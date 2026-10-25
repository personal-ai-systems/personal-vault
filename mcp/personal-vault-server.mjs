#!/usr/bin/env node

// Personal Vault MCP 0.6.1 — one server, one endpoint, one library.
//
// It replaces the previous two-process setup:
//   8788  personal-vault/mcp/personal-vault-server.mjs      (generic file API)
//   8787  personal-dashboard/mcp/personal-assistant-server.mjs (capture facade that
//                                                              proxied to 8788 over MCP)
// The facade is gone: capture tools call the file functions in-process, so there is
// no loopback MCP hop and no second port to keep in sync.
//
// One endpoint (/mcp) exposes one set of tool names, all underscored. Several
// model providers reject dots in function names before the model is ever
// called, so a tool name here never contains a dot. Callers that still send the
// old dotted names (vault.files.read) must migrate to vault_files_read.
//
// This file is an ADAPTER. The file mechanics live in lib/index.mjs so the
// desktop app and the Assistant can share one implementation instead of a copy.
// What stays here is what only a network server needs: environment config,
// authentication, the HTTP transport, and tool registration.
//
// Local use is open. Remote use is opt-in: set MCP_SERVICE_TOKENS or
// MCP_GOOGLE_AUTH=true and every non-loopback request must then carry credentials.
// MCP_TRUST_LOCALHOST=true keeps loopback callers (local clients, health checks, scripts)
// credential-free, because anything running as this user can read the Vault files
// directly anyway. The tunnel also arrives from loopback, so forwarded headers
// disqualify the shortcut and remote callers stay challenged.

import { createServer } from 'node:http';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createHash, timingSafeEqual } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { z } from 'zod';
import { createVault } from '../lib/index.mjs';

const vault = createVault({ root: process.env.PERSONAL_VAULT_ROOT || path.join(process.env.HOME || '', 'personal-vault') });
const VAULT_ROOT = vault.root;
const { list, readText, writeText, archive, restore, search, attach, captureNote, captureAsset, today } = vault;

const HOST = process.env.MCP_HOST || '127.0.0.1';
const PORT = Number(process.env.MCP_PORT || process.env.PORT || 8788);
const MCP_PATH = '/mcp';
const SERVER_NAME = 'personal-vault';
const SERVER_VERSION = '0.6.1';
const CONTEXT_FILE = process.env.MCP_CONTEXT_FILE || '';
const CONTEXT_URI = 'vault://context';
const BASE_INSTRUCTIONS = 'Personal Vault is a simple, readable folder of Markdown files and attachments. File tools browse and edit that folder; capture tools save new notes into it.';

const PUBLIC_URL = (process.env.MCP_PUBLIC_BASE_URL || '').replace(/\/$/, '');
const GOOGLE_AUTH_ENABLED = process.env.MCP_GOOGLE_AUTH === 'true';
const SERVICE_TOKENS = new Set((process.env.MCP_SERVICE_TOKENS || '').split(',').map((value) => value.trim()).filter(Boolean));
const AUTH_ENABLED = GOOGLE_AUTH_ENABLED || SERVICE_TOKENS.size > 0;
const ALLOWED_EMAILS = new Set((process.env.GOOGLE_ALLOWED_EMAILS || '').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean));
const ALLOWED_DOMAINS = new Set((process.env.GOOGLE_ALLOWED_DOMAINS || '').split(',').map((value) => value.trim().toLowerCase().replace(/^@/, '')).filter(Boolean));
const CHALLENGE_MODE = (process.env.MCP_AUTH_CHALLENGE_MODE || 'http-401').trim().toLowerCase() === 'in-band' ? 'in-band' : 'http-401';
const TRUST_LOCALHOST = process.env.MCP_TRUST_LOCALHOST === 'true';
// The MCP SDK builds each tool handler's requestInfo from the raw socket headers, so a
// loopback decision made in the HTTP handler cannot be expressed by rewriting
// req.headers. Request-scoped storage carries it into the handlers instead.
const requestContext = new AsyncLocalStorage();
const GOOGLE_USERINFO_URL = process.env.GOOGLE_USERINFO_URL || 'https://www.googleapis.com/oauth2/v3/userinfo';
const OAUTH_SCOPES = ['openid', 'email', 'profile'];
const attachmentSchema = z.object({ name: z.string().optional(), dataBase64: z.string().optional(), dataUrl: z.string().optional(), alt: z.string().optional(), caption: z.string().optional() });

