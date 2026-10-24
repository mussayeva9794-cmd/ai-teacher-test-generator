import { expect, test } from "@playwright/test";

// Motion must never leave content hidden: scroll-linked reveals have to finish
// even for cards at the very bottom of the page, and reduced motion shows
// everything at rest from the start.
for (const [name, width, height] of [["phone", 390, 844], ["desktop", 1280, 800]] as const) {
  test(`landing step cards end fully visible at the bottom of the page (${name})`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto("/");
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect.poll(async () => page.locator(".process-card").evaluateAll(cards =>
      cards.map(card => Number(getComputedStyle(card).opacity)))).toEqual([1, 1, 1]);
  });
}

test("reduced motion shows the landing page at rest immediately", async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.goto("/");
  const states = await page.locator(".enter, .process-card, .hero-preview").evaluateAll(elements =>
    elements.map(element => ({ opacity: getComputedStyle(element).opacity, animation: getComputedStyle(element).animationName })));
  for (const state of states) {
    expect(state.opacity).toBe("1");
    expect(state.animation).toBe("none");
  }
  await context.close();
});

test("the student test page does not animate while a test is in progress", async ({ page }) => {
  await page.goto("/");
  const css = await page.evaluate(() => [...document.styleSheets].flatMap(sheet => {
    try { return [...sheet.cssRules].map(rule => rule.cssText); } catch { return []; }
  }).join("\n"));
  for (const selector of [".student-card", ".question-title", ".option", ".strict-card"]) {
    const rules = css.split("\n").filter(rule => rule.startsWith(selector) || rule.includes(`, ${selector}`));
    expect(rules.some(rule => /animation(-name)?:\s*(?!none)/.test(rule)), `${selector} must not animate`).toBe(false);
  }
});
