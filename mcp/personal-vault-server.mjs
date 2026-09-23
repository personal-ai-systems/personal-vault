#!/usr/bin/env node

// Personal Vault MCP 0.6.0 — one server, one endpoint.
//
// It replaces the previous two-process setup:
//   8788  personal-vault/mcp/personal-vault-server.mjs      (generic file API)
//   8787  personal-dashboard/mcp/personal-assistant-server.mjs (capture facade that
//                                                              proxied to 8788 over MCP)
// The facade is gone: capture tools call the file functions in-process, so there is
// no loopback MCP hop and no second port to keep in sync.
//
// One endpoint (/mcp) exposes one set of tool names, all underscored. Several
// model providers reject dots in function names before the model is ever
// called, so a tool name here never contains a dot. Callers that still send the
// old dotted names (vault.files.read) must migrate to vault_files_read.
//
// Local use is open. Remote use is opt-in: set MCP_SERVICE_TOKENS or
// MCP_GOOGLE_AUTH=true and every non-loopback request must then carry credentials.
// MCP_TRUST_LOCALHOST=true keeps loopback callers (local clients, health checks, scripts)
// credential-free, because anything running as this user can read the Vault files
// directly anyway. The tunnel also arrives from loopback, so forwarded headers
// disqualify the shortcut and remote callers stay challenged.

import { createServer } from 'node:http';
import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { lstatSync, realpathSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { timingSafeEqual } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { z } from 'zod';

const VAULT_ROOT = realpathSync(path.resolve(process.env.PERSONAL_VAULT_ROOT || path.join(process.env.HOME || '', 'personal-vault')));
const HOST = process.env.MCP_HOST || '127.0.0.1';
const PORT = Number(process.env.MCP_PORT || process.env.PORT || 8788);
const MCP_PATH = '/mcp';
const SERVER_NAME = 'personal-vault';
const SERVER_VERSION = '0.6.0';
const TEXT_EXTENSIONS = new Set(['.md', '.txt', '.json', '.jsonl', '.csv', '.yaml', '.yml']);

const PUBLIC_URL = (process.env.MCP_PUBLIC_BASE_URL || '').replace(/\/$/, '');
const GOOGLE_AUTH_ENABLED = process.env.MCP_GOOGLE_AUTH === 'true';
const SERVICE_TOKENS = new Set((process.env.MCP_SERVICE_TOKENS || '').split(',').map((value) => value.trim()).filter(Boolean));
const AUTH_ENABLED = GOOGLE_AUTH_ENABLED || SERVICE_TOKENS.size > 0;
const ALLOWED_EMAILS = new Set((process.env.GOOGLE_ALLOWED_EMAILS || '').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean));
const ALLOWED_DOMAINS = new Set((process.env.GOOGLE_ALLOWED_DOMAINS || '').split(',').map((value) => value.trim().toLowerCase().replace(/^@/, '')).filter(Boolean));
const CHALLENGE_MODE = (process.env.MCP_AUTH_CHALLENGE_MODE || 'http-401').trim().toLowerCase() === 'in-band' ? 'in-band' : 'http-401';
const TRUST_LOCALHOST = process.env.MCP_TRUST_LOCALHOST === 'true';
// The MCP SDK builds each tool handler's requestInfo from the raw socket headers, so a
// loopback decision made in the HTTP handler cannot be expressed by rewriting
// req.headers. Request-scoped storage carries it into the handlers instead.
const requestContext = new AsyncLocalStorage();
const GOOGLE_USERINFO_URL = process.env.GOOGLE_USERINFO_URL || 'https://www.googleapis.com/oauth2/v3/userinfo';
const OAUTH_SCOPES = ['openid', 'email', 'profile'];
const attachmentSchema = z.object({ name: z.string().optional(), dataBase64: z.string().optional(), dataUrl: z.string().optional(), alt: z.string().optional(), caption: z.string().optional() });

