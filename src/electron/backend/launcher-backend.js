const crypto = require("crypto");
const dgram = require("dgram");
const fs = require("fs");
const fsp = require("fs/promises");
const net = require("net");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { pathToFileURL } = require("url");
const SimpleYaml = require("./simple-yaml");
const { DEFAULT_RELEASE_API_URL, LauncherUpdater } = require("./launcher-updater");
const { UiManager } = require("./ui-manager");

const DEFAULT_GAME_SERVER_STATUS_HOST = "76.251.85.36";
const DEFAULT_GAME_SERVER_STATUS_PORT = 9000;
const LOGIN_SERVER_SESSION_PROTOCOL_VERSION = 3;
const LOGIN_SERVER_SESSION_MAX_PACKET_SIZE = 512;
const EQ_CRC32_TABLE = createCrc32Table();

const DEFAULTS = {
  serverName: "Clumsy's World",
  filelistUrl: "https://patch.clumsysworld.com/",
  patchNotesUrl: "",
  launcherReleaseApiUrl: DEFAULT_RELEASE_API_URL,
  gameServerHost: "",
  gameServerPort: 0,
  loginServerHost: "",
  loginServerPort: 0,
  gameServerStatusTimeoutMs: 1500,
  tagline: "An EverQuest Emulated Server",
  primaryImage: "",
  backgroundImage: "",
  heroImage: "",
  wordmarkImage: "",
  wordmarkImageAlt: "",
  wordmarkRemoveLightBackground: false,
  emblemText: "",
  websiteUrl: "",
  websiteLabel: "",
  discordUrl: "",
  tools: [],
  defaultAutoPatch: false,
  defaultAutoPlay: false,
  defaultAutoLogin: false,
  defaultOnGameLaunch: "minimize",
  supportedClients: ["Rain_Of_Fear_2", "Rain_Of_Fear_2_4GB"]
};

const LEGACY_BRANDING = {
  normalizedServerName: "clumsy's world: resurgence",
  websiteUrl: "https://www.clumsysworld.com",
  websiteLabel: "www.clumsysworld.com",
  wordmarkImage: path.join("src", "electron", "assets", "branding", "clumsys-world-wordmark-cwt.png"),
  wordmarkImageAlt: "Clumsy's World Resurgence",
  wordmarkRemoveLightBackground: true,
  tools: [
    { label: "Wiki", url: "https://wiki.clumsysworld.com/" },
    { label: "Alla", url: "https://alla.clumsysworld.com/" },
    { label: "Magelo", url: "https://magelo.clumsysworld.com/" },
    { label: "Nexus", url: "https://nexus.clumsysworld.com/" }
  ]
};

const LEGACY_SERVER_NAMES = new Set(["Rebuild EQ"]);
const GENERIC_HOST_SEGMENTS = new Set(["app", "cdn", "download", "downloads", "files", "patch", "static", "updates", "www"]);
const SERVER_NAME_ALIASES = {
  clumsysworld: "Clumsy's World"
};

const CLIENTS = {
  Unknown: { label: "Unknown", suffix: "unk", image: "rof.png" },
  Titanium: { label: "Titanium", suffix: "tit", image: "titanium.png" },
  Rain_Of_Fear: { label: "Rain of Fear", suffix: "rof", image: "rof.png" },
  Rain_Of_Fear_2: { label: "Rain of Fear 2", suffix: "rof", image: "rof.png" },
  Rain_Of_Fear_2_4GB: { label: "Rain of Fear 2 (4GB)", suffix: "rof", image: "rof.png" },
  Seeds_Of_Destruction: { label: "Seeds of Destruction", suffix: "sod", image: "rof.png" },
  Underfoot: { label: "Underfoot", suffix: "und", image: "underfoot.png" },
  Secrets_Of_Feydwer: { label: "Secrets of Feydwer", suffix: "sof", image: "sof.png" },
  Broken_Mirror: { label: "Broken Mirror", suffix: "bro", image: "brokenmirror.png" }
};

const HASH_TO_VERSION = {
  "85218FC053D8B367F2B704BAC5E30ACC": "Secrets_Of_Feydwer",
  "859E89987AA636D36B1007F11C2CD6E0": "Underfoot",
  "EF07EE6649C9A2BA2EFFC3F346388E1E78B44B48": "Underfoot",
  "A9DE1B8CC5C451B32084656FCACF1103": "Titanium",
  "BB42BC3870F59B6424A56FED3289C6D4": "Titanium",
  "368BB9F425C8A55030A63E606D184445": "Rain_Of_Fear",
  "240C80800112ADA825C146D7349CE85B": "Rain_Of_Fear_2",
  "389709EC0E456C3DAE881A61218AAB3F": "Rain_Of_Fear_2_4GB",
  "A057A23F030BAA1C4910323B131407105ACAD14D": "Rain_Of_Fear_2",
  "6BFAE252C1A64FE8A3E176CAEE7AAE60": "Broken_Mirror",
  "AD970AD6DB97E5BB21141C205CAD6E68": "Broken_Mirror"
};

const PREREQUISITE_DOWNLOADS = {
  directx: {
    fileName: "directx_Jun2010_redist.exe",
    url: "https://download.microsoft.com/download/8/4/a/84a35bf1-dafe-4ae8-82af-ad2ae20b6b14/directx_Jun2010_redist.exe"
  },
  vcRedist: {
    x86: "https://aka.ms/vc14/vc_redist.x86.exe",
    x64: "https://aka.ms/vc14/vc_redist.x64.exe",
    arm64: "https://aka.ms/vc14/vc_redist.arm64.exe"
  }
};

const WINDOWS_PREREQUISITE_STATUS_CODES = new Set([0xC0000135]);
const WINDOWS_SUCCESS_REBOOT_EXIT_CODES = new Set([0, 1638, 3010, 1641]);
const PREREQUISITE_STAGE_LABELS = {
  preparing: "preparing installers",
  downloadDirectX: "downloading DirectX",
  extractDirectX: "extracting DirectX",
  installDirectX: "installing DirectX",
  downloadVcRedist: "downloading Visual C++ runtime",
  installVcRedist: "installing Visual C++ runtime"
};
const PREREQUISITE_INSTALLER_TIMEOUTS_MS = {
  extractDirectX: 5 * 60 * 1000,
  installDirectX: 15 * 60 * 1000,
  installVcRedist: 15 * 60 * 1000
};
const PE_MACHINE_ARCHITECTURES = {
  0x014C: "x86",
  0x8664: "x64",
  0xAA64: "arm64"
};
const WINDOWS_API_SET_DLL_PREFIXES = ["api-ms-win-", "ext-ms-win-"];
const AUTO_LOGIN_PROFILE_STORE_FILE = "auto-login-profiles.json";
const AUTO_LOGIN_SECRET_ENTROPY = "eqemupatcher:auto-login:v1";
const AUTO_LOGIN_HELPER_FILE_NAME = "Invoke-EqAutoLogin.ps1";
const AUTO_LOGIN_CONFIRMATION_TIMEOUT_EXIT_CODE = 2;
const AUTO_LOGIN_LOGIN_REJECTED_EXIT_CODE = 3;
const AUTO_LOGIN_HELPER_TIMEOUT_MS = 60 * 1000;
const AUTO_LOGIN_BATCH_DELAY_MS = 500;
const AUTO_LOGIN_HELPER_SOURCE_PATH = path.join(__dirname, "..", "assets", "auto-login", AUTO_LOGIN_HELPER_FILE_NAME);
const AUTO_LOGIN_EQCLIENT_RESTORE_INITIAL_DELAY_MS = 1500;
const AUTO_LOGIN_EQCLIENT_RESTORE_POLL_MS = 5000;
const AUTO_LOGIN_EQCLIENT_RESTORE_MAX_WAIT_MS = 12 * 60 * 60 * 1000;
const AUTO_LOGIN_EQCLIENT_FORCED_VALUES = {
  Maximized: "1",
  WindowedMode: "TRUE"
};
const AUTO_LOGIN_EQCLIENT_WINDOW_KEYS = [
  "Maximized",
  "WindowedMode",
  "WindowedModeXOffset",
  "WindowedModeYOffset",
  "RestoredXOffset",
  "RestoredYOffset",
  "RestoredWidth",
  "RestoredHeight",
  "WindowedWidth",
  "WindowedHeight",
  "Width",
  "Height",
  "VideoMode"
];

function boolToLegacyString(value) {
  return value ? "true" : "false";
}

function isTrue(value) {
  return value === true || value === "true";
}

function createAutoLoginStatus(state, label, detail = "") {
  return {
    state,
    label,
    detail
  };
}

function normalizeAutoLoginText(value, maxLength = 128) {
  return String(value || "").replace(/[\r\n]+/g, " ").trim().slice(0, maxLength);
}

function normalizeAutoLoginProfileId(value) {
  return String(value || "").trim().replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
}

function normalizeAutoLoginProfileIds(value) {
  const ids = Array.isArray(value) ? value : [];
  const seen = new Set();
  const normalizedIds = [];
  for (const id of ids) {
    const normalizedId = normalizeAutoLoginProfileId(id);
    if (!normalizedId || seen.has(normalizedId)) {
      continue;
    }

    seen.add(normalizedId);
    normalizedIds.push(normalizedId);
  }

  return normalizedIds;
}

function createAutoLoginProfileId() {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return crypto.randomBytes(16).toString("hex");
}

function sanitizeAutoLoginProfile(profile) {
  return {
    id: normalizeAutoLoginProfileId(profile?.id),
    label: normalizeAutoLoginText(profile?.label),
    username: normalizeAutoLoginText(profile?.username),
    isDefault: profile?.isDefault === true,
    createdAt: String(profile?.createdAt || ""),
    updatedAt: String(profile?.updatedAt || "")
  };
}

function sanitizeAutoLoginProfiles(profiles) {
  return (Array.isArray(profiles) ? profiles : [])
    .map(sanitizeAutoLoginProfile)
    .filter((profile) => profile.id && profile.username);
}

function sanitizeIniValue(value) {
  return String(value || "").replace(/[\r\n]/g, "").trim();
}

async function exists(filePath) {
  try {
    await fsp.access(filePath);
    return true;
  } catch (_error) {
    return false;
  }
}

function normalizeWindowsArchitecture(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) {
    return "";
  }

  if (["amd64", "x64", "x86_64", "x86-64"].includes(normalized)) {
    return "x64";
  }

  if (["x86", "i386", "i686", "x86-32"].includes(normalized)) {
    return "x86";
  }

  if (["arm64", "aarch64"].includes(normalized)) {
    return "arm64";
  }

  if (normalized === "arm") {
    return "arm64";
  }

  return "";
}

function parseUnsignedWindowsStatus(value) {
  if (value == null || value === "") {
    return null;
  }

  const normalized = String(value).trim();
  const parsed = /^0x/i.test(normalized)
    ? Number.parseInt(normalized, 16)
    : Number.parseInt(normalized, 10);

  if (!Number.isFinite(parsed)) {
    return null;
  }

  return parsed >>> 0;
}

function parseSimulatedMissingDllList(value) {
  if (value == null || value === "") {
    return [];
  }

  return String(value)
    .split(/[;,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function getPrerequisiteSimulationConfig(environment = process.env) {
  const launchExitCode = parseUnsignedWindowsStatus(environment.EQEMU_TEST_FORCE_LAUNCH_EXIT);
  const missingDlls = parseSimulatedMissingDllList(environment.EQEMU_TEST_FORCE_SCAN_MISSING_DLLS);
  const installMode = String(environment.EQEMU_TEST_PREREQ_MODE || "").trim().toLowerCase();
  const delayMs = Math.max(0, Number.parseInt(environment.EQEMU_TEST_PREREQ_DELAY_MS || "0", 10) || 0);

  return {
    launchExitCode,
    missingDlls,
    installMode,
    delayMs,
    active: launchExitCode != null || missingDlls.length > 0 || Boolean(installMode)
  };
}

function createInactivePrerequisiteSimulationConfig() {
  return {
    launchExitCode: null,
    missingDlls: [],
    installMode: "",
    delayMs: 0,
    active: false
  };
}

function shouldEnablePrerequisiteSimulation(environment = process.env, isPackaged = false) {
  if (!isPackaged) {
    return true;
  }

  return String(environment.EQEMU_ENABLE_TEST_SIM || "").trim() === "1";
}

function getEffectivePrerequisiteSimulationConfig(environment = process.env, isPackaged = false) {
  if (!shouldEnablePrerequisiteSimulation(environment, isPackaged)) {
    return createInactivePrerequisiteSimulationConfig();
  }

  return getPrerequisiteSimulationConfig(environment);
}

function formatDurationForDisplay(ms) {
  const totalSeconds = Math.max(1, Math.ceil(ms / 1000));
  if (totalSeconds < 60) {
    return `${totalSeconds} seconds`;
  }

  const totalMinutes = Math.ceil(totalSeconds / 60);
  return `${totalMinutes} minute${totalMinutes === 1 ? "" : "s"}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getPreferredWindowsRuntimeArchitecture(environment = process.env) {
  return normalizeWindowsArchitecture(
    environment.PROCESSOR_ARCHITEW6432 ||
    environment.PROCESSOR_ARCHITECTURE ||
    process.arch
  ) || "x64";
}

function mapPortableExecutableMachineToArchitecture(machine) {
  return PE_MACHINE_ARCHITECTURES[machine] || "";
}

async function detectPortableExecutableArchitecture(filePath) {
  let handle = null;
  try {
    handle = await fsp.open(filePath, "r");
    const dosHeader = Buffer.alloc(64);
    const { bytesRead: dosBytesRead } = await handle.read(dosHeader, 0, dosHeader.length, 0);
    if (dosBytesRead < dosHeader.length || dosHeader.readUInt16LE(0) !== 0x5A4D) {
      return "";
    }

    const peHeaderOffset = dosHeader.readUInt32LE(0x3C);
    const peHeader = Buffer.alloc(6);
    const { bytesRead: peBytesRead } = await handle.read(peHeader, 0, peHeader.length, peHeaderOffset);
    if (peBytesRead < peHeader.length || peHeader.readUInt32LE(0) !== 0x00004550) {
      return "";
    }

    return mapPortableExecutableMachineToArchitecture(peHeader.readUInt16LE(4));
  } catch (_error) {
    return "";
  } finally {
    await handle?.close().catch(() => {});
  }
}

function readNullTerminatedAscii(buffer, offset) {
  if (!Buffer.isBuffer(buffer) || !Number.isInteger(offset) || offset < 0 || offset >= buffer.length) {
    return "";
  }

  let end = offset;
  while (end < buffer.length && buffer[end] !== 0) {
    end += 1;
  }

  return buffer.toString("ascii", offset, end).trim();
}

function readPortableExecutableLayout(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 0x40 || buffer.readUInt16LE(0) !== 0x5A4D) {
    return null;
  }

  const peHeaderOffset = buffer.readUInt32LE(0x3C);
  if (peHeaderOffset <= 0 || (peHeaderOffset + 24) > buffer.length || buffer.readUInt32LE(peHeaderOffset) !== 0x00004550) {
    return null;
  }

  const fileHeaderOffset = peHeaderOffset + 4;
  const machine = buffer.readUInt16LE(fileHeaderOffset);
  const numberOfSections = buffer.readUInt16LE(fileHeaderOffset + 2);
  const sizeOfOptionalHeader = buffer.readUInt16LE(fileHeaderOffset + 16);
  const optionalHeaderOffset = fileHeaderOffset + 20;
  const optionalHeaderMagic = buffer.readUInt16LE(optionalHeaderOffset);
  const sectionTableOffset = optionalHeaderOffset + sizeOfOptionalHeader;

  if (numberOfSections <= 0 || sectionTableOffset > buffer.length) {
    return null;
  }

  let dataDirectoryOffset = 0;
  if (optionalHeaderMagic === 0x10B) {
    dataDirectoryOffset = optionalHeaderOffset + 96;
  } else if (optionalHeaderMagic === 0x20B) {
    dataDirectoryOffset = optionalHeaderOffset + 112;
  } else {
    return null;
  }

  if ((dataDirectoryOffset + 16) > buffer.length) {
    return null;
  }

  const importDirectoryRva = buffer.readUInt32LE(dataDirectoryOffset + 8);
  const importDirectorySize = buffer.readUInt32LE(dataDirectoryOffset + 12);
  const sections = [];
  for (let index = 0; index < numberOfSections; index += 1) {
    const sectionOffset = sectionTableOffset + (index * 40);
    if ((sectionOffset + 40) > buffer.length) {
      break;
    }

    sections.push({
      virtualSize: buffer.readUInt32LE(sectionOffset + 8),
      virtualAddress: buffer.readUInt32LE(sectionOffset + 12),
      sizeOfRawData: buffer.readUInt32LE(sectionOffset + 16),
      pointerToRawData: buffer.readUInt32LE(sectionOffset + 20)
    });
  }

  return {
    machine,
    importDirectoryRva,
    importDirectorySize,
    sections
  };
}

function rvaToFileOffset(rva, sections) {
  if (!Number.isFinite(rva) || rva <= 0 || !Array.isArray(sections)) {
    return null;
  }

  for (const section of sections) {
    const start = section.virtualAddress;
    const length = Math.max(section.virtualSize, section.sizeOfRawData);
    const end = start + length;
    if (rva >= start && rva < end) {
      return section.pointerToRawData + (rva - start);
    }
  }

  return null;
}

function listPortableExecutableImports(buffer, layout) {
  if (!layout?.importDirectoryRva || !layout.importDirectorySize) {
    return [];
  }

  const descriptorOffset = rvaToFileOffset(layout.importDirectoryRva, layout.sections);
  if (!Number.isInteger(descriptorOffset) || descriptorOffset < 0 || descriptorOffset >= buffer.length) {
    return [];
  }

  const imports = [];
  for (let offset = descriptorOffset; (offset + 20) <= buffer.length; offset += 20) {
    const originalFirstThunk = buffer.readUInt32LE(offset);
    const timeDateStamp = buffer.readUInt32LE(offset + 4);
    const forwarderChain = buffer.readUInt32LE(offset + 8);
    const nameRva = buffer.readUInt32LE(offset + 12);
    const firstThunk = buffer.readUInt32LE(offset + 16);

    if (!originalFirstThunk && !timeDateStamp && !forwarderChain && !nameRva && !firstThunk) {
      break;
    }

    const nameOffset = rvaToFileOffset(nameRva, layout.sections);
    const name = readNullTerminatedAscii(buffer, nameOffset);
    if (name) {
      imports.push(name);
    }
  }

  return Array.from(new Set(imports));
}

async function readPortableExecutableMetadata(filePath) {
  try {
    const buffer = await fsp.readFile(filePath);
    const layout = readPortableExecutableLayout(buffer);
    if (!layout) {
      return null;
    }

    return {
      architecture: mapPortableExecutableMachineToArchitecture(layout.machine),
      imports: listPortableExecutableImports(buffer, layout)
    };
  } catch (_error) {
    return null;
  }
}

function shouldIgnoreDependencyName(fileName) {
  const normalized = String(fileName || "").trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  return WINDOWS_API_SET_DLL_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function getWindowsDependencySearchPaths(executablePath, executableArch, environment = process.env) {
  const executableDirectory = path.dirname(executablePath || "");
  const windowsDirectory = environment.SystemRoot || environment.windir || process.env.SystemRoot || process.env.windir || "";
  const preferredArch = executableArch || getPreferredWindowsRuntimeArchitecture(environment);
  const hostArch = getPreferredWindowsRuntimeArchitecture(environment);
  const pathEntries = String(environment.Path || environment.PATH || "")
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);

  const directories = [executableDirectory];
  if (windowsDirectory) {
    if (preferredArch === "x86" && hostArch !== "x86") {
      directories.push(path.join(windowsDirectory, "SysWOW64"));
    }
    directories.push(path.join(windowsDirectory, "System32"));
    directories.push(path.join(windowsDirectory, "System"));
    directories.push(windowsDirectory);
  }
  directories.push(...pathEntries);

  return Array.from(new Set(directories.filter(Boolean)));
}

function resolveWindowsDependencyPath(fileName, searchPaths) {
  if (!fileName) {
    return "";
  }

  if (path.isAbsolute(fileName)) {
    return fs.existsSync(fileName) ? fileName : "";
  }

  for (const directory of searchPaths) {
    const candidatePath = path.join(directory, fileName);
    if (fs.existsSync(candidatePath)) {
      return candidatePath;
    }
  }

  return "";
}

function cloneState(state) {
  return JSON.parse(JSON.stringify(state));
}

function normalizeVersion(value) {
  if (value == null || value === "") {
    return "";
  }

  return String(value);
}

function normalizeOnGameLaunch(value) {
  return value === "close" ? "close" : "minimize";
}

function computePatchNotesContentHash(content) {
  const normalizedContent = String(content || "");
  if (!normalizedContent) {
    return "";
  }

  return crypto.createHash("sha256").update(normalizedContent, "utf8").digest("hex");
}

function createEmptyPatchNotesCache() {
  return {
    url: "",
    content: "",
    html: "",
    fetchedAt: "",
    lineCount: 0,
    contentHash: "",
    etag: "",
    lastModified: ""
  };
}

function buildUrl(baseUrl, relativePath) {
  const normalizedBaseUrl = String(baseUrl || "").endsWith("/") ? String(baseUrl || "") : `${String(baseUrl || "")}/`;
  return new URL(relativePath, normalizedBaseUrl).toString();
}

function normalizeServerName(value) {
  if (value == null) {
    return "";
  }

  return String(value).trim();
}

function normalizeConfigText(value) {
  return String(value == null ? "" : value).trim();
}

function normalizeNetworkPort(value, fallbackPort = 0) {
  const port = Number.parseInt(String(value ?? "").trim(), 10);
  if (Number.isInteger(port) && port > 0 && port <= 65535) {
    return port;
  }

  const fallback = Number.parseInt(String(fallbackPort ?? ""), 10);
  return Number.isInteger(fallback) && fallback > 0 && fallback <= 65535 ? fallback : 0;
}

function inferPortFromScheme(scheme) {
  const normalized = String(scheme || "").trim().toLowerCase().replace(/:$/, "");
  if (normalized === "https") {
    return 443;
  }

  if (normalized === "http") {
    return 80;
  }

  return 0;
}

function parseEndpointSource(value, defaultPort = 0) {
  const source = normalizeConfigText(value);
  if (!source) {
    return { host: "", port: 0 };
  }

  const parseUrl = (candidate) => {
    try {
      const parsed = new URL(candidate);
      return {
        host: normalizeConfigText(parsed.hostname),
        port: normalizeNetworkPort(parsed.port, inferPortFromScheme(parsed.protocol) || defaultPort)
      };
    } catch (_error) {
      return null;
    }
  };

  const parsedWithScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(source) ? parseUrl(source) : null;
  if (parsedWithScheme?.host) {
    return parsedWithScheme;
  }

  const parsedAsHost = parseUrl(`tcp://${source}`);
  if (parsedAsHost?.host) {
    return {
      host: parsedAsHost.host,
      port: normalizeNetworkPort(parsedAsHost.port, defaultPort)
    };
  }

  return {
    host: source.split(/[\/\s]/)[0].replace(/:\d+$/, ""),
    port: defaultPort
  };
}

function resolveEndpoint(value, configuredPort, defaultPort = 0) {
  const parsed = parseEndpointSource(value, defaultPort);
  return {
    host: parsed.host,
    port: normalizeNetworkPort(configuredPort, parsed.port || defaultPort)
  };
}

function parseEqhostLoginServer(content) {
  const parsed = parseEqhostLoginServers(content);
  const activeEntry = parsed.entries.find((entry) => !entry.commented);
  return activeEntry ? activeEntry.hostSource : "";
}

function splitEqhostLines(content) {
  const source = String(content || "");
  if (!source) {
    return [];
  }

  return source.match(/[^\r\n]*(?:\r\n|\n|\r)|[^\r\n]+/g) || [];
}

function splitLineTerminator(line) {
  const source = String(line || "");
  const match = source.match(/(\r\n|\n|\r)$/);
  if (!match) {
    return {
      body: source,
      eol: ""
    };
  }

  return {
    body: source.slice(0, -match[1].length),
    eol: match[1]
  };
}

function parseEqhostLoginServers(content) {
  const lines = splitEqhostLines(content);
  const entries = [];

  lines.forEach((line, lineIndex) => {
    const { body } = splitLineTerminator(line);
    const match = body.match(/^(\s*)(#?)(Host\s*=\s*(.+))$/i);
    if (!match) {
      return;
    }

    const hostSource = normalizeConfigText(match[4]);
    const endpoint = resolveEndpoint(hostSource, 0, 5999);
    if (!endpoint.host) {
      return;
    }

    entries.push({
      lineIndex,
      commented: match[2] === "#",
      hostSource,
      host: endpoint.host,
      port: endpoint.port
    });
  });

  return {
    lines,
    entries
  };
}

function getManagedLoginServerEntries(parsedEqhost) {
  return Array.isArray(parsedEqhost?.entries) ? parsedEqhost.entries.slice(0, 2) : [];
}

function createLoginServerOption(entry = null) {
  return {
    host: entry?.host || "",
    port: entry?.host ? entry.port : 0
  };
}

function createLoginServerOptions(primary = null, backup = null) {
  return {
    primary: createLoginServerOption(primary),
    backup: createLoginServerOption(backup)
  };
}

function getActiveManagedLoginServerRole(entries) {
  const managedEntries = Array.isArray(entries) ? entries : [];
  if (managedEntries[0] && !managedEntries[0].commented) {
    return "primary";
  }

  if (managedEntries[1] && !managedEntries[1].commented) {
    return "backup";
  }

  return "";
}

function normalizeLoginServerRole(value) {
  return value === "backup" ? "backup" : value === "primary" ? "primary" : "";
}

function setEqhostActiveLoginServer(content, role) {
  const normalizedRole = normalizeLoginServerRole(role);
  const parsed = parseEqhostLoginServers(content);
  const managedEntries = getManagedLoginServerEntries(parsed);
  if (!normalizedRole || managedEntries.length < 2) {
    return {
      content: String(content || ""),
      changed: false
    };
  }

  const activeIndex = normalizedRole === "backup" ? 1 : 0;
  const lines = [...parsed.lines];

  managedEntries.forEach((entry, index) => {
    const { body, eol } = splitLineTerminator(lines[entry.lineIndex]);
    const match = body.match(/^(\s*)(#?)(Host\s*=.*)$/i);
    if (!match) {
      return;
    }

    const nextBody = `${match[1]}${index === activeIndex ? "" : "#"}${match[3]}`;
    lines[entry.lineIndex] = `${nextBody}${eol}`;
  });

  const nextContent = lines.join("");
  return {
    content: nextContent,
    changed: nextContent !== String(content || "")
  };
}

function normalizeGameServerStatusTimeoutMs(value) {
  const timeoutMs = Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    return DEFAULTS.gameServerStatusTimeoutMs;
  }

  return Math.min(Math.max(timeoutMs, 250), 10000);
}

function createGameServerStatus(overrides = {}) {
  return {
    state: "unconfigured",
    label: "Not configured",
    detail: "Game server status has not been checked.",
    host: "",
    port: 0,
    checkedAt: "",
    latencyMs: 0,
    error: "",
    ...overrides
  };
}

function createLoginServerStatus(overrides = {}) {
  return {
    state: "unconfigured",
    label: "Not configured",
    detail: "Select a game directory with eqhost.txt to show login server status.",
    host: "",
    port: 0,
    checkedAt: "",
    latencyMs: 0,
    error: "",
    role: "",
    selectionMode: "auto",
    failoverActive: false,
    primaryError: "",
    backupError: "",
    ...overrides
  };
}

function createEqLoginSessionRequest(connectCode) {
  const packet = Buffer.alloc(14);
  packet[0] = 0x00;
  packet[1] = 0x01;
  packet.writeUInt32BE(LOGIN_SERVER_SESSION_PROTOCOL_VERSION, 2);
  packet.writeUInt32BE(connectCode, 6);
  packet.writeUInt32BE(LOGIN_SERVER_SESSION_MAX_PACKET_SIZE, 10);
  return packet;
}

function createCrc32Table() {
  const table = [];
  for (let index = 0; index < 256; index += 1) {
    let crc = index;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) ? (0xEDB88320 ^ (crc >>> 1)) : (crc >>> 1);
    }
    table[index] = crc >>> 0;
  }

  return table;
}

function updateEqCrc32(crc, byte) {
  return ((crc >>> 8) ^ EQ_CRC32_TABLE[(crc ^ byte) & 0xFF]) >>> 0;
}

function calculateEqCrc32(buffer, key) {
  let crc = 0xFFFFFFFF;
  for (let index = 0; index < 4; index += 1) {
    crc = updateEqCrc32(crc, (key >>> (index * 8)) & 0xFF);
  }

  for (const byte of buffer) {
    crc = updateEqCrc32(crc, byte);
  }

  return (~crc) >>> 0;
}

function createEqLoginSessionDisconnect(connectCode, response) {
  const basePacket = Buffer.alloc(6);
  basePacket[0] = 0x00;
  basePacket[1] = 0x05;
  basePacket.writeUInt32BE(connectCode, 2);

  const crcBytes = response?.length >= 11 ? response[10] : 0;
  if (crcBytes !== 2 && crcBytes !== 4) {
    return basePacket;
  }

  const packet = Buffer.alloc(basePacket.length + crcBytes);
  basePacket.copy(packet);
  const encodeKey = response.readUInt32BE(6);
  const crc = calculateEqCrc32(basePacket, encodeKey);
  if (crcBytes === 2) {
    packet.writeUInt16BE(crc & 0xFFFF, basePacket.length);
  } else {
    packet.writeUInt32BE(crc, basePacket.length);
  }

  return packet;
}

function isEqLoginSessionResponse(message, connectCode) {
  return Buffer.isBuffer(message)
    && message.length >= 10
    && message[0] === 0x00
    && message[1] === 0x02
    && message.readUInt32BE(2) === connectCode;
}

function createLoginServerConnectedDetail(check) {
  if (check.probe === "eq-udp") {
    return `Connected to ${check.target} over the EQ login protocol in ${check.latencyMs}ms.`;
  }

  return `Connected to ${check.target} in ${check.latencyMs}ms.`;
}

function normalizeBrandingServerName(value) {
  return normalizeServerName(value)
    .toLowerCase()
    .replace(/[\s]+/g, " ");
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(normalizeConfigText(value));
}

function isFileUrl(value) {
  return /^file:\/\//i.test(normalizeConfigText(value));
}

function normalizeBrandingTools(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => ({
      label: normalizeConfigText(entry?.label),
      url: normalizeConfigText(entry?.url)
    }))
    .filter((entry) => entry.label && entry.url);
}

function looksLikeLegacyServerName(value) {
  const normalized = normalizeServerName(value);
  return normalized === "" || LEGACY_SERVER_NAMES.has(normalized);
}

function humanizeServerToken(token) {
  const normalizedToken = String(token || "").trim().toLowerCase();
  if (!normalizedToken) {
    return "";
  }

  if (SERVER_NAME_ALIASES[normalizedToken]) {
    return SERVER_NAME_ALIASES[normalizedToken];
  }

  const separated = normalizedToken
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z0-9])/g, "$1 $2")
    .replace(/([0-9])([a-zA-Z])/g, "$1 $2")
    .replace(/([a-zA-Z])([0-9])/g, "$1 $2")
    .trim();

  return separated
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function deriveServerNameFromUrl(urlValue) {
  if (!urlValue) {
    return "";
  }

  try {
    const hostname = new URL(String(urlValue)).hostname.toLowerCase();
    const labels = hostname.split(".").filter(Boolean);
    if (labels.length === 0) {
      return "";
    }

    let hostLabels = labels.slice(0, -1);
    if (
      labels.length >= 3 &&
      labels.at(-1).length === 2 &&
      ["co", "com", "net", "org"].includes(labels.at(-2))
    ) {
      hostLabels = labels.slice(0, -2);
    }

    const candidateLabel = [...hostLabels].reverse().find((label) => !GENERIC_HOST_SEGMENTS.has(label)) || hostLabels.at(-1) || labels[0];
    return humanizeServerToken(candidateLabel);
  } catch (_error) {
    return "";
  }
}


function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}


