const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const XML_FILE_PATTERN = /^EQUI_.+\.xml$/i;
const SOURCE_COMMENT_PATTERN = /^<!--\s*([^>]+?)\s*-->$/;
const PREVIEW_IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
const ROOT_UI_INI_PATTERN = /^UI_(.+)_(.+)\.ini$/i;
const DEFAULT_PACKAGE_NAME = "default";
const MAX_UI_MANAGER_BACKUPS_PER_PACKAGE = 8;
const MAX_UI_MANAGER_BACKUP_BYTES_PER_PACKAGE = 128 * 1024 * 1024;

function normalizeRelativePath(value) {
  return String(value || "")
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "")
    .trim();
}

async function exists(targetPath) {
  try {
    await fsp.access(targetPath);
    return true;
  } catch (_error) {
    return false;
  }
}

async function ensureDirectory(targetPath) {
  await fsp.mkdir(targetPath, { recursive: true });
}

async function listDirectoryEntries(targetPath) {
  if (!(await exists(targetPath))) {
    return [];
  }

  return fsp.readdir(targetPath, { withFileTypes: true });
}

async function getFileHash(filePath) {
  const crypto = require("node:crypto");
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("md5");
    const stream = fs.createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex").toUpperCase()));
  });
}

async function getComparableXmlHash(filePath) {
  const normalizedContent = String(await readText(filePath))
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n");
  const { firstLine, remainder } = splitFirstLine(normalizedContent);
  const comparableContent = (parseSourceComment(firstLine) ? remainder : normalizedContent)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length)
    .join("\n");
  const crypto = require("node:crypto");
  return crypto.createHash("md5").update(comparableContent, "utf8").digest("hex").toUpperCase();
}

async function copyFileEnsuringParent(sourcePath, destinationPath) {
  await ensureDirectory(path.dirname(destinationPath));
  await fsp.copyFile(sourcePath, destinationPath);
}

async function copyDirectoryContents(sourceDirectory, destinationDirectory) {
  await ensureDirectory(destinationDirectory);
  const entries = await listDirectoryEntries(sourceDirectory);

  for (const entry of entries) {
    const sourcePath = path.join(sourceDirectory, entry.name);
    const destinationPath = path.join(destinationDirectory, entry.name);

    if (entry.isDirectory()) {
      await copyDirectoryContents(sourcePath, destinationPath);
      continue;
    }

    await copyFileEnsuringParent(sourcePath, destinationPath);
  }
}

async function copyDirectoryFilesToRoot(sourceDirectory, destinationDirectory) {
  await ensureDirectory(destinationDirectory);
  const files = (await listFilesRecursively(sourceDirectory)).sort((left, right) => byCaseInsensitiveName(left.relativePath, right.relativePath));
  const seenNames = new Map();

  for (const file of files) {
    const fileName = path.basename(file.relativePath);
    const existingPath = seenNames.get(fileName);
    if (existingPath && existingPath !== file.relativePath) {
      throw new Error(`Options/Default contains duplicate file names that cannot be flattened safely: ${fileName}`);
    }

    seenNames.set(fileName, file.relativePath);
    await copyFileEnsuringParent(file.absolutePath, path.join(destinationDirectory, fileName));
  }
}

async function removeDirectoryContents(targetDirectory, options = {}) {
  const { preserveNames = new Set() } = options;
  const entries = await listDirectoryEntries(targetDirectory);

  for (const entry of entries) {
    if (preserveNames.has(entry.name)) {
      continue;
    }

    await fsp.rm(path.join(targetDirectory, entry.name), { recursive: true, force: true });
  }
}

async function listFilesRecursively(targetDirectory, prefix = "") {
  const results = [];
  const entries = await listDirectoryEntries(targetDirectory);

  for (const entry of entries) {
    const nextPrefix = prefix ? path.posix.join(prefix, entry.name) : entry.name;
    const entryPath = path.join(targetDirectory, entry.name);

    if (entry.isDirectory()) {
      results.push(...(await listFilesRecursively(entryPath, nextPrefix)));
      continue;
    }

    results.push({
      absolutePath: entryPath,
      relativePath: nextPrefix
    });
  }

  return results;
}

async function readText(filePath) {
  return fsp.readFile(filePath, "utf8");
}

async function writeText(filePath, value) {
  await ensureDirectory(path.dirname(filePath));
  await fsp.writeFile(filePath, value, "utf8");
}

function splitFirstLine(content) {
  const text = String(content || "");
  const newlineIndex = text.indexOf("\n");
  if (newlineIndex === -1) {
    return {
      firstLine: text,
      remainder: ""
    };
  }

  return {
    firstLine: text.slice(0, newlineIndex).replace(/\r$/, ""),
    remainder: text.slice(newlineIndex + 1)
  };
}

function buildSourceComment(optionPath) {
  return `<!-- ${normalizeRelativePath(optionPath)} -->`;
}

