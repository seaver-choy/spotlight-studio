import { describe, expect, it } from 'vitest'
import { parseProject } from '@shared/project'

describe('project schema', () => {
  it('fills defaults for a minimal project (what an agent might write)', () => {
    const p = parseProject({
      version: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      sources: { screen: { file: 'screen.mp4', width: 100, height: 100, durationMs: 1000 } },
      clips: [{ id: 'c', sourceStart: 0, sourceEnd: 1000 }]
    })
    expect(p.clips[0].speed).toBe(1)
    expect(p.camera.shape).toBe('circle')
    expect(p.background.type).toBe('gradient')
    expect(p.cursorFx.clickRipple).toBe(true)
    expect(p.zooms).toEqual([])
    expect(p.sources.camera).toBeNull()
  })

  it('rejects invalid data', () => {
    expect(() => parseProject({ version: 2 })).toThrow()
    expect(() =>
      parseProject({
        version: 1,
        createdAt: 'x',
        sources: { screen: { file: 's', width: 1, height: 1, durationMs: 1 } },
        clips: []
      })
    ).toThrow()
  })
})
