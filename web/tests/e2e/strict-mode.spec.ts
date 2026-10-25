import { expect, test, type Page } from "@playwright/test";

// Drives the real student page against mocked Supabase Auth and share APIs.
// The build must point NEXT_PUBLIC_SUPABASE_URL at a placeholder project
// (CI uses https://e2e-test.supabase.co); nothing here reaches a real backend.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
test.skip(!supabaseUrl.includes("e2e-test"), "requires a build with the placeholder e2e Supabase URL");

const TOKEN = "strict-token";
const user = {
  id: "student-1", aud: "authenticated", role: "authenticated", email: "student@example.com",
  app_metadata: { provider: "google" }, user_metadata: { display_name: "Ученик Тестов" }, created_at: "2026-10-01T00:00:00Z",
};
const questions = [
  { id: "q1", type: "multiple_choice", question: "Сколько будет 2 + 2?", options: ["3", "4"], skill_tag: "math" },
  { id: "q2", type: "short_answer", question: "Столица Казахстана?", skill_tag: "geo" },
];

type Settings = { leave_limit: number | null; question_seconds: number };
type Mock = { events: { kind: string; question_id: string | null }[]; submits: unknown[]; drafts: unknown[]; virtualMs: number };
type InitialProgress = { currentIndex?: number; questionStartedAt?: string; finished?: boolean };

async function openStrictTest(page: Page, settings: Settings, initial: InitialProgress = {}, eventDelayMs = 0) {
  const mock: Mock = { events: [], submits: [], drafts: [], virtualMs: 0 };
  const serverNow = () => new Date(Date.now() + mock.virtualMs).toISOString();
  let currentIndex = initial.currentIndex || 0;
  let questionStartedAt = initial.questionStartedAt || serverNow();
  const leaves = () => mock.events.filter(event => event.kind === "leave").length;
  const locked = () => settings.leave_limit !== null && leaves() > settings.leave_limit;

  await page.addInitScript(([key, value]) => window.localStorage.setItem(key, value), [
    `sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token`,
    JSON.stringify({
      access_token: "e2e-access-token", refresh_token: "e2e-refresh-token", token_type: "bearer",
      expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user,
    }),
  ]);
  await page.route(`${supabaseUrl}/**`, route => route.fulfill({ json: user }));
  await page.route(`**/api/share/${TOKEN}`, route => route.fulfill({ json: {
    submitted: false, title: "Контрольная", topic: "Повторение", variant_name: "Variant A",
    variant: { instructions: "Отвечайте сами.", questions: initial.finished ? [] : [questions[currentIndex]] },
    settings: { one_question_at_a_time: true, reveal_score: false, strict_mode: true, ...settings },
    answers: {}, closes_at: null, saved_at: serverNow(), expired: false,
    question_count: questions.length,
    student_label: "Ученик Тестов · student@example.com",
    integrity: { leaves: 0, locked: false },
    strict_progress: { current_index: currentIndex, question_started_at: questionStartedAt, finished: Boolean(initial.finished) },
    server_now: serverNow(),
  } }));
  await page.route(`**/api/share/${TOKEN}/events`, async route => {
    const body = route.request().postDataJSON() as { kind: string; question_id: string | null };
    mock.events.push(body);
    if (eventDelayMs) await new Promise(resolve => setTimeout(resolve, eventDelayMs));
    await route.fulfill({ json: { leaves: leaves(), locked: locked(), server_now: serverNow() } });
  });
  await page.route(`**/api/share/${TOKEN}/draft`, async route => {
    mock.drafts.push(route.request().postDataJSON());
    await route.fulfill({ json: { saved_at: serverNow() } });
  });
  await page.route(`**/api/share/${TOKEN}/submit`, async route => {
    mock.submits.push(route.request().postDataJSON());
    // Like the real server: a per-question timeout does not expire the whole attempt window.
    await route.fulfill({ json: { submitted: true, percentage: null, expired: false, locked: locked() } });
  });
  await page.route(`**/api/share/${TOKEN}/next`, async route => {
    if (currentIndex >= questions.length - 1) {
      await route.fulfill({ json: { finished: true, server_now: serverNow() } });
      return;
    }
    currentIndex += 1;
    questionStartedAt = serverNow();
    await route.fulfill({ json: {
      ready: true, current_index: currentIndex, question_started_at: questionStartedAt,
      server_now: serverNow(), question: questions[currentIndex],
    } });
  });

  await page.goto(`/s/${TOKEN}`);
  await expect(page.getByText("Строгий режим.")).toBeVisible();
  return mock;
}

