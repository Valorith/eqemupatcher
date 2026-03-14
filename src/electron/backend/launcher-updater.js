const crypto = require("crypto");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { spawn } = require("child_process");

const DEFAULT_RELEASE_API_URL = "https://api.github.com/repos/Valorith/eqemupatcher/releases/latest";
const PORTABLE_ASSET_PATTERN = /^EQEmu Launcher-.*-windows-portable\.exe$/i;
const RELEASE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeVersion(value) {
  return String(value || "").trim().replace(/^v/i, "");
}

function compareVersions(leftValue, rightValue) {
  const left = normalizeVersion(leftValue);
  const right = normalizeVersion(rightValue);

  if (left === right) {
    return 0;
  }

  const tokenize = (value) => String(value || "").match(/\d+|[A-Za-z]+/g) || [];
  const leftTokens = tokenize(left);
  const rightTokens = tokenize(right);
  const tokenCount = Math.max(leftTokens.length, rightTokens.length);

  for (let index = 0; index < tokenCount; index += 1) {
    const leftToken = leftTokens[index];
    const rightToken = rightTokens[index];

    if (leftToken == null) {
      return -1;
    }

    if (rightToken == null) {
      return 1;
    }

    const leftNumber = /^\d+$/.test(leftToken) ? Number(leftToken) : null;
    const rightNumber = /^\d+$/.test(rightToken) ? Number(rightToken) : null;

    if (leftNumber != null && rightNumber != null) {
      if (leftNumber !== rightNumber) {
        return leftNumber > rightNumber ? 1 : -1;
      }
      continue;
    }

    const comparison = String(leftToken).localeCompare(String(rightToken), undefined, { sensitivity: "base" });
    if (comparison !== 0) {
      return comparison > 0 ? 1 : -1;
    }
  }

  return left.localeCompare(right, undefined, { sensitivity: "base" });
}

async function exists(targetPath) {
  try {
    await fsp.access(targetPath);
    return true;
  } catch (_error) {
    return false;
  }
}

function createDefaultState({ appVersion, supported }) {
  return {
    status: supported ? "idle" : "unsupported-platform",
    currentVersion: normalizeVersion(appVersion) || "0.0.0",
    latestVersion: "",
    releaseUrl: "",
    releaseNotes: "",
    assetName: "",
    progressValue: 0,
    progressMax: 1,
    message: supported
      ? "Launcher self-update is ready."
      : "Launcher self-update is available only in the packaged Windows build."
  };
}

class LauncherUpdater {
  constructor({
    appUserDataPath,
    projectRoot,
    fetchImpl,
    spawnImpl,
    onStateChange,
    emitLog,
    platform,
    appVersion,
    executablePath,
    processId,
    relaunchArgs,
    isPackaged
  }) {
    this.appUserDataPath = appUserDataPath;
    this.projectRoot = projectRoot;
    this.fetchImpl = fetchImpl || fetch;
    this.spawnImpl = spawnImpl || spawn;
    this.onStateChange = onStateChange;
    this.emitLog = emitLog || (() => {});
    this.platform = platform || process.platform;
    this.appVersion = normalizeVersion(appVersion) || "0.0.0";
    this.executablePath = executablePath || "";
    this.executableName = path.basename(this.executablePath || "");
    this.processId = processId || process.pid;
    this.relaunchArgs = Array.isArray(relaunchArgs) ? [...relaunchArgs] : [];
    this.isPackaged = Boolean(isPackaged);
    this.supported = this.platform === "win32" && this.isPackaged && Boolean(this.executablePath);

    this.updateRoot = path.join(this.appUserDataPath, "launcher-update");
    this.helperSourcePath = path.join(this.projectRoot, "src", "electron", "assets", "updater", "portable-update-helper.ps1");
    this.helperInstalledPath = path.join(this.updateRoot, "portable-update-helper.ps1");
    this.releaseCachePath = path.join(this.updateRoot, "release-cache.json");
    this.stagedMetadataPath = path.join(this.updateRoot, "staged-update.json");
    this.stagedRootPath = path.join(this.updateRoot, "staged");
    this.applyResultPath = path.join(this.updateRoot, "apply-result.json");
    this.helperLogPath = path.join(this.updateRoot, "helper.log");

    this.state = createDefaultState({ appVersion: this.appVersion, supported: this.supported });
    this.releaseCache = {
      releaseApiUrl: "",
      checkedAt: "",
      etag: "",
      release: null
    };
    this.stagedMetadata = null;
    this.stagedReadyMetadata = null;
    this.latestRelease = null;
    this.helperReady = false;
    this.helperIssueMessage = "";
    this.previousApplyError = "";
    this.checkPromise = null;
    this.downloadPromise = null;
  }