function sanitizeMarkdownHref(href) {
  const normalized = String(href || "").trim().replace(/&amp;/g, "&");
  if (!normalized) {
    return "#";
  }

  if (/^https?\/\//i.test(normalized)) {
    return normalized.replace(/^https?(?=\/\/)/i, (scheme) => `${scheme}:`);
  }

  if (/^(https?:\/\/)/i.test(normalized)) {
    return normalized;
  }

  if (/^(#|\/|\.\/|\.\.\/)/.test(normalized)) {
    return normalized;
  }

  return "#";
}

function renderInlineMarkdown(value) {
  let rendered = escapeHtml(value);
  rendered = rendered.replace(/`([^`]+)`/g, "<code>$1</code>");
  rendered = rendered.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  rendered = rendered.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  rendered = rendered.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label, href) => `<a href="${escapeHtml(sanitizeMarkdownHref(href))}">${label}</a>`);
  return rendered;
}

function getListIndentWidth(value) {
  return String(value || "").replace(/\t/g, "  ").length;
}

function markdownToHtml(markdown) {
  const lines = String(markdown || "").split("\n").map((line) => line.replace(/\r$/, ""));
  const html = [];
  let inCode = false;
  const listStack = [];

  const closeLists = (targetIndent = -1) => {
    while (listStack.length && listStack[listStack.length - 1] > targetIndent) {
      html.push("</li></ul>");
      listStack.pop();
    }
  };

  for (const line of lines) {
    if (line.startsWith("```")) {
      closeLists();
      if (inCode) {
        html.push("</code></pre>");
        inCode = false;
      } else {
        html.push("<pre><code>");
        inCode = true;
      }
      continue;
    }

    if (inCode) {
      html.push(`${escapeHtml(line)}\n`);
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      closeLists();
      const level = heading[1].length;
      html.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }

    const listItem = line.match(/^(\s*)[-*]\s+(.+)$/);
    if (listItem) {
      const indent = getListIndentWidth(listItem[1]);
      const content = renderInlineMarkdown(listItem[2]);

      if (!listStack.length) {
        html.push("<ul>");
        listStack.push(indent);
        html.push(`<li>${content}`);
        continue;
      }

      const currentIndent = listStack[listStack.length - 1];
      if (indent > currentIndent) {
        html.push("<ul>");
        listStack.push(indent);
        html.push(`<li>${content}`);
        continue;
      }

      if (indent === currentIndent) {
        html.push("</li>");
        html.push(`<li>${content}`);
        continue;
      }

      closeLists(indent);
      if (listStack.length && listStack[listStack.length - 1] === indent) {
        html.push("</li>");
        html.push(`<li>${content}`);
      } else {
        html.push("<ul>");
        listStack.push(indent);
        html.push(`<li>${content}`);
      }
      continue;
    }

    if (/^>\s+/.test(line)) {
      closeLists();
      html.push(`<blockquote>${renderInlineMarkdown(line.replace(/^>\s+/, ""))}</blockquote>`);
      continue;
    }

    if (/^---+$/.test(line.trim())) {
      closeLists();
      html.push("<hr>");
      continue;
    }

    if (!line.trim()) {
      closeLists();
      continue;
    }

    closeLists();
    html.push(`<p>${renderInlineMarkdown(line)}</p>`);
  }

  closeLists();
  if (inCode) {
    html.push("</code></pre>");
  }

  return html.join("\n");
}
function isLaunchPermissionError(error) {
  return error && ["EACCES", "EPERM"].includes(error.code);
}

const WINDOWS_STARTUP_STATUS_HINTS = {
  0xC0000135: {
    symbol: "STATUS_DLL_NOT_FOUND",
    assessment: "A required DLL was missing during startup.",
    guidance: "Install the DirectX 9 June 2010 runtime and the Visual C++ redistributables, then try again."
  },
  0xC000007B: {
    symbol: "STATUS_INVALID_IMAGE_FORMAT",
    assessment: "Windows reported an invalid image format while loading the client.",
    guidance: "A 32-bit/64-bit dependency mismatch or a corrupted DLL is likely. Reinstall the client dependencies and check for replaced DLLs in the game folder."
  },
  0xC0000142: {
    symbol: "STATUS_DLL_INIT_FAILED",
    assessment: "A required DLL failed to initialize before the game window appeared.",
    guidance: "Graphics runtimes, overlays, or injected DLLs can cause this. Disable overlays and reinstall DirectX 9 runtime components."
  },
  0xC0000005: {
    symbol: "STATUS_ACCESS_VIOLATION",
    assessment: "The client crashed with an access violation during startup.",
    guidance: "This usually points to a bad or incompatible DLL, overlay injection, or a damaged client file."
  },
  0xC000001D: {
    symbol: "STATUS_ILLEGAL_INSTRUCTION",
    assessment: "The client hit an illegal CPU instruction during startup.",
    guidance: "This can happen with incompatible binaries, aggressive compatibility settings, or corrupted executable files."
  },
  0xC0000409: {
    symbol: "STATUS_STACK_BUFFER_OVERRUN",
    assessment: "Windows terminated the client after a stack buffer overrun.",
    guidance: "Overlays, injected hooks, or corrupted client files are common causes. Disable third-party overlays and verify the client files."
  },
  0xC00000FD: {
    symbol: "STATUS_STACK_OVERFLOW",
    assessment: "The client overflowed its stack during startup.",
    guidance: "This usually indicates a crash in early initialization or a bad injected module."
  },
  0x40000015: {
    symbol: "STATUS_FATAL_APP_EXIT",
    assessment: "The client aborted itself during startup.",
    guidance: "Look for a client-side dialog, missing dependency, or configuration problem immediately after launch."
  }
};

function toWindowsStatusHex(code) {
  if (!Number.isFinite(code)) {
    return "";
  }

  return `0x${(code >>> 0).toString(16).toUpperCase().padStart(8, "0")}`;
}

function getWindowsStartupStatusHint(code) {
  if (!Number.isFinite(code)) {
    return null;
  }

  return WINDOWS_STARTUP_STATUS_HINTS[code >>> 0] || null;
}

function isMissingRuntimeStartupStatus(code) {
  return Number.isFinite(code) && WINDOWS_PREREQUISITE_STATUS_CODES.has(code >>> 0);
}

function getPrerequisiteStageLabel(stage) {
  return PREREQUISITE_STAGE_LABELS[stage] || "installing prerequisites";
}

function getPrerequisiteFailureRecommendations(stage, offer = {}) {
  const recommendations = [];
  const vcLabel = offer.vcArch ? `Visual C++ ${offer.vcArch.toUpperCase()}` : "Visual C++";

  if (stage === "downloadDirectX" || stage === "downloadVcRedist") {
    recommendations.push("Check your internet connection, firewall, VPN, or antivirus web filtering, then try again.");
  }

  if (stage === "extractDirectX" || stage === "installDirectX" || stage === "installVcRedist") {
    recommendations.push("Allow any Windows security or UAC prompts, close other installer windows, and retry the install.");
  }

  if (stage === "installVcRedist") {
    recommendations.push("If the Visual C++ installer keeps failing, restart Windows to clear any pending runtime install and try again.");
  }

  recommendations.push(`If retrying still fails, install DirectX June 2010 and ${vcLabel} manually from Microsoft, then launch EverQuest again.`);
  recommendations.push(`DirectX June 2010: ${PREREQUISITE_DOWNLOADS.directx.url}`);
  if (offer.vcUrl) {
    recommendations.push(`${vcLabel}: ${offer.vcUrl}`);
  }

  return recommendations;
}

function describeImmediateExit(code, signal) {
  if (code != null) {
    const windowsStatus = toWindowsStatusHex(code);
    const hint = getWindowsStartupStatusHint(code);

    return {
      statusDetail: `exit code ${code}${windowsStatus ? ` / ${windowsStatus}` : ""}`,
      hint: hint ? `${hint.assessment} ${hint.guidance}` : "",
      windowsStatus,
      symbol: hint?.symbol || "",
      assessment: hint?.assessment || "",
      guidance: hint?.guidance || ""
    };
  }

  if (signal) {
    return {
      statusDetail: `signal ${signal}`,
      hint: "",
      windowsStatus: "",
      symbol: "",
      assessment: "The client was terminated by a signal during startup.",
      guidance: ""
    };
  }

  return {
    statusDetail: "an unknown status",
    hint: "",
    windowsStatus: "",
    symbol: "",
    assessment: "",
    guidance: ""
  };
}

function createImmediateExitError(command, code, signal, launchMethod = "") {
  const processLabel = path.basename(command || "process");
  const { statusDetail, hint, windowsStatus, symbol, assessment, guidance } = describeImmediateExit(code, signal);
  const error = new Error(`${processLabel} exited immediately (${statusDetail}).${hint ? ` ${hint}` : ""}`);
  error.code = "EARLY_EXIT";
  error.exitCode = code;
  error.signal = signal;
  error.launchMethod = launchMethod;
  error.windowsStatus = windowsStatus;
  error.windowsStatusSymbol = symbol;
  error.assessment = assessment;
  error.guidance = guidance;
  return error;
}

function createLaunchDiagnostics(error) {
  const diagnostics = [];
  const launchMethod = error?.launchMethod || "";
  if (launchMethod) {
    diagnostics.push({
      text: `Launch method: ${launchMethod}.`,
      tone: "warning"
    });
  }

  if (error?.code === "EARLY_EXIT") {
    const rawStatus = error.windowsStatus
      ? `Startup status: ${error.windowsStatus}${error.windowsStatusSymbol ? ` (${error.windowsStatusSymbol})` : ""}.`
      : error.exitCode != null
        ? `Startup status: exit code ${error.exitCode}.`
        : error.signal
          ? `Startup status: signal ${error.signal}.`
          : "";

    if (rawStatus) {
      diagnostics.push({
        text: rawStatus,
        tone: "warning"
      });
    }

    if (error.assessment) {
      diagnostics.push({
        text: `Assessment: ${error.assessment}`,
        tone: "warning"
      });
    }

    if (error.guidance) {
      diagnostics.push({
        text: `Suggested fix: ${error.guidance}`,
        tone: "warning"
      });
    } else {
      diagnostics.push({
        text: "Suggested fix: run eqgame.exe patchme manually from the EverQuest folder to check for a Windows dialog or missing dependency prompt.",
        tone: "warning"
      });
    }
  } else if (isLaunchPermissionError(error)) {
    diagnostics.push({
      text: "Assessment: Windows denied the launcher permission to start the client directly.",
      tone: "warning"
    });
    diagnostics.push({
      text: "Suggested fix: check antivirus, Controlled Folder Access, and any compatibility or 'Run as administrator' settings on eqgame.exe.",
      tone: "warning"
    });
  }

  return diagnostics;
}

