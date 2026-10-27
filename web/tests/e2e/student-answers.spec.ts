import { expect, test, type Page } from "@playwright/test";

// Matching by choice and the strict full-screen rule, against mocked APIs
// (same placeholder build as strict-mode.spec.ts).
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
test.skip(!supabaseUrl.includes("e2e-test"), "requires a build with the placeholder e2e Supabase URL");

const TOKEN = "answers-token";
const user = {
  id: "student-1", aud: "authenticated", role: "authenticated", email: "student@example.com",
  app_metadata: { provider: "google" }, user_metadata: { display_name: "Ученик Тестов" }, created_at: "2026-10-01T00:00:00Z",
};
const matching = {
  id: "q1", type: "matching", question: "Сопоставьте дроби", skill_tag: "дроби",
  pairs: [{ left: "1/2", right: "" }, { left: "1/4", right: "" }], match_options: ["0,25", "0,5"],
};

async function openTest(page: Page, settings: Record<string, unknown>, questions = [matching]) {
  const mock = { drafts: [] as unknown[], events: [] as string[] };
  await page.addInitScript(([key, value]) => window.localStorage.setItem(key, value), [
    `sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token`,
    JSON.stringify({ access_token: "a", refresh_token: "r", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user }),
  ]);
  await page.route(`${supabaseUrl}/**`, route => route.fulfill({ json: user }));
  const strict = settings.strict_mode === true;
  await page.route(`**/api/share/${TOKEN}`, route => route.fulfill({ json: {
    submitted: false, title: "Дроби", topic: "Повторение", variant_name: "Variant A",
    variant: { instructions: "Отвечайте сами.", questions },
    settings: { one_question_at_a_time: true, reveal_score: false, ...settings },
    answers: {}, closes_at: null, saved_at: new Date().toISOString(), expired: false,
    ...(strict ? {
      question_count: questions.length, student_label: "Ученик Тестов", integrity: { leaves: 0, locked: false },
      strict_progress: { current_index: 0, question_started_at: new Date().toISOString(), finished: false },
    } : {}),
    server_now: new Date().toISOString(),
  } }));
  await page.route(`**/api/share/${TOKEN}/draft`, async route => {
    mock.drafts.push(route.request().postDataJSON());
    await route.fulfill({ json: { saved_at: new Date().toISOString() } });
  });
  await page.route(`**/api/share/${TOKEN}/events`, async route => {
    mock.events.push((route.request().postDataJSON() as { kind: string }).kind);
    const leaves = mock.events.filter(kind => kind === "leave").length;
    await route.fulfill({ json: { leaves, locked: false, server_now: new Date().toISOString() } });
  });
  await page.goto(`/s/${TOKEN}`);
  return mock;
}

test("matching is answered by choosing from the list and saved as left → right", async ({ page }) => {
  const mock = await openTest(page, { strict_mode: false });
  const half = page.locator(".match-row select").first();
  await expect(half).toBeVisible();
  await expect(half.locator("option")).toHaveText(["Выберите…", "0,25", "0,5"]);
  await half.selectOption("0,5");
  await page.locator(".match-row select").nth(1).selectOption("0,25");
  await expect.poll(() => JSON.stringify(mock.drafts.at(-1))).toBe(JSON.stringify({ answers: { q1: { "1/2": "0,5", "1/4": "0,25" } } }));
});

test("a strict test asks for full screen first and counts leaving it", async ({ page }) => {
  const mock = await openTest(page, { strict_mode: true, leave_limit: 2, question_seconds: 0, require_fullscreen: true });
  await expect(page.getByRole("heading", { name: "Тест проходит в полноэкранном режиме" })).toBeVisible();
  await expect(page.getByText("Сопоставьте дроби")).toHaveCount(0);
  await page.getByRole("button", { name: "Открыть тест на весь экран" }).click();
  await expect(page.getByText("Сопоставьте дроби")).toBeVisible();
  expect(mock.events.filter(kind => kind === "leave")).toHaveLength(0);

  await page.evaluate(() => document.exitFullscreen());
  await expect(page.getByRole("heading", { name: "Тест скрыт" })).toBeVisible();
  await expect.poll(() => mock.events.filter(kind => kind === "leave").length).toBe(1);
  await page.getByRole("button", { name: "Вернуться в полноэкранный режим" }).click();
  await expect(page.getByText("Сопоставьте дроби")).toBeVisible();
  await expect.poll(() => mock.events.includes("return")).toBe(true);
});

test("without the full-screen setting a strict test opens directly", async ({ page }) => {
  await openTest(page, { strict_mode: true, leave_limit: 2, question_seconds: 0 });
  await expect(page.getByText("Сопоставьте дроби")).toBeVisible();
  await expect(page.getByRole("button", { name: "Открыть тест на весь экран" })).toHaveCount(0);
});
