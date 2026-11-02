import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { Api } from '../shared/ipc'

function subscribe<T extends unknown[]>(channel: string, cb: (...args: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, ...args: unknown[]): void => cb(...(args as T))
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

function editorFolder(): string | null {
  const hash = (globalThis as { location?: { hash: string } }).location?.hash ?? ''
  const q = hash.indexOf('?')
  if (q < 0) return null
  return new URLSearchParams(hash.slice(q + 1)).get('folder')
}

const api: Api = {
  platform: process.platform,
  getSources: () => ipcRenderer.invoke('sources:list'),
  getPermissions: () => ipcRenderer.invoke('perm:get'),
  requestPermission: (kind) => ipcRenderer.invoke('perm:request', kind),
  startRecording: (config) => ipcRenderer.invoke('rec:start', config),
  listRecordings: () => ipcRenderer.invoke('recordings:list'),
  openEditor: (folder) => ipcRenderer.invoke('editor:open', folder),
  openRecordingsFolder: () => ipcRenderer.invoke('recordings:reveal-root'),
  chooseRecordingFolder: () => ipcRenderer.invoke('recordings:choose'),
  onShortcutStart: (cb) => subscribe('home:shortcut-start', cb),
  onHomeError: (cb) => subscribe('home:error', cb),

  getSession: () => ipcRenderer.invoke('rec:session'),
  recorderReady: () => ipcRenderer.invoke('rec:ready'),
  onRecorderBegin: (cb) => subscribe('recorder:begin', cb),
  onRecorderStopRequest: (cb) => subscribe('recorder:stop-request', cb),
  recorderStarted: (info) => ipcRenderer.invoke('rec:started', info),
  recorderChunk: (track, data) => ipcRenderer.invoke('rec:chunk', track, data),
  recorderPause: () => ipcRenderer.invoke('rec:pause'),
  recorderResume: () => ipcRenderer.invoke('rec:resume'),
  recorderFinished: () => ipcRenderer.invoke('rec:finished'),
  recorderCancel: () => ipcRenderer.invoke('rec:cancel'),
  recorderRestart: () => ipcRenderer.invoke('rec:restart'),
  recorderError: (message) => ipcRenderer.invoke('rec:error', message),

  getEditorFolder: () => editorFolder(),
  readText: (path) => ipcRenderer.invoke('fs:read-text', path),
  writeText: (path, text) => ipcRenderer.invoke('fs:write-text', path, text),
  exists: (path) => ipcRenderer.invoke('fs:exists', path),
  removeFile: (path) => ipcRenderer.invoke('fs:remove', path),
  fileOpen: (path) => ipcRenderer.invoke('fs:open', path),
  fileWrite: (handle, position, data) => ipcRenderer.invoke('fs:write', handle, position, data),
  fileClose: (handle) => ipcRenderer.invoke('fs:close', handle),
  chooseExportPath: (name) => ipcRenderer.invoke('dialog:export-path', name),
  chooseImage: () => ipcRenderer.invoke('dialog:image'),
  copyInto: (folder, src, dest) => ipcRenderer.invoke('fs:copy-into', folder, src, dest),
  reveal: (path) => ipcRenderer.invoke('shell:reveal', path),
  watchProject: (folder) => ipcRenderer.invoke('project:watch', folder),
  onProjectChanged: (cb) => subscribe('project:changed', cb),
  setTitle: (title) => ipcRenderer.send('win:set-title', title),
  copyText: (text) => ipcRenderer.invoke('clipboard:write', text),
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),

  driveStatus: () => ipcRenderer.invoke('drive:status'),
  driveConnect: () => ipcRenderer.invoke('drive:connect'),
  driveCancelConnect: () => ipcRenderer.invoke('drive:cancel-connect'),
  driveDisconnect: () => ipcRenderer.invoke('drive:disconnect'),
  driveUpload: (uploadId, path, opts) => ipcRenderer.invoke('drive:upload', uploadId, path, opts),
  driveCancelUpload: (uploadId) => ipcRenderer.invoke('drive:cancel-upload', uploadId),
  onDriveProgress: (cb) => subscribe('drive:progress', cb)
}

contextBridge.exposeInMainWorld('api', api)
