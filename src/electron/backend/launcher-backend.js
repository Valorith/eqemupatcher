const crypto = require("crypto");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { spawn } = require("child_process");
const { pathToFileURL } = require("url");
const SimpleYaml = require("./simple-yaml");

const DEFAULTS = {
  serverName: "Clumsy's World",
  filelistUrl: "https://patch.clumsysworld.com/",
  patchNotesUrl: "",
  defaultAutoPatch: false,
  defaultAutoPlay: false,
  supportedClients: ["Rain_Of_Fear_2", "Rain_Of_Fear_2_4GB"]
};

const LEGACY_SERVER_NAMES = new Set(["Rebuild EQ"]);
const GENERIC_HOST_SEGMENTS = new Set(["app", "cdn", "download", "downloads", "files", "patch", "static", "updates", "www"]);
const SERVER_NAME_ALIASES = {
  clumsysworld: "Clumsy's World"
};

const CLIENTS = {
  Unknown: { label: "Unknown", suffix: "unk", image: "rof.png" },
  Titanium: { label: "Titanium", suffix: "tit", image: "titanium.png" },
  Rain_Of_Fear: { label: "Rain of Fear", suffix: "rof", image: "rof.png" },
  Rain_Of_Fear_2: { label: "Rain of Fear 2", suffix: "rof", image: "rof.png" },
  Rain_Of_Fear_2_4GB: { label: "Rain of Fear 2 (4GB)", suffix: "rof", image: "rof.png" },
  Seeds_Of_Destruction: { label: "Seeds of Destruction", suffix: "sod", image: "rof.png" },
  Underfoot: { label: "Underfoot", suffix: "und", image: "underfoot.png" },
  Secrets_Of_Feydwer: { label: "Secrets of Feydwer", suffix: "sof", image: "sof.png" },
  Broken_Mirror: { label: "Broken Mirror", suffix: "bro", image: "brokenmirror.png" }
};

const HASH_TO_VERSION = {
  "85218FC053D8B367F2B704BAC5E30ACC": "Secrets_Of_Feydwer",
  "859E89987AA636D36B1007F11C2CD6E0": "Underfoot",
  "EF07EE6649C9A2BA2EFFC3F346388E1E78B44B48": "Underfoot",
  "A9DE1B8CC5C451B32084656FCACF1103": "Titanium",
  "BB42BC3870F59B6424A56FED3289C6D4": "Titanium",
  "368BB9F425C8A55030A63E606D184445": "Rain_Of_Fear",
  "240C80800112ADA825C146D7349CE85B": "Rain_Of_Fear_2",
  "389709EC0E456C3DAE881A61218AAB3F": "Rain_Of_Fear_2_4GB",
  "A057A23F030BAA1C4910323B131407105ACAD14D": "Rain_Of_Fear_2",
  "6BFAE252C1A64FE8A3E176CAEE7AAE60": "Broken_Mirror",
  "AD970AD6DB97E5BB21141C205CAD6E68": "Broken_Mirror"
};

function boolToLegacyString(value) {
  return value ? "true" : "false";
}

function isTrue(value) {
  return value === true || value === "true";
}

async function exists(filePath) {
  try {
    await fsp.access(filePath);
    return true;
  } catch (_error) {
    return false;
  }
}

function cloneState(state) {
  return JSON.parse(JSON.stringify(state));
}

function normalizeVersion(value) {
  if (value == null || value === "") {
    return "";
  }

  return String(value);
}

function buildUrl(baseUrl, relativePath) {
  const normalizedBaseUrl = String(baseUrl || "").endsWith("/") ? String(baseUrl || "") : `${String(baseUrl || "")}/`;
  return new URL(relativePath, normalizedBaseUrl).toString();
}

function normalizeServerName(value) {
  if (value == null) {
    return "";
  }

  return String(value).trim();
}

function looksLikeLegacyServerName(value) {
  const normalized = normalizeServerName(value);
  return normalized === "" || LEGACY_SERVER_NAMES.has(normalized);
}

function humanizeServerToken(token) {
  const normalizedToken = String(token || "").trim().toLowerCase();
  if (!normalizedToken) {
    return "";
  }

  if (SERVER_NAME_ALIASES[normalizedToken]) {
    return SERVER_NAME_ALIASES[normalizedToken];
  }

  const separated = normalizedToken
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z0-9])/g, "$1 $2")
    .replace(/([0-9])([a-zA-Z])/g, "$1 $2")
    .replace(/([a-zA-Z])([0-9])/g, "$1 $2")
    .trim();

  return separated
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function deriveServerNameFromUrl(urlValue) {
  if (!urlValue) {
    return "";
  }

  try {
    const hostname = new URL(String(urlValue)).hostname.toLowerCase();
    const labels = hostname.split(".").filter(Boolean);
    if (labels.length === 0) {
      return "";
    }

    let hostLabels = labels.slice(0, -1);
    if (
      labels.length >= 3 &&
      labels.at(-1).length === 2 &&
      ["co", "com", "net", "org"].includes(labels.at(-2))
    ) {
      hostLabels = labels.slice(0, -2);
    }

    const candidateLabel = [...hostLabels].reverse().find((label) => !GENERIC_HOST_SEGMENTS.has(label)) || hostLabels.at(-1) || labels[0];
    return humanizeServerToken(candidateLabel);
  } catch (_error) {
    return "";
  }
}


