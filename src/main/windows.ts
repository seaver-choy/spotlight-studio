import { join } from 'node:path'
import { BrowserWindow, screen, shell, type Display } from 'electron'

const isMac = process.platform === 'darwin'

function load(win: BrowserWindow, route: string, query: Record<string, string> = {}): void {
  const qs = new URLSearchParams(query).toString()
  const hash = `/${route}${qs ? `?${qs}` : ''}`
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) void win.loadURL(`${devUrl}#${hash}`)
  else void win.loadFile(join(__dirname, '../renderer/index.html'), { hash })
}

function prefs(extra: Electron.WebPreferences = {}): Electron.WebPreferences {
  return {
    preload: join(__dirname, '../preload/index.js'),
    sandbox: true,
    contextIsolation: true,
    ...extra
  }
}

function openExternalLinks(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
}

let home: BrowserWindow | null = null

export function getHomeWindow(): BrowserWindow | null {
  return home && !home.isDestroyed() ? home : null
}

export function showHomeWindow(): BrowserWindow {
  const existing = getHomeWindow()
  if (existing) {
    existing.show()
    existing.focus()
    return existing
  }
  home = new BrowserWindow({
    width: 980,
    height: 720,
    minWidth: 820,
    minHeight: 600,
    title: 'Spotlight Studio',
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    backgroundColor: '#0E0E12',
    show: false,
    webPreferences: prefs()
  })
  home.once('ready-to-show', () => home?.show())
  home.on('closed', () => (home = null))
  openExternalLinks(home)
  load(home, 'home')
  return home
}

const editors = new Map<string, BrowserWindow>()

export function openEditorWindow(folder: string): BrowserWindow {
  const existing = editors.get(folder)
  if (existing && !existing.isDestroyed()) {
    existing.show()
    existing.focus()
    return existing
  }
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 700,
    title: 'Spotlight Studio — Editor',
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    backgroundColor: '#0E0E12',
    show: false,
    webPreferences: prefs({ backgroundThrottling: false })
  })
  win.once('ready-to-show', () => win.show())
  win.on('closed', () => editors.delete(folder))
  openExternalLinks(win)
  editors.set(folder, win)
  load(win, 'editor', { folder })
  return win
}

/** Floating windows that must never appear in the recording. */
function overlayWindow(opts: Electron.BrowserWindowConstructorOptions): BrowserWindow {
  const win = new BrowserWindow({
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    show: false,
    backgroundColor: '#00000000',
    ...opts,
    webPreferences: prefs({ backgroundThrottling: false })
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  // Excludes the window from screen capture (macOS / Windows).
  win.setContentProtection(true)
  return win
}

export function createControlBar(display: Display): BrowserWindow {
  const w = 420
  const h = 64
  const { x, y, width, height } = display.workArea
  const win = overlayWindow({
    width: w,
    height: h,
    x: Math.round(x + (width - w) / 2),
    y: y + height - h - 24
  })
  load(win, 'bar')
  win.once('ready-to-show', () => win.showInactive())
  return win
}

export function createCameraBubble(display: Display, cameraDeviceId: string): BrowserWindow {
  const size = 220
  const { x, y, height } = display.workArea
  const win = overlayWindow({ width: size, height: size, x: x + 32, y: y + height - size - 32 })
  load(win, 'bubble', { camera: cameraDeviceId })
  win.once('ready-to-show', () => win.showInactive())
  return win
}

export function createCountdown(display: Display): BrowserWindow {
  const size = 240
  const { x, y, width, height } = display.bounds
  const win = overlayWindow({
    width: size,
    height: size,
    x: Math.round(x + (width - size) / 2),
    y: Math.round(y + (height - size) / 2),
    focusable: false
  })
  win.setIgnoreMouseEvents(true)
  load(win, 'countdown')
  win.once('ready-to-show', () => win.showInactive())
  return win
}

export function displayById(id: string | null): Display {
  const all = screen.getAllDisplays()
  return all.find((d) => String(d.id) === id) ?? screen.getPrimaryDisplay()
}
