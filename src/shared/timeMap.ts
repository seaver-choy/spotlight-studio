/**
 * Mapping between source time (ms into the raw recording) and timeline time
 * (ms into the edited video). Clips are played back-to-back in array order.
 */
import type { Clip } from './project'

export function clipTimelineDuration(clip: Clip): number {
  return Math.max(0, clip.sourceEnd - clip.sourceStart) / clip.speed
}

export function timelineDuration(clips: Clip[]): number {
  return clips.reduce((sum, c) => sum + clipTimelineDuration(c), 0)
}

/** Timeline start time of each clip. */
export function clipStarts(clips: Clip[]): number[] {
  const starts: number[] = []
  let t = 0
  for (const c of clips) {
    starts.push(t)
    t += clipTimelineDuration(c)
  }
  return starts
}

export interface SourcePosition {
  clipIndex: number
  /** Source time in ms. */
  source: number
}

/** Timeline ms → source ms. Clamps to the timeline range. */
export function timelineToSource(clips: Clip[], t: number): SourcePosition {
  if (clips.length === 0) return { clipIndex: -1, source: 0 }
  let start = 0
  for (let i = 0; i < clips.length; i++) {
    const c = clips[i]
    const d = clipTimelineDuration(c)
    if (t < start + d || i === clips.length - 1) {
      const local = Math.min(Math.max(t - start, 0), d)
      return { clipIndex: i, source: c.sourceStart + local * c.speed }
    }
    start += d
  }
  return { clipIndex: clips.length - 1, source: clips[clips.length - 1].sourceEnd }
}

/**
 * Source ms → timeline ms, or null if that source moment was cut out.
 * If the same source moment appears in several clips, the first is returned.
 */
export function sourceToTimeline(clips: Clip[], s: number): number | null {
  let start = 0
  for (const c of clips) {
    if (s >= c.sourceStart && s <= c.sourceEnd) return start + (s - c.sourceStart) / c.speed
    start += clipTimelineDuration(c)
  }
  return null
}

/**
 * Like sourceToTimeline but snaps removed moments to the nearest following kept moment
 * (or the end of the timeline). Used to draw overlay segments on the timeline.
 */
export function sourceToTimelineClamped(clips: Clip[], s: number): number {
  const exact = sourceToTimeline(clips, s)
  if (exact !== null) return exact
  let start = 0
  let best: number | null = null
  let bestDist = Infinity
  for (const c of clips) {
    if (c.sourceStart >= s && c.sourceStart - s < bestDist) {
      bestDist = c.sourceStart - s
      best = start
    }
    start += clipTimelineDuration(c)
  }
  return best ?? start
}

/**
 * Visible timeline ranges for a source range (one per clip it overlaps).
 * Used to draw overlays that span cuts.
 */
export function sourceRangeToTimelineRanges(
  clips: Clip[],
  s0: number,
  s1: number
): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = []
  let start = 0
  for (const c of clips) {
    const a = Math.max(s0, c.sourceStart)
    const b = Math.min(s1, c.sourceEnd)
    if (b > a)
      out.push({ start: start + (a - c.sourceStart) / c.speed, end: start + (b - c.sourceStart) / c.speed })
    start += clipTimelineDuration(c)
  }
  return out
}

/** Split the clip under timeline time t into two. Returns the new clip list (unchanged if t is on a boundary). */
export function splitAt(clips: Clip[], t: number, makeId: () => string): Clip[] {
  const { clipIndex, source } = timelineToSource(clips, t)
  if (clipIndex < 0) return clips
  const c = clips[clipIndex]
  if (source - c.sourceStart < 50 || c.sourceEnd - source < 50) return clips
  const a: Clip = { ...c, sourceEnd: source }
  const b: Clip = { ...c, id: makeId(), sourceStart: source }
  return [...clips.slice(0, clipIndex), a, b, ...clips.slice(clipIndex + 1)]
}
