const state = {
  current: null,
  logs: [],
  syncTimer: null
};

const elements = {
  refreshButton: document.getElementById("refreshButton"),
  minimizeButton: document.getElementById("minimizeButton"),
  closeButton: document.getElementById("closeButton"),
  workingDirectoryInput: document.getElementById("workingDirectoryInput"),
  workingDirectoryValue: document.getElementById("workingDirectoryValue"),
  clientInput: document.getElementById("clientInput"),
  clientValue: document.getElementById("clientValue"),
  downloadPrefixInput: document.getElementById("downloadPrefixInput"),
  ignoreInput: document.getElementById("ignoreInput"),
  deleteInput: document.getElementById("deleteInput"),
  chooseDirectoryButton: document.getElementById("chooseDirectoryButton"),
  openDirectoryButton: document.getElementById("openDirectoryButton"),
  saveFilesButton: document.getElementById("saveFilesButton"),
  generateButton: document.getElementById("generateButton"),
  openConfigButton: document.getElementById("openConfigButton"),
  openManifestButton: document.getElementById("openManifestButton"),
  openPatchButton: document.getElementById("openPatchButton"),
  statusChip: document.getElementById("statusChip"),
  statusDetail: document.getElementById("statusDetail"),
  includedFilesValue: document.getElementById("includedFilesValue"),
  deleteEntriesValue: document.getElementById("deleteEntriesValue"),
  archiveSizeValue: document.getElementById("archiveSizeValue"),
  outputValue: document.getElementById("outputValue"),
  compatibilityNote: document.getElementById("compatibilityNote"),
  progressLabel: document.getElementById("progressLabel"),
  progressValue: document.getElementById("progressValue"),
  progressBar: document.getElementById("progressBar"),
  logList: document.getElementById("logList"),
  logPlaceholder: document.getElementById("logPlaceholder"),
  versionLabel: document.getElementById("versionLabel")
};

function renderProgress(progress) {
  const safeMax = Math.max(1, progress.max || 1);
  const safeValue = Math.max(0, Math.min(progress.value || 0, safeMax));
  elements.progressLabel.textContent = progress.label || "Waiting for input";
  elements.progressValue.textContent = `${safeValue} / ${safeMax}`;
  elements.progressBar.style.width = `${(safeValue / safeMax) * 100}%`;
}

function renderLogs() {
  elements.logList.innerHTML = "";
  elements.logPlaceholder.style.display = state.logs.length ? "none" : "block";

  for (const entry of state.logs) {
    const row = document.createElement("div");
    row.className = `log-entry ${entry.tone || "info"}`;

    const time = document.createElement("span");
    time.className = "log-time";
    time.textContent = new Date(entry.timestamp).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });

    const text = document.createElement("span");
    text.className = "log-text";
    text.textContent = entry.text;

    row.append(time, text);
    elements.logList.appendChild(row);
  }

  elements.logList.scrollTop = elements.logList.scrollHeight;
}

function pushLog(entry) {
  state.logs.push(entry);
  if (state.logs.length > 500) {
    state.logs = state.logs.slice(-500);
  }
  renderLogs();
}

function setBusy(button, busyText, busy) {
  if (!button.dataset.originalText) {
    button.dataset.originalText = button.textContent;
  }
  button.disabled = busy;
  button.textContent = busy ? busyText : button.dataset.originalText;
}

function renderVersion(version) {
  elements.versionLabel.textContent = `Builder v${version || "0.0.0"}`;
}

function syncDraftSoon() {
  clearTimeout(state.syncTimer);
  state.syncTimer = setTimeout(() => {
    syncDraft().catch((error) => {
      pushLog({
        text: `Draft sync failed: ${error.message}`,
        tone: "error",
        timestamp: new Date().toISOString()
      });
    });
  }, 250);
}

async function syncDraft() {
  const nextState = await window.fileListBuilder.updateDraft({
    client: elements.clientInput.value,
    downloadPrefix: elements.downloadPrefixInput.value,
    ignoreText: elements.ignoreInput.value,
    deleteText: elements.deleteInput.value
  });
  renderState(nextState);
}

async function openUtilityPath(key, successMessage, failureMessage) {
  const result = await window.fileListBuilder.openPath(key);
  if (result?.ok) {
    pushLog({
      text: `${successMessage} ${result.path}`,
      tone: "info",
      timestamp: new Date().toISOString()
    });
    return;
  }

  pushLog({
    text: result?.error || failureMessage,
    tone: "error",
    timestamp: new Date().toISOString()
  });
}

