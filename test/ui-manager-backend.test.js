const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const { LauncherBackend } = require("../src/electron/backend/launcher-backend");
const { MAX_UI_MANAGER_BACKUPS_PER_PACKAGE } = require("../src/electron/backend/ui-manager");

async function createTempDir(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function createHarness(t) {
  const projectRoot = await createTempDir("eqemu-ui-project-");
  const appUserDataPath = await createTempDir("eqemu-ui-user-");
  const gameDirectory = await createTempDir("eqemu-ui-game-");
  const backend = new LauncherBackend({
    appUserDataPath,
    projectRoot,
    eventSink: () => {}
  });
  backend.state.gameDirectory = gameDirectory;

  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
    await fs.rm(appUserDataPath, { recursive: true, force: true });
    await fs.rm(gameDirectory, { recursive: true, force: true });
  });

  await fs.mkdir(path.join(gameDirectory, "uifiles"), { recursive: true });

  return {
    backend,
    gameDirectory
  };
}

async function writeFile(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
}

async function readFile(filePath) {
  return fs.readFile(filePath, "utf8");
}

function createXml(body, sourceComment = "") {
  return `${sourceComment ? `${sourceComment}\n` : ""}<?xml version="1.0" encoding="us-ascii" ?>\n<XML>${body}</XML>\n`;
}

async function seedUiIni(gameDirectory, fileName, uiSkin = "Default") {
  const iniPath = path.join(gameDirectory, fileName);
  await writeFile(iniPath, `[Main]\nUISkin=${uiSkin}\nAtlasSkin=Default\n`);
  return iniPath;
}

test("prepareUiPackage creates Options/Default, moves root folders, and normalizes source comments", async (t) => {
  const { backend, gameDirectory } = await createHarness(t);
  const packagePath = path.join(gameDirectory, "uifiles", "FancyUI");

  await writeFile(path.join(packagePath, "EQUI_Inventory.xml"), createXml("inventory", "<!-- Original author note -->"));
  await writeFile(
    path.join(packagePath, "EQUI_TargetWindow.xml"),
    createXml("alt-target", "<!-- Target Variants\\Slim -->")
  );
  await writeFile(
    path.join(packagePath, "Target Variants", "Slim", "EQUI_TargetWindow.xml"),
    createXml("alt-target", "<!-- Target Variants\\Slim -->")
  );
  await writeFile(path.join(packagePath, "skin.tga"), "root-skin");

  const result = await backend.prepareUiPackage("FancyUI");
  const inventoryRoot = await readFile(path.join(packagePath, "EQUI_Inventory.xml"));
  const targetRoot = await readFile(path.join(packagePath, "EQUI_TargetWindow.xml"));
  const optionTarget = await readFile(path.join(packagePath, "Options", "Target Variants", "Slim", "EQUI_TargetWindow.xml"));

  assert.equal(result.details.prepared, true);
  assert.match(inventoryRoot, /^<!-- Options\/Default -->\n<!-- Original author note -->/);
  assert.match(targetRoot, /^<!-- Options\/Target Variants\/Slim -->/);
  assert.match(optionTarget, /^<!-- Options\/Target Variants\/Slim -->/);
  assert.equal(await fs.stat(path.join(packagePath, "Options", "Default")).then(() => true), true);
  assert.equal(await fs.stat(path.join(packagePath, "Options", "Target Variants", "Slim")).then(() => true), true);
  assert.equal(await fs.stat(path.join(packagePath, "Target Variants")).then(() => false).catch(() => true), true);
});