  getState() {
    return clone(this.state);
  }

  updateState(patch) {
    this.state = {
      ...this.state,
      ...patch,
      currentVersion: this.appVersion
    };

    if (this.onStateChange) {
      this.onStateChange(this.getState());
    }
  }

  async initialize({ releaseApiUrl }) {
    await fsp.mkdir(this.updateRoot, { recursive: true });
    await this.loadReleaseCache();
    await this.loadStagedMetadata();
    await this.consumeApplyResult();

    if (!this.supported) {
      this.updateState({});
      return this.getState();
    }

    await this.ensureHelperInstalled();
    await this.loadStagedReadyMetadata();

    if (this.previousApplyError) {
      this.updateState({
        status: "helper-error",
        latestVersion: this.stagedReadyMetadata?.version || "",
        releaseUrl: this.stagedReadyMetadata?.releaseUrl || "",
        releaseNotes: "",
        assetName: this.stagedReadyMetadata?.assetName || "",
        progressValue: 0,
        progressMax: 1,
        message: `Previous launcher update failed: ${this.previousApplyError}`
      });
      return this.getState();
    }

    if (this.stagedReadyMetadata && compareVersions(this.stagedReadyMetadata.version, this.appVersion) > 0) {
      this.updateState({
        status: "ready",
        latestVersion: this.stagedReadyMetadata.version,
        releaseUrl: this.stagedReadyMetadata.releaseUrl || "",
        releaseNotes: "",
        assetName: this.stagedReadyMetadata.assetName || "",
        progressValue: this.stagedReadyMetadata.size || 1,
        progressMax: this.stagedReadyMetadata.size || 1,
        message: `Launcher ${this.stagedReadyMetadata.version} is staged. Restart to update.`
      });
      return this.getState();
    }

    if (!this.helperReady) {
      this.updateState({
        status: "helper-error",
        message: this.helperIssueMessage || "Launcher self-update is unavailable because the updater helper could not be prepared."
      });
      return this.getState();
    }

    this.updateState({
      status: "idle",
      latestVersion: "",
      releaseUrl: String(releaseApiUrl || "").trim(),
      releaseNotes: "",
      assetName: "",
      progressValue: 0,
      progressMax: 1,
      message: "Launcher self-update is ready."
    });
    return this.getState();
  }

  async checkForUpdate({ force = false, ignoreTtl = false, releaseApiUrl }) {
    if (!this.supported) {
      return this.getState();
    }

    if (this.checkPromise) {
      return this.checkPromise;
    }

    this.checkPromise = this.performCheckForUpdate({ force, ignoreTtl, releaseApiUrl }).finally(() => {
      this.checkPromise = null;
    });
    return this.checkPromise;
  }

  async startDownload({ releaseApiUrl }) {
    if (!this.supported) {
      return this.getState();
    }

    if (this.downloadPromise) {
      return this.downloadPromise;
    }

    this.downloadPromise = this.performStartDownload({ releaseApiUrl }).finally(() => {
      this.downloadPromise = null;
    });
    return this.downloadPromise;
  }

