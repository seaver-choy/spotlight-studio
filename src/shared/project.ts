/**
 * The Spotlight Studio project format.
 *
 * A recording folder contains the raw media (screen.mp4, camera.mp4), cursor.json and
 * project.json. project.json holds every edit. Nothing is ever baked into the media,
 * so all edits are reversible and can also be made by hand or by an AI agent
 * (see AGENTS.md, written into every recording folder).
 *
 * TIME CONVENTION: every time stored in a project is in **source milliseconds**, i.e.
 * milliseconds since the start of screen.mp4. Clips map source time onto the edited
 * timeline. Overlays (zooms, layouts, annotations) are stored in source time so they
 * stay attached to the content when you cut or speed up sections.
 *
 * POSITION CONVENTION: positions on the screen recording are normalized 0..1
 * (x: left→right, y: top→bottom) relative to the full screen recording frame.
 */
import { z } from 'zod'

export const PROJECT_VERSION = 1

const id = z.string().min(1)
const ms = z.number().min(0)
const unit = z.number().min(0).max(1)
const color = z.string()

export const ClipSchema = z.object({
  id,
  sourceStart: ms,
  sourceEnd: ms,
  /** Playback speed multiplier (0.25–4). Audio is muted in clips whose speed is not 1. */
  speed: z.number().min(0.25).max(4).default(1)
})
export type Clip = z.infer<typeof ClipSchema>

export const LayoutPresetSchema = z.enum(['screen', 'pip', 'side-by-side', 'camera'])
export type LayoutPreset = z.infer<typeof LayoutPresetSchema>

export const LayoutSegmentSchema = z.object({
  id,
  start: ms,
  end: ms,
  layout: LayoutPresetSchema
})
export type LayoutSegment = z.infer<typeof LayoutSegmentSchema>

export const ZoomSegmentSchema = z.object({
  id,
  start: ms,
  end: ms,
  /** Magnification, e.g. 2 = 200%. */
  scale: z.number().min(1).max(6).default(2),
  /** 'follow' tracks the cursor smoothly; 'fixed' holds the view on (x, y). */
  mode: z.enum(['follow', 'fixed']).default('follow'),
  x: unit.default(0.5),
  y: unit.default(0.5),
  /** True if created by the auto-zoom generator (regenerating replaces only these). */
  auto: z.boolean().default(false)
})
export type ZoomSegment = z.infer<typeof ZoomSegmentSchema>

export const AnnotationKindSchema = z.enum(['text', 'arrow', 'rect', 'highlight', 'blur'])
export type AnnotationKind = z.infer<typeof AnnotationKindSchema>

export const AnnotationSchema = z.object({
  id,
  kind: AnnotationKindSchema,
  start: ms,
  end: ms,
  /** Top-left corner (rect/highlight/blur/text) or arrow tail. Normalized screen coordinates. */
  x: unit,
  y: unit,
  /** Width/height for boxes; for arrows (x+w, y+h) is the arrow head. May be negative for arrows. */
  w: z.number().min(-1).max(1),
  h: z.number().min(-1).max(1),
  color: color.default('#FF3B5C'),
  text: z.string().default(''),
  /** Font size in px at 1080p output. */
  fontSize: z.number().min(8).max(200).default(42),
  strokeWidth: z.number().min(1).max(40).default(6)
})
export type Annotation = z.infer<typeof AnnotationSchema>

export const CameraStyleSchema = z.object({
  shape: z.enum(['circle', 'rounded', 'square']).default('circle'),
  /** PiP camera size as a fraction of output height. */
  size: z.number().min(0.08).max(0.6).default(0.28),
  /** PiP camera center, normalized to the output canvas. */
  x: unit.default(0.86),
  y: unit.default(0.78),
  mirror: z.boolean().default(true),
  borderWidth: z.number().min(0).max(20).default(4),
  borderColor: color.default('#FFFFFF'),
  /** Side-by-side: which side the camera sits on and the share of width it gets. */
  side: z.enum(['left', 'right']).default('right'),
  sideRatio: z.number().min(0.2).max(0.6).default(0.32)
})
export type CameraStyle = z.infer<typeof CameraStyleSchema>

