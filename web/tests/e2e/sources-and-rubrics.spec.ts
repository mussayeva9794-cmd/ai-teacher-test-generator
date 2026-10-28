import { expect, test, type Page } from "@playwright/test";

// Lesson material from a PDF and from photos, the SOR/SOCh format and its
// table, against mocked APIs (placeholder e2e build).
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
test.skip(!supabaseUrl.includes("e2e-test"), "requires a build with the placeholder e2e Supabase URL");

const teacher = { id: "teacher-1", aud: "authenticated", role: "authenticated", email: "t@example.com", app_metadata: {}, user_metadata: { display_name: "Учитель" }, created_at: "2026-10-01T00:00:00Z" };

async function signIn(page: Page) {
  await page.addInitScript(([key, value]) => window.localStorage.setItem(key, value), [
    `sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token`,
    JSON.stringify({ access_token: "a", refresh_token: "r", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: teacher }),
  ]);
  await page.route(`${supabaseUrl}/**`, route => route.fulfill({ json: teacher }));
}

test("a PDF is read in the browser and sent with the SOR format and thinking levels", async ({ page, browser }) => {
  // Make a real two-page PDF with text to upload.
  const maker = await browser.newPage();
  await maker.setContent(`<h1>Фотосинтез</h1><p>Растения поглощают углекислый газ и выделяют кислород.</p><p style="break-before:page">Хлорофилл находится в хлоропластах.</p>`);
  const pdf = await maker.pdf({ format: "A5" });
  await maker.close();

  await signIn(page);
  let sent: Record<string, unknown> | null = null;
  await page.route("**/api/generate", async route => { sent = route.request().postDataJSON(); await route.fulfill({ status: 503, json: { error: "Groq is temporarily unavailable. Retry shortly." } }); });
  await page.goto("/create");
  await page.getByLabel("Тема теста").fill("Фотосинтез");
  await page.getByLabel("Формат работы").selectOption("sor");
  await expect(page.getByText(/ИИ также составит таблицу/)).toBeVisible();
  await page.getByText("Дополнительные настройки").click();
  await page.getByLabel("Уровни мышления").selectOption("application");

  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Загрузить PDF" }).click();
  await (await chooser).setFiles({ name: "biology.pdf", mimeType: "application/pdf", buffer: pdf });
  await expect(page.getByText("Текст из PDF добавлен (страниц: 2). Проверьте его ниже.")).toBeVisible();
  const material = page.locator(".source-material textarea");
  await expect(material).toHaveValue(/углекислый газ[\s\S]*Хлорофилл/);
  await expect(page.getByLabel("Название источника")).toHaveValue("biology");

  await page.getByRole("button", { name: /Сгенерировать/ }).click();
  await expect.poll(() => sent).not.toBeNull();
  expect(sent).toMatchObject({ format: "sor", bloomMix: "application", sourceTitle: "biology" });
  expect(String(sent!.sourceText)).toContain("Хлорофилл");
});

test("photos are shrunk, read by AI and appended to the material", async ({ page }) => {
  await signIn(page);
  const uploads: { images: string[] }[] = [];
  let finishReading: () => void = () => undefined;
  await page.route("**/api/sources/ocr", async route => {
    uploads.push(route.request().postDataJSON());
    await new Promise<void>(resolve => { finishReading = resolve; });
    await route.fulfill({ json: { text: "§ 14. Закон Ома: I = U / R." } });
  });
  await page.goto("/create");
  // A large PNG made in the page, so the browser has to shrink it.
  const png = Buffer.from(await page.evaluate(async () => {
    const canvas = Object.assign(document.createElement("canvas"), { width: 3000, height: 2000 });
    canvas.getContext("2d")!.fillRect(0, 0, 10, 10);
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(b => resolve(b!), "image/png"));
    return [...new Uint8Array(await blob.arrayBuffer())];
  }));
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Фото страниц" }).click();
  await (await chooser).setFiles([{ name: "page.png", mimeType: "image/png", buffer: png }]);
  // Generation waits until the photos are read, or it would ignore them.
  await page.getByLabel("Тема теста").fill("Закон Ома");
  await expect(page.getByRole("button", { name: /Сгенерировать/ })).toBeDisabled();
  await expect.poll(() => uploads.length).toBe(1);
  finishReading();
  await expect(page.getByText("Текст с фото добавлен. Проверьте, что ИИ прочитал его верно.")).toBeVisible();
  await expect(page.locator(".source-material textarea")).toHaveValue("§ 14. Закон Ома: I = U / R.");
  expect(uploads).toHaveLength(1);
  expect(uploads[0].images[0]).toMatch(/^data:image\/jpeg;base64,/);
  const size = await page.evaluate(src => new Promise<number[]>(resolve => { const img = new Image(); img.onload = () => resolve([img.width, img.height]); img.src = src; }), uploads[0].images[0]);
  expect(size).toEqual([1600, 1067]);
});

