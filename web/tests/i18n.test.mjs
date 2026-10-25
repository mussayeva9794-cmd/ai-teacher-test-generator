import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { registerHooks } from "node:module";

// lib/ uses extensionless relative imports (resolved by Next); add ".ts" here.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if ((specifier.startsWith("./") || specifier.startsWith("../")) && !/\.[cm]?[jt]s$/.test(specifier) && context.parentURL?.includes("/lib/")) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const { dictionaries } = await import("../lib/i18n/dictionaries/index.ts");
const { negotiateLocale, LOCALES } = await import("../lib/i18n/config.ts");
const { serverMessage } = await import("../lib/i18n/server-message.ts");
const { variantLabel } = await import("../lib/labels.ts");
const root = fileURLToPath(new URL("..", import.meta.url));

function shape(value) {
  if (typeof value === "function") return `fn/${value.length}`;
  if (Array.isArray(value)) return value.map(shape);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, shape(value[key])]));
  return typeof value;
}

function strings(value, path = "") {
  if (typeof value === "string") return [[path, value]];
  if (typeof value === "function") return [[path, value(3, 5, 7)]];
  if (Array.isArray(value)) return value.flatMap((item, i) => strings(item, `${path}[${i}]`));
  if (value && typeof value === "object") return Object.entries(value).flatMap(([key, item]) => strings(item, `${path}.${key}`));
  return [];
}

test("Kazakh and English cover exactly the Russian keys", () => {
  for (const locale of ["kk", "en"]) assert.deepEqual(shape(dictionaries[locale]), shape(dictionaries.ru), locale);
});

test("no translation is empty and Kazakh/English are actually translated", () => {
  const ru = new Map(strings(dictionaries.ru));
  for (const locale of LOCALES) {
    for (const [path, text] of strings(dictionaries[locale])) assert.ok(text.trim(), `${locale}${path} is empty`);
  }
  // Words spelled the same in Russian and Kazakh.
  const shared = new Set([".nav.account", ".testPage.eyebrow"]);
  for (const locale of ["kk", "en"]) {
    const same = strings(dictionaries[locale]).filter(([path, text]) =>
      !path.startsWith(".serverErrors") && !shared.has(path) && ru.get(path) === text && /[А-Яа-яЁё]{4,}/.test(text));
    assert.deepEqual(same, [], `${locale} still has Russian text`);
  }
});

test("Kazakh UI text uses Kazakh, English UI text has no Cyrillic", () => {
  const kk = strings(dictionaries.kk).filter(([path]) => !path.startsWith(".serverErrors")).map(([, text]) => text).join(" ");
  assert.match(kk, /[әғқңөұүһі]/i);
  const en = strings(dictionaries.en).filter(([path]) => !path.startsWith(".serverErrors")).map(([, text]) => text);
  assert.deepEqual(en.filter((text) => /[А-Яа-яЁё]/.test(text)), []);
});

test("the brand is Mugalim AI everywhere", () => {
  for (const locale of LOCALES) {
    assert.match(dictionaries[locale].meta.title, /^Mugalim AI \|/);
    assert.doesNotMatch(JSON.stringify(strings(dictionaries[locale])), /AI Teacher/);
  }
});

test("a saved choice wins; Kazakh browsers get Kazakh; everyone else gets Russian", () => {
  assert.equal(negotiateLocale("kk", "en-US,en;q=0.9"), "kk");
  assert.equal(negotiateLocale("en", "ru-RU"), "en");
  assert.equal(negotiateLocale(undefined, "kk-KZ,kk;q=0.9,ru;q=0.8"), "kk");
  assert.equal(negotiateLocale(undefined, "ru-RU,kk;q=0.7"), "ru");
  assert.equal(negotiateLocale(undefined, "en-US,en;q=0.9,kk;q=0.5"), "kk");
  assert.equal(negotiateLocale(undefined, "en-US,en;q=0.9"), "ru");
  assert.equal(negotiateLocale("fr", "de-DE"), "ru");
  assert.equal(negotiateLocale(null, ""), "ru");
  assert.equal(negotiateLocale(undefined, "kk;q=0,ru;q=0.5"), "ru");
});

