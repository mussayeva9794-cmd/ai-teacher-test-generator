import { expect, test, type Page } from "@playwright/test";

// Question editor, paper version and board QR against mocked APIs
// (same placeholder build as teacher-page.spec.ts).
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
test.skip(!supabaseUrl.includes("e2e-test"), "requires a build with the placeholder e2e Supabase URL");

const TEST_ID = "22222222-2222-4222-8222-222222222222";
const teacher = {
  id: "teacher-1", aud: "authenticated", role: "authenticated", email: "teacher@example.com",
  app_metadata: {}, user_metadata: { display_name: "Учитель" }, created_at: "2026-10-01T00:00:00Z",
};
const variant = (letter: string) => ({
  title: "Дроби", instructions: "Отвечайте сами.",
  questions: [
    { id: `easy-${letter}1`, type: "multiple_choice", question: `Сколько будет 1/2 + 1/2? (${letter})`, options: ["1", "2", "1/4"], correct_answer: "1", explanation: "Сумма половин", skill_tag: "дроби" },
    { id: `easy-${letter}2`, type: "matching", question: "Сопоставьте", correct_answer: "", explanation: "", skill_tag: "дроби",
      pairs: [{ left: "1/2", right: "0,5" }, { left: "1/4", right: "0,25" }] },
  ],
});
const testRow = {
  id: TEST_ID, owner_id: teacher.id, title: "Контрольная по дробям", topic: "Дроби", language: "russian",
  grade_level: "5", status: "published", created_at: "2026-10-20T10:00:00Z",
  variants: { "Variant A": variant("A"), "Variant B": variant("B"), "Variant C": variant("C"), "Variant D": variant("D") },
};
const link = {
  id: "link-1", token: "tok-1", url: "https://example.test/s/tok-1", variant_name: "Variant A", class_id: null, is_active: true,
  settings: { strict_mode: false }, created_at: "2026-10-21T10:00:00Z",
};

async function openTeacherTest(page: Page, path = `/tests/${TEST_ID}`) {
  const saves: { variants: Record<string, { questions: { id: string; question: string }[] }> }[] = [];
  const regenerations: unknown[] = [];
  await page.addInitScript(([key, value]) => window.localStorage.setItem(key, value), [
    `sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token`,
    JSON.stringify({ access_token: "a", refresh_token: "r", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: teacher }),
  ]);
  await page.route(`${supabaseUrl}/**`, route => route.fulfill({ json: teacher }));
  await page.route(`**/api/tests/${TEST_ID}`, async route => {
    if (route.request().method() === "PATCH") { saves.push(route.request().postDataJSON()); return route.fulfill({ json: { test: { id: TEST_ID, status: "published" } } }); }
    return route.fulfill({ json: { test: testRow } });
  });
  await page.route(`**/api/tests/${TEST_ID}/regenerate`, async route => {
    regenerations.push(route.request().postDataJSON());
    await route.fulfill({ json: { question: { id: "easy-rnew", type: "multiple_choice", question: "Новый вопрос про дроби", options: ["3/4", "1/4"], correct_answer: "3/4", explanation: "", skill_tag: "дроби" } } });
  });
  await page.route(`**/api/tests/${TEST_ID}/share`, route => route.fulfill({ json: { links: [link] } }));
  await page.route("**/api/classes", route => route.fulfill({ json: { classes: [] } }));
  await page.route(`**/api/tests/${TEST_ID}/attempts**`, route => route.fulfill({ json: {
    attempts: [], summary: { count: 0, graded_count: 0, pending_review: 0, average: 0 }, page: 0, page_size: 50, total_pages: 0, has_more: false,
  } }));
  await page.goto(path);
  await expect(page.getByRole("heading", { name: "Контрольная по дробям", exact: true }).first()).toBeVisible();
  return { saves, regenerations };
}

test("a new blank question is flagged and blocks saving until it is filled in", async ({ page }) => {
  const { saves } = await openTeacherTest(page);
  await page.getByLabel("Тип нового вопроса").selectOption("short_answer");
  await page.getByRole("button", { name: "Добавить вопрос" }).click();
  await expect(page.getByText("Вопрос 3")).toBeVisible();
  await expect(page.getByText("Впишите формулировку вопроса.")).toBeVisible();
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByText(/Исправьте отмеченные вопросы в варианте «Вариант A»/)).toBeVisible();
  expect(saves).toHaveLength(0);

  const card = page.locator(".question-editor").nth(2);
  await card.getByLabel("Формулировка").fill("Как записать половину десятичной дробью?");
  await expect(card.getByText("Впишите правильный ответ.")).toBeVisible();
  await card.getByLabel("Правильный ответ").fill("0,5");
  await expect(card.locator(".error")).toHaveCount(0);
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect.poll(() => saves.length).toBe(1);
  expect(saves[0].variants["Variant A"].questions).toHaveLength(3);
});

