import test from "node:test";
import assert from "node:assert/strict";
import { checkDictation, compareTexts, countErrors, DEFAULT_NORMS, gradeFor, isValidMarks, isValidNorms, schoolGrade, GRADE_SCORE } from "../lib/dictation.ts";

const errorsOf = (reference, answer, mode = "dictation") => compareTexts(reference, answer, mode).errors.map(({ kind, expected, given, repeat }) => ({ kind, expected, given, repeat }));
const norms = DEFAULT_NORMS.dictation;

test("an exact copy has no mistakes and gets a 5", () => {
  const text = "Наступила осень. Листья, жёлтые и красные, падают на землю!";
  const check = checkDictation(text, text, "dictation", norms);
  assert.deepEqual(check.errors, []);
  assert.equal(check.grade, 5);
  assert.equal(check.score, 1);
});

test("spaces, quotes, dashes, ё and three dots are not mistakes", () => {
  assert.deepEqual(errorsOf("Он сказал: «Всё — хорошо...»", "Он  сказал:\n\"Все – хорошо…\""), []);
  assert.deepEqual(errorsOf("Кое-как дошли.", "Кое-как дошли ."), []);
});

test("a misspelt word is one spelling mistake", () => {
  assert.deepEqual(errorsOf("Собака бежит по дороге.", "Сабака бежит по дароге."), [
    { kind: "spelling", expected: "Собака", given: "Сабака", repeat: false },
    { kind: "spelling", expected: "дороге", given: "дароге", repeat: false },
  ]);
});

test("a small letter at the start of a sentence is a spelling mistake", () => {
  assert.deepEqual(errorsOf("Пришла зима. Выпал снег.", "Пришла зима. выпал снег."), [
    { kind: "spelling", expected: "Выпал", given: "выпал", repeat: false },
  ]);
});

test("missing, extra and wrong commas are punctuation mistakes", () => {
  assert.deepEqual(errorsOf("Я знаю, что он придёт.", "Я знаю что он придёт."), [{ kind: "punctuation", expected: ",", given: "", repeat: false }]);
  assert.deepEqual(errorsOf("Он шёл и пел.", "Он шёл, и пел."), [{ kind: "punctuation", expected: "", given: ",", repeat: false }]);
  assert.deepEqual(errorsOf("Он пришёл.", "Он пришёл!"), [{ kind: "punctuation", expected: ".", given: "!", repeat: false }]);
});

test("missing and extra words are spelling mistakes", () => {
  assert.deepEqual(errorsOf("Мы пошли в лес.", "Мы пошли лес."), [{ kind: "spelling", expected: "в", given: "", repeat: false }]);
  assert.deepEqual(errorsOf("Мы пошли в лес.", "Мы пошли в тёмный лес."), [{ kind: "spelling", expected: "", given: "тёмный", repeat: false }]);
});

test("every word of a skipped sentence counts", () => {
  const check = checkDictation("Птицы улетели на юг. Только воробьи остались.", "Только воробьи остались.", "dictation", norms);
  assert.deepEqual([check.spelling, check.punctuation], [4, 1]);
  assert.equal(check.grade, 3);
});

test("words written together, apart or without a hyphen are one mistake", () => {
  assert.deepEqual(errorsOf("Я не знаю.", "Я незнаю."), [{ kind: "spelling", expected: "не знаю", given: "незнаю", repeat: false }]);
  assert.deepEqual(errorsOf("По-моему, хорошо.", "По моему, хорошо."), [{ kind: "spelling", expected: "По-моему", given: "По моему", repeat: false }]);
});

test("the same word misspelt again is a repeat and not counted", () => {
  const check = checkDictation("Корова и ещё корова.", "Карова и ещё карова.", "dictation", norms);
  assert.deepEqual(check.errors.map(error => error.repeat), [false, true]);
  assert.equal(check.spelling, 1);
  assert.equal(check.grade, 4);
});

test("Kazakh and English texts are checked the same way", () => {
  assert.deepEqual(errorsOf("Күз келді. Жапырақтар сарғайды.", "Куз келді. Жапырақтар сарғайды"), [
    { kind: "spelling", expected: "Күз", given: "Куз", repeat: false },
    { kind: "punctuation", expected: ".", given: "", repeat: false },
  ]);
  assert.deepEqual(errorsOf("I don't know, but it's fine.", "I dont know but it's fine."), [
    { kind: "spelling", expected: "don't", given: "dont", repeat: false },
    { kind: "punctuation", expected: ",", given: "", repeat: false },
  ]);
});

