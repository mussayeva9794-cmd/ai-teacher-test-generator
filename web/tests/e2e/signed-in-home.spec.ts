import { expect, test, type Page } from "@playwright/test";

// A teacher who is already signed in is not asked to sign in again (placeholder e2e build).
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
test.skip(!supabaseUrl.includes("e2e-test"), "requires a build with the placeholder e2e Supabase URL");

const teacher = { id: "teacher-1", aud: "authenticated", role: "authenticated", email: "t@example.com", app_metadata: {}, user_metadata: {}, created_at: "2026-10-01T00:00:00Z" };

async function signedIn(page: Page, role: "teacher" | "student") {
  await page.addInitScript(([key, value]) => window.localStorage.setItem(key, value), [
    `sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token`,
    JSON.stringify({ access_token: "a", refresh_token: "r", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: teacher }),
  ]);
  await page.route(`${supabaseUrl}/**`, route => route.request().url().includes("web_profiles")
    ? route.fulfill({ json: { role } })
    : route.fulfill({ json: teacher }));
  await page.route("**/api/tests**", route => route.fulfill({ json: { tests: [] } }));
}

test("the home page leads a signed-in teacher back to the dashboard", async ({ page }) => {
  await signedIn(page, "teacher");
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Основная навигация" });
  await expect(nav.getByRole("link", { name: "Мой кабинет" })).toHaveAttribute("href", "/dashboard");
  await expect(nav.getByRole("link", { name: "Войти" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Открыть кабинет/ })).toBeVisible();
});

test("the sign-in page offers the account that is already signed in", async ({ page }) => {
  await signedIn(page, "teacher");
  await page.goto("/login");
  await expect(page.getByText("Вы уже вошли как t@example.com.")).toBeVisible();
  await page.getByRole("button", { name: "Продолжить" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
});

test("a visitor who is not signed in still sees the sign-in buttons", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "Основная навигация" }).getByRole("link", { name: "Войти" })).toBeVisible();
});

test("a student who signs out on the home page gets every sign-in button back", async ({ page }) => {
  await signedIn(page, "student");
  await page.goto("/");
  await page.getByRole("button", { name: "Выйти" }).click();
  await expect(page.getByRole("navigation", { name: "Основная навигация" }).getByRole("link", { name: "Войти" })).toBeVisible();
  await expect(page.getByRole("link", { name: "У меня есть аккаунт" })).toBeVisible();
});

test("a student sees the tests they submitted, with the score only where it is shown", async ({ page }) => {
  await signedIn(page, "student");
  await page.route("**/api/my/attempts", route => route.fulfill({ json: { attempts: [
    { id: "a1", title: "Дроби", topic: "Математика", submitted_at: "2026-10-01T10:00:00Z", score: { state: "shown", percentage: 85 }, href: "/s/tok1" },
    { id: "a2", title: "Проценты", topic: null, submitted_at: "2026-10-02T10:00:00Z", score: { state: "hidden" }, href: null },
  ] } }));
  await page.goto("/");
  await page.getByRole("navigation", { name: "Основная навигация" }).getByRole("link", { name: "Мои тесты" }).click();
  await expect(page).toHaveURL(/\/my$/);
  await expect(page.getByRole("link", { name: /85%.*Дроби/s })).toHaveAttribute("href", "/s/tok1");
  await expect(page.getByText("Результат скрыт учителем")).toBeVisible();
});

test("a student with no submitted tests is told where they will appear", async ({ page }) => {
  await signedIn(page, "student");
  await page.route("**/api/my/attempts", route => route.fulfill({ json: { attempts: [] } }));
  await page.goto("/my");
  await expect(page.getByText("Пока нет сданных тестов")).toBeVisible();
});
