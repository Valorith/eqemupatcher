// Shared defaults and validation for the Windows auto-login helper
// (src/electron/assets/auto-login/Invoke-EqAutoLogin.ps1). The helper embeds the
// same defaults; test/auto-login-helper.test.js fails if the two tables drift apart.

const AUTO_LOGIN_LAYOUT_MODES = ["auto", "fit", "centered", "stretch"];

const AUTO_LOGIN_DEFAULT_SETTINGS = Object.freeze({
  windowWaitSeconds: 45,
  preLoginWaitSeconds: 25,
  loginFormWaitSeconds: 30,
  loginOutcomeWaitSeconds: 10,
  serverSelectWaitSeconds: 15,
  focusWaitSeconds: 10,
  preLoginClickIntervalMs: 150,
  clickMoveDelayMs: 20,
  clickHoldDelayMs: 20,
  credentialFocusDelayMs: 120,
  keyDelayMs: 8,
  postPasswordDelayMs: 150,
  loginOutcomeMinimumAgeMs: 2500,
  loginOutcomeStableMs: 1200,
  credentialClearBackspaceCount: 64,
  credentialAttempts: 2,
  probeRadiusPx: 1,
  uiLayoutMode: "auto",
  uiLayoutWidth: 1024,
  uiLayoutHeight: 768,
  points: Object.freeze({
    eulaAccept: [0.661, 0.757],
    splashContinue: [0.5, 0.5],
    mainMenuLogin: [0.4023, 0.474],
    mainMenuLoginRight: [0.5781, 0.474],
    mainMenuOptions: [0.4023, 0.5391],
    mainMenuGap: [0.4023, 0.5716],
    mainMenuExit: [0.4023, 0.6042],
    mainMenuBelowExit: [0.4023, 0.6823],
    loginFormUsername: [0.5781, 0.3893],
    loginFormPassword: [0.5781, 0.474],
    loginFormLoginButton: [0.4023, 0.5391],
    loginFormGap: [0.4023, 0.5716],
    loginFormQuickConnect: [0.4023, 0.6042],
    loginFormCancel: [0.4023, 0.6823],
    loginErrorOkLeft: [0.4609, 0.6081],
    loginErrorOkRight: [0.5391, 0.6081],
    loginErrorText: [0.5586, 0.5326],
    loginErrorLeftOfOk: [0.4219, 0.6081],
    loginErrorRightOfOk: [0.5781, 0.6081],
    usernameField: [0.56, 0.39],
    passwordField: [0.56, 0.474],
    serverSelectPlay: [0.724, 0.7]
  })
});

const AUTO_LOGIN_SETTING_RANGES = Object.freeze({
  windowWaitSeconds: [1, 300],
  preLoginWaitSeconds: [1, 120],
  loginFormWaitSeconds: [1, 120],
  loginOutcomeWaitSeconds: [1, 120],
  serverSelectWaitSeconds: [1, 120],
  focusWaitSeconds: [1, 60],
  preLoginClickIntervalMs: [50, 5000],
  clickMoveDelayMs: [0, 1000],
  clickHoldDelayMs: [0, 1000],
  credentialFocusDelayMs: [0, 2000],
  keyDelayMs: [0, 250],
  postPasswordDelayMs: [0, 2000],
  loginOutcomeMinimumAgeMs: [0, 30000],
  loginOutcomeStableMs: [100, 30000],
  credentialClearBackspaceCount: [0, 256],
  credentialAttempts: [1, 5],
  probeRadiusPx: [0, 8],
  uiLayoutWidth: [320, 8192],
  uiLayoutHeight: [240, 8192]
});

const AUTO_LOGIN_SETTINGS_FILE_HELP = [
  "Advanced tuning for the EverQuest auto-login helper. Every value is optional and is clamped to a safe range.",
  "Timing values are seconds (…Seconds) or milliseconds (…Ms).",
  "uiLayoutMode: 'auto' (default) follows how EverQuest lays out its login windows: each at native size, centred, pinned to the top/left when the window is larger than the client, and adjusted for Windows display scaling. Legacy overrides: 'fit' shrinks a 1024x768 canvas to fit the client, 'centered' centres a fixed 1024x768 canvas, 'stretch' makes the canvas fill the client.",
  "points: [x, y] ratios (0-1) inside the 1024x768 reference canvas for each click/probe target.",
  "Only top-level keys are applied: copy a key from _defaults up one level to override it. Keys you leave out follow the launcher's built-in defaults, which may improve between releases."
].join(" ");

function clampInteger(value, [minimum, maximum], fallback) {
  if (value == null || value === "") {
    return fallback;
  }

  const parsed = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(maximum, Math.max(minimum, Math.round(parsed)));
}

function normalizeRatioPoint(value, fallback) {
  let x;
  let y;
  if (Array.isArray(value) && value.length >= 2) {
    [x, y] = value;
  } else if (value && typeof value === "object") {
    ({ x, y } = value);
  } else {
    return [...fallback];
  }

  const parsedX = Number(x);
  const parsedY = Number(y);
  if (!Number.isFinite(parsedX) || !Number.isFinite(parsedY)) {
    return [...fallback];
  }
  if (parsedX < -0.5 || parsedX > 1.5 || parsedY < -0.5 || parsedY > 1.5) {
    return [...fallback];
  }

  return [parsedX, parsedY];
}