function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderInlineMarkdown(value) {
  let rendered = escapeHtml(value);
  rendered = rendered.replace(/`([^`]+)`/g, "<code>$1</code>");
  rendered = rendered.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  rendered = rendered.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  rendered = rendered.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  return rendered;
}

function markdownToHtml(markdown) {
  const lines = String(markdown || "").split("\n").map((line) => line.replace(/\r$/, ""));
  const html = [];
  let inCode = false;
  let inList = false;

  const closeList = () => {
    if (inList) {
      html.push("</ul>");
      inList = false;
    }
  };

  for (const line of lines) {
    if (line.startsWith("```")) {
      closeList();
      if (inCode) {
        html.push("</code></pre>");
        inCode = false;
      } else {
        html.push("<pre><code>");
        inCode = true;
      }
      continue;
    }

    if (inCode) {
      html.push(`${escapeHtml(line)}\n`);
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      closeList();
      const level = heading[1].length;
      html.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }

    const listItem = line.match(/^[-*]\s+(.+)$/);
    if (listItem) {
      if (!inList) {
        html.push("<ul>");
        inList = true;
      }
      html.push(`<li>${renderInlineMarkdown(listItem[1])}</li>`);
      continue;
    }

    if (/^>\s+/.test(line)) {
      closeList();
      html.push(`<blockquote>${renderInlineMarkdown(line.replace(/^>\s+/, ""))}</blockquote>`);
      continue;
    }

    if (/^---+$/.test(line.trim())) {
      closeList();
      html.push("<hr>");
      continue;
    }

    if (!line.trim()) {
      closeList();
      continue;
    }

    closeList();
    html.push(`<p>${renderInlineMarkdown(line)}</p>`);
  }

  closeList();
  if (inCode) {
    html.push("</code></pre>");
  }

  return html.join("\n");
}
function isLaunchPermissionError(error) {
  return error && ["EACCES", "EPERM"].includes(error.code);
}

class LauncherBackend {
  constructor({ appUserDataPath, projectRoot, launchDirectory, runtimeDirectory, eventSink, fetchImpl, spawnImpl, platform }) {
    this.appUserDataPath = appUserDataPath;
    this.projectRoot = projectRoot;
    this.launchDirectory = launchDirectory || "";
    this.runtimeDirectory = runtimeDirectory || "";
    this.eventSink = eventSink;
    this.fetchImpl = fetchImpl || fetch;
    this.spawnImpl = spawnImpl || spawn;
    this.platform = platform || process.platform;
    this.appStatePath = path.join(this.appUserDataPath, "launcher-state.yml");
    this.configPath = path.join(this.projectRoot, "launcher-config.yml");
    this.launchConfigPath = this.launchDirectory ? path.join(this.launchDirectory, "launcher-config.yml") : "";
    this.runtimeConfigPath = this.runtimeDirectory ? path.join(this.runtimeDirectory, "launcher-config.yml") : "";
    this.config = { ...DEFAULTS };
    this.gameSettings = null;
    this.appState = { gameDirectory: "" };
    this.cancelController = null;
    this.cancelRequested = false;
    this.resolvedConfigPath = this.configPath;
    this.patchNotesCache = {
      url: "",
      content: "",
      fetchedAt: ""
    };

    this.state = {
      platform: this.platform,
      serverName: this.config.serverName,
      filelistUrl: this.config.filelistUrl,
      patchNotesUrl: this.config.patchNotesUrl,
      gameDirectory: "",
      eqGamePath: "",
      clientVersion: "Unknown",
      clientLabel: CLIENTS.Unknown.label,
      clientHash: "",
      clientSupported: false,
      manifestVersion: "",
      lastPatchedVersion: "",
      needsPatch: false,
      patchActionLabel: "Deploy Patch",
      launchActionLabel: "Launch Game",
      statusBadge: "Standby",
      statusDetail: "Select your EverQuest directory to begin.",
      heroImageUrl: this.getHeroImageUrl("Unknown"),
      autoPatch: this.config.defaultAutoPatch,
      autoPlay: this.config.defaultAutoPlay,
      isPatching: false,
      progressValue: 0,
      progressMax: 1,
      progressLabel: "Waiting for input",
      canPatch: false,
      canLaunch: false,
      launchSupported: this.platform === "win32",
      reportUrl: "",
      lastError: "",
      manifestUrl: ""
    };
  }