test("prepareUiPackage auto-created Options/Default preserves the original root layout before root folders are moved", async (t) => {
  const { backend, gameDirectory } = await createHarness(t);
  const packagePath = path.join(gameDirectory, "uifiles", "FancyUI");

  await writeFile(path.join(packagePath, "EQUI_Inventory.xml"), createXml("inventory"));
  await writeFile(
    path.join(packagePath, "Window Sets", "Raid", "EQUI_RaidWindow.xml"),
    createXml("raid-window")
  );
  await writeFile(path.join(packagePath, "Window Sets", "Raid", "raid-window.tga"), "raid-window-tga");

  await backend.prepareUiPackage("FancyUI");

  assert.equal(await fs.stat(path.join(packagePath, "Options", "Default", "EQUI_Inventory.xml")).then(() => true), true);
  assert.equal(await fs.stat(path.join(packagePath, "Options", "Default", "Window Sets", "Raid", "EQUI_RaidWindow.xml")).then(() => true), true);
  assert.equal(await fs.stat(path.join(packagePath, "Options", "Default", "Window Sets", "Raid", "raid-window.tga")).then(() => true), true);
  assert.equal(await fs.stat(path.join(packagePath, "Options", "Window Sets", "Raid", "EQUI_RaidWindow.xml")).then(() => true), true);
  assert.equal(await fs.stat(path.join(packagePath, "Window Sets")).then(() => false).catch(() => true), true);
});

test("activateUiOption copies XML and same-folder TGAs while preserving the source comment and updating UISkin", async (t) => {
  const { backend, gameDirectory } = await createHarness(t);
  const packagePath = path.join(gameDirectory, "uifiles", "FancyUI");
  const iniPath = await seedUiIni(gameDirectory, "UI_Test_CW.ini", "Default");

  await writeFile(path.join(packagePath, "EQUI_Inventory.xml"), createXml("default", "<!-- Options/Default -->"));
  await writeFile(path.join(packagePath, "bar.tga"), "old-tga");
  await writeFile(path.join(packagePath, "Options", "Default", "EQUI_Inventory.xml"), createXml("default", "<!-- Options/Default -->"));
  await writeFile(path.join(packagePath, "Options", "Alt", "Blue", "EQUI_Inventory.xml"), createXml("alt", "<!-- Options/Alt/Blue -->"));
  await writeFile(path.join(packagePath, "Options", "Alt", "Blue", "bar.tga"), "new-tga");

  const result = await backend.activateUiOption({
    packageName: "FancyUI",
    optionPath: "Options/Alt/Blue",
    iniPaths: [iniPath]
  });

  assert.match(await readFile(path.join(packagePath, "EQUI_Inventory.xml")), /^<!-- Options\/Alt\/Blue -->/);
  assert.equal(await readFile(path.join(packagePath, "bar.tga")), "new-tga");
  assert.match(await readFile(iniPath), /UISkin=FancyUI/);
  assert.equal(result.details.name, "FancyUI");
});

test("activating Options/Default copies only XML files and does not flood root with default TGAs", async (t) => {
  const { backend, gameDirectory } = await createHarness(t);
  const packagePath = path.join(gameDirectory, "uifiles", "FancyUI");

  await writeFile(path.join(packagePath, "EQUI_Inventory.xml"), createXml("alt", "<!-- Options/Alt/Blue -->"));
  await writeFile(path.join(packagePath, "Options", "Default", "EQUI_Inventory.xml"), createXml("default", "<!-- Options/Default -->"));
  await writeFile(path.join(packagePath, "Options", "Default", "defaultskin.tga"), "default-tga");

  await backend.activateUiOption({
    packageName: "FancyUI",
    optionPath: "Options/Default",
    iniPaths: []
  });

  assert.match(await readFile(path.join(packagePath, "EQUI_Inventory.xml")), /^<!-- Options\/Default -->/);
  assert.equal(await fs.stat(path.join(packagePath, "defaultskin.tga")).then(() => true).catch(() => false), false);
});

test("activating a nested Options/Default bundle copies only XML files from that default subtree", async (t) => {
  const { backend, gameDirectory } = await createHarness(t);
  const packagePath = path.join(gameDirectory, "uifiles", "FancyUI");

  await writeFile(path.join(packagePath, "EQUI_Inventory.xml"), createXml("alt", "<!-- Options/Alt/Blue -->"));
  await writeFile(
    path.join(packagePath, "Options", "Default", "Inventory", "Grid", "EQUI_Inventory.xml"),
    createXml("default-grid", "<!-- Options/Default/Inventory/Grid -->")
  );
  await writeFile(path.join(packagePath, "Options", "Default", "Inventory", "Grid", "defaultskin.tga"), "default-grid-tga");

  await backend.activateUiOption({
    packageName: "FancyUI",
    optionPath: "Options/Default/Inventory/Grid",
    iniPaths: []
  });

  assert.match(await readFile(path.join(packagePath, "EQUI_Inventory.xml")), /^<!-- Options\/Default\/Inventory\/Grid -->/);
  assert.equal(await fs.stat(path.join(packagePath, "defaultskin.tga")).then(() => true).catch(() => false), false);
});

