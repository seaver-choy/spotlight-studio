/**
 * AGENTS.md is written into every recording folder so that a coding agent
 * (e.g. Claude Code run by the user in that folder) can edit the video by editing
 * project.json. The editor live-reloads when project.json changes on disk.
 */
export const AGENTS_MD = `# Spotlight Studio recording

This folder is a Spotlight Studio recording. The video is edited **non-destructively**
by editing \`project.json\`. Never modify the media files. Spotlight Studio's editor
reloads automatically when \`project.json\` changes, so edits show up live.

## Files
| File | What it is |
| --- | --- |
| \`screen.mp4\` | Raw screen recording (also carries the microphone audio). |
| \`camera.mp4\` | Raw webcam recording (optional). |
| \`cursor.json\` | Cursor samples \`[timeMs, x, y]\` at 60 Hz, \`clicks\` \`{t, x, y}\`, and keyboard shortcuts \`keys\` \`{t, label}\`. |
| \`project.json\` | **All edits. This is the file to change.** |
| \`recording.json\` | Recording metadata. Read-only. |

## Conventions
- **All times are milliseconds of *source* time** (time in the raw screen.mp4), including
  zooms, layouts and annotations. Clips map source time onto the final timeline, so cutting
  never moves overlays off their content.
- **Positions on the screen recording are normalized 0–1** (x left→right, y top→bottom).
- Keep \`version\` at 1 and keep every \`id\` unique (any short string works, e.g. \`"zoom_intro"\`).
- \`project.json\` is validated when loaded; if it's invalid the editor shows the error and
  keeps the last valid version, so make sure the JSON parses.

## project.json fields
- \`clips\`: \`[{ id, sourceStart, sourceEnd, speed }]\` — played back-to-back in order. To cut
  out a section, split a clip in two around it. \`speed\` 0.25–4 (audio is muted when ≠ 1).
- \`defaultLayout\`: \`"screen" | "pip" | "side-by-side" | "camera"\`.
- \`layouts\`: \`[{ id, start, end, layout }]\` — overrides \`defaultLayout\` for a time range
  (e.g. \`"camera"\` for an intro, \`"side-by-side"\` while talking).
- \`camera\`: PiP style — \`shape\` (\`circle|rounded|square\`), \`size\` (fraction of output
  height), \`x\`/\`y\` (center, 0–1 of the output), \`mirror\`, \`borderWidth\`, \`borderColor\`,
  \`side\` (\`left|right\`) and \`sideRatio\` for side-by-side.
- \`zooms\`: \`[{ id, start, end, scale, mode, x, y, auto }]\` — \`mode: "follow"\` follows the
  cursor smoothly; \`"fixed"\` holds the view centered on \`x\`,\`y\`. \`scale\` 1–6 (2 is a good
  default). Zooms shouldn't overlap. Leave at least ~1.5 s per zoom.
- \`annotations\`: \`[{ id, kind, start, end, x, y, w, h, color, text, fontSize, strokeWidth }]\`
  - \`kind\`: \`"text"\` (callout at x,y), \`"arrow"\` (from x,y to x+w,y+h), \`"rect"\` (outline box),
    \`"highlight"\` (dims everything except the box), \`"blur"\` (redacts the box).
- \`cursorFx\`: \`clickRipple\`, \`glow\`, \`spotlight\` (dim around the cursor), \`keystrokes\`.
- \`background\`: \`type\` (\`gradient|solid|image\`), \`colors\` [a, b], \`angle\`, \`padding\`
  (fraction of output height), \`radius\`, \`shadow\`.
- \`aspect\`: \`"16:9" | "9:16" | "1:1" | "4:3" | "source"\`.

## Useful recipes
- **Find dead air:** gaps with no cursor movement and no clicks in \`cursor.json\` are good
  candidates to cut or speed up (\`speed: 2–4\`).
- **Zoom on an action:** clicks in \`cursor.json\` tell you where and when something
  happened; add a zoom starting ~700 ms before the click and ending ~1.5 s after.
- **Look at a frame:** \`ffmpeg -ss <seconds> -i screen.mp4 -frames:v 1 frame.png\`
  (then delete the image).
`
