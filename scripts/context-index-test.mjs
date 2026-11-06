import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, stat, rename, symlink, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { refreshContextIndex, getContext, indexStatus } from '../lib/context-index.mjs';

const sha = (s) => createHash('sha256').update(s).digest('hex');
async function fixture(run) {
  const root = await mkdtemp(path.join(tmpdir(), 'vault-context-index-test-'));
  const put = async (relative, text) => { const p = path.join(root, relative); await mkdir(path.dirname(p), { recursive: true }); await writeFile(p, text); };
  try { await run(root, put); } finally { await rm(root, { recursive: true, force: true }); }
}
async function rows(root) { return (await readFile(path.join(root, 'indexes/context-index/index.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse); }

test('reviewed intent preserves primary need versus optional expansion across paraphrases and scoped follow-ups', () => fixture(async (root, put) => {
  // Synthetic product evidence: aliases are authored data, not an engine
  // translation dictionary. This checks evidence available to an answer,
  // not an actual model invocation or automatic topic selection by a host.
  const original = '# Narration request\nМне не нравится мой голос и акцент. Перевод необязателен.\n';
  const brief = '# Current narration intent\nThe primary need is a chosen narration voice, even in one language.\n';
  const summary = 'Primary pain: dislike of recorded voice/accent/delivery, including one-language use. In this use case, retain a voice similar to the creator with their desired pronunciation. Optional expansion: two or three languages. Own media and story; face optional. Instagram is the primary channel with a short Reel; Facebook carries fuller commentary and narration. No proven integration, customer demand or permission to publish.';
  await put('raw/narration.md', original);
  await put('structured/intent.md', brief);
  await put('raw/diagnosis.md', '# Retrieval diagnosis\ncreator voice accent change own voice Instagram multilingual\n');
  await put('raw/unrelated.md', '# Unrelated\nWhere is the router? A voice interface has a pain point.\n');
  const annotation = { path: 'structured/intent.md', sourceSha256: sha(brief), contexts: ['creator.workflow'], currentFor: ['creator.workflow'], aliases: ['creator voice accent change own voice Instagram multilingual', 'акцент голос озвучка', 'where is the pain point', 'в чём проблема с голосом'], summary, reviewState: 'assistant-reviewed', provenance: { kind: 'fixture', evidence: 'raw/narration.md' } };
  await put('structured/assistant-infrastructure/context-annotations.jsonl', JSON.stringify(annotation) + '\n');
  await refreshContextIndex({ root });
  const queries = [
    { query: 'creator voice accent change own voice Instagram multilingual' },
    { query: 'акцент голос озвучка', contexts: ['creator.workflow'] },
    { query: 'where is the pain point?', contexts: ['creator.workflow'] },
    { query: 'в чём проблема с голосом?', contexts: ['creator.workflow'] },
  ];
  for (const query of queries) {
    const result = await getContext({ root, ...query, limit: 3 });
    assert.equal(result.results[0].path, 'structured/intent.md', query.query);
    assert.equal(result.results[0].contentSha256, sha(brief));
    assert.equal(result.results[0].summaries[0].summary, summary);
    assert.match(result.results[0].summaries[0].summary, /including one-language use.*voice similar to the creator.*Optional expansion.*face optional.*Instagram is the primary channel.*Facebook carries fuller commentary and narration.*No proven integration/s);
  }
  // Rebuild/resume uses the same authored correction; it is not a fresh-client
  // acceptance test, and original bytes must not be translated or replaced.
  await rm(path.join(root, 'indexes/context-index/index.jsonl'));
  await refreshContextIndex({ root });
  assert.equal((await getContext({ root, ...queries[3] })).results[0].summaries[0].summary, summary);
  assert.equal(await readFile(path.join(root, 'raw/narration.md'), 'utf8'), original);
  await put('structured/intent.md', '# Corrected intent\nThe first channel decision has changed; re-review required.\n');
  const stale = await getContext({ root, ...queries[3] });
  assert.ok(stale.warnings.some((warning) => warning.path === 'structured/intent.md' && warning.reason === 'source-changed'));
  assert.ok(!stale.results.some((item) => item.summaries.some((item) => item.summary === summary)));
}));

test('default passage retention recovers a mid-document correction, and an explicit cap reports its loss', () => fixture(async (root, put) => {
  // Synthetic long note: 96 routine paragraphs with one unique correction in the
  // middle. The old 32-passage default sampled the middle away, so a matching
  // source hash still could not reach the correction.
  const token = 'ZQ7CORRECTIONTOKEN';
  const total = 96;
  const at = 43;
  const paragraphs = [];
  for (let i = 0; i < total; i++) paragraphs.push(`Paragraph ${i + 1} records routine background detail for the historical review, numbered ${i + 1}.`);
  paragraphs[at] = `Paragraph ${at + 1} records the unique correction ${token}: the approved current scope is rebuildable indexing and model-independent retrieval, not a readable-files-only boundary.`;
  const note = `# Long synthetic review note\n\n${paragraphs.join('\n\n')}\n`;
  const relative = 'raw/2026/11/2026-11-07-long-note.md';
  await put(relative, note);

  // (1) An explicit 32-passage cap reproduces the old behaviour and must admit it.
  const capped = await refreshContextIndex({ root, maxPassagesPerFile: 32 });
  assert.equal(capped.counts.cappedFiles, 1);
  assert.ok(capped.counts.omittedPassages > 0);
  const cappedRow = (await rows(root)).find((row) => row.path === relative);
  assert.equal(cappedRow.passages.length, 32);
  assert.ok(!cappedRow.passages.some((passage) => passage.excerpt.includes(token)), 'a capped index cannot see the middle correction');
  const cappedQuery = await getContext({ root, query: token, limit: 5 });
  assert.equal(cappedQuery.results.length, 0);
  assert.equal(cappedQuery.passageCoverageComplete, false);

  // (2) The default keeps every computed passage, so the same source resolves.
  const rebuilt = await refreshContextIndex({ root });
  assert.ok(rebuilt.readFiles > 0, 'changed extractor settings must not reuse the capped cache');
  const row = (await rows(root)).find((item) => item.path === relative);
  assert.equal(row.passages.length, row.passageCount);
  assert.equal(row.omittedPassages, 0);
  const found = await getContext({ root, query: token, limit: 5 });
  assert.equal(found.results.length, 1);
  const [result] = found.results;
  assert.equal(result.path, relative);
  assert.equal(result.contentSha256, sha(note));
  assert.match(result.excerpt, new RegExp(token));
  assert.equal(result.freshness, 'verified');
  assert.equal(result.indexedSourceTruncated, false);
  // The stored range must contain the correction line, not merely the file head.
  const correctionLine = note.split('\n').findIndex((line) => line.includes(token)) + 1;
  assert.ok(result.locator.startLine <= correctionLine && correctionLine <= result.locator.endLine, `locator ${result.locator.startLine}-${result.locator.endLine} excludes line ${correctionLine}`);
  assert.equal(found.passageCoverageComplete, true);
  // Returning more evidence must not change the documented result shape.
  for (const key of ['path', 'contentSha256', 'locator', 'excerpt', 'excerptKind', 'excerptTruncated', 'freshness', 'score', 'matchedTerms', 'summaries', 'indexedSourceTruncated', 'contentMode']) assert.ok(key in result, `result must still expose ${key}`);
  assert.deepEqual(Object.keys(result.locator).sort(), ['endLine', 'heading', 'role', 'startLine']);

  // (3) An unchanged refresh reuses the cache and still resolves the correction.
  const reused = await refreshContextIndex({ root });
  assert.equal(reused.changed, false);
  assert.ok(reused.reusedFiles > 0);
  assert.equal((await getContext({ root, query: token, limit: 5 })).results[0].contentSha256, sha(note));

  // (4) A caller character budget still bounds the response without hiding the match.
  const bounded = await getContext({ root, query: token, limit: 5, maxChars: 120 });
  assert.ok(bounded.charactersReturned <= 120, `charactersReturned ${bounded.charactersReturned} exceeded maxChars`);
  assert.equal(bounded.results[0].path, relative);
  assert.equal(bounded.results[0].excerptTruncated, true);

  // (5) Lowering the excerpt limit loses text inside a stored passage, so coverage
  // must report that honestly instead of claiming complete passages.
  const shortExcerpts = await refreshContextIndex({ root, excerptChars: 80 });
  assert.ok(shortExcerpts.counts.excerptTruncatedPassages > 0);
  const shortQuery = await getContext({ root, query: token, limit: 5 });
  assert.equal(shortQuery.passageCoverageComplete, false);
  assert.equal(shortQuery.results[0].excerptTruncated, true);
  // The per-result flag must carry stored excerpt loss, not only whole-passage or
  // whole-file omission, or a caller would read a cut source as complete.
  assert.equal(shortQuery.results[0].indexedSourceTruncated, true);

  // (6) Metadata-only sources stay metadata-only and add no excerpt loss.
  const metadata = await refreshContextIndex({ root, excerptChars: 1600, metadataOnly: ['raw/2026/11'] });
  const metaRow = (await rows(root)).find((item) => item.path === relative);
  assert.equal(metaRow.contentMode, 'metadata-only');
  assert.deepEqual(metaRow.passages, []);
  assert.equal(metaRow.omittedPassages, 0);
  assert.equal(metadata.counts.excerptTruncatedPassages, 0);
  assert.equal(metadata.counts.metadataOnlyFiles, 1);
}));

test('mixed conversation retrieves precise passage and source revision', () => fixture(async (root, put) => {
  const text = '# Mixed conversation\n\n## 1. user — 2026-01-02\nPlease update the resume with verified architecture experience.\n\n## 2. user — 2026-01-03\nNow help with school riddles about animals.\n';
  await put('raw/2026/01/2026-01-02-conversation.md', text);
  await refreshContextIndex({ root });
  const r = await getContext({ root, query: 'school riddles' });
  assert.equal(r.status, 'ok'); assert.equal(r.results[0].contentSha256, sha(text));
  assert.match(r.results[0].excerpt, /school riddles/); assert.equal(r.results[0].locator.role, 'user');
  assert.ok(r.results[0].locator.startLine > 4); assert.equal(r.results[0].freshness, 'verified');
  assert.equal(r.results[0].sourceDate, '2026-01-02'); assert.equal(r.results[0].sourceDateBasis, 'filename-hint');
}));

test('many-to-many authored context and aliases survive rebuild; hints do not exclude other topics', () => fixture(async (root, put) => {
  const text = '# Current document\nConfirmed employment dates are retained in the editable source.\n';
  await put('structured/current.md', text);
  await put('raw/housing.md', '# Housing\nThe lease signature date is distinct from occupancy.\n');
  const a = { path: 'structured/current.md', sourceSha256: sha(text), contexts: ['career.cv', 'employment'], aliases: ['резюме'], summary: 'Editable resume source.', reviewState: 'assistant-reviewed', provenance: { author: 'assistant' }, currentFor: ['career.cv'] };
  const original = JSON.stringify(a) + '\n';
  await put('structured/assistant-infrastructure/context-annotations.jsonl', original);
  await refreshContextIndex({ root });
  const r = await getContext({ root, query: 'резюме' });
  assert.equal(r.results[0].path, 'structured/current.md'); assert.deepEqual(r.results[0].contexts, ['career.cv', 'employment']);
  assert.equal(r.results[0].summaries[0].reviewState, 'assistant-reviewed'); assert.deepEqual(r.results[0].summaries[0].currentFor, ['career.cv']);
  const cross = await getContext({ root, query: 'lease signature', contexts: ['career.cv'] });
  assert.ok(cross.results.some((x) => x.path === 'raw/housing.md'));
  await rm(path.join(root, 'indexes/context-index/index.jsonl')); await refreshContextIndex({ root });
  assert.equal(await readFile(path.join(root, 'structured/assistant-infrastructure/context-annotations.jsonl'), 'utf8'), original);
}));

test('external edit is detected on lookup; refresh invalidates old authored summary without rewriting it', () => fixture(async (root, put) => {
  const original = '# Resume\nUse the previous source.\n';
  await put('raw/resume.md', original);
  const annotations = JSON.stringify({ path: 'raw/resume.md', sourceSha256: sha(original), contexts: ['cv'], summary: 'Previous authored summary.' }) + '\n';
  await put('structured/assistant-infrastructure/context-annotations.jsonl', annotations);
  await refreshContextIndex({ root }); await put('raw/resume.md', '# Resume\nA corrected source now exists.\n');
  const stale = await getContext({ root, query: 'Resume' });
  assert.equal(stale.results.length, 0); assert.equal(stale.warnings[0].reason, 'source-changed');
  await refreshContextIndex({ root });
  const updated = await getContext({ root, query: 'Resume' });
  assert.ok(updated.results.length); assert.equal(updated.results[0].staleAnnotationCount, 1); assert.deepEqual(updated.results[0].summaries, []);
  assert.equal(await readFile(path.join(root, 'structured/assistant-infrastructure/context-annotations.jsonl'), 'utf8'), annotations);
}));

test('unchanged refresh reuses sources and does not rewrite the index', () => fixture(async (root, put) => {
  await put('raw/a.md', '# A\nA retained original.\n');
  const first = await refreshContextIndex({ root }); const index = path.join(root, first.indexPath);
  const before = await readFile(index, 'utf8'); const beforeStat = await stat(index);
  const again = await refreshContextIndex({ root });
  assert.equal(again.changed, false); assert.equal(again.reusedFiles, 1); assert.equal(again.readFiles, 0);
  assert.equal(await readFile(index, 'utf8'), before); assert.equal((await stat(index)).mtimeMs, beforeStat.mtimeMs);
}));

test('query limits, cursor validation and source truncation are explicit', () => fixture(async (root, put) => {
  for (let n = 0; n < 3; n++) await put(`raw/${n}.md`, `# Document ${n}\n\n` + Array.from({ length: 30 }, (_, i) => `## Topic ${i}\nresume passage ${i} ` + 'x'.repeat(100)).join('\n\n'));
  await refreshContextIndex({ root, maxPassagesPerFile: 4 });
  const r = await getContext({ root, query: 'resume', maxChars: 100, limit: 1 });
  assert.equal(r.results.length, 1); assert.ok(r.charactersReturned <= 100); assert.equal(r.truncated, true); assert.ok(r.nextCursor); assert.equal(r.passageCoverageComplete, false);
  const more = await getContext({ root, query: 'resume', maxChars: 100, limit: 1, cursor: r.nextCursor }); assert.equal(more.results.length, 1);
  await assert.rejects(() => getContext({ root, query: 'other', cursor: r.nextCursor }), /different query/);
}));

test('missing or corrupt index provides explicit fallback, never claims no memory exists', () => fixture(async (root, put) => {
  await put('raw/a.md', '# Original\nStill readable.\n');
  assert.equal((await indexStatus({ root })).status, 'missing');
  assert.equal((await getContext({ root, query: 'Original' })).status, 'missing-index');
  await put('indexes/context-index/index.jsonl', '{broken\n');
  assert.equal((await indexStatus({ root })).status, 'invalid');
  assert.equal((await getContext({ root, query: 'Original' })).status, 'invalid-index');
  assert.match(await readFile(path.join(root, 'raw/a.md'), 'utf8'), /Still readable/);
}));

test('failed subtree scan preserves prior sources as unverified; confirmed removal is reflected', () => fixture(async (root, put) => {
  await put('raw/a.md', '# First\nsource material\n'); await put('incoming/b.md', '# Second\nsource material\n');
  await refreshContextIndex({ root });
  await rename(path.join(root, 'raw'), path.join(root, 'held-raw')); await put('raw', 'not a folder');
  const partial = await refreshContextIndex({ root });
  // A source root changed into a regular file; descendants cannot be considered
  // successfully enumerated, so their previous records must not be discarded.
  assert.equal(partial.complete, false);
  assert.ok((await rows(root)).some((r) => r.path === 'raw/a.md' && r.scanStatus === 'unverified-after-scan-error'));
  await rm(path.join(root, 'raw')); await rename(path.join(root, 'held-raw'), path.join(root, 'raw')); await rm(path.join(root, 'incoming/b.md'));
  const final = await refreshContextIndex({ root }); assert.equal(final.complete, true);
  assert.ok(!(await rows(root)).some((r) => r.path === 'incoming/b.md'));
}));

test('symlinks, path escapes and technical files are not followed or indexed', () => fixture(async (root, put) => {
  await put('raw/a.md', '# Retained\nordinary source\n'); await put('raw/.env', 'Environment fixture must remain unindexed.');
  await put('raw/node_modules/pkg/a.md', 'not-indexed');
  const other = await mkdtemp(path.join(tmpdir(), 'vault-index-external-'));
  try {
    await writeFile(path.join(other, 'outside.md'), 'external original'); await symlink(path.join(other, 'outside.md'), path.join(root, 'raw/link.md'));
    await refreshContextIndex({ root }); const r = await rows(root);
    assert.ok(!r.some((x) => x.path?.includes('link.md') || x.path?.includes('.env') || x.path?.includes('node_modules')));
    await assert.rejects(() => refreshContextIndex({ root, sourceRoots: ['../outside'] }), /inside/);
    await assert.rejects(() => indexStatus({ root, indexDir: '../outside' }), /inside/);
  } finally { await rm(other, { recursive: true, force: true }); }
}));

test('attachment and owner-held content is metadata-only; archive lifecycle stays explicit', () => fixture(async (root, put) => {
  await put('raw/doc.md', '# Document\nVisible original.\n');
  await put('raw/doc.assets/attachment.txt', 'must not embed attachment contents');
  await put('raw/held.md', '# Held\nDo not process this body.\n');
  await put('archive/2026-01-01/raw/old.md', '# Archived source\nHistorical context.\n');
  const r = await refreshContextIndex({ root, metadataOnly: ['raw/held.md'] });
  assert.equal(r.counts.metadataOnlyFiles, 2);
  const records = await rows(root);
  for (const file of ['raw/doc.assets/attachment.txt', 'raw/held.md']) { const item = records.find((x) => x.path === file); assert.equal(item.contentMode, 'metadata-only'); assert.deepEqual(item.passages, []); }
  const archived = await getContext({ root, query: 'Archived' }); assert.equal(archived.results[0].lifecycle, 'archive');
}));

test('invalid annotation lines are reported and cannot erase authored corrections', () => fixture(async (root, put) => {
  await put('raw/doc.md', '# Original\nRetained original.\n'); const raw = '{broken\n';
  await put('structured/assistant-infrastructure/context-annotations.jsonl', raw);
  const r = await refreshContextIndex({ root }); assert.equal(r.complete, false); assert.equal(r.errors[0].line, 1);
  assert.equal(await readFile(path.join(root, 'structured/assistant-infrastructure/context-annotations.jsonl'), 'utf8'), raw);
}));

test('malformed annotation fields are reported without poisoning valid context responses', () => fixture(async (root, put) => {
  const source = '# Original\nSource material remains readable.\n';
  const annotationPath = 'structured/assistant-infrastructure/context-annotations.jsonl';
  await put('raw/doc.md', source);
  const base = { path: 'raw/doc.md', sourceSha256: sha(source), contexts: ['example'], summary: 'Valid interpretation.', reviewState: 'unreviewed', currentFor: ['example'] };
  const raw = [
    { ...base, reviewState: { invalid: 'type' } },
    { ...base, sourceSha256: 'not-a-hash' },
    { ...base, sourceHash: 42 },
    { ...base, currentFor: { invalid: 'type' } },
    base,
  ].map(JSON.stringify).join('\n') + '\n';
  await put(annotationPath, raw);
  const refreshed = await refreshContextIndex({ root });
  assert.equal(refreshed.complete, false);
  assert.deepEqual(refreshed.errors.map((error) => error.line), [1, 2, 3, 4]);
  const result = await getContext({ root, query: 'Original' });
  assert.equal(result.status, 'ok');
  assert.equal(result.coverageComplete, false);
  assert.equal(result.results[0].summaries.length, 1);
  assert.equal(result.results[0].summaries[0].reviewState, 'unreviewed');
  assert.deepEqual(result.results[0].summaries[0].currentFor, ['example']);
  assert.equal(await readFile(path.join(root, annotationPath), 'utf8'), raw);
  assert.equal(await readFile(path.join(root, 'raw/doc.md'), 'utf8'), source);
}));

test('dead-PID refresh lock recovers, but a live owner is not interrupted', () => fixture(async (root, put) => {
  await put('raw/doc.md', '# Original\nRetained original.\n');
  await put('indexes/context-index/refresh.lock/owner.json', JSON.stringify({ pid: 2147483647, startedAt: '2000-01-01T00:00:00Z' }));
  const recovered = await refreshContextIndex({ root }); assert.equal(recovered.counts.files, 1);
  await put('indexes/context-index/refresh.lock/owner.json', JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  await assert.rejects(() => refreshContextIndex({ root }), (e) => e.code === 'INDEX_BUSY');
  assert.equal(JSON.parse(await readFile(path.join(root, 'indexes/context-index/refresh.lock/owner.json'), 'utf8')).pid, process.pid);
}));

test('all matching passages remain available across pages while source groups stay diverse', () => fixture(async (root, put) => {
  await put('raw/long.md', Array.from({ length: 10 }, (_, n) => `## Episode ${n}\nneedle source passage ${n}\n`).join('\n'));
  await refreshContextIndex({ root, maxPassagesPerFile: 100 });
  const first = await getContext({ root, query: 'needle', limit: 8 });
  assert.equal(first.totalCandidates, 10); assert.equal(first.results.length, 8); assert.equal(first.truncated, true); assert.ok(first.nextCursor);
  const second = await getContext({ root, query: 'needle', limit: 8, cursor: first.nextCursor });
  assert.equal(second.results.length, 2); assert.equal(second.truncated, false); assert.equal(second.nextCursor, null);
  assert.equal(new Set([...first.results, ...second.results].map((r) => r.locator.startLine)).size, 10);
  await put('incoming/short.md', '# Other source\nneedle from another source\n'); await refreshContextIndex({ root, maxPassagesPerFile: 100 });
  const diverse = await getContext({ root, query: 'needle', limit: 2 }); assert.equal(new Set(diverse.results.map((r) => r.path)).size, 2);
}));

test('modern importer You role is identified as user', () => fixture(async (root, put) => {
  await put('raw/import.md', '# Conversation\n\n## You\nPlease keep the source wording.\n\n## Assistant\nA proposed response.\n');
  await refreshContextIndex({ root }); const result = await getContext({ root, query: 'source wording' });
  assert.equal(result.results[0].locator.role, 'user');
}));

test('explicit currentFor declaration beats a newer dated snapshot for the matching context', () => fixture(async (root, put) => {
  const current = '# Current CV source\nAn explicitly selected document.\n';
  const historical = '# Current CV snapshot — 2020-01-01\nA historical document retained as evidence.\n';
  await put('structured/current.md', current); await put('raw/2020-01-01-cv-snapshot.md', historical);
  await utimes(path.join(root, 'structured/current.md'), new Date('2020-01-01'), new Date('2020-01-01'));
  await utimes(path.join(root, 'raw/2020-01-01-cv-snapshot.md'), new Date('2026-01-01'), new Date('2026-01-01'));
  await put('structured/assistant-infrastructure/context-annotations.jsonl', [
    { path: 'structured/current.md', sourceSha256: sha(current), contexts: ['career.cv'], currentFor: ['career.cv'], reviewState: 'assistant-reviewed' },
    { path: 'raw/2020-01-01-cv-snapshot.md', sourceSha256: sha(historical), contexts: ['career.cv'] },
  ].map(JSON.stringify).join('\n') + '\n');
  await refreshContextIndex({ root }); const result = await getContext({ root, query: 'CV', contexts: ['career.cv'], limit: 1 });
  assert.equal(result.results[0].path, 'structured/current.md');
  assert.equal(result.results[0].summaries[0].reviewState, 'assistant-reviewed');
}));

test('annotation edits withdraw old summaries, aliases and current ranking before refresh', () => fixture(async (root, put) => {
  const text = '# Resume\nUnchanged source material.\n';
  const annotationPath = 'structured/assistant-infrastructure/context-annotations.jsonl';
  await put('structured/selected.md', text); await put('raw/newer.md', text);
  await utimes(path.join(root, 'structured/selected.md'), new Date('2020-01-01'), new Date('2020-01-01'));
  await utimes(path.join(root, 'raw/newer.md'), new Date('2026-01-01'), new Date('2026-01-01'));
  const original = { path: 'structured/selected.md', sourceSha256: sha(text), contexts: ['career.cv'], aliases: ['ObsoleteAlias'], summary: 'Old authored interpretation.', currentFor: ['career.cv'] };
  await put(annotationPath, JSON.stringify(original) + '\n'); await refreshContextIndex({ root });
  const before = await getContext({ root, query: 'Resume', contexts: ['career.cv'], limit: 1 });
  assert.equal(before.results[0].path, original.path); assert.equal(before.annotationsFreshness, 'verified'); assert.ok(before.nextCursor);
  await put(annotationPath, JSON.stringify({ ...original, summary: 'Corrected authored interpretation.', currentFor: [], aliases: [] }) + '\n');
  const edited = await getContext({ root, query: 'Resume', contexts: ['career.cv'] });
  assert.equal(edited.annotationsFreshness, 'annotations-changed');
  assert.ok(edited.warnings.some((w) => w.path === annotationPath && w.reason === 'annotations-changed'));
  assert.equal(edited.results[0].path, 'raw/newer.md');
  const selected = edited.results.find((r) => r.path === original.path);
  assert.deepEqual(selected.summaries, []); assert.deepEqual(selected.contexts, []); assert.equal(selected.freshness, 'verified'); assert.equal(selected.staleAnnotationCount, 1);
  assert.equal((await getContext({ root, query: 'ObsoleteAlias' })).totalCandidates, 0);
  await assert.rejects(() => getContext({ root, query: 'Resume', contexts: ['career.cv'], limit: 1, cursor: before.nextCursor }), /stale/);
  await refreshContextIndex({ root }); const refreshed = await getContext({ root, query: 'Resume', contexts: ['career.cv'] });
  assert.equal(refreshed.annotationsFreshness, 'verified');
  assert.equal(refreshed.results.find((r) => r.path === original.path).summaries[0].summary, 'Corrected authored interpretation.');
  await rm(path.join(root, annotationPath));
  const removed = await getContext({ root, query: 'Resume' });
  assert.equal(removed.annotationsFreshness, 'annotations-changed'); assert.ok(removed.results.every((r) => !r.summaries.length));
  assert.equal(await readFile(path.join(root, original.path), 'utf8'), text);
}));

test('lookup checks the annotation source recorded by a custom-path index', () => fixture(async (root, put) => {
  const text = '# Source\nOriginal context.\n'; const annotationsPath = 'structured/custom-labels.jsonl';
  await put('raw/source.md', text);
  await put(annotationsPath, JSON.stringify({ path: 'raw/source.md', sourceSha256: sha(text), contexts: ['example'], summary: 'Authored context.' }) + '\n');
  await refreshContextIndex({ root, annotationsPath });
  const result = await getContext({ root, query: 'Source' });
  assert.equal(result.annotationsFreshness, 'verified'); assert.equal(result.results[0].summaries[0].summary, 'Authored context.');
}));

test('context and current declarations cannot crowd out lexical evidence or match a substring', () => fixture(async (root, put) => {
  const cv = '# Resume profile\nA selected career checkpoint.\n';
  await put('structured/resume-profile.md', cv);
  await put('raw/housing/lease-signature.md', '# Housing record\nThe lease signature date is distinct from occupancy.\n');
  await put('raw/releases.md', '# Release notes\nThe release is ready for distribution.\n');
  await put('structured/assistant-infrastructure/context-annotations.jsonl', JSON.stringify({ path: 'structured/resume-profile.md', sourceSha256: sha(cv), contexts: ['career.cv'], currentFor: ['career.cv'], summary: 'Current resume profile.' }) + '\n');
  await refreshContextIndex({ root });
  const result = await getContext({ root, query: 'lease signature', contexts: ['career.cv'], limit: 4 });
  assert.ok(result.results.length); assert.ok(result.results.every((r) => r.path === 'raw/housing/lease-signature.md'));
  assert.ok(result.results.some((r) => r.matchedTerms.includes('lease') && r.matchedTerms.includes('signature')));
  const hint = await getContext({ root, contexts: ['career.cv'], limit: 1 });
  assert.equal(hint.results[0].path, 'structured/resume-profile.md');
  const exact = await getContext({ root, query: 'lease' }); assert.ok(exact.results.every((r) => r.path !== 'raw/releases.md'));
  const filename = await getContext({ root, query: 'resume profile' }); assert.equal(filename.results[0].path, 'structured/resume-profile.md');
}));