test("validateUiPackageOptionComments scans Options recursively and corrects invalid first-line source comments", async (t) => {
  const { backend, gameDirectory } = await createHarness(t);
  const packagePath = path.join(gameDirectory, "uifiles", "FancyUI");

  await writeFile(
    path.join(packagePath, "Options", "Inventory", "Grid", "EQUI_Inventory.xml"),
    createXml("inventory-grid", "<!-- wrong/path -->")
  );
  await writeFile(
    path.join(packagePath, "Options", "Default", "Inventory", "List", "EQUI_Inventory.xml"),
    createXml("inventory-list")
  );
  await writeFile(
    path.join(packagePath, "Options", "Target", "Slim", "EQUI_TargetWindow.xml"),
    createXml("target-slim", "<!-- author note -->")
  );

  const result = await backend.validateUiPackageOptionComments("FancyUI");

  assert.deepEqual(result.summary, {
    scannedCount: 3,
    correctedCount: 3
  });
  assert.match(
    await readFile(path.join(packagePath, "Options", "Inventory", "Grid", "EQUI_Inventory.xml")),
    /^<!-- Options\/Inventory\/Grid -->/
  );
  assert.match(
    await readFile(path.join(packagePath, "Options", "Default", "Inventory", "List", "EQUI_Inventory.xml")),
    /^<!-- Options\/Default\/Inventory\/List -->/
  );
  assert.match(
    await readFile(path.join(packagePath, "Options", "Target", "Slim", "EQUI_TargetWindow.xml")),
    /^<!-- Options\/Target\/Slim -->\n<!-- author note -->/
  );
});

test("checkUiPackageMetadata scans Options recursively without mutating files", async (t) => {
  const { backend, gameDirectory } = await createHarness(t);
  const packagePath = path.join(gameDirectory, "uifiles", "FancyUI");

  const invalidFilePath = path.join(packagePath, "Options", "Inventory", "Grid", "EQUI_Inventory.xml");
  const validFilePath = path.join(packagePath, "Options", "Target", "Slim", "EQUI_TargetWindow.xml");
  await writeFile(invalidFilePath, createXml("inventory-grid", "<!-- wrong/path -->"));
  await writeFile(validFilePath, createXml("target-slim", "<!-- Options/Target/Slim -->"));

  const beforeInvalidContent = await readFile(invalidFilePath);
  const result = await backend.checkUiPackageMetadata("FancyUI");

  assert.deepEqual(result, {
    packageName: "FancyUI",
    status: "issues",
    scannedCount: 2,
    invalidCount: 1,
    healthy: false
  });
  assert.equal(await readFile(invalidFilePath), beforeInvalidContent);
});

