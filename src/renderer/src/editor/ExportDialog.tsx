import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, CheckCircle2, Cloud, Copy, Download, ExternalLink, Loader2, X } from 'lucide-react'
import type { DriveUploadResult } from '@shared/ipc'
import { outputSize } from '@shared/project'
import { timelineDuration } from '@shared/timeMap'
import { useDrive } from '../components/drive'
import { Button, Field, Segmented, Toggle, formatTime } from '../components/ui'
import { exportVideo, type ExportOptions } from '../export/exportVideo'
import { useEditor } from './store'

type Upload =
  | { kind: 'none' }
  | { kind: 'uploading'; sent: number; total: number }
  | { kind: 'uploaded'; result: DriveUploadResult; copied: boolean }
  | { kind: 'failed'; message: string }

type Phase =
  | { kind: 'idle' }
  | { kind: 'running'; progress: number; started: number }
  | { kind: 'done'; path: string; secs: number; upload: Upload }
  | { kind: 'error'; message: string }

interface Prefs extends ExportOptions {
  upload: boolean
  share: boolean
}

const PREFS_KEY = 'spotlight.exportPrefs'
const DEFAULTS: Prefs = { height: 1080, fps: 60, quality: 'high', upload: false, share: true }

function loadPrefs(): Prefs {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') }
  } catch {
    return DEFAULTS
  }
}

