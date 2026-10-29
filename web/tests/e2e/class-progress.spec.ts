import { expect, test } from "@playwright/test";

// A class's results across tests, against mocked APIs (placeholder e2e build).
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
test.skip(!supabaseUrl.includes("e2e-test"), "requires a build with the placeholder e2e Supabase URL");

const teacher = { id: "teacher-1", aud: "authenticated", role: "authenticated", email: "t@example.com", app_metadata: {}, user_metadata: { display_name: "Учитель" }, created_at: "2026-10-01T00:00:00Z" };

test("a class card opens the students' progress across tests", async ({ page }) => {
  await page.addInitScript(([key, value]) => window.localStorage.setItem(key, value), [
    `sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token`,
    JSON.stringify({ access_token: "a", refresh_token: "r", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: teacher }),
  ]);
  await page.route(`${supabaseUrl}/**`, route => route.fulfill({ json: teacher }));
  await page.route("**/api/classes", route => route.fulfill({ json: { classes: [{ id: "c1", name: "7А", is_active: true, created_at: "2026-09-01T00:00:00Z", web_class_members: [
    { id: "m1", email: "aigerim@school.kz", student_id: "s1", created_at: "2026-09-01T00:00:00Z", name: "Айгерим Серикова" },
    { id: "m2", email: "new@school.kz", student_id: null, created_at: "2026-09-01T00:00:00Z", name: null },
  ] }] } }));
  await page.route("**/api/classes/c1/progress", route => route.fulfill({ json: {
    columns: [{ id: "t1", title: "Дроби" }, { id: "t2", title: "Проценты" }],
    rows: [{ name: "Айгерим Серикова", email: "aigerim@school.kz", cells: [45, 80], average: 63, trend: 35 },
      { name: null, email: "new@school.kz", cells: [null, null], average: null, trend: null }],
  } }));
  await page.goto("/classes");
  // The roster shows a signed-in student's name with the email beneath it.
  await expect(page.getByText("Айгерим Серикова")).toBeVisible();
  await expect(page.getByText("aigerim@school.kz")).toBeVisible();
  await page.getByRole("button", { name: "Успеваемость" }).click();
  const table = page.locator(".progress-table");
  await expect(table.getByRole("rowheader", { name: /Айгерим Серикова\s*aigerim@school\.kz/ })).toBeVisible();
  await expect(table.getByRole("rowheader", { name: "new@school.kz" })).toBeVisible();
  await expect(table.locator("td.heat-wrong")).toHaveText("45");
  await expect(table.getByText("▲ 35")).toBeVisible();
  await expect(page.locator(".progress-tests li")).toHaveText(["Дроби", "Проценты"]);
});

test("a teacher types 'Фамилия Имя, email' and edits a student's name", async ({ page }) => {
  await page.addInitScript(([key, value]) => window.localStorage.setItem(key, value), [
    `sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token`,
    JSON.stringify({ access_token: "a", refresh_token: "r", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: teacher }),
  ]);
  await page.route(`${supabaseUrl}/**`, route => route.fulfill({ json: teacher }));
  const posted: unknown[] = [];
  await page.route("**/api/classes", route => route.request().method() === "POST"
    ? (posted.push(route.request().postDataJSON()), route.fulfill({ status: 201, json: { class: { name: "7Б" }, member_count: 2 } }))
    : route.fulfill({ json: { classes: [{ id: "c1", name: "7А", is_active: true, created_at: "2026-09-01T00:00:00Z", web_class_members: [
      { id: "m1", email: "aigerim@school.kz", full_name: "Серикова Айгерим", student_id: "s1", created_at: "2026-09-01T00:00:00Z", name: "Серикова Айгерим" },
      { id: "m2", email: "zhan@school.kz", full_name: null, student_id: null, created_at: "2026-09-01T00:00:00Z", name: null },
      { id: "m3", email: "asel@school.kz", full_name: "Абенова Асель", student_id: null, created_at: "2026-09-01T00:00:00Z", name: "Абенова Асель" },
    ] }] } }));
  await page.route("**/api/classes/c1/progress", route => route.fulfill({ json: { columns: [], rows: [] } }));
  let patched: unknown = null;
  await page.route("**/api/classes/c1/members/m2", route => { patched = route.request().postDataJSON(); return route.fulfill({ json: { full_name: "Жанов Жан" } }); });
  await page.goto("/classes");

  // The typed name is shown first, with the email beneath it; the roster is sorted by what is shown.
  const roster = page.locator(".list-item b");
  await expect(roster).toHaveText(["zhan@school.kz", "Абенова Асель", "Серикова Айгерим"]);

  // A line it cannot read is shown back and nothing is sent.
  await page.getByLabel(/Название/).fill("7Б");
  const students = page.getByLabel(/Ученики — по одному на строку/);
  await students.fill("Ахметов Нурлан\nКим Виктор, viktor@mail.ru");
  await page.getByRole("button", { name: "Создать класс" }).click();
  await expect(page.locator(".error[role=alert]")).toContainText("Ахметов Нурлан");
  expect(posted).toEqual([]);

  await students.fill("Ахметов Нурлан, nurlan@school.kz\nviktor@mail.ru");
  await page.getByRole("button", { name: "Создать класс" }).click();
  await expect(page.getByRole("status")).toContainText("7Б");
  expect(posted).toEqual([{ name: "7Б", students: [{ email: "nurlan@school.kz", full_name: "Ахметов Нурлан" }, { email: "viktor@mail.ru", full_name: null }] }]);

  page.once("dialog", dialog => dialog.accept("  Жанов   Жан "));
  await page.getByRole("button", { name: "Добавить ФИО" }).click();
  await expect(page.getByRole("status")).toHaveText("ФИО сохранено.");
  expect(patched).toEqual({ full_name: "Жанов Жан" });
});
