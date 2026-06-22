const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { Readable } = require("node:stream");
const { pathToFileURL } = require("node:url");

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

async function writePortableExecutable(filePath, machine) {
  const buffer = Buffer.alloc(512);
  buffer.writeUInt16LE(0x5A4D, 0);
  buffer.writeUInt32LE(0x80, 0x3C);
  buffer.writeUInt32LE(0x00004550, 0x80);
  buffer.writeUInt16LE(machine, 0x84);
  await fsp.writeFile(filePath, buffer);
}

async function createBackendHarness(t, options = {}) {
  const projectRoot = await createTempDir("eqemu-project-");
  const appUserDataPath = await createTempDir("eqemu-user-");
  const events = [];
  const {
    netConnectImpl = () => createMockSocket("connect"),
    loginServerUdpProbeImpl = async () => {
      throw new Error("login UDP probe unavailable in test");
    },
    ...backendOptions
  } = options;

  t.after(async () => {
    await fsp.rm(projectRoot, { recursive: true, force: true });
    await fsp.rm(appUserDataPath, { recursive: true, force: true });
  });

  return {
    backend: new LauncherBackend({
      appUserDataPath,
      projectRoot,
      eventSink: (event) => events.push(event),
      netConnectImpl,
      loginServerUdpProbeImpl,
      ...backendOptions
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

function createMockSocket(eventName, payload) {
  const socket = new EventEmitter();
  socket.setTimeout = () => socket;
  socket.destroy = () => {};
  setImmediate(() => {
    socket.emit(eventName, payload);
  });
  return socket;
}

test("initialize without a selected game directory reports selection state", async (t) => {
  const { backend, appUserDataPath } = await createBackendHarness(t);

  const state = await backend.initialize();

  assert.equal(state.gameDirectory, "");
  assert.equal(state.statusBadge, "Run In Folder");
  assert.equal(state.patchActionLabel, "Deploy Patch");
  assert.equal(state.autoPatch, false);
  assert.equal(state.autoPlay, false);
  assert.equal(state.autoLogin, false);
  assert.equal(state.onGameLaunch, "minimize");

  const appStatePath = path.join(appUserDataPath, "launcher-state.yml");
  const savedState = await fsp.readFile(appStatePath, "utf8");
  assert.match(savedState, /gameDirectory: ""/);
  assert.match(savedState, /onGameLaunch: minimize/);
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

test("initialize defaults on game launch to minimize when the saved app state predates the setting", async (t) => {
  const { backend, appUserDataPath } = await createBackendHarness(t);
  const appStatePath = path.join(appUserDataPath, "launcher-state.yml");

  await fsp.writeFile(appStatePath, 'gameDirectory: ""\n', "utf8");

  const state = await backend.initialize();
  const savedState = await fsp.readFile(appStatePath, "utf8");

  assert.equal(state.onGameLaunch, "minimize");
  assert.match(savedState, /gameDirectory: ""/);
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

test("initialize reports configured game server status as online", async (t) => {
  const { backend, projectRoot } = await createBackendHarness(t, {
    netConnectImpl: () => createMockSocket("connect")
  });

  await fsp.writeFile(
    path.join(projectRoot, "launcher-config.yml"),
    "serverName: Test Realm\nfilelistUrl: https://example.invalid/\ngameServerHost: game.example.invalid\ngameServerPort: 9000\n",
    "utf8"
  );

  const state = await backend.initialize();

  assert.equal(state.gameServerHost, "game.example.invalid");
  assert.equal(state.gameServerPort, 9000);
  assert.equal(state.gameServerStatus.state, "online");
  assert.equal(state.gameServerStatus.label, "Online");
  assert.equal(state.gameServerStatus.host, "game.example.invalid");
  assert.equal(state.gameServerStatus.port, 9000);
  assert.match(state.gameServerStatus.detail, /Connected to game\.example\.invalid:9000/);
});

test("initialize uses the built-in game server status endpoint when no override is configured", async (t) => {
  const connectionChecks = [];
  const { backend, projectRoot } = await createBackendHarness(t, {
    netConnectImpl: (options) => {
      connectionChecks.push(options);
      return createMockSocket("connect");
    }
  });

  await fsp.writeFile(
    path.join(projectRoot, "launcher-config.yml"),
    "serverName: Test Realm\nfilelistUrl: https://example.invalid/\n",
    "utf8"
  );

  const state = await backend.initialize();

  assert.equal(state.gameServerPort, 9000);
  assert.equal(state.gameServerStatus.state, "online");
  assert.equal(state.gameServerStatus.label, "Online");
  assert.equal(state.gameServerStatus.port, 9000);
  assert.ok(state.gameServerHost);
  assert.ok(state.gameServerStatus.host);
  assert.deepEqual(connectionChecks.map((check) => check.port), [9000]);
});

test("initialize reports configured game server status as offline", async (t) => {
  const { backend, projectRoot } = await createBackendHarness(t, {
    netConnectImpl: () => createMockSocket("error", new Error("connection refused"))
  });

  await fsp.writeFile(
    path.join(projectRoot, "launcher-config.yml"),
    "serverName: Test Realm\nfilelistUrl: https://example.invalid/\ngameServerHost: game.example.invalid\ngameServerPort: 9000\n",
    "utf8"
  );

  const state = await backend.initialize();

  assert.equal(state.gameServerStatus.state, "offline");
  assert.equal(state.gameServerStatus.label, "Offline");
  assert.equal(state.gameServerStatus.host, "game.example.invalid");
  assert.equal(state.gameServerStatus.port, 9000);
  assert.equal(state.gameServerStatus.error, "connection refused");
});

test("initialize reports login server status from eqhost as online", async (t) => {
  const launchDirectory = await createTempDir("eqemu-launch-");
  const connectionChecks = [];
  const { backend, projectRoot } = await createBackendHarness(t, {
    launchDirectory,
    netConnectImpl: (options) => {
      connectionChecks.push(options);
      return createMockSocket("connect");
    }
  });

  t.after(async () => {
    await fsp.rm(launchDirectory, { recursive: true, force: true });
  });

  backend.checkForLauncherUpdate = async () => backend.getState();

  await fsp.writeFile(
    path.join(projectRoot, "launcher-config.yml"),
    "serverName: Test Realm\nfilelistUrl: https://example.invalid/\n",
    "utf8"
  );
  await fsp.writeFile(path.join(launchDirectory, "eqgame.exe"), "dummy", "utf8");
  await fsp.writeFile(
    path.join(launchDirectory, "eqhost.txt"),
    "[LoginServer]\n;Host=ignored.eqemulator.net:5999\nHost=login.eqemulator.net:5999\n",
    "utf8"
  );

  const state = await backend.initialize();

  assert.equal(state.loginServerHost, "login.eqemulator.net");
  assert.equal(state.loginServerPort, 5999);
  assert.equal(state.loginServerStatus.state, "online");
  assert.equal(state.loginServerStatus.label, "Online");
  assert.equal(state.loginServerStatus.host, "login.eqemulator.net");
  assert.equal(state.loginServerStatus.port, 5999);
  assert.equal(state.loginServerActiveRole, "primary");
  assert.equal(state.loginServerOptions.backup.host, "");
  assert.match(state.loginServerStatus.detail, /Connected to login\.eqemulator\.net:5999/);
  assert(connectionChecks.some((check) => check.host === "login.eqemulator.net" && check.port === 5999));
});

test("initialize fails over to backup login server by only toggling eqhost comment prefixes", async (t) => {
  const launchDirectory = await createTempDir("eqemu-launch-");
  const connectionChecks = [];
  const { backend, projectRoot } = await createBackendHarness(t, {
    launchDirectory,
    netConnectImpl: (options) => {
      connectionChecks.push(options);
      if (options.host === "primary.login.invalid") {
        return createMockSocket("error", new Error("primary offline"));
      }
      return createMockSocket("connect");
    }
  });

  t.after(async () => {
    await fsp.rm(launchDirectory, { recursive: true, force: true });
  });

  backend.checkForLauncherUpdate = async () => backend.getState();

  await fsp.writeFile(
    path.join(projectRoot, "launcher-config.yml"),
    "serverName: Test Realm\nfilelistUrl: https://example.invalid/\n",
    "utf8"
  );
  await fsp.writeFile(path.join(launchDirectory, "eqgame.exe"), "dummy", "utf8");
  const eqhostPath = path.join(launchDirectory, "eqhost.txt");
  await fsp.writeFile(
    eqhostPath,
    "[LoginServer]\r\n  Host = primary.login.invalid:5999\r\n  #Host=backup.login.invalid:5999\r\n;Host=ignored.login.invalid:5999\r\n",
    "utf8"
  );

  const state = await backend.initialize();
  const eqhost = await fsp.readFile(eqhostPath, "utf8");

  assert.equal(state.loginServerHost, "backup.login.invalid");
  assert.equal(state.loginServerPort, 5999);
  assert.equal(state.loginServerStatus.state, "online");
  assert.equal(state.loginServerStatus.label, "Backup");
  assert.equal(state.loginServerActiveRole, "backup");
  assert.equal(state.loginServerSelectionMode, "auto");
  assert.equal(state.loginServerFailoverActive, true);
  assert.equal(state.loginServerStatus.primaryError, "primary offline");
  assert.equal(eqhost, "[LoginServer]\r\n  #Host = primary.login.invalid:5999\r\n  Host=backup.login.invalid:5999\r\n;Host=ignored.login.invalid:5999\r\n");
  assert(connectionChecks.some((check) => check.host === "primary.login.invalid" && check.port === 5999));
  assert(connectionChecks.some((check) => check.host === "backup.login.invalid" && check.port === 5999));
});

test("initialize detects backup login server with EQ UDP probe when TCP refuses it", async (t) => {
  const launchDirectory = await createTempDir("eqemu-launch-");
  const udpChecks = [];
  const { backend, projectRoot } = await createBackendHarness(t, {
    launchDirectory,
    netConnectImpl: (options) => createMockSocket("error", new Error(`${options.host} tcp refused`)),
    loginServerUdpProbeImpl: async (endpoint) => {
      udpChecks.push(endpoint);
      if (endpoint.host === "backup.login.invalid") {
        return;
      }
      throw new Error(`${endpoint.host} udp timeout`);
    }
  });

  t.after(async () => {
    await fsp.rm(launchDirectory, { recursive: true, force: true });
  });

  backend.checkForLauncherUpdate = async () => backend.getState();

  await fsp.writeFile(
    path.join(projectRoot, "launcher-config.yml"),
    "serverName: Test Realm\nfilelistUrl: https://example.invalid/\n",
    "utf8"
  );
  await fsp.writeFile(path.join(launchDirectory, "eqgame.exe"), "dummy", "utf8");
  const eqhostPath = path.join(launchDirectory, "eqhost.txt");
  await fsp.writeFile(
    eqhostPath,
    "[LoginServer]\nHost=primary.login.invalid:5999\n#Host=backup.login.invalid:5999\n",
    "utf8"
  );

  const state = await backend.initialize();

  assert.equal(state.loginServerHost, "backup.login.invalid");
  assert.equal(state.loginServerPort, 5999);
  assert.equal(state.loginServerStatus.state, "online");
  assert.equal(state.loginServerStatus.label, "Backup");
  assert.equal(state.loginServerActiveRole, "backup");
  assert.equal(state.loginServerFailoverActive, true);
  assert.equal(state.loginServerStatus.primaryError, "primary.login.invalid tcp refused");
  assert.match(state.loginServerStatus.detail, /over the EQ login protocol/);
  assert(udpChecks.some((check) => check.host === "primary.login.invalid" && check.port === 5999));
  assert(udpChecks.some((check) => check.host === "backup.login.invalid" && check.port === 5999));
  assert.equal(await fsp.readFile(eqhostPath, "utf8"), "[LoginServer]\n#Host=primary.login.invalid:5999\nHost=backup.login.invalid:5999\n");
});

test("initialize selects backup when primary is offline even if backup status is unconfirmed", async (t) => {
  const launchDirectory = await createTempDir("eqemu-launch-");
  const { backend, projectRoot } = await createBackendHarness(t, {
    launchDirectory,
    netConnectImpl: (options) => {
      if (options.host.endsWith(".login.invalid")) {
        return createMockSocket("error", new Error(`${options.host} offline`));
      }
      return createMockSocket("connect");
    }
  });

  t.after(async () => {
    await fsp.rm(launchDirectory, { recursive: true, force: true });
  });

  backend.checkForLauncherUpdate = async () => backend.getState();

  await fsp.writeFile(
    path.join(projectRoot, "launcher-config.yml"),
    "serverName: Test Realm\nfilelistUrl: https://example.invalid/\n",
    "utf8"
  );
  await fsp.writeFile(path.join(launchDirectory, "eqgame.exe"), "dummy", "utf8");
  const eqhostPath = path.join(launchDirectory, "eqhost.txt");
  await fsp.writeFile(
    eqhostPath,
    "[LoginServer]\n#Host=primary.login.invalid:5999\nHost=backup.login.invalid:5999\n",
    "utf8"
  );

  const state = await backend.initialize();
  const eqhost = await fsp.readFile(eqhostPath, "utf8");

  assert.equal(state.loginServerHost, "backup.login.invalid");
  assert.equal(state.loginServerStatus.state, "unknown");
  assert.equal(state.loginServerStatus.label, "Backup");
  assert.equal(state.loginServerActiveRole, "backup");
  assert.equal(state.loginServerFailoverActive, true);
  assert.equal(state.loginServerStatus.primaryError, "primary.login.invalid offline");
  assert.equal(state.loginServerStatus.backupError, "backup.login.invalid offline");
  assert.equal(eqhost, "[LoginServer]\n#Host=primary.login.invalid:5999\nHost=backup.login.invalid:5999\n");
});

test("refreshServerStatus returns from backup to primary when primary recovers", async (t) => {
  const launchDirectory = await createTempDir("eqemu-launch-");
  let primaryOnline = false;
  const { backend, projectRoot } = await createBackendHarness(t, {
    launchDirectory,
    netConnectImpl: (options) => {
      if (options.host === "primary.login.invalid" && !primaryOnline) {
        return createMockSocket("error", new Error("primary offline"));
      }
      return createMockSocket("connect");
    }
  });

  t.after(async () => {
    await fsp.rm(launchDirectory, { recursive: true, force: true });
  });

  backend.checkForLauncherUpdate = async () => backend.getState();

  await fsp.writeFile(
    path.join(projectRoot, "launcher-config.yml"),
    "serverName: Test Realm\nfilelistUrl: https://example.invalid/\n",
    "utf8"
  );
  await fsp.writeFile(path.join(launchDirectory, "eqgame.exe"), "dummy", "utf8");
  const eqhostPath = path.join(launchDirectory, "eqhost.txt");
  await fsp.writeFile(
    eqhostPath,
    "[LoginServer]\nHost=primary.login.invalid:5999\n#Host=backup.login.invalid:5999\n",
    "utf8"
  );

  let state = await backend.initialize();
  assert.equal(state.loginServerActiveRole, "backup");

  primaryOnline = true;
  state = await backend.refreshServerStatus();
  const eqhost = await fsp.readFile(eqhostPath, "utf8");

  assert.equal(state.loginServerHost, "primary.login.invalid");
  assert.equal(state.loginServerActiveRole, "primary");
  assert.equal(state.loginServerFailoverActive, false);
  assert.equal(eqhost, "[LoginServer]\nHost=primary.login.invalid:5999\n#Host=backup.login.invalid:5999\n");
});

test("manual backup login server selection holds until restart", async (t) => {
  const launchDirectory = await createTempDir("eqemu-launch-");
  const netConnectImpl = () => createMockSocket("connect");
  const { backend, projectRoot } = await createBackendHarness(t, {
    launchDirectory,
    netConnectImpl
  });

  t.after(async () => {
    await fsp.rm(launchDirectory, { recursive: true, force: true });
  });

  backend.checkForLauncherUpdate = async () => backend.getState();

  await fsp.writeFile(
    path.join(projectRoot, "launcher-config.yml"),
    "serverName: Test Realm\nfilelistUrl: https://example.invalid/\n",
    "utf8"
  );
  await fsp.writeFile(path.join(launchDirectory, "eqgame.exe"), "dummy", "utf8");
  const eqhostPath = path.join(launchDirectory, "eqhost.txt");
  await fsp.writeFile(
    eqhostPath,
    "[LoginServer]\nHost=primary.login.invalid:5999\n#Host=backup.login.invalid:5999\n",
    "utf8"
  );

  let state = await backend.initialize();
  assert.equal(state.loginServerActiveRole, "primary");

  state = await backend.setActiveLoginServer({ role: "backup" });
  assert.equal(state.loginServerSelectionMode, "manual");
  assert.equal(state.loginServerActiveRole, "backup");

  state = await backend.refreshServerStatus();
  assert.equal(state.loginServerSelectionMode, "manual");
  assert.equal(state.loginServerActiveRole, "backup");
  assert.equal(await fsp.readFile(eqhostPath, "utf8"), "[LoginServer]\n#Host=primary.login.invalid:5999\nHost=backup.login.invalid:5999\n");

  const { backend: restartedBackend } = await createBackendHarness(t, {
    launchDirectory,
    netConnectImpl
  });
  restartedBackend.checkForLauncherUpdate = async () => restartedBackend.getState();

  state = await restartedBackend.initialize();
  assert.equal(state.loginServerSelectionMode, "auto");
  assert.equal(state.loginServerActiveRole, "primary");
  assert.equal(await fsp.readFile(eqhostPath, "utf8"), "[LoginServer]\nHost=primary.login.invalid:5999\n#Host=backup.login.invalid:5999\n");
});

test("manual backup login server selection stays active when status probe cannot confirm it", async (t) => {
  const launchDirectory = await createTempDir("eqemu-launch-");
  const { backend, projectRoot } = await createBackendHarness(t, {
    launchDirectory,
    netConnectImpl: (options) => {
      if (options.host === "backup.login.invalid") {
        return createMockSocket("error", new Error("backup probe refused"));
      }
      return createMockSocket("connect");
    }
  });

  t.after(async () => {
    await fsp.rm(launchDirectory, { recursive: true, force: true });
  });

  backend.checkForLauncherUpdate = async () => backend.getState();

  await fsp.writeFile(
    path.join(projectRoot, "launcher-config.yml"),
    "serverName: Test Realm\nfilelistUrl: https://example.invalid/\n",
    "utf8"
  );
  await fsp.writeFile(path.join(launchDirectory, "eqgame.exe"), "dummy", "utf8");
  const eqhostPath = path.join(launchDirectory, "eqhost.txt");
  await fsp.writeFile(
    eqhostPath,
    "[LoginServer]\nHost=primary.login.invalid:5999\n#Host=backup.login.invalid:5999\n",
    "utf8"
  );

  await backend.initialize();
  const state = await backend.setActiveLoginServer({ role: "backup" });

  assert.equal(state.loginServerSelectionMode, "manual");
  assert.equal(state.loginServerActiveRole, "backup");
  assert.equal(state.loginServerStatus.state, "unknown");
  assert.equal(state.loginServerStatus.label, "Backup");
  assert.equal(state.loginServerStatus.backupError, "backup probe refused");
  assert.equal(await fsp.readFile(eqhostPath, "utf8"), "[LoginServer]\n#Host=primary.login.invalid:5999\nHost=backup.login.invalid:5999\n");
});

test("manual backup login server selection reports online when EQ UDP probe succeeds", async (t) => {
  const launchDirectory = await createTempDir("eqemu-launch-");
  const { backend, projectRoot } = await createBackendHarness(t, {
    launchDirectory,
    netConnectImpl: (options) => {
      if (options.host === "backup.login.invalid") {
        return createMockSocket("error", new Error("backup tcp refused"));
      }
      return createMockSocket("connect");
    },
    loginServerUdpProbeImpl: async (endpoint) => {
      if (endpoint.host === "backup.login.invalid") {
        return;
      }
      throw new Error("udp timeout");
    }
  });

  t.after(async () => {
    await fsp.rm(launchDirectory, { recursive: true, force: true });
  });

  backend.checkForLauncherUpdate = async () => backend.getState();

  await fsp.writeFile(
    path.join(projectRoot, "launcher-config.yml"),
    "serverName: Test Realm\nfilelistUrl: https://example.invalid/\n",
    "utf8"
  );
  await fsp.writeFile(path.join(launchDirectory, "eqgame.exe"), "dummy", "utf8");
  const eqhostPath = path.join(launchDirectory, "eqhost.txt");
  await fsp.writeFile(
    eqhostPath,
    "[LoginServer]\nHost=primary.login.invalid:5999\n#Host=backup.login.invalid:5999\n",
    "utf8"
  );

  await backend.initialize();
  const state = await backend.setActiveLoginServer({ role: "backup" });

  assert.equal(state.loginServerSelectionMode, "manual");
  assert.equal(state.loginServerActiveRole, "backup");
  assert.equal(state.loginServerStatus.state, "online");
  assert.equal(state.loginServerStatus.label, "Backup");
  assert.match(state.loginServerStatus.detail, /over the EQ login protocol/);
  assert.equal(await fsp.readFile(eqhostPath, "utf8"), "[LoginServer]\n#Host=primary.login.invalid:5999\nHost=backup.login.invalid:5999\n");
});

test("manual login server selection can return to auto failover mode", async (t) => {
  const launchDirectory = await createTempDir("eqemu-launch-");
  const { backend, projectRoot } = await createBackendHarness(t, {
    launchDirectory,
    netConnectImpl: () => createMockSocket("connect")
  });

  t.after(async () => {
    await fsp.rm(launchDirectory, { recursive: true, force: true });
  });

  backend.checkForLauncherUpdate = async () => backend.getState();

  await fsp.writeFile(
    path.join(projectRoot, "launcher-config.yml"),
    "serverName: Test Realm\nfilelistUrl: https://example.invalid/\n",
    "utf8"
  );
  await fsp.writeFile(path.join(launchDirectory, "eqgame.exe"), "dummy", "utf8");
  const eqhostPath = path.join(launchDirectory, "eqhost.txt");
  await fsp.writeFile(
    eqhostPath,
    "[LoginServer]\nHost=primary.login.invalid:5999\n#Host=backup.login.invalid:5999\n",
    "utf8"
  );

  await backend.initialize();
  let state = await backend.setActiveLoginServer({ role: "backup" });
  assert.equal(state.loginServerSelectionMode, "manual");
  assert.equal(state.loginServerActiveRole, "backup");
  assert.equal(await fsp.readFile(eqhostPath, "utf8"), "[LoginServer]\n#Host=primary.login.invalid:5999\nHost=backup.login.invalid:5999\n");

  state = await backend.setActiveLoginServer({ role: "auto" });

  assert.equal(state.loginServerSelectionMode, "auto");
  assert.equal(state.loginServerActiveRole, "primary");
  assert.equal(state.loginServerFailoverActive, false);
  assert.equal(await fsp.readFile(eqhostPath, "utf8"), "[LoginServer]\nHost=primary.login.invalid:5999\n#Host=backup.login.invalid:5999\n");
});

test("manual backup login server selection reports a clear error without two managed hosts", async (t) => {
  const launchDirectory = await createTempDir("eqemu-launch-");
  const { backend, projectRoot } = await createBackendHarness(t, {
    launchDirectory,
    netConnectImpl: () => createMockSocket("connect")
  });

  t.after(async () => {
    await fsp.rm(launchDirectory, { recursive: true, force: true });
  });

  backend.checkForLauncherUpdate = async () => backend.getState();

  await fsp.writeFile(
    path.join(projectRoot, "launcher-config.yml"),
    "serverName: Test Realm\nfilelistUrl: https://example.invalid/\n",
    "utf8"
  );
  await fsp.writeFile(path.join(launchDirectory, "eqgame.exe"), "dummy", "utf8");
  await fsp.writeFile(
    path.join(launchDirectory, "eqhost.txt"),
    "[LoginServer]\nHost=primary.login.invalid:5999\n",
    "utf8"
  );

  await backend.initialize();

  await assert.rejects(
    () => backend.setActiveLoginServer({ role: "backup" }),
    /requires two Host entries/
  );
});

test("initialize reports login server status as unconfigured when eqhost is missing", async (t) => {
  const launchDirectory = await createTempDir("eqemu-launch-");
  const connectionChecks = [];
  const { backend, projectRoot } = await createBackendHarness(t, {
    launchDirectory,
    netConnectImpl: (options) => {
      connectionChecks.push(options);
      return createMockSocket("connect");
    }
  });

  t.after(async () => {
    await fsp.rm(launchDirectory, { recursive: true, force: true });
  });

  backend.checkForLauncherUpdate = async () => backend.getState();

  await fsp.writeFile(
    path.join(projectRoot, "launcher-config.yml"),
    "serverName: Test Realm\nfilelistUrl: https://example.invalid/\n",
    "utf8"
  );
  await fsp.writeFile(path.join(launchDirectory, "eqgame.exe"), "dummy", "utf8");

  const state = await backend.initialize();

  assert.equal(state.loginServerHost, "");
  assert.equal(state.loginServerPort, 0);
  assert.equal(state.loginServerStatus.state, "unconfigured");
  assert.equal(state.loginServerStatus.label, "Not configured");
  assert.equal(state.loginServerStatus.detail, "eqhost.txt was not found in the selected game directory.");
  assert.equal(connectionChecks.some((check) => check.host === "login.eqemulator.net"), false);
});

test("initialize uses configured login server fallback when eqhost is missing", async (t) => {
  const launchDirectory = await createTempDir("eqemu-launch-");
  const connectionChecks = [];
  const { backend, projectRoot } = await createBackendHarness(t, {
    launchDirectory,
    netConnectImpl: (options) => {
      connectionChecks.push(options);
      return createMockSocket("connect");
    }
  });

  t.after(async () => {
    await fsp.rm(launchDirectory, { recursive: true, force: true });
  });

  backend.checkForLauncherUpdate = async () => backend.getState();

  await fsp.writeFile(
    path.join(projectRoot, "launcher-config.yml"),
    "serverName: Test Realm\nfilelistUrl: https://example.invalid/\nloginServerHost: login.eqemulator.net\nloginServerPort: 5999\n",
    "utf8"
  );
  await fsp.writeFile(path.join(launchDirectory, "eqgame.exe"), "dummy", "utf8");

  const state = await backend.initialize();

  assert.equal(state.loginServerHost, "login.eqemulator.net");
  assert.equal(state.loginServerPort, 5999);
  assert.equal(state.loginServerStatus.state, "online");
  assert.equal(state.loginServerStatus.label, "Online");
  assert.equal(state.loginServerStatus.host, "login.eqemulator.net");
  assert.equal(state.loginServerStatus.port, 5999);
  assert.match(state.loginServerStatus.detail, /Connected to login\.eqemulator\.net:5999/);
  assert(connectionChecks.some((check) => check.host === "login.eqemulator.net" && check.port === 5999));
});

test("refreshServerStatus checks game and login endpoints without manifest refresh", async (t) => {
  const launchDirectory = await createTempDir("eqemu-launch-");
  const connectionChecks = [];
  const { backend, projectRoot } = await createBackendHarness(t, {
    launchDirectory,
    netConnectImpl: (options) => {
      connectionChecks.push(options);
      return createMockSocket("connect");
    }
  });

  t.after(async () => {
    await fsp.rm(launchDirectory, { recursive: true, force: true });
  });

  backend.checkForLauncherUpdate = async () => backend.getState();

  await fsp.writeFile(
    path.join(projectRoot, "launcher-config.yml"),
    "serverName: Test Realm\nfilelistUrl: https://example.invalid/\ngameServerHost: https://patch.example.invalid/\ngameServerPort: 443\n",
    "utf8"
  );
  await fsp.writeFile(path.join(launchDirectory, "eqgame.exe"), "dummy", "utf8");
  await fsp.writeFile(
    path.join(launchDirectory, "eqhost.txt"),
    "[LoginServer]\nHost=login.eqemulator.net:5999\n",
    "utf8"
  );

  await backend.initialize();
  connectionChecks.length = 0;

  const state = await backend.refreshServerStatus();

  assert.equal(state.gameServerStatus.state, "online");
  assert.equal(state.loginServerStatus.state, "online");
  assert.deepEqual(connectionChecks, [
    { host: "patch.example.invalid", port: 443 },
    { host: "login.eqemulator.net", port: 5999 }
  ]);
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

test("initialize returns local state before the manifest refresh completes", async (t) => {
  const launchDirectory = await createTempDir("eqemu-launch-");
  let releaseManifestRequest = null;
  const manifestRequestGate = new Promise((resolve) => {
    releaseManifestRequest = resolve;
  });
  const { backend, projectRoot, events } = await createBackendHarness(t, {
    platform: "win32",
    launchDirectory,
    fetchImpl: async (url) => {
      if (url.endsWith("/rof/filelist_rof.yml")) {
        await manifestRequestGate;
        return {
          ok: true,
          status: 200,
          async text() {
            return "version: 7\ndownloadprefix: http://127.0.0.1:1/files/\ndownloads: []\n";
          }
        };
      }

      throw new Error(`Unexpected fetch: ${url}`);
    }
  });

  t.after(async () => {
    await fsp.rm(launchDirectory, { recursive: true, force: true });
  });

  await fsp.writeFile(
    path.join(projectRoot, "launcher-config.yml"),
    "serverName: Test Realm\nfilelistUrl: https://example.invalid/\nsupportedClients:\n  - Rain_Of_Fear\n",
    "utf8"
  );
  await fsp.writeFile(path.join(launchDirectory, "eqgame.exe"), "dummy", "utf8");

  backend.detectClientVersion = async () => ({
    found: true,
    hash: "KNOWN",
    version: "Rain_Of_Fear"
  });
  backend.checkForLauncherUpdate = async () => backend.getState();

  const state = await Promise.race([
    backend.initialize(),
    new Promise((_, reject) => setTimeout(() => reject(new Error("initialize timed out")), 150))
  ]);

  assert.equal(state.gameDirectory, launchDirectory);
  assert.equal(state.manifestVersion, "");
  assert.equal(state.canPatch, false);
  assert.equal(state.canLaunch, false);
  assert.equal(state.statusBadge, "Checking");

  releaseManifestRequest();
  const deadline = Date.now() + 200;
  while (Date.now() < deadline) {
    if (events.some((event) => event.type === "state" && event.payload.manifestVersion === "7")) {
      break;
    }
    await new Promise((resolve) => setImmediate(resolve));
  }

  const stateEvents = events.filter((event) => event.type === "state").map((event) => event.payload);
  assert.ok(stateEvents.some((payload) => payload.statusBadge === "Checking"));
  assert.ok(stateEvents.some((payload) => payload.manifestVersion === "7"));
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

test("Verify Integrity emits scan progress and a success summary when files are already current", async (t) => {
  const { backend, projectRoot, events } = await createBackendHarness(t);
  const gameDirectory = await createTempDir("eqemu-game-");
  const currentContent = "current content";
  const currentHash = md5(currentContent);

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
          `    md5: ${currentHash}`,
          `    size: ${Buffer.byteLength(currentContent)}`,
          "deletes: []",
          ""
        ].join("\n")
      );
    }
  });

  t.after(() => server.close());

  await fsp.writeFile(
    path.join(projectRoot, "launcher-config.yml"),
    `serverName: Test Realm\nfilelistUrl: ${baseUrl}/\ndefaultAutoPatch: false\ndefaultAutoPlay: false\nsupportedClients:\n  - Rain_Of_Fear\n`,
    "utf8"
  );

  await fsp.writeFile(path.join(gameDirectory, "eqgame.exe"), "dummy", "utf8");
  await fsp.writeFile(path.join(gameDirectory, "target.txt"), currentContent, "utf8");

  await backend.initialize();
  backend.detectClientVersion = async () => ({
    found: true,
    hash: "KNOWN",
    version: "Rain_Of_Fear"
  });

  await backend.setGameDirectory(gameDirectory);
  backend.state.needsPatch = false;
  backend.state.lastPatchedVersion = "42";
  await backend.startPatch();

  const logMessages = events.filter((event) => event.type === "log").map((event) => event.payload.text);

  assert(logMessages.some((entry) => /Verify Integrity started\. Checking 1 manifest file\(s\)\./.test(entry)));
  assert(logMessages.some((entry) => /Verified 1 \/ 1 manifest file\(s\)\.\.\./.test(entry)));
  assert(logMessages.some((entry) => /Verified 1 manifest file\(s\); patch 42 is already installed\./.test(entry)));
});

test("Verify Integrity reports detected repair candidates before downloading replacements", async (t) => {
  const { backend, projectRoot, events } = await createBackendHarness(t);
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
          "version: 42",
          `downloadprefix: ${baseUrl}/files/`,
          "downloads:",
          "  - name: target.txt",
          `    md5: ${downloadHash}`,
          `    size: ${Buffer.byteLength(downloadContent)}`,
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
  await fsp.writeFile(path.join(gameDirectory, "target.txt"), "stale content", "utf8");

  await backend.initialize();
  backend.detectClientVersion = async () => ({
    found: true,
    hash: "KNOWN",
    version: "Rain_Of_Fear"
  });

  await backend.setGameDirectory(gameDirectory);
  backend.state.needsPatch = false;
  backend.state.lastPatchedVersion = "42";
  await backend.startPatch();

  const logMessages = events.filter((event) => event.type === "log").map((event) => event.payload.text);

  assert(logMessages.some((entry) => /Integrity mismatch detected: target\.txt/.test(entry)));
  assert(logMessages.some((entry) => /Verify Integrity found 1 file\(s\) requiring repair\./.test(entry)));
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

test("updateSettings persists launch preferences", async (t) => {
  const { backend, appUserDataPath } = await createBackendHarness(t, { platform: "win32" });
  const gameDirectory = await createTempDir("eqemu-game-");

  t.after(async () => {
    await fsp.rm(gameDirectory, { recursive: true, force: true });
  });

  await fsp.writeFile(path.join(gameDirectory, "eqgame.exe"), "dummy", "utf8");

  await backend.initialize();
  await backend.setGameDirectory(gameDirectory);
  backend.autoLoginProfiles = [{
    id: "profile-1",
    label: "Vayle Box",
    username: "vayle2",
    secret: "protected-secret",
    isDefault: true,
    createdAt: "2026-06-21T00:00:00.000Z",
    updatedAt: "2026-06-21T00:00:00.000Z"
  }];
  backend.syncAutoLoginProfilesState();

  const state = await backend.updateSettings({ onGameLaunch: "close", autoLogin: true, autoLoginEnterWorld: true });
  const savedState = await fsp.readFile(path.join(appUserDataPath, "launcher-state.yml"), "utf8");
  const savedGameSettings = await fsp.readFile(path.join(gameDirectory, "eqemupatcher.yml"), "utf8");

  assert.equal(state.onGameLaunch, "close");
  assert.equal(state.autoLogin, true);
  assert.equal(state.autoLoginEnterWorld, true);
  assert.match(savedState, /onGameLaunch: close/);
  assert.match(savedState, /autoLoginEnterWorld: true/);
  assert.match(savedGameSettings, /autoLogin: true/);
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

test("branding config resolves custom artwork and links relative to the config file", async (t) => {
  const { backend, projectRoot } = await createBackendHarness(t);
  const brandDirectory = path.join(projectRoot, "branding");
  const primaryImagePath = path.join(brandDirectory, "primary.png");
  const wordmarkImagePath = path.join(brandDirectory, "wordmark.png");

  await fsp.mkdir(brandDirectory, { recursive: true });
  await fsp.writeFile(primaryImagePath, "primary", "utf8");
  await fsp.writeFile(wordmarkImagePath, "wordmark", "utf8");
  await fsp.writeFile(
    path.join(projectRoot, "launcher-config.yml"),
    [
      "serverName: Brand Realm",
      "filelistUrl: https://brand.invalid/",
      "tagline: A Custom EQ Server",
      "primaryImage: branding/primary.png",
      "wordmarkImage: branding/wordmark.png",
      "wordmarkImageAlt: Brand Realm Wordmark",
      "wordmarkRemoveLightBackground: true",
      "emblemText: BR",
      "websiteUrl: https://brand.invalid",
      "websiteLabel: brand.invalid",
      "discordUrl: https://discord.gg/brand",
      "tools:",
      "  - label: Wiki",
      "    url: https://wiki.brand.invalid/",
      "supportedClients:",
      "  - Rain_Of_Fear",
      ""
    ].join("\n"),
    "utf8"
  );

  const state = await backend.initialize();

  assert.equal(state.branding.serverName, "Brand Realm");
  assert.equal(state.branding.tagline, "A Custom EQ Server");
  assert.equal(state.branding.primaryImageUrl, pathToFileURL(primaryImagePath).toString());
  assert.equal(state.branding.wordmarkImageUrl, pathToFileURL(wordmarkImagePath).toString());
  assert.equal(state.branding.wordmarkImageAlt, "Brand Realm Wordmark");
  assert.equal(state.branding.wordmarkRemoveLightBackground, true);
  assert.equal(state.branding.emblemText, "BR");
  assert.equal(state.branding.websiteUrl, "https://brand.invalid");
  assert.equal(state.branding.websiteLabel, "brand.invalid");
  assert.equal(state.branding.discordUrl, "https://discord.gg/brand");
  assert.deepEqual(state.branding.tools, [{ label: "Wiki", url: "https://wiki.brand.invalid/" }]);
});

test("configured primary image takes precedence over legacy eqemupatcher splash art", async (t) => {
  const { backend, projectRoot } = await createBackendHarness(t);
  const gameDirectory = await createTempDir("eqemu-game-");
  const primaryImagePath = path.join(projectRoot, "primary.png");

  t.after(async () => {
    await fsp.rm(gameDirectory, { recursive: true, force: true });
  });

  await fsp.writeFile(primaryImagePath, "primary", "utf8");
  await fsp.writeFile(
    path.join(projectRoot, "launcher-config.yml"),
    "serverName: Test Realm\nfilelistUrl: https://example.invalid/\nprimaryImage: primary.png\nsupportedClients:\n  - Rain_Of_Fear\n",
    "utf8"
  );
  await fsp.writeFile(path.join(gameDirectory, "eqgame.exe"), "dummy", "utf8");
  await fsp.writeFile(path.join(gameDirectory, "eqemupatcher.png"), "legacy", "utf8");

  await backend.initialize();
  const state = await backend.setGameDirectory(gameDirectory);

  assert.equal(state.heroImageUrl, pathToFileURL(path.join(gameDirectory, "eqemupatcher.png")).toString());
  assert.equal(state.branding.primaryImageUrl, pathToFileURL(primaryImagePath).toString());
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

test("launchGame invokes the selected window action callback after a successful launch", async (t) => {
  const launchActions = [];
  const { backend } = await createBackendHarness(t, {
    platform: "win32",
    launchStabilizationMs: 10,
    onGameLaunched: async (payload) => {
      launchActions.push(payload);
    },
    spawnImpl: () => {
      const child = new EventEmitter();
      child.unref = () => {};

      process.nextTick(() => {
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
  backend.state.onGameLaunch = "close";

  await backend.launchGame();

  assert.deepEqual(launchActions, [{ action: "close", autoTriggered: false }]);
});

test("auto-login profiles store protected secrets and expose sanitized state", async (t) => {
  const { backend, appUserDataPath } = await createBackendHarness(t, {
    platform: "win32"
  });
  backend.protectAutoLoginSecret = async (password) => `protected:${Buffer.from(password, "utf8").toString("base64")}`;
  backend.unprotectAutoLoginSecret = async (secret) => Buffer.from(secret.replace(/^protected:/, ""), "base64").toString("utf8");

  let state = await backend.saveAutoLoginProfile({
    label: "Vayle Box",
    username: "vayle2",
    password: "not-the-real-password"
  });

  assert.equal(state.autoLoginProfiles.length, 1);
  assert.equal(state.autoLoginProfiles[0].label, "Vayle Box");
  assert.equal(state.autoLoginProfiles[0].username, "vayle2");
  assert.equal(Object.hasOwn(state.autoLoginProfiles[0], "secret"), false);
  assert.equal(JSON.stringify(state).includes("not-the-real-password"), false);

  const storePath = path.join(appUserDataPath, "auto-login-profiles.json");
  const savedStore = await fsp.readFile(storePath, "utf8");
  assert.match(savedStore, /protected:/);
  assert.equal(savedStore.includes("not-the-real-password"), false);

  const profileId = state.autoLoginProfiles[0].id;
  state = await backend.saveAutoLoginProfile({
    id: profileId,
    label: "Vayle Main",
    username: "vayle2",
    password: ""
  });

  assert.equal(state.autoLoginProfiles[0].label, "Vayle Main");
  assert.equal(await backend.unprotectAutoLoginSecret(backend.autoLoginProfiles[0].secret), "not-the-real-password");

  state = await backend.deleteAutoLoginProfile({ id: profileId });
  assert.deepEqual(state.autoLoginProfiles, []);
});

test("auto-login profile defaults persist and become the startup selection", async (t) => {
  const { backend, appUserDataPath, projectRoot } = await createBackendHarness(t, {
    platform: "win32"
  });
  backend.protectAutoLoginSecret = async (password) => `protected:${Buffer.from(password, "utf8").toString("base64")}`;

  let state = await backend.saveAutoLoginProfile({
    label: "Vayle Box",
    username: "vayle2",
    password: "first-password"
  });
  const firstProfileId = state.autoLoginProfiles[0].id;

  state = await backend.saveAutoLoginProfile({
    label: "Valgor",
    username: "valgor",
    password: "second-password",
    isDefault: true
  });
  const secondProfileId = state.autoLoginProfiles.find((profile) => profile.username === "valgor").id;

  assert.equal(state.autoLoginProfiles.find((profile) => profile.id === firstProfileId).isDefault, false);
  assert.equal(state.autoLoginProfiles.find((profile) => profile.id === secondProfileId).isDefault, true);
  assert.equal(state.selectedAutoLoginProfileId, secondProfileId);

  const restartedBackend = new LauncherBackend({
    appUserDataPath,
    projectRoot,
    platform: "win32"
  });
  const restartedState = await restartedBackend.initialize();

  assert.equal(restartedState.selectedAutoLoginProfileId, secondProfileId);
  assert.equal(restartedState.autoLoginProfiles.find((profile) => profile.id === secondProfileId).isDefault, true);
});

test("auto-login profile order and multi-selection persist across restart", async (t) => {
  const { backend, appUserDataPath, projectRoot } = await createBackendHarness(t, {
    platform: "win32"
  });
  backend.protectAutoLoginSecret = async (password) => `protected:${Buffer.from(password, "utf8").toString("base64")}`;

  let state = await backend.saveAutoLoginProfile({
    label: "Druid",
    username: "vayle04",
    password: "first-password"
  });
  const druidId = state.autoLoginProfiles[0].id;

  state = await backend.saveAutoLoginProfile({
    label: "Cleric",
    username: "bgondaway",
    password: "second-password"
  });
  const clericId = state.autoLoginProfiles.find((profile) => profile.username === "bgondaway").id;

  state = await backend.saveAutoLoginProfile({
    label: "Bard",
    username: "vayle3",
    password: "third-password"
  });
  const bardId = state.autoLoginProfiles.find((profile) => profile.username === "vayle3").id;

  state = await backend.reorderAutoLoginProfiles({
    ids: [bardId, druidId, clericId]
  });
  assert.deepEqual(state.autoLoginProfiles.map((profile) => profile.id), [bardId, druidId, clericId]);

  state = await backend.setAutoLoginProfileSelection({
    activeId: druidId,
    ids: [druidId, bardId]
  });
  assert.deepEqual(state.selectedAutoLoginProfileIds, [bardId, druidId]);
  assert.equal(state.selectedAutoLoginProfileId, druidId);

  const restartedBackend = new LauncherBackend({
    appUserDataPath,
    projectRoot,
    platform: "win32"
  });
  const restartedState = await restartedBackend.initialize();

  assert.deepEqual(restartedState.autoLoginProfiles.map((profile) => profile.id), [bardId, druidId, clericId]);
  assert.deepEqual(restartedState.selectedAutoLoginProfileIds, [bardId, druidId]);
  assert.equal(restartedState.selectedAutoLoginProfileId, druidId);
});

test("auto-login helper uses DPI-aware client-area click coordinates", async () => {
  const helperSource = await fsp.readFile(
    path.join(__dirname, "..", "src", "electron", "assets", "auto-login", "Invoke-EqAutoLogin.ps1"),
    "utf8"
  );

  assert.match(helperSource, /SetProcessDpiAwarenessContext/);
  assert.match(helperSource, /SetThreadDpiAwarenessContext/);
  assert.match(helperSource, /GetClientRect/);
  assert.match(helperSource, /ClientToScreen/);
  assert.match(helperSource, /LEGACY_EQ_UI_WIDTH = 1024/);
  assert.match(helperSource, /LEGACY_EQ_UI_HEIGHT = 768/);
  assert.match(helperSource, /GetCenteredLegacyEqUiRect/);
  assert.match(helperSource, /GetWindowRelativePixel/);
  assert.match(helperSource, /GetPixel/);
  assert.match(helperSource, /Get-LoginCanvasState/);
  assert.match(helperSource, /Test-DarkPixel/);
  assert.match(helperSource, /Test-MainMenuLoginButtonPixel/);
  assert.match(helperSource, /Wait-ForLoginFormReady/);
  assert.match(helperSource, /Wait-ForLoginOutcome/);
  assert.match(helperSource, /\[switch\]\$EnterWorld/);
  assert.match(helperSource, /Wait-ForServerSelectReady/);
  assert.match(helperSource, /Test-ServerSelectPlayButtonPixel/);
  assert.match(helperSource, /\$ServerSelectPlayButtonXRatio = 0\.724/);
  assert.match(helperSource, /\$ServerSelectPlayButtonYRatio = 0\.700/);
  assert.match(helperSource, /Test-ServerSelectPlayButtonReady/);
  assert.match(helperSource, /ClickWindowRelative\(\$window\.Handle, \$ServerSelectPlayButtonXRatio, \$ServerSelectPlayButtonYRatio/);
  assert.match(helperSource, /enter-world-complete/);
  assert.match(helperSource, /catch\s*{\s*\$state = "advanced"/);
  assert.match(helperSource, /catch\s*{\s*return "advanced"/);
  assert.match(helperSource, /\[Console\]::InputEncoding = \[System\.Text\.Encoding\]::UTF8/);
  assert.match(helperSource, /\[int\]\$LoginFormWaitSeconds = 30/);
  assert.match(helperSource, /\[int\]\$FocusWaitSeconds = 10/);
  assert.match(helperSource, /public static bool IsForegroundWindow/);
  assert.match(helperSource, /function Wait-ForTargetWindowForeground/);
  assert.match(helperSource, /Timed out waiting for the new EverQuest window to become foreground/);
  assert.match(helperSource, /Wait-ForTargetWindowForeground -WindowHandle \$window\.Handle -TimeoutSeconds \$FocusWaitSeconds -Stage "credentials"/);
  assert.match(helperSource, /Wait-ForTargetWindowForeground -WindowHandle \$window\.Handle -TimeoutSeconds \$FocusWaitSeconds -Stage "username entry"/);
  assert.match(helperSource, /Wait-ForTargetWindowForeground -WindowHandle \$window\.Handle -TimeoutSeconds \$FocusWaitSeconds -Stage "login submit"/);
  assert.match(helperSource, /\[int\]\$CredentialFocusDelayMilliseconds = 120/);
  assert.match(helperSource, /\[int\]\$KeyDelayMilliseconds = 8/);
  assert.match(helperSource, /\[int\]\$PostPasswordDelayMilliseconds = 150/);
  assert.match(helperSource, /public static void ClearText/);
  assert.match(helperSource, /private const ushort VK_BACK = 0x08/);
  assert.match(helperSource, /\$CredentialClearBackspaceCount = 64/);
  assert.match(helperSource, /\$LoginUsernameXRatio = 0\.560/);
  assert.match(helperSource, /\$LoginUsernameYRatio = 0\.390/);
  assert.match(helperSource, /\$LoginPasswordXRatio = 0\.560/);
  assert.match(helperSource, /\$LoginPasswordYRatio = 0\.474/);
  assert.match(helperSource, /ClickWindowRelative\(\$window\.Handle, \$LoginUsernameXRatio, \$LoginUsernameYRatio[\s\S]*ClearText\(\$CredentialClearBackspaceCount, \$KeyDelayMilliseconds\)[\s\S]*SendText\(\$Username, \$KeyDelayMilliseconds\)/);
  assert.match(helperSource, /ClickWindowRelative\(\$window\.Handle, \$LoginPasswordXRatio, \$LoginPasswordYRatio[\s\S]*ClearText\(\$CredentialClearBackspaceCount, \$KeyDelayMilliseconds\)[\s\S]*SendText\(\$password, \$KeyDelayMilliseconds\)/);
  assert.match(helperSource, /SendText\(\$password, \$KeyDelayMilliseconds\)[\s\S]*Start-Sleep -Milliseconds \$PostPasswordDelayMilliseconds[\s\S]*SendEnter\(\$KeyDelayMilliseconds\)/);
  assert.match(helperSource, /login-error/);
  assert.match(helperSource, /main-menu/);
  assert.match(helperSource, /\$passwordField = Get-WindowRelativePixel/);
  assert.match(helperSource, /Waiting for the login form/);
  assert.match(helperSource, /ClickWindowRelative\(\$WindowHandle, 0\.497, 0\.456/);
  assert.match(helperSource, /public static void ClickWindowRelative[\s\S]*GetClientRect[\s\S]*ClientToScreen/);
  assert.match(helperSource, /public static void ClickWindowRelative[\s\S]*GetCenteredLegacyEqUiRect/);
  assert.match(helperSource, /ClickWindowRelative\(\$window\.Handle, 0\.661, 0\.757/);
  assert.doesNotMatch(helperSource, /Wait-ForStableUdpEndpoint/);
  assert.doesNotMatch(helperSource, /continuing with input/);
});

test("launchAutoLoginProfile prepares INI files and invokes the helper with the decrypted password", async (t) => {
  const launchActions = [];
  let helperRequest = null;
  const { backend, events } = await createBackendHarness(t, {
    platform: "win32",
    onGameLaunched: async (payload) => {
      launchActions.push(payload);
    }
  });
  const gameDirectory = await createTempDir("eqemu-game-");

  t.after(async () => {
    await fsp.rm(gameDirectory, { recursive: true, force: true });
  });

  await fsp.writeFile(path.join(gameDirectory, "eqgame.exe"), "dummy", "utf8");
  await fsp.writeFile(path.join(gameDirectory, "eqclient.ini"), "[Defaults]\nWindowedMode=FALSE\nMaximized=0\n", "utf8");
  await fsp.writeFile(path.join(gameDirectory, "eqlsPlayerData.ini"), "[PLAYER]\nUsername=olduser\n", "utf8");

  backend.state.gameDirectory = gameDirectory;
  backend.state.clientVersion = "Rain_Of_Fear_2";
  backend.state.clientLabel = "Rain of Fear 2";
  backend.state.clientSupported = true;
  backend.state.canLaunch = true;
  backend.state.onGameLaunch = "minimize";
  backend.autoLoginProfiles = [{
    id: "profile-1",
    label: "Vayle Box",
    username: "vayle2",
    secret: "protected-secret",
    createdAt: "2026-06-21T00:00:00.000Z",
    updatedAt: "2026-06-21T00:00:00.000Z"
  }];
  backend.syncAutoLoginProfilesState();
  backend.unprotectAutoLoginSecret = async (secret) => {
    assert.equal(secret, "protected-secret");
    return "not-the-real-password";
  };
  backend.runAutoLoginHelper = async (request) => {
    helperRequest = { ...request };
    return { confirmed: true, enteredWorld: request.enterWorld === true };
  };

  const state = await backend.launchAutoLoginProfile({ id: "profile-1", enterWorld: true });
  const eqclient = await fsp.readFile(path.join(gameDirectory, "eqclient.ini"), "utf8");
  const eqlsPlayerData = await fsp.readFile(path.join(gameDirectory, "eqlsPlayerData.ini"), "utf8");

  assert.match(eqclient, /^WindowedMode=TRUE$/m);
  assert.match(eqclient, /^Maximized=1$/m);
  assert.match(eqlsPlayerData, /^Username=vayle2$/m);
  assert.equal(helperRequest.eqGamePath, path.join(gameDirectory, "eqgame.exe"));
  assert.equal(helperRequest.username, "vayle2");
  assert.equal(helperRequest.password, "not-the-real-password");
  assert.equal(helperRequest.enterWorld, true);
  assert.equal(state.statusBadge, "Auto Login");
  assert.match(state.statusDetail, /Play EverQuest/);
  assert.equal(state.isAutoLoginRunning, false);
  assert.equal(state.autoLoginOverlayText, "");
  assert.equal(state.autoLoginOverlayProgress, 0);
  assert.equal(state.autoLoginOverlayTone, "default");
  assert.deepEqual(
    [...new Set(events
      .filter((event) => event.type === "state" && event.payload.autoLoginOverlayText)
      .map((event) => `${event.payload.autoLoginOverlayText}|${event.payload.autoLoginOverlayProgress}|${event.payload.autoLoginOverlayTone}`))],
    [
      "Loading Vayle Box|0|default",
      "Loading Vayle Box|100|success"
    ]
  );
  assert.equal(JSON.stringify(state).includes("not-the-real-password"), false);
  assert.deepEqual(launchActions, [{ action: "minimize", autoTriggered: false }]);
});

test("launchAutoLoginProfiles runs selected profiles sequentially in saved order", async (t) => {
  const launchActions = [];
  const helperRequests = [];
  const { backend, events } = await createBackendHarness(t, {
    platform: "win32",
    onGameLaunched: async (payload) => {
      launchActions.push(payload);
    }
  });
  const gameDirectory = await createTempDir("eqemu-game-");

  t.after(async () => {
    await fsp.rm(gameDirectory, { recursive: true, force: true });
  });

  await fsp.writeFile(path.join(gameDirectory, "eqgame.exe"), "dummy", "utf8");
  await fsp.writeFile(path.join(gameDirectory, "eqclient.ini"), "[Defaults]\nWindowedMode=FALSE\nMaximized=0\n", "utf8");
  await fsp.writeFile(path.join(gameDirectory, "eqlsPlayerData.ini"), "[PLAYER]\nUsername=olduser\n", "utf8");

  backend.state.gameDirectory = gameDirectory;
  backend.state.clientVersion = "Rain_Of_Fear_2";
  backend.state.clientLabel = "Rain of Fear 2";
  backend.state.clientSupported = true;
  backend.state.canLaunch = true;
  backend.state.onGameLaunch = "minimize";
  backend.autoLoginProfiles = [{
    id: "profile-1",
    label: "Druid",
    username: "vayle04",
    secret: "protected-druid",
    isDefault: true,
    createdAt: "2026-06-21T00:00:00.000Z",
    updatedAt: "2026-06-21T00:00:00.000Z"
  }, {
    id: "profile-2",
    label: "Cleric",
    username: "bgondaway",
    secret: "protected-cleric",
    createdAt: "2026-06-21T00:00:00.000Z",
    updatedAt: "2026-06-21T00:00:00.000Z"
  }, {
    id: "profile-3",
    label: "Bard",
    username: "vayle3",
    secret: "protected-bard",
    createdAt: "2026-06-21T00:00:00.000Z",
    updatedAt: "2026-06-21T00:00:00.000Z"
  }];
  backend.syncAutoLoginProfilesState();
  backend.unprotectAutoLoginSecret = async (secret) => `password-for-${secret}`;
  backend.runAutoLoginHelper = async (request) => {
    helperRequests.push({ ...request });
    return { confirmed: true, enteredWorld: request.enterWorld === true };
  };

  const state = await backend.launchAutoLoginProfiles({
    ids: ["profile-3", "profile-1"],
    autoTriggered: true,
    enterWorld: true
  });
  const eqlsPlayerData = await fsp.readFile(path.join(gameDirectory, "eqlsPlayerData.ini"), "utf8");

  assert.deepEqual(helperRequests.map((request) => request.username), ["vayle04", "vayle3"]);
  assert.deepEqual(helperRequests.map((request) => request.password), ["password-for-protected-druid", "password-for-protected-bard"]);
  assert.deepEqual(helperRequests.map((request) => request.enterWorld), [true, true]);
  assert.match(eqlsPlayerData, /^Username=vayle3$/m);
  assert.equal(state.statusBadge, "Auto Login");
  assert.match(state.statusDetail, /2 selected profiles pressed Play EverQuest/);
  assert.equal(state.isAutoLoginRunning, false);
  assert.equal(state.autoLoginOverlayText, "");
  assert.equal(state.autoLoginOverlayProgress, 0);
  assert.equal(state.autoLoginOverlayTone, "default");
  assert.deepEqual(
    [...new Set(events
      .filter((event) => event.type === "state" && event.payload.autoLoginOverlayText)
      .map((event) => `${event.payload.autoLoginOverlayText}|${event.payload.autoLoginOverlayProgress}|${event.payload.autoLoginOverlayTone}`))],
    [
      "Loading Druid (1/2)|0|default",
      "Loading Druid (1/2)|50|success",
      "Loading Bard (2/2)|50|default",
      "Loading Bard (2/2)|100|success"
    ]
  );
  assert.deepEqual(launchActions, [{ action: "minimize", autoTriggered: true }]);
});

test("launchAutoLoginProfiles keeps credentials paired across a large selected batch", async (t) => {
  const helperRequests = [];
  const profileCount = 64;
  const { backend } = await createBackendHarness(t, {
    platform: "win32",
    autoLoginBatchDelayMs: 0
  });
  const gameDirectory = await createTempDir("eqemu-game-");

  t.after(async () => {
    await fsp.rm(gameDirectory, { recursive: true, force: true });
  });

  await fsp.writeFile(path.join(gameDirectory, "eqgame.exe"), "dummy", "utf8");
  await fsp.writeFile(path.join(gameDirectory, "eqclient.ini"), "[Defaults]\nWindowedMode=FALSE\nMaximized=0\n", "utf8");
  await fsp.writeFile(path.join(gameDirectory, "eqlsPlayerData.ini"), "[PLAYER]\nUsername=olduser\n", "utf8");

  backend.state.gameDirectory = gameDirectory;
  backend.state.clientVersion = "Rain_Of_Fear_2";
  backend.state.clientLabel = "Rain of Fear 2";
  backend.state.clientSupported = true;
  backend.state.canLaunch = true;
  backend.autoLoginProfiles = Array.from({ length: profileCount }, (_value, index) => ({
    id: `profile-${String(index + 1).padStart(2, "0")}`,
    label: `Box ${index + 1}`,
    username: `account${String(index + 1).padStart(2, "0")}`,
    secret: `secret-${index + 1}`,
    isDefault: index === 0,
    createdAt: "2026-06-21T00:00:00.000Z",
    updatedAt: "2026-06-21T00:00:00.000Z"
  }));
  backend.syncAutoLoginProfilesState();
  backend.unprotectAutoLoginSecret = async (secret) => `password-for-${secret}`;
  backend.runAutoLoginHelper = async (request) => {
    const eqlsPlayerData = await fsp.readFile(path.join(gameDirectory, "eqlsPlayerData.ini"), "utf8");
    helperRequests.push({
      username: request.username,
      password: request.password,
      enterWorld: request.enterWorld,
      configuredUsername: eqlsPlayerData.match(/^Username=(.*)$/m)?.[1] || ""
    });
    return { confirmed: true, enteredWorld: request.enterWorld === true };
  };

  const requestedIds = backend.autoLoginProfiles.map((profile) => profile.id).reverse();
  const state = await backend.launchAutoLoginProfiles({
    ids: requestedIds,
    enterWorld: true
  });
  const expectedUsernames = backend.autoLoginProfiles.map((profile) => profile.username);
  const expectedPasswords = backend.autoLoginProfiles.map((profile) => `password-for-${profile.secret}`);
  const eqlsPlayerData = await fsp.readFile(path.join(gameDirectory, "eqlsPlayerData.ini"), "utf8");

  assert.equal(helperRequests.length, backend.autoLoginProfiles.length);
  assert.deepEqual(helperRequests.map((request) => request.username), expectedUsernames);
  assert.deepEqual(helperRequests.map((request) => request.password), expectedPasswords);
  assert.deepEqual(helperRequests.map((request) => request.configuredUsername), expectedUsernames);
  assert.deepEqual(helperRequests.map((request) => request.enterWorld), backend.autoLoginProfiles.map(() => true));
  assert.match(eqlsPlayerData, new RegExp(`^Username=account${String(profileCount).padStart(2, "0")}$`, "m"));
  assert.equal(state.statusBadge, "Auto Login");
  assert.match(state.statusDetail, new RegExp(`${profileCount} selected profiles pressed Play EverQuest`));
});

test("launchGame routes through auto-login when Auto Login is enabled", async (t) => {
  const launchActions = [];
  let spawnCalls = 0;
  let helperRequest = null;
  const { backend } = await createBackendHarness(t, {
    platform: "win32",
    spawnImpl: () => {
      spawnCalls += 1;
      throw new Error("plain launch should not be used");
    },
    onGameLaunched: async (payload) => {
      launchActions.push(payload);
    }
  });
  const gameDirectory = await createTempDir("eqemu-game-");

  t.after(async () => {
    await fsp.rm(gameDirectory, { recursive: true, force: true });
  });

  await fsp.writeFile(path.join(gameDirectory, "eqgame.exe"), "dummy", "utf8");
  await fsp.writeFile(path.join(gameDirectory, "eqclient.ini"), "[Defaults]\nWindowedMode=FALSE\nMaximized=0\n", "utf8");

  backend.state.gameDirectory = gameDirectory;
  backend.state.clientVersion = "Rain_Of_Fear_2";
  backend.state.clientLabel = "Rain of Fear 2";
  backend.state.clientSupported = true;
  backend.state.canLaunch = true;
  backend.state.autoLogin = true;
  backend.state.autoLoginEnterWorld = true;
  backend.autoLoginProfiles = [{
    id: "profile-1",
    label: "Vayle Box",
    username: "vayle2",
    secret: "protected-secret",
    isDefault: true,
    createdAt: "2026-06-21T00:00:00.000Z",
    updatedAt: "2026-06-21T00:00:00.000Z"
  }];
  backend.syncAutoLoginProfilesState();
  backend.unprotectAutoLoginSecret = async () => "not-the-real-password";
  backend.runAutoLoginHelper = async (request) => {
    helperRequest = { ...request };
    return { confirmed: true };
  };

  const state = await backend.launchGame({ autoTriggered: true });

  assert.equal(spawnCalls, 0);
  assert.equal(helperRequest.username, "vayle2");
  assert.equal(helperRequest.enterWorld, true);
  assert.equal(state.statusBadge, "Auto Login");
  assert.deepEqual(launchActions, [{ action: "minimize", autoTriggered: true }]);
});

test("launchGame routes all selected profiles through batch auto-login", async (t) => {
  const helperRequests = [];
  const { backend } = await createBackendHarness(t, {
    platform: "win32",
    autoLoginBatchDelayMs: 0
  });
  const gameDirectory = await createTempDir("eqemu-game-");

  t.after(async () => {
    await fsp.rm(gameDirectory, { recursive: true, force: true });
  });

  await fsp.writeFile(path.join(gameDirectory, "eqgame.exe"), "dummy", "utf8");
  await fsp.writeFile(path.join(gameDirectory, "eqclient.ini"), "[Defaults]\nWindowedMode=FALSE\nMaximized=0\n", "utf8");
  await fsp.writeFile(path.join(gameDirectory, "eqlsPlayerData.ini"), "[PLAYER]\nUsername=olduser\n", "utf8");

  backend.state.gameDirectory = gameDirectory;
  backend.state.clientVersion = "Rain_Of_Fear_2";
  backend.state.clientLabel = "Rain of Fear 2";
  backend.state.clientSupported = true;
  backend.state.canLaunch = true;
  backend.state.autoLogin = true;
  backend.state.autoLoginEnterWorld = true;
  backend.autoLoginProfiles = [{
    id: "profile-1",
    label: "Druid",
    username: "vayle04",
    secret: "protected-druid",
    isDefault: true,
    createdAt: "2026-06-21T00:00:00.000Z",
    updatedAt: "2026-06-21T00:00:00.000Z"
  }, {
    id: "profile-2",
    label: "Cleric",
    username: "bgondaway",
    secret: "protected-cleric",
    createdAt: "2026-06-21T00:00:00.000Z",
    updatedAt: "2026-06-21T00:00:00.000Z"
  }, {
    id: "profile-3",
    label: "Bard",
    username: "vayle3",
    secret: "protected-bard",
    createdAt: "2026-06-21T00:00:00.000Z",
    updatedAt: "2026-06-21T00:00:00.000Z"
  }];
  backend.state.selectedAutoLoginProfileId = "profile-2";
  backend.state.selectedAutoLoginProfileIds = ["profile-3", "profile-1", "profile-2"];
  backend.syncAutoLoginProfilesState();
  backend.unprotectAutoLoginSecret = async (secret) => `password-for-${secret}`;
  backend.runAutoLoginHelper = async (request) => {
    helperRequests.push({ ...request });
    return { confirmed: true, enteredWorld: request.enterWorld === true };
  };

  const state = await backend.launchGame({ autoTriggered: true });

  assert.deepEqual(helperRequests.map((request) => request.username), ["vayle04", "bgondaway", "vayle3"]);
  assert.deepEqual(helperRequests.map((request) => request.password), [
    "password-for-protected-druid",
    "password-for-protected-cleric",
    "password-for-protected-bard"
  ]);
  assert.deepEqual(helperRequests.map((request) => request.enterWorld), [true, true, true]);
  assert.equal(state.statusBadge, "Auto Login");
  assert.match(state.statusDetail, /3 selected profiles pressed Play EverQuest/);
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

  await writePortableExecutable(path.join(gameDirectory, "eqgame.exe"), 0x014C);
  backend.state.gameDirectory = gameDirectory;
  backend.state.clientVersion = "Rain_Of_Fear_2";
  backend.state.clientLabel = "Rain of Fear 2";
  backend.state.clientSupported = true;
  backend.inspectMissingRuntimeDependencies = async () => ({
    executableArch: "x86",
    primaryMissingDependency: "d3dx9_30.dll",
    missingSummary: "Static dependency scan found unresolved DLL imports, including d3dx9_30.dll.",
    missingDependencies: [
      {
        name: "d3dx9_30.dll",
        referencedBy: "eqgame.exe"
      }
    ]
  });

  const state = await backend.launchGame();
  const logMessages = events.filter((event) => event.type === "log").map((event) => event.payload.text);

  assert.equal(state.statusBadge, "Launch Error");
  assert.match(state.statusDetail, /0xC0000135/i);
  assert.match(state.statusDetail, /required DLL was missing/i);
  assert.match(state.statusDetail, /DirectX 9 June 2010 runtime/i);
  assert.equal(state.canInstallPrerequisites, true);
  assert.equal(state.prerequisiteInstallArch, "x86");
  assert.equal(state.prerequisiteDirectXUrl, "https://download.microsoft.com/download/8/4/a/84a35bf1-dafe-4ae8-82af-ad2ae20b6b14/directx_Jun2010_redist.exe");
  assert.equal(state.prerequisiteVcUrl, "https://aka.ms/vc14/vc_redist.x86.exe");
  assert(logMessages.includes("Launch method: direct spawn."));
  assert(logMessages.includes("Startup status: 0xC0000135 (STATUS_DLL_NOT_FOUND)."));
  assert(logMessages.includes("Assessment: A required DLL was missing during startup."));
  assert(logMessages.includes("Suggested fix: Install the DirectX 9 June 2010 runtime and the Visual C++ redistributables, then try again."));
  assert(logMessages.includes("Using the Visual C++ X86 redistributable because eqgame.exe is X86."));
  assert(logMessages.includes("Static dependency scan found unresolved DLL imports, including d3dx9_30.dll."));
  assert(logMessages.includes("Static dependency scan found unresolved DLL import: d3dx9_30.dll (referenced by eqgame.exe)."));
});

test("installMissingPrerequisites downloads DirectX and the matching Visual C++ runtime", async (t) => {
  const downloads = [];
  const spawns = [];
  const { backend } = await createBackendHarness(t, {
    platform: "win32",
    fetchImpl: async (url) => {
      downloads.push(url);
      return {
        ok: true,
        body: Readable.from([Buffer.from(`payload:${url}`)])
      };
    },
    spawnImpl: (command, args) => {
      spawns.push({
        command,
        args: Array.isArray(args) ? [...args] : []
      });

      if (path.basename(command).toLowerCase() === "directx_jun2010_redist.exe") {
        const extractArg = args.find((entry) => String(entry).startsWith("/T:"));
        const extractPath = extractArg ? String(extractArg).slice(3) : "";
        if (extractPath) {
          fs.mkdirSync(extractPath, { recursive: true });
          fs.writeFileSync(path.join(extractPath, "DXSETUP.exe"), "");
        }
      }

      const child = new EventEmitter();
      child.unref = () => {};
      process.nextTick(() => {
        child.emit("spawn");
        child.emit("exit", 0, null);
      });
      return child;
    }
  });
  const gameDirectory = await createTempDir("eqemu-game-");

  t.after(async () => {
    await fsp.rm(gameDirectory, { recursive: true, force: true });
  });

  await writePortableExecutable(path.join(gameDirectory, "eqgame.exe"), 0x014C);
  backend.state.gameDirectory = gameDirectory;
  backend.state.canInstallPrerequisites = true;

  const state = await backend.installMissingPrerequisites();

  assert.deepEqual(downloads, [
    "https://download.microsoft.com/download/8/4/a/84a35bf1-dafe-4ae8-82af-ad2ae20b6b14/directx_Jun2010_redist.exe",
    "https://aka.ms/vc14/vc_redist.x86.exe"
  ]);
  assert.equal(path.basename(spawns[0].command).toLowerCase(), "directx_jun2010_redist.exe");
  assert.deepEqual(spawns[0].args.slice(0, 1), ["/Q"]);
  assert.equal(path.basename(spawns[1].command).toLowerCase(), "dxsetup.exe");
  assert.deepEqual(spawns[1].args, ["/silent"]);
  assert.equal(path.basename(spawns[2].command).toLowerCase(), "vc_redist.x86.exe");
  assert.deepEqual(spawns[2].args, ["/install", "/passive", "/norestart"]);
  assert.equal(state.statusBadge, "Ready");
  assert.match(state.statusDetail, /Launch EverQuest again/i);
  assert.equal(state.canInstallPrerequisites, false);
  assert.equal(state.isInstallingPrerequisites, false);
});

test("installMissingPrerequisites fails gracefully with retry guidance when an installer exits with an error", async (t) => {
  const events = [];
  const { backend } = await createBackendHarness(t, {
    platform: "win32",
    eventSink: (event) => events.push(event),
    fetchImpl: async () => {
      return {
        ok: true,
        body: Readable.from([Buffer.from("payload")])
      };
    },
    spawnImpl: (command, args) => {
      if (path.basename(command).toLowerCase() === "directx_jun2010_redist.exe") {
        const extractArg = args.find((entry) => String(entry).startsWith("/T:"));
        const extractPath = extractArg ? String(extractArg).slice(3) : "";
        if (extractPath) {
          fs.mkdirSync(extractPath, { recursive: true });
          fs.writeFileSync(path.join(extractPath, "DXSETUP.exe"), "");
        }
      }

      const child = new EventEmitter();
      child.unref = () => {};
      process.nextTick(() => {
        child.emit("spawn");
        if (path.basename(command).toLowerCase() === "vc_redist.x64.exe") {
          child.emit("exit", 1603, null);
          return;
        }
        child.emit("exit", 0, null);
      });
      return child;
    },
    environment: {
      PROCESSOR_ARCHITECTURE: "AMD64"
    }
  });
  const gameDirectory = await createTempDir("eqemu-game-");

  t.after(async () => {
    await fsp.rm(gameDirectory, { recursive: true, force: true });
  });

  await writePortableExecutable(path.join(gameDirectory, "eqgame.exe"), 0x8664);
  backend.state.gameDirectory = gameDirectory;

  const state = await backend.installMissingPrerequisites();
  const logMessages = events.filter((event) => event.type === "log").map((event) => event.payload.text);

  assert.equal(state.statusBadge, "Install Error");
  assert.match(state.statusDetail, /failed while installing visual c\+\+ runtime/i);
  assert.equal(state.canInstallPrerequisites, true);
  assert.equal(state.prerequisiteInstallArch, "x64");
  assert.equal(state.prerequisiteDirectXUrl, "https://download.microsoft.com/download/8/4/a/84a35bf1-dafe-4ae8-82af-ad2ae20b6b14/directx_Jun2010_redist.exe");
  assert.equal(state.prerequisiteVcUrl, "https://aka.ms/vc14/vc_redist.x64.exe");
  assert(logMessages.some((entry) => /Runtime installation failed while installing Visual C\+\+ runtime/i.test(entry)));
  assert(logMessages.some((entry) => /Recommended: Allow any Windows security or UAC prompts/i.test(entry)));
  assert(logMessages.some((entry) => /Recommended: If the Visual C\+\+ installer keeps failing, restart Windows/i.test(entry)));
  assert(logMessages.some((entry) => /Recommended: DirectX June 2010:/i.test(entry)));
  assert(logMessages.some((entry) => /Recommended: Visual C\+\+ X64:/i.test(entry)));
});

test("installMissingPrerequisites reports an incomplete install when dependency validation still finds a missing DLL", async (t) => {
  const events = [];
  const { backend } = await createBackendHarness(t, {
    platform: "win32",
    eventSink: (event) => events.push(event),
    fetchImpl: async () => {
      return {
        ok: true,
        body: Readable.from([Buffer.from("payload")])
      };
    },
    spawnImpl: (command, args) => {
      if (path.basename(command).toLowerCase() === "directx_jun2010_redist.exe") {
        const extractArg = args.find((entry) => String(entry).startsWith("/T:"));
        const extractPath = extractArg ? String(extractArg).slice(3) : "";
        if (extractPath) {
          fs.mkdirSync(extractPath, { recursive: true });
          fs.writeFileSync(path.join(extractPath, "DXSETUP.exe"), "");
        }
      }

      const child = new EventEmitter();
      child.unref = () => {};
      process.nextTick(() => {
        child.emit("spawn");
        child.emit("exit", 0, null);
      });
      return child;
    }
  });
  const gameDirectory = await createTempDir("eqemu-game-");

  t.after(async () => {
    await fsp.rm(gameDirectory, { recursive: true, force: true });
  });

  await writePortableExecutable(path.join(gameDirectory, "eqgame.exe"), 0x014C);
  backend.state.gameDirectory = gameDirectory;
  let validationCallCount = 0;
  backend.inspectMissingRuntimeDependencies = async () => {
    validationCallCount += 1;
    return {
      executableArch: "x86",
      primaryMissingDependency: "d3dx9_30.dll",
      missingSummary: "Static dependency scan found unresolved DLL imports, including d3dx9_30.dll.",
      missingDependencies: [
        {
          name: "d3dx9_30.dll",
          referencedBy: "eqgame.exe"
        }
      ]
    };
  };

  const state = await backend.installMissingPrerequisites();
  const logMessages = events.filter((event) => event.type === "log").map((event) => event.payload.text);

  assert.equal(validationCallCount, 1);
  assert.equal(state.statusBadge, "Install Incomplete");
  assert.match(state.statusDetail, /static dependency scan found unresolved dll imports, including d3dx9_30\.dll/i);
  assert.equal(state.canInstallPrerequisites, true);
  assert.equal(state.prerequisiteInstallArch, "x86");
  assert.equal(state.prerequisiteDirectXUrl, "https://download.microsoft.com/download/8/4/a/84a35bf1-dafe-4ae8-82af-ad2ae20b6b14/directx_Jun2010_redist.exe");
  assert.equal(state.prerequisiteVcUrl, "https://aka.ms/vc14/vc_redist.x86.exe");
  assert(logMessages.some((entry) => /dependency validation still found unresolved DLL imports/i.test(entry)));
  assert(logMessages.includes("Static dependency scan found unresolved DLL import: d3dx9_30.dll (referenced by eqgame.exe)."));
});

test("packaged builds ignore prerequisite simulation hooks unless explicitly enabled", async (t) => {
  const { backend } = await createBackendHarness(t, {
    isPackaged: true,
    environment: {
      EQEMU_TEST_FORCE_LAUNCH_EXIT: "0xC0000135",
      EQEMU_TEST_FORCE_SCAN_MISSING_DLLS: "d3dx9_30.dll",
      EQEMU_TEST_PREREQ_MODE: "success"
    }
  });

  assert.equal(backend.testSimulation.active, false);
  assert.equal(backend.testSimulation.launchExitCode, null);
  assert.deepEqual(backend.testSimulation.missingDlls, []);
  assert.equal(backend.testSimulation.installMode, "");
});

test("spawnAndWait fails clearly when an installer does not finish before the timeout", async (t) => {
  const { backend } = await createBackendHarness(t, {
    spawnImpl: () => {
      const child = new EventEmitter();
      child.unref = () => {};
      child.kill = () => {};
      process.nextTick(() => {
        child.emit("spawn");
      });
      return child;
    }
  });

  await assert.rejects(
    backend.spawnAndWait("hung-installer.exe", [], {}, {
      label: "Hung installer",
      timeoutMs: 25
    }),
    /Hung installer did not finish within 25 seconds|Hung installer did not finish within 1 second/i
  );
});

test("downloadFile allows callers to omit the progress callback", async (t) => {
  const { backend } = await createBackendHarness(t, {
    fetchImpl: async () => ({
      ok: true,
      body: Readable.from([Buffer.from("payload")]),
      headers: {
        get(name) {
          return String(name).toLowerCase() === "content-length" ? "7" : null;
        }
      }
    })
  });
  const destinationDirectory = await createTempDir("eqemu-download-");
  const destinationPath = path.join(destinationDirectory, "payload.bin");

  t.after(async () => {
    await fsp.rm(destinationDirectory, { recursive: true, force: true });
  });

  await backend.downloadFile("https://example.invalid/payload.bin", destinationPath, null);

  assert.equal(await fsp.readFile(destinationPath, "utf8"), "payload");
});

test("ui manager mutations are blocked while prerequisites are installing", async (t) => {
  const { backend } = await createBackendHarness(t);
  const calls = [];

  backend.uiManager = {
    async getUiManagerOverview() {
      calls.push("overview");
      return { packages: [] };
    },
    async importUiPackageFolder(_sourcePath) {
      calls.push("import");
      return {};
    },
    async prepareUiPackage(_packageName) {
      calls.push("prepare");
      return {};
    },
    async validateUiPackageOptionComments(_packageName) {
      calls.push("validate");
      return {};
    },
    async activateUiOption(_options) {
      calls.push("activate");
      return {};
    },
    async setUiSkinTargets(_options) {
      calls.push("skin");
      return {};
    },
    async resetUiPackage(_packageName) {
      calls.push("reset");
      return {};
    },
    async restoreUiManagerBackup(_options) {
      calls.push("restore");
      return {};
    }
  };
  backend.state.isInstallingPrerequisites = true;

  await assert.rejects(backend.importUiPackageFolder("C:\\Temp\\FancyUI"), /UI Manager actions are unavailable while prerequisites are installing\./);
  await assert.rejects(backend.prepareUiPackage("FancyUI"), /UI Manager actions are unavailable while prerequisites are installing\./);
  await assert.rejects(backend.validateUiPackageOptionComments("FancyUI"), /UI Manager actions are unavailable while prerequisites are installing\./);
  await assert.rejects(backend.activateUiOption({ packageName: "FancyUI", optionPath: "Options/Alt/Red" }), /UI Manager actions are unavailable while prerequisites are installing\./);
  await assert.rejects(backend.setUiSkinTargets({ packageName: "FancyUI", iniPaths: ["C:\\EQ\\UI_Test.ini"] }), /UI Manager actions are unavailable while prerequisites are installing\./);
  await assert.rejects(backend.resetUiPackage("FancyUI"), /UI Manager actions are unavailable while prerequisites are installing\./);
  await assert.rejects(backend.restoreUiManagerBackup({ packageName: "FancyUI", backupId: "backup-1" }), /UI Manager actions are unavailable while prerequisites are installing\./);

  const overview = await backend.getUiManagerOverview();

  assert.deepEqual(overview, { packages: [] });
  assert.deepEqual(calls, ["overview"]);
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
