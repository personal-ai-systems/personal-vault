#!/usr/bin/env node

// Tests lib/index.mjs directly, with no MCP server and no HTTP.
//
// Everything happens inside a fresh mkdtemp folder. This script refuses to run
// if that folder resolves anywhere near the real Vault, so a mistake here
// cannot damage user files.

import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
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
