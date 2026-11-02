/** Types shared between the main process, preload and renderer. */

export interface CaptureSource {
  id: string
  name: string
  kind: 'screen' | 'window'
  /** PNG data URL thumbnail. */
  thumbnail: string
  /** Electron display id for screen sources. */
  displayId: string | null
}

export type PermissionStatus = 'granted' | 'denied' | 'not-determined' | 'restricted' | 'unknown'

export interface Permissions {
  screen: PermissionStatus
  camera: PermissionStatus
  microphone: PermissionStatus
  /** Needed to capture mouse clicks and keyboard shortcuts. */
  accessibility: PermissionStatus
}

export type PermissionKind = keyof Permissions

export interface RecordingConfig {
  sourceId: string
  sourceKind: 'screen' | 'window'
  sourceName: string
  displayId: string | null
  cameraDeviceId: string | null
  micDeviceId: string | null
  showCameraBubble: boolean
  recordKeys: boolean
}

export interface RecordingSession {
  config: RecordingConfig
  folder: string
  /** Display size in physical pixels (used to request full-resolution capture). */
  capture: { width: number; height: number }
}

export interface RecorderStartedInfo {
  screenMime: string
  cameraMime: string | null
  /** Date.now() when each MediaRecorder fired its start event. */
  screenStartedAt: number
  cameraStartedAt: number | null
}

export interface RecordingSummary {
  folder: string
  name: string
  createdAt: string
  /** file:// style media URL to a thumbnail-able video, if any. */
  hasProject: boolean
  durationMs: number | null
}

/** recording.json — written once when recording stops. */
export interface RecordingMeta {
  version: 1
  createdAt: string
  source: { kind: 'screen' | 'window'; name: string }
  screen: { file: string; mime: string }
  camera: { file: string; mime: string; offsetMs: number } | null
  hasCursor: boolean
}

export interface DriveStatus {
  /** False when this build has no Google OAuth client configured. */
  configured: boolean
  connected: boolean
  email: string | null
}

export interface DriveUploadResult {
  id: string
  /** Google Drive web link to the file. */
  link: string
  shared: boolean
}

export interface DriveProgress {
  uploadId: string
  sent: number
  total: number
}

export const MEDIA_SCHEME = 'ss-media'

/** URL the renderer can use to stream a local file (supports range requests). */
export function mediaUrl(absPath: string): string {
  return `${MEDIA_SCHEME}://local/${encodeURIComponent(absPath)}`
}

export interface Api {
  platform: string
  // Home
  getSources(): Promise<CaptureSource[]>
  getPermissions(): Promise<Permissions>
  requestPermission(kind: PermissionKind): Promise<Permissions>
  startRecording(config: RecordingConfig): Promise<void>
  listRecordings(): Promise<RecordingSummary[]>
  openEditor(folder: string): Promise<void>
  openRecordingsFolder(): Promise<void>
  chooseRecordingFolder(): Promise<string | null>
  onShortcutStart(cb: () => void): () => void
  onHomeError(cb: (message: string) => void): () => void

  // Recorder (control bar)
  getSession(): Promise<RecordingSession | null>
  recorderReady(): Promise<void>
  onRecorderBegin(cb: () => void): () => void
  onRecorderStopRequest(cb: () => void): () => void
  recorderStarted(info: RecorderStartedInfo): Promise<void>
  recorderChunk(track: 'screen' | 'camera', data: ArrayBuffer): Promise<void>
  recorderPause(): Promise<void>
  recorderResume(): Promise<void>
  recorderFinished(): Promise<void>
  recorderCancel(): Promise<void>
  recorderRestart(): Promise<void>
  recorderError(message: string): Promise<void>

  // Editor / files
  getEditorFolder(): string | null
  readText(path: string): Promise<string | null>
  writeText(path: string, text: string): Promise<void>
  exists(path: string): Promise<boolean>
  removeFile(path: string): Promise<void>
  fileOpen(path: string): Promise<number>
  fileWrite(handle: number, position: number, data: Uint8Array): Promise<void>
  fileClose(handle: number): Promise<void>
  chooseExportPath(defaultName: string): Promise<string | null>
  chooseImage(): Promise<string | null>
  copyInto(folder: string, srcPath: string, destName: string): Promise<string>
  reveal(path: string): Promise<void>
  watchProject(folder: string): Promise<void>
  onProjectChanged(cb: (text: string) => void): () => void
  setTitle(title: string): void
  copyText(text: string): Promise<void>
  openExternal(url: string): Promise<void>

  // Google Drive
  driveStatus(): Promise<DriveStatus>
  driveConnect(): Promise<DriveStatus>
  driveCancelConnect(): Promise<void>
  driveDisconnect(): Promise<DriveStatus>
  driveUpload(
    uploadId: string,
    path: string,
    opts: { name?: string; share: boolean }
  ): Promise<DriveUploadResult>
  driveCancelUpload(uploadId: string): Promise<void>
  onDriveProgress(cb: (p: DriveProgress) => void): () => void
}

declare global {
  interface Window {
    api: Api
  }
}