  emit(type, payload) {
    if (!this.eventSink) {
      return;
    }

    this.eventSink({ type, payload });
  }

  emitState() {
    this.emit("state", this.getState());
  }

  emitLog(text, tone = "info") {
    this.emit("log", {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      text,
      tone,
      timestamp: new Date().toISOString()
    });
  }

  emitProgress() {
    this.emit("progress", {
      value: this.state.progressValue,
      max: this.state.progressMax,
      label: this.state.progressLabel
    });
  }

  getState() {
    return cloneState(this.state);
  }

  getHeroImageUrl(version) {
    const gameDirectory = this.state?.gameDirectory || "";
    if (gameDirectory) {
      const customSplashPath = path.join(gameDirectory, "eqemupatcher.png");
      if (fs.existsSync(customSplashPath)) {
        return pathToFileURL(customSplashPath).toString();
      }
    }

    const imageName = (CLIENTS[version] || CLIENTS.Unknown).image;
    const imagePath = path.join(this.projectRoot, "src", "electron", "assets", "hero", imageName);
    return pathToFileURL(imagePath).toString();
  }

  setStatus(badge, detail, error = "") {
    this.state.statusBadge = badge;
    this.state.statusDetail = detail;
    this.state.lastError = error;
  }

  resolveServerName(options = {}) {
    const { manifest = null } = options;
    const explicitServerNames = [
      manifest?.serverName,
      this.gameSettings?.serverName,
      this.config.serverName
    ];

    for (const candidate of explicitServerNames) {
      const normalizedCandidate = normalizeServerName(candidate);
      if (normalizedCandidate && !looksLikeLegacyServerName(normalizedCandidate)) {
        return normalizedCandidate;
      }
    }

    const derivedServerName = (
      deriveServerNameFromUrl(manifest?.downloadprefix) ||
      deriveServerNameFromUrl(this.gameSettings?.filelistUrl) ||
      deriveServerNameFromUrl(this.config.filelistUrl)
    );

    if (derivedServerName) {
      return derivedServerName;
    }

    return normalizeServerName(this.config.serverName) || DEFAULTS.serverName;
  }

  async initialize() {
    await this.loadConfig();
    await this.loadAppState();
    await this.useLaunchDirectory();
    await this.loadGameSettings();
    return this.refreshState({ performAutoActions: true });
  }

  async useLaunchDirectory() {
    if (!this.launchDirectory) {
      return;
    }

    this.state.gameDirectory = this.launchDirectory;
    this.appState.gameDirectory = this.launchDirectory;
    await this.saveAppState();
  }

  async resolveConfigPath() {
    if (this.launchConfigPath && (await exists(this.launchConfigPath))) {
      return this.launchConfigPath;
    }

    if (this.runtimeConfigPath && (await exists(this.runtimeConfigPath))) {
      return this.runtimeConfigPath;
    }

    return this.configPath;
  }

  async loadConfig() {
    this.config = { ...DEFAULTS };
    const resolvedConfigPath = await this.resolveConfigPath();
    this.resolvedConfigPath = resolvedConfigPath;

    if (!(await exists(resolvedConfigPath))) {
      this.state.serverName = this.resolveServerName();
      this.state.filelistUrl = this.config.filelistUrl;
      this.state.patchNotesUrl = this.config.patchNotesUrl;
      return;
    }

    try {
      const parsed = await this.loadYaml(resolvedConfigPath);
      this.config = {
        ...DEFAULTS,
        ...(parsed || {})
      };
    } catch (_error) {
      this.config = { ...DEFAULTS };
    }

    if (!Array.isArray(this.config.supportedClients)) {
      this.config.supportedClients = [...DEFAULTS.supportedClients];
    }

    this.state.serverName = this.resolveServerName();
    this.state.filelistUrl = this.config.filelistUrl;
    this.state.patchNotesUrl = this.config.patchNotesUrl;
  }


  async getPatchNotes(options = {}) {
    const { forceRefresh = false } = options;

    try {
      const notes = await this.fetchPatchNotes({ forceRefresh });
      const html = notes.content ? markdownToHtml(notes.content) : "";
      return {
        ...notes,
        html,
        error: ""
      };
    } catch (error) {
      return {
        url: String(this.config.patchNotesUrl || "").trim(),
        content: "",
        html: "",
        fetchedAt: "",
        error: error.message || "Unable to load patch notes."
      };
    }
  }

