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
  const client = new Client({ name: 'personal-vault-smoke', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://${host}:${port}/mcp`)));
  const tools = await client.listTools();
  assert.deepEqual(tools.tools.map((tool) => tool.name).sort(), ['vault.files.archive', 'vault.files.attach', 'vault.files.create', 'vault.files.list', 'vault.files.read', 'vault.files.restore', 'vault.files.search', 'vault.files.update']);
  const created = await client.callTool({ name: 'vault.files.create', arguments: { path: 'raw/2026/08/hello.md', content: '# Hello\n\nA readable note.\n' } });
  assert.equal(created.structuredContent.path, 'raw/2026/08/hello.md');
  assert.equal((await client.callTool({ name: 'vault.files.read', arguments: { path: 'raw/2026/08/hello.md' } })).structuredContent.content.includes('readable note'), true);
  const attached = await client.callTool({ name: 'vault.files.attach', arguments: { markdownPath: 'raw/2026/08/hello.md', name: 'sample.bin', dataBase64: Buffer.from('sample').toString('base64') } });
  assert.equal(attached.structuredContent.assetPath, 'raw/2026/08/hello.assets/sample.bin');
  assert.equal((await client.callTool({ name: 'vault.files.search', arguments: { query: 'readable' } })).structuredContent.matches[0].path, 'raw/2026/08/hello.md');
  await client.callTool({ name: 'vault.files.archive', arguments: { path: 'raw/2026/08/hello.md' } });
  const archived = `archive/${new Date().toISOString().slice(0, 10)}/raw/2026/08/hello.md`;
  const archivedAsset = `archive/${new Date().toISOString().slice(0, 10)}/raw/2026/08/hello.assets/sample.bin`;
  assert.equal((await readFile(path.join(fixture, archivedAsset), 'utf8')), 'sample');
  await client.callTool({ name: 'vault.files.restore', arguments: { path: archived } });
  assert.equal((await readFile(path.join(fixture, 'raw/2026/08/hello.md'), 'utf8')).includes('Hello'), true);
  assert.equal((await readFile(path.join(fixture, 'raw/2026/08/hello.assets/sample.bin'), 'utf8')), 'sample');
  const call = (name, args) => client.callTool({ name: `vault.files.${name}`, arguments: args });
  assert.equal((await call('create', { path: 'raw/2026/08/hello.md', content: 'duplicate' })).isError, true);
  assert.equal((await call('update', { path: 'missing.md', content: 'missing' })).isError, true);
  assert.equal((await call('attach', { markdownPath: 'raw/2026/08/hello.md', name: 'sample.bin', dataBase64: Buffer.from('different').toString('base64') })).isError, true);
  assert.equal(await readFile(path.join(fixture, 'raw/2026/08/hello.assets/sample.bin'), 'utf8'), 'sample');
  await call('update', { path: 'raw/2026/08/hello.md', content: '# Edited' });
  assert.equal(await readFile(path.join(fixture, 'raw/2026/08/hello.md'), 'utf8'), '# Edited');
  const outside = await mkdtemp(path.join(tmpdir(), 'vault-outside-'));
  try {
    await writeFile(path.join(outside, 'outside.md'), 'outside fixture');
    await symlink(outside, path.join(fixture, 'escape'));
    for (const [name, args] of [
      ['read', { path: 'escape/outside.md' }],
      ['create', { path: 'escape/new.md', content: 'bad' }],
      ['update', { path: 'escape/outside.md', content: 'bad' }],
      ['archive', { path: 'escape/outside.md' }],
      ['list', { path: 'escape' }],
    ]) assert.equal((await call(name,args)).isError, true, name);
    assert.equal(await readFile(path.join(outside, 'outside.md'), 'utf8'), 'outside fixture');
    assert.equal((await call('search', { query: 'outside fixture' })).structuredContent.matches.length, 0);
  } finally { await rm(outside, { recursive: true, force: true }); }
  await client.close();
  console.log('Personal Vault smoke test passed: readable files, search, attachments, archive and restore.');
} finally {
  child.kill('SIGTERM');
  await rm(fixture, { recursive: true, force: true });
}
