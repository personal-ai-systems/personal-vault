#!/usr/bin/env node

import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, appendFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

const VAULT_ROOT = path.resolve(process.env.PERSONAL_VAULT_ROOT || path.join(process.env.HOME || '', 'personal-vault'));
const PORT = Number(process.env.MCP_PORT || process.env.PORT || 8787);
const MCP_PATH = '/mcp';
const CONTRACT_VERSION = 'personal-vault/v1';
const GOOGLE_AUTH_ENABLED = process.env.MCP_GOOGLE_AUTH === 'true';
const MCP_PUBLIC_BASE_URL = (process.env.MCP_PUBLIC_BASE_URL || '').replace(/\/$/, '');
const GOOGLE_ALLOWED_EMAILS = new Set((process.env.GOOGLE_ALLOWED_EMAILS || '').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean));
const GOOGLE_ALLOWED_DOMAINS = new Set((process.env.GOOGLE_ALLOWED_DOMAINS || '').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean));
const STORE_ROOT = path.join(VAULT_ROOT, '.personal-vault');
const RECORDS_ROOT = path.join(STORE_ROOT, 'records');
const AUDIT_PATH = path.join(STORE_ROOT, 'audit', 'events.jsonl');
const IDEMPOTENCY_PATH = path.join(STORE_ROOT, 'indexes', 'idempotency.json');

const actorSchema = z.object({ kind: z.enum(['user', 'application', 'service', 'migration', 'recovery']), id: z.string().min(1).max(256), displayName: z.string().min(1).max(256).optional() });
const provenanceSchema = z.object({
  origin: z.enum(['direct', 'import', 'derivation', 'migration', 'recovery']),
  capturedAt: z.string().datetime(),
  capturedBy: actorSchema,
  sourceLocator: z.string().max(4096).optional(),
  sourceRecordIds: z.array(z.string()).optional(),
  processor: z.object({ id: z.string().min(1), version: z.string().min(1), configurationHash: z.string().optional() }).optional(),
  sourceHash: z.string().optional(),
});
const approvalSchema = z.object({ kind: z.enum(['user', 'migration', 'recovery']), approvedAt: z.string().datetime(), approvedBy: actorSchema, evidenceRef: z.string().min(1).max(4096), expiresAt: z.string().datetime().optional() });
const recordDraftSchema = z.object({ privacy: z.enum(['private', 'shared', 'public']), title: z.string().min(1).max(1024).optional(), content: z.string(), provenance: provenanceSchema, metadata: z.record(z.string(), z.unknown()).default({}), assetRefs: z.array(z.unknown()).default([]) });
const mutationSchema = z.object({ contractVersion: z.literal(CONTRACT_VERSION), mutationId: z.string().regex(/^pvm_[0-9A-HJKMNP-TV-Z]{26}$/), requestedAt: z.string().datetime(), requestedBy: actorSchema, idempotencyKey: z.string().min(16).max(256), approval: approvalSchema, operation: z.object({ type: z.enum(['record.create', 'record.revise', 'record.archive', 'record.restore', 'record.trash']) }).passthrough(), provenance: provenanceSchema });

const CROCKFORD_BASE32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function encodeTime(value) {
  let remaining = value;
  let encoded = '';
  for (let index = 0; index < 10; index += 1) {
    encoded = CROCKFORD_BASE32[remaining % 32] + encoded;
    remaining = Math.floor(remaining / 32);
  }
  return encoded;
}

