const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const {
  generateLegacyArtifacts,
  parseConfigText,
  readOptionalTextFile,
  scanLegacyWorkingDirectory,
  serializeConfig
} = require("./legacy-filelistbuilder");

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

function formatBytes(totalBytes) {
  const value = Number(totalBytes) || 0;
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  if (value < 1024 * 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

class FileListBuilderBackend {
  constructor({ appUserDataPath, launchDirectory, eventSink }) {
    this.appUserDataPath = appUserDataPath;
    this.launchDirectory = launchDirectory || "";
    this.eventSink = eventSink;
    this.appStatePath = path.join(this.appUserDataPath, "filelistbuilder-state.yml");
    this.state = {
      workingDirectory: "",
      client: "",
      downloadPrefix: "",
      ignoreText: "",
      deleteText: "",
      manifestPath: "",
      patchZipPath: "",
      manifestVersion: "",
      statusBadge: "Select Folder",
      statusDetail: "Choose the patch build directory that contains the files you want to publish.",
      progressValue: 0,
      progressMax: 1,
      progressLabel: "Waiting for folder selection",
      previewFileCount: 0,
      previewDeleteCount: 0,
      previewTotalBytes: 0,
      previewSizeLabel: "0 B",
      canGenerate: false,
      canSave: false,
      isGenerating: false,
      lastGeneratedAt: "",
      outputLabel: "Awaiting client",
      compatibilityNote: "Legacy filelistbuilder output is preserved.",
      projectLink: "https://github.com/Xackery/eqemupatcher"
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

  emitProgress() {
    this.emit("progress", {
      value: this.state.progressValue,
      max: this.state.progressMax,
      label: this.state.progressLabel
    });
  }

  emitLog(text, tone = "info") {
    this.emit("log", {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      text,
      tone,
      timestamp: new Date().toISOString()
    });
  }

  getState() {
    return cloneState(this.state);
  }

  getConfigPath() {
    if (!this.state.workingDirectory) {
      return "";
    }
    return path.join(this.state.workingDirectory, "filelistbuilder.yml");
  }

  async initialize() {
    await fsp.mkdir(this.appUserDataPath, { recursive: true });
    const initialWorkingDirectory = await this.resolveInitialWorkingDirectory();
    if (initialWorkingDirectory) {
      await this.loadWorkingDirectory(initialWorkingDirectory);
    } else {
      await this.refreshPreview();
    }
    return this.getState();
  }

  async resolveInitialWorkingDirectory() {
    if (await exists(this.appStatePath)) {
      try {
        const raw = await fsp.readFile(this.appStatePath, "utf8");
        const match = raw.match(/^workingDirectory:\s*(.+)$/m);
        if (match) {
          const saved = match[1].replace(/^"|"$/g, "").trim();
          if (saved && (await exists(saved))) {
            return saved;
          }
        }
      } catch (_error) {
        // Ignore invalid state and fall through.
      }
    }

    if (this.launchDirectory && (await exists(this.launchDirectory))) {
      const configPath = path.join(this.launchDirectory, "filelistbuilder.yml");
      const ignorePath = path.join(this.launchDirectory, "ignore.txt");
      const deletePath = path.join(this.launchDirectory, "delete.txt");
      const patchZipPath = path.join(this.launchDirectory, "patch.zip");

      if (
        (await exists(configPath)) ||
        (await exists(ignorePath)) ||
        (await exists(deletePath)) ||
        (await exists(patchZipPath))
      ) {
        return this.launchDirectory;
      }
    }

    return "";
  }

  async saveAppState() {
    const content = `workingDirectory: ${JSON.stringify(this.state.workingDirectory || "")}\n`;
    await fsp.writeFile(this.appStatePath, content, "utf8");
  }

  async loadWorkingDirectory(workingDirectory) {
    this.state.workingDirectory = path.resolve(workingDirectory);
    await this.saveAppState();

    const configText = await readOptionalTextFile(this.getConfigPath());
    const parsedConfig = parseConfigText(configText);
    this.state.client = parsedConfig.client;
    this.state.downloadPrefix = parsedConfig.downloadprefix;
    this.state.ignoreText = await readOptionalTextFile(path.join(this.state.workingDirectory, "ignore.txt"));
    this.state.deleteText = await readOptionalTextFile(path.join(this.state.workingDirectory, "delete.txt"));

    const detectedManifestPath =
      this.state.client ? path.join(this.state.workingDirectory, `filelist_${this.state.client}.yml`) : "";
    this.state.manifestPath = detectedManifestPath && fs.existsSync(detectedManifestPath) ? detectedManifestPath : "";
    this.state.patchZipPath = path.join(this.state.workingDirectory, "patch.zip");
    if (!fs.existsSync(this.state.patchZipPath)) {
      this.state.patchZipPath = "";
    }

    await this.refreshPreview();
    return this.getState();
  }

  async setWorkingDirectory(workingDirectory) {
    return this.loadWorkingDirectory(workingDirectory);
  }

  async refreshState() {
    if (!this.state.workingDirectory) {
      return this.getState();
    }
    return this.loadWorkingDirectory(this.state.workingDirectory);
  }

  async updateDraft(patch) {
    if (typeof patch.client === "string") {
      this.state.client = patch.client;
    }
    if (typeof patch.downloadPrefix === "string") {
      this.state.downloadPrefix = patch.downloadPrefix;
    }
    if (typeof patch.ignoreText === "string") {
      this.state.ignoreText = patch.ignoreText;
    }
    if (typeof patch.deleteText === "string") {
      this.state.deleteText = patch.deleteText;
    }

    await this.refreshPreview();
    return this.getState();
  }

  async refreshPreview() {
    this.state.progressValue = 0;
    this.state.progressMax = 1;
    this.state.progressLabel = this.state.workingDirectory ? "Scanning working directory" : "Waiting for folder selection";
    this.emitProgress();

    if (!this.state.workingDirectory) {
      this.state.previewFileCount = 0;
      this.state.previewDeleteCount = 0;
      this.state.previewTotalBytes = 0;
      this.state.previewSizeLabel = "0 B";
      this.state.outputLabel = this.state.client ? `filelist_${this.state.client}.yml + patch.zip` : "Awaiting client";
      this.state.canGenerate = false;
      this.state.canSave = false;
      this.state.statusBadge = "Select Folder";
      this.state.statusDetail = "Choose the patch build directory that contains the files you want to publish.";
      this.emitState();
      return this.getState();
    }

    const scanResult = await scanLegacyWorkingDirectory(this.state.workingDirectory, {
      ignoreText: this.state.ignoreText,
      deleteText: this.state.deleteText,
      includeHashes: false
    });

    this.state.previewFileCount = scanResult.downloads.length;
    this.state.previewDeleteCount = scanResult.deletes.length;
    this.state.previewTotalBytes = scanResult.totalBytes;
    this.state.previewSizeLabel = formatBytes(scanResult.totalBytes);
    this.state.outputLabel = this.state.client ? `filelist_${this.state.client}.yml + patch.zip` : "Awaiting client";
    this.state.canSave = true;
    this.state.canGenerate = Boolean(
      this.state.workingDirectory &&
        this.state.client.trim() &&
        this.state.downloadPrefix.trim() &&
        scanResult.downloads.length > 0
    );

    if (!this.state.client.trim()) {
      this.state.statusBadge = "Missing Client";
      this.state.statusDetail = "Enter the legacy client suffix, such as rof, before generating outputs.";
    } else if (!this.state.downloadPrefix.trim()) {
      this.state.statusBadge = "Missing Prefix";
      this.state.statusDetail = "Enter the hosted download prefix that clients will use for patch files.";
    } else if (scanResult.downloads.length === 0) {
      this.state.statusBadge = "No Files";
      this.state.statusDetail = "No publishable files were found after applying the legacy skip and ignore rules.";
    } else if (this.state.isGenerating) {
      this.state.statusBadge = "Generating";
      this.state.statusDetail = "Writing the legacy manifest and patch archive.";
    } else if (this.state.lastGeneratedAt) {
      this.state.statusBadge = "Generated";
      this.state.statusDetail = `Latest outputs match the current draft and were written at ${this.state.lastGeneratedAt}.`;
    } else {
      this.state.statusBadge = "Ready";
      this.state.statusDetail = "The working directory is ready for a legacy-compatible build.";
    }

    this.emitState();
    return this.getState();
  }

  async saveDraftFiles() {
    if (!this.state.workingDirectory) {
      throw new Error("Select a working directory first.");
    }

    await fsp.writeFile(
      this.getConfigPath(),
      serializeConfig({
        client: this.state.client.trim(),
        downloadprefix: this.state.downloadPrefix.trim()
      }),
      "utf8"
    );

    await this.writeOptionalFile(path.join(this.state.workingDirectory, "ignore.txt"), this.state.ignoreText);
    await this.writeOptionalFile(path.join(this.state.workingDirectory, "delete.txt"), this.state.deleteText);

    this.emitLog("Saved filelistbuilder.yml, ignore.txt, and delete.txt.");
    const manifestPath = this.state.client.trim()
      ? path.join(this.state.workingDirectory, `filelist_${this.state.client.trim()}.yml`)
      : "";
    this.state.manifestPath = manifestPath && fs.existsSync(manifestPath) ? manifestPath : "";
    this.emitState();
    return this.getState();
  }

  async writeOptionalFile(filePath, content) {
    if (String(content || "").trim().length === 0) {
      await fsp.rm(filePath, { force: true });
      return;
    }

    await fsp.writeFile(filePath, content, "utf8");
  }

  async generate() {
    if (this.state.isGenerating) {
      return this.getState();
    }

    await this.saveDraftFiles();
    this.state.isGenerating = true;
    this.state.progressValue = 0;
    this.state.progressMax = Math.max(this.state.previewFileCount, 1);
    this.state.progressLabel = "Hashing files";
    this.state.statusBadge = "Generating";
    this.state.statusDetail = "Writing the legacy manifest and patch archive.";
    this.emitState();
    this.emitProgress();
    this.emitLog("Legacy file list generation started.");
    let generationError = null;

    try {
      const result = await generateLegacyArtifacts({
        workingDirectory: this.state.workingDirectory,
        client: this.state.client.trim(),
        downloadPrefix: this.state.downloadPrefix.trim(),
        ignoreText: this.state.ignoreText,
        deleteText: this.state.deleteText,
        onFile: async (index, entry) => {
          this.state.progressValue = index;
          this.state.progressMax = Math.max(this.state.previewFileCount, index, 1);
          this.state.progressLabel = `Hashing ${entry.name}`;
          this.emitProgress();
        }
      });

      this.state.manifestPath = result.manifestPath;
      this.state.patchZipPath = result.patchZipPath;
      this.state.manifestVersion = result.fileList.version;
      this.state.lastGeneratedAt = new Date().toLocaleString();
      this.state.progressValue = this.state.progressMax;
      this.state.progressLabel = "Generation complete";
      this.state.statusBadge = "Generated";
      this.state.statusDetail = `Wrote ${path.basename(result.manifestPath)} and patch.zip with ${result.downloadCount} files.`;
      this.emitLog(
        `Wrote ${path.basename(result.manifestPath)} and patch.zip with ${result.downloadCount} files inside.`,
        "success"
      );
    } catch (error) {
      generationError = error;
      this.emitLog(`Generation failed: ${error.message}`, "error");
    } finally {
      this.state.isGenerating = false;
      await this.refreshPreview();
      if (generationError) {
        this.state.statusBadge = "Build Error";
        this.state.statusDetail = generationError.message;
        this.emitState();
      }
      this.emitProgress();
    }

    return this.getState();
  }

  getOpenablePaths() {
    return {
      configPath: this.getConfigPath(),
      workingDirectory: this.state.workingDirectory,
      manifestPath: this.state.manifestPath,
      patchZipPath: this.state.patchZipPath
    };
  }
}

module.exports = {
  FileListBuilderBackend
};