test("removing the correct option asks for a new correct answer; questions can be deleted", async ({ page }) => {
  const { saves } = await openTeacherTest(page);
  const first = page.locator(".question-editor").first();
  await first.getByRole("button", { name: "Удалить вариант ответа 1" }).click();
  await expect(first.getByText("Выберите правильный ответ.")).toBeVisible();
  await first.getByLabel("Правильный ответ").selectOption("2");
  await expect(first.locator(".error")).toHaveCount(0);

  page.once("dialog", dialog => void dialog.accept());
  await page.locator(".question-editor").nth(1).getByRole("button", { name: "Удалить", exact: true }).click();
  await expect(page.locator(".question-editor")).toHaveCount(1);
  await expect(page.locator(".question-editor").first().getByRole("button", { name: "Удалить", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect.poll(() => saves.length).toBe(1);
  expect(saves[0].variants["Variant A"].questions.map(question => question.id)).toEqual(["easy-A1"]);
});

test("replace with AI swaps in the new question without saving it", async ({ page }) => {
  const { saves, regenerations } = await openTeacherTest(page);
  page.once("dialog", dialog => void dialog.accept());
  await page.locator(".question-editor").first().getByRole("button", { name: "Заменить через ИИ" }).click();
  await expect(page.getByText("Вопрос заменён. Проверьте его и сохраните тест.")).toBeVisible();
  await expect(page.locator(".question-editor").first().getByLabel("Формулировка")).toHaveValue("Новый вопрос про дроби");
  expect(regenerations).toEqual([{ variant_name: "Variant A", question_id: "easy-A1", question: "Сколько будет 1/2 + 1/2? (A)", type: "multiple_choice", skill_tag: "дроби" }]);
  expect(saves).toHaveLength(0);
  await expect(page.getByText("Есть несохранённые изменения")).toBeVisible();
});

test("the paper version prints the sheet in the test language with an answer key", async ({ page }) => {
  await openTeacherTest(page, `/tests/${TEST_ID}/print`);
  const sheet = page.locator(".print-sheet").first();
  await expect(sheet.getByText("Фамилия, имя")).toBeVisible();
  await expect(sheet.getByText("Сколько будет 1/2 + 1/2? (A)")).toBeVisible();
  await expect(sheet.locator(".print-options li").nth(1)).toHaveText("Б) 2");
  const key = page.locator(".print-key");
  await expect(key.getByText("Ответы — Вариант A")).toBeVisible();
  // Matching choices are lettered in sorted order: А) 0,25  Б) 0,5.
  await expect(key.getByText("1 — Б, 2 — А")).toBeVisible();
  await expect(key.getByText("А) 1")).toBeVisible();

  await page.getByLabel("Вариант B").check();
  await expect(page.locator(".print-sheet:not(.print-key)")).toHaveCount(2);
  await page.emulateMedia({ media: "print" });
  await expect(page.getByRole("button", { name: "Печать / PDF" })).toBeHidden();
  await expect(sheet).toBeVisible();
});

test("an open link can be shown as a large QR code", async ({ page }) => {
  await openTeacherTest(page);
  await page.getByRole("button", { name: "Поделиться" }).click();
  await page.getByRole("button", { name: "QR для доски" }).click();
  const dialog = page.getByRole("dialog", { name: "Отсканируйте камерой телефона" });
  await expect(dialog.locator(".qr-code svg")).toBeVisible();
  await expect(dialog.getByText(link.url)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("saving while a question is being replaced cannot drop the new question", async ({ page }) => {
  const { saves } = await openTeacherTest(page);
  let releaseRegeneration: () => void = () => undefined;
  await page.route(`**/api/tests/${TEST_ID}/regenerate`, async route => {
    await new Promise<void>(resolve => { releaseRegeneration = resolve; });
    await route.fulfill({ json: { question: { id: "easy-rnew", type: "short_answer", question: "Новый вопрос", correct_answer: "0,5", explanation: "", skill_tag: "дроби" } } });
  });
  await page.locator(".question-editor").first().getByLabel("Объяснение").fill("Правка до замены");
  page.once("dialog", dialog => void dialog.accept());
  await page.locator(".question-editor").nth(1).getByRole("button", { name: "Заменить через ИИ" }).click();
  await expect(page.getByRole("button", { name: "Сохранить" })).toBeDisabled();
  // The question being replaced cannot be edited until the new one arrives.
  await expect(page.locator(".question-editor").nth(1).getByLabel("Формулировка")).toBeDisabled();
  await expect(page.locator(".question-editor").first().getByLabel("Объяснение")).toBeEnabled();
  releaseRegeneration();
  await expect(page.locator(".question-editor").nth(1).getByLabel("Формулировка")).toHaveValue("Новый вопрос");
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect.poll(() => saves.length).toBe(1);
  expect(saves[0].variants["Variant A"].questions.map(question => question.id)).toEqual(["easy-A1", "easy-rnew"]);
});

test("a question added while a save is in flight stays unsaved, not lost", async ({ page }) => {
  await openTeacherTest(page);
  let releaseSave: () => void = () => undefined;
  await page.route(`**/api/tests/${TEST_ID}`, async route => {
    if (route.request().method() !== "PATCH") return route.fallback();
    await new Promise<void>(resolve => { releaseSave = resolve; });
    await route.fulfill({ json: { test: { id: TEST_ID, status: "published" } } });
  });
  await page.locator(".question-editor").first().getByLabel("Объяснение").fill("Первая правка");
  await page.getByRole("button", { name: "Сохранить" }).click();
  // While saving, adding is blocked; once the save lands the editor keeps the newer state.
  await expect(page.getByRole("button", { name: "Добавить вопрос" })).toBeDisabled();
  releaseSave();
  await expect(page.getByText("Все изменения сохранены")).toBeVisible();
  await page.getByRole("button", { name: "Добавить вопрос" }).click();
  await expect(page.locator(".question-editor")).toHaveCount(3);
  await expect(page.getByText("Есть несохранённые изменения")).toBeVisible();
});