class LauncherBackend {
  constructor({
    appUserDataPath,
    projectRoot,
    launchDirectory,
    runtimeDirectory,
    eventSink,
    fetchImpl,
    netConnectImpl,
    dgramCreateSocketImpl,
    loginServerUdpProbeImpl,
    spawnImpl,
    platform,
    appVersion,
    executablePath,
    processId,
    relaunchArgs,
    isPackaged,
    launchStabilizationMs,
    autoLoginBatchDelayMs,
    onGameLaunched,
    environment
  }) {
    this.appUserDataPath = appUserDataPath;
    this.projectRoot = projectRoot;
    this.launchDirectory = launchDirectory || "";
    this.runtimeDirectory = runtimeDirectory || "";
    this.eventSink = eventSink;
    this.fetchImpl = fetchImpl || fetch;
    this.netConnectImpl = netConnectImpl || net.createConnection;
    this.dgramCreateSocketImpl = dgramCreateSocketImpl || ((type) => dgram.createSocket(type));
    this.loginServerUdpProbeImpl = typeof loginServerUdpProbeImpl === "function" ? loginServerUdpProbeImpl : null;
    this.spawnImpl = spawnImpl || spawn;
    this.platform = platform || process.platform;
    this.appVersion = normalizeVersion(appVersion) || "0.0.0";
    this.executablePath = executablePath || "";
    this.processId = processId || process.pid;
    this.relaunchArgs = Array.isArray(relaunchArgs) ? [...relaunchArgs] : [];
    this.isPackaged = Boolean(isPackaged);
    this.launchStabilizationMs = Number.isFinite(launchStabilizationMs) && launchStabilizationMs >= 0 ? launchStabilizationMs : 500;
    this.autoLoginBatchDelayMs = Number.isFinite(autoLoginBatchDelayMs) && autoLoginBatchDelayMs >= 0 ? autoLoginBatchDelayMs : AUTO_LOGIN_BATCH_DELAY_MS;
    this.onGameLaunched = typeof onGameLaunched === "function" ? onGameLaunched : null;
    this.environment = environment || process.env;
    this.testSimulation = getEffectivePrerequisiteSimulationConfig(this.environment, this.isPackaged);
    this.appStatePath = path.join(this.appUserDataPath, "launcher-state.yml");
    this.patchNotesCachePath = path.join(this.appUserDataPath, "patch-notes-cache.json");
    this.autoLoginProfilesPath = path.join(this.appUserDataPath, AUTO_LOGIN_PROFILE_STORE_FILE);
    this.configPath = path.join(this.projectRoot, "launcher-config.yml");
    this.gameConfigPath = "";
    this.launchConfigPath = this.launchDirectory ? path.join(this.launchDirectory, "launcher-config.yml") : "";
    this.runtimeConfigPath = this.runtimeDirectory ? path.join(this.runtimeDirectory, "launcher-config.yml") : "";
    this.config = { ...DEFAULTS };
    this.gameSettings = null;
    this.appState = {
      gameDirectory: "",
      onGameLaunch: normalizeOnGameLaunch(DEFAULTS.defaultOnGameLaunch),
      autoLoginEnterWorld: false,
      selectedAutoLoginProfileId: "",
      selectedAutoLoginProfileIds: []
    };
    this.cancelController = null;
    this.cancelRequested = false;
    this.resolvedConfigPath = this.configPath;
    this.patchNotesCache = createEmptyPatchNotesCache();
    this.patchNotesCacheLoaded = false;
    this.autoLoginProfiles = [];
    this.initializePromise = null;

    this.state = {
      platform: this.platform,
      serverName: this.config.serverName,
      filelistUrl: this.config.filelistUrl,
      patchNotesUrl: this.config.patchNotesUrl,
      launcherReleaseApiUrl: this.config.launcherReleaseApiUrl,
      gameServerHost: normalizeConfigText(this.config.gameServerHost),
      gameServerPort: 0,
      gameServerStatus: createGameServerStatus(),
      loginServerHost: "",
      loginServerPort: 0,
      loginServerStatus: createLoginServerStatus(),
      loginServerSelectionMode: "auto",
      loginServerActiveRole: "",
      loginServerFailoverActive: false,
      loginServerOptions: createLoginServerOptions(),
      gameDirectory: "",
      eqGamePath: "",
      clientVersion: "Unknown",
      clientLabel: CLIENTS.Unknown.label,
      clientHash: "",
      clientSupported: false,
      manifestVersion: "",
      lastPatchedVersion: "",
      needsPatch: false,
      patchActionLabel: "Deploy Patch",
      launchActionLabel: "Launch Game",
      statusBadge: "Standby",
      statusDetail: "Select your EverQuest directory to begin.",
      heroImageUrl: this.getHeroImageUrl("Unknown"),
      branding: this.getBrandingState("Unknown"),
      autoPatch: this.config.defaultAutoPatch,
      autoPlay: this.config.defaultAutoPlay,
      autoLogin: false,
      autoLoginEnterWorld: false,
      onGameLaunch: normalizeOnGameLaunch(this.config.defaultOnGameLaunch),
      isPatching: false,
      progressValue: 0,
      progressMax: 1,
      progressLabel: "Waiting for input",
      canPatch: false,
      canLaunch: false,
      launchSupported: this.platform === "win32",
      canInstallPrerequisites: false,
      isInstallingPrerequisites: false,
      autoLoginAvailable: this.platform === "win32",
      autoLoginProfiles: [],
      selectedAutoLoginProfileId: "",
      selectedAutoLoginProfileIds: [],
      isAutoLoginRunning: false,
      autoLoginOverlayText: "",
      autoLoginOverlayProgress: 0,
      autoLoginOverlayTone: "default",
      autoLoginStatus: createAutoLoginStatus(
        this.platform === "win32" ? "idle" : "unavailable",
        this.platform === "win32" ? "Ready" : "Windows only",
        this.platform === "win32"
          ? "Account profile launch is ready."
          : "Account profile launch is only available on Windows."
      ),
      prerequisiteInstallArch: "",
      prerequisiteInstallReason: "",
      prerequisiteDirectXUrl: "",
      prerequisiteVcUrl: "",
      reportUrl: "",
      lastError: "",
      manifestUrl: "",
      launcherUpdate: null
    };

    this.launcherUpdater = new LauncherUpdater({
      appUserDataPath: this.appUserDataPath,
      projectRoot: this.projectRoot,
      fetchImpl: this.fetchImpl,
      spawnImpl: this.spawnImpl,
      emitLog: this.emitLog.bind(this),
      onStateChange: (nextUpdaterState) => {
        this.state.launcherUpdate = nextUpdaterState;
        this.emitState();
      },
      platform: this.platform,
      appVersion: this.appVersion,
      executablePath: this.executablePath,
      processId: this.processId,
      relaunchArgs: this.relaunchArgs,
      isPackaged: this.isPackaged
    });
    this.state.launcherUpdate = this.launcherUpdater.getState();
    this.uiManager = new UiManager({
      getGameDirectory: () => this.state.gameDirectory,
      emitLog: this.emitLog.bind(this)
    });
  }

  emit(type, payload) {
    if (!this.eventSink) {
      return;
    }

    this.eventSink({ type, payload });
  }

  emitState() {
    this.emit("state", this.getState());
  }

  emitLog(text, tone = "info") {
    this.emit("log", {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      text,
      tone,
      timestamp: new Date().toISOString()
    });
  }

  emitProgress() {
    this.emit("progress", {
      value: this.state.progressValue,
      max: this.state.progressMax,
      label: this.state.progressLabel
    });
  }

  setAutoLoginOverlayState(text = "", progress = 0, tone = "default") {
    const normalizedProgress = Number(progress);
    this.state.autoLoginOverlayText = normalizeAutoLoginText(text, 120);
    this.state.autoLoginOverlayProgress = Number.isFinite(normalizedProgress)
      ? Math.min(100, Math.max(0, Math.round(normalizedProgress)))
      : 0;
    this.state.autoLoginOverlayTone = tone === "success" ? "success" : "default";
  }

  getState() {
    return cloneState(this.state);
  }

  getBundledAssetUrl(...segments) {
    return pathToFileURL(path.join(this.projectRoot, ...segments)).toString();
  }

  getDefaultPrimaryImageUrl() {
    return this.getBundledAssetUrl("src", "electron", "assets", "hero", "generated", "dragon-cavern-v1.png");
  }

  getLegacySplashImageUrl() {
    const gameDirectory = this.state?.gameDirectory || "";
    if (gameDirectory) {
      const customSplashPath = path.join(gameDirectory, "eqemupatcher.png");
      if (fs.existsSync(customSplashPath)) {
        return pathToFileURL(customSplashPath).toString();
      }
    }

    return "";
  }

