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
    { id: "m1", email: "aigerim@school.kz", student_id: "s1", created_at: "2026-09-01T00:00:00Z" },
  ] }] } }));
  await page.route("**/api/classes/c1/progress", route => route.fulfill({ json: {
    columns: [{ id: "t1", title: "Дроби" }, { id: "t2", title: "Проценты" }],
    rows: [{ email: "aigerim@school.kz", cells: [45, 80], average: 63, trend: 35 }],
  } }));
  await page.goto("/classes");
  await page.getByRole("button", { name: "Успеваемость" }).click();
  const table = page.locator(".progress-table");
  await expect(table.getByRole("rowheader", { name: "aigerim@school.kz" })).toBeVisible();
  await expect(table.locator("td.heat-wrong")).toHaveText("45");
  await expect(table.getByText("▲ 35")).toBeVisible();
  await expect(page.locator(".progress-tests li")).toHaveText(["Дроби", "Проценты"]);
});