  async applyUpdate() {
    if (!this.supported) {
      return { ok: false, shouldQuit: false, state: this.getState() };
    }

    if (!this.helperReady) {
      this.updateState({
        status: "helper-error",
        message: this.helperIssueMessage || "Launcher self-update is unavailable because the updater helper could not be prepared."
      });
      return { ok: false, shouldQuit: false, state: this.getState() };
    }

    if (!this.stagedReadyMetadata || !(await exists(this.stagedReadyMetadata.filePath))) {
      this.updateState({
        status: "error",
        releaseUrl: this.latestRelease?.releaseUrl || "",
        releaseNotes: this.latestRelease?.releaseNotes || "",
        message: "No staged launcher update is ready to apply."
      });
      return { ok: false, shouldQuit: false, state: this.getState() };
    }

    try {
      await this.preflightWritableDirectory(path.dirname(this.executablePath));
    } catch (error) {
      this.updateState({
        status: "error",
        releaseUrl: this.latestRelease?.releaseUrl || this.stagedReadyMetadata.releaseUrl || "",
        releaseNotes: this.latestRelease?.releaseNotes || "",
        assetName: this.stagedReadyMetadata.assetName || "",
        latestVersion: this.stagedReadyMetadata.version || "",
        message: error.message || "The launcher directory is not writable."
      });
      return { ok: false, shouldQuit: false, state: this.getState() };
    }

    const backupPath = `${this.executablePath}.bak`;
    const relaunchArgsPayload = Buffer.from(JSON.stringify(this.relaunchArgs), "utf8").toString("base64");

    try {
      await this.spawnHelperProcess({
        parentPid: this.processId,
        targetExe: this.executablePath,
        stagedExe: this.stagedReadyMetadata.filePath,
        backupExe: backupPath,
        resultPath: this.applyResultPath,
        logPath: this.helperLogPath,
        relaunchArgsPayload
      });
    } catch (error) {
      this.updateState({
        status: "error",
        releaseUrl: this.latestRelease?.releaseUrl || this.stagedReadyMetadata.releaseUrl || "",
        releaseNotes: this.latestRelease?.releaseNotes || "",
        assetName: this.stagedReadyMetadata.assetName || "",
        latestVersion: this.stagedReadyMetadata.version || "",
        message: error.message || "Unable to start the launcher updater helper."
      });
      return { ok: false, shouldQuit: false, state: this.getState() };
    }

    this.updateState({
      status: "applying",
      latestVersion: this.stagedReadyMetadata.version || "",
      releaseUrl: this.latestRelease?.releaseUrl || this.stagedReadyMetadata.releaseUrl || "",
      releaseNotes: this.latestRelease?.releaseNotes || "",
      assetName: this.stagedReadyMetadata.assetName || "",
      progressValue: this.stagedReadyMetadata.size || 1,
      progressMax: this.stagedReadyMetadata.size || 1,
      message: `Applying launcher ${this.stagedReadyMetadata.version}. The app will restart.`
    });
    this.emitLog(`Launcher ${this.stagedReadyMetadata.version} is being applied.`, "info");

    return { ok: true, shouldQuit: true, state: this.getState() };
  }

  async performCheckForUpdate({ force = false, ignoreTtl = false, releaseApiUrl }) {
    const resolvedReleaseApiUrl = String(releaseApiUrl || DEFAULT_RELEASE_API_URL).trim();
    if (!resolvedReleaseApiUrl) {
      this.updateState({
        status: "error",
        message: "Launcher release API is not configured."
      });
      return this.getState();
    }

    if (this.state.status !== "ready" && this.state.status !== "helper-error") {
      this.updateState({
        status: "checking",
        message: "Checking for launcher updates...",
        progressValue: 0,
        progressMax: 1
      });
    }

    let release;
    try {
      release = await this.resolveRelease({ force, ignoreTtl, releaseApiUrl: resolvedReleaseApiUrl });
    } catch (error) {
      this.updateState({
        status: this.helperReady ? "error" : "helper-error",
        message: error.message || "Unable to check for launcher updates."
      });
      return this.getState();
    }

    this.latestRelease = release;
    const compare = compareVersions(release.latestVersion, this.appVersion);

    if (compare <= 0) {
      if (this.stagedReadyMetadata && compareVersions(this.stagedReadyMetadata.version, this.appVersion) > 0) {
        this.updateState({
          status: "ready",
          latestVersion: this.stagedReadyMetadata.version,
          releaseUrl: this.stagedReadyMetadata.releaseUrl || release.releaseUrl || "",
          releaseNotes: release.releaseNotes || "",
          assetName: this.stagedReadyMetadata.assetName || release.assetName || "",
          progressValue: this.stagedReadyMetadata.size || 1,
          progressMax: this.stagedReadyMetadata.size || 1,
          message: `Launcher ${this.stagedReadyMetadata.version} is staged. Restart to update.`
        });
        return this.getState();
      }

      this.updateState({
        status: "up-to-date",
        latestVersion: release.latestVersion,
        releaseUrl: release.releaseUrl || "",
        releaseNotes: release.releaseNotes || "",
        assetName: release.assetName || "",
        progressValue: 0,
        progressMax: 1,
        message: "Launcher is up to date."
      });
      return this.getState();
    }

    if (release.error) {
      this.updateState({
        status: "error",
        latestVersion: release.latestVersion,
        releaseUrl: release.releaseUrl || "",
        releaseNotes: release.releaseNotes || "",
        assetName: release.assetName || "",
        progressValue: 0,
        progressMax: 1,
        message: release.error
      });
      return this.getState();
    }

    if (!this.helperReady) {
      this.updateState({
        status: "helper-error",
        latestVersion: release.latestVersion,
        releaseUrl: release.releaseUrl || "",
        releaseNotes: release.releaseNotes || "",
        assetName: release.assetName || "",
        progressValue: 0,
        progressMax: 1,
        message: this.helperIssueMessage || "Launcher update is available, but the updater helper could not be prepared."
      });
      return this.getState();
    }

    if (this.previousApplyError) {
      this.updateState({
        status: "helper-error",
        latestVersion: release.latestVersion,
        releaseUrl: release.releaseUrl || "",
        releaseNotes: release.releaseNotes || "",
        assetName: release.assetName || "",
        progressValue: 0,
        progressMax: 1,
        message: `Previous launcher update failed: ${this.previousApplyError}`
      });
      return this.getState();
    }

    if (this.stagedReadyMetadata && this.stagedReadyMetadata.version === release.latestVersion) {
      this.updateState({
        status: "ready",
        latestVersion: release.latestVersion,
        releaseUrl: release.releaseUrl || "",
        releaseNotes: release.releaseNotes || "",
        assetName: release.assetName || "",
        progressValue: release.size || 1,
        progressMax: release.size || 1,
        message: `Launcher ${release.latestVersion} is staged. Restart to update.`
      });
      return this.getState();
    }

    this.updateState({
      status: "available",
      latestVersion: release.latestVersion,
      releaseUrl: release.releaseUrl || "",
      releaseNotes: release.releaseNotes || "",
      assetName: release.assetName || "",
      progressValue: 0,
      progressMax: 1,
      message: `Launcher ${release.latestVersion} is available.`
    });
    return this.getState();
  }