function renderState(nextState) {
  state.current = nextState;
  if (document.activeElement !== elements.clientInput) {
    elements.clientInput.value = nextState.client || "";
  }
  if (document.activeElement !== elements.downloadPrefixInput) {
    elements.downloadPrefixInput.value = nextState.downloadPrefix || "";
  }
  if (document.activeElement !== elements.ignoreInput) {
    elements.ignoreInput.value = nextState.ignoreText || "";
  }
  if (document.activeElement !== elements.deleteInput) {
    elements.deleteInput.value = nextState.deleteText || "";
  }

  elements.workingDirectoryInput.value = nextState.workingDirectory || "";
  elements.workingDirectoryInput.title = nextState.workingDirectory || "";
  elements.workingDirectoryValue.textContent = nextState.workingDirectory || "Not selected";
  elements.workingDirectoryValue.title = nextState.workingDirectory || "";
  elements.clientValue.textContent = nextState.client || "Unset";
  elements.outputValue.textContent = nextState.outputLabel || "Awaiting client";
  elements.statusChip.textContent = nextState.statusBadge;
  elements.statusDetail.textContent = nextState.statusDetail;
  elements.includedFilesValue.textContent = String(nextState.previewFileCount || 0);
  elements.deleteEntriesValue.textContent = String(nextState.previewDeleteCount || 0);
  elements.archiveSizeValue.textContent = nextState.previewSizeLabel || "0 B";
  elements.compatibilityNote.textContent = nextState.compatibilityNote;
  elements.openDirectoryButton.disabled = !nextState.workingDirectory;
  elements.openConfigButton.disabled = !nextState.workingDirectory;
  elements.openManifestButton.disabled = !nextState.manifestPath;
  elements.openPatchButton.disabled = !nextState.patchZipPath;
  elements.saveFilesButton.disabled = !nextState.canSave || nextState.isGenerating;
  elements.generateButton.disabled = !nextState.canGenerate || nextState.isGenerating;
}

function subscribe() {
  return window.fileListBuilder.onEvent((event) => {
    if (event.type === "state") {
      renderState(event.payload);
      return;
    }

    if (event.type === "progress") {
      renderProgress(event.payload);
      return;
    }

    if (event.type === "log") {
      pushLog(event.payload);
    }
  });
}

function wireEvents() {
  elements.minimizeButton.addEventListener("click", async () => {
    await window.fileListBuilder.minimizeWindow();
  });

  elements.closeButton.addEventListener("click", async () => {
    await window.fileListBuilder.closeWindow();
  });

  elements.refreshButton.addEventListener("click", async () => {
    setBusy(elements.refreshButton, "Reloading...", true);
    try {
      const nextState = await window.fileListBuilder.refreshState();
      renderState(nextState);
    } finally {
      setBusy(elements.refreshButton, "Reloading...", false);
    }
  });

  elements.chooseDirectoryButton.addEventListener("click", async () => {
    const nextState = await window.fileListBuilder.chooseWorkingDirectory();
    renderState(nextState);
  });

  elements.openDirectoryButton.addEventListener("click", async () => {
    await openUtilityPath("workingDirectory", "Opened working folder:", "Unable to open the working folder.");
  });

  elements.saveFilesButton.addEventListener("click", async () => {
    await syncDraft();
    setBusy(elements.saveFilesButton, "Saving...", true);
    try {
      const nextState = await window.fileListBuilder.saveDraftFiles();
      renderState(nextState);
    } finally {
      setBusy(elements.saveFilesButton, "Saving...", false);
    }
  });

  elements.generateButton.addEventListener("click", async () => {
    await syncDraft();
    setBusy(elements.generateButton, "Generating...", true);
    try {
      const nextState = await window.fileListBuilder.generate();
      renderState(nextState);
    } finally {
      setBusy(elements.generateButton, "Generating...", false);
    }
  });

  elements.openConfigButton.addEventListener("click", async () => {
    await openUtilityPath("configPath", "Opened config file:", "Unable to open filelistbuilder.yml.");
  });

  elements.openManifestButton.addEventListener("click", async () => {
    await openUtilityPath("manifestPath", "Opened manifest:", "Unable to open the generated manifest.");
  });

  elements.openPatchButton.addEventListener("click", async () => {
    await openUtilityPath("patchZipPath", "Opened patch archive:", "Unable to open patch.zip.");
  });

  for (const input of [elements.clientInput, elements.downloadPrefixInput, elements.ignoreInput, elements.deleteInput]) {
    input.addEventListener("input", syncDraftSoon);
  }
}

async function bootstrap() {
  wireEvents();
  subscribe();
  const [version, nextState] = await Promise.all([
    window.fileListBuilder.getVersion(),
    window.fileListBuilder.initialize()
  ]);
  renderVersion(version);
  renderState(nextState);
}

bootstrap().catch((error) => {
  pushLog({
    text: `Renderer bootstrap failed: ${error.message}`,
    tone: "error",
    timestamp: new Date().toISOString()
  });
});
