import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const loginSource = await readFile(new URL("../app/login/page.tsx", import.meta.url), "utf8");
const recoverySource = await readFile(new URL("../app/reset-password/page.tsx", import.meta.url), "utf8");

test("forgot-password action is only rendered for sign-in and uses the current origin callback", () => {
  assert.match(loginSource, /mode === "signin" && <div[\s\S]*?Забыли пароль\?/);
  assert.match(loginSource, /resetPasswordForEmail\(email\.trim\(\), \{[\s\S]*?redirectTo: `\$\{window\.location\.origin\}\/reset-password`/);
});

test("reset request uses account-neutral success and does not surface provider error details", () => {
  assert.match(loginSource, /Если аккаунт с таким адресом существует/);
  assert.match(loginSource, /catch \{\s*setError\("Не удалось отправить письмо/);
  assert.doesNotMatch(loginSource, /setError\(resetError\.message\)/);
});

test("password update requires a recognized recovery session and matching passwords", () => {
  assert.match(recoverySource, /event !== "PASSWORD_RECOVERY" \|\| !session/);
  assert.match(recoverySource, /window\.sessionStorage\.getItem\(recoveryMarker\) === "1"/);
  assert.match(recoverySource, /if \(password !== confirmPassword\)/);
  assert.match(recoverySource, /auth\.updateUser\(\{ password \}\)/);
  assert.match(recoverySource, /window\.sessionStorage\.removeItem\(recoveryMarker\)/);
});

test("recovery flow has generic errors, accessible status, and a safe login return", () => {
  assert.match(recoverySource, /Не удалось изменить пароль\. Запросите новую ссылку/);
  assert.match(recoverySource, /role="alert"/);
  assert.match(recoverySource, /role="status"/);
  assert.match(recoverySource, /href="\/login"/);
});
