"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { api } from "@/lib/client";
import type { Question, TestRow, TestVariant } from "@/lib/types";
import { dictionaries, type Dictionary } from "@/lib/i18n/dictionaries";
import { serverMessage } from "@/lib/i18n/server-message";
import { variantLabel } from "@/lib/labels";
import { TeacherHeader } from "../../../teacher-nav";
import { useT } from "../../../i18n-provider";

// The sheet itself is printed in the language of the test, not of the interface.
const SHEET_LOCALE = { russian: "ru", kazakh: "kk", english: "en" } as const;

/** Letter for choice `i`, falling back to a number past the end of the alphabet given. */
const choiceLabel = (letters: string, i: number) => letters[i] ?? String(i + 1);

/** Right-hand matching items in the same sorted order students see. */
const matchChoices = (question: Question) => (question.pairs || []).map(pair => pair.right).sort((a, b) => a.localeCompare(b));

function correctLabel(question: Question, letters: string) {
  if (question.type === "matching") {
    const choices = matchChoices(question);
    return (question.pairs || []).map((pair, i) => `${i + 1} — ${choiceLabel(letters, choices.indexOf(pair.right))}`).join(", ");
  }
  if (question.options) {
    const at = question.options.findIndex(option => option.trim().toLocaleLowerCase() === question.correct_answer.trim().toLocaleLowerCase());
    return at >= 0 ? `${choiceLabel(letters, at)}) ${question.options[at]}` : question.correct_answer;
  }
  return question.correct_answer;
}

function Sheet({ title, name, variant, s }: { title: string; name: string; variant: TestVariant; s: Dictionary }) {
  const pr = s.print;
  return <section className="print-sheet">
    <header className="print-head"><div><div className="eyebrow">{variantLabel(name, s)}</div><h1>{title}</h1></div><div className="print-fields"><span>{pr.name}: <i /></span><span>{pr.className}: <i /></span><span>{pr.date}: <i /></span></div></header>
    {variant.instructions && <p className="print-instructions">{variant.instructions}</p>}
    <ol className="print-questions">{variant.questions.map(question => <li key={question.id}>
      <p className="print-question">{question.question}</p>
      {question.type === "multiple_choice" && <ul className="print-options">{question.options?.map((option, i) => <li key={i}><b>{choiceLabel(pr.letters, i)})</b> {option}</li>)}</ul>}
      {question.type === "true_false" && <><p className="print-hint">{pr.trueFalseHint}</p><p className="print-tf">{question.options?.map((option, i) => <span key={i}>{option}</span>)}</p></>}
      {question.type === "matching" && <><p className="print-hint">{pr.matchHint}</p><div className="print-match"><ol>{question.pairs?.map((pair, i) => <li key={i}><b>{i + 1}.</b> {pair.left} <i /></li>)}</ol><ul>{matchChoices(question).map((choice, i) => <li key={i}><b>{choiceLabel(pr.letters, i)})</b> {choice}</li>)}</ul></div></>}
      {question.type === "short_answer" && <div className="print-lines"><i /><i /></div>}
    </li>)}</ol>
  </section>;
}

export default function PrintPage() {
  const { id } = useParams<{ id: string }>();
  const t = useT();
  const pr = t.print;
  const [test, setTest] = useState<TestRow | null>(null);
  const [error, setError] = useState("");
  const [chosen, setChosen] = useState<string[]>(["Variant A"]);
  const [withKey, setWithKey] = useState(true);

  useEffect(() => {
    api<{ test: TestRow }>(`/api/tests/${id}`)
      .then(result => setTest(result.test))
      .catch(cause => setError(serverMessage(t, cause instanceof Error ? cause.message : "", t.testPage.loadFailed)));
  }, [id]);

  const sheet = test ? dictionaries[SHEET_LOCALE[test.language as keyof typeof SHEET_LOCALE] || "ru"] : t;
  const names = test ? Object.keys(test.variants).filter(name => chosen.includes(name)) : [];
  return <div className="wrap print-page">
    <div className="no-print"><TeacherHeader current="tests" />
      <section className="page-head"><div className="eyebrow">{pr.title}</div><h1>{test?.title || pr.title}</h1><p className="muted">{pr.lead}</p></section>
      {!test ? <div className="panel">{error || t.testPage.loading}</div> : <div className="panel stack" style={{ marginBottom: 24 }}>
        <div className="eyebrow">{pr.variants}</div>
        <div className="row print-choices">{Object.keys(test.variants).map(name => <label className="option" key={name}><input type="checkbox" checked={chosen.includes(name)} onChange={e => setChosen(current => e.target.checked ? [...current, name] : current.filter(item => item !== name))} />{variantLabel(name, t)}</label>)}</div>
        <label className="option"><input type="checkbox" checked={withKey} onChange={e => setWithKey(e.target.checked)} />{pr.answerKey}</label>
        <div className="row"><Link className="btn ghost" href={`/tests/${id}`}>{pr.back}</Link><button className="btn primary" disabled={!names.length} onClick={() => window.print()}>{pr.print}</button></div>
        {!names.length && <p className="muted small">{pr.chooseVariant}</p>}
      </div>}
    </div>
    {test && names.map(name => <Sheet key={name} title={test.title} name={name} variant={test.variants[name]} s={sheet} />)}
    {test && withKey && names.length > 0 && <section className="print-sheet print-key"><h1>{sheet.print.keyTitle}: {test.title}</h1>{names.map(name => <div key={name} className="print-key-block"><h2>{sheet.print.keyFor(variantLabel(name, sheet))}</h2><ol>{test.variants[name].questions.map(question => <li key={question.id}>{correctLabel(question, sheet.print.letters)}</li>)}</ol></div>)}</section>}
  </div>;
}
