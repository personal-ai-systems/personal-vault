import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFile, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

const SERVER_PATH = path.resolve('mcp/personal-vault-server.mjs');
const ACTOR = { kind: 'user', id: 'kirill', displayName: 'Kirill' };
let instanceNumber = 0;

function hash(text) {
  return `sha256:${createHash('sha256').update(text).digest('hex')}`;
}

function provenance(now = new Date().toISOString()) {
  return { origin: 'direct', capturedAt: now, capturedBy: ACTOR };
}

function draft({ text = '# Fixture\nTemporary test data.', title = 'Fixture record', privacy = 'restricted', metadata = { 'vault.fixture': true } } = {}) {
  return {
    privacy,
    title,
    content: { format: 'markdown', text, hash: hash(text), language: 'en' },
    provenance: provenance(),
    assetRefs: [],
    metadata,
  };
}

function mutation(operation, { id = 'A', key = `fixture-idempotency-${id}`, expiresAt } = {}) {
  const now = new Date().toISOString();
  const approval = { kind: 'user', approvedAt: now, approvedBy: ACTOR, evidenceRef: `fixture:${id}` };
  if (expiresAt) approval.expiresAt = expiresAt;
  return {
    contractVersion: 'personal-vault/v1',
    mutationId: `pvm_${id.repeat(26)}`,
    requestedAt: now,
    requestedBy: ACTOR,
    idempotencyKey: key.padEnd(16, '-'),
    approval,
    operation,
    provenance: provenance(now),
  };
}

function assetAttach({ recordId, baseRevision, bytes = Buffer.from('hello asset'), role = 'attachment' }) {
  return {
    type: 'asset.attach',
    recordId,
    baseRevision,
    asset: {
      privacy: 'restricted',
      mediaType: 'application/octet-stream',
      byteLength: bytes.length,
      contentHash: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
      originalName: 'fixture.bin',
      provenance: provenance(),
      metadata: { 'vault.fixture': true },
    },
    reference: { role },
    payload: { encoding: 'base64', dataBase64: bytes.toString('base64') },
  };
}

async function fixtureRuntime(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'personal-vault-contract-'));
  t.after(async () => rm(root, { recursive: true, force: true }));
  process.env.PERSONAL_VAULT_ROOT = root;
  instanceNumber += 1;
  const runtime = await import(`${pathToFileURL(SERVER_PATH).href}?fixture=${instanceNumber}`);
  return { root, runtime };
}

async function storeFiles(root) {
  const store = path.join(root, '.personal-vault');
  const records = await readdir(path.join(store, 'records')).catch((error) => error.code === 'ENOENT' ? [] : Promise.reject(error));
  const audit = await readFile(path.join(store, 'audit', 'events.jsonl'), 'utf8').catch((error) => ['ENOENT', 'EISDIR'].includes(error.code) ? '' : Promise.reject(error));
  const idempotency = await readFile(path.join(store, 'indexes', 'idempotency.json'), 'utf8').catch((error) => error.code === 'ENOENT' ? '{}' : Promise.reject(error));
  return { records, audit: audit.split('\n').filter(Boolean).map(JSON.parse), idempotency: JSON.parse(idempotency) };
}

test('create persists a contract-shaped readable record and audit event', async (t) => {
  const { root, runtime } = await fixtureRuntime(t);
  const create = mutation({ type: 'record.create', record: draft() });
  const result = await runtime.applyMutation(create);

  assert.equal(result.replayed, false);
  assert.equal(result.record.contractVersion, 'personal-vault/v1');
  assert.equal(result.record.revision, 1);
  assert.equal(result.record.state, 'active');
  assert.equal(result.record.privacy, 'restricted');
  assert.equal(result.record.content.text, '# Fixture\nTemporary test data.');
  assert.equal(result.auditEvent.action, 'record.created');
  assert.deepEqual(result.auditEvent.resource, { recordId: result.record.recordId, revision: 1 });

  const stored = await runtime.readRecord(result.record.recordId);
  assert.deepEqual(stored, result.record);
  const files = await storeFiles(root);
  assert.equal(files.records.length, 1);
  assert.equal(files.audit.length, 1);
  assert.equal(Object.keys(files.idempotency).length, 1);
});

