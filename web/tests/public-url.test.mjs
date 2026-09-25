import test from "node:test";
import assert from "node:assert/strict";
import { publicTestUrl } from "../lib/public-url.ts";

test("preview deployment links point to the public production domain", () => {
  const previous = process.env.PUBLIC_APP_URL;
  delete process.env.PUBLIC_APP_URL;
  try {
    assert.equal(
      publicTestUrl("https://ai-teacher-test-generator-git-feature-example.vercel.app", "abc123"),
      "https://ai-teacher-test-generator.vercel.app/s/abc123",
    );
  } finally {
    if (previous === undefined) delete process.env.PUBLIC_APP_URL;
    else process.env.PUBLIC_APP_URL = previous;
  }
});

test("local links stay local and configured domains are honored", () => {
  const previous = process.env.PUBLIC_APP_URL;
  delete process.env.PUBLIC_APP_URL;
  try {
    assert.equal(publicTestUrl("http://localhost:3000", "token"), "http://localhost:3000/s/token");
    process.env.PUBLIC_APP_URL = "https://tests.example.com/";
    assert.equal(publicTestUrl("https://preview.vercel.app", "token"), "https://tests.example.com/s/token");
  } finally {
    if (previous === undefined) delete process.env.PUBLIC_APP_URL;
    else process.env.PUBLIC_APP_URL = previous;
  }
});