function parseSourceComment(firstLine) {
  const match = String(firstLine || "").trim().match(SOURCE_COMMENT_PATTERN);
  if (!match) {
    return "";
  }

  const normalized = normalizeRelativePath(match[1]);
  if (!normalized) {
    return "";
  }

  const withoutOptionsPrefix = normalized.replace(/^options\//i, "");
  if (!withoutOptionsPrefix.includes("/") && !/^default$/i.test(withoutOptionsPrefix)) {
    return "";
  }

  if (/^options\//i.test(normalized)) {
    return normalized.replace(/^options\//i, "Options/");
  }

  return `Options/${normalized}`;
}

function isXmlFileName(fileName) {
  return XML_FILE_PATTERN.test(String(fileName || ""));
}

function isProtectedPackageName(packageName) {
  return String(packageName || "").trim().toLowerCase() === DEFAULT_PACKAGE_NAME;
}

function isDefaultOptionPath(optionPath) {
  return normalizeRelativePath(optionPath).toLowerCase().startsWith("options/default");
}

function byCaseInsensitiveName(left, right) {
  return String(left || "").localeCompare(String(right || ""), undefined, {
    sensitivity: "base",
    numeric: true
  });
}

function createBackupId(reason) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const suffix = String(reason || "manual")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "manual";
  return `${stamp}-${suffix}`;
}

async function getDirectorySize(targetDirectory) {
  if (!(await exists(targetDirectory))) {
    return 0;
  }

  let total = 0;
  const entries = await listDirectoryEntries(targetDirectory);
  for (const entry of entries) {
    const entryPath = path.join(targetDirectory, entry.name);
    if (entry.isDirectory()) {
      total += await getDirectorySize(entryPath);
      continue;
    }

    const stats = await fsp.stat(entryPath).catch(() => null);
    total += stats?.size || 0;
  }

  return total;
}

function parseUiIniFileName(fileName) {
  const match = String(fileName || "").match(ROOT_UI_INI_PATTERN);
  if (!match) {
    return {
      characterName: "",
      serverName: ""
    };
  }

  return {
    characterName: match[1],
    serverName: match[2]
  };
}

function inferBundleLabel(optionPath) {
  const segments = normalizeRelativePath(optionPath).split("/").filter(Boolean);
  if (!segments.length) {
    return "";
  }
  if (segments.length === 2 && segments[0] === "Options") {
    return segments[1];
  }
  return segments.at(-1) || "";
}

async function findPreviewImage(bundleDirectory) {
  const entries = await listDirectoryEntries(bundleDirectory);
  const images = entries
    .filter((entry) => entry.isFile() && PREVIEW_IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => entry.name)
    .sort(byCaseInsensitiveName);

  if (!images.length) {
    return "";
  }

  const preferred = images.find((name) => /example/i.test(name)) || images[0];
  return pathToFileURL(path.join(bundleDirectory, preferred)).toString();
}

async function buildBundleContentSignature(bundleDirectory, xmlFiles, tgaFiles) {
  const fileNames = [
    ...xmlFiles.map((fileName) => ({ fileName, isXml: true })),
    ...tgaFiles.map((fileName) => ({ fileName, isXml: false }))
  ].sort((left, right) => byCaseInsensitiveName(left.fileName, right.fileName));
  const signatureParts = [];

  for (const file of fileNames) {
    const fileName = file.fileName;
    const filePath = path.join(bundleDirectory, fileName);
    if (!file.isXml) {
      signatureParts.push(`${fileName}:${await getFileHash(filePath)}`);
      continue;
    }

    signatureParts.push(`${fileName}:${await getComparableXmlHash(filePath)}`);
  }

  return signatureParts.join("|");
}

async function readInstructions(optionPath) {
  const instructionsPath = path.join(optionPath, "Instructions.txt");
  if (!(await exists(instructionsPath))) {
    return "";
  }

  return String(await readText(instructionsPath)).trim();
}

class UiManager {
  constructor({ getGameDirectory, emitLog }) {
    this.getGameDirectory = getGameDirectory;
    this.emitLog = typeof emitLog === "function" ? emitLog : () => {};
  }

  getGameDirectoryOrThrow() {
    const gameDirectory = String(this.getGameDirectory?.() || "").trim();
    if (!gameDirectory) {
      throw new Error("No game directory is currently selected.");
    }

    return gameDirectory;
  }

  getUiFilesDirectory() {
    return path.join(this.getGameDirectoryOrThrow(), "uifiles");
  }

  getBackupRoot() {
    return path.join(this.getGameDirectoryOrThrow(), "backup", "eqemupatcher", "ui-manager");
  }

  getPackageBackupRoot(packageName) {
    return path.join(this.getBackupRoot(), packageName);
  }

  resolveUiFilesPath(relativePath) {
    const uiFilesDirectory = this.getUiFilesDirectory();
    const resolved = path.resolve(uiFilesDirectory, relativePath);
    const rootWithSeparator = uiFilesDirectory.endsWith(path.sep) ? uiFilesDirectory : `${uiFilesDirectory}${path.sep}`;
    if (resolved !== uiFilesDirectory && !resolved.startsWith(rootWithSeparator)) {
      throw new Error(`Refusing to access files outside uifiles: ${relativePath}`);
    }
    return resolved;
  }

  resolveGamePath(relativePath) {
    const gameDirectory = this.getGameDirectoryOrThrow();
    const resolved = path.resolve(gameDirectory, relativePath);
    const rootWithSeparator = gameDirectory.endsWith(path.sep) ? gameDirectory : `${gameDirectory}${path.sep}`;
    if (resolved !== gameDirectory && !resolved.startsWith(rootWithSeparator)) {
      throw new Error(`Refusing to access files outside the game directory: ${relativePath}`);
    }
    return resolved;
  }

  async getUiManagerOverview() {
    const gameDirectory = this.getGameDirectory?.() || "";
    if (!gameDirectory) {
      return {
        gameDirectory: "",
        uiFilesDirectory: "",
        canManage: false,
        packages: [],
        targets: []
      };
    }

    const uiFilesDirectory = path.join(gameDirectory, "uifiles");
    const [packages, targets] = await Promise.all([
      this.listPackages(uiFilesDirectory),
      this.listTargets(gameDirectory)
    ]);

    return {
      gameDirectory,
      uiFilesDirectory,
      canManage: await exists(uiFilesDirectory),
      packages,
      targets
    };
  }

  async listPackages(uiFilesDirectory = this.getUiFilesDirectory()) {
    const entries = await listDirectoryEntries(uiFilesDirectory);
    const directories = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort(byCaseInsensitiveName);
    const summaries = [];

    for (const packageName of directories) {
      const packagePath = path.join(uiFilesDirectory, packageName);
      const packageInfo = await this.getPackageSummary(packageName, packagePath);
      summaries.push(packageInfo);
    }

    return summaries;
  }

  async getPackageSummary(packageName, packagePath) {
    const prepared = await this.isPackagePrepared(packagePath);
    const optionBundles = prepared ? await this.findOptionBundles(packagePath) : [];
    const rootEntries = await listDirectoryEntries(packagePath);
    const rootXmlCount = rootEntries.filter((entry) => entry.isFile() && isXmlFileName(entry.name)).length;

    return {
      name: packageName,
      path: packagePath,
      protected: isProtectedPackageName(packageName),
      prepared,
      optionCount: optionBundles.length,
      rootXmlCount
    };
  }

  async listTargets(gameDirectory = this.getGameDirectoryOrThrow()) {
    const entries = await listDirectoryEntries(gameDirectory);
    const targets = [];

    for (const entry of entries) {
      if (!entry.isFile() || !ROOT_UI_INI_PATTERN.test(entry.name)) {
        continue;
      }

      const iniPath = path.join(gameDirectory, entry.name);
      const { characterName, serverName } = parseUiIniFileName(entry.name);
      targets.push({
        path: iniPath,
        fileName: entry.name,
        characterName,
        serverName,
        uiSkin: await this.readUiSkinFromIni(iniPath)
      });
    }

    targets.sort((left, right) => {
      const serverCompare = byCaseInsensitiveName(left.serverName, right.serverName);
      if (serverCompare !== 0) {
        return serverCompare;
      }
      return byCaseInsensitiveName(left.characterName, right.characterName);
    });

    return targets;
  }

  async readUiSkinFromIni(iniPath) {
    if (!(await exists(iniPath))) {
      return "Default";
    }

    const content = await readText(iniPath);
    const mainSectionMatch = content.match(/\[Main\]([\s\S]*?)(?:\n\[|$)/i);
    if (!mainSectionMatch) {
      return "Default";
    }

    const skinMatch = mainSectionMatch[1].match(/^\s*UISkin\s*=\s*(.*?)\s*$/im);
    return skinMatch ? skinMatch[1] || "Default" : "Default";
  }

  async isPackagePrepared(packagePath) {
    return (await exists(path.join(packagePath, "Options"))) && (await exists(path.join(packagePath, "Options", "Default")));
  }

  async assertPackageExists(packageName) {
    const packagePath = this.resolveUiFilesPath(packageName);
    if (!(await exists(packagePath))) {
      throw new Error(`UI package not found: ${packageName}`);
    }
    return packagePath;
  }

  async assertMutablePackage(packageName) {
    if (isProtectedPackageName(packageName)) {
      throw new Error("The default UI package is protected and cannot be modified.");
    }
    return this.assertPackageExists(packageName);
  }

  async getUiPackageDetails(packageName) {
    const packagePath = await this.assertPackageExists(packageName);
    const prepared = await this.isPackagePrepared(packagePath);
    const bundles = prepared ? await this.findOptionBundles(packagePath) : [];
    const backups = await this.listUiManagerBackups(packageName);
    const backupSummary = this.buildBackupSummary(backups);
    const rootEntries = await listDirectoryEntries(packagePath);

    return {
      name: packageName,
      path: packagePath,
      protected: isProtectedPackageName(packageName),
      prepared,
      rootFiles: rootEntries
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name)
        .sort(byCaseInsensitiveName),
      bundles: bundles
        .sort((left, right) => byCaseInsensitiveName(left.optionPath, right.optionPath)),
      backups,
      backupSummary
    };
  }

  async prepareUiPackage(packageName) {
    const packagePath = await this.assertMutablePackage(packageName);
    const backup = await this.createBackup(packageName, {
      reason: "prepare"
    });

    await ensureDirectory(path.join(packagePath, "Options"));

    const defaultDirectory = path.join(packagePath, "Options", "Default");
    if (!(await exists(defaultDirectory))) {
      await ensureDirectory(defaultDirectory);
      const rootEntries = await listDirectoryEntries(packagePath);
      for (const entry of rootEntries) {
        if (entry.name === "Options") {
          continue;
        }

        const sourcePath = path.join(packagePath, entry.name);
        const destinationPath = path.join(defaultDirectory, entry.name);
        if (entry.isDirectory()) {
          await copyDirectoryContents(sourcePath, destinationPath);
          continue;
        }

        if (entry.isFile()) {
          await copyFileEnsuringParent(sourcePath, destinationPath);
        }
      }
    }

    const rootEntriesBeforeMove = await listDirectoryEntries(packagePath);
    for (const entry of rootEntriesBeforeMove) {
      if (!entry.isDirectory() || entry.name === "Options") {
        continue;
      }

      await this.moveDirectoryIntoOptions(packagePath, entry.name);
    }

    await this.normalizeOptionXmlComments(packagePath);
    await this.normalizeRootXmlComments(packagePath);

    this.emitLog(`Prepared UI package ${packageName}.`, "success");
    return {
      backup,
      details: await this.getUiPackageDetails(packageName)
    };
  }

  async moveDirectoryIntoOptions(packagePath, directoryName) {
    const sourcePath = path.join(packagePath, directoryName);
    const destinationPath = path.join(packagePath, "Options", directoryName);
    await copyDirectoryContents(sourcePath, destinationPath);
    await fsp.rm(sourcePath, { recursive: true, force: true });
  }

  async normalizeOptionXmlComments(packagePath) {
    return this.scanAndNormalizeOptionXmlComments(packagePath);
  }

  async scanAndNormalizeOptionXmlComments(packagePath) {
    const optionBundles = await this.findOptionBundles(packagePath, { includeState: false });
    let scannedCount = 0;
    let correctedCount = 0;

    for (const bundle of optionBundles) {
      for (const xmlFileName of bundle.xmlFiles) {
        const filePath = path.join(packagePath, bundle.optionPath, xmlFileName);
        scannedCount += 1;
        if (await this.normalizeXmlSourceComment(filePath, bundle.optionPath)) {
          correctedCount += 1;
        }
      }
    }

    return {
      scannedCount,
      correctedCount
    };
  }

  async checkUiPackageMetadata(packageName) {
    const packagePath = await this.assertPackageExists(packageName);
    if (isProtectedPackageName(packageName)) {
      return {
        packageName,
        status: "read-only",
        scannedCount: 0,
        invalidCount: 0,
        healthy: true
      };
    }

    if (!(await exists(path.join(packagePath, "Options")))) {
      return {
        packageName,
        status: "unavailable",
        scannedCount: 0,
        invalidCount: 0,
        healthy: false
      };
    }

    const optionBundles = await this.findOptionBundles(packagePath, { includeState: false });
    let scannedCount = 0;
    let invalidCount = 0;

    for (const bundle of optionBundles) {
      for (const xmlFileName of bundle.xmlFiles) {
        scannedCount += 1;
        const filePath = path.join(packagePath, bundle.optionPath, xmlFileName);
        const { firstLine } = splitFirstLine(await readText(filePath));
        if (parseSourceComment(firstLine) !== normalizeRelativePath(bundle.optionPath)) {
          invalidCount += 1;
        }
      }
    }

    return {
      packageName,
      status: invalidCount ? "issues" : "healthy",
      scannedCount,
      invalidCount,
      healthy: invalidCount === 0
    };
  }

  async normalizeRootXmlComments(packagePath) {
    const optionIndex = await this.buildOptionIndex(packagePath);
    const rootEntries = await listDirectoryEntries(packagePath);

    for (const entry of rootEntries) {
      if (!entry.isFile() || !isXmlFileName(entry.name)) {
        continue;
      }

      const filePath = path.join(packagePath, entry.name);
      const resolvedSource = await this.resolveRootXmlSource(filePath, entry.name, optionIndex);
      if (!resolvedSource) {
        continue;
      }

      await this.normalizeXmlSourceComment(filePath, resolvedSource);
    }
  }

  async buildOptionIndex(packagePath) {
    const bundles = await this.findOptionBundles(packagePath, { includeState: false });
    const index = new Map();

    for (const bundle of bundles) {
      for (const xmlFileName of bundle.xmlFiles) {
        if (!index.has(xmlFileName)) {
          index.set(xmlFileName, []);
        }
        index.get(xmlFileName).push(bundle.optionPath);
      }
    }

    return index;
  }

  async resolveRootXmlSource(rootFilePath, xmlFileName, optionIndex) {
    const currentContent = await readText(rootFilePath);
    const { firstLine } = splitFirstLine(currentContent);
    const parsedCommentPath = parseSourceComment(firstLine);
    const packagePath = path.dirname(rootFilePath);
    const candidatePaths = optionIndex.get(xmlFileName) || [];

    if (parsedCommentPath) {
      const directCandidate = path.join(packagePath, parsedCommentPath, xmlFileName);
      if (candidatePaths.includes(parsedCommentPath) && (await exists(directCandidate)) && normalizeRelativePath(parsedCommentPath) !== "Options/Default") {
        return parsedCommentPath;
      }
    }

    const rootHash = await getComparableXmlHash(rootFilePath);
    const nonDefaultCandidates = candidatePaths.filter((optionPath) => !isDefaultOptionPath(optionPath));
    const defaultCandidates = candidatePaths
      .filter((optionPath) => isDefaultOptionPath(optionPath))
      .sort((left, right) => {
        const leftIsFlatDefault = normalizeRelativePath(left) === "Options/Default";
        const rightIsFlatDefault = normalizeRelativePath(right) === "Options/Default";
        if (leftIsFlatDefault !== rightIsFlatDefault) {
          return leftIsFlatDefault ? 1 : -1;
        }
        return byCaseInsensitiveName(left, right);
      });
    const orderedCandidates = isDefaultOptionPath(parsedCommentPath)
      ? [...defaultCandidates, ...nonDefaultCandidates]
      : [...nonDefaultCandidates, ...defaultCandidates];

    for (const optionPath of orderedCandidates) {
      const candidateFilePath = path.join(packagePath, optionPath, xmlFileName);
      if (!(await exists(candidateFilePath))) {
        continue;
      }

      if ((await getComparableXmlHash(candidateFilePath)) === rootHash) {
        return optionPath;
      }
    }

    const defaultFilePath = path.join(packagePath, "Options", "Default", xmlFileName);
    if (!(await exists(defaultFilePath))) {
      await copyFileEnsuringParent(rootFilePath, defaultFilePath);
    }

    return "Options/Default";
  }

  async normalizeXmlSourceComment(filePath, optionPath) {
    const normalizedComment = buildSourceComment(optionPath);
    const originalContent = await readText(filePath);
    const { firstLine, remainder } = splitFirstLine(originalContent);
    const parsedSource = parseSourceComment(firstLine);

    if (parsedSource) {
      const nextContent = `${normalizedComment}\n${remainder}`.replace(/\n$/, "");
      if (nextContent !== originalContent) {
        await writeText(filePath, nextContent);
        return true;
      }
      return false;
    }

    if (String(firstLine || "").trim().startsWith("<!--") && String(firstLine || "").trim().endsWith("-->")) {
      const nextContent = `${normalizedComment}\n${firstLine}\n${remainder}`.replace(/\n$/, "");
      if (nextContent !== originalContent) {
        await writeText(filePath, nextContent);
        return true;
      }
      return false;
    }

    const nextContent = `${normalizedComment}\n${originalContent}`.replace(/\n$/, "");
    if (nextContent !== originalContent) {
      await writeText(filePath, nextContent);
      return true;
    }

    return false;
  }

  async findOptionBundles(packagePath, options = {}) {
    const { includeState = true } = options;
    const optionsDirectory = path.join(packagePath, "Options");
    if (!(await exists(optionsDirectory))) {
      return [];
    }

    const rootOrigins = includeState ? await this.getRootOrigins(packagePath) : new Map();
    const bundles = [];
    const queue = [{ absolutePath: optionsDirectory, relativePath: "Options" }];

    while (queue.length) {
      const current = queue.shift();
      const entries = await listDirectoryEntries(current.absolutePath);
      const directXmlFiles = entries.filter((entry) => entry.isFile() && isXmlFileName(entry.name)).map((entry) => entry.name).sort(byCaseInsensitiveName);

      if (directXmlFiles.length) {
        const optionPath = normalizeRelativePath(current.relativePath);
        const tgaFiles = entries
          .filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === ".tga")
          .map((entry) => entry.name)
          .sort(byCaseInsensitiveName);
        const previewImageUrl = await findPreviewImage(current.absolutePath);
        const instructions = await readInstructions(current.absolutePath);
        const activeMatches = includeState
          ? directXmlFiles.map((xmlFileName) => rootOrigins.get(xmlFileName) === optionPath)
          : [];
        let activeState = "inactive";
        if (includeState && activeMatches.length && activeMatches.every(Boolean)) {
          activeState = "active";
        } else if (includeState && activeMatches.some(Boolean)) {
          activeState = "mixed";
        }

        bundles.push({
          optionPath,
          label: inferBundleLabel(optionPath),
          categoryPath: optionPath.startsWith("Options/") ? optionPath.slice("Options/".length).split("/").slice(0, -1).join("/") : "",
          isDefault: isDefaultOptionPath(optionPath),
          xmlFiles: directXmlFiles,
          tgaFiles,
          previewImageUrl,
          instructions,
          activeState,
          _matchKey: directXmlFiles.join("|"),
          _contentSignature: await buildBundleContentSignature(current.absolutePath, directXmlFiles, tgaFiles)
        });
      }

      for (const entry of entries.filter((child) => child.isDirectory()).sort((left, right) => byCaseInsensitiveName(left.name, right.name))) {
        queue.push({
          absolutePath: path.join(current.absolutePath, entry.name),
          relativePath: path.posix.join(current.relativePath, entry.name)
        });
      }
    }

    if (!includeState) {
      return bundles.map(({ _matchKey, _contentSignature, ...bundle }) => bundle);
    }

    const dedupedBundles = [];
    const seenSignatures = new Set();
    const groupedBundles = new Map();

    for (const bundle of bundles) {
      const signatureKey = `${bundle._matchKey}::${bundle._contentSignature}`;
      if (!groupedBundles.has(signatureKey)) {
        groupedBundles.set(signatureKey, []);
      }
      groupedBundles.get(signatureKey).push(bundle);
    }

    const getBundlePriority = (bundle) => {
      const activeRank = bundle.activeState === "active" ? 0 : bundle.activeState === "mixed" ? 1 : 2;
      const defaultRank = bundle.isDefault ? 1 : 0;
      const defaultRootRank = bundle.optionPath === "Options/Default" ? 1 : 0;
      return [activeRank, defaultRank, defaultRootRank, bundle.optionPath];
    };

    const comparePriority = (left, right) => {
      const leftPriority = getBundlePriority(left);
      const rightPriority = getBundlePriority(right);
      for (let index = 0; index < leftPriority.length; index += 1) {
        if (leftPriority[index] === rightPriority[index]) {
          continue;
        }

        if (typeof leftPriority[index] === "string" || typeof rightPriority[index] === "string") {
          return byCaseInsensitiveName(leftPriority[index], rightPriority[index]);
        }

        return leftPriority[index] - rightPriority[index];
      }

      return 0;
    };

    for (const bundle of bundles) {
      const signatureKey = `${bundle._matchKey}::${bundle._contentSignature}`;
      if (bundle.optionPath === "Options/Default") {
        continue;
      }

      if (seenSignatures.has(signatureKey)) {
        continue;
      }

      const duplicates = groupedBundles.get(signatureKey) || [bundle];
      duplicates.sort(comparePriority);
      dedupedBundles.push(duplicates[0]);
      seenSignatures.add(signatureKey);
    }

    return dedupedBundles.map(({ _matchKey, _contentSignature, ...bundle }) => bundle);
  }

  async getRootOrigins(packagePath) {
    const rootOrigins = new Map();
    const optionIndex = await this.buildOptionIndex(packagePath);
    const rootEntries = await listDirectoryEntries(packagePath);

    for (const entry of rootEntries) {
      if (!entry.isFile() || !isXmlFileName(entry.name)) {
        continue;
      }

      const rootFilePath = path.join(packagePath, entry.name);
      rootOrigins.set(entry.name, await this.resolveRootXmlSource(rootFilePath, entry.name, optionIndex));
    }

    return rootOrigins;
  }

  async activateUiOption({ packageName, optionPath, iniPaths = [] }) {
    const packagePath = await this.assertMutablePackage(packageName);
    const normalizedOptionPath = normalizeRelativePath(optionPath);
    if (!normalizedOptionPath || !normalizedOptionPath.startsWith("Options/")) {
      throw new Error("A valid UI option path is required.");
    }

    const bundleDirectory = path.join(packagePath, normalizedOptionPath);
    if (!(await exists(bundleDirectory))) {
      throw new Error(`UI option not found: ${normalizedOptionPath}`);
    }

    const entries = await listDirectoryEntries(bundleDirectory);
    const xmlFileNames = entries.filter((entry) => entry.isFile() && isXmlFileName(entry.name)).map((entry) => entry.name);
    if (!xmlFileNames.length) {
      throw new Error("The selected UI option does not contain any XML files.");
    }

    const validatedIniPaths = await this.validateIniTargets(iniPaths);
    const backup = await this.createBackup(packageName, {
      reason: "activate",
      iniPaths: validatedIniPaths
    });

    for (const xmlFileName of xmlFileNames) {
      await copyFileEnsuringParent(path.join(bundleDirectory, xmlFileName), path.join(packagePath, xmlFileName));
    }

    if (!isDefaultOptionPath(normalizedOptionPath)) {
      const tgaFileNames = entries
        .filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === ".tga")
        .map((entry) => entry.name);
      for (const tgaFileName of tgaFileNames) {
        await copyFileEnsuringParent(path.join(bundleDirectory, tgaFileName), path.join(packagePath, tgaFileName));
      }
    }

    if (validatedIniPaths.length) {
      await this.setUiSkinTargets({
        packageName,
        iniPaths: validatedIniPaths,
        createBackup: false
      });
    }

    this.emitLog(`Activated ${normalizedOptionPath} for ${packageName}.`, "success");
    return {
      backup,
      details: await this.getUiPackageDetails(packageName)
    };
  }

  async validateIniTargets(iniPaths) {
    const gameDirectory = this.getGameDirectoryOrThrow();
    const normalizedPaths = Array.from(
      new Set(
        (Array.isArray(iniPaths) ? iniPaths : [])
          .map((value) => String(value || "").trim())
          .filter(Boolean)
      )
    );

    const validated = [];
    for (const iniPath of normalizedPaths) {
      const resolved = path.resolve(iniPath);
      const rootWithSeparator = gameDirectory.endsWith(path.sep) ? gameDirectory : `${gameDirectory}${path.sep}`;
      if (resolved !== gameDirectory && !resolved.startsWith(rootWithSeparator)) {
        throw new Error(`Refusing to update an INI outside the game directory: ${iniPath}`);
      }
      if (!(await exists(resolved))) {
        throw new Error(`UI settings file not found: ${iniPath}`);
      }
      validated.push(resolved);
    }

    return validated;
  }

  async setUiSkinTargets({ packageName, iniPaths = [], createBackup = true }) {
    const validatedIniPaths = await this.validateIniTargets(iniPaths);
    if (!validatedIniPaths.length) {
      throw new Error("Select at least one character UI settings file.");
    }

    if (!isProtectedPackageName(packageName)) {
      await this.assertPackageExists(packageName);
    }

    let backup = null;
    if (createBackup) {
      backup = await this.createBackup(packageName, {
        reason: "set-uiskin",
        iniPaths: validatedIniPaths,
        includePackageSnapshot: false
      });
    }

    for (const iniPath of validatedIniPaths) {
      const content = await readText(iniPath);
      await writeText(iniPath, this.updateUiSkinInIni(content, packageName));
    }

    this.emitLog(`Updated UISkin=${packageName} for ${validatedIniPaths.length} character setting file(s).`, "success");
    return {
      backup,
      targets: await this.listTargets()
    };
  }

  updateUiSkinInIni(content, packageName) {
    const normalizedContent = String(content || "");
    if (!/\[Main\]/i.test(normalizedContent)) {
      const suffix = normalizedContent && !normalizedContent.endsWith("\n") ? "\n" : "";
      return `${normalizedContent}${suffix}[Main]\nUISkin=${packageName}\n`;
    }

    const lines = normalizedContent.split(/\r?\n/);
    const output = [];
    let index = 0;
    let updated = false;

    while (index < lines.length) {
      const line = lines[index];
      output.push(line);

      if (/^\[Main\]\s*$/i.test(line)) {
        index += 1;
        let inserted = false;
        while (index < lines.length && !/^\[.+\]\s*$/.test(lines[index])) {
          if (/^\s*UISkin\s*=/.test(lines[index])) {
            output.push(`UISkin=${packageName}`);
            updated = true;
            index += 1;
            while (index < lines.length && !/^\[.+\]\s*$/.test(lines[index])) {
              output.push(lines[index]);
              index += 1;
            }
            inserted = true;
            break;
          }
          output.push(lines[index]);
          index += 1;
        }

        if (!inserted && !updated) {
          output.push(`UISkin=${packageName}`);
          updated = true;
        }
        continue;
      }

      index += 1;
    }

    return updated ? output.join("\n") : `${normalizedContent}${normalizedContent.endsWith("\n") ? "" : "\n"}[Main]\nUISkin=${packageName}\n`;
  }

  async resetUiPackage(packageName) {
    const packagePath = await this.assertMutablePackage(packageName);
    const defaultDirectory = path.join(packagePath, "Options", "Default");
    if (!(await exists(defaultDirectory))) {
      throw new Error("Reset UI requires Options/Default to exist.");
    }

    const backup = await this.createBackup(packageName, {
      reason: "reset"
    });

    await removeDirectoryContents(packagePath, {
      preserveNames: new Set(["Options"])
    });
    await copyDirectoryFilesToRoot(defaultDirectory, packagePath);
    this.emitLog(`Reset ${packageName} to its Options/Default layout.`, "success");

    return {
      backup,
      details: await this.getUiPackageDetails(packageName)
    };
  }

  async validateUiPackageOptionComments(packageName) {
    const packagePath = await this.assertMutablePackage(packageName);
    if (!(await exists(path.join(packagePath, "Options")))) {
      throw new Error("Validate UI Meta Data requires the package to contain an Options folder.");
    }

    const backup = await this.createBackup(packageName, {
      reason: "validate-ui-metadata"
    });
    const summary = await this.scanAndNormalizeOptionXmlComments(packagePath);

    this.emitLog(
      `Validated UI Meta Data for ${packageName}: ${summary.correctedCount} corrected across ${summary.scannedCount} option XML files.`,
      "success"
    );

    return {
      backup,
      summary,
      details: await this.getUiPackageDetails(packageName)
    };
  }

  async createBackup(packageName, options = {}) {
    const { reason = "manual", iniPaths = [], includePackageSnapshot = true } = options;
    const packagePath = await this.assertPackageExists(packageName);
    const backupId = createBackupId(reason);
    const backupDirectory = path.join(this.getPackageBackupRoot(packageName), backupId);
    const snapshotDirectory = path.join(backupDirectory, "snapshot");
    const iniDirectory = path.join(backupDirectory, "ini");
    await ensureDirectory(backupDirectory);
    if (includePackageSnapshot) {
      await ensureDirectory(snapshotDirectory);
      await copyDirectoryContents(packagePath, snapshotDirectory);
    }

    const metadata = {
      id: backupId,
      packageName,
      reason,
      createdAt: new Date().toISOString(),
      hasSnapshot: Boolean(includePackageSnapshot),
      iniFiles: []
    };

    const validatedIniPaths = await this.validateIniTargets(iniPaths).catch(() => []);
    for (const [index, iniPath] of validatedIniPaths.entries()) {
      const targetName = `${String(index + 1).padStart(2, "0")}__${path.basename(iniPath)}`;
      await ensureDirectory(iniDirectory);
      await copyFileEnsuringParent(iniPath, path.join(iniDirectory, targetName));
      metadata.iniFiles.push({
        originalPath: iniPath,
        backupFile: targetName
      });
    }

    metadata.sizeBytes = await getDirectorySize(backupDirectory);
    await writeText(path.join(backupDirectory, "metadata.json"), JSON.stringify(metadata, null, 2));
    await this.pruneUiManagerBackups(packageName);
    return metadata;
  }

  async listUiManagerBackups(packageName) {
    const packageBackupRoot = this.getPackageBackupRoot(packageName);
    const entries = await listDirectoryEntries(packageBackupRoot);
    const backups = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const metadataPath = path.join(packageBackupRoot, entry.name, "metadata.json");
      if (!(await exists(metadataPath))) {
        continue;
      }

      try {
        const metadata = JSON.parse(await readText(metadataPath));
        const backupDirectory = path.join(packageBackupRoot, entry.name);
        backups.push({
          ...metadata,
          packageName,
          hasSnapshot: Boolean(metadata.hasSnapshot ?? (await exists(path.join(packageBackupRoot, entry.name, "snapshot")))),
          iniFiles: Array.isArray(metadata.iniFiles) ? metadata.iniFiles : [],
          sizeBytes: Number.isFinite(Number(metadata.sizeBytes)) ? Number(metadata.sizeBytes) : await getDirectorySize(backupDirectory)
        });
      } catch (_error) {
        backups.push({
          id: entry.name,
          packageName,
          reason: "unknown",
          createdAt: "",
          hasSnapshot: await exists(path.join(packageBackupRoot, entry.name, "snapshot")),
          iniFiles: [],
          sizeBytes: await getDirectorySize(path.join(packageBackupRoot, entry.name))
        });
      }
    }

    backups.sort((left, right) => {
      const byDate = String(right.createdAt || "").localeCompare(String(left.createdAt || ""));
      if (byDate !== 0) {
        return byDate;
      }
      return String(right.id || "").localeCompare(String(left.id || ""));
    });
    return backups;
  }

  buildBackupSummary(backups = []) {
    const items = Array.isArray(backups) ? backups : [];
    return {
      backupCount: items.length,
      totalSizeBytes: items.reduce((sum, backup) => sum + Math.max(0, Number(backup?.sizeBytes) || 0), 0),
      maxBackupCount: MAX_UI_MANAGER_BACKUPS_PER_PACKAGE,
      maxTotalSizeBytes: MAX_UI_MANAGER_BACKUP_BYTES_PER_PACKAGE
    };
  }

  async restoreUiManagerBackup({ packageName, backupId }) {
    const packagePath = await this.assertPackageExists(packageName);
    const backupDirectory = path.join(this.getPackageBackupRoot(packageName), backupId);
    const metadataPath = path.join(backupDirectory, "metadata.json");
    const snapshotDirectory = path.join(backupDirectory, "snapshot");

    if (!(await exists(metadataPath))) {
      throw new Error("The requested backup could not be found.");
    }

    const metadata = JSON.parse(await readText(metadataPath));
    const hasSnapshot = Boolean(metadata.hasSnapshot ?? (await exists(snapshotDirectory)));
    if (hasSnapshot) {
      if (!(await exists(snapshotDirectory))) {
        throw new Error("The requested backup could not be found.");
      }
      await removeDirectoryContents(packagePath);
      await copyDirectoryContents(snapshotDirectory, packagePath);
    }

    for (const iniFile of Array.isArray(metadata.iniFiles) ? metadata.iniFiles : []) {
      const sourcePath = path.join(backupDirectory, "ini", iniFile.backupFile);
      if (!(await exists(sourcePath))) {
        continue;
      }
      await copyFileEnsuringParent(sourcePath, iniFile.originalPath);
    }

    this.emitLog(`Restored UI Manager backup ${backupId} for ${packageName}.`, "success");
    return {
      details: await this.getUiPackageDetails(packageName),
      targets: await this.listTargets()
    };
  }

  async pruneUiManagerBackups(packageName) {
    const packageBackupRoot = this.getPackageBackupRoot(packageName);
    const entries = await listDirectoryEntries(packageBackupRoot);
    const backups = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const backupDirectory = path.join(packageBackupRoot, entry.name);
      const metadataPath = path.join(backupDirectory, "metadata.json");
      let createdAt = "";

      if (await exists(metadataPath)) {
        try {
          createdAt = JSON.parse(await readText(metadataPath)).createdAt || "";
        } catch (_error) {
          createdAt = "";
        }
      }

      backups.push({
        id: entry.name,
        backupDirectory,
        createdAt,
        sizeBytes: await getDirectorySize(backupDirectory)
      });
    }

    backups.sort((left, right) => {
      const byDate = String(right.createdAt || "").localeCompare(String(left.createdAt || ""));
      if (byDate !== 0) {
        return byDate;
      }
      return String(right.id || "").localeCompare(String(left.id || ""));
    });

    let totalBytes = backups.reduce((sum, backup) => sum + backup.sizeBytes, 0);
    let retainedCount = backups.length;

    for (let index = backups.length - 1; index >= 0; index -= 1) {
      if (retainedCount <= 1) {
        break;
      }
      if (
        retainedCount <= MAX_UI_MANAGER_BACKUPS_PER_PACKAGE &&
        totalBytes <= MAX_UI_MANAGER_BACKUP_BYTES_PER_PACKAGE
      ) {
        break;
      }

      const backup = backups[index];
      await fsp.rm(backup.backupDirectory, { recursive: true, force: true });
      retainedCount -= 1;
      totalBytes -= backup.sizeBytes;
    }
  }

  async importUiPackageFolder(sourcePath) {
    const normalizedSourcePath = String(sourcePath || "").trim();
    if (!normalizedSourcePath) {
      throw new Error("Select a UI package folder to import.");
    }

    const sourceStats = await fsp.stat(normalizedSourcePath).catch(() => null);
    if (!sourceStats?.isDirectory()) {
      throw new Error("The selected UI package folder could not be found.");
    }

    const packageName = path.basename(normalizedSourcePath);
    if (!packageName || isProtectedPackageName(packageName)) {
      throw new Error("The selected folder name is reserved and cannot be imported.");
    }

    const destinationPath = this.resolveUiFilesPath(packageName);
    if (await exists(destinationPath)) {
      throw new Error(`A UI package named ${packageName} already exists.`);
    }

    const sourceFiles = await listFilesRecursively(normalizedSourcePath);
    if (!sourceFiles.some((entry) => XML_FILE_PATTERN.test(path.basename(entry.relativePath)))) {
      throw new Error("The selected folder does not contain any EverQuest UI XML files.");
    }

    await ensureDirectory(path.dirname(destinationPath));
    await copyDirectoryContents(normalizedSourcePath, destinationPath);
    this.emitLog(`Imported UI package ${packageName}.`, "success");

    return {
      overview: await this.getUiManagerOverview(),
      details: await this.getUiPackageDetails(packageName)
    };
  }
}

module.exports = {
  UiManager,
  MAX_UI_MANAGER_BACKUPS_PER_PACKAGE,
  MAX_UI_MANAGER_BACKUP_BYTES_PER_PACKAGE,
  normalizeRelativePath,
  parseSourceComment,
  buildSourceComment,
  isProtectedPackageName
};
