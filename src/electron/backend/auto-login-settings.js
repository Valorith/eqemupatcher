// Shared defaults and validation for the Windows auto-login helper
// (src/electron/assets/auto-login/Invoke-EqAutoLogin.ps1). The helper embeds the
// same defaults; keep the two tables in sync.

const AUTO_LOGIN_LAYOUT_MODES = ["fit", "centered", "stretch"];

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
  uiLayoutMode: "fit",
  uiLayoutWidth: 1024,
  uiLayoutHeight: 768,
  points: Object.freeze({
    eulaAccept: [0.661, 0.757],
    splashContinue: [0.5, 0.5],
    mainMenuLogin: [0.497, 0.456],
    mainMenuPasswordField: [0.497, 0.486],
    mainMenuLoginButton: [0.497, 0.526],
    mainMenuExitButton: [0.497, 0.6],
    loginErrorButton: [0.49, 0.61],
    loginErrorBorder: [0.49, 0.59],
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
  "uiLayoutMode: 'fit' shrinks a 1024x768 login canvas to fit the client area (default), 'centered' assumes a fixed 1024x768 canvas centred in the client (clipped when smaller), 'stretch' assumes the canvas fills the client.",
  "points: [x, y] ratios (0-1) inside that canvas for each click/probe target."
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

const AUTO_LOGIN_HELPER_TIMEOUT_MARGIN_MS = 20 * 1000;
const AUTO_LOGIN_HELPER_MINIMUM_TIMEOUT_MS = 60 * 1000;
const AUTO_LOGIN_CREDENTIAL_CHARACTER_ESTIMATE = 96;

// The helper owns per-stage timeouts; the backend's wall-clock guard must exceed their sum
// or slow machines get killed before any stage can report which step stalled.
function computeAutoLoginHelperTimeoutMs(rawSettings, options = {}) {
  const settings = normalizeAutoLoginSettings(rawSettings);
  const enterWorld = options.enterWorld === true;
  const stageSeconds = settings.windowWaitSeconds
    + settings.preLoginWaitSeconds
    + settings.loginFormWaitSeconds
    + settings.loginOutcomeWaitSeconds
    + (enterWorld ? settings.serverSelectWaitSeconds : 0)
    + (settings.focusWaitSeconds * 2);
  const typingMs = settings.credentialAttempts * (
    ((settings.credentialClearBackspaceCount * 2) + AUTO_LOGIN_CREDENTIAL_CHARACTER_ESTIMATE) * settings.keyDelayMs
    + (settings.credentialFocusDelayMs * 2)
  ) + settings.postPasswordDelayMs;

  return Math.max(
    AUTO_LOGIN_HELPER_MINIMUM_TIMEOUT_MS,
    (stageSeconds * 1000) + typingMs + AUTO_LOGIN_HELPER_TIMEOUT_MARGIN_MS
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

function createAutoLoginSettingsFileContent() {
  return `${JSON.stringify({
    _help: AUTO_LOGIN_SETTINGS_FILE_HELP,
    ...normalizeAutoLoginSettings(AUTO_LOGIN_DEFAULT_SETTINGS)
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
