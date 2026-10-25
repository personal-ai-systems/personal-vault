#!/usr/bin/env node

import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { strFromU8, unzipSync } from 'fflate';

const SOURCE_LINE = 'openai_conversation_id:';

function usage() {
  return `Import an OpenAI data export into readable Personal Vault notes.

Usage:
  npm run import:openai -- /path/to/openai-export.zip --vault /path/to/Personal\ Vault
  npm run import:openai -- /path/to/conversations.json --vault /path/to/Personal\ Vault

Options:
  --vault <folder>  Personal Vault folder (or set PERSONAL_VAULT_ROOT)
  --dry-run         Show what would be imported without writing files
  --help            Show this help`;
}

function parseArgs(argv) {
  const result = { inputPath: null, vaultRoot: process.env.PERSONAL_VAULT_ROOT || null, dryRun: false, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--help' || value === '-h') return { help: true };
    if (value === '--dry-run') { result.dryRun = true; continue; }
    if (value === '--json') { result.json = true; continue; }
    if (value === '--vault') { result.vaultRoot = argv[++index] || null; continue; }
    if (!result.inputPath) { result.inputPath = value; continue; }
    throw new Error(`Unexpected argument: ${value}`);
  }
  return result;
}

function safeDate(seconds) {
  const date = Number.isFinite(Number(seconds)) ? new Date(Number(seconds) * 1000) : new Date(0);
  return Number.isNaN(date.valueOf()) ? new Date(0) : date;
}

function iso(seconds) {
  return safeDate(seconds).toISOString();
}

function slugify(title) {
  const slug = String(title || 'untitled conversation')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
  return slug || 'untitled-conversation';
}

function yamlString(value) {
  return JSON.stringify(String(value ?? ''));
}

function readablePart(part) {
  if (typeof part === 'string') return part;
  if (!part || typeof part !== 'object') return '';
  if (typeof part.text === 'string') return part.text;
  if (typeof part.content === 'string') return part.content;
  if (part.asset_pointer || part.content_type === 'image_asset_pointer') return '[Attachment in the original OpenAI export]';
  return '';
}

function messageText(message) {
  const content = message?.content;
  if (!content) return '';
  if (Array.isArray(content.parts)) return content.parts.map(readablePart).filter(Boolean).join('\n\n').trim();
  if (typeof content.text === 'string') return content.text.trim();
  if (typeof content === 'string') return content.trim();
  return '';
}

function conversationMessages(conversation) {
  const mapping = conversation?.mapping && typeof conversation.mapping === 'object' ? conversation.mapping : {};
  const current = conversation?.current_node;
  const branch = [];
  const seen = new Set();
  let nodeId = current;

  while (nodeId && mapping[nodeId] && !seen.has(nodeId)) {
    seen.add(nodeId);
    const node = mapping[nodeId];
    if (node.message) branch.push(node.message);
    nodeId = node.parent || null;
  }

  const messages = branch.length
    ? branch.reverse()
    : Object.values(mapping).map((entry) => entry?.message).filter(Boolean)
        .sort((left, right) => Number(left.create_time || 0) - Number(right.create_time || 0));

  return messages
    .map((message) => ({
      role: message?.author?.role || 'unknown',
      text: messageText(message),
    }))
    .filter((message) => message.text && ['user', 'assistant', 'system'].includes(message.role));
}

function renderConversation(conversation, importedAt) {
  const title = String(conversation.title || 'Untitled conversation').trim() || 'Untitled conversation';
  const created = iso(conversation.create_time);
  const updated = iso(conversation.update_time || conversation.create_time);
  const id = String(conversation.id || conversation.conversation_id || '').trim();
  const sections = conversationMessages(conversation).map(({ role, text }) => {
    const heading = role === 'user' ? 'You' : role === 'assistant' ? 'Assistant' : 'System';
    return `## ${heading}\n\n${text}`;
  });
  return `---\n` +
    `title: ${yamlString(title)}\n` +
    `source: openai-export\n` +
    `created: ${created}\n` +
    `updated: ${updated}\n` +
    `imported: ${importedAt}\n` +
    (id ? `${SOURCE_LINE} ${yamlString(id)}\n` : '') +
    `---\n\n# ${title}\n\n${sections.join('\n\n')}\n`;
}