test('revise and lifecycle mutations enforce revisions and emit contract actions', async (t) => {
  const { runtime } = await fixtureRuntime(t);
  const created = (await runtime.applyMutation(mutation({ type: 'record.create', record: draft() }, { id: 'A' }))).record;
  const revisedText = '# Revised\nStill temporary.';
  const replacement = {
    ...created,
    revision: 2,
    updatedAt: new Date().toISOString(),
    title: 'Revised fixture',
    content: { ...created.content, text: revisedText, hash: hash(revisedText) },
  };
  const revised = await runtime.applyMutation(mutation({ type: 'record.revise', recordId: created.recordId, baseRevision: 1, record: replacement }, { id: 'B' }));
  assert.equal(revised.record.revision, 2);
  assert.equal(revised.record.content.text, revisedText);
  assert.equal(revised.auditEvent.action, 'record.revised');

  await assert.rejects(
    runtime.applyMutation(mutation({ type: 'record.archive', recordId: created.recordId, baseRevision: 1 }, { id: 'C' })),
    /Record revision conflict/,
  );

  const archived = await runtime.applyMutation(mutation({ type: 'record.archive', recordId: created.recordId, baseRevision: 2 }, { id: 'D' }));
  const restored = await runtime.applyMutation(mutation({ type: 'record.restore', recordId: created.recordId, baseRevision: 3 }, { id: 'E' }));
  const trashed = await runtime.applyMutation(mutation({ type: 'record.trash', recordId: created.recordId, baseRevision: 4 }, { id: 'F' }));
  assert.deepEqual(
    [archived.record.state, restored.record.state, trashed.record.state],
    ['archived', 'active', 'trashed'],
  );
  assert.deepEqual(
    [archived.auditEvent.action, restored.auditEvent.action, trashed.auditEvent.action],
    ['record.archived', 'record.restored', 'record.trashed'],
  );
});

test('idempotent replay is stable and conflicting reuse is rejected without duplicate audit', async (t) => {
  const { root, runtime } = await fixtureRuntime(t);
  const original = mutation({ type: 'record.create', record: draft() }, { id: 'A', key: 'fixture-replay-key' });
  const first = await runtime.applyMutation(original);
  const replay = await runtime.applyMutation(original);
  assert.equal(replay.replayed, true);
  assert.equal(replay.record.recordId, first.record.recordId);
  assert.equal(replay.auditEvent.eventId, first.auditEvent.eventId);

  const conflict = mutation({ type: 'record.create', record: draft({ title: 'Different' }) }, { id: 'B', key: 'fixture-replay-key' });
  await assert.rejects(runtime.applyMutation(conflict), /Idempotency key conflicts/);

  const files = await storeFiles(root);
  assert.equal(files.records.length, 1);
  assert.equal(files.audit.length, 1);
  assert.equal(Object.keys(files.idempotency).length, 1);
});

test('rejected validation-stage mutations leave the temporary store unchanged', async (t) => {
  const { root, runtime } = await fixtureRuntime(t);
  const badHash = draft();
  badHash.content.hash = `sha256:${'0'.repeat(64)}`;
  await assert.rejects(runtime.applyMutation(mutation({ type: 'record.create', record: badHash }, { id: 'A' })), /content hash/);

  const badMetadata = draft({ metadata: { unnamespaced: true } });
  await assert.rejects(runtime.applyMutation(mutation({ type: 'record.create', record: badMetadata }, { id: 'B' })), /Metadata key must be namespaced/);

  const expired = mutation({ type: 'record.create', record: draft() }, { id: 'C', expiresAt: '2000-01-01T00:00:00.000Z' });
  await assert.rejects(runtime.applyMutation(expired), /Approval has expired/);

  const files = await storeFiles(root);
  assert.deepEqual(files.records, []);
  assert.deepEqual(files.audit, []);
  assert.deepEqual(files.idempotency, {});
});

test('search returns contract-shaped title and content matches with limits', async (t) => {
  const { runtime } = await fixtureRuntime(t);
  await runtime.applyMutation(mutation({ type: 'record.create', record: draft({ title: 'Alpha title', text: 'First body.' }) }, { id: 'A' }));
  await runtime.applyMutation(mutation({ type: 'record.create', record: draft({ title: 'Other title', text: 'Body contains alpha token.' }) }, { id: 'B' }));
  await runtime.applyMutation(mutation({ type: 'record.create', record: draft({ title: 'Unrelated', text: 'No matching text.' }) }, { id: 'C' }));

  const titleMatches = await runtime.searchRecords('alpha', 1);
  assert.equal(titleMatches.length, 1);
  assert.equal(titleMatches[0].score, 1);
  assert.deepEqual(titleMatches[0].matchedFields, ['title']);
  assert.match(titleMatches[0].snippet, /Alpha title/i);

  const allMatches = await runtime.searchRecords('alpha', 20);
  assert.equal(allMatches.length, 2);
  assert.ok(allMatches.some((match) => match.matchedFields.includes('content')));
});

