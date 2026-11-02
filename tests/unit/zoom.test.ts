import { describe, expect, it } from 'vitest'
import type { CursorData, ZoomSegment } from '@shared/project'
import { applyView, cursorAt, generateAutoZooms, unapplyView, ZoomCamera } from '@shared/zoom'

function cursorWith(
  clicks: Array<[number, number, number]>,
  path?: (t: number) => [number, number]
): CursorData {
  const samples: CursorData['samples'] = []
  for (let t = 0; t <= 30000; t += 1000 / 60) {
    const [x, y] = path ? path(t) : [0.5, 0.5]
    samples.push([t, x, y])
  }
  return { version: 1, samples, clicks: clicks.map(([t, x, y]) => ({ t, x, y, button: 1 })), keys: [] }
}

let n = 0
const id = (): string => `z${n++}`

describe('cursorAt', () => {
  it('interpolates', () => {
    const c: CursorData = {
      version: 1,
      samples: [
        [0, 0, 0],
        [100, 1, 0.5]
      ],
      clicks: [],
      keys: []
    }
    expect(cursorAt(c, 50)).toEqual({ x: 0.5, y: 0.25 })
    expect(cursorAt(c, -5)).toEqual({ x: 0, y: 0 })
    expect(cursorAt(c, 500)).toEqual({ x: 1, y: 0.5 })
    expect(cursorAt(null, 0)).toBeNull()
  })
})

describe('generateAutoZooms', () => {
  it('groups nearby clicks and separates distant ones', () => {
    const c = cursorWith([
      [2000, 0.2, 0.2],
      [3000, 0.22, 0.25], // same group
      [12000, 0.8, 0.8] // far in time → new group
    ])
    const z = generateAutoZooms(c, 30000, id)
    expect(z).toHaveLength(2)
    expect(z[0].start).toBe(1300)
    expect(z[0].end).toBe(4800)
    expect(z[1].start).toBeLessThan(12000)
    expect(z.every((s) => s.auto && s.mode === 'follow')).toBe(true)
  })

  it('merges zooms with small gaps and clamps to duration', () => {
    const c = cursorWith([
      [500, 0.5, 0.5],
      [3500, 0.5, 0.5] // gap 3000 > maxGap → new group, but ranges overlap → merged
    ])
    const z = generateAutoZooms(c, 4000, id)
    expect(z).toHaveLength(1)
    expect(z[0].start).toBe(0)
    expect(z[0].end).toBe(4000)
  })

  it('returns nothing without clicks', () => {
    expect(generateAutoZooms(cursorWith([]), 30000, id)).toEqual([])
    expect(generateAutoZooms(null, 30000, id)).toEqual([])
  })
})

describe('ZoomCamera', () => {
  const seg: ZoomSegment = {
    id: 'a',
    start: 1000,
    end: 5000,
    scale: 2,
    mode: 'fixed',
    x: 0.9,
    y: 0.9,
    auto: false
  }

  it('is identity outside zooms', () => {
    const cam = new ZoomCamera([seg], null)
    expect(cam.viewAt(0)).toEqual({ scale: 1, cx: 0.5, cy: 0.5 })
    expect(cam.viewAt(6000)).toEqual({ scale: 1, cx: 0.5, cy: 0.5 })
  })

  it('eases in and clamps the view inside the frame', () => {
    const cam = new ZoomCamera([seg], null)
    const mid = cam.viewAt(3000)
    expect(mid.scale).toBe(2)
    // Visible region must stay inside the screen: cx ≤ 1 - 0.5/scale.
    expect(mid.cx).toBeCloseTo(0.75)
    expect(mid.cy).toBeCloseTo(0.75)
    const early = cam.viewAt(1100)
    expect(early.scale).toBeGreaterThan(1)
    expect(early.scale).toBeLessThan(2)
    expect(early.cx).toBeLessThanOrEqual(1 - 0.5 / early.scale + 1e-9)
  })

  it('follows the cursor smoothly without leaving the frame', () => {
    const c = cursorWith([], (t) => [0.1 + 0.8 * Math.min(1, t / 10000), 0.5])
    const cam = new ZoomCamera([{ ...seg, mode: 'follow', start: 0, end: 12000 }], c)
    let prev = cam.viewAt(1000).cx
    for (let t = 1000; t < 11000; t += 100) {
      const v = cam.viewAt(t)
      expect(v.cx).toBeGreaterThanOrEqual(0.25 - 1e-9)
      expect(v.cx).toBeLessThanOrEqual(0.75 + 1e-9)
      expect(Math.abs(v.cx - prev)).toBeLessThan(0.05) // no jumps
      prev = v.cx
    }
    // The camera ends up near the cursor (clamped to the edge).
    expect(cam.viewAt(11000).cx).toBeGreaterThan(0.6)
  })

  it('view transforms are inverses', () => {
    const v = { scale: 2.5, cx: 0.4, cy: 0.6 }
    const p = { x: 0.33, y: 0.71 }
    const back = unapplyView(v, applyView(v, p))
    expect(back.x).toBeCloseTo(p.x)
    expect(back.y).toBeCloseTo(p.y)
  })
})
