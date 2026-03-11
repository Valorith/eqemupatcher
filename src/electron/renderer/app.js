const state = {
  current: null,
  logs: [],
  consoleVisible: false,
  activeTab: "patch"
};

const elements = {
  leftStage: document.getElementById("leftStage"),
  statusChip: document.getElementById("statusChip"),
  statusDetail: document.getElementById("statusDetail"),
  heroImage: document.getElementById("heroImage"),
  titleValue: document.getElementById("titleValue"),
  websiteLink: document.getElementById("websiteLink"),
  patchTabButton: document.getElementById("patchTabButton"),
  notesTabButton: document.getElementById("notesTabButton"),
  patchTabPanel: document.getElementById("patchTabPanel"),
  notesTabPanel: document.getElementById("notesTabPanel"),
  serverValue: document.getElementById("serverValue"),
  clientValue: document.getElementById("clientValue"),
  patchStateValue: document.getElementById("patchStateValue"),
  actionsRow: document.getElementById("actionsRow"),
  patchButton: document.getElementById("patchButton"),
  actionStatus: document.getElementById("actionStatus"),
  launchButton: document.getElementById("launchButton"),
  refreshButton: document.getElementById("refreshButton"),
  settingsButton: document.getElementById("settingsButton"),
  minimizeButton: document.getElementById("minimizeButton"),
  closeButton: document.getElementById("closeButton"),
  autoPatchToggle: document.getElementById("autoPatchToggle"),
  autoPlayToggle: document.getElementById("autoPlayToggle"),
  reportLink: document.getElementById("reportLink"),
  progressLabel: document.getElementById("progressLabel"),
  progressValue: document.getElementById("progressValue"),
  progressBar: document.getElementById("progressBar"),
  logList: document.getElementById("logList"),
  logPlaceholder: document.getElementById("logPlaceholder"),
  settingsModal: document.getElementById("settingsModal"),
  settingsBackdrop: document.getElementById("settingsBackdrop"),
  settingsCloseButton: document.getElementById("settingsCloseButton"),
  openConfigButton: document.getElementById("openConfigButton"),
  openGameDirectoryButton: document.getElementById("openGameDirectoryButton"),
  versionLabel: document.getElementById("versionLabel")
};

function openSettingsModal() {
  elements.settingsModal.classList.remove("hidden");
  elements.settingsModal.setAttribute("aria-hidden", "false");
}

function closeSettingsModal() {
  elements.settingsModal.classList.add("hidden");
  elements.settingsModal.setAttribute("aria-hidden", "true");
}

async function runUtilityAction(action, successMessage, failureFallback) {
  const result = await action();
  if (result?.ok) {
    pushLog({
      text: `${successMessage} ${result.path}`,
      tone: "info",
      timestamp: new Date().toISOString()
    });
    return;
  }

  pushLog({
    text: result?.error || failureFallback,
    tone: "error",
    timestamp: new Date().toISOString()
  });
}

function setActiveTab(tabName) {
  state.activeTab = tabName;
  const patchIsActive = tabName === "patch";
  const notesIsActive = tabName === "notes";

  elements.patchTabButton.classList.toggle("is-active", patchIsActive);
  elements.patchTabButton.setAttribute("aria-selected", String(patchIsActive));
  elements.patchTabPanel.classList.toggle("hidden", !patchIsActive);

  elements.notesTabButton.classList.toggle("is-active", notesIsActive);
  elements.notesTabButton.setAttribute("aria-selected", String(notesIsActive));
  elements.notesTabPanel.classList.toggle("hidden", !notesIsActive);
}

function renderVersion(version) {
  elements.versionLabel.textContent = `Patcher v${version || "0.0.0"}`;
}

function isCheckingPatch(nextState) {
  return Boolean(
    nextState.gameDirectory &&
      !nextState.isPatching &&
      !nextState.reportUrl &&
      nextState.clientVersion !== "Unknown" &&
      nextState.clientSupported &&
      !nextState.manifestVersion &&
      nextState.statusBadge !== "Manifest Error"
  );
}

