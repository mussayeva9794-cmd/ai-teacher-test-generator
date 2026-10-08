import { expect, test } from "@playwright/test";

test("landing page renders and links to sign-in", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: "Войти" })).toHaveAttribute("href", "/login");
});

test("login page renders without requiring external credentials", async ({ page }) => {
  await page.goto("/login");

  await expect(page.getByRole("heading", { name: "С возвращением" })).toBeVisible();
  await expect(page.getByLabel("Электронная почта")).toHaveAttribute("type", "email");
  await expect(page.getByLabel("Пароль")).toHaveAttribute("type", "password");
});

test("teacher API rejects unauthenticated requests", async ({ request }) => {
  const response = await request.get("/api/tests");

  expect(response.status()).toBe(401);
  await expect(response.json()).resolves.toMatchObject({ error: "Teacher sign-in required." });
});
