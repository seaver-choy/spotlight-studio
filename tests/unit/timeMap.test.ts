import { describe, expect, it } from 'vitest'
import type { Clip } from '@shared/project'
import {
  sourceRangeToTimelineRanges,
  sourceToTimeline,
  sourceToTimelineClamped,
  splitAt,
  timelineDuration,
  timelineToSource
} from '@shared/timeMap'

const clips: Clip[] = [
  { id: 'a', sourceStart: 0, sourceEnd: 4000, speed: 1 },
  // 4000–6000 cut out
  { id: 'b', sourceStart: 6000, sourceEnd: 10000, speed: 2 }
]

describe('timeMap', () => {
  it('computes duration with speed', () => {
    expect(timelineDuration(clips)).toBe(4000 + 2000)
  })

  it('maps timeline → source across a cut and a speed change', () => {
    expect(timelineToSource(clips, 1000)).toEqual({ clipIndex: 0, source: 1000 })
    expect(timelineToSource(clips, 4000)).toEqual({ clipIndex: 1, source: 6000 })
    expect(timelineToSource(clips, 5000)).toEqual({ clipIndex: 1, source: 8000 })
    expect(timelineToSource(clips, 99999).source).toBe(10000)
  })

  it('maps source → timeline and reports cut regions', () => {
    expect(sourceToTimeline(clips, 2000)).toBe(2000)
    expect(sourceToTimeline(clips, 5000)).toBeNull()
    expect(sourceToTimeline(clips, 8000)).toBe(5000)
    expect(sourceToTimelineClamped(clips, 5000)).toBe(4000)
  })

  it('round-trips', () => {
    for (const t of [0, 123, 3999, 4000, 4500, 5999]) {
      const s = timelineToSource(clips, t).source
      expect(sourceToTimeline(clips, s)).toBeCloseTo(t, 6)
    }
  })

  it('splits ranges spanning cuts', () => {
    expect(sourceRangeToTimelineRanges(clips, 3000, 7000)).toEqual([
      { start: 3000, end: 4000 },
      { start: 4000, end: 4500 }
    ])
  })

  it('splits a clip at the playhead', () => {
    let n = 0
    const out = splitAt(clips, 2000, () => `new${n++}`)
    expect(out.map((c) => [c.sourceStart, c.sourceEnd])).toEqual([
      [0, 2000],
      [2000, 4000],
      [6000, 10000]
    ])
    expect(timelineDuration(out)).toBe(timelineDuration(clips))
    // On a boundary: no-op.
    expect(splitAt(clips, 4000, () => 'x')).toBe(clips)
  })
})
