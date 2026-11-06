#!/usr/bin/env node

// Tests lib/index.mjs directly, with no MCP server and no HTTP.
//
// Everything happens inside a fresh mkdtemp folder. This script refuses to run
// if that folder resolves anywhere near the real Vault, so a mistake here
// cannot damage user files.

import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createVault } from '../lib/index.mjs';

const HOME = process.env.HOME || '';
let REAL_VAULT = null;
if (HOME) {
  try { REAL_VAULT = realpathSync(path.resolve(HOME, 'personal-vault')); }
  catch { REAL_VAULT = null; }
}

function assertInside(root, candidate) {
  const target = path.resolve(root, candidate);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Refusing to touch ${target}: outside the test Vault.`);
  }
  if (REAL_VAULT && (target === REAL_VAULT || target.startsWith(`${REAL_VAULT}${path.sep}`))) {
    throw new Error(`Refusing to touch ${target}: that is the real Vault.`);
  }
  return target;
}

const root = realpathSync(await mkdtemp(path.join(tmpdir(), 'personal-vault-lib-')));
assertInside(root, '.');
const other = realpathSync(await mkdtemp(path.join(tmpdir(), 'personal-vault-lib-other-')));
assertInside(other, '.');

const checks = [];
function check(name, run) {
  checks.push({ name, run });
}

try {
  const vault = createVault({ root });

  check('createVault exposes the resolved root', () => {
    assert.equal(vault.root, root);
  });

  check('listing a folder that does not exist is an empty result', async () => {
    assert.deepEqual(await vault.list('raw/2099/01'), []);
  });

  check('Recently Deleted starts empty only when its folder is absent', async () => {
    assert.deepEqual(await vault.listDeleted(), { items: [], unsupported: [], truncated: false });
    const absent = createVault({ root: path.join(root, 'missing-vault-root') });
    await assert.rejects(() => absent.listDeleted(), (error) => error.code === 'ENOENT');
  });

  check('a new root resolves its existing parent before first save', async () => {
    const fresh = createVault({ root: path.join(tmpdir(), path.basename(root), 'new', 'selected') });
    await fresh.writeText('hello.md', 'first note');
    assert.equal(fresh.root, path.join(root, 'new/selected'));
    assert.equal((await fresh.readText('hello.md')).content, 'first note');
  });

  check('create writes readable text and returns file info', async () => {
    const created = await vault.writeText('raw/2026/08/hello.md', '# Hello\n\nA readable note.\n');
    assert.equal(created.path, 'raw/2026/08/hello.md');
    assert.equal(created.kind, 'file');
    assert.equal(await readFile(assertInside(root, 'raw/2026/08/hello.md'), 'utf8'), '# Hello\n\nA readable note.\n');
  });

  check('read returns the same content the file holds', async () => {
    const file = await vault.readText('raw/2026/08/hello.md');
    assert.equal(file.content.includes('readable note'), true);
  });

  check('create refuses to overwrite an existing file', async () => {
    await assert.rejects(
      () => vault.writeText('raw/2026/08/hello.md', 'duplicate'),
      /A file already exists at this path/,
    );
    assert.equal(await readFile(assertInside(root, 'raw/2026/08/hello.md'), 'utf8'), '# Hello\n\nA readable note.\n');
  });

  check('update replaces content and leaves no temporary file behind', async () => {
    await vault.writeText('raw/2026/08/hello.md', '# Edited', true);
    assert.equal(await readFile(assertInside(root, 'raw/2026/08/hello.md'), 'utf8'), '# Edited');
    const names = await readdir(assertInside(root, 'raw/2026/08'));
    assert.deepEqual(names.filter((name) => name.includes('.tmp-')), [], `temporary files leaked: ${names.join(', ')}`);
  });

  check('update refuses a missing file instead of creating it', async () => {
    // rename would create the target, so the library checks existence first.
    // update means update; create means create.
    await assert.rejects(
      () => vault.writeText('raw/2026/08/fresh.md', 'fresh', true),
      (error) => error.code === 'ENOENT',
    );
    assert.equal((await vault.list('raw/2026/08')).some((item) => item.path === 'raw/2026/08/fresh.md'), false);
  });

  check('saving an existing private file preserves its permissions', async () => {
    await vault.writeText('private.md', 'before');
    if (process.platform === 'win32') return;
    await chmod(assertInside(root, 'private.md'), 0o600);
    await vault.writeText('private.md', 'after', true);
    assert.equal((await stat(assertInside(root, 'private.md'))).mode & 0o777, 0o600);
  });

  check('attach saves a visible .assets file beside the Markdown', async () => {
    const attached = await vault.attach('raw/2026/08/hello.md', 'sample.bin', Buffer.from('sample').toString('base64'));
    assert.equal(attached.assetPath, 'raw/2026/08/hello.assets/sample.bin');
    assert.equal(await readFile(assertInside(root, 'raw/2026/08/hello.assets/sample.bin'), 'utf8'), 'sample');
  });

  check('attach refuses a duplicate name', async () => {
    await assert.rejects(
      () => vault.attach('raw/2026/08/hello.md', 'sample.bin', Buffer.from('different').toString('base64')),
      /An attachment already exists with this name/,
    );
    assert.equal(await readFile(assertInside(root, 'raw/2026/08/hello.assets/sample.bin'), 'utf8'), 'sample');
  });

  check('search finds the file and reports a readable path', async () => {
    const matches = await vault.search('Edited');
    assert.equal(matches.length > 0, true);
    assert.equal(matches[0].path, 'raw/2026/08/hello.md');
  });

  check('archive moves the note and its .assets folder together', async () => {
    await vault.archive('raw/2026/08/hello.md');
    const day = new Date().toISOString().slice(0, 10);
    assert.equal(await readFile(assertInside(root, `archive/${day}/raw/2026/08/hello.assets/sample.bin`), 'utf8'), 'sample');
    await assert.rejects(() => vault.readText('raw/2026/08/hello.md'), /ENOENT/);
  });

  check('restore puts the note and its .assets folder back', async () => {
    const day = new Date().toISOString().slice(0, 10);
    await vault.restore(`archive/${day}/raw/2026/08/hello.md`);
    assert.equal(await readFile(assertInside(root, 'raw/2026/08/hello.md'), 'utf8'), '# Edited');
    assert.equal(await readFile(assertInside(root, 'raw/2026/08/hello.assets/sample.bin'), 'utf8'), 'sample');
  });

  check('trash, listDeleted and restoreDeleted preserve readable paths and attachments', async () => {
    const source = 'structured/deleted-note.md';
    const body = '# Deleted note\n\n![sample](deleted-note.assets/sample.bin)\n';
    await vault.writeText(source, body);
    await vault.attach(source, 'sample.bin', Buffer.from('recoverable bytes').toString('base64'));
    const moved = await vault.trash(source);
    const date = new Date().toISOString().slice(0, 10);
    assert.equal(moved.to, `.trash/${date}/${source}`);
    assert.equal(moved.assetsTo, `.trash/${date}/structured/deleted-note.assets`);
    assert.equal(await vault.exists(source), false);
    assert.equal((await vault.list('', true, 1000)).some((item) => item.path.startsWith('.trash/')), false);
    assert.equal((await vault.search('Deleted note')).some((item) => item.path.startsWith('.trash/')), false);
    const deleted = await vault.listDeleted();
    const item = deleted.items.find((entry) => entry.path === moved.to);
    assert.equal(item.originalPath, source);
    assert.equal(item.deletedOn, date);
    assert.equal(item.canRestore, true);
    assert.equal(item.kind, 'file');
    assert.equal(deleted.items.some((entry) => entry.path.includes('.assets/')), false);
    assert.equal(deleted.truncated, false);
    await vault.restoreDeleted(moved.to);
    assert.equal((await vault.readText(source)).content, body);
    assert.equal((await vault.readBinary('structured/deleted-note.assets/sample.bin')).content.toString(), 'recoverable bytes');
    assert.equal((await vault.listDeleted()).items.some((entry) => entry.path === moved.to), false);
  });

  check('trash refuses same-day collisions without changing either copy or assets', async () => {
    const source = 'structured/collision.md';
    await vault.writeText(source, 'first');
    await vault.attach(source, 'first.bin', Buffer.from('first asset').toString('base64'));
    const first = await vault.trash(source);
    await vault.writeText(source, 'second');
    await vault.attach(source, 'second.bin', Buffer.from('second asset').toString('base64'));
    await assert.rejects(() => vault.trash(source), /already exists/);
    assert.equal((await vault.readText(source)).content, 'second');
    assert.equal((await vault.readText(first.to)).content, 'first');
    assert.equal((await vault.readBinary('structured/collision.assets/second.bin')).content.toString(), 'second asset');
    await assert.rejects(() => vault.restoreDeleted(first.to), /already exists/);
    assert.equal((await vault.readBinary(`${first.to.slice(0, -3)}.assets/first.bin`)).content.toString(), 'first asset');
  });

  check('trash and restoreDeleted refuse occupied attachment destinations', async () => {
    await vault.writeText('attachment-collision.md', 'source');
    await vault.attach('attachment-collision.md', 'a.bin', Buffer.from('asset').toString('base64'));
    const date = new Date().toISOString().slice(0, 10);
    await vault.ensureFolder(`.trash/${date}/attachment-collision.assets`);
    await assert.rejects(() => vault.trash('attachment-collision.md'), /already exists/);
    assert.equal((await vault.readText('attachment-collision.md')).content, 'source');
    const moved = await vault.trash('structured/deleted-note.md');
    await vault.ensureFolder('structured/deleted-note.assets');
    await assert.rejects(() => vault.restoreDeleted(moved.to), /already exists/);
    assert.equal(await vault.exists(moved.to), true);
    await vault.writeText('bare-note.md', 'no source assets');
    const bare = await vault.trash('bare-note.md');
    await vault.ensureFolder('bare-note.assets');
    await assert.rejects(() => vault.restoreDeleted(bare.to), /already exists/);
    assert.equal(await vault.exists(bare.to), true);
  });

  check('listDeleted reports legacy paths and orphan assets honestly and enforces bounds', async () => {
    await vault.writeText('.trash/legacy.md', 'original folder is unknown');
    await vault.writeText('.trash/2020-01-01/known/original.md', 'known original path');
    await vault.ensureFolder('.trash/2020-01-01/known/orphan.assets');
    const result = await vault.listDeleted();
    assert.equal(result.items.find((item) => item.path === '.trash/2020-01-01/known/original.md').originalPath, 'known/original.md');
    assert.equal(result.unsupported.some((item) => item.path === '.trash/legacy.md' && /unknown/.test(item.reason)), true);
    assert.equal(result.unsupported.some((item) => item.path.endsWith('/orphan.assets')), true);
    assert.equal((await vault.readText('.trash/legacy.md')).content, 'original folder is unknown');
    await assert.rejects(() => vault.restoreDeleted('.trash/legacy.md'), /original path/);
    const bounded = await vault.listDeleted(1);
    assert.equal(bounded.items.length + bounded.unsupported.length, 1);
    assert.equal(bounded.truncated, true);
    for (const limit of [0, -1, 1.5, 1001, NaN]) await assert.rejects(() => vault.listDeleted(limit), /limit/);
  });

  check('Recently Deleted rejects unsafe paths and never follows symlinks', async () => {
    for (const unsafe of ['', '.', '../outside.md', '/outside.md', '.trash/legacy.md', 'structured']) {
      await assert.rejects(() => vault.trash(unsafe), /Vault root|inside the Vault|not a folder/);
    }
    for (const unsafe of ['../outside.md', '/outside.md', '.trash/2020-02-30/no.md', '.trash/2020-01-01/.trash/nested.md']) {
      await assert.rejects(() => vault.restoreDeleted(unsafe), /inside the Vault|original path|outside Recently Deleted/);
    }
    await symlink(other, assertInside(root, '.trash/2020-01-01/linked'));
    const result = await vault.listDeleted();
    assert.equal(result.unsupported.some((entry) => entry.path === '.trash/2020-01-01/linked' && /Symbolic links/.test(entry.reason)), true);
    await assert.rejects(() => vault.restoreDeleted('.trash/2020-01-01/linked/outside.md'), /Symbolic links/);
    await symlink(other, assertInside(root, 'unsafe-assets.assets'));
    await vault.writeText('unsafe-assets.md', 'safe source');
    await assert.rejects(() => vault.trash('unsafe-assets.md'), /Symbolic links/);
    assert.equal((await vault.readText('unsafe-assets.md')).content, 'safe source');
    await vault.writeText('replacement/location.md', 'deleted before replacement');
    const moved = await vault.trash('replacement/location.md');
    await symlink(other, assertInside(root, 'replacement/location.md'));
    assert.equal((await vault.listDeleted()).items.some((entry) => entry.path === moved.to && entry.originalPath === 'replacement/location.md'), true);
    await assert.rejects(() => vault.restoreDeleted(moved.to), /Symbolic links/);
    assert.equal((await vault.readText(moved.to)).content, 'deleted before replacement');
  });

  check('concurrent restores cannot replace the same original destination', async () => {
    const first = '.trash/2000-01-01/concurrent.md';
    const second = '.trash/2000-01-02/concurrent.md';
    await vault.writeText(first, 'first candidate');
    await vault.writeText(second, 'second candidate');
    const another = createVault({ root });
    const results = await Promise.allSettled([vault.restoreDeleted(first), another.restoreDeleted(second)]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
    const winner = results[0].status === 'fulfilled' ? 'first candidate' : 'second candidate';
    const remaining = results[0].status === 'fulfilled' ? second : first;
    assert.equal((await vault.readText('concurrent.md')).content, winner);
    assert.equal(await vault.exists(remaining), true);
  });

  check('captureNote writes readable Markdown in raw/YYYY/MM', async () => {
    const saved = await vault.captureNote({ input: 'A captured thought.', title: 'Lib Smoke Capture' });
    assert.match(saved.capturePath, /^raw\/\d{4}\/\d{2}\/\d{4}-\d{2}-\d{2}-lib-smoke-capture\.md$/);
    const content = await readFile(assertInside(root, saved.capturePath), 'utf8');
    assert.equal(content.includes('title: "Lib Smoke Capture"'), true);
    assert.equal(content.includes('A captured thought.'), true);
    assert.equal(saved.assetCount, 0);
  });

  check('captureNote stores attachments and links them from the note', async () => {
    const saved = await vault.captureNote({
      input: 'With a picture.',
      title: 'Lib Smoke Capture',
      attachments: [{ name: 'shot.png', dataBase64: Buffer.from('png-bytes').toString('base64'), caption: 'A caption' }],
    });
    assert.equal(saved.assetCount, 1);
    assert.match(saved.capturePath, /lib-smoke-capture-2\.md$/, 'a second capture must not collide with the first');
    const content = await readFile(assertInside(root, saved.capturePath), 'utf8');
    assert.equal(content.includes('](/'), false, 'attachment links must stay relative');
    assert.equal(content.includes('shot.png'), true);
    assert.equal(content.includes('A caption'), true);
    assert.equal(await readFile(assertInside(root, `raw/${saved.capturePath.split('/')[1]}/${saved.capturePath.split('/')[2]}/${saved.capturePath.slice(0, -3).split('/').pop()}.assets/shot.png`), 'utf8'), 'png-bytes');
  });

  check('a non-Latin title keeps its meaning in the filename', async () => {
    const saved = await vault.captureNote({ input: 'Мысли о проекте.', title: 'Идеи 📝' });
    assert.match(saved.capturePath, /^raw\/\d{4}\/\d{2}\/\d{4}-\d{2}-\d{2}-идеи\.md$/,
      'a Cyrillic title must stay readable instead of collapsing to "capture"');
    const content = await readFile(assertInside(root, saved.capturePath), 'utf8');
    assert.equal(content.includes('title: "Идеи 📝"'), true, 'the title itself must survive verbatim');
    assert.equal(content.includes('Мысли о проекте.'), true);
  });

  check('another script keeps its own characters and repeats still suffix', async () => {
    const greek = await vault.captureNote({ input: 'Σημείωση.', title: 'Σημειώσεις' });
    assert.match(greek.capturePath, /-σημειώσεις\.md$/, 'Greek titles are not transliterated to ASCII either');
    const cyrillicAgain = await vault.captureNote({ input: 'Второй раз.', title: 'Идеи 📝' });
    assert.match(cyrillicAgain.capturePath, /-идеи-2\.md$/, 'a repeated readable title must suffix rather than overwrite');
  });

  check('unsafe characters cannot escape the capture folder', async () => {
    const saved = await vault.captureNote({ input: 'Traversal attempt.', title: '../../etc/pa:ss|wo*rd' });
    assert.match(saved.capturePath, /^raw\/\d{4}\/\d{2}\/\d{4}-\d{2}-\d{2}-etc-pa-ss-wo-rd\.md$/,
      'separators and reserved punctuation collapse to one separator');
    assert.equal(saved.capturePath.split('/').length, 4, 'the note stays two folders deep inside raw/');
  });

  check('a punctuation-only title still falls back to a stable name', async () => {
    const saved = await vault.captureNote({ input: 'No words in the title.', title: '!!! ??? 📝' });
    assert.match(saved.capturePath, /-capture\.md$/, 'a title with no letters or digits keeps the documented fallback');
  });

  check('a listing failure is reported instead of inventing a free path', async () => {
    if (process.platform === 'win32') return;
    const saved = await vault.captureNote({ input: 'Placeholder.', title: 'Lib Smoke Listing Failure' });
    const folder = path.posix.dirname(saved.capturePath);
    const folderPath = assertInside(root, folder);
    await chmod(folderPath, 0o000);
    try {
      await assert.rejects(() => vault.captureNote({ input: 'Blocked.', title: 'Lib Smoke Listing Failure' }),
        (error) => error.code === 'EACCES' || error.code === 'EPERM',
        'a real listing failure must not be swallowed into an empty list');
    } finally {
      await chmod(folderPath, 0o755);
    }
    assert.equal((await vault.list(folder, false, 100)).length > 0, true, 'the folder is readable again after the check');
  });

  check('captureAsset appends to an existing capture', async () => {
    const first = await vault.captureNote({ input: 'Bare note.', title: 'Lib Smoke Asset' });
    const saved = await vault.captureAsset({ capturePath: first.capturePath, attachments: [{ name: 'extra.txt', dataBase64: Buffer.from('extra').toString('base64') }] });
    assert.equal(saved.assetCount, 1);
    const content = await readFile(assertInside(root, first.capturePath), 'utf8');
    assert.equal(content.includes('extra.txt'), true);
  });

  check('relative parent traversal is refused', async () => {
    await assert.rejects(() => vault.readText('../outside.md'), /Path must stay inside the Vault/);
    await assert.rejects(() => vault.writeText('../outside.md', 'bad'), /Path must stay inside the Vault/);
  });

  check('absolute paths are refused', async () => {
    await assert.rejects(() => vault.readText('/etc/passwd.md'), /Path must stay inside the Vault/);
  });

  check('symlinks are refused even when they point outside', async () => {
    const outside = realpathSync(await mkdtemp(path.join(tmpdir(), 'personal-vault-outside-')));
    try {
      await writeFile(path.join(outside, 'outside.md'), 'outside fixture');
      await symlink(outside, path.join(root, 'escape'));
      await assert.rejects(() => vault.readText('escape/outside.md'), /Symbolic links are not supported/);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  check('a second Vault instance is fully isolated', async () => {
    const second = createVault({ root: other });
    assert.deepEqual(await second.list('raw', true), []);
    await second.writeText('raw/2026/08/other.md', 'other vault');
    const mine = (await second.list('raw', true)).filter((item) => item.kind === 'file').map((item) => item.path);
    assert.deepEqual(mine, ['raw/2026/08/other.md']);
    const seenByFirst = (await vault.list('raw', true)).filter((item) => item.kind === 'file').map((item) => item.path);
    assert.equal(seenByFirst.includes('raw/2026/08/other.md'), false);
  });

  check('binary and unknown extensions are not writable through the text API', async () => {
    await assert.rejects(() => vault.writeText('raw/2026/08/image.png', 'nope'), /readable text files only/);
  });

  check('readBinary returns bytes for a non-text file', async () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]);
    await writeFile(assertInside(root, 'raw/2026/08/pixel.png'), bytes);
    const read = await vault.readBinary('raw/2026/08/pixel.png');
    assert.equal(Buffer.compare(read.content, bytes), 0);
    assert.equal(read.sizeBytes, bytes.length);
    assert.equal(read.path, 'raw/2026/08/pixel.png');
  });

  check('readBinary refuses a folder', async () => {
    await assert.rejects(() => vault.readBinary('raw'), /folder, not a file/);
  });

  check('appendText creates the file and its folder, then appends', async () => {
    const first = await vault.appendText('indexes/captures.jsonl', '{"n":1}\n');
    assert.equal(first.path, 'indexes/captures.jsonl');
    await vault.appendText('indexes/captures.jsonl', '{"n":2}\n');
    const stored = await readFile(assertInside(root, 'indexes/captures.jsonl'), 'utf8');
    assert.equal(stored, '{"n":1}\n{"n":2}\n');
  });

  check('appendText appends to an existing file without truncating it', async () => {
    await vault.writeText('indexes/existing.jsonl', '{"a":1}\n');
    await vault.appendText('indexes/existing.jsonl', '{"a":2}\n');
    assert.equal(await readFile(assertInside(root, 'indexes/existing.jsonl'), 'utf8'), '{"a":1}\n{"a":2}\n');
  });

  check('exists reports both states without throwing', async () => {
    assert.equal(await vault.exists('raw/2026/08/hello.md'), true);
    assert.equal(await vault.exists('raw/2026/08/absent.md'), false);
  });

  check('ensureFolder is idempotent', async () => {
    await vault.ensureFolder('structured/plans');
    await vault.ensureFolder('structured/plans');
    assert.equal((await vault.list('structured')).some((item) => item.path === 'structured/plans' && item.kind === 'folder'), true);
  });

  check('move renames a file and its .assets folder', async () => {
    await vault.writeText('raw/2026/08/movable.md', 'movable');
    await vault.attach('raw/2026/08/movable.md', 'side.bin', Buffer.from('side').toString('base64'));
    const moved = await vault.move('raw/2026/08/movable.md', '.trash/movable.md');
    assert.equal(moved.to, '.trash/movable.md');
    assert.equal(await readFile(assertInside(root, '.trash/movable.md'), 'utf8'), 'movable');
    assert.equal(await readFile(assertInside(root, '.trash/movable.assets/side.bin'), 'utf8'), 'side');
  });

  check('move refuses to clobber an existing destination', async () => {
    await vault.writeText('raw/2026/08/one.md', 'one');
    await vault.writeText('raw/2026/08/two.md', 'two');
    await assert.rejects(() => vault.move('raw/2026/08/one.md', 'raw/2026/08/two.md'), /already exists at the destination/);
    assert.equal(await readFile(assertInside(root, 'raw/2026/08/one.md'), 'utf8'), 'one');
  });

  check('metadata refuses absolute paths, traversal and symlinks', async () => {
    assert.equal((await vault.info('raw/2026/08/one.md')).kind, 'file');
    await assert.rejects(() => vault.info(path.join(other, 'outside.md')), /Path must stay inside/);
    await assert.rejects(() => vault.info('../outside.md'), /Path must stay inside/);
    await assert.rejects(() => vault.info('escape/outside.md'), /Symbolic links/);
  });

  check('renamed Markdown keeps inline and reference attachment links', async () => {
    const body = '# Rename\n![pic](./old.assets/a.png)\n[file](old.assets/a.png)\n[ref]: ./old.assets/a.png\nhttps://example.com/old.assets/a.png\n`![inline](./old.assets/a.png)`\n```md\n![example](./old.assets/a.png)\n```\n';
    await vault.writeText('rename/old.md', body);
    await vault.attach('rename/old.md', 'a.png', Buffer.from('image').toString('base64'));
    await vault.move('rename/old.md', 'elsewhere/new.md');
    const content = (await vault.readText('elsewhere/new.md')).content;
    assert.ok(content.includes('![pic](./new.assets/a.png)'));
    assert.ok(content.includes('[file](new.assets/a.png)'));
    assert.ok(content.includes('[ref]: ./new.assets/a.png'));
    assert.ok(content.includes('https://example.com/old.assets/a.png'));
    assert.ok(content.includes('```md\n![example](./old.assets/a.png)\n```'));
    assert.ok(content.includes('`![inline](./old.assets/a.png)`'));
    assert.equal((await vault.readBinary('elsewhere/new.assets/a.png')).content.toString(), 'image');
  });

  check('a note with assets cannot be renamed to a different format', async () => {
    await assert.rejects(() => vault.move('elsewhere/new.md', 'elsewhere/new.txt'), /keep its .md extension/);
    assert.equal(await vault.exists('elsewhere/new.md'), true);
    assert.equal(await vault.exists('elsewhere/new.assets/a.png'), true);
    assert.equal(await vault.exists('elsewhere/new.txt'), false);
  });

  check('move refuses folders and the Vault root', async () => {
    await assert.rejects(() => vault.move('', 'moved'), /Vault root/);
    await assert.rejects(() => vault.move('rename', 'moved'), /not a folder/);
  });

  const results = [];
  for (const { name, run } of checks) {
    try { await run(); results.push({ name, ok: true }); }
    catch (error) { results.push({ name, ok: false, error }); }
  }

  const failed = results.filter((result) => !result.ok);
  for (const result of results) console.log(`${result.ok ? 'ok  ' : 'FAIL'}  ${result.name}`);
  if (failed.length) {
    for (const result of failed) console.error(`\n${result.name}:\n${result.error?.stack || result.error}`);
    throw new Error(`${failed.length} of ${checks.length} library checks failed.`);
  }
  console.log(`\n${checks.length} library checks passed (root ${root}).`);
} finally {
  await rm(root, { recursive: true, force: true });
  await rm(other, { recursive: true, force: true });
}
