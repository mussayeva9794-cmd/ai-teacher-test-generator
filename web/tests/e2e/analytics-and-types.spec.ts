import { expect, test, type Page } from "@playwright/test";

// New question types, the after-submission review, class analytics and AI
// score suggestions, against mocked APIs (placeholder e2e build).
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
test.skip(!supabaseUrl.includes("e2e-test"), "requires a build with the placeholder e2e Supabase URL");

const authKey = () => `sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token`;
const session = (user: object) => JSON.stringify({ access_token: "a", refresh_token: "r", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user });

const student = { id: "student-1", aud: "authenticated", role: "authenticated", email: "s@example.com", app_metadata: { provider: "google" }, user_metadata: { display_name: "Ученик" }, created_at: "2026-10-01T00:00:00Z" };
const TOKEN = "types-token";

async function openStudentTest(page: Page) {
  const mock = { drafts: [] as { answers: Record<string, unknown> }[], submits: 0 };
  await page.addInitScript(([key, value]) => window.localStorage.setItem(key, value), [authKey(), session(student)]);
  await page.route(`${supabaseUrl}/**`, route => route.fulfill({ json: student }));
  await page.route(url => url.pathname === `/api/share/${TOKEN}`, route => route.fulfill({ json: {
    submitted: false, title: "Числа", topic: "Повторение", variant_name: "Variant A",
    variant: { instructions: "", questions: [
      { id: "s1", type: "multiple_select", question: "Какие числа простые?", options: ["2", "3", "4", "9"], skill_tag: "" },
      { id: "o1", type: "ordering", question: "От меньшего к большему", items: ["1/2", "1/4", "1"], skill_tag: "" },
    ] },
    settings: { one_question_at_a_time: false, reveal_score: true },
    answers: {}, closes_at: null, saved_at: new Date().toISOString(), expired: false, server_now: new Date().toISOString(),
  } }));
  await page.route(`**/api/share/${TOKEN}/draft`, async route => {
    mock.drafts.push(route.request().postDataJSON());
    await route.fulfill({ json: { saved_at: new Date().toISOString() } });
  });
  await page.route(`**/api/share/${TOKEN}/submit`, async route => {
    mock.submits += 1;
    await route.fulfill({ json: { submitted: true, percentage: 67, review: [
      { id: "s1", question: "Какие числа простые?", given: "2; 3", correct: "2; 3", explanation: "", score: 1 },
      { id: "o1", question: "От меньшего к большему", given: "1/2 → 1/4 → 1", correct: "1/4 → 1/2 → 1", explanation: "Четверть меньше половины.", score: 0.33 },
    ] } });
  });
  await page.goto(`/s/${TOKEN}`);
  await expect(page.getByText("Какие числа простые?")).toBeVisible();
  return mock;
}

test("students tick several answers and put items in order", async ({ page }) => {
  const mock = await openStudentTest(page);
  await page.getByLabel("2", { exact: true }).check();
  await page.getByLabel("3", { exact: true }).check();
  await page.getByRole("button", { name: "Поднять: 1/4" }).click();
  await expect(page.locator(".order-list li span")).toHaveText(["1/4", "1/2", "1"]);
  await expect.poll(() => JSON.stringify(mock.drafts.at(-1)?.answers)).toBe(JSON.stringify({ s1: ["2", "3"], o1: ["1/4", "1/2", "1"] }));
});

