#!/usr/bin/env node

import { createServer } from 'node:http';
import { createHash, createCipheriv, createDecipheriv, randomBytes, scrypt as scryptCallback } from 'node:crypto';
import { promisify, isDeepStrictEqual } from 'node:util';
import { mkdir, readFile, writeFile, appendFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

const VAULT_ROOT = path.resolve(process.env.PERSONAL_VAULT_ROOT || path.join(process.env.HOME || '', 'personal-vault'));
const HOST = process.env.MCP_HOST || '127.0.0.1';
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
const JOURNAL_PATH = path.join(STORE_ROOT, 'indexes', 'pending.jsonl');
const ASSETS_ROOT = path.join(STORE_ROOT, 'assets');
const ASSETS_META_ROOT = path.join(ASSETS_ROOT, 'meta');
const ASSETS_PAYLOAD_ROOT = path.join(ASSETS_ROOT, 'payloads');
const EXPORTS_ROOT = path.join(VAULT_ROOT, 'exports');
const BACKUPS_ROOT = path.join(VAULT_ROOT, 'backups');

const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const RECORD_ID_PATTERN = /^pvr_[0-9A-HJKMNP-TV-Z]{26}$/;
const ASSET_ID_PATTERN = /^pva_[0-9A-HJKMNP-TV-Z]{26}$/;
const MEDIA_TYPE_PATTERN = /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+(?:;.*)?$/;
const actorSchema = z.object({ kind: z.enum(['user', 'application', 'service', 'migration', 'recovery']), id: z.string().min(1).max(256), displayName: z.string().min(1).max(256).optional() }).strict();
const processorSchema = z.object({ id: z.string().regex(/^[a-z][a-z0-9-]{0,63}(?:\.[a-z][a-z0-9-]{0,63})+$/), version: z.string().min(1).max(128), configurationHash: z.string().regex(SHA256_PATTERN).optional() }).strict();
const provenanceSchema = z.object({
  origin: z.enum(['direct', 'import', 'derivation', 'migration', 'recovery']),
  capturedAt: z.string().datetime(),
  capturedBy: actorSchema,
  sourceLocator: z.string().max(4096).optional(),
  sourceRecordIds: z.array(z.string().regex(RECORD_ID_PATTERN)).optional(),
  processor: processorSchema.optional(),
  sourceHash: z.string().regex(SHA256_PATTERN).optional(),
}).strict().superRefine((value, context) => {
  if (value.origin === 'derivation' && (!value.sourceRecordIds || !value.processor)) context.addIssue({ code: 'custom', message: 'Derived provenance requires sourceRecordIds and processor.' });
});
const approvalSchema = z.object({ kind: z.enum(['user', 'migration', 'recovery']), approvedAt: z.string().datetime(), approvedBy: actorSchema, evidenceRef: z.string().min(1).max(4096), expiresAt: z.string().datetime().optional() }).strict();
const privacySchema = z.enum(['private', 'restricted', 'shared', 'public']);
const contentSchema = z.object({ format: z.enum(['markdown', 'plain-text']), text: z.string(), hash: z.string().regex(SHA256_PATTERN), language: z.string().regex(/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{2,8})*$/).optional() }).strict();
const assetReferenceSchema = z.object({ assetId: z.string().regex(ASSET_ID_PATTERN), role: z.enum(['attachment', 'preview', 'source', 'derived']), caption: z.string().max(4096).optional() }).strict();
const assetReferenceDraftSchema = z.object({ role: z.enum(['attachment', 'preview', 'source', 'derived']), caption: z.string().max(4096).optional() }).strict();
const metadataSchema = z.record(z.string(), z.unknown());
const assetDraftSchema = z.object({ privacy: privacySchema, mediaType: z.string().regex(MEDIA_TYPE_PATTERN), byteLength: z.number().int().min(0), contentHash: z.string().regex(SHA256_PATTERN), originalName: z.string().max(1024).optional(), provenance: provenanceSchema, metadata: metadataSchema.optional() }).strict();
const assetPayloadSchema = z.object({ encoding: z.literal('base64'), dataBase64: z.string().regex(/^[A-Za-z0-9+/]*={0,2}$/) }).strict();
const recordDraftSchema = z.object({ privacy: privacySchema, title: z.string().min(1).max(1024).optional(), content: contentSchema, provenance: provenanceSchema, metadata: metadataSchema, assetRefs: z.array(assetReferenceSchema).optional().default([]) }).strict();
const recordSchema = z.object({ contractVersion: z.literal(CONTRACT_VERSION), recordId: z.string().regex(RECORD_ID_PATTERN), revision: z.number().int().min(1), state: z.enum(['active', 'archived', 'trashed']), createdAt: z.string().datetime(), updatedAt: z.string().datetime(), createdBy: actorSchema, privacy: privacySchema, title: z.string().min(1).max(1024).optional(), content: contentSchema, provenance: provenanceSchema, assetRefs: z.array(assetReferenceSchema), metadata: metadataSchema }).strict();
const createOperationSchema = z.object({ type: z.literal('record.create'), record: recordDraftSchema }).strict();
const reviseOperationSchema = z.object({ type: z.literal('record.revise'), recordId: z.string().regex(RECORD_ID_PATTERN), baseRevision: z.number().int().min(1), record: recordSchema }).strict();
const lifecycleOperationSchema = z.object({ type: z.enum(['record.archive', 'record.restore', 'record.trash']), recordId: z.string().regex(RECORD_ID_PATTERN), baseRevision: z.number().int().min(1), reason: z.string().max(4096).optional() }).strict();
const assetOperationSchema = z.object({ type: z.literal('asset.attach'), recordId: z.string().regex(RECORD_ID_PATTERN), baseRevision: z.number().int().min(1), asset: assetDraftSchema, reference: assetReferenceDraftSchema.optional(), payload: assetPayloadSchema }).strict();
const mutationSchema = z.object({ contractVersion: z.literal(CONTRACT_VERSION), mutationId: z.string().regex(/^pvm_[0-9A-HJKMNP-TV-Z]{26}$/), requestedAt: z.string().datetime(), requestedBy: actorSchema, idempotencyKey: z.string().min(16).max(256), approval: approvalSchema, operation: z.union([createOperationSchema, reviseOperationSchema, assetOperationSchema, lifecycleOperationSchema]), provenance: provenanceSchema }).strict();

