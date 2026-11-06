// A readable, disposable lookup index. Original files and authored annotations
// remain authoritative. This module does not call a model or decide facts.
import { createReadStream } from 'node:fs';
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import path from 'node:path';

const VERSION = 1;
const DEFAULT_ROOTS = ['raw', 'structured', 'incoming', 'attachments', 'output', 'exports', 'archive'];
const DEFAULT_INDEX = 'indexes/context-index';
const DEFAULT_ANNOTATIONS = 'structured/assistant-infrastructure/context-annotations.jsonl';
const TEXT = new Set(['.md', '.txt']);
const EXCLUDED = new Set(['node_modules', '.git', '.trash', '.next', '__pycache__', 'tmp', 'logs', 'config', 'indexes']);
const digest = (value) => createHash('sha256').update(value).digest('hex');
const inside = (file, prefix) => file === prefix || file.startsWith(`${prefix}/`);
const words = (value) => [...new Set(String(value).normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu) || [])];
const integer = (value, fallback, min, max) => value === undefined ? fallback : Number.isInteger(value) && value >= min && value <= max ? value : (() => { throw new Error(`Expected an integer from ${min} to ${max}.`); })();

function clean(value) {
  if (typeof value !== 'string' || !value || value.includes('\0') || path.isAbsolute(value)) throw new Error('Choose a Vault-relative path.');
  const result = value.replaceAll('\\', '/').replace(/^\.\//, '');
  if (result.split('/').some((part) => part === '..' || !part)) throw new Error('Path must stay inside the Vault.');
  return result;
}

async function environment({ root, indexDir = DEFAULT_INDEX, annotationsPath = DEFAULT_ANNOTATIONS } = {}) {
  if (!root) throw new Error('A Vault root is required.');
  const base = await realpath(root);
  if (!(await stat(base)).isDirectory()) throw new Error('The Vault root is not a folder.');
  const resolve = async (relative) => {
    const normalized = clean(relative);
    let target = base;
    for (const component of normalized.split('/')) {
      target = path.join(target, component);
      try { if ((await lstat(target)).isSymbolicLink()) throw new Error('Symbolic links are not supported in an index path.'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    return target;
  };
  return { base, resolve, indexDir: clean(indexDir), annotationsPath: clean(annotationsPath), indexFile: await resolve(`${clean(indexDir)}/index.jsonl`) };
}

async function load(env) {
  let text;
  try { text = await readFile(env.indexFile, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  const rows = text.split('\n').filter(Boolean).map((line) => JSON.parse(line));
  const header = rows.shift();
  const strings = (value) => Array.isArray(value) && value.every((item) => typeof item === 'string');
  const validSource = (row) => row.recordType === 'source' && typeof row.path === 'string' && /^[a-f0-9]{64}$/.test(row.contentSha256) && typeof row.title === 'string' && typeof row.modifiedAt === 'string' && strings(row.contexts) && strings(row.annotationContexts) && Array.isArray(row.passages) && row.passages.every((p) => typeof p.excerpt === 'string' && typeof p.heading === 'string' && strings(p.terms));
  if (header?.recordType !== 'manifest' || header.schemaVersion !== VERSION || rows.some((row) => !validSource(row))) throw new Error('Unsupported or incomplete context index.');
  if (header.counts?.files !== rows.length || digest(JSON.stringify(rows)) !== header.contentDigest) throw new Error('Context index integrity check failed.');
  return { header, rows };
}

async function content(file, textLimit = 0) {
  const h = createHash('sha256');
  const kept = [];
  let size = 0;
  let stored = 0;
  for await (const chunk of createReadStream(file)) {
    h.update(chunk); size += chunk.length;
    if (stored < textLimit) { const part = chunk.subarray(0, textLimit - stored); kept.push(part); stored += part.length; }
  }
  return { sha256: h.digest('hex'), size, text: Buffer.concat(kept).toString('utf8'), textTruncated: size > textLimit };
}

function extract(text, maxPassages, excerptChars) {
  const lines = text.split(/\r?\n/);
  const metadata = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text)?.[1] || '';
  const title = /^title:\s*["']?(.+?)["']?\s*$/m.exec(metadata)?.[1] || /^#\s+(.+)$/m.exec(text)?.[1] || '';
  const date = /^(?:created|date):\s*["']?(\d{4}-\d{2}-\d{2})/m.exec(metadata)?.[1] || null;
  const contexts = [];
  for (const match of metadata.matchAll(/^(?:project|topics|contexts):\s*(.+)$/gm)) contexts.push(...match[1].replace(/[\[\]"']/g, '').split(',').map((v) => v.trim()).filter(Boolean));
  const all = [];
  let heading = '';
  let role = null;
  let block = [];
  let from = 1;
  function flush(last) {
    const full = block.join('\n').trim();
    if (full) {
      const terms = words(full).filter((w) => w.length > 2).slice(0, 24);
      all.push({ startLine: from, endLine: last, heading, role, excerpt: full.slice(0, excerptChars), excerptTruncated: full.length > excerptChars, terms });
    }
    block = [];
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const h = /^(#{1,6})\s+(.+)$/.exec(line);
    if (h) {
      flush(i); heading = h[2];
      const r = /(?:^|\b)(user|you|assistant|system|developer)(?:\b|\s*[—:])/i.exec(h[2]);
      role = r ? r[1].toLowerCase() === 'you' ? 'user' : r[1].toLowerCase() : role;
      from = i + 1;
    }
    if (!block.length) from = i + 1;
    block.push(line);
    if (!line.trim() || block.join('\n').length >= 1600) flush(i + 1);
  }
  flush(lines.length);
  // For long files, retain a spread across the source, including its end. The
  // omitted count is explicit; this is not a complete full-text search engine.
  const selected = all.length <= maxPassages ? all : Array.from({ length: maxPassages }, (_, i) => all[Math.floor(i * (all.length - 1) / (maxPassages - 1))]);
  return { title, sourceDate: date, contexts: [...new Set(contexts)], passages: selected, passageCount: all.length, omittedPassages: all.length - selected.length };
}

async function annotations(env) {
  let raw;
  try { raw = await readFile(await env.resolve(env.annotationsPath), 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return { rows: [], hash: null, errors: [] }; throw error; }
  const rows = [], errors = [];
  for (const [i, line] of raw.split('\n').entries()) {
    if (!line.trim()) continue;
    try {
      const item = JSON.parse(line);
      clean(item.path);
      if (item.contexts !== undefined && (!Array.isArray(item.contexts) || item.contexts.some((v) => typeof v !== 'string'))) throw new Error('contexts must contain strings');
      if (item.aliases !== undefined && (!Array.isArray(item.aliases) || item.aliases.some((v) => typeof v !== 'string'))) throw new Error('aliases must contain strings');
      if (item.summary !== undefined && (typeof item.summary !== 'string' || item.summary.length > 12000)) throw new Error('summary must be text of at most 12000 characters');
      if (item.reviewState !== undefined && typeof item.reviewState !== 'string') throw new Error('reviewState must be text');
      for (const field of ['sourceSha256', 'sourceHash']) {
        if (item[field] !== undefined && (typeof item[field] !== 'string' || !/^[a-f0-9]{64}$/.test(item[field]))) throw new Error(`${field} must be a lowercase SHA-256 hash`);
      }
      if (item.currentFor !== undefined && typeof item.currentFor !== 'string' && (!Array.isArray(item.currentFor) || item.currentFor.some((v) => typeof v !== 'string'))) throw new Error('currentFor must be text or an array of strings');
      rows.push(item);
    } catch (error) { errors.push({ path: env.annotationsPath, line: i + 1, reason: error.message }); }
  }
  return { rows, hash: digest(raw), errors };
}

async function acquireLock(lock) {
  const busy = () => Object.assign(new Error('A context-index refresh is already running; inspect refresh.lock if an earlier process stopped.'), { code: 'INDEX_BUSY' });
  try { await mkdir(lock, { mode: 0o700 }); return; }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  // A private recovery directory serialises reclaim attempts. Never reclaim a
  // live PID, an unreadable owner file, or an unfamiliar ownership/format.
  const recovery = `${lock}.recovery`;
  try { await mkdir(recovery, { mode: 0o700 }); }
  catch (error) { if (error.code === 'EEXIST') throw busy(); throw error; }
  try {
    const ownerPath = path.join(lock, 'owner.json');
    let owner, metadata;
    try {
      metadata = await lstat(ownerPath);
      if (!metadata.isFile() || metadata.isSymbolicLink() || (process.getuid && metadata.uid !== process.getuid())) throw busy();
      owner = JSON.parse(await readFile(ownerPath, 'utf8'));
    } catch (error) { if (error.code === 'INDEX_BUSY') throw error; throw busy(); }
    if (!Number.isInteger(owner.pid) || owner.pid <= 0) throw busy();
    try { process.kill(owner.pid, 0); throw busy(); }
    catch (error) { if (error.code !== 'ESRCH') throw busy(); }
    // A second check avoids deleting a newly replaced owner during recovery.
    const checked = await lstat(ownerPath);
    if (checked.ino !== metadata.ino || checked.mtimeMs !== metadata.mtimeMs) throw busy();
    await rm(lock, { recursive: true });
    try { await mkdir(lock, { mode: 0o700 }); }
    catch (error) { if (error.code === 'EEXIST') throw busy(); throw error; }
  } finally { await rm(recovery, { recursive: true, force: true }); }
}

/** Refresh only derived files. Authored context annotations are read, never rewritten. */
export async function refreshContextIndex(options = {}) {
  const env = await environment(options);
  const sourceRoots = [...new Set((options.sourceRoots || DEFAULT_ROOTS).map(clean))];
  if (!sourceRoots.length) throw new Error('Choose at least one source root.');
  const metadataOnly = (options.metadataOnly || []).map(clean);
  const maxTextBytes = integer(options.maxTextBytes, 4 * 1024 * 1024, 1024, 32 * 1024 * 1024);
  const maxPassages = integer(options.maxPassagesPerFile, 32, 2, 1000);
  const excerptChars = integer(options.excerptChars, 300, 80, 4000);
  const verifyAfterMs = integer(options.verifyAfterMs, 3600000, 0, 7 * 86400000);
  const now = new Date();
  await mkdir(await env.resolve(env.indexDir), { recursive: true, mode: 0o700 });
  const lock = await env.resolve(`${env.indexDir}/refresh.lock`);
  await acquireLock(lock);
  let temporary;
  try {
    await writeFile(path.join(lock, 'owner.json'), JSON.stringify({ pid: process.pid, startedAt: now.toISOString() }), { flag: 'wx', mode: 0o600 });
    const previous = await load(env).catch(() => null);
    const prior = new Map((previous?.rows || []).map((row) => [row.path, row]));
    const notes = await annotations(env);
    const errors = [...notes.errors], rows = [], skipped = [], scannedRoots = [];
    const settings = { extractorVersion: 1, sourceRoots, metadataOnly, maxTextBytes, maxPassages, excerptChars, annotationsPath: env.annotationsPath };
    const configurationHash = digest(JSON.stringify(settings));
    let readFiles = 0, reusedFiles = 0;
    function excluded(relative) {
      const parts = relative.split('/');
      return parts.some((part) => part.startsWith('.') || EXCLUDED.has(part)) || /(?:^|\/)(?:id_rsa|id_ed25519|credentials|secrets?)(?:\.|$)/i.test(relative) || relative === env.annotationsPath || inside(relative, env.indexDir);
    }
    async function visit(relative) {
      if (excluded(relative)) return;
      let file, s;
      try {
        file = await env.resolve(relative); s = await lstat(file);
        if (s.isSymbolicLink()) { skipped.push({ path: relative, reason: 'symbolic-link' }); return; }
        if (s.isDirectory()) {
          const entries = (await readdir(file)).sort();
          for (const entry of entries) await visit(`${relative}/${entry}`);
          return;
        }
        if (!s.isFile()) return;
        if (sourceRoots.includes(relative) && [...prior.keys()].some((p) => p.startsWith(`${relative}/`))) throw new Error('A previously indexed source folder is no longer a directory.');
        const old = prior.get(relative);
        const metadata = metadataOnly.some((p) => inside(relative, p)) || relative.split('/').some((p) => p.endsWith('.assets')) || !TEXT.has(path.extname(relative).toLowerCase());
        const same = old && previous.header.configurationHash === configurationHash && old.sizeBytes === s.size && old.modifiedAt === s.mtime.toISOString() && old.changedAt === s.ctime.toISOString() && old.contentMode === (metadata ? 'metadata-only' : 'extractive-text');
        if (same && now - new Date(old.verifiedAt) < verifyAfterMs) { const reused = { ...old }; delete reused.scanStatus; rows.push(reused); reusedFiles++; return; }
        const material = await content(file, metadata ? 0 : maxTextBytes);
        // Do not publish offsets/hash from two different revisions.
        const after = await stat(file);
        if (after.size !== s.size || after.mtimeMs !== s.mtimeMs || after.ctimeMs !== s.ctimeMs) throw new Error('Source changed during indexing; retry on a later refresh.');
        const text = metadata ? { title: path.basename(relative), sourceDate: null, contexts: [], passages: [], passageCount: 0, omittedPassages: 0 } : extract(material.text, maxPassages, excerptChars);
        rows.push({ recordType: 'source', path: relative, contentSha256: material.sha256, sizeBytes: s.size, modifiedAt: s.mtime.toISOString(), changedAt: s.ctime.toISOString(), firstIndexedAt: old?.firstIndexedAt || now.toISOString(), verifiedAt: now.toISOString(), contentMode: metadata ? 'metadata-only' : 'extractive-text', metadataOnlyReason: metadata ? metadataOnly.some((p) => inside(relative, p)) ? 'owner-configured' : relative.split('/').some((p) => p.endsWith('.assets')) ? 'attachment' : 'unsupported-text-format' : null, lifecycle: relative.startsWith('archive/') ? 'archive' : 'active', ...text, sourceDateBasis: text.sourceDate ? 'source-metadata' : 'filename-hint', sourceDate: text.sourceDate || /(?:^|\/)(\d{4}-\d{2}-\d{2})/.exec(relative)?.[1] || null, textTruncated: !metadata && material.textTruncated });
        readFiles++;
      } catch (error) {
        if (error.code === 'ENOENT' && sourceRoots.includes(relative) && ![...prior.keys()].some((p) => inside(p, relative))) return;
        errors.push({ path: relative, reason: error.code || error.message });
      }
    }
    for (const sourceRoot of sourceRoots) { await visit(sourceRoot); scannedRoots.push(sourceRoot); }
    // An incomplete subtree must not turn yesterday's sources into deletions.
    for (const old of prior.values()) if (!rows.some((row) => row.path === old.path) && errors.some((e) => inside(old.path, e.path))) rows.push({ ...old, scanStatus: 'unverified-after-scan-error' });
    for (let i = 0; i < rows.length; i++) {
      const source = { ...rows[i] }; delete source.annotations; delete source.annotationContexts;
      const attached = notes.rows.filter((item) => item.path === source.path).map((item) => ({ ...item, status: (item.sourceSha256 || item.sourceHash) === source.contentSha256 ? 'source-matched' : 'stale-or-unverified' }));
      if (attached.length) source.annotations = attached;
      source.annotationContexts = [...new Set(attached.filter((item) => item.status === 'source-matched').flatMap((item) => item.contexts || []))];
      rows[i] = source;
    }
    rows.sort((a, b) => a.path.localeCompare(b.path));
    const contentDigest = digest(JSON.stringify(rows));
    const unchanged = previous?.header.contentDigest === contentDigest && JSON.stringify(previous.header.errors) === JSON.stringify(errors) && previous.header.annotationsHash === notes.hash && previous.header.configurationHash === configurationHash;
    if (unchanged) return { changed: false, ...previous.header, readFiles, reusedFiles, indexPath: `${env.indexDir}/index.jsonl` };
    const counts = { files: rows.length, textFiles: rows.filter((r) => r.contentMode === 'extractive-text').length, metadataOnlyFiles: rows.filter((r) => r.contentMode === 'metadata-only').length, passages: rows.reduce((n, r) => n + r.passages.length, 0), omittedPassages: rows.reduce((n, r) => n + r.omittedPassages, 0), textTruncatedFiles: rows.filter((r) => r.textTruncated).length, staleAnnotations: rows.reduce((n, r) => n + (r.annotations || []).filter((a) => a.status !== 'source-matched').length, 0), removedFiles: [...prior.keys()].filter((p) => !rows.some((r) => r.path === p)).length };
    const header = { recordType: 'manifest', schemaVersion: VERSION, indexRevision: contentDigest.slice(0, 20), contentDigest, builtAt: now.toISOString(), configurationHash, annotationsPath: env.annotationsPath, annotationsHash: notes.hash, complete: errors.length === 0, sourceRoots, metadataOnly, counts, errors, skipped, limitations: ['Excerpts and keyword terms are extractive navigation, not factual or exhaustive summaries.', 'Long text and passage counts are bounded; broad search or original-file reading remains available.', 'Authored context annotations are stored separately and are never deleted by refresh.', 'Attachment bytes are hashed and inventoried, not parsed or sent to a model.'] };
    temporary = `${env.indexFile}.${process.pid}.${randomBytes(5).toString('hex')}.tmp`;
    await writeFile(temporary, [header, ...rows].map((row) => JSON.stringify(row)).join('\n') + '\n', { flag: 'wx', mode: 0o600 });
    await rename(temporary, env.indexFile); temporary = null;
    return { changed: true, ...header, readFiles, reusedFiles, indexPath: `${env.indexDir}/index.jsonl` };
  } finally {
    if (temporary) await rm(temporary, { force: true }).catch(() => {});
    await rm(lock, { recursive: true, force: true });
  }
}

/** Read index coverage without claiming a scan is equivalent to factual review. */
export async function indexStatus(options = {}) {
  const env = await environment(options);
  try {
    const index = await load(env);
    return index ? { status: index.header.complete ? 'available' : 'incomplete', ...index.header, indexPath: `${env.indexDir}/index.jsonl` } : { status: 'missing', schemaVersion: VERSION, indexPath: `${env.indexDir}/index.jsonl`, fallback: 'Use ordinary Vault file listing/search/read, or refresh the index.' };
  } catch (error) { return { status: 'invalid', reason: error.message, fallback: 'Original files remain readable; rebuild the derived index.' }; }
}

/** Context hints boost relevance; they never deny broader source discovery. */
export async function getContext(options = {}) {
  const env = await environment(options);
  const limit = integer(options.limit, 8, 1, 100);
  const maxChars = integer(options.maxChars, 12000, 100, 100000);
  const query = String(options.query || '').trim();
  const contexts = options.contexts || [];
  if (!Array.isArray(contexts) || contexts.some((v) => typeof v !== 'string')) throw new Error('contexts must contain strings.');
  let index;
  try { index = await load(env); }
  catch (error) { return { status: 'invalid-index', reason: error.message, results: [], fallback: 'Use ordinary full-text search/read or refresh the derived index.' }; }
  if (!index) return { status: 'missing-index', results: [], fallback: 'Use ordinary full-text search/read or refresh the derived index.' };
  const annotationPath = options.annotationsPath || index.header.annotationsPath || env.annotationsPath;
  const warnings = [];
  let annotationHash = null, annotationsFreshness = 'verified';
  try { annotationHash = (await content(await env.resolve(annotationPath))).sha256; }
  catch (error) { if (error.code !== 'ENOENT') annotationsFreshness = 'annotations-unavailable'; }
  if (annotationsFreshness === 'verified' && annotationHash !== index.header.annotationsHash) annotationsFreshness = 'annotations-changed';
  if (annotationsFreshness !== 'verified') warnings.push({ path: annotationPath, reason: annotationsFreshness });
  // Annotation edits can change meaning without touching an original. Check
  // their hash once per lookup before using stored summaries or ranking hints.
  const matchedAnnotations = (source) => annotationsFreshness === 'verified' ? (source.annotations || []).filter((a) => a.status === 'source-matched') : [];
  const sourceLabels = (source) => [...source.contexts, ...(annotationsFreshness === 'verified' ? source.annotationContexts || [] : [])];
  const request = digest(JSON.stringify({ query, contexts, annotationHash, annotationsFreshness }));
  const terms = words(query);
  const desired = contexts.map((c) => c.toLowerCase());
  const candidates = [];
  for (const source of index.rows) {
    const labels = sourceLabels(source);
    const contextScore = desired.reduce((n, hint) => n + (labels.some((label) => label.toLowerCase() === hint || label.toLowerCase().startsWith(`${hint}.`)) ? 6 : 0), 0);
    const current = matchedAnnotations(source);
    const currentFor = current.flatMap((a) => typeof a.currentFor === 'string' ? [a.currentFor] : Array.isArray(a.currentFor) ? a.currentFor.filter((v) => typeof v === 'string') : []);
    const currentScore = currentFor.some((label) => {
      const lower = label.toLowerCase();
      return desired.some((hint) => lower === hint || lower.startsWith(`${hint}.`) || hint.startsWith(`${lower}.`)) || terms.some((term) => words(lower.replaceAll('.', ' ')).includes(term));
    }) ? 18 : 0;
    const description = new Set(words(`${source.path} ${source.title} ${labels.join(' ')} ${current.map((a) => `${a.summary || ''} ${(a.aliases || []).join(' ')}`).join(' ')}`));
    const topScore = terms.reduce((n, t) => n + (description.has(t) ? 4 : 0), 0);
    const passages = source.passages.length ? source.passages : [{ startLine: null, endLine: null, heading: '', role: null, excerpt: '', terms: [] }];
    for (const passage of passages) {
      const body = new Set(words(`${passage.heading} ${passage.excerpt} ${passage.terms.join(' ')}`));
      const matchedTerms = terms.filter((term) => body.has(term));
      // Context and current-source declarations refine relevant matches; they
      // must not manufacture a match for an unrelated nonempty query.
      if (terms.length && !topScore && !matchedTerms.length) continue;
      const score = topScore + matchedTerms.length * 3 + contextScore + currentScore;
      if (score || (!terms.length && !desired.length)) candidates.push({ source, passage, score, matchedTerms });
    }
  }
  const compare = (a, b) => b.score - a.score || b.source.modifiedAt.localeCompare(a.source.modifiedAt) || a.source.path.localeCompare(b.source.path) || (a.passage.startLine || 0) - (b.passage.startLine || 0);
  candidates.sort(compare);
  // Interleave ranked source groups instead of discarding a source's later
  // matches. Initial results remain diverse; every match remains pageable.
  const groups = new Map();
  for (const candidate of candidates) {
    if (!groups.has(candidate.source.path)) groups.set(candidate.source.path, []);
    groups.get(candidate.source.path).push(candidate);
  }
  const rankedGroups = [...groups.values()].sort((a, b) => compare(a[0], b[0]));
  const interleaved = [];
  for (let round = 0; interleaved.length < candidates.length; round++) {
    for (const group of rankedGroups) if (group[round]) interleaved.push(group[round]);
  }
  candidates.length = 0;
  for (const candidate of interleaved) candidates.push(candidate);
  let offset = 0;
  if (options.cursor) {
    let decoded;
    try { decoded = JSON.parse(Buffer.from(options.cursor, 'base64url').toString()); } catch { throw new Error('Invalid context cursor.'); }
    if (decoded.revision !== index.header.indexRevision || decoded.request !== request || !Number.isInteger(decoded.offset) || decoded.offset < 0) throw new Error('Context cursor is stale or belongs to a different query.');
    offset = decoded.offset;
  }
  const results = [], checked = new Map();
  let used = 0, cursorAt = offset;
  for (let i = offset; i < candidates.length && results.length < limit; i++) {
    const { source, passage, score, matchedTerms } = candidates[i];
    cursorAt = i + 1;
    if (!checked.has(source.path)) {
      try {
        const current = await content(await env.resolve(source.path));
        checked.set(source.path, current.sha256 === source.contentSha256 ? 'verified' : 'source-changed');
      } catch (error) { checked.set(source.path, error.code === 'ENOENT' ? 'source-missing' : 'source-unavailable'); }
    }
    const freshness = checked.get(source.path);
    if (freshness !== 'verified') { warnings.push({ path: source.path, reason: freshness }); continue; }
    const summaries = matchedAnnotations(source).map((a) => ({ summary: a.summary || null, contexts: a.contexts || [], provenance: a.provenance || null, reviewState: a.reviewState || 'unreviewed', status: 'source-matched', currentFor: a.currentFor || null, supersedes: a.supersedes || null, submittedEvidence: a.submittedEvidence || null }));
    let excerpt = passage.excerpt;
    const summaryChars = summaries.reduce((n, a) => n + (a.summary?.length || 0), 0);
    const remaining = maxChars - used;
    if (remaining <= 0) { cursorAt = i; break; }
    const boundedSummaries = summaries.map((a) => ({ ...a, summary: a.summary?.slice(0, Math.min(2000, remaining)) || null }));
    // The character budget bounds returned human-readable context, not JSON keys.
    let consumed = 0;
    for (const a of boundedSummaries) { if (a.summary) { a.summary = a.summary.slice(0, Math.max(0, remaining - consumed)); consumed += a.summary.length; } }
    excerpt = excerpt.slice(0, Math.max(0, remaining - consumed)); consumed += excerpt.length;
    used += consumed;
    results.push({ path: source.path, contentSha256: source.contentSha256, sourceDate: source.sourceDate, sourceDateBasis: source.sourceDateBasis, modifiedAt: source.modifiedAt, lifecycle: source.lifecycle, contentMode: source.contentMode, title: source.title, contexts: sourceLabels(source), locator: { startLine: passage.startLine, endLine: passage.endLine, heading: passage.heading, role: passage.role }, excerpt, excerptKind: 'extractive', excerptTruncated: Boolean(passage.excerptTruncated || excerpt.length < passage.excerpt.length), summaries: boundedSummaries, summaryTruncated: summaryChars > boundedSummaries.reduce((n, a) => n + (a.summary?.length || 0), 0), staleAnnotationCount: (source.annotations || []).filter((a) => annotationsFreshness !== 'verified' || a.status !== 'source-matched').length, indexedSourceTruncated: Boolean(source.textTruncated || source.omittedPassages), freshness, score, matchedTerms });
  }
  const truncated = cursorAt < candidates.length;
  const nextCursor = truncated ? Buffer.from(JSON.stringify({ revision: index.header.indexRevision, request, offset: cursorAt })).toString('base64url') : null;
  return { status: 'ok', query, contexts, indexRevision: index.header.indexRevision, builtAt: index.header.builtAt, annotationsFreshness, coverageComplete: index.header.complete, passageCoverageComplete: index.header.counts.omittedPassages === 0 && index.header.counts.textTruncatedFiles === 0, results, charactersReturned: used, maxChars, totalCandidates: candidates.length, truncated, nextCursor, warnings: [...new Map(warnings.map((w) => [`${w.path}:${w.reason}`, w])).values()], fallback: 'Read the referenced original or broaden ordinary file search when the index omits evidence. A context hint is not an access restriction.' };
}
