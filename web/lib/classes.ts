const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizedClassName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim().replace(/\s+/g, " ");
  return name.length >= 1 && name.length <= 48 ? name : null;
}

export function normalizedClassEmails(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 100) return null;
  const emails = value.map((entry) => typeof entry === "string" ? entry.trim().toLowerCase() : "");
  if (emails.some((email) => email.length > 254 || !EMAIL_PATTERN.test(email))) return null;
  return [...new Set(emails)];
}

// A roster entry: the student's email and, optionally, the name the teacher
// typed for them ("Фамилия Имя"). The roster name is shown before the
// Google profile name, because it is the one the teacher recognises.
export type RosterEntry = { email: string; full_name: string | null };

const MAX_ROSTER = 100;
export const MAX_STUDENT_NAME = 120;
// An apostrophe may sit inside the part before @ (o'brien@school.kz), never at its ends.
const EMAIL_IN_TEXT = /[^\s,;<>()"'|]+(?:'[^\s,;<>()"'|]+)*@[^\s,;<>()"'|]+\.[^\s,;<>()"'|]+/gu;
// "1. ", "2) " or "3 " before a name in a numbered list.
const LINE_NUMBER = /^\d{1,4}(?:[.)]?(?:\s+|$)|[.)](?=\p{L}))/u;

/** A teacher-typed student name: whitespace collapsed, at least one letter, no control characters. */
export function normalizedStudentName(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || /[\p{Cc}\p{Cf}]/u.test(value.replace(/[\t\n\r]/g, " "))) return undefined;
  const name = value.trim().replace(/\s+/g, " ");
  if (!name) return null;
  return name.length <= MAX_STUDENT_NAME && /\p{L}/u.test(name) ? name : undefined;
}

/** Server-side roster check: up to 100 entries, deduplicated by email; a later name replaces an earlier one. */
export function normalizedClassStudents(value: unknown): RosterEntry[] | null {
  if (!Array.isArray(value) || value.length > MAX_ROSTER) return null;
  const byEmail = new Map<string, RosterEntry>();
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const { email, full_name } = item as { email?: unknown; full_name?: unknown };
    const emails = normalizedClassEmails([email]);
    const name = normalizedStudentName(full_name);
    if (!emails || name === undefined) return null;
    const previous = byEmail.get(emails[0]);
    byEmail.set(emails[0], { email: emails[0], full_name: name ?? previous?.full_name ?? null });
  }
  return [...byEmail.values()];
}

/**
 * Reads a pasted roster: one student per line as "Фамилия Имя, email" (any
 * order; comma, tab or spaces between), or plain emails as before, several
 * to a line. A list number before the name is dropped. Lines it cannot read
 * are returned so the teacher can fix them.
 */
export function parseRoster(text: string): { entries: RosterEntry[]; invalid: string[] } {
  const entries: RosterEntry[] = [];
  const invalid: string[] = [];
  for (const line of rosterRecords(text)) {
    const emails = line.match(EMAIL_IN_TEXT) || [];
    // Apostrophes between letters belong to the name (O'Brien); others are quotes.
    const rest = line.replace(EMAIL_IN_TEXT, " ").replace(/[<>()"|,;\t]/g, " ")
      .replace(/(?<!\p{L})'|'(?!\p{L})/gu, " ").trim().replace(LINE_NUMBER, "")
      .replace(/^[\s\-–—:.]+|[\s\-–—:.]+$/gu, "").replace(/\s+/g, " ").trim();
    const name = normalizedStudentName(rest);
    const valid = emails.length > 0 && normalizedClassEmails(emails) !== null && name !== undefined && (emails.length === 1 || !name);
    if (!valid) { invalid.push(line); continue; }
    for (const email of emails) entries.push({ email: email.toLowerCase(), full_name: name ?? null });
  }
  return { entries, invalid };
}

/**
 * Splits pasted text into student records. A ";" separates students when
 * every part has an email ("Иванов, a@x.kz; Петров, b@x.kz"); otherwise it
 * separates the columns of one row, as Excel in ru/kk saves "Иванов;a@x.kz".
 */
function rosterRecords(text: string): string[] {
  const records: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const parts = line.split(";").map((part) => part.trim()).filter(Boolean);
    const onePerPart = parts.length > 1 && parts.every((part) => (part.match(EMAIL_IN_TEXT) || []).length > 0);
    records.push(...(onePerPart ? parts : [line]));
  }
  return records;
}

/** A roster from a request body: `students` with names, or the older `emails` list. */
export function rosterFromBody(body: { emails?: unknown; students?: unknown }): RosterEntry[] | null {
  if (body.students !== undefined) return normalizedClassStudents(body.students);
  return normalizedClassEmails(body.emails)?.map((email) => ({ email, full_name: null })) ?? null;
}
