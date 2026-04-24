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

  function createState(mode) {
    const base = {
      serverName: "Clumsy's World: Resurgence",
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

  function createUiManagerOverview() {
    return {
      gameDirectory: "C:\\Preview\\EverQuest",
      uiFilesDirectory: "C:\\Preview\\EverQuest\\uifiles",
      canManage: true,
      packages: [
        {
          name: "Clumsy Gold",
          path: "C:\\Preview\\EverQuest\\uifiles\\Clumsy Gold",
          protected: false,
          prepared: true,
          optionCount: 3,
          rootXmlCount: 12
        },
        {
          name: "Clumsy Classic",
          path: "C:\\Preview\\EverQuest\\uifiles\\Clumsy Classic",
          protected: false,
          prepared: false,
          optionCount: 1,
          rootXmlCount: 9
        }
      ],
      targets: [
        {
          path: "C:\\Preview\\EverQuest\\UI_Clumsy_CW.ini",
          fileName: "UI_Clumsy_CW.ini",
          characterName: "Clumsy",
          serverName: "CW",
          uiSkin: "Clumsy Gold"
        },
        {
          path: "C:\\Preview\\EverQuest\\UI_Tester_CW.ini",
          fileName: "UI_Tester_CW.ini",
          characterName: "Tester",
          serverName: "CW",
          uiSkin: "Default"
        }
      ]
    };
  }

  function createUiManagerDetail(packageName = "Clumsy Gold") {
    return {
      name: packageName,
      path: `C:\\Preview\\EverQuest\\uifiles\\${packageName}`,
      protected: false,
      prepared: packageName !== "Clumsy Classic",
      rootFiles: ["EQUI_Inventory.xml", "EQUI_TargetWindow.xml", "window_pieces04.tga"],
      bundles: [
        {
          optionPath: "Options/Default",
          label: "Default",
          categoryPath: "",
          isDefault: true,
          xmlFiles: ["EQUI_Inventory.xml"],
          tgaFiles: [],
          previewImageUrl: "",
          instructions: "Baseline package configuration.",
          activeState: "inactive"
        },
        {
          optionPath: "Options/Art/Dragon",
          label: "Dragon",
          categoryPath: "Art",
          isDefault: false,
          xmlFiles: ["EQUI_TargetWindow.xml"],
          tgaFiles: ["window_pieces04.tga"],
          previewImageUrl: "/src/electron/assets/hero/generated/dragon-cavern-v1.png",
          instructions: "Uses the new launcher visual language for feature previews.",
          activeState: "active"
        },
        {
          optionPath: "Options/Art/Classic",
          label: "Classic",
          categoryPath: "Art",
          isDefault: false,
          xmlFiles: ["EQUI_TargetWindow.xml"],
          tgaFiles: [],
          previewImageUrl: "",
          instructions: "A lower-contrast fallback for comparison.",
          activeState: "inactive"
        }
      ],
      backups: [
        {
          id: "preview-reset-backup",
          packageName,
          reason: "reset",
          createdAt: "2026-04-20T18:00:00.000Z",
          sizeBytes: 10240,
          hasSnapshot: true,
          iniFiles: []
        }
      ],
      backupSummary: {
        backupCount: 1,
        totalSizeBytes: 10240,
        maxBackupCount: 20,
        maxTotalSizeBytes: 536870912
      }
    };
  }

  let currentState = createState(previewMode);
  let uiManagerOverview = createUiManagerOverview();
  let uiManagerDetail = createUiManagerDetail();

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
      return clone(uiManagerOverview);
    },
    async openUiManagerImportDialog() {
      return {
        canceled: true,
        sourcePath: ""
      };
    },
    async importUiPackageFolder() {
      return {
        overview: clone(uiManagerOverview),
        details: clone(uiManagerDetail)
      };
    },
    async prepareUiPackage(packageName) {
      uiManagerDetail = createUiManagerDetail(packageName);
      return {
        details: clone(uiManagerDetail)
      };
    },
    async validateUiPackageOptionComments() {
      return {
        details: clone(uiManagerDetail),
        summary: {
          scannedCount: 3,
          correctedCount: 0
        }
      };
    },
    async checkUiPackageMetadata(packageName) {
      return {
        packageName,
        status: "healthy",
        scannedCount: 3,
        invalidCount: 0,
        healthy: true
      };
    },
    async getUiPackageDetails(packageName) {
      uiManagerDetail = createUiManagerDetail(packageName);
      return clone(uiManagerDetail);
    },
    async activateUiOption() {
      return {
        details: clone(uiManagerDetail)
      };
    },
    async setUiSkinTargets() {
      return {
        targets: clone(uiManagerOverview.targets)
      };
    },
    async resetUiPackage() {
      return {
        details: clone(uiManagerDetail)
      };
    },
    async listUiManagerBackups() {
      return clone(uiManagerDetail.backups);
    },
    async restoreUiManagerBackup() {
      return {
        details: clone(uiManagerDetail),
        targets: clone(uiManagerOverview.targets)
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
