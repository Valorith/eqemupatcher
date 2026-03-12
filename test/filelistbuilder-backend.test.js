const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");

const {
  buildLegacyReadme,
  buildLegacyVersion,
  generateLegacyArtifacts,
  scanLegacyWorkingDirectory
} = require("../src/filelistbuilder-electron/backend/legacy-filelistbuilder");

async function createTempDir(prefix) {
  return fsp.mkdtemp(path.join(os.tmpdir(), prefix));
}

function md5(value) {
  return crypto.createHash("md5").update(value).digest("hex");
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractZipEntries(buffer) {
  const entries = [];
  let offset = 0;

  while (offset + 4 <= buffer.length) {
    const signature = buffer.readUInt32LE(offset);
    if (signature !== 0x04034b50) {
      break;
    }

    const compression = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const fileNameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const fileNameStart = offset + 30;
    const fileNameEnd = fileNameStart + fileNameLength;
    const dataStart = fileNameEnd + extraLength;
    const dataEnd = dataStart + compressedSize;
    const fileName = buffer.slice(fileNameStart, fileNameEnd).toString("utf8");
    const compressedData = buffer.slice(dataStart, dataEnd);
    const data = compression === 8 ? zlib.inflateRawSync(compressedData) : compressedData;

    entries.push({ name: fileName, data });
    offset = dataEnd;
  }

  return entries;
}

test("scanLegacyWorkingDirectory applies legacy ignore and skip rules", async (t) => {
  const workingDirectory = await createTempDir("filelistbuilder-scan-");
  t.after(async () => {
    await fsp.rm(workingDirectory, { recursive: true, force: true });
  });

  await fsp.writeFile(path.join(workingDirectory, "keep.txt"), "keep", "utf8");
  await fsp.writeFile(path.join(workingDirectory, "ignore.txt"), "ignored.txt\n", "utf8");
  await fsp.writeFile(path.join(workingDirectory, "ignored.txt"), "ignored", "utf8");
  await fsp.writeFile(path.join(workingDirectory, "delete.txt"), "old.txt\n", "utf8");
  await fsp.writeFile(path.join(workingDirectory, "filelistbuilder.yml"), "client: rof\n", "utf8");
  await fsp.writeFile(path.join(workingDirectory, "filelist_rof.yml"), "old", "utf8");
  await fsp.writeFile(path.join(workingDirectory, "eqemupatcher.exe"), "old", "utf8");
  await fsp.mkdir(path.join(workingDirectory, "nested"));
  await fsp.writeFile(path.join(workingDirectory, "nested", "asset.txt"), "asset", "utf8");

  const result = await scanLegacyWorkingDirectory(workingDirectory, {
    ignoreText: await fsp.readFile(path.join(workingDirectory, "ignore.txt"), "utf8"),
    deleteText: await fsp.readFile(path.join(workingDirectory, "delete.txt"), "utf8"),
    includeHashes: false
  });

  assert.deepEqual(
    result.downloads.map((entry) => entry.name),
    ["keep.txt", path.join("nested", "asset.txt")]
  );
  assert.deepEqual(result.deletes, [{ name: "old.txt" }]);
});

test("generateLegacyArtifacts writes a legacy-compatible manifest and patch archive", async (t) => {
  const workingDirectory = await createTempDir("filelistbuilder-generate-");
  t.after(async () => {
    await fsp.rm(workingDirectory, { recursive: true, force: true });
  });

  await fsp.mkdir(path.join(workingDirectory, "Resources"));
  await fsp.writeFile(path.join(workingDirectory, "root.txt"), "root payload", "utf8");
  await fsp.writeFile(path.join(workingDirectory, "Resources", "asset.txt"), "legacy asset", "utf8");

  const seed = {
    now: new Date("2026-03-11T15:16:17.000Z"),
    nanosecond: 123456789
  };

  const result = await generateLegacyArtifacts({
    workingDirectory,
    client: "rof",
    downloadPrefix: "https://example.com/patch/rof/",
    ignoreText: "",
    deleteText: "oldfile.txt\n",
    versionSeed: seed
  });

  const expectedNames = [path.join("Resources", "asset.txt"), "root.txt"];
  const expectedVersion = buildLegacyVersion(expectedNames.map((name) => ({ name })), seed);

  assert.equal(result.fileList.version, expectedVersion);
  assert.match(result.manifestText, new RegExp(`^version: ${expectedVersion}$`, "m"));
  assert.match(result.manifestText, /^deletes:\n- name: oldfile\.txt$/m);
  assert.match(result.manifestText, /^downloadprefix: https:\/\/example\.com\/patch\/rof\/$/m);
  assert.match(result.manifestText, new RegExp(`^- name: ${escapeRegex(path.join("Resources", "asset.txt"))}$`, "m"));
  assert.match(result.manifestText, /^  md5: [0-9a-f]{32}$/m);
  assert.match(result.manifestText, /^  size: 12$/m);

  const zipEntries = extractZipEntries(await fsp.readFile(result.patchZipPath));
  assert.deepEqual(zipEntries.map((entry) => entry.name), [...expectedNames, "README.txt"]);
  assert.equal(zipEntries[0].data.toString("utf8"), "legacy asset");
  assert.equal(zipEntries[1].data.toString("utf8"), "root payload");
  assert.equal(zipEntries[2].data.toString("utf8"), buildLegacyReadme([{ name: "oldfile.txt" }]));
});

test("generateLegacyArtifacts preserves lower-case legacy hashes", async (t) => {
  const workingDirectory = await createTempDir("filelistbuilder-hash-");
  t.after(async () => {
    await fsp.rm(workingDirectory, { recursive: true, force: true });
  });

  await fsp.writeFile(path.join(workingDirectory, "asset.txt"), "payload", "utf8");

  const result = await generateLegacyArtifacts({
    workingDirectory,
    client: "rof",
    downloadPrefix: "https://example.com/patch/rof/",
    ignoreText: "",
    deleteText: ""
  });

  assert.equal(result.fileList.downloads[0].md5, md5("payload"));
});
