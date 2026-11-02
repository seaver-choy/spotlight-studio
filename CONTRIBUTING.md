# Contributing to Spotlight Studio

Thanks for helping out! Bug reports, ideas and pull requests are all welcome.

## Getting started

```sh
pnpm install
pnpm dev
```

`pnpm dev` starts Electron with hot reload for the UI. Changes to `src/main` restart the app.

### macOS permissions during development

In development, macOS attributes the Screen Recording, Camera, Microphone and Accessibility permissions to the **app you launched from**: your terminal (Terminal, iTerm, VS Code…) or `Electron.app`. If recording shows a black screen or no sources, give that app Screen Recording permission in **System Settings → Privacy & Security** and restart it.

You don't need permissions to work on the editor. `node scripts/make-fixture.mjs` generates a synthetic recording (needs ffmpeg), and then:

```sh
pnpm build && SPOTLIGHT_OPEN_FOLDER="$PWD/tests/fixtures/generated/demo" pnpm start
```

## Project layout

| Path | What's there |
| --- | --- |
| `src/main` | Electron main process: windows, capture sources, the recording session, cursor tracking, the local media protocol |
| `src/preload` | The typed bridge (`window.api`) between the UI and the main process |
| `src/renderer/src/home` | The home screen: source picker, devices, recent recordings |
| `src/renderer/src/recorder` | Control bar (it does the recording), camera bubble, countdown |
| `src/renderer/src/editor` | Editor UI: preview, timeline, inspector, export dialog |
| `src/renderer/src/compositor` | `renderFrame()`, which draws a frame for both the preview and the export |
| `src/renderer/src/export` | WebCodecs export pipeline |
| `src/shared` | Project schema (zod) and pure logic: time mapping, zoom camera, layout geometry |

The [architecture notes](docs/architecture.md) explain the main design decisions.

## Before opening a PR

```sh
pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e
```

- Keep logic that can be pure in `src/shared` and add unit tests for it.
- If you change the project format, update `src/shared/project.ts` **and** the `AGENTS.md` template in `src/main/agentsDoc.ts`, and keep old projects loading (add defaults instead of making fields required).
- UI changes: please include a screenshot or a short clip in the PR. Recorded with Spotlight Studio, ideally 🙂

## Reporting bugs

Please include your macOS version, your Mac model (Apple Silicon or Intel), what you recorded (display or window, camera on or off), and steps to reproduce. If a recording won't open, the files in its folder (`recording.json`, `project.json`) help a lot. Leave out the media files if they're private.
