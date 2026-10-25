import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { importOpenAIExport } from './import-openai-export.mjs';

const fixture = await mkdtemp(path.join(os.tmpdir(), 'personal-vault-openai-import-'));
const vault = path.join(fixture, 'vault');
const extracted = path.join(fixture, 'export');

function node(id, parent, role, text, time) {
  return { id, parent, children: [], message: { author: { role }, create_time: time, content: { content_type: 'text', parts: [text] } } };
}

const conversations = [
  {
    id: 'conversation-one', title: 'Trip ideas', create_time: 1761000000, update_time: 1761000100, current_node: 'a2',
    mapping: {
      root: { id: 'root', parent: null, children: ['u1'], message: null },
      u1: node('u1', 'root', 'user', 'Plan a quiet weekend.', 1761000001),
      a1: node('a1', 'u1', 'assistant', 'Discarded branch.', 1761000002),
      a2: node('a2', 'u1', 'assistant', 'Take the train to the coast.', 1761000003),
    },
  },
  {
    id: 'conversation-two', title: 'Trip ideas', create_time: 1761000000, update_time: 1761000200, current_node: 'b1',
    mapping: { b1: node('b1', null, 'user', 'A second conversation with the same title.', 1761000004) },
  },
];

try {
  await mkdir(vault, { recursive: true });
  await mkdir(extracted, { recursive: true });
  await writeFile(path.join(extracted, 'conversations.json'), JSON.stringify(conversations));

  const preview = await importOpenAIExport({ inputPath: extracted, vaultRoot: vault, dryRun: true });
  assert.equal(preview.imported, 2);
  await assert.rejects(readFile(path.join(vault, preview.files[0]), 'utf8'));

  const archive = path.join(fixture, 'openai-export.zip');
  await writeFile(archive, zipSync({ 'export/conversations.json': strToU8(JSON.stringify(conversations)) }));
  const result = await importOpenAIExport({ inputPath: archive, vaultRoot: vault });
  assert.equal(result.imported, 2);
  assert.equal(result.skipped, 0);
  assert.notEqual(result.files[0], result.files[1]);
  assert.match(result.files[0], /^raw\/2025\/10\/2025-10-20-openai-trip-ideas/);

  const first = await readFile(path.join(vault, result.files[0]), 'utf8');
  assert.match(first, /source: openai-export/);
  assert.match(first, /openai_conversation_id: "conversation-one"/);
  assert.match(first, /## You\n\nPlan a quiet weekend\./);
  assert.match(first, /## Assistant\n\nTake the train to the coast\./);
  assert.doesNotMatch(first, /Discarded branch/);

  const repeated = await importOpenAIExport({ inputPath: archive, vaultRoot: vault });
  assert.deepEqual({ imported: repeated.imported, skipped: repeated.skipped }, { imported: 0, skipped: 2 });
  console.log('OPENAI_IMPORT_OK: ZIP and folder input, readable Markdown, current branch, safe names, dry run and repeat import');
} finally {
  await rm(fixture, { recursive: true, force: true });
}