  async fetchPatchNotes(options = {}) {
    const { forceRefresh = false } = options;
    const patchNotesUrl = String(this.config.patchNotesUrl || "").trim();

    if (!patchNotesUrl) {
      this.patchNotesCache = {
        url: "",
        content: "",
        fetchedAt: ""
      };
      return {
        url: "",
        content: "",
        fetchedAt: ""
      };
    }

    if (!forceRefresh && this.patchNotesCache.url === patchNotesUrl && this.patchNotesCache.content) {
      return cloneState(this.patchNotesCache);
    }

    const response = await this.fetchImpl(patchNotesUrl);
    if (!response.ok) {
      throw new Error(`Patch notes request failed with ${response.status}`);
    }

    const content = await response.text();
    this.patchNotesCache = {
      url: patchNotesUrl,
      content,
      fetchedAt: new Date().toISOString()
    };
    return cloneState(this.patchNotesCache);
  }

  async getResolvedConfigPath() {
    const resolvedConfigPath = await this.resolveConfigPath();
    this.resolvedConfigPath = resolvedConfigPath;
    return resolvedConfigPath;
  }

  async loadAppState() {
    await fsp.mkdir(this.appUserDataPath, { recursive: true });
    if (!(await exists(this.appStatePath))) {
      await this.saveYaml(this.appStatePath, this.appState);
      return;
    }

    try {
      const parsed = await this.loadYaml(this.appStatePath);
      this.appState = { ...this.appState, ...(parsed || {}) };
      this.state.gameDirectory = this.appState.gameDirectory || "";
    } catch (_error) {
      this.appState = { gameDirectory: "" };
      await this.saveYaml(this.appStatePath, this.appState);
    }
  }

  async saveAppState() {
    await this.saveYaml(this.appStatePath, this.appState);
  }

  getGameSettingsPath() {
    if (!this.state.gameDirectory) {
      return "";
    }

    return path.join(this.state.gameDirectory, "eqemupatcher.yml");
  }

  getManifestPath() {
    if (!this.state.gameDirectory) {
      return "";
    }

    return path.join(this.state.gameDirectory, "filelist.yml");
  }

  getEqGamePath() {
    if (!this.state.gameDirectory) {
      return "";
    }

    return path.join(this.state.gameDirectory, "eqgame.exe");
  }

  async loadGameSettings() {
    if (!this.state.gameDirectory) {
      this.gameSettings = {
        autoPatch: boolToLegacyString(this.config.defaultAutoPatch),
        autoPlay: boolToLegacyString(this.config.defaultAutoPlay),
        clientVersion: "Unknown",
        lastPatchedVersion: ""
      };
      this.state.autoPatch = this.config.defaultAutoPatch;
      this.state.autoPlay = this.config.defaultAutoPlay;
      return;
    }

    const settingsPath = this.getGameSettingsPath();
    const defaults = {
      autoPatch: boolToLegacyString(this.config.defaultAutoPatch),
      autoPlay: boolToLegacyString(this.config.defaultAutoPlay),
      clientVersion: "Unknown",
      lastPatchedVersion: ""
    };

    try {
      const parsed = (await exists(settingsPath)) ? await this.loadYaml(settingsPath) : {};
      this.gameSettings = { ...defaults, ...(parsed || {}) };
    } catch (_error) {
      this.gameSettings = defaults;
    }

    this.state.autoPatch = isTrue(this.gameSettings.autoPatch);
    this.state.autoPlay = isTrue(this.gameSettings.autoPlay);
    this.state.lastPatchedVersion = normalizeVersion(this.gameSettings.lastPatchedVersion);

    await this.saveGameSettings();
  }

  async saveGameSettings() {
    if (!this.state.gameDirectory || !this.gameSettings) {
      return;
    }

    this.gameSettings.autoPatch = boolToLegacyString(this.state.autoPatch);
    this.gameSettings.autoPlay = boolToLegacyString(this.state.autoPlay);
    this.gameSettings.clientVersion = this.state.clientVersion;
    this.gameSettings.lastPatchedVersion = normalizeVersion(this.state.lastPatchedVersion);
    await this.saveYaml(this.getGameSettingsPath(), this.gameSettings);
  }

  async setGameDirectory(gameDirectory) {
    this.state.gameDirectory = gameDirectory;
    this.appState.gameDirectory = gameDirectory;
    await this.saveAppState();
    await this.loadGameSettings();
    return this.refreshState({ performAutoActions: true });
  }

  async updateSettings(patch) {
    if (typeof patch.autoPatch === "boolean") {
      this.state.autoPatch = patch.autoPatch;
    }

    if (typeof patch.autoPlay === "boolean") {
      this.state.autoPlay = patch.autoPlay;
    }

    await this.saveGameSettings();
    this.emitState();
    return this.getState();
  }

