import { useRef, useState, type ReactNode } from 'react'
import { CheckCircle2, Download, X } from 'lucide-react'
import { outputSize } from '@shared/project'
import { timelineDuration } from '@shared/timeMap'
import { Button, Field, Segmented, formatTime } from '../components/ui'
import { exportVideo, type ExportOptions } from '../export/exportVideo'
import { useEditor } from './store'

type Phase =
  | { kind: 'idle' }
  | { kind: 'running'; progress: number; started: number }
  | { kind: 'done'; path: string; secs: number }
  | { kind: 'error'; message: string }

const PREFS_KEY = 'spotlight.exportPrefs'

function loadPrefs(): ExportOptions {
  try {
    return { height: 1080, fps: 60, quality: 'high', ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') }
  } catch {
    return { height: 1080, fps: 60, quality: 'high' }
  }
}

export function ExportDialog({ onClose }: { onClose: () => void }): ReactNode {
  const project = useEditor((s) => s.project)!
  const cursor = useEditor((s) => s.cursor)
  const folder = useEditor((s) => s.folder)
  const [opts, setOpts] = useState<ExportOptions>(loadPrefs)
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const abort = useRef<AbortController | null>(null)

  const set = (patch: Partial<ExportOptions>): void => {
    const next = { ...opts, ...patch }
    setOpts(next)
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(next))
    } catch {
      /* ignore */
    }
  }

  const size = outputSize(project, opts.height)
  const duration = timelineDuration(project.clips)

  const run = async (): Promise<void> => {
    const safe = project.name.replace(/[/\\:*?"<>|]+/g, '-').slice(0, 80) || 'Spotlight recording'
    const path = await window.api.chooseExportPath(`${safe}.mp4`)
    if (!path) return
    const ctrl = new AbortController()
    abort.current = ctrl
    const started = performance.now()
    setPhase({ kind: 'running', progress: 0, started })
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
      setPhase({ kind: 'done', path, secs: (performance.now() - started) / 1000 })
    } catch (e) {
      if (ctrl.signal.aborted) {
        await window.api.removeFile(path)
        setPhase({ kind: 'idle' })
      } else {
        console.error(e)
        setPhase({ kind: 'error', message: (e as Error).message })
      }
    }
  }

  const eta = (): string => {
    if (phase.kind !== 'running' || phase.progress < 0.02) return 'Estimating…'
    const elapsed = (performance.now() - phase.started) / 1000
    const left = elapsed / phase.progress - elapsed
    return `About ${Math.max(1, Math.round(left))}s left`
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm">
      <div className="w-[420px] rounded-2xl border border-ink-700 bg-ink-900 p-5 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">Export video</h2>
          {phase.kind !== 'running' && (
            <button onClick={onClose} className="text-ink-400 hover:text-ink-100">
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
            <p className="mt-2 text-xs text-ink-400">
              MP4 (H.264) · {size.width}×{size.height} · {formatTime(duration)}
            </p>
            {phase.kind === 'error' && (
              <p className="mt-3 rounded-lg bg-rec/15 p-2 text-xs text-red-200">{phase.message}</p>
            )}
            <Button variant="primary" size="lg" className="mt-4 w-full" onClick={() => void run()}>
              <Download size={16} /> Export MP4
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
          <div className="flex flex-col items-center py-2 text-center">
            <CheckCircle2 size={36} className="mb-2 text-emerald-400" />
            <p className="font-medium">Export finished in {phase.secs.toFixed(0)}s</p>
            <p className="mt-1 max-w-full truncate text-xs text-ink-400">{phase.path}</p>
            <div className="mt-4 flex gap-2">
              <Button variant="primary" onClick={() => void window.api.reveal(phase.path)}>
                Show in Finder
              </Button>
              <Button onClick={onClose}>Done</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