test('change feed paginates with opaque cursors and accurate hasMore', async (t) => {
  const { runtime } = await fixtureRuntime(t);
  await runtime.applyMutation(mutation({ type: 'record.create', record: draft({ title: 'One' }) }, { id: 'A' }));
  await runtime.applyMutation(mutation({ type: 'record.create', record: draft({ title: 'Two' }) }, { id: 'B' }));
  await runtime.applyMutation(mutation({ type: 'record.create', record: draft({ title: 'Three' }) }, { id: 'C' }));

  const firstPage = await runtime.listChanges('v1:0', 2);
  assert.equal(firstPage.contractVersion, 'personal-vault/v1');
  assert.equal(firstPage.events.length, 2);
  assert.equal(firstPage.hasMore, true);
  assert.match(firstPage.nextCursor, /^v1:\d+$/);
  assert.ok(firstPage.events[0].sequence < firstPage.events[1].sequence);

  const secondPage = await runtime.listChanges(firstPage.nextCursor, 2);
  assert.equal(secondPage.events.length, 1);
  assert.equal(secondPage.hasMore, false);
  assert.notEqual(secondPage.events[0].eventId, firstPage.events[1].eventId);

  const emptyPage = await runtime.listChanges(secondPage.nextCursor, 2);
  assert.deepEqual(emptyPage.events, []);
  assert.equal(emptyPage.nextCursor, secondPage.nextCursor);
  assert.equal(emptyPage.hasMore, false);
  await assert.rejects(runtime.listChanges('v1:not-a-number', 2), /Invalid change cursor/);
});

test('asset.attach persists a content-addressed payload and appends a record revision', async (t) => {
  const { root, runtime } = await fixtureRuntime(t);
  const created = (await runtime.applyMutation(mutation({ type: 'record.create', record: draft() }, { id: 'A' }))).record;
  const bytes = Buffer.from('hello asset');
  const op = assetAttach({ recordId: created.recordId, baseRevision: 1, bytes });
  const attachMutation = mutation(op, { id: 'B' });
  const result = await runtime.applyMutation(attachMutation);

  assert.equal(result.auditEvent.action, 'asset.attached');
  assert.deepEqual(result.auditEvent.resource, { recordId: created.recordId, revision: 2, assetId: result.asset.assetId });
  assert.equal(result.record.revision, 2);
  assert.equal(result.record.assetRefs.length, 1);
  assert.equal(result.record.assetRefs[0].assetId, result.asset.assetId);
  assert.equal(result.asset.contentHash, `sha256:${createHash('sha256').update(bytes).digest('hex')}`);

  const storedAsset = await runtime.readAsset(result.asset.assetId);
  assert.deepEqual(storedAsset, result.asset);
  const payloadPath = path.join(root, '.personal-vault', 'assets', 'payloads', `${createHash('sha256').update(bytes).digest('hex')}.bin`);
  assert.deepEqual(await readFile(payloadPath), bytes);

  const replay = await runtime.applyMutation(attachMutation);
  assert.equal(replay.replayed, true);
  assert.equal(replay.asset.assetId, result.asset.assetId);
});

test('asset.attach rejects hash and byteLength mismatches without writes', async (t) => {
  const { root, runtime } = await fixtureRuntime(t);
  const created = (await runtime.applyMutation(mutation({ type: 'record.create', record: draft() }, { id: 'A' }))).record;
  const bytes = Buffer.from('hello asset');

  const badHash = assetAttach({ recordId: created.recordId, baseRevision: 1, bytes });
  badHash.asset.contentHash = `sha256:${'0'.repeat(64)}`;
  await assert.rejects(runtime.applyMutation(mutation(badHash, { id: 'B' })), /Asset content hash/);

  const badLength = assetAttach({ recordId: created.recordId, baseRevision: 1, bytes });
  badLength.asset.byteLength = 1;
  await assert.rejects(runtime.applyMutation(mutation(badLength, { id: 'C' })), /Asset byteLength/);

  const files = await storeFiles(root);
  assert.equal(files.records.length, 1);
  assert.equal(files.audit.length, 1);
  assert.equal(Object.keys(files.idempotency).length, 1);
  assert.deepEqual(await readdir(path.join(root, '.personal-vault', 'assets', 'payloads')), []);
  assert.deepEqual(await readdir(path.join(root, '.personal-vault', 'assets', 'meta')), []);
});

