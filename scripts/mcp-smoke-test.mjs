#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER_PATH = path.join(REPO_ROOT, 'mcp', 'personal-vault-server.mjs');
const HOST = '127.0.0.1';

async function reservePort() {
  const server = createServer();
  server.listen(0, HOST);
  await once(server, 'listening');
  const address = server.address();
  assert.equal(typeof address, 'object');
  const port = address.port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitForStatus(url, child, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Personal Vault MCP exited early with code ${child.exitCode}.`);
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
      lastError = new Error(`status returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError?.message || 'unknown error'}`);
}

function content(text) {
  return {
    format: 'markdown',
    text,
    hash: `sha256:${createHash('sha256').update(text).digest('hex')}`,
    language: 'en',
  };
}

function createMutation() {
  const now = new Date().toISOString();
  const actor = { kind: 'user', id: 'fixture-user', displayName: 'Fixture User' };
  return {
    contractVersion: 'personal-vault/v1',
    mutationId: `pvm_${'A'.repeat(26)}`,
    requestedAt: now,
    requestedBy: actor,
    idempotencyKey: 'fixture-smoke-create-0001',
    approval: { kind: 'user', approvedAt: now, approvedBy: actor, evidenceRef: 'fixture:smoke-test' },
    operation: {
      type: 'record.create',
      record: {
        privacy: 'restricted',
        title: 'Temporary MCP smoke record',
        content: content('# Temporary MCP smoke record\nThis fixture is deleted after the test.'),
        provenance: { origin: 'direct', capturedAt: now, capturedBy: actor },
        assetRefs: [],
        metadata: { 'fixture.smoke-test': true },
      },
    },
    provenance: { origin: 'direct', capturedAt: now, capturedBy: actor },
  };
}

export async function runMcpSmokeTest() {
  const fixtureRoot = await mkdtemp(path.join(tmpdir(), 'personal-vault-mcp-smoke-'));
  const port = await reservePort();
  const baseUrl = `http://${HOST}:${port}`;
  const stderr = [];
  const stdout = [];
  const child = spawn(process.execPath, [SERVER_PATH], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      PERSONAL_VAULT_ROOT: fixtureRoot,
      MCP_HOST: HOST,
      MCP_PORT: String(port),
      MCP_GOOGLE_AUTH: 'false',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => stdout.push(chunk));
  child.stderr.on('data', (chunk) => stderr.push(chunk));

  let client;
  try {
    const status = await waitForStatus(`${baseUrl}/status`, child);
    assert.equal(status.server, 'personal-vault');
    assert.equal(status.contractVersion, 'personal-vault/v1');
    assert.equal(status.bind, HOST);
    assert.equal(status.mcpEndpoint, `${baseUrl}/mcp`);

    client = new Client({ name: 'personal-vault-smoke-test', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`));
    await client.connect(transport);

    assert.equal(client.getServerVersion()?.name, 'personal-vault');
    const discovered = await client.listTools();
    assert.ok(discovered.tools.length > 0);
    assert.ok(discovered.tools.every((tool) => tool.name.startsWith('vault.')), discovered.tools.map((tool) => tool.name).join(', '));
    const names = new Set(discovered.tools.map((tool) => tool.name));
    assert.ok(names.has('vault.records.create'));
    assert.ok(names.has('vault.records.get'));

    const created = await client.callTool({ name: 'vault.records.create', arguments: { mutation: createMutation() } });
    assert.equal(created.isError, undefined);
    const recordId = created.structuredContent?.record?.recordId;
    assert.match(recordId, /^pvr_[0-9A-HJKMNP-TV-Z]{26}$/);

    const fetched = await client.callTool({ name: 'vault.records.get', arguments: { recordId } });
    assert.equal(fetched.isError, undefined);
    assert.equal(fetched.structuredContent?.record?.recordId, recordId);
    assert.match(fetched.content?.[0]?.text || '', /Temporary MCP smoke record/);

    const recordFiles = await readFile(path.join(fixtureRoot, '.personal-vault', 'records', `${recordId}.md`), 'utf8');
    assert.match(recordFiles, /fixture\.smoke-test/);

    return { fixtureRoot, port, toolCount: discovered.tools.length, recordId };
  } finally {
    if (client) await client.close().catch(() => {});
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await Promise.race([
        once(child, 'exit'),
        new Promise((resolve) => setTimeout(resolve, 2_000)),
      ]);
      if (child.exitCode === null) child.kill('SIGKILL');
    }
    await rm(fixtureRoot, { recursive: true, force: true });
    if (child.exitCode && child.exitCode !== 0 && child.signalCode !== 'SIGTERM') {
      throw new Error(`Personal Vault MCP failed (code=${child.exitCode}, signal=${child.signalCode}).\nstdout:\n${stdout.join('')}\nstderr:\n${stderr.join('')}`);
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await runMcpSmokeTest();
  console.log(`Personal Vault MCP smoke test passed: ${result.toolCount} vault.* tools, record ${result.recordId}, temporary port ${result.port}.`);
}
