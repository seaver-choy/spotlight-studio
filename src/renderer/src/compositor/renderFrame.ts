/**
 * The compositor. Draws one output frame for a given source time. The editor preview
 * and the exporter both call this, so what you see is exactly what you export.
 */
import type { Annotation, CursorData, Project } from '@shared/project'
import { layoutAt, type Rect } from '@shared/layout'
import { applyView, cursorAt, ZoomCamera, type Point, type ZoomView } from '@shared/zoom'

export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

export interface FrameImage {
  image: CanvasImageSource
  width: number
  height: number
}

export interface FrameInputs {
  screen: FrameImage | null
  camera: FrameImage | null
  backgroundImage: FrameImage | null
}

export interface Scene {
  project: Project
  cursor: CursorData | null
  zoom: ZoomCamera
}

export function createScene(project: Project, cursor: CursorData | null): Scene {
  return { project, cursor, zoom: new ZoomCamera(project.zooms, cursor) }
}

const RIPPLE_MS = 650
const KEY_MS = 1600
const FADE_MS = 160

let scratch: OffscreenCanvas | null = null
function scratchCtx(w: number, h: number): OffscreenCanvasRenderingContext2D {
  if (!scratch) scratch = new OffscreenCanvas(w, h)
  if (scratch.width !== w || scratch.height !== h) {
    scratch.width = w
    scratch.height = h
  }
  return scratch.getContext('2d')!
}

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '')
  const full =
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h.slice(0, 6)
  const n = parseInt(full, 16)
  if (Number.isNaN(n)) return `rgba(255,255,255,${alpha})`
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`
}

function drawBackground(ctx: Ctx2D, W: number, H: number, p: Project, img: FrameImage | null): void {
  const bg = p.background
  if (bg.type === 'image' && img) {
    drawCover(ctx, img, { x: 0, y: 0, w: W, h: H })
    return
  }
  if (bg.type === 'solid') {
    ctx.fillStyle = bg.colors[0]
    ctx.fillRect(0, 0, W, H)
    return
  }
  const a = (bg.angle * Math.PI) / 180
  const dx = Math.sin(a)
  const dy = -Math.cos(a)
  const len = Math.abs(W * dx) + Math.abs(H * dy)
  const g = ctx.createLinearGradient(
    W / 2 - (dx * len) / 2,
    H / 2 - (dy * len) / 2,
    W / 2 + (dx * len) / 2,
    H / 2 + (dy * len) / 2
  )
  g.addColorStop(0, bg.colors[0])
  g.addColorStop(1, bg.colors[1])
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)
}

/** Draw an image covering `r` (center crop). */
function drawCover(ctx: Ctx2D, img: FrameImage, r: Rect, mirror = false): void {
  const ia = img.width / img.height
  const ra = r.w / r.h
  let sw = img.width
  let sh = img.height
  if (ia > ra) sw = img.height * ra
  else sh = img.width / ra
  const sx = (img.width - sw) / 2
  const sy = (img.height - sh) / 2
  if (mirror) {
    ctx.save()
    ctx.translate(r.x + r.w, r.y)
    ctx.scale(-1, 1)
    ctx.drawImage(img.image, sx, sy, sw, sh, 0, 0, r.w, r.h)
    ctx.restore()
  } else {
    ctx.drawImage(img.image, sx, sy, sw, sh, r.x, r.y, r.w, r.h)
  }
}

function roundedPath(ctx: Ctx2D, r: Rect, radius: number): void {
  ctx.beginPath()
  ctx.roundRect(r.x, r.y, r.w, r.h, Math.max(0, Math.min(radius, r.w / 2, r.h / 2)))
}

function fadeAlpha(t: number, start: number, end: number): number {
  return Math.max(0, Math.min(1, (t - start) / FADE_MS, (end - t) / FADE_MS))
}

/** Converts normalized screen coordinates into output pixels under the current zoom. */
function mapper(view: ZoomView, R: Rect): (p: Point) => Point {
  return (p) => {
    const q = applyView(view, p)
    return { x: R.x + q.x * R.w, y: R.y + q.y * R.h }
  }
}

function drawArrow(ctx: Ctx2D, a: Point, b: Point, width: number, color: string): void {
  const ang = Math.atan2(b.y - a.y, b.x - a.x)
  const head = Math.max(width * 3.2, 14)
  const shaftEnd = { x: b.x - Math.cos(ang) * head * 0.8, y: b.y - Math.sin(ang) * head * 0.8 }
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = width
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(a.x, a.y)
  ctx.lineTo(shaftEnd.x, shaftEnd.y)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(b.x, b.y)
  ctx.lineTo(b.x - Math.cos(ang - 0.45) * head, b.y - Math.sin(ang - 0.45) * head)
  ctx.lineTo(b.x - Math.cos(ang + 0.45) * head, b.y - Math.sin(ang + 0.45) * head)
  ctx.closePath()
  ctx.fill()
}

function boxRect(a: Annotation, map: (p: Point) => Point): Rect {
  const p0 = map({ x: Math.min(a.x, a.x + a.w), y: Math.min(a.y, a.y + a.h) })
  const p1 = map({ x: Math.max(a.x, a.x + a.w), y: Math.max(a.y, a.y + a.h) })
  return { x: p0.x, y: p0.y, w: p1.x - p0.x, h: p1.y - p0.y }
}

/** Annotations that sit inside the screen (clipped): blur and highlight. */
function drawClippedAnnotations(
  ctx: Ctx2D,
  list: Annotation[],
  t: number,
  R: Rect,
  map: (p: Point) => Point,
  screen: FrameImage,
  u: number
): void {
  for (const a of list) {
    if (t < a.start || t > a.end) continue
    const alpha = fadeAlpha(t, a.start, a.end)
    const box = boxRect(a, map)
    if (a.kind === 'blur') {
      // Pixelate the source region (robust redaction, deterministic).
      const sx = Math.max(0, Math.min(a.x, a.x + a.w)) * screen.width
      const sy = Math.max(0, Math.min(a.y, a.y + a.h)) * screen.height
      const sw = Math.abs(a.w) * screen.width
      const sh = Math.abs(a.h) * screen.height
      if (sw < 1 || sh < 1) continue
      const block = 14 * u
      const tw = Math.max(1, Math.round(box.w / block))
      const th = Math.max(1, Math.round(box.h / block))
      const sc = scratchCtx(tw, th)
      sc.imageSmoothingEnabled = true
      sc.drawImage(screen.image, sx, sy, sw, sh, 0, 0, tw, th)
      ctx.save()
      ctx.globalAlpha *= alpha
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(scratch!, 0, 0, tw, th, box.x, box.y, box.w, box.h)
      ctx.restore()
    } else if (a.kind === 'highlight') {
      ctx.save()
      ctx.globalAlpha *= alpha
      ctx.beginPath()
      ctx.rect(R.x, R.y, R.w, R.h)
      ctx.roundRect(box.x, box.y, box.w, box.h, 10 * u)
      ctx.fillStyle = 'rgba(0,0,0,0.55)'
      ctx.fill('evenodd')
      ctx.lineWidth = 3 * u
      ctx.strokeStyle = hexToRgba(a.color, 0.95)
      roundedPath(ctx, box, 10 * u)
      ctx.stroke()
      ctx.restore()
    }
  }
}

/** Annotations drawn on top of everything (may extend beyond the screen). */
function drawOverlayAnnotations(
  ctx: Ctx2D,
  list: Annotation[],
  t: number,
  map: (p: Point) => Point,
  u: number
): void {
  for (const a of list) {
    if (t < a.start || t > a.end) continue
    const alpha = fadeAlpha(t, a.start, a.end)
    ctx.save()
    ctx.globalAlpha *= alpha
    if (a.kind === 'rect') {
      const box = boxRect(a, map)
      ctx.lineWidth = a.strokeWidth * u
      ctx.strokeStyle = a.color
      roundedPath(ctx, box, 10 * u)
      ctx.stroke()
    } else if (a.kind === 'arrow') {
      drawArrow(ctx, map({ x: a.x, y: a.y }), map({ x: a.x + a.w, y: a.y + a.h }), a.strokeWidth * u, a.color)
    } else if (a.kind === 'text' && a.text.trim()) {
      const p = map({ x: a.x, y: a.y })
      const size = a.fontSize * u
      ctx.font = `600 ${size}px -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif`
      const lines = a.text.split('\n')
      const widths = lines.map((l) => ctx.measureText(l).width)
      const padX = size * 0.6
      const padY = size * 0.4
      const lh = size * 1.25
      const bw = Math.max(...widths) + padX * 2
      const bh = lines.length * lh + padY * 2 - (lh - size)
      ctx.shadowColor = 'rgba(0,0,0,0.35)'
      ctx.shadowBlur = 18 * u
      ctx.shadowOffsetY = 6 * u
      ctx.fillStyle = a.color
      ctx.beginPath()
      ctx.roundRect(p.x, p.y, bw, bh, size * 0.45)
      ctx.fill()
      ctx.shadowColor = 'transparent'
      ctx.fillStyle = '#FFFFFF'
      ctx.textBaseline = 'top'
      lines.forEach((l, i) => ctx.fillText(l, p.x + padX, p.y + padY + i * lh))
    }
    ctx.restore()
  }
}

function drawCursorFx(
  ctx: Ctx2D,
  scene: Scene,
  t: number,
  R: Rect,
  view: ZoomView,
  map: (p: Point) => Point,
  u: number
): void {
  const { project, cursor } = scene
  const fx = project.cursorFx
  if (!cursor) return
  const pos = cursorAt(cursor, t)

  if (fx.spotlight && pos) {
    const c = map(pos)
    const r = fx.spotlightRadius * R.w * view.scale
    const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, r)
    g.addColorStop(0, 'rgba(0,0,0,0)')
    g.addColorStop(0.72, 'rgba(0,0,0,0)')
    g.addColorStop(1, `rgba(0,0,0,${fx.spotlightDim})`)
    ctx.fillStyle = g
    ctx.fillRect(R.x, R.y, R.w, R.h)
  }

  if (fx.glow && pos) {
    const c = map(pos)
    const r = 34 * u * Math.sqrt(view.scale)
    const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, r)
    g.addColorStop(0, hexToRgba(fx.glowColor, 0.55))
    g.addColorStop(0.6, hexToRgba(fx.glowColor, 0.25))
    g.addColorStop(1, hexToRgba(fx.glowColor, 0))
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(c.x, c.y, r, 0, Math.PI * 2)
    ctx.fill()
  }

  if (fx.clickRipple) {
    for (const c of cursor.clicks) {
      const dt = t - c.t
      if (dt < 0 || dt > RIPPLE_MS) continue
      const k = dt / RIPPLE_MS
      const ease = 1 - Math.pow(1 - k, 3)
      const p = map(c)
      const base = u * Math.sqrt(view.scale)
      ctx.save()
      ctx.globalAlpha *= 1 - k
      ctx.strokeStyle = fx.rippleColor
      ctx.lineWidth = 4 * base
      ctx.beginPath()
      ctx.arc(p.x, p.y, (8 + 38 * ease) * base, 0, Math.PI * 2)
      ctx.stroke()
      ctx.fillStyle = hexToRgba(fx.rippleColor, 0.35 * (1 - k))
      ctx.beginPath()
      ctx.arc(p.x, p.y, (6 + 14 * ease) * base, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }
  }
}

function drawKeystrokes(ctx: Ctx2D, scene: Scene, t: number, W: number, H: number, u: number): void {
  if (!scene.project.cursorFx.keystrokes || !scene.cursor) return
  let key: { t: number; label: string } | null = null
  for (const k of scene.cursor.keys) {
    if (k.t <= t && t - k.t < KEY_MS) key = k
    if (k.t > t) break
  }
  if (!key) return
  const alpha = Math.min(1, (KEY_MS - (t - key.t)) / 300, (t - key.t) / 80 + 0.3)
  const size = 40 * u
  ctx.save()
  ctx.globalAlpha *= Math.max(0, alpha)
  ctx.font = `600 ${size}px -apple-system, BlinkMacSystemFont, "SF Pro Display", "Inter", sans-serif`
  const tw = ctx.measureText(key.label).width
  const bw = tw + size * 1.2
  const bh = size * 1.7
  const x = (W - bw) / 2
  const y = H - bh - Math.min(W, H) * 0.06
  ctx.fillStyle = 'rgba(20,20,24,0.82)'
  ctx.beginPath()
  ctx.roundRect(x, y, bw, bh, bh * 0.3)
  ctx.fill()
  ctx.fillStyle = '#FFFFFF'
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'center'
  ctx.fillText(key.label, W / 2, y + bh / 2 + size * 0.04)
  ctx.restore()
}

/**
 * Render the frame at source time `t` (ms) onto a W×H context.
 */
export function renderFrame(
  ctx: Ctx2D,
  W: number,
  H: number,
  scene: Scene,
  inputs: FrameInputs,
  t: number
): void {
  const { project } = scene
  const u = Math.min(W, H) / 1080
  ctx.save()
  ctx.clearRect(0, 0, W, H)
  drawBackground(ctx, W, H, project, inputs.backgroundImage)

  const geo = layoutAt(project, t, W, H)
  const R = geo.screen
  const view = scene.zoom.viewAt(t)
  const map = mapper(view, R)
  const active = project.annotations

  if (geo.screenAlpha > 0.001) {
    ctx.save()
    ctx.globalAlpha = geo.screenAlpha
    if (project.background.shadow > 0) {
      ctx.save()
      ctx.shadowColor = `rgba(0,0,0,${0.55 * project.background.shadow})`
      ctx.shadowBlur = 50 * u * project.background.shadow
      ctx.shadowOffsetY = 18 * u * project.background.shadow
      ctx.fillStyle = '#000'
      roundedPath(ctx, R, geo.screenRadius)
      ctx.fill()
      ctx.restore()
    }
    roundedPath(ctx, R, geo.screenRadius)
    ctx.clip()
    if (inputs.screen) {
      const s = inputs.screen
      const sw = s.width / view.scale
      const sh = s.height / view.scale
      const sx = (view.cx - 0.5 / view.scale) * s.width
      const sy = (view.cy - 0.5 / view.scale) * s.height
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(s.image, sx, sy, sw, sh, R.x, R.y, R.w, R.h)
      drawClippedAnnotations(ctx, active, t, R, map, s, u)
    } else {
      ctx.fillStyle = '#111'
      ctx.fillRect(R.x, R.y, R.w, R.h)
    }
    drawCursorFx(ctx, scene, t, R, view, map, u)
    ctx.restore()

    ctx.save()
    ctx.globalAlpha = geo.screenAlpha
    drawOverlayAnnotations(ctx, active, t, map, u)
    ctx.restore()
  }

  if (inputs.camera && geo.cameraAlpha > 0.001) {
    const C = geo.camera
    const cam = project.camera
    ctx.save()
    ctx.globalAlpha = geo.cameraAlpha
    ctx.shadowColor = 'rgba(0,0,0,0.4)'
    ctx.shadowBlur = 30 * u
    ctx.shadowOffsetY = 10 * u
    ctx.fillStyle = '#000'
    roundedPath(ctx, C, geo.cameraRadius)
    ctx.fill()
    ctx.shadowColor = 'transparent'
    ctx.save()
    roundedPath(ctx, C, geo.cameraRadius)
    ctx.clip()
    drawCover(ctx, inputs.camera, C, cam.mirror)
    ctx.restore()
    if (cam.borderWidth > 0) {
      ctx.lineWidth = cam.borderWidth * u
      ctx.strokeStyle = cam.borderColor
      roundedPath(ctx, C, geo.cameraRadius)
      ctx.stroke()
    }
    ctx.restore()
  }

  drawKeystrokes(ctx, scene, t, W, H, u)
  ctx.restore()
}
