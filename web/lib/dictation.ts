// Checking typed dictations, word dictations and copying against the
// teacher's text. Mistakes are found by aligning the two texts, never by AI:
// the same text always gives the same mistakes, on the server and in the browser.

export const DICTATION_MODES = ["dictation", "words", "copy"] as const;
export type DictationMode = typeof DICTATION_MODES[number];

/** The most mistakes a grade allows: spelling, punctuation and both together. */
export type Limits = { spelling: number; punctuation: number; total: number };
export type GradeNorms = { five: Limits; four: Limits; three: Limits };
export type SchoolGrade = 2 | 3 | 4 | 5;

/** How the teacher counts one mistake. Unmarked mistakes count in full, repeats not at all. */
export type MarkStatus = "counted" | "minor" | "ignored";
export type Marks = Record<string, MarkStatus>;

export const MARK_STATUSES: readonly MarkStatus[] = ["counted", "minor", "ignored"];

// Classic school norms; the teacher can change them per work.
export const DEFAULT_NORMS: Record<DictationMode, GradeNorms> = {
  dictation: { five: { spelling: 0, punctuation: 0, total: 0 }, four: { spelling: 2, punctuation: 4, total: 4 }, three: { spelling: 4, punctuation: 7, total: 8 } },
  words: { five: { spelling: 0, punctuation: 0, total: 0 }, four: { spelling: 2, punctuation: 0, total: 2 }, three: { spelling: 4, punctuation: 0, total: 4 } },
  copy: { five: { spelling: 0, punctuation: 0, total: 0 }, four: { spelling: 1, punctuation: 1, total: 1 }, three: { spelling: 2, punctuation: 2, total: 2 } },
};

// A grade as a share of full marks, chosen so that schoolGrade() of the
// percentage gives the same grade back.
export const GRADE_SCORE: Record<SchoolGrade, number> = { 5: 1, 4: 0.75, 3: 0.5, 2: 0.25 };

/** Kazakhstan's percentage-to-grade scale for summative work. */
export function schoolGrade(percentage: number): SchoolGrade {
  return percentage >= 85 ? 5 : percentage >= 65 ? 4 : percentage >= 40 ? 3 : 2;
}

export const MAX_REFERENCE_LENGTH = 6000;
export const MAX_WRITTEN_ANSWER_LENGTH = 10000;

type Token = { kind: "word" | "punct"; text: string; key: string; space: boolean };

// Words keep inner hyphens and apostrophes (кое-как, don't); every other
// non-space character is a punctuation mark of its own.
const TOKEN = /[\p{L}\p{N}\p{M}]+(?:[-'’ʼ][\p{L}\p{N}\p{M}]+)*|[^\s\p{L}\p{N}\p{M}]/gu;
const QUOTES = /["«»“”„‟]/u;
const DASHES = /[-‐‑‒–—―−]/u;

function punctKey(char: string) {
  if (QUOTES.test(char)) return "\"";
  if (DASHES.test(char)) return "—";
  if (char === "’" || char === "‘") return "'";
  return char;
}

export function tokenize(text: string, mode: DictationMode): Token[] {
  const source = String(text ?? "").replace(/\.{3}/g, "…");
  const tokens: Token[] = [];
  for (const match of source.matchAll(TOKEN)) {
    const value = match[0];
    const at = match.index ?? 0;
    const space = at > 0 && /\s/u.test(source[at - 1]);
    if (/[\p{L}\p{N}\p{M}]/u.test(value[0])) {
      // ё and е count as one letter, as in Russian schools.
      let key = value.replace(/[’ʼ]/g, "'").replace(/ё/g, "е").replace(/Ё/g, "Е");
      if (mode === "words") key = key.toLocaleLowerCase();
      tokens.push({ kind: "word", text: value, key, space });
    } else if (mode !== "words") {
      tokens.push({ kind: "punct", text: value, key: punctKey(value), space });
    }
  }
  return tokens;
}

export type Op =
  | { op: "same"; given: Token }
  | { op: "wrong"; expected: Token[]; given: Token[]; error: number }
  | { op: "missing"; expected: Token[]; error: number }
  | { op: "extra"; given: Token[]; error: number };

export type DictationError = {
  id: number;
  kind: "spelling" | "punctuation";
  expected: string;
  given: string;
  // A later misspelling of a word already misspelled: by school rules it is not counted again.
  repeat: boolean;
};

export type DictationCheck = {
  ops: Op[];
  errors: DictationError[];
  spelling: number;
  punctuation: number;
  grade: SchoolGrade;
  score: number;
  empty: boolean;
};

function lcsPairs(a: Token[], b: Token[]): Array<[number, number]> {
  const n = a.length;
  const m = b.length;
  const width = m + 1;
  const table = new Uint16Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i * width + j] = a[i].key === b[j].key && a[i].kind === b[j].kind
        ? table[(i + 1) * width + j + 1] + 1
        : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    }
  }
  const pairs: Array<[number, number]> = [];
  let i = 0; let j = 0;
  while (i < n && j < m) {
    if (a[i].key === b[j].key && a[i].kind === b[j].kind) { pairs.push([i, j]); i++; j++; }
    else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) i++;
    else j++;
  }
  return pairs;
}

