import { test } from "node:test";
import assert from "node:assert/strict";
import { buildConfirmHtml, normalizeConfirmOptions } from "./ui-dialogs.js";

test("normalizeConfirmOptions: summary", () => {
  assert.deepEqual(normalizeConfirmOptions({ summary: "Do it" }), {
    summary: "Do it",
  });
});

test("normalizeConfirmOptions: message alias", () => {
  assert.deepEqual(
    normalizeConfirmOptions({ title: "Test", message: "This is a test" }),
    { title: "Test", message: "This is a test", summary: "This is a test" },
  );
});

test("normalizeConfirmOptions: summary wins over message", () => {
  assert.equal(
    normalizeConfirmOptions({ summary: "primary", message: "ignored" }).summary,
    "primary",
  );
});

test("normalizeConfirmOptions: rejects empty body", () => {
  assert.throws(
    () => normalizeConfirmOptions({ title: "No body" }),
    /requires `summary`/,
  );
});

test("buildConfirmHtml: includes message/summary body", () => {
  const html = buildConfirmHtml(normalizeConfirmOptions({ message: "Hello & world" }));
  assert.match(html, /Hello &amp; world/);
});
