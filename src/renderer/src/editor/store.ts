import { create } from 'zustand'
import {
  newId,
  parseProject,
  type Annotation,
  type AnnotationKind,
  type CursorData,
  type LayoutPreset,
  type Project
} from '@shared/project'
import { splitAt, timelineDuration, timelineToSource } from '@shared/timeMap'
import { generateAutoZooms } from '@shared/zoom'

export type SelectionKind = 'clip' | 'zoom' | 'layout' | 'annotation'
export interface Selection {
  kind: SelectionKind
  id: string
}

interface EditorState {
  folder: string
  project: Project | null
  cursor: CursorData | null
  past: Project[]
  future: Project[]
  lastCoalesce: { key: string; at: number } | null
  selection: Selection | null
  /** Timeline time in ms. */
  playhead: number
  playing: boolean
  notice: string | null
  /** The project object last loaded from disk (autosave skips it to avoid rewriting external edits). */
  fromDisk: Project | null

  load(folder: string, project: Project, cursor: CursorData | null): void
  /** Apply a change. Changes with the same `coalesce` key within 1s share one undo step. */
  update(fn: (p: Project) => void, coalesce?: string): void
  replaceFromDisk(text: string): void
  undo(): void
  redo(): void
  select(sel: Selection | null): void
  seek(t: number): void
  setPlaying(v: boolean): void
  setNotice(n: string | null): void

  splitAtPlayhead(): void
  deleteSelection(): void
  addZoom(): void
  addLayout(layout: LayoutPreset): void
  addAnnotation(kind: AnnotationKind): void
  regenerateAutoZooms(): void
}

const HISTORY_LIMIT = 200

export const useEditor = create<EditorState>((set, get) => ({
  folder: '',
  project: null,
  cursor: null,
  past: [],
  future: [],
  lastCoalesce: null,
  selection: null,
  playhead: 0,
  playing: false,
  notice: null,
  fromDisk: null,

  load: (folder, project, cursor) =>
    set({ folder, project, cursor, past: [], future: [], selection: null, playhead: 0, fromDisk: project }),

  update: (fn, coalesce) => {
    const { project, past, lastCoalesce } = get()
    if (!project) return
    const next = structuredClone(project)
    fn(next)
    const now = Date.now()
    const merge = coalesce && lastCoalesce && lastCoalesce.key === coalesce && now - lastCoalesce.at < 1000
    set({
      project: next,
      past: merge ? past : [...past, project].slice(-HISTORY_LIMIT),
      future: [],
      lastCoalesce: coalesce ? { key: coalesce, at: now } : null
    })
    // Keep the playhead in range after edits that shorten the timeline.
    const dur = timelineDuration(next.clips)
    if (get().playhead > dur) set({ playhead: dur })
  },

  replaceFromDisk: (text) => {
    const { project, past } = get()
    try {
      const next = parseProject(JSON.parse(text))
      set({
        project: next,
        past: project ? [...past, project].slice(-HISTORY_LIMIT) : past,
        future: [],
        lastCoalesce: null,
        fromDisk: next,
        notice: 'Reloaded project.json (changed outside the app) — ⌘Z to undo'
      })
    } catch (e) {
      set({
        notice: `project.json on disk is invalid and was ignored: ${(e as Error).message.slice(0, 300)}`
      })
    }
  },

  undo: () => {
    const { past, project, future } = get()
    if (!past.length || !project) return
    set({
      project: past[past.length - 1],
      past: past.slice(0, -1),
      future: [project, ...future],
      lastCoalesce: null
    })
  },
  redo: () => {
    const { past, project, future } = get()
    if (!future.length || !project) return
    set({ project: future[0], future: future.slice(1), past: [...past, project], lastCoalesce: null })
  },

  select: (selection) => set({ selection }),
  seek: (t) => {
    const p = get().project
    const dur = p ? timelineDuration(p.clips) : 0
    set({ playhead: Math.max(0, Math.min(dur, t)) })
  },
  setPlaying: (playing) => set({ playing }),
  setNotice: (notice) => set({ notice }),

  splitAtPlayhead: () => {
    const t = get().playhead
    get().update((p) => {
      p.clips = splitAt(p.clips, t, () => newId('clip'))
    })
  },

  deleteSelection: () => {
    const sel = get().selection
    if (!sel) return
    get().update((p) => {
      if (sel.kind === 'clip') {
        if (p.clips.length > 1) p.clips = p.clips.filter((c) => c.id !== sel.id)
      } else if (sel.kind === 'zoom') p.zooms = p.zooms.filter((z) => z.id !== sel.id)
      else if (sel.kind === 'layout') p.layouts = p.layouts.filter((l) => l.id !== sel.id)
      else p.annotations = p.annotations.filter((a) => a.id !== sel.id)
    })
    set({ selection: null })
  },

  addZoom: () => {
    const { project, playhead, cursor } = get()
    if (!project) return
    const s = timelineToSource(project.clips, playhead).source
    const dur = project.sources.screen.durationMs
    const start = Math.max(0, Math.min(s, dur - 1000))
    const end = Math.min(dur, start + 3000)
    // Don't overlap existing zooms: trim the new one to the free gap.
    const next = project.zooms.filter((z) => z.start > start).sort((a, b) => a.start - b.start)[0]
    const id = newId('zoom')
    const p0 = cursor?.samples.find((x) => x[0] >= start)
    get().update((p) => {
      p.zooms.push({
        id,
        start,
        end: next ? Math.min(end, next.start - 50) : end,
        scale: 2,
        mode: cursor ? 'follow' : 'fixed',
        x: p0?.[1] ?? 0.5,
        y: p0?.[2] ?? 0.5,
        auto: false
      })
      p.zooms = p.zooms.filter((z) => z.end - z.start >= 300 || z.id !== id)
    })
    set({ selection: { kind: 'zoom', id } })
  },

  addLayout: (layout) => {
    const { project, playhead } = get()
    if (!project) return
    const s = timelineToSource(project.clips, playhead).source
    const id = newId('layout')
    get().update((p) => {
      p.layouts.push({ id, start: s, end: Math.min(p.sources.screen.durationMs, s + 4000), layout })
    })
    set({ selection: { kind: 'layout', id } })
  },

  addAnnotation: (kind) => {
    const { project, playhead } = get()
    if (!project) return
    const s = timelineToSource(project.clips, playhead).source
    const id = newId('note')
    const base: Annotation = {
      id,
      kind,
      start: s,
      end: Math.min(project.sources.screen.durationMs, s + 3000),
      x: 0.35,
      y: 0.35,
      w: 0.3,
      h: 0.2,
      color: kind === 'highlight' ? '#FFD60A' : '#FF3B5C',
      text: kind === 'text' ? 'Click here' : '',
      fontSize: 42,
      strokeWidth: 6
    }
    if (kind === 'arrow') Object.assign(base, { x: 0.3, y: 0.3, w: 0.15, h: 0.12 })
    if (kind === 'text') Object.assign(base, { x: 0.4, y: 0.4, w: 0, h: 0 })
    get().update((p) => {
      p.annotations.push(base)
    })
    set({ selection: { kind: 'annotation', id } })
  },

  regenerateAutoZooms: () => {
    const { cursor } = get()
    get().update((p) => {
      const manual = p.zooms.filter((z) => !z.auto)
      const auto = generateAutoZooms(cursor, p.sources.screen.durationMs, () => newId('zoom')).filter(
        (a) => !manual.some((m) => a.start < m.end && a.end > m.start)
      )
      p.zooms = [...manual, ...auto].sort((a, b) => a.start - b.start)
    })
  }
}))
