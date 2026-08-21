#!/usr/bin/env node

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const PATTERNS = [
  { name: 'openai-api-key', re: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  { name: 'aws-access-key', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: 'github-pat', re: /\bghp_[A-Za-z0-9]{36,}\b/g },
  { name: 'github-fine-grained-pat', re: /\bgithub_pat_[A-Za-z0-9_]{22,}\b/g },
  { name: 'slack-token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { name: 'google-api-key', re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { name: 'private-key', re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP |DSA )?PRIVATE KEY-----/g },
  { name: 'stripe-live-key', re: /\bsk_live_[0-9A-Za-z]{24,}\b/g },
];

const PLACEHOLDER_VALUE = /^(?:\?+|\.{3,}|<[^>]*>|your[_-].*|xxx+|changeme|example|dummy|placeholder|\[\]|\{\}|""|''|\$\{\{.*\}\}|\$\{.*\})$/i;

function looksLikeSecret(value) {
  if (!value) return false;
  const trimmed = value.trim().replace(/^["']|["']$/g, '');
  if (PLACEHOLDER_VALUE.test(trimmed)) return false;
  if (/^(true|false|null|undefined|none|nil|0|1)$/i.test(trimmed)) return false;
  if (trimmed.length < 8) return false;
  return true;
}

function scanText(text, filePath) {
  const findings = [];
  for (const { name, re } of PATTERNS) {
    re.lastIndex = 0;
    let match;
    while ((match = re.exec(text)) !== null) {
      findings.push({ file: filePath, rule: name, line: text.slice(0, match.index).split('\n').length, match: match[0] });
    }
  }

  const generic = /\b(?:api[_-]?key|apikey|secret|password|passwd|client[_-]?secret|access[_-]?token|auth[_-]?token)\b\s*[:=]\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^\s,;]+)/gi;
  let genericMatch;
  while ((genericMatch = generic.exec(text)) !== null) {
    const value = (genericMatch[1] || '').replace(/^["']|["']$/g, '');
    if (looksLikeSecret(value)) {
      findings.push({ file: filePath, rule: 'generic-assignment', line: text.slice(0, genericMatch.index).split('\n').length, match: genericMatch[0] });
    }
  }
  return findings;
}

const SKIP_DIRS = new Set(['.git', 'node_modules', 'backups', 'exports']);

async function walk(dir, base) {
  const entries = await readdir(dir, { withFileTypes: true });
  const results = [];
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    const rel = path.relative(base, full);
    if (entry.isDirectory()) {
      results.push(...await walk(full, base));
    } else if (entry.isFile()) {
      try {
        const text = await readFile(full, 'utf8');
        results.push(...scanText(text, rel));
      } catch (error) {
        if (error.code !== 'EISDIR' && error.code !== 'ENOENT') throw error;
      }
    }
  }
  return results;
}

async function scanGitHistory(base) {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileAsync = promisify(execFile);
  try {
    const { stdout } = await execFileAsync('git', ['-C', base, 'log', '--all', '-p', '--', '.', ':!node_modules'], { maxBuffer: 64 * 1024 * 1024 });
    return scanText(stdout, 'git-history');
  } catch (error) {
    if (error.code === 'ENOENT') return [{ file: 'git-history', rule: 'error', line: 1, match: 'git not available' }];
    return [{ file: 'git-history', rule: 'error', line: 1, match: error.stderr ? String(error.stderr).split('\n')[0] : String(error.message) }];
  }
}

function matchesIgnore(file, patterns) {
  return patterns.some((pattern) => {
    const trimmed = pattern.trim();
    if (!trimmed || trimmed.startsWith('#')) return false;
    if (trimmed.endsWith('/')) return file.startsWith(trimmed);
    if (trimmed.endsWith('*')) return file.startsWith(trimmed.slice(0, -1));
    return file === trimmed;
  });
}

async function readIgnores(root) {
  try {
    const text = await readFile(path.join(root, '.secrets-ignore'), 'utf8');
    return text.split('\n').map((line) => line.trim()).filter(Boolean);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

export async function scanSecrets({ root = REPO_ROOT, history = false } = {}) {
  const findings = await walk(root, root);
  if (history) findings.push(...await scanGitHistory(root));
  const ignores = await readIgnores(root);
  return findings.filter((finding) => !matchesIgnore(finding.file, ignores));
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const history = process.argv.includes('--history');
  const findings = await scanSecrets({ root: REPO_ROOT, history });
  if (findings.length) {
    for (const finding of findings) {
      const redacted = finding.match.length > 10 ? `${finding.match.slice(0, 4)}...${finding.match.slice(-4)}` : finding.match;
      console.error(`${finding.file}:${finding.line} [${finding.rule}] ${redacted}`);
    }
    console.error(`Secret scan failed: ${findings.length} potential finding(s).`);
    process.exitCode = 1;
  } else {
    console.log('Secret scan passed: no potential secrets found.');
  }
}