// ---------------------------------------------------------------- vault paths

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
  // Validate the path before the extension, so an escaping path reports the real reason.
  const clean = cleanPath(relative);
  if (!textFile(clean)) throw new Error('Only readable text files can be opened with this tool.');
  const target = fullPath(clean);
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
      if (error.code === 'EEXIST') throw new Error('A file already exists at this path. Use vault_files_update to change it.');
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
  const assetRelative = `${source.slice(0, -3)}.assets/${safeFileName(name)}`;
  const assetFile = fullPath(assetRelative);
  await mkdir(path.dirname(assetFile), { recursive: true });
  await writeFile(assetFile, bytes, { flag: 'wx' }).catch((error) => {
    if (error.code === 'EEXIST') throw new Error('An attachment already exists with this name. Choose another name.');
    throw error;
  });
  return { markdownPath: source, assetPath: assetRelative, sizeBytes: bytes.length };
}

// ------------------------------------------------------------------ capture

function today() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
function slug(value) { return String(value).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70) || 'capture'; }

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

// --------------------------------------------------------------------- auth

function publicUrl(req) { return PUBLIC_URL || `http://${req?.headers?.host || `localhost:${PORT}`}`; }
function challengeValue(host) {
  const base = PUBLIC_URL || `https://${host || `localhost:${PORT}`}`;
  return `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource", scope="${OAUTH_SCOPES.join(' ')}"`;
}
function authMessage() {
  return SERVICE_TOKENS.size ? 'Provide a valid service token or sign in with the allowed Google account before accessing private Vault files.' : 'Sign in with the allowed Google account before accessing private Vault files.';
}
function authError(req) {
  const challenge = GOOGLE_AUTH_ENABLED ? { 'mcp/www_authenticate': challengeValue(req?.requestInfo?.headers?.host) } : {};
  return { isError: true, content: [{ type: 'text', text: authMessage() }], _meta: challenge };
}
function bearerToken(header) {
  const match = /^Bearer\s+(.+)$/i.exec(String(header || ''));
  return match ? match[1].trim() : null;
}
function fromTrustedLoopback(req) {
  const proxied = req.headers['x-forwarded-for'] || req.headers['x-forwarded-proto'] || req.headers['x-real-ip'] || req.headers.forwarded;
  if (proxied) return false;
  const remote = req.socket?.remoteAddress || '';
  return remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
}
function matchesServiceToken(token) {
  if (!SERVICE_TOKENS.size) return false;
  const candidate = Buffer.from(String(token));
  let matched = false;
  for (const known of SERVICE_TOKENS) {
    const expected = Buffer.from(known);
    if (expected.length === candidate.length && timingSafeEqual(expected, candidate)) matched = true;
  }
  return matched;
}
function emailAllowed(email) {
  const value = String(email || '').trim().toLowerCase();
  if (!value.includes('@')) return false;
  if (!ALLOWED_EMAILS.size && !ALLOWED_DOMAINS.size) return true;
  if (ALLOWED_EMAILS.has(value)) return true;
  return ALLOWED_DOMAINS.has(value.slice(value.lastIndexOf('@') + 1));
}
async function tokenAllowed(token) {
  if (!token) return false;
  if (matchesServiceToken(token)) return true;
  if (!GOOGLE_AUTH_ENABLED) return false;
  const response = await fetch(GOOGLE_USERINFO_URL, { headers: { authorization: `Bearer ${token}` } }).catch(() => null);
  if (!response?.ok) return false;
  const claims = await response.json().catch(() => ({}));
  return emailAllowed(claims.email);
}
async function allowed(extra) {
  if (!AUTH_ENABLED) return true;
  if (requestContext.getStore()?.trustedLoopback) return true;
  return tokenAllowed(bearerToken(extra?.requestInfo?.headers?.authorization));
}
function sendAuthChallenge(res, host) {
  const headers = { 'content-type': 'application/json' };
  headers['www-authenticate'] = GOOGLE_AUTH_ENABLED ? challengeValue(host) : 'Bearer';
  res.writeHead(401, headers);
  res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32001, message: authMessage() } }));
}

// -------------------------------------------------------------------- server