function derivePresentation(nextState) {
  const presentation = {
    chipText: nextState.statusBadge,
    chipTone: "neutral",
    statusDetail: nextState.statusDetail || "",
    patchStateText: nextState.needsPatch ? "Update Ready" : nextState.manifestVersion ? "Ready" : "Idle",
    patchLabel: "Verify Integrity",
    patchAction: "verify",
    actionButtonLabel: "Launch Game",
    actionButtonAction: "launch",
    actionButtonTone: "launch",
    showActionStatus: false,
    actionStatusText: "Checking for patch"
  };

  if (!nextState.gameDirectory) {
    presentation.chipText = "Run In Folder";
    presentation.chipTone = "attention";
    presentation.patchStateText = "Waiting for eqgame.exe";
    presentation.actionButtonLabel = "Launch Locked";
    presentation.actionButtonAction = "locked";
    return presentation;
  }

  if (nextState.isPatching) {
    presentation.chipText = "Patching";
    presentation.chipTone = "active";
    presentation.patchStateText = "Patching";
    presentation.patchLabel = "Cancel Patch";
    presentation.patchAction = "cancel";
    presentation.showActionStatus = true;
    presentation.actionStatusText = "Applying patch";
    return presentation;
  }

  if (isCheckingPatch(nextState)) {
    presentation.chipText = "Checking";
    presentation.chipTone = "active";
    presentation.patchStateText = "Checking";
    presentation.showActionStatus = true;
    presentation.actionStatusText = "Checking for patch";
    return presentation;
  }

  if (nextState.reportUrl) {
    presentation.chipText = "Unknown Client";
    presentation.chipTone = "warning";
    presentation.patchStateText = "Unknown client";
    presentation.patchLabel = "Patch Unavailable";
    presentation.patchAction = "locked";
    presentation.actionButtonLabel = "Launch Locked";
    presentation.actionButtonAction = "locked";
    return presentation;
  }

  if (!nextState.clientSupported && nextState.clientVersion !== "Unknown") {
    presentation.chipText = "Unsupported";
    presentation.chipTone = "warning";
    presentation.patchStateText = "Unsupported";
    presentation.patchLabel = "Patch Unavailable";
    presentation.patchAction = "locked";
    presentation.actionButtonLabel = "Launch Locked";
    presentation.actionButtonAction = "locked";
    return presentation;
  }

  if (nextState.statusBadge === "Manifest Error") {
    presentation.chipText = "Manifest Error";
    presentation.chipTone = "warning";
    presentation.patchStateText = "Manifest offline";
    presentation.patchLabel = "Verify Integrity";
    presentation.actionButtonLabel = "Launch Locked";
    presentation.actionButtonAction = "locked";
    return presentation;
  }

  if (nextState.needsPatch) {
    presentation.chipText = "Update Ready";
    presentation.chipTone = "active";
    presentation.patchStateText = "Update Ready";
    presentation.actionButtonLabel = "Start Patch";
    presentation.actionButtonAction = "patch";
    presentation.actionButtonTone = "patch";
    return presentation;
  }

  if (nextState.manifestVersion) {
    presentation.chipText = "Launch Ready";
    presentation.chipTone = "success";
    presentation.patchStateText = "Ready";
    presentation.patchLabel = "Verify Integrity";
    return presentation;
  }

  return presentation;
}

function setBusy(button, busyText, busy) {
  if (button.classList.contains("refresh-button")) {
    button.disabled = busy;
    button.classList.toggle("is-busy", busy);
    button.setAttribute("aria-busy", String(busy));
    return;
  }

  if (!button.dataset.originalText) {
    button.dataset.originalText = button.textContent;
  }

  button.disabled = busy;
  button.textContent = busy ? busyText : button.dataset.originalText;
}

function formatProgress(value, max) {
  return `${value} / ${max}`;
}