test("option library hides the flat Default card and keeps nested default component cards active when comments are stale", async (t) => {
  const { backend, gameDirectory } = await createHarness(t);
  const packagePath = path.join(gameDirectory, "uifiles", "FancyUI");

  await writeFile(
    path.join(packagePath, "EQUI_Inventory.xml"),
    createXml("active-grid", "<!-- Options/Default -->")
  );
  await writeFile(
    path.join(packagePath, "Options", "Default", "EQUI_Inventory.xml"),
    createXml("active-grid", "<!-- Options/Default -->")
  );
  await writeFile(
    path.join(packagePath, "Options", "Default", "EQUI_TargetWindow.xml"),
    createXml("default-target", "<!-- Options/Default -->")
  );
  await writeFile(
    path.join(packagePath, "Options", "Default", "Inventory", "Grid", "EQUI_Inventory.xml"),
    createXml("active-grid", "<!-- Options/Default/Inventory/Grid -->")
  );
  await writeFile(
    path.join(packagePath, "Options", "Inventory", "Grid", "EQUI_Inventory.xml"),
    createXml("active-grid", "<!-- Options/Inventory/Grid -->")
  );
  await writeFile(
    path.join(packagePath, "Options", "Inventory", "List", "EQUI_Inventory.xml"),
    createXml("inventory-list", "<!-- Options/Inventory/List -->")
  );

  const details = await backend.getUiPackageDetails("FancyUI");
  const bundlePaths = details.bundles.map((bundle) => bundle.optionPath).sort();

  assert.deepEqual(bundlePaths, [
    "Options/Default/Inventory/Grid",
    "Options/Inventory/List"
  ]);
  assert.equal(details.bundles.find((bundle) => bundle.optionPath === "Options/Default/Inventory/Grid")?.activeState, "active");
});

test("setUiSkinTargets updates multiple character UI INIs in place", async (t) => {
  const { backend, gameDirectory } = await createHarness(t);
  const firstIni = await seedUiIni(gameDirectory, "UI_Alice_CW.ini", "Default");
  const secondIni = path.join(gameDirectory, "UI_Bob_CW.ini");
  await writeFile(secondIni, "[Chat]\nLocked=true\n");

  await writeFile(path.join(gameDirectory, "uifiles", "FancyUI", "EQUI_Inventory.xml"), createXml("default"));

  await backend.setUiSkinTargets({
    packageName: "FancyUI",
    iniPaths: [firstIni, secondIni]
  });

  assert.match(await readFile(firstIni), /UISkin=FancyUI/);
  assert.match(await readFile(secondIni), /\[Main\]\nUISkin=FancyUI/);
});

test("setUiSkinTargets creates an INI-only backup and restoreUiManagerBackup restores only INIs", async (t) => {
  const { backend, gameDirectory } = await createHarness(t);
  const packagePath = path.join(gameDirectory, "uifiles", "FancyUI");
  const iniPath = await seedUiIni(gameDirectory, "UI_Alice_CW.ini", "Default");

  await writeFile(path.join(packagePath, "EQUI_Inventory.xml"), createXml("original-root", "<!-- Options/Default -->"));

  await backend.setUiSkinTargets({
    packageName: "FancyUI",
    iniPaths: [iniPath]
  });

  const backups = await backend.listUiManagerBackups("FancyUI");
  assert.equal(backups.length, 1);
  assert.equal(backups[0].hasSnapshot, false);
  assert.equal(backups[0].iniFiles.length, 1);

  const details = await backend.getUiPackageDetails("FancyUI");
  assert.equal(details.backupSummary.backupCount, 1);
  assert.equal(details.backupSummary.maxBackupCount, MAX_UI_MANAGER_BACKUPS_PER_PACKAGE);
  assert.ok(details.backupSummary.totalSizeBytes > 0);

  const backupDirectory = path.join(gameDirectory, "backup", "eqemupatcher", "ui-manager", "FancyUI", backups[0].id);
  assert.equal(await fs.stat(path.join(backupDirectory, "snapshot")).then(() => true).catch(() => false), false);

  await writeFile(iniPath, "[Main]\nUISkin=ChangedAgain\n");
  await writeFile(path.join(packagePath, "EQUI_Inventory.xml"), createXml("mutated-root", "<!-- Options/Alt/Blue -->"));

  await backend.restoreUiManagerBackup({
    packageName: "FancyUI",
    backupId: backups[0].id
  });

  assert.match(await readFile(iniPath), /UISkin=Default/);
  assert.match(await readFile(path.join(packagePath, "EQUI_Inventory.xml")), /mutated-root/);
});

