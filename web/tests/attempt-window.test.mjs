import test from "node:test";
import assert from "node:assert/strict";
import { attemptWindowExpired, canStartAttempt } from "../lib/attempt-window.ts";

test("timer is active until its exact deadline and expires at the boundary", () => {
  const started = "2026-10-08T10:00:00.000Z";
  assert.equal(attemptWindowExpired(started, 10, null, Date.parse("2026-10-08T10:09:59Z")), false);
  assert.equal(attemptWindowExpired(started, 10, null, Date.parse("2026-10-08T10:10:00Z")), true);
});

test("deadline blocks new starts but permits existing drafts to be submitted as expired", () => {
  const deadline = "2026-10-08T12:00:00.000Z";
  assert.equal(canStartAttempt(deadline, Date.parse("2026-10-08T11:59:59Z")), true);
  assert.equal(canStartAttempt(deadline, Date.parse("2026-10-08T12:00:00Z")), false);
  assert.equal(attemptWindowExpired("2026-10-08T11:00:00Z", 0, deadline, Date.parse("2026-10-08T12:00:00Z")), true);
});

test("invalid legacy timestamps fail closed", () => {
  assert.equal(canStartAttempt("not-a-date", 1000), false);
  assert.equal(attemptWindowExpired("not-a-date", 5, null, 1000), true);
});
