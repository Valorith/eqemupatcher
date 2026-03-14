const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const {
  getPatchNotesSignature
} = require("../src/electron/renderer/patch-notes-state");

const APP_SOURCE = fs.readFileSync(path.join(__dirname, "..", "src", "electron", "renderer", "app.js"), "utf8");

class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  add(...tokens) {
    for (const token of tokens) {
      this.values.add(token);
    }
  }

  remove(...tokens) {
    for (const token of tokens) {
      this.values.delete(token);
    }
  }

  contains(token) {
    return this.values.has(token);
  }

  toggle(token, force) {
    if (force === true) {
      this.values.add(token);
      return true;
    }

    if (force === false) {
      this.values.delete(token);
      return false;
    }

    if (this.values.has(token)) {
      this.values.delete(token);
      return false;
    }

    this.values.add(token);
    return true;
  }
}

class FakeNode {
  constructor() {
    this.parentNode = null;
  }

  replaceWith(_value) {}
}

class FakeTextNode extends FakeNode {
  constructor(text) {
    super();
    this.nodeValue = text;
    this.textContent = text;
  }
}

class FakeElement extends FakeNode {
  constructor(id = "") {
    super();
    this.id = id;
    this.dataset = {};
    this.style = {};
    this.attributes = {};
    this.listeners = new Map();
    this.classList = new FakeClassList();
    this.children = [];
    this.value = "";
    this.checked = false;
    this.disabled = false;
    this.href = "#";
    this.src = "";
    this.textContent = "";
    this.innerHTML = "";
    this.className = "";
    this.scrollTop = 0;
    this.clientHeight = 0;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name === "href") {
      this.href = String(value);
    }
  }

  getAttribute(name) {
    return this.attributes[name];
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, []);
    }
    this.listeners.get(type).push(listener);
  }

  async dispatch(type, overrides = {}) {
    const listeners = this.listeners.get(type) || [];
    const event = {
      type,
      target: overrides.target || this,
      currentTarget: this,
      key: overrides.key,
      shiftKey: Boolean(overrides.shiftKey),
      preventDefault() {},
      stopPropagation() {}
    };

    for (const listener of listeners) {
      await listener(event);
    }
  }

  append(...nodes) {
    for (const node of nodes) {
      this.appendChild(node);
    }
  }

  appendChild(node) {
    if (node instanceof FakeFragment) {
      for (const child of node.children) {
        this.appendChild(child);
      }
      return node;
    }

    if (node && typeof node === "object") {
      node.parentNode = this;
    }
    this.children.push(node);
    return node;
  }

  contains(node) {
    return node === this || this.children.includes(node);
  }

  closest(_selector) {
    return null;
  }

  querySelectorAll(_selector) {
    return [];
  }

  getBoundingClientRect() {
    return {
      top: 0,
      height: 0
    };
  }

  scrollTo(options = {}) {
    if (typeof options.top === "number") {
      this.scrollTop = options.top;
    }
  }
}

class FakeFragment extends FakeNode {
  constructor() {
    super();
    this.children = [];
  }

  appendChild(node) {
    this.children.push(node);
    return node;
  }
}

class MemoryStorage {
  constructor() {
    this.values = new Map();
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }
}

class FakeDocument {
  constructor() {
    this.elements = new Map();
    this.listeners = new Map();
    this.title = "EQEmu Launcher";
  }

  getElementById(id) {
    if (!this.elements.has(id)) {
      this.elements.set(id, new FakeElement(id));
    }
    return this.elements.get(id);
  }

  createElement(tagName) {
    return new FakeElement(tagName);
  }

  createTextNode(text) {
    return new FakeTextNode(text);
  }

  createDocumentFragment() {
    return new FakeFragment();
  }

  createTreeWalker() {
    return {
      nextNode() {
        return null;
      }
    };
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, []);
    }
    this.listeners.get(type).push(listener);
  }
}