export const BackgroundSchema = z.object({
  type: z.enum(['gradient', 'solid', 'image']).default('gradient'),
  colors: z.tuple([color, color]).default(['#5B5BF7', '#C847E8']),
  angle: z.number().default(135),
  /** File name inside the project folder when type === 'image'. */
  image: z.string().nullable().default(null),
  /** Padding around the screen as a fraction of output height. */
  padding: z.number().min(0).max(0.3).default(0.06),
  /** Corner radius in px at 1080p output. */
  radius: z.number().min(0).max(80).default(16),
  /** Shadow strength 0..1. */
  shadow: z.number().min(0).max(1).default(0.5)
})
export type Background = z.infer<typeof BackgroundSchema>

export const CursorFxSchema = z.object({
  clickRipple: z.boolean().default(true),
  rippleColor: color.default('#FFD60A'),
  glow: z.boolean().default(false),
  glowColor: color.default('#FFD60A'),
  spotlight: z.boolean().default(false),
  /** Spotlight dim strength 0..1. */
  spotlightDim: z.number().min(0).max(1).default(0.55),
  /** Spotlight radius as a fraction of screen-recording width. */
  spotlightRadius: z.number().min(0.03).max(0.5).default(0.12),
  /** Show keyboard shortcuts (modifier combos only) as an on-screen overlay. */
  keystrokes: z.boolean().default(true)
})
export type CursorFx = z.infer<typeof CursorFxSchema>

export const AspectSchema = z.enum(['16:9', '9:16', '1:1', '4:3', 'source'])
export type Aspect = z.infer<typeof AspectSchema>

export const SourcesSchema = z.object({
  screen: z.object({
    file: z.string(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    durationMs: ms,
    hasAudio: z.boolean().default(false)
  }),
  camera: z
    .object({
      file: z.string(),
      width: z.number().int().positive(),
      height: z.number().int().positive(),
      /** camera time = source time - offsetMs */
      offsetMs: z.number().default(0)
    })
    .nullable()
    .default(null),
  /** cursor.json, or null if cursor data is unavailable (e.g. window capture). */
  cursor: z.string().nullable().default(null)
})
export type Sources = z.infer<typeof SourcesSchema>

export const ProjectSchema = z.object({
  version: z.literal(PROJECT_VERSION),
  name: z.string().default('Untitled recording'),
  createdAt: z.string(),
  sources: SourcesSchema,
  aspect: AspectSchema.default('16:9'),
  clips: z.array(ClipSchema).min(1),
  defaultLayout: LayoutPresetSchema.default('pip'),
  layouts: z.array(LayoutSegmentSchema).default([]),
  camera: CameraStyleSchema.prefault({}),
  background: BackgroundSchema.prefault({}),
  cursorFx: CursorFxSchema.prefault({}),
  zooms: z.array(ZoomSegmentSchema).default([]),
  annotations: z.array(AnnotationSchema).default([])
})
export type Project = z.infer<typeof ProjectSchema>

/** Cursor data recorded alongside the screen. */
export const CursorDataSchema = z.object({
  version: z.literal(1),
  /** Samples: [timeMs, x, y] with x/y normalized to the screen recording. */
  samples: z.array(z.tuple([z.number(), z.number(), z.number()])),
  /** Mouse button presses. */
  clicks: z.array(z.object({ t: z.number(), x: z.number(), y: z.number(), button: z.number().default(1) })),
  /** Keyboard shortcuts (only combos that include ⌘, ⌃ or ⌥ — never plain typing). */
  keys: z.array(z.object({ t: z.number(), label: z.string() }))
})
export type CursorData = z.infer<typeof CursorDataSchema>

export function parseProject(json: unknown): Project {
  return ProjectSchema.parse(json)
}

export function newId(prefix = 'id'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`
}

/** Output canvas size for an aspect ratio at a given output height. */
export function outputSize(
  project: Pick<Project, 'aspect' | 'sources'>,
  height: number
): { width: number; height: number } {
  const even = (n: number): number => Math.max(2, Math.round(n / 2) * 2)
  let ratio: number
  switch (project.aspect) {
    case '16:9':
      ratio = 16 / 9
      break
    case '9:16':
      ratio = 9 / 16
      break
    case '1:1':
      ratio = 1
      break
    case '4:3':
      ratio = 4 / 3
      break
    default:
      ratio = project.sources.screen.width / project.sources.screen.height
  }
  // For portrait outputs, `height` refers to the short edge to keep 1080p meaning "1080 wide".
  if (ratio < 1) return { width: even(height), height: even(height / ratio) }
  return { width: even(height * ratio), height: even(height) }
}
