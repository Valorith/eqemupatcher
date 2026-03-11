const path = require("path");
const { spawn } = require("child_process");

const electronBinary = require("electron");

const entryPath = process.argv[2] || "src/electron/main.js";
const rootDir = path.resolve(__dirname, "..");
const resolvedEntryPath = path.resolve(rootDir, entryPath);

const child = spawn(electronBinary, [resolvedEntryPath], {
  cwd: rootDir,
  env: {
    ...process.env,
    ELECTRON_ENABLE_LOGGING: process.env.ELECTRON_ENABLE_LOGGING || "1",
    ELECTRON_ENABLE_STACK_DUMPING: process.env.ELECTRON_ENABLE_STACK_DUMPING || "1"
  },
  stdio: "inherit"
});

child.on("error", (error) => {
  console.error(error.message);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