function editDistance(a: string, b: string) {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[b.length];
}

const lower = (token: Token) => token.key.toLocaleLowerCase();
const joined = (tokens: Token[]) => tokens.map(token => lower(token).replace(/-/g, "")).join("");

/** The same word written with a mistake rather than another word. */
function similar(a: Token, b: Token) {
  const x = lower(a); const y = lower(b);
  return editDistance(x, y) <= Math.max(1, Math.ceil(Math.max(x.length, y.length) / 2));
}

type GapStep = { kind: "sub"; expected: Token[]; given: Token[] } | { kind: "del"; expected: Token } | { kind: "ins"; given: Token };

// Pair up what differs between two matched stretches: a misspelt word with
// its word, a wrong mark with its mark, and words written together or apart
// (не знаю / незнаю, по-моему / по моему) as one mistake.
function alignGap(expected: Token[], given: Token[]): GapStep[] {
  const n = expected.length;
  const m = given.length;
  if (!n || !m || n * m > 250000) {
    return [...expected.map(token => ({ kind: "del", expected: token }) as GapStep), ...given.map(token => ({ kind: "ins", given: token }) as GapStep)];
  }
  const cost = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(Infinity));
  const back = Array.from({ length: n + 1 }, () => new Array<[number, number]>(m + 1));
  cost[0][0] = 0;
  const relax = (i: number, j: number, fromI: number, fromJ: number, step: number) => {
    if (cost[fromI][fromJ] + step < cost[i][j]) { cost[i][j] = cost[fromI][fromJ] + step; back[i][j] = [fromI, fromJ]; }
  };
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= m; j++) {
      if (i > 0) relax(i, j, i - 1, j, 1);
      if (j > 0) relax(i, j, i, j - 1, 1);
      if (i > 0 && j > 0) {
        const a = expected[i - 1]; const b = given[j - 1];
        if (a.kind === b.kind && (a.kind === "punct" || similar(a, b))) relax(i, j, i - 1, j - 1, 1);
      }
      if (i > 1 && j > 0 && expected[i - 2].kind === "word" && expected[i - 1].kind === "word" && given[j - 1].kind === "word" &&
        joined(expected.slice(i - 2, i)) === joined([given[j - 1]])) relax(i, j, i - 2, j - 1, 1);
      if (i > 0 && j > 1 && expected[i - 1].kind === "word" && given[j - 2].kind === "word" && given[j - 1].kind === "word" &&
        joined([expected[i - 1]]) === joined(given.slice(j - 2, j))) relax(i, j, i - 1, j - 2, 1);
    }
  }
  const steps: GapStep[] = [];
  let i = n; let j = m;
  while (i > 0 || j > 0) {
    const [fromI, fromJ] = back[i][j];
    if (fromJ === j) steps.push({ kind: "del", expected: expected[i - 1] });
    else if (fromI === i) steps.push({ kind: "ins", given: given[j - 1] });
    else steps.push({ kind: "sub", expected: expected.slice(fromI, i), given: given.slice(fromJ, j) });
    i = fromI; j = fromJ;
  }
  return steps.reverse();
}

/** Every difference between the teacher's text and the student's, in reading order. */
export function compareTexts(reference: string, answer: string, mode: DictationMode): { ops: Op[]; errors: DictationError[] } {
  const expected = tokenize(reference, mode);
  // A runaway answer is cut so the comparison table stays small; the rest is not graded.
  const given = tokenize(answer, mode).slice(0, Math.min(expected.length * 3 + 200, Math.floor(8_000_000 / Math.max(1, expected.length))));
  const ops: Op[] = [];
  const errors: DictationError[] = [];
  const misspelt = new Set<string>();
  const add = (kind: DictationError["kind"], expectedText: string, givenText: string, word?: string) => {
    const repeat = word !== undefined && misspelt.has(word);
    if (word !== undefined) misspelt.add(word);
    errors.push({ id: errors.length, kind, expected: expectedText, given: givenText, repeat });
    return errors.length - 1;
  };
  const text = (tokens: Token[]) => tokens.map((token, i) => (i && token.space ? " " : "") + token.text).join("");
  const flush = (from: [number, number], to: [number, number]) => {
    for (const step of alignGap(expected.slice(from[0], to[0]), given.slice(from[1], to[1]))) {
      // Every lost or added word counts: a half-written dictation must not pass as one mistake.
      if (step.kind === "del") ops.push({ op: "missing", expected: [step.expected], error: add(step.expected.kind === "word" ? "spelling" : "punctuation", step.expected.text, "") });
      else if (step.kind === "ins") ops.push({ op: "extra", given: [step.given], error: add(step.given.kind === "word" ? "spelling" : "punctuation", "", step.given.text) });
      else {
        const kind = step.expected[0].kind === "word" ? "spelling" : "punctuation";
        const word = kind === "spelling" ? step.expected.map(lower).join(" ") : undefined;
        ops.push({ op: "wrong", expected: step.expected, given: step.given, error: add(kind, text(step.expected), text(step.given), word) });
      }
    }
  };
  let previous: [number, number] = [0, 0];
  for (const [i, j] of lcsPairs(expected, given)) {
    flush(previous, [i, j]);
    ops.push({ op: "same", given: given[j] });
    previous = [i + 1, j + 1];
  }
  flush(previous, [expected.length, given.length]);
  return { ops, errors };
}