  async refreshState(options = {}) {
    const { performAutoActions = false } = options;

    this.state.eqGamePath = this.getEqGamePath();
    this.state.heroImageUrl = this.getHeroImageUrl(this.state.clientVersion);
    this.state.reportUrl = "";
    this.state.canPatch = false;
    this.state.canLaunch = false;
    this.state.manifestVersion = "";
    this.state.needsPatch = false;
    this.state.manifestUrl = "";
    this.state.progressValue = 0;
    this.state.progressMax = 1;
    this.state.progressLabel = "Waiting for input";
    this.emitProgress();

      if (!this.state.gameDirectory) {
      this.state.clientVersion = "Unknown";
      this.state.clientLabel = CLIENTS.Unknown.label;
      this.state.clientHash = "";
      this.state.patchActionLabel = "Deploy Patch";
      this.setStatus("Run In Folder", "Run this launcher from the EverQuest directory that contains eqgame.exe.");
      this.state.heroImageUrl = this.getHeroImageUrl("Unknown");
      this.emitState();
      return this.getState();
    }

    this.state.serverName = this.resolveServerName();
    this.state.filelistUrl = this.config.filelistUrl;

    const detectResult = await this.detectClientVersion();
    this.state.clientVersion = detectResult.version;
    this.state.clientLabel = (CLIENTS[detectResult.version] || CLIENTS.Unknown).label;
      this.state.clientHash = detectResult.hash;
      this.state.clientSupported = this.config.supportedClients.includes(detectResult.version);
      this.state.heroImageUrl = this.getHeroImageUrl(detectResult.version);
      this.state.canLaunch = false;

      await this.saveGameSettings();

    if (!detectResult.found) {
      this.state.patchActionLabel = "Deploy Patch";
      this.state.canLaunch = false;
      this.setStatus("No Client", "eqgame.exe was not found in the selected folder.");
      this.emitState();
      return this.getState();
    }

    if (detectResult.version === "Unknown") {
      this.state.patchActionLabel = "Unsupported Client";
      this.state.canLaunch = false;
      this.state.reportUrl = `https://github.com/Xackery/eqemupatcher/issues/new?title=A+New+EQClient+Found&body=Hi+I+Found+A+New+Client!+Hash:+${detectResult.hash}`;
      this.setStatus("Client Unknown", "This EverQuest executable does not match a known client hash.");
      this.emitState();
      return this.getState();
    }

    if (!this.state.clientSupported) {
      this.state.patchActionLabel = "Unsupported Build";
      this.state.canLaunch = false;
      this.setStatus("Unsupported", `${this.state.serverName} does not publish patches for ${this.state.clientLabel}.`);
      this.emitState();
      return this.getState();
    }

    try {
      const manifest = await this.fetchManifest();
      this.state.serverName = this.resolveServerName({ manifest });
      this.state.manifestVersion = normalizeVersion(manifest.version);
      this.state.lastPatchedVersion = normalizeVersion(this.gameSettings.lastPatchedVersion);
      this.state.needsPatch = this.state.manifestVersion !== this.state.lastPatchedVersion;
      this.state.canPatch = true;
      this.state.canLaunch = !this.state.needsPatch && detectResult.found && this.state.launchSupported;
      this.state.patchActionLabel = this.state.needsPatch ? "Deploy Patch" : "Verify Integrity";
      this.state.launchActionLabel = this.state.needsPatch ? "Start Patch" : "Launch Game";
      this.state.progressLabel = this.state.needsPatch ? "Update available" : "Files are in sync";

      if (this.state.needsPatch) {
        this.setStatus("Update Ready", `Manifest ${this.state.manifestVersion} is ready to deploy.`);
      } else {
        this.setStatus("Ready", "Manifest and local patch version are aligned.");
      }

      this.emitState();

      if (performAutoActions) {
        if (this.state.needsPatch && this.state.autoPatch) {
          await this.startPatch({ autoTriggered: true });
        } else if (!this.state.needsPatch && this.state.autoPlay) {
          await this.launchGame({ autoTriggered: true });
        }
      }
    } catch (error) {
      this.state.patchActionLabel = "Manifest Error";
      this.setStatus("Manifest Error", error.message, error.message);
      this.emitLog(`Manifest fetch failed: ${error.message}`, "error");
      this.emitState();
    }

    return this.getState();
  }

  async detectClientVersion() {
    const eqGamePath = this.getEqGamePath();
    if (!(await exists(eqGamePath))) {
      return { found: false, hash: "", version: "Unknown" };
    }

    const hash = await this.getFileHash(eqGamePath);
    const version = HASH_TO_VERSION[hash] || "Unknown";
    return { found: true, hash, version };
  }

  async fetchManifest() {
    const client = CLIENTS[this.state.clientVersion];
    const manifestUrl = buildUrl(this.config.filelistUrl, `${client.suffix}/filelist_${client.suffix}.yml`);
    const manifestPath = this.getManifestPath();
    this.state.manifestUrl = manifestUrl;
    this.emitLog(`Fetching manifest from ${manifestUrl}`);
    this.setStatus("Manifest Sync", "Contacting the patch endpoint.");
    this.emitState();

    const response = await this.fetchImpl(manifestUrl);
    if (!response.ok) {
      throw new Error(response.status === 404 ? "Manifest not found (404)." : `Manifest request failed (${response.status}).`);
    }

    const text = await response.text();
    await fsp.writeFile(manifestPath, text, "utf8");
    const parsed = SimpleYaml.parse(text);
    if (!parsed || typeof parsed !== "object") {
      throw new Error("Manifest response was empty or invalid.");
    }

    return parsed;
  }