function createVaultServer() {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { instructions: 'Personal Vault is a simple, readable folder of Markdown files and attachments. File tools browse and edit that folder; capture tools save new notes into it.' });
  const fileToolName = (operation) => `vault_files_${operation}`;

  // Tool names are always underscored: several model providers reject dots in
  // function names before the model is ever called.
  server.registerTool(fileToolName('list'), { title: 'List files', inputSchema: { path: z.string().optional(), recursive: z.boolean().optional(), limit: z.number().int().min(1).max(1000).optional() } }, async ({ path: target = '', recursive = false, limit = 200 }, extra) => {
    if (!(await allowed(extra))) return authError(extra);
    try { const items = await list(target, recursive, limit); return { content: [{ type: 'text', text: `Found ${items.length} item(s).` }], structuredContent: { path: cleanPath(target), items } }; }
    catch (error) { return { isError: true, content: [{ type: 'text', text: error.message }] }; }
  });
  server.registerTool(fileToolName('read'), { title: 'Read a text file', inputSchema: { path: z.string().min(1) } }, async ({ path: target }, extra) => {
    if (!(await allowed(extra))) return authError(extra);
    try { return { content: [{ type: 'text', text: `Read ${target}.` }], structuredContent: await readText(target) }; }
    catch (error) { return { isError: true, content: [{ type: 'text', text: error.message }] }; }
  });
  server.registerTool(fileToolName('create'), { title: 'Create a text file', inputSchema: { path: z.string().min(1), content: z.string() } }, async ({ path: target, content }, extra) => {
    if (!(await allowed(extra))) return authError(extra);
    try { return { content: [{ type: 'text', text: `Created ${target}.` }], structuredContent: await writeText(target, content) }; }
    catch (error) { return { isError: true, content: [{ type: 'text', text: error.message }] }; }
  });
  server.registerTool(fileToolName('update'), { title: 'Update a text file', inputSchema: { path: z.string().min(1), content: z.string() } }, async ({ path: target, content }, extra) => {
    if (!(await allowed(extra))) return authError(extra);
    try { return { content: [{ type: 'text', text: `Updated ${target}.` }], structuredContent: await writeText(target, content, true) }; }
    catch (error) { return { isError: true, content: [{ type: 'text', text: error.message }] }; }
  });
  server.registerTool(fileToolName('archive'), { title: 'Archive a file', inputSchema: { path: z.string().min(1) } }, async ({ path: target }, extra) => {
    if (!(await allowed(extra))) return authError(extra);
    try { return { content: [{ type: 'text', text: `Archived ${target}.` }], structuredContent: await archive(target) }; }
    catch (error) { return { isError: true, content: [{ type: 'text', text: error.message }] }; }
  });
  server.registerTool(fileToolName('restore'), { title: 'Restore an archived file', inputSchema: { path: z.string().min(1) } }, async ({ path: target }, extra) => {
    if (!(await allowed(extra))) return authError(extra);
    try { return { content: [{ type: 'text', text: `Restored ${target}.` }], structuredContent: await restore(target) }; }
    catch (error) { return { isError: true, content: [{ type: 'text', text: error.message }] }; }
  });
  server.registerTool(fileToolName('search'), { title: 'Search text files', inputSchema: { query: z.string().min(1), limit: z.number().int().min(1).max(100).optional() } }, async ({ query, limit = 20 }, extra) => {
    if (!(await allowed(extra))) return authError(extra);
    try { const matches = await search(query, limit); return { content: [{ type: 'text', text: `Found ${matches.length} match(es).` }], structuredContent: { query, matches } }; }
    catch (error) { return { isError: true, content: [{ type: 'text', text: error.message }] }; }
  });
  server.registerTool(fileToolName('attach'), { title: 'Save an attachment beside Markdown', inputSchema: { markdownPath: z.string().min(1), name: z.string().min(1), dataBase64: z.string().min(1) } }, async ({ markdownPath, name, dataBase64 }, extra) => {
    if (!(await allowed(extra))) return authError(extra);
    try { return { content: [{ type: 'text', text: `Saved ${name}.` }], structuredContent: await attach(markdownPath, name, dataBase64) }; }
    catch (error) { return { isError: true, content: [{ type: 'text', text: error.message }] }; }
  });

  // Capture tools — moved here from the retired 8787 facade.
  server.registerTool('capture_note', { title: 'capture_note', description: 'Save a readable Markdown note in the Vault.', inputSchema: { input: z.string().min(1), title: z.string().optional(), projectId: z.string().optional(), intent: z.string().optional(), attachments: z.array(attachmentSchema).optional() } }, async ({ input, title, projectId, intent = 'note', attachments = [] }, extra) => {
    if (!(await allowed(extra))) return authError(extra);
    try {
      const titleText = title || `Capture - ${today()}`;
      const filePath = await capturePath(titleText);
      let markdown = ['---', `title: ${JSON.stringify(titleText)}`, `created: ${JSON.stringify(new Date().toISOString())}`, `intent: ${JSON.stringify(intent)}`, projectId ? `project: ${JSON.stringify(projectId)}` : '', '---', '', `# ${titleText}`, '', input, ''].filter(Boolean).join('\n');
      await writeText(filePath, markdown);
      const assets = [];
      for (const attachment of attachments) {
        const asset = await attach(filePath, attachment.name || 'attachment', dataForAttachment(attachment));
        const relative = `./${path.basename(filePath, '.md')}.assets/${path.basename(asset.assetPath)}`;
        markdown += `\n![${String(attachment.alt || attachment.name || 'attachment').replace(/[\[\]\r\n]/g, ' ')}](${relative})\n${attachment.caption ? `\n_${attachment.caption}_\n` : ''}`;
        assets.push(asset);
      }
      if (assets.length) await writeText(filePath, markdown, true);
      const proposalSet = { capturePath: filePath, proposals: [{ id: 'review-capture', label: 'Review this capture before changing plans', preview: 'The note is saved. Decide together whether it should affect a plan.' }], questions: [] };
      return { content: [{ type: 'text', text: `Saved readable Markdown: ${filePath}` }], structuredContent: { capturePath: filePath, path: filePath, title: titleText, assetCount: assets.length, assets, proposalSet } };
    } catch (error) { return { isError: true, content: [{ type: 'text', text: error.message }] }; }
  });
  server.registerTool('capture_asset', { title: 'capture_asset', description: 'Save files beside an existing Markdown capture.', inputSchema: { capturePath: z.string().min(1), attachments: z.array(attachmentSchema).min(1) } }, async ({ capturePath: target, attachments }, extra) => {
    if (!(await allowed(extra))) return authError(extra);
    try {
      let markdown = (await readText(target)).content;
      const assets = [];
      for (const attachment of attachments) {
        const asset = await attach(target, attachment.name || 'attachment', dataForAttachment(attachment));
        markdown += `\n![${String(attachment.alt || attachment.name || 'attachment').replace(/[\[\]\r\n]/g, ' ')}](./${path.basename(target, '.md')}.assets/${path.basename(asset.assetPath)})\n`;
        assets.push(asset);
      }
      await writeText(target, markdown, true);
      return { content: [{ type: 'text', text: `Saved ${assets.length} attachment(s) beside ${target}.` }], structuredContent: { capturePath: target, assetCount: assets.length, assets } };
    } catch (error) { return { isError: true, content: [{ type: 'text', text: error.message }] }; }
  });
  // search_vault kept as the historical name of vault_files_search.
  server.registerTool('search_vault', { title: 'search_vault', description: 'Search readable Vault files.', inputSchema: { query: z.string().min(2), limit: z.number().int().min(1).max(20).optional() } }, async ({ query, limit = 5 }, extra) => {
    if (!(await allowed(extra))) return authError(extra);
    try { const matches = await search(query, limit); return { content: [{ type: 'text', text: matches.length ? `Found ${matches.length} match(es).` : 'No matches found.' }], structuredContent: { query, matches } }; }
    catch (error) { return { isError: true, content: [{ type: 'text', text: error.message }] }; }
  });
  server.registerTool('get_today_plan', { title: 'get_today_plan', description: 'Read the current Today plan file.', inputSchema: {} }, async (_args, extra) => {
    if (!(await allowed(extra))) return authError(extra);
    try {
      const file = await readText('structured/plans/daily-projection.json');
      const plan = JSON.parse(file.content);
      const tasks = (plan.tasks || []).filter((task) => task.date === today() && task.status !== 'dropped');
      return { content: [{ type: 'text', text: tasks.length ? `Today:\n${tasks.map((task) => `- ${task.title}`).join('\n')}` : 'No dated commitments are currently projected.' }], structuredContent: { date: today(), tasks, sourcePath: file.path } };
    } catch (error) { return { isError: true, content: [{ type: 'text', text: `Could not read Today plan: ${error.message}` }] }; }
  });
  server.registerTool('get_capture_review', { title: 'get_capture_review', description: 'Return the saved capture path for a conversational review.', inputSchema: { capturePath: z.string().min(1) } }, async ({ capturePath: target }, extra) => (await allowed(extra)) ? ({ content: [{ type: 'text', text: `Review ${target} with the user before changing any plan.` }], structuredContent: { capturePath: target, status: 'review-in-conversation' } }) : authError(extra));
  server.registerTool('apply_capture_action', { title: 'apply_capture_action', description: 'Record that a user approved a proposal; the Assistant should then make a clear, separate change.', inputSchema: { capturePath: z.string().min(1), proposalId: z.string() } }, async ({ capturePath: target, proposalId }, extra) => (await allowed(extra)) ? ({ content: [{ type: 'text', text: `The user approved ${proposalId} for ${target}. Make the next Assistant change explicitly and explain it.` }], structuredContent: { capturePath: target, proposalId, approved: true } }) : authError(extra));

  return server;
}

