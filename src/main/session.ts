/**
 * Recording session lifecycle: folder creation, overlay windows, chunked file writes,
 * cursor tracking, and handing the finished recording to the editor.
 */
import { createWriteStream, type WriteStream } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { app, BrowserWindow, type Display } from 'electron'
import type { RecorderStartedInfo, RecordingConfig, RecordingMeta, RecordingSession } from '@shared/ipc'
import { AGENTS_MD } from './agentsDoc'
import { CursorTracker } from './cursorTracker'
import { allowMediaRoot } from './mediaProtocol'
import {
  createCameraBubble,
  createControlBar,
  createCountdown,
  displayById,
  getHomeWindow,
  openEditorWindow,
  showHomeWindow
} from './windows'

export function recordingsRoot(): string {
  try {
    return join(app.getPath('videos'), 'Spotlight Studio')
  } catch {
    return join(homedir(), 'Movies', 'Spotlight Studio')
  }
}

function timestampName(d = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}.${p(d.getSeconds())}`
}

function extFor(mime: string): string {
  return mime.includes('mp4') ? 'mp4' : 'webm'
}

interface Active {
  session: RecordingSession
  display: Display
  bar: BrowserWindow
  bubble: BrowserWindow | null
  countdown: BrowserWindow | null
  tracker: CursorTracker | null
  started: RecorderStartedInfo | null
  streams: Partial<Record<'screen' | 'camera', WriteStream>>
  createdAt: Date
}

let active: Active | null = null

export function isRecording(): boolean {
  return active !== null
}

export function currentSession(): RecordingSession | null {
  return active?.session ?? null
}

function closeWindows(a: Active): void {
  for (const w of [a.bar, a.bubble, a.countdown]) if (w && !w.isDestroyed()) w.close()
}

export async function startRecording(config: RecordingConfig): Promise<void> {
  if (active) return
  const root = recordingsRoot()
  allowMediaRoot(root)
  const createdAt = new Date()
  const folder = join(root, timestampName(createdAt))
  await mkdir(folder, { recursive: true })

  const display = displayById(config.displayId)
  const session: RecordingSession = {
    config,
    folder,
    capture: {
      width: Math.round(display.size.width * display.scaleFactor),
      height: Math.round(display.size.height * display.scaleFactor)
    }
  }
  getHomeWindow()?.hide()
  const bar = createControlBar(display)
  const bubble =
    config.cameraDeviceId && config.showCameraBubble
      ? createCameraBubble(display, config.cameraDeviceId)
      : null
  active = {
    session,
    display,
    bar,
    bubble,
    countdown: null,
    tracker: null,
    started: null,
    streams: {},
    createdAt
  }
  bar.on('closed', () => {
    // If the bar is closed unexpectedly (e.g. crash), clean up.
    if (active?.bar === bar) void cancelRecording()
  })
}

/** Called when the control bar has acquired its media streams. Shows a 3-2-1 countdown. */
export async function recorderReady(): Promise<void> {
  const a = active
  if (!a) return
  a.countdown = createCountdown(a.display)
  await new Promise((r) => setTimeout(r, 3300))
  if (active !== a) return
  if (a.countdown && !a.countdown.isDestroyed()) a.countdown.close()
  a.countdown = null
  a.bar.webContents.send('recorder:begin')
}

export function recorderStarted(info: RecorderStartedInfo): void {
  const a = active
  if (!a) return
  a.started = info
  a.streams.screen = createWriteStream(join(a.session.folder, `screen.raw.${extFor(info.screenMime)}`))
  if (info.cameraMime)
    a.streams.camera = createWriteStream(join(a.session.folder, `camera.raw.${extFor(info.cameraMime)}`))
  if (a.session.config.sourceKind === 'screen') {
    a.tracker = new CursorTracker(a.display.bounds, a.session.config.recordKeys)
    a.tracker.start(info.screenStartedAt)
  }
}

export function recorderChunk(track: 'screen' | 'camera', data: ArrayBuffer): Promise<void> {
  const stream = active?.streams[track]
  if (!stream) return Promise.resolve()
  return new Promise((resolve, reject) => {
    stream.write(Buffer.from(data), (err) => (err ? reject(err) : resolve()))
  })
}

export function recorderPause(): void {
  active?.tracker?.pause()
}

export function recorderResume(): void {
  active?.tracker?.resume()
}

function endStream(s: WriteStream | undefined): Promise<void> {
  return new Promise((resolve) => (s ? s.end(() => resolve()) : resolve()))
}

export async function recorderFinished(): Promise<void> {
  const a = active
  if (!a || !a.started) return
  active = null
  const cursor = a.tracker?.stop() ?? null
  await Promise.all([endStream(a.streams.screen), endStream(a.streams.camera)])
  const info = a.started
  const meta: RecordingMeta = {
    version: 1,
    createdAt: a.createdAt.toISOString(),
    source: { kind: a.session.config.sourceKind, name: a.session.config.sourceName },
    screen: { file: `screen.raw.${extFor(info.screenMime)}`, mime: info.screenMime },
    camera:
      info.cameraMime && info.cameraStartedAt
        ? {
            file: `camera.raw.${extFor(info.cameraMime)}`,
            mime: info.cameraMime,
            offsetMs: info.cameraStartedAt - info.screenStartedAt
          }
        : null,
    hasCursor: !!cursor
  }
  const folder = a.session.folder
  if (cursor) await writeFile(join(folder, 'cursor.json'), JSON.stringify(cursor))
  await writeFile(join(folder, 'recording.json'), JSON.stringify(meta, null, 2))
  await writeFile(join(folder, 'AGENTS.md'), AGENTS_MD)
  closeWindows(a)
  openEditorWindow(folder)
}

export async function cancelRecording(): Promise<void> {
  const a = active
  if (!a) return
  active = null
  a.tracker?.stop()
  await Promise.all([endStream(a.streams.screen), endStream(a.streams.camera)])
  closeWindows(a)
  await rm(a.session.folder, { recursive: true, force: true })
  showHomeWindow()
}

export async function restartRecording(): Promise<void> {
  const config = active?.session.config
  await cancelRecording()
  if (config) {
    getHomeWindow()?.hide()
    await startRecording(config)
  }
}

export async function recorderError(message: string): Promise<void> {
  console.error('[recorder]', message)
  const a = active
  await cancelRecording()
  const home = showHomeWindow()
  if (a) home.webContents.send('home:error', message)
}

export function requestStop(): void {
  active?.bar.webContents.send('recorder:stop-request')
}
