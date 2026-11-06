#!/usr/bin/env node
// Exercises a real CLI worker against an isolated temporary Vault only.
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const cli = fileURLToPath(new URL('./context-index.mjs', import.meta.url));
const root = await mkdtemp(path.join(os.tmpdir(), 'vault-context-worker-'));
const digest = (text) => createHash('sha256').update(text).digest('hex');
const indexFile = path.join(root, 'indexes/context-index/index.jsonl');
const events = [];
const waiting = new Set();
let stderr = '';
let buffer = '';
let child;
let exited = false;

function dispatch() {
  for (const waiter of waiting) {
    const found = events.findIndex((event, i) => i >= waiter.after && waiter.accept(event));
    if (found >= 0) {
      clearTimeout(waiter.timer);
      waiting.delete(waiter);
      waiter.resolve({ event: events[found], cursor: found + 1 });
    }
  }
}

function waitForEvent(after, accept, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const waiter = { after, accept, resolve, reject };
    waiter.timer = setTimeout(() => {
      waiting.delete(waiter);
      reject(new Error(`Context worker event timed out. stderr=${stderr}; events=${JSON.stringify(events)}`));
    }, timeoutMs);
    waiting.add(waiter);
    dispatch();
    if (exited && waiting.has(waiter)) {
      clearTimeout(waiter.timer);
      waiting.delete(waiter);
      reject(new Error(`Context worker exited before expected refresh: ${stderr}`));
    }
  });
}

async function sourceRow(relative) {
  const rows = (await readFile(indexFile, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
  return rows.find((row) => row.recordType === 'source' && row.path === relative);
}

async function waitForSource(relative, hash, after) {
  const deadline = Date.now() + 20000;
  let cursor = after;
  while (Date.now() < deadline) {
    const next = await waitForEvent(cursor, (event) => event.event === 'context-index-refresh', deadline - Date.now());
    cursor = next.cursor;
    const row = await sourceRow(relative);
    if (row?.contentSha256 === hash) return { row, cursor, refresh: next.event };
  }
  throw new Error(`Worker did not publish the expected source revision for ${relative}.`);
}

async function query(text) {
  const result = await execFileAsync(process.execPath, [cli, 'query', '--root', root, '--query', text, '--max-chars', '4000'], {
    timeout: 10000, maxBuffer: 1024 * 1024,
  });
  return JSON.parse(result.stdout);
}

try {
  await mkdir(path.join(root, 'raw'));
  const initial = '# Worker fixture\n\nThe approved outcome is initial-worker-marker.\n';
  await writeFile(path.join(root, 'raw/example.md'), initial);
  child = spawn(process.execPath, [cli, 'watch', '--root', root, '--interval-ms', '1000', '--debounce-ms', '25'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PERSONAL_VAULT_ROOT: root },
  });
  const exit = new Promise((resolve) => {
    child.once('error', (error) => { stderr += error.message; });
    child.once('close', (code, signal) => {
      exited = true;
      for (const waiter of waiting) {
        clearTimeout(waiter.timer);
        waiter.reject(new Error(`Worker exited unexpectedly (${code}, ${signal}): ${stderr}`));
      }
      waiting.clear();
      resolve({ code, signal });
    });
  });
  child.stderr.on('data', (chunk) => { stderr += String(chunk); });
  child.stdout.on('data', (chunk) => {
    buffer += String(chunk);
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
      if (line.trim()) {
        try { events.push(JSON.parse(line)); }
        catch { stderr += `Invalid JSON worker output: ${line}\n`; }
      }
    }
    dispatch();
  });

  const startup = await waitForEvent(0, (event) => event.event === 'context-index-refresh' && event.reason === 'startup');
  assert.equal(startup.event.complete, true, 'startup scan is complete');
  assert.equal((await sourceRow('raw/example.md')).contentSha256, digest(initial));
  const firstQuery = await query('approved outcome');
  assert.equal(firstQuery.status, 'ok');
  assert.ok(firstQuery.results.some((item) => item.path === 'raw/example.md' && item.excerpt.includes('initial-worker-marker')));

  // This simulates an editor that bypasses the Vault capture operation.
  const changed = '# Worker fixture\n\nThe approved outcome is changed-worker-marker.\n';
  const beforeEdit = events.length;
  await writeFile(path.join(root, 'raw/example.md'), changed);
  const edited = await waitForSource('raw/example.md', digest(changed), beforeEdit);
  assert.equal(edited.row.contentMode, 'extractive-text');
  const changedQuery = await query('approved outcome');
  assert.ok(changedQuery.results.some((item) => item.path === 'raw/example.md' && item.excerpt.includes('changed-worker-marker')));
  assert.ok(changedQuery.results.every((item) => !item.excerpt.includes('initial-worker-marker')), 'old excerpt is not returned as current');

  // No watcher was mounted for a directory absent at startup. Periodic recovery
  // must still discover files subsequently saved into that source root.
  const late = '# Late arrival\n\nA separate late-root-marker arrived outside capture.\n';
  const beforeLateRoot = events.length;
  await mkdir(path.join(root, 'incoming'));
  await writeFile(path.join(root, 'incoming/late.md'), late);
  const recovered = await waitForSource('incoming/late.md', digest(late), beforeLateRoot);
  const lateQuery = await query('late-root-marker');
  assert.ok(lateQuery.results.some((item) => item.path === 'incoming/late.md' && item.freshness === 'verified'));

  const beforeIdle = events.length;
  const revisionBefore = await readFile(indexFile, 'utf8');
  const mtimeBefore = (await stat(indexFile)).mtimeMs;
  const idle = await waitForEvent(beforeIdle, (event) => event.event === 'context-index-refresh' && event.reason === 'periodic-reconciliation' && event.changed === false);
  assert.equal(idle.event.readFiles, 0, 'unchanged sources reuse previous content');
  assert.equal(idle.event.reusedFiles, 2);
  assert.equal(await readFile(indexFile, 'utf8'), revisionBefore, 'idle reconciliation leaves derived bytes unchanged');
  assert.equal((await stat(indexFile)).mtimeMs, mtimeBefore, 'idle reconciliation does not rewrite the index');
  assert.equal(events.filter((event) => event.event === 'context-index-error').length, 0);

  child.kill('SIGTERM');
  let killTimer;
  const stopped = await Promise.race([
    exit,
    new Promise((_, reject) => { killTimer = setTimeout(() => reject(new Error('Worker did not stop cleanly.')), 5000); }),
  ]).finally(() => clearTimeout(killTimer));
  assert.equal(stopped.code, 0, 'worker handles shutdown cleanly');
  assert.equal(recovered.row.contentSha256, digest(late));
  console.log('Context index worker: startup, external edit, missing-root recovery, idle reuse and shutdown passed.');
} finally {
  if (child && !exited) child.kill('SIGKILL');
  for (const waiter of waiting) clearTimeout(waiter.timer);
  await rm(root, { recursive: true, force: true });
}