  async performStartDownload({ releaseApiUrl }) {
    if (!this.helperReady) {
      this.updateState({
        status: "helper-error",
        message: this.helperIssueMessage || "Launcher self-update is unavailable because the updater helper could not be prepared."
      });
      return this.getState();
    }

    if (!this.latestRelease || compareVersions(this.latestRelease.latestVersion, this.appVersion) <= 0) {
      await this.checkForUpdate({ force: true, releaseApiUrl });
    }

    const release = this.latestRelease;
    if (!release || compareVersions(release.latestVersion, this.appVersion) <= 0) {
      this.updateState({
        status: "up-to-date",
        releaseNotes: release?.releaseNotes || "",
        message: "Launcher is up to date."
      });
      return this.getState();
    }

    if (release.error) {
      this.updateState({
        status: "error",
        releaseUrl: release.releaseUrl || "",
        releaseNotes: release.releaseNotes || "",
        message: release.error
      });
      return this.getState();
    }

    if (this.stagedReadyMetadata && this.stagedReadyMetadata.version === release.latestVersion) {
      this.updateState({
        status: "ready",
        latestVersion: release.latestVersion,
        releaseUrl: release.releaseUrl || "",
        releaseNotes: release.releaseNotes || "",
        assetName: release.assetName || "",
        progressValue: release.size || 1,
        progressMax: release.size || 1,
        message: `Launcher ${release.latestVersion} is staged. Restart to update.`
      });
      return this.getState();
    }

    const versionDirectory = path.join(this.stagedRootPath, release.latestVersion);
    const finalPath = path.join(versionDirectory, release.assetName);
    const tempPath = `${finalPath}.download`;

    await fsp.mkdir(versionDirectory, { recursive: true });
    await fsp.rm(tempPath, { force: true }).catch(() => {});

    this.updateState({
      status: "downloading",
      latestVersion: release.latestVersion,
      releaseUrl: release.releaseUrl || "",
      releaseNotes: release.releaseNotes || "",
      assetName: release.assetName || "",
      progressValue: 0,
      progressMax: release.size || 1,
      message: `Downloading launcher ${release.latestVersion}...`
    });

    try {
      const download = await this.downloadReleaseAsset({
        url: release.downloadUrl,
        destinationPath: tempPath,
        expectedSize: release.size,
        expectedSha256: release.sha256,
        onProgress: (downloadedBytes) => {
          this.updateState({
            status: "downloading",
            latestVersion: release.latestVersion,
            releaseUrl: release.releaseUrl || "",
            releaseNotes: release.releaseNotes || "",
            assetName: release.assetName || "",
            progressValue: downloadedBytes,
            progressMax: release.size || Math.max(downloadedBytes, 1),
            message: `Downloading launcher ${release.latestVersion}...`
          });
        }
      });

      await fsp.rm(finalPath, { force: true }).catch(() => {});
      await fsp.rename(tempPath, finalPath);

      this.stagedMetadata = {
        version: release.latestVersion,
        assetName: release.assetName,
        filePath: finalPath,
        sha256: release.sha256,
        size: release.size,
        releaseUrl: release.releaseUrl || "",
        downloadedAt: new Date().toISOString()
      };
      this.stagedReadyMetadata = clone(this.stagedMetadata);
      await this.saveStagedMetadata();

      this.emitLog(`Launcher ${release.latestVersion} was downloaded and staged.`, "success");
      this.updateState({
        status: "ready",
        latestVersion: release.latestVersion,
        releaseUrl: release.releaseUrl || "",
        releaseNotes: release.releaseNotes || "",
        assetName: release.assetName || "",
        progressValue: release.size || download.downloadedBytes || 1,
        progressMax: release.size || download.downloadedBytes || 1,
        message: `Launcher ${release.latestVersion} is staged. Restart to update.`
      });
    } catch (error) {
      await fsp.rm(tempPath, { force: true }).catch(() => {});
      this.updateState({
        status: "error",
        latestVersion: release.latestVersion,
        releaseUrl: release.releaseUrl || "",
        releaseNotes: release.releaseNotes || "",
        assetName: release.assetName || "",
        progressValue: 0,
        progressMax: release.size || 1,
        message: error.message || "Launcher download failed."
      });
    }

    return this.getState();
  }

