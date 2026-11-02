/**
 * Layout geometry: where the screen and the camera go on the output canvas
 * for each layout preset, and smooth transitions between presets.
 */
import type { LayoutPreset, Project } from './project'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface LayoutGeometry {
  screen: Rect
  screenAlpha: number
  screenRadius: number
  camera: Rect
  cameraAlpha: number
  cameraRadius: number
}

export const TRANSITION_MS = 450

const lerp = (a: number, b: number, k: number): number => a + (b - a) * k
const lerpRect = (a: Rect, b: Rect, k: number): Rect => ({
  x: lerp(a.x, b.x, k),
  y: lerp(a.y, b.y, k),
  w: lerp(a.w, b.w, k),
  h: lerp(a.h, b.h, k)
})

/** Largest rect with the given aspect ratio that fits inside `box`, centered. */
export function fitRect(box: Rect, aspect: number): Rect {
  let w = box.w
  let h = w / aspect
  if (h > box.h) {
    h = box.h
    w = h * aspect
  }
  return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h }
}

type LayoutInput = Pick<Project, 'background' | 'camera' | 'sources'>

/** Geometry for one preset on a W×H canvas. */
export function presetGeometry(preset: LayoutPreset, p: LayoutInput, W: number, H: number): LayoutGeometry {
  const unit = Math.min(W, H) / 1080
  const pad = p.background.padding * Math.min(W, H)
  const content: Rect = { x: pad, y: pad, w: W - pad * 2, h: H - pad * 2 }
  const screenAspect = p.sources.screen.width / p.sources.screen.height
  const radius = p.background.radius * unit
  const cam = p.camera
  const hasCamera = !!p.sources.camera
  const effective: LayoutPreset = hasCamera ? preset : 'screen'

  // Picture-in-picture camera rect (used by 'pip', and as the hidden resting place for 'screen').
  const camSize = cam.size * Math.min(W, H)
  const margin = 12 * unit
  const pipCam: Rect = {
    x: Math.min(Math.max(cam.x * W - camSize / 2, margin), W - camSize - margin),
    y: Math.min(Math.max(cam.y * H - camSize / 2, margin), H - camSize - margin),
    w: camSize,
    h: camSize
  }
  const pipRadius = cam.shape === 'circle' ? camSize / 2 : cam.shape === 'rounded' ? camSize * 0.18 : 0

  const fullScreen = fitRect(content, screenAspect)

  switch (effective) {
    case 'screen':
      return {
        screen: fullScreen,
        screenAlpha: 1,
        screenRadius: radius,
        camera: pipCam,
        cameraAlpha: 0,
        cameraRadius: pipRadius
      }
    case 'pip':
      return {
        screen: fullScreen,
        screenAlpha: 1,
        screenRadius: radius,
        camera: pipCam,
        cameraAlpha: 1,
        cameraRadius: pipRadius
      }
    case 'camera': {
      const camRect = content
      // Shrink the screen toward the center as it fades out.
      const s = fullScreen
      const shrunk: Rect = { x: s.x + s.w * 0.1, y: s.y + s.h * 0.1, w: s.w * 0.8, h: s.h * 0.8 }
      return {
        screen: shrunk,
        screenAlpha: 0,
        screenRadius: radius,
        camera: camRect,
        cameraAlpha: 1,
        cameraRadius: radius * 1.5
      }
    }
    case 'side-by-side': {
      const gap = pad > 0 ? pad * 0.6 : 16 * unit
      const horizontal = W >= H
      if (horizontal) {
        const camW = content.w * cam.sideRatio - gap / 2
        const scrW = content.w - camW - gap
        const scrBox: Rect =
          cam.side === 'right'
            ? { x: content.x, y: content.y, w: scrW, h: content.h }
            : { x: content.x + camW + gap, y: content.y, w: scrW, h: content.h }
        const screen = fitRect(scrBox, screenAspect)
        const camH = Math.min(content.h, Math.max(screen.h, camW))
        const camX = cam.side === 'right' ? screen.x + screen.w + gap : screen.x - gap - camW
        const camera: Rect = { x: camX, y: content.y + (content.h - camH) / 2, w: camW, h: camH }
        // Center the pair horizontally.
        const left = Math.min(screen.x, camera.x)
        const right = Math.max(screen.x + screen.w, camera.x + camera.w)
        const dx = content.x + (content.w - (right - left)) / 2 - left
        screen.x += dx
        camera.x += dx
        return { screen, screenAlpha: 1, screenRadius: radius, camera, cameraAlpha: 1, cameraRadius: radius }
      }
      // Portrait: screen on top, camera below.
      const camH = content.h * cam.sideRatio - gap / 2
      const scrBox: Rect = { x: content.x, y: content.y, w: content.w, h: content.h - camH - gap }
      const screen = fitRect(scrBox, screenAspect)
      const camera: Rect = { x: content.x, y: screen.y + screen.h + gap, w: content.w, h: camH }
      const total = camera.y + camera.h - screen.y
      const dy = content.y + (content.h - total) / 2 - screen.y
      screen.y += dy
      camera.y += dy
      return { screen, screenAlpha: 1, screenRadius: radius, camera, cameraAlpha: 1, cameraRadius: radius }
    }
  }
}

/** Layout preset active at source time t. */
export function presetAt(p: Pick<Project, 'layouts' | 'defaultLayout'>, t: number): LayoutPreset {
  for (const seg of p.layouts) if (t >= seg.start && t < seg.end) return seg.layout
  return p.defaultLayout
}

const smooth = (k: number): number => k * k * (3 - 2 * k)

/**
 * Geometry at source time t, blending smoothly across layout changes.
 * Transitions are centered on each boundary.
 */
export function layoutAt(
  p: LayoutInput & Pick<Project, 'layouts' | 'defaultLayout'>,
  t: number,
  W: number,
  H: number
): LayoutGeometry {
  const half = TRANSITION_MS / 2
  // Find the nearest boundary within half a transition.
  let boundary: number | null = null
  for (const seg of p.layouts) {
    for (const b of [seg.start, seg.end]) {
      if (Math.abs(t - b) < half && (boundary === null || Math.abs(t - b) < Math.abs(t - boundary)))
        boundary = b
    }
  }
  const current = presetGeometry(presetAt(p, t), p, W, H)
  if (boundary === null) return current
  const before = presetAt(p, boundary - 1)
  const after = presetAt(p, boundary)
  if (before === after) return current
  const k = smooth(Math.min(1, Math.max(0, (t - (boundary - half)) / TRANSITION_MS)))
  const a = presetGeometry(before, p, W, H)
  const b = presetGeometry(after, p, W, H)
  return {
    screen: lerpRect(a.screen, b.screen, k),
    screenAlpha: lerp(a.screenAlpha, b.screenAlpha, k),
    screenRadius: lerp(a.screenRadius, b.screenRadius, k),
    camera: lerpRect(a.camera, b.camera, k),
    cameraAlpha: lerp(a.cameraAlpha, b.cameraAlpha, k),
    cameraRadius: lerp(a.cameraRadius, b.cameraRadius, k)
  }
}
