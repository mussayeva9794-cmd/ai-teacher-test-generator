"use client";

import type { ReviewItem } from "@/lib/assessment";
import { compareTexts } from "@/lib/dictation";
import { DictationMarkup } from "../../dictation-markup";
import { useT } from "../../i18n-provider";

/** The after-submission review, shown only when the teacher allowed it. */
export function AnswerReview({ items }: { items: ReviewItem[] }) {
  const t = useT();
  const st = t.student;
  const verdict = (score: number | null, checked: boolean) => score === null ? ["pending", checked ? st.reviewChecked : st.reviewPending]
    : score >= 1 ? ["right", st.reviewRight] : score > 0 ? ["partly", st.reviewPartly] : ["wrong", st.reviewWrong];
  return <section className="stack answer-review" aria-label={st.reviewTitle}>
    <h2>{st.reviewTitle}</h2>
    {items.map((item, i) => {
      const [kind, label] = verdict(item.score, item.checked);
      return <article className={`panel review-item review-${kind}`} key={item.id}>
        <div className="row"><span className="eyebrow">{st.questionOf(i + 1, items.length)}</span><span className="review-verdict">{label}</span></div>
        <p className="review-question">{item.question}</p>
        {item.dictation ? (() => {
          const { ops, errors } = compareTexts(item.dictation.reference, item.given, item.dictation.mode);
          return <><p><b>{t.written.grade(item.dictation.grade)}</b> · {t.written.errorsSummary(item.dictation.spelling, item.dictation.punctuation)}</p>
            {item.given ? <DictationMarkup ops={ops} errors={errors} marks={item.dictation.marks} /> : <i className="muted">{st.reviewNoAnswer}</i>}</>;
        })() : <>
        <p><span className="muted">{st.reviewYour}: </span>{item.given || <i className="muted">{st.reviewNoAnswer}</i>}</p>
        {kind !== "right" && item.correct && <p><span className="muted">{st.reviewCorrect}: </span><b>{item.correct}</b></p>}</>}
        {item.explanation && <p className="muted small">{item.explanation}</p>}
      </article>;
    })}
  </section>;
}
