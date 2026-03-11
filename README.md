# EQEmu Launcher

Electron-based EQEmu patcher and launcher with backward compatibility for servers already using the original EQEmu patcher manifest format.

## What This Fork Is

This fork replaces the old desktop client with a lightweight Electron launcher while preserving the original patching model:

* detect `eqgame.exe` from a selected EverQuest directory
* identify the client by executable hash
* fetch `filelist_<client>.yml`
* compare local files by MD5
* delete stale files and download patch files
* persist `eqemupatcher.yml` in the game directory
* launch `eqgame.exe patchme` on Windows

The main client application in this fork is the Electron app under [src/electron](/Users/robg/Documents/GitHub/eqemupatcher/src/electron).

## Compatibility

The launcher is intended to remain backward compatible with existing patch servers that were built for the original EQEmu patcher.

The preserved server-side contract is:

* manifests are published as `filelist_<suffix>.yml`
* patch files are hosted under the existing `downloadprefix`
* `delete.txt`-driven delete entries from `filelistbuilder` are still honored
* client patch state is still persisted in `eqemupatcher.yml`

## Configuration

Runtime defaults for the Electron launcher live in [launcher-config.yml](/Users/robg/Documents/GitHub/eqemupatcher/launcher-config.yml).

Current fields:

```yaml
serverName: Clumsy's World
filelistUrl: https://patch.clumsysworld.com/
defaultAutoPatch: false
defaultAutoPlay: false
supportedClients:
  - Rain_Of_Fear
  - Rain_Of_Fear_2
```

Update this file before packaging if you are shipping a launcher for a different server.

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

Fallback installer build:

```bash
npm install
npm test
npm run dist:win:installer
```

Notes:

* `npm run dist:win` targets Electron Builder's `portable` output
* building the Windows portable executable is best done on Windows
* packaged output is written under `dist/electron/`
* the package includes the launcher config and built-in hero art used by the Electron app

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

This repository still includes the original Go `filelistbuilder` source under [filelistbuilder](/Users/robg/Documents/GitHub/eqemupatcher/filelistbuilder).

Build it with Go:

```bash
go build -o filelistbuilder/filelistbuilder ./filelistbuilder
```

The builder is configured by [filelistbuilder.yml](/Users/robg/Documents/GitHub/eqemupatcher/filelistbuilder.yml):

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

Servers can still provide a custom splash image by placing `eqemupatcher.png` in the player's game directory. The Electron launcher will prefer that file over its built-in hero art when present.

## Validation In This Fork

The Electron backend is covered by automated tests in [test/electron-backend.test.js](/Users/robg/Documents/GitHub/eqemupatcher/test/electron-backend.test.js), including compatibility coverage for legacy `filelistbuilder` manifest output.


