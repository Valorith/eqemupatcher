const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const {
  AUTO_LOGIN_DEFAULT_SETTINGS,
  AUTO_LOGIN_LAYOUT_MODES,
  AUTO_LOGIN_SETTING_RANGES
} = require("../src/electron/backend/auto-login-settings");

const TEST_SCRIPT = path.join(__dirname, "auto-login-helper.tests.ps1");
const HELPER_SCRIPT = path.join(__dirname, "..", "src", "electron", "assets", "auto-login", "Invoke-EqAutoLogin.ps1");
// Windows PowerShell 5.1 defaults to the Restricted policy on client editions; the launcher
// passes the same flag when it runs the helper.
const POWERSHELL_ARGS = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass"];

function findPowerShell() {
  const candidates = process.env.EQ_AUTOLOGIN_PWSH
    ? [process.env.EQ_AUTOLOGIN_PWSH]
    : ["pwsh", "powershell"];
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, [...POWERSHELL_ARGS, "-Command", "$PSVersionTable.PSVersion.Major"], {
      encoding: "utf8",
      timeout: 30000,
      windowsHide: true
    });
    if (!probe.error && probe.status === 0 && /^\d+/.test(String(probe.stdout).trim())) {
      return candidate;
    }
  }
  return null;
}

function toPlainJson(value) {
  return JSON.parse(JSON.stringify(value));
}

test("auto-login helper pure logic (PowerShell)", (t) => {
  const powershell = findPowerShell();
  if (!powershell) {
    t.skip("PowerShell (pwsh or powershell) is not available; set EQ_AUTOLOGIN_PWSH to point at one.");
    return;
  }

  const result = spawnSync(powershell, [...POWERSHELL_ARGS, "-File", TEST_SCRIPT], {
    encoding: "utf8",
    timeout: 120000,
    windowsHide: true
  });

  const output = `${result.stdout || ""}${result.stderr || ""}`;
  const failures = output.split(/\r?\n/).filter((line) => line.startsWith("not ok"));
  assert.equal(result.status, 0, `PowerShell tests failed:\n${output}`);
  assert.deepEqual(failures, [], output);
  assert.match(output, /# passes [1-9]\d*/);
});

test("auto-login helper defaults and ranges match auto-login-settings.js", (t) => {
  const powershell = findPowerShell();
  if (!powershell) {
    t.skip("PowerShell (pwsh or powershell) is not available; set EQ_AUTOLOGIN_PWSH to point at one.");
    return;
  }

  const helperPath = HELPER_SCRIPT.replace(/'/g, "''");
  const command = `. '${helperPath}'; [ordered]@{ defaults = $AutoLoginDefaultSettings; ranges = $AutoLoginSettingRanges; modes = $AutoLoginLayoutModes } | ConvertTo-Json -Depth 6 -Compress`;
  const result = spawnSync(powershell, [...POWERSHELL_ARGS, "-Command", command], {
    encoding: "utf8",
    timeout: 120000,
    windowsHide: true
  });

  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  const jsonLine = String(result.stdout).trim().split(/\r?\n/).pop();
  const helperTables = JSON.parse(jsonLine);
  assert.deepEqual(helperTables.defaults, toPlainJson(AUTO_LOGIN_DEFAULT_SETTINGS));
  assert.deepEqual(helperTables.ranges, toPlainJson(AUTO_LOGIN_SETTING_RANGES));
  assert.deepEqual(helperTables.modes, [...AUTO_LOGIN_LAYOUT_MODES]);
});