test("a word dictation ignores punctuation and letter case", () => {
  assert.deepEqual(errorsOf("берёза\nворона\nкарандаш", "Береза, варона\nкарандаш.", "words"), [
    { kind: "spelling", expected: "ворона", given: "варона", repeat: false },
  ]);
});

test("teacher marks: ignored mistakes do not count, two minor ones make one", () => {
  const reference = "Я знаю, что он придёт, и мы пойдём.";
  const answer = "Я знаю что он придёт и мы пойдём.";
  const { errors } = compareTexts(reference, answer, "dictation");
  assert.equal(errors.length, 2);
  assert.deepEqual(countErrors(errors, {}), { spelling: 0, punctuation: 2 });
  assert.deepEqual(countErrors(errors, { 0: "ignored" }), { spelling: 0, punctuation: 1 });
  assert.deepEqual(countErrors(errors, { 0: "minor" }), { spelling: 0, punctuation: 1 });
  assert.deepEqual(countErrors(errors, { 0: "minor", 1: "minor" }), { spelling: 0, punctuation: 1 });
  assert.equal(checkDictation(reference, answer, "dictation", norms, { 0: "minor" }).grade, 4);
  assert.equal(checkDictation(reference, answer, "dictation", norms, { 0: "ignored", 1: "ignored" }).grade, 5);
  // A teacher can still count a repeat.
  const repeat = compareTexts("Корова и корова.", "Карова и карова.", "dictation").errors;
  assert.deepEqual(countErrors(repeat, { 1: "counted" }), { spelling: 2, punctuation: 0 });
});

test("school norms for a dictation", () => {
  assert.equal(gradeFor(norms, 0, 0), 5);
  assert.equal(gradeFor(norms, 0, 1), 4);
  assert.equal(gradeFor(norms, 2, 2), 4);
  assert.equal(gradeFor(norms, 1, 3), 4);
  assert.equal(gradeFor(norms, 0, 4), 4);
  assert.equal(gradeFor(norms, 3, 1), 3, "three spelling mistakes are too many for a 4");
  assert.equal(gradeFor(norms, 4, 4), 3);
  assert.equal(gradeFor(norms, 3, 5), 3);
  assert.equal(gradeFor(norms, 0, 7), 3);
  assert.equal(gradeFor(norms, 5, 0), 2);
  assert.equal(gradeFor(norms, 0, 8), 2);
  assert.equal(gradeFor(DEFAULT_NORMS.copy, 1, 0), 4);
  assert.equal(gradeFor(DEFAULT_NORMS.copy, 3, 0), 2);
});

test("a blank answer is a 2 with no score", () => {
  for (const answer of ["", "   ", undefined, 42, ". , !"]) {
    const check = checkDictation("Текст.", answer, "dictation", norms);
    assert.equal(check.grade, 2);
    assert.equal(check.score, 0);
    assert.equal(check.empty, true);
  }
});

test("a grade's score converts back to the same grade", () => {
  for (const grade of [2, 3, 4, 5]) assert.equal(schoolGrade(GRADE_SCORE[grade] * 100), grade);
  assert.equal(schoolGrade(84.99), 4);
  assert.equal(schoolGrade(0), 2);
});

test("a very long answer is compared quickly", () => {
  const reference = "Осенью в лесу тихо, листья падают на землю. ".repeat(60);
  const started = Date.now();
  const check = checkDictation(reference, "бла ".repeat(3000), "dictation", norms);
  assert.equal(check.grade, 2);
  assert.ok(Date.now() - started < 3000);
});

test("norms and marks are validated", () => {
  assert.equal(isValidNorms(norms), true);
  assert.equal(isValidNorms({ ...norms, five: { spelling: 3, punctuation: 0, total: 0 } }), false, "a 5 cannot allow more than a 4");
  assert.equal(isValidNorms({ ...norms, three: { spelling: 1.5, punctuation: 7, total: 8 } }), false);
  assert.equal(isValidNorms(null), false);
  assert.equal(isValidMarks({ 0: "minor", 2: "ignored" }, 3), true);
  assert.equal(isValidMarks({ 3: "minor" }, 3), false);
  assert.equal(isValidMarks({ 0: "half" }, 3), false);
  assert.equal(isValidMarks({ __proto__: "x" }, 3), true, "an inherited key is not an own mark");
  assert.equal(isValidMarks([], 3), false);
});