  async resolveRelease({ force, ignoreTtl, releaseApiUrl }) {
    const cachedReleaseUsable =
      !force &&
      !ignoreTtl &&
      this.releaseCache.releaseApiUrl === releaseApiUrl &&
      this.releaseCache.release &&
      this.releaseCache.checkedAt &&
      (Date.now() - new Date(this.releaseCache.checkedAt).getTime()) < RELEASE_CACHE_TTL_MS;

    if (cachedReleaseUsable) {
      return clone(this.releaseCache.release);
    }

    const headers = {
      Accept: "application/vnd.github+json",
      "User-Agent": `EQEmuLauncher/${this.appVersion}`
    };

    if (force) {
      headers["Cache-Control"] = "no-cache, no-store";
      headers.Pragma = "no-cache";
    }

    if (!force && this.releaseCache.releaseApiUrl === releaseApiUrl && this.releaseCache.etag) {
      headers["If-None-Match"] = this.releaseCache.etag;
    }

    const response = await this.fetchImpl(this.buildReleaseRequestUrl(releaseApiUrl, { force }), { headers });
    if (response.status === 304 && this.releaseCache.releaseApiUrl === releaseApiUrl && this.releaseCache.release) {
      this.releaseCache.checkedAt = new Date().toISOString();
      await this.saveReleaseCache();
      return clone(this.releaseCache.release);
    }

    if (!response.ok) {
      throw new Error(`Launcher release check failed with ${response.status}.`);
    }

    const releasePayload = await response.json();
    const parsedRelease = this.parseReleasePayload(releasePayload);
    this.releaseCache = {
      releaseApiUrl,
      checkedAt: new Date().toISOString(),
      etag: response.headers?.get?.("etag") || "",
      release: parsedRelease
    };
    await this.saveReleaseCache();
    return clone(parsedRelease);
  }

  buildReleaseRequestUrl(releaseApiUrl, { force }) {
    if (!force) {
      return releaseApiUrl;
    }

    const requestUrl = new URL(releaseApiUrl);
    requestUrl.searchParams.set("_", String(Date.now()));
    return requestUrl.toString();
  }

