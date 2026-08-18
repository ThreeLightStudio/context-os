import assert from "node:assert/strict";
import test from "node:test";
import { describeContextConnection } from "../src/connection-status.ts";

test("describes missing Context Server settings", () => {
  const status = describeContextConnection("", false);
  assert.equal(status.target, "unconfigured");
  assert.match(status.detail, /URL/i);
});

test("recognizes loopback Context Server URLs as local", () => {
  assert.equal(describeContextConnection("http://127.0.0.1:17001", true).target, "local");
  assert.equal(describeContextConnection("http://localhost:17001", true).target, "local");
});

test("describes non-loopback URLs as Cloudflare or external", () => {
  const status = describeContextConnection("https://context.example.com", true);
  assert.equal(status.target, "cloudflare");
  assert.match(status.title, /Cloudflare/);
});