const CROCKFORD_BASE32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const SCRIPT = promisify(scryptCallback);

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

function assetMetaPath(assetId) {
  if (!ASSET_ID_PATTERN.test(assetId)) throw new Error('Invalid assetId.');
  return path.join(ASSETS_META_ROOT, `${assetId}.json`);
}

function assetPayloadPath(contentHash) {
  const match = contentHash.match(/^sha256:([a-f0-9]{64})$/);
  if (!match) throw new Error('Invalid contentHash.');
  return path.join(ASSETS_PAYLOAD_ROOT, `${match[1]}.bin`);
}

async function fileExists(filePath) {
  return readFile(filePath).then(() => true).catch((error) => error.code === 'ENOENT' ? false : Promise.reject(error));
}

async function writeAssetMeta(asset) {
  await ensureStore();
  await writeFile(assetMetaPath(asset.assetId), `${JSON.stringify(asset, null, 2)}\n`, 'utf8');
}

async function readAsset(assetId) {
  return JSON.parse(await readFile(assetMetaPath(assetId), 'utf8'));
}

async function getAsset(assetId) {
  const asset = await readAsset(assetId);
  const payload = await readFile(assetPayloadPath(asset.contentHash));
  if (asset.byteLength !== payload.length) throw new Error('Asset byteLength does not match stored payload.');
  if (asset.contentHash !== `sha256:${sha256(payload)}`) throw new Error('Asset content hash does not match stored payload.');
  return { asset, payload: { encoding: 'base64', dataBase64: payload.toString('base64') } };
}

function toMarkdown(record) {
  const { content, ...recordHeader } = record;
  const { text, ...contentHeader } = content;
  const header = { ...recordHeader, content: contentHeader };
  return `<!-- personal-vault-record\n${JSON.stringify(header, null, 2)}\n-->\n${text}`;
}

function fromMarkdown(markdown) {
  const match = markdown.match(/^<!-- personal-vault-record\n([\s\S]*?)\n-->\n?([\s\S]*)$/);
  if (!match) throw new Error('Record is not a Personal Vault v1 Markdown record.');
  const header = JSON.parse(match[1]);
  return recordSchema.parse({ ...header, content: { ...header.content, text: match[2] } });
}

