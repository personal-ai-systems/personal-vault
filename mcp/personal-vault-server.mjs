import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { appendFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

const execFileAsync = promisify(execFile);
const VAULT_ROOT = process.env.PERSONAL_VAULT_ROOT || path.join(process.env.HOME || '', 'personal-vault');
const PORT = Number(process.env.MCP_PORT || process.env.PORT || 8787);
const MCP_PATH = '/mcp';
const DASHBOARD_BASE_URL = (process.env.DASHBOARD_BASE_URL || 'http://127.0.0.1:3002').replace(/\/$/, '');
const CAPTURE_REVIEW_PROVIDER = process.env.CAPTURE_REVIEW_PROVIDER || 'codex';
const CAPTURE_REVIEW_TIMEOUT_MS = Number(process.env.CAPTURE_REVIEW_TIMEOUT_MS || 20000);
const CODEX_BIN = process.env.CODEX_BIN || '/Applications/Codex.app/Contents/Resources/codex';
const GOOGLE_AUTH_ENABLED = process.env.MCP_GOOGLE_AUTH === 'true';
const MCP_PUBLIC_BASE_URL = (process.env.MCP_PUBLIC_BASE_URL || '').replace(/\/$/, '');
const GOOGLE_ALLOWED_EMAILS = (process.env.GOOGLE_ALLOWED_EMAILS || '')
  .split(',')
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);
const GOOGLE_ALLOWED_DOMAINS = (process.env.GOOGLE_ALLOWED_DOMAINS || '')
  .split(',')
  .map((domain) => domain.trim().toLowerCase())
  .filter(Boolean);
const GOOGLE_AUTHORIZATION_SERVER = 'https://accounts.google.com';
const OAUTH_SCOPES = ['openid', 'email', 'profile'];
const tokenCache = new Map();
const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const MAX_CAPTURE_ATTACHMENT_BYTES = Number(process.env.MAX_CAPTURE_ATTACHMENT_BYTES || 8 * 1024 * 1024);

const oauthSecuritySchemes = [
  {
    type: 'oauth2',
    scopes: OAUTH_SCOPES,
  },
];

function readOptionalRepoText(relativePath) {
  try {
    return readFileSync(path.join(REPO_ROOT, relativePath), 'utf-8').trim();
  } catch {
    return '';
  }
}

const processorPrinciples = readOptionalRepoText('docs/personal-vault-fluid-capture.md');

const routingInstructions = [
  'Personal Vault is the user-owned memory store.',
  'capture_note is the main entrypoint: save raw Markdown first, then return proposed actions in the same tool result.',
  'capture_note and capture_asset can store image bytes when the client provides dataBase64 or dataUrl attachments; ChatGPT internal file IDs alone are not enough to persist a physical image.',
  'Never assume a project hint alone means a structured dashboard update should be applied.',
  'Health dashboard proposals are only appropriate for factual health/activity records: completed exercises, sets, reps, weights, walking/cardio, symptoms, procedures, measurements, or medical decisions.',
  'Architecture discussions, MCP/OAuth/tool-discovery conversations, dashboard ideas, planning research, and memory-system decisions should normally stay as raw capture/inbox or be linked to a project as source evidence.',
  'Structured dashboard changes must be proposed as generic apply-structured-update actions with a processorId, not as project-specific public tools.',
  'apply_capture_action mutates structured project/dashboard state and must only be called after explicit user approval.',
  'Use get_today_plan for current commitments and search_vault before answering questions about prior decisions.',
  processorPrinciples,
].join(' ');