  parseReleasePayload(payload) {
    const latestVersion = normalizeVersion(payload?.tag_name);
    const releaseUrl = String(payload?.html_url || "").trim();
    const releaseNotes = String(payload?.body || "").trim();
    const assets = Array.isArray(payload?.assets) ? payload.assets : [];
    const asset = this.selectReleaseAsset(assets);

    if (!latestVersion) {
      return {
        latestVersion: "",
        releaseUrl,
        releaseNotes,
        assetName: "",
        downloadUrl: "",
        size: 0,
        sha256: "",
        error: "Latest launcher release did not expose a usable version tag."
      };
    }

    if (!asset) {
      return {
        latestVersion,
        releaseUrl,
        releaseNotes,
        assetName: "",
        downloadUrl: "",
        size: 0,
        sha256: "",
        error: "Latest launcher release is missing the Windows portable launcher asset."
      };
    }

    const digest = String(asset.digest || "").trim();
    const digestMatch = digest.match(/^sha256:([a-f0-9]{64})$/i);
    if (!digestMatch) {
      return {
        latestVersion,
        releaseUrl,
        releaseNotes,
        assetName: String(asset.name || "").trim(),
        downloadUrl: String(asset.browser_download_url || "").trim(),
        size: Number(asset.size) || 0,
        sha256: "",
        error: "Latest launcher release is missing a SHA-256 digest. Download it manually from the release page."
      };
    }

    return {
      latestVersion,
      releaseUrl,
      releaseNotes,
      assetName: String(asset.name || "").trim(),
      downloadUrl: String(asset.browser_download_url || "").trim(),
      size: Number(asset.size) || 0,
      sha256: digestMatch[1].toLowerCase(),
      error: ""
    };
  }

  selectReleaseAsset(assets) {
    const executableAssets = assets.filter((candidate) => {
      const name = String(candidate?.name || "").trim();
      return Boolean(name) && /\.exe$/i.test(name) && !/\.blockmap$/i.test(name);
    });

    if (this.executableName) {
      const exactMatch = executableAssets.find(
        (candidate) => String(candidate?.name || "").trim().toLowerCase() === this.executableName.toLowerCase()
      );
      if (exactMatch) {
        return exactMatch;
      }
    }

    const legacyPortableMatch = executableAssets.find((candidate) => PORTABLE_ASSET_PATTERN.test(String(candidate?.name || "")));
    if (legacyPortableMatch) {
      return legacyPortableMatch;
    }

    if (executableAssets.length === 1) {
      return executableAssets[0];
    }

    const portableKeywordMatch = executableAssets.find((candidate) => /portable/i.test(String(candidate?.name || "")));
    if (portableKeywordMatch) {
      return portableKeywordMatch;
    }

    return null;
  }

  async ensureHelperInstalled() {
    try {
      const sourceContent = await fsp.readFile(this.helperSourcePath, "utf8");
      let installedContent = "";
      if (await exists(this.helperInstalledPath)) {
        installedContent = await fsp.readFile(this.helperInstalledPath, "utf8");
      }

      if (installedContent !== sourceContent) {
        await fsp.mkdir(path.dirname(this.helperInstalledPath), { recursive: true });
        await fsp.writeFile(this.helperInstalledPath, sourceContent, "utf8");
      }

      this.helperReady = true;
      this.helperIssueMessage = "";
    } catch (error) {
      this.helperReady = false;
      this.helperIssueMessage = `Launcher updater helper is unavailable: ${error.message}`;
      this.emitLog(this.helperIssueMessage, "error");
    }
  }

  async loadReleaseCache() {
    if (!(await exists(this.releaseCachePath))) {
      return;
    }

    try {
      const raw = await fsp.readFile(this.releaseCachePath, "utf8");
      const parsed = JSON.parse(raw);
      this.releaseCache = {
        ...this.releaseCache,
        ...(parsed || {})
      };
    } catch (_error) {
      this.releaseCache = {
        releaseApiUrl: "",
        checkedAt: "",
        etag: "",
        release: null
      };
    }
  }

  async saveReleaseCache() {
    await fsp.mkdir(path.dirname(this.releaseCachePath), { recursive: true });
    await fsp.writeFile(this.releaseCachePath, JSON.stringify(this.releaseCache, null, 2), "utf8");
  }

  async loadStagedMetadata() {
    if (!(await exists(this.stagedMetadataPath))) {
      return;
    }

    try {
      const raw = await fsp.readFile(this.stagedMetadataPath, "utf8");
      this.stagedMetadata = JSON.parse(raw);
    } catch (_error) {
      this.stagedMetadata = null;
    }
  }

  async saveStagedMetadata() {
    await fsp.mkdir(path.dirname(this.stagedMetadataPath), { recursive: true });
    await fsp.writeFile(this.stagedMetadataPath, JSON.stringify(this.stagedMetadata, null, 2), "utf8");
  }

