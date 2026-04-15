const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const fsp = require("node:fs/promises");

const { LauncherBackend } = require("../src/electron/backend/launcher-backend");

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

async function createSimulationHarness(t, environment = {}) {
  const projectRoot = await createTempDir("eqemu-sim-project-");
  const appUserDataPath = await createTempDir("eqemu-sim-user-");
  const gameDirectory = await createTempDir("eqemu-sim-game-");
  const events = [];

  t.after(async () => {
    await fsp.rm(projectRoot, { recursive: true, force: true });
    await fsp.rm(appUserDataPath, { recursive: true, force: true });
    await fsp.rm(gameDirectory, { recursive: true, force: true });
  });

  await writePortableExecutable(path.join(gameDirectory, "eqgame.exe"), 0x014C);

  const backend = new LauncherBackend({
    appUserDataPath,
    projectRoot,
    launchDirectory: gameDirectory,
    runtimeDirectory: gameDirectory,
    platform: "win32",
    environment: {
      PROCESSOR_ARCHITECTURE: "AMD64",
      ...environment
    },
    eventSink: (event) => events.push(event)
  });

  backend.state.gameDirectory = gameDirectory;
  backend.state.clientVersion = "Rain_Of_Fear_2";
  backend.state.clientLabel = "Rain of Fear 2";
  backend.state.clientSupported = true;
  backend.state.canLaunch = true;

  return {
    backend,
    events,
    gameDirectory
  };
}

function getLogMessages(events) {
  return events.filter((event) => event.type === "log").map((event) => event.payload.text);
}

function getProgressLabels(events) {
  return events.filter((event) => event.type === "progress").map((event) => event.payload.label);
}

test("simulated prerequisite workflow: launch failure -> install success -> ready", async (t) => {
  const { backend, events } = await createSimulationHarness(t, {
    EQEMU_TEST_FORCE_LAUNCH_EXIT: "0xC0000135",
    EQEMU_TEST_FORCE_SCAN_MISSING_DLLS: "d3dx9_30.dll",
    EQEMU_TEST_PREREQ_MODE: "success"
  });

  const launchState = await backend.launchGame();
  assert.equal(launchState.statusBadge, "Launch Error");
  assert.equal(launchState.canInstallPrerequisites, true);

  const installState = await backend.installMissingPrerequisites();
  const logMessages = getLogMessages(events);
  const progressLabels = getProgressLabels(events);

  assert.equal(installState.statusBadge, "Ready");
  assert.equal(installState.canInstallPrerequisites, false);
  assert(progressLabels.includes("Step 1 of 5: Downloading DirectX runtime"));
  assert(progressLabels.includes("Step 5 of 5: Installing Visual C++ X86"));
  assert(logMessages.some((entry) => /Simulation: DirectX runtime download completed\./.test(entry)));
  assert(logMessages.some((entry) => /Dependency validation passed after installing the runtime prerequisites\./.test(entry)));
});

test("simulated prerequisite workflow: installer failure stays retryable", async (t) => {
  const { backend, events } = await createSimulationHarness(t, {
    EQEMU_TEST_FORCE_LAUNCH_EXIT: "0xC0000135",
    EQEMU_TEST_FORCE_SCAN_MISSING_DLLS: "d3dx9_30.dll",
    EQEMU_TEST_PREREQ_MODE: "fail"
  });

  await backend.launchGame();
  const installState = await backend.installMissingPrerequisites();
  const logMessages = getLogMessages(events);

  assert.equal(installState.statusBadge, "Install Error");
  assert.equal(installState.canInstallPrerequisites, true);
  assert(logMessages.some((entry) => /Runtime installation failed while installing Visual C\+\+ runtime: Simulated prerequisite installer failure\./.test(entry)));
  assert(logMessages.some((entry) => /Recommended: If retrying still fails, install DirectX June 2010 and Visual C\+\+ X86 manually/i.test(entry)));
});

test("simulated prerequisite workflow: installer incomplete remains conservative", async (t) => {
  const { backend, events } = await createSimulationHarness(t, {
    EQEMU_TEST_FORCE_LAUNCH_EXIT: "0xC0000135",
    EQEMU_TEST_FORCE_SCAN_MISSING_DLLS: "d3dx9_30.dll",
    EQEMU_TEST_PREREQ_MODE: "incomplete"
  });

  await backend.launchGame();
  const installState = await backend.installMissingPrerequisites();
  const logMessages = getLogMessages(events);

  assert.equal(installState.statusBadge, "Install Incomplete");
  assert.equal(installState.canInstallPrerequisites, true);
  assert.match(installState.statusDetail, /static dependency scan found unresolved dll imports/i);
  assert(logMessages.some((entry) => /Static dependency scan found unresolved DLL import: d3dx9_30\.dll/i.test(entry)));
});

test("simulated prerequisite workflow: reboot-required outcome is preserved", async (t) => {
  const { backend } = await createSimulationHarness(t, {
    EQEMU_TEST_FORCE_LAUNCH_EXIT: "0xC0000135",
    EQEMU_TEST_PREREQ_MODE: "reboot"
  });

  await backend.launchGame();
  const installState = await backend.installMissingPrerequisites();

  assert.equal(installState.statusBadge, "Restart Required");
  assert.match(installState.statusDetail, /restart is required/i);
});
