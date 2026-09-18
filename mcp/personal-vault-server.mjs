#!/usr/bin/env node

import { createServer } from 'node:http';
import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { lstatSync, realpathSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

const VAULT_ROOT = realpathSync(path.resolve(process.env.PERSONAL_VAULT_ROOT || path.join(process.env.HOME || '', 'personal-vault')));
const HOST = process.env.MCP_HOST || '127.0.0.1';
const PORT = Number(process.env.MCP_PORT || process.env.PORT || 8788);
const MCP_PATH = '/mcp';
const TEXT_EXTENSIONS = new Set(['.md', '.txt', '.json', '.jsonl', '.csv', '.yaml', '.yml']);

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

async function info(filePath) {
  const details = await stat(filePath);
  return { path: relativePath(filePath), kind: details.isDirectory() ? 'folder' : 'file', sizeBytes: details.size, modifiedAt: details.mtime.toISOString() };
}

async function list(relative = '', recursive = false, limit = 200) {
  const root = fullPath(relative);
  const entries = [];
  async function walk(directory) {
    if (entries.length >= limit) return;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink() || !visibleName(entry.name) || entries.length >= limit) continue;
      const candidate = path.join(directory, entry.name);
      entries.push(await info(candidate));
      if (recursive && entry.isDirectory()) await walk(candidate);
    }
  }
  await walk(root);
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

async function readText(relative) {
  if (!textFile(relative)) throw new Error('Only readable text files can be opened with this tool.');
  const target = fullPath(relative);
  return { ...(await info(target)), content: await readFile(target, 'utf8') };
}

async function writeText(relative, content, overwrite = false) {
  if (!textFile(relative)) throw new Error('Personal Vault writes readable text files only.');
  const target = fullPath(relative);
  await mkdir(path.dirname(target), { recursive: true });
  if (overwrite) {
    // r+ refuses to create an absent file. Preserve inode and do not truncate until opened.
    const { open } = await import('node:fs/promises');
    const handle = await open(target, 'r+');
    try { await handle.writeFile(content, 'utf8'); await handle.truncate(Buffer.byteLength(content)); }
    finally { await handle.close(); }
  } else {
    await writeFile(target, content, { encoding: 'utf8', flag: 'wx' }).catch(error => {
      if (error.code === 'EEXIST') throw new Error('A file already exists at this path. Use vault.files.update to change it.');
      throw error;
    });
  }
  return readText(relative);
}

function archivePath(relative) {
  const date = new Date().toISOString().slice(0, 10);
  return `archive/${date}/${cleanPath(relative)}`;
}

async function exists(target) {
  return stat(target).then(() => true).catch((error) => error.code === 'ENOENT' ? false : Promise.reject(error));
}

