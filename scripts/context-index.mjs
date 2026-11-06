#!/usr/bin/env node
// Maintenance/retrieval adapter. Never chooses a real Vault implicitly.
import { watch } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { refreshContextIndex, getContext, indexStatus } from '../lib/context-index.mjs';

const args = process.argv.slice(2);
const operation = args.shift() || 'status';
const options = {};
while (args.length) {
  const key = args.shift();
  if (!key?.startsWith('--') || !args.length) throw new Error('Options need a --name and value.');
  const value = args.shift();
  if (['context', 'metadata-only'].includes(key.slice(2))) (options[key.slice(2)] ||= []).push(value);
  else options[key.slice(2)] = value;
}
const root = options.root || process.env.PERSONAL_VAULT_ROOT;
if (!root || !(await stat(root)).isDirectory()) throw new Error('Select an existing Vault with --root.');
const settings = { root, ...(options['metadata-only'] ? { metadataOnly: options['metadata-only'] } : {}) };
const emit = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);

if (operation === 'refresh') emit(await refreshContextIndex(settings));
else if (operation === 'status') emit(await indexStatus({ root }));
else if (operation === 'query') emit(await getContext({ root, query: options.query || '', contexts: options.context || [],
  ...(options.cursor ? { cursor: options.cursor } : {}),
  ...(options.limit ? { limit: Number(options.limit) } : {}),
  ...(options['max-chars'] ? { maxChars: Number(options['max-chars']) } : {}) }));
else if (operation === 'watch') {
  const intervalMs = Number(options['interval-ms'] || 300000);
  const debounceMs = Number(options['debounce-ms'] || 1500);
  if (!Number.isFinite(intervalMs) || intervalMs < 1000 || !Number.isFinite(debounceMs) || debounceMs < 10) throw new Error('Invalid watch interval.');
  let active;
  let dirty = false;
  let timer;
  let stopping = false;
  const watchers = [];
  async function refresh(reason) {
    if (stopping) return;
    if (active) { dirty = true; return; }
    active = (async () => {
      do {
        dirty = false;
        try {
          const result = await refreshContextIndex(settings);
          emit({ event: 'context-index-refresh', reason, at: new Date().toISOString(), ...result });
        } catch (error) { emit({ event: 'context-index-error', at: new Date().toISOString(), message: error.message }); }
      } while (dirty && !stopping);
    })();
    await active;
    active = null;
  }
  const schedule = (reason) => {
    if (stopping) return;
    clearTimeout(timer);
    timer = setTimeout(() => { void refresh(reason); }, debounceMs);
  };
  for (const name of ['raw', 'structured', 'incoming', 'attachments', 'output', 'exports', 'archive']) {
    try {
      const watcher = watch(path.join(root, name), { recursive: true }, (_event, filename) => {
        if (filename && String(filename).split(/[\\/]/).some((part) => ['.git', 'node_modules', '__pycache__'].includes(part))) return;
        schedule('source-change');
      });
      watcher.on('error', () => schedule('watcher-recovery'));
      watchers.push(watcher);
    } catch (error) { if (error.code !== 'ENOENT') emit({ event: 'context-index-watch-error', directory: name, message: error.message }); }
  }
  const periodic = setInterval(() => schedule('periodic-reconciliation'), intervalMs);
  async function stop() {
    if (stopping) return;
    stopping = true;
    clearTimeout(timer);
    clearInterval(periodic);
    for (const watcher of watchers) watcher.close();
    await active;
  }
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  // A hosting Node client can close its IPC channel to request graceful
  // shutdown on every platform. Windows child.kill() forcibly terminates the
  // process even for SIGTERM, so it cannot run the cleanup above.
  if (process.connected) process.once('disconnect', stop);
  await refresh('startup');
} else throw new Error('Choose refresh, query, status or watch.');
