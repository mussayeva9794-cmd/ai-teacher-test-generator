"use client";

import { useMemo, useState } from "react";
import { analyzeVariant, type AnalyticsAttempt, type HeatCell } from "@/lib/analytics";
import { variantLabel } from "@/lib/labels";
import type { TestRow } from "@/lib/types";
import type { Dictionary } from "@/lib/i18n/dictionaries";

const pct = (value: number) => Math.round(value * 100);
const tone = (value: HeatCell) => value === "absent" ? "none" : value === null ? "pending" : value >= 1 ? "right" : value > 0 ? "partly" : "wrong";
// A class average is coloured by how well the class did, not by any score above zero.
const averageTone = (value: number | null) => value === null ? "pending" : value >= 0.9 ? "right" : value < 0.4 ? "wrong" : "partly";

/** Heat map and question breakdown for one variant of a test. */
export function ClassAnalytics({ t, test, attempts }: { t: Dictionary; test: TestRow; attempts: AnalyticsAttempt[] }) {
  const p = t.testPage;
  const variants = Object.keys(test.variants).filter(name => attempts.some(attempt => attempt.variant_name === name));
  const [variant, setVariant] = useState(variants[0] || "");
  const data = useMemo(() => variant ? analyzeVariant(variant, attempts, test.variants[variant]?.questions || []) : null, [variant, attempts, test]);
  if (!data || !data.attempts) return <p className="muted">{p.analyticsNone}</p>;
  const hardestFirst = [...data.questions].sort((a, b) => (a.average ?? 2) - (b.average ?? 2));
  const cellText = (value: HeatCell) => value === "absent" ? p.heatAbsent : value === null ? p.heatPending : `${pct(value)}%`;
  return <div className="stack analytics">
    {variants.length > 1 && <div className="tabs">{variants.map(name => <button key={name} className={name === variant ? "active" : ""} onClick={() => setVariant(name)}>{variantLabel(name, t)}</button>)}</div>}
    <p className="muted small" style={{ margin: 0 }}>{p.analyticsLead}</p>
    <div className="heat-scroll" tabIndex={0} aria-label={p.analytics}>
      <table className="heatmap">
        <thead><tr><th scope="col">{p.heatStudent}</th>{data.questions.map(question => <th scope="col" key={question.id} title={question.text}>{question.number}</th>)}<th scope="col">{p.heatTotal}</th></tr></thead>
        <tbody>
          {data.rows.map(row => <tr key={row.attemptId}><th scope="row">{row.student}{row.email && <span className="student-email muted small">{row.email}</span>}</th>{row.cells.map((cell, i) => <td key={i} className={`heat-${tone(cell)}`} title={p.heatCell(row.student, i + 1, cellText(cell))}><span className="sr-only">{cellText(cell)}</span></td>)}<td className="heat-total">{row.total === null ? "—" : `${pct(row.total)}%`}</td></tr>)}
          <tr className="heat-average"><th scope="row">%</th>{data.questions.map(question => <td key={question.id} className={`heat-${averageTone(question.average)}`}>{question.average === null ? "—" : pct(question.average)}</td>)}<td /></tr>
        </tbody>
      </table>
    </div>
    <div className="heat-legend small muted" aria-hidden="true"><span><i className="heat-right" />{p.legendRight}</span><span><i className="heat-partly" />{p.legendPartly}</span><span><i className="heat-wrong" />{p.legendWrong}</span><span><i className="heat-pending" />{p.legendPending}</span></div>
    <h3 style={{ margin: "12px 0 0" }}>{p.itemsTitle}</h3>
    <p className="muted small" style={{ margin: 0 }}>{p.itemsLead}</p>
    {hardestFirst.map(question => <div className={`item-stat level-${question.level || "none"}`} key={question.id}>
      <div className="row"><b>{p.question(question.number)}</b>{question.level === "hard" ? <span className="pill">{p.levelHard}</span> : question.level === "easy" ? <span className="pill soft">{p.levelEasy}</span> : null}</div>
      <p style={{ margin: "4px 0" }}>{question.text || <i className="muted">{p.itemNoText}</i>}</p>
      <div className="item-bar" aria-hidden="true"><span style={{ width: `${question.average === null ? 0 : pct(question.average)}%` }} /></div>
      <p className="small muted" style={{ margin: "6px 0 0" }}>{question.average === null ? p.heatPending : p.itemSolved(pct(question.average), question.graded)}{question.unanswered ? ` · ${p.itemUnanswered(question.unanswered)}` : ""}</p>
      {question.wrongAnswers.length > 0 && <p className="small" style={{ margin: "4px 0 0" }}>{p.itemWrong} {question.wrongAnswers.map(item => `«${item.answer}» × ${item.count}`).join(", ")}</p>}
    </div>)}
  </div>;
}
