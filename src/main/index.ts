import { watch, type FSWatcher } from 'node:fs'
import {
  copyFile,
  mkdir,
  open,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
  type FileHandle
} from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import {
  app,
  BrowserWindow,
  clipboard,
  desktopCapturer,
  dialog,
  globalShortcut,
  ipcMain,
  shell,
  systemPreferences,
  type IpcMainInvokeEvent
} from 'electron'
import type {
  CaptureSource,
  PermissionKind,
  Permissions,
  PermissionStatus,
  RecordingConfig,
  RecordingSummary
} from '@shared/ipc'
import {
  driveCancelConnect,
  driveCancelUpload,
  driveConnect,
  driveDisconnect,
  driveStatus,
  driveUpload
} from './drive/driveService'
import { allowMediaRoot, handleMediaProtocol, registerMediaSchemePrivileges } from './mediaProtocol'
import {
  cancelRecording,
  currentSession,
  isRecording,
  recorderChunk,
  recorderError,
  recorderFinished,
  recorderPause,
  recorderReady,
  recorderResume,
  recorderStarted,
  recordingsRoot,
  requestStop,
  restartRecording,
  startRecording
} from './session'
import { getHomeWindow, openEditorWindow, showHomeWindow } from './windows'

app.setName('Spotlight Studio')
// Test hook: isolate settings/tokens from the real profile.
if (process.env['SPOTLIGHT_USER_DATA']) app.setPath('userData', process.env['SPOTLIGHT_USER_DATA'])
registerMediaSchemePrivileges()

const isMac = process.platform === 'darwin'

function mediaStatus(kind: 'screen' | 'camera' | 'microphone'): PermissionStatus {
  if (!isMac && process.platform !== 'win32') return 'granted'
  try {
    return systemPreferences.getMediaAccessStatus(kind) as PermissionStatus
  } catch {
    return 'unknown'
  }
}

function permissions(): Permissions {
  return {
    screen: mediaStatus('screen'),
    camera: mediaStatus('camera'),
    microphone: mediaStatus('microphone'),
    accessibility: isMac
      ? systemPreferences.isTrustedAccessibilityClient(false)
        ? 'granted'
        : 'denied'
      : 'granted'
  }
}

async function requestPermission(kind: PermissionKind): Promise<Permissions> {
  if (!isMac) return permissions()
  switch (kind) {
    case 'camera':
    case 'microphone':
      if (mediaStatus(kind) === 'not-determined') await systemPreferences.askForMediaAccess(kind)
      else
        void shell.openExternal(
          `x-apple.systempreferences:com.apple.preference.security?Privacy_${kind === 'camera' ? 'Camera' : 'Microphone'}`
        )
      break
    case 'screen':
      // Triggers the system prompt the first time; afterwards the user must toggle it in Settings.
      await desktopCapturer
        .getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } })
        .catch(() => [])
      if (mediaStatus('screen') !== 'granted')
        void shell.openExternal(
          'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'
        )
      break
    case 'accessibility':
      if (!systemPreferences.isTrustedAccessibilityClient(true))
        void shell.openExternal(
          'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'
        )
      break
  }
  return permissions()
}

async function getSources(): Promise<CaptureSource[]> {
  let sources: Electron.DesktopCapturerSource[]
  try {
    sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 480, height: 300 },
      fetchWindowIcons: false
    })
  } catch (err) {
    // Usually means the Screen Recording permission hasn't been granted yet.
    console.warn('[sources] unavailable:', (err as Error).message)
    return []
  }
  return sources
    .filter((s) => !s.name.startsWith('Spotlight Studio'))
    .map((s) => ({
      id: s.id,
      name: s.name,
      kind: s.id.startsWith('screen:') ? ('screen' as const) : ('window' as const),
      thumbnail: s.thumbnail.isEmpty() ? '' : s.thumbnail.toDataURL(),
      displayId: s.display_id || null
    }))
}

