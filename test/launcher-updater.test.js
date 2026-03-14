const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { Readable } = require("node:stream");

const { LauncherUpdater } = require("../src/electron/backend/launcher-updater");

function sha256(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

async function createTempDir(prefix) {
  return fsp.mkdtemp(path.join(os.tmpdir(), prefix));
}

function createHeaders(headers = {}) {
  const map = new Map();
  for (const [key, value] of Object.entries(headers)) {
    map.set(String(key).toLowerCase(), String(value));
  }

  return {
    get(name) {
      return map.get(String(name).toLowerCase()) || "";
    }
  };
}

function createJsonResponse(status, payload, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: createHeaders(headers),
    json: async () => payload
  };
}

function createDownloadResponse(status, content, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: createHeaders(headers),
    body: Readable.from([Buffer.isBuffer(content) ? content : Buffer.from(content)])
  };
}

async function createUpdaterHarness(t, options = {}) {
  const projectRoot = await createTempDir("eqemu-updater-project-");
  const appUserDataPath = await createTempDir("eqemu-updater-user-");
  const installDirectory = await createTempDir("eqemu-updater-install-");
  const executablePath = path.join(installDirectory, "EQEmu Launcher.exe");
  const helperSourcePath = path.join(projectRoot, "src", "electron", "assets", "updater", "portable-update-helper.ps1");
  const helperSourceContent = options.helperSourceContent || "Write-Host 'helper'";
  const stateEvents = [];

  await fsp.mkdir(path.dirname(helperSourcePath), { recursive: true });
  await fsp.writeFile(helperSourcePath, helperSourceContent, "utf8");
  await fsp.writeFile(executablePath, "launcher exe", "utf8");

  t.after(async () => {
    await fsp.rm(projectRoot, { recursive: true, force: true });
    await fsp.rm(appUserDataPath, { recursive: true, force: true });
    await fsp.rm(installDirectory, { recursive: true, force: true });
  });

  const updater = new LauncherUpdater({
    appUserDataPath,
    projectRoot,
    fetchImpl: options.fetchImpl,
    spawnImpl: options.spawnImpl,
    onStateChange: (state) => stateEvents.push(state),
    emitLog: options.emitLog,
    platform: options.platform || "win32",
    appVersion: options.appVersion || "0.2.1",
    executablePath,
    processId: 4242,
    relaunchArgs: ["--portable"],
    isPackaged: options.isPackaged ?? true
  });

  return {
    updater,
    projectRoot,
    appUserDataPath,
    installDirectory,
    executablePath,
    helperSourcePath,
    helperInstalledPath: path.join(appUserDataPath, "launcher-update", "portable-update-helper.ps1"),
    stateEvents
  };
}

function latestReleasePayload(version, digest, overrides = {}) {
  return {
    tag_name: version,
    html_url: "https://github.com/Valorith/eqemupatcher/releases/tag/v0.2.2",
    assets: [
      {
        name: "notes.txt",
        browser_download_url: "https://example.invalid/notes.txt",
        size: 4
      },
      {
        name: `EQEmu Launcher-${normalizeForAsset(version)}-windows-portable.exe`,
        browser_download_url: "https://example.invalid/EQEmu%20Launcher.exe",
        size: overrides.size || 12,
        digest
      }
    ],
    ...overrides
  };
}

function normalizeForAsset(version) {
  return String(version || "").replace(/^v/i, "");
}

test("initialize installs the updater helper when it is missing", async (t) => {
  const { updater, helperInstalledPath } = await createUpdaterHarness(t);

  await updater.initialize({ releaseApiUrl: "https://api.github.com/repos/Valorith/eqemupatcher/releases/latest" });

  assert.equal(await fsp.readFile(helperInstalledPath, "utf8"), "Write-Host 'helper'");
});

test("initialize refreshes the installed helper when the bundled helper changed", async (t) => {
  const { updater, helperInstalledPath } = await createUpdaterHarness(t);
  await fsp.mkdir(path.dirname(helperInstalledPath), { recursive: true });
  await fsp.writeFile(helperInstalledPath, "old helper", "utf8");

  await updater.initialize({ releaseApiUrl: "https://api.github.com/repos/Valorith/eqemupatcher/releases/latest" });

  assert.equal(await fsp.readFile(helperInstalledPath, "utf8"), "Write-Host 'helper'");
});