  resolveConfigAssetUrl(value, fallbackUrl = "") {
    const normalized = normalizeConfigText(value);
    if (!normalized) {
      return fallbackUrl;
    }

    if (isHttpUrl(normalized) || isFileUrl(normalized)) {
      return normalized;
    }

    const configDirectory = this.resolvedConfigPath ? path.dirname(this.resolvedConfigPath) : this.projectRoot;
    const candidates = path.isAbsolute(normalized)
      ? [normalized]
      : [
          path.resolve(configDirectory, normalized),
          path.resolve(this.projectRoot, normalized)
        ];

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return pathToFileURL(candidate).toString();
      }
    }

    return fallbackUrl;
  }

  getConfiguredPrimaryImageUrl() {
    const configuredImage = (
      normalizeConfigText(this.config.primaryImage) ||
      normalizeConfigText(this.config.backgroundImage) ||
      normalizeConfigText(this.config.heroImage)
    );

    if (configuredImage) {
      return this.resolveConfigAssetUrl(configuredImage, this.getDefaultPrimaryImageUrl());
    }

    return this.getLegacySplashImageUrl() || this.getDefaultPrimaryImageUrl();
  }

  getHeroImageUrl(version) {
    const legacySplashUrl = this.getLegacySplashImageUrl();
    if (legacySplashUrl) {
      return legacySplashUrl;
    }

    const imageName = (CLIENTS[version] || CLIENTS.Unknown).image;
    const imagePath = path.join(this.projectRoot, "src", "electron", "assets", "hero", imageName);
    return pathToFileURL(imagePath).toString();
  }

  getBrandingState(version = "Unknown") {
    const serverName = normalizeServerName(this.state?.serverName) || this.resolveServerName();
    const normalizedServerName = normalizeBrandingServerName(serverName);
    const useLegacyBranding = normalizedServerName === LEGACY_BRANDING.normalizedServerName;
    const configuredWordmarkImage = normalizeConfigText(this.config.wordmarkImage);
    const configuredTools = normalizeBrandingTools(this.config.tools);
    const fallbackWordmarkImage = useLegacyBranding ? LEGACY_BRANDING.wordmarkImage : "";
    const wordmarkImageUrl = this.resolveConfigAssetUrl(configuredWordmarkImage || fallbackWordmarkImage, "");
    const websiteUrl = normalizeConfigText(this.config.websiteUrl) || (useLegacyBranding ? LEGACY_BRANDING.websiteUrl : "");
    const websiteLabel = normalizeConfigText(this.config.websiteLabel) || (websiteUrl ? websiteUrl.replace(/^https?:\/\//i, "").replace(/\/$/, "") : "");
    const tools = configuredTools.length ? configuredTools : (useLegacyBranding ? LEGACY_BRANDING.tools : []);

    return {
      serverName,
      tagline: normalizeConfigText(this.config.tagline) || DEFAULTS.tagline,
      primaryImageUrl: this.getConfiguredPrimaryImageUrl(version),
      wordmarkImageUrl,
      wordmarkImageAlt: normalizeConfigText(this.config.wordmarkImageAlt) || (useLegacyBranding ? LEGACY_BRANDING.wordmarkImageAlt : serverName),
      wordmarkRemoveLightBackground: configuredWordmarkImage
        ? this.config.wordmarkRemoveLightBackground === true
        : Boolean(useLegacyBranding && LEGACY_BRANDING.wordmarkRemoveLightBackground),
      emblemText: normalizeConfigText(this.config.emblemText || serverName.charAt(0)).slice(0, 3),
      websiteUrl,
      websiteLabel,
      discordUrl: normalizeConfigText(this.config.discordUrl),
      tools
    };
  }

  syncBrandingState(version = this.state.clientVersion || "Unknown") {
    this.state.branding = this.getBrandingState(version);
  }

  getConfiguredGameServerEndpoint() {
    const configuredHost = normalizeConfigText(this.config.gameServerHost);
    const endpoint = configuredHost
      ? resolveEndpoint(configuredHost, this.config.gameServerPort, DEFAULT_GAME_SERVER_STATUS_PORT)
      : {
          host: DEFAULT_GAME_SERVER_STATUS_HOST,
          port: DEFAULT_GAME_SERVER_STATUS_PORT
        };
    return {
      ...endpoint,
      timeoutMs: normalizeGameServerStatusTimeoutMs(this.config.gameServerStatusTimeoutMs)
    };
  }

  syncGameServerConfigState() {
    const endpoint = this.getConfiguredGameServerEndpoint();
    this.state.gameServerHost = endpoint.host;
    this.state.gameServerPort = endpoint.host ? endpoint.port : 0;
    if (!endpoint.host) {
      this.state.gameServerStatus = createGameServerStatus();
    }
  }

  getConfiguredLoginServerFallbackEndpoint() {
    const endpoint = resolveEndpoint(this.config.loginServerHost, this.config.loginServerPort, 5999);
    return {
      ...endpoint,
      timeoutMs: normalizeGameServerStatusTimeoutMs(this.config.gameServerStatusTimeoutMs)
    };
  }

  getLoginServerEndpointFallback(detail) {
    const fallbackEndpoint = this.getConfiguredLoginServerFallbackEndpoint();
    if (fallbackEndpoint.host) {
      return {
        ...fallbackEndpoint,
        detail: ""
      };
    }

    return {
      host: "",
      port: 0,
      timeoutMs: normalizeGameServerStatusTimeoutMs(this.config.gameServerStatusTimeoutMs),
      detail
    };
  }

  getLoginServerStatusTimeoutMs() {
    return normalizeGameServerStatusTimeoutMs(this.config.gameServerStatusTimeoutMs);
  }

  syncLoginServerSelectionState({
    activeRole = "",
    failoverActive = false,
    primary = null,
    backup = null
  } = {}) {
    this.state.loginServerActiveRole = activeRole;
    this.state.loginServerFailoverActive = Boolean(failoverActive);
    this.state.loginServerOptions = createLoginServerOptions(primary, backup);
  }

  createLoginServerEndpointFromEntry(entry, role) {
    if (!entry?.host) {
      return {
        role,
        host: "",
        port: 0,
        timeoutMs: this.getLoginServerStatusTimeoutMs()
      };
    }

    return {
      role,
      host: entry.host,
      port: entry.port,
      timeoutMs: this.getLoginServerStatusTimeoutMs()
    };
  }

  async getConfiguredLoginServerEndpoint() {
    if (!this.state.gameDirectory) {
      return this.getLoginServerEndpointFallback("Select a game directory with eqhost.txt to show login server status.");
    }

    const eqhostPath = path.join(this.state.gameDirectory, "eqhost.txt");
    if (!(await exists(eqhostPath))) {
      return this.getLoginServerEndpointFallback("eqhost.txt was not found in the selected game directory.");
    }

    const configuredHost = parseEqhostLoginServer(await fsp.readFile(eqhostPath, "utf8"));
    if (!configuredHost) {
      return this.getLoginServerEndpointFallback("eqhost.txt does not contain an active Host entry.");
    }

    const endpoint = resolveEndpoint(configuredHost, 0, 5999);
    return {
      ...endpoint,
      timeoutMs: normalizeGameServerStatusTimeoutMs(this.config.gameServerStatusTimeoutMs),
      detail: ""
    };
  }

  async getLoginServerConfiguration() {
    if (!this.state.gameDirectory) {
      return {
        type: "fallback",
        endpoint: this.getLoginServerEndpointFallback("Select a game directory with eqhost.txt to show login server status."),
        primary: null,
        backup: null,
        activeRole: ""
      };
    }

    const eqhostPath = path.join(this.state.gameDirectory, "eqhost.txt");
    if (!(await exists(eqhostPath))) {
      return {
        type: "fallback",
        endpoint: this.getLoginServerEndpointFallback("eqhost.txt was not found in the selected game directory."),
        primary: null,
        backup: null,
        activeRole: ""
      };
    }

    const content = await fsp.readFile(eqhostPath, "utf8");
    const parsed = parseEqhostLoginServers(content);
    const managedEntries = getManagedLoginServerEntries(parsed);

    if (managedEntries.length >= 2) {
      const primary = this.createLoginServerEndpointFromEntry(managedEntries[0], "primary");
      const backup = this.createLoginServerEndpointFromEntry(managedEntries[1], "backup");
      return {
        type: "managed",
        eqhostPath,
        content,
        primary,
        backup,
        activeRole: getActiveManagedLoginServerRole(managedEntries)
      };
    }

    const configuredHost = parseEqhostLoginServer(content);
    if (!configuredHost) {
      return {
        type: "fallback",
        endpoint: this.getLoginServerEndpointFallback("eqhost.txt does not contain an active Host entry."),
        primary: managedEntries[0] ? this.createLoginServerEndpointFromEntry(managedEntries[0], "primary") : null,
        backup: null,
        activeRole: ""
      };
    }

    const endpoint = resolveEndpoint(configuredHost, 0, 5999);
    return {
      type: "single",
      endpoint: {
        ...endpoint,
        role: "primary",
        timeoutMs: this.getLoginServerStatusTimeoutMs(),
        detail: ""
      },
      primary: {
        ...endpoint,
        role: "primary",
        timeoutMs: this.getLoginServerStatusTimeoutMs()
      },
      backup: null,
      activeRole: "primary"
    };
  }

  async activateEqhostLoginServer(configuration, role) {
    const normalizedRole = normalizeLoginServerRole(role);
    if (configuration?.type !== "managed" || !normalizedRole) {
      return false;
    }

    const result = setEqhostActiveLoginServer(configuration.content, normalizedRole);
    if (!result.changed) {
      return false;
    }

    await fsp.writeFile(configuration.eqhostPath, result.content, "utf8");
    configuration.content = result.content;
    configuration.activeRole = normalizedRole;
    return true;
  }

  async checkLoginServerEndpoint(endpoint) {
    const startedAt = Date.now();
    const checkedAt = new Date().toISOString();
    const target = `${endpoint.host}:${endpoint.port}`;

    try {
      const result = await this.testLoginServerConnection(endpoint);
      return {
        online: true,
        checkedAt,
        latencyMs: Math.max(1, Date.now() - startedAt),
        target,
        probe: result.probe,
        error: ""
      };
    } catch (error) {
      return {
        online: false,
        checkedAt,
        latencyMs: 0,
        target,
        error: String(error?.message || "Connection failed.").trim()
      };
    }
  }

  async testLoginServerConnection(endpoint) {
    try {
      await this.testGameServerConnection(endpoint);
      return { probe: "tcp" };
    } catch (tcpError) {
      const tcpMessage = String(tcpError?.message || "Connection failed.").trim();

      try {
        await this.testEqLoginServerSessionConnection(endpoint);
        return { probe: "eq-udp" };
      } catch {
        throw new Error(tcpMessage);
      }
    }
  }

  async testEqLoginServerSessionConnection(endpoint) {
    if (this.loginServerUdpProbeImpl) {
      await this.loginServerUdpProbeImpl(endpoint);
      return;
    }

    await this.testEqLoginServerSessionProbe(endpoint);
  }

  async testEqLoginServerSessionProbe({ host, port, timeoutMs }) {
    await new Promise((resolve, reject) => {
      let socket = null;
      let timeout = null;
      let settled = false;
      const connectCode = crypto.randomBytes(4).readUInt32BE(0);
      const request = createEqLoginSessionRequest(connectCode);

      const finish = (error = null) => {
        if (settled) {
          return;
        }

        settled = true;
        if (timeout) {
          clearTimeout(timeout);
        }

        if (socket) {
          socket.removeAllListeners("message");
          socket.removeAllListeners("error");
          if (typeof socket.close === "function") {
            socket.close();
          }
        }

        if (error) {
          reject(error);
          return;
        }

        resolve();
      };

      const sendDisconnectAndFinish = (disconnect) => {
        if (!socket || typeof socket.send !== "function") {
          finish();
          return;
        }

        socket.send(disconnect, port, host, () => finish());
      };

      try {
        socket = this.dgramCreateSocketImpl("udp4");
      } catch (error) {
        finish(error);
        return;
      }

      if (!socket || typeof socket.once !== "function" || typeof socket.send !== "function") {
        finish(new Error("Login protocol status check did not return a UDP socket."));
        return;
      }

      timeout = setTimeout(() => {
        const error = new Error(`Login protocol probe timed out after ${timeoutMs}ms.`);
        error.code = "ETIMEDOUT";
        finish(error);
      }, timeoutMs);

      socket.once("message", (message) => {
        if (!isEqLoginSessionResponse(message, connectCode)) {
          finish(new Error("Login protocol probe received an unexpected response."));
          return;
        }

        sendDisconnectAndFinish(createEqLoginSessionDisconnect(connectCode, message));
      });

      socket.once("error", (error) => finish(error));
      socket.send(request, port, host, (error) => {
        if (error) {
          finish(error);
        }
      });
    });
  }

  setLoginServerStatusFromCheck(endpoint, check, {
    role = "",
    failoverActive = false,
    primary = null,
    backup = null,
    primaryError = "",
    backupError = "",
    allowUnconfirmedSelection = false,
    unconfirmedDetail = ""
  } = {}) {
    this.state.loginServerHost = endpoint.host;
    this.state.loginServerPort = endpoint.host ? endpoint.port : 0;
    this.syncLoginServerSelectionState({
      activeRole: role,
      failoverActive,
      primary,
      backup
    });

    if (check.online) {
      this.state.loginServerStatus = createLoginServerStatus({
        state: "online",
        label: role === "backup" ? "Backup" : "Online",
        detail: createLoginServerConnectedDetail(check),
        host: endpoint.host,
        port: endpoint.port,
        checkedAt: check.checkedAt,
        latencyMs: check.latencyMs,
        error: "",
        role,
        selectionMode: this.state.loginServerSelectionMode,
        failoverActive: Boolean(failoverActive),
        primaryError,
        backupError
      });
      return;
    }

    if (allowUnconfirmedSelection) {
      const detail = unconfirmedDetail || `Selected ${check.target}. Login server status check could not confirm reachability: ${check.error}`;
      this.state.loginServerStatus = createLoginServerStatus({
        state: "unknown",
        label: role === "backup" ? "Backup" : "Selected",
        detail,
        host: endpoint.host,
        port: endpoint.port,
        checkedAt: check.checkedAt,
        latencyMs: 0,
        error: check.error,
        role,
        selectionMode: this.state.loginServerSelectionMode,
        failoverActive: Boolean(failoverActive),
        primaryError,
        backupError
      });
      return;
    }

    this.state.loginServerStatus = createLoginServerStatus({
      state: "offline",
      label: "Offline",
      detail: `Unable to reach ${check.target}.`,
      host: endpoint.host,
      port: endpoint.port,
      checkedAt: check.checkedAt,
      latencyMs: 0,
      error: check.error,
      role,
      selectionMode: this.state.loginServerSelectionMode,
      failoverActive: Boolean(failoverActive),
      primaryError,
      backupError
    });
  }

  async testGameServerConnection({ host, port, timeoutMs }) {
    await new Promise((resolve, reject) => {
      let socket = null;
      let settled = false;

      const finish = (error = null) => {
        if (settled) {
          return;
        }

        settled = true;
        if (socket) {
          socket.removeAllListeners("connect");
          socket.removeAllListeners("error");
          socket.removeAllListeners("timeout");
          if (typeof socket.destroy === "function") {
            socket.destroy();
          }
        }

        if (error) {
          reject(error);
          return;
        }

        resolve();
      };

      try {
        socket = this.netConnectImpl({ host, port });
      } catch (error) {
        finish(error);
        return;
      }

      if (!socket || typeof socket.once !== "function") {
        finish(new Error("Game server connection check did not return a socket."));
        return;
      }

      socket.once("connect", () => finish());
      socket.once("error", (error) => finish(error));
      if (typeof socket.setTimeout === "function") {
        socket.setTimeout(timeoutMs, () => {
          const error = new Error(`Connection timed out after ${timeoutMs}ms.`);
          error.code = "ETIMEDOUT";
          finish(error);
        });
      }
    });
  }

  async refreshGameServerStatus() {
    const endpoint = this.getConfiguredGameServerEndpoint();
    this.state.gameServerHost = endpoint.host;
    this.state.gameServerPort = endpoint.host ? endpoint.port : 0;

    if (!endpoint.host) {
      this.state.gameServerStatus = createGameServerStatus();
      return;
    }

    const startedAt = Date.now();
    const checkedAt = new Date().toISOString();
    const target = `${endpoint.host}:${endpoint.port}`;

    try {
      await this.testGameServerConnection(endpoint);
      const latencyMs = Math.max(1, Date.now() - startedAt);
      this.state.gameServerStatus = createGameServerStatus({
        state: "online",
        label: "Online",
        detail: `Connected to ${target} in ${latencyMs}ms.`,
        host: endpoint.host,
        port: endpoint.port,
        checkedAt,
        latencyMs,
        error: ""
      });
    } catch (error) {
      const message = String(error?.message || "Connection failed.").trim();
      this.state.gameServerStatus = createGameServerStatus({
        state: "offline",
        label: "Offline",
        detail: `Unable to reach ${target}.`,
        host: endpoint.host,
        port: endpoint.port,
        checkedAt,
        latencyMs: 0,
        error: message
      });
    }
  }

  async refreshLoginServerStatus() {
    const configuration = await this.getLoginServerConfiguration();
    const primary = configuration.primary || null;
    const backup = configuration.backup || null;

    if (configuration.type === "managed") {
      if (this.state.loginServerSelectionMode === "manual") {
        const manualRole = normalizeLoginServerRole(this.state.loginServerActiveRole) || configuration.activeRole || "primary";
        const endpoint = manualRole === "backup" ? backup : primary;
        await this.activateEqhostLoginServer(configuration, manualRole);
        const check = await this.checkLoginServerEndpoint(endpoint);
        this.setLoginServerStatusFromCheck(endpoint, check, {
          role: manualRole,
          failoverActive: false,
          primary,
          backup,
          primaryError: manualRole === "primary" ? check.error : "",
          backupError: manualRole === "backup" ? check.error : "",
          allowUnconfirmedSelection: true
        });
        return;
      }

      const primaryCheck = await this.checkLoginServerEndpoint(primary);
      if (primaryCheck.online) {
        await this.activateEqhostLoginServer(configuration, "primary");
        this.setLoginServerStatusFromCheck(primary, primaryCheck, {
          role: "primary",
          failoverActive: false,
          primary,
          backup
        });
        return;
      }

      const backupCheck = await this.checkLoginServerEndpoint(backup);
      if (backupCheck.online) {
        await this.activateEqhostLoginServer(configuration, "backup");
        this.setLoginServerStatusFromCheck(backup, backupCheck, {
          role: "backup",
          failoverActive: true,
          primary,
          backup,
          primaryError: primaryCheck.error
        });
        return;
      }

      await this.activateEqhostLoginServer(configuration, "backup");
      this.setLoginServerStatusFromCheck(backup, backupCheck, {
        role: "backup",
        failoverActive: true,
        primary,
        backup,
        primaryError: primaryCheck.error,
        backupError: backupCheck.error,
        allowUnconfirmedSelection: true,
        unconfirmedDetail: `Primary login server is unreachable, so backup ${backupCheck.target} was selected. Backup status check could not confirm reachability: ${backupCheck.error}`
      });
      return;
    }

    const endpoint = configuration.endpoint;
    this.state.loginServerHost = endpoint.host;
    this.state.loginServerPort = endpoint.host ? endpoint.port : 0;
    this.syncLoginServerSelectionState({
      activeRole: configuration.activeRole || "",
      failoverActive: false,
      primary,
      backup
    });

    if (!endpoint.host) {
      this.state.loginServerStatus = createLoginServerStatus({
        detail: endpoint.detail || "Select a game directory with eqhost.txt to show login server status.",
        role: configuration.activeRole || "",
        selectionMode: this.state.loginServerSelectionMode,
        failoverActive: false
      });
      return;
    }

    const check = await this.checkLoginServerEndpoint(endpoint);
    this.setLoginServerStatusFromCheck(endpoint, check, {
      role: configuration.activeRole || endpoint.role || "",
      failoverActive: false,
      primary,
      backup
    });
  }

  async refreshServerStatus() {
    await Promise.all([
      this.refreshGameServerStatus(),
      this.refreshLoginServerStatus()
    ]);
    return this.getState();
  }

  async setActiveLoginServer(options = {}) {
    const requestedRole = String(options.role || "").trim().toLowerCase();
    if (requestedRole === "auto") {
      this.state.loginServerSelectionMode = "auto";
      this.state.loginServerActiveRole = "";
      await this.refreshLoginServerStatus();
      this.emitState();
      return this.getState();
    }

    const role = normalizeLoginServerRole(requestedRole);
    if (!role) {
      throw new Error("A login server role of primary, backup, or auto is required.");
    }

    const configuration = await this.getLoginServerConfiguration();
    if (configuration.type !== "managed") {
      throw new Error("Manual login server switching requires two Host entries in eqhost.txt.");
    }

    this.state.loginServerSelectionMode = "manual";
    this.state.loginServerActiveRole = role;
    await this.activateEqhostLoginServer(configuration, role);
    await this.refreshLoginServerStatus();
    this.emitState();
    return this.getState();
  }

  setStatus(badge, detail, error = "") {
    this.state.statusBadge = badge;
    this.state.statusDetail = detail;
    this.state.lastError = error;
  }

  clearPrerequisiteInstallOffer() {
    this.state.canInstallPrerequisites = false;
    this.state.prerequisiteInstallArch = "";
    this.state.prerequisiteInstallReason = "";
    this.state.prerequisiteDirectXUrl = "";
    this.state.prerequisiteVcUrl = "";
  }

  setPrerequisiteInstallOffer(offer) {
    this.state.canInstallPrerequisites = true;
    this.state.prerequisiteInstallArch = offer.vcArch || "";
    this.state.prerequisiteInstallReason = offer.reason || "";
    this.state.prerequisiteDirectXUrl = offer.directxUrl || "";
    this.state.prerequisiteVcUrl = offer.vcUrl || "";
  }

  async buildMissingRuntimeInstallOffer(eqGamePath = this.getEqGamePath()) {
    const executableArch = eqGamePath && (await exists(eqGamePath))
      ? await detectPortableExecutableArchitecture(eqGamePath)
      : "";
    const vcArch = executableArch || getPreferredWindowsRuntimeArchitecture(this.environment);

    return {
      vcArch,
      directxUrl: PREREQUISITE_DOWNLOADS.directx.url,
      vcUrl: PREREQUISITE_DOWNLOADS.vcRedist[vcArch] || PREREQUISITE_DOWNLOADS.vcRedist.x64,
      reason: executableArch
        ? `Using the Visual C++ ${vcArch.toUpperCase()} redistributable because eqgame.exe is ${executableArch.toUpperCase()}.`
        : `Using the Visual C++ ${vcArch.toUpperCase()} redistributable based on this Windows installation.`
    };
  }

  updatePrerequisiteProgress(value, max, label) {
    this.state.progressValue = value;
    this.state.progressMax = max;
    this.state.progressLabel = label;
    this.emitProgress();
  }

  setPrerequisiteInstallStage({ stage, progressValue, progressMax = 100, label, detail, logText, logTone = "info" }) {
    if (Number.isFinite(progressValue)) {
      this.updatePrerequisiteProgress(progressValue, progressMax, label || this.state.progressLabel);
    } else if (label) {
      this.state.progressLabel = label;
      this.emitProgress();
    }

    if (detail) {
      this.setStatus("Installing", detail);
      this.emitState();
    }

    if (logText) {
      this.emitLog(logText, logTone);
    }

    return stage;
  }

  updateDownloadProgressRange(startValue, endValue, label, downloadedBytes, totalBytes) {
    if (!Number.isFinite(downloadedBytes) || downloadedBytes < 0) {
      return;
    }

    const safeTotal = Number.isFinite(totalBytes) && totalBytes > 0 ? totalBytes : 0;
    const boundedStart = Number.isFinite(startValue) ? startValue : 0;
    const boundedEnd = Number.isFinite(endValue) ? endValue : boundedStart;
    let value = boundedStart;

    if (safeTotal > 0) {
      const ratio = Math.max(0, Math.min(downloadedBytes / safeTotal, 1));
      value = boundedStart + ((boundedEnd - boundedStart) * ratio);
    }

    this.updatePrerequisiteProgress(Math.round(value), 100, label);
  }

  async maybeDelayPrerequisiteSimulation() {
    if (this.testSimulation.delayMs > 0) {
      await sleep(this.testSimulation.delayMs);
    }
  }

  async runSimulatedPrerequisiteInstallation(offer, eqGamePath) {
    const simulateStep = async ({ stage, progressValue, label, detail, logText }) => {
      this.setPrerequisiteInstallStage({
        stage,
        progressValue,
        label,
        detail,
        logText
      });
      await this.maybeDelayPrerequisiteSimulation();
    };

    await simulateStep({
      stage: "downloadDirectX",
      progressValue: 10,
      label: "Step 1 of 5: Downloading DirectX runtime",
      detail: "Simulating DirectX runtime download.",
      logText: "Simulation: DirectX runtime download completed."
    });
    await simulateStep({
      stage: "extractDirectX",
      progressValue: 28,
      label: "Step 2 of 5: Extracting DirectX files",
      detail: "Simulating DirectX redistributable extraction.",
      logText: "Simulation: DirectX redistributable extracted."
    });
    await simulateStep({
      stage: "installDirectX",
      progressValue: 52,
      label: "Step 3 of 5: Installing DirectX runtime",
      detail: "Simulating DirectX runtime installation.",
      logText: "Simulation: DirectX runtime install completed."
    });
    await simulateStep({
      stage: "downloadVcRedist",
      progressValue: 72,
      label: `Step 4 of 5: Downloading Visual C++ ${offer.vcArch.toUpperCase()}`,
      detail: `Simulating Visual C++ ${offer.vcArch.toUpperCase()} redistributable download.`,
      logText: `Simulation: Visual C++ ${offer.vcArch.toUpperCase()} redistributable download completed.`
    });
    await simulateStep({
      stage: "installVcRedist",
      progressValue: 90,
      label: `Step 5 of 5: Installing Visual C++ ${offer.vcArch.toUpperCase()}`,
      detail: `Simulating Visual C++ ${offer.vcArch.toUpperCase()} runtime installation.`,
      logText: `Simulation: Visual C++ ${offer.vcArch.toUpperCase()} redistributable install completed.`
    });

    const installMode = this.testSimulation.installMode;
    if (installMode === "fail") {
      const error = new Error("Simulated prerequisite installer failure.");
      error.simulated = true;
      error.prerequisiteStage = "installVcRedist";
      throw error;
    }

    if (installMode === "incomplete") {
      return {
        validationScan: await this.inspectMissingRuntimeDependencies(eqGamePath),
        vcExitCode: 0
      };
    }

    if (installMode === "reboot") {
      return {
        validationScan: {
          executableArch: offer.vcArch,
          missingDependencies: [],
          primaryMissingDependency: "",
          missingSummary: ""
        },
        vcExitCode: 3010
      };
    }

    return {
      validationScan: {
        executableArch: offer.vcArch,
        missingDependencies: [],
        primaryMissingDependency: "",
        missingSummary: ""
      },
      vcExitCode: 0
    };
  }

  async inspectMissingRuntimeDependencies(eqGamePath = this.getEqGamePath()) {
    if (this.testSimulation.missingDlls.length) {
      const missingDependencies = this.testSimulation.missingDlls.map((name) => ({
        name,
        referencedBy: path.basename(eqGamePath || "eqgame.exe")
      }));
      return {
        executableArch: await detectPortableExecutableArchitecture(eqGamePath),
        missingDependencies,
        primaryMissingDependency: missingDependencies[0]?.name || "",
        missingSummary: missingDependencies.length
          ? `Static dependency scan found unresolved DLL imports${missingDependencies[0]?.name ? `, including ${missingDependencies[0].name}` : ""}.`
          : ""
      };
    }

    if (this.platform !== "win32" || !eqGamePath || !(await exists(eqGamePath))) {
      return {
        executableArch: "",
        missingDependencies: [],
        primaryMissingDependency: "",
        missingSummary: ""
      };
    }

    const rootMetadata = await readPortableExecutableMetadata(eqGamePath);
    const executableArch = rootMetadata?.architecture || getPreferredWindowsRuntimeArchitecture(this.environment);
    const searchPaths = getWindowsDependencySearchPaths(eqGamePath, executableArch, this.environment);
    const pendingPaths = [eqGamePath];
    const visitedPaths = new Set();
    const missingDependencies = [];
    const missingNames = new Set();

    while (pendingPaths.length && missingDependencies.length < 8) {
      const currentPath = pendingPaths.shift();
      const normalizedCurrentPath = path.normalize(currentPath).toLowerCase();
      if (visitedPaths.has(normalizedCurrentPath)) {
        continue;
      }
      visitedPaths.add(normalizedCurrentPath);

      const metadata = currentPath === eqGamePath ? rootMetadata : await readPortableExecutableMetadata(currentPath);
      if (!metadata || !Array.isArray(metadata.imports) || !metadata.imports.length) {
        continue;
      }

      for (const importName of metadata.imports) {
        if (shouldIgnoreDependencyName(importName)) {
          continue;
        }

        const normalizedImportName = String(importName).trim().toLowerCase();
        const resolvedPath = resolveWindowsDependencyPath(importName, searchPaths);
        if (!resolvedPath) {
          if (!missingNames.has(normalizedImportName)) {
            missingNames.add(normalizedImportName);
            missingDependencies.push({
              name: importName,
              referencedBy: path.basename(currentPath)
            });
          }
          continue;
        }

        const normalizedResolvedPath = path.normalize(resolvedPath).toLowerCase();
        if (!visitedPaths.has(normalizedResolvedPath)) {
          pendingPaths.push(resolvedPath);
        }
      }
    }

    const primaryMissingDependency = missingDependencies[0]?.name || "";
    const missingSummary = primaryMissingDependency
      ? `Static dependency scan found unresolved DLL imports${missingDependencies.length === 1 ? `, including ${primaryMissingDependency}` : ""}.`
      : "";

    return {
      executableArch,
      missingDependencies,
      primaryMissingDependency,
      missingSummary
    };
  }

  emitMissingDependencyLogs(scanResult) {
    if (!scanResult?.primaryMissingDependency) {
      return;
    }

    const [primaryDependency, ...remainingDependencies] = scanResult.missingDependencies;
    this.emitLog(
      `Static dependency scan found unresolved DLL import: ${primaryDependency.name}${primaryDependency.referencedBy ? ` (referenced by ${primaryDependency.referencedBy})` : ""}.`,
      "warning"
    );

    if (remainingDependencies.length) {
      this.emitLog(
        `Additional unresolved imports from the static scan: ${remainingDependencies.slice(0, 3).map((entry) => entry.name).join(", ")}${remainingDependencies.length > 3 ? ", ..." : ""}.`,
        "warning"
      );
    }
  }

  resolveServerName(options = {}) {
    const { manifest = null } = options;
    const explicitServerNames = [
      manifest?.serverName,
      this.gameSettings?.serverName,
      this.config.serverName
    ];

    for (const candidate of explicitServerNames) {
      const normalizedCandidate = normalizeServerName(candidate);
      if (normalizedCandidate && !looksLikeLegacyServerName(normalizedCandidate)) {
        return normalizedCandidate;
      }
    }

    const derivedServerName = (
      deriveServerNameFromUrl(manifest?.downloadprefix) ||
      deriveServerNameFromUrl(this.gameSettings?.filelistUrl) ||
      deriveServerNameFromUrl(this.config.filelistUrl)
    );

    if (derivedServerName) {
      return derivedServerName;
    }

    return normalizeServerName(this.config.serverName) || DEFAULTS.serverName;
  }

  async initialize() {
    if (this.initializePromise) {
      return this.initializePromise;
    }

    this.initializePromise = this.performInitialize().finally(() => {
      this.initializePromise = null;
    });

    return this.initializePromise;
  }

  async performInitialize() {
    await this.loadConfig();
    await this.loadAppState();
    await this.loadAutoLoginProfiles();
    await this.useLaunchDirectory();
    await this.ensureGameDirectoryConfig();
    await this.loadConfig();
    await this.loadGameSettings();
    await this.launcherUpdater.initialize({
      releaseApiUrl: this.config.launcherReleaseApiUrl
    });

    const state = await this.refreshState({
      performAutoActions: false,
      skipManifestFetch: true
    });

    if (state.gameDirectory && state.clientVersion !== "Unknown" && state.clientSupported) {
      this.refreshState({ performAutoActions: true }).catch((error) => {
        this.setStatus("Manifest Error", error.message, error.message);
        this.emitLog(`Manifest fetch failed: ${error.message}`, "error");
        this.emitState();
      });
    }

    this.checkForLauncherUpdate({ force: true }).catch((error) => {
      this.emitLog(`Launcher update check failed: ${error.message}`, "error");
    });
    return state;
  }

  async useLaunchDirectory() {
    if (!this.launchDirectory) {
      return;
    }

    this.state.gameDirectory = this.launchDirectory;
    this.appState.gameDirectory = this.launchDirectory;
    await this.saveAppState();
  }

  async resolveConfigPath() {
    this.gameConfigPath = this.state.gameDirectory ? path.join(this.state.gameDirectory, "launcher-config.yml") : "";

    if (this.gameConfigPath && (await exists(this.gameConfigPath))) {
      return this.gameConfigPath;
    }

    if (this.launchConfigPath && (await exists(this.launchConfigPath))) {
      return this.launchConfigPath;
    }

    if (this.runtimeConfigPath && (await exists(this.runtimeConfigPath))) {
      return this.runtimeConfigPath;
    }

    return this.configPath;
  }

  async ensureGameDirectoryConfig() {
    if (!this.state.gameDirectory) {
      return;
    }

    const gameConfigPath = path.join(this.state.gameDirectory, "launcher-config.yml");
    this.gameConfigPath = gameConfigPath;

    if (await exists(gameConfigPath)) {
      return;
    }

    const sourceCandidates = [
      this.resolvedConfigPath,
      this.launchConfigPath,
      this.runtimeConfigPath,
      this.configPath
    ].filter(Boolean);

    for (const sourcePath of sourceCandidates) {
      if (path.resolve(sourcePath) === path.resolve(gameConfigPath)) {
        continue;
      }

      if (!(await exists(sourcePath))) {
        continue;
      }

      await fsp.mkdir(path.dirname(gameConfigPath), { recursive: true });
      await fsp.copyFile(sourcePath, gameConfigPath);
      return;
    }

    await this.saveYaml(gameConfigPath, this.config);
  }

  async loadConfig() {
    this.config = { ...DEFAULTS };
    const resolvedConfigPath = await this.resolveConfigPath();
    this.resolvedConfigPath = resolvedConfigPath;

    if (!(await exists(resolvedConfigPath))) {
      this.state.serverName = this.resolveServerName();
      this.state.filelistUrl = this.config.filelistUrl;
      this.state.patchNotesUrl = this.config.patchNotesUrl;
      this.state.launcherReleaseApiUrl = this.config.launcherReleaseApiUrl;
      this.syncGameServerConfigState();
      this.syncBrandingState();
      return;
    }

    try {
      const parsed = await this.loadYaml(resolvedConfigPath);
      this.config = {
        ...DEFAULTS,
        ...(parsed || {})
      };
    } catch (_error) {
      this.config = { ...DEFAULTS };
    }

    if (!Array.isArray(this.config.supportedClients)) {
      this.config.supportedClients = [...DEFAULTS.supportedClients];
    }

    if (!Array.isArray(this.config.tools)) {
      this.config.tools = [];
    }

    this.state.serverName = this.resolveServerName();
    this.state.filelistUrl = this.config.filelistUrl;
    this.state.patchNotesUrl = this.config.patchNotesUrl;
    this.state.launcherReleaseApiUrl = this.config.launcherReleaseApiUrl;
    this.syncGameServerConfigState();
    this.syncBrandingState();
  }


  async getPatchNotes(options = {}) {
    const { forceRefresh = false } = options;

    try {
      const notes = await this.fetchPatchNotes({ forceRefresh });
      return {
        ...notes,
        error: ""
      };
    } catch (error) {
      return {
        url: String(this.config.patchNotesUrl || "").trim(),
        content: "",
        html: "",
        fetchedAt: "",
        lineCount: 0,
        contentHash: "",
        error: error.message || "Unable to load patch notes."
      };
    }
  }

  async checkForLauncherUpdate(options = {}) {
    await this.launcherUpdater.checkForUpdate({
      force: Boolean(options.force),
      releaseApiUrl: this.config.launcherReleaseApiUrl
    });
    this.state.launcherUpdate = this.launcherUpdater.getState();
    return this.getState();
  }

  async startLauncherUpdateDownload() {
    await this.launcherUpdater.startDownload({
      releaseApiUrl: this.config.launcherReleaseApiUrl
    });
    this.state.launcherUpdate = this.launcherUpdater.getState();
    return this.getState();
  }

  async applyLauncherUpdate() {
    if (this.state.isPatching) {
      this.state.launcherUpdate = {
        ...this.state.launcherUpdate,
        status: "error",
        message: "Finish or cancel the current patch before restarting to update the launcher."
      };
      this.emitState();
      return {
        ok: false,
        shouldQuit: false,
        state: this.getState()
      };
    }

    const result = await this.launcherUpdater.applyUpdate();
    this.state.launcherUpdate = result.state;
    return {
      ...result,
      state: this.getState()
    };
  }

  throwIfUiManagerActionLocked() {
    if (this.state.isInstallingPrerequisites) {
      throw new Error("UI Manager actions are unavailable while prerequisites are installing.");
    }
  }

  async getUiManagerOverview() {
    return this.uiManager.getUiManagerOverview();
  }

  async importUiPackageFolder(sourcePath) {
    this.throwIfUiManagerActionLocked();
    return this.uiManager.importUiPackageFolder(sourcePath);
  }

  async prepareUiPackage(packageName) {
    this.throwIfUiManagerActionLocked();
    return this.uiManager.prepareUiPackage(packageName);
  }

  async validateUiPackageOptionComments(packageName) {
    this.throwIfUiManagerActionLocked();
    return this.uiManager.validateUiPackageOptionComments(packageName);
  }

  async checkUiPackageMetadata(packageName) {
    return this.uiManager.checkUiPackageMetadata(packageName);
  }

  async getUiPackageDetails(packageName) {
    return this.uiManager.getUiPackageDetails(packageName);
  }

  async activateUiOption(options = {}) {
    this.throwIfUiManagerActionLocked();
    return this.uiManager.activateUiOption(options);
  }

  async setUiSkinTargets(options = {}) {
    this.throwIfUiManagerActionLocked();
    return this.uiManager.setUiSkinTargets(options);
  }

  async resetUiPackage(packageName) {
    this.throwIfUiManagerActionLocked();
    return this.uiManager.resetUiPackage(packageName);
  }

  async listUiManagerBackups(packageName) {
    return this.uiManager.listUiManagerBackups(packageName);
  }

  async restoreUiManagerBackup(options = {}) {
    this.throwIfUiManagerActionLocked();
    return this.uiManager.restoreUiManagerBackup(options);
  }

  async loadPatchNotesCache() {
    if (this.patchNotesCacheLoaded) {
      return;
    }

    this.patchNotesCacheLoaded = true;
    if (!(await exists(this.patchNotesCachePath))) {
      return;
    }

    try {
      const raw = await fsp.readFile(this.patchNotesCachePath, "utf8");
      const parsed = JSON.parse(raw);
      this.patchNotesCache = {
        ...this.patchNotesCache,
        ...(parsed || {})
      };
      if (this.patchNotesCache.content && !this.patchNotesCache.contentHash) {
        this.patchNotesCache.contentHash = computePatchNotesContentHash(this.patchNotesCache.content);
      }
    } catch (_error) {
      this.patchNotesCache = createEmptyPatchNotesCache();
    }
  }

  async savePatchNotesCache() {
    await fsp.mkdir(path.dirname(this.patchNotesCachePath), { recursive: true });
    await fsp.writeFile(this.patchNotesCachePath, JSON.stringify(this.patchNotesCache, null, 2), "utf8");
  }

  async fetchPatchNotes(options = {}) {
    const { forceRefresh = false } = options;
    const patchNotesUrl = String(this.config.patchNotesUrl || "").trim();
    await this.loadPatchNotesCache();

    if (!patchNotesUrl) {
      this.patchNotesCache = createEmptyPatchNotesCache();
      return createEmptyPatchNotesCache();
    }

    const requestHeaders = {};
    if (!forceRefresh && this.patchNotesCache.url === patchNotesUrl && this.patchNotesCache.etag) {
      requestHeaders["If-None-Match"] = this.patchNotesCache.etag;
    }
    if (!forceRefresh && this.patchNotesCache.url === patchNotesUrl && this.patchNotesCache.lastModified) {
      requestHeaders["If-Modified-Since"] = this.patchNotesCache.lastModified;
    }

    let response;
    try {
      response = await this.fetchImpl(patchNotesUrl, Object.keys(requestHeaders).length ? { headers: requestHeaders } : undefined);
    } catch (error) {
      if (this.patchNotesCache.url === patchNotesUrl && this.patchNotesCache.content) {
        return cloneState(this.patchNotesCache);
      }
      throw error;
    }
    if (response.status === 304 && this.patchNotesCache.url === patchNotesUrl && this.patchNotesCache.content) {
      return cloneState(this.patchNotesCache);
    }

    if (!response.ok) {
      throw new Error(`Patch notes request failed with ${response.status}`);
    }

    const content = await response.text();
    const html = content ? markdownToHtml(content) : "";
    this.patchNotesCache = {
      url: patchNotesUrl,
      content,
      html,
      fetchedAt: new Date().toISOString(),
      lineCount: content ? content.split("\n").length : 0,
      contentHash: computePatchNotesContentHash(content),
      etag: response.headers?.get?.("etag") || "",
      lastModified: response.headers?.get?.("last-modified") || ""
    };
    await this.savePatchNotesCache();
    return cloneState(this.patchNotesCache);
  }

  async getResolvedConfigPath() {
    const resolvedConfigPath = await this.resolveConfigPath();
    this.resolvedConfigPath = resolvedConfigPath;
    return resolvedConfigPath;
  }

  async loadAppState() {
    await fsp.mkdir(this.appUserDataPath, { recursive: true });
    if (!(await exists(this.appStatePath))) {
      await this.saveYaml(this.appStatePath, this.appState);
      return;
    }

    try {
      const parsed = await this.loadYaml(this.appStatePath);
      this.appState = { ...this.appState, ...(parsed || {}) };
      this.state.gameDirectory = this.appState.gameDirectory || "";
      this.state.onGameLaunch = normalizeOnGameLaunch(this.appState.onGameLaunch);
      this.state.autoLoginEnterWorld = this.appState.autoLoginEnterWorld === true;
      this.state.selectedAutoLoginProfileId = normalizeAutoLoginProfileId(this.appState.selectedAutoLoginProfileId);
      this.state.selectedAutoLoginProfileIds = normalizeAutoLoginProfileIds(this.appState.selectedAutoLoginProfileIds);
      this.appState.onGameLaunch = this.state.onGameLaunch;
      this.appState.autoLoginEnterWorld = this.state.autoLoginEnterWorld;
      this.appState.selectedAutoLoginProfileId = this.state.selectedAutoLoginProfileId;
      this.appState.selectedAutoLoginProfileIds = [...this.state.selectedAutoLoginProfileIds];
    } catch (_error) {
      this.appState = {
        gameDirectory: "",
        onGameLaunch: normalizeOnGameLaunch(DEFAULTS.defaultOnGameLaunch),
        autoLoginEnterWorld: false,
        selectedAutoLoginProfileId: "",
        selectedAutoLoginProfileIds: []
      };
      this.state.onGameLaunch = this.appState.onGameLaunch;
      this.state.autoLoginEnterWorld = false;
      this.state.selectedAutoLoginProfileId = "";
      this.state.selectedAutoLoginProfileIds = [];
      await this.saveYaml(this.appStatePath, this.appState);
    }
  }

  async saveAppState() {
    await this.saveYaml(this.appStatePath, this.appState);
  }

  normalizeAutoLoginProfileDefaults() {
    if (!Array.isArray(this.autoLoginProfiles) || this.autoLoginProfiles.length === 0) {
      return;
    }

    let defaultAssigned = false;
    this.autoLoginProfiles = this.autoLoginProfiles.map((profile, index) => {
      const shouldBeDefault = profile.isDefault === true && !defaultAssigned;
      if (shouldBeDefault) {
        defaultAssigned = true;
      }
      return {
        ...profile,
        isDefault: shouldBeDefault
      };
    });

    if (!defaultAssigned) {
      this.autoLoginProfiles[0] = {
        ...this.autoLoginProfiles[0],
        isDefault: true
      };
    }
  }

  syncAutoLoginProfilesState() {
    this.normalizeAutoLoginProfileDefaults();
    const sanitizedProfiles = sanitizeAutoLoginProfiles(this.autoLoginProfiles);
    const profileIds = new Set(sanitizedProfiles.map((profile) => profile.id));
    const requestedSelectedIds = normalizeAutoLoginProfileIds(this.state.selectedAutoLoginProfileIds);
    let orderedSelectedIds = sanitizedProfiles
      .map((profile) => profile.id)
      .filter((id) => requestedSelectedIds.includes(id));
    let selectedId = normalizeAutoLoginProfileId(this.state.selectedAutoLoginProfileId);
    const selectedExists = profileIds.has(selectedId);
    const defaultProfile = sanitizedProfiles.find((profile) => profile.isDefault);
    selectedId = selectedExists
      ? selectedId
      : orderedSelectedIds[0] || defaultProfile?.id || sanitizedProfiles[0]?.id || "";
    if (!orderedSelectedIds.length && selectedId) {
      orderedSelectedIds = [selectedId];
    }
    this.state.autoLoginProfiles = sanitizedProfiles;
    this.state.selectedAutoLoginProfileId = selectedId;
    this.state.selectedAutoLoginProfileIds = orderedSelectedIds;
    this.appState.selectedAutoLoginProfileId = selectedId;
    this.appState.selectedAutoLoginProfileIds = [...orderedSelectedIds];
    if (!sanitizedProfiles.length) {
      this.state.autoLogin = false;
      this.state.selectedAutoLoginProfileId = "";
      this.state.selectedAutoLoginProfileIds = [];
      this.appState.selectedAutoLoginProfileId = "";
      this.appState.selectedAutoLoginProfileIds = [];
    }
  }

  async loadAutoLoginProfiles() {
    await fsp.mkdir(this.appUserDataPath, { recursive: true });

    if (!(await exists(this.autoLoginProfilesPath))) {
      this.autoLoginProfiles = [];
      this.syncAutoLoginProfilesState();
      return;
    }

    try {
      const parsed = JSON.parse(await fsp.readFile(this.autoLoginProfilesPath, "utf8"));
      const profiles = Array.isArray(parsed?.profiles) ? parsed.profiles : [];
      this.autoLoginProfiles = profiles
        .map((profile) => ({
          id: normalizeAutoLoginProfileId(profile?.id),
          label: normalizeAutoLoginText(profile?.label),
          username: normalizeAutoLoginText(profile?.username),
          secret: String(profile?.secret || ""),
          isDefault: profile?.isDefault === true,
          createdAt: String(profile?.createdAt || ""),
          updatedAt: String(profile?.updatedAt || "")
        }))
        .filter((profile) => profile.id && profile.username && profile.secret);
      this.syncAutoLoginProfilesState();
    } catch (error) {
      this.autoLoginProfiles = [];
      this.syncAutoLoginProfilesState();
      this.emitLog(`Account profile store could not be read: ${error.message}`, "warning");
    }
  }

  async saveAutoLoginProfiles() {
    await fsp.mkdir(path.dirname(this.autoLoginProfilesPath), { recursive: true });
    const payload = {
      version: 1,
      profiles: this.autoLoginProfiles
    };
    await fsp.writeFile(this.autoLoginProfilesPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    await fsp.chmod(this.autoLoginProfilesPath, 0o600).catch(() => {});
    this.syncAutoLoginProfilesState();
  }

  getAutoLoginProfiles() {
    this.syncAutoLoginProfilesState();
    return this.getState();
  }

  async selectAutoLoginProfile(options = {}) {
    const requestedId = normalizeAutoLoginProfileId(options.id);
    if (requestedId && !this.autoLoginProfiles.some((profile) => profile.id === requestedId)) {
      throw new Error("The selected account profile no longer exists.");
    }

    this.state.selectedAutoLoginProfileId = requestedId;
    this.state.selectedAutoLoginProfileIds = requestedId ? [requestedId] : [];
    this.syncAutoLoginProfilesState();
    await this.saveAppState();
    this.emitState();
    return this.getState();
  }

  async setAutoLoginProfileSelection(options = {}) {
    const existingIds = new Set(this.autoLoginProfiles.map((profile) => profile.id));
    const requestedIds = normalizeAutoLoginProfileIds(options.ids);
    const activeId = normalizeAutoLoginProfileId(options.activeId || options.id);

    for (const id of requestedIds) {
      if (!existingIds.has(id)) {
        throw new Error("One or more selected account profiles no longer exist.");
      }
    }

    if (activeId && !existingIds.has(activeId)) {
      throw new Error("The selected account profile no longer exists.");
    }

    this.state.selectedAutoLoginProfileIds = requestedIds;
    this.state.selectedAutoLoginProfileId = activeId || requestedIds[0] || "";
    this.syncAutoLoginProfilesState();
    await this.saveAppState();
    this.emitState();
    return this.getState();
  }

  async reorderAutoLoginProfiles(options = {}) {
    const requestedOrderIds = normalizeAutoLoginProfileIds(options.ids);
    const existingIds = new Set(this.autoLoginProfiles.map((profile) => profile.id));

    for (const id of requestedOrderIds) {
      if (!existingIds.has(id)) {
        throw new Error("One or more account profiles no longer exist.");
      }
    }

    if (requestedOrderIds.length === 0 || this.autoLoginProfiles.length <= 1) {
      this.syncAutoLoginProfilesState();
      return this.getState();
    }

    const profileById = new Map(this.autoLoginProfiles.map((profile) => [profile.id, profile]));
    const requestedOrderSet = new Set(requestedOrderIds);
    this.autoLoginProfiles = [
      ...requestedOrderIds.map((id) => profileById.get(id)).filter(Boolean),
      ...this.autoLoginProfiles.filter((profile) => !requestedOrderSet.has(profile.id))
    ];

    await this.saveAutoLoginProfiles();
    await this.saveAppState();
    this.state.autoLoginStatus = createAutoLoginStatus("idle", "Profiles reordered", "Account profile order was saved.");
    this.emitState();
    return this.getState();
  }

  async saveAutoLoginProfile(options = {}) {
    if (this.platform !== "win32") {
      throw new Error("Account profile storage is only available on Windows.");
    }

    const requestedId = normalizeAutoLoginProfileId(options.id);
    const username = normalizeAutoLoginText(options.username, 64);
    const label = normalizeAutoLoginText(options.label, 80) || username;
    const password = typeof options.password === "string" ? options.password : "";
    const existingIndex = requestedId
      ? this.autoLoginProfiles.findIndex((profile) => profile.id === requestedId)
      : -1;
    const existingProfile = existingIndex >= 0 ? this.autoLoginProfiles[existingIndex] : null;

    if (!username) {
      throw new Error("A login username is required.");
    }

    if (!existingProfile && !password) {
      throw new Error("A password is required when creating a new account profile.");
    }

    const now = new Date().toISOString();
    const profile = {
      id: existingProfile?.id || requestedId || createAutoLoginProfileId(),
      label,
      username,
      secret: existingProfile?.secret || "",
      isDefault: existingProfile?.isDefault === true,
      createdAt: existingProfile?.createdAt || now,
      updatedAt: now
    };

    if (password) {
      profile.secret = await this.protectAutoLoginSecret(password);
    }

    if (!profile.secret) {
      throw new Error("The account profile password could not be protected.");
    }

    if (options.isDefault === true) {
      this.autoLoginProfiles = this.autoLoginProfiles.map((candidate) => ({
        ...candidate,
        isDefault: false
      }));
      profile.isDefault = true;
    }

    if (existingIndex >= 0) {
      this.autoLoginProfiles.splice(existingIndex, 1, profile);
    } else {
      this.autoLoginProfiles.push(profile);
    }

    this.state.selectedAutoLoginProfileId = profile.id;
    this.state.selectedAutoLoginProfileIds = [profile.id];
    await this.saveAutoLoginProfiles();
    await this.saveAppState();
    this.state.autoLoginStatus = createAutoLoginStatus("idle", "Profile saved", `${profile.label} is ready to launch.`);
    this.emitLog(`Saved account profile '${profile.label}' for ${profile.username}.`, "success");
    this.emitState();
    return this.getState();
  }

  async deleteAutoLoginProfile(options = {}) {
    const requestedId = normalizeAutoLoginProfileId(options.id);
    const existingIndex = this.autoLoginProfiles.findIndex((profile) => profile.id === requestedId);
    if (existingIndex < 0) {
      throw new Error("The account profile no longer exists.");
    }

    const [removedProfile] = this.autoLoginProfiles.splice(existingIndex, 1);
    await this.saveAutoLoginProfiles();
    await this.saveAppState();
    await this.saveGameSettings();
    this.state.autoLoginStatus = createAutoLoginStatus("idle", "Profile deleted", `${removedProfile.label || removedProfile.username} was removed.`);
    this.emitLog(`Deleted account profile '${removedProfile.label || removedProfile.username}'.`, "warning");
    this.emitState();
    return this.getState();
  }

  async protectAutoLoginSecret(plainText) {
    if (this.platform !== "win32") {
      throw new Error("Secure account profile storage requires Windows DPAPI.");
    }

    const script = `
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Security
$plainText = [Console]::In.ReadToEnd()
$plainBytes = [System.Text.Encoding]::UTF8.GetBytes($plainText)
$entropy = [System.Text.Encoding]::UTF8.GetBytes('${AUTO_LOGIN_SECRET_ENTROPY}')
$protectedBytes = [System.Security.Cryptography.ProtectedData]::Protect($plainBytes, $entropy, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
[Console]::Out.Write([Convert]::ToBase64String($protectedBytes))
`;
    const result = await this.spawnAndCapture(this.resolvePowerShellCommand(), [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      script
    ], {
      input: plainText,
      windowsHide: true
    }, {
      label: "Windows credential protector",
      timeoutMs: 15000
    });

    const protectedSecret = String(result.stdout || "").trim();
    if (!protectedSecret) {
      throw new Error("Windows credential protector did not return an encrypted secret.");
    }

    return protectedSecret;
  }

  async unprotectAutoLoginSecret(protectedSecret) {
    if (this.platform !== "win32") {
      throw new Error("Secure account profile storage requires Windows DPAPI.");
    }

    const script = `
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Security
$protectedText = [Console]::In.ReadToEnd().Trim()
$protectedBytes = [Convert]::FromBase64String($protectedText)
$entropy = [System.Text.Encoding]::UTF8.GetBytes('${AUTO_LOGIN_SECRET_ENTROPY}')
$plainBytes = [System.Security.Cryptography.ProtectedData]::Unprotect($protectedBytes, $entropy, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
[Console]::Out.Write([System.Text.Encoding]::UTF8.GetString($plainBytes))
`;
    const result = await this.spawnAndCapture(this.resolvePowerShellCommand(), [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      script
    ], {
      input: String(protectedSecret || ""),
      windowsHide: true
    }, {
      label: "Windows credential reader",
      timeoutMs: 15000
    });

    return String(result.stdout || "");
  }

  resolvePowerShellCommand() {
    const systemRoot = this.environment.SystemRoot || this.environment.windir || "";
    const windowsPowerShell = systemRoot
      ? path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
      : "";
    return windowsPowerShell || "powershell.exe";
  }

  async setIniSectionValues(filePath, sectionName, values) {
    const sectionPattern = /^\s*\[([^\]]+)\]\s*$/;
    const assignmentPattern = /^\s*([^=;#][^=]*?)\s*=/;
    const normalizedSection = String(sectionName || "").trim().toLowerCase();
    const requestedValues = new Map(
      Object.entries(values || {}).map(([key, value]) => [
        String(key).trim().toLowerCase(),
        {
          key: String(key).trim(),
          value: sanitizeIniValue(value)
        }
      ])
    );

    if (!normalizedSection || requestedValues.size === 0) {
      return;
    }

    const existingContent = (await exists(filePath)) ? await fsp.readFile(filePath, "utf8") : "";
    const newline = existingContent.includes("\r\n") ? "\r\n" : "\n";
    const lines = existingContent ? existingContent.split(/\r?\n/) : [];
    if (lines.length === 1 && lines[0] === "") {
      lines.pop();
    }

    let sectionStart = -1;
    let sectionEnd = lines.length;
    for (let index = 0; index < lines.length; index += 1) {
      const match = sectionPattern.exec(lines[index]);
      if (!match) {
        continue;
      }

      const currentSection = match[1].trim().toLowerCase();
      if (sectionStart >= 0) {
        sectionEnd = index;
        break;
      }

      if (currentSection === normalizedSection) {
        sectionStart = index;
      }
    }

    if (sectionStart < 0) {
      if (lines.length && lines[lines.length - 1] !== "") {
        lines.push("");
      }
      lines.push(`[${sectionName}]`);
      sectionStart = lines.length - 1;
      sectionEnd = lines.length;
    }

    for (let index = sectionStart + 1; index < sectionEnd; index += 1) {
      const match = assignmentPattern.exec(lines[index]);
      if (!match) {
        continue;
      }

      const existingKey = match[1].trim().toLowerCase();
      const requestedValue = requestedValues.get(existingKey);
      if (!requestedValue) {
        continue;
      }

      lines[index] = `${requestedValue.key}=${requestedValue.value}`;
      requestedValues.delete(existingKey);
    }

    for (const requestedValue of requestedValues.values()) {
      lines.splice(sectionEnd, 0, `${requestedValue.key}=${requestedValue.value}`);
      sectionEnd += 1;
    }

    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    const nextContent = lines.join(newline);
    await fsp.writeFile(filePath, nextContent.endsWith(newline) ? nextContent : `${nextContent}${newline}`, "utf8");
  }

  async createIniSectionValueSnapshot(filePath, sectionName, keys) {
    const requestedValues = new Map(
      (Array.isArray(keys) ? keys : [])
        .map((key) => String(key || "").trim())
        .filter(Boolean)
        .map((key) => [key.toLowerCase(), { key, exists: false, value: "" }])
    );

    if (!requestedValues.size) {
      return null;
    }

    const existingContent = (await exists(filePath)) ? await fsp.readFile(filePath, "utf8") : "";
    const lines = existingContent ? existingContent.split(/\r?\n/) : [];
    const sectionPattern = /^\s*\[([^\]]+)\]\s*$/;
    const assignmentPattern = /^\s*([^=;#][^=]*?)\s*=\s*(.*)$/;
    const normalizedSection = String(sectionName || "").trim().toLowerCase();
    let sectionStart = -1;
    let sectionEnd = lines.length;

    for (let index = 0; index < lines.length; index += 1) {
      const match = sectionPattern.exec(lines[index]);
      if (!match) {
        continue;
      }

      const currentSection = match[1].trim().toLowerCase();
      if (sectionStart >= 0) {
        sectionEnd = index;
        break;
      }

      if (currentSection === normalizedSection) {
        sectionStart = index;
      }
    }

    if (sectionStart >= 0) {
      for (let index = sectionStart + 1; index < sectionEnd; index += 1) {
        const match = assignmentPattern.exec(lines[index]);
        if (!match) {
          continue;
        }

        const existingKey = match[1].trim().toLowerCase();
        const requestedValue = requestedValues.get(existingKey);
        if (!requestedValue) {
          continue;
        }

        requestedValue.exists = true;
        requestedValue.value = sanitizeIniValue(match[2]);
      }
    }

    return {
      filePath,
      sectionName,
      values: [...requestedValues.values()]
    };
  }

  async restoreIniSectionValueSnapshot(snapshot) {
    if (!snapshot?.filePath || !snapshot?.sectionName || !Array.isArray(snapshot.values)) {
      return;
    }

    const requestedValues = new Map(
      snapshot.values
        .map((entry) => ({
          key: String(entry?.key || "").trim(),
          exists: entry?.exists === true,
          value: sanitizeIniValue(entry?.value)
        }))
        .filter((entry) => entry.key)
        .map((entry) => [entry.key.toLowerCase(), entry])
    );

    if (!requestedValues.size) {
      return;
    }

    const filePath = snapshot.filePath;
    const existingContent = (await exists(filePath)) ? await fsp.readFile(filePath, "utf8") : "";
    const newline = existingContent.includes("\r\n") ? "\r\n" : "\n";
    const lines = existingContent ? existingContent.split(/\r?\n/) : [];
    if (lines.length === 1 && lines[0] === "") {
      lines.pop();
    }

    const sectionPattern = /^\s*\[([^\]]+)\]\s*$/;
    const assignmentPattern = /^\s*([^=;#][^=]*?)\s*=/;
    const normalizedSection = String(snapshot.sectionName || "").trim().toLowerCase();
    let sectionStart = -1;
    let sectionEnd = lines.length;

    for (let index = 0; index < lines.length; index += 1) {
      const match = sectionPattern.exec(lines[index]);
      if (!match) {
        continue;
      }

      const currentSection = match[1].trim().toLowerCase();
      if (sectionStart >= 0) {
        sectionEnd = index;
        break;
      }

      if (currentSection === normalizedSection) {
        sectionStart = index;
      }
    }

    if (sectionStart < 0) {
      const hasValuesToRestore = [...requestedValues.values()].some((entry) => entry.exists);
      if (!hasValuesToRestore) {
        return;
      }

      if (lines.length && lines[lines.length - 1] !== "") {
        lines.push("");
      }
      lines.push(`[${snapshot.sectionName}]`);
      sectionStart = lines.length - 1;
      sectionEnd = lines.length;
    }

    for (let index = sectionStart + 1; index < sectionEnd; index += 1) {
      const match = assignmentPattern.exec(lines[index]);
      if (!match) {
        continue;
      }

      const existingKey = match[1].trim().toLowerCase();
      const requestedValue = requestedValues.get(existingKey);
      if (!requestedValue) {
        continue;
      }

      if (requestedValue.exists) {
        lines[index] = `${requestedValue.key}=${requestedValue.value}`;
        index += 1;
      } else {
        lines.splice(index, 1);
        sectionEnd -= 1;
      }
      requestedValues.delete(existingKey);
      index -= 1;
    }

    for (const requestedValue of requestedValues.values()) {
      if (!requestedValue.exists) {
        continue;
      }
      lines.splice(sectionEnd, 0, `${requestedValue.key}=${requestedValue.value}`);
      sectionEnd += 1;
    }

    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    const nextContent = lines.join(newline);
    await fsp.writeFile(filePath, nextContent.endsWith(newline) ? nextContent : `${nextContent}${newline}`, "utf8");
  }

  async restoreForcedAutoLoginIniValues(snapshot) {
    if (!snapshot?.filePath || !snapshot?.sectionName || !Array.isArray(snapshot.values)) {
      return;
    }

    const forcedEntries = Object.entries(AUTO_LOGIN_EQCLIENT_FORCED_VALUES);
    const currentSnapshot = await this.createIniSectionValueSnapshot(
      snapshot.filePath,
      snapshot.sectionName,
      forcedEntries.map(([key]) => key)
    );
    const originalValues = new Map(
      snapshot.values
        .map((entry) => [String(entry?.key || "").trim().toLowerCase(), entry])
        .filter(([key]) => Boolean(key))
    );
    const currentValues = new Map(
      (currentSnapshot?.values || [])
        .map((entry) => [String(entry?.key || "").trim().toLowerCase(), entry])
        .filter(([key]) => Boolean(key))
    );
    const valuesToRestore = [];

    for (const [key, forcedValue] of forcedEntries) {
      const normalizedKey = key.toLowerCase();
      const originalValue = originalValues.get(normalizedKey);
      const currentValue = currentValues.get(normalizedKey);
      if (!originalValue || !currentValue?.exists) {
        continue;
      }

      if (String(currentValue.value).toLowerCase() !== String(forcedValue).toLowerCase()) {
        continue;
      }

      if (originalValue.exists === currentValue.exists && String(originalValue.value).toLowerCase() === String(currentValue.value).toLowerCase()) {
        continue;
      }

      valuesToRestore.push(originalValue);
    }

    if (!valuesToRestore.length) {
      return;
    }

    await this.restoreIniSectionValueSnapshot({
      filePath: snapshot.filePath,
      sectionName: snapshot.sectionName,
      values: valuesToRestore
    });
  }

  isProcessRunning(processId) {
    const normalizedProcessId = Number(processId);
    if (!Number.isFinite(normalizedProcessId) || normalizedProcessId <= 0) {
      return false;
    }

    try {
      process.kill(Math.trunc(normalizedProcessId), 0);
      return true;
    } catch (error) {
      return error?.code === "EPERM";
    }
  }

  async scheduleDeferredIniSectionValueRestore(snapshot, processId) {
    const normalizedProcessId = Number(processId);
    if (!Number.isFinite(normalizedProcessId) || normalizedProcessId <= 0 || !snapshot?.filePath) {
      return;
    }

    const targetProcessId = Math.trunc(normalizedProcessId);
    const startedAt = Date.now();
    const poll = async () => {
      if (this.isProcessRunning(targetProcessId) && Date.now() - startedAt < AUTO_LOGIN_EQCLIENT_RESTORE_MAX_WAIT_MS) {
        const timer = setTimeout(poll, AUTO_LOGIN_EQCLIENT_RESTORE_POLL_MS);
        if (typeof timer.unref === "function") {
          timer.unref();
        }
        return;
      }

      try {
        await this.restoreForcedAutoLoginIniValues(snapshot);
      } catch (error) {
        this.emitLog(`Auto login: Could not restore EQ window settings after client exit: ${error.message}`, "warning");
      }
    };

    const timer = setTimeout(poll, AUTO_LOGIN_EQCLIENT_RESTORE_INITIAL_DELAY_MS);
    if (typeof timer.unref === "function") {
      timer.unref();
    }
  }

  async configureAutoLoginClient(username) {
    const safeUsername = sanitizeIniValue(username);
    if (!safeUsername) {
      throw new Error("A login username is required.");
    }

    const eqclientSnapshot = await this.createIniSectionValueSnapshot(
      path.join(this.state.gameDirectory, "eqclient.ini"),
      "Defaults",
      AUTO_LOGIN_EQCLIENT_WINDOW_KEYS
    );
    await this.setIniSectionValues(path.join(this.state.gameDirectory, "eqlsPlayerData.ini"), "PLAYER", {
      Username: safeUsername
    });
    await this.setIniSectionValues(path.join(this.state.gameDirectory, "eqclient.ini"), "Defaults", {
      Maximized: "1",
      WindowedMode: "TRUE"
    });

    return {
      eqclientSnapshot
    };
  }

  async ensureAutoLoginHelperScript() {
    const helperContent = await fsp.readFile(AUTO_LOGIN_HELPER_SOURCE_PATH, "utf8");
    const helperDirectory = path.join(this.appUserDataPath, "auto-login");
    const helperPath = path.join(helperDirectory, AUTO_LOGIN_HELPER_FILE_NAME);
    await fsp.mkdir(helperDirectory, { recursive: true });

    const existingContent = (await exists(helperPath)) ? await fsp.readFile(helperPath, "utf8").catch(() => "") : "";
    if (existingContent !== helperContent) {
      await fsp.writeFile(helperPath, helperContent, "utf8");
      await fsp.chmod(helperPath, 0o600).catch(() => {});
    }

    return helperPath;
  }

  handleAutoLoginHelperEvent(event) {
    const message = normalizeAutoLoginText(event?.message, 240);
    const tone = ["success", "warning", "error"].includes(event?.tone) ? event.tone : "info";
    const statusState = normalizeAutoLoginText(event?.statusState, 32);
    const statusLabel = normalizeAutoLoginText(event?.statusLabel, 80);
    const statusDetail = normalizeAutoLoginText(event?.statusDetail, 240);
    const progressValue = Number(event?.progressValue);
    const progressMax = Number(event?.progressMax);
    const progressLabel = normalizeAutoLoginText(event?.progressLabel, 120);

    if (message) {
      this.emitLog(`Auto login: ${message}`, tone);
    }

    if (statusState || statusLabel || statusDetail) {
      this.state.autoLoginStatus = createAutoLoginStatus(
        statusState || this.state.autoLoginStatus.state,
        statusLabel || this.state.autoLoginStatus.label,
        statusDetail || this.state.autoLoginStatus.detail
      );
    }

    if (Number.isFinite(progressValue) && Number.isFinite(progressMax) && progressMax > 0) {
      this.state.progressValue = progressValue;
      this.state.progressMax = progressMax;
      this.state.progressLabel = progressLabel || this.state.progressLabel;
      this.emitProgress();
    }

    this.emitState();
  }

  async runAutoLoginHelper({ eqGamePath, username, password, enterWorld = false }) {
    const helperPath = await this.ensureAutoLoginHelperScript();
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
      "-WindowWaitSeconds",
      "45",
      "-UdpWaitSeconds",
      "10"
    ];
    if (enterWorld) {
      args.push("-EnterWorld", "-ServerSelectWaitSeconds", "15");
    }

    return new Promise((resolve, reject) => {
      let child;
      try {
        child = this.spawnImpl(this.resolvePowerShellCommand(), args, {
          cwd: this.state.gameDirectory,
          windowsHide: true,
          stdio: ["pipe", "pipe", "pipe"]
        });
      } catch (error) {
        reject(error);
        return;
      }

      let settled = false;
      let timeoutId = null;
      let stdoutRemainder = "";
      let stderrOutput = "";
      let enteredWorld = false;
      let startedProcessId = 0;
      const finish = (callback, value) => {
        if (settled) {
          return;
        }
        settled = true;
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        callback(value);
      };
      const handleLine = (line) => {
        const trimmedLine = line.trim();
        if (!trimmedLine) {
          return;
        }

        try {
          const helperEvent = JSON.parse(trimmedLine);
          if (helperEvent?.stage === "process-started") {
            const processId = Number(helperEvent.processId);
            if (Number.isFinite(processId) && processId > 0) {
              startedProcessId = Math.trunc(processId);
            }
          }
          if (helperEvent?.stage === "enter-world-complete") {
            enteredWorld = true;
          }
          this.handleAutoLoginHelperEvent(helperEvent);
        } catch (_error) {
          this.emitLog(`Auto login: ${trimmedLine}`, "info");
        }
      };

      timeoutId = setTimeout(() => {
        timeoutId = null;
        if (typeof child.kill === "function") {
          try {
            child.kill();
          } catch (_error) {
            // Ignore termination errors and surface the timeout itself.
          }
        }
        const error = new Error("Auto login did not finish within 60 seconds.");
        error.processId = startedProcessId;
        finish(reject, error);
      }, AUTO_LOGIN_HELPER_TIMEOUT_MS);

      child.stdout?.on?.("data", (chunk) => {
        stdoutRemainder += chunk.toString("utf8");
        let newlineIndex = stdoutRemainder.search(/\r?\n/);
        while (newlineIndex >= 0) {
          const line = stdoutRemainder.slice(0, newlineIndex);
          stdoutRemainder = stdoutRemainder.slice(
            stdoutRemainder[newlineIndex] === "\r" && stdoutRemainder[newlineIndex + 1] === "\n"
              ? newlineIndex + 2
              : newlineIndex + 1
          );
          handleLine(line);
          newlineIndex = stdoutRemainder.search(/\r?\n/);
        }
      });

      child.stderr?.on?.("data", (chunk) => {
        stderrOutput += chunk.toString("utf8");
        if (stderrOutput.length > 16000) {
          stderrOutput = stderrOutput.slice(-16000);
        }
      });

      child.once("error", (error) => {
        finish(reject, error);
      });

      child.once("exit", (code, signal) => {
        if (stdoutRemainder.trim()) {
          handleLine(stdoutRemainder);
          stdoutRemainder = "";
        }

        if (signal) {
          finish(reject, new Error(`Auto login helper was terminated by signal ${signal}.`));
          return;
        }

        const normalizedCode = Number.isFinite(code) ? code : 0;
        if (normalizedCode === 0) {
          finish(resolve, { confirmed: true, enteredWorld, processId: startedProcessId });
          return;
        }

        if (normalizedCode === AUTO_LOGIN_CONFIRMATION_TIMEOUT_EXIT_CODE) {
          finish(resolve, { confirmed: false, processId: startedProcessId });
          return;
        }

        if (normalizedCode === AUTO_LOGIN_LOGIN_REJECTED_EXIT_CODE) {
          finish(resolve, { confirmed: false, loginRejected: true, processId: startedProcessId });
          return;
        }

        const detail = stderrOutput.trim();
        const error = new Error(detail || `Auto login helper exited with code ${normalizedCode}.`);
        error.processId = startedProcessId;
        finish(reject, error);
      });

      if (child.stdin) {
        child.stdin.end(String(password || ""), "utf8");
      }
    });
  }

  getGameSettingsPath() {
    if (!this.state.gameDirectory) {
      return "";
    }

    return path.join(this.state.gameDirectory, "eqemupatcher.yml");
  }

  getManifestPath() {
    if (!this.state.gameDirectory) {
      return "";
    }

    return path.join(this.state.gameDirectory, "filelist.yml");
  }

  getEqGamePath() {
    if (!this.state.gameDirectory) {
      return "";
    }

    return path.join(this.state.gameDirectory, "eqgame.exe");
  }

  async loadGameSettings() {
    if (!this.state.gameDirectory) {
      this.gameSettings = {
        autoPatch: boolToLegacyString(this.config.defaultAutoPatch),
        autoPlay: boolToLegacyString(this.config.defaultAutoPlay),
        autoLogin: boolToLegacyString(false),
        clientVersion: "Unknown",
        lastPatchedVersion: ""
      };
      this.state.autoPatch = this.config.defaultAutoPatch;
      this.state.autoPlay = this.config.defaultAutoPlay;
      this.state.autoLogin = false;
      return;
    }

    const settingsPath = this.getGameSettingsPath();
    const defaults = {
      autoPatch: boolToLegacyString(this.config.defaultAutoPatch),
      autoPlay: boolToLegacyString(this.config.defaultAutoPlay),
      autoLogin: boolToLegacyString(false),
      clientVersion: "Unknown",
      lastPatchedVersion: ""
    };

    try {
      const parsed = (await exists(settingsPath)) ? await this.loadYaml(settingsPath) : {};
      this.gameSettings = { ...defaults, ...(parsed || {}) };
    } catch (_error) {
      this.gameSettings = defaults;
    }

    this.state.autoPatch = isTrue(this.gameSettings.autoPatch);
    this.state.autoPlay = isTrue(this.gameSettings.autoPlay);
    this.state.autoLogin = this.state.autoLoginAvailable && this.autoLoginProfiles.length > 0 && isTrue(this.gameSettings.autoLogin);
    this.state.lastPatchedVersion = normalizeVersion(this.gameSettings.lastPatchedVersion);

    await this.saveGameSettings();
  }

  async saveGameSettings() {
    if (!this.state.gameDirectory || !this.gameSettings) {
      return;
    }

    this.gameSettings.autoPatch = boolToLegacyString(this.state.autoPatch);
    this.gameSettings.autoPlay = boolToLegacyString(this.state.autoPlay);
    this.state.autoLogin = this.state.autoLoginAvailable && this.autoLoginProfiles.length > 0 && Boolean(this.state.autoLogin);
    this.gameSettings.autoLogin = boolToLegacyString(this.state.autoLogin);
    this.gameSettings.clientVersion = this.state.clientVersion;
    this.gameSettings.lastPatchedVersion = normalizeVersion(this.state.lastPatchedVersion);
    await this.saveYaml(this.getGameSettingsPath(), this.gameSettings);
  }

  async setGameDirectory(gameDirectory) {
    this.state.gameDirectory = gameDirectory;
    this.appState.gameDirectory = gameDirectory;
    this.state.loginServerSelectionMode = "auto";
    this.state.loginServerActiveRole = "";
    await this.saveAppState();
    await this.ensureGameDirectoryConfig();
    await this.loadConfig();
    await this.loadGameSettings();
    return this.refreshState({ performAutoActions: true });
  }

  async updateSettings(patch) {
    if (typeof patch.autoPatch === "boolean") {
      this.state.autoPatch = patch.autoPatch;
    }

    if (typeof patch.autoPlay === "boolean") {
      this.state.autoPlay = patch.autoPlay;
    }

    if (typeof patch.autoLogin === "boolean") {
      this.state.autoLogin = this.state.autoLoginAvailable && this.autoLoginProfiles.length > 0 && patch.autoLogin;
    }

    if (typeof patch.autoLoginEnterWorld === "boolean") {
      this.state.autoLoginEnterWorld = patch.autoLoginEnterWorld;
      this.appState.autoLoginEnterWorld = this.state.autoLoginEnterWorld;
    }

    if (typeof patch.onGameLaunch === "string") {
      this.state.onGameLaunch = normalizeOnGameLaunch(patch.onGameLaunch);
      this.appState.onGameLaunch = this.state.onGameLaunch;
    }

    await this.saveAppState();
    await this.saveGameSettings();
    this.emitState();
    return this.getState();
  }

  async refreshState(options = {}) {
    this.clearPrerequisiteInstallOffer();
    const { performAutoActions = false, skipManifestFetch = false } = options;

    this.state.eqGamePath = this.getEqGamePath();
    this.state.heroImageUrl = this.getHeroImageUrl(this.state.clientVersion);
    this.syncBrandingState(this.state.clientVersion);
    this.state.reportUrl = "";
    this.state.canPatch = false;
    this.state.canLaunch = false;
    this.state.manifestVersion = "";
    this.state.needsPatch = false;
    this.state.manifestUrl = "";
    this.state.progressValue = 0;
    this.state.progressMax = 1;
    this.state.progressLabel = "Waiting for input";
    this.state.serverName = this.resolveServerName();
    this.state.filelistUrl = this.config.filelistUrl;
    this.state.patchNotesUrl = this.config.patchNotesUrl;
    this.state.launcherReleaseApiUrl = this.config.launcherReleaseApiUrl;
    this.syncBrandingState(this.state.clientVersion);
    await Promise.all([
      this.refreshGameServerStatus(),
      this.refreshLoginServerStatus()
    ]);
    this.emitProgress();

    if (!this.state.gameDirectory) {
      this.state.clientVersion = "Unknown";
      this.state.clientLabel = CLIENTS.Unknown.label;
      this.state.clientHash = "";
      this.state.patchActionLabel = "Deploy Patch";
      this.setStatus("Run In Folder", "Run this launcher from the EverQuest directory that contains eqgame.exe.");
      this.state.heroImageUrl = this.getHeroImageUrl("Unknown");
      this.syncBrandingState("Unknown");
      this.emitState();
      return this.getState();
    }

    this.syncBrandingState(this.state.clientVersion);

    const detectResult = await this.detectClientVersion();
    this.state.clientVersion = detectResult.version;
    this.state.clientLabel = (CLIENTS[detectResult.version] || CLIENTS.Unknown).label;
    this.state.clientHash = detectResult.hash;
    this.state.clientSupported = this.config.supportedClients.includes(detectResult.version);
    this.state.heroImageUrl = this.getHeroImageUrl(detectResult.version);
    this.syncBrandingState(detectResult.version);
    this.state.canLaunch = false;

    await this.saveGameSettings();

    if (!detectResult.found) {
      this.state.patchActionLabel = "Deploy Patch";
      this.state.canLaunch = false;
      this.setStatus("No Client", "eqgame.exe was not found in the selected folder.");
      this.emitState();
      return this.getState();
    }

    if (detectResult.version === "Unknown") {
      this.state.patchActionLabel = "Unsupported Client";
      this.state.canLaunch = false;
      this.state.reportUrl = `https://github.com/Xackery/eqemupatcher/issues/new?title=A+New+EQClient+Found&body=Hi+I+Found+A+New+Client!+Hash:+${detectResult.hash}`;
      this.setStatus("Client Unknown", "This EverQuest executable does not match a known client hash.");
      this.emitState();
      return this.getState();
    }

    if (!this.state.clientSupported) {
      this.state.patchActionLabel = "Unsupported Build";
      this.state.canLaunch = false;
      this.setStatus("Unsupported", `${this.state.serverName} does not publish patches for ${this.state.clientLabel}.`);
      this.emitState();
      return this.getState();
    }

    if (skipManifestFetch) {
      this.state.patchActionLabel = "Verify Integrity";
      this.state.launchActionLabel = "Launch Game";
      this.state.progressLabel = "Checking patch state";
      this.setStatus("Checking", "Checking the current patch state.");
      this.emitState();
      return this.getState();
    }

    try {
      const manifest = await this.fetchManifest();
      this.state.serverName = this.resolveServerName({ manifest });
      this.syncBrandingState(detectResult.version);
      this.state.manifestVersion = normalizeVersion(manifest.version);
      this.state.lastPatchedVersion = normalizeVersion(this.gameSettings.lastPatchedVersion);
      this.state.needsPatch = this.state.manifestVersion !== this.state.lastPatchedVersion;
      this.state.canPatch = true;
      this.state.canLaunch = !this.state.needsPatch && detectResult.found && this.state.launchSupported;
      this.state.patchActionLabel = this.state.needsPatch ? "Deploy Patch" : "Verify Integrity";
      this.state.launchActionLabel = this.state.needsPatch ? "Start Patch" : "Launch Game";
      this.state.progressLabel = this.state.needsPatch ? "Update available" : "Files are in sync";

      if (this.state.needsPatch) {
        this.setStatus("Update Ready", `Manifest ${this.state.manifestVersion} is ready to deploy.`);
      } else {
        this.setStatus("Ready", "Manifest and local patch version are aligned.");
      }

      this.emitState();

      if (performAutoActions) {
        if (this.state.needsPatch && this.state.autoPatch) {
          await this.startPatch({ autoTriggered: true });
        } else if (!this.state.needsPatch && this.state.autoPlay) {
          await this.launchGame({ autoTriggered: true });
        }
      }
    } catch (error) {
      this.state.patchActionLabel = "Manifest Error";
      this.setStatus("Manifest Error", error.message, error.message);
      this.emitLog(`Manifest fetch failed: ${error.message}`, "error");
      this.emitState();
    }

    return this.getState();
  }

  async detectClientVersion() {
    const eqGamePath = this.getEqGamePath();
    if (!(await exists(eqGamePath))) {
      return { found: false, hash: "", version: "Unknown" };
    }

    const hash = await this.getFileHash(eqGamePath);
    const version = HASH_TO_VERSION[hash] || "Unknown";
    return { found: true, hash, version };
  }

  async fetchManifest() {
    const client = CLIENTS[this.state.clientVersion];
    const manifestUrl = buildUrl(this.config.filelistUrl, `${client.suffix}/filelist_${client.suffix}.yml`);
    const manifestPath = this.getManifestPath();
    this.state.manifestUrl = manifestUrl;
    this.emitLog(`Fetching manifest from ${manifestUrl}`);
    this.setStatus("Manifest Sync", "Contacting the patch endpoint.");
    this.emitState();

    const response = await this.fetchImpl(manifestUrl);
    if (!response.ok) {
      throw new Error(response.status === 404 ? "Manifest not found (404)." : `Manifest request failed (${response.status}).`);
    }

    const text = await response.text();
    await fsp.writeFile(manifestPath, text, "utf8");
    const parsed = SimpleYaml.parse(text);
    if (!parsed || typeof parsed !== "object") {
      throw new Error("Manifest response was empty or invalid.");
    }

    return parsed;
  }

  async startPatch(options = {}) {
    const { autoTriggered = false } = options;
    const verifyIntegrityRequested = !this.state.needsPatch;
    const scanVerb = verifyIntegrityRequested ? "Verifying" : "Scanning";
    const scanCompleteVerb = verifyIntegrityRequested ? "Verified" : "Scanned";

    if (this.state.isPatching) {
      return this.getState();
    }

    if (this.state.isInstallingPrerequisites) {
      return this.getState();
    }

    this.clearPrerequisiteInstallOffer();

    if (!this.state.gameDirectory) {
      this.setStatus("Run In Folder", "Run this launcher from a valid EverQuest directory before patching.");
      this.emitState();
      return this.getState();
    }

    if (this.state.clientVersion === "Unknown") {
      this.state.canPatch = false;
      this.state.canLaunch = false;
      this.state.patchActionLabel = "Unsupported Client";
      this.state.reportUrl = `https://github.com/Xackery/eqemupatcher/issues/new?title=A+New+EQClient+Found&body=Hi+I+Found+A+New+Client!+Hash:+${this.state.clientHash}`;
      this.setStatus("Client Unknown", "This EverQuest executable does not match a known client hash.");
      this.emitLog("Patch blocked: the selected EverQuest client is unknown.", "warning");
      this.emitState();
      return this.getState();
    }

    if (!this.state.clientSupported) {
      this.state.canPatch = false;
      this.state.canLaunch = false;
      this.state.patchActionLabel = "Unsupported Build";
      this.setStatus("Unsupported", `${this.state.serverName} does not publish patches for ${this.state.clientLabel}.`);
      this.emitLog(`Patch blocked: ${this.state.clientLabel} is not supported by ${this.state.serverName}.`, "warning");
      this.emitState();
      return this.getState();
    }

    let manifest;
    try {
      manifest = await this.ensureManifestLoaded();
    } catch (error) {
      this.state.patchActionLabel = "Manifest Error";
      this.setStatus("Manifest Error", error.message, error.message);
      this.emitLog(`Patch preparation failed: ${error.message}`, "error");
      this.emitState();
      return this.getState();
    }

    const downloads = Array.isArray(manifest.downloads) ? manifest.downloads : [];
    const deletes = Array.isArray(manifest.deletes) ? manifest.deletes : [];

    this.cancelRequested = false;
    this.cancelController = new AbortController();
    this.state.isPatching = true;
    this.state.canLaunch = false;
    this.state.patchActionLabel = "Cancel Patch";
    this.state.launchActionLabel = "Start Patch";
    this.state.progressValue = 0;
    this.state.progressMax = Math.max(downloads.length, 1);
    this.state.progressLabel = downloads.length ? `${scanVerb} 0 / ${downloads.length} files` : `${scanVerb} local files`;
    this.setStatus(
      "Patching",
      verifyIntegrityRequested
        ? "Verifying local files against the manifest."
        : autoTriggered
          ? "Auto patch is running."
          : "Scanning local files against the manifest."
    );
    this.emitState();
    this.emitProgress();
    if (verifyIntegrityRequested) {
      this.emitLog(`Verify Integrity started. Checking ${downloads.length} manifest file(s).`);
    } else {
      this.emitLog(autoTriggered ? "Auto patch triggered." : "Patch operation started.");
    }

    try {
      const filesToDownload = [];
      let totalBytes = 0;
      let scannedFiles = 0;

      for (const entry of downloads) {
        this.throwIfCanceled();
        const targetPath = this.resolveGamePath(entry.name);
        const expectedHash = String(entry.md5 || "").toUpperCase();
        const targetExists = await exists(targetPath);
        const shouldDownload = !targetExists || (await this.getFileHash(targetPath)) !== expectedHash;
        scannedFiles += 1;
        this.state.progressValue = scannedFiles;
        this.state.progressMax = Math.max(downloads.length, 1);
        this.state.progressLabel = `${scanVerb} ${scannedFiles} / ${downloads.length} files`;
        this.emitProgress();

        const shouldLogScanProgress =
          downloads.length <= 12 || scannedFiles === 1 || scannedFiles === downloads.length || scannedFiles % 25 === 0;
        if (shouldLogScanProgress) {
          this.emitLog(`${scanCompleteVerb} ${scannedFiles} / ${downloads.length} manifest file(s)...`);
        }

        if (shouldDownload) {
          filesToDownload.push(entry);
          totalBytes += Math.max(1, Number(entry.size) || 0);
          this.emitLog(
            targetExists ? `Integrity mismatch detected: ${entry.name}` : `Missing file detected: ${entry.name}`,
            "warning"
          );
        }
      }

      if (verifyIntegrityRequested && filesToDownload.length > 0) {
        this.emitLog(`Verify Integrity found ${filesToDownload.length} file(s) requiring repair.`, "warning");
      }

      for (const entry of deletes) {
        this.throwIfCanceled();
        const targetPath = this.resolveGamePath(entry.name);
        if (await exists(targetPath)) {
          this.emitLog(`Deleting ${entry.name}...`);
          await fsp.unlink(targetPath);
        }
      }

      if (filesToDownload.length === 0) {
        this.state.progressValue = 1;
        this.state.progressMax = 1;
        this.state.progressLabel = "Files are already up to date";
        this.state.lastPatchedVersion = normalizeVersion(manifest.version);
        await this.saveGameSettings();
        this.state.needsPatch = false;
        this.state.canLaunch = this.state.launchSupported && this.state.clientSupported && this.state.clientVersion !== "Unknown";
        this.state.patchActionLabel = "Verify Integrity";
        this.state.launchActionLabel = "Launch Game";
        this.setStatus("Ready", `Patch ${manifest.version || "current"} is already installed.`);
        this.emitLog(`Verified ${downloads.length} manifest file(s); patch ${manifest.version || "current"} is already installed.`, "success");
        this.finishPatch();
        return this.getState();
      }

      this.state.progressValue = 0;
      this.state.progressMax = totalBytes;
      this.state.progressLabel = `Downloading ${filesToDownload.length} files`;
      this.emitProgress();
      this.emitLog(`Downloading ${totalBytes} bytes across ${filesToDownload.length} files...`);

      let downloadedBytes = 0;
      for (const entry of filesToDownload) {
        this.throwIfCanceled();
        const targetPath = this.resolveGamePath(entry.name);
        const expectedHash = String(entry.md5 || "").toUpperCase();
        const downloadUrl = buildUrl(manifest.downloadprefix, entry.name.replace(/\\/g, "/"));
        this.state.progressLabel = `Downloading ${entry.name}`;
        this.emitProgress();
        this.emitLog(`${entry.name}...`);
        await this.downloadFile(downloadUrl, targetPath, this.cancelController.signal, (chunkSize) => {
          downloadedBytes += chunkSize;
          this.state.progressValue = Math.min(downloadedBytes, this.state.progressMax);
          this.emitProgress();
        });

        if (expectedHash && (await this.getFileHash(targetPath)) !== expectedHash) {
          await fsp.unlink(targetPath).catch(() => {});
          throw new Error(`Downloaded file failed verification: ${entry.name}`);
        }
      }

      this.state.progressValue = this.state.progressMax;
      this.state.progressLabel = "Patch complete";
      this.state.lastPatchedVersion = normalizeVersion(manifest.version);
      this.state.needsPatch = false;
      this.state.canLaunch = this.state.launchSupported && this.state.clientSupported && this.state.clientVersion !== "Unknown";
      await this.saveGameSettings();
      this.state.launchActionLabel = "Launch Game";
      this.setStatus("Ready", "Patch complete. Launch is now available.");
      this.emitLog("Complete! Press Launch to begin.");
      this.finishPatch();
    } catch (error) {
      if (error.message === "PATCH_CANCELED") {
        this.state.needsPatch = true;
        this.state.canLaunch = false;
        this.state.patchActionLabel = "Deploy Patch";
        this.state.launchActionLabel = "Start Patch";
        this.setStatus("Patch Canceled", "Patch deployment was canceled before completion.");
        this.emitLog("Patching cancelled.", "warning");
      } else {
        this.state.needsPatch = true;
        this.state.canLaunch = false;
        this.state.patchActionLabel = "Deploy Patch";
        this.state.launchActionLabel = "Start Patch";
        this.setStatus("Patch Error", error.message, error.message);
        this.emitLog(`Patch failed: ${error.message}`, "error");
      }

      this.state.isPatching = false;
      this.cancelController = null;
      this.emitState();
      this.emitProgress();
    }

    return this.getState();
  }

  finishPatch() {
    this.state.isPatching = false;
    this.state.patchActionLabel = this.state.needsPatch ? "Deploy Patch" : "Verify Integrity";
    this.state.launchActionLabel = this.state.needsPatch ? "Start Patch" : "Launch Game";
    this.cancelController = null;
    this.cancelRequested = false;
    this.emitState();
    this.emitProgress();
  }

  async cancelPatch() {
    if (!this.state.isPatching) {
      return this.getState();
    }

    this.cancelRequested = true;
    if (this.cancelController) {
      this.cancelController.abort();
    }

    this.setStatus("Canceling", "Waiting for the active transfer to stop.");
    this.emitLog("Cancel requested. Waiting for the current operation to finish...", "warning");
    this.emitState();
    return this.getState();
  }

  async getAutoLoginLaunchPath() {
    if (!this.state.gameDirectory) {
      this.setStatus("Run In Folder", "Run this launcher from the EverQuest directory before launching.");
      this.emitState();
      return "";
    }

    if (this.platform !== "win32") {
      this.setStatus("Windows Only", "Account profile launch is only supported on Windows.");
      this.emitLog("Account profile launch blocked: auto-login input is only supported on Windows.", "warning");
      this.emitState();
      return "";
    }

    if (this.state.clientVersion === "Unknown") {
      this.setStatus("Client Unknown", "This EverQuest executable does not match a known client hash.");
      this.emitLog("Account profile launch blocked: the selected EverQuest client is unknown.", "warning");
      this.emitState();
      return "";
    }

    if (!this.state.clientSupported) {
      this.setStatus("Unsupported", `${this.state.serverName} does not publish patches for ${this.state.clientLabel}.`);
      this.emitLog(`Account profile launch blocked: ${this.state.clientLabel} is not supported by ${this.state.serverName}.`, "warning");
      this.emitState();
      return "";
    }

    const eqGamePath = this.getEqGamePath();
    if (!(await exists(eqGamePath))) {
      this.setStatus("No Client", "eqgame.exe was not found in the selected folder.");
      this.emitState();
      return "";
    }

    if (this.testSimulation.launchExitCode != null) {
      this.setStatus("Launch Error", "Simulated launch failure.");
      this.emitState();
      return "";
    }

    return eqGamePath;
  }

  async runAutoLoginProfile(profile, eqGamePath, options = {}) {
    const {
      batchIndex = 1,
      batchTotal = 1,
      enterWorld = this.state.autoLoginEnterWorld
    } = options;
    const shouldEnterWorld = enterWorld === true;
    const normalizedBatchIndex = Math.max(1, Number(batchIndex) || 1);
    const normalizedBatchTotal = Math.max(1, Number(batchTotal) || 1);
    const batchPrefix = normalizedBatchTotal > 1 ? `${normalizedBatchIndex}/${normalizedBatchTotal} ` : "";
    const progressValue = (localValue) => normalizedBatchTotal > 1
      ? Math.min(100, Math.max(0, Math.round((((normalizedBatchIndex - 1) * 100) + localValue) / normalizedBatchTotal)))
      : localValue;
    const profileLabel = profile.label || profile.username;
    const overlayText = normalizedBatchTotal > 1
      ? `Loading ${profileLabel} (${normalizedBatchIndex}/${normalizedBatchTotal})`
      : `Loading ${profileLabel}`;
    const overlayStartProgress = normalizedBatchTotal > 1
      ? Math.round(((normalizedBatchIndex - 1) / normalizedBatchTotal) * 100)
      : 0;
    const overlaySuccessProgress = Math.round((normalizedBatchIndex / normalizedBatchTotal) * 100);
    let password = "";
    let clientConfiguration = null;
    let launchedProcessId = 0;

    try {
      this.state.selectedAutoLoginProfileId = profile.id;
      this.setAutoLoginOverlayState(overlayText, overlayStartProgress, "default");
      this.state.autoLoginStatus = createAutoLoginStatus("running", `${batchPrefix}Preparing`.trim(), `Preparing ${profileLabel}.`);
      this.state.progressValue = progressValue(0);
      this.state.progressMax = 100;
      this.state.progressLabel = normalizedBatchTotal > 1 ? `Preparing ${profileLabel}` : "Preparing account profile launch";
      this.setStatus("Auto Login", normalizedBatchTotal > 1
        ? `Preparing account profile ${normalizedBatchIndex}/${normalizedBatchTotal}: '${profileLabel}'.`
        : `Preparing account profile '${profileLabel}'.`);
      this.emitLog(`Preparing account profile launch for '${profileLabel}'.`);
      this.emitProgress();
      this.emitState();

      password = await this.unprotectAutoLoginSecret(profile.secret);
      if (!password) {
        throw new Error("The saved account password could not be read.");
      }

      clientConfiguration = await this.configureAutoLoginClient(profile.username);
      this.emitLog("Prepared EverQuest login settings for the selected account profile.");
      this.state.autoLoginStatus = createAutoLoginStatus("running", `${batchPrefix}Launching`.trim(), "Starting EverQuest and sending the login sequence.");
      this.state.progressValue = progressValue(10);
      this.state.progressLabel = `Launching ${profileLabel}`;
      this.emitProgress();
      this.emitState();

      const result = await this.runAutoLoginHelper({
        eqGamePath,
        username: profile.username,
        password,
        enterWorld: shouldEnterWorld
      });
      launchedProcessId = Number(result?.processId) || 0;

      if (result.confirmed) {
        const successDetail = result.enteredWorld
          ? `${profileLabel} pressed Play EverQuest on the server select screen.`
          : `${profileLabel} advanced past the login form.`;
        const successLog = result.enteredWorld
          ? `Account profile '${profileLabel}' pressed Play EverQuest.`
          : `Account profile '${profileLabel}' advanced past the login form.`;
        this.state.progressValue = progressValue(100);
        this.state.progressLabel = normalizedBatchTotal > 1 ? `${profileLabel} complete` : "Account profile launch complete";
        this.emitProgress();
        this.state.autoLoginStatus = createAutoLoginStatus("success", result.enteredWorld ? "Entering world" : "Login advanced", successDetail);
        this.setAutoLoginOverlayState(overlayText, overlaySuccessProgress, "success");
        this.setStatus("Auto Login", result.enteredWorld ? "Play EverQuest was pressed." : "EverQuest advanced past the login form.");
        this.emitLog(successLog, "success");
        this.emitState();
        return { outcome: "success" };
      }

      if (result.loginRejected) {
        this.state.autoLoginStatus = createAutoLoginStatus(
          "warning",
          "Login rejected",
          "The game client reported a login error. Check the saved username and password."
        );
        this.setStatus("Auto Login Check", "The game client reported a login error.");
        this.emitLog("Auto login was rejected by the game client. Check the saved username and password.", "warning");
        return { outcome: "loginRejected" };
      }

      this.state.autoLoginStatus = createAutoLoginStatus(
        "warning",
        "Login not confirmed",
        "The login sequence was sent, but the client did not appear to advance past the login form."
      );
      this.setStatus("Auto Login Check", "Login input was sent, but the client did not appear to advance past the login form.");
      this.emitLog("Auto login sent the credential sequence, but the client did not appear to advance past the login form.", "warning");
      return { outcome: "notConfirmed" };
    } catch (error) {
      launchedProcessId = Number(error?.processId) || launchedProcessId;
      throw error;
    } finally {
      password = "";
      if (clientConfiguration?.eqclientSnapshot) {
        try {
          await this.restoreIniSectionValueSnapshot(clientConfiguration.eqclientSnapshot);
          if (launchedProcessId > 0) {
            await this.scheduleDeferredIniSectionValueRestore(clientConfiguration.eqclientSnapshot, launchedProcessId);
          }
        } catch (restoreError) {
          this.emitLog(`Auto login: Could not restore prior EQ window settings: ${restoreError.message}`, "warning");
        }
      }
    }
  }

  async launchAutoLoginProfile(options = {}) {
    const { autoTriggered = false } = options;
    const enterWorld = options.enterWorld === true || (options.enterWorld == null && this.state.autoLoginEnterWorld === true);
    const profileId = normalizeAutoLoginProfileId(options.id || this.state.selectedAutoLoginProfileId);
    const profile = this.autoLoginProfiles.find((candidate) => candidate.id === profileId);
    this.clearPrerequisiteInstallOffer();

    if (this.state.isAutoLoginRunning) {
      return this.getState();
    }

    if (!profile) {
      this.setAutoLoginOverlayState();
      this.state.autoLoginStatus = createAutoLoginStatus("error", "Profile missing", "Select a saved account profile before launching.");
      this.emitState();
      return this.getState();
    }

    const eqGamePath = await this.getAutoLoginLaunchPath();
    if (!eqGamePath) {
      return this.getState();
    }

    let result = null;
    try {
      this.state.isAutoLoginRunning = true;
      result = await this.runAutoLoginProfile(profile, eqGamePath, {
        batchIndex: 1,
        batchTotal: 1,
        enterWorld
      });
      if (result?.outcome === "success") {
        if (this.onGameLaunched) {
          await this.onGameLaunched({
            action: normalizeOnGameLaunch(this.state.onGameLaunch),
            autoTriggered
          });
        }
      }
    } catch (error) {
      this.state.autoLoginStatus = createAutoLoginStatus("error", "Launch failed", error.message);
      this.setStatus("Auto Login Error", error.message, error.message);
      this.emitLog(`Account profile launch failed: ${error.message}`, "error");
    } finally {
      this.state.isAutoLoginRunning = false;
      this.setAutoLoginOverlayState();
      this.syncAutoLoginProfilesState();
      this.emitState();
    }

    return this.getState();
  }

  async launchAutoLoginProfiles(options = {}) {
    const { autoTriggered = false } = options;
    const enterWorld = options.enterWorld === true || (options.enterWorld == null && this.state.autoLoginEnterWorld === true);
    const requestedIds = new Set(
      (Array.isArray(options.ids) ? options.ids : [])
        .map((id) => normalizeAutoLoginProfileId(id))
        .filter(Boolean)
    );
    const profiles = this.autoLoginProfiles.filter((profile) => requestedIds.has(profile.id));
    this.clearPrerequisiteInstallOffer();

    if (this.state.isAutoLoginRunning) {
      return this.getState();
    }

    if (profiles.length === 0) {
      this.setAutoLoginOverlayState();
      this.state.autoLoginStatus = createAutoLoginStatus("error", "Profiles missing", "Select one or more saved account profiles before launching.");
      this.emitState();
      return this.getState();
    }

    if (profiles.length === 1) {
      return this.launchAutoLoginProfile({
        id: profiles[0].id,
        autoTriggered,
        enterWorld
      });
    }

    const eqGamePath = await this.getAutoLoginLaunchPath();
    if (!eqGamePath) {
      return this.getState();
    }

    let completedCount = 0;
    try {
      this.state.isAutoLoginRunning = true;
      this.state.progressValue = 0;
      this.state.progressMax = 100;
      this.state.progressLabel = "Preparing account profile batch";
      this.setAutoLoginOverlayState(`Loading ${profiles[0].label || profiles[0].username} (1/${profiles.length})`, 0, "default");
      this.state.autoLoginStatus = createAutoLoginStatus("running", "Batch starting", `Preparing ${profiles.length} account profiles.`);
      this.setStatus("Auto Login", `Preparing ${profiles.length} selected account profiles.`);
      this.emitLog(`Starting account profile batch for ${profiles.length} profiles.`);
      this.emitProgress();
      this.emitState();

      for (let index = 0; index < profiles.length; index += 1) {
        const profile = profiles[index];
        const result = await this.runAutoLoginProfile(profile, eqGamePath, {
          batchIndex: index + 1,
          batchTotal: profiles.length,
          enterWorld
        });

        if (result?.outcome !== "success") {
          this.state.autoLoginStatus = createAutoLoginStatus(
            "warning",
            "Batch stopped",
            `${completedCount} of ${profiles.length} selected profiles advanced before '${profile.label || profile.username}' stopped the batch.`
          );
          this.setStatus("Auto Login Check", `Account profile batch stopped at ${index + 1}/${profiles.length}.`);
          this.emitLog(`Account profile batch stopped at '${profile.label || profile.username}'.`, "warning");
          return this.getState();
        }

        completedCount += 1;
        if (index < profiles.length - 1) {
          const nextProfileLabel = profiles[index + 1].label || profiles[index + 1].username;
          this.state.autoLoginStatus = createAutoLoginStatus("running", "Next profile", `Waiting before launching ${nextProfileLabel}.`);
          this.state.progressLabel = `Waiting for ${nextProfileLabel}`;
          this.emitProgress();
          this.emitState();
          await sleep(this.autoLoginBatchDelayMs);
        }
      }

      this.state.progressValue = 100;
      this.state.progressLabel = "Account profile batch complete";
      this.emitProgress();
      const batchCompleteDetail = enterWorld
        ? `${completedCount} selected profiles pressed Play EverQuest.`
        : `${completedCount} selected profiles advanced past the login form.`;
      this.state.autoLoginStatus = createAutoLoginStatus("success", "Batch complete", batchCompleteDetail);
      this.setStatus("Auto Login", batchCompleteDetail);
      this.emitLog(`Account profile batch complete: ${batchCompleteDetail}`, "success");
      if (this.onGameLaunched) {
        await this.onGameLaunched({
          action: normalizeOnGameLaunch(this.state.onGameLaunch),
          autoTriggered
        });
      }
    } catch (error) {
      this.state.autoLoginStatus = createAutoLoginStatus("error", "Batch failed", error.message);
      this.setStatus("Auto Login Error", error.message, error.message);
      this.emitLog(`Account profile batch failed: ${error.message}`, "error");
    } finally {
      this.state.isAutoLoginRunning = false;
      this.setAutoLoginOverlayState();
      this.syncAutoLoginProfilesState();
      this.emitState();
    }

    return this.getState();
  }

  async launchGame(options = {}) {
    const { autoTriggered = false } = options;
    this.clearPrerequisiteInstallOffer();

    if (this.state.autoLogin && this.autoLoginProfiles.length > 0) {
      const requestedSelectedIds = normalizeAutoLoginProfileIds(this.state.selectedAutoLoginProfileIds);
      const requestedSelectedIdSet = new Set(requestedSelectedIds);
      const selectedProfiles = this.autoLoginProfiles.filter((profile) => requestedSelectedIdSet.has(profile.id));
      if (selectedProfiles.length > 1) {
        return this.launchAutoLoginProfiles({
          ids: selectedProfiles.map((profile) => profile.id),
          autoTriggered,
          enterWorld: this.state.autoLoginEnterWorld
        });
      }

      return this.launchAutoLoginProfile({
        id: selectedProfiles[0]?.id || this.state.selectedAutoLoginProfileId,
        autoTriggered,
        enterWorld: this.state.autoLoginEnterWorld
      });
    }

    if (!this.state.gameDirectory) {
      this.setStatus("Run In Folder", "Run this launcher from the EverQuest directory before launching.");
      this.emitState();
      return this.getState();
    }

    if (this.platform !== "win32") {
      this.setStatus("Windows Only", "Launching eqgame.exe is only supported on Windows.");
      this.emitLog("Launch blocked: eqgame.exe can only be started from Windows.", "warning");
      this.emitState();
      return this.getState();
    }

    if (this.state.clientVersion === "Unknown") {
      this.setStatus("Client Unknown", "This EverQuest executable does not match a known client hash.");
      this.emitLog("Launch blocked: the selected EverQuest client is unknown.", "warning");
      this.emitState();
      return this.getState();
    }

    if (!this.state.clientSupported) {
      this.setStatus("Unsupported", `${this.state.serverName} does not publish patches for ${this.state.clientLabel}.`);
      this.emitLog(`Launch blocked: ${this.state.clientLabel} is not supported by ${this.state.serverName}.`, "warning");
      this.emitState();
      return this.getState();
    }

    const eqGamePath = this.getEqGamePath();
    if (!(await exists(eqGamePath))) {
      this.setStatus("No Client", "eqgame.exe was not found in the selected folder.");
      this.emitState();
      return this.getState();
    }

    try {
      this.setStatus("Launching", autoTriggered ? "Auto Play is launching EverQuest." : "Launching EverQuest.");
      this.emitLog("Starting eqgame.exe patchme...");
      this.emitState();

      if (this.testSimulation.launchExitCode != null) {
        throw createImmediateExitError(eqGamePath, this.testSimulation.launchExitCode, null, "simulated launch failure");
      }

      await this.spawnEverQuest(eqGamePath);
      if (this.onGameLaunched) {
        await this.onGameLaunched({
          action: normalizeOnGameLaunch(this.state.onGameLaunch),
          autoTriggered
        });
      }
      this.setStatus("Launching", "EverQuest was started.");
      this.emitState();
    } catch (error) {
      let dependencyScan = null;
      if (isMissingRuntimeStartupStatus(error?.exitCode)) {
        const offer = await this.buildMissingRuntimeInstallOffer(eqGamePath);
        this.setPrerequisiteInstallOffer(offer);
        dependencyScan = await this.inspectMissingRuntimeDependencies(eqGamePath);
        this.emitMissingDependencyLogs(dependencyScan);
      }

      this.setStatus("Launch Error", error.message, error.message);
      this.emitLog(`Launch failed: ${error.message}`, "error");
      for (const diagnostic of createLaunchDiagnostics(error)) {
        this.emitLog(diagnostic.text, diagnostic.tone);
      }
      if (dependencyScan?.missingSummary) {
        this.emitLog(dependencyScan.missingSummary, "warning");
      }
      if (this.state.canInstallPrerequisites && this.state.prerequisiteInstallReason) {
        this.emitLog(this.state.prerequisiteInstallReason);
      }
      this.emitState();
    }

    return this.getState();
  }

  async installMissingPrerequisites() {
    if (this.platform !== "win32") {
      this.setStatus("Windows Only", "Runtime prerequisite installation is only supported on Windows.");
      this.emitState();
      return this.getState();
    }

    if (this.state.isInstallingPrerequisites) {
      return this.getState();
    }

    const eqGamePath = this.getEqGamePath();
    if (!(await exists(eqGamePath))) {
      this.setStatus("No Client", "eqgame.exe was not found in the selected folder.");
      this.emitState();
      return this.getState();
    }

    const offer = await this.buildMissingRuntimeInstallOffer(eqGamePath);
    this.setPrerequisiteInstallOffer(offer);
    this.state.isInstallingPrerequisites = true;
    this.setStatus("Installing", "Preparing DirectX June 2010 and the required Visual C++ runtime installers.");
    this.updatePrerequisiteProgress(0, 100, "Preparing prerequisite installers");
    this.emitLog("Preparing Windows prerequisite installers...");
    this.emitLog(offer.reason);
    this.emitState();

    const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "eqemu-prereqs-"));
    const directxRedistPath = path.join(tempRoot, PREREQUISITE_DOWNLOADS.directx.fileName);
    const vcRedistPath = path.join(tempRoot, `vc_redist.${offer.vcArch}.exe`);
    const directxExtractPath = path.join(tempRoot, "directx");
    let activeStage = this.setPrerequisiteInstallStage({
      stage: "preparing",
      progressValue: 2,
      label: "Preparing prerequisite installers",
      detail: "Preparing Microsoft runtime installers.",
      logText: `Temporary installer workspace: ${tempRoot}`
    });

    try {
      if (this.testSimulation.installMode) {
        const simulatedResult = await this.runSimulatedPrerequisiteInstallation(offer, eqGamePath);
        const validationScan = simulatedResult.validationScan;
        const vcExitCode = simulatedResult.vcExitCode;
        this.updatePrerequisiteProgress(100, 100, "Prerequisite installation complete");
        this.state.isInstallingPrerequisites = false;

        if (validationScan.primaryMissingDependency) {
          this.setPrerequisiteInstallOffer(offer);
          const detail = validationScan.missingSummary
            ? `The prerequisite installers completed, but ${validationScan.missingSummary.toLowerCase()}`
            : "The prerequisite installers completed, but the dependency scan still found unresolved DLL imports.";
          this.setStatus("Install Incomplete", detail, detail);
          this.emitLog("Prerequisite installers completed, but the dependency validation still found unresolved DLL imports.", "warning");
          this.emitMissingDependencyLogs(validationScan);
          for (const recommendation of getPrerequisiteFailureRecommendations("installVcRedist", offer)) {
            this.emitLog(`Recommended: ${recommendation}`, "warning");
          }
          this.emitState();
          return this.getState();
        }

        this.clearPrerequisiteInstallOffer();
        this.emitLog("Dependency validation passed after installing the runtime prerequisites.", "success");

        if (vcExitCode === 3010 || vcExitCode === 1641) {
          this.setStatus("Restart Required", "Windows reported the runtime installation succeeded and a restart is required before launching EverQuest.");
          this.emitLog("Runtime installation completed, and Windows requested a restart.", "warning");
        } else {
          this.setStatus("Ready", "Runtime installation finished. Launch EverQuest again.");
          this.emitLog("Runtime installation completed. Try launching EverQuest again.", "success");
        }

        this.emitState();
        return this.getState();
      }

      activeStage = this.setPrerequisiteInstallStage({
        stage: "downloadDirectX",
        progressValue: 5,
        label: "Step 1 of 5: Downloading DirectX runtime",
        detail: "Downloading the DirectX June 2010 redistributable from Microsoft.",
        logText: "Step 1 of 5: Downloading DirectX June 2010 runtime..."
      });
      await this.downloadFile(PREREQUISITE_DOWNLOADS.directx.url, directxRedistPath, null, (chunkSize, totalBytes, downloadedBytes) => {
        this.updateDownloadProgressRange(5, 30, "Step 1 of 5: Downloading DirectX runtime", downloadedBytes, totalBytes);
      });
      this.emitLog("DirectX June 2010 runtime downloaded.", "success");

      activeStage = this.setPrerequisiteInstallStage({
        stage: "extractDirectX",
        progressValue: 34,
        label: "Step 2 of 5: Extracting DirectX files",
        detail: "Extracting the DirectX runtime package.",
        logText: "Step 2 of 5: Extracting DirectX redistributable files..."
      });
      await fsp.mkdir(directxExtractPath, { recursive: true });
      await this.spawnAndWait(directxRedistPath, ["/Q", `/T:${directxExtractPath}`], {
        cwd: tempRoot,
        windowsHide: true,
        stdio: "ignore"
      }, {
        label: "DirectX June 2010 redistributable extractor",
        timeoutMs: PREREQUISITE_INSTALLER_TIMEOUTS_MS.extractDirectX
      });

      const dxSetupPath = path.join(directxExtractPath, "DXSETUP.exe");
      if (!(await exists(dxSetupPath))) {
        throw new Error("DirectX extraction completed, but DXSETUP.exe was not found.");
      }

      activeStage = this.setPrerequisiteInstallStage({
        stage: "installDirectX",
        progressValue: 46,
        label: "Step 3 of 5: Installing DirectX runtime",
        detail: "Installing DirectX June 2010 runtime components.",
        logText: "Step 3 of 5: Installing DirectX June 2010 runtime..."
      });
      await this.spawnAndWait(dxSetupPath, ["/silent"], {
        cwd: directxExtractPath,
        windowsHide: true,
        stdio: "ignore"
      }, {
        label: "DirectX runtime installer",
        timeoutMs: PREREQUISITE_INSTALLER_TIMEOUTS_MS.installDirectX
      });
      this.updatePrerequisiteProgress(60, 100, "Step 3 of 5: Installing DirectX runtime");
      this.emitLog("DirectX runtime installation completed.", "success");

      activeStage = this.setPrerequisiteInstallStage({
        stage: "downloadVcRedist",
        progressValue: 66,
        label: `Step 4 of 5: Downloading Visual C++ ${offer.vcArch.toUpperCase()}`,
        detail: `Downloading the Visual C++ ${offer.vcArch.toUpperCase()} redistributable from Microsoft.`,
        logText: `Step 4 of 5: Downloading Visual C++ ${offer.vcArch.toUpperCase()} redistributable...`
      });
      await this.downloadFile(offer.vcUrl, vcRedistPath, null, (chunkSize, totalBytes, downloadedBytes) => {
        this.updateDownloadProgressRange(66, 84, `Step 4 of 5: Downloading Visual C++ ${offer.vcArch.toUpperCase()}`, downloadedBytes, totalBytes);
      });
      this.emitLog(`Visual C++ ${offer.vcArch.toUpperCase()} redistributable downloaded.`, "success");

      activeStage = this.setPrerequisiteInstallStage({
        stage: "installVcRedist",
        progressValue: 88,
        label: `Step 5 of 5: Installing Visual C++ ${offer.vcArch.toUpperCase()}`,
        detail: `Installing the Visual C++ ${offer.vcArch.toUpperCase()} runtime. Follow any Windows prompts if they appear.`,
        logText: `Step 5 of 5: Installing Visual C++ ${offer.vcArch.toUpperCase()} redistributable...`
      });
      const vcExitCode = await this.spawnAndWait(vcRedistPath, ["/install", "/passive", "/norestart"], {
        cwd: tempRoot,
        windowsHide: true,
        stdio: "ignore"
      }, {
        label: `Visual C++ ${offer.vcArch.toUpperCase()} redistributable`,
        acceptedExitCodes: WINDOWS_SUCCESS_REBOOT_EXIT_CODES,
        timeoutMs: PREREQUISITE_INSTALLER_TIMEOUTS_MS.installVcRedist
      });

      const validationScan = await this.inspectMissingRuntimeDependencies(eqGamePath);
      this.updatePrerequisiteProgress(100, 100, "Prerequisite installation complete");
      this.state.isInstallingPrerequisites = false;

      if (validationScan.primaryMissingDependency) {
        this.setPrerequisiteInstallOffer(offer);
        const detail = validationScan.missingSummary
          ? `The prerequisite installers completed, but ${validationScan.missingSummary.toLowerCase()}`
          : "The prerequisite installers completed, but the dependency scan still found unresolved DLL imports.";
        this.setStatus("Install Incomplete", detail, detail);
        this.emitLog("Prerequisite installers completed, but the dependency validation still found unresolved DLL imports.", "warning");
        this.emitMissingDependencyLogs(validationScan);
        for (const recommendation of getPrerequisiteFailureRecommendations("installVcRedist", offer)) {
          this.emitLog(`Recommended: ${recommendation}`, "warning");
        }
        this.emitState();
        return this.getState();
      }

      this.clearPrerequisiteInstallOffer();
      this.emitLog("Dependency validation passed after installing the runtime prerequisites.", "success");

      if (vcExitCode === 3010 || vcExitCode === 1641) {
        this.setStatus("Restart Required", "Windows reported the runtime installation succeeded and a restart is required before launching EverQuest.");
        this.emitLog("Runtime installation completed, and Windows requested a restart.", "warning");
      } else {
        this.setStatus("Ready", "Runtime installation finished. Launch EverQuest again.");
        this.emitLog("Runtime installation completed. Try launching EverQuest again.", "success");
      }

      this.emitState();
      return this.getState();
    } catch (error) {
      this.state.isInstallingPrerequisites = false;
      this.setPrerequisiteInstallOffer(offer);
      const stageLabel = getPrerequisiteStageLabel(error.prerequisiteStage || activeStage);
      const detail = `Prerequisite installation failed while ${stageLabel}. ${error.message}`;
      this.updatePrerequisiteProgress(Math.min(this.state.progressValue || 0, 99), 100, `Install failed while ${stageLabel}`);
      this.setStatus("Install Error", detail, detail);
      this.emitLog(`Runtime installation failed while ${stageLabel}: ${error.message}`, "error");
      for (const recommendation of getPrerequisiteFailureRecommendations(activeStage, offer)) {
        this.emitLog(`Recommended: ${recommendation}`, "warning");
      }
      this.emitState();
      return this.getState();
    } finally {
      await fsp.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
    }
  }

  throwIfCanceled() {
    if (this.cancelRequested) {
      throw new Error("PATCH_CANCELED");
    }
  }

  resolveGamePath(relativePath) {
    const normalized = relativePath.replace(/[\\/]+/g, path.sep);
    const resolved = path.resolve(this.state.gameDirectory, normalized);
    const rootWithSeparator = this.state.gameDirectory.endsWith(path.sep) ? this.state.gameDirectory : `${this.state.gameDirectory}${path.sep}`;
    if (resolved !== this.state.gameDirectory && !resolved.startsWith(rootWithSeparator)) {
      throw new Error(`Refusing to write outside the game directory: ${relativePath}`);
    }

    return resolved;
  }

  async downloadFile(url, destinationPath, signal, onChunk) {
    await fsp.mkdir(path.dirname(destinationPath), { recursive: true });

    const response = await this.fetchImpl(url, { signal });
    if (!response.ok || !response.body) {
      throw new Error(response.status === 404 ? `File not found: ${url}` : `Download failed (${response.status}) for ${url}`);
    }

    const contentLengthHeader =
      typeof response.headers?.get === "function"
        ? response.headers.get("content-length")
        : response.headers?.["content-length"];
    const totalBytes = Number.parseInt(contentLengthHeader, 10);
    const safeTotalBytes = Number.isFinite(totalBytes) && totalBytes > 0 ? totalBytes : 0;

    const file = fs.createWriteStream(destinationPath);
    let downloadedBytes = 0;
    const handleChunk = typeof onChunk === "function" ? onChunk : null;
    try {
      for await (const chunk of response.body) {
        this.throwIfCanceled();
        file.write(chunk);
        downloadedBytes += chunk.length;
        handleChunk?.(chunk.length, safeTotalBytes, downloadedBytes);
      }
    } catch (error) {
      file.destroy();
      await fsp.unlink(destinationPath).catch(() => {});
      throw error.name === "AbortError" ? new Error("PATCH_CANCELED") : error;
    }

    await new Promise((resolve, reject) => {
      file.end((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  async ensureManifestLoaded() {
    const manifestPath = this.getManifestPath();
    if (!(await exists(manifestPath))) {
      await this.fetchManifest();
    }

    const manifest = await this.loadYaml(manifestPath);
    if (!manifest || typeof manifest !== "object") {
      throw new Error("Manifest response was empty or invalid.");
    }

    if (!manifest.downloadprefix) {
      throw new Error("Manifest is missing downloadprefix.");
    }

    manifest.version = normalizeVersion(manifest.version);

    if (!Array.isArray(manifest.downloads)) {
      manifest.downloads = [];
    }

    if (manifest.deletes != null && !Array.isArray(manifest.deletes)) {
      throw new Error("Manifest deletes field is invalid.");
    }

    return manifest;
  }

  async spawnEverQuest(eqGamePath) {
    const launchOptions = {
      cwd: this.state.gameDirectory,
      detached: true,
      stdio: "ignore",
      windowsHide: true
    };

    try {
      await this.spawnDetached(eqGamePath, ["patchme"], launchOptions, {
        waitForExitMs: this.launchStabilizationMs,
        launchMethod: "direct spawn"
      });
    } catch (error) {
      if (this.platform !== "win32" || !isLaunchPermissionError(error)) {
        throw error;
      }

      error.launchMethod = error.launchMethod || "direct spawn";
      this.emitLog(`Direct launch was denied (${error.code}). Retrying through cmd.exe...`, "warning");
      await this.spawnDetached(
        process.env.comspec || "cmd.exe",
        ["/d", "/s", "/c", "start", '""', "/d", this.state.gameDirectory, eqGamePath, "patchme"],
        launchOptions,
        { launchMethod: "cmd.exe start fallback" }
      );
    }
  }

  async spawnDetached(command, args, options, behavior = {}) {
    const waitForExitMs = Number.isFinite(behavior.waitForExitMs) && behavior.waitForExitMs > 0 ? behavior.waitForExitMs : 0;
    const launchMethod = typeof behavior.launchMethod === "string" ? behavior.launchMethod : "";

    await new Promise((resolve, reject) => {
      let child;
      try {
        child = this.spawnImpl(command, args, options);
      } catch (error) {
        if (launchMethod && error && !error.launchMethod) {
          error.launchMethod = launchMethod;
        }
        reject(error);
        return;
      }

      let settled = false;
      const finish = (callback, value) => {
        if (settled) {
          return;
        }
        settled = true;
        callback(value);
      };

      let launchTimer = null;
      const clearLaunchTimer = () => {
        if (launchTimer) {
          clearTimeout(launchTimer);
          launchTimer = null;
        }
      };

      child.once("error", (error) => {
        if (launchMethod && error && !error.launchMethod) {
          error.launchMethod = launchMethod;
        }
        clearLaunchTimer();
        finish(reject, error);
      });

      if (waitForExitMs > 0) {
        const rejectOnEarlyExit = (code, signal) => {
          clearLaunchTimer();
          finish(reject, createImmediateExitError(command, code, signal, launchMethod));
        };

        child.once("exit", rejectOnEarlyExit);
        child.once("close", rejectOnEarlyExit);
      }

      child.once("spawn", () => {
        if (waitForExitMs > 0) {
          launchTimer = setTimeout(() => {
            launchTimer = null;
            child.unref();
            finish(resolve);
          }, waitForExitMs);
          return;
        }

        child.unref();
        finish(resolve);
      });
    });
  }

  async spawnAndCapture(command, args, options = {}, behavior = {}) {
    const acceptedExitCodes = new Set(
      Array.isArray(behavior.acceptedExitCodes) && behavior.acceptedExitCodes.length
        ? behavior.acceptedExitCodes
        : [0]
    );
    const label = behavior.label || path.basename(command || "process");
    const timeoutMs = Number.isFinite(behavior.timeoutMs) && behavior.timeoutMs > 0
      ? behavior.timeoutMs
      : 0;
    const input = options.input == null ? null : String(options.input);
    const spawnOptions = { ...options, stdio: ["pipe", "pipe", "pipe"] };
    delete spawnOptions.input;

    return new Promise((resolve, reject) => {
      let child;
      try {
        child = this.spawnImpl(command, args, spawnOptions);
      } catch (error) {
        reject(error);
        return;
      }

      let settled = false;
      let timeoutId = null;
      let stdout = "";
      let stderr = "";
      const finish = (callback, value) => {
        if (settled) {
          return;
        }
        settled = true;
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        callback(value);
      };
      const appendOutput = (current, chunk) => {
        const next = `${current}${chunk.toString("utf8")}`;
        return next.length > 64000 ? next.slice(-64000) : next;
      };

      if (timeoutMs > 0) {
        timeoutId = setTimeout(() => {
          timeoutId = null;
          if (typeof child.kill === "function") {
            try {
              child.kill();
            } catch (_error) {
              // Ignore termination errors and surface the timeout itself.
            }
          }
          finish(reject, new Error(`${label} did not finish within ${formatDurationForDisplay(timeoutMs)}.`));
        }, timeoutMs);
      }

      child.stdout?.on?.("data", (chunk) => {
        stdout = appendOutput(stdout, chunk);
      });

      child.stderr?.on?.("data", (chunk) => {
        stderr = appendOutput(stderr, chunk);
      });

      child.once("error", (error) => {
        finish(reject, error);
      });

      child.once("exit", (code, signal) => {
        if (signal) {
          finish(reject, new Error(`${label} was terminated by signal ${signal}.`));
          return;
        }

        const normalizedCode = Number.isFinite(code) ? code : 0;
        if (!acceptedExitCodes.has(normalizedCode)) {
          const detail = stderr.trim();
          finish(reject, new Error(detail || `${label} exited with code ${normalizedCode}.`));
          return;
        }

        finish(resolve, {
          code: normalizedCode,
          stdout,
          stderr
        });
      });

      if (child.stdin) {
        child.stdin.end(input || "", "utf8");
      }
    });
  }

  async spawnAndWait(command, args, options, behavior = {}) {
    const acceptedExitCodes = new Set(
      Array.isArray(behavior.acceptedExitCodes) && behavior.acceptedExitCodes.length
        ? behavior.acceptedExitCodes
        : [0]
    );
    const label = behavior.label || path.basename(command || "installer");
    const timeoutMs = Number.isFinite(behavior.timeoutMs) && behavior.timeoutMs > 0
      ? behavior.timeoutMs
      : 0;

    return new Promise((resolve, reject) => {
      let child;
      try {
        child = this.spawnImpl(command, args, options);
      } catch (error) {
        reject(error);
        return;
      }

      let settled = false;
      let timeoutId = null;
      const finish = (callback, value) => {
        if (settled) {
          return;
        }
        settled = true;
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        callback(value);
      };

      if (timeoutMs > 0) {
        timeoutId = setTimeout(() => {
          timeoutId = null;
          if (typeof child.kill === "function") {
            try {
              child.kill();
            } catch (_error) {
              // Ignore termination errors and surface the timeout itself.
            }
          }
          finish(reject, new Error(`${label} did not finish within ${formatDurationForDisplay(timeoutMs)}.`));
        }, timeoutMs);
      }

      child.once("error", (error) => {
        finish(reject, error);
      });

      child.once("exit", (code, signal) => {
        if (signal) {
          finish(reject, new Error(`${label} was terminated by signal ${signal}.`));
          return;
        }

        const normalizedCode = Number.isFinite(code) ? code : 0;
        if (!acceptedExitCodes.has(normalizedCode)) {
          finish(reject, new Error(`${label} exited with code ${normalizedCode}.`));
          return;
        }

        finish(resolve, normalizedCode);
      });
    });
  }

  async getFileHash(filePath) {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash("md5");
      const stream = fs.createReadStream(filePath);
      stream.on("error", reject);
      stream.on("data", (chunk) => hash.update(chunk));
      stream.on("end", () => resolve(hash.digest("hex").toUpperCase()));
    });
  }

  async loadYaml(filePath) {
    const content = await fsp.readFile(filePath, "utf8");
    return SimpleYaml.parse(content);
  }

  async saveYaml(filePath, data) {
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    const content = SimpleYaml.stringify(data);
    await fsp.writeFile(filePath, content, "utf8");
  }
}

module.exports = {
  LauncherBackend
};
