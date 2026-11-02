/**
 * Cursor lookup, auto-zoom generation and the zoom "camera" (what part of the
 * screen recording is visible at a given moment).
 *
 * Everything here is a pure function of (project, cursor data, source time) so the
 * editor preview and the exporter produce identical frames, and seeking is exact.
 */
import type { CursorData, ZoomSegment } from './project'

export interface Point {
  x: number
  y: number
}

export interface ZoomView {
  /** Magnification (1 = whole screen). */
  scale: number
  /** Center of the visible region in normalized screen coordinates. */
  cx: number
  cy: number
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

export const easeInOutCubic = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2

/** Linear interpolation of the cursor position at time t (ms). Returns null without data. */
export function cursorAt(cursor: CursorData | null, t: number): Point | null {
  const s = cursor?.samples
  if (!s || s.length === 0) return null
  if (t <= s[0][0]) return { x: s[0][1], y: s[0][2] }
  const last = s[s.length - 1]
  if (t >= last[0]) return { x: last[1], y: last[2] }
  let lo = 0
  let hi = s.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (s[mid][0] <= t) lo = mid
    else hi = mid
  }
  const a = s[lo]
  const b = s[hi]
  const k = b[0] === a[0] ? 0 : (t - a[0]) / (b[0] - a[0])
  return { x: a[1] + (b[1] - a[1]) * k, y: a[2] + (b[2] - a[2]) * k }
}

export interface AutoZoomOptions {
  scale: number
  /** Clicks further apart in time than this start a new zoom. */
  maxGapMs: number
  /** Clicks further apart than this (normalized distance) start a new zoom. */
  maxDistance: number
  /** Zoom starts this long before the first click. */
  leadMs: number
  /** Zoom ends this long after the last click. */
  tailMs: number
  minDurationMs: number
  /** Zooms closer together than this are merged. */
  mergeGapMs: number
}

export const DEFAULT_AUTO_ZOOM: AutoZoomOptions = {
  scale: 2,
  maxGapMs: 2500,
  maxDistance: 0.3,
  leadMs: 700,
  tailMs: 1800,
  minDurationMs: 2200,
  mergeGapMs: 900
}

/**
 * Turn clicks into zoom segments. Clicks close together in time and space become one
 * segment; the zoom then follows the cursor for its duration.
 */
export function generateAutoZooms(
  cursor: CursorData | null,
  durationMs: number,
  makeId: () => string,
  opts: Partial<AutoZoomOptions> = {}
): ZoomSegment[] {
  const o = { ...DEFAULT_AUTO_ZOOM, ...opts }
  if (!cursor || cursor.clicks.length === 0) return []
  const clicks = [...cursor.clicks].sort((a, b) => a.t - b.t)

  const groups: Array<{ first: number; last: number; cx: number; cy: number; n: number }> = []
  for (const c of clicks) {
    const g = groups[groups.length - 1]
    if (g && c.t - g.last <= o.maxGapMs && Math.hypot(c.x - g.cx, c.y - g.cy) <= o.maxDistance) {
      g.last = c.t
      g.cx = (g.cx * g.n + c.x) / (g.n + 1)
      g.cy = (g.cy * g.n + c.y) / (g.n + 1)
      g.n++
    } else {
      groups.push({ first: c.t, last: c.t, cx: c.x, cy: c.y, n: 1 })
    }
  }

  const ranges = groups.map((g) => {
    let start = g.first - o.leadMs
    let end = g.last + o.tailMs
    if (end - start < o.minDurationMs) {
      const pad = (o.minDurationMs - (end - start)) / 2
      start -= pad
      end += pad
    }
    return { start: clamp(start, 0, durationMs), end: clamp(end, 0, durationMs), cx: g.cx, cy: g.cy }
  })

  const merged: typeof ranges = []
  for (const r of ranges) {
    const prev = merged[merged.length - 1]
    if (prev && r.start - prev.end <= o.mergeGapMs) {
      prev.end = Math.max(prev.end, r.end)
    } else {
      merged.push({ ...r })
    }
  }

  return merged
    .filter((r) => r.end - r.start >= 500)
    .map((r) => ({
      id: makeId(),
      start: Math.round(r.start),
      end: Math.round(r.end),
      scale: o.scale,
      mode: 'follow' as const,
      x: r.cx,
      y: r.cy,
      auto: true
    }))
}

const TRACK_STEP_MS = 1000 / 60

/** Pre-computed camera path for a follow-mode zoom segment. */
interface FollowTrack {
  start: number
  xs: Float32Array
  ys: Float32Array
}

/**
 * Simulates a smooth camera that follows the cursor with a dead-zone:
 * the camera only moves when the cursor leaves the middle part of the view, and it
 * moves with a critically damped spring so it never overshoots or jitters.
 */
