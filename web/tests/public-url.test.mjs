import test from "node:test";
import assert from "node:assert/strict";
import { publicTestUrl } from "../lib/public-url.ts";

function withEnvironment(values, callback) {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    callback();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("preview links stay on the same deployment instead of crossing into production", () => {
  withEnvironment({
    PUBLIC_APP_URL: undefined,
    VERCEL_ENV: "preview",
    VERCEL_URL: "ai-teacher-test-generator-git-feature-example.vercel.app",
  }, () => {
    assert.equal(
      publicTestUrl("https://spoofed.example", "abc123"),
      "https://ai-teacher-test-generator-git-feature-example.vercel.app/s/abc123",
    );
  });
});

test("preview ignores a shared public URL so it cannot cross into another environment", () => {
  withEnvironment({
    VERCEL_ENV: "preview",
    VERCEL_URL: "ai-teacher-test-generator-git-feature-example.vercel.app",
    PUBLIC_APP_URL: "https://ai-teacher-test-generator.vercel.app",
  }, () => {
    assert.equal(
      publicTestUrl("https://spoofed.example", "token"),
      "https://ai-teacher-test-generator-git-feature-example.vercel.app/s/token",
    );
    process.env.PUBLIC_APP_URL = "https://staging.example.com/";
    assert.equal(
      publicTestUrl("https://spoofed.example", "token"),
      "https://ai-teacher-test-generator-git-feature-example.vercel.app/s/token",
    );
  });
});

test("local links stay local and configured domains are honored", () => {
  withEnvironment({ PUBLIC_APP_URL: undefined, VERCEL_ENV: undefined, VERCEL_URL: undefined }, () => {
    assert.equal(publicTestUrl("http://localhost:3000", "token"), "http://localhost:3000/s/token");
    process.env.PUBLIC_APP_URL = "https://tests.example.com/";
    assert.equal(publicTestUrl("https://preview.vercel.app", "token"), "https://tests.example.com/s/token");
  });
});

test("production links remain stable even when Vercel exposes a deployment hostname", () => {
  withEnvironment({
    PUBLIC_APP_URL: undefined,
    VERCEL_ENV: "production",
    VERCEL_URL: "ai-teacher-test-generator-random-hash-kuma-b5e0.vercel.app",
  }, () => {
    assert.equal(
      publicTestUrl("https://ai-teacher-test-generator-random-hash-kuma-b5e0.vercel.app", "token"),
      "https://ai-teacher-test-generator.vercel.app/s/token",
    );
  });
});

test("preview links fail closed without a safe staging or deployment origin", () => {
  withEnvironment({
    PUBLIC_APP_URL: "https://ai-teacher-test-generator.vercel.app",
    VERCEL_ENV: "preview",
    VERCEL_URL: undefined,
  }, () => {
    assert.throws(
      () => publicTestUrl("https://preview.example.com", "token"),
      /Preview test links require a non-production app URL/,
    );
  });

  withEnvironment({
    PUBLIC_APP_URL: undefined,
    VERCEL_ENV: "preview",
    VERCEL_URL: "ai-teacher-test-generator.vercel.app",
  }, () => {
    assert.throws(
      () => publicTestUrl("https://preview.example.com", "token"),
      /Preview test links require a non-production app URL/,
    );
  });
});