const cleanError = (e: unknown): string =>
  (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

const mb = (n: number): string => `${(n / 1024 / 1024).toFixed(n > 100 * 1024 * 1024 ? 0 : 1)} MB`

export function ExportDialog({ onClose }: { onClose: () => void }): ReactNode {
  const project = useEditor((s) => s.project)!
  const cursor = useEditor((s) => s.cursor)
  const folder = useEditor((s) => s.folder)
  const drive = useDrive()
  const [opts, setOpts] = useState<Prefs>(loadPrefs)
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const abort = useRef<AbortController | null>(null)
  const uploadId = useRef<string | null>(null)

  const driveReady = !!drive.status?.configured
  const connected = !!drive.status?.connected
  const willUpload = driveReady && opts.upload

  const set = (patch: Partial<Prefs>): void => {
    const next = { ...opts, ...patch }
    setOpts(next)
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(next))
    } catch {
      /* ignore */
    }
  }

  useEffect(
    () =>
      window.api.onDriveProgress((p) => {
        if (p.uploadId !== uploadId.current) return
        setPhase((ph) =>
          ph.kind === 'done' ? { ...ph, upload: { kind: 'uploading', sent: p.sent, total: p.total } } : ph
        )
      }),
    []
  )

  const size = outputSize(project, opts.height)
  const duration = timelineDuration(project.clips)
  const fileName = `${project.name.replace(/[/\\:*?"<>|]+/g, '-').slice(0, 80) || 'Spotlight recording'}.mp4`

  const upload = async (path: string, secs: number): Promise<void> => {
    const id = `up_${Date.now()}`
    uploadId.current = id
    setPhase({ kind: 'done', path, secs, upload: { kind: 'uploading', sent: 0, total: 1 } })
    try {
      const result = await window.api.driveUpload(id, path, { name: fileName, share: opts.share })
      await window.api.copyText(result.link)
      setPhase({ kind: 'done', path, secs, upload: { kind: 'uploaded', result, copied: true } })
    } catch (e) {
      const message = cleanError(e)
      setPhase({
        kind: 'done',
        path,
        secs,
        upload: /cancel/i.test(message) ? { kind: 'none' } : { kind: 'failed', message }
      })
    } finally {
      uploadId.current = null
    }
  }

  const run = async (): Promise<void> => {
    if (willUpload && !connected && !(await drive.connect())) return
    const path = await window.api.chooseExportPath(fileName)
    if (!path) return
    const ctrl = new AbortController()
    abort.current = ctrl
    const started = performance.now()
    setPhase({ kind: 'running', progress: 0, started })
    let secs = 0
    try {
      await exportVideo(
        folder,
        project,
        cursor,
        path,
        opts,
        (p) => setPhase({ kind: 'running', progress: p.progress, started }),
        ctrl.signal
      )
      secs = (performance.now() - started) / 1000
    } catch (e) {
      if (ctrl.signal.aborted) {
        await window.api.removeFile(path)
        setPhase({ kind: 'idle' })
      } else {
        console.error(e)
        setPhase({ kind: 'error', message: (e as Error).message })
      }
      return
    }
    if (willUpload) await upload(path, secs)
    else setPhase({ kind: 'done', path, secs, upload: { kind: 'none' } })
  }

  const eta = (): string => {
    if (phase.kind !== 'running' || phase.progress < 0.02) return 'Estimating…'
    const elapsed = (performance.now() - phase.started) / 1000
    const left = elapsed / phase.progress - elapsed
    return `About ${Math.max(1, Math.round(left))}s left`
  }

  const busy = phase.kind === 'running' || (phase.kind === 'done' && phase.upload.kind === 'uploading')

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm">
      <div className="w-[440px] rounded-2xl border border-ink-700 bg-ink-900 p-5 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">Export video</h2>
          {!busy && (
            <button onClick={onClose} className="text-ink-400 hover:text-ink-100" aria-label="Close">
              <X size={18} />
            </button>
          )}
        </div>

        {phase.kind === 'idle' || phase.kind === 'error' ? (
          <>
            <Field label="Resolution">
              <Segmented
                value={String(opts.height)}
                onChange={(v) => set({ height: Number(v) as ExportOptions['height'] })}
                options={[
                  { value: '720', label: '720p' },
                  { value: '1080', label: '1080p' },
                  { value: '1440', label: '1440p' },
                  { value: '2160', label: '4K' }
                ]}
              />
            </Field>
            <Field label="Frame rate">
              <Segmented
                value={String(opts.fps)}
                onChange={(v) => set({ fps: Number(v) as ExportOptions['fps'] })}
                options={[
                  { value: '30', label: '30 fps' },
                  { value: '60', label: '60 fps' }
                ]}
              />
            </Field>
            <Field label="Quality">
              <Segmented
                value={opts.quality}
                onChange={(v) => set({ quality: v })}
                options={[
                  { value: 'medium', label: 'Smaller file' },
                  { value: 'high', label: 'High' },
                  { value: 'very-high', label: 'Best' }
                ]}
              />
            </Field>
            <p className="mt-1 text-xs text-ink-400">
              MP4 (H.264) · {size.width}×{size.height} · {formatTime(duration)}
            </p>

            {driveReady && (
              <div className="mt-4 rounded-xl border border-ink-700 bg-ink-850 px-3 py-1.5">
                <Toggle
                  label={
                    <span className="flex items-center gap-1.5">
                      <Cloud size={14} /> Upload to Google Drive
                    </span>
                  }
                  hint={
                    connected
                      ? `To “Spotlight Studio” in ${drive.status?.email ?? 'your Drive'}. The link is copied when it’s done.`
                      : 'You’ll sign in with Google in your browser.'
                  }
                  checked={opts.upload}
                  onChange={(v) => set({ upload: v })}
                />
                {opts.upload && (
                  <Toggle
                    label="Anyone with the link can view"
                    hint="Turn off to keep it private to your account"
                    checked={opts.share}
                    onChange={(v) => set({ share: v })}
                  />
                )}
                {opts.upload && !connected && (
                  <Button
                    size="sm"
                    className="my-1.5"
                    onClick={() => void drive.connect()}
                    disabled={drive.connecting}
                  >
                    {drive.connecting ? <Loader2 size={13} className="animate-spin" /> : <Cloud size={13} />}
                    {drive.connecting ? 'Waiting for Google…' : 'Connect Google Drive'}
                  </Button>
                )}
                {drive.error && <p className="pb-1.5 text-xs text-red-300">{drive.error}</p>}
              </div>
            )}

            {phase.kind === 'error' && (
              <p className="mt-3 rounded-lg bg-rec/15 p-2 text-xs text-red-200">{phase.message}</p>
            )}
            <Button
              variant="primary"
              size="lg"
              className="mt-4 w-full"
              onClick={() => void run()}
              disabled={drive.connecting}
            >
              {willUpload ? <Cloud size={16} /> : <Download size={16} />}
              {willUpload ? 'Export & upload' : 'Export MP4'}
            </Button>
          </>
        ) : phase.kind === 'running' ? (
          <div className="py-2">
            <div className="mb-2 flex justify-between text-xs text-ink-300">
              <span>Rendering… {Math.round(phase.progress * 100)}%</span>
              <span>{eta()}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-ink-700">
              <div
                className="h-full rounded-full bg-accent transition-[width]"
                style={{ width: `${phase.progress * 100}%` }}
              />
            </div>
            <Button className="mt-4 w-full" onClick={() => abort.current?.abort()}>
              Cancel
            </Button>
          </div>
        ) : (
          <DoneView
            phase={phase}
            canUpload={driveReady}
            onUpload={async () => {
              if (connected || (await drive.connect())) await upload(phase.path, phase.secs)
            }}
            onCancelUpload={() => uploadId.current && void window.api.driveCancelUpload(uploadId.current)}
            onCopy={async (link) => {
              await window.api.copyText(link)
              setPhase((ph) =>
                ph.kind === 'done' && ph.upload.kind === 'uploaded'
                  ? { ...ph, upload: { ...ph.upload, copied: true } }
                  : ph
              )
            }}
            onClose={onClose}
          />
        )}
      </div>
    </div>
  )
}

