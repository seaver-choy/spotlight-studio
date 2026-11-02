import { useEffect, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from 'react'
import { Layout, Scissors, Type, ZoomIn } from 'lucide-react'
import type { Project } from '@shared/project'
import {
  clipStarts,
  clipTimelineDuration,
  sourceToTimelineClamped,
  timelineDuration,
  timelineToSource
} from '@shared/timeMap'
import { cx, formatTime } from '../components/ui'
import { useEditor, type SelectionKind } from './store'

const TRACK_H = 34
const LABEL_W = 92

const LAYOUT_LABEL: Record<string, string> = {
  screen: 'Screen',
  pip: 'Picture-in-picture',
  'side-by-side': 'Side by side',
  camera: 'Camera'
}
const NOTE_LABEL: Record<string, string> = {
  text: 'Text',
  arrow: 'Arrow',
  rect: 'Box',
  highlight: 'Highlight',
  blur: 'Blur'
}

interface Drag {
  kind: SelectionKind
  id: string
  mode: 'move' | 'start' | 'end'
  x0: number
  orig: { start: number; end: number }
  origTimeline: { start: number; end: number }
}

function useWidth(ref: React.RefObject<HTMLDivElement | null>): number {
  const [w, setW] = useState(800)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setW(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return w
}

/** Assign overlapping items to lanes. */
function lanes<T extends { start: number; end: number }>(items: T[]): Array<T & { lane: number }> {
  const ends: number[] = []
  return [...items]
    .sort((a, b) => a.start - b.start)
    .map((it) => {
      let lane = ends.findIndex((e) => e <= it.start)
      if (lane < 0) lane = ends.length
      ends[lane] = it.end
      return { ...it, lane }
    })
}

function Playhead({ pxPerMs }: { pxPerMs: number }): ReactNode {
  const playhead = useEditor((s) => s.playhead)
  return (
    <div
      className="pointer-events-none absolute bottom-0 top-0 z-20 w-px bg-rec"
      style={{ left: playhead * pxPerMs }}
    >
      <div className="absolute -left-1.5 -top-0.5 h-3 w-3 rotate-45 rounded-sm bg-rec" />
    </div>
  )
}

export function Timeline({ zoomLevel }: { zoomLevel: number }): ReactNode {
  const project = useEditor((s) => s.project) as Project
  const selection = useEditor((s) => s.selection)
  const scroller = useRef<HTMLDivElement>(null)
  const width = useWidth(scroller)
  const drag = useRef<Drag | null>(null)

  const duration = Math.max(1, timelineDuration(project.clips))
  const fitPx = (width - 24) / duration
  const pxPerMs = fitPx * zoomLevel
  const totalW = Math.max(width - 24, duration * pxPerMs)
  const starts = clipStarts(project.clips)

  const tToSource = (t: number): number => timelineToSource(project.clips, t).source
  const sToT = (s: number): number => sourceToTimelineClamped(project.clips, s)

  const seekFromEvent = (e: RPointerEvent): void => {
    const rect = scroller.current!.getBoundingClientRect()
    const x = e.clientX - rect.left + scroller.current!.scrollLeft
    useEditor.getState().seek(x / pxPerMs)
  }

  const startDrag = (
    e: RPointerEvent,
    kind: SelectionKind,
    id: string,
    mode: Drag['mode'],
    orig: { start: number; end: number }
  ): void => {
    e.stopPropagation()
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    useEditor.getState().select({ kind, id })
    drag.current = {
      kind,
      id,
      mode,
      x0: e.clientX,
      orig,
      origTimeline: kind === 'clip' ? orig : { start: sToT(orig.start), end: sToT(orig.end) }
    }
  }

  const onMove = (e: RPointerEvent): void => {
    const d = drag.current
    if (!d) return
    const dt = (e.clientX - d.x0) / pxPerMs
    const { update } = useEditor.getState()
    const srcDur = project.sources.screen.durationMs
    const key = `tl-${d.id}-${d.mode}`
    if (d.kind === 'clip') {
      update((p) => {
        const c = p.clips.find((x) => x.id === d.id)
        if (!c) return
        // Trimming: dt is timeline ms; convert to source ms with the clip's speed.
        if (d.mode === 'start')
          c.sourceStart = Math.max(0, Math.min(d.orig.end - 100, d.orig.start + dt * c.speed))
        if (d.mode === 'end')
          c.sourceEnd = Math.min(srcDur, Math.max(d.orig.start + 100, d.orig.end + dt * c.speed))
      }, key)
      return
    }
    update((p) => {
      const list = (d.kind === 'zoom' ? p.zooms : d.kind === 'layout' ? p.layouts : p.annotations) as Array<{
        id: string
        start: number
        end: number
      }>
      const it = list.find((x) => x.id === d.id)
      if (!it) return
      const len = d.orig.end - d.orig.start
      if (d.mode === 'move') {
        const s = tToSource(Math.max(0, d.origTimeline.start + dt))
        it.start = Math.max(0, Math.min(srcDur - len, s))
        it.end = it.start + len
      } else if (d.mode === 'start') {
        it.start = Math.max(0, Math.min(it.end - 200, tToSource(Math.max(0, d.origTimeline.start + dt))))
      } else {
        it.end = Math.min(srcDur, Math.max(it.start + 200, tToSource(Math.max(0, d.origTimeline.end + dt))))
      }
    }, key)
  }

  const endDrag = (): void => {
    drag.current = null
  }

  const item = (
    kind: SelectionKind,
    id: string,
    left: number,
    w: number,
    top: number,
    color: string,
    label: ReactNode,
    orig: { start: number; end: number },
    title?: string
  ): ReactNode => {
    const sel = selection?.kind === kind && selection.id === id
    return (
      <div
        key={id}
        title={title}
        className={cx(
          'group absolute flex items-center overflow-hidden rounded-md border text-[11px] font-medium text-white',
          color,
          sel ? 'z-10 border-white ring-1 ring-white' : 'border-black/20'
        )}
        style={{ left, width: Math.max(6, w), top: top + 3, height: TRACK_H - 6 }}
        onPointerDown={(e) => startDrag(e, kind, id, 'move', orig)}
        onPointerMove={onMove}
        onPointerUp={endDrag}
      >
        <div
          className="absolute bottom-0 left-0 top-0 w-2 cursor-ew-resize bg-white/0 group-hover:bg-white/30"
          onPointerDown={(e) => startDrag(e, kind, id, 'start', orig)}
          onPointerMove={onMove}
          onPointerUp={endDrag}
        />
        <span className="pointer-events-none truncate px-2.5">{label}</span>
        <div
          className="absolute bottom-0 right-0 top-0 w-2 cursor-ew-resize bg-white/0 group-hover:bg-white/30"
          onPointerDown={(e) => startDrag(e, kind, id, 'end', orig)}
          onPointerMove={onMove}
          onPointerUp={endDrag}
        />
      </div>
    )
  }

  const visible = <T extends { start: number; end: number }>(
    list: T[]
  ): Array<T & { t0: number; t1: number }> =>
    list.map((x) => ({ ...x, t0: sToT(x.start), t1: sToT(x.end) })).filter((x) => x.t1 - x.t0 > 1)

  const noteLanes = lanes(visible(project.annotations).map((a) => ({ ...a, start: a.t0, end: a.t1 })))
  const laneCount = Math.max(1, ...noteLanes.map((n) => n.lane + 1))

  // Ruler ticks.
  const tickEvery =
    [500, 1000, 2000, 5000, 10000, 15000, 30000, 60000].find((s) => s * pxPerMs >= 70) ?? 120000
  const ticks: number[] = []
  for (let t = 0; t <= duration; t += tickEvery) ticks.push(t)

  const rows: Array<{ key: string; label: ReactNode; height: number }> = [
    {
      key: 'clips',
      label: (
        <>
          <Scissors size={12} /> Clips
        </>
      ),
      height: TRACK_H
    },
    {
      key: 'zoom',
      label: (
        <>
          <ZoomIn size={12} /> Zoom
        </>
      ),
      height: TRACK_H
    },
    {
      key: 'layout',
      label: (
        <>
          <Layout size={12} /> Layout
        </>
      ),
      height: TRACK_H
    },
    {
      key: 'notes',
      label: (
        <>
          <Type size={12} /> Highlights
        </>
      ),
      height: TRACK_H * laneCount
    }
  ]
  let y = 22
  const rowTop: Record<string, number> = {}
  for (const r of rows) {
    rowTop[r.key] = y
    y += r.height
  }

  return (
    <div className="flex min-h-0 border-t border-ink-800 bg-ink-900">
      <div className="shrink-0 border-r border-ink-800 pt-[22px]" style={{ width: LABEL_W }}>
        {rows.map((r) => (
          <div
            key={r.key}
            className="flex items-start gap-1.5 px-3 pt-2.5 text-[11px] font-medium text-ink-300"
            style={{ height: r.height }}
          >
            {r.label}
          </div>
        ))}
      </div>
      <div
        ref={scroller}
        className="relative min-w-0 flex-1 overflow-x-auto overflow-y-hidden"
        onPointerDown={(e) => {
          useEditor.getState().select(null)
          seekFromEvent(e)
          ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
          drag.current = null
          const move = (ev: PointerEvent): void => {
            const rect = scroller.current!.getBoundingClientRect()
            useEditor.getState().seek((ev.clientX - rect.left + scroller.current!.scrollLeft) / pxPerMs)
          }
          const up = (): void => {
            window.removeEventListener('pointermove', move)
            window.removeEventListener('pointerup', up)
          }
          window.addEventListener('pointermove', move)
          window.addEventListener('pointerup', up)
        }}
      >
        <div className="relative" style={{ width: totalW + 24, height: y + 8 }}>
          {/* Ruler */}
          <div className="absolute left-0 right-0 top-0 h-[22px] border-b border-ink-800">
            {ticks.map((t) => (
              <div
                key={t}
                className="absolute top-0 h-full border-l border-ink-700 pl-1 text-[10px] tabular-nums leading-[20px] text-ink-400"
                style={{ left: t * pxPerMs }}
              >
                {formatTime(t, tickEvery < 1000)}
              </div>
            ))}
          </div>

          {/* Clips */}
          {project.clips.map((c, i) =>
            item(
              'clip',
              c.id,
              starts[i] * pxPerMs,
              clipTimelineDuration(c) * pxPerMs - 2,
              rowTop.clips,
              'bg-sky-600/80',
              <>
                {formatTime(c.sourceStart)}–{formatTime(c.sourceEnd)}
                {c.speed !== 1 && <span className="ml-1.5 rounded bg-black/30 px-1">{c.speed}×</span>}
              </>,
              { start: c.sourceStart, end: c.sourceEnd },
              'Drag the edges to trim. S splits at the playhead.'
            )
          )}

          {/* Zooms */}
          {visible(project.zooms).map((z) =>
            item(
              'zoom',
              z.id,
              z.t0 * pxPerMs,
              (z.t1 - z.t0) * pxPerMs,
              rowTop.zoom,
              z.auto ? 'bg-violet-600/80' : 'bg-violet-500',
              <>
                {z.scale.toFixed(1)}× {z.mode === 'follow' ? 'follow' : ''}
              </>,
              z
            )
          )}

          {/* Layouts */}
          {visible(project.layouts).map((l) =>
            item(
              'layout',
              l.id,
              l.t0 * pxPerMs,
              (l.t1 - l.t0) * pxPerMs,
              rowTop.layout,
              'bg-emerald-600/80',
              LAYOUT_LABEL[l.layout],
              l
            )
          )}

          {/* Annotations */}
          {noteLanes.map((a) => {
            const orig = project.annotations.find((x) => x.id === a.id)!
            return item(
              'annotation',
              a.id,
              a.start * pxPerMs,
              (a.end - a.start) * pxPerMs,
              rowTop.notes + a.lane * TRACK_H,
              a.kind === 'blur' ? 'bg-slate-500' : 'bg-amber-600/90',
              <>
                {NOTE_LABEL[a.kind]}
                {a.kind === 'text' && a.text ? `: ${a.text}` : ''}
              </>,
              { start: orig.start, end: orig.end }
            )
          })}

          <Playhead pxPerMs={pxPerMs} />
        </div>
      </div>
    </div>
  )
}
