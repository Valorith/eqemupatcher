const crypto = require("crypto");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const zlib = require("zlib");
const SimpleYaml = require("../../electron/backend/simple-yaml");

const LEGACY_SKIP_PATTERNS = [
  "eqemupatcher.exe",
  ".gitignore",
  ".DS_Store",
  "filelistbuilder",
  "filelist",
  "ignore.txt"
];

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      if ((value & 1) === 1) {
        value = 0xedb88320 ^ (value >>> 1);
      } else {
        value >>>= 1;
      }
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function formatDate(value) {
  const year = value.getFullYear();
  const month = `${value.getMonth() + 1}`.padStart(2, "0");
  const day = `${value.getDate()}`.padStart(2, "0");
  return `${year}${month}${day}`;
}

function formatLegacyScalar(value) {
  if (typeof value === "number") {
    return String(value);
  }

  const text = String(value ?? "");
  if (text === "") {
    return '""';
  }

  if (/^[A-Za-z0-9_./:\\-]+$/.test(text)) {
    return text;
  }

  return JSON.stringify(text);
}

function shouldSkipLegacyPath(relativePath) {
  if (relativePath === "patch.zip") {
    return true;
  }

  return LEGACY_SKIP_PATTERNS.some((pattern) => relativePath.includes(pattern));
}

function parseLegacyListText(text) {
  const entries = [];
  for (const rawLine of String(text || "").replace(/\r\n/g, "\n").split("\n")) {
    if (rawLine.length === 0) {
      continue;
    }

    let value = rawLine;
    const commentIndex = value.indexOf("#");
    if (commentIndex !== -1) {
      value = value.slice(0, commentIndex);
    }

    if (value.trim().length < 1) {
      continue;
    }

    entries.push({ name: value });
  }

  return entries;
}

function serializeConfig(config) {
  return SimpleYaml.stringify({
    client: config.client || "",
    downloadprefix: config.downloadprefix || ""
  });
}

function parseConfigText(text) {
  const parsed = SimpleYaml.parse(String(text || ""));
  return {
    client: String(parsed?.client || "").trim(),
    downloadprefix: String(parsed?.downloadprefix || "").trim()
  };
}

async function exists(filePath) {
  try {
    await fsp.access(filePath);
    return true;
  } catch (_error) {
    return false;
  }
}

async function readOptionalTextFile(filePath) {
  if (!(await exists(filePath))) {
    return "";
  }

  return fsp.readFile(filePath, "utf8");
}

async function getFileHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("md5");
    const stream = fs.createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function getLegacyNanosecond() {
  return Number(process.hrtime.bigint() % 1000000000n);
}

function buildLegacyVersion(downloads, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const nanosecond = Number.isInteger(options.nanosecond) ? options.nanosecond : getLegacyNanosecond();
  const hash = crypto.createHash("md5");

  hash.update(`%!i(int=${nanosecond})`);
  for (const download of downloads) {
    hash.update(download.name);
  }

  return `${formatDate(now)}${hash.digest("hex")}`;
}

async function walkLegacyDirectory(workingDirectory, visitor, relativePath = ".") {
  const fullPath = relativePath === "." ? workingDirectory : path.join(workingDirectory, relativePath);
  const stats = await fsp.lstat(fullPath);
  await visitor(relativePath, fullPath, stats);

  if (!stats.isDirectory()) {
    return;
  }

  const entries = await fsp.readdir(fullPath, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    const childRelativePath = relativePath === "." ? entry.name : path.join(relativePath, entry.name);
    await walkLegacyDirectory(workingDirectory, visitor, childRelativePath);
  }
}

async function scanLegacyWorkingDirectory(workingDirectory, options = {}) {
  const ignoreEntries = parseLegacyListText(options.ignoreText || "");
  const ignoreSet = new Set(ignoreEntries.map((entry) => entry.name));
  const deleteEntries = parseLegacyListText(options.deleteText || "");
  const includeHashes = options.includeHashes !== false;
  const downloads = [];
  let totalBytes = 0;

  await walkLegacyDirectory(workingDirectory, async (relativePath, fullPath, stats) => {
    if (relativePath !== "." && shouldSkipLegacyPath(relativePath)) {
      return;
    }

    if (!stats.isFile()) {
      return;
    }

    if (ignoreSet.has(relativePath)) {
      return;
    }

    if (relativePath === "delete.txt") {
      return;
    }

    const download = {
      name: relativePath,
      date: formatDate(stats.mtime),
      size: stats.size
    };

    if (includeHashes) {
      download.md5 = await getFileHash(fullPath);
    }

    downloads.push(download);
    totalBytes += stats.size;

    if (typeof options.onFile === "function") {
      await options.onFile(downloads.length, download);
    }
  });

  return {
    deletes: deleteEntries,
    downloads,
    totalBytes
  };
}

function buildLegacyReadme(deletes) {
  let readme = "Extract the contents of patch.zip to your root EQ directory.\r\n";
  if (deletes.length > 0) {
    readme += "Also delete the following files:\r\n";
    for (const entry of deletes) {
      readme += `${entry.name}\r\n`;
    }
  }
  return readme;
}

function formatLegacyManifest(fileList) {
  const lines = [];
  lines.push(`version: ${formatLegacyScalar(fileList.version)}`);
  if (Array.isArray(fileList.deletes) && fileList.deletes.length > 0) {
    lines.push("deletes:");
    for (const entry of fileList.deletes) {
      lines.push(`- name: ${formatLegacyScalar(entry.name)}`);
    }
  }
  lines.push(`downloadprefix: ${formatLegacyScalar(fileList.downloadprefix)}`);
  lines.push("downloads:");
  for (const entry of fileList.downloads) {
    lines.push(`- name: ${formatLegacyScalar(entry.name)}`);
    lines.push(`  md5: ${formatLegacyScalar(entry.md5)}`);
    lines.push(`  date: ${formatLegacyScalar(entry.date)}`);
    lines.push(`  size: ${entry.size}`);
  }
  return `${lines.join("\n")}\n`;
}

