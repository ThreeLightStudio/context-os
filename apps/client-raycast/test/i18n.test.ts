import assert from "node:assert/strict";
import test from "node:test";
import { createI18n, getI18n, normalizeLocalePreference, resolveLocale } from "../src/i18n.ts";

test("auto resolves Korean browser locales to Korean", () => {
  assert.equal(resolveLocale("auto", "ko-KR"), "ko");
  assert.equal(resolveLocale("auto", "ko"), "ko");
});

test("auto resolves non-Korean browser locales to English", () => {
  assert.equal(resolveLocale("auto", "en-US"), "en");
  assert.equal(resolveLocale("auto", "ja-JP"), "en");
});

test("explicit locale preferences override the runtime locale", () => {
  assert.equal(resolveLocale("ko", "en-US"), "ko");
  assert.equal(resolveLocale("en", "ko-KR"), "en");
});

test("invalid or missing preferences safely fall back to auto", () => {
  assert.equal(normalizeLocalePreference(undefined), "auto");
  assert.equal(normalizeLocalePreference("fr"), "auto");
  assert.equal(getI18n({ language: "invalid" }).locale, resolveLocale("auto"));
});

test("preferences are applied when creating the command translator", () => {
  assert.equal(getI18n({ language: "ko" }).locale, "ko");
  assert.equal(getI18n({ language: "en" }).locale, "en");
});

test("messages interpolate values and dates use the selected locale", () => {
  const korean = createI18n("ko");
  const english = createI18n("en");
  const date = new Date("2026-08-06T01:02:03.000Z");
  const dateOptions = { timeZone: "UTC", year: "numeric", month: "long", day: "numeric" } as const;

  assert.equal(korean.t("recent.copied", { count: 2 }), "2개 기록을 복사했습니다");
  assert.equal(english.t("recent.copied", { count: 2 }), "Copied 2 capture(s)");
  assert.notEqual(korean.formatDate(date, dateOptions), english.formatDate(date, dateOptions));
  assert.match(korean.formatDate(date, dateOptions), /2026/);
  assert.match(english.formatDate(date, dateOptions), /2026/);
});
