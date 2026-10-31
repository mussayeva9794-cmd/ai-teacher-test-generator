import { expect, test, type Page } from "@playwright/test";

// Written works (dictation, essay) for the teacher and the student, against
// mocked APIs (same placeholder build as teacher-tools.spec.ts).
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
test.skip(!supabaseUrl.includes("e2e-test"), "requires a build with the placeholder e2e Supabase URL");

const TEST_ID = "33333333-3333-4333-8333-333333333333";
const teacher = {
  id: "teacher-1", aud: "authenticated", role: "authenticated", email: "teacher@example.com",
  app_metadata: {}, user_metadata: { display_name: "Учитель" }, created_at: "2026-10-01T00:00:00Z",
};
const student = { ...teacher, id: "student-1", email: "student@example.com", app_metadata: { provider: "google" }, user_metadata: { display_name: "Ученик" } };
const norms = { five: { spelling: 0, punctuation: 0, total: 0 }, four: { spelling: 2, punctuation: 4, total: 4 }, three: { spelling: 4, punctuation: 7, total: 8 } };
const reference = "Я знаю, что он придёт. Собака бежит.";
const dictation = { id: "written-dictation", type: "dictation", dictation_mode: "dictation", question: "Напишите текст под диктовку учителя.", correct_answer: reference, grade_norms: norms, explanation: "", skill_tag: "Диктант" };
const essay = { id: "written-essay", type: "essay", question: "Почему важно читать?", correct_answer: "", explanation: "", skill_tag: "Эссе", min_words: 50,
  criteria: [{ name: "Содержание", points: 4 }, { name: "Грамотность", points: 6 }] };

async function signIn(page: Page, user: typeof teacher) {
  await page.addInitScript(([key, value]) => window.localStorage.setItem(key, value), [
    `sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token`,
    JSON.stringify({ access_token: "a", refresh_token: "r", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user }),
  ]);
  await page.route(`${supabaseUrl}/**`, route => route.fulfill({ json: user }));
}

async function openResults(page: Page, questions: unknown[], attempts: unknown[]) {
  const patches: unknown[] = [];
  await signIn(page, teacher);
  const testRow = { id: TEST_ID, owner_id: teacher.id, title: "Диктант «Осень»", topic: "Диктант", language: "russian", grade_level: "5", status: "published", created_at: "2026-10-20T10:00:00Z",
    variants: { "Variant A": { title: "Диктант «Осень»", instructions: "", questions } } };
  await page.route(`**/api/tests/${TEST_ID}`, route => route.fulfill({ json: { test: testRow } }));
  await page.route(`**/api/tests/${TEST_ID}/share`, route => route.fulfill({ json: { links: [] } }));
  await page.route("**/api/classes", route => route.fulfill({ json: { classes: [] } }));
  await page.route(`**/api/tests/${TEST_ID}/attempts/dictation`, async route => {
    patches.push(route.request().postDataJSON());
    await route.fulfill({ json: { percentage: 100 } });
  });
  await page.route(`**/api/tests/${TEST_ID}/attempts?**`, route => route.fulfill({ json: {
    attempts, summary: { count: attempts.length, graded_count: attempts.length, pending_review: 0, average: 75 }, page: 0, page_size: 50, total_pages: 1, has_more: false,
  } }));
  await page.goto(`/tests/${TEST_ID}`);
  await page.getByRole("button", { name: "Результаты" }).click();
  return patches;
}

test("a teacher creates a dictation without AI", async ({ page }) => {
  await signIn(page, teacher);
  const posts: unknown[] = [];
  await page.route("**/api/tests", async route => {
    if (route.request().method() !== "POST") return route.fallback();
    posts.push(route.request().postDataJSON());
    await route.fulfill({ json: { id: TEST_ID } });
  });
  await page.route(`**/api/tests/${TEST_ID}**`, route => route.abort());
  await page.goto("/create");
  await page.getByRole("link", { name: "Диктант или эссе без ИИ →" }).click();
  await expect(page.getByRole("heading", { name: "Диктант, списывание или эссе" })).toBeVisible();
  await page.getByLabel("Словарный диктант").check();
  await page.getByLabel("Название").fill("Словарные слова");
  await page.getByLabel("Слова, каждое с новой строки").fill("берёза\nворона");
  await page.getByRole("button", { name: "Создать работу" }).click();
  await expect(page).toHaveURL(new RegExp(`/tests/${TEST_ID}$`));
  expect(posts).toEqual([{ kind: "words", title: "Словарные слова", language: "russian", gradeLevel: "", text: "берёза\nворона" }]);
});

