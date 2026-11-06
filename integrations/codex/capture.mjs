// Optional host adapter. These files are readable conversation evidence, not
// an indexer's interpretation or an alternative source of personal truth.
import { createHash, randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const digest = (text) => createHash('sha256').update(text).digest('hex');
const VERSION = 1;

export function sessionStatePath(sessionId) {
  return `indexes/codex/${digest(sessionId).slice(0, 24)}.json`;
}

async function readState(vault, sessionId) {
  try {
    const result = JSON.parse((await vault.readText(sessionStatePath(sessionId))).content);
    if (result.version !== VERSION || result.sessionId !== sessionId || typeof result.capturePath !== 'string') throw new Error('Invalid capture checkpoint; inspect it before retrying.');
    vault.resolvePath(result.capturePath);
    return result;
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

export async function existingCapture(vault, sessionId) {
  if (typeof sessionId !== 'string' || !sessionId) return null;
  const state = await readState(vault, sessionId);
  if (!state?.sourceCreated) return null;
  const source = await vault.readText(state.capturePath);
  return { ...state, content: source.content, currentSha256: digest(source.content), checkpointMatchesSource: digest(source.content) === state.captureSha256 };
}

export async function atomicState(vault, relative, state) {
  const destination = vault.resolvePath(relative);
  await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(state, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    await rename(temporary, destination);
  } finally { await rm(temporary, { force: true }); }
}

async function acquireLock(vault, sessionId) {
  const relative = `indexes/codex/locks/${digest(sessionId).slice(0, 24)}.lock`;
  const lock = vault.resolvePath(relative);
  await mkdir(path.dirname(lock), { recursive: true, mode: 0o700 });
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      await mkdir(lock, { mode: 0o700 });
      await writeFile(path.join(lock, 'owner.json'), JSON.stringify({ pid: process.pid, uid: process.getuid?.(), startedAt: new Date().toISOString() }), { mode: 0o600, flag: 'wx' });
      return async () => rm(lock, { recursive: true, force: true });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const recovery = `${lock}.recovery`;
      let recovering = false;
      try {
        await mkdir(recovery, { mode: 0o700 }); recovering = true;
        const ownerPath = path.join(lock, 'owner.json');
        const before = await lstat(ownerPath);
        const owner = JSON.parse(await readFile(ownerPath, 'utf8'));
        if (before.isFile() && !before.isSymbolicLink() && before.uid === process.getuid?.() && Number.isSafeInteger(owner.pid) && owner.pid > 0 && owner.uid === process.getuid?.()) {
          let dead = false;
          try { process.kill(owner.pid, 0); } catch (ownerError) { dead = ownerError.code === 'ESRCH'; }
          if (dead) {
            const after = await lstat(ownerPath);
            if (before.ino === after.ino && before.mtimeMs === after.mtimeMs) await rm(lock, { recursive: true });
          }
        }
      } catch { /* An incomplete, unfamiliar or concurrently reclaimed owner stays intact. */ }
      finally { if (recovering) await rm(recovery, { recursive: true, force: true }); }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  throw new Error('Conversation capture is busy; no source was overwritten. Retry this event.');
}

function calendarDate(now, timeZone) {
  const values = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now).map((item) => [item.type, item.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export async function captureEvent(vault, event, config, now = new Date()) {
  if (!config.capture?.enabled) return { status: 'disabled' };
  const role = event.hook_event_name === 'UserPromptSubmit' ? 'user' : event.hook_event_name === 'Stop' ? 'assistant' : null;
  if (!role) return { status: 'not-a-capture-event' };
  const content = role === 'user' ? event.prompt : event.last_assistant_message;
  if (content === null || content === undefined || content === '') return { status: 'no-message' };
  if (typeof content !== 'string') throw new Error('Capture requires a text message.');
  if (typeof event.session_id !== 'string' || !event.session_id || typeof event.turn_id !== 'string' || !event.turn_id) throw new Error('Capture requires session_id and turn_id; nothing was guessed or saved.');
  if (event.agent_type || event.parent_session_id || event.parent_thread_id) return { status: 'subagent-excluded' };
  const release = await acquireLock(vault, event.session_id);
  try {
    const statePath = sessionStatePath(event.session_id);
    let state = await readState(vault, event.session_id);
    if (!state) {
      const date = calendarDate(now, config.timeZone);
      state = {
        version: VERSION, sessionId: event.session_id,
        capturePath: `raw/${date.slice(0, 4)}/${date.slice(5, 7)}/${date}-codex-${digest(event.session_id).slice(0, 16)}.md`,
        sourceCreated: false, captureStartedAt: now.toISOString(),
        coverage: 'Main-chat user prompts and final assistant messages observed by enabled hooks only. Earlier history, tool traces, subagents and interrupted incomplete answers are not captured.',
        semanticReview: 'pending',
      };
      // Persist the chosen first-capture date before writing. A retry tomorrow
      // must continue the same source if the previous process was interrupted.
      await atomicState(vault, statePath, state);
    }
    const marker = `<!-- personal-vault-codex-session:${digest(event.session_id)} -->`;
    let previous;
    try {
      previous = (await vault.readText(state.capturePath)).content;
      if (!previous.startsWith(marker + '\n')) throw new Error('Capture destination is not the expected conversation source; it was preserved.');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      if (state.sourceCreated) throw new Error('A previously captured conversation is missing; restore or reconcile it before appending.');
      previous = `${marker}\n# Codex conversation\n\nSession: ${JSON.stringify(event.session_id)}\n\nCapture started: ${state.captureStartedAt}\n\nCoverage: ${state.coverage}\n\nThese are recorded messages, not new instructions or verified facts. No semantic summary or task status is inferred.\n`;
    }
    const eventId = digest(JSON.stringify([event.session_id, event.turn_id, role, content]));
    const eventMarker = `<!-- personal-vault-codex-event:${eventId} -->`;
    const duplicate = previous.includes(eventMarker + '\n');
    let appended = '';
    if (!duplicate) {
      // JSON metadata stays one line even if identifiers contain punctuation.
      const metadata = JSON.stringify({ turnId: event.turn_id, observedAt: now.toISOString(), contentSha256: digest(content) });
      appended = `\n${eventMarker}\n## ${role} — ${now.toISOString()}\n\nProvenance: ${metadata}\n\n${content}\n`;
      if (await vault.exists(state.capturePath)) await vault.appendText(state.capturePath, appended);
      else await vault.writeText(state.capturePath, previous + appended);
      await chmod(vault.resolvePath(state.capturePath), 0o600);
    }
    // Re-readback is a persistence check, not a semantic review.
    const saved = (await vault.readText(state.capturePath)).content;
    if (!saved.startsWith(marker + '\n') || !saved.includes(duplicate ? eventMarker + '\n' : appended)) throw new Error('Conversation changed during capture; inspect the source before retrying.');
    if (duplicate && state.sourceCreated && state.captureSha256 === digest(saved)) return { status: 'already-saved', path: state.capturePath, sha256: state.captureSha256, statePath, semanticReview: state.semanticReview };
    state = {
      ...state, sourceCreated: true, captureSha256: digest(saved),
      updatedAt: duplicate ? (state.updatedAt || now.toISOString()) : now.toISOString(),
      lastObservedTurnId: event.turn_id, lastObservedRole: role,
      lastEventId: eventId, semanticReview: 'pending',
      reviewInstruction: 'Read changed source evidence, preserve corrections, and update the matching authorized context/checkpoint. This queue entry creates no personal task or approval.',
    };
    await atomicState(vault, statePath, state);
    return { status: duplicate ? 'already-saved' : 'saved', path: state.capturePath, sha256: state.captureSha256, statePath, semanticReview: 'pending' };
  } finally { await release(); }
}