export function markOf(error: DictationError, marks: Marks | undefined): MarkStatus {
  const mark = marks?.[String(error.id)];
  return mark && MARK_STATUSES.includes(mark) ? mark : error.repeat ? "ignored" : "counted";
}

/** Mistakes that count: two minor ones make one. */
export function countErrors(errors: DictationError[], marks: Marks | undefined) {
  const count = (kind: DictationError["kind"]) => {
    const own = errors.filter(error => error.kind === kind);
    const full = own.filter(error => markOf(error, marks) === "counted").length;
    const minor = own.filter(error => markOf(error, marks) === "minor").length;
    return full + Math.floor(minor / 2);
  };
  return { spelling: count("spelling"), punctuation: count("punctuation") };
}

export function gradeFor(norms: GradeNorms, spelling: number, punctuation: number): SchoolGrade {
  const fits = (limits: Limits) => spelling <= limits.spelling && punctuation <= limits.punctuation && spelling + punctuation <= limits.total;
  return fits(norms.five) ? 5 : fits(norms.four) ? 4 : fits(norms.three) ? 3 : 2;
}

export function checkDictation(reference: string, answer: unknown, mode: DictationMode, norms: GradeNorms, marks?: Marks): DictationCheck {
  const text = typeof answer === "string" ? answer.slice(0, MAX_WRITTEN_ANSWER_LENGTH) : "";
  const { ops, errors } = compareTexts(reference, text, mode);
  const empty = !tokenize(text, mode).some(token => token.kind === "word");
  const { spelling, punctuation } = countErrors(errors, marks);
  // A blank sheet is a 2 with no marks at all.
  const grade = empty ? 2 : gradeFor(norms, spelling, punctuation);
  return { ops, errors, spelling, punctuation, grade, score: empty ? 0 : GRADE_SCORE[grade], empty };
}

/**
 * What a graded dictation keeps in the attempt: the text and norms it was
 * checked against (later edits to the work do not move old mistakes), the
 * teacher's marks and the outcome.
 */
export type DictationRecord = {
  mode: DictationMode;
  reference: string;
  norms: GradeNorms;
  marks?: Marks;
  grade: SchoolGrade;
  spelling: number;
  punctuation: number;
};

export function dictationRecord(reference: string, answer: unknown, mode: DictationMode, norms: GradeNorms, marks?: Marks): { record: DictationRecord; score: number } {
  const check = checkDictation(reference, answer, mode, norms, marks);
  return {
    record: { mode, reference, norms, ...(marks && Object.keys(marks).length ? { marks } : {}), grade: check.grade, spelling: check.spelling, punctuation: check.punctuation },
    score: check.score,
  };
}

/** A stored record as sent back by the database, or null when it is not one. */
export function readDictationRecord(value: unknown): DictationRecord | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<DictationRecord>;
  if (!(DICTATION_MODES as readonly unknown[]).includes(record.mode) || typeof record.reference !== "string" || !isValidNorms(record.norms) ||
    ![2, 3, 4, 5].includes(record.grade as number) || (record.marks !== undefined && !isValidMarks(record.marks, Number.MAX_SAFE_INTEGER))) return null;
  return record as DictationRecord;
}

export function isValidNorms(value: unknown): value is GradeNorms {
  if (!value || typeof value !== "object") return false;
  const norms = value as Record<string, unknown>;
  const limits = (["five", "four", "three"] as const).map(name => norms[name] as Record<string, unknown> | undefined);
  const fields = ["spelling", "punctuation", "total"] as const;
  if (!limits.every(item => item && typeof item === "object" && fields.every(field => Number.isInteger(item[field]) && (item[field] as number) >= 0 && (item[field] as number) <= 50))) return false;
  // A better grade can never allow more mistakes than a worse one.
  return fields.every(field => (limits[0]![field] as number) <= (limits[1]![field] as number) && (limits[1]![field] as number) <= (limits[2]![field] as number));
}

export function isValidMarks(value: unknown, errorCount: number): value is Marks {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.entries(value).every(([id, mark]) => /^\d+$/.test(id) && Number(id) < errorCount && MARK_STATUSES.includes(mark as MarkStatus));
}