// --------------------------------------------------------------------- auth

function publicUrl(req) { return PUBLIC_URL || `http://${req?.headers?.host || `localhost:${PORT}`}`; }
function challengeValue(host) {
  const base = PUBLIC_URL || `https://${host || `localhost:${PORT}`}`;
  return `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource", scope="${OAUTH_SCOPES.join(' ')}"`;
}
function authMessage() {
  return SERVICE_TOKENS.size ? 'Provide a valid service token or sign in with the allowed Google account before accessing private Vault files.' : 'Sign in with the allowed Google account before accessing private Vault files.';
}
function authError(req) {
  const challenge = GOOGLE_AUTH_ENABLED ? { 'mcp/www_authenticate': challengeValue(req?.requestInfo?.headers?.host) } : {};
  return { isError: true, content: [{ type: 'text', text: authMessage() }], _meta: challenge };
}
function bearerToken(header) {
  const match = /^Bearer\s+(.+)$/i.exec(String(header || ''));
  return match ? match[1].trim() : null;
}
function fromTrustedLoopback(req) {
  const proxied = req.headers['x-forwarded-for'] || req.headers['x-forwarded-proto'] || req.headers['x-real-ip'] || req.headers.forwarded;
  if (proxied) return false;
  const remote = req.socket?.remoteAddress || '';
  return remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
}
function matchesServiceToken(token) {
  if (!SERVICE_TOKENS.size) return false;
  const candidate = Buffer.from(String(token));
  let matched = false;
  for (const known of SERVICE_TOKENS) {
    const expected = Buffer.from(known);
    if (expected.length === candidate.length && timingSafeEqual(expected, candidate)) matched = true;
  }
  return matched;
}
function emailAllowed(email) {
  const value = String(email || '').trim().toLowerCase();
  if (!value.includes('@')) return false;
  if (!ALLOWED_EMAILS.size && !ALLOWED_DOMAINS.size) return true;
  if (ALLOWED_EMAILS.has(value)) return true;
  return ALLOWED_DOMAINS.has(value.slice(value.lastIndexOf('@') + 1));
}
async function tokenAllowed(token) {
  if (!token) return false;
  if (matchesServiceToken(token)) return true;
  if (!GOOGLE_AUTH_ENABLED) return false;
  const response = await fetch(GOOGLE_USERINFO_URL, { headers: { authorization: `Bearer ${token}` } }).catch(() => null);
  if (!response?.ok) return false;
  const claims = await response.json().catch(() => ({}));
  return emailAllowed(claims.email);
}
async function allowed(extra) {
  if (!AUTH_ENABLED) return true;
  if (requestContext.getStore()?.trustedLoopback) return true;
  return tokenAllowed(bearerToken(extra?.requestInfo?.headers?.authorization));
}
function sendAuthChallenge(res, host) {
  const headers = { 'content-type': 'application/json' };
  headers['www-authenticate'] = GOOGLE_AUTH_ENABLED ? challengeValue(host) : 'Bearer';
  res.writeHead(401, headers);
  res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32001, message: authMessage() } }));
}

// -------------------------------------------------------------------- server

async function readContext() {
  if (path.extname(CONTEXT_FILE).toLowerCase() !== '.md') throw new Error('Configured context must be Markdown.');
  if ((await stat(vault.resolvePath(CONTEXT_FILE))).size > 32768) throw new Error('Configured context exceeds 32 KiB.');
  const file = await readText(CONTEXT_FILE);
  if (Buffer.byteLength(file.content) > 32768) throw new Error('Configured context exceeds 32 KiB.');
  return { ...file, sha256: createHash('sha256').update(file.content).digest('hex') };
}