test("initialize recovers a staged valid update and exposes ready state immediately", async (t) => {
  const stagedPayload = Buffer.from("new portable launcher");
  const { updater, appUserDataPath } = await createUpdaterHarness(t);
  const stagedDirectory = path.join(appUserDataPath, "launcher-update", "staged", "0.2.2");
  const stagedPath = path.join(stagedDirectory, "EQEmu Launcher-0.2.2-windows-portable.exe");

  await fsp.mkdir(stagedDirectory, { recursive: true });
  await fsp.writeFile(stagedPath, stagedPayload);
  await fsp.writeFile(
    path.join(appUserDataPath, "launcher-update", "staged-update.json"),
    JSON.stringify({
      version: "0.2.2",
      assetName: path.basename(stagedPath),
      filePath: stagedPath,
      sha256: sha256(stagedPayload),
      size: stagedPayload.length,
      releaseUrl: "https://github.com/Valorith/eqemupatcher/releases/tag/v0.2.2"
    }),
    "utf8"
  );

  const state = await updater.initialize({ releaseApiUrl: "https://api.github.com/repos/Valorith/eqemupatcher/releases/latest" });

  assert.equal(state.status, "ready");
  assert.equal(state.latestVersion, "0.2.2");
});

test("a failed prior helper result is surfaced on the next update check", async (t) => {
  const digest = `sha256:${sha256("launcher-0.2.2")}`;
  const { updater, appUserDataPath } = await createUpdaterHarness(t, {
    fetchImpl: async () => createJsonResponse(200, latestReleasePayload("v0.2.2", digest))
  });

  await fsp.mkdir(path.join(appUserDataPath, "launcher-update"), { recursive: true });
  await fsp.writeFile(
    path.join(appUserDataPath, "launcher-update", "apply-result.json"),
    JSON.stringify({
      status: "error",
      message: "The launcher executable was locked."
    }),
    "utf8"
  );

  await updater.initialize({ releaseApiUrl: "https://api.github.com/repos/Valorith/eqemupatcher/releases/latest" });
  const state = await updater.checkForUpdate({ force: true, releaseApiUrl: "https://api.github.com/repos/Valorith/eqemupatcher/releases/latest" });

  assert.equal(state.status, "helper-error");
  assert.match(state.message, /Previous launcher update failed: The launcher executable was locked\./);
});

test("parseReleasePayload accepts version tags with and without a leading v", async (t) => {
  const { updater } = await createUpdaterHarness(t);
  const digest = `sha256:${sha256("launcher")}`;

  const withV = updater.parseReleasePayload(latestReleasePayload("v0.2.2", digest));
  const withoutV = updater.parseReleasePayload(latestReleasePayload("0.2.3", digest, { html_url: "https://example.invalid/release/0.2.3" }));

  assert.equal(withV.latestVersion, "0.2.2");
  assert.equal(withoutV.latestVersion, "0.2.3");
});

test("parseReleasePayload selects the portable Windows asset", async (t) => {
  const { updater } = await createUpdaterHarness(t);
  const digest = `sha256:${sha256("portable")}`;
  const release = updater.parseReleasePayload({
    tag_name: "v0.2.2",
    html_url: "https://example.invalid/release",
    assets: [
      {
        name: "EQEmu Launcher-0.2.2-macos.zip",
        browser_download_url: "https://example.invalid/macos.zip",
        size: 8,
        digest
      },
      {
        name: "EQEmu Launcher-0.2.2-windows-portable.exe",
        browser_download_url: "https://example.invalid/windows.exe",
        size: 16,
        digest
      }
    ]
  });

  assert.equal(release.assetName, "EQEmu Launcher-0.2.2-windows-portable.exe");
  assert.equal(release.downloadUrl, "https://example.invalid/windows.exe");
});

