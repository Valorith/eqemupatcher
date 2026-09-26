(function bootstrapBrowserPreview() {
  if (typeof window === "undefined" || window.launcher) {
    return;
  }

  const params = new URLSearchParams(window.location.search);
  const previewMode = String(params.get("browser-preview") || "ready").trim().toLowerCase() || "ready";
  const appVersion = "2.1.0-browser-preview";
  const patchNotesUrl = "https://example.invalid/patch-notes.md";
  const listeners = new Set();

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function createBaseLauncherUpdate(status) {
    return {
      status,
      currentVersion: "2.1.0",
      latestVersion: status === "available" ? "2.1.2" : "2.1.0",
      progressValue: 0,
      progressMax: 100,
      releaseUrl: "https://example.invalid/releases/2.1.2",
      message: ""
    };
  }

  function createAutoLoginProfiles() {
    const accounts = [
      ["Asakani", "nalanceseisary"], ["Troglodytam", "merbriken"], ["Marlzing", "delere"],
      ["Mortem", "morsmangone"], ["Athazin", "marlzing"], ["Eloquii", "fascinare"],
      ["Doktor", "mootok"], ["Taliant", "daranja"], ["Malvarien", "1iksarmonk"],
      ["Growl", "growlwar"], ["Bestia", "1beastlord"], ["Avmenieu", "vendors"],
      ["Ranthor", "ranthorpal"], ["Kelsa", "kelsadruid"]
    ];
    const requestedCount = Number.parseInt(params.get("profiles") || "", 10);
    const count = Number.isFinite(requestedCount) && requestedCount >= 0 ? requestedCount : accounts.length;
    return Array.from({ length: count }, (_, index) => {
      const [label, username] = accounts[index % accounts.length];
      const round = Math.floor(index / accounts.length);
      return {
        id: `preview-profile-${index + 1}`,
        label: round ? `${label} ${round + 1}` : label,
        username: round ? `${username}${round + 1}` : username,
        isDefault: index === 0
      };
    });
  }

  function createState(mode) {
    const base = {
      serverName: "Clumsy's World: Resurgence",
      gameServerHost: "",
      gameServerPort: 9000,
      gameServerStatus: {
        state: "online",
        label: "Online",
        detail: "Connected to the default game server in 24ms.",
        host: "",
        port: 9000,
        checkedAt: new Date().toISOString(),
        latencyMs: 24,
        error: ""
      },
      loginServerHost: "login.eqemulator.net",
      loginServerPort: 5999,
      loginServerStatus: {
        state: "online",
        label: "Online",
        detail: "Connected to login.eqemulator.net:5999 in 31ms.",
        host: "login.eqemulator.net",
        port: 5999,
        checkedAt: new Date().toISOString(),
        latencyMs: 31,
        error: ""
      },
      patchNotesUrl,
      clientLabel: "Rain of Fear 2 (4GB)",
      clientVersion: "Rain_Of_Fear_2_4GB",
      clientHash: "389709EC0E456C3DAE881A61218AAB3F",
      clientSupported: true,
      statusBadge: "Launch Ready",
      statusDetail: "EverQuest was started.",
      heroImageUrl: "/src/electron/assets/hero/rof.png",
      branding: {
        serverName: "Clumsy's World: Resurgence",
        tagline: "An EverQuest Emulated Server",
        primaryImageUrl: "/src/electron/assets/hero/generated/dragon-cavern-v1.png",
        wordmarkImageUrl: "/src/electron/assets/branding/clumsys-world-wordmark-cwt.png",
        wordmarkImageAlt: "Clumsy's World Resurgence",
        wordmarkRemoveLightBackground: true,
        emblemText: "C",
        websiteUrl: "https://www.clumsysworld.com",
        websiteLabel: "www.clumsysworld.com",
        discordUrl: "",
        tools: [
          { label: "Wiki", url: "https://wiki.clumsysworld.com/" },
          { label: "Alla", url: "https://alla.clumsysworld.com/" },
          { label: "Magelo", url: "https://magelo.clumsysworld.com/" },
          { label: "Nexus", url: "https://nexus.clumsysworld.com/" }
        ]
      },
      canPatch: true,
      canLaunch: true,
      autoPatch: true,
      autoPlay: false,
      onGameLaunch: "minimize",
      gameDirectory: "C:\\Preview\\EverQuest",
      reportUrl: "",
      prerequisiteDirectXUrl: "",
      prerequisiteVcUrl: "",
      progressValue: 1,
      progressMax: 1,
      progressLabel: "Ready",
      isPatching: false,
      isInstallingPrerequisites: false,
      manifestVersion: "preview-manifest-001",
      needsPatch: false,
      launcherUpdate: createBaseLauncherUpdate("up-to-date")
    };

    switch (mode) {
      case "missing":
        return {
          ...base,
          clientLabel: "Unknown",
          clientVersion: "Unknown",
          clientHash: "",
          clientSupported: false,
          statusBadge: "Run In Folder",
          statusDetail: "eqgame.exe was not found in the selected folder.",
          gameDirectory: "",
          canPatch: false,
          canLaunch: false,
          autoPatch: false,
          progressValue: 0,
          progressLabel: "Waiting for input",
          manifestVersion: "",
          heroImageUrl: "/src/electron/assets/hero/rof.png"
        };
      case "patching":
        return {
          ...base,
          statusBadge: "Patching",
          statusDetail: "Applying mock files for browser preview.",
          isPatching: true,
          canPatch: true,
          canLaunch: false,
          progressValue: 62,
          progressMax: 100,
          progressLabel: "Downloading files"
        };
      case "update":
        return {
          ...base,
          launcherUpdate: createBaseLauncherUpdate("available")
        };
      case "profiles": {
        const autoLoginProfiles = createAutoLoginProfiles();
        return {
          ...base,
          autoLoginProfiles,
          selectedAutoLoginProfileId: autoLoginProfiles[0]?.id || "",
          selectedAutoLoginProfileIds: autoLoginProfiles.slice(0, 2).map((profile) => profile.id)
        };
      }
      case "ready":
      default:
        return base;
    }
  }

  function createPatchNotesResponse() {
    const content = [
      "# Browser Preview Notes",
      "",
      "- This browser preview uses mocked launcher data.",
      "- Tabs, layout, buttons, patch notes, and UI Manager can all be inspected safely.",
      "- Nothing in this preview touches your live EverQuest folder or Electron profile.",
      "",
      "[Release Notes](https://example.invalid/releases/2.1.2)"
    ].join("\n");

    return {
      url: patchNotesUrl,
      content,
      html: [
        "<h1>Browser Preview Notes</h1>",
        "<ul>",
        "<li>This browser preview uses mocked launcher data.</li>",
        "<li>Tabs, layout, buttons, patch notes, and UI Manager can all be inspected safely.</li>",
        "<li>Nothing in this preview touches your live EverQuest folder or Electron profile.</li>",
        "</ul>",
        "<p><a href=\"https://example.invalid/releases/2.1.2\">Release Notes</a></p>"
      ].join(""),
      error: "",
      fetchedAt: "2026-04-21T00:00:00.000Z",
      contentHash: "browser-preview-notes"
    };
  }

  // In-memory stand-in for the UI Manager backend. Nothing here touches disk;
  // it mutates plain objects so apply/reset/restore visibly change the preview.
  const PREVIEW_GAME_DIRECTORY = "C:\\Preview\\EverQuest";
  const PREVIEW_UI_FILES_DIRECTORY = `${PREVIEW_GAME_DIRECTORY}\\uifiles`;
  const PREVIEW_ART = {
    dragon: "/src/electron/assets/hero/generated/dragon-cavern-v1.png",
    rof: "/src/electron/assets/hero/rof.png",
    sof: "/src/electron/assets/hero/sof.png",
    titanium: "/src/electron/assets/hero/titanium.png",
    underfoot: "/src/electron/assets/hero/underfoot.png",
    mirror: "/src/electron/assets/hero/brokenmirror.png"
  };

  function createPreviewBundle(optionPath, xmlFiles, options = {}) {
    const segments = optionPath.split("/");
    return {
      optionPath,
      label: segments.at(-1),
      categoryPath: segments.slice(1, -1).join("/"),
      isDefault: /\/default$/i.test(optionPath),
      xmlFiles,
      tgaFiles: options.tgaFiles || [],
      previewImageUrl: options.previewImageUrl || "",
      instructions: options.instructions || "",
      activeState: options.active ? "active" : options.mixed ? "mixed" : "inactive"
    };
  }

  const uiManagerPackages = {
    "Clumsy Gold": {
      prepared: true,
      rootXmlCount: 14,
      bundles: [
        createPreviewBundle("Options/Inventory/Default", ["EQUI_Inventory.xml"], { active: true }),
        createPreviewBundle("Options/Inventory/Compact", ["EQUI_Inventory.xml"], {
          previewImageUrl: PREVIEW_ART.titanium,
          tgaFiles: ["inventory_compact.tga"],
          instructions: "Shrinks the bag grid and moves the coin purse under the paper doll."
        }),
        createPreviewBundle("Options/Inventory/Wide", ["EQUI_Inventory.xml"], { tgaFiles: ["inventory_wide.tga"] }),
        createPreviewBundle("Options/Target/Dragon", ["EQUI_TargetWindow.xml"], {
          active: true,
          previewImageUrl: PREVIEW_ART.dragon,
          tgaFiles: ["window_pieces04.tga"],
          instructions: "Uses the dragon-scale frame from the launcher art. Pairs well with the Gold player window."
        }),
        createPreviewBundle("Options/Target/Classic", ["EQUI_TargetWindow.xml"], {
          previewImageUrl: PREVIEW_ART.mirror,
          instructions: "A lower-contrast fallback for comparison."
        }),
        createPreviewBundle("Options/Player/Gold", ["EQUI_PlayerWindow.xml"], {
          active: true,
          previewImageUrl: PREVIEW_ART.rof,
          tgaFiles: ["player_gold.tga"]
        }),
        createPreviewBundle("Options/Player/Slim Bars", ["EQUI_PlayerWindow.xml"], {
          previewImageUrl: PREVIEW_ART.sof,
          tgaFiles: ["player_slim.tga"],
          instructions: "Thinner HP, mana, and endurance bars with numeric readouts."
        }),
        createPreviewBundle("Options/Spells/Classic Gems", ["EQUI_CastSpellWnd.xml", "EQUI_SpellBookWnd.xml"], { active: true }),
        createPreviewBundle("Options/Spells/Large Icons", ["EQUI_CastSpellWnd.xml", "EQUI_SpellBookWnd.xml"], {
          previewImageUrl: PREVIEW_ART.underfoot,
          tgaFiles: ["spell_gems_large.tga", "spellbook_large.tga"],
          instructions: "Doubles gem size for high-resolution displays. Requires a UI reload (/loadskin) after applying."
        }),
        createPreviewBundle("Options/Buffs/Default", ["EQUI_BuffWindow.xml"], { mixed: true }),
        createPreviewBundle("Options/Buffs/Timers", ["EQUI_BuffWindow.xml"], { tgaFiles: ["buff_timers.tga"] })
      ]
    },
    "Clumsy Classic": {
      prepared: false,
      rootXmlCount: 9,
      bundles: []
    },
    "Vert": {
      prepared: true,
      rootXmlCount: 11,
      metadataIssues: 2,
      bundles: [
        createPreviewBundle("Options/Hotbar/Vertical", ["EQUI_HotButtonWnd.xml"], { active: true, previewImageUrl: PREVIEW_ART.sof }),
        createPreviewBundle("Options/Hotbar/Horizontal", ["EQUI_HotButtonWnd.xml"], {})
      ]
    },
    default: {
      prepared: false,
      protected: true,
      rootXmlCount: 212,
      bundles: []
    }
  };

  const uiManagerTargets = [
    ["Clumsy", "CW", "Clumsy Gold"],
    ["Tester", "CW", "Default"],
    ["Athazin", "CW", "Clumsy Gold"],
    ["Eloquii", "CW", "Vert"],
    ["Mortem", "CW", "Default"],
    ["Kelsa", "PEQ", "Default"],
    ["Ranthor", "PEQ", "Clumsy Gold"]
  ].map(([characterName, serverName, uiSkin]) => ({
    path: `${PREVIEW_GAME_DIRECTORY}\\UI_${characterName}_${serverName}.ini`,
    fileName: `UI_${characterName}_${serverName}.ini`,
    characterName,
    serverName,
    uiSkin
  }));

  const uiManagerBackups = {};
  let uiManagerBackupSequence = 0;

  function recordPreviewBackup(packageName, reason, options = {}) {
    uiManagerBackupSequence += 1;
    const createdAt = new Date(Date.now() - (options.ageMinutes || 0) * 60000).toISOString();
    const backup = {
      id: `${createdAt.replace(/[:.]/g, "-")}-${reason}`,
      packageName,
      reason,
      createdAt,
      sizeBytes: options.snapshot === false ? 2048 : 1843200 + uiManagerBackupSequence * 40960,
      hasSnapshot: options.snapshot !== false,
      iniFiles: (options.iniPaths || []).map((originalPath, index) => ({
        originalPath,
        backupFile: `${String(index + 1).padStart(2, "0")}__${originalPath.split("\\").at(-1)}`
      }))
    };
    uiManagerBackups[packageName] = [backup, ...(uiManagerBackups[packageName] || [])].slice(0, 8);
    return backup;
  }

  recordPreviewBackup("Clumsy Gold", "prepare", { ageMinutes: 60 * 24 * 9 });
  recordPreviewBackup("Clumsy Gold", "set-uiskin", { ageMinutes: 60 * 24 * 3, snapshot: false, iniPaths: [uiManagerTargets[2].path] });
  recordPreviewBackup("Clumsy Gold", "activate", { ageMinutes: 90, iniPaths: [uiManagerTargets[0].path] });

  function getPreviewPackageSummary(name) {
    const pkg = uiManagerPackages[name];
    return {
      name,
      path: `${PREVIEW_UI_FILES_DIRECTORY}\\${name}`,
      protected: Boolean(pkg.protected),
      prepared: Boolean(pkg.prepared),
      optionCount: pkg.prepared ? pkg.bundles.length : 0,
      rootXmlCount: pkg.rootXmlCount
    };
  }

  function createUiManagerOverview() {
    return {
      gameDirectory: PREVIEW_GAME_DIRECTORY,
      uiFilesDirectory: PREVIEW_UI_FILES_DIRECTORY,
      canManage: true,
      packages: Object.keys(uiManagerPackages)
        .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }))
        .map(getPreviewPackageSummary),
      targets: uiManagerTargets.map((target) => ({ ...target }))
    };
  }

  function createUiManagerDetail(packageName) {
    const pkg = uiManagerPackages[packageName];
    if (!pkg) {
      throw new Error(`UI package not found: ${packageName}`);
    }
    const backups = uiManagerBackups[packageName] || [];
    return {
      ...getPreviewPackageSummary(packageName),
      rootFiles: ["EQUI_Inventory.xml", "EQUI_TargetWindow.xml", "window_pieces04.tga"],
      bundles: pkg.prepared ? pkg.bundles.map((bundle) => ({ ...bundle })) : [],
      backups: backups.map((backup) => ({ ...backup })),
      backupSummary: {
        backupCount: backups.length,
        totalSizeBytes: backups.reduce((sum, backup) => sum + backup.sizeBytes, 0),
        maxBackupCount: 8,
        maxTotalSizeBytes: 134217728
      }
    };
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function activatePreviewBundles(packageName, optionPaths) {
    const pkg = uiManagerPackages[packageName];
    for (const optionPath of optionPaths) {
      const bundle = pkg.bundles.find((entry) => entry.optionPath === optionPath);
      if (!bundle) {
        throw new Error(`UI option not found: ${optionPath}`);
      }
      const key = bundle.xmlFiles.join("|").toLowerCase();
      for (const entry of pkg.bundles) {
        if (entry.xmlFiles.join("|").toLowerCase() === key) {
          entry.activeState = "inactive";
        }
      }
      bundle.activeState = "active";
    }
  }

  function setPreviewUiSkin(packageName, iniPaths) {
    for (const target of uiManagerTargets) {
      if (iniPaths.includes(target.path)) {
        target.uiSkin = packageName;
      }
    }
  }

  let currentState = createState(previewMode);

  function emit(event) {
    for (const listener of listeners) {
      listener(clone(event));
    }
  }

  function emitState() {
    emit({
      type: "state",
      payload: currentState
    });
  }

  async function updateState(patch) {
    currentState = {
      ...currentState,
      ...patch
    };
    emitState();
    return clone(currentState);
  }

  window.launcher = {
    async initialize() {
      return clone(currentState);
    },
    async getVersion() {
      return appVersion;
    },
    async refreshState() {
      return clone(currentState);
    },
    async refreshServerStatus() {
      currentState = {
        ...currentState,
        gameServerStatus: {
          ...currentState.gameServerStatus,
          checkedAt: new Date().toISOString(),
          latencyMs: 24
        },
        loginServerStatus: {
          ...currentState.loginServerStatus,
          checkedAt: new Date().toISOString(),
          latencyMs: 31
        }
      };
      emitState();
      return clone(currentState);
    },
    async getPatchNotes() {
      return createPatchNotesResponse();
    },
    async checkForLauncherUpdate() {
      return clone(currentState);
    },
    async startLauncherUpdateDownload() {
      currentState = {
        ...currentState,
        launcherUpdate: {
          ...currentState.launcherUpdate,
          status: "downloading",
          progressValue: 64,
          progressMax: 100
        }
      };
      emitState();
      return clone(currentState);
    },
    async applyLauncherUpdate() {
      currentState = {
        ...currentState,
        launcherUpdate: {
          ...currentState.launcherUpdate,
          status: "ready",
          latestVersion: "2.1.2"
        }
      };
      emitState();
      return {
        ok: true,
        state: clone(currentState)
      };
    },
    async getUiManagerOverview() {
      await wait(180);
      return createUiManagerOverview();
    },
    async openUiManagerImportDialog() {
      return {
        canceled: true,
        sourcePath: ""
      };
    },
    getPathForFile(file) {
      return file?.name ? `C:\\Users\\Preview\\Downloads\\${file.name}` : "";
    },
    async importUiPackageFolder(sourcePath) {
      await wait(400);
      const packageName = String(sourcePath || "").split(/[\\/]/).filter(Boolean).at(-1) || "Imported UI";
      if (uiManagerPackages[packageName]) {
        throw new Error(`A UI package named ${packageName} already exists.`);
      }
      uiManagerPackages[packageName] = { prepared: false, rootXmlCount: 6, bundles: [] };
      return {
        overview: createUiManagerOverview(),
        details: createUiManagerDetail(packageName)
      };
    },
    async prepareUiPackage(packageName) {
      await wait(500);
      recordPreviewBackup(packageName, "prepare");
      const pkg = uiManagerPackages[packageName];
      pkg.prepared = true;
      if (!pkg.bundles.length) {
        pkg.bundles = [
          createPreviewBundle("Options/Inventory/Default", ["EQUI_Inventory.xml"], { active: true }),
          createPreviewBundle("Options/Inventory/Classic Bags", ["EQUI_Inventory.xml"], { previewImageUrl: PREVIEW_ART.titanium })
        ];
      }
      return {
        details: createUiManagerDetail(packageName)
      };
    },
    async validateUiPackageOptionComments(packageName) {
      await wait(400);
      recordPreviewBackup(packageName, "validate-ui-metadata");
      const corrected = uiManagerPackages[packageName]?.metadataIssues || 0;
      if (uiManagerPackages[packageName]) {
        uiManagerPackages[packageName].metadataIssues = 0;
      }
      return {
        details: createUiManagerDetail(packageName),
        summary: {
          scannedCount: uiManagerPackages[packageName]?.bundles.length || 0,
          correctedCount: corrected
        }
      };
    },
    async checkUiPackageMetadata(packageName) {
      await wait(250);
      const pkg = uiManagerPackages[packageName];
      const invalidCount = pkg?.metadataIssues || 0;
      return {
        packageName,
        status: !pkg?.prepared ? "unavailable" : invalidCount ? "issues" : "healthy",
        scannedCount: pkg?.bundles.length || 0,
        invalidCount,
        healthy: !invalidCount
      };
    },
    async getUiPackageDetails(packageName) {
      await wait(120);
      return createUiManagerDetail(packageName);
    },
    async activateUiOption({ packageName, optionPath, iniPaths = [] }) {
      return window.launcher.activateUiOptions({ packageName, optionPaths: [optionPath], iniPaths });
    },
    async activateUiOptions({ packageName, optionPaths = [], iniPaths = [] }) {
      await wait(500);
      recordPreviewBackup(packageName, "activate", { iniPaths });
      activatePreviewBundles(packageName, optionPaths);
      setPreviewUiSkin(packageName, iniPaths);
      return {
        details: createUiManagerDetail(packageName)
      };
    },
    async setUiSkinTargets({ packageName, iniPaths = [] }) {
      await wait(350);
      if (!iniPaths.length) {
        throw new Error("Select at least one character UI settings file.");
      }
      recordPreviewBackup(packageName, "set-uiskin", { snapshot: false, iniPaths });
      setPreviewUiSkin(packageName, iniPaths);
      return {
        targets: uiManagerTargets.map((target) => ({ ...target }))
      };
    },
    async resetUiPackage(packageName) {
      await wait(500);
      recordPreviewBackup(packageName, "reset");
      const pkg = uiManagerPackages[packageName];
      const seenGroups = new Set();
      for (const bundle of pkg.bundles) {
        bundle.activeState = "inactive";
      }
      for (const bundle of pkg.bundles) {
        const key = bundle.xmlFiles.join("|").toLowerCase();
        if (!seenGroups.has(key) && bundle.isDefault) {
          bundle.activeState = "active";
          seenGroups.add(key);
        }
      }
      return {
        details: createUiManagerDetail(packageName)
      };
    },
    async listUiManagerBackups(packageName) {
      return createUiManagerDetail(packageName).backups;
    },
    async restoreUiManagerBackup({ packageName }) {
      await wait(450);
      recordPreviewBackup(packageName, "restore");
      return {
        details: createUiManagerDetail(packageName),
        targets: uiManagerTargets.map((target) => ({ ...target }))
      };
    },
    async startPatch() {
      return updateState({
        isPatching: true,
        canLaunch: false,
        statusBadge: "Patching",
        statusDetail: "Applying mock files for browser preview.",
        progressValue: 62,
        progressMax: 100,
        progressLabel: "Downloading files"
      });
    },
    async cancelPatch() {
      return updateState({
        isPatching: false,
        canLaunch: true,
        statusBadge: "Launch Ready",
        statusDetail: "EverQuest was started.",
        progressValue: 1,
        progressMax: 1,
        progressLabel: "Ready"
      });
    },
    async launchGame() {
      return updateState({
        statusBadge: "Launch Ready",
        statusDetail: "EverQuest was started."
      });
    },
    async installMissingPrerequisites() {
      return updateState({
        isInstallingPrerequisites: true,
        statusBadge: "Installing",
        statusDetail: "Simulating prerequisite installation in browser preview.",
        progressValue: 40,
        progressMax: 100,
        progressLabel: "Installing prerequisites"
      });
    },
    async setAutoLoginProfileSelection({ activeId, ids } = {}) {
      return updateState({
        selectedAutoLoginProfileId: activeId || currentState.selectedAutoLoginProfileId || "",
        selectedAutoLoginProfileIds: Array.isArray(ids) ? [...ids] : []
      });
    },
    async reorderAutoLoginProfiles({ ids } = {}) {
      const profiles = Array.isArray(currentState.autoLoginProfiles) ? currentState.autoLoginProfiles : [];
      const byId = new Map(profiles.map((profile) => [profile.id, profile]));
      const ordered = (Array.isArray(ids) ? ids : []).map((id) => byId.get(id)).filter(Boolean);
      return updateState({
        autoLoginProfiles: [...ordered, ...profiles.filter((profile) => !ordered.includes(profile))]
      });
    },
    async updateSettings(patch) {
      return updateState(patch || {});
    },
    async minimizeWindow() {
      return true;
    },
    async toggleMaximizeWindow() {
      return true;
    },
    async closeWindow() {
      return true;
    },
    async openExternal(url) {
      if (url) {
        window.open(url, "_blank", "noopener,noreferrer");
      }
      return true;
    },
    async openConfigFile() {
      return {
        ok: true,
        path: "C:\\Preview\\EverQuest\\launcher-config.yml",
        error: ""
      };
    },
    async openGameDirectory() {
      return {
        ok: true,
        path: currentState.gameDirectory || "C:\\Preview\\EverQuest",
        error: ""
      };
    },
    onEvent(callback) {
      listeners.add(callback);
      return () => listeners.delete(callback);
    }
  };
})();