async function loadConversations(inputPath) {
  const input = path.resolve(inputPath);
  const info = await stat(input);
  let json;
  if (info.isDirectory()) {
    json = await readFile(path.join(input, 'conversations.json'), 'utf8');
  } else if (path.extname(input).toLowerCase() === '.zip') {
    const archive = new Uint8Array(await readFile(input));
    const files = unzipSync(archive, {
      filter: (entry) => /(^|\/)conversations\.json$/i.test(entry.name),
    });
    const match = Object.entries(files).find(([name]) => /(^|\/)conversations\.json$/i.test(name));
    if (!match) throw new Error('This ZIP does not contain conversations.json. Choose the ZIP downloaded from OpenAI.');
    json = strFromU8(match[1]);
  } else {
    json = await readFile(input, 'utf8');
  }
  const parsed = JSON.parse(json);
  if (!Array.isArray(parsed)) throw new Error('conversations.json is not in the expected OpenAI export format.');
  return parsed;
}

async function markdownFiles(root) {
  const found = [];
  async function walk(folder) {
    let entries;
    try { entries = await readdir(folder, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(folder, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) found.push(full);
    }
  }
  await walk(root);
  return found;
}

async function existingConversationIds(vaultRoot) {
  const ids = new Set();
  for (const file of await markdownFiles(vaultRoot)) {
    let text;
    try { text = await readFile(file, 'utf8'); } catch { continue; }
    const line = text.split('\n').find((value) => value.startsWith(SOURCE_LINE));
    if (!line) continue;
    const raw = line.slice(SOURCE_LINE.length).trim();
    try { ids.add(JSON.parse(raw)); } catch { ids.add(raw.replace(/^['"]|['"]$/g, '')); }
  }
  return ids;
}

async function availablePath(folder, baseName, reserved) {
  for (let suffix = 1; ; suffix += 1) {
    const name = suffix === 1 ? `${baseName}.md` : `${baseName}-${suffix}.md`;
    const target = path.join(folder, name);
    if (reserved.has(target)) continue;
    try { await stat(target); } catch { reserved.add(target); return target; }
  }
}

export async function importOpenAIExport({ inputPath, vaultRoot, dryRun = false }) {
  if (!inputPath) throw new Error('Choose an OpenAI export ZIP or conversations.json file.');
  if (!vaultRoot) throw new Error('Choose a Personal Vault folder with --vault or PERSONAL_VAULT_ROOT.');
  const resolvedVault = path.resolve(vaultRoot.replace(/^~(?=$|\/)/, os.homedir()));
  const info = await stat(resolvedVault);
  if (!info.isDirectory()) throw new Error('The Personal Vault path is not a folder.');

  const conversations = await loadConversations(inputPath);
  const existingIds = await existingConversationIds(resolvedVault);
  const reserved = new Set();
  const importedAt = new Date().toISOString();
  const files = [];
  let skipped = 0;

  const ordered = [...conversations].sort((left, right) => Number(left.create_time || 0) - Number(right.create_time || 0));
  for (const conversation of ordered) {
    const id = String(conversation.id || conversation.conversation_id || '').trim();
    if (id && existingIds.has(id)) { skipped += 1; continue; }
    const created = safeDate(conversation.create_time);
    const year = String(created.getUTCFullYear()).padStart(4, '0');
    const month = String(created.getUTCMonth() + 1).padStart(2, '0');
    const day = String(created.getUTCDate()).padStart(2, '0');
    const folder = path.join(resolvedVault, 'raw', year, month);
    const target = await availablePath(folder, `${year}-${month}-${day}-openai-${slugify(conversation.title)}`, reserved);
    const content = renderConversation(conversation, importedAt);
    if (!dryRun) {
      await mkdir(folder, { recursive: true });
      await writeFile(target, content, { encoding: 'utf8', flag: 'wx' });
    }
    files.push(path.relative(resolvedVault, target).split(path.sep).join('/'));
    if (id) existingIds.add(id);
  }

  return { imported: files.length, skipped, total: conversations.length, dryRun, files };
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isCli) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) { console.log(usage()); process.exit(0); }
    const result = await importOpenAIExport(options);
    if (options.json) console.log(JSON.stringify(result));
    else {
      console.log(`${result.dryRun ? 'Would import' : 'Imported'} ${result.imported} conversation${result.imported === 1 ? '' : 's'}; skipped ${result.skipped} already present.`);
      for (const file of result.files) console.log(`- ${file}`);
    }
  } catch (error) {
    console.error(`OpenAI import failed: ${error instanceof Error ? error.message : String(error)}`);
    console.error('\n' + usage());
    process.exitCode = 1;
  }
}