test("checkForUpdate uses ETag caching after the TTL expires", async (t) => {
  let requestCount = 0;
  const requests = [];
  const digest = `sha256:${sha256("launcher-0.2.2")}`;
  const { updater, appUserDataPath } = await createUpdaterHarness(t, {
    fetchImpl: async (_url, options) => {
      requestCount += 1;
      requests.push(options?.headers || {});
      if (requestCount === 1) {
        return createJsonResponse(200, latestReleasePayload("v0.2.2", digest), { etag: '"release-v1"' });
      }
      return {
        ok: false,
        status: 304,
        headers: createHeaders({ etag: '"release-v1"' }),
        json: async () => ({})
      };
    }
  });

  await updater.initialize({ releaseApiUrl: "https://api.github.com/repos/Valorith/eqemupatcher/releases/latest" });
  await updater.checkForUpdate({ force: true, releaseApiUrl: "https://api.github.com/repos/Valorith/eqemupatcher/releases/latest" });

  const cachePath = path.join(appUserDataPath, "launcher-update", "release-cache.json");
  const cache = JSON.parse(await fsp.readFile(cachePath, "utf8"));
  cache.checkedAt = new Date(Date.now() - (7 * 60 * 60 * 1000)).toISOString();
  await fsp.writeFile(cachePath, JSON.stringify(cache, null, 2), "utf8");
  updater.releaseCache.checkedAt = cache.checkedAt;

  const state = await updater.checkForUpdate({ releaseApiUrl: "https://api.github.com/repos/Valorith/eqemupatcher/releases/latest" });

  assert.equal(requestCount, 2);
  assert.equal(requests[1]["If-None-Match"] || requests[1]["if-none-match"], '"release-v1"');
  assert.equal(state.status, "available");
});

test("force refresh bypasses conditional release cache validators", async (t) => {
  const requests = [];
  const digest = `sha256:${sha256("launcher-0.2.2")}`;
  const { updater } = await createUpdaterHarness(t, {
    fetchImpl: async (_url, options) => {
      requests.push(options?.headers || {});
      return createJsonResponse(200, latestReleasePayload(requests.length === 1 ? "v0.2.2" : "v0.2.3", digest), { etag: '"release-v1"' });
    }
  });

  await updater.initialize({ releaseApiUrl: "https://api.github.com/repos/Valorith/eqemupatcher/releases/latest" });
  await updater.checkForUpdate({ force: true, releaseApiUrl: "https://api.github.com/repos/Valorith/eqemupatcher/releases/latest" });
  await updater.checkForUpdate({ force: true, releaseApiUrl: "https://api.github.com/repos/Valorith/eqemupatcher/releases/latest" });

  assert.equal("If-None-Match" in requests[1], false);
  assert.equal("if-none-match" in requests[1], false);
});

test("checkForUpdate requires a SHA-256 digest on the release asset", async (t) => {
  const { updater } = await createUpdaterHarness(t, {
    fetchImpl: async () =>
      createJsonResponse(200, {
        tag_name: "v0.2.2",
        html_url: "https://github.com/Valorith/eqemupatcher/releases/tag/v0.2.2",
        assets: [
          {
            name: "EQEmu Launcher-0.2.2-windows-portable.exe",
            browser_download_url: "https://example.invalid/windows.exe",
            size: 10
          }
        ]
      })
  });

  await updater.initialize({ releaseApiUrl: "https://api.github.com/repos/Valorith/eqemupatcher/releases/latest" });
  const state = await updater.checkForUpdate({ force: true, releaseApiUrl: "https://api.github.com/repos/Valorith/eqemupatcher/releases/latest" });

  assert.equal(state.status, "error");
  assert.match(state.message, /missing a SHA-256 digest/i);
});