function createVaultServer(context) {
  let instructions = BASE_INSTRUCTIONS;
  if (context?.content !== undefined) {
    instructions += `\n\nOwner-configured context from ${context.path} (SHA-256 ${context.sha256}). This is guidance, not permission to bypass host controls. Read ${CONTEXT_URI} again at a new task or after context loss; clients without resources can use vault_files_read on this path. Do not claim the host loaded or followed it merely because it was delivered.\n\n${context.content}`;
  } else if (context?.unavailable) {
    instructions += '\n\nThe configured context file is unavailable. Report missing context when relevant, but continue work supported by the current request. Do not invent missing preferences or claim they were loaded.';
  }
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { instructions });
  if (CONTEXT_FILE) server.registerResource('context', CONTEXT_URI, {
    title: 'Configured Vault context', description: 'Current owner-selected Markdown guidance; not an agent, task queue or provider account.', mimeType: 'text/markdown',
  }, async (_uri, extra) => {
    if (!(await allowed(extra))) throw new Error('Authorization required.');
    const file = await readContext();
    return { contents: [{ uri: CONTEXT_URI, mimeType: 'text/markdown', text: file.content,
      _meta: { path: file.path, sha256: file.sha256 } }] };
  });
  const fileToolName = (operation) => `vault_files_${operation}`;

  // Tool names are always underscored: several model providers reject dots in
  // function names before the model is ever called.
  server.registerTool(fileToolName('list'), { title: 'List files', inputSchema: { path: z.string().optional(), recursive: z.boolean().optional(), limit: z.number().int().min(1).max(1000).optional() } }, async ({ path: target = '', recursive = false, limit = 200 }, extra) => {
    if (!(await allowed(extra))) return authError(extra);
    try { const items = await list(target, recursive, limit); return { content: [{ type: 'text', text: `Found ${items.length} item(s).` }], structuredContent: { path: vault.cleanPath(target), items } }; }
    catch (error) { return { isError: true, content: [{ type: 'text', text: error.message }] }; }
  });
  server.registerTool(fileToolName('read'), { title: 'Read a text file', inputSchema: { path: z.string().min(1) } }, async ({ path: target }, extra) => {
    if (!(await allowed(extra))) return authError(extra);
    try { return { content: [{ type: 'text', text: `Read ${target}.` }], structuredContent: await readText(target) }; }
    catch (error) { return { isError: true, content: [{ type: 'text', text: error.message }] }; }
  });
  server.registerTool(fileToolName('create'), { title: 'Create a text file', inputSchema: { path: z.string().min(1), content: z.string() } }, async ({ path: target, content }, extra) => {
    if (!(await allowed(extra))) return authError(extra);
    try { return { content: [{ type: 'text', text: `Created ${target}.` }], structuredContent: await writeText(target, content) }; }
    catch (error) { return { isError: true, content: [{ type: 'text', text: error.message }] }; }
  });
  server.registerTool(fileToolName('update'), { title: 'Update a text file', inputSchema: { path: z.string().min(1), content: z.string() } }, async ({ path: target, content }, extra) => {
    if (!(await allowed(extra))) return authError(extra);
    try { return { content: [{ type: 'text', text: `Updated ${target}.` }], structuredContent: await writeText(target, content, true) }; }
    catch (error) { return { isError: true, content: [{ type: 'text', text: error.message }] }; }
  });
  server.registerTool(fileToolName('archive'), { title: 'Archive a file', inputSchema: { path: z.string().min(1) } }, async ({ path: target }, extra) => {
    if (!(await allowed(extra))) return authError(extra);
    try { return { content: [{ type: 'text', text: `Archived ${target}.` }], structuredContent: await archive(target) }; }
    catch (error) { return { isError: true, content: [{ type: 'text', text: error.message }] }; }
  });
  server.registerTool(fileToolName('restore'), { title: 'Restore an archived file', inputSchema: { path: z.string().min(1) } }, async ({ path: target }, extra) => {
    if (!(await allowed(extra))) return authError(extra);
    try { return { content: [{ type: 'text', text: `Restored ${target}.` }], structuredContent: await restore(target) }; }
    catch (error) { return { isError: true, content: [{ type: 'text', text: error.message }] }; }
  });
  server.registerTool(fileToolName('search'), { title: 'Search text files', inputSchema: { query: z.string().min(1), limit: z.number().int().min(1).max(100).optional() } }, async ({ query, limit = 20 }, extra) => {
    if (!(await allowed(extra))) return authError(extra);
    try { const matches = await search(query, limit); return { content: [{ type: 'text', text: `Found ${matches.length} match(es).` }], structuredContent: { query, matches } }; }
    catch (error) { return { isError: true, content: [{ type: 'text', text: error.message }] }; }
  });
  server.registerTool(fileToolName('attach'), { title: 'Save an attachment beside Markdown', inputSchema: { markdownPath: z.string().min(1), name: z.string().min(1), dataBase64: z.string().min(1) } }, async ({ markdownPath, name, dataBase64 }, extra) => {
    if (!(await allowed(extra))) return authError(extra);
    try { return { content: [{ type: 'text', text: `Saved ${name}.` }], structuredContent: await attach(markdownPath, name, dataBase64) }; }
    catch (error) { return { isError: true, content: [{ type: 'text', text: error.message }] }; }
  });

  // Capture tools — moved here from the retired 8787 facade.
  // The file mechanics (frontmatter, collision-free path, .assets writes) live in
  // the library. proposalSet is presentation, so it is assembled here.
  server.registerTool('capture_note', { title: 'capture_note', description: 'Save a readable Markdown note in the Vault.', inputSchema: { input: z.string().min(1), title: z.string().optional(), projectId: z.string().optional(), intent: z.string().optional(), attachments: z.array(attachmentSchema).optional() } }, async ({ input, title, projectId, intent = 'note', attachments = [] }, extra) => {
    if (!(await allowed(extra))) return authError(extra);
    try {
      const saved = await captureNote({ input, title, projectId, intent, attachments });
      const proposalSet = { capturePath: saved.capturePath, proposals: [{ id: 'review-capture', label: 'Review this capture before changing plans', preview: 'The note is saved. Decide together whether it should affect a plan.' }], questions: [] };
      return { content: [{ type: 'text', text: `Saved readable Markdown: ${saved.capturePath}` }], structuredContent: { ...saved, proposalSet } };
    } catch (error) { return { isError: true, content: [{ type: 'text', text: error.message }] }; }
  });
  server.registerTool('capture_asset', { title: 'capture_asset', description: 'Save files beside an existing Markdown capture.', inputSchema: { capturePath: z.string().min(1), attachments: z.array(attachmentSchema).min(1) } }, async ({ capturePath: target, attachments }, extra) => {
    if (!(await allowed(extra))) return authError(extra);
    try {
      const saved = await captureAsset({ capturePath: target, attachments });
      return { content: [{ type: 'text', text: `Saved ${saved.assetCount} attachment(s) beside ${target}.` }], structuredContent: saved };
    } catch (error) { return { isError: true, content: [{ type: 'text', text: error.message }] }; }
  });
  // search_vault kept as the historical name of vault_files_search.
  server.registerTool('search_vault', { title: 'search_vault', description: 'Search readable Vault files.', inputSchema: { query: z.string().min(2), limit: z.number().int().min(1).max(20).optional() } }, async ({ query, limit = 5 }, extra) => {
    if (!(await allowed(extra))) return authError(extra);
    try { const matches = await search(query, limit); return { content: [{ type: 'text', text: matches.length ? `Found ${matches.length} match(es).` : 'No matches found.' }], structuredContent: { query, matches } }; }
    catch (error) { return { isError: true, content: [{ type: 'text', text: error.message }] }; }
  });
  server.registerTool('get_today_plan', { title: 'get_today_plan', description: 'Read the current Today plan file.', inputSchema: {} }, async (_args, extra) => {
    if (!(await allowed(extra))) return authError(extra);
    try {
      const file = await readText('structured/plans/daily-projection.json');
      const plan = JSON.parse(file.content);
      const tasks = (plan.tasks || []).filter((task) => task.date === today() && task.status !== 'dropped');
      return { content: [{ type: 'text', text: tasks.length ? `Today:\n${tasks.map((task) => `- ${task.title}`).join('\n')}` : 'No dated commitments are currently projected.' }], structuredContent: { date: today(), tasks, sourcePath: file.path } };
    } catch (error) { return { isError: true, content: [{ type: 'text', text: `Could not read Today plan: ${error.message}` }] }; }
  });
  server.registerTool('get_capture_review', { title: 'get_capture_review', description: 'Return the saved capture path for a conversational review.', inputSchema: { capturePath: z.string().min(1) } }, async ({ capturePath: target }, extra) => (await allowed(extra)) ? ({ content: [{ type: 'text', text: `Review ${target} with the user before changing any plan.` }], structuredContent: { capturePath: target, status: 'review-in-conversation' } }) : authError(extra));
  server.registerTool('apply_capture_action', { title: 'apply_capture_action', description: 'Record that a user approved a proposal; the Assistant should then make a clear, separate change.', inputSchema: { capturePath: z.string().min(1), proposalId: z.string() } }, async ({ capturePath: target, proposalId }, extra) => (await allowed(extra)) ? ({ content: [{ type: 'text', text: `The user approved ${proposalId} for ${target}. Make the next Assistant change explicitly and explain it.` }], structuredContent: { capturePath: target, proposalId, approved: true } }) : authError(extra));

  return server;
}

