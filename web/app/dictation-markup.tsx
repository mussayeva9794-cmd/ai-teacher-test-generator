"use client";

import type { DictationError, Marks, MarkStatus, Op } from "@/lib/dictation";
import { markOf } from "@/lib/dictation";
import { useT } from "./i18n-provider";

type Token = { text: string; space: boolean };

const join = (tokens: Token[]) => tokens.map((token, i) => (i && token.space ? " " : "") + token.text).join("");
const lead = (tokens: Token[], first: boolean) => !first && tokens[0]?.space ? " " : "";

/**
 * The student's text with every mistake marked: crossed out what was written,
 * the right form beside it. With onMark the teacher can press a mistake to
 * change how it counts.
 */
export function DictationMarkup({ ops, errors, marks, onMark }: { ops: Op[]; errors: DictationError[]; marks?: Marks; onMark?: (error: DictationError, next: MarkStatus) => void }) {
  const w = useT().written;
  const cycle: Record<MarkStatus, MarkStatus> = { counted: "minor", minor: "ignored", ignored: "counted" };
  return <p className="dict-text">{ops.map((op, i) => {
    if (op.op === "same") return <span key={i}>{lead([op.given], i === 0)}{op.given.text}</span>;
    const error = errors[op.error];
    const status = markOf(error, marks);
    const given = op.op === "missing" ? [] : op.given;
    const expected = op.op === "extra" ? [] : op.expected;
    const label = w.errorLabel(join(given), join(expected), error.repeat && status === "ignored" ? w.repeat : w.status[status]);
    const body = <>{given.length > 0 && <del>{join(given)}</del>}{expected.length > 0 && <ins>{join(expected)}</ins>}</>;
    const className = `dict-err dict-${status}${error.kind === "punctuation" ? " dict-punct" : ""}`;
    return <span key={i}>{lead(given.length ? given : expected, i === 0)}{onMark
      ? <button type="button" className={className} aria-label={label} title={label} onClick={() => onMark(error, cycle[status])}>{body}</button>
      : <span className={className} title={label}>{body}</span>}</span>;
  })}</p>;
}
