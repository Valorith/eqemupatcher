const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const { LauncherBackend } = require("../src/electron/backend/launcher-backend");

function md5(text) {
  return crypto.createHash("md5").update(text).digest("hex").toUpperCase();
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
  assert.equal(state.statusBadge, "Select Folder");
  assert.equal(state.patchActionLabel, "Deploy Patch");
  assert.equal(state.autoPatch, false);
  assert.equal(state.autoPlay, false);

  const appStatePath = path.join(appUserDataPath, "launcher-state.yml");
  const savedState = await fsp.readFile(appStatePath, "utf8");
  assert.match(savedState, /gameDirectory: ""/);
});

test("refreshState recognizes a configured supported client and manifest status", async (t) => {
  const { backend, projectRoot } = await createBackendHarness(t);
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
  assert.equal(state.patchActionLabel, "Deploy Patch");
  assert.equal(state.statusBadge, "Update Ready");
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

test("refreshState treats legacy string patch versions as up to date", async (t) => {
  const { backend, projectRoot } = await createBackendHarness(t);
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
