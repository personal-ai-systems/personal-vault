// Personal Vault file library.
//
// This file is the only implementation of Vault file mechanics. Adapters call
// it; it never calls them. The MCP server is one adapter, the desktop app is
// another, and the Assistant will be a third.
//
// Deliberate absences, because they are what keeps the boundary real:
//   - no MCP SDK, no HTTP, no auth, no schema library
//   - no process.env reads: configuration arrives through the factory argument
//   - no tool names and no transport status codes
//   - no application concepts such as Today, Health, Planner or projects.
//     Those belong to the Assistant, not to the Vault.
//
// Several Vaults can coexist in one process, which is what makes temporary
// folder tests possible without touching a real Vault.

import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { lstatSync, realpathSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

const TEXT_EXTENSIONS = new Set(['.md', '.txt', '.json', '.jsonl', '.csv', '.yaml', '.yml']);

export function createVault({ root, timeZone = 'Australia/Sydney' } = {}) {
  if (!root) throw new Error('createVault requires a root.');

  // Resolve the real path once. On macOS a temp folder lives under /var, which
  // is a symlink to /private/var; comparing unresolved and resolved paths later
  // would make every containment check fail.
  let VAULT_ROOT;
  try { VAULT_ROOT = realpathSync(path.resolve(root)); }
  catch (error) {
    // A Vault that has not been created yet is legitimate for a library, even
    // though the current server always starts on an existing folder.
    if (error.code !== 'ENOENT') throw error;
    // Resolve the nearest existing parent too. A new selected folder under
    // macOS /var must not be rejected just because /var aliases /private/var.
    let parent = path.resolve(root);
    const missing = [];
    while (true) {
      try { VAULT_ROOT = path.join(realpathSync(parent), ...missing); break; }
      catch (parentError) {
        if (parentError.code !== 'ENOENT' || path.dirname(parent) === parent) throw parentError;
        missing.unshift(path.basename(parent));
        parent = path.dirname(parent);
      }
    }
  }

  // ------------------------------------------------------------- vault paths

  function cleanPath(input = '') {
    const value = String(input).replace(/\\/g, '/').replace(/^\.\//, '');
    if (value.includes('\0') || value.startsWith('/') || value.split('/').includes('..')) throw new Error('Path must stay inside the Vault.');
    return value;
  }

  function fullPath(relativePath = '') {
    const target = path.resolve(VAULT_ROOT, cleanPath(relativePath));
    if (target !== VAULT_ROOT && !target.startsWith(`${VAULT_ROOT}${path.sep}`)) throw new Error('Path must stay inside the Vault.');
    // Refuse symlinks in every existing component, including the selected root.
    let cursor = path.parse(target).root;
    for (const part of target.slice(cursor.length).split(path.sep).filter(Boolean)) {
      cursor = path.join(cursor, part);
      try { if (lstatSync(cursor).isSymbolicLink()) throw new Error('Symbolic links are not supported inside the Vault path.'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    return target;
  }

  function relativePath(filePath) {
    return path.relative(VAULT_ROOT, filePath).split(path.sep).join('/');
  }

  function visibleName(name) {
    return !name.startsWith('.') && name !== 'node_modules';
  }

  function textFile(relative) {
    return TEXT_EXTENSIONS.has(path.extname(relative).toLowerCase());
  }

  async function infoAt(filePath) {
    const details = await stat(filePath);
    return { path: relativePath(filePath), kind: details.isDirectory() ? 'folder' : 'file', sizeBytes: details.size, modifiedAt: details.mtime.toISOString(), changedAt: details.ctime.toISOString() };
  }

  // Public operations always take Vault-relative paths, including metadata.
  async function info(relative = '') {
    return infoAt(fullPath(relative));
  }

  async function list(relative = '', recursive = false, limit = 200) {
    const root = fullPath(relative);
    const entries = [];
    async function walk(directory) {
      if (entries.length >= limit) return;
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (entry.isSymbolicLink() || !visibleName(entry.name) || entries.length >= limit) continue;
        const candidate = path.join(directory, entry.name);
        entries.push(await infoAt(candidate));
        if (recursive && entry.isDirectory()) await walk(candidate);
      }
    }
    try { await walk(root); }
    catch (error) {
      // Listing a folder that has not been created yet is an empty result. Other
      // filesystem failures remain visible to the caller.
      if (error.code !== 'ENOENT') throw error;
    }
    return entries.sort((left, right) => left.path.localeCompare(right.path));
  }

  async function readText(relative) {
    // Validate the path before the extension, so an escaping path reports the real reason.
    const clean = cleanPath(relative);
    if (!textFile(clean)) throw new Error('Only readable text files can be opened with this tool.');
    const target = fullPath(clean);
    return { ...(await infoAt(target)), content: await readFile(target, 'utf8') };
  }

  async function writeText(relative, content, overwrite = false) {
    if (!textFile(relative)) throw new Error('Personal Vault writes readable text files only.');
    const target = fullPath(relative);
    await mkdir(path.dirname(target), { recursive: true });

    if (!overwrite) {
      await writeFile(target, content, { encoding: 'utf8', flag: 'wx' }).catch((error) => {
        if (error.code === 'EEXIST') throw Object.assign(new Error('A file already exists at this path. Update it instead of creating it.'), { code: 'EEXIST' });
        throw error;
      });
      return readText(relative);
    }

    // Atomic overwrite. The previous implementation opened the target with r+
    // and then truncated it, so a crash or a full disk between those two steps
    // left a partially written file and the original content was gone. Write
    // beside the target and rename over it instead: same directory means same
    // filesystem, so the rename is atomic and the original survives any failure.
    //
    // r+ also refused to create an absent file, and update must keep refusing:
    // rename would happily create one. Check first and let ENOENT surface with
    // its natural code and message.
    const previous = await stat(target);
    const directory = path.dirname(target);
    const temporary = path.join(directory, `.${path.basename(target)}.tmp-${randomBytes(6).toString('hex')}`);
    try {
      await writeFile(temporary, content, { encoding: 'utf8', mode: previous.mode });
      await rename(temporary, target);
    } catch (error) {
      await unlink(temporary).catch(() => {});
      throw error;
    }
    return readText(relative);
  }

  // ------------------------------------------------------------ other reads
  //
  // These four exist because a second consumer needed them. The first version of
  // this library only covered what the MCP server asked for, which is a lesson
  // about extracting from one caller: the Assistant reads binary attachments,
  // appends to JSONL indexes, tests whether a file exists, and creates folders
  // before writing. Without them the consumer reaches for `fs` again and the
  // whole point of this file is lost.

  // Binary read, for attachments and images. Deliberately separate from
  // readText: guessing whether bytes are text is how mojibake gets written back.
  async function readBinary(relative) {
    const target = fullPath(cleanPath(relative));
    const details = await stat(target);
    if (details.isDirectory()) throw new Error('That path is a folder, not a file.');
    return { ...(await infoAt(target)), content: await readFile(target) };
  }

  // Append, for visible log files such as captures.jsonl. O_APPEND keeps the
  // write atomic for small entries, so concurrent appends interleave whole lines
  // rather than splicing into each other. Creates the file and its folder.
  async function appendText(relative, content) {
    if (!textFile(relative)) throw new Error('Personal Vault appends readable text files only.');
    const target = fullPath(relative);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, String(content), { encoding: 'utf8', flag: 'a' });
    const details = await stat(target);
    return { path: relativePath(target), sizeBytes: details.size, modifiedAt: details.mtime.toISOString() };
  }

  // Existence check without throwing. Callers use this instead of catching
  // ENOENT, which hides real permission and I/O errors behind the same catch.
  async function exists(relative) {
    return existsAt(fullPath(relative));
  }

  async function ensureFolder(relative = '') {
    const target = fullPath(relative);
    await mkdir(target, { recursive: true });
    return { path: relativePath(target), kind: 'folder' };
  }

  // ------------------------------------------------------------------ moving

  // Generic move, for renames inside the Vault such as moving a file into
  // .trash/ on discard. archive/restore are the opinionated cases on top of it.
  async function move(fromRelative, toRelative) {
    return moveNoteWithAssets(cleanPath(fromRelative), cleanPath(toRelative));
  }

  function archivePath(relative) {
    const date = new Date().toISOString().slice(0, 10);
    return `archive/${date}/${cleanPath(relative)}`;
  }

  // Absolute-path existence check, used internally by the move helpers below.
  // Named apart from the public exists() so the two cannot shadow each other.
  async function existsAt(target) {
    return stat(target).then(() => true).catch((error) => error.code === 'ENOENT' ? false : Promise.reject(error));
  }

  async function moveNoteWithAssets(sourceRelative, destinationRelative) {
    const source = fullPath(sourceRelative);
    const destination = fullPath(destinationRelative);
    const sourceAssetsRelative = path.extname(sourceRelative).toLowerCase() === '.md' ? `${sourceRelative.slice(0, -3)}.assets` : null;
    if (!sourceRelative || !destinationRelative) throw new Error('Choose a file, not the Vault root.');
    const destinationAssetsRelative = sourceAssetsRelative ? `${destinationRelative.slice(0, -3)}.assets` : null;
    const sourceAssets = sourceAssetsRelative ? fullPath(sourceAssetsRelative) : null;
    const destinationAssets = destinationAssetsRelative ? fullPath(destinationAssetsRelative) : null;
    const hasAssets = sourceAssets ? await existsAt(sourceAssets) : false;
    if (hasAssets && path.extname(destinationRelative).toLowerCase() !== '.md') {
      throw new Error('A note with attachments must keep its .md extension.');
    }
    if (!(await stat(source)).isFile()) throw new Error('Choose a file, not a folder.');
    // A rename changes the adjacent asset folder's name. Keep its Markdown
    // destinations readable and working; do not alter prose, code or web URLs.
    let originalMarkdown;
    let movedMarkdown;
    if (hasAssets && path.basename(sourceRelative) !== path.basename(destinationRelative)) {
      originalMarkdown = await readFile(source, 'utf8');
      const oldName = path.basename(sourceAssetsRelative);
      const newName = path.basename(destinationAssetsRelative);
      const rewrite = (url) => {
        for (const prefix of [`./${oldName}/`, `${oldName}/`, `./${encodeURIComponent(oldName)}/`, `${encodeURIComponent(oldName)}/`]) {
          if (url.startsWith(prefix)) return `${prefix.startsWith('./') ? './' : ''}${encodeURIComponent(newName)}/${url.slice(prefix.length)}`;
        }
        return url;
      };
      let fence = null;
      movedMarkdown = originalMarkdown.split(/(\r?\n)/).map((line) => {
        const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
        if (marker) {
          if (!fence) fence = marker;
          else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null;
          return line;
        }
        if (fence) return line;
        return line.split(/(`+[^`]*?`+)/g).map((part, index) => index % 2 ? part : part
          .replace(/(\]\(\s*<?)([^\s)>]+)(>?)/g, (_all, open, url, close) => `${open}${rewrite(url)}${close}`)
          .replace(/^(\s{0,3}\[[^\]]+\]:\s*<?)([^\s>]+)(>?)/, (_all, open, url, close) => `${open}${rewrite(url)}${close}`)).join('');
      }).join('');
    }
    if (await existsAt(destination) || (hasAssets && await existsAt(destinationAssets))) throw new Error('A file already exists at the destination.');
    await mkdir(path.dirname(destination), { recursive: true });
    if (hasAssets) await mkdir(path.dirname(destinationAssets), { recursive: true });
    await rename(source, destination);
    try {
      if (hasAssets) await rename(sourceAssets, destinationAssets);
      if (movedMarkdown !== undefined && movedMarkdown !== originalMarkdown) {
        await writeText(destinationRelative, movedMarkdown, true);
      }
    } catch (error) {
      if (hasAssets && await existsAt(destinationAssets)) await rename(destinationAssets, sourceAssets).catch(() => {});
      await rename(destination, source).catch(() => {});
      throw error;
    }
    return { from: sourceRelative, to: destinationRelative, ...(hasAssets ? { assetsFrom: sourceAssetsRelative, assetsTo: destinationAssetsRelative } : {}) };
  }

  async function archive(relative) {
    const sourceRelative = cleanPath(relative);
    return moveNoteWithAssets(sourceRelative, archivePath(sourceRelative));
  }

  async function restore(relative) {
    const clean = cleanPath(relative);
    const match = /^archive\/\d{4}-\d{2}-\d{2}\/(.+)$/.exec(clean);
    if (!match) throw new Error('Choose a file under archive/YYYY-MM-DD to restore.');
    return moveNoteWithAssets(clean, match[1]);
  }

  // ------------------------------------------------------------------ search

  async function search(query, limit = 20) {
    const matches = [];
    async function walk(directory) {
      if (matches.length >= limit) return;
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (entry.isSymbolicLink() || !visibleName(entry.name) || matches.length >= limit) continue;
        const candidate = path.join(directory, entry.name);
        if (entry.isDirectory()) await walk(candidate);
        else {
          const relative = relativePath(candidate);
          if (!textFile(relative)) continue;
          const content = await readFile(candidate, 'utf8').catch(() => '');
          const index = content.toLowerCase().indexOf(query.toLowerCase());
          if (index >= 0) matches.push({ path: relative, preview: content.slice(Math.max(0, index - 120), index + 280).replace(/\s+/g, ' ').trim() });
        }
      }
    }
    await walk(VAULT_ROOT);
    return matches;
  }

  // ------------------------------------------------------------- attachments

  function safeFileName(name) {
    const cleaned = path.basename(String(name || 'attachment')).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
    if (!cleaned) throw new Error('Attachment name is invalid.');
    return cleaned;
  }

  async function attach(markdownPath, name, dataBase64) {
    const source = cleanPath(markdownPath);
    if (path.extname(source).toLowerCase() !== '.md') throw new Error('Attachments belong beside a Markdown file.');
    await readText(source);
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(dataBase64 || '')) throw new Error('Attachment must be base64 data.');
    const bytes = Buffer.from(dataBase64, 'base64');
    if (!bytes.length || bytes.toString('base64') !== dataBase64) throw new Error('Attachment data is invalid.');
    const assetRelative = `${source.slice(0, -3)}.assets/${safeFileName(name)}`;
    const assetFile = fullPath(assetRelative);
    await mkdir(path.dirname(assetFile), { recursive: true });
    await writeFile(assetFile, bytes, { flag: 'wx' }).catch((error) => {
      if (error.code === 'EEXIST') throw new Error('An attachment already exists with this name. Choose another name.');
      throw error;
    });
    return { markdownPath: source, assetPath: assetRelative, sizeBytes: bytes.length };
  }

  // ----------------------------------------------------------------- capture

  function today() {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  }

  function slug(value) {
    return String(value).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70) || 'capture';
  }

  function dataForAttachment(attachment) {
    if (attachment.dataBase64) return attachment.dataBase64.replace(/\s+/g, '');
    const match = /^data:[^;,]+;base64,([A-Za-z0-9+/=\s]+)$/i.exec(String(attachment.dataUrl || ''));
    if (!match) throw new Error('Each attachment needs dataBase64 or a base64 data URL.');
    return match[1].replace(/\s+/g, '');
  }

  async function capturePath(title) {
    const [year, month] = today().split('-');
    const base = `${today()}-${slug(title)}`;
    const folder = `raw/${year}/${month}`;
    const files = await list(folder, false, 1000).catch(() => []);
    const used = new Set(files.map((item) => item.path));
    let suffix = 1;
    let candidate = `${folder}/${base}.md`;
    while (used.has(candidate)) candidate = `${folder}/${base}-${++suffix}.md`;
    return candidate;
  }

  function imageAlt(attachment) {
    return String(attachment.alt || attachment.name || 'attachment').replace(/[\[\]\r\n]/g, ' ');
  }

  async function captureNote({ input, title, projectId, intent = 'note', attachments = [] }) {
    const titleText = title || `Capture - ${today()}`;
    const filePath = await capturePath(titleText);
    let markdown = ['---', `title: ${JSON.stringify(titleText)}`, `created: ${JSON.stringify(new Date().toISOString())}`, `intent: ${JSON.stringify(intent)}`, projectId ? `project: ${JSON.stringify(projectId)}` : '', '---', '', `# ${titleText}`, '', input, ''].filter(Boolean).join('\n');
    await writeText(filePath, markdown);
    const assets = [];
    for (const attachment of attachments) {
      const asset = await attach(filePath, attachment.name || 'attachment', dataForAttachment(attachment));
      const relative = `./${path.basename(filePath, '.md')}.assets/${path.basename(asset.assetPath)}`;
      markdown += `\n![${imageAlt(attachment)}](${relative})\n${attachment.caption ? `\n_${attachment.caption}_\n` : ''}`;
      assets.push(asset);
    }
    if (assets.length) await writeText(filePath, markdown, true);
    return { capturePath: filePath, path: filePath, title: titleText, assetCount: assets.length, assets };
  }

  async function captureAsset({ capturePath: target, attachments }) {
    let markdown = (await readText(target)).content;
    const assets = [];
    for (const attachment of attachments) {
      const asset = await attach(target, attachment.name || 'attachment', dataForAttachment(attachment));
      markdown += `\n![${imageAlt(attachment)}](./${path.basename(target, '.md')}.assets/${path.basename(asset.assetPath)})\n`;
      assets.push(asset);
    }
    await writeText(target, markdown, true);
    return { capturePath: target, assetCount: assets.length, assets };
  }

  return {
    // The resolved root, so adapters do not re-derive it and cannot disagree
    // with the containment checks above.
    root: VAULT_ROOT,
    timeZone,
    cleanPath,
    fullPath,
    relativePath,
    // Validated absolute path. Exposed for adapters that need to stat a file
    // themselves; it keeps the containment and symlink checks in one place.
    resolvePath: fullPath,
    isTextFile: textFile,
    info,
    list,
    readText,
    readBinary,
    writeText,
    appendText,
    exists,
    ensureFolder,
    move,
    archivePath,
    archive,
    restore,
    search,
    safeFileName,
    attach,
    today,
    capturePath,
    captureNote,
    captureAsset,
  };
}