test('audit failure rolls back asset.attach revision and removes new asset files', async (t) => {
  const { root, runtime } = await fixtureRuntime(t);
  const created = (await runtime.applyMutation(mutation({ type: 'record.create', record: draft() }, { id: 'A' }))).record;
  const auditPath = path.join(root, '.personal-vault', 'audit', 'events.jsonl');
  await rm(auditPath, { force: true });
  await mkdir(auditPath, { recursive: true });

  const bytes = Buffer.from('hello asset');
  await assert.rejects(
    runtime.applyMutation(mutation(assetAttach({ recordId: created.recordId, baseRevision: 1, bytes }), { id: 'B' })),
    /EISDIR|illegal operation on a directory|Is a directory/i,
  );

  assert.deepEqual(await runtime.readRecord(created.recordId), created);
  const files = await storeFiles(root);
  assert.equal(files.records.length, 1);
  assert.deepEqual(files.audit, []);
  assert.deepEqual(await readdir(path.join(root, '.personal-vault', 'assets', 'payloads')), []);
  assert.deepEqual(await readdir(path.join(root, '.personal-vault', 'assets', 'meta')), []);
});

test('recovery commits asset.attach idempotency when audit exists but index was lost', async (t) => {
  const { root, runtime } = await fixtureRuntime(t);
  const created = (await runtime.applyMutation(mutation({ type: 'record.create', record: draft() }, { id: 'A' }))).record;
  const bytes = Buffer.from('hello asset');
  const op = assetAttach({ recordId: created.recordId, baseRevision: 1, bytes });
  const attachMutation = mutation(op, { id: 'B', key: 'fixture-asset-crash-key' });
  const applied = await runtime.applyMutation(attachMutation);
  const store = path.join(root, '.personal-vault');
  const idempotencyPath = path.join(store, 'indexes', 'idempotency.json');
  const journalPath = path.join(store, 'indexes', 'pending.jsonl');
  const storedIdempotency = JSON.parse(await readFile(idempotencyPath, 'utf8'));
  const fingerprint = storedIdempotency['fixture-asset-crash-key'].fingerprint;
  await rm(idempotencyPath, { force: true });
  await appendFile(journalPath, `${JSON.stringify({
    idempotencyKey: 'fixture-asset-crash-key',
    fingerprint,
    mutationId: applied.auditEvent.mutationId,
    operationType: 'asset.attach',
    recordId: created.recordId,
    previousRecord: created,
    assetId: applied.asset.assetId,
    assetMetaPath: path.join(store, 'assets', 'meta', `${applied.asset.assetId}.json`),
    assetPayloadPath: path.join(store, 'assets', 'payloads', `${createHash('sha256').update(bytes).digest('hex')}.bin`),
    assetPayloadExisted: false,
  })}\n`, 'utf8');

  assert.deepEqual(await runtime.recoverPendingMutations(), { recovered: 1, committed: 1, rolledBack: 0 });
  const replay = await runtime.applyMutation(attachMutation);
  assert.equal(replay.replayed, true);
  assert.equal(replay.asset.assetId, applied.asset.assetId);
  const files = await storeFiles(root);
  assert.equal(files.audit.length, 2, 'recovery must not duplicate audit events');
  assert.equal(await readFile(journalPath, 'utf8'), '');
});

test('recovery rolls back asset.attach that never reached audit and removes new asset files', async (t) => {
  const { root, runtime } = await fixtureRuntime(t);
  const created = (await runtime.applyMutation(mutation({ type: 'record.create', record: draft() }, { id: 'A' }))).record;
  const bytes = Buffer.from('hello asset');
  const replacement = { ...created, revision: 2, updatedAt: new Date().toISOString(), assetRefs: [{ assetId: `pva_${'E'.repeat(26)}`, role: 'attachment' }] };
  const store = path.join(root, '.personal-vault');
  const recordPath = path.join(store, 'records', `${created.recordId}.md`);
  const metaPath = path.join(store, 'assets', 'meta', `pva_${'E'.repeat(26)}.json`);
  const payloadPath = path.join(store, 'assets', 'payloads', `${createHash('sha256').update(bytes).digest('hex')}.bin`);
  const journalPath = path.join(store, 'indexes', 'pending.jsonl');
  await writeFile(recordPath, runtime.toMarkdown(replacement), 'utf8');
  await mkdir(path.dirname(metaPath), { recursive: true });
  await mkdir(path.dirname(payloadPath), { recursive: true });
  await writeFile(metaPath, '{}\n', 'utf8');
  await writeFile(payloadPath, bytes);
  await appendFile(journalPath, `${JSON.stringify({
    idempotencyKey: 'fixture-asset-uncommitted',
    fingerprint: 'f'.repeat(64),
    mutationId: `pvm_${'E'.repeat(26)}`,
    operationType: 'asset.attach',
    recordId: created.recordId,
    previousRecord: created,
    assetId: `pva_${'E'.repeat(26)}`,
    assetMetaPath: metaPath,
    assetPayloadPath: payloadPath,
    assetPayloadExisted: false,
  })}\n`, 'utf8');

  assert.deepEqual(await runtime.recoverPendingMutations(), { recovered: 1, committed: 0, rolledBack: 1 });
  assert.deepEqual(await runtime.readRecord(created.recordId), created);
  await assert.rejects(readFile(metaPath), /ENOENT/);
  await assert.rejects(readFile(payloadPath), /ENOENT/);
  const files = await storeFiles(root);
  assert.equal(files.records.length, 1);
  assert.equal(files.audit.length, 1);
  assert.equal(Object.keys(files.idempotency).length, 1);
});