test("after submitting, an allowed review shows the right answers and explanations", async ({ page }) => {
  await openStudentTest(page);
  await page.getByRole("button", { name: "Проверить и завершить" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Да, отправить" }).click();
  const review = page.getByRole("region", { name: "Разбор ответов" });
  await expect(review).toBeVisible();
  await expect(review.locator(".review-right")).toHaveCount(1);
  const partly = review.locator(".review-partly");
  await expect(partly.getByText("Частично верно")).toBeVisible();
  await expect(partly.getByText("1/4 → 1/2 → 1")).toBeVisible();
  await expect(partly.getByText("Четверть меньше половины.")).toBeVisible();
});

const TEST_ID = "33333333-3333-4333-8333-333333333333";
const teacher = { id: "teacher-1", aud: "authenticated", role: "authenticated", email: "t@example.com", app_metadata: {}, user_metadata: { display_name: "Учитель" }, created_at: "2026-10-01T00:00:00Z" };
const questions = [
  { id: "q1", type: "multiple_choice", question: "2 + 2?", options: ["3", "4", "5"], correct_answer: "4", explanation: "", skill_tag: "" },
  { id: "q2", type: "short_answer", question: "Столица Казахстана?", correct_answer: "Астана", explanation: "", skill_tag: "" },
];
const variant = { title: "Повторение", instructions: "", questions };
const attempt = (id: string, name: string, answers: Record<string, unknown>, scores: [string, number, boolean?][], percentage: number | null) => ({
  id, link_id: "l1", student_id: id, student_name: name, student_email: `${id}@school.kz`, variant_name: "Variant A", percentage, answers, submitted_at: "2026-10-26T09:00:00Z",
  result: { requires_manual_review: percentage === null, per_question: scores.map(([qid, score, review]) => ({ id: qid, skill_tag: "", score, requires_manual_review: Boolean(review) })) },
  integrity: null,
});
const attempts = [
  attempt("a1", "Айгерим", { q1: "4", q2: "Астана" }, [["q1", 1], ["q2", 1]], 100),
  attempt("a2", "Болат", { q1: "3", q2: "Алматы" }, [["q1", 0], ["q2", 0]], 0),
  attempt("a3", "Дана", { q1: "3", q2: "город Астана" }, [["q1", 0], ["q2", 0, true]], null),
];

async function openResults(page: Page) {
  const calls = { suggest: 0, reviews: [] as unknown[] };
  await page.addInitScript(([key, value]) => window.localStorage.setItem(key, value), [authKey(), session(teacher)]);
  await page.route(`${supabaseUrl}/**`, route => route.fulfill({ json: teacher }));
  await page.route(`**/api/tests/${TEST_ID}`, route => route.fulfill({ json: { test: {
    id: TEST_ID, owner_id: teacher.id, title: "Повторение", topic: "Повторение", language: "russian", grade_level: "", status: "published", created_at: "2026-10-20T10:00:00Z",
    variants: { "Variant A": variant, "Variant B": variant, "Variant C": variant, "Variant D": variant },
  } } }));
  await page.route(`**/api/tests/${TEST_ID}/share`, route => route.fulfill({ json: { links: [] } }));
  await page.route("**/api/classes", route => route.fulfill({ json: { classes: [] } }));
  await page.route(`**/api/tests/${TEST_ID}/attempts?**`, route => route.fulfill({ json: {
    attempts, summary: { count: 3, graded_count: 2, pending_review: 1, average: 50 }, page: 0, page_size: 50, total_pages: 1, has_more: false,
  } }));
  await page.route(`**/api/tests/${TEST_ID}/attempts/suggest`, async route => {
    calls.suggest += 1;
    await route.fulfill({ json: { suggestions: [{ attempt_id: "a3", percentage: 50, questions: [{ id: "q2", score: 1, comment: "Ответ верный по смыслу." }] }] } });
  });
  await page.route(`**/api/tests/${TEST_ID}/attempts/review`, async route => {
    calls.reviews.push(route.request().postDataJSON());
    await route.fulfill({ json: { reviewed: true, percentage: 50 } });
  });
  await page.goto(`/tests/${TEST_ID}`);
  await page.getByRole("button", { name: "Результаты" }).click();
  return calls;
}

test("class analytics shows the heat map and the hardest question first", async ({ page }) => {
  await openResults(page);
  await page.getByRole("button", { name: "Показать аналитику" }).click();
  const heat = page.locator(".heatmap");
  await expect(heat.getByRole("rowheader", { name: /Айгерим/ })).toBeVisible();
  // The email under each name tells apart students with the same name.
  await expect(heat.locator("tbody tr").first().locator(".student-email")).toHaveText(/@school\.kz$/);
  await expect(heat.locator("tbody tr").first().locator("td.heat-right")).toHaveCount(2);
  await expect(heat.locator("tbody tr").nth(2).locator("td.heat-pending")).toHaveCount(1);
  const first = page.locator(".item-stat").first();
  await expect(first.getByText("Вопрос 1")).toBeVisible();
  await expect(first.getByText("Трудный — стоит повторить тему")).toBeVisible();
  await expect(first.getByText("«3» × 2")).toBeVisible();
});

test("AI suggestions are shown for checking and only saved by the teacher", async ({ page }) => {
  const calls = await openResults(page);
  page.once("dialog", dialog => void dialog.accept());
  await page.getByRole("button", { name: "Предложить оценки ИИ" }).click();
  await expect(page.getByText("ИИ предложил оценки для работ: 1.")).toBeVisible();
  expect(calls.reviews).toHaveLength(0);
  await page.locator("summary", { hasText: "Дана" }).click();
  await expect(page.getByText("Ответ верный по смыслу.")).toBeVisible();
  await page.getByRole("button", { name: "Подставить 50%" }).click();
  await expect(page.getByLabel("Итоговая оценка (%)")).toHaveValue("50");
  await page.getByRole("button", { name: "Сохранить проверку" }).click();
  await expect.poll(() => calls.reviews).toEqual([{ attempt_id: "a3", percentage: 50 }]);
});
