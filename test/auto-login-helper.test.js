const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const TEST_SCRIPT = path.join(__dirname, "auto-login-helper.tests.ps1");

function findPowerShell() {
  const candidates = process.env.EQ_AUTOLOGIN_PWSH
    ? [process.env.EQ_AUTOLOGIN_PWSH]
    : ["pwsh", "powershell"];
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ["-NoProfile", "-NonInteractive", "-Command", "$PSVersionTable.PSVersion.Major"], {
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

test("auto-login helper pure logic (PowerShell)", (t) => {
  const powershell = findPowerShell();
  if (!powershell) {
    t.skip("PowerShell (pwsh or powershell) is not available; set EQ_AUTOLOGIN_PWSH to point at one.");
    return;
  }

  const result = spawnSync(powershell, ["-NoProfile", "-NonInteractive", "-File", TEST_SCRIPT], {
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
