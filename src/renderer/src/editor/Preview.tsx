/**
 * Live preview. Plays the raw <video> elements through the edit (clips, speed) and
 * draws every frame with the same compositor the exporter uses.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as RPointerEvent,
  type ReactNode
} from 'react'
import { mediaUrl } from '@shared/ipc'
import { layoutAt, presetAt } from '@shared/layout'
import { outputSize, type Annotation, type Project } from '@shared/project'
import { clipStarts, timelineDuration, timelineToSource } from '@shared/timeMap'
import { applyView, unapplyView } from '@shared/zoom'
import { createScene, renderFrame, type FrameImage } from '../compositor/renderFrame'
import { join } from '../lib/media'
import { useEditor } from './store'

function videoImage(v: HTMLVideoElement | null): FrameImage | null {
  if (!v || v.readyState < 2 || !v.videoWidth) return null
  return { image: v, width: v.videoWidth, height: v.videoHeight }
}

function useBackgroundImage(folder: string, project: Project): FrameImage | null {
  const [img, setImg] = useState<FrameImage | null>(null)
  const file = project.background.type === 'image' ? project.background.image : null
  useEffect(() => {
    if (!file) return setImg(null)
    const el = new Image()
    el.onload = () => setImg({ image: el, width: el.naturalWidth, height: el.naturalHeight })
    el.src = mediaUrl(join(folder, file))
  }, [folder, file])
  return img
}

interface DragState {
  kind: 'move' | 'resize' | 'head' | 'camera'
  id: string
  startX: number
  startY: number
  orig: Annotation | { x: number; y: number }
}

export function Preview({ onFrameRef }: { onFrameRef?: (draw: () => void) => void }): ReactNode {
  const folder = useEditor((s) => s.folder)
  const project = useEditor((s) => s.project)!
  const cursor = useEditor((s) => s.cursor)
  const playing = useEditor((s) => s.playing)
  const playhead = useEditor((s) => s.playhead)
  const selection = useEditor((s) => s.selection)

  const wrap = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const screenVideo = useRef<HTMLVideoElement>(null)
  const cameraVideo = useRef<HTMLVideoElement>(null)
  const clipIndex = useRef(0)
  const [box, setBox] = useState({ w: 640, h: 360 })
  const [, forceOverlay] = useState(0)

  const scene = useMemo(() => createScene(project, cursor), [project, cursor])
  const bgImage = useBackgroundImage(folder, project)
  const out = outputSize(project, 1080)

  // Fit the canvas into the available space.
  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const aw = el.clientWidth - 32
      const ah = el.clientHeight - 32
      const ratio = out.width / out.height
      let w = aw
      let h = w / ratio
      if (h > ah) {
        h = ah
        w = h * ratio
      }
      setBox({ w: Math.max(100, Math.floor(w)), h: Math.max(60, Math.floor(h)) })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [out.width, out.height])

  const sourceNow = useCallback((): number => {
    const v = screenVideo.current
    const st = useEditor.getState()
    if (st.playing && v) return v.currentTime * 1000
    return timelineToSource(project.clips, st.playhead).source
  }, [project.clips])

  const draw = useCallback(() => {
    const c = canvas.current
    if (!c) return
    const dpr = window.devicePixelRatio || 1
    const W = Math.round(box.w * dpr)
    const H = Math.round(box.h * dpr)
    if (c.width !== W || c.height !== H) {
      c.width = W
      c.height = H
    }
    const ctx = c.getContext('2d')!
    renderFrame(
      ctx,
      W,
      H,
      scene,
      {
        screen: videoImage(screenVideo.current),
        camera: videoImage(cameraVideo.current),
        backgroundImage: bgImage
      },
      sourceNow()
    )
  }, [box, scene, bgImage, sourceNow])

  useEffect(() => onFrameRef?.(draw), [draw, onFrameRef])

  // Seek the videos when paused and the playhead moves.
  useEffect(() => {
    if (playing) return
    const { source, clipIndex: ci } = timelineToSource(project.clips, playhead)
    clipIndex.current = ci
    const v = screenVideo.current
    if (v && Math.abs(v.currentTime * 1000 - source) > 15) v.currentTime = source / 1000
    const cv = cameraVideo.current
    const cam = project.sources.camera
    if (cv && cam) {
      const ct = Math.max(0, (source - cam.offsetMs) / 1000)
      if (Math.abs(cv.currentTime - ct) > 0.02) cv.currentTime = ct
    }
    draw()
  }, [playhead, playing, project, draw])

  // Redraw after seeks complete / data loads.
  useEffect(() => {
    const vids = [screenVideo.current, cameraVideo.current].filter(Boolean) as HTMLVideoElement[]
    const on = (): void => {
      if (!useEditor.getState().playing) draw()
    }
    vids.forEach((v) => {
      v.addEventListener('seeked', on)
      v.addEventListener('loadeddata', on)
    })
    return () =>
      vids.forEach((v) => {
        v.removeEventListener('seeked', on)
        v.removeEventListener('loadeddata', on)
      })
  }, [draw])

  // Playback loop.
  useEffect(() => {
    const v = screenVideo.current
    const cv = cameraVideo.current
    if (!v) return
    if (!playing) {
      v.pause()
      cv?.pause()
      return
    }
    const clips = project.clips
    const starts = clipStarts(clips)
    const cam = project.sources.camera
    const st = useEditor.getState()
    if (st.playhead >= timelineDuration(clips) - 30) st.seek(0)
    const pos = timelineToSource(clips, useEditor.getState().playhead)
    clipIndex.current = pos.clipIndex
    const applyClip = (i: number): void => {
      const c = clips[i]
      v.playbackRate = c.speed
      v.muted = c.speed !== 1
      if (cv) cv.playbackRate = c.speed
    }
    v.currentTime = pos.source / 1000
    applyClip(pos.clipIndex)
    void v.play().catch(() => undefined)
    if (cv && cam) {
      cv.currentTime = Math.max(0, (pos.source - cam.offsetMs) / 1000)
      void cv.play().catch(() => undefined)
    }

    let raf = 0
    const tick = (): void => {
      const i = clipIndex.current
      const c = clips[i]
      const s = v.currentTime * 1000
      if (s >= c.sourceEnd - 5 || v.ended) {
        if (i + 1 >= clips.length) {
          useEditor.getState().setPlaying(false)
          useEditor.getState().seek(timelineDuration(clips))
          return
        }
        clipIndex.current = i + 1
        const n = clips[i + 1]
        v.currentTime = n.sourceStart / 1000
        applyClip(i + 1)
        if (cv && cam) cv.currentTime = Math.max(0, (n.sourceStart - cam.offsetMs) / 1000)
      } else {
        const t = starts[i] + Math.max(0, s - c.sourceStart) / c.speed
        useEditor.setState({ playhead: t })
        if (cv && cam) {
          const expected = (s - cam.offsetMs) / 1000
          if (Math.abs(cv.currentTime - expected) > 0.12) cv.currentTime = Math.max(0, expected)
        }
      }
      draw()
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      v.pause()
      cv?.pause()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, project.clips, project.sources.camera])

  // Redraw on any project change while paused.
  useEffect(() => {
    if (!playing) draw()
  }, [project, draw, playing])

  // ---------- direct manipulation overlay ----------
  const drag = useRef<DragState | null>(null)
  const sourceT = timelineToSource(project.clips, playhead).source
  const dpr = 1 // overlay works in CSS pixels
  const geo = layoutAt(project, sourceT, box.w * dpr, box.h * dpr)
  const view = scene.zoom.viewAt(sourceT)
  const R = geo.screen
  const toCss = (x: number, y: number): { x: number; y: number } => {
    const q = applyView(view, { x, y })
    return { x: R.x + q.x * R.w, y: R.y + q.y * R.h }
  }
  const selected =
    selection?.kind === 'annotation'
      ? project.annotations.find((a) => a.id === selection.id && sourceT >= a.start && sourceT <= a.end)
      : undefined
  const pipActive = !!project.sources.camera && presetAt(project, sourceT) === 'pip' && !playing

  const onPointerDown = (
    e: RPointerEvent,
    kind: DragState['kind'],
    id: string,
    orig: DragState['orig']
  ): void => {
    e.stopPropagation()
    ;(e.target as Element).setPointerCapture(e.pointerId)
    drag.current = { kind, id, startX: e.clientX, startY: e.clientY, orig: structuredClone(orig) }
  }
  const onPointerMove = (e: RPointerEvent): void => {
    const d = drag.current
    if (!d) return
    const dxCss = e.clientX - d.startX
    const dyCss = e.clientY - d.startY
    const update = useEditor.getState().update
    if (d.kind === 'camera') {
      const o = d.orig as { x: number; y: number }
      update((p) => {
        p.camera.x = Math.min(1, Math.max(0, o.x + dxCss / box.w))
        p.camera.y = Math.min(1, Math.max(0, o.y + dyCss / box.h))
      }, `drag-camera`)
      return
    }
    const dx = dxCss / (R.w * view.scale)
    const dy = dyCss / (R.h * view.scale)
    const o = d.orig as Annotation
    update((p) => {
      const a = p.annotations.find((x) => x.id === d.id)
      if (!a) return
      const clamp = (v: number): number => Math.min(1, Math.max(0, v))
      if (d.kind === 'move') {
        a.x = clamp(o.x + dx)
        a.y = clamp(o.y + dy)
      } else if (d.kind === 'resize') {
        a.w = Math.max(0.01, Math.min(1 - a.x, o.w + dx))
        a.h = Math.max(0.01, Math.min(1 - a.y, o.h + dy))
      } else if (d.kind === 'head') {
        a.w = Math.max(-1, Math.min(1, o.w + dx))
        a.h = Math.max(-1, Math.min(1, o.h + dy))
      }
    }, `drag-${d.id}-${d.kind}`)
    forceOverlay((n) => n + 1)
  }
  const onPointerUp = (): void => {
    drag.current = null
  }

  let handles: ReactNode = null
  if (selected && !playing) {
    const a = selected
    if (a.kind === 'arrow') {
      const p0 = toCss(a.x, a.y)
      const p1 = toCss(a.x + a.w, a.y + a.h)
      handles = (
        <>
          <div
            className="absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 cursor-move rounded-full border-2 border-white bg-accent"
            style={{ left: p0.x, top: p0.y }}
            onPointerDown={(e) => onPointerDown(e, 'move', a.id, a)}
          />
          <div
            className="absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 cursor-crosshair rounded-full border-2 border-white bg-rec"
            style={{ left: p1.x, top: p1.y }}
            onPointerDown={(e) => onPointerDown(e, 'head', a.id, a)}
          />
        </>
      )
    } else if (a.kind === 'text') {
      const p0 = toCss(a.x, a.y)
      handles = (
        <div
          className="absolute -translate-x-1 -translate-y-1 cursor-move rounded border-2 border-dashed border-white/80"
          style={{ left: p0.x, top: p0.y, width: 24, height: 24 }}
          title="Drag to move"
          onPointerDown={(e) => onPointerDown(e, 'move', a.id, a)}
        />
      )
    } else {
      const p0 = toCss(a.x, a.y)
      const p1 = toCss(a.x + a.w, a.y + a.h)
      handles = (
        <div
          className="absolute cursor-move border-2 border-dashed border-white/90"
          style={{ left: p0.x, top: p0.y, width: p1.x - p0.x, height: p1.y - p0.y }}
          onPointerDown={(e) => onPointerDown(e, 'move', a.id, a)}
        >
          <div
            className="absolute -bottom-1.5 -right-1.5 h-3 w-3 cursor-nwse-resize rounded-sm border-2 border-white bg-accent"
            onPointerDown={(e) => onPointerDown(e, 'resize', a.id, a)}
          />
        </div>
      )
    }
  }

  const onCanvasClick = (e: RPointerEvent<HTMLDivElement>): void => {
    // Click on the preview while a zoom is selected in fixed mode → set its focus point.
    const sel = useEditor.getState().selection
    if (sel?.kind !== 'zoom') return
    const z = project.zooms.find((x) => x.id === sel.id)
    if (!z || z.mode !== 'fixed') return
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
    const cx = (e.clientX - rect.left - R.x) / R.w
    const cy = (e.clientY - rect.top - R.y) / R.h
    const p = unapplyView(view, { x: cx, y: cy })
    useEditor.getState().update((pr) => {
      const zz = pr.zooms.find((x) => x.id === z.id)
      if (zz) {
        zz.x = Math.min(1, Math.max(0, p.x))
        zz.y = Math.min(1, Math.max(0, p.y))
      }
    })
  }

  const screenSrc = mediaUrl(join(folder, project.sources.screen.file))
  const cameraSrc = project.sources.camera ? mediaUrl(join(folder, project.sources.camera.file)) : null

  return (
    <div ref={wrap} className="relative flex min-h-0 flex-1 items-center justify-center bg-ink-950">
      <video ref={screenVideo} src={screenSrc} preload="auto" playsInline className="hidden" />
      {cameraSrc && (
        <video ref={cameraVideo} src={cameraSrc} preload="auto" muted playsInline className="hidden" />
      )}
      <div
        className="relative overflow-hidden rounded-md shadow-2xl ring-1 ring-white/5"
        style={{ width: box.w, height: box.h }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerDown={onCanvasClick}
      >
        <canvas ref={canvas} style={{ width: box.w, height: box.h }} className="block" />
        {handles}
        {pipActive && (
          <div
            className="absolute cursor-grab rounded-full hover:ring-2 hover:ring-accent/70"
            title="Drag to move the camera"
            style={{ left: geo.camera.x, top: geo.camera.y, width: geo.camera.w, height: geo.camera.h }}
            onPointerDown={(e) =>
              onPointerDown(e, 'camera', 'camera', { x: project.camera.x, y: project.camera.y })
            }
          />
        )}
      </div>
    </div>
  )
}