test("createBackup prunes older UI Manager backups per package", async (t) => {
  const { backend, gameDirectory } = await createHarness(t);
  const packagePath = path.join(gameDirectory, "uifiles", "FancyUI");
  const iniPath = await seedUiIni(gameDirectory, "UI_Alice_CW.ini", "Default");

  await writeFile(path.join(packagePath, "EQUI_Inventory.xml"), createXml("original-root", "<!-- Options/Default -->"));

  for (let index = 0; index < MAX_UI_MANAGER_BACKUPS_PER_PACKAGE + 3; index += 1) {
    await backend.uiManager.createBackup("FancyUI", {
      reason: `retention-${index}`,
      iniPaths: [iniPath],
      includePackageSnapshot: false
    });
  }

  const backups = await backend.listUiManagerBackups("FancyUI");
  assert.equal(backups.length, MAX_UI_MANAGER_BACKUPS_PER_PACKAGE);
  assert.equal(backups.some((backup) => backup.reason === "retention-0"), false);
  assert.equal(backups.some((backup) => backup.reason === "retention-1"), false);
  assert.equal(backups.some((backup) => backup.reason === "retention-2"), false);
  assert.equal(backups.some((backup) => backup.reason === `retention-${MAX_UI_MANAGER_BACKUPS_PER_PACKAGE + 2}`), true);
});

test("resetUiPackage mirrors Options/Default and restoreUiManagerBackup brings the previous root back", async (t) => {
  const { backend, gameDirectory } = await createHarness(t);
  const packagePath = path.join(gameDirectory, "uifiles", "FancyUI");

  await writeFile(path.join(packagePath, "EQUI_Inventory.xml"), createXml("active", "<!-- Options/Alt/Blue -->"));
  await writeFile(path.join(packagePath, "extra.txt"), "keep-me-before-reset");
  await writeFile(path.join(packagePath, "Options", "Default", "EQUI_Inventory.xml"), createXml("default", "<!-- Options/Default -->"));
  await writeFile(path.join(packagePath, "Options", "Default", "defaultskin.tga"), "default-tga");
  await writeFile(path.join(packagePath, "Options", "Alt", "Blue", "EQUI_Inventory.xml"), createXml("active", "<!-- Options/Alt/Blue -->"));

  await backend.resetUiPackage("FancyUI");
  const backups = await backend.listUiManagerBackups("FancyUI");

  assert.match(await readFile(path.join(packagePath, "EQUI_Inventory.xml")), /^<!-- Options\/Default -->/);
  assert.equal(await readFile(path.join(packagePath, "defaultskin.tga")), "default-tga");
  assert.equal(await fs.stat(path.join(packagePath, "extra.txt")).then(() => true).catch(() => false), false);
  assert.equal(await fs.stat(path.join(packagePath, "Options")).then(() => true), true);

  await backend.restoreUiManagerBackup({
    packageName: "FancyUI",
    backupId: backups[0].id
  });

  assert.match(await readFile(path.join(packagePath, "EQUI_Inventory.xml")), /^<!-- Options\/Alt\/Blue -->/);
  assert.equal(await readFile(path.join(packagePath, "extra.txt")), "keep-me-before-reset");
});

test("resetUiPackage flattens nested Options/Default files back into the package root", async (t) => {
  const { backend, gameDirectory } = await createHarness(t);
  const packagePath = path.join(gameDirectory, "uifiles", "FancyUI");

  await writeFile(path.join(packagePath, "EQUI_Inventory.xml"), createXml("active", "<!-- Options/Alt/Blue -->"));
  await writeFile(
    path.join(packagePath, "Options", "Default", "Inventory", "Grid", "EQUI_Inventory.xml"),
    createXml("default-grid", "<!-- Options/Default/Inventory/Grid -->")
  );
  await writeFile(path.join(packagePath, "Options", "Default", "Textures", "defaultskin.tga"), "default-tga");

  await backend.resetUiPackage("FancyUI");

  assert.match(await readFile(path.join(packagePath, "EQUI_Inventory.xml")), /^<!-- Options\/Default\/Inventory\/Grid -->/);
  assert.equal(await readFile(path.join(packagePath, "defaultskin.tga")), "default-tga");
  assert.equal(await fs.stat(path.join(packagePath, "Inventory")).then(() => true).catch(() => false), false);
  assert.equal(await fs.stat(path.join(packagePath, "Textures")).then(() => true).catch(() => false), false);
});
