"use client";

import type { Assessment, TestVariant } from "@/lib/types";
import type { Dictionary } from "@/lib/i18n/dictionaries";

/** The summative assessment (SOR / SOCh) table of one variant, editable in place. */
export function RubricEditor({ t, variant, edit }: { t: Dictionary; variant: TestVariant; edit: (mutator: (assessment: Assessment) => void) => void }) {
  const p = t.testPage;
  const assessment = variant.assessment!;
  const total = assessment.rows.reduce((sum, row) => sum + row.points, 0);
  const tasks = new Set(assessment.rows.map(row => row.task));
  const stale = assessment.rows.some(row => row.task > variant.questions.length) || variant.questions.some((_, i) => !tasks.has(i + 1));
  return <section className="panel stack rubric">
    <div><div className="eyebrow">{t.labels.assessmentKind[assessment.kind]}</div><h3 style={{ margin: "6px 0" }}>{p.rubricTitle(t.labels.assessmentKind[assessment.kind])}</h3><p className="muted small" style={{ margin: 0 }}>{p.rubricLead}</p></div>
    {stale && <p className="notice small" role="status">{p.rubricStale}</p>}
    <div className="rubric-scroll"><table className="rubric-table">
      <thead><tr><th scope="col">{p.rubricTask}</th><th scope="col">{p.rubricCriterion}</th><th scope="col">{p.rubricLevel}</th><th scope="col">{p.rubricDescriptor}</th><th scope="col">{p.rubricPoints}</th></tr></thead>
      <tbody>{assessment.rows.map((row, i) => {
        const level = variant.questions[row.task - 1]?.bloom_level;
        return <tr key={i}>
          <td className="rubric-num">{row.task}</td>
          <td><textarea aria-label={`${p.rubricCriterion} ${row.task}`} value={row.criterion} onChange={e => edit(a => { a.rows[i].criterion = e.target.value; })} /></td>
          <td className="small">{level ? t.labels.bloom[level] : "—"}</td>
          <td><textarea aria-label={`${p.rubricDescriptor} ${row.task}`} value={row.descriptor} onChange={e => edit(a => { a.rows[i].descriptor = e.target.value; })} /></td>
          <td><input aria-label={`${p.rubricPoints} ${row.task}`} type="number" min={0} max={10} value={row.points} onChange={e => edit(a => { a.rows[i].points = Math.max(0, Math.min(10, Math.round(Number(e.target.value) || 0))); })} /></td>
        </tr>;
      })}</tbody>
    </table></div>
    <p className="small" style={{ margin: 0 }}><b>{p.rubricTotal(total)}</b></p>
  </section>;
}