async function ensureStore() {
  await Promise.all([mkdir(RECORDS_ROOT, { recursive: true }), mkdir(path.dirname(AUDIT_PATH), { recursive: true }), mkdir(path.dirname(IDEMPOTENCY_PATH), { recursive: true }), mkdir(ASSETS_META_ROOT, { recursive: true }), mkdir(ASSETS_PAYLOAD_ROOT, { recursive: true })]);
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

async function readAuditEvents() {
  const text = await readFile(AUDIT_PATH, 'utf8').catch((error) => error?.code === 'ENOENT' ? '' : Promise.reject(error));
  return text.split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

async function readJournal() {
  const text = await readFile(JOURNAL_PATH, 'utf8').catch((error) => error?.code === 'ENOENT' ? '' : Promise.reject(error));
  return text.split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

async function writeJournal(entries) {
  await ensureStore();
  const text = entries.map((entry) => JSON.stringify(entry)).join('\n');
  await writeFile(JOURNAL_PATH, text ? `${text}\n` : '', 'utf8');
}

async function appendJournal(entry) {
  await ensureStore();
  await appendFile(JOURNAL_PATH, `${JSON.stringify(entry)}\n`, 'utf8');
}

async function removeJournalEntry(entry) {
  const entries = await readJournal();
  await writeJournal(entries.filter((candidate) => candidate.mutationId !== entry.mutationId));
}

async function recoverPendingMutations() {
  await ensureStore();
  const entries = await readJournal();
  if (!entries.length) return { recovered: 0, committed: 0, rolledBack: 0 };

  const idempotency = await readIdempotencyIndex();
  const auditEvents = await readAuditEvents();
  let committed = 0;
  let rolledBack = 0;

  for (const entry of entries) {
    const auditEvent = auditEvents.find((event) => event.mutationId === entry.mutationId);
    if (auditEvent) {
      const record = await readRecord(entry.recordId);
      const result = { record, auditEvent, replayed: false };
      if (entry.operationType === 'asset.attach' && entry.assetId) result.asset = await readAsset(entry.assetId);
      idempotency[entry.idempotencyKey] = { fingerprint: entry.fingerprint, result };
      committed += 1;
    } else if (entry.previousRecord) {
      await writeRecord(entry.previousRecord);
      if (entry.operationType === 'asset.attach') {
        if (entry.assetMetaPath) await rm(entry.assetMetaPath, { force: true });
        if (entry.assetPayloadPath && !entry.assetPayloadExisted) await rm(entry.assetPayloadPath, { force: true });
      }
      rolledBack += 1;
    } else {
      await rm(recordPath(entry.recordId), { force: true });
      rolledBack += 1;
    }
  }

  await writeFile(IDEMPOTENCY_PATH, `${JSON.stringify(idempotency, null, 2)}\n`, 'utf8');
  await writeJournal([]);
  return { recovered: entries.length, committed, rolledBack };
}

const AUDIT_ACTIONS = {
  'record.create': 'record.created',
  'record.revise': 'record.revised',
  'record.archive': 'record.archived',
  'record.restore': 'record.restored',
  'record.trash': 'record.trashed',
  'asset.attach': 'asset.attached',
};

async function appendAudit({ mutation, record, asset }) {
  const existingEvents = await readAuditEvents();
  const previousSequence = existingEvents.length ? existingEvents.at(-1).sequence : 0;
  const previousEventHash = existingEvents.length ? existingEvents.at(-1).eventHash : null;
  const resource = { recordId: record.recordId, revision: record.revision };
  if (asset) resource.assetId = asset.assetId;
  const baseEvent = {
    contractVersion: CONTRACT_VERSION,
    eventId: makeId('pve'),
    sequence: Math.max(Date.now(), previousSequence + 1),
    occurredAt: new Date().toISOString(),
    mutationId: mutation.mutationId,
    action: AUDIT_ACTIONS[mutation.operation.type],
    actor: mutation.requestedBy,
    resource,
    provenance: mutation.provenance,
  };
  const event = {
    ...baseEvent,
    ...(previousEventHash ? { previousEventHash } : {}),
    eventHash: `sha256:${sha256(JSON.stringify({ ...baseEvent, ...(previousEventHash ? { previousEventHash } : {}) }))}`,
  };
  await appendFile(AUDIT_PATH, `${JSON.stringify(event)}\n`, 'utf8');
  return event;
}

function assertApproval(approval) {
  if (approval.expiresAt && new Date(approval.expiresAt).getTime() < Date.now()) throw new Error('Approval has expired.');
}

function assertContentIntegrity(content) {
  if (content.hash !== `sha256:${sha256(content.text)}`) throw new Error('Record content hash does not match its text.');
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
  let previousRecord = null;
  let assetRecord = null;
  let assetFiles = null;
  let payloadBuffer = null;
  const operation = mutation.operation;
  if (operation.type === 'record.create') {
    const draft = recordDraftSchema.parse(operation.record);
    assertMetadata(draft.metadata);
    assertContentIntegrity(draft.content);
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
  } else if (operation.type === 'asset.attach') {
    const assetDraft = assetDraftSchema.parse(operation.asset);
    const payload = assetPayloadSchema.parse(operation.payload);
    payloadBuffer = Buffer.from(payload.dataBase64, 'base64');
    if (assetDraft.contentHash !== `sha256:${sha256(payloadBuffer)}`) throw new Error('Asset content hash does not match payload.');
    if (assetDraft.byteLength !== payloadBuffer.length) throw new Error('Asset byteLength does not match payload.');
    record = await readRecord(operation.recordId);
    previousRecord = record;
    if (operation.baseRevision !== record.revision) throw new Error('Record revision conflict.');
    const assetId = makeId('pva');
    assetRecord = {
      contractVersion: CONTRACT_VERSION,
      assetId,
      createdAt: now,
      createdBy: mutation.requestedBy,
      privacy: assetDraft.privacy,
      mediaType: assetDraft.mediaType,
      byteLength: assetDraft.byteLength,
      contentHash: assetDraft.contentHash,
      ...(assetDraft.originalName !== undefined ? { originalName: assetDraft.originalName } : {}),
      provenance: assetDraft.provenance,
      ...(assetDraft.metadata !== undefined ? { metadata: assetDraft.metadata } : {}),
    };
    const referenceDraft = assetReferenceDraftSchema.parse(operation.reference ?? { role: 'attachment' });
    const reference = { assetId, role: referenceDraft.role, ...(referenceDraft.caption !== undefined ? { caption: referenceDraft.caption } : {}) };
    const metaPath = assetMetaPath(assetId);
    const payloadPath = assetPayloadPath(assetDraft.contentHash);
    const payloadExisted = await fileExists(payloadPath);
    assetFiles = { metaPath, payloadPath, payloadExisted };
    record = { ...record, revision: record.revision + 1, updatedAt: now, assetRefs: [...record.assetRefs, reference] };
  } else {
    const recordId = z.string().min(1).parse(operation.recordId);
    record = await readRecord(recordId);
    previousRecord = record;
    if (operation.baseRevision !== record.revision) throw new Error('Record revision conflict.');
    if (operation.type === 'record.revise') {
      const replacement = recordSchema.parse(operation.record);
      if (replacement.recordId !== operation.recordId) throw new Error('Revised recordId does not match operation.recordId.');
      if (replacement.revision !== operation.baseRevision + 1) throw new Error('Revised record must contain the next revision.');
      assertMetadata(replacement.metadata);
      assertContentIntegrity(replacement.content);
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
  const journalEntry = {
    idempotencyKey: mutation.idempotencyKey,
    fingerprint,
    mutationId: mutation.mutationId,
    operationType: operation.type,
    recordId: record.recordId,
    previousRecord,
    assetId: assetRecord?.assetId,
    assetMetaPath: assetFiles?.metaPath,
    assetPayloadPath: assetFiles?.payloadPath,
    assetPayloadExisted: assetFiles?.payloadExisted,
  };
  await appendJournal(journalEntry);
  if (assetRecord) {
    await writeAssetMeta(assetRecord);
    await mkdir(path.dirname(assetFiles.payloadPath), { recursive: true });
    await writeFile(assetFiles.payloadPath, payloadBuffer);
  }
  await writeRecord(record);
  let auditEvent;
  try {
    auditEvent = await appendAudit({ mutation, record, asset: assetRecord });
  } catch (auditError) {
    try {
      if (previousRecord) await writeRecord(previousRecord);
      else await rm(recordPath(record.recordId), { force: true });
      if (assetFiles) {
        await rm(assetFiles.metaPath, { force: true });
        if (!assetFiles.payloadExisted) await rm(assetFiles.payloadPath, { force: true });
      }
      await removeJournalEntry(journalEntry);
    } catch (rollbackError) {
      throw new AggregateError([auditError, rollbackError], 'Audit append failed and record rollback also failed.');
    }
    throw auditError;
  }
  const result = { record, auditEvent, ...(assetRecord ? { asset: assetRecord } : {}), replayed: false };
  idempotency[mutation.idempotencyKey] = { fingerprint, result };
  await writeFile(IDEMPOTENCY_PATH, `${JSON.stringify(idempotency, null, 2)}\n`, 'utf8');
  await removeJournalEntry(journalEntry);
  return result;
}

async function listRecords() {
  await ensureStore();
  const entries = await readdir(RECORDS_ROOT, { withFileTypes: true });
  return Promise.all(entries.filter((entry) => entry.isFile() && entry.name.endsWith('.md')).map((entry) => readRecord(entry.name.slice(0, -3))));
}

function encodeRecordCursor(after) {
  return `v1:${Buffer.from(JSON.stringify({ kind: 'records', after }), 'utf8').toString('base64url')}`;
}

function decodeRecordCursor(cursor) {
  if (!cursor) return null;
  if (!/^v1:[A-Za-z0-9_-]{1,512}$/.test(cursor)) throw new Error('Invalid record cursor.');
  try {
    const decoded = JSON.parse(Buffer.from(cursor.slice(3), 'base64url').toString('utf8'));
    if (decoded.kind !== 'records' || !RECORD_ID_PATTERN.test(decoded.after)) throw new Error();
    return decoded.after;
  } catch {
    throw new Error('Invalid record cursor.');
  }
}

function matchesExactMetadata(metadata, filters) {
  return Object.entries(filters).every(([key, expected]) => Object.hasOwn(metadata, key) && isDeepStrictEqual(metadata[key], expected));
}

async function listRecordsPage({ cursor, limit = 50, state, metadata = {} } = {}) {
  assertMetadata(metadata);
  const after = decodeRecordCursor(cursor);
  const filtered = (await listRecords())
    .filter((record) => !state || record.state === state)
    .filter((record) => matchesExactMetadata(record.metadata, metadata))
    .sort((left, right) => left.recordId.localeCompare(right.recordId))
    .filter((record) => !after || record.recordId > after);
  const records = filtered.slice(0, limit);
  const lastRecordId = records.length ? records.at(-1).recordId : after;
  return {
    contractVersion: CONTRACT_VERSION,
    records,
    nextCursor: encodeRecordCursor(lastRecordId ?? 'pvr_00000000000000000000000000'),
    hasMore: records.length < filtered.length,
  };
}

async function searchRecords(query, limit = 20) {
  const normalized = query.toLowerCase();
  const indexEntries = await readRebuiltSearchIndex();
  const haystackEntries = indexEntries ?? (await listRecords()).map((record) => ({ ...record, text: record.content.text }));
  return haystackEntries.flatMap((record) => {
    const searchable = `${record.title || ''}\n${record.text}`;
    const haystack = searchable.toLowerCase();
    const index = haystack.indexOf(normalized);
    return index < 0 ? [] : [{ recordId: record.recordId, revision: record.revision, state: record.state, privacy: record.privacy, title: record.title || null, score: 1, snippet: searchable.slice(Math.max(0, index - 120), index + 280).replace(/\s+/g, ' ').trim(), matchedFields: record.title?.toLowerCase().includes(normalized) ? ['title'] : ['content'] }];
  }).slice(0, limit);
}

async function listChanges(cursor = 'v1:0', limit = 50) {
  const afterSequence = Number(cursor.slice(3));
  if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) throw new Error('Invalid change cursor.');
  const remaining = (await readAuditEvents()).filter((event) => event.sequence > afterSequence);
  const events = remaining.slice(0, limit);
  const nextCursor = `v1:${events.length ? events.at(-1).sequence : afterSequence}`;
  return { contractVersion: CONTRACT_VERSION, events, nextCursor, hasMore: remaining.length > events.length };
}

async function listAssets() {
  await ensureStore();
  const entries = await readdir(ASSETS_META_ROOT, { withFileTypes: true });
  return Promise.all(entries.filter((entry) => entry.isFile() && entry.name.endsWith('.json')).map((entry) => readAsset(entry.name.slice(0, -5))));
}

const SEARCH_INDEX_PATH = path.join(STORE_ROOT, 'indexes', 'search.json');
const ASSETS_INDEX_PATH = path.join(STORE_ROOT, 'indexes', 'assets.json');

async function rebuildIndexes() {
  await ensureStore();
  const records = await listRecords();
  const assets = await listAssets();
  const searchIndex = records.map((record) => ({
    recordId: record.recordId,
    revision: record.revision,
    state: record.state,
    privacy: record.privacy,
    title: record.title || null,
    text: record.content.text,
    updatedAt: record.updatedAt,
  }));
  const assetsIndex = assets;
  await writeFile(SEARCH_INDEX_PATH, `${JSON.stringify(searchIndex, null, 2)}\n`, 'utf8');
  await writeFile(ASSETS_INDEX_PATH, `${JSON.stringify(assetsIndex, null, 2)}\n`, 'utf8');
  return {
    contractVersion: CONTRACT_VERSION,
    rebuiltAt: new Date().toISOString(),
    recordIndexEntries: searchIndex.length,
    assetIndexEntries: assetsIndex.length,
    searchIndexPath: SEARCH_INDEX_PATH,
    assetsIndexPath: ASSETS_INDEX_PATH,
  };
}

async function readRebuiltSearchIndex() {
  try {
    return JSON.parse(await readFile(SEARCH_INDEX_PATH, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function canonicalHash(value) {
  return `sha256:${sha256(JSON.stringify(value))}`;
}

async function exportVault({ includeAssets = true } = {}) {
  await ensureStore();
  const records = await listRecords();
  const audit = await readAuditEvents();
  let assets = [];
  if (includeAssets) {
    assets = await Promise.all((await listAssets()).map(async (asset) => {
      const payload = await readFile(assetPayloadPath(asset.contentHash));
      return { ...asset, payloadBase64: payload.toString('base64') };
    }));
  }
  const assetsManifest = assets.map(({ payloadBase64, ...meta }) => meta);
  const manifest = {
    recordCount: records.length,
    assetCount: assets.length,
    auditCount: audit.length,
    recordsHash: canonicalHash(records),
    assetsHash: canonicalHash(assetsManifest),
    auditHash: canonicalHash(audit),
  };
  const exportedAt = new Date().toISOString();
  const exportObject = {
    contractVersion: CONTRACT_VERSION,
    exportFormat: 'personal-vault-export/v1',
    exportedAt,
    manifest,
    records,
    assets,
    audit,
  };
  await mkdir(EXPORTS_ROOT, { recursive: true });
  const exportPath = path.join(EXPORTS_ROOT, `export-${exportedAt.replace(/[:.]/g, '-')}.json`);
  await writeFile(exportPath, `${JSON.stringify(exportObject, null, 2)}\n`, 'utf8');
  return { path: exportPath, ...exportObject };
}

async function verifyExport(filePath) {
  const exportObject = JSON.parse(await readFile(filePath, 'utf8'));
  const issues = [];
  if (exportObject.contractVersion !== CONTRACT_VERSION) issues.push('export contractVersion mismatch');
  if (exportObject.exportFormat !== 'personal-vault-export/v1') issues.push('export format mismatch');
  const records = Array.isArray(exportObject.records) ? exportObject.records : [];
  const assets = Array.isArray(exportObject.assets) ? exportObject.assets : [];
  const audit = Array.isArray(exportObject.audit) ? exportObject.audit : [];
  const assetsManifest = assets.map(({ payloadBase64, ...meta }) => meta);
  if (exportObject.manifest?.recordsHash !== canonicalHash(records)) issues.push('records hash mismatch');
  if (exportObject.manifest?.assetsHash !== canonicalHash(assetsManifest)) issues.push('assets hash mismatch');
  if (exportObject.manifest?.auditHash !== canonicalHash(audit)) issues.push('audit hash mismatch');
  if (exportObject.manifest?.recordCount !== records.length) issues.push('record count mismatch');
  if (exportObject.manifest?.assetCount !== assets.length) issues.push('asset count mismatch');
  if (exportObject.manifest?.auditCount !== audit.length) issues.push('audit count mismatch');
  for (const asset of assets) {
    try {
      const payload = Buffer.from(asset.payloadBase64, 'base64');
      if (asset.contentHash !== `sha256:${sha256(payload)}`) issues.push(`asset ${asset.assetId}: payload hash mismatch`);
      if (asset.byteLength !== payload.length) issues.push(`asset ${asset.assetId}: payload byteLength mismatch`);
    } catch (error) {
      issues.push(`asset ${asset.assetId}: payload unreadable (${error.message})`);
    }
  }
  return {
    contractVersion: CONTRACT_VERSION,
    checkedAt: new Date().toISOString(),
    path: filePath,
    ok: issues.length === 0,
    issues,
  };
}

const BACKUP_KDF = { algorithm: 'scrypt', N: 16384, r: 8, p: 1, keyLength: 32 };
const BACKUP_CIPHER = { algorithm: 'aes-256-gcm' };

async function deriveBackupKey(passphrase, salt) {
  return SCRIPT(passphrase, salt, BACKUP_KDF.keyLength, { N: BACKUP_KDF.N, r: BACKUP_KDF.r, p: BACKUP_KDF.p });
}

async function backupVault(passphrase) {
  if (typeof passphrase !== 'string' || passphrase.length < 8) throw new Error('Backup passphrase must be at least 8 characters.');
  const exportObject = await exportVault({ includeAssets: true });
  const payload = JSON.stringify({
    manifest: exportObject.manifest,
    records: exportObject.records,
    assets: exportObject.assets,
    audit: exportObject.audit,
  });
  const salt = randomBytes(16);
  const key = await deriveBackupKey(passphrase, salt);
  const iv = randomBytes(12);
  const cipher = createCipheriv(BACKUP_CIPHER.algorithm, key, iv);
  const encrypted = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const createdAt = new Date().toISOString();
  const backupObject = {
    contractVersion: CONTRACT_VERSION,
    backupFormat: 'personal-vault-backup/v1',
    createdAt,
    manifest: exportObject.manifest,
    kdf: { algorithm: BACKUP_KDF.algorithm, salt: salt.toString('base64'), N: BACKUP_KDF.N, r: BACKUP_KDF.r, p: BACKUP_KDF.p, keyLength: BACKUP_KDF.keyLength },
    cipher: { algorithm: BACKUP_CIPHER.algorithm, iv: iv.toString('base64'), authTag: authTag.toString('base64') },
    encryptedDataBase64: encrypted.toString('base64'),
  };
  await mkdir(BACKUPS_ROOT, { recursive: true });
  const backupPath = path.join(BACKUPS_ROOT, `backup-${createdAt.replace(/[:.]/g, '-')}.json`);
  await writeFile(backupPath, `${JSON.stringify(backupObject, null, 2)}\n`, 'utf8');
  return { path: backupPath, contractVersion: backupObject.contractVersion, backupFormat: backupObject.backupFormat, createdAt, manifest: backupObject.manifest };
}

async function decryptBackup(filePath, passphrase) {
  const backupObject = JSON.parse(await readFile(filePath, 'utf8'));
  if (backupObject.contractVersion !== CONTRACT_VERSION) throw new Error('Backup contractVersion mismatch.');
  if (backupObject.backupFormat !== 'personal-vault-backup/v1') throw new Error('Backup format mismatch.');
  if (typeof passphrase !== 'string' || passphrase.length < 8) throw new Error('Backup passphrase must be at least 8 characters.');
  const key = await deriveBackupKey(passphrase, Buffer.from(backupObject.kdf.salt, 'base64'));
  const decipher = createDecipheriv(BACKUP_CIPHER.algorithm, key, Buffer.from(backupObject.cipher.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(backupObject.cipher.authTag, 'base64'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(backupObject.encryptedDataBase64, 'base64')), decipher.final()]);
  const data = JSON.parse(decrypted.toString('utf8'));
  const manifest = JSON.stringify(data.manifest) === JSON.stringify(backupObject.manifest)
    ? data.manifest
    : (() => { throw new Error('Backup manifest does not match encrypted payload.'); })();
  return { backupObject, data, manifest };
}

async function restoreVault(filePath, passphrase) {
  const { data } = await decryptBackup(filePath, passphrase);
  const issues = [];
  const records = Array.isArray(data.records) ? data.records : [];
  const assets = Array.isArray(data.assets) ? data.assets : [];
  const audit = Array.isArray(data.audit) ? data.audit : [];
  const assetsManifest = assets.map(({ payloadBase64, ...meta }) => meta);
  if (data.manifest?.recordsHash !== canonicalHash(records)) issues.push('records hash mismatch');
  if (data.manifest?.assetsHash !== canonicalHash(assetsManifest)) issues.push('assets hash mismatch');
  if (data.manifest?.auditHash !== canonicalHash(audit)) issues.push('audit hash mismatch');
  if (issues.length) throw new Error(`Backup integrity failed: ${issues.join('; ')}`);
  await ensureStore();

  let recordsRestored = 0;
  let assetsRestored = 0;
  let auditRestored = 0;
  let skipped = 0;

  for (const record of records) {
    let exists = true;
    try {
      await readRecord(record.recordId);
    } catch (error) {
      if (error.code === 'ENOENT') exists = false;
      else { skipped += 1; continue; }
    }
    if (exists) {
      skipped += 1;
      continue;
    }
    await writeRecord(record);
    recordsRestored += 1;
  }

  for (const asset of assets) {
    const { payloadBase64, ...meta } = asset;
    let exists = true;
    try {
      await readAsset(asset.assetId);
    } catch (error) {
      if (error.code === 'ENOENT') exists = false;
      else { skipped += 1; continue; }
    }
    if (exists) {
      skipped += 1;
      continue;
    }
    await writeAssetMeta(meta);
    const payloadPath = assetPayloadPath(asset.contentHash);
    await mkdir(path.dirname(payloadPath), { recursive: true });
    await writeFile(payloadPath, Buffer.from(payloadBase64, 'base64'));
    assetsRestored += 1;
  }

  const existingEvents = await readAuditEvents();
  const lastSequence = existingEvents.length ? existingEvents.at(-1).sequence : 0;
  const existingIds = new Set(existingEvents.map((event) => event.eventId));
  for (const event of [...audit].sort((a, b) => a.sequence - b.sequence)) {
    if (existingIds.has(event.eventId) || event.sequence <= lastSequence) {
      skipped += 1;
      continue;
    }
    await appendFile(AUDIT_PATH, `${JSON.stringify(event)}\n`, 'utf8');
    auditRestored += 1;
  }

  return {
    contractVersion: CONTRACT_VERSION,
    restoredAt: new Date().toISOString(),
    recordsRestored,
    assetsRestored,
    auditRestored,
    skipped,
  };
}

async function checkIntegrity() {
  const issues = [];
  let records = [];
  let assets = [];
  let audit = [];

  try {
    records = await listRecords();
  } catch (error) {
    issues.push(`records: ${error.message}`);
  }
  for (const record of records) {
    try {
      assertContentIntegrity(record.content);
    } catch (error) {
      issues.push(`record ${record.recordId}: ${error.message}`);
    }
  }

  try {
    assets = await listAssets();
  } catch (error) {
    issues.push(`assets: ${error.message}`);
  }
  for (const asset of assets) {
    try {
      const payload = await readFile(assetPayloadPath(asset.contentHash));
      if (asset.byteLength !== payload.length) issues.push(`asset ${asset.assetId}: stored byteLength does not match payload`);
      if (asset.contentHash !== `sha256:${sha256(payload)}`) issues.push(`asset ${asset.assetId}: payload hash mismatch`);
    } catch (error) {
      issues.push(`asset ${asset.assetId}: payload missing or unreadable (${error?.code || error.message})`);
    }
  }

  try {
    audit = await readAuditEvents();
  } catch (error) {
    issues.push(`audit: ${error.message}`);
  }
  let previousSequence = 0;
  let previousEventHash = null;
  for (const event of audit) {
    if (!Number.isSafeInteger(event.sequence) || event.sequence <= previousSequence) {
      issues.push(`audit ${event.eventId}: non-monotonic sequence ${event.sequence}`);
    }
    previousSequence = event.sequence;
    if (event.eventHash) {
      const { eventHash, ...rest } = event;
      if ((event.previousEventHash ?? null) !== previousEventHash) {
        issues.push(`audit ${event.eventId}: hash chain broken (previousEventHash mismatch)`);
      }
      if (eventHash !== `sha256:${sha256(JSON.stringify(rest))}`) {
        issues.push(`audit ${event.eventId}: event hash mismatch`);
      }
      previousEventHash = eventHash;
    }
  }

  try {
    await readIdempotencyIndex();
  } catch (error) {
    issues.push(`idempotency index: ${error.message}`);
  }

  return {
    contractVersion: CONTRACT_VERSION,
    checkedAt: new Date().toISOString(),
    recordCount: records.length,
    assetCount: assets.length,
    auditCount: audit.length,
    ok: issues.length === 0,
    issues,
  };
}

function getHeader(headers, name) {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function getPublicBaseUrl(req) {
  if (MCP_PUBLIC_BASE_URL) return MCP_PUBLIC_BASE_URL;
  const host = getHeader(req.headers, 'host') || `${HOST}:${PORT}`;
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
  server.registerTool('vault.assets.get', { title: 'Get asset', description: 'Read generic asset metadata and its verified payload by stable asset identifier.', inputSchema: { assetId: z.string().regex(ASSET_ID_PATTERN) } }, withAuth(async ({ assetId }) => {
    const result = await getAsset(assetId);
    return { content: [{ type: 'text', text: `Returned asset ${assetId} (${result.asset.byteLength} byte(s)).` }], structuredContent: result };
  }));
  server.registerTool('vault.assets.attach', { title: 'Attach asset', description: 'Attach a content-addressed asset to a record from an approved asset.attach mutation.', inputSchema: { mutation: z.unknown() } }, withAuth(async ({ mutation }) => {
    const result = await applyMutation(mutation);
    if (result.auditEvent.action !== 'asset.attached') throw new Error('vault.assets.attach accepts only asset.attach mutations.');
    return { content: [{ type: 'text', text: `Attached asset ${result.asset.assetId} to ${result.record.recordId}.` }], structuredContent: result };
  }));
  server.registerTool('vault.records.create', { title: 'Create record', description: 'Create a generic record from an approved record.create mutation.', inputSchema: { mutation: z.unknown() } }, withAuth(async ({ mutation }) => {
    const result = await applyMutation(mutation);
    if (result.auditEvent.action !== 'record.created') throw new Error('vault.records.create accepts only record.create mutations.');
    return { content: [{ type: 'text', text: `Created record ${result.record.recordId}.` }], structuredContent: result };
  }));
  server.registerTool('vault.records.get', { title: 'Get record', description: 'Read a generic record by stable identifier.', inputSchema: { recordId: z.string().regex(RECORD_ID_PATTERN) } }, withAuth(async ({ recordId }) => {
    const record = await readRecord(recordId);
    return { content: [{ type: 'text', text: record.content.text }], structuredContent: { record } };
  }));
  server.registerTool('vault.records.list', { title: 'List records', description: 'List generic records with opaque pagination and exact lifecycle/metadata filters.', inputSchema: { cursor: z.string().regex(/^v1:[A-Za-z0-9_-]{1,512}$/).optional(), limit: z.number().int().min(1).max(100).optional(), state: z.enum(['active', 'archived', 'trashed']).optional(), metadata: z.record(z.string(), z.unknown()).optional() } }, withAuth(async ({ cursor, limit = 50, state, metadata = {} }) => {
    const result = await listRecordsPage({ cursor, limit, state, metadata });
    return { content: [{ type: 'text', text: `Returned ${result.records.length} record(s).` }], structuredContent: result };
  }));
  server.registerTool('vault.records.search', { title: 'Search records', description: 'Search generic record title and content without domain interpretation.', inputSchema: { query: z.string().min(1), limit: z.number().int().min(1).max(100).optional() } }, withAuth(async ({ query, limit = 20 }) => {
    const matches = await searchRecords(query, limit);
    return { content: [{ type: 'text', text: matches.length ? `Found ${matches.length} record(s).` : 'No records found.' }], structuredContent: { query, matches } };
  }));
  server.registerTool('vault.changes.list', { title: 'List changes', description: 'List generic audit events after an optional opaque cursor.', inputSchema: { cursor: z.string().regex(/^v1:[A-Za-z0-9_-]{1,512}$/).optional(), limit: z.number().int().min(1).max(100).optional() } }, withAuth(async ({ cursor = 'v1:0', limit = 50 }) => {
    const changeFeed = await listChanges(cursor, limit);
    return { content: [{ type: 'text', text: `Returned ${changeFeed.events.length} change event(s).` }], structuredContent: changeFeed };
  }));
  server.registerTool('vault.integrity.check', { title: 'Check integrity', description: 'Verify record content hashes, asset payloads, audit sequence ordering and index readability without modifying the store.', inputSchema: {} }, withAuth(async () => {
    const result = await checkIntegrity();
    return { content: [{ type: 'text', text: result.ok ? `Integrity ok (${result.recordCount} record(s), ${result.assetCount} asset(s), ${result.auditCount} audit event(s)).` : `Integrity issues: ${result.issues.length}` }], structuredContent: result };
  }));
  server.registerTool('vault.export.create', { title: 'Create export', description: 'Create a portable export of records, assets and audit events with a verifiable manifest.', inputSchema: { includeAssets: z.boolean().optional() } }, withAuth(async ({ includeAssets = true }) => {
    const exportResult = await exportVault({ includeAssets });
    return { content: [{ type: 'text', text: `Export written to ${exportResult.path} (${exportResult.manifest.recordCount} record(s), ${exportResult.manifest.assetCount} asset(s), ${exportResult.manifest.auditCount} audit event(s)).` }], structuredContent: { path: exportResult.path, contractVersion: exportResult.contractVersion, exportFormat: exportResult.exportFormat, exportedAt: exportResult.exportedAt, manifest: exportResult.manifest } };
  }));
  server.registerTool('vault.export.verify', { title: 'Verify export', description: 'Verify a stored export file manifest and asset payload integrity without modifying the store.', inputSchema: { path: z.string().min(1) } }, withAuth(async ({ path: exportPath }) => {
    const result = await verifyExport(exportPath);
    return { content: [{ type: 'text', text: result.ok ? `Export verified: ${exportPath}` : `Export issues: ${result.issues.length}` }], structuredContent: result };
  }));
  server.registerTool('vault.backup.create', { title: 'Create backup', description: 'Create an encrypted backup of records, assets and audit events protected with a passphrase-derived AES-256-GCM key.', inputSchema: { passphrase: z.string().min(8).max(1024) } }, withAuth(async ({ passphrase }) => {
    const result = await backupVault(passphrase);
    return { content: [{ type: 'text', text: `Encrypted backup written to ${result.path}.` }], structuredContent: result };
  }));
  server.registerTool('vault.backup.restore', { title: 'Restore backup', description: 'Non-destructively restore records, assets and audit events from an encrypted backup file using the passphrase.', inputSchema: { path: z.string().min(1), passphrase: z.string().min(8).max(1024) } }, withAuth(async ({ path: backupPath, passphrase }) => {
    const result = await restoreVault(backupPath, passphrase);
    return { content: [{ type: 'text', text: `Restored ${result.recordsRestored} record(s), ${result.assetsRestored} asset(s), ${result.auditRestored} audit event(s); skipped ${result.skipped}.` }], structuredContent: result };
  }));
  server.registerTool('vault.indexes.rebuild', { title: 'Rebuild indexes', description: 'Recreate the search and asset indexes from canonical records and asset metadata.', inputSchema: {} }, withAuth(async () => {
    const result = await rebuildIndexes();
    return { content: [{ type: 'text', text: `Rebuilt ${result.recordIndexEntries} search and ${result.assetIndexEntries} asset index entr(ies).` }], structuredContent: result };
  }));
  return server;
}

const httpServer = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'GET' && url.pathname === '/') return void res.writeHead(200, { 'content-type': 'text/plain' }).end('Personal Vault MCP server');
  if (req.method === 'GET' && url.pathname === '/status') return void res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify({ status: 'ok', server: 'personal-vault', contractVersion: CONTRACT_VERSION, mcpEndpoint: `${getPublicBaseUrl(req)}${MCP_PATH}`, bind: HOST, authentication: GOOGLE_AUTH_ENABLED ? 'oauth-required' : 'disabled' }));
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

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  recoverPendingMutations()
    .then(() => httpServer.listen(PORT, HOST, () => console.log(`Personal Vault MCP server listening on http://${HOST}:${PORT}${MCP_PATH}`)))
    .catch((error) => {
      console.error('Personal Vault recovery failed:', error);
      process.exitCode = 1;
    });
}

export {
  applyMutation,
  backupVault,
  checkIntegrity,
  contentSchema,
  decryptBackup,
  exportVault,
  fromMarkdown,
  getAsset,
  listAssets,
  listChanges,
  listRecords,
  listRecordsPage,
  mutationSchema,
  provenanceSchema,
  readAsset,
  rebuildIndexes,
  readRecord,
  recoverPendingMutations,
  recordDraftSchema,
  recordSchema,
  restoreVault,
  searchRecords,
  sha256,
  toMarkdown,
  verifyExport,
};
