import { expect, test, type Page } from "@playwright/test";

// Drives the real teacher test page against mocked Supabase Auth and API
// routes (same placeholder build as strict-mode.spec.ts).
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
test.skip(!supabaseUrl.includes("e2e-test"), "requires a build with the placeholder e2e Supabase URL");

const TEST_ID = "11111111-1111-4111-8111-111111111111";
const teacher = {
  id: "teacher-1", aud: "authenticated", role: "authenticated", email: "teacher@example.com",
  app_metadata: {}, user_metadata: { display_name: "Учитель" }, created_at: "2026-10-01T00:00:00Z",
};
const variant = (letter: string) => ({
  title: "Дроби", instructions: "Отвечайте сами.",
  questions: [{ id: `q-${letter}`, type: "multiple_choice", question: `Вопрос ${letter}`, options: ["1/2", "1/3"], correct_answer: "1/2", explanation: "", skill_tag: "дроби" }],
});
const testRow = {
  id: TEST_ID, owner_id: teacher.id, title: "Контрольная по дробям", topic: "Контрольная по дробям", language: "russian",
  grade_level: "", status: "published", created_at: "2026-10-20T10:00:00Z",
  variants: { "Variant A": variant("A"), "Variant B": variant("B"), "Variant C": variant("C"), "Variant D": variant("D") },
};

async function openTeacherTest(page: Page) {
  const saves: unknown[] = [];
  await page.addInitScript(([key, value]) => window.localStorage.setItem(key, value), [
    `sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token`,
    JSON.stringify({ access_token: "a", refresh_token: "r", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: teacher }),
  ]);
  await page.route(`${supabaseUrl}/**`, route => route.fulfill({ json: teacher }));
  await page.route(`**/api/tests/${TEST_ID}`, async route => {
    if (route.request().method() === "PATCH") { saves.push(route.request().postDataJSON()); return route.fulfill({ json: { test: { id: TEST_ID, status: "published" } } }); }
    return route.fulfill({ json: { test: testRow } });
  });
  await page.route(`**/api/tests/${TEST_ID}/share`, route => route.fulfill({ json: { links: [] } }));
  await page.route("**/api/classes", route => route.fulfill({ json: { classes: [] } }));
  await page.route(`**/api/tests/${TEST_ID}/attempts**`, route => route.fulfill({ json: {
    attempts: [{
      id: "att-1", link_id: "l1", student_id: "s1", student_name: "Айгерим Нурланова", variant_name: "Variant A", percentage: 100,
      answers: { "q-A": "1/2" }, submitted_at: "2026-10-24T09:30:00Z",
      result: { per_question: [{ id: "q-A", skill_tag: "дроби", score: 1 }] },
      integrity: { leaves: 2, pastes: 1, copies: 0, auto_submitted: false, away_seconds: 12, question_seconds: { "q-A": 40 } },
    }],
    summary: { count: 1, graded_count: 1, pending_review: 0, average: 100 }, page: 0, page_size: 50, total_pages: 1, has_more: false,
  } }));
  await page.goto(`/tests/${TEST_ID}`);
  await expect(page.getByRole("heading", { name: "Контрольная по дробям" })).toBeVisible();
  return saves;
}

test("labels are in Russian and the topic is not repeated", async ({ page }) => {
  await openTeacherTest(page);
  await expect(page.getByRole("button", { name: "Вариант A" })).toBeVisible();
  await expect(page.getByText("Variant A")).toHaveCount(0);
  await expect(page.getByText("Русский")).toBeVisible();
  await expect(page.getByText("russian")).toHaveCount(0);
  await expect(page.getByText("Контрольная по дробям ·")).toHaveCount(0);
  await page.getByRole("button", { name: "Поделиться" }).click();
  await expect(page.getByText(/Vercel/)).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Меню учителя" }).getByRole("link", { name: "Тесты" })).toHaveAttribute("aria-current", "page");
});

test("unsaved edits are flagged, survive a results refresh, guard leaving and save", async ({ page }) => {
  const saves = await openTeacherTest(page);
  await expect(page.getByText("Все изменения сохранены")).toBeVisible();
  await expect(page.getByRole("button", { name: "Сохранить" })).toBeDisabled();

  await page.getByLabel("Формулировка").fill("Какая дробь больше?");
  await expect(page.getByText("Есть несохранённые изменения")).toBeVisible();

  // Refreshing results reloads the test from the server; the edit must stay.
  await page.getByRole("button", { name: "Результаты" }).click();
  await page.getByRole("button", { name: "Обновить" }).click();
  await page.getByRole("button", { name: "Вопросы" }).click();
  await expect(page.getByLabel("Формулировка")).toHaveValue("Какая дробь больше?");

  let asked = "";
  page.once("dialog", dialog => { asked = dialog.message(); void dialog.dismiss(); });
  await page.getByRole("navigation", { name: "Меню учителя" }).getByRole("link", { name: "Классы" }).click();
  expect(asked).toContain("несохранённые изменения");
  await expect(page).toHaveURL(new RegExp(`/tests/${TEST_ID}$`));

  // The save bar stays reachable after scrolling.
  await page.mouse.wheel(0, 2000);
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByText("Все изменения сохранены")).toBeVisible();
  expect(JSON.stringify(saves[0])).toContain("Какая дробь больше?");
});

test("on a phone each result is one row that opens its details", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openTeacherTest(page);
  await page.getByRole("button", { name: "Результаты" }).click();
  const row = page.locator(".result-row").first();
  await expect(row.locator("summary")).toContainText("Айгерим Нурланова");
  await expect(row.locator("summary")).toContainText("уходов: 2 (12 с)");
  await expect(page.getByText("Ответ: 1/2")).toBeHidden();
  await row.locator("summary").click();
  await expect(page.getByText("Ответ: 1/2")).toBeVisible();
  await expect(page.getByText("40 с на вопрос")).toBeVisible();
  const box = await row.locator("summary").boundingBox();
  expect(box!.width).toBeLessThanOrEqual(390);
});

for (const width of [390, 360, 320]) {
  test(`the teacher menu fits on one line without sideways scrolling at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 700 });
    await openTeacherTest(page);
    const nav = await page.getByRole("navigation", { name: "Меню учителя" }).boundingBox();
    expect(nav!.height).toBeLessThan(48);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}
