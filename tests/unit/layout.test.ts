import { describe, expect, it } from 'vitest'
import { fitRect, layoutAt, presetGeometry, TRANSITION_MS } from '@shared/layout'
import { outputSize, parseProject, type Project } from '@shared/project'

function project(over: Partial<Project> = {}): Project {
  return parseProject({
    version: 1,
    createdAt: new Date(0).toISOString(),
    sources: {
      screen: { file: 'screen.mp4', width: 2880, height: 1800, durationMs: 10000 },
      camera: { file: 'camera.mp4', width: 1280, height: 720, offsetMs: 0 }
    },
    clips: [{ id: 'c', sourceStart: 0, sourceEnd: 10000, speed: 1 }],
    ...over
  })
}

const inside = (r: { x: number; y: number; w: number; h: number }, W: number, H: number): boolean =>
  r.x >= -0.5 && r.y >= -0.5 && r.x + r.w <= W + 0.5 && r.y + r.h <= H + 0.5

describe('layout', () => {
  it('fits preserving aspect', () => {
    const r = fitRect({ x: 0, y: 0, w: 1600, h: 900 }, 16 / 10)
    expect(r.h).toBe(900)
    expect(r.w).toBeCloseTo(1440)
    expect(r.x).toBeCloseTo(80)
  })

  it('keeps every preset on-canvas for every aspect', () => {
    for (const aspect of ['16:9', '9:16', '1:1', '4:3', 'source'] as const) {
      const p = project({ aspect })
      const { width: W, height: H } = outputSize(p, 1080)
      for (const preset of ['screen', 'pip', 'side-by-side', 'camera'] as const) {
        const g = presetGeometry(preset, p, W, H)
        if (g.screenAlpha > 0) expect(inside(g.screen, W, H)).toBe(true)
        if (g.cameraAlpha > 0) expect(inside(g.camera, W, H)).toBe(true)
      }
    }
  })

  it('side-by-side does not overlap screen and camera', () => {
    const p = project()
    const g = presetGeometry('side-by-side', p, 1920, 1080)
    const overlapX =
      Math.min(g.screen.x + g.screen.w, g.camera.x + g.camera.w) - Math.max(g.screen.x, g.camera.x)
    expect(overlapX).toBeLessThanOrEqual(0)
  })

  it('without a camera, every preset falls back to screen', () => {
    const p = project({ sources: { ...project().sources, camera: null } })
    expect(presetGeometry('camera', p, 1920, 1080).cameraAlpha).toBe(0)
    expect(presetGeometry('camera', p, 1920, 1080).screenAlpha).toBe(1)
  })

  it('transitions smoothly across layout changes', () => {
    const p = project({
      defaultLayout: 'pip',
      layouts: [{ id: 'l', start: 4000, end: 6000, layout: 'camera' }]
    })
    const before = layoutAt(p, 4000 - TRANSITION_MS, 1920, 1080)
    const mid = layoutAt(p, 4000, 1920, 1080)
    const after = layoutAt(p, 4000 + TRANSITION_MS, 1920, 1080)
    expect(before.screenAlpha).toBe(1)
    expect(after.screenAlpha).toBe(0)
    expect(mid.screenAlpha).toBeGreaterThan(0)
    expect(mid.screenAlpha).toBeLessThan(1)
  })

  it('output sizes are even and match the aspect', () => {
    const p = project({ aspect: '9:16' })
    expect(outputSize(p, 1080)).toEqual({ width: 1080, height: 1920 })
    expect(outputSize(project({ aspect: 'source' }), 1080)).toEqual({ width: 1728, height: 1080 })
  })
})