test("strict mode watermarks the page, blocks the clipboard and auto-submits after too many leaves", async ({ page }) => {
  const mock = await openStrictTest(page, { leave_limit: 1, question_seconds: 0 });

  await expect(page.locator(".strict-watermark").first()).toContainText("student@example.com");
  await expect(page.getByText("Столица Казахстана?")).toHaveCount(0);

  const copyBlocked = await page.getByRole("heading", { name: "Сколько будет 2 + 2?" }).evaluate(element => {
    const event = new ClipboardEvent("copy", { bubbles: true, cancelable: true });
    element.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(copyBlocked).toBe(true);
  await expect.poll(() => mock.events.filter(event => event.kind === "copy").length).toBe(1);

  await page.getByRole("button", { name: "Далее →" }).click();
  const answer = page.getByPlaceholder("Введите ответ");
  await answer.fill("Астана");
  const pasteBlocked = await answer.evaluate(element => {
    const data = new DataTransfer();
    data.setData("text/plain", "ответ из нейросети");
    const event = new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data });
    element.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(pasteBlocked).toBe(true);
  await expect(answer).toHaveValue("Астана");
  await expect.poll(() => mock.events.filter(event => event.kind === "paste").length).toBe(1);

  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect(page.getByRole("heading", { name: "Тест скрыт" })).toBeVisible();
  await expect(page.getByText("Столица Казахстана?")).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByText("Столица Казахстана?")).toBeVisible();
  await expect(page.getByText(/Уходов:\s*1 из 1/)).toBeVisible();
  expect(mock.events.map(event => event.kind)).toEqual(expect.arrayContaining(["leave", "return"]));

  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect(page.getByRole("heading", { name: "Работа отправлена автоматически" })).toBeVisible();
  expect(mock.submits).toEqual([{}]);
});

test("per-question timer advances on its own, hides the back button and submits at the end", async ({ page }) => {
  await page.clock.install();
  const mock = await openStrictTest(page, { leave_limit: null, question_seconds: 15 });
  const advance = async (ms: number) => { mock.virtualMs += ms; await page.clock.fastForward(ms); };

  await expect(page.getByText("Вопрос 1 из 2")).toBeVisible();
  await expect(page.getByText(/На вопрос: 0:1\d/)).toBeVisible();
  await expect(page.getByRole("button", { name: "← Назад" })).toHaveCount(0);
  await expect(page.getByText(/Уходов:/)).toHaveCount(0);

  await advance(16_000);
  await expect(page.getByText("Вопрос 2 из 2")).toBeVisible();

  await advance(16_000);
  await expect(page.getByRole("heading", { name: "Время вышло, работа отправлена" })).toBeVisible();
  expect(mock.submits).toEqual([{}]);
});

test("reloading resumes the server-selected question and never returns an earlier one", async ({ page }) => {
  const mock = await openStrictTest(page, { leave_limit: 2, question_seconds: 30 }, {
    currentIndex: 1, questionStartedAt: new Date().toISOString(),
  });
  await expect(page.getByText("Вопрос 2 из 2")).toBeVisible();
  await expect(page.getByText("Сколько будет 2 + 2?")).toHaveCount(0);
  expect(mock.submits).toEqual([]);
});

test("the leave counter updates at once, before a slow server answers", async ({ page }) => {
  const mock = await openStrictTest(page, { leave_limit: 2, question_seconds: 0 }, {}, 4000);
  await expect(page.getByText(/Уходов:\s*0 из 2/)).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  // The mocked server takes 4 s; the screen must not wait for it.
  await expect(page.getByText(/Уходов:\s*1 из 2/)).toBeVisible({ timeout: 1500 });
  await expect.poll(() => mock.events.filter(event => event.kind === "leave").length).toBe(1);
});

test("the student header fits a 360px phone in Kazakh", async ({ page, context }) => {
  await context.addCookies([{ name: "mugalim_lang", value: "kk", domain: "127.0.0.1", path: "/" }]);
  await page.setViewportSize({ width: 360, height: 740 });
  await page.addInitScript(([key, value]) => window.localStorage.setItem(key, value), [
    `sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token`,
    JSON.stringify({ access_token: "a", refresh_token: "r", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user }),
  ]);
  await page.route(`${supabaseUrl}/**`, route => route.fulfill({ json: user }));
  await page.route(`**/api/share/${TOKEN}`, route => route.fulfill({ json: {
    submitted: false, title: "Контрольная", topic: "Повторение", variant_name: "Variant A",
    variant: { instructions: "", questions }, settings: { one_question_at_a_time: true, reveal_score: false, strict_mode: false },
    answers: {}, closes_at: null, saved_at: new Date().toISOString(), expired: false, server_now: new Date().toISOString(),
  } }));
  await page.goto(`/s/${TOKEN}`);
  await expect(page.getByRole("button", { name: "Шығу / аккаунтты ауыстыру" })).toBeVisible();
  await expect(page.getByText("Сұрақ 1 / 2")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
});
