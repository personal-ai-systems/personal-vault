#!/usr/bin/env node
// Optional client installation, not part of the Vault file engine.
import { readFile, writeFile, mkdir, realpath, lstat, rename } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateConfig } from '../integrations/codex/hook.mjs';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
async function optional(file) {
  try { return await readFile(file, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function safeDirectory(directory) {
  const absolute = path.resolve(directory);
  let current = path.parse(absolute).root;
  for (const part of absolute.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try { if ((await lstat(current)).isSymbolicLink()) throw new Error('Installation directory must not traverse symbolic links.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}
async function atomic(file, text) {
  const temporary = `${file}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(temporary, text, { mode: 0o600, flag: 'wx' });
  await rename(temporary, file);
}

export async function installCodexMemory({ root, codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), apply = false, capture, bindings } = {}) {
  if (!root) throw new Error('Choose an existing Vault with --root.');
  const vaultRoot = await realpath(root);
  if (!(await lstat(vaultRoot)).isDirectory()) throw new Error('Vault root must be a directory.');
  const home = path.resolve(codexHome);
  const integration = path.join(home, 'personal-vault');
  await safeDirectory(integration);
  const hooksPath = path.join(home, 'hooks.json');
  const configPath = path.join(integration, 'config.json');
  const receiptPath = path.join(integration, 'installation.json');
  for (const file of [hooksPath, configPath, receiptPath]) {
    try { if ((await lstat(file)).isSymbolicLink()) throw new Error('Refusing to replace a symbolic-link configuration.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const [priorHooks, priorConfig, priorReceipt] = await Promise.all([optional(hooksPath), optional(configPath), optional(receiptPath)]);
  const hooks = priorHooks === null ? { hooks: {} } : JSON.parse(priorHooks);
  if (!hooks || typeof hooks !== 'object' || Array.isArray(hooks) || !hooks.hooks || typeof hooks.hooks !== 'object' || Array.isArray(hooks.hooks)) throw new Error('Existing hooks.json is not a supported hooks object; no files changed.');
  const previous = priorReceipt ? JSON.parse(priorReceipt) : {};
  const existingConfig = priorConfig ? JSON.parse(priorConfig) : {};
  const config = validateConfig({ ...existingConfig, version: 1, vaultRoot,
    timeZone: existingConfig.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone,
    maxContextChars: existingConfig.maxContextChars || 10000,
    ...(bindings ? { bindings } : {}),
    capture: { ...(existingConfig.capture || {}), enabled: capture === undefined ? existingConfig.capture?.enabled === true : capture }
  });
  const hookScript = path.join(repository, 'integrations/codex/hook.mjs');
  if (!(await lstat(hookScript)).isFile()) throw new Error('The Codex hook script is missing; no files changed.');
  const command = `${quote(process.execPath)} ${quote(hookScript)} --config ${quote(configPath)}`;
  const managed = new Set([command, ...(previous.commands || [])]);
  for (const [event, groups] of Object.entries(hooks.hooks)) {
    if (!Array.isArray(groups) || groups.some((group) => !Array.isArray(group.hooks))) throw new Error(`Malformed existing ${event} hooks; no files changed.`);
    hooks.hooks[event] = groups.map((group) => ({ ...group, hooks: group.hooks.filter((hook) => !managed.has(hook.command)) })).filter((group) => group.hooks.length);
  }
  const definitions = [
    ['SessionStart', 'startup|resume|clear|compact|fork', 'Loading Personal Vault context'],
    ['UserPromptSubmit', undefined, 'Reading relevant Personal Vault memory'],
    ['Stop', undefined, 'Saving conversation and checking memory disclosure'],
    ['PreToolUse', '(^|__)request_user_input(_async)?$', 'Checking memory disclosure before a question']
  ];
  for (const [event, matcher, statusMessage] of definitions) {
    const handler = { type: 'command', command, timeout: 20, statusMessage, ...(event === 'SessionStart' || event === 'UserPromptSubmit' ? { additionalContextLimit: 4000 } : {}) };
    (hooks.hooks[event] ||= []).push({ ...(matcher ? { matcher } : {}), hooks: [handler] });
  }
  const hooksText = `${JSON.stringify(hooks, null, 2)}\n`;
  const configText = `${JSON.stringify(config, null, 2)}\n`;
  const changes = [[hooksPath, priorHooks, hooksText], [configPath, priorConfig, configText]].filter(([, prior, next]) => prior !== next);
  const result = { mode: apply ? 'installed' : 'preview', vaultRoot, hooksPath, configPath,
    captureEnabled: config.capture.enabled, changedFiles: changes.map(([file]) => file),
    events: definitions.map(([event]) => event), command,
    activation: 'Review and trust the exact hooks in Codex Settings > Hooks or /hooks. Installation does not grant trust or prove execution.' };
  if (!apply) return result;
  await mkdir(integration, { recursive: true, mode: 0o700 });
  const backups = [...(previous.backups || [])];
  // Preserve exact previous bytes before making a narrow change. Unrelated hooks survive.
  for (const [file, prior] of changes) if (prior !== null) {
    const backup = path.join(integration, `${path.basename(file)}.before-${hash(prior).slice(0, 12)}`);
    if (await optional(backup) === null) await writeFile(backup, prior, { flag: 'wx', mode: 0o600 });
    if (!backups.includes(backup)) backups.push(backup);
  }
  for (const [file, , next] of changes) await atomic(file, next);
  const receipt = { version: 1, repository, commands: [command], hooksPath, configPath, backups,
    installedAt: changes.length ? new Date().toISOString() : previous.installedAt || new Date().toISOString(),
    trust: 'Not changed by installer. Inspect the current host hooks/list result.' };
  const receiptText = `${JSON.stringify(receipt, null, 2)}\n`;
  if (receiptText !== priorReceipt) await atomic(receiptPath, receiptText);
  return { ...result, receiptPath };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = {};
    const args = process.argv.slice(2);
    while (args.length) {
      const key = args.shift();
      if (key === '--apply') options.apply = true;
      else if (key === '--capture') options.capture = true;
      else if (key === '--no-capture') options.capture = false;
      else if (['--root', '--codex-home', '--bindings'].includes(key)) {
        const value = args.shift();
        if (!value || value.startsWith('--')) throw new Error(`${key} needs a value.`);
        if (key === '--bindings') options.bindings = JSON.parse(await readFile(value, 'utf8'));
        else options[key === '--root' ? 'root' : 'codexHome'] = value;
      } else throw new Error('Use --root PATH [--codex-home PATH] [--bindings JSON_FILE] [--capture|--no-capture] [--apply]. Without --apply this only previews.');
    }
    process.stdout.write(`${JSON.stringify(await installCodexMemory(options), null, 2)}\n`);
  } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