test('export includes records assets and audit and verifies clean', async (t) => {
  const { runtime } = await fixtureRuntime(t);
  const created = (await runtime.applyMutation(mutation({ type: 'record.create', record: draft() }, { id: 'A' }))).record;
  await runtime.applyMutation(mutation(assetAttach({ recordId: created.recordId, baseRevision: 1 }), { id: 'B' }));

  const result = await runtime.exportVault({ includeAssets: true });
  assert.equal(result.contractVersion, 'personal-vault/v1');
  assert.equal(result.exportFormat, 'personal-vault-export/v1');
  assert.deepEqual(result.manifest, {
    recordCount: 1,
    assetCount: 1,
    auditCount: 2,
    recordsHash: result.manifest.recordsHash,
    assetsHash: result.manifest.assetsHash,
    auditHash: result.manifest.auditHash,
  });
  assert.equal(result.records.length, 1);
  assert.equal(result.assets.length, 1);
  assert.equal(typeof result.assets[0].payloadBase64, 'string');
  assert.equal(result.audit.length, 2);

  const verification = await runtime.verifyExport(result.path);
  assert.equal(verification.ok, true);
  assert.deepEqual(verification.issues, []);
});

test('export without assets has empty asset list', async (t) => {
  const { runtime } = await fixtureRuntime(t);
  await runtime.applyMutation(mutation({ type: 'record.create', record: draft() }, { id: 'A' }));
  const result = await runtime.exportVault({ includeAssets: false });
  assert.deepEqual(result.assets, []);
  assert.equal(result.manifest.assetCount, 0);
  const verification = await runtime.verifyExport(result.path);
  assert.equal(verification.ok, true);
});

test('verify detects a tampered record inside an export file', async (t) => {
  const { root, runtime } = await fixtureRuntime(t);
  await runtime.applyMutation(mutation({ type: 'record.create', record: draft() }, { id: 'A' }));
  const result = await runtime.exportVault({ includeAssets: false });
  const exportObject = JSON.parse(await readFile(result.path, 'utf8'));
  exportObject.records[0].title = 'Tampered';
  await writeFile(result.path, `${JSON.stringify(exportObject)}\n`, 'utf8');

  const verification = await runtime.verifyExport(result.path);
  assert.equal(verification.ok, false);
  assert.ok(verification.issues.some((issue) => issue.includes('records hash mismatch')));
});

test('verify detects a tampered asset payload inside an export file', async (t) => {
  const { runtime } = await fixtureRuntime(t);
  const created = (await runtime.applyMutation(mutation({ type: 'record.create', record: draft() }, { id: 'A' }))).record;
  await runtime.applyMutation(mutation(assetAttach({ recordId: created.recordId, baseRevision: 1 }), { id: 'B' }));
  const result = await runtime.exportVault({ includeAssets: true });
  const exportObject = JSON.parse(await readFile(result.path, 'utf8'));
  exportObject.assets[0].payloadBase64 = Buffer.from('tampered').toString('base64');
  await writeFile(result.path, `${JSON.stringify(exportObject)}\n`, 'utf8');

  const verification = await runtime.verifyExport(result.path);
  assert.equal(verification.ok, false);
  assert.ok(verification.issues.some((issue) => issue.includes('payload hash mismatch')));
});

