#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = await mkdtemp(path.join(tmpdir(), 'vault-context-'));
const token = 'context-test-token';
const original = '# Shared protocol\n\nSynthetic owner preferences, not provider memory.\n';
const clients = new Set();
let child;
let base;
let checks = 0;
const pass = (label) => { checks++; console.log(`ok ${checks}: ${label}`); };
const stop = async () => {
  for (const client of clients) await client.close();
  clients.clear();
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited;
  }
};
const start = async (contextFile, mode = 'http-401', trustLocalhost = false) => {
  await stop();
  const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ['mcp/personal-vault-server.mjs'], { cwd: root, stdio: 'ignore', env: {
    ...process.env, PERSONAL_VAULT_ROOT: fixture, MCP_HOST: '127.0.0.1', MCP_PORT: String(port),
    MCP_GOOGLE_AUTH: 'false', MCP_SERVICE_TOKENS: token, MCP_TRUST_LOCALHOST: String(trustLocalhost),
    MCP_CONTEXT_FILE: contextFile, MCP_AUTH_CHALLENGE_MODE: mode,
  } });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${base}/status`)).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('Fixture server did not start.');
};
const connect = async (auth = token) => {
  const client = new Client({ name: 'neutral-context-test', version: '1' }); clients.add(client);
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
    requestInit: { headers: auth ? { authorization: `Bearer ${auth}` } : {} },
  })); return client;
};
const rawInitialize = (auth = token, extraHeaders = {}) => fetch(`${base}/mcp`, { method: 'POST', headers: {
  'content-type': 'application/json', accept: 'application/json, text/event-stream',
  ...(auth ? { authorization: `Bearer ${auth}` } : {}),
  ...extraHeaders,
}, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
  protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'raw-json-rpc-client', version: '1' },
} }) });

try {
  await writeFile(path.join(fixture, 'protocol.md'), original);
  await start('protocol.md');
  assert.equal((await rawInitialize()).status, 200);
  const client = await connect();
  assert.ok(client.getInstructions().includes(original));
  const wire = await (await rawInitialize()).json();
  assert.equal(wire.result.instructions, client.getInstructions());
  pass('SDK and raw JSON-RPC clients receive identical context without model SDKs');
  assert.deepEqual((await client.listResources()).resources.map(r => r.uri), ['vault://context']);
  const resource = (await client.readResource({ uri: 'vault://context' })).contents[0];
  assert.equal(resource.text, original);
  assert.equal(resource._meta.sha256, createHash('sha256').update(original).digest('hex'));
  pass('resource discovery/read exposes exact Markdown and content hash');
  const file = await client.callTool({ name: 'vault_files_read', arguments: { path: 'protocol.md' } });
  assert.equal(file.structuredContent.content, original);
  pass('existing file tool remains a fallback for resource-less clients');
  const updated = '# Updated protocol\nDo not revive yesterday\'s task.\n';
  await writeFile(path.join(fixture, 'protocol.md'), updated);
  assert.equal((await client.readResource({ uri: 'vault://context' })).contents[0].text, updated);
  assert.ok((await connect()).getInstructions().includes(updated));
  pass('edits appear on resource refresh and reconnect without server restart');
  const anon = await rawInitialize(null);
  assert.equal(anon.status, 401); assert.ok(!(await anon.text()).includes(updated));
  assert.equal((await rawInitialize('wrong')).status, 401);
  pass('anonymous and wrong-token initialization do not disclose private context');
  await start('protocol.md', 'in-band');
  const inBand = await connect(null);
  assert.ok(!inBand.getInstructions().includes(updated));
  await assert.rejects(inBand.readResource({ uri: 'vault://context' }));
  pass('legacy in-band mode does not leak startup text or allow resource reads');
  await start('protocol.md', 'http-401', true);
  const local = await rawInitialize(null);
  assert.equal(local.status, 200);
  assert.ok((await local.json()).result.instructions.includes(updated));
  for (const headers of [{ forwarded: 'for=203.0.113.7' }, { 'x-forwarded-for': '203.0.113.7' }]) {
    const proxied = await rawInitialize(null, headers);
    assert.equal(proxied.status, 401);
    assert.ok(!(await proxied.text()).includes(updated));
  }
  assert.equal((await rawInitialize('wrong')).status, 401);
  pass('trusted loopback receives context; forwarded requests and wrong tokens remain denied');
  await start('missing.md');
  const missing = await connect();
  assert.match(missing.getInstructions(), /context file is unavailable/);
  assert.ok((await missing.listTools()).tools.some(t => t.name === 'vault_files_read'));
  await assert.rejects(missing.readResource({ uri: 'vault://context' }));
  pass('missing context is explicit; ordinary Vault tools remain available');
  await start('../outside.md');
  assert.match((await connect()).getInstructions(), /context file is unavailable/);
  await start('/outside.md');
  assert.match((await connect()).getInstructions(), /context file is unavailable/);
  pass('absolute paths and traversal cannot supply context');
  await symlink(path.join(fixture, 'protocol.md'), path.join(fixture, 'link.md'));
  await start('link.md');
  assert.match((await connect()).getInstructions(), /context file is unavailable/);
  pass('symlinks cannot supply context');
  await writeFile(path.join(fixture, 'large.md'), 'x'.repeat(32769));
  await start('large.md');
  assert.match((await connect()).getInstructions(), /context file is unavailable/);
  pass('oversized startup content is rejected without truncation');
  await start('');
  const disabled = await connect();
  assert.ok(!disabled.getInstructions().includes(updated));
  assert.equal(disabled.getServerCapabilities().resources, undefined);
  pass('unset configuration preserves the ordinary generic Vault interface');
  console.log(`Context smoke test passed: ${checks} checks. No real provider calls or personal data used.`);
} finally {
  await stop();
  await rm(fixture, { recursive: true, force: true });
}
