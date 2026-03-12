const state = {
  current: null,
  logs: [],
  consoleVisible: false,
  activeTab: "patch",
  lastUnsupportedClientKey: "",
  patchNotes: {
    loadedUrl: "",
    content: "",
    html: "",
    error: "",
    loading: false,
    fetchedAt: "",
    matchCount: 0,
    activeMatchIndex: -1
  }
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
  notesSearchInput: document.getElementById("notesSearchInput"),
  notesPrevMatchButton: document.getElementById("notesPrevMatchButton"),
  notesNextMatchButton: document.getElementById("notesNextMatchButton"),
  notesMeta: document.getElementById("notesMeta"),
  notesContent: document.getElementById("notesContent"),
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
  unsupportedClientModal: document.getElementById("unsupportedClientModal"),
  unsupportedClientBackdrop: document.getElementById("unsupportedClientBackdrop"),
  unsupportedClientCloseButton: document.getElementById("unsupportedClientCloseButton"),
  unsupportedClientDismissButton: document.getElementById("unsupportedClientDismissButton"),
  unsupportedClientMessage: document.getElementById("unsupportedClientMessage"),
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
function openUnsupportedClientModal(nextState) {
  if (nextState.clientVersion === "Unknown") {
    elements.unsupportedClientMessage.textContent = `This EverQuest executable is not recognized by ${nextState.serverName}. Launch is disabled until you switch to a supported client build.`;
  } else {
    elements.unsupportedClientMessage.textContent = `${nextState.clientLabel} is not listed as a supported client for ${nextState.serverName}. Launch is disabled until you switch to a supported client build.`;
  }
  elements.unsupportedClientModal.classList.remove("hidden");
  elements.unsupportedClientModal.setAttribute("aria-hidden", "false");
}
function closeUnsupportedClientModal() {
  elements.unsupportedClientModal.classList.add("hidden");
  elements.unsupportedClientModal.setAttribute("aria-hidden", "true");
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
function escapeRegex(text) {
  return String(text || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function updatePatchNotesMeta(text) {
  elements.notesMeta.textContent = text;
}


function hasConfiguredPatchNotesSource() {
  return Boolean(String(state.current?.patchNotesUrl || "").trim());
}

function setPatchNotesSearchEnabled(enabled) {
  elements.notesSearchInput.disabled = !enabled;
  if (!enabled) {
    elements.notesPrevMatchButton.disabled = true;
    elements.notesNextMatchButton.disabled = true;
  }
}

function updateMatchNavigation() {
  if (!hasConfiguredPatchNotesSource()) {
    setPatchNotesSearchEnabled(false);
    return;
  }

  setPatchNotesSearchEnabled(true);
  const hasMatches = state.patchNotes.matchCount > 0;
  const hasActive = state.patchNotes.activeMatchIndex >= 0;

  elements.notesPrevMatchButton.disabled = !hasMatches || !hasActive || state.patchNotes.activeMatchIndex === 0;
  elements.notesNextMatchButton.disabled =
    !hasMatches || !hasActive || state.patchNotes.activeMatchIndex >= state.patchNotes.matchCount - 1;
}

function setActiveSearchMatch(nextIndex, options = {}) {
  const { scrollIntoView = true } = options;
  const matches = Array.from(elements.notesContent.querySelectorAll("mark.notes-match"));

  if (!matches.length) {
    state.patchNotes.activeMatchIndex = -1;
    updateMatchNavigation();
    return;
  }

  const safeIndex = Math.max(0, Math.min(nextIndex, matches.length - 1));
  state.patchNotes.activeMatchIndex = safeIndex;

  for (const [index, match] of matches.entries()) {
    match.classList.toggle("is-current", index === safeIndex);
  }

  if (scrollIntoView) {
    matches[safeIndex].scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
  }

  updateMatchNavigation();
}

function highlightMatchesInPatchNotes(query) {
  const trimmed = String(query || "").trim();
  if (!trimmed) {
    state.patchNotes.matchCount = 0;
    state.patchNotes.activeMatchIndex = -1;
    updateMatchNavigation();
    return;
  }

  const regex = new RegExp(escapeRegex(trimmed), "gi");
  const walker = document.createTreeWalker(elements.notesContent, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  let node;

  while ((node = walker.nextNode())) {
    if (!node.nodeValue || !node.nodeValue.trim()) {
      continue;
    }
    textNodes.push(node);
  }

  let totalMatches = 0;

  for (const textNode of textNodes) {
    const text = textNode.nodeValue;
    regex.lastIndex = 0;
    if (!regex.test(text)) {
      continue;
    }

    regex.lastIndex = 0;
    const fragment = document.createDocumentFragment();
    let cursor = 0;
    let match;

    while ((match = regex.exec(text))) {
      const startIndex = match.index;
      const endIndex = startIndex + match[0].length;

      if (startIndex > cursor) {
        fragment.appendChild(document.createTextNode(text.slice(cursor, startIndex)));
      }

      const mark = document.createElement("mark");
      mark.className = "notes-match";
      mark.textContent = text.slice(startIndex, endIndex);
      fragment.appendChild(mark);
      totalMatches += 1;
      cursor = endIndex;
    }

    if (cursor < text.length) {
      fragment.appendChild(document.createTextNode(text.slice(cursor)));
    }

    textNode.replaceWith(fragment);
  }

  state.patchNotes.matchCount = totalMatches;
  if (!totalMatches) {
    state.patchNotes.activeMatchIndex = -1;
    updateMatchNavigation();
    return;
  }

  setActiveSearchMatch(0, { scrollIntoView: false });
}

function renderPatchNotes() {
  const query = elements.notesSearchInput.value.trim();

  if (state.patchNotes.loading) {
    elements.notesContent.innerHTML = '<p class="notes-copy">Loading patch notes...</p>';
    state.patchNotes.matchCount = 0;
    state.patchNotes.activeMatchIndex = -1;
    updatePatchNotesMeta("Loading...");
    updateMatchNavigation();
    return;
  }

  if (state.patchNotes.error) {
    elements.notesContent.innerHTML = "";
    const errorParagraph = document.createElement("p");
    errorParagraph.className = "notes-copy";
    errorParagraph.textContent = state.patchNotes.error;
    elements.notesContent.appendChild(errorParagraph);
    state.patchNotes.matchCount = 0;
    state.patchNotes.activeMatchIndex = -1;
    updatePatchNotesMeta("Unable to load");
    updateMatchNavigation();
    return;
  }

  if (!state.patchNotes.html) {
    elements.notesContent.innerHTML = '<p class="notes-copy">Patch Notes source not configured.</p>';
    state.patchNotes.matchCount = 0;
    state.patchNotes.activeMatchIndex = -1;
    if (!hasConfiguredPatchNotesSource()) {
      elements.notesSearchInput.value = "";
    }
    updatePatchNotesMeta("No source configured");
    updateMatchNavigation();
    return;
  }

  elements.notesContent.innerHTML = state.patchNotes.html;
  highlightMatchesInPatchNotes(query);

  const lineCount = state.patchNotes.content ? state.patchNotes.content.split("\n").length : 0;
  const hasQuery = Boolean(query);
  const matchLabel = hasQuery ? ` · ${state.patchNotes.activeMatchIndex + 1}/${state.patchNotes.matchCount} matches` : "";
  const meta = hasQuery
    ? `Filtered by "${query}" · ${lineCount} lines${matchLabel}`
    : `${lineCount} lines`;
  updatePatchNotesMeta(meta);
}

async function loadPatchNotes(forceRefresh = false) {
  if (state.patchNotes.loading) {
    return;
  }

  state.patchNotes.loading = true;
  renderPatchNotes();

  const notes = await window.launcher.getPatchNotes({ forceRefresh });
  state.patchNotes.loading = false;
  state.patchNotes.loadedUrl = notes.url || "";
  state.patchNotes.content = notes.content || "";
  state.patchNotes.html = notes.html || "";
  state.patchNotes.error = notes.error || "";
  state.patchNotes.fetchedAt = notes.fetchedAt || "";
  state.patchNotes.matchCount = 0;
  state.patchNotes.activeMatchIndex = -1;
  renderPatchNotes();
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
  if (notesIsActive && !state.patchNotes.html && !state.patchNotes.loading) {
    loadPatchNotes(false).catch((error) => {
      state.patchNotes.loading = false;
      state.patchNotes.error = `Unable to load patch notes: ${error.message}`;
      renderPatchNotes();
    });
  }
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
    statusDetailTone: "default",
    patchStateText: nextState.needsPatch ? "Update Ready" : nextState.manifestVersion ? "Ready" : "Idle",
    patchLabel: "Verify Integrity",
    patchAction: "verify",
    actionButtonLabel: "Launch Game",
    actionButtonAction: "launch",
    actionButtonTone: "launch",
    blockedClient: false,
    unsupportedClient: false,
    showActionStatus: false,
    actionStatusText: "Checking for patch"
  };
  if (!nextState.gameDirectory) {
    presentation.chipText = "Run In Folder";
    presentation.chipTone = "attention";
    presentation.statusDetailTone = "danger";
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
    presentation.statusDetailTone = "danger";
    presentation.patchStateText = "Unknown client";
    presentation.patchLabel = "Patch Unavailable";
    presentation.patchAction = "locked";
    presentation.actionButtonLabel = "Launch Locked";
    presentation.actionButtonAction = "locked";
    presentation.actionButtonTone = "unsupported";
    presentation.blockedClient = true;
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
    presentation.actionButtonTone = "unsupported";
    presentation.blockedClient = true;
    presentation.unsupportedClient = true;
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
  setPatchNotesSearchEnabled(hasConfiguredPatchNotesSource());
  const presentation = derivePresentation(nextState);
  const resolvedTitle = nextState.serverName || "Launcher";
  if (nextState.isPatching) {
    showConsole();
  }
  elements.statusChip.textContent = presentation.chipText;
  elements.statusChip.dataset.tone = presentation.chipTone;
  elements.statusDetail.textContent = presentation.statusDetail;
  elements.statusDetail.dataset.tone = presentation.statusDetailTone;
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
  elements.launchButton.classList.toggle("unsupported-launch-button", presentation.actionButtonTone === "unsupported");
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
  const blockedClientKey = presentation.blockedClient ? `${nextState.clientVersion}:${nextState.clientHash}` : "";
  if (presentation.blockedClient && blockedClientKey !== state.lastUnsupportedClientKey) {
    openUnsupportedClientModal(nextState);
    state.lastUnsupportedClientKey = blockedClientKey;
  } else if (!presentation.blockedClient) {
    state.lastUnsupportedClientKey = "";
    closeUnsupportedClientModal();
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
      const [nextState] = await Promise.all([
        window.launcher.refreshState(),
        loadPatchNotes(true)
      ]);
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
  elements.unsupportedClientCloseButton.addEventListener("click", () => {
    closeUnsupportedClientModal();
  });
  elements.unsupportedClientDismissButton.addEventListener("click", () => {
    closeUnsupportedClientModal();
  });
  elements.unsupportedClientBackdrop.addEventListener("click", () => {
    closeUnsupportedClientModal();
  });
  elements.patchTabButton.addEventListener("click", () => {
    setActiveTab("patch");
  });
  elements.notesTabButton.addEventListener("click", () => {
    setActiveTab("notes");
  });
  let notesSearchDebounce = null;
  elements.notesSearchInput.addEventListener("input", () => {
    clearTimeout(notesSearchDebounce);
    notesSearchDebounce = setTimeout(() => {
      renderPatchNotes();
    }, 120);
  });

  elements.notesSearchInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      if (event.shiftKey) {
        setActiveSearchMatch(state.patchNotes.activeMatchIndex - 1);
      } else {
        setActiveSearchMatch(state.patchNotes.activeMatchIndex + 1);
      }
    }
  });

  elements.notesPrevMatchButton.addEventListener("click", () => {
    setActiveSearchMatch(state.patchNotes.activeMatchIndex - 1);
  });

  elements.notesNextMatchButton.addEventListener("click", () => {
    setActiveSearchMatch(state.patchNotes.activeMatchIndex + 1);
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
    if (event.key !== "Escape") {
      return;
    }
    if (!elements.unsupportedClientModal.classList.contains("hidden")) {
      closeUnsupportedClientModal();
      return;
    }
    if (!elements.settingsModal.classList.contains("hidden")) {
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
