import { expect, test } from "@playwright/test";

test("the brand is Mugalim AI and Russian is the default", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/^Mugalim AI \|/);
  await expect(page.locator("html")).toHaveAttribute("lang", "ru");
  await expect(page.getByRole("link", { name: /Mugalim AI/ }).first()).toBeVisible();
  await expect(page.getByText("AI Teacher")).toHaveCount(0);
});

test("switching to Kazakh translates the page and survives a reload", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Язык интерфейса").selectOption("kk");
  await expect(page.locator("html")).toHaveAttribute("lang", "kk");
  await expect(page.getByRole("link", { name: "Кіру" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("оқушыларға");
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("оқушыларға");
  await expect(page).toHaveTitle(/Артық жұмыссыз бағалау/);
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Қош келдіңіз" })).toBeVisible();
  await expect(page.getByLabel("Құпиясөз")).toHaveAttribute("type", "password");
});

test("English is available on request and a Kazakh browser starts in Kazakh", async ({ browser }) => {
  const english = await browser.newPage();
  await english.goto("/login");
  await english.getByLabel("Язык интерфейса").selectOption("en");
  await expect(english.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  await english.close();

  const context = await browser.newContext({ locale: "kk-KZ" });
  const kazakh = await context.newPage();
  await kazakh.goto("/");
  await expect(kazakh.locator("html")).toHaveAttribute("lang", "kk");
  await context.close();
});
