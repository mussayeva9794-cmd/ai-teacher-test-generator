"use client";

import type { ReviewItem } from "@/lib/assessment";
import { useT } from "../../i18n-provider";

/** The after-submission review, shown only when the teacher allowed it. */
export function AnswerReview({ items }: { items: ReviewItem[] }) {
  const st = useT().student;
  const verdict = (score: number | null) => score === null ? ["pending", st.reviewPending]
    : score >= 1 ? ["right", st.reviewRight] : score > 0 ? ["partly", st.reviewPartly] : ["wrong", st.reviewWrong];
  return <section className="stack answer-review" aria-label={st.reviewTitle}>
    <h2>{st.reviewTitle}</h2>
    {items.map((item, i) => {
      const [kind, label] = verdict(item.score);
      return <article className={`panel review-item review-${kind}`} key={item.id}>
        <div className="row"><span className="eyebrow">{st.questionOf(i + 1, items.length)}</span><span className="review-verdict">{label}</span></div>
        <p className="review-question">{item.question}</p>
        <p><span className="muted">{st.reviewYour}: </span>{item.given || <i className="muted">{st.reviewNoAnswer}</i>}</p>
        {kind !== "right" && <p><span className="muted">{st.reviewCorrect}: </span><b>{item.correct}</b></p>}
        {item.explanation && <p className="muted small">{item.explanation}</p>}
      </article>;
    })}
  </section>;
}