test("server messages are shown in the interface language", () => {
  const msg = "This account is not enrolled in the selected class.";
  assert.match(serverMessage(dictionaries.ru, msg), /нет в списке класса/);
  assert.match(serverMessage(dictionaries.kk, msg), /сынып тізімінде жоқ/);
  assert.match(serverMessage(dictionaries.en, msg), /not on the class list/);
  assert.equal(serverMessage(dictionaries.kk, "Request failed (502)"), dictionaries.kk.common.offline);
  assert.equal(serverMessage(dictionaries.en, "Failed to fetch"), dictionaries.en.common.offline);
  assert.equal(serverMessage(dictionaries.ru, "Invalid login credentials"), "Неверный email или пароль.");
  assert.equal(serverMessage(dictionaries.en, "For security purposes, you can only request this after 30 seconds."), dictionaries.en.serverRateLimited);
  assert.equal(serverMessage(dictionaries.ru, "Some new English error", "Запасной текст"), "Запасной текст");
  assert.equal(serverMessage(dictionaries.ru, "Уже по-русски."), "Уже по-русски.");
});

test("every error message a server route can return has a translation", () => {
  const files = [];
  const walk = (dir) => { for (const name of readdirSync(dir)) { const path = join(dir, name); statSync(path).isDirectory() ? walk(path) : /\.tsx?$/.test(name) && files.push(path); } };
  walk(join(root, "app/api")); files.push(join(root, "lib/share.ts"), join(root, "lib/passkeys.ts"), join(root, "lib/signup.ts"));
  const source = files.map((file) => readFileSync(file, "utf8")).join("\n");
  const internal = /^(Could not scan drafts|Could not record the event|Invalid (access scope|class selection|class status|event|link status|request body|results page|review data|status|strict answer)|No class changes|Open the test before recording|Preview test links|Question progression|Results summary is not configured|Strict mode is not|Supabase (public|server) configuration|Too many events|The saved draft|authentication|configuration|invalid_response|rate_limit|timeout|upstream)/;
  const messages = new Set([...source.matchAll(/(?:jsonError\(|error: |Error\()"([^"]+)"/g), ...source.matchAll(/^\s+\w+: "([^"]+)",$/gm)]
    .map((match) => match[1]).filter((text) => !internal.test(text) && /[.!?]$/.test(text)));
  assert.ok(messages.size > 60, `found ${messages.size}`);
  for (const locale of LOCALES) {
    const missing = [...messages].filter((text) => !(text in dictionaries[locale].serverErrors));
    assert.deepEqual(missing, [], locale);
  }
});

test("variant names follow the interface language", () => {
  assert.equal(variantLabel("Variant A"), "Вариант A");
  assert.equal(variantLabel("Variant B", dictionaries.kk), "B нұсқасы");
  assert.equal(variantLabel("Variant C", dictionaries.en), "Variant C");
  assert.equal(variantLabel("Custom"), "Custom");
});

test("pages render text only through the dictionaries", () => {
  const pages = [];
  const walk = (dir) => { for (const name of readdirSync(dir)) { const path = join(dir, name); statSync(path).isDirectory() ? name !== "api" && walk(path) : name.endsWith(".tsx") && pages.push(path); } };
  walk(join(root, "app"));
  const offenders = pages.filter((file) => /[А-Яа-яЁё]/.test(readFileSync(file, "utf8").replace(/<option value="(russian|kazakh|english)">[^<]+<\/option>/g, "")));
  assert.deepEqual(offenders.map((file) => file.slice(root.length)), []);
});

test("Kazakh dates are spelled out instead of the browser's incomplete data", async () => {
  const { formatDate } = await import("../lib/i18n/format.ts");
  const when = new Date(2026, 9, 24, 14, 5);
  assert.equal(formatDate("kk", when, "date"), "24.10.2026");
  assert.equal(formatDate("kk", when, "dateTime"), "24.10.2026, 14:05");
  assert.equal(formatDate("kk", when, "dayTime"), "24 қазан, 14:05");
  assert.equal(formatDate("kk", when, "dayTimeLong"), "24 қазан, 14:05");
  assert.match(formatDate("ru", when, "dayTimeLong"), /24 октября/);
  assert.match(formatDate("en", when, "dayTimeLong"), /24 October/);
  assert.equal(formatDate("kk", "not a date"), "");
});
