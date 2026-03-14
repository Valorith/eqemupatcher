const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createPatchNotesReadTracker,
  getPatchNotesSignature,
  shouldLoadPatchNotes
} = require("../src/electron/renderer/patch-notes-state");

class MemoryStorage {
  constructor() {
    this.values = new Map();
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setItem(key, value) {
    this.values.set(key, value);
  }
}

test("getPatchNotesSignature prefers the backend content hash when available", () => {
  assert.equal(
    getPatchNotesSignature("https://example.invalid/notes.md", "abc123", "ignored"),
    "https://example.invalid/notes.md::abc123"
  );
});

test("getPatchNotesSignature falls back to a stable content signature when needed", () => {
  const first = getPatchNotesSignature("https://example.invalid/notes.md", "", "first body");
  const second = getPatchNotesSignature("https://example.invalid/notes.md", "", "first body");
  const third = getPatchNotesSignature("https://example.invalid/notes.md", "", "second body");

  assert.notEqual(first, "");
  assert.equal(first, second);
  assert.notEqual(first, third);
});

test("createPatchNotesReadTracker persists and compares read signatures", () => {
  const tracker = createPatchNotesReadTracker({
    storage: new MemoryStorage(),
    storageKey: "eqemu.patchNotesRead",
    initializedStorageKey: "eqemu.patchNotesReadInitialized"
  });

  assert.equal(tracker.initializeBaseline("https://example.invalid/notes.md", "sig-v1"), true);
  assert.equal(tracker.isUnread("https://example.invalid/notes.md", "sig-v1"), false);
  tracker.markRead("https://example.invalid/notes.md", "sig-v1");
  assert.equal(tracker.isUnread("https://example.invalid/notes.md", "sig-v1"), false);
  assert.equal(tracker.isUnread("https://example.invalid/notes.md", "sig-v2"), true);
});

test("createPatchNotesReadTracker falls back to session memory when storage is unavailable", () => {
  const tracker = createPatchNotesReadTracker({
    storage: {
      getItem() {
        throw new Error("storage unavailable");
      },
      setItem() {
        throw new Error("storage unavailable");
      }
    },
    storageKey: "eqemu.patchNotesRead",
    initializedStorageKey: "eqemu.patchNotesReadInitialized"
  });

  tracker.initializeBaseline("https://example.invalid/notes.md", "sig-v1");

  assert.equal(tracker.isUnread("https://example.invalid/notes.md", "sig-v1"), false);
  assert.equal(tracker.isUnread("https://example.invalid/notes.md", "sig-v2"), true);
});

test("createPatchNotesReadTracker only baselines the first clean load", () => {
  const tracker = createPatchNotesReadTracker({
    storage: new MemoryStorage(),
    storageKey: "eqemu.patchNotesRead",
    initializedStorageKey: "eqemu.patchNotesReadInitialized"
  });

  assert.equal(tracker.initializeBaseline("https://example.invalid/notes.md", "sig-v1"), true);
  assert.equal(tracker.initializeBaseline("https://example.invalid/notes.md", "sig-v2"), false);
  assert.equal(tracker.isUnread("https://example.invalid/notes.md", "sig-v2"), true);
});

test("shouldLoadPatchNotes requests an initial or changed source and skips loaded sources", () => {
  assert.equal(shouldLoadPatchNotes("", { loaded: false, loadedUrl: "", loading: false }), false);
  assert.equal(shouldLoadPatchNotes("https://example.invalid/notes.md", { loaded: false, loadedUrl: "", loading: true }), false);
  assert.equal(shouldLoadPatchNotes("https://example.invalid/notes.md", { loaded: false, loadedUrl: "", loading: false }), true);
  assert.equal(
    shouldLoadPatchNotes("https://example.invalid/notes.md", {
      loaded: true,
      loadedUrl: "https://example.invalid/notes.md",
      loading: false
    }),
    false
  );
  assert.equal(
    shouldLoadPatchNotes("https://example.invalid/notes.md", {
      loaded: true,
      loadedUrl: "https://example.invalid/other.md",
      loading: false
    }),
    true
  );
});
