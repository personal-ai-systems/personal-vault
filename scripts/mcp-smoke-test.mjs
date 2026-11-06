#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createVault } from '../lib/index.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const host = '127.0.0.1';
const fixture = await mkdtemp(path.join(tmpdir(), 'personal-vault-smoke-'));
const reservation = createServer();
reservation.listen(0, host);
await once(reservation, 'listening');
const port = reservation.address().port;
await new Promise((resolve) => reservation.close(resolve));
const child = spawn(process.execPath, ['mcp/personal-vault-server.mjs'], { cwd: root, env: { ...process.env, PERSONAL_VAULT_ROOT: fixture, MCP_HOST: host, MCP_PORT: String(port) }, stdio: 'ignore' });

async function waitForServer() {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try { if ((await fetch(`http://${host}:${port}/status`)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Timed out waiting for Personal Vault MCP.');
}

try {
  await waitForServer();
  const base = `http://${host}:${port}`;

  // /status advertises the one MCP endpoint this product serves.
  const status = await (await fetch(`${base}/status`)).json();
  assert.equal(status.mcpEndpoint, `${base}/mcp`);

  const client = new Client({ name: 'personal-vault-smoke', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
  const startupGuidance = client.getInstructions().slice(0, 512);
  assert.match(startupGuidance, /vault_context_get/);
  assert.match(startupGuidance, /Before every answer or question/);
  assert.match(startupGuidance, /sources were actually read/);
  const captureTools = ['apply_capture_action', 'capture_asset', 'capture_note', 'get_capture_review', 'get_today_plan', 'search_vault'];
  const fileTools = ['vault_files_archive', 'vault_files_attach', 'vault_files_create', 'vault_files_list', 'vault_files_list_deleted', 'vault_files_read', 'vault_files_read_binary', 'vault_files_restore', 'vault_files_restore_deleted', 'vault_files_search', 'vault_files_trash', 'vault_files_update'];
  const tools = await client.listTools();
  assert.deepEqual(tools.tools.map((tool) => tool.name).sort(), [...captureTools, ...fileTools, 'vault_context_get'].sort());
  for (const tool of tools.tools) assert.equal(tool.name.includes('.'), false, `${tool.name} must not contain a dot`);
  const contextTool = tools.tools.find((tool) => tool.name === 'vault_context_get');
  assert.equal(contextTool.annotations.readOnlyHint, true);
  assert.equal(contextTool.outputSchema.type, 'object');
  assert.deepEqual(contextTool.outputSchema.properties.status.enum, ['ok', 'missing-index', 'invalid-index']);
  assert.equal(contextTool.outputSchema.properties.results.items.properties.contentSha256.type, 'string');

  const call = (name, args) => client.callTool({ name: `vault_files_${name}`, arguments: args });
  assert.equal((await client.callTool({ name: 'vault_context_get', arguments: { query: 'readable' } })).structuredContent.status, 'missing-index');
  const missingFolder = await call('list', { path: 'raw/2099/01' });
  assert.deepEqual(missingFolder.structuredContent.items, []);
  const created = await call('create', { path: 'raw/2026/08/hello.md', content: '# Hello\n\nA readable note.\n' });
  assert.equal(created.structuredContent.path, 'raw/2026/08/hello.md');
  assert.equal((await call('read', { path: 'raw/2026/08/hello.md' })).structuredContent.content.includes('readable note'), true);
  const attached = await call('attach', { markdownPath: 'raw/2026/08/hello.md', name: 'sample.bin', dataBase64: Buffer.from('sample').toString('base64') });
  assert.equal(attached.structuredContent.assetPath, 'raw/2026/08/hello.assets/sample.bin');
  assert.equal((await call('search', { query: 'readable' })).structuredContent.matches[0].path, 'raw/2026/08/hello.md');
  const indexedVault = createVault({ root: fixture });
  await indexedVault.refreshContextIndex();
  const indexPath = path.join(fixture, 'indexes/context-index/index.jsonl');
  const indexBytesBeforeQuery = await readFile(indexPath, 'utf8');
  const contextOptions = { query: 'readable', contexts: ['unrelated-hint'], limit: 3, maxChars: 2000 };
  const localContext = await indexedVault.getContext(contextOptions);
  const remoteContext = await client.callTool({ name: 'vault_context_get', arguments: contextOptions });
  assert.deepEqual(remoteContext.structuredContent, localContext, 'Local library and MCP must use the same bounded source context.');
  assert.equal(await readFile(indexPath, 'utf8'), indexBytesBeforeQuery, 'Read-only retrieval must not refresh or rewrite the index.');
  assert.deepEqual(JSON.parse(remoteContext.content[0].text), remoteContext.structuredContent, 'Text and structured clients receive the same contract.');
  assert.equal(localContext.results.some((item) => item.path === 'raw/2026/08/hello.md' && item.freshness === 'verified'), true);
  await writeFile(indexPath, '{invalid index\n');
  const invalidContext = await client.callTool({ name: 'vault_context_get', arguments: contextOptions });
  assert.equal(invalidContext.isError, undefined);
  assert.equal(invalidContext.structuredContent.status, 'invalid-index');
  assert.deepEqual(invalidContext.structuredContent.results, []);
  assert.match(invalidContext.structuredContent.fallback, /ordinary full-text search/);
  await writeFile(indexPath, indexBytesBeforeQuery);
  await writeFile(path.join(fixture, 'raw/2026/08/hello.md'), '# Hello\n\nA readable note. External edit.\n');
  const staleContext = (await client.callTool({ name: 'vault_context_get', arguments: contextOptions })).structuredContent;
  assert.equal(staleContext.warnings.some((item) => item.reason === 'source-changed'), true);
  await indexedVault.refreshContextIndex();
  assert.equal((await client.callTool({ name: 'vault_context_get', arguments: { query: 'External edit' } })).structuredContent.results.some((item) => item.excerpt.includes('External edit')), true);
  await call('archive', { path: 'raw/2026/08/hello.md' });
  const archived = `archive/${new Date().toISOString().slice(0, 10)}/raw/2026/08/hello.md`;
  const archivedAsset = `archive/${new Date().toISOString().slice(0, 10)}/raw/2026/08/hello.assets/sample.bin`;
  assert.equal((await readFile(path.join(fixture, archivedAsset), 'utf8')), 'sample');
  await call('restore', { path: archived });
  assert.equal((await readFile(path.join(fixture, 'raw/2026/08/hello.md'), 'utf8')).includes('Hello'), true);
  assert.equal((await readFile(path.join(fixture, 'raw/2026/08/hello.assets/sample.bin'), 'utf8')), 'sample');

  const trashed = await call('trash', { path: 'raw/2026/08/hello.md' });
  assert.equal(trashed.isError, undefined);
  const deletedPath = trashed.structuredContent.to;
  assert.equal(deletedPath, `.trash/${new Date().toISOString().slice(0, 10)}/raw/2026/08/hello.md`);
  assert.equal(await readFile(path.join(fixture, `${deletedPath.slice(0, -3)}.assets/sample.bin`), 'utf8'), 'sample');
  const deleted = await call('list_deleted', {});
  assert.equal(deleted.structuredContent.items[0].path, deletedPath);
  assert.equal(deleted.structuredContent.items[0].originalPath, 'raw/2026/08/hello.md');
  assert.equal(deleted.structuredContent.items[0].canRestore, true);
  assert.equal(deleted.structuredContent.truncated, false);
  await writeFile(path.join(fixture, '.trash/legacy.md'), 'unknown original folder');
  const withLegacy = await call('list_deleted', {});
  assert.equal(withLegacy.structuredContent.unsupported.some((item) => item.path === '.trash/legacy.md'), true);
  assert.equal((await call('restore_deleted', { path: '.trash/legacy.md' })).isError, true);
  assert.equal((await call('restore_deleted', { path: deletedPath })).isError, undefined);
  assert.equal(await readFile(path.join(fixture, 'raw/2026/08/hello.assets/sample.bin'), 'utf8'), 'sample');
  assert.equal((await call('list_deleted', {})).structuredContent.items.length, 0);
  assert.equal((await call('trash', { path: '../outside.md' })).isError, true);
  assert.equal((await call('restore_deleted', { path: '../outside.md' })).isError, true);
  assert.equal((await call('list_deleted', { limit: 0 })).isError, true);

  assert.equal((await call('create', { path: 'raw/2026/08/hello.md', content: 'duplicate' })).isError, true);
  assert.equal((await call('update', { path: 'missing.md', content: 'missing' })).isError, true);
  assert.equal((await call('attach', { markdownPath: 'raw/2026/08/hello.md', name: 'sample.bin', dataBase64: Buffer.from('different').toString('base64') })).isError, true);
  assert.equal(await readFile(path.join(fixture, 'raw/2026/08/hello.assets/sample.bin'), 'utf8'), 'sample');
  const binary = await call('read_binary', { path: 'raw/2026/08/hello.assets/sample.bin' });
  assert.equal(Buffer.from(binary.structuredContent.dataBase64, 'base64').toString(), 'sample');
  assert.equal((await call('read_binary', { path: '../outside.bin' })).isError, true);
  await call('update', { path: 'raw/2026/08/hello.md', content: '# Edited' });
  assert.equal(await readFile(path.join(fixture, 'raw/2026/08/hello.md'), 'utf8'), '# Edited');

  const outside = await mkdtemp(path.join(tmpdir(), 'vault-outside-'));
  try {
    await writeFile(path.join(outside, 'outside.md'), 'outside fixture');
    await symlink(outside, path.join(fixture, 'escape'));
    for (const [name, args] of [
      ['read', { path: 'escape/outside.md' }],
      ['read_binary', { path: 'escape/outside.md' }],
      ['create', { path: 'escape/new.md', content: 'bad' }],
      ['update', { path: 'escape/outside.md', content: 'bad' }],
      ['archive', { path: 'escape/outside.md' }],
      ['trash', { path: 'escape/outside.md' }],
      ['list', { path: 'escape' }],
    ]) assert.equal((await call(name, args)).isError, true, name);
    assert.equal(await readFile(path.join(outside, 'outside.md'), 'utf8'), 'outside fixture');
    assert.equal((await call('search', { query: 'outside fixture' })).structuredContent.matches.length, 0);
  } finally { await rm(outside, { recursive: true, force: true }); }
  await client.close();
  console.log('Personal Vault smoke test passed: one /mcp endpoint, underscore tool names, readable files, search, attachments, archive, recoverable delete and restore.');
} finally {
  child.kill('SIGTERM');
  await rm(fixture, { recursive: true, force: true });
}
