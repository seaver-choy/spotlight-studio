# Architecture

## Record raw, compose later

During recording, Spotlight Studio writes separate files and bakes nothing in:

| File | Contents |
| --- | --- |
| `screen.mp4` | Display or window capture at native resolution, plus microphone audio |
| `camera.mp4` | Webcam, if enabled |
| `cursor.json` | Cursor position at 60 Hz, mouse clicks, and keyboard shortcuts (modifier combos only) |
| `recording.json` | Metadata, including the camera's start offset relative to the screen recording |
| `project.json` | Every edit. It's created the first time the recording is opened |
| `AGENTS.md` | Documentation of the format for AI coding agents |

Because the sources stay separate, layouts, zooms and effects can all be changed after recording.

## Time

Everything in `project.json` uses **source time**: milliseconds into `screen.mp4`. `clips` maps source time onto the edited timeline, and `src/shared/timeMap.ts` converts between the two. Overlays (zooms, layout changes, annotations) are stored in source time, so cutting a section never moves them off their content.

## One renderer

`renderFrame(ctx, W, H, scene, inputs, sourceTime)` in `src/renderer/src/compositor` draws an output frame on a 2D canvas:

1. Background (gradient, solid or image)
2. Screen: the layout rect from `layoutAt()`, cropped by the zoom view from `ZoomCamera.viewAt()`, with rounded corners and a shadow
3. Blur and highlight annotations (clipped to the screen)
4. Cursor effects: spotlight, glow and click ripples, mapped through the zoom
5. Arrows, boxes and text callouts
6. The camera, in its layout rect and shape
7. The keyboard shortcut overlay

The editor preview calls it with `<video>` elements as inputs. The exporter calls it with decoded WebCodecs frames. Every input is a pure function of the project and the time, so the export matches the preview frame for frame.

## Zoom camera

`src/shared/zoom.ts`:

- `generateAutoZooms` groups clicks that are close in time and space into segments, adds lead-in and tail time, and merges segments that end up near each other.
- In `follow` mode, a segment pre-computes a camera path at 60 Hz. The target only moves when the cursor leaves a dead-zone in the middle of the view, and the camera chases the target with a critically damped spring. Pre-computing the path keeps seeking exact and deterministic.
- Scale eases in and out with a cubic curve, and the zoom anchors on the focal point while it scales.

## Recording pipeline

- The **control bar** window owns the `MediaRecorder`s. It captures the screen through Electron's `chromeMediaSource: 'desktop'` constraints, adds the mic track to the screen stream, and records the camera as a separate stream.
- Chunks are sent to the main process every second and appended to `screen.raw.*` and `camera.raw.*`.
- The main process tracks the cursor using the same wall clock as the screen recorder's start event, and leaves paused time out of it.
- The control bar, camera bubble and countdown use `setContentProtection(true)`, which keeps them out of the capture.
- The first time a recording opens, the editor remuxes the raw MediaRecorder output (which has no seek index) into a normal MP4 with mediabunny. There's no re-encode.

## Local media

The renderer reads local files through a custom `ss-media://` protocol that supports HTTP range requests, so `<video>` can seek and mediabunny can read lazily. It only serves files from the recordings folder and from recordings you've opened.

## Live reload for external edits

The main process watches `project.json`. If the file changes and it wasn't the editor's own autosave, the editor validates the new contents and loads them as an undoable step. This is what makes "Edit with AI" work.