test('backup encrypts and restore round-trips records assets and audit into a fresh vault', async (t) => {
  const source = await fixtureRuntime(t);
  const created = (await source.runtime.applyMutation(mutation({ type: 'record.create', record: draft() }, { id: 'A' }))).record;
  await source.runtime.applyMutation(mutation(assetAttach({ recordId: created.recordId, baseRevision: 1 }), { id: 'B' }));
  const backup = await source.runtime.backupVault('correct-horse-battery');
  assert.equal(backup.backupFormat, 'personal-vault-backup/v1');
  assert.equal(backup.manifest.recordCount, 1);
  assert.equal(backup.manifest.assetCount, 1);
  assert.equal(backup.manifest.auditCount, 2);
  const raw = await readFile(backup.path, 'utf8');
  assert.ok(!raw.includes('hello asset'), 'backup file must not contain plaintext payloads');
  assert.ok(!raw.includes('# Fixture'), 'backup file must not contain plaintext record text');

  const target = await fixtureRuntime(t);
  const restored = await target.runtime.restoreVault(backup.path, 'correct-horse-battery');
  assert.deepEqual(restored, {
    contractVersion: 'personal-vault/v1',
    restoredAt: restored.restoredAt,
    recordsRestored: 1,
    assetsRestored: 1,
    auditRestored: 2,
    skipped: 0,
  });
  const integrity = await target.runtime.checkIntegrity();
  assert.equal(integrity.ok, true, JSON.stringify(integrity.issues));
  const records = await target.runtime.listRecords();
  assert.equal(records.length, 1);
  assert.deepEqual(records[0].content, created.content);
});

test('backup restore rejects a wrong passphrase', async (t) => {
  const source = await fixtureRuntime(t);
  await source.runtime.applyMutation(mutation({ type: 'record.create', record: draft() }, { id: 'A' }));
  const backup = await source.runtime.backupVault('correct-horse-battery');
  await assert.rejects(
    source.runtime.restoreVault(backup.path, 'wrong-passphrase'),
    /auth|unable to authenticate|bad decrypt/i,
  );
});

test('backup restore rejects a tampered encrypted payload', async (t) => {
  const source = await fixtureRuntime(t);
  await source.runtime.applyMutation(mutation({ type: 'record.create', record: draft() }, { id: 'A' }));
  const backup = await source.runtime.backupVault('correct-horse-battery');
  const backupObject = JSON.parse(await readFile(backup.path, 'utf8'));
  const bytes = Buffer.from(backupObject.encryptedDataBase64, 'base64');
  bytes[0] ^= 0xff;
  backupObject.encryptedDataBase64 = bytes.toString('base64');
  await writeFile(backup.path, `${JSON.stringify(backupObject)}\n`, 'utf8');
  await assert.rejects(source.runtime.restoreVault(backup.path, 'correct-horse-battery'), /auth|unable to authenticate|bad decrypt/i);
});

test('backup restore is non-destructive and skips existing records and audit', async (t) => {
  const source = await fixtureRuntime(t);
  const created = (await source.runtime.applyMutation(mutation({ type: 'record.create', record: draft() }, { id: 'A' }))).record;
  const backup = await source.runtime.backupVault('correct-horse-battery');
  const revisedText = '# Revised after backup\nNewer content.';
  const replacement = {
    ...created,
    revision: 2,
    updatedAt: new Date().toISOString(),
    title: 'Newer',
    content: { ...created.content, text: revisedText, hash: hash(revisedText) },
  };
  await source.runtime.applyMutation(mutation({ type: 'record.revise', recordId: created.recordId, baseRevision: 1, record: replacement }, { id: 'B' }));

  const restored = await source.runtime.restoreVault(backup.path, 'correct-horse-battery');
  assert.equal(restored.recordsRestored, 0);
  assert.equal(restored.assetsRestored, 0);
  assert.equal(restored.auditRestored, 0);
  assert.equal(restored.skipped, 2);

  const current = await source.runtime.readRecord(created.recordId);
  assert.equal(current.revision, 2, 'existing record must not be overwritten');
  assert.equal(current.content.text, revisedText);
  const integrity = await source.runtime.checkIntegrity();
  assert.equal(integrity.ok, true, JSON.stringify(integrity.issues));
});

test('audit failure restores the previous revision of an existing record', async (t) => {
  const { root, runtime } = await fixtureRuntime(t);
  const created = (await runtime.applyMutation(mutation({ type: 'record.create', record: draft() }, { id: 'A' }))).record;
  const auditPath = path.join(root, '.personal-vault', 'audit', 'events.jsonl');
  await rm(auditPath, { force: true });
  await mkdir(auditPath, { recursive: true });

  const revisedText = '# Failed revision\nThis must be rolled back.';
  const replacement = {
    ...created,
    revision: 2,
    updatedAt: new Date().toISOString(),
    title: 'Failed revision',
    content: { ...created.content, text: revisedText, hash: hash(revisedText) },
  };

  await assert.rejects(
    runtime.applyMutation(mutation({ type: 'record.revise', recordId: created.recordId, baseRevision: 1, record: replacement }, { id: 'B' })),
    /EISDIR|illegal operation on a directory|Is a directory/i,
  );

  const restored = await runtime.readRecord(created.recordId);
  assert.deepEqual(restored, created);
  const files = await storeFiles(root);
  assert.equal(files.records.length, 1);
  assert.deepEqual(files.audit, []);
  assert.equal(Object.keys(files.idempotency).length, 1, 'only the successful create mutation remains indexed');
});