const httpServer = createServer(async (req, res) => {
  if (!req.url) return void res.writeHead(400).end('Missing URL');
  const url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);
  if (req.method === 'GET' && url.pathname === '/healthz') return void res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ status: 'ok', server: SERVER_NAME, version: SERVER_VERSION, mcpEndpoint: `${publicUrl(req)}${MCP_PATH}`, root: VAULT_ROOT, bind: HOST, storage: 'readable-files', authentication: [GOOGLE_AUTH_ENABLED ? 'google-oauth' : '', SERVICE_TOKENS.size ? `service-token(${SERVICE_TOKENS.size})` : '', TRUST_LOCALHOST ? 'loopback-trusted' : ''].filter(Boolean).join('+') || 'disabled', googleAllowlist: [ALLOWED_EMAILS.size ? `email(${ALLOWED_EMAILS.size})` : '', ALLOWED_DOMAINS.size ? `domain(${ALLOWED_DOMAINS.size})` : ''].filter(Boolean).join('+') || 'any-verified-google-account', challengeMode: AUTH_ENABLED ? CHALLENGE_MODE : 'none' }));
  if (req.method === 'GET' && url.pathname === '/status') return void res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ status: 'ok', server: SERVER_NAME, version: SERVER_VERSION, root: VAULT_ROOT, bind: HOST, mcpEndpoint: `http://${HOST}:${PORT}${MCP_PATH}` }));
  if (req.method === 'GET' && url.pathname === '/.well-known/oauth-protected-resource') return void res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ resource: publicUrl(req), authorization_servers: ['https://accounts.google.com'], scopes_supported: OAUTH_SCOPES }));
  if (req.method === 'OPTIONS' && url.pathname === MCP_PATH) return void res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, GET, DELETE, OPTIONS', 'Access-Control-Allow-Headers': 'content-type, mcp-session-id, authorization', 'Access-Control-Expose-Headers': 'Mcp-Session-Id' }).end();
  if (url.pathname !== MCP_PATH || !['POST', 'GET', 'DELETE'].includes(req.method || '')) return void res.writeHead(404).end('Not Found');
  const trustedLoopback = TRUST_LOCALHOST && fromTrustedLoopback(req) && !req.headers.authorization;
  // Startup guidance can contain private settings: authorize it even in in-band mode.
  const authorized = !AUTH_ENABLED || trustedLoopback || await tokenAllowed(bearerToken(req.headers.authorization)).catch(() => false);
  if (!authorized && CHALLENGE_MODE === 'http-401') return void sendAuthChallenge(res, req.headers.host);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');
  const context = CONTEXT_FILE && authorized ? await readContext().catch(() => ({ unavailable: true })) : null;
  const server = createVaultServer(context);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => { transport.close(); server.close(); });
  try { await requestContext.run({ trustedLoopback }, async () => { await server.connect(transport); await transport.handleRequest(req, res); }); }
  catch (error) { console.error('MCP request failed:', error); if (!res.headersSent) res.writeHead(500).end('Internal server error'); }
});

httpServer.listen(PORT, HOST, () => console.log(`Personal Vault MCP ${SERVER_VERSION} listening on http://${HOST}:${PORT}${MCP_PATH} (root ${VAULT_ROOT}, auth ${AUTH_ENABLED ? 'on' : 'off'})`));
