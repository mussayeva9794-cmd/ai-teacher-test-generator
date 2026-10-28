// A copy of a student's not-yet-confirmed answers in this browser, so a dropped
// connection or a reload does not lose them. Only for regular (non-strict)
// tests: strict answers are accepted by the server one open question at a time.

const PREFIX = "mugalim_answers:";

type Backup = { answers: Record<string, unknown>; at: number };

const keyFor = (token: string, userId: string) => `${PREFIX}${token}:${userId}`;

export function saveBackup(token: string, userId: string, answers: Record<string, unknown>) {
  try { window.localStorage.setItem(keyFor(token, userId), JSON.stringify({ answers, at: Date.now() })); } catch { /* storage full or blocked */ }
}

export function readBackup(token: string, userId: string): Backup | null {
  try {
    const value = JSON.parse(window.localStorage.getItem(keyFor(token, userId)) || "null") as Backup | null;
    return value && typeof value.at === "number" && value.answers && typeof value.answers === "object" && !Array.isArray(value.answers) ? value : null;
  } catch { return null; }
}

export function clearBackup(token: string, userId: string) {
  try { window.localStorage.removeItem(keyFor(token, userId)); } catch { /* blocked */ }
}

/** On a shared computer, the next student must not inherit anyone's answers. */
export function clearAllBackups() {
  try {
    for (let i = window.localStorage.length - 1; i >= 0; i -= 1) {
      const key = window.localStorage.key(i);
      if (key?.startsWith(PREFIX)) window.localStorage.removeItem(key);
    }
  } catch { /* blocked */ }
}

/**
 * Answers to resume with. The copy is cleared as soon as the server confirms
 * exactly what it holds, so any copy still here has edits the server may not
 * have: they always win over the server's answers. (Comparing typing time
 * with the server's save time loses an answer when an older save lands late.)
 */
export function restoreAnswers(server: Record<string, unknown>, backup: Backup | null) {
  return backup ? { ...server, ...backup.answers } : server;
}

// Long enough to survive a lost connection during a lesson, short enough not to linger.
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

/**
 * Remove copies left by other students on this device and any older than a
 * school day, so a closed tab on a shared computer does not keep answers around.
 */
export function pruneBackups(currentUserId: string, now = Date.now()) {
  try {
    for (let i = window.localStorage.length - 1; i >= 0; i -= 1) {
      const key = window.localStorage.key(i);
      if (!key?.startsWith(PREFIX)) continue;
      let at = 0;
      try { at = Number((JSON.parse(window.localStorage.getItem(key) || "null") as Backup | null)?.at) || 0; } catch { /* unreadable */ }
      if (!key.endsWith(`:${currentUserId}`) || now - at > MAX_AGE_MS) window.localStorage.removeItem(key);
    }
  } catch { /* blocked */ }
}
