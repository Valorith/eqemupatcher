const state = {
  current: null,
  logs: []
};

const elements = {
  statusChip: document.getElementById("statusChip"),
  heroImage: document.getElementById("heroImage"),
  heroTitle: document.getElementById("heroTitle"),
  heroDetail: document.getElementById("heroDetail"),
  serverValue: document.getElementById("serverValue"),
  clientValue: document.getElementById("clientValue"),
  manifestValue: document.getElementById("manifestValue"),
  patchStateValue: document.getElementById("patchStateValue"),
  gameDirectoryValue: document.getElementById("gameDirectoryValue"),
  patchButton: document.getElementById("patchButton"),
  launchButton: document.getElementById("launchButton"),
  refreshButton: document.getElementById("refreshButton"),
  browseButton: document.getElementById("browseButton"),
  autoPatchToggle: document.getElementById("autoPatchToggle"),
  autoPlayToggle: document.getElementById("autoPlayToggle"),
  platformNote: document.getElementById("platformNote"),
  reportLink: document.getElementById("reportLink"),
  progressLabel: document.getElementById("progressLabel"),
  progressValue: document.getElementById("progressValue"),
  progressBar: document.getElementById("progressBar"),
  logList: document.getElementById("logList"),
  logPlaceholder: document.getElementById("logPlaceholder")
};

function derivePresentation(nextState) {
  const presentation = {
    chipText: nextState.statusBadge,
    chipTone: "neutral",
    heroTitle: nextState.statusBadge,
    heroDetail: nextState.statusDetail,
    patchStateText: nextState.needsPatch ? "Update Ready" : nextState.manifestVersion ? "Ready" : "Idle",
    patchLabel: nextState.patchActionLabel,
    launchLabel: nextState.launchActionLabel,
    platformNote: nextState.launchSupported
      ? "Patch files and launch from this machine."
      : "Patch validation works here. Game launch remains Windows-only."
  };

  if (!nextState.gameDirectory) {
    presentation.chipText = "Awaiting Directory";
    presentation.chipTone = "attention";
    presentation.heroTitle = "Prime the Launcher";
    presentation.heroDetail = "Choose your EverQuest directory to detect the client, load the manifest, and unlock deployment controls.";
    presentation.patchStateText = "Awaiting directory";
    presentation.patchLabel = "Patch Locked";
    presentation.launchLabel = "Launch Locked";
    return presentation;
  }

  if (nextState.isPatching) {
    presentation.chipText = "Patching";
    presentation.chipTone = "active";
    presentation.heroTitle = "Deploying Update";
    presentation.heroDetail = nextState.statusDetail;
    presentation.patchStateText = "Patching";
    presentation.patchLabel = "Cancel Patch";
    return presentation;
  }

  if (nextState.reportUrl) {
    presentation.chipText = "Unknown Client";
    presentation.chipTone = "warning";
    presentation.heroTitle = "Unknown Client Build";
    presentation.heroDetail = "This executable hash is not recognized. Report it before patching.";
    presentation.patchStateText = "Unknown client";
    presentation.patchLabel = "Patch Unavailable";
    presentation.launchLabel = "Launch Locked";
    return presentation;
  }

  if (!nextState.clientSupported && nextState.clientVersion !== "Unknown") {
    presentation.chipText = "Unsupported";
    presentation.chipTone = "warning";
    presentation.heroTitle = "Unsupported Client";
    presentation.heroDetail = nextState.statusDetail;
    presentation.patchStateText = "Unsupported";
    presentation.patchLabel = "Patch Unavailable";
    return presentation;
  }

  if (nextState.statusBadge === "Manifest Error") {
    presentation.chipText = "Manifest Error";
    presentation.chipTone = "warning";
    presentation.heroTitle = "Manifest Sync Failed";
    presentation.heroDetail = nextState.statusDetail;
    presentation.patchStateText = "Manifest offline";
    presentation.patchLabel = "Manifest Error";
    return presentation;
  }

  if (nextState.needsPatch) {
    presentation.chipText = "Update Ready";
    presentation.chipTone = "active";
    presentation.heroTitle = "Update Ready";
    presentation.heroDetail = nextState.manifestVersion
      ? `Manifest ${nextState.manifestVersion} is ready to deploy for ${nextState.clientLabel}.`
      : nextState.statusDetail;
    presentation.patchStateText = "Update Ready";
    presentation.patchLabel = "Deploy Patch";
    return presentation;
  }

  if (nextState.manifestVersion) {
    presentation.chipText = "Launch Ready";
    presentation.chipTone = "success";
    presentation.heroTitle = "Launch Ready";
    presentation.heroDetail = nextState.launchSupported
      ? "Files are in sync. Verify again or launch straight into the client."
      : "Files are in sync. Verification works here; launching eqgame.exe still requires Windows.";
    presentation.patchStateText = "Ready";
    presentation.patchLabel = "Verify Integrity";
    return presentation;
  }

  return presentation;
}

function setBusy(button, busyText, busy) {
  if (!button.dataset.originalText) {
    button.dataset.originalText = button.textContent;
  }

  button.textContent = busy ? busyText : button.dataset.originalText;
}

function formatProgress(value, max) {
  return `${value} / ${max}`;
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

  elements.statusChip.textContent = presentation.chipText;
  elements.statusChip.dataset.tone = presentation.chipTone;
  elements.heroImage.src = nextState.heroImageUrl;
  elements.heroTitle.textContent = presentation.heroTitle;
  elements.heroDetail.textContent = presentation.heroDetail;
  elements.serverValue.textContent = nextState.serverName;
  elements.clientValue.textContent = nextState.clientLabel;
  elements.manifestValue.textContent = nextState.manifestVersion || "Not loaded";
  elements.patchStateValue.textContent = presentation.patchStateText;
  elements.gameDirectoryValue.textContent = nextState.gameDirectory || "No folder selected";

  elements.patchButton.dataset.originalText = presentation.patchLabel;
  elements.patchButton.textContent = presentation.patchLabel;
  elements.patchButton.disabled = nextState.isPatching ? false : !nextState.canPatch;

  elements.launchButton.dataset.originalText = presentation.launchLabel;
  elements.launchButton.textContent = presentation.launchLabel;
  elements.launchButton.disabled = nextState.isPatching || !nextState.canLaunch;

  elements.autoPatchToggle.checked = nextState.autoPatch;
  elements.autoPlayToggle.checked = nextState.autoPlay;

  elements.platformNote.textContent = presentation.platformNote;

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
  elements.browseButton.addEventListener("click", async () => {
    setBusy(elements.browseButton, "Opening...", true);
    try {
      const nextState = await window.launcher.chooseGameDirectory();
      renderState(nextState);
    } finally {
      setBusy(elements.browseButton, "Opening...", false);
    }
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

  elements.patchButton.addEventListener("click", async () => {
    if (state.current?.isPatching) {
      await window.launcher.cancelPatch();
      return;
    }

    if (!state.current?.canPatch) {
      return;
    }

    await window.launcher.startPatch();
  });

  elements.launchButton.addEventListener("click", async () => {
    await window.launcher.launchGame();
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
  const nextState = await window.launcher.initialize();
  renderState(nextState);
}

bootstrap().catch((error) => {
  pushLog({
    text: `Renderer bootstrap failed: ${error.message}`,
    tone: "error",
    timestamp: new Date().toISOString()
  });
});