async function moveNoteWithAssets(sourceRelative, destinationRelative) {
  const source = fullPath(sourceRelative);
  const destination = fullPath(destinationRelative);
  const sourceAssetsRelative = path.extname(sourceRelative).toLowerCase() === '.md' ? `${sourceRelative.slice(0, -3)}.assets` : null;
  const destinationAssetsRelative = sourceAssetsRelative ? `${destinationRelative.slice(0, -3)}.assets` : null;
  const sourceAssets = sourceAssetsRelative ? fullPath(sourceAssetsRelative) : null;
  const destinationAssets = destinationAssetsRelative ? fullPath(destinationAssetsRelative) : null;
  const hasAssets = sourceAssets ? await exists(sourceAssets) : false;
  if (await exists(destination) || (hasAssets && await exists(destinationAssets))) throw new Error('A file already exists at the destination.');
  await mkdir(path.dirname(destination), { recursive: true });
  if (hasAssets) await mkdir(path.dirname(destinationAssets), { recursive: true });
  await rename(source, destination);
  try {
    if (hasAssets) await rename(sourceAssets, destinationAssets);
  } catch (error) {
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
  const sourceFile = fullPath(source);
  const assetRelative = `${source.slice(0, -3)}.assets/${safeFileName(name)}`;
  const assetFile = fullPath(assetRelative);
  await mkdir(path.dirname(assetFile), { recursive: true });
  await writeFile(assetFile, bytes, { flag: 'wx' }).catch((error) => {
    if (error.code === 'EEXIST') throw new Error('An attachment already exists with this name. Choose another name.');
    throw error;
  });
  return { markdownPath: source, assetPath: assetRelative, sizeBytes: bytes.length };
}

function createVaultServer() {
  const server = new McpServer({ name: 'personal-vault', version: '0.2.0' }, { instructions: 'Personal Vault is a simple, readable folder of Markdown files and attachments. The API is a safe way to browse and edit that folder.' });
  server.registerTool('vault.files.list', { title: 'List files', inputSchema: { path: z.string().optional(), recursive: z.boolean().optional(), limit: z.number().int().min(1).max(1000).optional() } }, async ({ path: target = '', recursive = false, limit = 200 }) => ({ content: [{ type: 'text', text: `Found ${await list(target, recursive, limit).then((items) => items.length)} item(s).` }], structuredContent: { path: cleanPath(target), items: await list(target, recursive, limit) } }));
  server.registerTool('vault.files.read', { title: 'Read a text file', inputSchema: { path: z.string().min(1) } }, async ({ path: target }) => ({ content: [{ type: 'text', text: `Read ${target}.` }], structuredContent: await readText(target) }));
  server.registerTool('vault.files.create', { title: 'Create a text file', inputSchema: { path: z.string().min(1), content: z.string() } }, async ({ path: target, content }) => ({ content: [{ type: 'text', text: `Created ${target}.` }], structuredContent: await writeText(target, content) }));
  server.registerTool('vault.files.update', { title: 'Update a text file', inputSchema: { path: z.string().min(1), content: z.string() } }, async ({ path: target, content }) => ({ content: [{ type: 'text', text: `Updated ${target}.` }], structuredContent: await writeText(target, content, true) }));
  server.registerTool('vault.files.archive', { title: 'Archive a file', inputSchema: { path: z.string().min(1) } }, async ({ path: target }) => ({ content: [{ type: 'text', text: `Archived ${target}.` }], structuredContent: await archive(target) }));
  server.registerTool('vault.files.restore', { title: 'Restore an archived file', inputSchema: { path: z.string().min(1) } }, async ({ path: target }) => ({ content: [{ type: 'text', text: `Restored ${target}.` }], structuredContent: await restore(target) }));
  server.registerTool('vault.files.search', { title: 'Search text files', inputSchema: { query: z.string().min(1), limit: z.number().int().min(1).max(100).optional() } }, async ({ query, limit = 20 }) => ({ content: [{ type: 'text', text: `Found ${(await search(query, limit)).length} match(es).` }], structuredContent: { query, matches: await search(query, limit) } }));
  server.registerTool('vault.files.attach', { title: 'Save an attachment beside Markdown', inputSchema: { markdownPath: z.string().min(1), name: z.string().min(1), dataBase64: z.string().min(1) } }, async ({ markdownPath, name, dataBase64 }) => ({ content: [{ type: 'text', text: `Saved ${name}.` }], structuredContent: await attach(markdownPath, name, dataBase64) }));
  return server;
}

const httpServer = createServer(async (req, res) => {
  if (process.env.PERSONAL_VAULT_TOKEN && req.headers.authorization !== `Bearer ${process.env.PERSONAL_VAULT_TOKEN}`) return void res.writeHead(401).end('Unauthorized');
  if (!req.url) return void res.writeHead(400).end('Missing URL');
  const url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);
  if (req.method === 'GET' && url.pathname === '/status') return void res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ status: 'ok', server: 'personal-vault', version: '0.2.0', root: VAULT_ROOT, bind: HOST, mcpEndpoint: `http://${HOST}:${PORT}${MCP_PATH}` }));
  if (req.method === 'OPTIONS' && url.pathname === MCP_PATH) return void res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, GET, DELETE, OPTIONS', 'Access-Control-Allow-Headers': 'content-type, mcp-session-id', 'Access-Control-Expose-Headers': 'Mcp-Session-Id' }).end();
  if (url.pathname !== MCP_PATH || !['POST', 'GET', 'DELETE'].includes(req.method || '')) return void res.writeHead(404).end('Not Found');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');
  const server = createVaultServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => { transport.close(); server.close(); });
  try { await server.connect(transport); await transport.handleRequest(req, res); }
  catch (error) { console.error('MCP request failed:', error); if (!res.headersSent) res.writeHead(500).end('Internal server error'); }
});

httpServer.listen(PORT, HOST, () => console.log(`Personal Vault MCP listening on http://${HOST}:${PORT}${MCP_PATH}`));