test('recovery completes idempotency after audit committed but index persistence was lost', async (t) => {
  const { root, runtime } = await fixtureRuntime(t);
  const create = mutation({ type: 'record.create', record: draft() }, { id: 'A', key: 'fixture-crash-window-key' });
  const applied = await runtime.applyMutation(create);
  const store = path.join(root, '.personal-vault');
  const idempotencyPath = path.join(store, 'indexes', 'idempotency.json');
  const journalPath = path.join(store, 'indexes', 'pending.jsonl');
  const storedIdempotency = JSON.parse(await readFile(idempotencyPath, 'utf8'));
  const fingerprint = storedIdempotency[create.idempotencyKey].fingerprint;

  await rm(idempotencyPath, { force: true });
  await appendFile(journalPath, `${JSON.stringify({
    idempotencyKey: create.idempotencyKey,
    fingerprint,
    mutationId: create.mutationId,
    operationType: create.operation.type,
    recordId: applied.record.recordId,
    previousRecord: null,
  })}\n`, 'utf8');

  assert.deepEqual(await runtime.recoverPendingMutations(), { recovered: 1, committed: 1, rolledBack: 0 });
  const replay = await runtime.applyMutation(create);
  assert.equal(replay.replayed, true);
  assert.equal(replay.record.recordId, applied.record.recordId);

  const files = await storeFiles(root);
  assert.equal(files.audit.length, 1, 'recovery must not append a duplicate audit event');
  assert.equal(Object.keys(files.idempotency).length, 1);
  assert.equal(await readFile(journalPath, 'utf8'), '');
});

test('recovery removes a newly created record that never reached audit', async (t) => {
  const { root, runtime } = await fixtureRuntime(t);
  const now = new Date().toISOString();
  const recordId = `pvr_${'C'.repeat(26)}`;
  const record = {
    contractVersion: 'personal-vault/v1',
    recordId,
    revision: 1,
    state: 'active',
    createdAt: now,
    updatedAt: now,
    createdBy: ACTOR,
    ...draft(),
  };
  const store = path.join(root, '.personal-vault');
  const recordPath = path.join(store, 'records', `${recordId}.md`);
  const journalPath = path.join(store, 'indexes', 'pending.jsonl');
  await mkdir(path.dirname(recordPath), { recursive: true });
  await mkdir(path.dirname(journalPath), { recursive: true });
  await writeFile(recordPath, runtime.toMarkdown(record), 'utf8');
  await writeFile(journalPath, `${JSON.stringify({
    idempotencyKey: 'fixture-uncommitted-create',
    fingerprint: createHash('sha256').update('uncommitted-create').digest('hex'),
    mutationId: `pvm_${'C'.repeat(26)}`,
    operationType: 'record.create',
    recordId,
    previousRecord: null,
  })}\n`, 'utf8');

  assert.deepEqual(await runtime.recoverPendingMutations(), { recovered: 1, committed: 0, rolledBack: 1 });
  const files = await storeFiles(root);
  assert.deepEqual(files.records, []);
  assert.deepEqual(files.audit, []);
  assert.deepEqual(files.idempotency, {});
});

test('recovery restores an existing record when its replacement never reached audit', async (t) => {
  const { root, runtime } = await fixtureRuntime(t);
  const created = (await runtime.applyMutation(mutation({ type: 'record.create', record: draft() }, { id: 'A' }))).record;
  const revisedText = '# Interrupted revision\nMust not survive recovery.';
  const replacement = {
    ...created,
    revision: 2,
    updatedAt: new Date().toISOString(),
    title: 'Interrupted revision',
    content: { ...created.content, text: revisedText, hash: hash(revisedText) },
  };
  const store = path.join(root, '.personal-vault');
  const recordPath = path.join(store, 'records', `${created.recordId}.md`);
  const journalPath = path.join(store, 'indexes', 'pending.jsonl');
  await writeFile(recordPath, runtime.toMarkdown(replacement), 'utf8');
  await appendFile(journalPath, `${JSON.stringify({
    idempotencyKey: 'fixture-uncommitted-revise',
    fingerprint: createHash('sha256').update('uncommitted-revise').digest('hex'),
    mutationId: `pvm_${'D'.repeat(26)}`,
    operationType: 'record.revise',
    recordId: created.recordId,
    previousRecord: created,
  })}\n`, 'utf8');

  assert.deepEqual(await runtime.recoverPendingMutations(), { recovered: 1, committed: 0, rolledBack: 1 });
  assert.deepEqual(await runtime.readRecord(created.recordId), created);
  const files = await storeFiles(root);
  assert.equal(files.records.length, 1);
  assert.equal(files.audit.length, 1, 'only the original create event remains');
  assert.equal(Object.keys(files.idempotency).length, 1, 'only the original create is indexed');
});