  async startPatch(options = {}) {
    const { autoTriggered = false } = options;

    if (this.state.isPatching) {
      return this.getState();
    }

    if (!this.state.gameDirectory) {
      this.setStatus("Run In Folder", "Run this launcher from a valid EverQuest directory before patching.");
      this.emitState();
      return this.getState();
    }

    if (this.state.clientVersion === "Unknown") {
      this.state.canPatch = false;
      this.state.canLaunch = false;
      this.state.patchActionLabel = "Unsupported Client";
      this.state.reportUrl = `https://github.com/Xackery/eqemupatcher/issues/new?title=A+New+EQClient+Found&body=Hi+I+Found+A+New+Client!+Hash:+${this.state.clientHash}`;
      this.setStatus("Client Unknown", "This EverQuest executable does not match a known client hash.");
      this.emitLog("Patch blocked: the selected EverQuest client is unknown.", "warning");
      this.emitState();
      return this.getState();
    }

    if (!this.state.clientSupported) {
      this.state.canPatch = false;
      this.state.canLaunch = false;
      this.state.patchActionLabel = "Unsupported Build";
      this.setStatus("Unsupported", `${this.state.serverName} does not publish patches for ${this.state.clientLabel}.`);
      this.emitLog(`Patch blocked: ${this.state.clientLabel} is not supported by ${this.state.serverName}.`, "warning");
      this.emitState();
      return this.getState();
    }

    let manifest;
    try {
      manifest = await this.ensureManifestLoaded();
    } catch (error) {
      this.state.patchActionLabel = "Manifest Error";
      this.setStatus("Manifest Error", error.message, error.message);
      this.emitLog(`Patch preparation failed: ${error.message}`, "error");
      this.emitState();
      return this.getState();
    }

    const downloads = Array.isArray(manifest.downloads) ? manifest.downloads : [];
    const deletes = Array.isArray(manifest.deletes) ? manifest.deletes : [];

    this.cancelRequested = false;
    this.cancelController = new AbortController();
    this.state.isPatching = true;
    this.state.canLaunch = false;
    this.state.patchActionLabel = "Cancel Patch";
    this.state.launchActionLabel = "Start Patch";
    this.state.progressValue = 0;
    this.state.progressMax = Math.max(downloads.length, 1);
    this.state.progressLabel = downloads.length ? `Scanning 0 / ${downloads.length} files` : "Scanning local files";
    this.setStatus("Patching", autoTriggered ? "Auto patch is running." : "Scanning local files against the manifest.");
    this.emitState();
    this.emitProgress();
    this.emitLog(autoTriggered ? "Auto patch triggered." : "Patch operation started.");

    try {
      const filesToDownload = [];
      let totalBytes = 0;
      let scannedFiles = 0;

      for (const entry of downloads) {
        this.throwIfCanceled();
        const targetPath = this.resolveGamePath(entry.name);
        const shouldDownload = !(await exists(targetPath)) || (await this.getFileHash(targetPath)) !== String(entry.md5 || "").toUpperCase();
        scannedFiles += 1;
        this.state.progressValue = scannedFiles;
        this.state.progressMax = Math.max(downloads.length, 1);
        this.state.progressLabel = `Scanning ${scannedFiles} / ${downloads.length} files`;
        this.emitProgress();
        if (shouldDownload) {
          filesToDownload.push(entry);
          totalBytes += Math.max(1, Number(entry.size) || 0);
        }
      }

      for (const entry of deletes) {
        this.throwIfCanceled();
        const targetPath = this.resolveGamePath(entry.name);
        if (await exists(targetPath)) {
          this.emitLog(`Deleting ${entry.name}...`);
          await fsp.unlink(targetPath);
        }
      }

      if (filesToDownload.length === 0) {
        this.state.progressValue = 1;
        this.state.progressMax = 1;
        this.state.progressLabel = "Files are already up to date";
        this.state.lastPatchedVersion = normalizeVersion(manifest.version);
        await this.saveGameSettings();
        this.state.needsPatch = false;
        this.state.canLaunch = this.state.launchSupported && this.state.clientSupported && this.state.clientVersion !== "Unknown";
        this.state.patchActionLabel = "Verify Integrity";
        this.state.launchActionLabel = "Launch Game";
        this.setStatus("Ready", `Patch ${manifest.version || "current"} is already installed.`);
        this.emitLog(`Up to date with patch ${manifest.version || "current"}.`);
        this.finishPatch();
        return this.getState();
      }

      this.state.progressValue = 0;
      this.state.progressMax = totalBytes;
      this.state.progressLabel = `Downloading ${filesToDownload.length} files`;
      this.emitProgress();
      this.emitLog(`Downloading ${totalBytes} bytes across ${filesToDownload.length} files...`);

      let downloadedBytes = 0;
      for (const entry of filesToDownload) {
        this.throwIfCanceled();
        const targetPath = this.resolveGamePath(entry.name);
        const expectedHash = String(entry.md5 || "").toUpperCase();
        const downloadUrl = buildUrl(manifest.downloadprefix, entry.name.replace(/\\/g, "/"));
        this.state.progressLabel = `Downloading ${entry.name}`;
        this.emitProgress();
        this.emitLog(`${entry.name}...`);
        await this.downloadFile(downloadUrl, targetPath, this.cancelController.signal, (chunkSize) => {
          downloadedBytes += chunkSize;
          this.state.progressValue = Math.min(downloadedBytes, this.state.progressMax);
          this.emitProgress();
        });

        if (expectedHash && (await this.getFileHash(targetPath)) !== expectedHash) {
          await fsp.unlink(targetPath).catch(() => {});
          throw new Error(`Downloaded file failed verification: ${entry.name}`);
        }
      }

      this.state.progressValue = this.state.progressMax;
      this.state.progressLabel = "Patch complete";
      this.state.lastPatchedVersion = normalizeVersion(manifest.version);
      this.state.needsPatch = false;
      this.state.canLaunch = this.state.launchSupported && this.state.clientSupported && this.state.clientVersion !== "Unknown";
      await this.saveGameSettings();
      this.state.launchActionLabel = "Launch Game";
      this.setStatus("Ready", "Patch complete. Launch is now available.");
      this.emitLog("Complete! Press Launch to begin.");
      this.finishPatch();
    } catch (error) {
      if (error.message === "PATCH_CANCELED") {
        this.state.needsPatch = true;
        this.state.canLaunch = false;
        this.state.patchActionLabel = "Deploy Patch";
        this.state.launchActionLabel = "Start Patch";
        this.setStatus("Patch Canceled", "Patch deployment was canceled before completion.");
        this.emitLog("Patching cancelled.", "warning");
      } else {
        this.state.needsPatch = true;
        this.state.canLaunch = false;
        this.state.patchActionLabel = "Deploy Patch";
        this.state.launchActionLabel = "Start Patch";
        this.setStatus("Patch Error", error.message, error.message);
        this.emitLog(`Patch failed: ${error.message}`, "error");
      }

      this.state.isPatching = false;
      this.cancelController = null;
      this.emitState();
      this.emitProgress();
    }

    return this.getState();
  }