function getDosDateTime() {
  return { time: 0, date: 33 };
}

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) {
    value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function createZipEntryRecord(name, data) {
  const rawName = Buffer.from(name, "utf8");
  const compressed = zlib.deflateRawSync(data);
  const checksum = crc32(data);
  const { time, date } = getDosDateTime();

  const localHeader = Buffer.alloc(30);
  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(20, 4);
  localHeader.writeUInt16LE(0, 6);
  localHeader.writeUInt16LE(8, 8);
  localHeader.writeUInt16LE(time, 10);
  localHeader.writeUInt16LE(date, 12);
  localHeader.writeUInt32LE(checksum, 14);
  localHeader.writeUInt32LE(compressed.length, 18);
  localHeader.writeUInt32LE(data.length, 22);
  localHeader.writeUInt16LE(rawName.length, 26);
  localHeader.writeUInt16LE(0, 28);

  const centralHeader = Buffer.alloc(46);
  centralHeader.writeUInt32LE(0x02014b50, 0);
  centralHeader.writeUInt16LE(20, 4);
  centralHeader.writeUInt16LE(20, 6);
  centralHeader.writeUInt16LE(0, 8);
  centralHeader.writeUInt16LE(8, 10);
  centralHeader.writeUInt16LE(time, 12);
  centralHeader.writeUInt16LE(date, 14);
  centralHeader.writeUInt32LE(checksum, 16);
  centralHeader.writeUInt32LE(compressed.length, 20);
  centralHeader.writeUInt32LE(data.length, 24);
  centralHeader.writeUInt16LE(rawName.length, 28);
  centralHeader.writeUInt16LE(0, 30);
  centralHeader.writeUInt16LE(0, 32);
  centralHeader.writeUInt16LE(0, 34);
  centralHeader.writeUInt16LE(0, 36);
  centralHeader.writeUInt32LE(0, 38);

  return {
    localChunk: Buffer.concat([localHeader, rawName, compressed]),
    centralHeader,
    rawName
  };
}

function buildZipBuffer(entries) {
  const localChunks = [];
  const centralChunks = [];
  let offset = 0;

  for (const entry of entries) {
    const record = createZipEntryRecord(entry.name, entry.data);
    record.centralHeader.writeUInt32LE(offset, 42);
    localChunks.push(record.localChunk);
    centralChunks.push(record.centralHeader, record.rawName);
    offset += record.localChunk.length;
  }

  const centralDirectory = Buffer.concat(centralChunks);
  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054b50, 0);
  endRecord.writeUInt16LE(0, 4);
  endRecord.writeUInt16LE(0, 6);
  endRecord.writeUInt16LE(entries.length, 8);
  endRecord.writeUInt16LE(entries.length, 10);
  endRecord.writeUInt32LE(centralDirectory.length, 12);
  endRecord.writeUInt32LE(offset, 16);
  endRecord.writeUInt16LE(0, 20);

  return Buffer.concat([...localChunks, centralDirectory, endRecord]);
}

async function generateLegacyArtifacts(options) {
  const workingDirectory = path.resolve(options.workingDirectory);
  const config = {
    client: String(options.client || "").trim(),
    downloadprefix: String(options.downloadPrefix || "").trim()
  };

  if (!config.client) {
    throw new Error("client not set in filelistbuilder.yml");
  }

  if (!config.downloadprefix) {
    throw new Error("downloadprefix not set in filelistbuilder.yml");
  }

  const scanResult = await scanLegacyWorkingDirectory(workingDirectory, {
    ignoreText: options.ignoreText || "",
    deleteText: options.deleteText || "",
    includeHashes: true,
    onFile: options.onFile
  });

  if (scanResult.downloads.length === 0) {
    throw new Error("No files found in directory");
  }

  const fileList = {
    version: buildLegacyVersion(scanResult.downloads, options.versionSeed),
    deletes: scanResult.deletes,
    downloadprefix: config.downloadprefix,
    downloads: scanResult.downloads
  };

  const manifestText = formatLegacyManifest(fileList);
  const manifestPath = path.join(workingDirectory, `filelist_${config.client}.yml`);
  const patchZipPath = path.join(workingDirectory, "patch.zip");

  const zipEntries = [];
  for (const entry of fileList.downloads) {
    zipEntries.push({
      name: entry.name,
      data: await fsp.readFile(path.join(workingDirectory, entry.name))
    });
  }

  zipEntries.push({
    name: "README.txt",
    data: Buffer.from(buildLegacyReadme(fileList.deletes), "utf8")
  });

  await fsp.writeFile(manifestPath, manifestText, "utf8");
  await fsp.writeFile(patchZipPath, buildZipBuffer(zipEntries));

  return {
    config,
    manifestPath,
    patchZipPath,
    manifestText,
    fileList,
    downloadCount: fileList.downloads.length,
    deleteCount: fileList.deletes.length,
    totalBytes: scanResult.totalBytes
  };
}

module.exports = {
  buildLegacyReadme,
  buildLegacyVersion,
  formatLegacyManifest,
  generateLegacyArtifacts,
  parseConfigText,
  parseLegacyListText,
  readOptionalTextFile,
  scanLegacyWorkingDirectory,
  serializeConfig
};
