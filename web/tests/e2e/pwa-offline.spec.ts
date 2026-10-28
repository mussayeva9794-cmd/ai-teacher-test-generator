import { expect, test, type Page } from "@playwright/test";

// The installable app (manifest, icons, offline page), answers kept through a
// dropped connection, the iPhone install hint and the student dark theme.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";

test("the app has a manifest, icons and a service worker that never caches tests", async ({ request }) => {
  const manifest = await (await request.get("/manifest.webmanifest")).json();
  expect(manifest).toMatchObject({ name: "Mugalim AI", display: "standalone", start_url: "/" });
  for (const icon of manifest.icons) expect((await request.get(icon.src)).status(), icon.src).toBe(200);
  expect(manifest.icons.some((icon: { purpose: string }) => icon.purpose === "maskable")).toBe(true);
  const sw = await request.get("/sw.js");
  expect(sw.headers()["cache-control"]).toContain("no-store");
  const code = await sw.text();
  expect(code).toContain('event.request.mode !== "navigate"');
  expect(code).not.toMatch(/cache\.put|api\//);
  expect((await request.get("/apple-icon.png")).status()).toBe(200);
});

test("without internet a page load shows the offline page in the chosen language", async ({ page, context }) => {
  await context.addCookies([{ name: "mugalim_lang", value: "kk", url: "http://127.0.0.1:4173" }]);
  await page.goto("/privacy");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await context.setOffline(true);
  await page.goto("/login").catch(() => undefined);
  await expect(page.getByRole("heading", { name: "Интернет байланысы жоқ" })).toBeVisible();
  await context.setOffline(false);
});

test("an iPhone gets the Share → Add to Home Screen hint, which can be hidden", async ({ browser }) => {
  const context = await browser.newContext({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1", viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto("/");
  const hint = page.getByRole("complementary", { name: "Mugalim AI на телефоне" });
  await expect(hint.getByText(/«Поделиться»/)).toBeVisible();
  await hint.getByRole("button", { name: "Скрыть" }).click();
  await page.reload();
  await expect(page.getByText(/«Поделиться»/)).toHaveCount(0);
  await context.close();
});

const TOKEN = "offline-token";
const student = { id: "student-1", aud: "authenticated", role: "authenticated", email: "s@example.com", app_metadata: { provider: "google" }, user_metadata: { display_name: "Ученик" }, created_at: "2026-10-01T00:00:00Z" };

async function openTest(page: Page, network: { up: boolean; drafts: unknown[] }) {
  await page.addInitScript(([key, value]) => window.localStorage.setItem(key, value), [
    `sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token`,
    JSON.stringify({ access_token: "a", refresh_token: "r", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: student }),
  ]);
  await page.route(`${supabaseUrl}/**`, route => route.fulfill({ json: student }));
  await page.route(url => url.pathname === `/api/share/${TOKEN}`, route => route.fulfill({ json: {
    submitted: false, title: "Дроби", topic: "Повторение", variant_name: "Variant A",
    variant: { instructions: "", questions: [{ id: "q1", type: "short_answer", question: "Сколько будет 1/2 + 1/4?", skill_tag: "" }] },
    settings: { one_question_at_a_time: false, reveal_score: false },
    answers: {}, closes_at: null, saved_at: new Date(Date.now() - 3600_000).toISOString(), expired: false, server_now: new Date().toISOString(),
  } }));
  await page.route(`**/api/share/${TOKEN}/draft`, async route => {
    if (!network.up) return route.abort("internetdisconnected");
    network.drafts.push(route.request().postDataJSON());
    await route.fulfill({ json: { saved_at: new Date().toISOString() } });
  });
  await page.goto(`/s/${TOKEN}`);
  await expect(page.getByText("Сколько будет 1/2 + 1/4?")).toBeVisible();
}

test.describe("with the placeholder e2e build", () => {
  test.skip(!supabaseUrl.includes("e2e-test"), "requires a build with the placeholder e2e Supabase URL");

  test("answers typed offline survive a reload and are sent when the connection returns", async ({ page }) => {
    const network = { up: false, drafts: [] as unknown[] };
    await openTest(page, network);
    await page.getByLabel("Ваш ответ").fill("3/4");
    await expect(page.getByText(/Ответы хранятся на этом устройстве/)).toBeVisible();
    expect(network.drafts).toHaveLength(0);

    await page.reload();
    await expect(page.getByLabel("Ваш ответ")).toHaveValue("3/4");
    network.up = true;
    await expect.poll(() => JSON.stringify(network.drafts.at(-1)), { timeout: 15000 }).toBe(JSON.stringify({ answers: { q1: "3/4" } }));
    await expect(page.getByText(/Ответы хранятся на этом устройстве/)).toHaveCount(0);
  });

  test("signing out for the next student removes answers kept on the device", async ({ page }) => {
    const network = { up: false, drafts: [] as unknown[] };
    await openTest(page, network);
    await page.getByLabel("Ваш ответ").fill("секрет");
    await expect.poll(() => page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith("mugalim_answers:")).length)).toBe(1);
    await page.route(`${supabaseUrl}/auth/v1/logout**`, route => route.fulfill({ status: 204, body: "" }));
    await page.getByRole("button", { name: "Выйти / сменить аккаунт" }).click();
    await expect.poll(() => page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith("mugalim_answers:")).length)).toBe(0);
  });

  test("students get a dark theme when the device uses one; teachers keep the light one", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await openTest(page, { up: true, drafts: [] });
    const panel = await page.locator(".student-card").first().evaluate(el => getComputedStyle(el).backgroundColor);
    expect(panel).toBe("rgb(33, 26, 28)");
    await page.goto("/privacy");
    const surface = await page.locator(".panel").first().evaluate(el => getComputedStyle(el).backgroundColor);
    expect(surface).not.toBe("rgb(33, 26, 28)");
  });
});