  finishPatch() {
    this.state.isPatching = false;
    this.state.patchActionLabel = this.state.needsPatch ? "Deploy Patch" : "Verify Integrity";
    this.state.launchActionLabel = this.state.needsPatch ? "Start Patch" : "Launch Game";
    this.cancelController = null;
    this.cancelRequested = false;
    this.emitState();
    this.emitProgress();
  }

  async cancelPatch() {
    if (!this.state.isPatching) {
      return this.getState();
    }

    this.cancelRequested = true;
    if (this.cancelController) {
      this.cancelController.abort();
    }

    this.setStatus("Canceling", "Waiting for the active transfer to stop.");
    this.emitLog("Cancel requested. Waiting for the current operation to finish...", "warning");
    this.emitState();
    return this.getState();
  }

  async launchGame(options = {}) {
    const { autoTriggered = false } = options;

    if (!this.state.gameDirectory) {
      this.setStatus("Run In Folder", "Run this launcher from the EverQuest directory before launching.");
      this.emitState();
      return this.getState();
    }

    if (this.platform !== "win32") {
      this.setStatus("Windows Only", "Launching eqgame.exe is only supported on Windows.");
      this.emitLog("Launch blocked: eqgame.exe can only be started from Windows.", "warning");
      this.emitState();
      return this.getState();
    }

    if (this.state.clientVersion === "Unknown") {
      this.setStatus("Client Unknown", "This EverQuest executable does not match a known client hash.");
      this.emitLog("Launch blocked: the selected EverQuest client is unknown.", "warning");
      this.emitState();
      return this.getState();
    }

    if (!this.state.clientSupported) {
      this.setStatus("Unsupported", `${this.state.serverName} does not publish patches for ${this.state.clientLabel}.`);
      this.emitLog(`Launch blocked: ${this.state.clientLabel} is not supported by ${this.state.serverName}.`, "warning");
      this.emitState();
      return this.getState();
    }

    const eqGamePath = this.getEqGamePath();
    if (!(await exists(eqGamePath))) {
      this.setStatus("No Client", "eqgame.exe was not found in the selected folder.");
      this.emitState();
      return this.getState();
    }

    try {
      this.setStatus("Launching", autoTriggered ? "Auto Play is launching EverQuest." : "Launching EverQuest.");
      this.emitLog("Starting eqgame.exe patchme...");
      this.emitState();

      await this.spawnEverQuest(eqGamePath);
      this.setStatus("Launching", "EverQuest was started.");
      this.emitState();
    } catch (error) {
      this.setStatus("Launch Error", error.message, error.message);
      this.emitLog(`Launch failed: ${error.message}`, "error");
      this.emitState();
    }

    return this.getState();
  }

