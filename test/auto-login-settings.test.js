const test = require("node:test");
const assert = require("node:assert/strict");

const {
  AUTO_LOGIN_DEFAULT_SETTINGS,
  buildAutoLoginHelperArgs,
  computeAutoLoginHelperTimeoutMs,
  createAutoLoginSettingsFileContent,
  encodeAutoLoginSettings,
  isDefaultAutoLoginSettings,
  normalizeAutoLoginSettings
} = require("../src/electron/backend/auto-login-settings");

test("normalizeAutoLoginSettings returns defaults for missing or malformed input", () => {
  for (const input of [undefined, null, "", 42, [], "nope", { points: "bad" }]) {
    const settings = normalizeAutoLoginSettings(input);
    assert.equal(settings.windowWaitSeconds, 45);
    assert.equal(settings.uiLayoutMode, "fit");
    assert.deepEqual(settings.points.eulaAccept, [0.661, 0.757]);
    assert.equal(isDefaultAutoLoginSettings(settings), true);
  }
});

test("normalizeAutoLoginSettings clamps, coerces and validates every field", () => {
  const settings = normalizeAutoLoginSettings({
    windowWaitSeconds: 9999,
    preLoginWaitSeconds: -4,
    keyDelayMs: "12.6",
    focusWaitSeconds: "abc",
    credentialAttempts: 0,
    probeRadiusPx: 3.2,
    uiLayoutMode: " STRETCH ",
    uiLayoutWidth: 10,
    points: {
      eulaAccept: { x: 0.25, y: 0.75 },
      splashContinue: [2, 2],
      usernameField: ["0.4", "0.5"],
      passwordField: [0.1],
      unknownPoint: [0.5, 0.5]
    }
  });

  assert.equal(settings.windowWaitSeconds, 300);
  assert.equal(settings.preLoginWaitSeconds, 1);
  assert.equal(settings.keyDelayMs, 13);
  assert.equal(settings.focusWaitSeconds, 10);
  assert.equal(settings.credentialAttempts, 1);
  assert.equal(settings.probeRadiusPx, 3);
  assert.equal(settings.uiLayoutMode, "stretch");
  assert.equal(settings.uiLayoutWidth, 320);
  assert.deepEqual(settings.points.eulaAccept, [0.25, 0.75]);
  assert.deepEqual(settings.points.splashContinue, [0.5, 0.5], "out-of-range ratios fall back");
  assert.deepEqual(settings.points.usernameField, [0.4, 0.5]);
  assert.deepEqual(settings.points.passwordField, [0.56, 0.474]);
  assert.equal(Object.hasOwn(settings.points, "unknownPoint"), false);
  assert.equal(isDefaultAutoLoginSettings(settings), false);
});

test("normalizeAutoLoginSettings rejects unknown layout modes", () => {
  assert.equal(normalizeAutoLoginSettings({ uiLayoutMode: "diagonal" }).uiLayoutMode, "fit");
  assert.equal(normalizeAutoLoginSettings({ uiLayoutMode: "Centered" }).uiLayoutMode, "centered");
});

test("computeAutoLoginHelperTimeoutMs always exceeds the summed stage budgets", () => {
  const defaults = computeAutoLoginHelperTimeoutMs(AUTO_LOGIN_DEFAULT_SETTINGS, { enterWorld: false });
  const withServerSelect = computeAutoLoginHelperTimeoutMs(AUTO_LOGIN_DEFAULT_SETTINGS, { enterWorld: true });
  // Stage deadlines plus every foreground wait that can run outside them: initial focus,
  // submit focus, 2 per credential field per attempt (2 fields x 2 attempts), and one
  // overrun per polling stage (pre-login, login form, login outcome).
  const worstCaseFocusWaits = 1 + 1 + (2 * 2 * 2) + 3;
  const summedStagesMs = (45 + 25 + 30 + 10 + (10 * worstCaseFocusWaits)) * 1000;

  assert.ok(defaults > summedStagesMs, `${defaults} > ${summedStagesMs}`);
  // Enter world adds the server-select deadline, the Play focus wait and one more polling overrun.
  assert.equal(withServerSelect - defaults, (15 + 10 + 10) * 1000);
  assert.ok(
    computeAutoLoginHelperTimeoutMs({ credentialAttempts: 3 }) - computeAutoLoginHelperTimeoutMs({ credentialAttempts: 2 }) >= 4 * 10 * 1000,
    "each extra credential attempt budgets its four focus waits"
  );
  assert.ok(computeAutoLoginHelperTimeoutMs({ windowWaitSeconds: 1, preLoginWaitSeconds: 1, loginFormWaitSeconds: 1, loginOutcomeWaitSeconds: 1, focusWaitSeconds: 1 }) >= 60 * 1000, "never shorter than the historical 60s guard");
  assert.ok(computeAutoLoginHelperTimeoutMs({ windowWaitSeconds: 300 }) > 300 * 1000);
  assert.ok(computeAutoLoginHelperTimeoutMs({ keyDelayMs: 250, credentialAttempts: 5 }) > computeAutoLoginHelperTimeoutMs({ keyDelayMs: 8 }), "slow typing widens the guard");
});

test("buildAutoLoginHelperArgs encodes settings and never includes the password", () => {
  const args = buildAutoLoginHelperArgs({
    helperPath: "C:\\helper\\Invoke-EqAutoLogin.ps1",
    eqGamePath: "C:\\EQ\\eqgame.exe",
    username: "vayle2",
    settings: { keyDelayMs: 20 },
    enterWorld: true
  });

  assert.deepEqual(args.slice(0, 6), ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", "C:\\helper\\Invoke-EqAutoLogin.ps1"]);
  assert.equal(args[args.indexOf("-EqGamePath") + 1], "C:\\EQ\\eqgame.exe");
  assert.equal(args[args.indexOf("-Username") + 1], "vayle2");
  assert.equal(args[args.length - 1], "-EnterWorld");
  const encoded = args[args.indexOf("-SettingsBase64") + 1];
  assert.match(encoded, /^[A-Za-z0-9+/]+=*$/);
  assert.equal(encoded, encodeAutoLoginSettings({ keyDelayMs: 20 }));
  const decoded = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
  assert.equal(decoded.keyDelayMs, 20);
  assert.equal(decoded.windowWaitSeconds, 45);
  assert.equal(buildAutoLoginHelperArgs({ helperPath: "h", eqGamePath: "e", username: "u", settings: {} }).includes("-EnterWorld"), false);
});

test("createAutoLoginSettingsFileContent is valid JSON that round-trips to defaults", () => {
  const content = createAutoLoginSettingsFileContent();
  const parsed = JSON.parse(content);
  assert.match(parsed._help, /uiLayoutMode/);
  assert.equal(isDefaultAutoLoginSettings(parsed), true);
  assert.ok(content.endsWith("\n"));
});

test("the generated settings file lists defaults without pinning them", () => {
  const parsed = JSON.parse(createAutoLoginSettingsFileContent());
  assert.deepEqual(Object.keys(parsed).sort(), ["_defaults", "_help"]);
  assert.deepEqual(parsed._defaults, normalizeAutoLoginSettings({}));

  // A later release changing a default must reach users who never edited the file.
  const tunedDefault = normalizeAutoLoginSettings({ ...parsed, windowWaitSeconds: undefined });
  assert.equal(tunedDefault.windowWaitSeconds, AUTO_LOGIN_DEFAULT_SETTINGS.windowWaitSeconds);
  assert.equal(normalizeAutoLoginSettings({ ...parsed, windowWaitSeconds: 90 }).windowWaitSeconds, 90, "top-level keys still override");
});
