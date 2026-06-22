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
const INDEX_SOURCE = fs.readFileSync(path.join(__dirname, "..", "src", "electron", "renderer", "index.html"), "utf8");
const STYLE_SOURCE = fs.readFileSync(path.join(__dirname, "..", "src", "electron", "renderer", "styles.css"), "utf8");
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
    this.alt = "";
    this.textContent = "";
    this.innerHTML = "";
    this.className = "";
    this.scrollTop = 0;
    this.clientHeight = 0;
    this.offsetWidth = 0;
    this.offsetHeight = 0;
    this.boundingClientRect = {
      left: 0,
      top: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0
    };
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name === "href") {
      this.href = String(value);
    }
    if (name === "src") {
      this.src = String(value);
    }
    if (name === "alt") {
      this.alt = String(value);
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
      button: overrides.button,
      clientX: overrides.clientX,
      clientY: overrides.clientY,
      preventDefault: typeof overrides.preventDefault === "function" ? overrides.preventDefault : function preventDefault() {},
      stopPropagation: typeof overrides.stopPropagation === "function" ? overrides.stopPropagation : function stopPropagation() {}
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
    return node === this || this.children.some((child) => (
      child === node ||
      (child && typeof child.contains === "function" && child.contains(node))
    ));
  }

  closest(_selector) {
    return null;
  }

  querySelectorAll(_selector) {
    return [];
  }

  getBoundingClientRect() {
    return this.boundingClientRect;
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

  querySelectorAll(_selector) {
    return [];
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
      preventDefault: typeof overrides.preventDefault === "function" ? overrides.preventDefault : function preventDefault() {},
      stopPropagation: typeof overrides.stopPropagation === "function" ? overrides.stopPropagation : function stopPropagation() {}
    };

    for (const listener of listeners) {
      await listener(event);
    }
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
    gameServerHost: "",
    gameServerPort: 0,
    gameServerStatus: {
      state: "unconfigured",
      label: "Not configured",
      detail: "Set gameServerHost in launcher-config.yml.",
      host: "",
      port: 0,
      checkedAt: "",
      latencyMs: 0,
      error: ""
    },
    loginServerHost: "",
    loginServerPort: 0,
    loginServerStatus: {
      state: "unconfigured",
      label: "Not configured",
      detail: "Read from eqhost.txt after selecting a game directory.",
      host: "",
      port: 0,
      checkedAt: "",
      latencyMs: 0,
      error: "",
      role: "",
      selectionMode: "auto",
      failoverActive: false,
      primaryError: "",
      backupError: ""
    },
    loginServerSelectionMode: "auto",
    loginServerActiveRole: "",
    loginServerFailoverActive: false,
    loginServerOptions: {
      primary: {
        host: "",
        port: 0
      },
      backup: {
        host: "",
        port: 0
      }
    },
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
    autoLogin: false,
    autoLoginEnterWorld: false,
    onGameLaunch: "minimize",
    autoLoginAvailable: true,
    autoLoginProfiles: [],
    selectedAutoLoginProfileId: "",
    selectedAutoLoginProfileIds: [],
    isAutoLoginRunning: false,
    autoLoginStatus: {
      state: "idle",
      label: "Ready",
      detail: "Account profile launch is ready."
    },
    gameDirectory: options.gameDirectory || "",
    reportUrl: "",
    prerequisiteDirectXUrl: "",
    prerequisiteVcUrl: "",
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

function getUiManagerOptionCard(harness, optionPath) {
  return harness.elements.uiManagerOptionList.children.find(
    (child) => child && typeof child === "object" && child.dataset?.optionPath === optionPath
  ) || null;
}

function getUiManagerOptionToggle(card) {
  return card?.children?.[0]?.children?.[2]?.children?.[0] || null;
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
    refreshServerStatus: 0,
    setActiveLoginServer: [],
    checkForLauncherUpdate: 0,
    openExternal: [],
    getUiManagerOverview: 0,
    openUiManagerImportDialog: 0,
    getUiPackageDetails: [],
    prepareUiPackage: [],
    checkUiPackageMetadata: [],
    validateUiPackageOptionComments: [],
    activateUiOption: [],
    setUiSkinTargets: [],
    resetUiPackage: [],
    restoreUiManagerBackup: [],
    importUiPackageFolder: [],
    startPatch: 0,
    launchGame: 0,
    selectAutoLoginProfile: [],
    setAutoLoginProfileSelection: [],
    reorderAutoLoginProfiles: [],
    saveAutoLoginProfile: [],
    deleteAutoLoginProfile: [],
    launchAutoLoginProfile: [],
    launchAutoLoginProfiles: [],
    updateSettings: [],
    minimizeWindow: 0,
    toggleMaximizeWindow: 0,
    closeWindow: 0
  };
  const intervals = [];
  const fakeSetInterval = (callback, milliseconds) => {
    const id = intervals.length + 1;
    intervals.push({
      id,
      callback,
      milliseconds,
      cleared: false
    });
    return id;
  };
  const fakeClearInterval = (id) => {
    const interval = intervals.find((candidate) => candidate.id === id);
    if (interval) {
      interval.cleared = true;
    }
  };
  let uiManagerOverview = options.uiManagerOverview || createUiManagerOverviewResponse();
  let uiManagerDetail = options.uiManagerDetail || createUiManagerDetailResponse();

  const launcherState = createLauncherState(options.includePatchNotesUrl === false ? "" : patchNotesUrl, options);
  const launcher = {
    async initialize() {
      return launcherState;
    },
    async getVersion() {
      return "2.1.0";
    },
    async getPatchNotes(requestOptions = {}) {
      calls.getPatchNotes.push({ ...requestOptions });
      return requestOptions.forceRefresh ? refreshedNotes : initialNotes;
    },
    async refreshState() {
      calls.refreshState += 1;
      return launcherState;
    },
    async refreshServerStatus() {
      calls.refreshServerStatus += 1;
      if (options.polledServerStatusState) {
        Object.assign(launcherState, options.polledServerStatusState);
      }
      return launcherState;
    },
    async setActiveLoginServer(requestOptions = {}) {
      calls.setActiveLoginServer.push({ ...requestOptions });
      if (requestOptions.role === "auto") {
        Object.assign(launcherState, {
          loginServerSelectionMode: "auto",
          loginServerActiveRole: "primary",
          loginServerFailoverActive: false
        });
        if (launcherState.loginServerStatus) {
          launcherState.loginServerStatus = {
            ...launcherState.loginServerStatus,
            role: "primary",
            selectionMode: "auto",
            failoverActive: false
          };
        }
        return launcherState;
      }

      const role = requestOptions.role === "backup" ? "backup" : "primary";
      Object.assign(launcherState, {
        loginServerSelectionMode: "manual",
        loginServerActiveRole: role,
        loginServerFailoverActive: false
      });
      if (launcherState.loginServerStatus) {
        launcherState.loginServerStatus = {
          ...launcherState.loginServerStatus,
          role,
          selectionMode: "manual",
          failoverActive: false
        };
      }
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
      calls.startPatch += 1;
      return launcherState;
    },
    async cancelPatch() {
      return launcherState;
    },
    async launchGame() {
      calls.launchGame += 1;
      return launcherState;
    },
    async getAutoLoginProfiles() {
      return launcherState;
    },
    async selectAutoLoginProfile(requestOptions = {}) {
      calls.selectAutoLoginProfile.push({ ...requestOptions });
      launcherState.selectedAutoLoginProfileId = requestOptions.id || "";
      return launcherState;
    },
    async setAutoLoginProfileSelection(requestOptions = {}) {
      const requestedIds = Array.isArray(requestOptions.ids) ? [...requestOptions.ids] : [];
      calls.setAutoLoginProfileSelection.push({
        activeId: requestOptions.activeId || "",
        ids: requestedIds
      });
      const validIds = new Set(launcherState.autoLoginProfiles.map((profile) => profile.id));
      launcherState.selectedAutoLoginProfileIds = (Array.isArray(requestOptions.ids) ? requestOptions.ids : [])
        .filter((id) => validIds.has(id));
      launcherState.selectedAutoLoginProfileId = validIds.has(requestOptions.activeId)
        ? requestOptions.activeId
        : launcherState.selectedAutoLoginProfileIds[0] || "";
      return launcherState;
    },
    async reorderAutoLoginProfiles(requestOptions = {}) {
      const requestedIds = Array.isArray(requestOptions.ids) ? [...requestOptions.ids] : [];
      calls.reorderAutoLoginProfiles.push({ ids: requestedIds });
      const profileById = new Map(launcherState.autoLoginProfiles.map((profile) => [profile.id, profile]));
      const requestedSet = new Set(requestedIds);
      launcherState.autoLoginProfiles = [
        ...requestedIds.map((id) => profileById.get(id)).filter(Boolean),
        ...launcherState.autoLoginProfiles.filter((profile) => !requestedSet.has(profile.id))
      ];
      return launcherState;
    },
    async saveAutoLoginProfile(requestOptions = {}) {
      calls.saveAutoLoginProfile.push({ ...requestOptions });
      const id = requestOptions.id || `profile-${calls.saveAutoLoginProfile.length}`;
      const existingIndex = launcherState.autoLoginProfiles.findIndex((profile) => profile.id === id);
      if (requestOptions.isDefault === true) {
        launcherState.autoLoginProfiles = launcherState.autoLoginProfiles.map((profile) => ({
          ...profile,
          isDefault: false
        }));
      }
      const profile = {
        id,
        label: requestOptions.label || requestOptions.username || "Profile",
        username: requestOptions.username || "",
        isDefault: requestOptions.isDefault === true || launcherState.autoLoginProfiles.length === 0,
        createdAt: "2026-06-21T00:00:00.000Z",
        updatedAt: "2026-06-21T00:00:00.000Z"
      };
      if (existingIndex >= 0) {
        launcherState.autoLoginProfiles.splice(existingIndex, 1, profile);
      } else {
        launcherState.autoLoginProfiles.push(profile);
      }
      launcherState.selectedAutoLoginProfileId = id;
      return launcherState;
    },
    async deleteAutoLoginProfile(requestOptions = {}) {
      calls.deleteAutoLoginProfile.push({ ...requestOptions });
      launcherState.autoLoginProfiles = launcherState.autoLoginProfiles.filter((profile) => profile.id !== requestOptions.id);
      launcherState.selectedAutoLoginProfileId = launcherState.autoLoginProfiles[0]?.id || "";
      launcherState.autoLogin = launcherState.autoLogin && launcherState.autoLoginProfiles.length > 0;
      return launcherState;
    },
    async launchAutoLoginProfile(requestOptions = {}) {
      calls.launchAutoLoginProfile.push({ ...requestOptions });
      return launcherState;
    },
    async launchAutoLoginProfiles(requestOptions = {}) {
      calls.launchAutoLoginProfiles.push({ ...requestOptions });
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
    async toggleMaximizeWindow() {
      calls.toggleMaximizeWindow += 1;
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
      calls.openUiManagerImportDialog += 1;
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
      PatchNotesState: require("../src/electron/renderer/patch-notes-state"),
      innerWidth: options.viewportWidth || 1280,
      innerHeight: options.viewportHeight || 720
    },
    document,
    NodeFilter: {
      SHOW_TEXT: 4
    },
    setTimeout,
    clearTimeout,
    setInterval: fakeSetInterval,
    clearInterval: fakeClearInterval,
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
  document.getElementById("autoLoginModal").classList.add("hidden");
  document.getElementById("uiManagerModal").classList.add("hidden");
  document.getElementById("uiManagerConfirmModal").classList.add("hidden");
  document.getElementById("toolsMenu").classList.add("hidden");
  document.getElementById("loginServerContextMenu").classList.add("hidden");
  document.getElementById("autoLoginPopover").classList.add("hidden");
  document.getElementById("launcherUpdatePanel").classList.add("hidden");

  vm.runInNewContext(APP_SOURCE, context, {
    filename: "renderer-app.js"
  });

  await flushAsyncWork();

  return {
    calls,
    document,
    intervals,
    async runInterval(index = 0) {
      const interval = intervals[index];
      assert.ok(interval, `Expected interval ${index} to be registered`);
      await interval.callback();
      await flushAsyncWork();
    },
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
      uiManagerRefreshButton: document.getElementById("uiManagerRefreshButton"),
      uiManagerRecoveryButton: document.getElementById("uiManagerRecoveryButton"),
      uiManagerRecoveryStats: document.getElementById("uiManagerRecoveryStats"),
      uiManagerBackupList: document.getElementById("uiManagerBackupList"),
      uiManagerImportButton: document.getElementById("uiManagerImportButton"),
      uiManagerModalRefreshButton: document.getElementById("uiManagerModalRefreshButton"),
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
      actionsRow: document.getElementById("actionsRow"),
      patchButton: document.getElementById("patchButton"),
      launchButton: document.getElementById("launchButton"),
      manualPrerequisitesButton: document.getElementById("manualPrerequisitesButton"),
      serverValue: document.getElementById("serverValue"),
      gameServerStatusBadge: document.getElementById("gameServerStatusBadge"),
      gameServerStatusLabel: document.getElementById("gameServerStatusLabel"),
      gameServerStatusRefreshButton: document.getElementById("gameServerStatusRefreshButton"),
      gameServerStatusDetail: document.getElementById("gameServerStatusDetail"),
      loginServerSummaryItem: document.getElementById("loginServerSummaryItem"),
      loginServerValue: document.getElementById("loginServerValue"),
      loginServerStatusBadge: document.getElementById("loginServerStatusBadge"),
      loginServerStatusLabel: document.getElementById("loginServerStatusLabel"),
      loginServerStatusRefreshButton: document.getElementById("loginServerStatusRefreshButton"),
      loginServerStatusDetail: document.getElementById("loginServerStatusDetail"),
      loginServerContextMenu: document.getElementById("loginServerContextMenu"),
      loginServerUseAutoAction: document.getElementById("loginServerUseAutoAction"),
      loginServerUsePrimaryAction: document.getElementById("loginServerUsePrimaryAction"),
      loginServerUseBackupAction: document.getElementById("loginServerUseBackupAction"),
      taglineValue: document.getElementById("taglineValue"),
      heroBackgroundImage: document.getElementById("heroBackgroundImage"),
      heroWordmark: document.getElementById("heroWordmark"),
      heroWordmarkImage: document.getElementById("heroWordmarkImage"),
      heroEmblemText: document.getElementById("heroEmblemText"),
      websiteLink: document.getElementById("websiteLink"),
      toolsButton: document.getElementById("toolsButton"),
      toolsMenu: document.getElementById("toolsMenu"),
      discordButton: document.getElementById("discordButton"),
      onGameLaunchSelect: document.getElementById("onGameLaunchSelect"),
      patchNotesPromptModal: document.getElementById("patchNotesPromptModal"),
      patchNotesPromptLaterButton: document.getElementById("patchNotesPromptLaterButton"),
      patchNotesPromptViewButton: document.getElementById("patchNotesPromptViewButton"),
      launcherUpdateModal: document.getElementById("launcherUpdateModal"),
      launcherUpdateLaterButton: document.getElementById("launcherUpdateLaterButton"),
      launcherUpdateReleaseNotes: document.getElementById("launcherUpdateReleaseNotes"),
      autoLoginMenuButton: document.getElementById("autoLoginMenuButton"),
      autoLoginPopover: document.getElementById("autoLoginPopover"),
      autoLoginProfileSelect: document.getElementById("autoLoginProfileSelect"),
      autoLoginProfileList: document.getElementById("autoLoginProfileList"),
      autoLoginSelectAllButton: document.getElementById("autoLoginSelectAllButton"),
      autoLoginSelectNoneButton: document.getElementById("autoLoginSelectNoneButton"),
      autoLoginEnterWorldInput: document.getElementById("autoLoginEnterWorldInput"),
      autoLoginManageButton: document.getElementById("autoLoginManageButton"),
      autoLoginModal: document.getElementById("autoLoginModal"),
      autoLoginManageProfileSelect: document.getElementById("autoLoginManageProfileSelect"),
      autoLoginLabelInput: document.getElementById("autoLoginLabelInput"),
      autoLoginUsernameInput: document.getElementById("autoLoginUsernameInput"),
      autoLoginPasswordInput: document.getElementById("autoLoginPasswordInput"),
      autoLoginDefaultInput: document.getElementById("autoLoginDefaultInput"),
      autoLoginSaveButton: document.getElementById("autoLoginSaveButton"),
      autoLoginDeleteButton: document.getElementById("autoLoginDeleteButton"),
      autoLoginLaunchButton: document.getElementById("autoLoginLaunchButton"),
      autoLoginToggle: document.getElementById("autoLoginToggle"),
      autoLoginStatusText: document.getElementById("autoLoginStatusText")
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

test("launch-ready state keeps Verify Integrity visible alongside Launch Ready", async () => {
  const harness = await createRendererHarness({
    gameDirectory: "C:\\EQ",
    clientVersion: "Rain_Of_Fear_2_4GB",
    clientLabel: "Rain of Fear 2 (4GB)",
    clientSupported: true,
    statusBadge: "Ready",
    statusDetail: "Manifest and local patch version are aligned.",
    manifestVersion: "3.0.0",
    needsPatch: false,
    canPatch: true,
    canLaunch: true
  });

  assert.equal(harness.elements.patchButton.classList.contains("hidden"), false);
  assert.equal(harness.elements.launchButton.classList.contains("hidden"), false);
  assert.equal(harness.elements.actionsRow.classList.contains("single-action"), false);
  assert.equal(harness.elements.patchButton.textContent, "Verify Integrity");
  assert.equal(harness.elements.launchButton.textContent, "Launch Ready");
});

test("clicking Verify Integrity in the ready state reuses the existing verification flow", async () => {
  const harness = await createRendererHarness({
    gameDirectory: "C:\\EQ",
    clientVersion: "Rain_Of_Fear_2_4GB",
    clientLabel: "Rain of Fear 2 (4GB)",
    clientSupported: true,
    statusBadge: "Ready",
    statusDetail: "Manifest and local patch version are aligned.",
    manifestVersion: "3.0.0",
    needsPatch: false,
    canPatch: true,
    canLaunch: true
  });

  await harness.elements.patchButton.dispatch("click");
  await flushAsyncWork();

  assert.equal(harness.calls.startPatch, 1);
});

test("renderer launches the selected auto-login profile through the profile bridge", async () => {
  const harness = await createRendererHarness({
    gameDirectory: "C:\\EQ",
    clientVersion: "Rain_Of_Fear_2_4GB",
    clientLabel: "Rain of Fear 2 (4GB)",
    clientSupported: true,
    statusBadge: "Ready",
    statusDetail: "Manifest and local patch version are aligned.",
    manifestVersion: "3.0.0",
    needsPatch: false,
    canPatch: true,
    canLaunch: true,
    autoLoginProfiles: [{
      id: "profile-1",
      label: "Vayle Box",
      username: "vayle2",
      createdAt: "2026-06-21T00:00:00.000Z",
      updatedAt: "2026-06-21T00:00:00.000Z"
    }],
    selectedAutoLoginProfileId: "profile-1"
  });

  await harness.elements.autoLoginLaunchButton.dispatch("click");
  await flushAsyncWork();

  assert.deepEqual(harness.calls.launchAutoLoginProfile, [{ id: "profile-1" }]);
  assert.equal(harness.calls.launchGame, 0);
});

test("renderer batch launches checked auto-login profiles in profile order", async () => {
  const harness = await createRendererHarness({
    gameDirectory: "C:\\EQ",
    clientVersion: "Rain_Of_Fear_2_4GB",
    clientLabel: "Rain of Fear 2 (4GB)",
    clientSupported: true,
    statusBadge: "Ready",
    statusDetail: "Manifest and local patch version are aligned.",
    manifestVersion: "3.0.0",
    needsPatch: false,
    canPatch: true,
    canLaunch: true,
    autoLoginProfiles: [{
      id: "profile-1",
      label: "Druid",
      username: "vayle04",
      isDefault: true,
      createdAt: "2026-06-21T00:00:00.000Z",
      updatedAt: "2026-06-21T00:00:00.000Z"
    }, {
      id: "profile-2",
      label: "Cleric",
      username: "bgondaway",
      createdAt: "2026-06-21T00:00:00.000Z",
      updatedAt: "2026-06-21T00:00:00.000Z"
    }, {
      id: "profile-3",
      label: "Bard",
      username: "vayle3",
      createdAt: "2026-06-21T00:00:00.000Z",
      updatedAt: "2026-06-21T00:00:00.000Z"
    }],
    selectedAutoLoginProfileId: "profile-1"
  });

  const firstProfileMeta = harness.elements.autoLoginProfileList.children[0].children[1];
  assert.equal(firstProfileMeta.className, "auto-login-profile-meta");
  assert.equal(firstProfileMeta.children[0].textContent, "Druid");
  assert.equal(firstProfileMeta.children[1].textContent, "vayle04");

  await harness.elements.autoLoginSelectAllButton.dispatch("click");
  await flushAsyncWork();
  assert.equal(harness.elements.autoLoginLaunchButton.textContent, "Launch 3 Profiles");

  await harness.elements.autoLoginLaunchButton.dispatch("click");
  await flushAsyncWork();

  assert.deepEqual(harness.calls.launchAutoLoginProfiles, [{
    ids: ["profile-1", "profile-2", "profile-3"]
  }]);
  assert.deepEqual(harness.calls.launchAutoLoginProfile, []);
});

test("renderer primary launch uses checked profiles when auto-login is enabled", async () => {
  const harness = await createRendererHarness({
    gameDirectory: "C:\\EQ",
    clientVersion: "Rain_Of_Fear_2_4GB",
    clientLabel: "Rain of Fear 2 (4GB)",
    clientSupported: true,
    statusBadge: "Ready",
    statusDetail: "Manifest and local patch version are aligned.",
    manifestVersion: "3.0.0",
    needsPatch: false,
    canPatch: true,
    canLaunch: true,
    autoLogin: true,
    autoLoginProfiles: [{
      id: "profile-1",
      label: "Druid",
      username: "vayle04",
      isDefault: true,
      createdAt: "2026-06-21T00:00:00.000Z",
      updatedAt: "2026-06-21T00:00:00.000Z"
    }, {
      id: "profile-2",
      label: "Cleric",
      username: "bgondaway",
      createdAt: "2026-06-21T00:00:00.000Z",
      updatedAt: "2026-06-21T00:00:00.000Z"
    }],
    selectedAutoLoginProfileId: "profile-1"
  });

  await harness.elements.autoLoginSelectAllButton.dispatch("click");
  await flushAsyncWork();
  assert.equal(harness.elements.launchButton.textContent, "Launch (2) Ready");
  await harness.elements.launchButton.dispatch("click");
  await flushAsyncWork();

  assert.deepEqual(harness.calls.launchAutoLoginProfiles, [{
    ids: ["profile-1", "profile-2"]
  }]);
  assert.equal(harness.calls.launchGame, 0);
});

test("renderer can opt auto-login into pressing Play EverQuest", async () => {
  const harness = await createRendererHarness({
    gameDirectory: "C:\\EQ",
    clientVersion: "Rain_Of_Fear_2_4GB",
    clientLabel: "Rain of Fear 2 (4GB)",
    clientSupported: true,
    statusBadge: "Ready",
    statusDetail: "Manifest and local patch version are aligned.",
    manifestVersion: "3.0.0",
    needsPatch: false,
    canPatch: true,
    canLaunch: true,
    autoLogin: true,
    autoLoginProfiles: [{
      id: "profile-1",
      label: "Druid",
      username: "vayle04",
      isDefault: true,
      createdAt: "2026-06-21T00:00:00.000Z",
      updatedAt: "2026-06-21T00:00:00.000Z"
    }, {
      id: "profile-2",
      label: "Cleric",
      username: "bgondaway",
      createdAt: "2026-06-21T00:00:00.000Z",
      updatedAt: "2026-06-21T00:00:00.000Z"
    }],
    selectedAutoLoginProfileId: "profile-1",
    selectedAutoLoginProfileIds: ["profile-1", "profile-2"]
  });

  assert.equal(harness.elements.autoLoginEnterWorldInput.checked, false);
  harness.elements.autoLoginEnterWorldInput.checked = true;
  await harness.elements.autoLoginEnterWorldInput.dispatch("change");
  await flushAsyncWork();

  assert.deepEqual(harness.calls.updateSettings.at(-1), { autoLoginEnterWorld: true });
  assert.equal(harness.elements.autoLoginEnterWorldInput.checked, true);

  await harness.elements.launchButton.dispatch("click");
  await flushAsyncWork();

  assert.deepEqual(harness.calls.launchAutoLoginProfiles, [{
    ids: ["profile-1", "profile-2"],
    enterWorld: true
  }]);
  assert.equal(harness.calls.launchGame, 0);
});

test("renderer restores saved multi-profile auto-login selection", async () => {
  const harness = await createRendererHarness({
    gameDirectory: "C:\\EQ",
    clientVersion: "Rain_Of_Fear_2_4GB",
    clientLabel: "Rain of Fear 2 (4GB)",
    clientSupported: true,
    statusBadge: "Ready",
    statusDetail: "Manifest and local patch version are aligned.",
    manifestVersion: "3.0.0",
    needsPatch: false,
    canPatch: true,
    canLaunch: true,
    autoLogin: true,
    autoLoginProfiles: [{
      id: "profile-1",
      label: "Druid",
      username: "vayle04",
      isDefault: true,
      createdAt: "2026-06-21T00:00:00.000Z",
      updatedAt: "2026-06-21T00:00:00.000Z"
    }, {
      id: "profile-2",
      label: "Cleric",
      username: "bgondaway",
      createdAt: "2026-06-21T00:00:00.000Z",
      updatedAt: "2026-06-21T00:00:00.000Z"
    }, {
      id: "profile-3",
      label: "Bard",
      username: "vayle3",
      createdAt: "2026-06-21T00:00:00.000Z",
      updatedAt: "2026-06-21T00:00:00.000Z"
    }],
    selectedAutoLoginProfileId: "profile-3",
    selectedAutoLoginProfileIds: ["profile-1", "profile-3"]
  });

  assert.equal(harness.elements.launchButton.textContent, "Launch (2) Ready");
  assert.equal(harness.elements.autoLoginProfileList.children[0].attributes["aria-checked"], "true");
  assert.equal(harness.elements.autoLoginProfileList.children[1].attributes["aria-checked"], "false");
  assert.equal(harness.elements.autoLoginProfileList.children[2].attributes["aria-checked"], "true");
});

test("renderer keeps account profile controls in a popover and management modal", async () => {
  const harness = await createRendererHarness({
    gameDirectory: "C:\\EQ",
    clientVersion: "Rain_Of_Fear_2_4GB",
    clientLabel: "Rain of Fear 2 (4GB)",
    clientSupported: true,
    statusBadge: "Ready",
    statusDetail: "Manifest and local patch version are aligned.",
    manifestVersion: "3.0.0",
    needsPatch: false,
    canPatch: true,
    canLaunch: true,
    autoLoginProfiles: [{
      id: "profile-1",
      label: "Vayle Box",
      username: "vayle2",
      createdAt: "2026-06-21T00:00:00.000Z",
      updatedAt: "2026-06-21T00:00:00.000Z"
    }],
    selectedAutoLoginProfileId: "profile-1"
  });

  assert.equal(harness.elements.autoLoginPopover.classList.contains("hidden"), true);
  assert.equal(harness.elements.autoLoginModal.classList.contains("hidden"), true);

  await harness.elements.autoLoginMenuButton.dispatch("click");
  assert.equal(harness.elements.autoLoginPopover.classList.contains("hidden"), false);
  assert.equal(harness.elements.autoLoginMenuButton.attributes["aria-expanded"], "true");

  await harness.elements.autoLoginMenuButton.dispatch("click");
  assert.equal(harness.elements.autoLoginPopover.classList.contains("hidden"), true);
  assert.equal(harness.elements.autoLoginMenuButton.attributes["aria-expanded"], "false");

  await harness.elements.autoLoginMenuButton.dispatch("click");
  await harness.elements.autoLoginManageButton.dispatch("click");
  assert.equal(harness.elements.autoLoginPopover.classList.contains("hidden"), true);
  assert.equal(harness.elements.autoLoginModal.classList.contains("hidden"), false);
  assert.equal(harness.elements.autoLoginModal.attributes["aria-hidden"], "false");
});

test("renderer anchors account profile popover above the Account button with CSS", async () => {
  assert.match(INDEX_SOURCE, /summary-item-server[\s\S]*?gameServerStatusBadge[\s\S]*?autoLoginPanel/);
  assert.doesNotMatch(INDEX_SOURCE, /toggle-row[\s\S]*?autoLoginPanel/);
  assert.doesNotMatch(INDEX_SOURCE, /<div id="autoLoginPanel"[^>]*>[\s\S]{0,600}<div id="autoLoginPopover"/);
  assert.match(INDEX_SOURCE, /loginServerContextMenu[\s\S]*?autoLoginPopover/);
  assert.match(INDEX_SOURCE, /autoLoginProfileList/);
  assert.match(INDEX_SOURCE, /autoLoginProfileSelect" class="auto-login-input auto-login-profile-select hidden"/);
  assert.match(INDEX_SOURCE, /autoLoginEnterWorldInput[\s\S]*?Press Play EverQuest/);
  assert.match(INDEX_SOURCE, /auto-login-popover-heading[\s\S]*?auto-login-popover-beta-badge/);
  assert.match(INDEX_SOURCE, /toggle auto-login-toggle-control[\s\S]*?auto-login-toggle-beta-badge/);
  assert.match(INDEX_SOURCE, /autoLoginSelectAllButton[\s\S]*?autoLoginSelectNoneButton/);
  assert.match(STYLE_SOURCE, /\.auto-login-panel\s*{[\s\S]*?position:\s*relative;/);
  assert.match(STYLE_SOURCE, /\.auto-login-popover\s*{[\s\S]*?position:\s*fixed;/);
  assert.match(STYLE_SOURCE, /\.auto-login-popover\s*{[\s\S]*?z-index:\s*2000;/);
  assert.match(STYLE_SOURCE, /body \.auto-login-popover\s*{[\s\S]*?width:\s*min\(40rem, calc\(100vw - 2rem\)\);/);
  assert.match(STYLE_SOURCE, /body \.auto-login-popover\s*{[\s\S]*?min-height:\s*min\(25rem, calc\(100vh - 2rem\)\);/);
  assert.match(STYLE_SOURCE, /\.auto-login-profile-field\s*{[\s\S]*?grid-template-rows:\s*auto minmax\(0, 1fr\);/);
  assert.match(STYLE_SOURCE, /\.auto-login-selection-action\s*{[\s\S]*?border-radius:\s*999px;/);
  assert.match(STYLE_SOURCE, /\.auto-login-profile-option\s*{[\s\S]*?grid-template-columns:\s*auto minmax\(0, 1fr\) auto;/);
  assert.match(STYLE_SOURCE, /\.auto-login-profile-meta\s*{[\s\S]*?display:\s*grid;/);
  assert.match(STYLE_SOURCE, /\.auto-login-profile-username\s*{[\s\S]*?text-transform:\s*uppercase;/);
  assert.match(STYLE_SOURCE, /\.auto-login-profile-move-controls\s*{[\s\S]*?display:\s*inline-flex;/);
  assert.match(STYLE_SOURCE, /\.auto-login-profile-move-button\s*{[\s\S]*?place-items:\s*center;/);
  assert.match(STYLE_SOURCE, /\.auto-login-profile-checkbox\s*{[\s\S]*?border-radius:\s*0\.22rem;/);
  assert.match(STYLE_SOURCE, /\.auto-login-enter-world-toggle\s*{[\s\S]*?grid-template-columns:\s*1\.05rem auto;/);
  assert.match(STYLE_SOURCE, /\.auto-login-enter-world-box\s*{[\s\S]*?border-radius:\s*0\.22rem;/);
  assert.match(STYLE_SOURCE, /\.auto-login-beta-badge\s*{[\s\S]*?border-radius:\s*999px;/);
  assert.match(STYLE_SOURCE, /\.auto-login-beta-badge\s*{[\s\S]*?rgba\(52, 95, 146, 0\.92\)/);
  assert.match(STYLE_SOURCE, /\.auto-login-beta-badge\s*{[\s\S]*?box-shadow:\s*none;/);
  assert.match(STYLE_SOURCE, /body \.toggle\.auto-login-toggle-control\s*{[\s\S]*?grid-template-columns:\s*50px auto auto;/);
  assert.match(STYLE_SOURCE, /\.auto-login-profile-list\s*{[\s\S]*?display:\s*grid;/);
  assert.match(STYLE_SOURCE, /body \.summary-stack \.summary-item\.summary-item-server\s*{[\s\S]*?z-index:\s*30;/);
  assert.match(STYLE_SOURCE, /body \.summary-status-layout \.auto-login-panel\s*{[\s\S]*?z-index:\s*31;/);
  assert.match(APP_SOURCE, /AUTO_LOGIN_POPOVER_ANCHOR_HEIGHT_PX = 228/);
  assert.match(APP_SOURCE, /positionAutoLoginPopover/);
});

test("renderer opens account profile popover at the Account button anchor", async () => {
  const harness = await createRendererHarness({
    viewportWidth: 500,
    viewportHeight: 500,
    gameDirectory: "C:\\EQ",
    clientVersion: "Rain_Of_Fear_2_4GB",
    clientLabel: "Rain of Fear 2 (4GB)",
    clientSupported: true,
    statusBadge: "Ready",
    manifestVersion: "3.0.0",
    needsPatch: false,
    canPatch: true,
    canLaunch: true,
    autoLoginProfiles: [{
      id: "profile-1",
      label: "Vayle Box",
      username: "vayle2",
      isDefault: true,
      createdAt: "2026-06-21T00:00:00.000Z",
      updatedAt: "2026-06-21T00:00:00.000Z"
    }],
    selectedAutoLoginProfileId: "profile-1"
  });
  harness.elements.autoLoginMenuButton.boundingClientRect = {
    left: 440,
    top: 300,
    right: 520,
    bottom: 332,
    width: 80,
    height: 32
  };
  harness.elements.autoLoginPopover.boundingClientRect = {
    left: 0,
    top: 0,
    right: 320,
    bottom: 220,
    width: 320,
    height: 220
  };

  await harness.elements.autoLoginMenuButton.dispatch("click");

  assert.equal(harness.elements.autoLoginPopover.classList.contains("hidden"), false);
  assert.equal(harness.elements.autoLoginPopover.style.left, "168px");
  assert.equal(harness.elements.autoLoginPopover.style.top, "80px");
});

test("renderer keeps the account popover top anchor when the panel grows", async () => {
  const harness = await createRendererHarness({
    viewportWidth: 1280,
    viewportHeight: 720,
    gameDirectory: "C:\\EQ",
    clientVersion: "Rain_Of_Fear_2_4GB",
    clientLabel: "Rain of Fear 2 (4GB)",
    clientSupported: true,
    statusBadge: "Ready",
    manifestVersion: "3.0.0",
    needsPatch: false,
    canPatch: true,
    canLaunch: true,
    autoLoginProfiles: [{
      id: "profile-1",
      label: "Vayle Box",
      username: "vayle2",
      isDefault: true,
      createdAt: "2026-06-21T00:00:00.000Z",
      updatedAt: "2026-06-21T00:00:00.000Z"
    }],
    selectedAutoLoginProfileId: "profile-1"
  });
  harness.elements.autoLoginMenuButton.boundingClientRect = {
    left: 440,
    top: 300,
    right: 520,
    bottom: 332,
    width: 80,
    height: 32
  };
  harness.elements.autoLoginPopover.boundingClientRect = {
    left: 0,
    top: 0,
    right: 640,
    bottom: 420,
    width: 640,
    height: 420
  };

  await harness.elements.autoLoginMenuButton.dispatch("click");

  assert.equal(harness.elements.autoLoginPopover.classList.contains("hidden"), false);
  assert.equal(harness.elements.autoLoginPopover.style.left, "520px");
  assert.equal(harness.elements.autoLoginPopover.style.top, "72px");
});

test("renderer keeps account profile popover open for clicks inside it", async () => {
  const harness = await createRendererHarness({
    gameDirectory: "C:\\EQ",
    clientVersion: "Rain_Of_Fear_2_4GB",
    clientLabel: "Rain of Fear 2 (4GB)",
    clientSupported: true,
    statusBadge: "Ready",
    manifestVersion: "3.0.0",
    needsPatch: false,
    canPatch: true,
    canLaunch: true,
    autoLoginProfiles: [{
      id: "profile-1",
      label: "Vayle Box",
      username: "vayle2",
      isDefault: true,
      createdAt: "2026-06-21T00:00:00.000Z",
      updatedAt: "2026-06-21T00:00:00.000Z"
    }],
    selectedAutoLoginProfileId: "profile-1"
  });
  let stopped = false;

  await harness.elements.autoLoginMenuButton.dispatch("click");
  await harness.elements.autoLoginPopover.dispatch("click", {
    stopPropagation: () => {
      stopped = true;
    }
  });
  await harness.document.dispatch("click", {
    target: harness.elements.autoLoginPopover
  });

  assert.equal(stopped, true);
  assert.equal(harness.elements.autoLoginPopover.classList.contains("hidden"), false);
});

test("renderer keeps account profile popover open when profile select retargets the final click", async () => {
  const harness = await createRendererHarness({
    gameDirectory: "C:\\EQ",
    clientVersion: "Rain_Of_Fear_2_4GB",
    clientLabel: "Rain of Fear 2 (4GB)",
    clientSupported: true,
    statusBadge: "Ready",
    manifestVersion: "3.0.0",
    needsPatch: false,
    canPatch: true,
    canLaunch: true,
    autoLoginProfiles: [{
      id: "profile-1",
      label: "Vayle Box",
      username: "vayle2",
      isDefault: true,
      createdAt: "2026-06-21T00:00:00.000Z",
      updatedAt: "2026-06-21T00:00:00.000Z"
    }],
    selectedAutoLoginProfileId: "profile-1"
  });
  const nativeSelectTarget = { id: "native-profile-option" };
  const outsideTarget = new FakeElement("outside");

  harness.elements.autoLoginPopover.appendChild(harness.elements.autoLoginProfileSelect);
  await harness.elements.autoLoginMenuButton.dispatch("click");
  await harness.document.dispatch("pointerdown", {
    target: harness.elements.autoLoginProfileSelect
  });
  await harness.document.dispatch("click", {
    target: nativeSelectTarget
  });

  assert.equal(harness.elements.autoLoginPopover.classList.contains("hidden"), false);

  await harness.document.dispatch("pointerdown", {
    target: outsideTarget
  });
  await harness.document.dispatch("click", {
    target: outsideTarget
  });

  assert.equal(harness.elements.autoLoginPopover.classList.contains("hidden"), true);
});

test("renderer selects account profile from inline popover list without closing it", async () => {
  const harness = await createRendererHarness({
    gameDirectory: "C:\\EQ",
    clientVersion: "Rain_Of_Fear_2_4GB",
    clientLabel: "Rain of Fear 2 (4GB)",
    clientSupported: true,
    statusBadge: "Ready",
    manifestVersion: "3.0.0",
    needsPatch: false,
    canPatch: true,
    canLaunch: true,
    autoLoginProfiles: [{
      id: "profile-1",
      label: "Druid",
      username: "vayle04",
      isDefault: true,
      createdAt: "2026-06-21T00:00:00.000Z",
      updatedAt: "2026-06-21T00:00:00.000Z"
    }, {
      id: "profile-2",
      label: "Cleric",
      username: "bgondaway",
      isDefault: false,
      createdAt: "2026-06-21T00:00:00.000Z",
      updatedAt: "2026-06-21T00:00:00.000Z"
    }],
    selectedAutoLoginProfileId: "profile-1"
  });
  const [, clericOption] = harness.elements.autoLoginProfileList.children;

  harness.elements.autoLoginPopover.appendChild(harness.elements.autoLoginProfileList);
  await harness.elements.autoLoginMenuButton.dispatch("click");
  await harness.elements.autoLoginProfileList.dispatch("click", {
    target: clericOption
  });
  await flushAsyncWork();
  const selectedClericOption = harness.elements.autoLoginProfileList.children[1];
  await harness.document.dispatch("pointerdown", {
    target: selectedClericOption
  });
  await harness.document.dispatch("click", {
    target: selectedClericOption
  });

  assert.deepEqual(harness.calls.selectAutoLoginProfile, []);
  assert.deepEqual(harness.calls.setAutoLoginProfileSelection, [{
    activeId: "profile-2",
    ids: ["profile-1", "profile-2"]
  }]);
  assert.equal(harness.elements.autoLoginProfileSelect.value, "profile-2");
  assert.equal(harness.elements.autoLoginPopover.classList.contains("hidden"), false);
  assert.equal(selectedClericOption.attributes["aria-selected"], "true");
});

test("renderer reorders account profiles from inline controls", async () => {
  const harness = await createRendererHarness({
    gameDirectory: "C:\\EQ",
    clientVersion: "Rain_Of_Fear_2_4GB",
    clientLabel: "Rain of Fear 2 (4GB)",
    clientSupported: true,
    statusBadge: "Ready",
    manifestVersion: "3.0.0",
    needsPatch: false,
    canPatch: true,
    canLaunch: true,
    autoLoginProfiles: [{
      id: "profile-1",
      label: "Druid",
      username: "vayle04",
      isDefault: true,
      createdAt: "2026-06-21T00:00:00.000Z",
      updatedAt: "2026-06-21T00:00:00.000Z"
    }, {
      id: "profile-2",
      label: "Cleric",
      username: "bgondaway",
      createdAt: "2026-06-21T00:00:00.000Z",
      updatedAt: "2026-06-21T00:00:00.000Z"
    }, {
      id: "profile-3",
      label: "Bard",
      username: "vayle3",
      createdAt: "2026-06-21T00:00:00.000Z",
      updatedAt: "2026-06-21T00:00:00.000Z"
    }],
    selectedAutoLoginProfileId: "profile-1"
  });
  const clericDownButton = harness.elements.autoLoginProfileList.children[1].children[2].children[0].children[1];

  await harness.elements.autoLoginProfileList.dispatch("click", {
    target: clericDownButton
  });
  await flushAsyncWork();

  assert.deepEqual(harness.calls.reorderAutoLoginProfiles, [{
    ids: ["profile-1", "profile-3", "profile-2"]
  }]);
  assert.equal(harness.elements.autoLoginProfileList.children[2].children[1].children[0].textContent, "Cleric");
});

test("renderer closes account profile popover for outside clicks", async () => {
  const harness = await createRendererHarness({
    gameDirectory: "C:\\EQ",
    clientVersion: "Rain_Of_Fear_2_4GB",
    clientLabel: "Rain of Fear 2 (4GB)",
    clientSupported: true,
    statusBadge: "Ready",
    manifestVersion: "3.0.0",
    needsPatch: false,
    canPatch: true,
    canLaunch: true,
    autoLoginProfiles: [{
      id: "profile-1",
      label: "Vayle Box",
      username: "vayle2",
      isDefault: true,
      createdAt: "2026-06-21T00:00:00.000Z",
      updatedAt: "2026-06-21T00:00:00.000Z"
    }],
    selectedAutoLoginProfileId: "profile-1"
  });
  const outsideTarget = new FakeElement("outside");

  await harness.elements.autoLoginMenuButton.dispatch("click");
  await harness.document.dispatch("click", {
    target: outsideTarget
  });

  assert.equal(harness.elements.autoLoginPopover.classList.contains("hidden"), true);
});

test("renderer disables Auto Login until a saved account profile exists", async () => {
  const emptyHarness = await createRendererHarness({
    gameDirectory: "C:\\EQ",
    clientVersion: "Rain_Of_Fear_2_4GB",
    clientLabel: "Rain of Fear 2 (4GB)",
    clientSupported: true,
    statusBadge: "Ready",
    manifestVersion: "3.0.0",
    needsPatch: false,
    canPatch: true,
    canLaunch: true
  });

  assert.equal(emptyHarness.elements.autoLoginToggle.checked, false);
  assert.equal(emptyHarness.elements.autoLoginToggle.disabled, true);

  const profileHarness = await createRendererHarness({
    gameDirectory: "C:\\EQ",
    clientVersion: "Rain_Of_Fear_2_4GB",
    clientLabel: "Rain of Fear 2 (4GB)",
    clientSupported: true,
    statusBadge: "Ready",
    manifestVersion: "3.0.0",
    needsPatch: false,
    canPatch: true,
    canLaunch: true,
    autoLoginProfiles: [{
      id: "profile-1",
      label: "Vayle Box",
      username: "vayle2",
      isDefault: true,
      createdAt: "2026-06-21T00:00:00.000Z",
      updatedAt: "2026-06-21T00:00:00.000Z"
    }],
    selectedAutoLoginProfileId: "profile-1"
  });

  assert.equal(profileHarness.elements.autoLoginToggle.checked, false);
  assert.equal(profileHarness.elements.autoLoginToggle.disabled, false);

  profileHarness.elements.autoLoginToggle.checked = true;
  await profileHarness.elements.autoLoginToggle.dispatch("change");
  await flushAsyncWork();

  assert.deepEqual(profileHarness.calls.updateSettings.at(-1), { autoLogin: true });
  assert.equal(profileHarness.elements.autoLoginToggle.checked, true);
});

test("renderer saves the default account profile flag", async () => {
  const harness = await createRendererHarness({
    gameDirectory: "C:\\EQ",
    clientVersion: "Rain_Of_Fear_2_4GB",
    clientLabel: "Rain of Fear 2 (4GB)",
    clientSupported: true,
    statusBadge: "Ready",
    manifestVersion: "3.0.0",
    needsPatch: false,
    canPatch: true,
    canLaunch: true,
    autoLoginProfiles: [{
      id: "profile-1",
      label: "Vayle Box",
      username: "vayle2",
      createdAt: "2026-06-21T00:00:00.000Z",
      updatedAt: "2026-06-21T00:00:00.000Z"
    }],
    selectedAutoLoginProfileId: "profile-1"
  });

  await harness.elements.autoLoginMenuButton.dispatch("click");
  await harness.elements.autoLoginManageButton.dispatch("click");
  harness.elements.autoLoginDefaultInput.checked = true;
  await harness.elements.autoLoginSaveButton.dispatch("click");
  await flushAsyncWork();

  assert.equal(harness.calls.saveAutoLoginProfile.at(-1).id, "profile-1");
  assert.equal(harness.calls.saveAutoLoginProfile.at(-1).isDefault, true);
  assert.equal(harness.elements.autoLoginManageProfileSelect.children[1].textContent, "Vayle Box (Default)");
});

test("renderer bootstrap defers patch notes loading until they are needed", async () => {
  const harness = await createRendererHarness({
    initialNotes: createPatchNotesResponse("https://example.invalid/notes.md", "Existing patch note")
  });

  assert.equal(harness.calls.getPatchNotes.length, 0);
  assert.equal(harness.elements.notesTabButton.classList.contains("has-unread"), false);
  assert.equal(harness.elements.patchNotesPromptModal.classList.contains("hidden"), true);
});

test("renderer applies configurable branding assets and links from launcher state", async () => {
  const harness = await createRendererHarness({
    serverName: "Brand Realm",
    heroImageUrl: "file:///legacy-client.png",
    branding: {
      serverName: "Brand Realm",
      tagline: "A Custom EQ Server",
      primaryImageUrl: "file:///brand-primary.png",
      wordmarkImageUrl: "file:///brand-wordmark.png",
      wordmarkImageAlt: "Brand Realm Wordmark",
      wordmarkRemoveLightBackground: false,
      emblemText: "BR",
      websiteUrl: "https://brand.invalid",
      websiteLabel: "brand.invalid",
      discordUrl: "https://discord.gg/brand",
      tools: [
        { label: "Wiki", url: "https://wiki.brand.invalid/" },
        { label: "Alla", url: "https://alla.brand.invalid/" }
      ]
    }
  });

  assert.equal(harness.elements.taglineValue.textContent, "A Custom EQ Server");
  assert.equal(harness.elements.heroBackgroundImage.src, "file:///brand-primary.png");
  assert.equal(harness.elements.heroWordmark.classList.contains("hidden"), true);
  assert.equal(harness.elements.heroWordmarkImage.classList.contains("hidden"), false);
  assert.equal(harness.elements.heroWordmarkImage.src, "file:///brand-wordmark.png");
  assert.equal(harness.elements.heroWordmarkImage.alt, "Brand Realm Wordmark");
  assert.equal(harness.elements.heroEmblemText.textContent, "BR");
  assert.equal(harness.elements.websiteLink.href, "https://brand.invalid");
  assert.equal(harness.elements.websiteLink.textContent, "brand.invalid");
  assert.equal(harness.elements.discordButton.classList.contains("hidden"), false);
  assert.equal(harness.elements.discordButton.dataset.url, "https://discord.gg/brand");
  assert.equal(harness.elements.toolsButton.classList.contains("hidden"), false);
  assert.deepEqual(
    harness.elements.toolsMenu.children.map((link) => ({ label: link.textContent, url: link.href })),
    [
      { label: "Wiki", url: "https://wiki.brand.invalid/" },
      { label: "Alla", url: "https://alla.brand.invalid/" }
    ]
  );
});

test("renderer displays configured game server status", async () => {
  const harness = await createRendererHarness({
    gameServerHost: "game.example.invalid",
    gameServerPort: 9000,
    gameServerStatus: {
      state: "online",
      label: "Online",
      detail: "Connected to game.example.invalid:9000 in 18ms.",
      host: "game.example.invalid",
      port: 9000,
      checkedAt: "2026-05-17T00:00:00.000Z",
      latencyMs: 18,
      error: ""
    }
  });

  assert.equal(harness.elements.serverValue.textContent, "Test Realm");
  assert.equal(harness.elements.gameServerStatusLabel.textContent, "Online");
  assert.equal(harness.elements.gameServerStatusBadge.dataset.state, "online");
  assert.equal(harness.elements.gameServerStatusDetail.textContent, "Game server reachable in 18ms.");
  assert.equal(harness.elements.gameServerStatusBadge.attributes["aria-label"], "Game server status: Online");
});

test("renderer surfaces offline game server status details", async () => {
  const harness = await createRendererHarness({
    gameServerHost: "game.example.invalid",
    gameServerPort: 9000,
    gameServerStatus: {
      state: "offline",
      label: "Offline",
      detail: "Unable to reach game.example.invalid:9000.",
      host: "game.example.invalid",
      port: 9000,
      checkedAt: "2026-05-17T00:00:00.000Z",
      latencyMs: 0,
      error: "connection refused"
    }
  });

  assert.equal(harness.elements.gameServerStatusLabel.textContent, "Offline");
  assert.equal(harness.elements.gameServerStatusBadge.dataset.state, "offline");
  assert.equal(harness.elements.gameServerStatusDetail.textContent, "Game server is unreachable: connection refused");
});

test("renderer displays login server status from launcher state", async () => {
  const harness = await createRendererHarness({
    loginServerHost: "login.eqemulator.net",
    loginServerPort: 5999,
    loginServerStatus: {
      state: "online",
      label: "Online",
      detail: "Connected to login.eqemulator.net:5999 in 22ms.",
      host: "login.eqemulator.net",
      port: 5999,
      checkedAt: "2026-05-17T00:00:00.000Z",
      latencyMs: 22,
      error: ""
    }
  });

  assert.equal(harness.elements.loginServerValue.textContent, "Login server status");
  assert.equal(harness.elements.loginServerStatusLabel.textContent, "Online");
  assert.equal(harness.elements.loginServerStatusBadge.dataset.state, "online");
  assert.equal(harness.elements.loginServerStatusDetail.textContent, "Login server reachable in 22ms.");
  assert.equal(harness.elements.loginServerStatusBadge.attributes["aria-label"], "Login server status: Online");
});

test("renderer marks backup login server status distinctly", async () => {
  const harness = await createRendererHarness({
    loginServerHost: "login.eqemulator.dev",
    loginServerPort: 5999,
    loginServerSelectionMode: "auto",
    loginServerActiveRole: "backup",
    loginServerFailoverActive: true,
    loginServerOptions: {
      primary: {
        host: "login.eqemulator.net",
        port: 5999
      },
      backup: {
        host: "login.eqemulator.dev",
        port: 5999
      }
    },
    loginServerStatus: {
      state: "online",
      label: "Backup",
      detail: "Connected to login.eqemulator.dev:5999 in 31ms.",
      host: "login.eqemulator.dev",
      port: 5999,
      checkedAt: "2026-05-17T00:00:00.000Z",
      latencyMs: 31,
      error: "",
      role: "backup",
      selectionMode: "auto",
      failoverActive: true,
      primaryError: "primary offline",
      backupError: ""
    }
  });

  assert.equal(harness.elements.loginServerStatusLabel.textContent, "Backup");
  assert.equal(harness.elements.loginServerStatusBadge.dataset.state, "backup");
  assert.equal(harness.elements.loginServerStatusDetail.textContent, "Backup login server reachable in 31ms.");
  assert.equal(harness.elements.loginServerStatusBadge.attributes["aria-label"], "Login server status: Backup");
});

test("renderer keeps backup label when login server status is unconfirmed", async () => {
  const harness = await createRendererHarness({
    loginServerHost: "login.eqemulator.dev",
    loginServerPort: 5999,
    loginServerSelectionMode: "manual",
    loginServerActiveRole: "backup",
    loginServerFailoverActive: false,
    loginServerOptions: {
      primary: {
        host: "login.eqemulator.net",
        port: 5999
      },
      backup: {
        host: "login.eqemulator.dev",
        port: 5999
      }
    },
    loginServerStatus: {
      state: "unknown",
      label: "Backup",
      detail: "Selected login.eqemulator.dev:5999. Login server status check could not confirm reachability: connection refused",
      host: "login.eqemulator.dev",
      port: 5999,
      checkedAt: "2026-05-17T00:00:00.000Z",
      latencyMs: 0,
      error: "connection refused",
      role: "backup",
      selectionMode: "manual",
      failoverActive: false,
      primaryError: "",
      backupError: "connection refused"
    }
  });

  assert.equal(harness.elements.loginServerStatusLabel.textContent, "Backup");
  assert.equal(harness.elements.loginServerStatusBadge.dataset.state, "backup");
  assert.equal(harness.elements.loginServerStatusDetail.textContent, "Selected login.eqemulator.dev:5999. Login server status check could not confirm reachability: connection refused");
});

test("login server status badge context menu toggles login servers", async () => {
  const harness = await createRendererHarness({
    loginServerHost: "login.eqemulator.net",
    loginServerPort: 5999,
    loginServerSelectionMode: "auto",
    loginServerActiveRole: "primary",
    loginServerOptions: {
      primary: {
        host: "login.eqemulator.net",
        port: 5999
      },
      backup: {
        host: "login.eqemulator.dev",
        port: 5999
      }
    },
    loginServerStatus: {
      state: "online",
      label: "Online",
      detail: "Connected to login.eqemulator.net:5999 in 22ms.",
      host: "login.eqemulator.net",
      port: 5999,
      checkedAt: "2026-05-17T00:00:00.000Z",
      latencyMs: 22,
      error: "",
      role: "primary",
      selectionMode: "auto",
      failoverActive: false,
      primaryError: "",
      backupError: ""
    }
  });

  await harness.elements.loginServerStatusBadge.dispatch("contextmenu", {
    clientX: 140,
    clientY: 190,
    preventDefault() {}
  });

  assert.equal(harness.elements.loginServerContextMenu.classList.contains("hidden"), false);
  assert.equal(harness.elements.loginServerContextMenu.style.left, "140px");
  assert.equal(harness.elements.loginServerUseBackupAction.textContent, "Use Backup");
  assert.equal(harness.elements.loginServerUseBackupAction.title, "Switch eqhost.txt to login.eqemulator.dev:5999.");

  await harness.elements.loginServerContextMenu.dispatch("click", {
    target: {
      closest(selector) {
        return selector === "button[data-login-server-role]" ? harness.elements.loginServerUseBackupAction : null;
      }
    }
  });
  await flushAsyncWork();

  assert.deepEqual(harness.calls.setActiveLoginServer, [{ role: "backup" }]);
  assert.equal(harness.elements.loginServerContextMenu.classList.contains("hidden"), true);
});

test("login server context menu can return manual selection to auto mode", async () => {
  const harness = await createRendererHarness({
    loginServerHost: "login.eqemulator.dev",
    loginServerPort: 5999,
    loginServerSelectionMode: "manual",
    loginServerActiveRole: "backup",
    loginServerOptions: {
      primary: {
        host: "login.eqemulator.net",
        port: 5999
      },
      backup: {
        host: "login.eqemulator.dev",
        port: 5999
      }
    },
    loginServerStatus: {
      state: "online",
      label: "Backup",
      detail: "Connected to login.eqemulator.dev:5999 in 22ms.",
      host: "login.eqemulator.dev",
      port: 5999,
      checkedAt: "2026-05-17T00:00:00.000Z",
      latencyMs: 22,
      error: "",
      role: "backup",
      selectionMode: "manual",
      failoverActive: false,
      primaryError: "",
      backupError: ""
    }
  });

  await harness.elements.loginServerStatusBadge.dispatch("contextmenu", {
    clientX: 100,
    clientY: 120,
    preventDefault() {}
  });

  assert.equal(harness.elements.loginServerUseAutoAction.textContent, "Auto");
  assert.equal(harness.elements.loginServerUseAutoAction.dataset.active, "false");
  assert.equal(harness.elements.loginServerUseBackupAction.dataset.active, "true");

  await harness.elements.loginServerContextMenu.dispatch("click", {
    target: {
      closest(selector) {
        return selector === "button[data-login-server-role]" ? harness.elements.loginServerUseAutoAction : null;
      }
    }
  });
  await flushAsyncWork();

  assert.deepEqual(harness.calls.setActiveLoginServer, [{ role: "auto" }]);
  assert.equal(harness.elements.loginServerContextMenu.classList.contains("hidden"), true);
});

test("login server context menu keeps manual actions clickable without parsed backup metadata", async () => {
  const harness = await createRendererHarness({
    loginServerHost: "login.eqemulator.net",
    loginServerPort: 5999,
    loginServerSelectionMode: "auto",
    loginServerActiveRole: "primary",
    loginServerOptions: {
      primary: {
        host: "login.eqemulator.net",
        port: 5999
      },
      backup: {
        host: "",
        port: 0
      }
    },
    loginServerStatus: {
      state: "online",
      label: "Online",
      detail: "Connected to login.eqemulator.net:5999 in 22ms.",
      host: "login.eqemulator.net",
      port: 5999,
      checkedAt: "2026-05-17T00:00:00.000Z",
      latencyMs: 22,
      error: "",
      role: "primary",
      selectionMode: "auto",
      failoverActive: false,
      primaryError: "",
      backupError: ""
    }
  });

  await harness.elements.loginServerStatusBadge.dispatch("contextmenu", {
    clientX: 90,
    clientY: 110,
    preventDefault() {}
  });

  assert.equal(harness.elements.loginServerContextMenu.classList.contains("hidden"), false);
  assert.equal(harness.elements.loginServerUseAutoAction.disabled, false);
  assert.equal(harness.elements.loginServerUsePrimaryAction.disabled, false);
  assert.equal(harness.elements.loginServerUseBackupAction.disabled, false);

  await harness.elements.loginServerContextMenu.dispatch("click", {
    target: {
      closest(selector) {
        return selector === "button[data-login-server-role]" ? harness.elements.loginServerUseBackupAction : null;
      }
    }
  });
  await flushAsyncWork();

  assert.deepEqual(harness.calls.setActiveLoginServer, [{ role: "backup" }]);
});

test("login server context menu opens from the whole login server row", async () => {
  const harness = await createRendererHarness({
    loginServerHost: "login.eqemulator.net",
    loginServerPort: 5999,
    loginServerSelectionMode: "auto",
    loginServerActiveRole: "primary",
    loginServerOptions: {
      primary: {
        host: "login.eqemulator.net",
        port: 5999
      },
      backup: {
        host: "login.eqemulator.dev",
        port: 5999
      }
    },
    loginServerStatus: {
      state: "online",
      label: "Online",
      detail: "Connected to login.eqemulator.net:5999 in 22ms.",
      host: "login.eqemulator.net",
      port: 5999,
      checkedAt: "2026-05-17T00:00:00.000Z",
      latencyMs: 22,
      error: "",
      role: "primary",
      selectionMode: "auto",
      failoverActive: false,
      primaryError: "",
      backupError: ""
    }
  });

  await harness.elements.loginServerSummaryItem.dispatch("contextmenu", {
    clientX: 75,
    clientY: 95,
    preventDefault() {}
  });

  assert.equal(harness.elements.loginServerContextMenu.classList.contains("hidden"), false);
  assert.equal(harness.elements.loginServerContextMenu.style.left, "75px");
  assert.equal(harness.elements.loginServerContextMenu.style.top, "95px");
});

test("renderer polls server status every 30 seconds", async () => {
  const harness = await createRendererHarness({
    polledServerStatusState: {
      gameServerHost: "game.example.invalid",
      gameServerPort: 9000,
      gameServerStatus: {
        state: "offline",
        label: "Offline",
        detail: "Unable to reach game.example.invalid:9000.",
        host: "game.example.invalid",
        port: 9000,
        checkedAt: new Date().toISOString(),
        latencyMs: 0,
        error: "connection refused"
      }
    }
  });

  assert.equal(harness.intervals.length, 1);
  assert.equal(harness.intervals[0].milliseconds, 30000);

  await harness.runInterval(0);

  assert.equal(harness.calls.refreshServerStatus, 1);
  assert.equal(harness.elements.gameServerStatusLabel.textContent, "Offline");
  assert.equal(harness.elements.gameServerStatusBadge.dataset.state, "offline");
});

test("status badge tooltip includes seconds since last check", async () => {
  const checkedAt = new Date(Date.now() - 12500).toISOString();
  const harness = await createRendererHarness({
    gameServerHost: "game.example.invalid",
    gameServerPort: 9000,
    gameServerStatus: {
      state: "online",
      label: "Online",
      detail: "Connected to game.example.invalid:9000 in 18ms.",
      host: "game.example.invalid",
      port: 9000,
      checkedAt,
      latencyMs: 18,
      error: ""
    },
    loginServerHost: "login.eqemulator.net",
    loginServerPort: 5999,
    loginServerStatus: {
      state: "online",
      label: "Online",
      detail: "Connected to login.eqemulator.net:5999 in 22ms.",
      host: "login.eqemulator.net",
      port: 5999,
      checkedAt,
      latencyMs: 22,
      error: ""
    }
  });

  await harness.elements.gameServerStatusBadge.dispatch("mouseenter");
  await harness.elements.loginServerStatusBadge.dispatch("mouseenter");

  assert.match(harness.elements.gameServerStatusBadge.title, /Last checked \d+ seconds ago\./);
  assert.match(harness.elements.loginServerStatusBadge.title, /Last checked \d+ seconds ago\./);
  assert.doesNotMatch(harness.elements.gameServerStatusBadge.title, /game\.example\.invalid/);
  assert.doesNotMatch(harness.elements.loginServerStatusBadge.title, /login\.eqemulator\.net/);
});

test("status badge refresh buttons trigger one manual check per minute", async () => {
  const harness = await createRendererHarness({
    gameServerHost: "game.example.invalid",
    gameServerPort: 9000,
    gameServerStatus: {
      state: "online",
      label: "Online",
      detail: "Connected to game.example.invalid:9000 in 18ms.",
      host: "game.example.invalid",
      port: 9000,
      checkedAt: new Date().toISOString(),
      latencyMs: 18,
      error: ""
    }
  });

  assert.equal(harness.elements.gameServerStatusRefreshButton.disabled, false);

  await harness.elements.gameServerStatusRefreshButton.dispatch("click");
  await flushAsyncWork();
  await harness.elements.loginServerStatusRefreshButton.dispatch("click");
  await flushAsyncWork();

  assert.equal(harness.calls.refreshServerStatus, 1);
  assert.equal(harness.elements.gameServerStatusRefreshButton.disabled, true);
  assert.equal(harness.elements.loginServerStatusRefreshButton.disabled, true);
  assert.match(harness.elements.gameServerStatusRefreshButton.title, /Manual refresh available in \d+ seconds\./);
});

test("renderer hides optional branding links when URLs are not configured", async () => {
  const harness = await createRendererHarness({
    branding: {
      primaryImageUrl: "file:///brand-primary.png",
      tools: []
    }
  });

  assert.equal(harness.elements.heroBackgroundImage.src, "file:///brand-primary.png");
  assert.equal(harness.elements.websiteLink.classList.contains("hidden"), true);
  assert.equal(harness.elements.discordButton.classList.contains("hidden"), true);
  assert.equal(harness.elements.toolsButton.classList.contains("hidden"), true);
  assert.equal(harness.elements.toolsMenu.children.length, 0);
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

  const redOptionCard = getUiManagerOptionCard(harness, "Options/Alt/Red");
  const redOptionCheckbox = getUiManagerOptionToggle(redOptionCard);
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

  const redOptionCard = getUiManagerOptionCard(harness, "Options/Alt/Red");
  const redOptionCheckbox = getUiManagerOptionToggle(redOptionCard);
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

  const redOptionCard = getUiManagerOptionCard(harness, "Options/Alt/Red");
  redOptionCard.closest = (selector) => selector === "[data-option-path]" ? redOptionCard : null;
  await harness.elements.uiManagerOptionList.dispatch("click", {
    target: redOptionCard
  });
  await flushAsyncWork();

  await harness.elements.uiManagerApplyOptionButton.dispatch("click");
  await flushAsyncWork();

  assert.equal(harness.elements.uiManagerConfirmModal.classList.contains("hidden"), true);
  assert.equal(harness.calls.activateUiOption.length, 0);
  assert.equal(getUiManagerOptionCard(harness, "Options/Alt/Red").classList.contains("is-selected"), true);
});

test("checking a competing UI component variant replaces the flagged bundle for apply", async () => {
  const harness = await createRendererHarness({
    gameDirectory: "C:\\EQ"
  });

  await harness.elements.uiManagerTabButton.dispatch("click");
  await flushAsyncWork();
  await harness.elements.openUiManagerButton.dispatch("click");
  await flushAsyncWork();

  const redOptionCard = getUiManagerOptionCard(harness, "Options/Alt/Red");
  const redOptionCheckbox = getUiManagerOptionToggle(redOptionCard);
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

  const redOptionCard = getUiManagerOptionCard(harness, "Options/Alt/Red");
  const redOptionCheckbox = getUiManagerOptionToggle(redOptionCard);
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

test("ui manager locks mutating controls while prerequisites are installing", async () => {
  const harness = await createRendererHarness({
    gameDirectory: "C:\\EQ",
    isInstallingPrerequisites: true
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

  const redOptionCard = getUiManagerOptionCard(harness, "Options/Alt/Red");
  const redOptionCheckbox = getUiManagerOptionToggle(redOptionCard);
  redOptionCheckbox.checked = true;
  redOptionCheckbox.closest = (selector) => selector === "input[data-option-toggle='true']" ? redOptionCheckbox : null;
  await harness.elements.uiManagerOptionList.dispatch("change", {
    target: redOptionCheckbox
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

  const backupRestoreButton = harness.elements.uiManagerBackupList.children[0].children[3];
  const overviewCalls = harness.calls.getUiManagerOverview;

  assert.equal(harness.elements.uiManagerRefreshButton.disabled, true);
  assert.equal(harness.elements.uiManagerModalRefreshButton.disabled, true);
  assert.equal(harness.elements.uiManagerImportButton.disabled, true);
  assert.equal(harness.elements.uiManagerRecoveryButton.disabled, true);
  assert.equal(harness.elements.uiManagerApplyOptionButton.disabled, true);
  assert.equal(harness.elements.uiManagerResetButton.disabled, true);
  assert.equal(backupRestoreButton.disabled, true);

  await harness.elements.uiManagerRefreshButton.dispatch("click");
  await harness.elements.uiManagerModalRefreshButton.dispatch("click");
  await harness.elements.uiManagerImportButton.dispatch("click");
  await harness.elements.uiManagerApplyOptionButton.dispatch("click");
  await harness.elements.uiManagerResetButton.dispatch("click");
  await flushAsyncWork();

  assert.equal(harness.calls.getUiManagerOverview, overviewCalls);
  assert.equal(harness.calls.openUiManagerImportDialog, 0);
  assert.equal(harness.elements.uiManagerConfirmModal.classList.contains("hidden"), true);
  assert.match(harness.elements.uiManagerNotice.textContent, /unavailable while prerequisites are installing/i);
});

test("manual prerequisite fallback opens the Microsoft downloads", async () => {
  const harness = await createRendererHarness({
    gameDirectory: "C:\\EQ",
    canInstallPrerequisites: true,
    prerequisiteDirectXUrl: "https://download.microsoft.com/directx_Jun2010_redist.exe",
    prerequisiteVcUrl: "https://aka.ms/vc14/vc_redist.x64.exe",
    statusBadge: "Install Error"
  });

  assert.equal(harness.elements.manualPrerequisitesButton.classList.contains("hidden"), false);

  await harness.elements.manualPrerequisitesButton.dispatch("click");
  await flushAsyncWork();

  assert.deepEqual(harness.calls.openExternal, [
    "https://download.microsoft.com/directx_Jun2010_redist.exe",
    "https://aka.ms/vc14/vc_redist.x64.exe"
  ]);
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

  const redOptionCard = getUiManagerOptionCard(harness, "Options/Alt/Red");
  const redOptionCheckbox = getUiManagerOptionToggle(redOptionCard);
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