function isHealthActivityCapture(lower, intentHint) {
  const architectureDiscussion =
    /(mcp|oauth|connector|connectors|tool discovery|tools\/list|schema|endpoint|server|cloudflare|tunnel|chatgpt|personal vault|dashboard|planner|memory system|architecture|router|routing|capture inbox)/i.test(lower);
  const explicitNonActivity =
    /(did\s+not\s+do|didn't\s+do|not\s+(a\s+)?workout|no\s+actual\s+activity|no\s+(workout|exercise|activity|kg|reps?|sets?)|no\s+\w+\s+were\s+(lifted|performed|completed)|не\s+(тренировка|упражнение)|не\s+делал|без\s+(тренировки|упражнений))/i.test(lower);
  const completedActivity =
    /(i\s+(?!(did\s+not|didn't)\b)(did|completed|finished)|сделал|выполнил|закрыл|done:|completed:).{0,120}(workout|gym|exercise|rehab|walk|cardio|bike|cycling|swim|kaw|csr|scr|bench|curl|row|face pull|farmer|carry|sets?|reps?|kg|трениров|упражнен|ходьб|килограмм)/i.test(lower);
  const concreteMetrics =
    /(\d+\s*(kg|кг|kilograms?)|\d+\s*[x×]\s*\d+|\d+\s*(sets?|reps?|подход|повтор|раза|раз)|\b(bp|csr|scr|kaw|gfp|fp|er|ir|rf|walk)\b)/i.test(lower);
  const medicalRecord =
    /(pain|symptom|procedure|laser|prp|sclerotherapy|blood pressure|weight|waist|боль|симптом|процедур|давлен|вес|талия)/i.test(lower);

  if (architectureDiscussion && explicitNonActivity) {
    return { match: false, reason: 'blocked-architecture-explicit-non-activity' };
  }

  if (architectureDiscussion && !completedActivity && !medicalRecord) {
    return { match: false, reason: 'blocked-architecture-discussion' };
  }

  if (explicitNonActivity && !completedActivity && !concreteMetrics && !medicalRecord) {
    return { match: false, reason: 'blocked-explicit-non-activity' };
  }

  if (intentHint === 'workout' || intentHint === 'achievement') {
    if (completedActivity) return { match: true, reason: 'completed-activity-with-workout-intent' };
    if (concreteMetrics) return { match: true, reason: 'concrete-health-metrics-with-workout-intent' };
    if (medicalRecord) return { match: true, reason: 'medical-record-with-workout-intent' };
    return { match: false, reason: 'workout-intent-without-health-evidence' };
  }

  if (completedActivity) return { match: true, reason: 'completed-activity' };
  if (concreteMetrics) return { match: true, reason: 'concrete-health-metrics' };
  if (medicalRecord) return { match: true, reason: 'medical-record' };
  return { match: false, reason: 'no-health-activity-signal' };
}

function semanticCaptureText(body) {
  return body
    .replace(/^\s*save\s+this\s+to\s+personal\s+vault\s*:?\s*/i, '')
    .replace(/^\s*сохрани\s+(?:это\s+)?(?:в\s+)?personal\s+vault\s*:?\s*/i, '')
    .trim();
}

function detectNutritionCandidate(lower) {
  const nutritionSignal =
    /\b(coffee|flat white|latte|cappuccino|espresso|meal|breakfast|lunch|dinner|snack|ate|eaten|drink|drank|food|calories?|protein|carbs?|fat|alcohol|beer|wine|кофе|еда|ел|съел|завтрак|обед|ужин|перекус|калори|белок)\b/i.test(lower);
  if (!nutritionSignal) return { match: false, reason: 'no-nutrition-signal' };

  const enoughDetail =
    /(\d+\s*(g|grams?|г|ml|мл|cup|cups|чашк)|small|regular|large|сахар|sugar|milk|молок|oil|масл)/i.test(lower);
  return {
    match: true,
    reason: enoughDetail ? 'nutrition-candidate-with-some-detail' : 'nutrition-candidate-needs-portion-detail',
    needsClarification: !enoughDetail,
  };
}

function detectReviewLaterCandidate(lower) {
  if (/\b(opened|article|read later|bookmark|source|link|reading|статья|прочитать|закладк)\b/i.test(lower)) {
    return { match: true, reason: 'review-later-source' };
  }
  return { match: false, reason: 'no-review-later-signal' };
}

function detectProjectCandidate(lower) {
  if (/\b(ai|openai|chatgpt|codex|mcp|dashboard|personal vault|connector|model|agent|interface|product|architecture|software)\b/i.test(lower)) {
    return { match: true, projectId: 'ai', reason: 'ai-product-architecture-signal' };
  }
  return { match: false, projectId: null, reason: 'no-project-signal' };
}

function buildClarificationQuestions({ lower, healthRouting, nutritionRouting, reviewLaterRouting, planningAction }) {
  const questions = [];

  if (nutritionRouting.match && nutritionRouting.needsClarification) {
    questions.push({
      id: 'nutrition-portion-detail',
      target: 'health/nutrition',
      question: 'For the food/drink estimate, what was the approximate size/portion and were there calorie-dense additions such as sugar, milk type, oil, sauce, nuts, cheese, or alcohol?',
    });
  }

  if (/\bwalked|walk|ходил|прогул/i.test(lower) && !/\d+\s*(min|mins|minutes|мин|km|км|steps|шаг)/i.test(lower)) {
    questions.push({
      id: 'activity-duration-detail',
      target: 'health/activity',
      question: 'For the walk/activity, roughly how long or how far was it?',
    });
  }

  const mixedSignals = [
    nutritionRouting.match,
    healthRouting.match || /\bwalked|walk|cycling|gym|exercise|activity|ходил|трениров/i.test(lower),
    reviewLaterRouting.match || /\bdashboard|ai|product|architecture|mcp|connector/i.test(lower),
    planningAction,
  ].filter(Boolean).length;

  if (mixedSignals >= 3) {
    questions.push({
      id: 'mixed-capture-split',
      target: 'routing',
      question: 'This capture touches multiple areas. Should I split it into separate proposed updates, or keep it as one raw note for review?',
    });
  }

  return questions;
}

function getSydneyDate() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Sydney',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 72) || 'capture';
}

function sanitizeAssetName(value, fallback = 'asset') {
  return String(value || fallback)
    .toLowerCase()
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/[^a-z0-9._ -]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 96) || fallback;
}

function extForMime(mimeType) {
  const map = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/svg+xml': '.svg',
    'application/pdf': '.pdf',
    'text/plain': '.txt',
    'text/csv': '.csv',
    'application/json': '.json',
  };
  return map[String(mimeType || '').toLowerCase()] || '';
}

function decodeCaptureAttachment(attachment) {
  const dataUrl = typeof attachment?.dataUrl === 'string' ? attachment.dataUrl.trim() : '';
  let mimeType = typeof attachment?.mimeType === 'string' ? attachment.mimeType.trim().toLowerCase() : '';
  let base64 = typeof attachment?.dataBase64 === 'string' ? attachment.dataBase64.trim() : '';

  if (dataUrl) {
    const match = dataUrl.match(/^data:([^;,]+);base64,(.+)$/s);
    if (!match) throw new Error('Attachment dataUrl must be a base64 data URL.');
    mimeType = match[1].trim().toLowerCase();
    base64 = match[2].trim();
  }

  if (!base64) throw new Error('Attachment must include dataBase64 or dataUrl.');
  if (!mimeType) mimeType = 'application/octet-stream';
  if (!/^image\/(png|jpeg|gif|webp|svg\+xml)$/.test(mimeType)) {
    throw new Error(`Unsupported capture attachment MIME type: ${mimeType}`);
  }

  const buffer = Buffer.from(base64.replace(/\s+/g, ''), 'base64');
  if (!buffer.length) throw new Error('Attachment decoded to an empty file.');
  if (buffer.byteLength > MAX_CAPTURE_ATTACHMENT_BYTES) {
    throw new Error(`Attachment is ${buffer.byteLength} bytes; limit is ${MAX_CAPTURE_ATTACHMENT_BYTES} bytes.`);
  }

  return { buffer, mimeType };
}

async function saveCaptureAttachments({ attachments = [], rawDir, markdownBaseName, relativeMarkdownPath, title }) {
  if (!attachments.length) return [];

  const assetsDirName = `${markdownBaseName}.assets`;
  const assetsDir = path.join(rawDir, assetsDirName);
  await mkdir(assetsDir, { recursive: true });
  await mkdir(path.join(VAULT_ROOT, 'indexes'), { recursive: true });

  const saved = [];
  for (const [index, attachment] of attachments.entries()) {
    const { buffer, mimeType } = decodeCaptureAttachment(attachment);
    const ext = extForMime(mimeType) || path.extname(attachment.name || '') || '.bin';
    const baseName = sanitizeAssetName(path.basename(attachment.name || `image-${index + 1}`, path.extname(attachment.name || '')));
    const filename = `${String(index + 1).padStart(2, '0')}-${baseName}${baseName.endsWith(ext) ? '' : ext}`;
    const assetPath = path.join(assetsDir, filename);
    await writeFile(assetPath, buffer);

    const relativeAssetPath = path.relative(VAULT_ROOT, assetPath).split(path.sep).join('/');
    const markdownRelativePath = `./${assetsDirName}/${filename}`;
    const record = {
      created: new Date().toISOString(),
      source: 'mcp-capture',
      title,
      rawPath: relativeMarkdownPath,
      vaultPath: relativeAssetPath,
      originalName: attachment.name || filename,
      mime: mimeType,
      sizeBytes: buffer.byteLength,
      alt: attachment.alt || attachment.caption || attachment.name || `capture image ${index + 1}`,
      caption: attachment.caption || '',
    };
    saved.push({ ...record, markdownRelativePath });
    await appendFile(path.join(VAULT_ROOT, 'indexes', 'capture-assets.jsonl'), JSON.stringify(record) + '\n', 'utf-8');
  }

  return saved;
}

function safeRelativePath(relativePath) {
  const normalized = path.normalize(relativePath).replace(/^(\.\.(\/|\\|$))+/, '');
  return normalized.startsWith('/') ? normalized.slice(1) : normalized;
}

function getHeader(headers, name) {
  const value = headers?.[name] ?? headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function getPublicBaseUrl(req) {
  if (MCP_PUBLIC_BASE_URL) return MCP_PUBLIC_BASE_URL;
  const host = req?.headers?.host || 'localhost:8787';
  const forwardedProto = req?.headers?.['x-forwarded-proto'];
  const proto = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto || (host.includes('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

function getPublicBaseUrlFromExtra(extra) {
  if (MCP_PUBLIC_BASE_URL) return MCP_PUBLIC_BASE_URL;
  const headers = extra?.requestInfo?.headers || {};
  const host = getHeader(headers, 'host') || 'localhost:8787';
  const proto = getHeader(headers, 'x-forwarded-proto') || (String(host).includes('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

function authChallenge(baseUrl, reason) {
  return `Bearer resource_metadata="${baseUrl}/.well-known/oauth-protected-resource", scope="${OAUTH_SCOPES.join(' ')}", error="invalid_token", error_description="${reason}"`;
}

function authError(extra, reason = 'A valid Personal Vault access token is required.') {
  const baseUrl = getPublicBaseUrlFromExtra(extra);
  return {
    isError: true,
    content: [
      {
        type: 'text',
        text: 'Personal Vault requires Google authentication before this tool can access private vault data.',
      },
    ],
    _meta: {
      'mcp/www_authenticate': authChallenge(baseUrl, reason),
    },
  };
}

function isAllowedGoogleUser(profile) {
  const email = String(profile?.email || '').toLowerCase();
  if (!email) return false;
  if (GOOGLE_ALLOWED_EMAILS.length && GOOGLE_ALLOWED_EMAILS.includes(email)) return true;
  const domain = email.split('@')[1];
  if (GOOGLE_ALLOWED_DOMAINS.length && GOOGLE_ALLOWED_DOMAINS.includes(domain)) return true;
  return !GOOGLE_ALLOWED_EMAILS.length && !GOOGLE_ALLOWED_DOMAINS.length;
}

async function verifyGoogleAccessToken(token) {
  const cached = tokenCache.get(token);
  if (cached && cached.expiresAt > Date.now()) return cached.profile;

  const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { authorization: `Bearer ${token}` },
  });

  if (!response.ok) return null;
  const profile = await response.json();
  if (!isAllowedGoogleUser(profile)) return null;

  tokenCache.set(token, {
    profile,
    expiresAt: Date.now() + 5 * 60 * 1000,
  });
  return profile;
}

async function requireGoogleAuth(extra) {
  if (!GOOGLE_AUTH_ENABLED) return { ok: true, profile: null };
  const authorization = getHeader(extra?.requestInfo?.headers || {}, 'authorization');
  const match = /^Bearer\s+(.+)$/i.exec(String(authorization || ''));
  if (!match) return { ok: false, reason: 'No Personal Vault access token was provided.' };

  const profile = await verifyGoogleAccessToken(match[1]);
  return profile
    ? { ok: true, profile }
    : { ok: false, reason: 'The Personal Vault access token is invalid, expired, or not allowed.' };
}

async function readJson(relativePath, fallback) {
  try {
    return JSON.parse(await readFile(path.join(VAULT_ROOT, safeRelativePath(relativePath)), 'utf-8'));
  } catch {
    return fallback;
  }
}

async function readText(relativePath) {
  return readFile(path.join(VAULT_ROOT, safeRelativePath(relativePath)), 'utf-8');
}

async function walkMarkdown(dir, limit = 200, acc = []) {
  if (acc.length >= limit) return acc;
  let entries = [];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return acc;
  }

  for (const entry of entries) {
    if (acc.length >= limit) break;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkMarkdown(fullPath, limit, acc);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      acc.push(fullPath);
    }
  }
  return acc;
}

function structuredSearchText(data) {
  const sessions = Array.isArray(data.sessions)
    ? data.sessions.map((session) => [
      session.title,
      ...(Array.isArray(session.exercises)
        ? session.exercises.map((exercise) => `${exercise.code || ''} ${exercise.name || ''}`)
        : []),
    ].filter(Boolean).join(': '))
    : [];
  const exercises = Array.isArray(data.exercises)
    ? data.exercises.map((exercise) => `${exercise.code || ''} ${exercise.name || ''} ${exercise.why || ''} ${exercise.how || ''}`)
    : [];

  return [
    data.title,
    data.id,
    data.status,
    data.goal,
    data.rule,
    ...(Array.isArray(data.rules) ? data.rules : []),
    ...(Array.isArray(data.notes) ? data.notes : []),
    ...sessions,
    ...exercises,
  ].filter(Boolean).join('\n');
}

async function readStructuredSearchDocuments() {
  const locations = [
    path.join(VAULT_ROOT, 'structured', 'health'),
    path.join(VAULT_ROOT, 'structured', 'projects'),
  ];
  const documents = [];

  for (const location of locations) {
    let entries = [];
    try {
      entries = await readdir(location, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isFile() || (!entry.name.endsWith('-plan.json') && entry.name !== 'exercise-library.json')) continue;
      const file = path.join(location, entry.name);
      try {
        const data = JSON.parse(await readFile(file, 'utf-8'));
        documents.push({
          path: path.relative(VAULT_ROOT, file),
          title: [data.title, data.id].filter(Boolean).join(' '),
          text: structuredSearchText(data),
          sourceType: 'structured-plan',
        });
      } catch {
        // A malformed derived file should not make vault search unavailable.
      }
    }
  }

  return documents;
}

function scoreSearchText(text, query) {
  const lower = text.toLowerCase();
  const phrase = query.trim().toLowerCase();
  const phraseIndex = lower.indexOf(phrase);
  const ignored = new Set(['and', 'the', 'for', 'with', 'this', 'that', 'plan', 'about', 'или', 'что', 'как', 'для', 'это', 'the']);
  const tokens = [...new Set((phrase.match(/[\p{L}\p{N}]+/gu) || [])
    .filter((token) => token.length >= 3 && !ignored.has(token)))];
  let score = phraseIndex >= 0 ? 100 : 0;
  let firstIndex = phraseIndex;

  for (const token of tokens) {
    const index = lower.indexOf(token);
    if (index < 0) continue;
    score += 10;
    if (firstIndex < 0 || index < firstIndex) firstIndex = index;
  }

  return score > 0 ? { score, index: Math.max(0, firstIndex) } : null;
}

async function createCapture({ input, source = 'chatgpt-mobile', projectId, intent = 'note', title, attachments = [] }) {
  const now = new Date();
  const iso = now.toISOString();
  const date = getSydneyDate();
  const [year, month] = date.split('-');
  const rawDir = path.join(VAULT_ROOT, 'raw', year, month);
  await mkdir(rawDir, { recursive: true });

  const titleText = title || `Capture - ${date}`;
  const filename = `${date}-capture-${slugify(title || input.split(/\s+/).slice(0, 9).join(' '))}.md`;
  const fullPath = path.join(rawDir, filename);
  const relativePath = path.relative(VAULT_ROOT, fullPath);
  const markdownBaseName = path.basename(filename, '.md');
  const savedAttachments = await saveCaptureAttachments({
    attachments,
    rawDir,
    markdownBaseName,
    relativeMarkdownPath: relativePath,
    title: titleText,
  });
  const attachmentMarkdown = savedAttachments.flatMap((asset) => {
    const alt = String(asset.alt || asset.originalName || 'capture image').replace(/[\[\]\n\r]/g, ' ').trim();
    const lines = [`![${alt}](${asset.markdownRelativePath})`];
    if (asset.caption) lines.push(`_${asset.caption}_`);
    return ['', ...lines];
  });
  const content = [
    '---',
    `title: ${JSON.stringify(titleText)}`,
    `created: ${JSON.stringify(iso)}`,
    `source: ${JSON.stringify(source)}`,
    `capture_intent: ${JSON.stringify(intent)}`,
    projectId ? `project: ${JSON.stringify(projectId)}` : '',
    savedAttachments.length ? `asset_count: ${savedAttachments.length}` : '',
    'privacy: private',
    '---',
    '',
    `# ${titleText}`,
    '',
    input,
    ...attachmentMarkdown,
    '',
  ].filter(Boolean).join('\n');

  await writeFile(fullPath, content, 'utf-8');
  await mkdir(path.join(VAULT_ROOT, 'indexes'), { recursive: true });
  await appendFile(
    path.join(VAULT_ROOT, 'indexes', 'captures.jsonl'),
    JSON.stringify({
      created: iso,
      source,
      intent,
      projectId: projectId || null,
      path: relativePath,
      title: titleText,
      assetCount: savedAttachments.length,
      assets: savedAttachments.map((asset) => ({
        vaultPath: asset.vaultPath,
        mime: asset.mime,
        sizeBytes: asset.sizeBytes,
        originalName: asset.originalName,
      })),
    }) + '\n',
    'utf-8'
  );

  return {
    path: relativePath,
    title: titleText,
    created: iso,
    assetCount: savedAttachments.length,
    assets: savedAttachments.map(({ markdownRelativePath, ...asset }) => asset),
  };
}

async function applyDashboardCaptureAction(capturePath, proposal) {
  try {
    const response = await fetch(`${DASHBOARD_BASE_URL}/api/capture/action`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        path: capturePath,
        actionId: proposal.actionId,
        projectId: proposal.projectId,
        processorId: proposal.processorId,
        recordType: proposal.recordType,
      }),
    });
    const data = await response.json().catch(() => null);
    return { ok: response.ok, data };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}

function captureBody(markdown) {
  return markdown
    .replace(/^---[\s\S]*?---\s*/, '')
    .replace(/^# .+$/m, '')
    .trim();
}

function parseFrontmatterValue(markdown, key) {
  const match = markdown.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return match[1].replace(/^"|"$/g, '');
  }
}

function normalizeReviewProposal(proposal, index) {
  const allowedActions = new Set([
    'leave-in-inbox',
    'link-to-project',
    'add-today-achievement',
    'add-to-today-plan',
    'apply-structured-update',
  ]);
  const actionId = allowedActions.has(proposal?.actionId) ? proposal.actionId : 'leave-in-inbox';
  return {
    id: String(proposal?.id || `proposal-${index + 1}`).replace(/[^a-z0-9-]/gi, '-').toLowerCase(),
    label: String(proposal?.label || 'Review capture'),
    target: proposal?.target == null ? null : String(proposal.target),
    actionId,
    projectId: proposal?.projectId == null ? null : String(proposal.projectId),
    processorId: proposal?.processorId == null ? null : String(proposal.processorId),
    recordType: proposal?.recordType == null ? null : String(proposal.recordType),
    preview: String(proposal?.preview || 'Review this raw capture before applying any derived change.'),
  };
}

function normalizeCaptureReview(review, fallbackReview) {
  const questions = Array.isArray(review?.questions)
    ? review.questions.map((question, index) => ({
        id: String(question?.id || `question-${index + 1}`).replace(/[^a-z0-9-]/gi, '-').toLowerCase(),
        question: String(question?.question || '').trim(),
      })).filter((question) => question.question)
    : [];

  const proposals = Array.isArray(review?.proposals)
    ? review.proposals.map(normalizeReviewProposal)
    : [];

  return {
    summary: String(review?.summary || fallbackReview?.summary || 'Raw capture saved.'),
    interpretation: String(review?.interpretation || fallbackReview?.interpretation || 'No processor interpretation was available.'),
    questions,
    proposals: proposals.length ? proposals : fallbackReview.proposals,
    providerDiagnostics: review?.providerDiagnostics || null,
  };
}

function buildCaptureReviewPrompt({ capturePath, markdown, fallbackReview }) {
  return [
    'You are the Personal Vault capture review processor.',
    '',
    'Core rule: raw Markdown is already saved and is the source of truth. Do not edit files. Do not create files. Do not run commands. Return only JSON matching the provided schema.',
    '',
    'Review the capture and return:',
    '- a short summary,',
    '- a human interpretation of what this appears to be,',
    '- minimal clarification questions only if needed,',
    '- proposed next actions that require user approval before mutation.',
    '',
    'Keep the system fluid. Do not invent rigid taxonomy. Do not expose internal buckets as product concepts. Use plain language in labels/previews.',
    '',
    'Allowed actionId values:',
    '- leave-in-inbox: no mutation, just keep raw capture',
    '- link-to-project: link as source evidence if clearly useful',
    '- add-today-achievement: show completed item today',
    '- add-to-today-plan: add an explicit task/review/follow-up',
    '- apply-structured-update: only when the capture contains enough factual detail to update derived dashboard state',
    '',
    'If proposing apply-structured-update, include projectId/processorId/recordType only as internal execution hints. If unsure, ask a clarification question instead.',
    '',
    'The user explicitly wants capture_note to synchronously explain what this appears to belong to and ask for confirmation before applying anything.',
    '',
    `Capture path: ${capturePath}`,
    '',
    'Fallback heuristic review, for reference only:',
    JSON.stringify(fallbackReview, null, 2),
    '',
    'Saved raw Markdown capture:',
    markdown,
  ].join('\n');
}

async function runCodexCaptureReview({ capturePath, markdown, fallbackReview }) {
  const outputPath = path.join(VAULT_ROOT, 'tmp', `capture-review-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
  await mkdir(path.dirname(outputPath), { recursive: true });
  const prompt = buildCaptureReviewPrompt({ capturePath, markdown, fallbackReview });
  const schemaPath = path.join(REPO_ROOT, 'mcp', 'capture-review.schema.json');
  const args = [
    'exec',
    '--cd', VAULT_ROOT,
    '--sandbox', 'read-only',
    '--skip-git-repo-check',
    '--output-schema', schemaPath,
    '--output-last-message', outputPath,
  ];
  if (process.env.CAPTURE_REVIEW_CODEX_MODEL) {
    args.push('--model', process.env.CAPTURE_REVIEW_CODEX_MODEL);
  }
  args.push('-');
  const { stdout, stderr } = await execFileAsync(
    CODEX_BIN,
    args,
    {
      input: prompt,
      timeout: CAPTURE_REVIEW_TIMEOUT_MS,
      maxBuffer: 1024 * 1024 * 8,
      env: {
        ...process.env,
        PERSONAL_VAULT_ROOT: VAULT_ROOT,
      },
    }
  );
  const rawOutput = await readFile(outputPath, 'utf-8');
  const parsed = JSON.parse(rawOutput);
  return {
    ...parsed,
    providerDiagnostics: {
      provider: 'codex',
      model: process.env.CAPTURE_REVIEW_CODEX_MODEL || 'codex-default',
      stderr: stderr?.slice(-2000) || null,
      stdout: stdout?.slice(-2000) || null,
    },
  };
}

async function runCaptureReview(input) {
  if (CAPTURE_REVIEW_PROVIDER === 'codex') {
    return runCodexCaptureReview(input);
  }
  throw new Error(`Unsupported capture review provider: ${CAPTURE_REVIEW_PROVIDER}`);
}

function createHeuristicCaptureReview({ capturePath, markdown }) {
  const body = captureBody(markdown);
  const semanticBody = semanticCaptureText(body);
  const lower = semanticBody.toLowerCase();
  const projectHint = parseFrontmatterValue(markdown, 'project');
  const intentHint = parseFrontmatterValue(markdown, 'capture_intent');
  const proposals = [];

  proposals.push({
    id: 'leave-in-inbox',
    label: 'Leave in capture inbox',
    target: 'indexes/captures.jsonl',
    actionId: 'leave-in-inbox',
    projectId: projectHint || null,
    preview: 'Keep this as raw readable evidence for later review.',
  });

  if (projectHint) {
    proposals.push({
      id: `link-to-${projectHint}`,
      label: `Link to ${projectHint}`,
      target: `project:${projectHint}`,
      actionId: 'link-to-project',
      projectId: projectHint,
      preview: `Attach this capture as source evidence for ${projectHint}.`,
    });
  }

  const healthRouting = isHealthActivityCapture(lower, intentHint);
  const nutritionRouting = detectNutritionCandidate(lower);
  const reviewLaterRouting = detectReviewLaterCandidate(lower);
  const projectRouting = detectProjectCandidate(lower);

  if (!projectHint && projectRouting.match) {
    proposals.push({
      id: `link-to-${projectRouting.projectId}`,
      label: `Link to ${projectRouting.projectId}`,
      target: `project:${projectRouting.projectId}`,
      actionId: 'link-to-project',
      projectId: projectRouting.projectId,
      preview: `Attach this capture as source evidence for ${projectRouting.projectId}.`,
      routingReason: projectRouting.reason,
    });
  }

  if (healthRouting.match) {
    proposals.push({
      id: 'update-health-activity',
      label: 'Update Health activity',
      target: 'structured/health',
      actionId: 'apply-structured-update',
      projectId: 'health',
      processorId: 'health.activity',
      recordType: 'activity_log',
      preview: 'Apply this raw capture through the Health activity processor and update today’s dashboard state.',
      routingReason: healthRouting.reason,
    });
  }

  if (nutritionRouting.match) {
    proposals.push({
      id: 'review-health-nutrition',
      label: 'Review Health nutrition',
      target: 'structured/health',
      actionId: 'leave-in-inbox',
      projectId: 'health',
      processorId: 'health.nutrition',
      recordType: 'nutrition_observation',
      preview: nutritionRouting.needsClarification
        ? 'Keep raw capture and ask for minimal portion details before estimating calories.'
        : 'Review this food/drink capture as Health nutrition evidence.',
      routingReason: nutritionRouting.reason,
    });
  }

  if (reviewLaterRouting.match) {
    proposals.push({
      id: 'mark-review-later',
      label: 'Mark review later',
      target: 'indexes/review-later.jsonl',
      actionId: 'leave-in-inbox',
      projectId: projectRouting.projectId || projectHint || null,
      preview: 'Keep this as a readable source/bookmark to revisit later.',
      routingReason: reviewLaterRouting.reason,
    });
  }

  const planningAction =
    intentHint === 'task' ||
    (!/(mcp|oauth|connector|tool discovery|schema|endpoint|server|cloudflare|tunnel|memory system|architecture)/i.test(lower) &&
      /\b(tomorrow|today|task|todo|plan)\b|надо|нужно/i.test(lower));

  if (planningAction) {
    proposals.push({
      id: 'add-to-today-plan',
      label: 'Add to Today plan',
      target: 'structured/today/plan-overrides.jsonl',
      actionId: 'add-to-today-plan',
      projectId: projectHint || null,
      preview: 'Promote this capture into the Today planning layer.',
    });
  }

  const questions = buildClarificationQuestions({
    lower,
    healthRouting,
    nutritionRouting,
    reviewLaterRouting,
    planningAction,
  });

  return {
    summary: 'Raw capture saved.',
    interpretation: 'Lightweight fallback review only; model processor was unavailable.',
    routingDiagnostics: {
      projectHint,
      intentHint,
      healthRouting,
      nutritionRouting,
      reviewLaterRouting,
      projectRouting,
      semanticBody,
    },
    questions,
    proposals,
  };
}

async function createCaptureProposals(capturePath) {
  const markdown = await readText(capturePath);
  const fallbackReview = createHeuristicCaptureReview({ capturePath, markdown });
  let review;
  let reviewStatus = 'model';
  try {
    review = normalizeCaptureReview(await runCaptureReview({ capturePath, markdown, fallbackReview }), fallbackReview);
  } catch (error) {
    reviewStatus = 'fallback';
    review = normalizeCaptureReview({
      ...fallbackReview,
      providerDiagnostics: {
        provider: CAPTURE_REVIEW_PROVIDER,
        error: String(error),
        stderr: error?.stderr?.slice?.(-2000) || null,
        stdout: error?.stdout?.slice?.(-2000) || null,
        timedOut: error?.killed || false,
      },
    }, fallbackReview);
  }

  const proposalSet = {
    capturePath,
    created: new Date().toISOString(),
    status: 'proposed',
    reviewStatus,
    summary: review.summary,
    interpretation: review.interpretation,
    routingDiagnostics: fallbackReview.routingDiagnostics,
    providerDiagnostics: review.providerDiagnostics,
    questions: review.questions,
    proposals: review.proposals,
  };
  const proposalDir = path.join(VAULT_ROOT, 'indexes', 'capture-proposals');
  await mkdir(proposalDir, { recursive: true });
  const proposalPath = path.join(proposalDir, `${slugify(capturePath)}.json`);
  const relativeProposalPath = path.relative(VAULT_ROOT, proposalPath);
  await writeFile(proposalPath, JSON.stringify(proposalSet, null, 2) + '\n', 'utf-8');
  await appendFile(
    path.join(VAULT_ROOT, 'indexes', 'capture-proposals.jsonl'),
    JSON.stringify({ created: proposalSet.created, capturePath, proposalPath: relativeProposalPath, proposals: proposalSet.proposals.map((proposal) => proposal.id) }) + '\n',
    'utf-8'
  );

  return { ...proposalSet, proposalPath: relativeProposalPath };
}

async function loadProposal(proposalPathOrCapturePath) {
  const normalized = safeRelativePath(proposalPathOrCapturePath);
  if (normalized.startsWith('indexes/capture-proposals/') && normalized.endsWith('.json')) {
    return JSON.parse(await readText(normalized));
  }
  const proposalPath = path.join('indexes', 'capture-proposals', `${slugify(normalized)}.json`);
  return JSON.parse(await readText(proposalPath));
}

async function loadCaptureReview(capturePath) {
  const normalized = safeRelativePath(capturePath);
  const proposalPath = path.join('indexes', 'capture-proposals', `${slugify(normalized)}.json`);
  const proposalSet = await readJson(proposalPath, null);
  const codexReviewPath = path.join('indexes', 'codex-capture-reviews', `${slugify(normalized)}.json`);
  const codexReview = await readJson(codexReviewPath, null);
  return {
    capturePath: normalized,
    proposalPath,
    proposalSet,
    codexReviewPath,
    codexReview,
    status: codexReview ? 'codex-reviewed' : proposalSet ? 'proposed' : 'missing',
  };
}

function createPersonalVaultServer() {
  const server = new McpServer(
    { name: 'personal-vault', version: '0.1.1' },
    {
      instructions: routingInstructions,
    }
  );

  server.registerTool(
    'capture_note',
    {
      title: 'capture_note',
      description: 'Save a user-approved note, voice capture, decision, task, workout note, or conversation summary as raw readable Markdown. This also returns proposed next actions; only apply them after user approval.',
      inputSchema: {
        input: z.string().min(1).describe('The exact content or summary to save.'),
        title: z.string().optional().describe('Short human-readable title.'),
        projectId: z.string().optional().describe('Optional project id such as health, ai, business, family, wealth, trading, travel.'),
        intent: z.enum(['note', 'achievement', 'workout', 'task', 'decision', 'question', 'replan']).optional(),
        attachments: z.array(z.object({
          name: z.string().optional().describe('Original file name, for example breakfast.jpg.'),
          mimeType: z.string().optional().describe('Image MIME type such as image/jpeg, image/png, image/webp, or image/gif.'),
          dataBase64: z.string().optional().describe('Raw base64 file bytes. Use dataUrl instead if easier.'),
          dataUrl: z.string().optional().describe('A data URL such as data:image/jpeg;base64,...'),
          alt: z.string().optional().describe('Short alt text for the Markdown image.'),
          caption: z.string().optional().describe('Optional human-readable caption saved below the image.'),
        })).optional().describe('Optional image files to store beside the raw Markdown capture in a sibling .assets directory.'),
      },
      _meta: { securitySchemes: oauthSecuritySchemes },
    },
    async ({ input, title, projectId, intent, attachments }, extra) => {
      const auth = await requireGoogleAuth(extra);
      if (!auth.ok) return authError(extra, auth.reason);
      const capture = await createCapture({ input, title, projectId, intent, attachments });
      const proposalSet = await createCaptureProposals(capture.path);
      const proposalText = proposalSet.proposals
        .map((proposal, index) => `${index + 1}. ${proposal.id}: ${proposal.label} - ${proposal.preview}`)
        .join('\n');
      const questionText = proposalSet.questions.length
        ? proposalSet.questions.map((question, index) => `${index + 1}. ${question.question}`).join('\n')
        : 'None.';
      const attachmentText = capture.assets.length
        ? capture.assets.map((asset, index) => `${index + 1}. ${asset.vaultPath} (${asset.mime}, ${asset.sizeBytes} bytes)`).join('\n')
        : 'None.';
      return {
        content: [
          {
            type: 'text',
            text: [
              `Saved raw capture to Personal Vault: ${capture.path}.`,
              '',
              'Saved attachments:',
              attachmentText,
              '',
              `Proposed next actions:`,
              proposalText,
              '',
              'Clarifying questions:',
              questionText,
              '',
              'Confirmation needed: tell the user what this appears to belong to, ask any clarifying questions above, and ask which proposal to apply. Do not call apply_capture_action until the user explicitly approves a proposal.',
            ].join('\n'),
          },
        ],
        structuredContent: { ...capture, proposalSet },
      };
    }
  );

  server.registerTool(
    'capture_asset',
    {
      title: 'capture_asset',
      description: 'Attach image bytes to an existing raw Personal Vault capture. Requires dataBase64 or dataUrl; a ChatGPT file_id alone is not enough to save the original image.',
      inputSchema: {
        capturePath: z.string().min(1).describe('Vault-relative raw Markdown path returned by capture_note.'),
        attachments: z.array(z.object({
          name: z.string().optional().describe('Original file name, for example breakfast.jpg.'),
          mimeType: z.string().optional().describe('Image MIME type such as image/jpeg, image/png, image/webp, or image/gif.'),
          dataBase64: z.string().optional().describe('Raw base64 file bytes. Use dataUrl instead if easier.'),
          dataUrl: z.string().optional().describe('A data URL such as data:image/jpeg;base64,...'),
          alt: z.string().optional().describe('Short alt text for the Markdown image.'),
          caption: z.string().optional().describe('Optional human-readable caption saved below the image.'),
        })).min(1).describe('Image files to store beside the raw Markdown capture in a sibling .assets directory.'),
      },
      _meta: { securitySchemes: oauthSecuritySchemes },
    },
    async ({ capturePath, attachments }, extra) => {
      const auth = await requireGoogleAuth(extra);
      if (!auth.ok) return authError(extra, auth.reason);

      const relativePath = safeRelativePath(capturePath);
      if (!relativePath.endsWith('.md')) {
        return {
          isError: true,
          content: [{ type: 'text', text: 'capturePath must point to a raw Markdown .md file.' }],
        };
      }

      const fullPath = path.join(VAULT_ROOT, relativePath);
      const existing = await readFile(fullPath, 'utf-8').catch(() => null);
      if (existing == null) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Capture not found: ${relativePath}` }],
        };
      }

      const rawDir = path.dirname(fullPath);
      const markdownBaseName = path.basename(fullPath, '.md');
      const savedAttachments = await saveCaptureAttachments({
        attachments,
        rawDir,
        markdownBaseName,
        relativeMarkdownPath: relativePath,
        title: path.basename(markdownBaseName),
      });

      const attachmentMarkdown = savedAttachments.flatMap((asset) => {
        const alt = String(asset.alt || asset.originalName || 'capture image').replace(/[\[\]\n\r]/g, ' ').trim();
        const lines = [`![${alt}](${asset.markdownRelativePath})`];
        if (asset.caption) lines.push(`_${asset.caption}_`);
        return ['', ...lines];
      }).join('\n');

      await appendFile(fullPath, `\n${attachmentMarkdown}\n`, 'utf-8');
      await appendFile(
        path.join(VAULT_ROOT, 'indexes', 'captures.jsonl'),
        JSON.stringify({
          created: new Date().toISOString(),
          source: 'mcp-capture-asset',
          intent: 'asset',
          projectId: null,
          path: relativePath,
          title: `Assets for ${path.basename(relativePath)}`,
          assetCount: savedAttachments.length,
          assets: savedAttachments.map((asset) => ({
            vaultPath: asset.vaultPath,
            mime: asset.mime,
            sizeBytes: asset.sizeBytes,
            originalName: asset.originalName,
          })),
        }) + '\n',
        'utf-8'
      );

      return {
        content: [
          {
            type: 'text',
            text: [
              `Attached ${savedAttachments.length} asset(s) to ${relativePath}.`,
              ...savedAttachments.map((asset, index) => `${index + 1}. ${asset.vaultPath} (${asset.mime}, ${asset.sizeBytes} bytes)`),
            ].join('\n'),
          },
        ],
        structuredContent: {
          capturePath: relativePath,
          assetCount: savedAttachments.length,
          assets: savedAttachments.map(({ markdownRelativePath, ...asset }) => asset),
        },
      };
    }
  );

  server.registerTool(
    'apply_capture_action',
    {
      title: 'apply_capture_action',
      description: 'Apply one previously proposed capture action after explicit user approval.',
      inputSchema: {
        proposalPath: z.string().optional().describe('Vault-relative proposal JSON path from propose_capture_actions.'),
        capturePath: z.string().optional().describe('Vault-relative capture path; used to find its proposal JSON.'),
        proposalId: z.string().describe('Proposal id to apply, such as update-health-activity or link-to-health.'),
      },
      _meta: { securitySchemes: oauthSecuritySchemes },
    },
    async ({ proposalPath, capturePath, proposalId }, extra) => {
      const auth = await requireGoogleAuth(extra);
      if (!auth.ok) return authError(extra, auth.reason);
      const proposalSet = await loadProposal(proposalPath || capturePath);
      const proposal = proposalSet.proposals.find((item) => item.id === proposalId);
      if (!proposal) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Proposal ${proposalId} was not found.` }],
        };
      }

      const result = await applyDashboardCaptureAction(proposalSet.capturePath, proposal);
      return {
        isError: !result.ok,
        content: [
          {
            type: 'text',
            text: result.ok
              ? `Applied proposal ${proposalId} for ${proposalSet.capturePath}.`
              : `Failed to apply proposal ${proposalId}: ${result.error || JSON.stringify(result.data)}`,
          },
        ],
        structuredContent: { proposal, result },
      };
    }
  );

  server.registerTool(
    'get_today_plan',
    {
      title: 'get_today_plan',
      description: 'Read the current Today plan from Personal Vault, including health and AI/project commitments.',
      inputSchema: {},
      _meta: { securitySchemes: oauthSecuritySchemes },
    },
    async (_args, extra) => {
      const auth = await requireGoogleAuth(extra);
      if (!auth.ok) return authError(extra, auth.reason);
      const today = getSydneyDate();
      const projection = await readJson('structured/plans/daily-projection.json', { tasks: [] });
      const tasks = (projection?.tasks || [])
        .filter((task) => task.date === today && task.status !== 'dropped')
        .sort((left, right) => Number(right.priority || 0) - Number(left.priority || 0));
      const healthTask = tasks.find((task) => task.projectId === 'health') || null;
      let health = healthTask;
      if (healthTask?.source?.startsWith('structured/health/') && healthTask.source.endsWith('.json')) {
        const healthPlan = await readJson(healthTask.source, null);
        const session = healthPlan?.sessions?.find((candidate) => healthTask.title.startsWith(candidate.title));
        if (session?.exercises?.length) {
          health = {
            ...healthTask,
            exercises: session.exercises.map((exercise) => ({
              code: exercise.code,
              name: exercise.name,
              prescription: healthTask.detail
                .split('; ')
                .find((part) => part.includes(exercise.code))
                ?.replace(/^\d+\.\s*/, '') || null,
            })),
          };
        }
      }
      const ai = tasks.find((task) => task.projectId === 'ai') || null;
      const projects = tasks.reduce((groups, task) => {
        const projectId = task.projectId || 'inbox';
        const group = groups[projectId] || [];
        group.push(task);
        groups[projectId] = group;
        return groups;
      }, {});
      const structuredContent = {
        date: today,
        generatedAt: projection?.generatedAt || null,
        health,
        ai,
        tasks,
        projects,
      };
      const commitmentText = tasks.length
        ? tasks.map((task) => `- ${task.area || task.projectId}: ${task.title}`).join('\n')
        : '- No dated commitments are currently projected.';
      const healthExerciseText = health?.exercises?.length
        ? `\n\nHealth exercise detail:\n${health.exercises.map((exercise, index) => `${index + 1}. ${exercise.code} - ${exercise.name}${exercise.prescription ? ` (${exercise.prescription})` : ''}`).join('\n')}`
        : '';

      return {
        content: [{
          type: 'text',
          text: `Today is ${today}.\n\nCurrent commitments:\n${commitmentText}\n\nHealth: ${health?.title || 'none'}. AI: ${ai?.title || 'none'}.${healthExerciseText}`,
        }],
        structuredContent,
      };
    }
  );

  server.registerTool(
    'get_capture_review',
    {
      title: 'get_capture_review',
      description: 'Read the current review/proposals for a raw Personal Vault capture. Use this after capture_note or after waiting for the Codex heartbeat reviewer.',
      inputSchema: {
        capturePath: z.string().min(1).describe('Vault-relative raw capture path returned by capture_note.'),
      },
      _meta: { securitySchemes: oauthSecuritySchemes },
    },
    async ({ capturePath }, extra) => {
      const auth = await requireGoogleAuth(extra);
      if (!auth.ok) return authError(extra, auth.reason);
      const review = await loadCaptureReview(capturePath);
      if (!review.proposalSet && !review.codexReview) {
        return {
          isError: true,
          content: [{ type: 'text', text: `No capture review found yet for ${review.capturePath}.` }],
          structuredContent: review,
        };
      }

      const source = review.codexReview || review.proposalSet;
      const proposals = source.proposals || [];
      const questions = source.questions || [];
      const proposalText = proposals.length
        ? proposals.map((proposal, index) => `${index + 1}. ${proposal.id}: ${proposal.label || 'Proposal'} - ${proposal.preview || ''}`).join('\n')
        : 'None.';
      const questionText = questions.length
        ? questions.map((question, index) => `${index + 1}. ${question.question || question}`).join('\n')
        : 'None.';

      return {
        content: [
          {
            type: 'text',
            text: [
              `Review status for ${review.capturePath}: ${review.status}.`,
              source.interpretation ? `Interpretation: ${source.interpretation}` : '',
              '',
              'Proposals:',
              proposalText,
              '',
              'Clarifying questions:',
              questionText,
              '',
              'Do not call apply_capture_action unless the user explicitly approves a proposal.',
            ].filter(Boolean).join('\n'),
          },
        ],
        structuredContent: review,
      };
    }
  );

  server.registerTool(
    'search_vault',
    {
      title: 'search_vault',
      description: 'Search readable Markdown plus structured plan and exercise-reference content in Personal Vault for prior decisions, plans, captures, and project context.',
      inputSchema: {
        query: z.string().min(2),
        limit: z.number().int().min(1).max(10).optional(),
      },
      _meta: { securitySchemes: oauthSecuritySchemes },
    },
    async ({ query, limit = 5 }, extra) => {
      const auth = await requireGoogleAuth(extra);
      if (!auth.ok) return authError(extra, auth.reason);
      const files = await walkMarkdown(VAULT_ROOT, 400);
      const documents = await Promise.all(files.map(async (file) => ({
        path: path.relative(VAULT_ROOT, file),
        title: '',
        text: await readFile(file, 'utf-8').catch(() => ''),
        sourceType: 'markdown',
      })));
      documents.push(...await readStructuredSearchDocuments());
      const matches = documents.flatMap((document) => {
        const match = scoreSearchText(document.text, query);
        if (!match) return [];
        const titleMatch = document.title ? scoreSearchText(document.title, query) : null;
        return [{
          path: document.path,
          preview: document.text.slice(Math.max(0, match.index - 120), match.index + 280).replace(/\s+/g, ' ').trim(),
          sourceType: document.sourceType,
          score: match.score + (titleMatch ? 200 + titleMatch.score : 0),
        }];
      })
        .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path))
        .slice(0, limit);

      return {
        content: [{ type: 'text', text: matches.length ? `Found ${matches.length} vault matches.` : 'No vault matches found.' }],
        structuredContent: { query, matches },
      };
    }
  );

  return server;
}

const httpServer = createServer(async (req, res) => {
  if (!req.url) {
    res.writeHead(400).end('Missing URL');
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { 'content-type': 'text/plain' }).end('Personal Vault MCP server');
    return;
  }

  if (req.method === 'GET' && url.pathname === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify({
      status: 'ok',
      server: 'personal-vault',
      version: '0.1.1',
      mcpEndpoint: `${getPublicBaseUrl(req)}${MCP_PATH}`,
      authentication: GOOGLE_AUTH_ENABLED ? 'oauth-required' : 'disabled',
    }));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/.well-known/oauth-protected-resource') {
    const baseUrl = getPublicBaseUrl(req);
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
      resource: baseUrl,
      authorization_servers: [GOOGLE_AUTHORIZATION_SERVER],
      scopes_supported: OAUTH_SCOPES,
      resource_documentation: `${baseUrl}/`,
    }));
    return;
  }

  if (req.method === 'OPTIONS' && url.pathname === MCP_PATH) {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, GET, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'content-type, mcp-session-id, authorization',
      'Access-Control-Expose-Headers': 'Mcp-Session-Id',
    });
    res.end();
    return;
  }

  if (url.pathname === MCP_PATH && ['POST', 'GET', 'DELETE'].includes(req.method || '')) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');

    const server = createPersonalVaultServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    res.on('close', () => {
      transport.close();
      server.close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (error) {
      console.error('MCP request failed:', error);
      if (!res.headersSent) res.writeHead(500).end('Internal server error');
    }
    return;
  }

  res.writeHead(404).end('Not Found');
});

httpServer.listen(PORT, () => {
  console.log(`Personal Vault MCP server listening on http://localhost:${PORT}${MCP_PATH}`);
});