test('audit failure rolls back the staged record write', async (t) => {
  const { root, runtime } = await fixtureRuntime(t);
  const auditPath = path.join(root, '.personal-vault', 'audit', 'events.jsonl');
  await mkdir(auditPath, { recursive: true });

  await assert.rejects(
    runtime.applyMutation(mutation({ type: 'record.create', record: draft() }, { id: 'A' })),
    /EISDIR|illegal operation on a directory|Is a directory/i,
  );

  const files = await storeFiles(root);
  assert.deepEqual(files.records, [], 'record write must be removed when audit append fails');
  assert.deepEqual(files.audit, []);
  assert.deepEqual(files.idempotency, {});
});

test('integrity check reports ok on a clean vault with records and assets', async (t) => {
  const { runtime } = await fixtureRuntime(t);
  const created = (await runtime.applyMutation(mutation({ type: 'record.create', record: draft() }, { id: 'A' }))).record;
  await runtime.applyMutation(mutation(assetAttach({ recordId: created.recordId, baseRevision: 1 }), { id: 'B' }));

  const result = await runtime.checkIntegrity();
  assert.equal(result.contractVersion, 'personal-vault/v1');
  assert.equal(result.ok, true);
  assert.deepEqual(result.issues, []);
  assert.equal(result.recordCount, 1);
  assert.equal(result.assetCount, 1);
  assert.equal(result.auditCount, 2);
});

test('integrity check detects a tampered record body', async (t) => {
  const { root, runtime } = await fixtureRuntime(t);
  const created = (await runtime.applyMutation(mutation({ type: 'record.create', record: draft() }, { id: 'A' }))).record;
  const recordFile = path.join(root, '.personal-vault', 'records', `${created.recordId}.md`);
  const markdown = await readFile(recordFile, 'utf8');
  await writeFile(recordFile, markdown.replace('# Fixture', '# Tampered'), 'utf8');

  const result = await runtime.checkIntegrity();
  assert.equal(result.ok, false);
  assert.equal(result.issues.length, 1);
  assert.match(result.issues[0], /record pvr_/);
  assert.match(result.issues[0], /content hash/);
});

test('integrity check detects a missing asset payload', async (t) => {
  const { root, runtime } = await fixtureRuntime(t);
  const created = (await runtime.applyMutation(mutation({ type: 'record.create', record: draft() }, { id: 'A' }))).record;
  const bytes = Buffer.from('hello asset');
  await runtime.applyMutation(mutation(assetAttach({ recordId: created.recordId, baseRevision: 1, bytes }), { id: 'B' }));
  const payloadPath = path.join(root, '.personal-vault', 'assets', 'payloads', `${createHash('sha256').update(bytes).digest('hex')}.bin`);
  await rm(payloadPath, { force: true });

  const result = await runtime.checkIntegrity();
  assert.equal(result.ok, false);
  assert.equal(result.issues.length, 1);
  assert.match(result.issues[0], /asset pva_/);
  assert.match(result.issues[0], /payload missing/);
});

test('integrity check detects non-monotonic audit sequences', async (t) => {
  const { root, runtime } = await fixtureRuntime(t);
  await runtime.applyMutation(mutation({ type: 'record.create', record: draft() }, { id: 'A' }));
  const auditPath = path.join(root, '.personal-vault', 'audit', 'events.jsonl');
  const events = (await readFile(auditPath, 'utf8')).split('\n').filter(Boolean).map(JSON.parse);
  const duplicated = JSON.parse(JSON.stringify(events[0]));
  await writeFile(auditPath, `${JSON.stringify(events[0])}\n${JSON.stringify({ ...duplicated, eventId: `pve_${'D'.repeat(26)}`, mutationId: `pvm_${'D'.repeat(26)}` })}\n`, 'utf8');

  const result = await runtime.checkIntegrity();
  assert.equal(result.ok, false);
  assert.equal(result.issues.length, 1);
  assert.match(result.issues[0], /non-monotonic sequence/);
});