test("the teacher sees the marked dictation and its grade, and changes how a mistake counts", async ({ page }) => {
  const answer = "Я знаю что он придёт. Сабака бежит.";
  const record = { mode: "dictation", reference, norms, grade: 4, spelling: 1, punctuation: 1 };
  const patches = await openResults(page, [dictation], [{
    id: "attempt-1", student_name: "Иванов Иван", student_email: "ivan@example.com", variant_name: "Variant A", percentage: 75,
    answers: { "written-dictation": answer }, submitted_at: "2026-10-30T09:00:00Z", integrity: null,
    result: { requires_manual_review: false, per_question: [{ id: "written-dictation", skill_tag: "Диктант", score: 0.75, requires_manual_review: false, dictation: record }] },
  }]);
  await expect(page.locator(".result-score")).toHaveText("4 (75%)");
  await page.locator(".result-row summary").click();
  await expect(page.getByText("Оценка: 4")).toBeVisible();
  await expect(page.getByText("Ошибок: орфографических 1, пунктуационных 1")).toBeVisible();
  const comma = page.getByRole("button", { name: /^Пропущено, нужно «,»/ });
  const dog = page.getByRole("button", { name: /^Написано «Сабака», нужно «Собака»/ });
  await expect(dog).toBeVisible();
  await comma.click();
  await expect(comma).toHaveAccessibleName(/Негрубая$/);
  await comma.click();
  await expect(comma).toHaveAccessibleName(/Не считается$/);
  await dog.click(); await dog.click();
  await expect(page.getByText("Оценка: 5")).toBeVisible();
  await page.getByRole("button", { name: "Сохранить оценку" }).click();
  await expect(page.getByText("Оценка сохранена.")).toBeVisible();
  expect(patches).toEqual([{ attempt_id: "attempt-1", question_id: "written-dictation", marks: { 0: "ignored", 1: "ignored" } }]);
});

test("essay points by criterion fill in the final score", async ({ page }) => {
  await openResults(page, [essay], [{
    id: "attempt-2", student_name: "Петрова Анна", student_email: null, variant_name: "Variant A", percentage: null,
    answers: { "written-essay": "Книги учат думать и понимать людей." }, submitted_at: "2026-10-30T09:00:00Z", integrity: null,
    result: { requires_manual_review: true, per_question: [{ id: "written-essay", skill_tag: "Эссе", score: 0, requires_manual_review: true }] },
  }]);
  await page.locator(".result-row summary").click();
  await expect(page.getByText("Книги учат думать и понимать людей.")).toBeVisible();
  await page.getByLabel("Содержание: 4 балла").fill("3");
  await page.getByLabel("Грамотность: 6 баллов").fill("5");
  await expect(page.getByText("8 из 10 — 80%, оценка 4")).toBeVisible();
  await page.getByRole("button", { name: "Перенести в итоговый балл" }).click();
  await expect(page.getByLabel("Итоговая оценка (%)")).toHaveValue("80");
});

async function openStudent(page: Page, questions: unknown[]) {
  const drafts: unknown[] = [];
  await signIn(page, student);
  await page.route(url => url.pathname === "/api/share/written-token", route => route.fulfill({ json: {
    submitted: false, title: "Диктант «Осень»", topic: "Диктант", variant_name: "Variant A",
    variant: { instructions: "", questions }, settings: { one_question_at_a_time: true, reveal_score: false, strict_mode: false },
    answers: {}, closes_at: null, saved_at: new Date().toISOString(), expired: false, server_now: new Date().toISOString(),
  } }));
  await page.route("**/api/share/written-token/draft", async route => { drafts.push(route.request().postDataJSON()); await route.fulfill({ json: { saved_at: new Date().toISOString() } }); });
  await page.goto("/s/written-token");
  return drafts;
}

test("a student types a dictation with autocorrect and pasting turned off", async ({ page }) => {
  const sent = { id: dictation.id, type: "dictation", dictation_mode: "dictation", question: dictation.question, skill_tag: "Диктант" };
  const drafts = await openStudent(page, [sent]);
  const box = page.getByLabel("Ваш текст");
  await expect(box).toBeVisible();
  await expect(box).toHaveAttribute("spellcheck", "false");
  await expect(box).toHaveAttribute("autocorrect", "off");
  await expect(box).toHaveAttribute("autocapitalize", "off");
  await expect(page.getByText(/автоисправление и вставка текста отключены/)).toBeVisible();
  await box.fill("Я знаю что он придёт.");
  await box.evaluate(element => {
    const data = new DataTransfer(); data.setData("text/plain", " Вставка");
    element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await expect(box).toHaveValue("Я знаю что он придёт.");
  await expect.poll(() => JSON.stringify(drafts.at(-1))).toBe(JSON.stringify({ answers: { "written-dictation": "Я знаю что он придёт." } }));
});

test("copying shows the text; an essay counts words", async ({ page }) => {
  const copy = { id: "c1", type: "dictation", dictation_mode: "copy", question: "Перепишите текст без ошибок.", skill_tag: "Списывание", copy_text: "Мама мыла раму." };
  const work = { id: essay.id, type: "essay", question: essay.question, skill_tag: "Эссе", min_words: 50, criteria: essay.criteria };
  await openStudent(page, [copy, work]);
  await expect(page.getByText("Мама мыла раму.")).toBeVisible();
  await page.getByRole("button", { name: "Далее →" }).click();
  await page.getByLabel("Ваш текст").fill("Книги учат думать.");
  await expect(page.getByText("Слов: 3 · нужно не меньше 50")).toBeVisible();
});