const httpServer = createServer(async (req, res) => {
  if (!req.url) return void res.writeHead(400).end('Missing URL');
  const url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);
  if (req.method === 'GET' && url.pathname === '/healthz') return void res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ status: 'ok', server: SERVER_NAME, version: SERVER_VERSION, mcpEndpoint: `${publicUrl(req)}${MCP_PATH}`, root: VAULT_ROOT, bind: HOST, storage: 'readable-files', authentication: [GOOGLE_AUTH_ENABLED ? 'google-oauth' : '', SERVICE_TOKENS.size ? `service-token(${SERVICE_TOKENS.size})` : '', TRUST_LOCALHOST ? 'loopback-trusted' : ''].filter(Boolean).join('+') || 'disabled', googleAllowlist: [ALLOWED_EMAILS.size ? `email(${ALLOWED_EMAILS.size})` : '', ALLOWED_DOMAINS.size ? `domain(${ALLOWED_DOMAINS.size})` : ''].filter(Boolean).join('+') || 'any-verified-google-account', challengeMode: AUTH_ENABLED ? CHALLENGE_MODE : 'none' }));
  if (req.method === 'GET' && url.pathname === '/status') return void res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ status: 'ok', server: SERVER_NAME, version: SERVER_VERSION, root: VAULT_ROOT, bind: HOST, mcpEndpoint: `http://${HOST}:${PORT}${MCP_PATH}` }));
  if (req.method === 'GET' && url.pathname === '/.well-known/oauth-protected-resource') return void res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ resource: publicUrl(req), authorization_servers: ['https://accounts.google.com'], scopes_supported: OAUTH_SCOPES }));
  if (req.method === 'OPTIONS' && url.pathname === MCP_PATH) return void res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, GET, DELETE, OPTIONS', 'Access-Control-Allow-Headers': 'content-type, mcp-session-id, authorization', 'Access-Control-Expose-Headers': 'Mcp-Session-Id' }).end();
  if (url.pathname !== MCP_PATH || !['POST', 'GET', 'DELETE'].includes(req.method || '')) return void res.writeHead(404).end('Not Found');
  const trustedLoopback = TRUST_LOCALHOST && fromTrustedLoopback(req) && !req.headers.authorization;
  if (!trustedLoopback && AUTH_ENABLED && CHALLENGE_MODE === 'http-401') {
    const authorized = await tokenAllowed(bearerToken(req.headers.authorization)).catch(() => false);
    if (!authorized) return void sendAuthChallenge(res, req.headers.host);
  }
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');
  const server = createVaultServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => { transport.close(); server.close(); });
  try { await requestContext.run({ trustedLoopback }, async () => { await server.connect(transport); await transport.handleRequest(req, res); }); }
  catch (error) { console.error('MCP request failed:', error); if (!res.headersSent) res.writeHead(500).end('Internal server error'); }
});

httpServer.listen(PORT, HOST, () => console.log(`Personal Vault MCP ${SERVER_VERSION} listening on http://${HOST}:${PORT}${MCP_PATH} (root ${VAULT_ROOT}, auth ${AUTH_ENABLED ? 'on' : 'off'})`));
