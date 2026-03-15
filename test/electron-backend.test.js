const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const { LauncherBackend } = require("../src/electron/backend/launcher-backend");

function md5(text) {
  return crypto.createHash("md5").update(text).digest("hex").toUpperCase();
}

function sha256(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

async function createTempDir(prefix) {
  return fsp.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function createBackendHarness(t, options = {}) {
  const projectRoot = await createTempDir("eqemu-project-");
  const appUserDataPath = await createTempDir("eqemu-user-");
  const events = [];

  t.after(async () => {
    await fsp.rm(projectRoot, { recursive: true, force: true });
    await fsp.rm(appUserDataPath, { recursive: true, force: true });
  });

  return {
    backend: new LauncherBackend({
      appUserDataPath,
      projectRoot,
      eventSink: (event) => events.push(event),
      ...options
    }),
    projectRoot,
    appUserDataPath,
    events
  };
}

async function startFixtureServer(routes) {
  const server = http.createServer((req, res) => {
    const handler = routes[req.url];
    if (!handler) {
      res.writeHead(404);
      res.end("missing");
      return;
    }

    handler(req, res);
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`
  };
}

test("initialize without a selected game directory reports selection state", async (t) => {
  const { backend, appUserDataPath } = await createBackendHarness(t);

  const state = await backend.initialize();

  assert.equal(state.gameDirectory, "");
  assert.equal(state.statusBadge, "Run In Folder");
  assert.equal(state.patchActionLabel, "Deploy Patch");
  assert.equal(state.autoPatch, false);
  assert.equal(state.autoPlay, false);

  const appStatePath = path.join(appUserDataPath, "launcher-state.yml");
  const savedState = await fsp.readFile(appStatePath, "utf8");
  assert.match(savedState, /gameDirectory: ""/);
});

test("initialize uses the launcher directory when it already contains eqgame.exe", async (t) => {
  const launchDirectory = await createTempDir("eqemu-launch-");
  const { backend, appUserDataPath } = await createBackendHarness(t, { launchDirectory });

  t.after(async () => {
    await fsp.rm(launchDirectory, { recursive: true, force: true });
  });

  await fsp.writeFile(path.join(launchDirectory, "eqgame.exe"), "dummy", "utf8");

  const state = await backend.initialize();

  assert.equal(state.gameDirectory, launchDirectory);

  const appStatePath = path.join(appUserDataPath, "launcher-state.yml");
  const savedState = await fsp.readFile(appStatePath, "utf8");
  assert.match(savedState, /gameDirectory:/);
  assert.match(savedState, /eqemu-launch-/);
});

test("launch directory config overrides the bundled default server config", async (t) => {
  const launchDirectory = await createTempDir("eqemu-launch-");
  const { backend, projectRoot } = await createBackendHarness(t, { launchDirectory });

  t.after(async () => {
    await fsp.rm(launchDirectory, { recursive: true, force: true });
  });

  await fsp.writeFile(
    path.join(projectRoot, "launcher-config.yml"),
    "serverName: Bundled Default\nfilelistUrl: https://default.invalid/\n",
    "utf8"
  );
  await fsp.writeFile(
    path.join(launchDirectory, "launcher-config.yml"),
    "serverName: Install Realm\nfilelistUrl: https://install.invalid/\npatchNotesUrl: https://install.invalid/notes.md\nsupportedClients:\n  - Rain_Of_Fear\n",
    "utf8"
  );

  const state = await backend.initialize();

  assert.equal(state.serverName, "Install Realm");
  assert.equal(state.filelistUrl, "https://install.invalid/");
  assert.equal(state.patchNotesUrl, "https://install.invalid/notes.md");
});

test("runtime directory config is used when launch directory has no config", async (t) => {
  const launchDirectory = await createTempDir("eqemu-launch-");
  const runtimeDirectory = await createTempDir("eqemu-runtime-");
  const { backend, projectRoot } = await createBackendHarness(t, { launchDirectory, runtimeDirectory });

  t.after(async () => {
    await fsp.rm(launchDirectory, { recursive: true, force: true });
    await fsp.rm(runtimeDirectory, { recursive: true, force: true });
  });

  await fsp.writeFile(
    path.join(projectRoot, "launcher-config.yml"),
    "serverName: Bundled Default\nfilelistUrl: https://default.invalid/\n",
    "utf8"
  );
  await fsp.writeFile(
    path.join(runtimeDirectory, "launcher-config.yml"),
    "serverName: Portable Realm\nfilelistUrl: https://portable.invalid/\nsupportedClients:\n  - Rain_Of_Fear\n",
    "utf8"
  );

  const state = await backend.initialize();

  assert.equal(state.serverName, "Portable Realm");
  assert.equal(state.filelistUrl, "https://portable.invalid/");
  assert.equal(await fsp.readFile(path.join(launchDirectory, "launcher-config.yml"), "utf8"), await fsp.readFile(path.join(runtimeDirectory, "launcher-config.yml"), "utf8"));
});

test("setGameDirectory seeds launcher-config.yml into the selected game directory and uses it", async (t) => {
  const { backend, projectRoot } = await createBackendHarness(t);
  const gameDirectory = await createTempDir("eqemu-game-");

  t.after(async () => {
    await fsp.rm(gameDirectory, { recursive: true, force: true });
  });

  await fsp.writeFile(
    path.join(projectRoot, "launcher-config.yml"),
    "serverName: Bundled Default\nfilelistUrl: https://default.invalid/\npatchNotesUrl: https://default.invalid/notes.md\n",
    "utf8"
  );
  await fsp.writeFile(path.join(gameDirectory, "eqgame.exe"), "dummy", "utf8");

  await backend.initialize();
  const state = await backend.setGameDirectory(gameDirectory);
  const seededConfig = await fsp.readFile(path.join(gameDirectory, "launcher-config.yml"), "utf8");

  assert.equal(state.serverName, "Bundled Default");
  assert.equal(state.filelistUrl, "https://default.invalid/");
  assert.equal(state.patchNotesUrl, "https://default.invalid/notes.md");
  assert.match(seededConfig, /serverName: Bundled Default/);
  assert.match(seededConfig, /filelistUrl: https:\/\/default\.invalid\//);
});

test("legacy placeholder server names are replaced with a label derived from the patch host", async (t) => {
  const { backend, projectRoot } = await createBackendHarness(t);

  await fsp.writeFile(
    path.join(projectRoot, "launcher-config.yml"),
    "serverName: Rebuild EQ\nfilelistUrl: https://patch.clumsysworld.com/\n",
    "utf8"
  );

  const state = await backend.initialize();

  assert.equal(state.serverName, "Clumsy's World");
  assert.equal(state.filelistUrl, "https://patch.clumsysworld.com/");
});

test("refreshState recognizes a configured supported client and manifest status", async (t) => {
  const { backend, projectRoot } = await createBackendHarness(t, { platform: "win32" });
  const gameDirectory = await createTempDir("eqemu-game-");

  t.after(async () => {
    await fsp.rm(gameDirectory, { recursive: true, force: true });
  });

  const { server, baseUrl } = await startFixtureServer({
    "/rof/filelist_rof.yml": (_req, res) => {
      res.writeHead(200, { "content-type": "text/yaml" });
      res.end("version: 7\ndownloadprefix: http://127.0.0.1:1/files/\ndownloads: []\n");
    }
  });

  t.after(() => server.close());

  await fsp.writeFile(
    path.join(projectRoot, "launcher-config.yml"),
    `serverName: Test Realm\nfilelistUrl: ${baseUrl}/\ndefaultAutoPatch: false\ndefaultAutoPlay: false\nsupportedClients:\n  - Rain_Of_Fear\n`,
    "utf8"
  );

  await fsp.writeFile(path.join(gameDirectory, "eqgame.exe"), "dummy", "utf8");

  await backend.initialize();
  backend.detectClientVersion = async () => ({
    found: true,
    hash: "KNOWN",
    version: "Rain_Of_Fear"
  });

  const state = await backend.setGameDirectory(gameDirectory);

  assert.equal(state.serverName, "Test Realm");
  assert.equal(state.clientVersion, "Rain_Of_Fear");
  assert.equal(state.clientLabel, "Rain of Fear");
  assert.equal(state.manifestVersion, "7");
  assert.equal(state.needsPatch, true);
  assert.equal(state.canLaunch, false);
  assert.equal(state.patchActionLabel, "Deploy Patch");
  assert.equal(state.statusBadge, "Update Ready");
});

test("detectClientVersion matches the Rain_Of_Fear_2_4GB hash", async (t) => {
  const { backend } = await createBackendHarness(t);
  const gameDirectory = await createTempDir("eqemu-game-");

  t.after(async () => {
    await fsp.rm(gameDirectory, { recursive: true, force: true });
  });

  await fsp.writeFile(path.join(gameDirectory, "eqgame.exe"), "dummy", "utf8");
  backend.state.gameDirectory = gameDirectory;
  backend.getFileHash = async () => "389709EC0E456C3DAE881A61218AAB3F";

  const result = await backend.detectClientVersion();

  assert.deepEqual(result, {
    found: true,
    hash: "389709EC0E456C3DAE881A61218AAB3F",
    version: "Rain_Of_Fear_2_4GB"
  });
});

test("manifest and download URLs work without trailing slashes", async (t) => {
  const { backend, projectRoot } = await createBackendHarness(t);
  const gameDirectory = await createTempDir("eqemu-game-");
  const downloadContent = "patched content";
  const downloadHash = md5(downloadContent);
  let manifestRequests = 0;
  let fileRequests = 0;

  t.after(async () => {
    await fsp.rm(gameDirectory, { recursive: true, force: true });
  });

  const { server, baseUrl } = await startFixtureServer({
    "/patch/rof/filelist_rof.yml": (_req, res) => {
      manifestRequests += 1;
      res.writeHead(200, { "content-type": "text/yaml" });
      res.end(
        [
          "version: 11",
          `downloadprefix: ${baseUrl}/downloads`,
          "downloads:",
          "  - name: target.txt",
          `    md5: ${downloadHash}`,
          `    size: ${Buffer.byteLength(downloadContent)}`,
          ""
        ].join("\n")
      );
    },
    "/downloads/target.txt": (_req, res) => {
      fileRequests += 1;
      res.writeHead(200, { "content-type": "application/octet-stream" });
      res.end(downloadContent);
    }
  });

  t.after(() => server.close());

  await fsp.writeFile(
    path.join(projectRoot, "launcher-config.yml"),
    `serverName: Test Realm\nfilelistUrl: ${baseUrl}/patch\ndefaultAutoPatch: false\ndefaultAutoPlay: false\nsupportedClients:\n  - Rain_Of_Fear\n`,
    "utf8"
  );

  await fsp.writeFile(path.join(gameDirectory, "eqgame.exe"), "dummy", "utf8");

  await backend.initialize();
  backend.detectClientVersion = async () => ({
    found: true,
    hash: "KNOWN",
    version: "Rain_Of_Fear"
  });

  const refreshed = await backend.setGameDirectory(gameDirectory);
  const patched = await backend.startPatch();

  assert.equal(refreshed.manifestVersion, "11");
  assert.equal(patched.needsPatch, false);
  assert.equal(await fsp.readFile(path.join(gameDirectory, "target.txt"), "utf8"), downloadContent);
  assert.equal(manifestRequests, 1);
  assert.equal(fileRequests, 1);
});

test("startPatch downloads changed files, writes settings, and clears needsPatch", async (t) => {
  const { backend, projectRoot } = await createBackendHarness(t);
  const gameDirectory = await createTempDir("eqemu-game-");
  const downloadContent = "patched content";
  const downloadHash = md5(downloadContent);
  const downloadSize = Buffer.byteLength(downloadContent);

  t.after(async () => {
    await fsp.rm(gameDirectory, { recursive: true, force: true });
  });

  const { server, baseUrl } = await startFixtureServer({
    "/rof/filelist_rof.yml": (_req, res) => {
      res.writeHead(200, { "content-type": "text/yaml" });
      res.end(
        [
          "version: 42",
          `downloadprefix: ${baseUrl}/files/`,
          "downloads:",
          "  - name: target.txt",
          `    md5: ${downloadHash}`,
          `    size: ${downloadSize}`,
          "deletes: []",
          ""
        ].join("\n")
      );
    },
    "/files/target.txt": (_req, res) => {
      res.writeHead(200, { "content-type": "application/octet-stream" });
      res.end(downloadContent);
    }
  });

  t.after(() => server.close());

  await fsp.writeFile(
    path.join(projectRoot, "launcher-config.yml"),
    `serverName: Test Realm\nfilelistUrl: ${baseUrl}/\ndefaultAutoPatch: false\ndefaultAutoPlay: false\nsupportedClients:\n  - Rain_Of_Fear\n`,
    "utf8"
  );

  await fsp.writeFile(path.join(gameDirectory, "eqgame.exe"), "dummy", "utf8");

  await backend.initialize();
  backend.detectClientVersion = async () => ({
    found: true,
    hash: "KNOWN",
    version: "Rain_Of_Fear"
  });

  await backend.setGameDirectory(gameDirectory);
  const state = await backend.startPatch();

  const patchedFile = await fsp.readFile(path.join(gameDirectory, "target.txt"), "utf8");
  const savedSettings = await fsp.readFile(path.join(gameDirectory, "eqemupatcher.yml"), "utf8");

  assert.equal(patchedFile, downloadContent);
  assert.equal(state.needsPatch, false);
  assert.equal(state.lastPatchedVersion, "42");
  assert.match(savedSettings, /lastPatchedVersion: 42/);
});

test("startPatch rejects downloaded files that fail hash verification", async (t) => {
  const { backend, projectRoot, events } = await createBackendHarness(t);
  const gameDirectory = await createTempDir("eqemu-game-");
  const expectedContent = "expected content";
  const servedContent = "wrong content";

  t.after(async () => {
    await fsp.rm(gameDirectory, { recursive: true, force: true });
  });

  const { server, baseUrl } = await startFixtureServer({
    "/rof/filelist_rof.yml": (_req, res) => {
      res.writeHead(200, { "content-type": "text/yaml" });
      res.end(
        [
          "version: 77",
          `downloadprefix: ${baseUrl}/files/`,
          "downloads:",
          "  - name: target.txt",
          `    md5: ${md5(expectedContent)}`,
          `    size: ${Buffer.byteLength(servedContent)}`,
          ""
        ].join("\n")
      );
    },
    "/files/target.txt": (_req, res) => {
      res.writeHead(200, { "content-type": "application/octet-stream" });
      res.end(servedContent);
    }
  });

  t.after(() => server.close());

  await fsp.writeFile(
    path.join(projectRoot, "launcher-config.yml"),
    `serverName: Test Realm\nfilelistUrl: ${baseUrl}/\ndefaultAutoPatch: false\ndefaultAutoPlay: false\nsupportedClients:\n  - Rain_Of_Fear\n`,
    "utf8"
  );

  await fsp.writeFile(path.join(gameDirectory, "eqgame.exe"), "dummy", "utf8");

  await backend.initialize();
  backend.detectClientVersion = async () => ({
    found: true,
    hash: "KNOWN",
    version: "Rain_Of_Fear"
  });

  await backend.setGameDirectory(gameDirectory);
  const state = await backend.startPatch();

  assert.equal(state.statusBadge, "Patch Error");
  assert.equal(state.patchActionLabel, "Deploy Patch");
  assert.equal(state.needsPatch, true);
  assert.equal(state.lastPatchedVersion, "");
  assert.equal(await fsp.access(path.join(gameDirectory, "target.txt")).then(() => true).catch(() => false), false);
  assert.ok(events.some((event) => event.type === "log" && /Downloaded file failed verification: target\.txt/.test(event.payload.text)));
});

test("refreshState treats legacy string patch versions as up to date", async (t) => {
  const { backend, projectRoot } = await createBackendHarness(t, { platform: "win32" });
  const gameDirectory = await createTempDir("eqemu-game-");

  t.after(async () => {
    await fsp.rm(gameDirectory, { recursive: true, force: true });
  });

  const { server, baseUrl } = await startFixtureServer({
    "/rof/filelist_rof.yml": (_req, res) => {
      res.writeHead(200, { "content-type": "text/yaml" });
      res.end("version: 42\ndownloadprefix: http://127.0.0.1:1/files/\ndownloads: []\n");
    }
  });

  t.after(() => server.close());

  await fsp.writeFile(
    path.join(projectRoot, "launcher-config.yml"),
    `serverName: Test Realm\nfilelistUrl: ${baseUrl}/\ndefaultAutoPatch: false\ndefaultAutoPlay: false\nsupportedClients:\n  - Rain_Of_Fear\n`,
    "utf8"
  );

  await fsp.writeFile(path.join(gameDirectory, "eqgame.exe"), "dummy", "utf8");
  await fsp.writeFile(
    path.join(gameDirectory, "eqemupatcher.yml"),
    'autoPatch: "false"\nautoPlay: "false"\nclientVersion: Rain_Of_Fear\nlastPatchedVersion: "42"\n',
    "utf8"
  );

  await backend.initialize();
  backend.detectClientVersion = async () => ({
    found: true,
    hash: "KNOWN",
    version: "Rain_Of_Fear"
  });

  const state = await backend.setGameDirectory(gameDirectory);

  assert.equal(state.manifestVersion, "42");
  assert.equal(state.lastPatchedVersion, "42");
  assert.equal(state.needsPatch, false);
  assert.equal(state.canLaunch, true);
  assert.equal(state.statusBadge, "Ready");
});

test("unknown clients remain non-launchable even on Windows", async (t) => {
  let spawnCalls = 0;
  const { backend } = await createBackendHarness(t, {
    platform: "win32",
    spawnImpl: () => {
      spawnCalls += 1;
      throw new Error("spawn should not be reached");
    }
  });
  const gameDirectory = await createTempDir("eqemu-game-");

  t.after(async () => {
    await fsp.rm(gameDirectory, { recursive: true, force: true });
  });

  await fsp.writeFile(path.join(gameDirectory, "eqgame.exe"), "dummy", "utf8");

  await backend.initialize();
  backend.detectClientVersion = async () => ({
    found: true,
    hash: "MYSTERY",
    version: "Unknown"
  });

  const state = await backend.setGameDirectory(gameDirectory);
  assert.equal(state.canLaunch, false);
  assert.equal(state.statusBadge, "Client Unknown");

  const launchState = await backend.launchGame();
  assert.equal(launchState.statusBadge, "Client Unknown");
  assert.equal(spawnCalls, 0);
});

test("unsupported clients are blocked from launch in the backend", async (t) => {
  let spawnCalls = 0;
  const { backend, projectRoot } = await createBackendHarness(t, {
    platform: "win32",
    spawnImpl: () => {
      spawnCalls += 1;
      throw new Error("spawn should not be reached");
    }
  });
  const gameDirectory = await createTempDir("eqemu-game-");

  t.after(async () => {
    await fsp.rm(gameDirectory, { recursive: true, force: true });
  });

  await fsp.writeFile(
    path.join(projectRoot, "launcher-config.yml"),
    "serverName: Test Realm\nfilelistUrl: https://example.invalid/\nsupportedClients:\n  - Rain_Of_Fear\n",
    "utf8"
  );
  await fsp.writeFile(path.join(gameDirectory, "eqgame.exe"), "dummy", "utf8");

  await backend.initialize();
  backend.detectClientVersion = async () => ({
    found: true,
    hash: "KNOWN",
    version: "Titanium"
  });

  const state = await backend.setGameDirectory(gameDirectory);
  assert.equal(state.clientSupported, false);
  assert.equal(state.canLaunch, false);
  assert.equal(state.statusBadge, "Unsupported");

  const launchState = await backend.launchGame();
  assert.equal(launchState.statusBadge, "Unsupported");
  assert.equal(spawnCalls, 0);
});

test("startPatch reports manifest bootstrap failures without rejecting", async (t) => {
  const { backend, projectRoot, events } = await createBackendHarness(t);
  const gameDirectory = await createTempDir("eqemu-game-");

  t.after(async () => {
    await fsp.rm(gameDirectory, { recursive: true, force: true });
  });

  await fsp.writeFile(
    path.join(projectRoot, "launcher-config.yml"),
    "serverName: Test Realm\nfilelistUrl: http://127.0.0.1:9/\nsupportedClients:\n  - Rain_Of_Fear\n",
    "utf8"
  );
  await fsp.writeFile(path.join(gameDirectory, "eqgame.exe"), "dummy", "utf8");

  await backend.initialize();
  backend.detectClientVersion = async () => ({
    found: true,
    hash: "KNOWN",
    version: "Rain_Of_Fear"
  });

  await backend.setGameDirectory(gameDirectory);
  const state = await backend.startPatch();

  assert.equal(state.statusBadge, "Manifest Error");
  assert.equal(state.patchActionLabel, "Manifest Error");
  assert.equal(state.isPatching, false);
  assert.equal(state.needsPatch, false);
  assert.ok(events.some((event) => event.type === "log" && /Patch preparation failed:/.test(event.payload.text)));
});

test("startPatch blocks unknown clients before manifest verification", async (t) => {
  const { backend } = await createBackendHarness(t);
  const gameDirectory = await createTempDir("eqemu-game-");

  t.after(async () => {
    await fsp.rm(gameDirectory, { recursive: true, force: true });
  });

  backend.state.gameDirectory = gameDirectory;
  backend.state.clientVersion = "Unknown";
  backend.state.clientHash = "ABC123";
  backend.state.clientSupported = false;
  backend.fetchManifest = async () => {
    throw new Error("fetchManifest should not be called");
  };

  const state = await backend.startPatch();

  assert.equal(state.statusBadge, "Client Unknown");
  assert.equal(state.patchActionLabel, "Unsupported Client");
  assert.equal(state.canPatch, false);
  assert.equal(state.canLaunch, false);
});

test("startPatch blocks unsupported clients before manifest verification", async (t) => {
  const { backend } = await createBackendHarness(t);
  const gameDirectory = await createTempDir("eqemu-game-");

  t.after(async () => {
    await fsp.rm(gameDirectory, { recursive: true, force: true });
  });

  backend.state.gameDirectory = gameDirectory;
  backend.state.serverName = "Test Realm";
  backend.state.clientVersion = "Rain_Of_Fear";
  backend.state.clientLabel = "Rain of Fear";
  backend.state.clientSupported = false;
  backend.fetchManifest = async () => {
    throw new Error("fetchManifest should not be called");
  };

  const state = await backend.startPatch();

  assert.equal(state.statusBadge, "Unsupported");
  assert.equal(state.patchActionLabel, "Unsupported Build");
  assert.equal(state.canPatch, false);
  assert.equal(state.canLaunch, false);
});

test("custom eqemupatcher.png overrides the default hero image", async (t) => {
  const { backend, projectRoot } = await createBackendHarness(t);
  const gameDirectory = await createTempDir("eqemu-game-");

  t.after(async () => {
    await fsp.rm(gameDirectory, { recursive: true, force: true });
  });

  const { server, baseUrl } = await startFixtureServer({
    "/rof/filelist_rof.yml": (_req, res) => {
      res.writeHead(200, { "content-type": "text/yaml" });
      res.end("version: 1\ndownloadprefix: http://127.0.0.1:1/files/\ndownloads: []\n");
    }
  });

  t.after(() => server.close());

  await fsp.writeFile(
    path.join(projectRoot, "launcher-config.yml"),
    `serverName: Test Realm\nfilelistUrl: ${baseUrl}/\ndefaultAutoPatch: false\ndefaultAutoPlay: false\nsupportedClients:\n  - Rain_Of_Fear\n`,
    "utf8"
  );

  await fsp.writeFile(path.join(gameDirectory, "eqgame.exe"), "dummy", "utf8");
  await fsp.writeFile(path.join(gameDirectory, "eqemupatcher.png"), "png", "utf8");

  await backend.initialize();
  backend.detectClientVersion = async () => ({
    found: true,
    hash: "KNOWN",
    version: "Rain_Of_Fear"
  });

  const state = await backend.setGameDirectory(gameDirectory);

  assert.match(state.heroImageUrl, /eqemupatcher\.png$/);
});

test("patch completion does not auto-launch even when autoPlay is enabled", async (t) => {
  let spawnCalls = 0;
  const { backend, projectRoot } = await createBackendHarness(t, {
    platform: "win32",
    spawnImpl: () => {
      spawnCalls += 1;
      throw new Error("spawn should not be reached");
    }
  });
  const gameDirectory = await createTempDir("eqemu-game-");
  const downloadContent = "patched content";
  const downloadHash = md5(downloadContent);

  t.after(async () => {
    await fsp.rm(gameDirectory, { recursive: true, force: true });
  });

  const { server, baseUrl } = await startFixtureServer({
    "/rof/filelist_rof.yml": (_req, res) => {
      res.writeHead(200, { "content-type": "text/yaml" });
      res.end(
        [
          "version: 9",
          `downloadprefix: ${baseUrl}/files/`,
          "downloads:",
          "  - name: target.txt",
          `    md5: ${downloadHash}`,
          `    size: ${Buffer.byteLength(downloadContent)}`,
          ""
        ].join("\n")
      );
    },
    "/files/target.txt": (_req, res) => {
      res.writeHead(200, { "content-type": "application/octet-stream" });
      res.end(downloadContent);
    }
  });

  t.after(() => server.close());

  await fsp.writeFile(
    path.join(projectRoot, "launcher-config.yml"),
    `serverName: Test Realm\nfilelistUrl: ${baseUrl}/\ndefaultAutoPatch: false\ndefaultAutoPlay: false\nsupportedClients:\n  - Rain_Of_Fear\n`,
    "utf8"
  );
  await fsp.writeFile(path.join(gameDirectory, "eqgame.exe"), "dummy", "utf8");

  await backend.initialize();
  backend.detectClientVersion = async () => ({
    found: true,
    hash: "KNOWN",
    version: "Rain_Of_Fear"
  });

  await backend.setGameDirectory(gameDirectory);
  await backend.updateSettings({ autoPlay: true });
  const state = await backend.startPatch();

  assert.equal(state.needsPatch, false);
  assert.equal(state.statusBadge, "Ready");
  assert.equal(spawnCalls, 0);
});

test("launchGame falls back to cmd.exe when direct spawn is denied on Windows", async (t) => {
  const spawnCalls = [];
  const { backend } = await createBackendHarness(t, {
    platform: "win32",
    launchStabilizationMs: 10,
    spawnImpl: (command, args, options) => {
      spawnCalls.push({ command, args, options });
      const child = new EventEmitter();
      child.unref = () => {};

      process.nextTick(() => {
        if (spawnCalls.length === 1) {
          const error = new Error("access denied");
          error.code = "EACCES";
          child.emit("error", error);
          return;
        }

        child.emit("spawn");
      });

      return child;
    }
  });
  const gameDirectory = await createTempDir("eqemu-game-");

  t.after(async () => {
    await fsp.rm(gameDirectory, { recursive: true, force: true });
  });

  await fsp.writeFile(path.join(gameDirectory, "eqgame.exe"), "dummy", "utf8");
  backend.state.gameDirectory = gameDirectory;
  backend.state.clientVersion = "Rain_Of_Fear_2";
  backend.state.clientLabel = "Rain of Fear 2";
  backend.state.clientSupported = true;

  const state = await backend.launchGame();

  assert.equal(state.statusBadge, "Launching");
  assert.equal(spawnCalls.length, 2);
  assert.equal(spawnCalls[0].command, path.join(gameDirectory, "eqgame.exe"));
  assert.equal(spawnCalls[1].command.toLowerCase().endsWith("cmd.exe"), true);
  assert.deepEqual(spawnCalls[1].args.slice(0, 6), ["/d", "/s", "/c", "start", '""', "/d"]);
  assert.equal(spawnCalls[1].args[6], gameDirectory);
  assert.equal(spawnCalls[1].args[7], path.join(gameDirectory, "eqgame.exe"));
  assert.equal(spawnCalls[1].args[8], "patchme");
});

test("launchGame reports an immediate exit instead of claiming success", async (t) => {
  const { backend, events } = await createBackendHarness(t, {
    platform: "win32",
    launchStabilizationMs: 10,
    spawnImpl: () => {
      const child = new EventEmitter();
      child.unref = () => {};

      process.nextTick(() => {
        child.emit("spawn");
        child.emit("exit", 1, null);
      });

      return child;
    }
  });
  const gameDirectory = await createTempDir("eqemu-game-");

  t.after(async () => {
    await fsp.rm(gameDirectory, { recursive: true, force: true });
  });

  await fsp.writeFile(path.join(gameDirectory, "eqgame.exe"), "dummy", "utf8");
  backend.state.gameDirectory = gameDirectory;
  backend.state.clientVersion = "Rain_Of_Fear_2";
  backend.state.clientLabel = "Rain of Fear 2";
  backend.state.clientSupported = true;

  const state = await backend.launchGame();
  const logMessages = events.filter((event) => event.type === "log").map((event) => event.payload.text);

  assert.equal(state.statusBadge, "Launch Error");
  assert.match(state.statusDetail, /eqgame\.exe exited immediately \(exit code 1 \/ 0x00000001\)\./i);
  assert(logMessages.includes("Launch method: direct spawn."));
  assert(logMessages.includes("Startup status: 0x00000001."));
  assert(logMessages.includes("Suggested fix: run eqgame.exe patchme manually from the EverQuest folder to check for a Windows dialog or missing dependency prompt."));
});

test("launchGame includes Windows dependency hints for missing DLL startup failures", async (t) => {
  const missingDllExitCode = 0xC0000135;
  const { backend, events } = await createBackendHarness(t, {
    platform: "win32",
    launchStabilizationMs: 10,
    spawnImpl: () => {
      const child = new EventEmitter();
      child.unref = () => {};

      process.nextTick(() => {
        child.emit("spawn");
        child.emit("exit", missingDllExitCode, null);
      });

      return child;
    }
  });
  const gameDirectory = await createTempDir("eqemu-game-");

  t.after(async () => {
    await fsp.rm(gameDirectory, { recursive: true, force: true });
  });

  await fsp.writeFile(path.join(gameDirectory, "eqgame.exe"), "dummy", "utf8");
  backend.state.gameDirectory = gameDirectory;
  backend.state.clientVersion = "Rain_Of_Fear_2";
  backend.state.clientLabel = "Rain of Fear 2";
  backend.state.clientSupported = true;

  const state = await backend.launchGame();
  const logMessages = events.filter((event) => event.type === "log").map((event) => event.payload.text);

  assert.equal(state.statusBadge, "Launch Error");
  assert.match(state.statusDetail, /0xC0000135/i);
  assert.match(state.statusDetail, /required DLL was missing/i);
  assert.match(state.statusDetail, /DirectX 9 June 2010 runtime/i);
  assert(logMessages.includes("Launch method: direct spawn."));
  assert(logMessages.includes("Startup status: 0xC0000135 (STATUS_DLL_NOT_FOUND)."));
  assert(logMessages.includes("Assessment: A required DLL was missing during startup."));
  assert(logMessages.includes("Suggested fix: Install the DirectX 9 June 2010 runtime and the Visual C++ redistributables, then try again."));
});

test("remains compatible with legacy filelistbuilder manifest output", async (t) => {
  const { backend, projectRoot } = await createBackendHarness(t);
  const gameDirectory = await createTempDir("eqemu-game-");
  const nestedContent = "legacy patch payload";
  const nestedHashLower = md5(nestedContent).toLowerCase();

  t.after(async () => {
    await fsp.rm(gameDirectory, { recursive: true, force: true });
  });

  const { server, baseUrl } = await startFixtureServer({
    "/rof/filelist_rof.yml": (_req, res) => {
      res.writeHead(200, { "content-type": "text/yaml" });
      res.end(
        [
          "version: 20260310deadbeef",
          `downloadprefix: ${baseUrl}/rof/`,
          "downloads:",
          "  - name: Resources/asset.txt",
          `    md5: ${nestedHashLower}`,
          "    date: 20260310",
          `    size: ${Buffer.byteLength(nestedContent)}`,
          "deletes:",
          "  - name: oldfile.txt",
          ""
        ].join("\n")
      );
    },
    "/rof/Resources/asset.txt": (_req, res) => {
      res.writeHead(200, { "content-type": "application/octet-stream" });
      res.end(nestedContent);
    }
  });

  t.after(() => server.close());

  await fsp.writeFile(
    path.join(projectRoot, "launcher-config.yml"),
    `serverName: Legacy Realm\nfilelistUrl: ${baseUrl}/\ndefaultAutoPatch: false\ndefaultAutoPlay: false\nsupportedClients:\n  - Rain_Of_Fear\n`,
    "utf8"
  );

  await fsp.writeFile(path.join(gameDirectory, "eqgame.exe"), "dummy", "utf8");
  await fsp.writeFile(path.join(gameDirectory, "oldfile.txt"), "remove me", "utf8");

  await backend.initialize();
  backend.detectClientVersion = async () => ({
    found: true,
    hash: "KNOWN",
    version: "Rain_Of_Fear"
  });

  const refreshed = await backend.setGameDirectory(gameDirectory);
  assert.equal(refreshed.manifestVersion, "20260310deadbeef");
  assert.equal(refreshed.needsPatch, true);

  const state = await backend.startPatch();
  const nestedFile = await fsp.readFile(path.join(gameDirectory, "Resources", "asset.txt"), "utf8");

  assert.equal(nestedFile, nestedContent);
  assert.equal(await fsp.access(path.join(gameDirectory, "oldfile.txt")).then(() => true).catch(() => false), false);
  assert.equal(state.lastPatchedVersion, "20260310deadbeef");
  assert.equal(state.needsPatch, false);
});

test("repairs missing files from flush-left legacy manifest entries", async (t) => {
  const { backend, projectRoot } = await createBackendHarness(t);
  const gameDirectory = await createTempDir("eqemu-game-");
  const payload = "restored from legacy manifest";
  const payloadHash = md5(payload).toLowerCase();
  let fileRequests = 0;

  t.after(async () => {
    await fsp.rm(gameDirectory, { recursive: true, force: true });
  });

  const { server, baseUrl } = await startFixtureServer({
    "/rof/filelist_rof.yml": (_req, res) => {
      res.writeHead(200, { "content-type": "text/yaml" });
      res.end(
        [
          "version: 20260310legacyshape",
          "deletes:",
          "- name: old-file.txt",
          `downloadprefix: ${baseUrl}/rof/`,
          "downloads:",
          "- name: barter_assets.txt",
          `  md5: ${payloadHash}`,
          "  date: 20260310",
          `  size: ${Buffer.byteLength(payload)}`,
          ""
        ].join("\n")
      );
    },
    "/rof/barter_assets.txt": (_req, res) => {
      fileRequests += 1;
      res.writeHead(200, { "content-type": "application/octet-stream" });
      res.end(payload);
    }
  });

  t.after(() => server.close());

  await fsp.writeFile(
    path.join(projectRoot, "launcher-config.yml"),
    `serverName: Test Realm\nfilelistUrl: ${baseUrl}/\ndefaultAutoPatch: false\ndefaultAutoPlay: false\nsupportedClients:\n  - Rain_Of_Fear_2\n`,
    "utf8"
  );

  await fsp.writeFile(path.join(gameDirectory, "eqgame.exe"), "dummy", "utf8");

  await backend.initialize();
  backend.detectClientVersion = async () => ({
    found: true,
    hash: "KNOWN",
    version: "Rain_Of_Fear_2"
  });

  const refreshed = await backend.setGameDirectory(gameDirectory);
  assert.equal(refreshed.manifestVersion, "20260310legacyshape");
  assert.equal(refreshed.needsPatch, true);

  const state = await backend.startPatch();

  assert.equal(fileRequests, 1);
  assert.equal(await fsp.readFile(path.join(gameDirectory, "barter_assets.txt"), "utf8"), payload);
  assert.equal(state.lastPatchedVersion, "20260310legacyshape");
  assert.equal(state.needsPatch, false);
});


test("getPatchNotes loads markdown from configured patch notes URL", async (t) => {
  const { backend, projectRoot } = await createBackendHarness(t);
  const markdown = "# Updates\n\n- Fixed launcher refresh\n- Added notes search\n- [Safe](https://example.invalid/patches)\n- [Blocked](javascript:alert(1))\n";

  const { server, baseUrl } = await startFixtureServer({
    "/notes.md": (_req, res) => {
      res.writeHead(200, { "content-type": "text/markdown" });
      res.end(markdown);
    }
  });

  t.after(() => server.close());

  await fsp.writeFile(
    path.join(projectRoot, "launcher-config.yml"),
    `serverName: Test Realm
filelistUrl: ${baseUrl}/
patchNotesUrl: ${baseUrl}/notes.md
`,
    "utf8"
  );

  await backend.initialize();
  const notes = await backend.getPatchNotes({ forceRefresh: true });

  assert.equal(notes.url, `${baseUrl}/notes.md`);
  assert.match(notes.content, /Fixed launcher refresh/);
  assert.match(notes.html, /<h1>Updates<\/h1>/);
  assert.match(notes.html, /href="https:\/\/example\.invalid\/patches"/);
  assert.match(notes.html, /href="#"/);
  assert.equal(notes.contentHash, sha256(markdown));
  assert.equal(notes.error, "");
});

test("getPatchNotes repairs missing cached content hashes before falling back to cache", async (t) => {
  const { backend, projectRoot, appUserDataPath } = await createBackendHarness(t);
  const patchNotesUrl = "http://127.0.0.1:9/notes.md";
  const markdown = "# Cached\n\n- Existing entry\n";

  await fsp.writeFile(
    path.join(projectRoot, "launcher-config.yml"),
    `serverName: Test Realm
filelistUrl: http://127.0.0.1:9/
patchNotesUrl: ${patchNotesUrl}
`,
    "utf8"
  );
  await fsp.writeFile(
    path.join(appUserDataPath, "patch-notes-cache.json"),
    JSON.stringify({
      url: patchNotesUrl,
      content: markdown,
      html: "<h1>Cached</h1>",
      fetchedAt: "2026-03-14T00:00:00.000Z",
      lineCount: 3,
      etag: '"notes-v1"',
      lastModified: ""
    }),
    "utf8"
  );

  await backend.initialize();
  const notes = await backend.getPatchNotes();

  assert.equal(notes.url, patchNotesUrl);
  assert.equal(notes.content, markdown);
  assert.equal(notes.contentHash, sha256(markdown));
  assert.equal(notes.error, "");
});

test("getPatchNotes repairs markdown links missing the scheme colon", async (t) => {
  const { backend, projectRoot } = await createBackendHarness(t);

  const { server, baseUrl } = await startFixtureServer({
    "/notes.md": (_req, res) => {
      res.writeHead(200, { "content-type": "text/markdown" });
      res.end("[Website](https//www.clumsysworld.com/)\n");
    }
  });

  t.after(() => server.close());

  await fsp.writeFile(
    path.join(projectRoot, "launcher-config.yml"),
    `serverName: Test Realm
filelistUrl: ${baseUrl}/
patchNotesUrl: ${baseUrl}/notes.md
`,
    "utf8"
  );

  await backend.initialize();
  const notes = await backend.getPatchNotes({ forceRefresh: true });

  assert.match(notes.html, /href="https:\/\/www\.clumsysworld\.com\/"/);
});



test("getPatchNotes falls back to cached content when refresh fails", async (t) => {
  const { backend, projectRoot } = await createBackendHarness(t);

  const { server, baseUrl } = await startFixtureServer({
    "/notes.md": (_req, res) => {
      res.writeHead(200, {
        "content-type": "text/markdown",
        etag: '"notes-v1"'
      });
      res.end("# Updates\n\n- One\n- Two\n");
    }
  });

  await fsp.writeFile(
    path.join(projectRoot, "launcher-config.yml"),
    `serverName: Test Realm
filelistUrl: ${baseUrl}/
patchNotesUrl: ${baseUrl}/notes.md
`,
    "utf8"
  );

  await backend.initialize();
  const first = await backend.getPatchNotes({ forceRefresh: true });
  await new Promise((resolve) => server.close(resolve));
  const second = await backend.getPatchNotes({ forceRefresh: true });

  assert.match(first.content, /- One/);
  assert.equal(second.content, first.content);
  assert.equal(second.html, first.html);
  assert.equal(second.error, "");
});

test("getPatchNotes refreshes cached content on a normal load when the server has newer notes", async (t) => {
  const { backend, projectRoot } = await createBackendHarness(t);

  let requestCount = 0;
  const { server, baseUrl } = await startFixtureServer({
    "/notes.md": (req, res) => {
      requestCount += 1;

      if (requestCount === 1) {
        res.writeHead(200, {
          "content-type": "text/markdown",
          etag: '"notes-v1"'
        });
        res.end("# Notes\n\n- First\n");
        return;
      }

      assert.equal(req.headers["if-none-match"], '"notes-v1"');
      res.writeHead(200, {
        "content-type": "text/markdown",
        etag: '"notes-v2"'
      });
      res.end("# Notes\n\n- Second\n");
    }
  });

  t.after(() => server.close());

  await fsp.writeFile(
    path.join(projectRoot, "launcher-config.yml"),
    `serverName: Test Realm
filelistUrl: ${baseUrl}/
patchNotesUrl: ${baseUrl}/notes.md
`,
    "utf8"
  );

  await backend.initialize();
  const first = await backend.getPatchNotes({ forceRefresh: true });
  const second = await backend.getPatchNotes();

  assert.equal(requestCount, 2);
  assert.match(first.content, /First/);
  assert.match(second.content, /Second/);
  assert.equal(second.error, "");
});

test("getPatchNotes forceRefresh bypasses conditional cache validators", async (t) => {
  const { backend, projectRoot } = await createBackendHarness(t);

  let requestCount = 0;
  const { server, baseUrl } = await startFixtureServer({
    "/notes.md": (req, res) => {
      requestCount += 1;
      const ifNoneMatch = req.headers["if-none-match"];
      if (requestCount > 1 && ifNoneMatch === '"notes-v1"') {
        res.writeHead(304);
        res.end();
        return;
      }

      res.writeHead(200, {
        "content-type": "text/markdown",
        etag: requestCount === 1 ? '"notes-v1"' : '"notes-v2"'
      });
      res.end(requestCount === 1 ? "# Notes\n\n- First\n" : "# Notes\n\n- Second\n");
    }
  });

  t.after(() => server.close());

  await fsp.writeFile(
    path.join(projectRoot, "launcher-config.yml"),
    `serverName: Test Realm
filelistUrl: ${baseUrl}/
patchNotesUrl: ${baseUrl}/notes.md
`,
    "utf8"
  );

  await backend.initialize();
  const first = await backend.getPatchNotes({ forceRefresh: true });
  const second = await backend.getPatchNotes({ forceRefresh: true });

  assert.match(first.content, /First/);
  assert.match(second.content, /Second/);
  assert.equal(second.error, "");
});

test("getPatchNotes preserves nested bullet structure", async (t) => {
  const { backend, projectRoot } = await createBackendHarness(t);

  const { server, baseUrl } = await startFixtureServer({
    "/notes.md": (_req, res) => {
      res.writeHead(200, { "content-type": "text/markdown" });
      res.end(
        [
          "- Main item",
          "  - Child item",
          "    - Grandchild item",
          "- Next item",
          ""
        ].join("\n")
      );
    }
  });

  t.after(() => server.close());

  await fsp.writeFile(
    path.join(projectRoot, "launcher-config.yml"),
    `serverName: Test Realm
filelistUrl: ${baseUrl}/
patchNotesUrl: ${baseUrl}/notes.md
`,
    "utf8"
  );

  await backend.initialize();
  const notes = await backend.getPatchNotes({ forceRefresh: true });

  assert.match(notes.html, /<ul>\s*<li>Main item\s*<ul>\s*<li>Child item\s*<ul>\s*<li>Grandchild item\s*<\/li><\/ul>\s*<\/li><\/ul>\s*<\/li>\s*<li>Next item\s*<\/li><\/ul>/);
});