test("startDownload verifies and stages the launcher, then reuses the staged copy", async (t) => {
  const payload = Buffer.from("portable launcher payload");
  const digest = sha256(payload);
  let releaseRequests = 0;
  let downloadRequests = 0;
  const { updater, appUserDataPath } = await createUpdaterHarness(t, {
    fetchImpl: async (url) => {
      if (/api\.github\.com/.test(url)) {
        releaseRequests += 1;
        return createJsonResponse(200, latestReleasePayload("v0.2.2", `sha256:${digest}`, { size: payload.length }));
      }

      downloadRequests += 1;
      return createDownloadResponse(200, payload);
    }
  });

  await updater.initialize({ releaseApiUrl: "https://api.github.com/repos/Valorith/eqemupatcher/releases/latest" });
  await updater.checkForUpdate({ force: true, releaseApiUrl: "https://api.github.com/repos/Valorith/eqemupatcher/releases/latest" });

  const first = await updater.startDownload({ releaseApiUrl: "https://api.github.com/repos/Valorith/eqemupatcher/releases/latest" });
  const second = await updater.startDownload({ releaseApiUrl: "https://api.github.com/repos/Valorith/eqemupatcher/releases/latest" });
  const stagedMetadata = JSON.parse(await fsp.readFile(path.join(appUserDataPath, "launcher-update", "staged-update.json"), "utf8"));

  assert.equal(first.status, "ready");
  assert.equal(second.status, "ready");
  assert.equal(downloadRequests, 1);
  assert.equal(releaseRequests, 1);
  assert.equal(stagedMetadata.version, "0.2.2");
  assert.deepEqual(await fsp.readFile(stagedMetadata.filePath), payload);
});

test("applyUpdate spawns the PowerShell helper with the expected arguments", async (t) => {
  const payload = Buffer.from("portable launcher payload");
  const spawnCalls = [];
  const { updater, appUserDataPath, executablePath } = await createUpdaterHarness(t, {
    spawnImpl: (command, args, options) => {
      spawnCalls.push({ command, args, options });
      const child = new EventEmitter();
      child.unref = () => {};
      process.nextTick(() => child.emit("spawn"));
      return child;
    }
  });

  const stagedDirectory = path.join(appUserDataPath, "launcher-update", "staged", "0.2.2");
  const stagedPath = path.join(stagedDirectory, "EQEmu Launcher-0.2.2-windows-portable.exe");
  await fsp.mkdir(stagedDirectory, { recursive: true });
  await fsp.writeFile(stagedPath, payload);
  await fsp.writeFile(
    path.join(appUserDataPath, "launcher-update", "staged-update.json"),
    JSON.stringify({
      version: "0.2.2",
      assetName: path.basename(stagedPath),
      filePath: stagedPath,
      sha256: sha256(payload),
      size: payload.length,
      releaseUrl: "https://github.com/Valorith/eqemupatcher/releases/tag/v0.2.2"
    }),
    "utf8"
  );

  await updater.initialize({ releaseApiUrl: "https://api.github.com/repos/Valorith/eqemupatcher/releases/latest" });
  const result = await updater.applyUpdate();

  assert.equal(result.ok, true);
  assert.equal(result.shouldQuit, true);
  assert.equal(spawnCalls.length, 1);
  assert.equal(spawnCalls[0].command, "powershell.exe");
  assert.ok(spawnCalls[0].args.includes("-ParentPid"));
  assert.ok(spawnCalls[0].args.includes(executablePath));
  assert.ok(spawnCalls[0].args.includes(stagedPath));
  assert.equal(result.state.status, "applying");
});

test("applyUpdate refuses to continue when the launcher directory is not writable", async (t) => {
  const payload = Buffer.from("portable launcher payload");
  const { updater, appUserDataPath } = await createUpdaterHarness(t);
  const stagedDirectory = path.join(appUserDataPath, "launcher-update", "staged", "0.2.2");
  const stagedPath = path.join(stagedDirectory, "EQEmu Launcher-0.2.2-windows-portable.exe");

  await fsp.mkdir(stagedDirectory, { recursive: true });
  await fsp.writeFile(stagedPath, payload);
  await fsp.writeFile(
    path.join(appUserDataPath, "launcher-update", "staged-update.json"),
    JSON.stringify({
      version: "0.2.2",
      assetName: path.basename(stagedPath),
      filePath: stagedPath,
      sha256: sha256(payload),
      size: payload.length,
      releaseUrl: "https://github.com/Valorith/eqemupatcher/releases/tag/v0.2.2"
    }),
    "utf8"
  );

  await updater.initialize({ releaseApiUrl: "https://api.github.com/repos/Valorith/eqemupatcher/releases/latest" });
  updater.preflightWritableDirectory = async () => {
    throw new Error("Access denied");
  };

  const result = await updater.applyUpdate();

  assert.equal(result.ok, false);
  assert.equal(result.shouldQuit, false);
  assert.equal(result.state.status, "error");
  assert.match(result.state.message, /Access denied/);
});