function DoneView({
  phase,
  canUpload,
  onUpload,
  onCancelUpload,
  onCopy,
  onClose
}: {
  phase: Extract<Phase, { kind: 'done' }>
  canUpload: boolean
  onUpload: () => Promise<void>
  onCancelUpload: () => void
  onCopy: (link: string) => void
  onClose: () => void
}): ReactNode {
  const up = phase.upload
  return (
    <div className="flex flex-col items-center py-2 text-center">
      <CheckCircle2 size={36} className="mb-2 text-emerald-400" />
      <p className="font-medium">Export finished in {phase.secs.toFixed(0)}s</p>
      <p className="mt-1 max-w-full truncate text-xs text-ink-400">{phase.path}</p>

      {up.kind === 'uploading' && (
        <div className="mt-4 w-full text-left">
          <div className="mb-2 flex justify-between text-xs text-ink-300">
            <span className="flex items-center gap-1.5">
              <Cloud size={13} /> Uploading to Google Drive…{' '}
              {Math.round((up.sent / Math.max(1, up.total)) * 100)}%
            </span>
            <span className="tabular-nums">{up.total > 1 ? `${mb(up.sent)} / ${mb(up.total)}` : ''}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-ink-700">
            <div
              className="h-full rounded-full bg-emerald-500 transition-[width]"
              style={{ width: `${(up.sent / Math.max(1, up.total)) * 100}%` }}
            />
          </div>
          <Button className="mt-3 w-full" onClick={onCancelUpload}>
            Cancel upload
          </Button>
        </div>
      )}

      {up.kind === 'uploaded' && (
        <div className="mt-4 w-full rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-left">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-emerald-200">
            <Cloud size={13} /> Uploaded to Google Drive
            {up.result.shared ? ' · anyone with the link can view' : ' · private'}
          </p>
          <div className="flex items-center gap-2 rounded-lg bg-ink-950 p-2">
            <span className="min-w-0 flex-1 truncate font-mono text-xs select-text">{up.result.link}</span>
            <Button size="sm" onClick={() => onCopy(up.result.link)} title="Copy link">
              {up.copied ? <Check size={13} /> : <Copy size={13} />} {up.copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="mt-2"
            onClick={() => void window.api.openExternal(up.result.link)}
          >
            <ExternalLink size={13} /> Open in Google Drive
          </Button>
        </div>
      )}

      {up.kind === 'failed' && (
        <div className="mt-4 w-full rounded-lg bg-rec/15 p-2 text-left text-xs text-red-200">
          Upload failed: {up.message}
          <Button size="sm" className="mt-2" onClick={() => void onUpload()}>
            Try again
          </Button>
        </div>
      )}

      <div className="mt-4 flex gap-2">
        {up.kind === 'none' && canUpload && (
          <Button onClick={() => void onUpload()}>
            <Cloud size={14} /> Upload to Google Drive
          </Button>
        )}
        <Button
          variant={up.kind === 'uploaded' ? 'secondary' : 'primary'}
          onClick={() => void window.api.reveal(phase.path)}
        >
          Show in Finder
        </Button>
        {up.kind !== 'uploading' && <Button onClick={onClose}>Done</Button>}
      </div>
    </div>
  )
}