function buildFollowTrack(seg: ZoomSegment, cursor: CursorData | null): FollowTrack {
  const n = Math.max(2, Math.ceil((seg.end - seg.start) / TRACK_STEP_MS) + 1)
  const xs = new Float32Array(n)
  const ys = new Float32Array(n)
  const half = 0.5 / seg.scale
  const dead = half * 0.45
  const omega = 7 // spring stiffness (rad/s)
  const dt = TRACK_STEP_MS / 1000

  const start = cursorAt(cursor, seg.start) ?? { x: seg.x, y: seg.y }
  let cx = clamp(start.x, half, 1 - half)
  let cy = clamp(start.y, half, 1 - half)
  let vx = 0
  let vy = 0
  let tx = cx
  let ty = cy

  for (let i = 0; i < n; i++) {
    const p = cursorAt(cursor, seg.start + i * TRACK_STEP_MS)
    if (p) {
      // Move the target only enough to bring the cursor back inside the dead-zone.
      if (p.x < tx - dead) tx = p.x + dead
      else if (p.x > tx + dead) tx = p.x - dead
      if (p.y < ty - dead) ty = p.y + dead
      else if (p.y > ty + dead) ty = p.y - dead
      tx = clamp(tx, half, 1 - half)
      ty = clamp(ty, half, 1 - half)
    }
    // Critically damped spring step.
    const ax = omega * omega * (tx - cx) - 2 * omega * vx
    const ay = omega * omega * (ty - cy) - 2 * omega * vy
    vx += ax * dt
    vy += ay * dt
    cx += vx * dt
    cy += vy * dt
    xs[i] = cx
    ys[i] = cy
  }
  return { start: seg.start, xs, ys }
}

/**
 * Computes zoom views. Construct once per (zoom segments, cursor) pair and reuse;
 * follow tracks are cached per segment.
 */
export class ZoomCamera {
  private readonly segments: ZoomSegment[]
  private readonly tracks = new Map<string, FollowTrack>()

  constructor(
    segments: ZoomSegment[],
    private readonly cursor: CursorData | null
  ) {
    this.segments = [...segments].sort((a, b) => a.start - b.start)
  }

  private track(seg: ZoomSegment): FollowTrack {
    const key = `${seg.id}:${seg.start}:${seg.end}:${seg.scale}`
    let tr = this.tracks.get(key)
    if (!tr) {
      tr = buildFollowTrack(seg, this.cursor)
      this.tracks.set(key, tr)
    }
    return tr
  }

  /** The zoom segment active at source time t, if any. */
  active(t: number): ZoomSegment | null {
    for (const s of this.segments) if (t >= s.start && t <= s.end) return s
    return null
  }

  viewAt(t: number): ZoomView {
    const seg = this.active(t)
    if (!seg || seg.scale <= 1.001) return { scale: 1, cx: 0.5, cy: 0.5 }

    const ramp = Math.min(550, (seg.end - seg.start) / 3)
    const kIn = clamp((t - seg.start) / ramp, 0, 1)
    const kOut = clamp((seg.end - t) / ramp, 0, 1)
    const k = easeInOutCubic(Math.min(kIn, kOut))
    const scale = 1 + (seg.scale - 1) * k

    let tx: number
    let ty: number
    if (seg.mode === 'fixed' || !this.cursor) {
      const half = 0.5 / seg.scale
      tx = clamp(seg.x, half, 1 - half)
      ty = clamp(seg.y, half, 1 - half)
    } else {
      const tr = this.track(seg)
      const f = (t - tr.start) / TRACK_STEP_MS
      const i = clamp(Math.floor(f), 0, tr.xs.length - 1)
      const j = Math.min(i + 1, tr.xs.length - 1)
      const r = clamp(f - i, 0, 1)
      tx = tr.xs[i] + (tr.xs[j] - tr.xs[i]) * r
      ty = tr.ys[i] + (tr.ys[j] - tr.ys[i]) * r
    }

    // Zoom toward the focal point: keeps the target visually anchored while scaling.
    const full = 1 - 1 / seg.scale
    const f = full <= 0 ? 0 : (1 - 1 / scale) / full
    const half = 0.5 / scale
    return {
      scale,
      cx: clamp(0.5 + (tx - 0.5) * f, half, 1 - half),
      cy: clamp(0.5 + (ty - 0.5) * f, half, 1 - half)
    }
  }
}

/** Map a normalized screen point to normalized view coordinates under a zoom view. */
export function applyView(v: ZoomView, p: Point): Point {
  return { x: (p.x - v.cx) * v.scale + 0.5, y: (p.y - v.cy) * v.scale + 0.5 }
}

/** Inverse of applyView. */
export function unapplyView(v: ZoomView, p: Point): Point {
  return { x: (p.x - 0.5) / v.scale + v.cx, y: (p.y - 0.5) / v.scale + v.cy }
}
