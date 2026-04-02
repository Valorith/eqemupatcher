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
const PATCH_NOTES_READ_STORAGE_KEY = "eqemu-launcher.patchNotesRead";
const PATCH_NOTES_READ_INITIALIZED_STORAGE_KEY = "eqemu-launcher.patchNotesReadInitialized";

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
  constructor(id = "", tagName = "div") {
    super();
    this.id = id;
    this.tagName = String(tagName || "div").toUpperCase();
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
    return new FakeElement("", tagName);
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

function collectTextContent(node) {
  if (!node) {
    return "";
  }

  if (node instanceof FakeTextNode) {
    return node.textContent;
  }

  if (node instanceof FakeFragment) {
    return node.children.map((child) => collectTextContent(child)).join("");
  }

  if (node instanceof FakeElement) {
    if (!node.children.length) {
      return node.textContent || "";
    }
    return node.children.map((child) => collectTextContent(child)).join("");
  }

  return "";
}

function createLauncherState(patchNotesUrl, options = {}) {
  const {
    launcherUpdate: launcherUpdateOverrides,
    patchNotesUrl: _patchNotesUrl,
    initialNotes: _initialNotes,
    refreshedNotes: _refreshedNotes,
    initializedReadState: _initializedReadState,
    markInitialized: _markInitialized,
    includePatchNotesUrl: _includePatchNotesUrl,
    ...stateOverrides
  } = options;
  const launcherUpdate = {
    status: "up-to-date",
    currentVersion: "0.3.12",
    latestVersion: "0.3.12",
    progressValue: 0,
    progressMax: 0,
    releaseUrl: "",
    ...(launcherUpdateOverrides || {})
  };

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
    onGameLaunch: "minimize",
    gameDirectory: options.gameDirectory || "",
    reportUrl: "",
    progressValue: 0,
    progressMax: 1,
    progressLabel: "Waiting for input",
    isPatching: false,
    manifestVersion: "",
    needsPatch: false,
    launcherUpdate,
    ...stateOverrides
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

function createUiManagerOverviewResponse() {
  return {
    gameDirectory: "C:\\EQ",
    uiFilesDirectory: "C:\\EQ\\uifiles",
    canManage: true,
    packages: [
      {
        name: "FancyUI",
        path: "C:\\EQ\\uifiles\\FancyUI",
        protected: false,
        prepared: true,
        optionCount: 2,
        rootXmlCount: 3
      }
    ],
    targets: [
      {
        path: "C:\\EQ\\UI_Test_CW.ini",
        fileName: "UI_Test_CW.ini",
        characterName: "Test",
        serverName: "CW",
        uiSkin: "Default"
      }
    ]
  };
}

function createUiManagerDetailResponse() {
  return {
    name: "FancyUI",
    path: "C:\\EQ\\uifiles\\FancyUI",
    protected: false,
    prepared: true,
    rootFiles: ["EQUI_Inventory.xml", "bar.tga"],
    bundles: [
      {
        optionPath: "Options/Default",
        label: "Default",
        categoryPath: "",
        isDefault: true,
        xmlFiles: ["EQUI_Inventory.xml"],
        tgaFiles: [],
        previewImageUrl: "",
        instructions: "",
        activeState: "inactive"
      },
      {
        optionPath: "Options/Alt/Blue",
        label: "Blue",
        categoryPath: "Alt",
        isDefault: false,
        xmlFiles: ["EQUI_Inventory.xml"],
        tgaFiles: ["bar.tga"],
        previewImageUrl: "file:///preview.png",
        instructions: "",
        activeState: "active"
      },
      {
        optionPath: "Options/Alt/Red",
        label: "Red",
        categoryPath: "Alt",
        isDefault: false,
        xmlFiles: ["EQUI_Inventory.xml"],
        tgaFiles: [],
        previewImageUrl: "",
        instructions: "",
        activeState: "inactive"
      }
    ],
    backups: [
      {
        id: "2026-03-21-restore",
        packageName: "FancyUI",
        reason: "reset",
        createdAt: "2026-03-21T12:00:00.000Z",
        sizeBytes: 8192,
        hasSnapshot: true,
        iniFiles: []
      },
      {
        id: "2026-03-20-set-uiskin",
        packageName: "FancyUI",
        reason: "set-uiskin",
        createdAt: "2026-03-20T12:00:00.000Z",
        sizeBytes: 1024,
        hasSnapshot: false,
        iniFiles: [{ originalPath: "C:\\EQ\\UI_Test_CW.ini", backupFile: "01__UI_Test_CW.ini" }]
      }
    ],
    backupSummary: {
      backupCount: 2,
      totalSizeBytes: 9216,
      maxBackupCount: 20,
      maxTotalSizeBytes: 536870912
    }
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
  if (options.initializedReadState) {
    localStorage.setItem(PATCH_NOTES_READ_STORAGE_KEY, JSON.stringify(options.initializedReadState));
    localStorage.setItem(PATCH_NOTES_READ_INITIALIZED_STORAGE_KEY, "true");
  } else if (options.markInitialized) {
    localStorage.setItem(PATCH_NOTES_READ_INITIALIZED_STORAGE_KEY, "true");
  }
  const calls = {
    getPatchNotes: [],
    refreshState: 0,
    checkForLauncherUpdate: 0,
    openExternal: [],
    getUiManagerOverview: 0,
    getUiPackageDetails: [],
    prepareUiPackage: [],
    checkUiPackageMetadata: [],
    validateUiPackageOptionComments: [],
    activateUiOption: [],
    setUiSkinTargets: [],
    resetUiPackage: [],
    restoreUiManagerBackup: [],
    importUiPackageFolder: [],
    launchGame: 0,
    updateSettings: [],
    minimizeWindow: 0,
    closeWindow: 0
  };
  let uiManagerOverview = options.uiManagerOverview || createUiManagerOverviewResponse();
  let uiManagerDetail = options.uiManagerDetail || createUiManagerDetailResponse();

  const launcherState = createLauncherState(options.includePatchNotesUrl === false ? "" : patchNotesUrl, options);
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
      calls.launchGame += 1;
      return launcherState;
    },
    async updateSettings(patch = {}) {
      calls.updateSettings.push({ ...patch });
      Object.assign(launcherState, patch);
      return launcherState;
    },
    async minimizeWindow() {
      calls.minimizeWindow += 1;
      return true;
    },
    async closeWindow() {
      calls.closeWindow += 1;
      return true;
    },
    async openExternal(url) {
      calls.openExternal.push(url);
      return true;
    },
    async openConfigFile() {
      return { ok: true, path: "", error: "" };
    },
    async openGameDirectory() {
      return { ok: false, path: "", error: "No game directory is currently selected." };
    },
    async getUiManagerOverview() {
      calls.getUiManagerOverview += 1;
      return uiManagerOverview;
    },
    async openUiManagerImportDialog() {
      return {
        canceled: true,
        sourcePath: ""
      };
    },
    async importUiPackageFolder(sourcePath) {
      calls.importUiPackageFolder.push(sourcePath);
      return {
        overview: uiManagerOverview,
        details: uiManagerDetail
      };
    },
    async prepareUiPackage(packageName) {
      calls.prepareUiPackage.push(packageName);
      return {
        details: uiManagerDetail
      };
    },
    async checkUiPackageMetadata(packageName) {
      calls.checkUiPackageMetadata.push(packageName);
      return {
        packageName,
        status: "healthy",
        scannedCount: 2,
        invalidCount: 0,
        healthy: true
      };
    },
    async validateUiPackageOptionComments(packageName) {
      calls.validateUiPackageOptionComments.push(packageName);
      return {
        details: uiManagerDetail,
        summary: {
          scannedCount: 2,
          correctedCount: 1
        }
      };
    },
    async getUiPackageDetails(packageName) {
      calls.getUiPackageDetails.push(packageName);
      return uiManagerDetail;
    },
    async activateUiOption(requestOptions) {
      calls.activateUiOption.push(requestOptions);
      return {
        details: uiManagerDetail
      };
    },
    async setUiSkinTargets(requestOptions) {
      calls.setUiSkinTargets.push(requestOptions);
      return {
        targets: uiManagerOverview.targets
      };
    },
    async resetUiPackage(packageName) {
      calls.resetUiPackage.push(packageName);
      return {
        details: uiManagerDetail
      };
    },
    async listUiManagerBackups() {
      return uiManagerDetail.backups;
    },
    async restoreUiManagerBackup(requestOptions) {
      calls.restoreUiManagerBackup.push(requestOptions);
      return {
        details: uiManagerDetail,
        targets: uiManagerOverview.targets
      };
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
  document.getElementById("patchTabButton").classList.add("is-active");
  document.getElementById("notesTabPanel").classList.add("hidden");
  document.getElementById("settingsModal").classList.add("hidden");
  document.getElementById("unsupportedClientModal").classList.add("hidden");
  document.getElementById("launcherUpdateModal").classList.add("hidden");
  document.getElementById("patchNotesPromptModal").classList.add("hidden");
  document.getElementById("uiManagerModal").classList.add("hidden");
  document.getElementById("uiManagerConfirmModal").classList.add("hidden");
  document.getElementById("toolsMenu").classList.add("hidden");
  document.getElementById("launcherUpdatePanel").classList.add("hidden");

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
      notesContent: document.getElementById("notesContent"),
      uiManagerTabButton: document.getElementById("uiManagerTabButton"),
      openUiManagerButton: document.getElementById("openUiManagerButton"),
      uiManagerModal: document.getElementById("uiManagerModal"),
      uiManagerPackageCount: document.getElementById("uiManagerPackageCount"),
      uiManagerPreviewName: document.getElementById("uiManagerPreviewName"),
      uiManagerPackageList: document.getElementById("uiManagerPackageList"),
      uiManagerRecoveryButton: document.getElementById("uiManagerRecoveryButton"),
      uiManagerRecoveryStats: document.getElementById("uiManagerRecoveryStats"),
      uiManagerBackupList: document.getElementById("uiManagerBackupList"),
      uiManagerOptionList: document.getElementById("uiManagerOptionList"),
      uiManagerApplyOptionButton: document.getElementById("uiManagerApplyOptionButton"),
      uiManagerStageTabs: document.getElementById("uiManagerStageTabs"),
      uiManagerResetButton: document.getElementById("uiManagerResetButton"),
      uiManagerTargetServerFilter: document.getElementById("uiManagerTargetServerFilter"),
      uiManagerTargetList: document.getElementById("uiManagerTargetList"),
      uiManagerStagePackagesButton: document.getElementById("uiManagerStagePackagesButton"),
      uiManagerConfirmModal: document.getElementById("uiManagerConfirmModal"),
      uiManagerConfirmAcceptButton: document.getElementById("uiManagerConfirmAcceptButton"),
      uiManagerNotice: document.getElementById("uiManagerNotice"),
      launchButton: document.getElementById("launchButton"),
      onGameLaunchSelect: document.getElementById("onGameLaunchSelect"),
      patchNotesPromptModal: document.getElementById("patchNotesPromptModal"),
      patchNotesPromptLaterButton: document.getElementById("patchNotesPromptLaterButton"),
      patchNotesPromptViewButton: document.getElementById("patchNotesPromptViewButton"),
      launcherUpdateModal: document.getElementById("launcherUpdateModal"),
      launcherUpdateLaterButton: document.getElementById("launcherUpdateLaterButton"),
      launcherUpdateReleaseNotes: document.getElementById("launcherUpdateReleaseNotes")
    },
    localStorage,
    setRefreshedNotes(value) {
      refreshedNotes = value;
    },
    setUiManagerOverview(value) {
      uiManagerOverview = value;
    },
    setUiManagerDetail(value) {
      uiManagerDetail = value;
    }
  };
}

test("renderer bootstrap defers patch notes loading until they are needed", async () => {
  const harness = await createRendererHarness({
    initialNotes: createPatchNotesResponse("https://example.invalid/notes.md", "Existing patch note")
  });

  assert.equal(harness.calls.getPatchNotes.length, 0);
  assert.equal(harness.elements.notesTabButton.classList.contains("has-unread"), false);
  assert.equal(harness.elements.patchNotesPromptModal.classList.contains("hidden"), true);
});

test("opening the notes tab loads patch notes and stores the baseline read state", async () => {
  const notes = createPatchNotesResponse("https://example.invalid/notes.md", "Existing patch note");
  const harness = await createRendererHarness({
    initialNotes: notes
  });

  await harness.elements.notesTabButton.dispatch("click");
  await flushAsyncWork();

  const expectedSignature = getPatchNotesSignature(notes.url, notes.contentHash, notes.content);
  const stored = JSON.parse(harness.localStorage.getItem(PATCH_NOTES_READ_STORAGE_KEY));

  assert.equal(harness.calls.getPatchNotes.length, 1);
  assert.deepEqual(harness.calls.getPatchNotes[0], { forceRefresh: false });
  assert.equal(harness.localStorage.getItem(PATCH_NOTES_READ_INITIALIZED_STORAGE_KEY), "true");
  assert.equal(stored[notes.url], expectedSignature);
});

test("patch notes prompt Later dismisses the current unread notice", async () => {
  const notes = createPatchNotesResponse("https://example.invalid/notes.md", "Unread patch note");
  const harness = await createRendererHarness({
    initialNotes: notes,
    refreshedNotes: notes,
    markInitialized: true
  });

  await harness.elements.refreshButton.dispatch("click");
  await flushAsyncWork();
  await harness.elements.patchNotesPromptLaterButton.dispatch("click");
  await flushAsyncWork();
  await harness.elements.refreshButton.dispatch("click");
  await flushAsyncWork();

  assert.equal(harness.elements.patchNotesPromptModal.classList.contains("hidden"), true);
  assert.equal(harness.elements.notesTabButton.classList.contains("has-unread"), true);
});

test("opening the notes tab marks the current notes as read", async () => {
  const notes = createPatchNotesResponse("https://example.invalid/notes.md", "Read me");
  const harness = await createRendererHarness({
    initialNotes: notes,
    markInitialized: true
  });

  await harness.elements.notesTabButton.dispatch("click");
  await flushAsyncWork();

  const expectedSignature = getPatchNotesSignature(notes.url, notes.contentHash, notes.content);
  const stored = JSON.parse(harness.localStorage.getItem(PATCH_NOTES_READ_STORAGE_KEY));

  assert.equal(harness.elements.notesTabButton.classList.contains("has-unread"), false);
  assert.equal(stored[notes.url], expectedSignature);
});

test("patch notes prompt View opens the patch notes tab", async () => {
  const harness = await createRendererHarness({
    initialNotes: createPatchNotesResponse("https://example.invalid/notes.md", "Unread patch note"),
    markInitialized: true
  });

  await harness.elements.refreshButton.dispatch("click");
  await flushAsyncWork();
  await harness.elements.patchNotesPromptViewButton.dispatch("click");
  await flushAsyncWork();

  assert.equal(harness.elements.patchNotesPromptModal.classList.contains("hidden"), true);
  assert.equal(harness.elements.notesTabButton.classList.contains("is-active"), true);
  assert.equal(harness.elements.notesTabButton.classList.contains("has-unread"), false);
});

test("refreshing after notes change restores the unread indicator", async () => {
  const initialNotes = createPatchNotesResponse("https://example.invalid/notes.md", "Version one");
  const refreshedNotes = createPatchNotesResponse("https://example.invalid/notes.md", "Version two");
  const harness = await createRendererHarness({
    initialNotes,
    refreshedNotes,
    initializedReadState: {
      [initialNotes.url]: getPatchNotesSignature(initialNotes.url, initialNotes.contentHash, initialNotes.content)
    }
  });

  await harness.elements.notesTabButton.dispatch("click");
  await flushAsyncWork();
  await harness.elements.patchTabButton.dispatch("click");
  await flushAsyncWork();

  harness.setRefreshedNotes(refreshedNotes);
  await harness.elements.refreshButton.dispatch("click");
  await flushAsyncWork();

  assert.equal(harness.calls.refreshState, 1);
  assert.equal(harness.calls.checkForLauncherUpdate, 0);
  assert.deepEqual(harness.calls.getPatchNotes.at(-1), { forceRefresh: true });
  assert.equal(harness.elements.notesTabButton.classList.contains("has-unread"), true);
  assert.equal(harness.elements.patchNotesPromptModal.classList.contains("hidden"), false);
});

test("launcher update prompt takes priority over the patch notes prompt", async () => {
  const harness = await createRendererHarness({
    initialNotes: createPatchNotesResponse("https://example.invalid/notes.md", "Unread patch note"),
    launcherUpdate: {
      status: "available",
      latestVersion: "0.3.13",
      releaseNotes: "## Release Notes\n\n- Added informed update dialogs"
    },
    markInitialized: true
  });

  await harness.elements.refreshButton.dispatch("click");
  await flushAsyncWork();

  assert.equal(harness.elements.launcherUpdateModal.classList.contains("hidden"), false);
  assert.equal(harness.elements.patchNotesPromptModal.classList.contains("hidden"), true);
  assert.match(collectTextContent(harness.elements.launcherUpdateReleaseNotes), /Added informed update dialogs/);

  await harness.elements.launcherUpdateLaterButton.dispatch("click");
  await flushAsyncWork();

  assert.equal(harness.elements.launcherUpdateModal.classList.contains("hidden"), true);
  assert.equal(harness.elements.patchNotesPromptModal.classList.contains("hidden"), false);
});

test("launcher update release notes render clickable links", async () => {
  const harness = await createRendererHarness({
    launcherUpdate: {
      status: "available",
      latestVersion: "0.3.13",
      releaseNotes: "Read the [changelog](https://example.invalid/changelog) or visit https://example.invalid/raw."
    },
    markInitialized: true
  });

  const anchors = harness.elements.launcherUpdateReleaseNotes.children.filter(
    (child) => child instanceof FakeElement && child.tagName === "A"
  );

  assert.equal(anchors.length, 2);
  assert.equal(anchors[0].textContent, "changelog");
  assert.equal(anchors[0].getAttribute("href"), "https://example.invalid/changelog");
  assert.equal(anchors[1].textContent, "https://example.invalid/raw");
  assert.equal(anchors[1].getAttribute("href"), "https://example.invalid/raw");
});

test("clicking a launcher update release note link opens it externally", async () => {
  const harness = await createRendererHarness({
    launcherUpdate: {
      status: "available",
      latestVersion: "0.3.13",
      releaseNotes: "More details: https://example.invalid/update."
    },
    markInitialized: true
  });

  const [anchor] = harness.elements.launcherUpdateReleaseNotes.children.filter(
    (child) => child instanceof FakeElement && child.tagName === "A"
  );

  await harness.elements.launcherUpdateReleaseNotes.dispatch("click", {
    target: {
      closest(selector) {
        return selector === "a" ? anchor : null;
      }
    }
  });

  assert.deepEqual(harness.calls.openExternal, ["https://example.invalid/update"]);
});

test("renderer bootstrap skips patch notes loading when no source is configured", async () => {
  const harness = await createRendererHarness({
    includePatchNotesUrl: false
  });

  assert.equal(harness.calls.getPatchNotes.length, 0);
  assert.equal(harness.elements.notesTabButton.classList.contains("has-unread"), false);
});

test("opening the UI Manager tab loads package overview lazily", async () => {
  const harness = await createRendererHarness({
    gameDirectory: "C:\\EQ"
  });

  assert.equal(harness.calls.getUiManagerOverview, 0);

  await harness.elements.uiManagerTabButton.dispatch("click");
  await flushAsyncWork();

  assert.equal(harness.calls.getUiManagerOverview, 1);
  assert.equal(harness.elements.uiManagerPackageCount.textContent, "1");
  assert.match(harness.elements.uiManagerPreviewName.textContent, /FancyUI/);
});

test("opening the UI Manager modal shows the workspace", async () => {
  const harness = await createRendererHarness({
    gameDirectory: "C:\\EQ"
  });

  await harness.elements.uiManagerTabButton.dispatch("click");
  await flushAsyncWork();
  await harness.elements.openUiManagerButton.dispatch("click");
  await flushAsyncWork();

  assert.equal(harness.elements.uiManagerModal.classList.contains("hidden"), false);
});

test("Stage 1 server filter narrows visible character cards by server name", async () => {
  const harness = await createRendererHarness({
    gameDirectory: "C:\\EQ",
    uiManagerOverview: {
      ...createUiManagerOverviewResponse(),
      targets: [
        {
          path: "C:\\EQ\\UI_One_CW.ini",
          fileName: "UI_One_CW.ini",
          characterName: "One",
          serverName: "CW",
          uiSkin: "Default"
        },
        {
          path: "C:\\EQ\\UI_Two_CW.ini",
          fileName: "UI_Two_CW.ini",
          characterName: "Two",
          serverName: "CW",
          uiSkin: "FancyUI"
        },
        {
          path: "C:\\EQ\\UI_Three_PEQ.ini",
          fileName: "UI_Three_PEQ.ini",
          characterName: "Three",
          serverName: "PEQ",
          uiSkin: "Default"
        }
      ]
    }
  });

  await harness.elements.uiManagerTabButton.dispatch("click");
  await flushAsyncWork();
  await harness.elements.openUiManagerButton.dispatch("click");
  await flushAsyncWork();

  harness.elements.uiManagerTargetServerFilter.value = "CW";
  await harness.elements.uiManagerTargetServerFilter.dispatch("change", {
    target: harness.elements.uiManagerTargetServerFilter
  });
  await flushAsyncWork();

  assert.equal(harness.elements.uiManagerTargetList.children.length, 2);
  assert.match(collectTextContent(harness.elements.uiManagerTargetList.children[0]), /CW/);
  assert.match(collectTextContent(harness.elements.uiManagerTargetList.children[1]), /CW/);
});

test("recovery view shows backup retention summary and per-backup storage metadata", async () => {
  const harness = await createRendererHarness({
    gameDirectory: "C:\\EQ"
  });

  await harness.elements.uiManagerTabButton.dispatch("click");
  await flushAsyncWork();
  await harness.elements.openUiManagerButton.dispatch("click");
  await flushAsyncWork();
  await harness.elements.uiManagerRecoveryButton.dispatch("click");
  await flushAsyncWork();

  assert.match(collectTextContent(harness.elements.uiManagerRecoveryStats), /2 of 20 kept/);
  assert.match(collectTextContent(harness.elements.uiManagerRecoveryStats), /9 KB used/);
  assert.match(collectTextContent(harness.elements.uiManagerRecoveryStats), /Auto-trim at 512\.0 MB/);
  assert.match(collectTextContent(harness.elements.uiManagerBackupList), /Full snapshot/);
  assert.match(collectTextContent(harness.elements.uiManagerBackupList), /INI-only/);
});

test("an unprepared package stays blocked from Stage 3 until prepared from Stage 2", async () => {
  const harness = await createRendererHarness({
    gameDirectory: "C:\\EQ",
    uiManagerOverview: {
      ...createUiManagerOverviewResponse(),
      packages: [
        {
          name: "FancyUI",
          path: "C:\\EQ\\uifiles\\FancyUI",
          protected: false,
          prepared: false,
          optionCount: 2,
          rootXmlCount: 3
        }
      ]
    },
    uiManagerDetail: {
      ...createUiManagerDetailResponse(),
      prepared: false
    }
  });

  await harness.elements.uiManagerTabButton.dispatch("click");
  await flushAsyncWork();
  await harness.elements.openUiManagerButton.dispatch("click");
  await flushAsyncWork();
  await harness.elements.uiManagerStagePackagesButton.dispatch("click");
  await flushAsyncWork();
  await harness.elements.uiManagerPackageList.dispatch("click", {
    target: {
      closest(selector) {
        return selector === "button[data-package-name]" ? harness.elements.uiManagerPackageList.children[0] : null;
      }
    }
  });
  await flushAsyncWork();

  assert.equal(harness.document.getElementById("uiManagerStageComponentsButton").getAttribute("aria-disabled"), "true");

  const prepareButton = {
    dataset: {
      uiManagerPackageAction: "prepare"
    },
    closest(selector) {
      return selector === "button[data-ui-manager-package-action]" ? this : null;
    }
  };
  await harness.document.getElementById("uiManagerPackageDetail").dispatch("click", {
    target: prepareButton
  });
  await flushAsyncWork();
  await harness.elements.uiManagerConfirmAcceptButton.dispatch("click");
  await flushAsyncWork();

  assert.deepEqual(harness.calls.prepareUiPackage, ["FancyUI"]);
});

test("opening Stage 2 automatically runs the UI Meta Data health check for prepared custom packages", async () => {
  const harness = await createRendererHarness({
    gameDirectory: "C:\\EQ"
  });

  await harness.elements.uiManagerTabButton.dispatch("click");
  await flushAsyncWork();
  await harness.elements.openUiManagerButton.dispatch("click");
  await flushAsyncWork();
  harness.elements.uiManagerStagePackagesButton.dataset.uiManagerStage = "packages";
  await harness.elements.uiManagerStageTabs.dispatch("click", {
    target: {
      closest(selector) {
        return selector === "button[data-ui-manager-stage]" ? harness.elements.uiManagerStagePackagesButton : null;
      }
    }
  });
  await flushAsyncWork();

  assert.deepEqual(harness.calls.checkUiPackageMetadata, ["FancyUI"]);
});

test("Stage 2 package cards use a tooltip on the health check instead of a visible UI Meta Data label", async () => {
  const harness = await createRendererHarness({
    gameDirectory: "C:\\EQ"
  });

  await harness.elements.uiManagerTabButton.dispatch("click");
  await flushAsyncWork();
  await harness.elements.openUiManagerButton.dispatch("click");
  await flushAsyncWork();
  await harness.elements.uiManagerStagePackagesButton.dispatch("click");
  await flushAsyncWork();

  const firstPackageCard = harness.elements.uiManagerPackageList.children[0];
  const healthRow = firstPackageCard.children[1];
  const healthCopy = healthRow.children[0];
  const healthCheck = healthRow.children[1];

  assert.doesNotMatch(collectTextContent(healthCopy), /UI Meta Data/);
  assert.match(collectTextContent(healthCopy), /checked|Healthy|Pending|Checking/i);
  assert.match(healthCheck.getAttribute("title") || "", /UI Meta Data health/i);
});

test("confirming Apply Option sends the selected package, option, and targets to the backend", async () => {
  const harness = await createRendererHarness({
    gameDirectory: "C:\\EQ",
    uiManagerOverview: {
      ...createUiManagerOverviewResponse(),
      targets: [
        {
          path: "C:\\EQ\\UI_Test_CW.ini",
          fileName: "UI_Test_CW.ini",
          characterName: "Test",
          serverName: "CW",
          uiSkin: "FancyUI"
        }
      ]
    }
  });

  await harness.elements.uiManagerTabButton.dispatch("click");
  await flushAsyncWork();
  await harness.elements.openUiManagerButton.dispatch("click");
  await flushAsyncWork();

  const targetInput = harness.elements.uiManagerTargetList.children[0].children[0];
  targetInput.checked = true;
  await harness.elements.uiManagerTargetList.dispatch("change", {
    target: targetInput
  });
  await flushAsyncWork();

  const redOptionCard = harness.elements.uiManagerOptionList.children[2];
  const redOptionCheckbox = redOptionCard.children[0].children[2].children[0];
  redOptionCheckbox.checked = true;
  redOptionCheckbox.closest = (selector) => selector === "input[data-option-toggle='true']" ? redOptionCheckbox : null;
  await harness.elements.uiManagerOptionList.dispatch("change", {
    target: redOptionCheckbox
  });
  await flushAsyncWork();

  await harness.elements.uiManagerApplyOptionButton.dispatch("click");
  await flushAsyncWork();
  assert.equal(harness.elements.uiManagerConfirmModal.classList.contains("hidden"), false);

  await harness.elements.uiManagerConfirmAcceptButton.dispatch("click");
  await flushAsyncWork();

  assert.equal(harness.calls.activateUiOption.length, 1);
  assert.equal(harness.calls.activateUiOption[0].packageName, "FancyUI");
  assert.equal(harness.calls.activateUiOption[0].optionPath, "Options/Alt/Red");
  assert.deepEqual(Array.from(harness.calls.activateUiOption[0].iniPaths), ["C:\\EQ\\UI_Test_CW.ini"]);
});

test("apply confirmation omits UISkin copy when the selected targets already use that package", async () => {
  const harness = await createRendererHarness({
    gameDirectory: "C:\\EQ",
    uiManagerOverview: {
      ...createUiManagerOverviewResponse(),
      targets: [
        {
          path: "C:\\EQ\\UI_Test_CW.ini",
          fileName: "UI_Test_CW.ini",
          characterName: "Test",
          serverName: "CW",
          uiSkin: "FancyUI"
        }
      ]
    }
  });

  await harness.elements.uiManagerTabButton.dispatch("click");
  await flushAsyncWork();
  await harness.elements.openUiManagerButton.dispatch("click");
  await flushAsyncWork();

  const redOptionCard = harness.elements.uiManagerOptionList.children[2];
  const redOptionCheckbox = redOptionCard.children[0].children[2].children[0];
  redOptionCheckbox.checked = true;
  redOptionCheckbox.closest = (selector) => selector === "input[data-option-toggle='true']" ? redOptionCheckbox : null;
  await harness.elements.uiManagerOptionList.dispatch("change", {
    target: redOptionCheckbox
  });
  await flushAsyncWork();

  await harness.elements.uiManagerApplyOptionButton.dispatch("click");
  await flushAsyncWork();

  const confirmMessage = harness.document.getElementById("uiManagerConfirmMessage").textContent;
  assert.match(confirmMessage, /Apply 1 component change/);
  assert.doesNotMatch(confirmMessage, /UISkin=FancyUI/);
});

test("clicking a competing UI component variant only updates the review selection", async () => {
  const harness = await createRendererHarness({
    gameDirectory: "C:\\EQ"
  });

  await harness.elements.uiManagerTabButton.dispatch("click");
  await flushAsyncWork();
  await harness.elements.openUiManagerButton.dispatch("click");
  await flushAsyncWork();

  const redOptionCard = harness.elements.uiManagerOptionList.children[2];
  redOptionCard.closest = (selector) => selector === "[data-option-path]" ? redOptionCard : null;
  await harness.elements.uiManagerOptionList.dispatch("click", {
    target: redOptionCard
  });
  await flushAsyncWork();

  await harness.elements.uiManagerApplyOptionButton.dispatch("click");
  await flushAsyncWork();

  assert.equal(harness.elements.uiManagerConfirmModal.classList.contains("hidden"), true);
  assert.equal(harness.calls.activateUiOption.length, 0);
  assert.equal(harness.elements.uiManagerOptionList.children[2].classList.contains("is-selected"), true);
});

test("checking a competing UI component variant replaces the flagged bundle for apply", async () => {
  const harness = await createRendererHarness({
    gameDirectory: "C:\\EQ"
  });

  await harness.elements.uiManagerTabButton.dispatch("click");
  await flushAsyncWork();
  await harness.elements.openUiManagerButton.dispatch("click");
  await flushAsyncWork();

  const redOptionCard = harness.elements.uiManagerOptionList.children[2];
  const redOptionCheckbox = redOptionCard.children[0].children[2].children[0];
  redOptionCheckbox.checked = true;
  redOptionCheckbox.closest = (selector) => selector === "input[data-option-toggle='true']" ? redOptionCheckbox : null;
  await harness.elements.uiManagerOptionList.dispatch("change", {
    target: redOptionCheckbox
  });
  await flushAsyncWork();

  await harness.elements.uiManagerApplyOptionButton.dispatch("click");
  await flushAsyncWork();
  await harness.elements.uiManagerConfirmAcceptButton.dispatch("click");
  await flushAsyncWork();

  assert.equal(harness.calls.activateUiOption.length, 1);
  assert.equal(harness.calls.activateUiOption[0].optionPath, "Options/Alt/Red");
});

test("pending component changes are cleared when a UISkin/package switch becomes the pending action", async () => {
  const harness = await createRendererHarness({
    gameDirectory: "C:\\EQ",
    uiManagerOverview: {
      ...createUiManagerOverviewResponse(),
      targets: [
        {
          path: "C:\\EQ\\UI_Test_CW.ini",
          fileName: "UI_Test_CW.ini",
          characterName: "Test",
          serverName: "CW",
          uiSkin: "FancyUI"
        },
        {
          path: "C:\\EQ\\UI_Alt_CW.ini",
          fileName: "UI_Alt_CW.ini",
          characterName: "Alt",
          serverName: "CW",
          uiSkin: "OtherUI"
        }
      ]
    }
  });

  await harness.elements.uiManagerTabButton.dispatch("click");
  await flushAsyncWork();
  await harness.elements.openUiManagerButton.dispatch("click");
  await flushAsyncWork();

  const redOptionCard = harness.elements.uiManagerOptionList.children[2];
  const redOptionCheckbox = redOptionCard.children[0].children[2].children[0];
  redOptionCheckbox.checked = true;
  redOptionCheckbox.closest = (selector) => selector === "input[data-option-toggle='true']" ? redOptionCheckbox : null;
  await harness.elements.uiManagerOptionList.dispatch("change", {
    target: redOptionCheckbox
  });
  await flushAsyncWork();

  const secondTargetCheckbox = harness.elements.uiManagerTargetList.children[1].children[0];
  secondTargetCheckbox.checked = true;
  await harness.elements.uiManagerTargetList.dispatch("change", {
    target: secondTargetCheckbox
  });
  await flushAsyncWork();

  const confirmStageButton = harness.document.getElementById("uiManagerStageConfirmButton");
  confirmStageButton.dataset.uiManagerStage = "confirm";
  await harness.elements.uiManagerStageTabs.dispatch("click", {
    target: {
      closest(selector) {
        return selector === "button[data-ui-manager-stage]" ? confirmStageButton : null;
      }
    }
  });
  await flushAsyncWork();

  assert.equal(harness.elements.uiManagerApplyOptionButton.disabled, false);
});

test("apply handles pure UISkin/package changes without component diffs", async () => {
  const harness = await createRendererHarness({
    gameDirectory: "C:\\EQ",
    uiManagerOverview: {
      ...createUiManagerOverviewResponse(),
      targets: [
        {
          path: "C:\\EQ\\UI_Test_CW.ini",
          fileName: "UI_Test_CW.ini",
          characterName: "Test",
          serverName: "CW",
          uiSkin: "OtherUI"
        }
      ]
    }
  });

  await harness.elements.uiManagerTabButton.dispatch("click");
  await flushAsyncWork();
  await harness.elements.openUiManagerButton.dispatch("click");
  await flushAsyncWork();

  const targetInput = harness.elements.uiManagerTargetList.children[0].children[0];
  targetInput.checked = true;
  await harness.elements.uiManagerTargetList.dispatch("change", {
    target: targetInput
  });
  await flushAsyncWork();

  const confirmStageButton = harness.document.getElementById("uiManagerStageConfirmButton");
  confirmStageButton.dataset.uiManagerStage = "confirm";
  await harness.elements.uiManagerStageTabs.dispatch("click", {
    target: {
      closest(selector) {
        return selector === "button[data-ui-manager-stage]" ? confirmStageButton : null;
      }
    }
  });
  await flushAsyncWork();

  await harness.elements.uiManagerApplyOptionButton.dispatch("click");
  await flushAsyncWork();
  await harness.elements.uiManagerConfirmAcceptButton.dispatch("click");
  await flushAsyncWork();

  assert.equal(
    JSON.stringify(harness.calls.setUiSkinTargets),
    JSON.stringify([
      {
        packageName: "FancyUI",
        iniPaths: ["C:\\EQ\\UI_Test_CW.ini"]
      }
    ])
  );
  assert.equal(harness.calls.activateUiOption.length, 0);
});

test("switching UI packages with pending component changes requires confirmation", async () => {
  const harness = await createRendererHarness({
    gameDirectory: "C:\\EQ",
    uiManagerOverview: {
      ...createUiManagerOverviewResponse(),
      packages: [
        {
          name: "FancyUI",
          path: "C:\\EQ\\uifiles\\FancyUI",
          protected: false,
          prepared: true,
          optionCount: 2,
          rootXmlCount: 3
        },
        {
          name: "OtherUI",
          path: "C:\\EQ\\uifiles\\OtherUI",
          protected: false,
          prepared: true,
          optionCount: 1,
          rootXmlCount: 2
        }
      ],
      targets: [
        {
          path: "C:\\EQ\\UI_Test_CW.ini",
          fileName: "UI_Test_CW.ini",
          characterName: "Test",
          serverName: "CW",
          uiSkin: "FancyUI"
        }
      ]
    }
  });

  await harness.elements.uiManagerTabButton.dispatch("click");
  await flushAsyncWork();
  await harness.elements.openUiManagerButton.dispatch("click");
  await flushAsyncWork();

  const redOptionCard = harness.elements.uiManagerOptionList.children[2];
  const redOptionCheckbox = redOptionCard.children[0].children[2].children[0];
  redOptionCheckbox.checked = true;
  redOptionCheckbox.closest = (selector) => selector === "input[data-option-toggle='true']" ? redOptionCheckbox : null;
  await harness.elements.uiManagerOptionList.dispatch("change", {
    target: redOptionCheckbox
  });
  await flushAsyncWork();

  const otherPackageCard = harness.elements.uiManagerPackageList.children[1];
  otherPackageCard.dataset.packageName = "OtherUI";
  await harness.elements.uiManagerPackageList.dispatch("click", {
    target: {
      closest(selector) {
        return selector === "button[data-package-name]" ? otherPackageCard : null;
      }
    }
  });
  await flushAsyncWork();

  assert.equal(harness.elements.uiManagerConfirmModal.classList.contains("hidden"), false);
  assert.match(harness.document.getElementById("uiManagerConfirmMessage").textContent, /pending component changes.*will be lost/i);

  await harness.elements.uiManagerConfirmAcceptButton.dispatch("click");
  await flushAsyncWork();

  assert.equal(harness.calls.getUiPackageDetails.at(-1), "OtherUI");
});

test("confirming Reset UI routes through the reset backend action", async () => {
  const harness = await createRendererHarness({
    gameDirectory: "C:\\EQ"
  });

  await harness.elements.uiManagerTabButton.dispatch("click");
  await flushAsyncWork();
  await harness.elements.uiManagerResetButton.dispatch("click");
  await flushAsyncWork();
  await harness.elements.uiManagerConfirmAcceptButton.dispatch("click");
  await flushAsyncWork();

  assert.deepEqual(harness.calls.resetUiPackage, ["FancyUI"]);
});

test("validating UI Meta Data routes through the backend package action", async () => {
  const harness = await createRendererHarness({
    gameDirectory: "C:\\EQ"
  });

  await harness.elements.uiManagerTabButton.dispatch("click");
  await flushAsyncWork();
  await harness.elements.openUiManagerButton.dispatch("click");
  await flushAsyncWork();
  await harness.elements.uiManagerStagePackagesButton.dispatch("click");
  await flushAsyncWork();
  await harness.elements.uiManagerPackageList.dispatch("contextmenu", {
    clientX: 120,
    clientY: 180,
    target: {
      closest(selector) {
        return selector === "button[data-package-name]" ? harness.elements.uiManagerPackageList.children[0] : null;
      }
    },
    preventDefault() {}
  });
  await flushAsyncWork();
  const validateAction = harness.document.getElementById("uiManagerPackageValidateAction");
  validateAction.dataset.uiManagerPackageContextAction = "validate-comments";
  await harness.document.getElementById("uiManagerPackageContextMenu").dispatch("click", {
    target: {
      closest(selector) {
        return selector === "button[data-ui-manager-package-context-action]" ? validateAction : null;
      }
    }
  });
  await harness.elements.uiManagerConfirmAcceptButton.dispatch("click");
  await flushAsyncWork();

  assert.deepEqual(harness.calls.validateUiPackageOptionComments, ["FancyUI"]);
  assert.match(harness.elements.uiManagerNotice.textContent, /Validated UI Meta Data for 2 option XML file\(s\); corrected 1\./);
});
