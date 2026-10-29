import { expect, test, type Page } from "@playwright/test";

// A teacher who is already signed in is not asked to sign in again (placeholder e2e build).
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
test.skip(!supabaseUrl.includes("e2e-test"), "requires a build with the placeholder e2e Supabase URL");

const teacher = { id: "teacher-1", aud: "authenticated", role: "authenticated", email: "t@example.com", app_metadata: {}, user_metadata: {}, created_at: "2026-10-01T00:00:00Z" };

async function signedInTeacher(page: Page) {
  await page.addInitScript(([key, value]) => window.localStorage.setItem(key, value), [
    `sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token`,
    JSON.stringify({ access_token: "a", refresh_token: "r", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: teacher }),
  ]);
  await page.route(`${supabaseUrl}/**`, route => route.request().url().includes("web_profiles")
    ? route.fulfill({ json: { role: "teacher" } })
    : route.fulfill({ json: teacher }));
  await page.route("**/api/tests**", route => route.fulfill({ json: { tests: [] } }));
}

test("the home page leads a signed-in teacher back to the dashboard", async ({ page }) => {
  await signedInTeacher(page);
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Основная навигация" });
  await expect(nav.getByRole("link", { name: "Мой кабинет" })).toHaveAttribute("href", "/dashboard");
  await expect(nav.getByRole("link", { name: "Войти" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Открыть кабинет/ })).toBeVisible();
});

test("the sign-in page offers the account that is already signed in", async ({ page }) => {
  await signedInTeacher(page);
  await page.goto("/login");
  await expect(page.getByText("Вы уже вошли как t@example.com.")).toBeVisible();
  await page.getByRole("button", { name: "Продолжить" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
});

test("a visitor who is not signed in still sees the sign-in buttons", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "Основная навигация" }).getByRole("link", { name: "Войти" })).toBeVisible();
});
