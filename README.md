# EQEmu Launcher
<img width="1460" height="940" alt="image" src="https://github.com/user-attachments/assets/372d1447-448b-4887-a9f2-89de7ce52e89" />


Electron-based EQEmu patcher and launcher with backward compatibility for servers already using the original EQEmu patcher manifest format. This app is built upon the work of https://github.com/xackery in the original EQEmu Patcher.

## What This Fork Is

This fork replaces the old desktop client with a lightweight Electron launcher while preserving the original patching model:

* detect `eqgame.exe` from a selected EverQuest directory
* identify the client by executable hash
* fetch `filelist_<client>.yml`
* compare local files by MD5
* delete stale files and download patch files
* persist `eqemupatcher.yml` in the game directory
* launch `eqgame.exe patchme` on Windows

The main client application in this fork is the Electron app under [src/electron](src/electron).

## Compatibility

The launcher is intended to remain backward compatible with existing patch servers that were built for the original EQEmu patcher.

The preserved server-side contract is:

* manifests are published as `filelist_<suffix>.yml`
* patch files are hosted under the existing `downloadprefix`
* `delete.txt`-driven delete entries from `filelistbuilder` are still honored
* client patch state is still persisted in `eqemupatcher.yml`

## Configuration

Runtime defaults for the Electron launcher live in [launcher-config.yml](launcher-config.yml).

Current fields:

```yaml
serverName: Clumsy's World
filelistUrl: https://patch.clumsysworld.com/
patchNotesUrl: https://patch.clumsysworld.com/patch-notes.md
launcherReleaseApiUrl: https://api.github.com/repos/your-org/your-patcher/releases/latest
loginServerHost: login.eqemulator.net
loginServerPort: 5999
tagline: An EverQuest Emulated Server
primaryImage: assets/branding/hero.png
wordmarkImage: assets/branding/wordmark.png
wordmarkImageAlt: Your Server Name
wordmarkRemoveLightBackground: false
emblemText: YS
websiteUrl: https://www.example.com
websiteLabel: www.example.com
discordUrl: https://discord.gg/example
tools:
  - label: Wiki
    url: https://wiki.example.com/
defaultAutoPatch: false
defaultAutoPlay: false
supportedClients:
  - Rain_Of_Fear_2
  - Rain_Of_Fear_2_4GB
```

Update this file before packaging if you are shipping a launcher for a different server. The launcher has a built-in game-server status target; set optional `gameServerHost` and `gameServerPort` fields only when you need to override it. `gameServerHost` may be a bare host or a URL. The launcher reads `eqhost.txt` from the selected game directory for the login-server status indicator, and falls back to `loginServerHost`/`loginServerPort` when `eqhost.txt` is unavailable. Branding image paths can be `https://` URLs, `file://` URLs, absolute local paths, or paths relative to the active `launcher-config.yml`. If `primaryImage` is not set, the launcher still supports the legacy `eqemupatcher.png` splash image in the player's game directory.

## Local Development

Requirements:

* Node.js and npm

Run locally:

```bash
npm install
npm test
npm start
```

Useful scripts:

```bash
npm run check
npm test
npm run dist:dir
npm run dist:win
npm run dist:win:installer
npm run start:filelistbuilder
npm run dist:filelistbuilder:win
```

Notes:

* the UI is cross-platform, but actual `eqgame.exe` launch remains Windows-only
* the launcher stores the last selected EQ directory in Electron app data
* `eqemupatcher.yml` is still written into the selected EverQuest directory for compatibility with the original patcher behavior

## Packaging

The preferred distributable for this fork is a portable Windows executable.

Build the portable Windows launcher:

```bash
npm install
npm test
npm run dist:win
```

### Manual GitHub Release Workflow

The repository includes a manual GitHub Actions workflow named `Manual Release`.

To publish a release from GitHub:

1. Open the repository's `Actions` tab.
2. Select `Manual Release`.
3. Click `Run workflow`.
4. Enter a semantic version such as `3.2.1`.

The workflow updates `package.json` and `package-lock.json`, runs checks and tests, builds the x64 portable Windows patcher, commits the version bump, tags it as `V<version>`, and creates a GitHub release containing `CWPatcher-v<version>-win-x64.exe`.

Fallback installer build:

```bash
npm install
npm test
npm run dist:win:installer
```

Notes:

* `npm run dist:win` targets Electron Builder's `portable` output
* Windows portable builds include separate `x64` and `ia32` folders, each containing `CWPatcher.exe`
* building the Windows portable executable is best done on Windows
* packaged output is written under `dist/electron/x64/` and `dist/electron/ia32/`
* the package includes the launcher config and built-in hero art used by the Electron app
* custom branding assets referenced by relative paths should be shipped beside the active `launcher-config.yml`

Build the portable Windows file list builder:

```bash
npm install
npm test
npm run dist:filelistbuilder:win
```

Notes:

* the builder packages as its own portable executable under `dist/filelistbuilder-electron/`
* the builder reuses the Electron design language from the launcher, but writes the legacy `filelistbuilder` outputs
* generated artifacts remain `filelist_<client>.yml` and `patch.zip`

## Player Usage

Distribute the packaged Electron launcher to players after you have configured `launcher-config.yml` and built the app.

Players do not need Node.js or Electron installed separately.

On first run they:

1. choose their EverQuest directory
2. let the launcher detect the client and compare files
3. patch if needed
4. launch the game on Windows

If the EverQuest directory is inside `Program Files`, patching or launch behavior may require elevated permissions depending on the system.

## Server Setup

This repository still includes the original Go `filelistbuilder` source under [filelistbuilder](filelistbuilder).

This fork now also includes an Electron-based File List Builder app that preserves the legacy output contract while providing a GUI for editing `filelistbuilder.yml`, `ignore.txt`, and `delete.txt`.

Build it with Go:

```bash
go build -o filelistbuilder/filelistbuilder ./filelistbuilder
```

The builder is configured by [filelistbuilder.yml](filelistbuilder.yml):

```yaml
client: rof
downloadprefix: https://example.com/patch/rof/
```

Typical server workflow:

1. create a working directory for a client build such as `rof/`
2. copy `filelistbuilder` and `filelistbuilder.yml` into that directory
3. copy the files you want to patch into that same directory
4. update `downloadprefix` so it matches the final hosted patch URL
5. optionally add `delete.txt` listing files to remove on the client
6. optionally add `ignore.txt` listing files the builder should skip
7. run `filelistbuilder`

Outputs:

* `filelist_<client>.yml`
* `patch.zip`

Host the generated files so the manifest is reachable at the expected URL, for example:

```text
https://example.com/patch/rof/filelist_rof.yml
```

## Custom Splash Art

Servers can configure the primary launcher artwork with `primaryImage` in `launcher-config.yml`. Servers can still provide a legacy custom splash image by placing `eqemupatcher.png` in the player's game directory; the Electron launcher will prefer that file over its built-in hero art when `primaryImage` is not configured.

## Validation In This Fork

The Electron backend is covered by automated tests in [test/electron-backend.test.js](test/electron-backend.test.js), including compatibility coverage for legacy `filelistbuilder` manifest output.