async function listRecordings(): Promise<RecordingSummary[]> {
  const root = recordingsRoot()
  await mkdir(root, { recursive: true })
  const entries = await readdir(root, { withFileTypes: true })
  const out: RecordingSummary[] = []
  for (const e of entries) {
    if (!e.isDirectory()) continue
    const folder = join(root, e.name)
    try {
      const metaText = await readFile(join(folder, 'recording.json'), 'utf8').catch(() => null)
      if (!metaText) continue
      const meta = JSON.parse(metaText) as { createdAt?: string }
      let name = e.name
      let durationMs: number | null = null
      let hasProject = false
      const projText = await readFile(join(folder, 'project.json'), 'utf8').catch(() => null)
      if (projText) {
        hasProject = true
        const proj = JSON.parse(projText) as { name?: string; sources?: { screen?: { durationMs?: number } } }
        name = proj.name || name
        durationMs = proj.sources?.screen?.durationMs ?? null
      }
      out.push({
        folder,
        name,
        createdAt: meta.createdAt ?? (await stat(folder)).birthtime.toISOString(),
        hasProject,
        durationMs
      })
    } catch {
      /* skip broken folders */
    }
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

// ---- file handles for streamed writes (remux / export) ----
const handles = new Map<number, FileHandle>()
let nextHandle = 1

// ---- project.json watching (live reload when edited externally, e.g. by an AI agent) ----
const watchers = new Map<string, FSWatcher>()
const lastWritten = new Map<string, string>()

function senderWindow(e: IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(e.sender)
}

function registerIpc(): void {
  ipcMain.handle('sources:list', () => getSources())
  ipcMain.handle('perm:get', () => permissions())
  ipcMain.handle('perm:request', (_e, kind: PermissionKind) => requestPermission(kind))
  ipcMain.handle('rec:start', (_e, config: RecordingConfig) => startRecording(config))
  ipcMain.handle('recordings:list', () => listRecordings())
  ipcMain.handle('recordings:reveal-root', async () => {
    await mkdir(recordingsRoot(), { recursive: true })
    await shell.openPath(recordingsRoot())
  })
  ipcMain.handle('recordings:choose', async (e) => {
    const win = senderWindow(e)
    const opts: Electron.OpenDialogOptions = {
      title: 'Open a Spotlight Studio recording',
      defaultPath: recordingsRoot(),
      properties: ['openDirectory']
    }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return res.canceled ? null : res.filePaths[0]
  })
  ipcMain.handle('editor:open', (_e, folder: string) => {
    allowMediaRoot(folder)
    openEditorWindow(folder)
    getHomeWindow()?.hide()
  })

  ipcMain.handle('rec:session', () => currentSession())
  ipcMain.handle('rec:ready', () => recorderReady())
  ipcMain.handle('rec:started', (_e, info) => recorderStarted(info))
  ipcMain.handle('rec:chunk', (_e, track: 'screen' | 'camera', data: ArrayBuffer) =>
    recorderChunk(track, data)
  )
  ipcMain.handle('rec:pause', () => recorderPause())
  ipcMain.handle('rec:resume', () => recorderResume())
  ipcMain.handle('rec:finished', () => recorderFinished())
  ipcMain.handle('rec:cancel', () => cancelRecording())
  ipcMain.handle('rec:restart', () => restartRecording())
  ipcMain.handle('rec:error', (_e, message: string) => recorderError(message))

  ipcMain.handle('fs:read-text', async (_e, path: string) => readFile(path, 'utf8').catch(() => null))
  ipcMain.handle('fs:write-text', async (_e, path: string, text: string) => {
    if (basename(path) === 'project.json') lastWritten.set(path, text)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, text)
  })
  ipcMain.handle('fs:exists', async (_e, path: string) =>
    stat(path).then(
      () => true,
      () => false
    )
  )
  ipcMain.handle('fs:remove', async (_e, path: string) => rm(path, { force: true }))
  ipcMain.handle('fs:open', async (_e, path: string) => {
    const h = await open(path, 'w')
    const id = nextHandle++
    handles.set(id, h)
    return id
  })
  ipcMain.handle('fs:write', async (_e, id: number, position: number, data: Uint8Array) => {
    const h = handles.get(id)
    if (!h) throw new Error('Invalid file handle')
    await h.write(data, 0, data.byteLength, position)
  })
  ipcMain.handle('fs:close', async (_e, id: number) => {
    const h = handles.get(id)
    handles.delete(id)
    await h?.close()
  })
  ipcMain.handle('dialog:export-path', async (e, defaultName: string) => {
    // Test hook: skip the save dialog.
    if (process.env['SPOTLIGHT_EXPORT_PATH']) return process.env['SPOTLIGHT_EXPORT_PATH']
    const win = senderWindow(e)
    const opts: Electron.SaveDialogOptions = {
      title: 'Export video',
      defaultPath: join(app.getPath('desktop'), defaultName),
      filters: [{ name: 'MP4 video', extensions: ['mp4'] }]
    }
    const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    return res.canceled || !res.filePath ? null : res.filePath
  })
  ipcMain.handle('dialog:image', async (e) => {
    const win = senderWindow(e)
    const opts: Electron.OpenDialogOptions = {
      title: 'Choose a background image',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
    }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return res.canceled ? null : res.filePaths[0]
  })
  ipcMain.handle('fs:copy-into', async (_e, folder: string, src: string, destName: string) => {
    await copyFile(src, join(folder, destName))
    return destName
  })
  ipcMain.handle('shell:reveal', (_e, path: string) => shell.showItemInFolder(path))
  ipcMain.handle('project:watch', (e, folder: string) => {
    const path = join(folder, 'project.json')
    watchers.get(path)?.close()
    let timer: NodeJS.Timeout | null = null
    const sender = e.sender
    try {
      const w = watch(folder, (_event, file) => {
        if (file !== 'project.json') return
        if (timer) clearTimeout(timer)
        timer = setTimeout(async () => {
          const text = await readFile(path, 'utf8').catch(() => null)
          if (text === null || text === lastWritten.get(path) || sender.isDestroyed()) return
          lastWritten.set(path, text)
          sender.send('project:changed', text)
        }, 150)
      })
      watchers.set(path, w)
      sender.once('destroyed', () => {
        w.close()
        watchers.delete(path)
      })
    } catch (err) {
      console.warn('[watch] failed', err)
    }
  })
  ipcMain.handle('clipboard:write', (_e, text: string) => clipboard.writeText(text))
  ipcMain.handle('shell:open-external', (_e, url: string) => {
    if (/^https:\/\/(drive|docs)\.google\.com\//.test(url)) return shell.openExternal(url)
  })
  ipcMain.handle('drive:status', () => driveStatus())
  ipcMain.handle('drive:connect', () => driveConnect())
  ipcMain.handle('drive:cancel-connect', () => driveCancelConnect())
  ipcMain.handle('drive:disconnect', () => driveDisconnect())
  ipcMain.handle(
    'drive:upload',
    (e, uploadId: string, path: string, opts: { name?: string; share: boolean }) =>
      driveUpload(e.sender, uploadId, path, opts)
  )
  ipcMain.handle('drive:cancel-upload', (_e, uploadId: string) => driveCancelUpload(uploadId))
  ipcMain.on('win:set-title', (e, title: string) => {
    BrowserWindow.fromWebContents(e.sender)?.setTitle(title)
  })
}

app.whenReady().then(() => {
  allowMediaRoot(recordingsRoot())
  handleMediaProtocol()
  registerIpc()

  // Test hook: open the editor directly on a fixture project.
  const openFolder = process.env['SPOTLIGHT_OPEN_FOLDER']
  if (openFolder) {
    allowMediaRoot(openFolder)
    openEditorWindow(openFolder)
  } else {
    showHomeWindow()
  }

  globalShortcut.register('CommandOrControl+Shift+R', () => {
    if (isRecording()) requestStop()
    else {
      const home = showHomeWindow()
      home.webContents.send('home:shortcut-start')
    }
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) showHomeWindow()
  })
})

app.on('will-quit', () => globalShortcut.unregisterAll())

app.on('window-all-closed', () => {
  if (!isMac) app.quit()
})
