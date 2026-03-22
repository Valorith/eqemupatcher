const state = {
  current: null,
  logs: [],
  consoleVisible: false,
  activeTab: "patch",
  lastUnsupportedClientKey: "",
  launcherUpdatePromptPending: true,
  launcherUpdatePromptedVersion: "",
  launcherUpdateAutoApplyVersion: "",
  launcherUpdateAutoApplyInFlight: false,
  patchNotesPromptDismissedSignature: "",
  uiManagerConfirmationAction: null,
  patchNotes: {
    loaded: false,
    loadedUrl: "",
    content: "",
    html: "",
    error: "",
    loading: false,
    fetchedAt: "",
    contentHash: "",
    signature: "",
    hasUnread: false,
    matchCount: 0,
    activeMatchIndex: -1
  },
  uiManager: {
    overviewLoading: false,
    detailLoading: false,
    actionLoading: false,
    overview: null,
    detail: null,
    packageMetadataHealth: {},
    packageMetadataHealthRunning: false,
    packageMetadataHealthRunId: 0,
    activeStage: "targets",
    selectedPackageName: "",
    selectedOptionPath: "",
    selectedOptionPaths: [],
    selectedTargetPaths: [],
    packageDetailTab: "overview",
    packageContextMenuOpen: false,
    packageContextMenuX: 0,
    packageContextMenuY: 0,
    packageContextPackageName: "",
    targetSearchQuery: "",
    targetServerFilter: "",
    targetPickerOpen: false,
    noticeText: "",
    noticeTone: "info"
  }
};
let uiManagerNoticeTimeoutId = null;
const PATCH_NOTES_READ_STORAGE_KEY = "eqemu-launcher.patchNotesRead";
const PATCH_NOTES_READ_INITIALIZED_STORAGE_KEY = "eqemu-launcher.patchNotesReadInitialized";
const { createPatchNotesReadTracker, getPatchNotesSignature, shouldLoadPatchNotes } = window.PatchNotesState;
const patchNotesReadTracker = createPatchNotesReadTracker({
  storage: window.localStorage,
  storageKey: PATCH_NOTES_READ_STORAGE_KEY,
  initializedStorageKey: PATCH_NOTES_READ_INITIALIZED_STORAGE_KEY
});
const elements = {
  leftStage: document.getElementById("leftStage"),
  statusChip: document.getElementById("statusChip"),
  statusDetail: document.getElementById("statusDetail"),
  heroImage: document.getElementById("heroImage"),
  titleValue: document.getElementById("titleValue"),
  websiteLink: document.getElementById("websiteLink"),
  toolsButton: document.getElementById("toolsButton"),
  toolsMenu: document.getElementById("toolsMenu"),
  patchTabButton: document.getElementById("patchTabButton"),
  notesTabButton: document.getElementById("notesTabButton"),
  uiManagerTabButton: document.getElementById("uiManagerTabButton"),
  patchTabPanel: document.getElementById("patchTabPanel"),
  notesTabPanel: document.getElementById("notesTabPanel"),
  uiManagerTabPanel: document.getElementById("uiManagerTabPanel"),
  notesSearchInput: document.getElementById("notesSearchInput"),
  notesPrevMatchButton: document.getElementById("notesPrevMatchButton"),
  notesNextMatchButton: document.getElementById("notesNextMatchButton"),
  notesMeta: document.getElementById("notesMeta"),
  notesCard: document.getElementById("notesCard"),
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
  discordButton: document.getElementById("discordButton"),
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
  launcherUpdateModal: document.getElementById("launcherUpdateModal"),
  launcherUpdateBackdrop: document.getElementById("launcherUpdateBackdrop"),
  launcherUpdateCloseButton: document.getElementById("launcherUpdateCloseButton"),
  launcherUpdateSummary: document.getElementById("launcherUpdateSummary"),
  launcherUpdateCurrentVersion: document.getElementById("launcherUpdateCurrentVersion"),
  launcherUpdateLatestVersion: document.getElementById("launcherUpdateLatestVersion"),
  launcherUpdateReleaseNotes: document.getElementById("launcherUpdateReleaseNotes"),
  launcherUpdateLaterButton: document.getElementById("launcherUpdateLaterButton"),
  launcherUpdateNowButton: document.getElementById("launcherUpdateNowButton"),
  launcherUpdatePanel: document.getElementById("launcherUpdatePanel"),
  launcherUpdateMeta: document.getElementById("launcherUpdateMeta"),
  launcherUpdateMessage: document.getElementById("launcherUpdateMessage"),
  launcherUpdateActionButton: document.getElementById("launcherUpdateActionButton"),
  launcherUpdateLinkButton: document.getElementById("launcherUpdateLinkButton"),
  patchNotesPromptModal: document.getElementById("patchNotesPromptModal"),
  patchNotesPromptBackdrop: document.getElementById("patchNotesPromptBackdrop"),
  patchNotesPromptCloseButton: document.getElementById("patchNotesPromptCloseButton"),
  patchNotesPromptMessage: document.getElementById("patchNotesPromptMessage"),
  patchNotesPromptLaterButton: document.getElementById("patchNotesPromptLaterButton"),
  patchNotesPromptViewButton: document.getElementById("patchNotesPromptViewButton"),
  openUiManagerButton: document.getElementById("openUiManagerButton"),
  uiManagerRefreshButton: document.getElementById("uiManagerRefreshButton"),
  uiManagerPackageCount: document.getElementById("uiManagerPackageCount"),
  uiManagerPreparedCount: document.getElementById("uiManagerPreparedCount"),
  uiManagerTargetCount: document.getElementById("uiManagerTargetCount"),
  uiManagerPreviewName: document.getElementById("uiManagerPreviewName"),
  uiManagerPreviewMeta: document.getElementById("uiManagerPreviewMeta"),
  uiManagerStatusBadge: document.getElementById("uiManagerStatusBadge"),
  uiManagerModal: document.getElementById("uiManagerModal"),
  uiManagerBackdrop: document.getElementById("uiManagerBackdrop"),
  uiManagerCloseButton: document.getElementById("uiManagerCloseButton"),
  uiManagerRecoveryButton: document.getElementById("uiManagerRecoveryButton"),
  uiManagerImportButton: document.getElementById("uiManagerImportButton"),
  uiManagerModalRefreshButton: document.getElementById("uiManagerModalRefreshButton"),
  uiManagerDropZone: document.getElementById("uiManagerDropZone"),
  uiManagerNotice: document.getElementById("uiManagerNotice"),
  uiManagerPackageContextMenu: document.getElementById("uiManagerPackageContextMenu"),
  uiManagerPackageValidateAction: document.getElementById("uiManagerPackageValidateAction"),
  uiManagerSidebarMeta: document.getElementById("uiManagerSidebarMeta"),
  uiManagerPackageList: document.getElementById("uiManagerPackageList"),
  uiManagerPackageMeta: document.getElementById("uiManagerPackageMeta"),
  uiManagerPackageDetail: document.getElementById("uiManagerPackageDetail"),
  uiManagerStageTabs: document.getElementById("uiManagerStageTabs"),
  uiManagerStageTargetsButton: document.getElementById("uiManagerStageTargetsButton"),
  uiManagerStagePackagesButton: document.getElementById("uiManagerStagePackagesButton"),
  uiManagerStageComponentsButton: document.getElementById("uiManagerStageComponentsButton"),
  uiManagerStageConfirmButton: document.getElementById("uiManagerStageConfirmButton"),
  uiManagerTargetsStage: document.getElementById("uiManagerTargetsStage"),
  uiManagerPackagesStage: document.getElementById("uiManagerPackagesStage"),
  uiManagerComponentsStage: document.getElementById("uiManagerComponentsStage"),
  uiManagerConfirmStage: document.getElementById("uiManagerConfirmStage"),
  uiManagerTargetMeta: document.getElementById("uiManagerTargetMeta"),
  uiManagerTargetServerFilter: document.getElementById("uiManagerTargetServerFilter"),
  uiManagerTargetPickerButton: document.getElementById("uiManagerTargetPickerButton"),
  uiManagerTargetPickerSummary: document.getElementById("uiManagerTargetPickerSummary"),
  uiManagerTargetPickerPanel: document.getElementById("uiManagerTargetPickerPanel"),
  uiManagerTargetSearchInput: document.getElementById("uiManagerTargetSearchInput"),
  uiManagerAllTargetsCheckbox: document.getElementById("uiManagerAllTargetsCheckbox"),
  uiManagerTargetList: document.getElementById("uiManagerTargetList"),
  uiManagerTargetSelectionSummary: document.getElementById("uiManagerTargetSelectionSummary"),
  uiManagerOptionMeta: document.getElementById("uiManagerOptionMeta"),
  uiManagerOptionPrevButton: document.getElementById("uiManagerOptionPrevButton"),
  uiManagerOptionNextButton: document.getElementById("uiManagerOptionNextButton"),
  uiManagerOptionList: document.getElementById("uiManagerOptionList"),
  uiManagerPreviewPanel: document.getElementById("uiManagerPreviewPanel"),
  uiManagerConfirmationSummary: document.getElementById("uiManagerConfirmationSummary"),
  uiManagerBackupList: document.getElementById("uiManagerBackupList"),
  uiManagerRecoveryModal: document.getElementById("uiManagerRecoveryModal"),
  uiManagerRecoveryBackdrop: document.getElementById("uiManagerRecoveryBackdrop"),
  uiManagerRecoveryCloseButton: document.getElementById("uiManagerRecoveryCloseButton"),
  uiManagerRecoveryPackageName: document.getElementById("uiManagerRecoveryPackageName"),
  uiManagerRecoveryMeta: document.getElementById("uiManagerRecoveryMeta"),
  uiManagerRecoveryStats: document.getElementById("uiManagerRecoveryStats"),
  uiManagerActionMeta: document.getElementById("uiManagerActionMeta"),
  uiManagerPreviousStageButton: document.getElementById("uiManagerPreviousStageButton"),
  uiManagerNextStageButton: document.getElementById("uiManagerNextStageButton"),
  uiManagerApplyOptionButton: document.getElementById("uiManagerApplyOptionButton"),
  uiManagerResetButton: document.getElementById("uiManagerResetButton"),
  uiManagerSelectAllTargetsButton: document.getElementById("uiManagerSelectAllTargetsButton"),
  uiManagerClearTargetsButton: document.getElementById("uiManagerClearTargetsButton"),
  uiManagerConfirmModal: document.getElementById("uiManagerConfirmModal"),
  uiManagerConfirmBackdrop: document.getElementById("uiManagerConfirmBackdrop"),
  uiManagerConfirmCloseButton: document.getElementById("uiManagerConfirmCloseButton"),
  uiManagerConfirmMessage: document.getElementById("uiManagerConfirmMessage"),
  uiManagerConfirmCancelButton: document.getElementById("uiManagerConfirmCancelButton"),
  uiManagerConfirmAcceptButton: document.getElementById("uiManagerConfirmAcceptButton")
};
function resetPatchNotesState() {
  closePatchNotesPromptModal();
  state.patchNotesPromptDismissedSignature = "";
  state.patchNotes.loaded = false;
  state.patchNotes.loadedUrl = "";
  state.patchNotes.content = "";
  state.patchNotes.html = "";
  state.patchNotes.error = "";
  state.patchNotes.loading = false;
  state.patchNotes.fetchedAt = "";
  state.patchNotes.contentHash = "";
  state.patchNotes.signature = "";
  state.patchNotes.hasUnread = false;
  state.patchNotes.matchCount = 0;
  state.patchNotes.activeMatchIndex = -1;
}
function normalizePatchNotesLinkHref(href) {
  const normalized = String(href || "").trim();
  if (!normalized) {
    return "";
  }

  if (/^https?\/\//i.test(normalized)) {
    return normalized.replace(/^https?(?=\/\/)/i, (scheme) => `${scheme}:`);
  }

  return normalized;
}
const RELEASE_NOTES_LINK_PATTERN = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|<((?:https?:\/\/)[^>\s]+)>|((?:https?:\/\/)[^\s<]+)/gi;
function clearElementContent(element) {
  element.textContent = "";
  element.innerHTML = "";
  if (Array.isArray(element.children)) {
    element.children.length = 0;
  }
}
function applyHorizontalWheelDelta(rail, delta) {
  if (!rail || !delta || rail.scrollWidth <= rail.clientWidth) {
    return false;
  }

  const scrollAmount = Math.sign(delta) * Math.min(Math.max(Math.abs(delta), 72), 220);
  rail.scrollLeft += scrollAmount;
  return true;
}
function scrollUiManagerRail(element, direction = 1, stepMultiplier = 0.82) {
  if (!element) {
    return;
  }

  const viewportWidth = typeof element.clientWidth === "number" && element.clientWidth > 0
    ? element.clientWidth
    : 320;
  const scrollAmount = Math.max(180, Math.round(viewportWidth * stepMultiplier)) * direction;

  if (typeof element.scrollBy === "function") {
    element.scrollBy({ left: scrollAmount, behavior: "smooth" });
    return;
  }

  element.scrollLeft += scrollAmount;
}
function handleHorizontalWheelEvent(rail, event, delta) {
  if (!rail || event.ctrlKey) {
    return false;
  }

  if (!applyHorizontalWheelDelta(rail, delta)) {
    return false;
  }

  event.preventDefault();
  return true;
}
function bindHorizontalWheelScroll(element) {
  if (!element) {
    return;
  }

  if (element.dataset.horizontalWheelBound !== "true") {
    element.dataset.horizontalWheelBound = "true";
    element.addEventListener("wheel", (event) => {
      if (event.target && typeof event.target.closest === "function" && event.target.closest("input[type='search'], input[type='text'], textarea")) {
        return;
      }

      const primaryDelta = Math.abs(event.deltaY) > Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
      handleHorizontalWheelEvent(element, event, primaryDelta);
    }, { passive: false });
    element.addEventListener("mousewheel", (event) => {
      if (event.target && typeof event.target.closest === "function" && event.target.closest("input[type='search'], input[type='text'], textarea")) {
        return;
      }

      const legacyDelta = typeof event.wheelDelta === "number" ? -event.wheelDelta : 0;
      handleHorizontalWheelEvent(element, event, legacyDelta);
    }, { passive: false });
  }
}
function createUiManagerPill(label, tone = "") {
  const pill = document.createElement("span");
  pill.className = "ui-manager-pill";
  pill.textContent = label;
  if (tone) {
    pill.dataset.tone = tone;
  }
  return pill;
}
function createUiManagerEmptyState(title, copy) {
  const empty = document.createElement("div");
  empty.className = "ui-manager-empty-state";

  const heading = document.createElement("p");
  heading.className = "ui-manager-empty-title";
  heading.textContent = title;
  empty.appendChild(heading);

  const body = document.createElement("p");
  body.className = "ui-manager-package-subcopy";
  body.textContent = copy;
  empty.appendChild(body);
  return empty;
}
const UI_MANAGER_STAGES = ["targets", "packages", "components", "confirm"];
function setUiManagerActiveStage(stageName) {
  const supportedStages = new Set(UI_MANAGER_STAGES);
  state.uiManager.activeStage = supportedStages.has(stageName) ? stageName : "targets";
}
function getUiManagerStageIndex(stageName = state.uiManager.activeStage) {
  return Math.max(0, UI_MANAGER_STAGES.indexOf(stageName));
}
function getUiManagerTargets() {
  return Array.isArray(state.uiManager.overview?.targets) ? state.uiManager.overview.targets : [];
}
function getUiManagerSelectedTargets() {
  return getUiManagerTargets().filter((entry) => state.uiManager.selectedTargetPaths.includes(entry.path));
}
function getUiManagerReviewTargets() {
  return areAllUiManagerTargetsSelected() ? getUiManagerTargets() : getUiManagerSelectedTargets();
}
function appendUiManagerLabelPills(container, labels, tone = "", maxVisible = 10) {
  const visibleLabels = labels.slice(0, maxVisible);
  for (const label of visibleLabels) {
    container.appendChild(createUiManagerPill(label, tone));
  }

  const remainder = labels.length - visibleLabels.length;
  if (remainder > 0) {
    container.appendChild(createUiManagerPill(`+${remainder} more`, "warning"));
  }
}
function canUiManagerOpenStage(stageName) {
  const selectedPackage = getUiManagerSelectedPackageSummary();
  if (stageName === "targets" || stageName === "packages") {
    return true;
  }

  if (stageName === "components" || stageName === "confirm") {
    return Boolean(selectedPackage && (selectedPackage.protected || selectedPackage.prepared));
  }

  return false;
}
function getUiManagerAdjacentStage(step) {
  const currentIndex = getUiManagerStageIndex();
  const nextIndex = currentIndex + step;
  if (nextIndex < 0 || nextIndex >= UI_MANAGER_STAGES.length) {
    return null;
  }

  return UI_MANAGER_STAGES[nextIndex];
}
function getUiManagerFilteredTargets() {
  const query = String(state.uiManager.targetSearchQuery || "").trim().toLowerCase();
  const serverFilter = String(state.uiManager.targetServerFilter || "").trim().toLowerCase();
  const targets = getUiManagerTargets();
  return targets.filter((target) => {
    if (serverFilter && String(target.serverName || "").trim().toLowerCase() !== serverFilter) {
      return false;
    }
    if (!query) {
      return true;
    }
    const haystack = [
      target.characterName,
      target.serverName,
      target.fileName,
      target.uiSkin
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(query);
  });
}
function getUiManagerAvailableServerNames() {
  return Array.from(
    new Set(
      getUiManagerTargets()
        .map((target) => String(target.serverName || "").trim())
        .filter(Boolean)
    )
  ).sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base", numeric: true }));
}
function areAllUiManagerTargetsSelected() {
  const targets = getUiManagerTargets();
  return Boolean(targets.length) && targets.every((target) => state.uiManager.selectedTargetPaths.includes(target.path));
}
function toggleUiManagerTargetSelection(targetPath, forceSelected = null) {
  const alreadySelected = state.uiManager.selectedTargetPaths.includes(targetPath);
  const shouldSelect = forceSelected === null ? !alreadySelected : Boolean(forceSelected);

  if (shouldSelect && !alreadySelected) {
    state.uiManager.selectedTargetPaths.push(targetPath);
  }

  if (!shouldSelect && alreadySelected) {
    state.uiManager.selectedTargetPaths = state.uiManager.selectedTargetPaths.filter((entry) => entry !== targetPath);
  }
}
function openUiManagerModal() {
  elements.uiManagerModal.classList.remove("hidden");
  elements.uiManagerModal.setAttribute("aria-hidden", "false");
}
function closeUiManagerModal() {
  closeUiManagerPackageContextMenu();
  closeUiManagerRecoveryModal();
  elements.uiManagerModal.classList.add("hidden");
  elements.uiManagerModal.setAttribute("aria-hidden", "true");
}
function openUiManagerRecoveryModal() {
  elements.uiManagerRecoveryModal.classList.remove("hidden");
  elements.uiManagerRecoveryModal.setAttribute("aria-hidden", "false");
}
function closeUiManagerRecoveryModal() {
  elements.uiManagerRecoveryModal.classList.add("hidden");
  elements.uiManagerRecoveryModal.setAttribute("aria-hidden", "true");
}
function openUiManagerPackageContextMenu(packageName, x, y) {
  state.uiManager.packageContextMenuOpen = true;
  state.uiManager.packageContextPackageName = packageName || "";
  state.uiManager.packageContextMenuX = Number.isFinite(x) ? x : 0;
  state.uiManager.packageContextMenuY = Number.isFinite(y) ? y : 0;
}
function closeUiManagerPackageContextMenu() {
  state.uiManager.packageContextMenuOpen = false;
  state.uiManager.packageContextPackageName = "";
}
function openUiManagerConfirmModal(message, action) {
  state.uiManagerConfirmationAction = typeof action === "function" ? action : null;
  elements.uiManagerConfirmMessage.textContent = message;
  elements.uiManagerConfirmModal.classList.remove("hidden");
  elements.uiManagerConfirmModal.setAttribute("aria-hidden", "false");
}
function closeUiManagerConfirmModal() {
  state.uiManagerConfirmationAction = null;
  elements.uiManagerConfirmModal.classList.add("hidden");
  elements.uiManagerConfirmModal.setAttribute("aria-hidden", "true");
}
function clearUiManagerNoticeTimeout() {
  if (!uiManagerNoticeTimeoutId) {
    return;
  }

  clearTimeout(uiManagerNoticeTimeoutId);
  uiManagerNoticeTimeoutId = null;
}
function setUiManagerNotice(message, tone = "info", options = {}) {
  const { persistent = false } = options;
  state.uiManager.noticeText = String(message || "").trim();
  state.uiManager.noticeTone = tone;
  renderUiManagerNotice();

  clearUiManagerNoticeTimeout();
  if (!state.uiManager.noticeText || persistent) {
    return;
  }

  uiManagerNoticeTimeoutId = setTimeout(() => {
    state.uiManager.noticeText = "";
    renderUiManagerNotice();
    uiManagerNoticeTimeoutId = null;
  }, tone === "error" ? 5200 : 2600);
}
function renderUiManagerNotice() {
  if (!state.uiManager.noticeText) {
    elements.uiManagerNotice.classList.add("hidden");
    elements.uiManagerNotice.textContent = "";
    return;
  }

  elements.uiManagerNotice.classList.remove("hidden");
  elements.uiManagerNotice.dataset.tone = state.uiManager.noticeTone || "info";
  elements.uiManagerNotice.textContent = state.uiManager.noticeText;
}
function getUiManagerSelectedPackageSummary() {
  const packages = Array.isArray(state.uiManager.overview?.packages) ? state.uiManager.overview.packages : [];
  return packages.find((entry) => entry.name === state.uiManager.selectedPackageName) || null;
}
function getUiManagerPackageSummaryByName(packageName) {
  const packages = Array.isArray(state.uiManager.overview?.packages) ? state.uiManager.overview.packages : [];
  return packages.find((entry) => entry.name === packageName) || null;
}
function resetUiManagerPackageMetadataHealthState() {
  const packages = Array.isArray(state.uiManager.overview?.packages) ? state.uiManager.overview.packages : [];
  const nextHealth = {};

  for (const pkg of packages) {
    nextHealth[pkg.name] = {
      status: pkg.protected ? "read-only" : "pending",
      scannedCount: 0,
      invalidCount: 0
    };
  }

  state.uiManager.packageMetadataHealth = nextHealth;
  state.uiManager.packageMetadataHealthRunning = false;
  state.uiManager.packageMetadataHealthRunId += 1;
}
function getUiManagerPackageMetadataHealth(packageName) {
  return state.uiManager.packageMetadataHealth?.[packageName] || {
    status: "pending",
    scannedCount: 0,
    invalidCount: 0
  };
}
function getUiManagerPackageMetadataLabel(health) {
  const invalidCount = Number(health?.invalidCount || 0);
  const scannedCount = Number(health?.scannedCount || 0);
  switch (health?.status) {
    case "read-only":
      return "Read only";
    case "unavailable":
      return "Prepare first";
    case "checking":
      return "Checking...";
    case "healthy":
      return scannedCount ? `${scannedCount} checked` : "Healthy";
    case "issues":
      return invalidCount ? `${invalidCount} issue${invalidCount === 1 ? "" : "s"}` : "Needs review";
    case "error":
      return "Check failed";
    default:
      return "Pending";
  }
}
function getUiManagerPackageMetadataTooltip(health) {
  switch (health?.status) {
    case "read-only":
      return "UI Meta Data health check is not required for the protected read-only default package.";
    case "checking":
      return "Checking UI Meta Data health for this package.";
    case "healthy":
      return "UI Meta Data health check passed for this package.";
    case "issues":
      return "UI Meta Data health check found issues in this package.";
    case "error":
      return "UI Meta Data health check could not be completed for this package.";
    case "prepare-first":
      return "Prepare this package before running a UI Meta Data health check.";
    default:
      return "UI Meta Data health status for this package.";
  }
}
function getUiManagerSelectedBundle() {
  const bundles = Array.isArray(state.uiManager.detail?.bundles) ? state.uiManager.detail.bundles : [];
  return bundles.find((entry) => entry.optionPath === state.uiManager.selectedOptionPath) || null;
}
function getUiManagerSelectedBundles() {
  const bundles = Array.isArray(state.uiManager.detail?.bundles) ? state.uiManager.detail.bundles : [];
  const selectedPaths = new Set(state.uiManager.selectedOptionPaths || []);
  return bundles.filter((entry) => selectedPaths.has(entry.optionPath));
}
function getUiManagerActiveBundles() {
  const bundles = Array.isArray(state.uiManager.detail?.bundles) ? state.uiManager.detail.bundles : [];
  return bundles.filter((entry) => entry.activeState === "active");
}
function createUiManagerBundleGroupMap(bundles) {
  const index = new Map();
  for (const bundle of bundles || []) {
    index.set(getUiManagerBundleGroupKey(bundle), bundle);
  }
  return index;
}
function getUiManagerBundleGroupKey(bundle) {
  const xmlFiles = Array.isArray(bundle?.xmlFiles) ? bundle.xmlFiles : [];
  return xmlFiles
    .map((entry) => String(entry || "").trim().toLowerCase())
    .filter(Boolean)
    .sort()
    .join("|");
}
function formatUiManagerBundleElementLabel(fileName) {
  return String(fileName || "")
    .replace(/\.xml$/i, "")
    .replace(/^EQUI_/i, "")
    .replace(/_/g, " ")
    .trim();
}
function formatUiManagerHumanLabel(value) {
  return String(value || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function formatUiManagerPrettyPath(value) {
  return String(value || "")
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .filter(Boolean)
    .map((segment) => formatUiManagerHumanLabel(segment))
    .join(" / ");
}
function formatUiManagerBundleVariantLabel(bundle) {
  const title = formatUiManagerHumanLabel(bundle?.label || bundle?.optionPath || "");
  const section = formatUiManagerPrettyPath(bundle?.categoryPath || "");
  if (!title) {
    return "";
  }
  if (!section) {
    return title;
  }

  const normalizedTitle = title.toLowerCase();
  const normalizedSection = section.toLowerCase();
  if (normalizedTitle === normalizedSection) {
    return bundle?.isDefault ? "Default" : title;
  }
  if (normalizedTitle.startsWith(normalizedSection)) {
    const trimmed = title.slice(section.length).replace(/^[\s:/-]+/, "").trim();
    return trimmed || (bundle?.isDefault ? "Default" : title);
  }
  return title;
}
function getUiManagerBundleGroupLabel(bundle) {
  const xmlFiles = Array.isArray(bundle?.xmlFiles) ? [...bundle.xmlFiles].sort() : [];
  if (!xmlFiles.length) {
    return "Standalone";
  }

  const primaryLabel = formatUiManagerBundleElementLabel(xmlFiles[0]);
  return xmlFiles.length === 1 ? primaryLabel : `${primaryLabel} +${xmlFiles.length - 1}`;
}
function getUiManagerBundleGroups() {
  const bundles = Array.isArray(state.uiManager.detail?.bundles) ? state.uiManager.detail.bundles : [];
  const groups = new Map();
  for (const bundle of bundles) {
    const key = getUiManagerBundleGroupKey(bundle);
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(bundle);
  }
  return groups;
}
function setUiManagerSelectedOptionPaths(optionPaths) {
  const bundles = Array.isArray(state.uiManager.detail?.bundles) ? state.uiManager.detail.bundles : [];
  const validPaths = new Set(bundles.map((entry) => entry.optionPath));
  const nextPaths = [];
  for (const optionPath of optionPaths || []) {
    if (!validPaths.has(optionPath) || nextPaths.includes(optionPath)) {
      continue;
    }
    nextPaths.push(optionPath);
  }
  state.uiManager.selectedOptionPaths = nextPaths;
}
function updateUiManagerStagedOptionPath(optionPath, shouldStage) {
  const bundles = Array.isArray(state.uiManager.detail?.bundles) ? state.uiManager.detail.bundles : [];
  const bundle = bundles.find((entry) => entry.optionPath === optionPath);
  if (!bundle) {
    return;
  }

  const nextPaths = new Set(state.uiManager.selectedOptionPaths || []);
  if (!shouldStage) {
    nextPaths.delete(bundle.optionPath);
    setUiManagerSelectedOptionPaths(Array.from(nextPaths));
    return;
  }

  const groupKey = getUiManagerBundleGroupKey(bundle);
  for (const entry of bundles) {
    if (entry.optionPath === bundle.optionPath) {
      continue;
    }
    if (getUiManagerBundleGroupKey(entry) === groupKey) {
      nextPaths.delete(entry.optionPath);
    }
  }
  nextPaths.add(bundle.optionPath);
  setUiManagerSelectedOptionPaths(Array.from(nextPaths));
}
function syncUiManagerStagedComponentsForSkinSwitch() {
  const selectedPackage = getUiManagerSelectedPackageSummary();
  const reviewTargets = getUiManagerReviewTargets();
  if (!selectedPackage || !reviewTargets.length || !state.uiManager.detail || state.uiManager.detail.name !== selectedPackage.name) {
    return;
  }

  const hasPendingSkinSwitch = reviewTargets.some(
    (target) => String(target.uiSkin || "Default").toLowerCase() !== String(selectedPackage.name || "").toLowerCase()
  );
  if (!hasPendingSkinSwitch) {
    return;
  }

  const activePaths = getUiManagerActiveBundles().map((bundle) => bundle.optionPath).sort();
  const selectedPaths = [...(state.uiManager.selectedOptionPaths || [])].sort();
  if (activePaths.length === selectedPaths.length && activePaths.every((entry, index) => entry === selectedPaths[index])) {
    return;
  }

  setUiManagerSelectedOptionPaths(activePaths);
}
function buildUiManagerConfirmationDiff() {
  const selectedPackage = getUiManagerSelectedPackageSummary();
  const reviewTargets = getUiManagerReviewTargets();
  const selectedBundles = getUiManagerSelectedBundles();
  const activeBundles = getUiManagerActiveBundles();
  const selectedBundleMap = createUiManagerBundleGroupMap(selectedBundles);
  const activeBundleMap = createUiManagerBundleGroupMap(activeBundles);
  const componentKeys = new Set([...activeBundleMap.keys(), ...selectedBundleMap.keys()]);

  const skinChanges = reviewTargets
    .filter((target) => selectedPackage && String(target.uiSkin || "Default").toLowerCase() !== String(selectedPackage.name || "").toLowerCase())
    .map((target) => ({
      label: `${target.characterName} • ${target.serverName}`,
      fileName: target.fileName,
      from: target.uiSkin || "Default",
      to: selectedPackage.name
    }));

  const componentChanges = Array.from(componentKeys)
    .map((key) => {
      const fromBundle = activeBundleMap.get(key) || null;
      const toBundle = selectedBundleMap.get(key) || null;
      if ((fromBundle?.optionPath || "") === (toBundle?.optionPath || "")) {
        return null;
      }

      const referenceBundle = toBundle || fromBundle;
      return {
        groupLabel: getUiManagerBundleGroupLabel(referenceBundle),
        xmlFiles: Array.isArray(referenceBundle?.xmlFiles) ? referenceBundle.xmlFiles : [],
        from: fromBundle?.label || fromBundle?.optionPath || "Inactive",
        to: toBundle?.label || toBundle?.optionPath || "Inactive",
        fromPath: fromBundle?.optionPath || "",
        toPath: toBundle?.optionPath || ""
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.groupLabel.localeCompare(right.groupLabel));

  return {
    selectedPackage,
    reviewTargets,
    selectedBundles,
    skinChanges,
    componentChanges,
    plannedActions: [
      skinChanges.length ? "Set UISkin" : "",
      componentChanges.length && !selectedPackage?.protected ? "Apply Components" : "",
      !selectedPackage?.prepared && !selectedPackage?.protected ? "Prepare Package First" : ""
    ].filter(Boolean)
  };
}
function syncUiManagerSelection() {
  setUiManagerActiveStage(state.uiManager.activeStage);
  const packages = Array.isArray(state.uiManager.overview?.packages) ? state.uiManager.overview.packages : [];
  if (!packages.length) {
    state.uiManager.selectedPackageName = "";
    state.uiManager.selectedOptionPath = "";
    state.uiManager.selectedOptionPaths = [];
    state.uiManager.selectedTargetPaths = [];
    state.uiManager.targetSearchQuery = "";
    state.uiManager.targetServerFilter = "";
    state.uiManager.targetPickerOpen = false;
    state.uiManager.detail = null;
    return;
  }

  if (!packages.some((entry) => entry.name === state.uiManager.selectedPackageName)) {
    const preferredPackage = packages.find((entry) => !entry.protected) || packages[0];
    state.uiManager.selectedPackageName = preferredPackage?.name || "";
    state.uiManager.selectedOptionPath = "";
    state.uiManager.selectedOptionPaths = [];
  }

  const targets = getUiManagerTargets();
  if (!state.uiManager.selectedTargetPaths.length && state.uiManager.selectedPackageName) {
    state.uiManager.selectedTargetPaths = targets
      .filter((entry) => String(entry.uiSkin || "").toLowerCase() === state.uiManager.selectedPackageName.toLowerCase())
      .map((entry) => entry.path);
  }

  state.uiManager.selectedTargetPaths = state.uiManager.selectedTargetPaths.filter((entry) => targets.some((target) => target.path === entry));
  syncUiManagerStagedComponentsForSkinSwitch();

  if (!canUiManagerOpenStage(state.uiManager.activeStage)) {
    setUiManagerActiveStage(state.uiManager.selectedPackageName ? "packages" : "targets");
  }
}
async function ensureUiManagerPackageMetadataChecks() {
  if (state.uiManager.activeStage !== "packages" || elements.uiManagerModal.classList.contains("hidden")) {
    return;
  }

  const packages = Array.isArray(state.uiManager.overview?.packages) ? state.uiManager.overview.packages : [];
  if (!packages.length || state.uiManager.overviewLoading || state.uiManager.actionLoading || state.uiManager.packageMetadataHealthRunning) {
    return;
  }

  const candidates = packages.filter((pkg) => !pkg.protected && getUiManagerPackageMetadataHealth(pkg.name).status === "pending");
  if (!candidates.length) {
    return;
  }

  const runId = state.uiManager.packageMetadataHealthRunId + 1;
  state.uiManager.packageMetadataHealthRunId = runId;
  state.uiManager.packageMetadataHealthRunning = true;
  renderUiManagerPackageList();

  for (const pkg of candidates) {
    if (state.uiManager.packageMetadataHealthRunId !== runId) {
      return;
    }

    state.uiManager.packageMetadataHealth[pkg.name] = {
      status: "checking",
      scannedCount: 0,
      invalidCount: 0
    };
    renderUiManagerPackageList();

    try {
      const result = await window.launcher.checkUiPackageMetadata(pkg.name);
      if (state.uiManager.packageMetadataHealthRunId !== runId) {
        return;
      }

      state.uiManager.packageMetadataHealth[pkg.name] = {
        status: result?.status || (result?.healthy ? "healthy" : "issues"),
        scannedCount: Number(result?.scannedCount || 0),
        invalidCount: Number(result?.invalidCount || 0)
      };
    } catch (_error) {
      if (state.uiManager.packageMetadataHealthRunId !== runId) {
        return;
      }

      state.uiManager.packageMetadataHealth[pkg.name] = {
        status: "error",
        scannedCount: 0,
        invalidCount: 0
      };
    }

    renderUiManagerPackageList();
  }

  if (state.uiManager.packageMetadataHealthRunId === runId) {
    state.uiManager.packageMetadataHealthRunning = false;
    renderUiManagerPackageList();
  }
}
async function selectUiManagerPackage(packageName, options = {}) {
  const {
    openContextMenu = false,
    contextX = 0,
    contextY = 0,
    preserveNotice = false
  } = options;
  if (!packageName) {
    return;
  }

  const currentPackageName = state.uiManager.selectedPackageName;
  const pendingComponentChanges = Array.isArray(buildUiManagerConfirmationDiff().componentChanges)
    ? buildUiManagerConfirmationDiff().componentChanges
    : [];

  const applyPackageSelection = async () => {
    state.uiManager.selectedPackageName = packageName;
    state.uiManager.selectedOptionPath = "";
    state.uiManager.selectedOptionPaths = [];
    state.uiManager.packageDetailTab = "overview";
    state.uiManager.targetPickerOpen = false;
    setUiManagerActiveStage("packages");

    if (openContextMenu) {
      openUiManagerPackageContextMenu(packageName, contextX, contextY);
    }

    renderUiManager();
    if (!state.uiManager.detail || state.uiManager.detail.name !== packageName) {
      await loadUiManagerPackageDetails(packageName, { preserveNotice });
    }
  };

  if (currentPackageName && currentPackageName !== packageName && pendingComponentChanges.length) {
    await promptUiManagerAction(
      `Switch to ${packageName}? Pending component changes for ${currentPackageName} will be lost if you change UI packages.`,
      applyPackageSelection
    );
    return;
  }

  await applyPackageSelection();
}
function renderUiManagerLaunchSurface() {
  const packages = Array.isArray(state.uiManager.overview?.packages) ? state.uiManager.overview.packages : [];
  const targets = Array.isArray(state.uiManager.overview?.targets) ? state.uiManager.overview.targets : [];
  const preparedCount = packages.filter((entry) => entry.prepared).length;
  const selectedPackage = getUiManagerSelectedPackageSummary();

  elements.uiManagerPackageCount.textContent = String(packages.length);
  elements.uiManagerPreparedCount.textContent = String(preparedCount);
  elements.uiManagerTargetCount.textContent = String(targets.length);

  if (!state.current?.gameDirectory) {
    elements.uiManagerPreviewName.textContent = "No game directory selected.";
    elements.uiManagerPreviewMeta.textContent = "Run the launcher from your EQ folder so the UI Manager can inspect uifiles and character UI settings.";
    elements.uiManagerStatusBadge.textContent = "Unavailable";
    elements.uiManagerStatusBadge.dataset.tone = "warning";
    return;
  }

  if (state.uiManager.overviewLoading) {
    elements.uiManagerPreviewName.textContent = "Scanning UI packages...";
    elements.uiManagerPreviewMeta.textContent = "Loading UI package folders and character UI settings from the current EverQuest directory.";
    elements.uiManagerStatusBadge.textContent = "Loading";
    elements.uiManagerStatusBadge.dataset.tone = "active";
    return;
  }

  if (!selectedPackage) {
    elements.uiManagerPreviewName.textContent = packages.length ? "Select a package to manage." : "No UI packages detected.";
    elements.uiManagerPreviewMeta.textContent = packages.length
      ? "Open the manager workspace to prepare packages, preview options, and assign UISkin values."
      : "Import a custom UI package folder into uifiles to begin.";
    elements.uiManagerStatusBadge.textContent = packages.length ? "Ready" : "Standby";
    elements.uiManagerStatusBadge.dataset.tone = packages.length ? "success" : "attention";
    return;
  }

  elements.uiManagerPreviewName.textContent = selectedPackage.name;
  elements.uiManagerPreviewMeta.textContent = selectedPackage.protected
    ? "Protected default package. UISkin assignment is available, but content changes are disabled."
    : selectedPackage.prepared
      ? `${selectedPackage.optionCount} option bundles detected. ${state.uiManager.selectedTargetPaths.length} character target(s) selected.`
      : "This package needs preparation before option switching and reset workflows are available.";
  elements.uiManagerStatusBadge.textContent = selectedPackage.protected ? "Read Only" : selectedPackage.prepared ? "Prepared" : "Needs Prep";
  elements.uiManagerStatusBadge.dataset.tone = selectedPackage.protected ? "warning" : selectedPackage.prepared ? "success" : "warning";
}
function renderUiManagerPackageList() {
  clearElementContent(elements.uiManagerPackageList);
  const packages = Array.isArray(state.uiManager.overview?.packages) ? state.uiManager.overview.packages : [];
  elements.uiManagerSidebarMeta.textContent = `${packages.length} loaded`;

  if (!packages.length) {
    elements.uiManagerPackageList.appendChild(
      createUiManagerEmptyState("No packages found", "The manager could not find any UI packages in your uifiles directory.")
    );
    return;
  }

  for (const pkg of packages) {
    const button = document.createElement("button");
    button.className = "ui-manager-package-card";
    button.type = "button";
    button.dataset.packageName = pkg.name;
    button.classList.toggle("is-selected", pkg.name === state.uiManager.selectedPackageName);

    const title = document.createElement("p");
    title.className = "ui-manager-package-title";
    title.textContent = pkg.name;
    button.appendChild(title);

    const health = getUiManagerPackageMetadataHealth(pkg.name);
    const healthRow = document.createElement("div");
    healthRow.className = "ui-manager-package-health";

    const healthCopy = document.createElement("div");
    healthCopy.className = "ui-manager-package-health-copy";

    const healthMeta = document.createElement("span");
    healthMeta.className = "ui-manager-package-health-meta";
    healthMeta.textContent = getUiManagerPackageMetadataLabel(health);
    healthCopy.appendChild(healthMeta);

    const healthCheck = document.createElement("span");
    healthCheck.className = `ui-manager-package-health-check is-${health.status || "pending"}`;
    healthCheck.setAttribute("aria-hidden", "true");
    healthCheck.setAttribute("title", getUiManagerPackageMetadataTooltip(health));
    healthCheck.setAttribute("aria-label", getUiManagerPackageMetadataTooltip(health));
    healthCheck.textContent = health.status === "healthy" || health.status === "read-only"
      ? "✓"
      : health.status === "checking"
        ? "…"
        : health.status === "issues" || health.status === "error"
          ? "!"
          : "";

    healthRow.appendChild(healthCopy);
    healthRow.appendChild(healthCheck);
    button.appendChild(healthRow);

    const copy = document.createElement("p");
    copy.className = "ui-manager-package-subcopy";
    copy.textContent = `${pkg.rootXmlCount} primary and ${pkg.optionCount} optional UI elements`;
    button.appendChild(copy);

    const pills = document.createElement("div");
    pills.className = "ui-manager-pill-row";
    pills.appendChild(createUiManagerPill(pkg.protected ? "Protected" : "Custom", pkg.protected ? "warning" : ""));
    pills.appendChild(
      createUiManagerPill(
        pkg.protected ? "Read Only" : pkg.prepared ? "Prepared" : "Needs Prep",
        pkg.protected ? "warning" : pkg.prepared ? "success" : "warning"
      )
    );
    button.appendChild(pills);
    elements.uiManagerPackageList.appendChild(button);
  }
}
function renderUiManagerPackageDetail() {
  clearElementContent(elements.uiManagerPackageDetail);
  const pkg = getUiManagerSelectedPackageSummary();
  const detail = state.uiManager.detail;
  elements.uiManagerPackageMeta.textContent = pkg ? pkg.name : "No selection";

  if (!pkg) {
    elements.uiManagerPackageDetail.appendChild(
      createUiManagerEmptyState("Choose a package", "Select a package from the library to inspect its structure and option bundles.")
    );
    return;
  }

  const workspace = document.createElement("div");
  workspace.className = "ui-manager-package-workspace";

  const panel = document.createElement("div");
  panel.className = "ui-manager-package-overview-panel";

  const heroCopy = document.createElement("div");
  heroCopy.className = "ui-manager-package-hero-copy";

  const heroPills = document.createElement("div");
  heroPills.className = "ui-manager-pill-row";
  heroPills.appendChild(createUiManagerPill(pkg.protected ? "Protected Default" : "Custom Package", pkg.protected ? "warning" : ""));
  heroPills.appendChild(
    createUiManagerPill(
      pkg.protected ? "Read Only" : pkg.prepared ? "Prepared" : "Needs Preparation",
      pkg.protected ? "warning" : pkg.prepared ? "success" : "warning"
    )
  );
  heroCopy.appendChild(heroPills);

  const heading = document.createElement("h4");
  heading.className = "ui-manager-package-heading";
  heading.textContent = pkg.name;
  heroCopy.appendChild(heading);

  if (pkg.path) {
    const pathLine = document.createElement("p");
    pathLine.className = "ui-manager-path-line";
    pathLine.textContent = pkg.path;
    heroCopy.appendChild(pathLine);
  }

  const summaryCopy = document.createElement("p");
  summaryCopy.className = "ui-manager-package-subcopy";
  summaryCopy.textContent = pkg.protected
    ? "The stock default package is visible for UISkin assignment and inspection, but its files remain read-only."
    : pkg.prepared
      ? "This package is ready for Stage 3 component selection and Stage 4 confirmation."
      : "Prepare this package before moving on to component selection and reset workflows.";
  heroCopy.appendChild(summaryCopy);

  const grid = document.createElement("div");
  grid.className = "ui-manager-detail-grid";

  const preparedItem = document.createElement("div");
  preparedItem.className = "ui-manager-detail-item";
  preparedItem.innerHTML = `<span class="summary-label">Status</span><strong>${pkg.protected ? "Read Only" : pkg.prepared ? "Prepared" : "Needs Prep"}</strong>`;
  grid.appendChild(preparedItem);

  const elementItem = document.createElement("div");
  elementItem.className = "ui-manager-detail-item";
  elementItem.innerHTML = `<span class="summary-label">UI Elements</span><strong>${detail?.rootFiles?.length || 0} primary • ${pkg.optionCount} optional</strong>`;
  grid.appendChild(elementItem);

  const protectionItem = document.createElement("div");
  protectionItem.className = "ui-manager-detail-item";
  protectionItem.innerHTML = `<span class="summary-label">Package Type</span><strong>${pkg.protected ? "Protected Default" : "Custom Package"}</strong>`;
  grid.appendChild(protectionItem);

  const readyCard = document.createElement("div");
  readyCard.className = "ui-manager-package-brief";
  readyCard.innerHTML = `<span class="summary-label">Ready State</span><strong>${pkg.protected ? "Protected package. You can assign UISkin, but content changes remain disabled." : pkg.prepared ? "Ready for UI Components and confirmation." : "Needs preparation before component switching is available."}</strong>`;
  if (!pkg.protected && !pkg.prepared) {
    const prepareCopy = document.createElement("p");
    prepareCopy.className = "ui-manager-package-subcopy";
    prepareCopy.textContent = "Prepare this package here to standardize its structure before moving on to Stage 3.";
    readyCard.appendChild(prepareCopy);

    const prepareButton = document.createElement("button");
    prepareButton.className = "secondary-button utility-button ui-manager-package-prepare-button";
    prepareButton.type = "button";
    prepareButton.dataset.uiManagerPackageAction = "prepare";
    prepareButton.textContent = "Prepare Package";
    readyCard.appendChild(prepareButton);
  }

  const hero = document.createElement("div");
  hero.className = "ui-manager-package-hero";
  hero.appendChild(heroCopy);
  hero.appendChild(grid);

  panel.appendChild(hero);
  panel.appendChild(readyCard);

  workspace.appendChild(panel);
  elements.uiManagerPackageDetail.appendChild(workspace);
}
function renderUiManagerPackageContextMenu() {
  const isOpen = Boolean(state.uiManager.packageContextMenuOpen && state.uiManager.packageContextPackageName);
  elements.uiManagerPackageContextMenu.classList.toggle("hidden", !isOpen);
  if (!isOpen) {
    return;
  }

  const packageSummary = getUiManagerPackageSummaryByName(state.uiManager.packageContextPackageName);
  const canValidate = Boolean(packageSummary && packageSummary.prepared && !packageSummary.protected && !state.uiManager.actionLoading);
  elements.uiManagerPackageValidateAction.disabled = !canValidate;
  elements.uiManagerPackageValidateAction.dataset.packageName = state.uiManager.packageContextPackageName;
  elements.uiManagerPackageContextMenu.style.left = `${state.uiManager.packageContextMenuX}px`;
  elements.uiManagerPackageContextMenu.style.top = `${state.uiManager.packageContextMenuY}px`;
}
function renderUiManagerStageState() {
  const activeStage = state.uiManager.activeStage || "targets";
  const stageMap = [
    { name: "targets", button: elements.uiManagerStageTargetsButton, panel: elements.uiManagerTargetsStage, label: "Select Character(s)" },
    { name: "packages", button: elements.uiManagerStagePackagesButton, panel: elements.uiManagerPackagesStage, label: "Select UI Package" },
    { name: "components", button: elements.uiManagerStageComponentsButton, panel: elements.uiManagerComponentsStage, label: "UI Components" },
    { name: "confirm", button: elements.uiManagerStageConfirmButton, panel: elements.uiManagerConfirmStage, label: "Confirmation" }
  ];

  for (const entry of stageMap) {
    const isActive = entry.name === activeStage;
    const canOpen = canUiManagerOpenStage(entry.name);
    entry.button.classList.toggle("is-active", isActive);
    entry.button.classList.toggle("is-disabled", !canOpen && !isActive);
    entry.button.setAttribute("aria-selected", isActive ? "true" : "false");
    entry.button.setAttribute("aria-disabled", !canOpen && !isActive ? "true" : "false");
    entry.panel.classList.toggle("hidden", !isActive);
  }

  const activeIndex = getUiManagerStageIndex(activeStage);
  elements.uiManagerPreviousStageButton.disabled = activeIndex === 0;
  const nextStage = getUiManagerAdjacentStage(1);
  elements.uiManagerNextStageButton.disabled = !nextStage || !canUiManagerOpenStage(nextStage);
}
function renderUiManagerConfirmationSummary() {
  clearElementContent(elements.uiManagerConfirmationSummary);
  const diff = buildUiManagerConfirmationDiff();
  const { selectedPackage, selectedBundles, reviewTargets, skinChanges, componentChanges, plannedActions } = diff;

  if (!selectedPackage) {
    elements.uiManagerConfirmationSummary.appendChild(
      createUiManagerEmptyState("Nothing to review yet", "Select characters, a UI package, and components to build a change review.")
    );
    return;
  }

  const overview = document.createElement("div");
  overview.className = "ui-manager-confirm-overview";

  const overviewHeader = document.createElement("div");
  overviewHeader.className = "ui-manager-confirm-overview-header";
  overviewHeader.innerHTML = `<span class="summary-label">Change Review</span><strong>${plannedActions.length ? plannedActions.join(" + ") : "No pending changes"}</strong>`;
  overview.appendChild(overviewHeader);

  const overviewPills = document.createElement("div");
  overviewPills.className = "ui-manager-pill-row ui-manager-confirm-hero-pills";
  overviewPills.appendChild(createUiManagerPill(selectedPackage.name, "success"));
  overviewPills.appendChild(createUiManagerPill(`${reviewTargets.length} target(s)`));
  overviewPills.appendChild(createUiManagerPill(`${skinChanges.length} UISkin diff(s)`, skinChanges.length ? "success" : ""));
  overviewPills.appendChild(createUiManagerPill(`${componentChanges.length} component diff(s)`, componentChanges.length ? "success" : ""));
  if (selectedBundles.length) {
    overviewPills.appendChild(createUiManagerPill(`${selectedBundles.length} flagged bundle(s)`));
  }
  overview.appendChild(overviewPills);

  const overviewCopy = document.createElement("p");
  overviewCopy.className = "ui-manager-package-subcopy";
  overviewCopy.textContent = plannedActions.length
    ? `Review the before/after diff for ${selectedPackage.name} before applying the queued changes.`
    : `No differences are queued for ${selectedPackage.name}. Adjust earlier stages if you expect to see pending changes here.`;
  overview.appendChild(overviewCopy);
  elements.uiManagerConfirmationSummary.appendChild(overview);

  const buildDiffSection = (label, status, emptyCopy) => {
    const section = document.createElement("section");
    section.className = "ui-manager-confirm-diff-section";
    const header = document.createElement("div");
    header.className = "ui-manager-confirm-diff-section-header";
    header.innerHTML = `<span class="summary-label">${label}</span><strong>${status}</strong>`;
    section.appendChild(header);
    if (emptyCopy) {
      const copy = document.createElement("p");
      copy.className = "ui-manager-package-subcopy";
      copy.textContent = emptyCopy;
      section.appendChild(copy);
    }
    return section;
  };

  const targetSection = buildDiffSection(
    "UISkin Diff",
    skinChanges.length ? `${skinChanges.length} pending` : "No changes detected",
    !reviewTargets.length
      ? "Select one or more characters in Stage 1 to review target-specific UISkin changes."
      : !skinChanges.length
        ? `All reviewed targets already use UISkin=${selectedPackage.name}.`
        : ""
  );

  if (skinChanges.length) {
    const list = document.createElement("div");
    list.className = "ui-manager-confirm-diff-stack";
    for (const change of skinChanges) {
      const file = document.createElement("article");
      file.className = "ui-manager-confirm-file";
      file.innerHTML = `
        <div class="ui-manager-confirm-file-header">
          <strong>${change.label}</strong>
          <span>${change.fileName}</span>
        </div>
      `;
      const body = document.createElement("div");
      body.className = "ui-manager-confirm-file-body";
      body.appendChild(createUiManagerDiffLine("remove", `UISkin=${change.from}`));
      body.appendChild(createUiManagerDiffLine("add", `UISkin=${change.to}`));
      file.appendChild(body);
      list.appendChild(file);
    }
    targetSection.appendChild(list);
  }
  elements.uiManagerConfirmationSummary.appendChild(targetSection);

  const componentSection = buildDiffSection(
    "Component Diff",
    selectedPackage.protected ? "Read-only package" : componentChanges.length ? `${componentChanges.length} pending` : "No changes detected",
    selectedPackage.protected
      ? "Component file changes are unavailable for the protected default package. Use this stage to review UISkin assignments only."
      : !componentChanges.length
        ? "No component variants differ from the package’s current active state."
        : ""
  );

  if (!selectedPackage.protected && componentChanges.length) {
    const list = document.createElement("div");
    list.className = "ui-manager-confirm-diff-stack";
    for (const change of componentChanges) {
      const file = document.createElement("article");
      file.className = "ui-manager-confirm-file";

      const header = document.createElement("div");
      header.className = "ui-manager-confirm-file-header";
      header.innerHTML = `<strong>${change.groupLabel}</strong><span>${change.fromPath || change.toPath || "Component variant"}</span>`;
      file.appendChild(header);

      const body = document.createElement("div");
      body.className = "ui-manager-confirm-file-body";
      body.appendChild(createUiManagerDiffLine("context", `XML: ${(change.xmlFiles || []).join(", ") || "No mapped XML files"}`));
      body.appendChild(createUiManagerDiffLine("remove", `variant=${change.from}`));
      body.appendChild(createUiManagerDiffLine("remove", `source=${change.fromPath || "Inactive"}`));
      body.appendChild(createUiManagerDiffLine("add", `variant=${change.to}`));
      body.appendChild(createUiManagerDiffLine("add", `source=${change.toPath || "Inactive"}`));
      file.appendChild(body);
      list.appendChild(file);
    }
    componentSection.appendChild(list);
  }
  elements.uiManagerConfirmationSummary.appendChild(componentSection);

  const footerNote = document.createElement("div");
  footerNote.className = "ui-manager-preview-callout";
  footerNote.textContent = plannedActions.length
    ? "Use the footer actions to apply the reviewed changes, or return to earlier stages to adjust the diff."
    : "No changes are currently queued. Adjust your selections in the earlier stages if you want this review to show pending work.";
  elements.uiManagerConfirmationSummary.appendChild(footerNote);
}
function createUiManagerDiffLine(type, text) {
  const line = document.createElement("div");
  line.className = `ui-manager-confirm-line is-${type}`;

  const marker = document.createElement("span");
  marker.className = "ui-manager-confirm-line-marker";
  marker.textContent = type === "add" ? "+" : type === "remove" ? "-" : " ";
  line.appendChild(marker);

  const code = document.createElement("code");
  code.className = "ui-manager-confirm-line-code";
  code.textContent = text;
  line.appendChild(code);
  return line;
}
function renderUiManagerTargetList() {
  clearElementContent(elements.uiManagerTargetList);
  const targets = getUiManagerTargets();
  const filteredTargets = getUiManagerFilteredTargets();
  const serverNames = getUiManagerAvailableServerNames();
  const selectedCount = state.uiManager.selectedTargetPaths.length;
  elements.uiManagerTargetMeta.textContent = areAllUiManagerTargetsSelected()
    ? "All selected"
    : `${selectedCount} selected`;
  elements.uiManagerTargetSearchInput.value = state.uiManager.targetSearchQuery || "";
  clearElementContent(elements.uiManagerTargetServerFilter);
  const allServersOption = document.createElement("option");
  allServersOption.value = "";
  allServersOption.textContent = "All Servers";
  elements.uiManagerTargetServerFilter.appendChild(allServersOption);
  for (const serverName of serverNames) {
    const option = document.createElement("option");
    option.value = serverName;
    option.textContent = serverName;
    elements.uiManagerTargetServerFilter.appendChild(option);
  }
  if (state.uiManager.targetServerFilter && !serverNames.includes(state.uiManager.targetServerFilter)) {
    state.uiManager.targetServerFilter = "";
  }
  elements.uiManagerTargetServerFilter.value = state.uiManager.targetServerFilter || "";

  if (!targets.length) {
    elements.uiManagerTargetList.appendChild(
      createUiManagerEmptyState("No targets detected", "Character-specific UI settings files were not found in the current EQ directory.")
    );
    return;
  }

  if (!filteredTargets.length) {
    elements.uiManagerTargetList.appendChild(
      createUiManagerEmptyState("No matches", "No character UI settings matched the current server filter and search.")
    );
    return;
  }

  for (const target of filteredTargets) {
    const wrapper = document.createElement("label");
    wrapper.className = "ui-manager-target-card";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = target.path;
    input.checked = state.uiManager.selectedTargetPaths.includes(target.path);
    wrapper.classList.toggle("is-selected", input.checked);
    wrapper.appendChild(input);

    const copyWrap = document.createElement("div");
    const title = document.createElement("p");
    title.className = "ui-manager-target-name";
    title.textContent = `${target.characterName} • ${target.serverName}`;
    copyWrap.appendChild(title);

    const meta = document.createElement("div");
    meta.className = "ui-manager-target-meta";
    meta.appendChild(createUiManagerPill(target.uiSkin || "Default", state.uiManager.selectedPackageName && String(target.uiSkin || "").toLowerCase() === state.uiManager.selectedPackageName.toLowerCase() ? "success" : ""));
    meta.appendChild(createUiManagerPill(target.fileName));
    copyWrap.appendChild(meta);
    wrapper.appendChild(copyWrap);
    elements.uiManagerTargetList.appendChild(wrapper);
  }
}
function renderUiManagerOptionList() {
  clearElementContent(elements.uiManagerOptionList);
  const bundles = Array.isArray(state.uiManager.detail?.bundles) ? state.uiManager.detail.bundles : [];
  const selectedPaths = new Set(state.uiManager.selectedOptionPaths || []);
  const bundleGroups = getUiManagerBundleGroups();
  const activeCount = bundles.filter((bundle) => bundle.activeState === "active").length;
  elements.uiManagerOptionMeta.textContent = bundles.length ? `${bundles.length} bundles • ${activeCount} active • ${selectedPaths.size} flagged` : "No options";

  if (!bundles.length) {
    elements.uiManagerOptionList.appendChild(
      createUiManagerEmptyState(
        getUiManagerSelectedPackageSummary()?.prepared ? "No option bundles found" : "Package preparation required",
        getUiManagerSelectedPackageSummary()?.prepared
          ? "This package is prepared, but no selectable option bundles were discovered under Options."
          : "Prepare the package to standardize its structure and populate the option library."
      )
    );
    return;
  }

  for (const bundle of bundles) {
    const groupKey = getUiManagerBundleGroupKey(bundle);
    const relatedBundles = bundleGroups.get(groupKey) || [bundle];
    const groupLabel = getUiManagerBundleGroupLabel(bundle);
    const sectionLabel = formatUiManagerPrettyPath(bundle.categoryPath || "");
    const variantLabel = formatUiManagerBundleVariantLabel(bundle);
    const card = document.createElement("article");
    card.className = "ui-manager-option-card";
    card.dataset.optionPath = bundle.optionPath;
    card.dataset.optionGroupKey = groupKey;
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-label", `Preview ${bundle.label || bundle.optionPath}`);
    card.classList.toggle("is-selected", bundle.optionPath === state.uiManager.selectedOptionPath);
    card.classList.toggle("is-staged", selectedPaths.has(bundle.optionPath));
    card.classList.toggle("is-active-bundle", bundle.activeState === "active");
    card.classList.toggle("is-mixed-bundle", bundle.activeState === "mixed");

    const head = document.createElement("div");
    head.className = "ui-manager-option-head";

    const mark = document.createElement("div");
    mark.className = "ui-manager-option-mark";
    mark.textContent = bundle.isDefault ? "DF" : "UI";
    head.appendChild(mark);

    const headingBlock = document.createElement("div");
    headingBlock.className = "ui-manager-option-heading";

    const title = document.createElement("p");
    title.className = "ui-manager-option-title";
    title.textContent = variantLabel || formatUiManagerHumanLabel(bundle.label || bundle.optionPath);
    headingBlock.appendChild(title);

    if (sectionLabel) {
      const section = document.createElement("p");
      section.className = "ui-manager-option-copy is-section";
      section.textContent = sectionLabel;
      headingBlock.appendChild(section);
    }

    if (variantLabel && variantLabel.toLowerCase() !== (sectionLabel || "").toLowerCase()) {
      const style = document.createElement("p");
      style.className = "ui-manager-option-copy is-style";
      style.textContent = `Style: ${variantLabel}`;
      headingBlock.appendChild(style);
    }
    head.appendChild(headingBlock);

    const toggle = document.createElement("label");
    toggle.className = "ui-manager-option-toggle";
    const toggleInput = document.createElement("input");
    toggleInput.type = "checkbox";
    toggleInput.checked = selectedPaths.has(bundle.optionPath);
    toggleInput.dataset.optionToggle = "true";
    toggleInput.dataset.optionPath = bundle.optionPath;
    toggleInput.setAttribute("aria-label", `Flag ${bundle.label || bundle.optionPath} for use`);
    toggle.appendChild(toggleInput);
    const toggleText = document.createElement("span");
    toggleText.textContent = "Use";
    toggle.appendChild(toggleText);
    head.appendChild(toggle);

    if (bundle.previewImageUrl) {
      const preview = document.createElement("div");
      preview.className = "ui-manager-option-thumb";
      const image = document.createElement("img");
      image.src = bundle.previewImageUrl;
      image.alt = `${bundle.label} preview`;
      preview.appendChild(image);
      head.appendChild(preview);
    }

    card.appendChild(head);

    const facts = document.createElement("p");
    facts.className = "ui-manager-option-facts";
    facts.textContent = `${bundle.xmlFiles.length} ${bundle.xmlFiles.length === 1 ? "screen element" : "screen elements"}${bundle.tgaFiles.length && !bundle.isDefault ? ` • ${bundle.tgaFiles.length} ${bundle.tgaFiles.length === 1 ? "art file" : "art files"}` : ""}`;
    card.appendChild(facts);

    const pills = document.createElement("div");
    pills.className = "ui-manager-pill-row";
    pills.appendChild(createUiManagerPill(groupLabel));
    if (relatedBundles.length > 1) {
      pills.appendChild(createUiManagerPill(`${relatedBundles.length} styles`, "warning"));
    }
    if (selectedPaths.has(bundle.optionPath)) {
      pills.appendChild(createUiManagerPill("Flagged", "success"));
    } else if (bundle.activeState === "active") {
      pills.appendChild(createUiManagerPill("Active", "success"));
    } else if (bundle.activeState === "mixed") {
      pills.appendChild(createUiManagerPill("Mixed", "warning"));
    } else if (bundle.isDefault) {
      pills.appendChild(createUiManagerPill("Default", "warning"));
    }
    card.appendChild(pills);
    elements.uiManagerOptionList.appendChild(card);
  }
}
function renderUiManagerPreviewAndBackups() {
  clearElementContent(elements.uiManagerPreviewPanel);
  clearElementContent(elements.uiManagerBackupList);
  clearElementContent(elements.uiManagerRecoveryStats);
  const bundle = getUiManagerSelectedBundle();
  const bundleGroups = getUiManagerBundleGroups();
  const selectedPackage = getUiManagerSelectedPackageSummary();
  const backups = Array.isArray(state.uiManager.detail?.backups) ? state.uiManager.detail.backups : [];
  const backupSummary = state.uiManager.detail?.backupSummary || null;
  elements.uiManagerRecoveryPackageName.textContent = selectedPackage?.name || "No package selected.";
  elements.uiManagerRecoveryMeta.textContent = selectedPackage
    ? `${backups.length} backup${backups.length === 1 ? "" : "s"} available for ${selectedPackage.name}.`
    : "Choose a package to review backups and restore points.";

  if (selectedPackage && backupSummary) {
    const stats = [
      `${backupSummary.backupCount || 0} of ${backupSummary.maxBackupCount || 0} kept`,
      `${formatByteValue(backupSummary.totalSizeBytes || 0)} used`,
      `Auto-trim at ${formatByteValue(backupSummary.maxTotalSizeBytes || 0)}`
    ];
    for (const label of stats) {
      elements.uiManagerRecoveryStats.appendChild(createUiManagerPill(label, "neutral"));
    }
  }

  if (!bundle) {
    elements.uiManagerPreviewPanel.appendChild(
      createUiManagerEmptyState("Select an option bundle", "Choose a bundle from the option library to see its preview, file set, and restore context.")
    );
  } else {
    const relatedBundles = bundleGroups.get(getUiManagerBundleGroupKey(bundle)) || [bundle];
    const prettyTitle = formatUiManagerHumanLabel(bundle.label || bundle.optionPath);
    const prettyCategory = formatUiManagerPrettyPath(bundle.categoryPath || "");
    const humanGroupLabel = formatUiManagerHumanLabel(getUiManagerBundleGroupLabel(bundle));
    const xmlCountLabel = `${bundle.xmlFiles.length} ${bundle.xmlFiles.length === 1 ? "screen element" : "screen elements"}`;
    const artCountLabel = bundle.isDefault
      ? "No extra artwork"
      : `${bundle.tgaFiles.length} ${bundle.tgaFiles.length === 1 ? "art file" : "art files"}`;
    const headerRow = document.createElement("div");
    headerRow.className = "ui-manager-preview-header";

    const headingCopy = document.createElement("div");
    headingCopy.className = "ui-manager-preview-header-copy";

    const title = document.createElement("p");
    title.className = "ui-manager-option-title";
    title.textContent = prettyTitle;
    headingCopy.appendChild(title);

    if (prettyCategory) {
      const categoryLine = document.createElement("p");
      categoryLine.className = "ui-manager-option-copy";
      categoryLine.textContent = `Section: ${prettyCategory}`;
      headingCopy.appendChild(categoryLine);
    }

    const summaryLine = document.createElement("p");
    summaryLine.className = "ui-manager-preview-summary";
    summaryLine.textContent = `This style updates ${humanGroupLabel.toLowerCase()} and includes ${xmlCountLabel.toLowerCase()}${bundle.isDefault ? "." : ` plus ${artCountLabel.toLowerCase()}.`}`;
    headingCopy.appendChild(summaryLine);
    headerRow.appendChild(headingCopy);
    elements.uiManagerPreviewPanel.appendChild(headerRow);

    const preview = document.createElement("div");
    preview.className = "ui-manager-preview-stage";
    if (bundle.previewImageUrl) {
      const image = document.createElement("img");
      image.src = bundle.previewImageUrl;
      image.alt = `${bundle.label} preview`;
      preview.appendChild(image);
    } else {
      const copy = document.createElement("div");
      copy.className = "ui-manager-option-preview is-empty";
      copy.textContent = "No preview image was included for this style.";
      preview.appendChild(copy);
    }
    elements.uiManagerPreviewPanel.appendChild(preview);

    const details = document.createElement("div");
    details.className = "ui-manager-preview-detail-grid";

    const affectsCard = document.createElement("div");
    affectsCard.className = "ui-manager-preview-detail-card";
    affectsCard.innerHTML = `<span class="summary-label">Affects</span><strong>${humanGroupLabel}</strong>`;
    details.appendChild(affectsCard);

    const assetsCard = document.createElement("div");
    assetsCard.className = "ui-manager-preview-detail-card";
    assetsCard.innerHTML = `<span class="summary-label">Includes</span><strong>${xmlCountLabel}${bundle.isDefault ? "" : ` • ${artCountLabel}`}</strong>`;
    details.appendChild(assetsCard);

    elements.uiManagerPreviewPanel.appendChild(details);

    if (relatedBundles.length > 1) {
      const relatedLabel = document.createElement("p");
      relatedLabel.className = "ui-manager-preview-related-label";
      relatedLabel.textContent = "Other styles in this set";
      elements.uiManagerPreviewPanel.appendChild(relatedLabel);

      const relatedStrip = document.createElement("div");
      relatedStrip.className = "ui-manager-package-file-strip";
      for (const relatedBundle of relatedBundles) {
        const tone = relatedBundle.optionPath === bundle.optionPath || relatedBundle.activeState === "active" ? "success" : "";
        relatedStrip.appendChild(createUiManagerPill(formatUiManagerHumanLabel(relatedBundle.label || relatedBundle.optionPath), tone));
      }
      elements.uiManagerPreviewPanel.appendChild(relatedStrip);
    }

    if (bundle.instructions) {
      const instructions = document.createElement("p");
      instructions.className = "ui-manager-preview-callout";
      instructions.textContent = bundle.instructions;
      elements.uiManagerPreviewPanel.appendChild(instructions);
    }
  }

  if (!selectedPackage) {
    elements.uiManagerBackupList.appendChild(
      createUiManagerEmptyState("No package selected", "Select a package in Stage 2 to open its recovery history and restore points.")
    );
    return;
  }

  if (!backups.length) {
    elements.uiManagerBackupList.appendChild(
      createUiManagerEmptyState("No backups yet", "Backups will appear here after prepare, apply, reset, or restore actions create snapshots.")
    );
    return;
  }

  for (const backup of backups) {
    const card = document.createElement("div");
    card.className = "ui-manager-backup-card";
    const title = document.createElement("p");
    title.className = "ui-manager-backup-title";
    title.textContent = backup.id;
    card.appendChild(title);

    const copy = document.createElement("p");
    copy.className = "ui-manager-backup-copy";
    copy.textContent = `${backup.reason || "manual"} • ${backup.createdAt || "Unknown date"}`;
    card.appendChild(copy);

    const metaStrip = document.createElement("div");
    metaStrip.className = "ui-manager-backup-meta-strip";
    metaStrip.appendChild(createUiManagerPill(formatByteValue(backup.sizeBytes || 0)));
    metaStrip.appendChild(createUiManagerPill(backup.hasSnapshot ? "Full snapshot" : "INI-only", backup.hasSnapshot ? "" : "success"));
    if (Array.isArray(backup.iniFiles) && backup.iniFiles.length) {
      metaStrip.appendChild(createUiManagerPill(`${backup.iniFiles.length} INI`, "neutral"));
    }
    card.appendChild(metaStrip);

    const restore = document.createElement("button");
    restore.className = "secondary-button utility-button";
    restore.type = "button";
    restore.dataset.backupId = backup.id;
    restore.textContent = "Restore Backup";
    card.appendChild(restore);
    elements.uiManagerBackupList.appendChild(card);
  }
}
function renderUiManagerActionState() {
  const selectedPackage = getUiManagerSelectedPackageSummary();
  const diff = buildUiManagerConfirmationDiff();
  const activeStage = state.uiManager.activeStage || "targets";
  const isConfirmStage = activeStage === "confirm";
  const pendingComponentChanges = Array.isArray(diff.componentChanges)
    ? diff.componentChanges.filter((entry) => entry.toPath)
    : [];
  const pendingSkinChanges = Array.isArray(diff.skinChanges) ? diff.skinChanges : [];
  const canApply = Boolean(
    selectedPackage
      && !selectedPackage.protected
      && (pendingComponentChanges.length || pendingSkinChanges.length)
  );
  const canReset = Boolean(selectedPackage && selectedPackage.prepared && !selectedPackage.protected);

  elements.uiManagerRecoveryButton.disabled = !selectedPackage;
  elements.uiManagerApplyOptionButton.disabled = !canApply || state.uiManager.actionLoading || !isConfirmStage;
  elements.uiManagerResetButton.disabled = !canReset || state.uiManager.actionLoading || !isConfirmStage;
  elements.uiManagerNextStageButton.textContent = activeStage === "components" ? "Review" : "Next";
  elements.uiManagerActionMeta.textContent = activeStage === "targets"
    ? "Stage 1: choose one or more characters, or use All Characters to target every UI settings file."
    : activeStage === "packages"
      ? !selectedPackage
        ? "Stage 2: select the UI package you want to assign or customize."
        : selectedPackage.prepared
          ? `Stage 2: ${selectedPackage.name} is ready. Continue to UI Components or go straight to confirmation.`
          : `Stage 2: ${selectedPackage.name} still needs preparation before component switching is available.`
      : activeStage === "components"
        ? "Stage 3: review the available component bundles and highlight the variant you want active."
        : !selectedPackage
          ? "Stage 4: complete the earlier stages to build a confirmation summary."
          : selectedPackage.protected
            ? "Stage 4: the protected default package can only be assigned via UISkin."
            : selectedPackage.prepared
              ? `${state.uiManager.selectedTargetPaths.length} target(s) selected. Review the summary, then apply the highlighted bundle or update UISkin.`
              : "Stage 4: prepare this package before applying component changes.";
}
function renderUiManager() {
  syncUiManagerSelection();
  renderUiManagerNotice();
  renderUiManagerPackageContextMenu();
  renderUiManagerLaunchSurface();
  renderUiManagerStageState();
  renderUiManagerPackageList();
  renderUiManagerPackageDetail();
  renderUiManagerTargetList();
  renderUiManagerOptionList();
  renderUiManagerPreviewAndBackups();
  renderUiManagerConfirmationSummary();
  renderUiManagerActionState();
  void ensureUiManagerPackageMetadataChecks();
}
async function loadUiManagerOverview(options = {}) {
  const { preserveNotice = false } = options;
  if (!state.current?.gameDirectory) {
    state.uiManager.overview = null;
    state.uiManager.detail = null;
    state.uiManager.packageMetadataHealth = {};
    renderUiManager();
    return;
  }

  state.uiManager.overviewLoading = true;
  if (!preserveNotice) {
    setUiManagerNotice("Refreshing UI Manager data...", "info", { persistent: true });
  }
  renderUiManager();

  try {
    state.uiManager.overview = await window.launcher.getUiManagerOverview();
    resetUiManagerPackageMetadataHealthState();
    syncUiManagerSelection();
    if (state.uiManager.selectedPackageName) {
      await loadUiManagerPackageDetails(state.uiManager.selectedPackageName, { preserveNotice: true });
    } else {
      state.uiManager.detail = null;
    }
    setUiManagerNotice("UI Manager data refreshed.", "success");
  } catch (error) {
    setUiManagerNotice(`Unable to load UI Manager data: ${error.message}`, "error");
  } finally {
    state.uiManager.overviewLoading = false;
    renderUiManager();
  }
}
async function loadUiManagerPackageDetails(packageName, options = {}) {
  const { preserveNotice = false } = options;
  if (!packageName) {
    state.uiManager.detail = null;
    renderUiManager();
    return;
  }

  state.uiManager.detailLoading = true;
  state.uiManager.selectedPackageName = packageName;
  if (!preserveNotice) {
    setUiManagerNotice(`Loading ${packageName}...`, "info", { persistent: true });
  }
  renderUiManager();

  try {
    state.uiManager.detail = await window.launcher.getUiPackageDetails(packageName);
    const bundles = Array.isArray(state.uiManager.detail?.bundles) ? state.uiManager.detail.bundles : [];
    const preferredBundle = bundles.find((entry) => entry.activeState === "active") || bundles[0] || null;
    const activeBundlePaths = bundles.filter((entry) => entry.activeState === "active").map((entry) => entry.optionPath);
    setUiManagerSelectedOptionPaths(state.uiManager.selectedOptionPaths.length ? state.uiManager.selectedOptionPaths : activeBundlePaths);
    if (!state.uiManager.selectedOptionPaths.length && preferredBundle?.optionPath) {
      state.uiManager.selectedOptionPaths = [preferredBundle.optionPath];
    }
    if (!bundles.some((entry) => entry.optionPath === state.uiManager.selectedOptionPath)) {
      state.uiManager.selectedOptionPath = state.uiManager.selectedOptionPaths[0] || preferredBundle?.optionPath || "";
    }
    if (!preserveNotice) {
      setUiManagerNotice(`Loaded ${packageName}.`, "success");
    }
  } catch (error) {
    state.uiManager.detail = null;
    setUiManagerNotice(`Unable to load ${packageName}: ${error.message}`, "error");
  } finally {
    state.uiManager.detailLoading = false;
    renderUiManager();
  }
}
async function runUiManagerAction(message, action) {
  state.uiManager.actionLoading = true;
  setUiManagerNotice(message, "info", { persistent: true });
  renderUiManager();
  try {
    const result = await action();
    state.uiManager.overview = result?.overview || state.uiManager.overview;
    if (result?.targets && state.uiManager.overview) {
      state.uiManager.overview = {
        ...state.uiManager.overview,
        targets: result.targets
      };
    }
    if (result?.details) {
      state.uiManager.detail = result.details;
      state.uiManager.selectedPackageName = result.details.name || state.uiManager.selectedPackageName;
    } else if (state.uiManager.selectedPackageName) {
      await loadUiManagerPackageDetails(state.uiManager.selectedPackageName, { preserveNotice: true });
    }
    if (!result?.overview) {
      const latestOverview = await window.launcher.getUiManagerOverview();
      state.uiManager.overview = latestOverview;
    }
    resetUiManagerPackageMetadataHealthState();
    syncUiManagerSelection();
    const summaryMessage = result?.summary && Number.isFinite(result.summary.scannedCount)
      ? `Validated UI Meta Data for ${result.summary.scannedCount} option XML file(s); corrected ${result.summary.correctedCount || 0}.`
      : "UI Manager action completed.";
    setUiManagerNotice(summaryMessage, "success");
    renderUiManager();
    return result;
  } catch (error) {
    setUiManagerNotice(error.message || "UI Manager action failed.", "error");
    renderUiManager();
    return null;
  } finally {
    state.uiManager.actionLoading = false;
    renderUiManager();
  }
}
async function promptUiManagerAction(message, action) {
  openUiManagerConfirmModal(message, async () => {
    closeUiManagerConfirmModal();
    await action();
  });
}
function createExternalLinkElement(href, label) {
  const anchor = document.createElement("a");
  anchor.className = "launcher-update-release-link";
  anchor.textContent = label;
  anchor.setAttribute("href", href);
  anchor.setAttribute("target", "_blank");
  anchor.setAttribute("rel", "noopener noreferrer");
  return anchor;
}
function splitTrailingReleaseNotesPunctuation(url) {
  let normalizedUrl = url;
  let trailingText = "";

  while (/[),.!?;:]$/.test(normalizedUrl)) {
    const trailingCharacter = normalizedUrl.slice(-1);
    if (trailingCharacter === ")") {
      const openingParens = (normalizedUrl.match(/\(/g) || []).length;
      const closingParens = (normalizedUrl.match(/\)/g) || []).length;
      if (closingParens <= openingParens) {
        break;
      }
    }

    trailingText = `${trailingCharacter}${trailingText}`;
    normalizedUrl = normalizedUrl.slice(0, -1);
  }

  return {
    url: normalizedUrl,
    trailingText
  };
}
function appendReleaseNotesTextWithLinks(fragment, text) {
  RELEASE_NOTES_LINK_PATTERN.lastIndex = 0;
  let cursor = 0;
  let match = RELEASE_NOTES_LINK_PATTERN.exec(text);

  while (match) {
    const startIndex = match.index;
    const endIndex = startIndex + match[0].length;

    if (startIndex > cursor) {
      fragment.appendChild(document.createTextNode(text.slice(cursor, startIndex)));
    }

    if (match[1] && match[2]) {
      fragment.appendChild(createExternalLinkElement(match[2], match[1]));
    } else {
      const rawUrl = match[3] || match[4] || "";
      const { url, trailingText } = splitTrailingReleaseNotesPunctuation(rawUrl);
      fragment.appendChild(createExternalLinkElement(url, url));
      if (trailingText) {
        fragment.appendChild(document.createTextNode(trailingText));
      }
    }

    cursor = endIndex;
    match = RELEASE_NOTES_LINK_PATTERN.exec(text);
  }

  if (cursor < text.length) {
    fragment.appendChild(document.createTextNode(text.slice(cursor)));
  }
}
function renderLauncherUpdateReleaseNotes(releaseNotes) {
  const releaseNotesText = String(releaseNotes || "").trim();
  clearElementContent(elements.launcherUpdateReleaseNotes);

  if (!releaseNotesText) {
    elements.launcherUpdateReleaseNotes.textContent = "No release notes were provided for this version.";
    return;
  }

  const fragment = document.createDocumentFragment();
  appendReleaseNotesTextWithLinks(fragment, releaseNotesText);
  elements.launcherUpdateReleaseNotes.appendChild(fragment);
}
function updatePatchNotesAttention() {
  elements.notesTabButton.classList.toggle("has-unread", state.patchNotes.hasUnread);
  elements.notesTabButton.setAttribute("aria-label", state.patchNotes.hasUnread ? "Patch Notes (new unread notes)" : "Patch Notes");
}
function markCurrentPatchNotesRead() {
  if (!state.patchNotes.signature || !state.patchNotes.loadedUrl) {
    state.patchNotes.hasUnread = false;
    closePatchNotesPromptModal();
    updatePatchNotesAttention();
    return;
  }

  patchNotesReadTracker.markRead(state.patchNotes.loadedUrl, state.patchNotes.signature);
  if (state.patchNotesPromptDismissedSignature === state.patchNotes.signature) {
    state.patchNotesPromptDismissedSignature = "";
  }
  state.patchNotes.hasUnread = false;
  closePatchNotesPromptModal();
  updatePatchNotesAttention();
}
function syncPatchNotesUnreadState() {
  if (!state.patchNotes.signature || !state.patchNotes.loadedUrl) {
    state.patchNotes.hasUnread = false;
    closePatchNotesPromptModal();
    updatePatchNotesAttention();
    return;
  }

  if (patchNotesReadTracker.initializeBaseline(state.patchNotes.loadedUrl, state.patchNotes.signature)) {
    state.patchNotes.hasUnread = false;
    closePatchNotesPromptModal();
    updatePatchNotesAttention();
    return;
  }

  state.patchNotes.hasUnread = patchNotesReadTracker.isUnread(state.patchNotes.loadedUrl, state.patchNotes.signature);

  if (state.activeTab === "notes" && state.patchNotes.html) {
    markCurrentPatchNotesRead();
    return;
  }

  updatePatchNotesAttention();
}
function openToolsMenu() {
  elements.toolsMenu.classList.remove("hidden");
  elements.toolsButton.setAttribute("aria-expanded", "true");
}
function closeToolsMenu() {
  elements.toolsMenu.classList.add("hidden");
  elements.toolsButton.setAttribute("aria-expanded", "false");
}
function toggleToolsMenu() {
  if (elements.toolsMenu.classList.contains("hidden")) {
    openToolsMenu();
    return;
  }
  closeToolsMenu();
}
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
function isPatchNotesPromptModalVisible() {
  return !elements.patchNotesPromptModal.classList.contains("hidden");
}
function isLauncherUpdateModalVisible() {
  return !elements.launcherUpdateModal.classList.contains("hidden");
}
function openPatchNotesPromptModal() {
  const serverName = state.current?.serverName || "this server";
  elements.patchNotesPromptMessage.textContent = `New patch notes were detected for ${serverName}. Open the Patch Notes tab now?`;
  elements.patchNotesPromptModal.classList.remove("hidden");
  elements.patchNotesPromptModal.setAttribute("aria-hidden", "false");
}
function closePatchNotesPromptModal() {
  elements.patchNotesPromptModal.classList.add("hidden");
  elements.patchNotesPromptModal.setAttribute("aria-hidden", "true");
}
function dismissPatchNotesPrompt() {
  if (state.patchNotes.signature) {
    state.patchNotesPromptDismissedSignature = state.patchNotes.signature;
  }
  closePatchNotesPromptModal();
}
function handlePatchNotesPrompt() {
  if (!state.patchNotes.hasUnread || !state.patchNotes.signature || state.activeTab === "notes") {
    closePatchNotesPromptModal();
    return;
  }

  if (isLauncherUpdateModalVisible()) {
    closePatchNotesPromptModal();
    return;
  }

  if (state.patchNotesPromptDismissedSignature === state.patchNotes.signature) {
    return;
  }

  openPatchNotesPromptModal();
}
function openLauncherUpdateModal(updateState) {
  closePatchNotesPromptModal();
  const currentVersion = `v${updateState.currentVersion || "0.0.0"}`;
  const latestVersion = `v${updateState.latestVersion || updateState.currentVersion || "0.0.0"}`;
  elements.launcherUpdateSummary.textContent = `A new patcher update is available. Update from ${currentVersion} to ${latestVersion}.`;
  elements.launcherUpdateCurrentVersion.textContent = currentVersion;
  elements.launcherUpdateLatestVersion.textContent = latestVersion;
  renderLauncherUpdateReleaseNotes(updateState.releaseNotes);
  elements.launcherUpdateModal.classList.remove("hidden");
  elements.launcherUpdateModal.setAttribute("aria-hidden", "false");
}
function closeLauncherUpdateModal() {
  elements.launcherUpdateModal.classList.add("hidden");
  elements.launcherUpdateModal.setAttribute("aria-hidden", "true");
  handlePatchNotesPrompt();
}
async function startLauncherUpdateDownloadFlow(expectedVersion = "") {
  state.launcherUpdateAutoApplyVersion = String(expectedVersion || state.current?.launcherUpdate?.latestVersion || "").trim();
  const nextState = await window.launcher.startLauncherUpdateDownload();
  if (!["downloading", "ready", "applying"].includes(nextState?.launcherUpdate?.status || nextState?.status || "")) {
    state.launcherUpdateAutoApplyVersion = "";
  }
  renderState(nextState);
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

function getConfiguredPatchNotesUrl() {
  return String(state.current?.patchNotesUrl || "").trim();
}

function hasConfiguredPatchNotesSource() {
  return Boolean(getConfiguredPatchNotesUrl());
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

function syncPatchNotesSourceState() {
  const configuredUrl = getConfiguredPatchNotesUrl();

  if (!configuredUrl) {
    if (state.patchNotes.loaded || state.patchNotes.loading || state.patchNotes.loadedUrl || state.patchNotes.html || state.patchNotes.error) {
      resetPatchNotesState();
      if (state.activeTab === "notes") {
        renderPatchNotes();
      }
    }
    return;
  }

  if (state.patchNotes.loadedUrl && state.patchNotes.loadedUrl !== configuredUrl) {
    resetPatchNotesState();
    if (state.activeTab === "notes") {
      renderPatchNotes();
    }
  }

  if (state.activeTab !== "notes") {
    return;
  }

  if (!shouldLoadPatchNotes(configuredUrl, state.patchNotes)) {
    return;
  }

  loadPatchNotes(false).catch((error) => {
    state.patchNotes.loaded = true;
    state.patchNotes.loading = false;
    state.patchNotes.loadedUrl = configuredUrl;
    state.patchNotes.content = "";
    state.patchNotes.html = "";
    state.patchNotes.error = `Unable to load patch notes: ${error.message}`;
    state.patchNotes.fetchedAt = "";
    state.patchNotes.contentHash = "";
    state.patchNotes.signature = "";
    state.patchNotes.hasUnread = false;
    renderPatchNotes();
  });
}

function scrollMatchIntoView(match, options = {}) {
  const { behavior = "smooth" } = options;
  const container = elements.notesCard;
  if (!container || !match) {
    return;
  }

  const containerRect = container.getBoundingClientRect();
  const matchRect = match.getBoundingClientRect();
  const currentTop = container.scrollTop;
  const relativeTop = matchRect.top - containerRect.top + currentTop;
  const targetTop = Math.max(0, relativeTop - container.clientHeight / 2 + matchRect.height / 2);

  container.scrollTo({
    top: targetTop,
    behavior
  });
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
    scrollMatchIntoView(matches[safeIndex]);
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
    updatePatchNotesAttention();
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
    state.patchNotes.hasUnread = false;
    closePatchNotesPromptModal();
    updatePatchNotesMeta("Unable to load");
    updatePatchNotesAttention();
    updateMatchNavigation();
    return;
  }

  if (!state.patchNotes.html) {
    const hasSource = hasConfiguredPatchNotesSource();
    elements.notesContent.innerHTML = hasSource
      ? '<p class="notes-copy">No patch notes have been published yet.</p>'
      : '<p class="notes-copy">Patch Notes source not configured.</p>';
    state.patchNotes.matchCount = 0;
    state.patchNotes.activeMatchIndex = -1;
    state.patchNotes.signature = "";
    state.patchNotes.hasUnread = false;
    closePatchNotesPromptModal();
    if (!hasSource) {
      elements.notesSearchInput.value = "";
    }
    updatePatchNotesMeta(hasSource ? "0 lines" : "No source configured");
    updatePatchNotesAttention();
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
  state.patchNotes.loaded = true;
  state.patchNotes.loading = false;
  state.patchNotes.loadedUrl = notes.url || "";
  state.patchNotes.content = notes.content || "";
  state.patchNotes.html = notes.html || "";
  state.patchNotes.error = notes.error || "";
  state.patchNotes.fetchedAt = notes.fetchedAt || "";
  state.patchNotes.contentHash = notes.contentHash || "";
  state.patchNotes.signature = getPatchNotesSignature(
    state.patchNotes.loadedUrl,
    state.patchNotes.contentHash,
    state.patchNotes.content
  );
  state.patchNotes.matchCount = 0;
  state.patchNotes.activeMatchIndex = -1;
  syncPatchNotesUnreadState();
  handlePatchNotesPrompt();
  renderPatchNotes();
}

function setActiveTab(tabName) {
  state.activeTab = tabName;
  const patchIsActive = tabName === "patch";
  const notesIsActive = tabName === "notes";
  const uiManagerIsActive = tabName === "ui-manager";
  elements.patchTabButton.classList.toggle("is-active", patchIsActive);
  elements.patchTabButton.setAttribute("aria-selected", String(patchIsActive));
  elements.patchTabPanel.classList.toggle("hidden", !patchIsActive);
  elements.notesTabButton.classList.toggle("is-active", notesIsActive);
  elements.notesTabButton.setAttribute("aria-selected", String(notesIsActive));
  elements.notesTabPanel.classList.toggle("hidden", !notesIsActive);
  elements.uiManagerTabButton.classList.toggle("is-active", uiManagerIsActive);
  elements.uiManagerTabButton.setAttribute("aria-selected", String(uiManagerIsActive));
  elements.uiManagerTabPanel.classList.toggle("hidden", !uiManagerIsActive);
  if (notesIsActive && state.patchNotes.html) {
    markCurrentPatchNotesRead();
  }
  if (notesIsActive && !state.patchNotes.html && !state.patchNotes.loading) {
    loadPatchNotes(false).catch((error) => {
      state.patchNotes.loading = false;
      state.patchNotes.error = `Unable to load patch notes: ${error.message}`;
      renderPatchNotes();
    });
  }
  if (uiManagerIsActive && !state.uiManager.overviewLoading && !state.uiManager.overview && state.current?.gameDirectory) {
    loadUiManagerOverview().catch((error) => {
      setUiManagerNotice(`Unable to load UI Manager data: ${error.message}`, "error");
    });
  }
}
function formatByteValue(value) {
  const numericValue = Math.max(0, Number(value) || 0);
  if (numericValue >= 1024 * 1024) {
    return `${(numericValue / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (numericValue >= 1024) {
    return `${Math.round(numericValue / 1024)} KB`;
  }
  return `${numericValue} B`;
}

function getLauncherUpdatePresentation(updateState) {
  const currentVersion = `v${updateState.currentVersion || "0.0.0"}`;
  const latestVersion = updateState.latestVersion ? `v${updateState.latestVersion}` : currentVersion;

  switch (updateState.status) {
    case "checking":
      return {
        meta: "Checking for Updates",
        message: `Checking patcher updates for ${currentVersion}.`
      };
    case "available":
      return {
        meta: "Update Available",
        message: `Current ${currentVersion}  Available ${latestVersion}`
      };
    case "downloading":
      return {
        meta: "Updating Patcher",
        message: `Downloading ${latestVersion}`
      };
    case "ready":
      return {
        meta: "Update Ready",
        message: `${latestVersion} is ready to install.`
      };
    case "applying":
      return {
        meta: "Applying Update",
        message: `Restarting into ${latestVersion}.`
      };
    case "helper-error":
    case "error":
      return {
        meta: "Update Check Failed",
        message: updateState.message || "Unable to complete the patcher update check."
      };
    case "idle":
    case "up-to-date":
    default:
      return {
        meta: "Patcher Up to Date",
        message: `${currentVersion} is installed.`
      };
  }
}

function handleLauncherUpdatePrompt(updateState) {
  if (!state.launcherUpdatePromptPending || !updateState) {
    return;
  }

  if (updateState.status === "available" && updateState.latestVersion && state.launcherUpdatePromptedVersion !== updateState.latestVersion) {
    state.launcherUpdatePromptedVersion = updateState.latestVersion;
    state.launcherUpdatePromptPending = false;
    openLauncherUpdateModal(updateState);
    return;
  }

  if (["up-to-date", "ready", "helper-error", "error"].includes(updateState.status)) {
    state.launcherUpdatePromptPending = false;
  }
}

async function handleLauncherUpdateAutoApply(updateState) {
  if (!updateState) {
    return;
  }

  if (updateState.status === "applying") {
    state.launcherUpdateAutoApplyVersion = "";
    return;
  }

  if (["up-to-date", "available", "helper-error", "error", "idle", "unsupported-platform"].includes(updateState.status)) {
    state.launcherUpdateAutoApplyVersion = "";
  }

  if (
    updateState.status !== "ready" ||
    !state.launcherUpdateAutoApplyVersion ||
    state.launcherUpdateAutoApplyVersion !== updateState.latestVersion ||
    state.launcherUpdateAutoApplyInFlight
  ) {
    return;
  }

  state.launcherUpdateAutoApplyInFlight = true;
  try {
    const result = await window.launcher.applyLauncherUpdate();
    if (result?.state) {
      renderState(result.state);
    }
  } finally {
    state.launcherUpdateAutoApplyInFlight = false;
    state.launcherUpdateAutoApplyVersion = "";
  }
}

function renderLauncherUpdate(updateState) {
  if (!updateState || updateState.status === "unsupported-platform") {
    elements.launcherUpdatePanel.classList.add("hidden");
    return;
  }

  elements.launcherUpdatePanel.classList.remove("hidden");
  const presentation = getLauncherUpdatePresentation(updateState);
  elements.launcherUpdateMeta.textContent = presentation.meta;

  let message = presentation.message;
  if (updateState.status === "downloading") {
    message = `${message} ${formatByteValue(updateState.progressValue)} / ${formatByteValue(updateState.progressMax)}`;
  }
  elements.launcherUpdateMessage.textContent = message;

  elements.launcherUpdateActionButton.classList.add("hidden");
  elements.launcherUpdateActionButton.disabled = false;
  elements.launcherUpdateActionButton.dataset.action = "";
  elements.launcherUpdateLinkButton.classList.add("hidden");
  elements.launcherUpdateLinkButton.disabled = false;

  if (updateState.status === "available") {
    elements.launcherUpdateActionButton.textContent = "Update Patcher";
    elements.launcherUpdateActionButton.dataset.action = "download";
    elements.launcherUpdateActionButton.classList.remove("hidden");
    return;
  }

  if (updateState.status === "ready") {
    elements.launcherUpdateActionButton.textContent = "Restart To Update";
    elements.launcherUpdateActionButton.dataset.action = "apply";
    elements.launcherUpdateActionButton.classList.remove("hidden");
    return;
  }

  if (updateState.status === "downloading" || updateState.status === "checking" || updateState.status === "applying") {
    elements.launcherUpdateActionButton.textContent =
      updateState.status === "checking" ? "Checking..." : updateState.status === "applying" ? "Restarting..." : "Downloading...";
    elements.launcherUpdateActionButton.disabled = true;
    elements.launcherUpdateActionButton.classList.remove("hidden");
    return;
  }

  if ((updateState.status === "helper-error" || updateState.status === "error") && updateState.releaseUrl) {
    elements.launcherUpdateLinkButton.classList.remove("hidden");
  }
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
  const previousGameDirectory = state.current?.gameDirectory || "";
  state.current = nextState;
  if ((nextState?.gameDirectory || "") !== previousGameDirectory) {
    state.uiManager.overview = null;
    state.uiManager.detail = null;
    state.uiManager.activeStage = "targets";
    state.uiManager.selectedPackageName = "";
    state.uiManager.selectedOptionPath = "";
    state.uiManager.selectedOptionPaths = [];
    state.uiManager.selectedTargetPaths = [];
    state.uiManager.targetSearchQuery = "";
    state.uiManager.targetServerFilter = "";
    state.uiManager.targetPickerOpen = false;
    state.uiManager.noticeText = "";
  }
  setPatchNotesSearchEnabled(hasConfiguredPatchNotesSource());
  syncPatchNotesSourceState();
  renderLauncherUpdate(nextState.launcherUpdate);
  handleLauncherUpdatePrompt(nextState.launcherUpdate);
  handlePatchNotesPrompt();
  handleLauncherUpdateAutoApply(nextState.launcherUpdate).catch((error) => {
    pushLog({
      text: `Unable to apply the downloaded patcher update automatically: ${error.message}`,
      tone: "error",
      timestamp: new Date().toISOString()
    });
  });
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
  renderUiManager();
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
  bindHorizontalWheelScroll(elements.uiManagerPackageList);
  bindHorizontalWheelScroll(elements.uiManagerTargetList);
  bindHorizontalWheelScroll(elements.uiManagerOptionList);
  bindHorizontalWheelScroll(elements.uiManagerStageTabs);

  elements.minimizeButton.addEventListener("click", async () => {
    await window.launcher.minimizeWindow();
  });
  elements.closeButton.addEventListener("click", async () => {
    await window.launcher.closeWindow();
  });
  elements.discordButton.addEventListener("click", async () => {
    await window.launcher.openExternal("https://discord.com/invite/3wkzwwc");
  });
  elements.websiteLink.addEventListener("click", async (event) => {
    event.preventDefault();
    await window.launcher.openExternal(elements.websiteLink.href);
  });
  elements.toolsButton.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleToolsMenu();
  });
  elements.toolsMenu.addEventListener("click", async (event) => {
    const link = event.target.closest("a.tools-menu-link");
    if (!link) {
      return;
    }
    event.preventDefault();
    closeToolsMenu();
    await window.launcher.openExternal(link.href);
  });
  elements.refreshButton.addEventListener("click", async () => {
    setBusy(elements.refreshButton, "Syncing...", true);
    try {
      const [nextState] = await Promise.all([
        window.launcher.refreshState(),
        loadPatchNotes(true)
      ]);
      renderState(nextState);
      if (state.activeTab === "ui-manager" || !elements.uiManagerModal.classList.contains("hidden")) {
        await loadUiManagerOverview({ preserveNotice: true });
      }
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
  elements.launcherUpdateCloseButton.addEventListener("click", () => {
    closeLauncherUpdateModal();
  });
  elements.launcherUpdateLaterButton.addEventListener("click", () => {
    closeLauncherUpdateModal();
  });
  elements.launcherUpdateBackdrop.addEventListener("click", () => {
    closeLauncherUpdateModal();
  });
  elements.launcherUpdateReleaseNotes.addEventListener("click", async (event) => {
    const link = event.target.closest("a");
    if (!link || !elements.launcherUpdateReleaseNotes.contains(link)) {
      return;
    }

    const href = normalizePatchNotesLinkHref(link.getAttribute("href"));
    if (!/^https?:\/\//i.test(href)) {
      return;
    }

    event.preventDefault();
    await window.launcher.openExternal(href);
  });
  elements.launcherUpdateNowButton.addEventListener("click", async () => {
    closeLauncherUpdateModal();
    await startLauncherUpdateDownloadFlow(state.current?.launcherUpdate?.latestVersion);
  });
  elements.patchNotesPromptCloseButton.addEventListener("click", () => {
    dismissPatchNotesPrompt();
  });
  elements.patchNotesPromptLaterButton.addEventListener("click", () => {
    dismissPatchNotesPrompt();
  });
  elements.patchNotesPromptBackdrop.addEventListener("click", () => {
    dismissPatchNotesPrompt();
  });
  elements.patchNotesPromptViewButton.addEventListener("click", () => {
    closePatchNotesPromptModal();
    setActiveTab("notes");
  });
  elements.patchTabButton.addEventListener("click", () => {
    setActiveTab("patch");
  });
  elements.notesTabButton.addEventListener("click", () => {
    setActiveTab("notes");
  });
  elements.uiManagerTabButton.addEventListener("click", () => {
    setActiveTab("ui-manager");
  });
  elements.openUiManagerButton.addEventListener("click", async () => {
    openUiManagerModal();
    if (!state.uiManager.overview && state.current?.gameDirectory) {
      await loadUiManagerOverview();
    } else {
      renderUiManager();
    }
  });
  elements.uiManagerRefreshButton.addEventListener("click", async () => {
    await loadUiManagerOverview();
  });
  elements.uiManagerModalRefreshButton.addEventListener("click", async () => {
    await loadUiManagerOverview();
  });
  elements.uiManagerRecoveryButton.addEventListener("click", () => {
    if (elements.uiManagerRecoveryButton.disabled) {
      return;
    }
    openUiManagerRecoveryModal();
  });
  elements.uiManagerCloseButton.addEventListener("click", () => {
    closeUiManagerModal();
  });
  elements.uiManagerBackdrop.addEventListener("click", () => {
    closeUiManagerModal();
  });
  elements.uiManagerRecoveryCloseButton.addEventListener("click", () => {
    closeUiManagerRecoveryModal();
  });
  elements.uiManagerRecoveryBackdrop.addEventListener("click", () => {
    closeUiManagerRecoveryModal();
  });
  elements.uiManagerImportButton.addEventListener("click", async () => {
    const result = await window.launcher.openUiManagerImportDialog();
    if (result?.canceled || !result?.sourcePath) {
      return;
    }
    await runUiManagerAction("Importing UI package folder...", () => window.launcher.importUiPackageFolder(result.sourcePath));
  });
  elements.uiManagerDropZone.addEventListener("dragover", (event) => {
    event.preventDefault();
    elements.uiManagerDropZone.classList.add("is-dragging");
  });
  elements.uiManagerDropZone.addEventListener("dragleave", () => {
    elements.uiManagerDropZone.classList.remove("is-dragging");
  });
  elements.uiManagerDropZone.addEventListener("drop", async (event) => {
    event.preventDefault();
    elements.uiManagerDropZone.classList.remove("is-dragging");
    const droppedPath = event.dataTransfer?.files?.[0]?.path;
    if (!droppedPath) {
      setUiManagerNotice("Drop a folder from your filesystem to import it.", "error");
      return;
    }
    await runUiManagerAction("Importing UI package folder...", () => window.launcher.importUiPackageFolder(droppedPath));
  });
  elements.uiManagerPackageList.addEventListener("click", async (event) => {
    closeUiManagerPackageContextMenu();
    const button = event.target.closest("button[data-package-name]");
    if (!button) {
      return;
    }
    await selectUiManagerPackage(button.dataset.packageName);
  });
  elements.uiManagerPackageList.addEventListener("contextmenu", async (event) => {
    const button = event.target.closest("button[data-package-name]");
    if (!button) {
      closeUiManagerPackageContextMenu();
      renderUiManagerPackageContextMenu();
      return;
    }

    event.preventDefault();
    await selectUiManagerPackage(button.dataset.packageName, {
      openContextMenu: true,
      contextX: event.clientX || 0,
      contextY: event.clientY || 0,
      preserveNotice: true
    });
    if (state.uiManager.selectedPackageName !== button.dataset.packageName) {
      closeUiManagerPackageContextMenu();
      renderUiManagerPackageContextMenu();
      return;
    }
  });
  elements.uiManagerPackageDetail.addEventListener("click", (event) => {
    const packageActionButton = event.target.closest("button[data-ui-manager-package-action]");
    if (packageActionButton) {
      if (packageActionButton.dataset.uiManagerPackageAction === "prepare" && state.uiManager.selectedPackageName) {
        promptUiManagerAction(
          `Prepare ${state.uiManager.selectedPackageName}? This will create a backup, normalize the folder structure, and stamp UI Meta Data.`,
          async () => {
            await runUiManagerAction(
              `Preparing ${state.uiManager.selectedPackageName}...`,
              () => window.launcher.prepareUiPackage(state.uiManager.selectedPackageName)
            );
          }
        );
      }
      return;
    }

    const button = event.target.closest("button[data-package-detail-tab]");
    if (!button) {
      return;
    }

    state.uiManager.packageDetailTab = button.dataset.packageDetailTab === "files" ? "files" : "overview";
    renderUiManagerPackageDetail();
  });
  elements.uiManagerPackageContextMenu.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-ui-manager-package-context-action]");
    if (!button) {
      return;
    }

    const packageName = button.dataset.packageName || state.uiManager.packageContextPackageName;
    closeUiManagerPackageContextMenu();
    renderUiManagerPackageContextMenu();
    if (button.dataset.uiManagerPackageContextAction === "validate-comments" && packageName) {
      await promptUiManagerAction(
        `Validate UI Meta Data in ${packageName}? This will scan the Options folder recursively, create a backup, and correct any invalid first-line UI Meta Data entries.`,
        async () => {
          await runUiManagerAction(
            `Validating UI Meta Data in ${packageName}...`,
            () => window.launcher.validateUiPackageOptionComments(packageName)
          );
        }
      );
    }
  });
  elements.uiManagerStageTabs.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-ui-manager-stage]");
    if (!button) {
      return;
    }

    if (button.getAttribute("aria-disabled") === "true") {
      return;
    }

    setUiManagerActiveStage(button.dataset.uiManagerStage);
    renderUiManager();
  });
  elements.uiManagerOptionList.addEventListener("click", (event) => {
    if (event.target.closest(".ui-manager-option-toggle") || event.target.closest("input[data-option-toggle='true']")) {
      return;
    }

    const card = event.target.closest("[data-option-path]");
    if (!card) {
      return;
    }
    const bundles = Array.isArray(state.uiManager.detail?.bundles) ? state.uiManager.detail.bundles : [];
    const bundle = bundles.find((entry) => entry.optionPath === card.dataset.optionPath);
    if (!bundle) {
      return;
    }

    state.uiManager.selectedOptionPath = bundle.optionPath;
    renderUiManager();
  });
  elements.uiManagerOptionList.addEventListener("change", (event) => {
    const toggleInput = event.target.closest("input[data-option-toggle='true']");
    if (!toggleInput) {
      return;
    }

    updateUiManagerStagedOptionPath(toggleInput.dataset.optionPath, Boolean(toggleInput.checked));
    renderUiManager();
  });
  elements.uiManagerOptionList.addEventListener("keydown", (event) => {
    if (event.target.closest("input[data-option-toggle='true']")) {
      return;
    }

    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    const card = event.target.closest("[data-option-path]");
    if (!card) {
      return;
    }

    event.preventDefault();
    state.uiManager.selectedOptionPath = card.dataset.optionPath;
    renderUiManager();
  });
  elements.uiManagerOptionPrevButton.addEventListener("click", () => {
    scrollUiManagerRail(elements.uiManagerOptionList, -1);
  });
  elements.uiManagerOptionNextButton.addEventListener("click", () => {
    scrollUiManagerRail(elements.uiManagerOptionList, 1);
  });
  elements.uiManagerTargetSearchInput.addEventListener("input", (event) => {
    state.uiManager.targetSearchQuery = event.target.value || "";
    renderUiManager();
  });
  elements.uiManagerTargetServerFilter.addEventListener("change", (event) => {
    state.uiManager.targetServerFilter = event.target.value || "";
    renderUiManager();
  });
  elements.uiManagerTargetList.addEventListener("change", (event) => {
    const targetInput = event.target;
    if (!targetInput || targetInput.type !== "checkbox") {
      return;
    }
    toggleUiManagerTargetSelection(targetInput.value, targetInput.checked);
    renderUiManager();
  });
  elements.uiManagerBackupList.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-backup-id]");
    if (!button || !state.uiManager.selectedPackageName) {
      return;
    }
    await promptUiManagerAction(
      `Restore backup ${button.dataset.backupId}? This will replace the current package files and restore any INI snapshots captured in that backup.`,
      async () => {
        await runUiManagerAction(
          `Restoring backup ${button.dataset.backupId}...`,
          () => window.launcher.restoreUiManagerBackup({
            packageName: state.uiManager.selectedPackageName,
            backupId: button.dataset.backupId
          })
        );
      }
    );
  });
  elements.uiManagerSelectAllTargetsButton.addEventListener("click", () => {
    state.uiManager.selectedTargetPaths = getUiManagerTargets().map((entry) => entry.path);
    renderUiManager();
  });
  elements.uiManagerClearTargetsButton.addEventListener("click", () => {
    state.uiManager.selectedTargetPaths = [];
    renderUiManager();
  });
  elements.uiManagerPreviousStageButton.addEventListener("click", () => {
    const previousStage = getUiManagerAdjacentStage(-1);
    if (!previousStage) {
      return;
    }

    setUiManagerActiveStage(previousStage);
    renderUiManager();
  });
  elements.uiManagerNextStageButton.addEventListener("click", () => {
    const nextStage = getUiManagerAdjacentStage(1);
    if (!nextStage || !canUiManagerOpenStage(nextStage)) {
      return;
    }

    setUiManagerActiveStage(nextStage);
    renderUiManager();
  });
  elements.uiManagerApplyOptionButton.addEventListener("click", async () => {
    const diff = buildUiManagerConfirmationDiff();
    const pendingComponentChanges = Array.isArray(diff.componentChanges)
      ? diff.componentChanges.filter((entry) => entry.toPath)
      : [];
    const pendingSkinChanges = Array.isArray(diff.skinChanges) ? diff.skinChanges : [];
    if (!state.uiManager.selectedPackageName || (!pendingComponentChanges.length && !pendingSkinChanges.length)) {
      return;
    }

    const pendingOptionPaths = pendingComponentChanges.map((entry) => entry.toPath);
    const batchSuffix = pendingSkinChanges.length
      ? ` Selected characters will also switch to UISkin=${state.uiManager.selectedPackageName}.`
      : "";
    const applyLabel = pendingComponentChanges.length
      ? pendingComponentChanges.length === 1
        ? `1 component change (${pendingComponentChanges[0].groupLabel})`
        : `${pendingComponentChanges.length} component changes`
      : pendingSkinChanges.length === 1
        ? "1 UISkin change"
        : `${pendingSkinChanges.length} UISkin changes`;
    await promptUiManagerAction(
      `Apply ${applyLabel} in ${state.uiManager.selectedPackageName}?${batchSuffix}`,
      async () => {
        await runUiManagerAction(
          pendingComponentChanges.length
            ? `Applying ${applyLabel}...`
            : `Applying ${applyLabel}...`,
          async () => {
            if (!pendingComponentChanges.length) {
              return window.launcher.setUiSkinTargets({
                packageName: state.uiManager.selectedPackageName,
                iniPaths: state.uiManager.selectedTargetPaths
              });
            }
            let result = null;
            for (const optionPath of pendingOptionPaths) {
              result = await window.launcher.activateUiOption({
                packageName: state.uiManager.selectedPackageName,
                optionPath,
                iniPaths: state.uiManager.selectedTargetPaths
              });
            }
            return result;
          }
        );
      }
    );
  });
  elements.uiManagerResetButton.addEventListener("click", async () => {
    if (!state.uiManager.selectedPackageName) {
      return;
    }
    await promptUiManagerAction(
      `Reset ${state.uiManager.selectedPackageName}? This will back it up, delete the current package root contents except Options, and rebuild the root from Options/Default.`,
      async () => {
        await runUiManagerAction(
          `Resetting ${state.uiManager.selectedPackageName}...`,
          () => window.launcher.resetUiPackage(state.uiManager.selectedPackageName)
        );
      }
    );
  });
  elements.uiManagerConfirmCloseButton.addEventListener("click", () => {
    closeUiManagerConfirmModal();
  });
  elements.uiManagerConfirmCancelButton.addEventListener("click", () => {
    closeUiManagerConfirmModal();
  });
  elements.uiManagerConfirmBackdrop.addEventListener("click", () => {
    closeUiManagerConfirmModal();
  });
  elements.uiManagerConfirmAcceptButton.addEventListener("click", async () => {
    const action = state.uiManagerConfirmationAction;
    if (!action) {
      closeUiManagerConfirmModal();
      return;
    }
    await action();
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
  elements.notesContent.addEventListener("click", async (event) => {
    const link = event.target.closest("a");
    if (!link || !elements.notesContent.contains(link)) {
      return;
    }

    const href = normalizePatchNotesLinkHref(link.getAttribute("href"));
    if (!/^https?:\/\//i.test(href)) {
      return;
    }

    event.preventDefault();
    await window.launcher.openExternal(href);
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
  elements.launcherUpdateActionButton.addEventListener("click", async () => {
    const action = elements.launcherUpdateActionButton.dataset.action;
    if (action === "download") {
      await startLauncherUpdateDownloadFlow(state.current?.launcherUpdate?.latestVersion);
      return;
    }

    if (action === "apply") {
      const result = await window.launcher.applyLauncherUpdate();
      if (result?.state) {
        renderState(result.state);
      }
    }
  });
  elements.launcherUpdateLinkButton.addEventListener("click", async () => {
    if (state.current?.launcherUpdate?.releaseUrl) {
      await window.launcher.openExternal(state.current.launcherUpdate.releaseUrl);
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") {
      return;
    }
    if (!elements.toolsMenu.classList.contains("hidden")) {
      closeToolsMenu();
      return;
    }
    if (!elements.unsupportedClientModal.classList.contains("hidden")) {
      closeUnsupportedClientModal();
      return;
    }
    if (!elements.launcherUpdateModal.classList.contains("hidden")) {
      closeLauncherUpdateModal();
      return;
    }
    if (!elements.patchNotesPromptModal.classList.contains("hidden")) {
      dismissPatchNotesPrompt();
      return;
    }
    if (!elements.uiManagerConfirmModal.classList.contains("hidden")) {
      closeUiManagerConfirmModal();
      return;
    }
    if (!elements.uiManagerPackageContextMenu.classList.contains("hidden")) {
      closeUiManagerPackageContextMenu();
      renderUiManagerPackageContextMenu();
      return;
    }
    if (!elements.uiManagerRecoveryModal.classList.contains("hidden")) {
      closeUiManagerRecoveryModal();
      return;
    }
    if (!elements.uiManagerModal.classList.contains("hidden")) {
      closeUiManagerModal();
      return;
    }
    if (!elements.settingsModal.classList.contains("hidden")) {
      closeSettingsModal();
    }
  });
  document.addEventListener("click", (event) => {
    if (event.target.closest(".tools-menu")) {
      return;
    }
    closeToolsMenu();
    if (event.target.closest("#uiManagerPackageContextMenu")) {
      return;
    }
    if (!elements.uiManagerPackageContextMenu.classList.contains("hidden")) {
      closeUiManagerPackageContextMenu();
      renderUiManagerPackageContextMenu();
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
  updatePatchNotesAttention();
  setActiveTab("patch");
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