function makeId(prefix) {
  const random = randomBytes(16);
  const suffix = Array.from(random, (byte) => CROCKFORD_BASE32[byte & 31]).join('');
  return `${prefix}_${encodeTime(Date.now())}${suffix}`;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function recordPath(recordId) {
  if (!/^pvr_[0-9A-HJKMNP-TV-Z]{26}$/.test(recordId)) throw new Error('Invalid recordId.');
  return path.join(RECORDS_ROOT, `${recordId}.md`);
}

function toMarkdown(record) {
  const { content, ...header } = record;
  return `<!-- personal-vault-record\n${JSON.stringify(header, null, 2)}\n-->\n${content}`;
}

function fromMarkdown(markdown) {
  const match = markdown.match(/^<!-- personal-vault-record\n([\s\S]*?)\n-->\n?([\s\S]*)$/);
  if (!match) throw new Error('Record is not a Personal Vault v1 Markdown record.');
  return { ...JSON.parse(match[1]), content: match[2] };
}

async function ensureStore() {
  await Promise.all([mkdir(RECORDS_ROOT, { recursive: true }), mkdir(path.dirname(AUDIT_PATH), { recursive: true }), mkdir(path.dirname(IDEMPOTENCY_PATH), { recursive: true })]);
}

async function readRecord(recordId) {
  return fromMarkdown(await readFile(recordPath(recordId), 'utf8'));
}

async function writeRecord(record) {
  await ensureStore();
  await writeFile(recordPath(record.recordId), toMarkdown(record), 'utf8');
}

async function readIdempotencyIndex() {
  try {
    return JSON.parse(await readFile(IDEMPOTENCY_PATH, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return {};
    throw error;
  }
}

async function appendAudit({ mutation, record }) {
  const event = {
    contractVersion: CONTRACT_VERSION,
    eventId: makeId('pve'),
    sequence: Date.now(),
    occurredAt: new Date().toISOString(),
    mutationId: mutation.mutationId,
    action: mutation.operation.type,
    actor: mutation.requestedBy,
    resourceId: record.recordId,
    resultingRevision: record.revision,
    provenance: mutation.provenance,
  };
  await appendFile(AUDIT_PATH, `${JSON.stringify(event)}\n`, 'utf8');
  return event;
}

function assertApproval(approval) {
  if (approval.expiresAt && new Date(approval.expiresAt).getTime() < Date.now()) throw new Error('Approval has expired.');
}

function assertMetadata(metadata) {
  for (const key of Object.keys(metadata)) {
    if (!/^[a-z][a-z0-9-]{0,63}(?:\.[a-z][a-z0-9-]{0,63})+$/.test(key)) throw new Error(`Metadata key must be namespaced: ${key}`);
  }
}

async function applyMutation(input) {
  const mutation = mutationSchema.parse(input);
  assertApproval(mutation.approval);
  await ensureStore();
  const idempotency = await readIdempotencyIndex();
  const fingerprint = sha256(JSON.stringify(mutation));
  const previous = idempotency[mutation.idempotencyKey];
  if (previous) {
    if (previous.fingerprint !== fingerprint) throw new Error('Idempotency key conflicts with a different mutation.');
    return { ...previous.result, replayed: true };
  }

  const now = new Date().toISOString();
  let record;
  const operation = mutation.operation;
  if (operation.type === 'record.create') {
    const draft = recordDraftSchema.parse(operation.record);
    assertMetadata(draft.metadata);
    record = {
      contractVersion: CONTRACT_VERSION,
      recordId: makeId('pvr'),
      revision: 1,
      state: 'active',
      createdAt: now,
      updatedAt: now,
      createdBy: mutation.requestedBy,
      privacy: draft.privacy,
      title: draft.title,
      content: draft.content,
      provenance: draft.provenance,
      assetRefs: draft.assetRefs,
      metadata: draft.metadata,
    };
  } else {
    const recordId = z.string().min(1).parse(operation.recordId);
    record = await readRecord(recordId);
    if (operation.baseRevision !== record.revision) throw new Error('Record revision conflict.');
    if (operation.type === 'record.revise') {
      const replacement = recordDraftSchema.parse(operation.record);
      assertMetadata(replacement.metadata);
      record = {
        ...record,
        revision: record.revision + 1,
        updatedAt: now,
        privacy: replacement.privacy,
        title: replacement.title,
        content: replacement.content,
        provenance: replacement.provenance,
        assetRefs: replacement.assetRefs,
        metadata: replacement.metadata,
      };
    } else {
      record = { ...record, revision: record.revision + 1, updatedAt: now, state: operation.type === 'record.archive' ? 'archived' : operation.type === 'record.restore' ? 'active' : 'trashed' };
    }
  }
  await writeRecord(record);
  const auditEvent = await appendAudit({ mutation, record });
  const result = { record, auditEvent, replayed: false };
  idempotency[mutation.idempotencyKey] = { fingerprint, result };
  await writeFile(IDEMPOTENCY_PATH, `${JSON.stringify(idempotency, null, 2)}\n`, 'utf8');
  return result;
}

async function listRecords() {
  await ensureStore();
  const entries = await readdir(RECORDS_ROOT, { withFileTypes: true });
  return Promise.all(entries.filter((entry) => entry.isFile() && entry.name.endsWith('.md')).map((entry) => readRecord(entry.name.slice(0, -3))));
}

function getHeader(headers, name) {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function getPublicBaseUrl(req) {
  if (MCP_PUBLIC_BASE_URL) return MCP_PUBLIC_BASE_URL;
  const host = getHeader(req.headers, 'host') || `127.0.0.1:${PORT}`;
  const forwardedProto = getHeader(req.headers, 'x-forwarded-proto');
  const protocol = forwardedProto || (host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https');
  return `${protocol}://${host}`;
}

function authError(extra, reason) {
  return { isError: true, content: [{ type: 'text', text: reason }], _meta: { 'mcp/www_authenticate': `Bearer resource_metadata="${getPublicBaseUrl(extra.requestInfo?.request || { headers: {} })}/.well-known/oauth-protected-resource"` } };
}

async function requireGoogleAuth(extra) {
  if (!GOOGLE_AUTH_ENABLED) return { ok: true };
  const authorization = getHeader(extra.requestInfo?.headers || {}, 'authorization') || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) return { ok: false, reason: 'A Personal Vault access token is required.' };
  const response = await fetch(`https://openidconnect.googleapis.com/v1/userinfo`, { headers: { authorization: `Bearer ${match[1]}` } });
  if (!response.ok) return { ok: false, reason: 'The access token is invalid or expired.' };
  const profile = await response.json();
  const email = String(profile.email || '').toLowerCase();
  const domain = email.split('@')[1] || '';
  if ((GOOGLE_ALLOWED_EMAILS.size || GOOGLE_ALLOWED_DOMAINS.size) && !GOOGLE_ALLOWED_EMAILS.has(email) && !GOOGLE_ALLOWED_DOMAINS.has(domain)) return { ok: false, reason: 'The authenticated account is not allowed.' };
  return { ok: true, profile };
}

function createMcpServer() {
  const server = new McpServer({ name: 'personal-vault', version: '0.1.0' }, { instructions: 'Personal Vault stores and retrieves generic records. It does not interpret application-domain meaning or generate recommendations.' });
  const withAuth = (handler) => async (args, extra) => {
    const auth = await requireGoogleAuth(extra);
    if (!auth.ok) return authError(extra, auth.reason);
    try {
      return await handler(args);
    } catch (error) {
      return { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : 'Unexpected error.' }] };
    }
  };

  server.registerTool('vault.mutations.append', { title: 'Append approved mutation', description: 'Append an approved generic record mutation with provenance and audit history.', inputSchema: { mutation: z.unknown() } }, withAuth(async ({ mutation }) => {
    const result = await applyMutation(mutation);
    return { content: [{ type: 'text', text: `Applied ${result.auditEvent.action} to ${result.record.recordId}.` }], structuredContent: result };
  }));
  server.registerTool('vault.records.create', { title: 'Create record', description: 'Create a generic record from an approved record.create mutation.', inputSchema: { mutation: z.unknown() } }, withAuth(async ({ mutation }) => {
    const result = await applyMutation(mutation);
    if (result.auditEvent.action !== 'record.create') throw new Error('vault.records.create accepts only record.create mutations.');
    return { content: [{ type: 'text', text: `Created record ${result.record.recordId}.` }], structuredContent: result };
  }));
  server.registerTool('vault.records.get', { title: 'Get record', description: 'Read a generic record by stable identifier.', inputSchema: { recordId: z.string().min(1) } }, withAuth(async ({ recordId }) => {
    const record = await readRecord(recordId);
    return { content: [{ type: 'text', text: record.content }], structuredContent: { record } };
  }));
  server.registerTool('vault.records.search', { title: 'Search records', description: 'Search generic record title and content without domain interpretation.', inputSchema: { query: z.string().min(1), limit: z.number().int().min(1).max(100).optional() } }, withAuth(async ({ query, limit = 20 }) => {
    const normalized = query.toLowerCase();
    const matches = (await listRecords()).flatMap((record) => {
      const haystack = `${record.title || ''}\n${record.content}`.toLowerCase();
      const index = haystack.indexOf(normalized);
      return index < 0 ? [] : [{ recordId: record.recordId, revision: record.revision, state: record.state, privacy: record.privacy, title: record.title || null, snippet: `${record.title || ''}\n${record.content}`.slice(Math.max(0, index - 120), index + 280).replace(/\s+/g, ' ').trim() }];
    }).slice(0, limit);
    return { content: [{ type: 'text', text: matches.length ? `Found ${matches.length} record(s).` : 'No records found.' }], structuredContent: { query, matches } };
  }));
  server.registerTool('vault.changes.list', { title: 'List changes', description: 'List generic audit events after an optional numeric cursor.', inputSchema: { cursor: z.number().int().nonnegative().optional(), limit: z.number().int().min(1).max(100).optional() } }, withAuth(async ({ cursor = 0, limit = 50 }) => {
    const text = await readFile(AUDIT_PATH, 'utf8').catch((error) => error?.code === 'ENOENT' ? '' : Promise.reject(error));
    const events = text.split('\n').filter(Boolean).map((line) => JSON.parse(line)).filter((event) => event.sequence > cursor).slice(0, limit);
    const nextCursor = events.length ? events.at(-1).sequence : cursor;
    return { content: [{ type: 'text', text: `Returned ${events.length} change event(s).` }], structuredContent: { contractVersion: CONTRACT_VERSION, events, nextCursor, hasMore: false } };
  }));
  return server;
}

const httpServer = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'GET' && url.pathname === '/') return void res.writeHead(200, { 'content-type': 'text/plain' }).end('Personal Vault MCP server');
  if (req.method === 'GET' && url.pathname === '/status') return void res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify({ status: 'ok', server: 'personal-vault', contractVersion: CONTRACT_VERSION, mcpEndpoint: `${getPublicBaseUrl(req)}${MCP_PATH}`, authentication: GOOGLE_AUTH_ENABLED ? 'oauth-required' : 'disabled' }));
  if (req.method === 'GET' && url.pathname === '/.well-known/oauth-protected-resource') return void res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ resource: getPublicBaseUrl(req), authorization_servers: ['https://accounts.google.com'], scopes_supported: ['openid', 'email', 'profile'] }));
  if (req.method === 'OPTIONS' && url.pathname === MCP_PATH) return void res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, GET, DELETE, OPTIONS', 'Access-Control-Allow-Headers': 'content-type, mcp-session-id, authorization', 'Access-Control-Expose-Headers': 'Mcp-Session-Id' }).end();
  if (url.pathname !== MCP_PATH || !['POST', 'GET', 'DELETE'].includes(req.method || '')) return void res.writeHead(404).end('Not found');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');
  const server = createMcpServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => { transport.close(); server.close(); });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res);
  } catch (error) {
    console.error('MCP request failed:', error);
    if (!res.headersSent) res.writeHead(500).end('Internal server error');
  }
});

httpServer.listen(PORT, () => console.log(`Personal Vault MCP server listening on http://localhost:${PORT}${MCP_PATH}`));
