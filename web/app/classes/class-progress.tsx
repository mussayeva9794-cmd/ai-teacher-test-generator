"use client";

import { useState } from "react";
import { api } from "@/lib/client";
import type { ProgressRow, ProgressTest } from "@/lib/progress";
import { serverMessage } from "@/lib/i18n/server-message";
import { useT } from "../i18n-provider";

const tone = (value: number) => value >= 85 ? "right" : value >= 50 ? "partly" : "wrong";

/** A class's results across tests, opened on request from the class card. */
export function ClassProgress({ classId }: { classId: string }) {
  const t = useT();
  const c = t.classes;
  const [data, setData] = useState<{ columns: ProgressTest[]; rows: ProgressRow[]; truncated?: boolean } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function toggle() {
    if (data) { setData(null); return; }
    setLoading(true); setError("");
    try { setData(await api(`/api/classes/${classId}/progress`)); }
    catch (cause) { setError(serverMessage(t, cause instanceof Error ? cause.message : "", c.progressFailed)); }
    finally { setLoading(false); }
  }

  return <div className="stack">
    <div><button type="button" className="btn" disabled={loading} aria-expanded={Boolean(data)} onClick={() => void toggle()}>{loading ? c.progressLoading : data ? c.progressHide : c.progress}</button></div>
    {error && <p className="error small" role="alert">{error}</p>}
    {data && (data.columns.length ? <>
      <p className="muted small" style={{ margin: 0 }}>{c.progressLead}</p>
      {data.truncated && <p className="notice small" role="status">{c.progressTruncated}</p>}
      <div className="heat-scroll" tabIndex={0} aria-label={c.progress}>
        <table className="heatmap progress-table">
          <thead><tr><th scope="col">{c.progressStudent}</th>{data.columns.map((test, i) => <th scope="col" key={test.id} title={test.title}>{i + 1}</th>)}<th scope="col">{c.progressAverage}</th><th scope="col">{c.progressTrend}</th></tr></thead>
          <tbody>{data.rows.map(row => <tr key={row.email}>
            <th scope="row">{row.email}</th>
            {row.cells.map((cell, i) => <td key={i} className={cell === null ? "heat-none" : cell === "pending" ? "heat-pending" : `heat-${tone(cell)}`} title={`${data.columns[i].title}: ${cell === null ? c.progressMissed : cell === "pending" ? c.progressPending : `${cell}%`}`}>{typeof cell === "number" ? Math.round(cell) : cell === "pending" ? "…" : <span className="sr-only">{c.progressMissed}</span>}</td>)}
            <td className="heat-total">{row.average === null ? "—" : `${row.average}%`}</td>
            <td className={row.trend === null ? "heat-total" : row.trend > 0 ? "heat-total trend-up" : row.trend < 0 ? "heat-total trend-down" : "heat-total"}>{row.trend === null ? "—" : row.trend > 0 ? `▲ ${row.trend}` : row.trend < 0 ? `▼ ${-row.trend}` : "＝"}</td>
          </tr>)}</tbody>
        </table>
      </div>
      <ol className="progress-tests small muted">{data.columns.map(test => <li key={test.id}>{test.title}</li>)}</ol>
    </> : <p className="muted small">{c.progressNone}</p>)}
  </div>;
}