function normalizeAutoLoginSettings(raw) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const settings = {};

  for (const [key, fallback] of Object.entries(AUTO_LOGIN_DEFAULT_SETTINGS)) {
    if (key === "points") {
      continue;
    }

    if (key === "uiLayoutMode") {
      const candidate = String(source[key] ?? "").trim().toLowerCase();
      settings[key] = AUTO_LOGIN_LAYOUT_MODES.includes(candidate) ? candidate : fallback;
      continue;
    }

    settings[key] = clampInteger(source[key], AUTO_LOGIN_SETTING_RANGES[key], fallback);
  }

  const rawPoints = source.points && typeof source.points === "object" ? source.points : {};
  settings.points = {};
  for (const [name, fallback] of Object.entries(AUTO_LOGIN_DEFAULT_SETTINGS.points)) {
    settings.points[name] = normalizeRatioPoint(rawPoints[name], fallback);
  }

  return settings;
}

function isDefaultAutoLoginSettings(settings) {
  return JSON.stringify(normalizeAutoLoginSettings(settings)) === JSON.stringify(normalizeAutoLoginSettings(AUTO_LOGIN_DEFAULT_SETTINGS));
}

// Covers PowerShell start-up and the helper's Add-Type compile.
const AUTO_LOGIN_HELPER_TIMEOUT_MARGIN_MS = 20 * 1000;
const AUTO_LOGIN_HELPER_MINIMUM_TIMEOUT_MS = 60 * 1000;
const AUTO_LOGIN_CREDENTIAL_CHARACTER_ESTIMATE = 96;
// Mirrors $WindowReacquireGraceMs in the helper; allow for EQ recreating its window twice.
const AUTO_LOGIN_WINDOW_REACQUIRE_ALLOWANCE_MS = 2 * 3000;

// Every foreground wait the helper can make outside a stage deadline, each bounded by
// focusWaitSeconds: the initial launch focus, the login submit focus, the Play EverQuest
// focus (enter world), two per credential field per attempt, and one overrun per polling
// stage (each poll starts with a foreground wait that may begin just before the deadline).
function countAutoLoginFocusWaits(settings, enterWorld) {
  const pollingStages = enterWorld ? 4 : 3;
  const credentialWaits = settings.credentialAttempts * 2 * 2;
  return 2 + (enterWorld ? 1 : 0) + credentialWaits + pollingStages;
}

// The helper owns per-stage timeouts; the backend's wall-clock guard must exceed their
// worst-case sum or slow machines get killed before any stage can report which step stalled.
function computeAutoLoginHelperTimeoutMs(rawSettings, options = {}) {
  const settings = normalizeAutoLoginSettings(rawSettings);
  const enterWorld = options.enterWorld === true;
  const stageSeconds = settings.windowWaitSeconds
    + settings.preLoginWaitSeconds
    + settings.loginFormWaitSeconds
    + settings.loginOutcomeWaitSeconds
    + (enterWorld ? settings.serverSelectWaitSeconds : 0)
    + (settings.focusWaitSeconds * countAutoLoginFocusWaits(settings, enterWorld));
  const typingMs = settings.credentialAttempts * (
    ((settings.credentialClearBackspaceCount * 2) + AUTO_LOGIN_CREDENTIAL_CHARACTER_ESTIMATE) * settings.keyDelayMs
    + (settings.credentialFocusDelayMs * 2)
  ) + settings.postPasswordDelayMs;

  return Math.max(
    AUTO_LOGIN_HELPER_MINIMUM_TIMEOUT_MS,
    (stageSeconds * 1000) + typingMs + AUTO_LOGIN_WINDOW_REACQUIRE_ALLOWANCE_MS + AUTO_LOGIN_HELPER_TIMEOUT_MARGIN_MS
  );
}

function encodeAutoLoginSettings(rawSettings) {
  return Buffer.from(JSON.stringify(normalizeAutoLoginSettings(rawSettings)), "utf8").toString("base64");
}

function buildAutoLoginHelperArgs({ helperPath, eqGamePath, username, settings, enterWorld = false }) {
  const args = [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    helperPath,
    "-EqGamePath",
    eqGamePath,
    "-Username",
    username,
    "-SettingsBase64",
    encodeAutoLoginSettings(settings)
  ];
  if (enterWorld) {
    args.push("-EnterWorld");
  }

  return args;
}

// The generated file lists the defaults for reference only, so untouched installs keep
// following the built-in defaults when a later release tunes them.
function createAutoLoginSettingsFileContent() {
  return `${JSON.stringify({
    _help: AUTO_LOGIN_SETTINGS_FILE_HELP,
    _defaults: normalizeAutoLoginSettings(AUTO_LOGIN_DEFAULT_SETTINGS)
  }, null, 2)}\n`;
}

module.exports = {
  AUTO_LOGIN_DEFAULT_SETTINGS,
  AUTO_LOGIN_LAYOUT_MODES,
  AUTO_LOGIN_SETTING_RANGES,
  buildAutoLoginHelperArgs,
  computeAutoLoginHelperTimeoutMs,
  createAutoLoginSettingsFileContent,
  encodeAutoLoginSettings,
  isDefaultAutoLoginSettings,
  normalizeAutoLoginSettings
};
