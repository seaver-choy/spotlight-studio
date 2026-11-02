/**
 * Records the cursor position (60 Hz), mouse clicks and keyboard shortcuts while
 * recording a display. Positions are normalized to the captured display.
 *
 * Clicks and keys come from uiohook-napi, which on macOS requires the Accessibility
 * permission. Without it we still record cursor movement (auto-zoom then has no clicks
 * to work from, but cursor effects still work).
 */
import { screen, systemPreferences, type Rectangle } from 'electron'
import type { CursorData } from '@shared/project'

type Hook = typeof import('uiohook-napi')

let hookModule: Hook | null | undefined

function loadHook(): Hook | null {
  if (hookModule !== undefined) return hookModule
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    hookModule = require('uiohook-napi') as Hook
  } catch (err) {
    console.warn('[cursor] uiohook-napi unavailable, click tracking disabled', err)
    hookModule = null
  }
  return hookModule
}

export function canTrackInput(): boolean {
  if (process.platform === 'darwin' && !systemPreferences.isTrustedAccessibilityClient(false)) return false
  return loadHook() !== null
}

const MODIFIER_KEYS = new Set([
  'Ctrl',
  'CtrlRight',
  'Alt',
  'AltRight',
  'Shift',
  'ShiftRight',
  'Meta',
  'MetaRight'
])

const KEY_LABELS: Record<string, string> = {
  Space: 'Space',
  Enter: '↩',
  Backspace: '⌫',
  Delete: '⌦',
  Escape: 'Esc',
  Tab: '⇥',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  BracketLeft: '[',
  BracketRight: ']',
  Minus: '-',
  Equal: '=',
  Backquote: '`'
}

export class CursorTracker {
  private samples: CursorData['samples'] = []
  private clicks: CursorData['clicks'] = []
  private keys: CursorData['keys'] = []
  private timer: NodeJS.Timeout | null = null
  private startedAt = 0
  private pausedAt: number | null = null
  private pausedTotal = 0
  private hookActive = false
  private keyNames: Map<number, string> | null = null

  constructor(
    private readonly bounds: Rectangle,
    private readonly recordKeys: boolean
  ) {}

  /** Milliseconds of recorded (unpaused) time. */
  private now(): number {
    return Date.now() - this.startedAt - this.pausedTotal
  }

  private normalized(): { x: number; y: number } {
    const p = screen.getCursorScreenPoint()
    const b = this.bounds
    return { x: (p.x - b.x) / b.width, y: (p.y - b.y) / b.height }
  }

  private round(n: number): number {
    return Math.round(n * 10000) / 10000
  }

  private onMouseDown = (e: { button: unknown }): void => {
    if (this.pausedAt !== null) return
    const p = this.normalized()
    this.clicks.push({ t: this.now(), x: this.round(p.x), y: this.round(p.y), button: Number(e.button) || 1 })
  }

  private onKeyDown = (e: {
    keycode: number
    metaKey: boolean
    ctrlKey: boolean
    altKey: boolean
    shiftKey: boolean
  }): void => {
    if (this.pausedAt !== null || !this.keyNames) return
    if (!e.metaKey && !e.ctrlKey && !e.altKey) return // never log plain typing
    const name = this.keyNames.get(e.keycode)
    if (!name || MODIFIER_KEYS.has(name)) return
    const mods = `${e.ctrlKey ? '⌃' : ''}${e.altKey ? '⌥' : ''}${e.shiftKey ? '⇧' : ''}${e.metaKey ? '⌘' : ''}`
    const key = KEY_LABELS[name] ?? (name.length === 1 ? name.toUpperCase() : name)
    this.keys.push({ t: this.now(), label: `${mods}${key}` })
  }

  /** `startedAt` is the Date.now() at which the screen recorder started. */
  start(startedAt: number): void {
    this.startedAt = startedAt
    this.timer = setInterval(() => {
      if (this.pausedAt !== null) return
      const p = this.normalized()
      this.samples.push([this.now(), this.round(p.x), this.round(p.y)])
    }, 1000 / 60)

    if (canTrackInput()) {
      const mod = loadHook()!
      this.keyNames = new Map(Object.entries(mod.UiohookKey).map(([k, v]) => [v as number, k]))
      mod.uIOhook.on('mousedown', this.onMouseDown)
      if (this.recordKeys) mod.uIOhook.on('keydown', this.onKeyDown)
      try {
        mod.uIOhook.start()
        this.hookActive = true
      } catch (err) {
        console.warn('[cursor] failed to start input hook', err)
      }
    }
  }

  pause(): void {
    if (this.pausedAt === null) this.pausedAt = Date.now()
  }

  resume(): void {
    if (this.pausedAt !== null) {
      this.pausedTotal += Date.now() - this.pausedAt
      this.pausedAt = null
    }
  }

  stop(): CursorData {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    if (this.hookActive) {
      const mod = loadHook()!
      mod.uIOhook.off('mousedown', this.onMouseDown)
      mod.uIOhook.off('keydown', this.onKeyDown)
      try {
        mod.uIOhook.stop()
      } catch {
        /* already stopped */
      }
      this.hookActive = false
    }
    return { version: 1, samples: this.samples, clicks: this.clicks, keys: this.keys }
  }
}