function sha256(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

function createLauncherState(patchNotesUrl) {
  return {
    serverName: "Test Realm",
    patchNotesUrl,
    clientLabel: "Unknown",
    clientVersion: "Unknown",
    clientHash: "",
    clientSupported: false,
    statusBadge: "Run In Folder",
    statusDetail: "Select your EverQuest directory to begin.",
    heroImageUrl: "file:///hero.png",
    canPatch: false,
    canLaunch: false,
    autoPatch: false,
    autoPlay: false,
    gameDirectory: "",
    reportUrl: "",
    progressValue: 0,
    progressMax: 1,
    progressLabel: "Waiting for input",
    isPatching: false,
    manifestVersion: "",
    needsPatch: false,
    launcherUpdate: {
      status: "up-to-date",
      currentVersion: "0.3.12",
      latestVersion: "0.3.12",
      progressValue: 0,
      progressMax: 0,
      releaseUrl: ""
    }
  };
}

function createPatchNotesResponse(url, content) {
  return {
    url,
    content,
    html: `<p>${content}</p>`,
    error: "",
    fetchedAt: "2026-03-14T00:00:00.000Z",
    contentHash: sha256(content)
  };
}

async function flushAsyncWork(turns = 6) {
  for (let index = 0; index < turns; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

async function createRendererHarness(options = {}) {
  const patchNotesUrl = options.patchNotesUrl || "https://example.invalid/notes.md";
  const initialNotes = options.initialNotes || createPatchNotesResponse(patchNotesUrl, "First note");
  let refreshedNotes = options.refreshedNotes || initialNotes;
  const document = new FakeDocument();
  const localStorage = new MemoryStorage();
  const calls = {
    getPatchNotes: [],
    refreshState: 0,
    checkForLauncherUpdate: 0
  };

  const launcherState = createLauncherState(options.includePatchNotesUrl === false ? "" : patchNotesUrl);
  const launcher = {
    async initialize() {
      return launcherState;
    },
    async getPatchNotes(requestOptions = {}) {
      calls.getPatchNotes.push({ ...requestOptions });
      return requestOptions.forceRefresh ? refreshedNotes : initialNotes;
    },
    async refreshState() {
      calls.refreshState += 1;
      return launcherState;
    },
    async checkForLauncherUpdate() {
      calls.checkForLauncherUpdate += 1;
      return launcherState;
    },
    async applyLauncherUpdate() {
      return {
        state: launcherState
      };
    },
    async startLauncherUpdateDownload() {
      return launcherState;
    },
    async startPatch() {
      return launcherState;
    },
    async cancelPatch() {
      return launcherState;
    },
    async launchGame() {
      return launcherState;
    },
    async updateSettings() {
      return launcherState;
    },
    async minimizeWindow() {
      return true;
    },
    async closeWindow() {
      return true;
    },
    async openExternal() {
      return true;
    },
    async openConfigFile() {
      return { ok: true, path: "", error: "" };
    },
    async openGameDirectory() {
      return { ok: false, path: "", error: "No game directory is currently selected." };
    },
    onEvent() {
      return () => {};
    }
  };

  const context = {
    console,
    window: {
      launcher,
      localStorage,
      PatchNotesState: require("../src/electron/renderer/patch-notes-state")
    },
    document,
    NodeFilter: {
      SHOW_TEXT: 4
    },
    setTimeout,
    clearTimeout,
    setImmediate,
    Promise,
    Date
  };
  context.globalThis = context;
  context.window.window = context.window;
  context.window.document = document;

  vm.runInNewContext(APP_SOURCE, context, {
    filename: "renderer-app.js"
  });

  await flushAsyncWork();

  return {
    calls,
    document,
    elements: {
      notesTabButton: document.getElementById("notesTabButton"),
      patchTabButton: document.getElementById("patchTabButton"),
      refreshButton: document.getElementById("refreshButton"),
      notesContent: document.getElementById("notesContent")
    },
    localStorage,
    setRefreshedNotes(value) {
      refreshedNotes = value;
    }
  };
}

test("renderer bootstrap loads configured patch notes in the background and shows unread state", async () => {
  const harness = await createRendererHarness({
    initialNotes: createPatchNotesResponse("https://example.invalid/notes.md", "Unread patch note")
  });

  assert.equal(harness.calls.getPatchNotes.length, 1);
  assert.deepEqual(harness.calls.getPatchNotes[0], { forceRefresh: false });
  assert.equal(harness.elements.notesTabButton.classList.contains("has-unread"), true);
  assert.equal(harness.elements.notesTabButton.attributes["aria-label"], "Patch Notes (new unread notes)");
});

test("opening the notes tab marks the current notes as read", async () => {
  const notes = createPatchNotesResponse("https://example.invalid/notes.md", "Read me");
  const harness = await createRendererHarness({
    initialNotes: notes
  });

  await harness.elements.notesTabButton.dispatch("click");
  await flushAsyncWork();

  const expectedSignature = getPatchNotesSignature(notes.url, notes.contentHash, notes.content);
  const stored = JSON.parse(harness.localStorage.getItem("eqemu-launcher.patchNotesRead"));

  assert.equal(harness.elements.notesTabButton.classList.contains("has-unread"), false);
  assert.equal(stored[notes.url], expectedSignature);
});

test("refreshing after notes change restores the unread indicator", async () => {
  const initialNotes = createPatchNotesResponse("https://example.invalid/notes.md", "Version one");
  const refreshedNotes = createPatchNotesResponse("https://example.invalid/notes.md", "Version two");
  const harness = await createRendererHarness({
    initialNotes,
    refreshedNotes
  });

  await harness.elements.notesTabButton.dispatch("click");
  await flushAsyncWork();
  await harness.elements.patchTabButton.dispatch("click");
  await flushAsyncWork();

  harness.setRefreshedNotes(refreshedNotes);
  await harness.elements.refreshButton.dispatch("click");
  await flushAsyncWork();

  assert.equal(harness.calls.refreshState, 1);
  assert.equal(harness.calls.checkForLauncherUpdate, 1);
  assert.deepEqual(harness.calls.getPatchNotes.at(-1), { forceRefresh: true });
  assert.equal(harness.elements.notesTabButton.classList.contains("has-unread"), true);
});

test("renderer bootstrap skips patch notes loading when no source is configured", async () => {
  const harness = await createRendererHarness({
    includePatchNotesUrl: false
  });

  assert.equal(harness.calls.getPatchNotes.length, 0);
  assert.equal(harness.elements.notesTabButton.classList.contains("has-unread"), false);
});