const TEST_ID = "44444444-4444-4444-8444-444444444444";
const sorVariant = (letter: string) => ({
  title: "Электричество", instructions: "",
  questions: [
    { id: `q${letter}1`, type: "multiple_choice", question: "Единица силы тока?", options: ["Ампер", "Вольт"], correct_answer: "Ампер", explanation: "", skill_tag: "", bloom_level: "knowledge" },
    { id: `q${letter}2`, type: "short_answer", question: "Найдите I при U = 6 В, R = 2 Ом", correct_answer: "3 А", explanation: "", skill_tag: "", bloom_level: "application" },
  ],
  assessment: { kind: "sor", rows: [
    { task: 1, criterion: "Знает единицы измерения", descriptor: "Обучающийся называет единицу силы тока", points: 1 },
    { task: 2, criterion: "Применяет закон Ома", descriptor: "Обучающийся вычисляет силу тока", points: 2 },
  ] },
});

test("the SOR table is shown, editable and printed for the teacher", async ({ page }) => {
  await signIn(page);
  const saves: { variants: Record<string, { assessment: { rows: { points: number }[] } }> }[] = [];
  await page.route(`**/api/tests/${TEST_ID}`, async route => {
    if (route.request().method() === "PATCH") { saves.push(route.request().postDataJSON()); return route.fulfill({ json: { test: { id: TEST_ID, status: "draft" } } }); }
    return route.fulfill({ json: { test: {
      id: TEST_ID, owner_id: teacher.id, title: "СОР: Электричество", topic: "Электричество", language: "russian", grade_level: "8", status: "draft", created_at: "2026-10-20T10:00:00Z",
      variants: { "Variant A": sorVariant("A"), "Variant B": sorVariant("B"), "Variant C": sorVariant("C"), "Variant D": sorVariant("D") },
    } } });
  });
  await page.route(`**/api/tests/${TEST_ID}/share`, route => route.fulfill({ json: { links: [] } }));
  await page.route("**/api/classes", route => route.fulfill({ json: { classes: [] } }));
  await page.route(`**/api/tests/${TEST_ID}/attempts**`, route => route.fulfill({ json: { attempts: [], summary: { count: 0, graded_count: 0, pending_review: 0, average: 0 }, page: 0, page_size: 50, total_pages: 0, has_more: false } }));
  await page.goto(`/tests/${TEST_ID}`);
  const table = page.locator(".rubric");
  await expect(table.getByRole("heading", { name: "СОР: критерии оценивания и дескрипторы" })).toBeVisible();
  await expect(table.getByText("Всего баллов: 3")).toBeVisible();
  await expect(table.getByRole("cell", { name: "Применение" })).toBeVisible();
  await table.getByLabel("Балл 2").fill("3");
  await expect(table.getByText("Всего баллов: 4")).toBeVisible();
  await expect(page.locator(".question-editor").nth(1).getByLabel("Уровень мыслительных навыков")).toHaveValue("application");
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect.poll(() => saves.length).toBe(1);
  expect(saves[0].variants["Variant A"].assessment.rows.map(row => row.points)).toEqual([1, 3]);

  // Replacing a question drops its old table row; the teacher can add a fresh one.
  await page.route(`**/api/tests/${TEST_ID}/regenerate`, route => route.fulfill({ json: { question: { id: "medium-rnew", type: "short_answer", question: "Найдите U при I = 2 А, R = 3 Ом", correct_answer: "6 В", explanation: "", skill_tag: "" } } }));
  page.once("dialog", dialog => void dialog.accept());
  await page.locator(".question-editor").nth(1).getByRole("button", { name: "Заменить через ИИ" }).click();
  await expect(table.getByText("Задания изменились после составления таблицы — проверьте номера строк.")).toBeVisible();
  await expect(table.getByText("Обучающийся вычисляет силу тока")).toHaveCount(0);
  await table.getByRole("button", { name: "+ Строка для задания 2" }).click();
  await expect(table.getByText(/Задания изменились/)).toHaveCount(0);

  await page.goto(`/tests/${TEST_ID}/print`);
  const printed = page.locator(".print-rubric");
  await expect(printed.getByText("Обучающийся вычисляет силу тока")).toBeVisible();
  await expect(printed.getByRole("cell", { name: "Знание" })).toBeVisible();
});