  async loadStagedReadyMetadata() {
    this.stagedReadyMetadata = null;
    if (!this.stagedMetadata) {
      return;
    }

    if (compareVersions(this.stagedMetadata.version, this.appVersion) <= 0) {
      return;
    }

    if (!(await exists(this.stagedMetadata.filePath))) {
      return;
    }

    const fileHash = await this.getSha256(this.stagedMetadata.filePath);
    if (fileHash !== String(this.stagedMetadata.sha256 || "").toLowerCase()) {
      return;
    }

    this.stagedReadyMetadata = clone(this.stagedMetadata);
  }

  async consumeApplyResult() {
    if (!(await exists(this.applyResultPath))) {
      return;
    }

    try {
      const raw = await fsp.readFile(this.applyResultPath, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed?.status === "error" && parsed.message) {
        this.previousApplyError = String(parsed.message);
      }
    } catch (_error) {
      this.previousApplyError = "The last launcher update failed before it could report details.";
    }

    await fsp.rm(this.applyResultPath, { force: true }).catch(() => {});
  }

  async downloadReleaseAsset({ url, destinationPath, expectedSize, expectedSha256, onProgress }) {
    const response = await this.fetchImpl(url, {
      headers: {
        "User-Agent": `EQEmuLauncher/${this.appVersion}`
      }
    });

    if (!response.ok || !response.body) {
      throw new Error(response.status === 404 ? "Launcher release asset was not found." : `Launcher download failed (${response.status}).`);
    }

    const file = fs.createWriteStream(destinationPath);
    const hash = crypto.createHash("sha256");
    let downloadedBytes = 0;

    try {
      for await (const chunk of response.body) {
        file.write(chunk);
        hash.update(chunk);
        downloadedBytes += chunk.length;
        if (onProgress) {
          onProgress(downloadedBytes);
        }
      }
    } catch (error) {
      file.destroy();
      await fsp.rm(destinationPath, { force: true }).catch(() => {});
      throw error;
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

    if (expectedSize && downloadedBytes !== expectedSize) {
      await fsp.rm(destinationPath, { force: true }).catch(() => {});
      throw new Error(`Launcher download size mismatch. Expected ${expectedSize} bytes, received ${downloadedBytes}.`);
    }

    const digest = hash.digest("hex").toLowerCase();
    if (digest !== String(expectedSha256 || "").toLowerCase()) {
      await fsp.rm(destinationPath, { force: true }).catch(() => {});
      throw new Error("Launcher download failed SHA-256 verification.");
    }

    return {
      downloadedBytes,
      sha256: digest
    };
  }

  async preflightWritableDirectory(directoryPath) {
    const probePath = path.join(directoryPath, `.launcher-update-write-test-${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`);
    try {
      await fsp.writeFile(probePath, "", "utf8");
    } catch (error) {
      throw new Error(`The launcher directory is not writable: ${error.message}`);
    } finally {
      await fsp.rm(probePath, { force: true }).catch(() => {});
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

  async spawnHelperProcess({ parentPid, targetExe, stagedExe, backupExe, resultPath, logPath, relaunchArgsPayload }) {
    const powerShellArgs = [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      this.helperInstalledPath,
      "-ParentPid",
      String(parentPid),
      "-TargetExe",
      targetExe,
      "-StagedExe",
      stagedExe,
      "-BackupExe",
      backupExe,
      "-ResultPath",
      resultPath,
      "-LogPath",
      logPath,
      "-RelaunchArgsJsonBase64",
      relaunchArgsPayload
    ];

    const command = process.env.comspec || "cmd.exe";
    const args = ["/d", "/s", "/c", "start", '""', "powershell.exe", ...powerShellArgs];
    await this.spawnDetached(command, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      cwd: path.dirname(this.executablePath)
    });
  }

  async getSha256(filePath) {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash("sha256");
      const stream = fs.createReadStream(filePath);
      stream.on("error", reject);
      stream.on("data", (chunk) => hash.update(chunk));
      stream.on("end", () => resolve(hash.digest("hex").toLowerCase()));
    });
  }
}

module.exports = {
  DEFAULT_RELEASE_API_URL,
  LauncherUpdater,
  PORTABLE_ASSET_PATTERN,
  RELEASE_CACHE_TTL_MS,
  compareVersions,
  normalizeVersion
};