function showConsole() {
  state.consoleVisible = true;
  elements.leftStage.classList.add("console-visible");
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

function renderState(nextState) {
  state.current = nextState;
  const presentation = derivePresentation(nextState);
  const resolvedTitle = nextState.serverName || "Launcher";

  if (nextState.isPatching) {
    showConsole();
  }

  elements.statusChip.textContent = presentation.chipText;
  elements.statusChip.dataset.tone = presentation.chipTone;
  elements.statusDetail.textContent = presentation.statusDetail;
  elements.heroImage.src = nextState.heroImageUrl;
  elements.titleValue.textContent = resolvedTitle;
  elements.serverValue.textContent = nextState.serverName;
  elements.clientValue.textContent = nextState.clientLabel;
  elements.patchStateValue.textContent = presentation.patchStateText;
  document.title = resolvedTitle;

  elements.patchButton.dataset.originalText = presentation.patchLabel;
  elements.patchButton.textContent = presentation.patchLabel;
  elements.patchButton.dataset.action = presentation.patchAction;
  elements.patchButton.disabled = presentation.patchAction === "cancel" ? false : !nextState.canPatch;
  const showStandalonePatchAction = presentation.actionButtonAction === "patch" && !presentation.showActionStatus;
  elements.patchButton.classList.toggle("hidden", showStandalonePatchAction);
  elements.actionsRow.classList.toggle("single-action", showStandalonePatchAction);

  elements.actionStatus.textContent = presentation.actionStatusText;
  elements.actionStatus.classList.toggle("hidden", !presentation.showActionStatus);
  elements.launchButton.classList.toggle("hidden", presentation.showActionStatus);
  elements.launchButton.dataset.originalText = presentation.actionButtonLabel;
  elements.launchButton.dataset.action = presentation.actionButtonAction;
  elements.launchButton.textContent = presentation.actionButtonLabel;
  elements.launchButton.classList.toggle("launch-button", presentation.actionButtonTone === "launch");
  elements.launchButton.classList.toggle("start-patch-button", presentation.actionButtonTone === "patch");
  elements.launchButton.classList.toggle("attention-pulse", showStandalonePatchAction);
  elements.launchButton.disabled =
    nextState.isPatching ||
    (presentation.actionButtonAction === "launch" && !nextState.canLaunch) ||
    (presentation.actionButtonAction === "patch" && !nextState.canPatch) ||
    !["launch", "patch"].includes(presentation.actionButtonAction);

  elements.autoPatchToggle.checked = nextState.autoPatch;
  elements.autoPlayToggle.checked = nextState.autoPlay;
  elements.openGameDirectoryButton.disabled = !nextState.gameDirectory;

  if (nextState.reportUrl) {
    elements.reportLink.classList.remove("hidden");
    elements.reportLink.href = nextState.reportUrl;
  } else {
    elements.reportLink.classList.add("hidden");
    elements.reportLink.href = "#";
  }

  renderProgress({
    value: nextState.progressValue,
    max: nextState.progressMax,
    label: nextState.progressLabel
  });
}

function renderProgress(progress) {
  const safeMax = Math.max(1, progress.max || 1);
  const safeValue = Math.max(0, Math.min(progress.value || 0, safeMax));
  const percent = `${(safeValue / safeMax) * 100}%`;

  elements.progressLabel.textContent = progress.label || "Waiting for input";
  elements.progressValue.textContent = formatProgress(safeValue, safeMax);
  elements.progressBar.style.width = percent;
}

function pushLog(entry) {
  state.logs.push(entry);
  if (state.logs.length > 500) {
    state.logs = state.logs.slice(-500);
  }
  renderLogs();
}

function wireEvents() {
  elements.minimizeButton.addEventListener("click", async () => {
    await window.launcher.minimizeWindow();
  });

  elements.closeButton.addEventListener("click", async () => {
    await window.launcher.closeWindow();
  });

  elements.websiteLink.addEventListener("click", async (event) => {
    event.preventDefault();
    await window.launcher.openExternal(elements.websiteLink.href);
  });

  elements.refreshButton.addEventListener("click", async () => {
    setBusy(elements.refreshButton, "Syncing...", true);
    try {
      const nextState = await window.launcher.refreshState();
      renderState(nextState);
    } finally {
      setBusy(elements.refreshButton, "Syncing...", false);
    }
  });

  elements.settingsButton.addEventListener("click", () => {
    openSettingsModal();
  });

  elements.settingsCloseButton.addEventListener("click", () => {
    closeSettingsModal();
  });

  elements.settingsBackdrop.addEventListener("click", () => {
    closeSettingsModal();
  });

  elements.patchTabButton.addEventListener("click", () => {
    setActiveTab("patch");
  });

  elements.notesTabButton.addEventListener("click", () => {
    setActiveTab("notes");
  });

  elements.patchButton.addEventListener("click", async () => {
    const action = elements.patchButton.dataset.action;

    if (action === "cancel") {
      await window.launcher.cancelPatch();
      return;
    }

    if (action !== "verify" || !state.current?.canPatch) {
      return;
    }

    showConsole();
    await window.launcher.startPatch();
  });

  elements.launchButton.addEventListener("click", async () => {
    const action = elements.launchButton.dataset.action;
    if (action === "patch") {
      showConsole();
      await window.launcher.startPatch();
      return;
    }

    if (action === "launch") {
      await window.launcher.minimizeWindow();
      await window.launcher.launchGame();
    }
  });

  elements.autoPatchToggle.addEventListener("change", async () => {
    const nextState = await window.launcher.updateSettings({ autoPatch: elements.autoPatchToggle.checked });
    renderState(nextState);
  });

  elements.autoPlayToggle.addEventListener("change", async () => {
    const nextState = await window.launcher.updateSettings({ autoPlay: elements.autoPlayToggle.checked });
    renderState(nextState);
  });

  elements.reportLink.addEventListener("click", async (event) => {
    event.preventDefault();
    if (state.current?.reportUrl) {
      await window.launcher.openExternal(state.current.reportUrl);
    }
  });

  elements.openConfigButton.addEventListener("click", async () => {
    await runUtilityAction(
      () => window.launcher.openConfigFile(),
      "Opened launcher config:",
      "Unable to open the launcher config file."
    );
  });

  elements.openGameDirectoryButton.addEventListener("click", async () => {
    await runUtilityAction(
      () => window.launcher.openGameDirectory(),
      "Opened game directory:",
      "Unable to open the selected game directory."
    );
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !elements.settingsModal.classList.contains("hidden")) {
      closeSettingsModal();
    }
  });
}

function subscribe() {
  return window.launcher.onEvent((event) => {
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

async function bootstrap() {
  wireEvents();
  subscribe();
  setActiveTab("patch");
  const [version, nextState] = await Promise.all([window.launcher.getVersion(), window.launcher.initialize()]);
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