  throwIfCanceled() {
    if (this.cancelRequested) {
      throw new Error("PATCH_CANCELED");
    }
  }

  resolveGamePath(relativePath) {
    const normalized = relativePath.replace(/[\\/]+/g, path.sep);
    const resolved = path.resolve(this.state.gameDirectory, normalized);
    const rootWithSeparator = this.state.gameDirectory.endsWith(path.sep) ? this.state.gameDirectory : `${this.state.gameDirectory}${path.sep}`;
    if (resolved !== this.state.gameDirectory && !resolved.startsWith(rootWithSeparator)) {
      throw new Error(`Refusing to write outside the game directory: ${relativePath}`);
    }

    return resolved;
  }

  async downloadFile(url, destinationPath, signal, onChunk) {
    await fsp.mkdir(path.dirname(destinationPath), { recursive: true });

    const response = await this.fetchImpl(url, { signal });
    if (!response.ok || !response.body) {
      throw new Error(response.status === 404 ? `File not found: ${url}` : `Download failed (${response.status}) for ${url}`);
    }

    const file = fs.createWriteStream(destinationPath);
    try {
      for await (const chunk of response.body) {
        this.throwIfCanceled();
        file.write(chunk);
        onChunk(chunk.length);
      }
    } catch (error) {
      file.destroy();
      await fsp.unlink(destinationPath).catch(() => {});
      throw error.name === "AbortError" ? new Error("PATCH_CANCELED") : error;
    }

    await new Promise((resolve, reject) => {
      file.end((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  async ensureManifestLoaded() {
    const manifestPath = this.getManifestPath();
    if (!(await exists(manifestPath))) {
      await this.fetchManifest();
    }

    const manifest = await this.loadYaml(manifestPath);
    if (!manifest || typeof manifest !== "object") {
      throw new Error("Manifest response was empty or invalid.");
    }

    if (!manifest.downloadprefix) {
      throw new Error("Manifest is missing downloadprefix.");
    }

    manifest.version = normalizeVersion(manifest.version);

    if (!Array.isArray(manifest.downloads)) {
      manifest.downloads = [];
    }

    if (manifest.deletes != null && !Array.isArray(manifest.deletes)) {
      throw new Error("Manifest deletes field is invalid.");
    }

    return manifest;
  }

  async spawnEverQuest(eqGamePath) {
    const launchOptions = {
      cwd: this.state.gameDirectory,
      detached: true,
      stdio: "ignore",
      windowsHide: true
    };

    try {
      await this.spawnDetached(eqGamePath, ["patchme"], launchOptions);
    } catch (error) {
      if (this.platform !== "win32" || !isLaunchPermissionError(error)) {
        throw error;
      }

      this.emitLog(`Direct launch was denied (${error.code}). Retrying through cmd.exe...`, "warning");
      await this.spawnDetached(
        process.env.comspec || "cmd.exe",
        ["/d", "/s", "/c", "start", '""', "/d", this.state.gameDirectory, eqGamePath, "patchme"],
        launchOptions
      );
    }
  }

  async spawnDetached(command, args, options) {
    await new Promise((resolve, reject) => {
      let child;
      try {
        child = this.spawnImpl(command, args, options);
      } catch (error) {
        reject(error);
        return;
      }

      let settled = false;
      const finish = (callback, value) => {
        if (settled) {
          return;
        }
        settled = true;
        callback(value);
      };

      child.once("error", (error) => {
        finish(reject, error);
      });

      child.once("spawn", () => {
        child.unref();
        finish(resolve);
      });
    });
  }

  async getFileHash(filePath) {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash("md5");
      const stream = fs.createReadStream(filePath);
      stream.on("error", reject);
      stream.on("data", (chunk) => hash.update(chunk));
      stream.on("end", () => resolve(hash.digest("hex").toUpperCase()));
    });
  }

  async loadYaml(filePath) {
    const content = await fsp.readFile(filePath, "utf8");
    return SimpleYaml.parse(content);
  }

  async saveYaml(filePath, data) {
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    const content = SimpleYaml.stringify(data);
    await fsp.writeFile(filePath, content, "utf8");
  }
}

module.exports = {
  LauncherBackend
};
