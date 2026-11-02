import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { AppWindow, Camera, FolderOpen, Mic, Monitor, RefreshCw, ShieldAlert, Video } from 'lucide-react'
import type {
  CaptureSource,
  PermissionKind,
  Permissions,
  RecordingConfig,
  RecordingSummary
} from '@shared/ipc'
import { Button, Field, SectionTitle, Select, Toggle, cx, formatTime } from '../components/ui'

const PREFS_KEY = 'spotlight.recordPrefs'

interface Prefs {
  cameraDeviceId: string | null
  micDeviceId: string | null
  showCameraBubble: boolean
  recordKeys: boolean
  sourceId: string | null
}

function loadPrefs(): Prefs {
  const defaults: Prefs = {
    cameraDeviceId: null,
    micDeviceId: 'default',
    showCameraBubble: true,
    recordKeys: true,
    sourceId: null
  }
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') }
  } catch {
    return defaults
  }
}

function savePrefs(p: Prefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p))
  } catch {
    /* ignore */
  }
}

const PERMISSION_INFO: Record<PermissionKind, { label: string; why: string }> = {
  screen: { label: 'Screen Recording', why: 'to capture your screen' },
  camera: { label: 'Camera', why: 'to record your face' },
  microphone: { label: 'Microphone', why: 'to record your voice' },
  accessibility: { label: 'Accessibility', why: 'to capture clicks for auto-zoom and keyboard shortcuts' }
}

function PermissionBanner({
  perms,
  onRequest
}: {
  perms: Permissions
  onRequest: (k: PermissionKind) => void
}): ReactNode {
  const missing = (Object.keys(PERMISSION_INFO) as PermissionKind[]).filter((k) => perms[k] !== 'granted')
  if (missing.length === 0) return null
  return (
    <div className="no-drag mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
      <div className="mb-2 flex items-center gap-2 font-medium text-amber-200">
        <ShieldAlert size={16} /> A few permissions are needed
      </div>
      <div className="flex flex-wrap gap-2">
        {missing.map((k) => (
          <Button key={k} size="sm" onClick={() => onRequest(k)} title={`Needed ${PERMISSION_INFO[k].why}`}>
            Allow {PERMISSION_INFO[k].label}
          </Button>
        ))}
      </div>
      <p className="mt-2 text-xs text-ink-300">
        After enabling Screen Recording or Accessibility in System Settings, you may need to quit and reopen
        Spotlight Studio.
      </p>
    </div>
  )
}

export function Home(): ReactNode {
  const [sources, setSources] = useState<CaptureSource[]>([])
  const [tab, setTab] = useState<'screen' | 'window'>('screen')
  const [perms, setPerms] = useState<Permissions | null>(null)
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs)
  const [recordings, setRecordings] = useState<RecordingSummary[]>([])
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const camVideo = useRef<HTMLVideoElement>(null)

  const update = useCallback((patch: Partial<Prefs>) => {
    setPrefs((p) => {
      const next = { ...p, ...patch }
      savePrefs(next)
      return next
    })
  }, [])

  const refreshSources = useCallback(async () => {
    const list = await window.api.getSources()
    setSources(list)
  }, [])

  const refreshDevices = useCallback(async () => {
    const list = await navigator.mediaDevices.enumerateDevices()
    setDevices(list)
  }, [])

  const refresh = useCallback(async () => {
    setPerms(await window.api.getPermissions())
    await Promise.all([refreshSources(), refreshDevices(), window.api.listRecordings().then(setRecordings)])
  }, [refreshSources, refreshDevices])

  useEffect(() => {
    void refresh()
    const onFocus = (): void => void refresh()
    window.addEventListener('focus', onFocus)
    const offErr = window.api.onHomeError((m) => setError(m))
    navigator.mediaDevices.addEventListener('devicechange', refreshDevices)
    return () => {
      window.removeEventListener('focus', onFocus)
      offErr()
      navigator.mediaDevices.removeEventListener('devicechange', refreshDevices)
    }
  }, [refresh, refreshDevices])

  // Live camera preview.
  useEffect(() => {
    let stream: MediaStream | null = null
    let cancelled = false
    if (prefs.cameraDeviceId) {
      navigator.mediaDevices
        .getUserMedia({ video: { deviceId: { exact: prefs.cameraDeviceId }, width: 640, height: 360 } })
        .then((s) => {
          if (cancelled) return s.getTracks().forEach((t) => t.stop())
          stream = s
          if (camVideo.current) camVideo.current.srcObject = s
          void refreshDevices() // labels become available after permission
        })
        .catch((e) => setError(`Camera: ${(e as Error).message}`))
    }
    return () => {
      cancelled = true
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [prefs.cameraDeviceId, refreshDevices])

  const cameras = devices.filter((d) => d.kind === 'videoinput')
  const mics = devices.filter((d) => d.kind === 'audioinput')
  const visible = sources.filter((s) => s.kind === tab)
  const selected =
    sources.find((s) => s.id === prefs.sourceId) ?? sources.find((s) => s.kind === 'screen') ?? null

  const start = useCallback(async () => {
    if (!selected || starting) return
    setError(null)
    setStarting(true)
    const config: RecordingConfig = {
      sourceId: selected.id,
      sourceKind: selected.kind,
      sourceName: selected.name,
      displayId: selected.displayId,
      cameraDeviceId: prefs.cameraDeviceId,
      micDeviceId: prefs.micDeviceId,
      showCameraBubble: prefs.showCameraBubble,
      recordKeys: prefs.recordKeys
    }
    try {
      await window.api.startRecording(config)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setStarting(false)
    }
  }, [selected, starting, prefs])

  useEffect(() => window.api.onShortcutStart(() => void start()), [start])

  const openRecording = async (): Promise<void> => {
    const folder = await window.api.chooseRecordingFolder()
    if (folder) await window.api.openEditor(folder)
  }

  return (
    <div className="flex h-full flex-col">
      <header className="drag flex h-12 shrink-0 items-center justify-between border-b border-ink-800 pl-20 pr-4">
        <div className="flex items-center gap-2 font-semibold">
          <span className="grid h-6 w-6 place-items-center rounded-md bg-gradient-to-br from-accent to-fuchsia-500">
            <Video size={14} />
          </span>
          Spotlight Studio
        </div>
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" onClick={() => void openRecording()}>
            <FolderOpen size={14} /> Open…
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void refresh()} title="Refresh sources">
            <RefreshCw size={14} />
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <main className="flex min-w-0 flex-1 flex-col overflow-y-auto p-5">
          {perms && (
            <PermissionBanner
              perms={perms}
              onRequest={(k) => void window.api.requestPermission(k).then(setPerms)}
            />
          )}
          {error && (
            <div className="mb-4 rounded-xl border border-rec/40 bg-rec/10 p-3 text-sm text-red-200">
              {error}
            </div>
          )}

          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold">What do you want to record?</h2>
            <div className="flex rounded-lg bg-ink-800 p-0.5">
              {(['screen', 'window'] as const).map((k) => (
                <button
                  key={k}
                  onClick={() => setTab(k)}
                  className={cx(
                    'flex h-7 items-center gap-1.5 rounded-md px-3 text-xs font-medium',
                    tab === k ? 'bg-ink-600 text-white' : 'text-ink-300 hover:text-ink-100'
                  )}
                >
                  {k === 'screen' ? <Monitor size={13} /> : <AppWindow size={13} />}
                  {k === 'screen' ? 'Screens' : 'Windows'}
                </button>
              ))}
            </div>
          </div>
          {tab === 'window' && (
            <p className="mb-3 text-xs text-ink-400">
              Tip: record a whole screen to get auto-zoom and cursor effects. Window recordings don’t include
              cursor data.
            </p>
          )}

          <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
            {visible.map((s) => (
              <button
                key={s.id}
                onClick={() => update({ sourceId: s.id })}
                className={cx(
                  'group overflow-hidden rounded-xl border-2 bg-ink-850 text-left transition-colors',
                  selected?.id === s.id ? 'border-accent' : 'border-transparent hover:border-ink-600'
                )}
              >
                <div className="aspect-video bg-ink-800">
                  {s.thumbnail ? (
                    <img src={s.thumbnail} className="h-full w-full object-contain" alt="" />
                  ) : (
                    <div className="grid h-full place-items-center text-ink-500">No preview</div>
                  )}
                </div>
                <div className="truncate px-2.5 py-2 text-xs text-ink-200">{s.name}</div>
              </button>
            ))}
            {visible.length === 0 && (
              <div className="col-span-full rounded-xl border border-dashed border-ink-600 p-8 text-center text-ink-400">
                No {tab === 'screen' ? 'screens' : 'windows'} found. Check the Screen Recording permission.
              </div>
            )}
          </div>

          <SectionTitle>
            <span className="mt-6 block">Recent recordings</span>
          </SectionTitle>
          <div className="mt-2 flex flex-col divide-y divide-ink-800 rounded-xl bg-ink-850">
            {recordings.length === 0 && (
              <div className="p-4 text-ink-400">Your recordings will show up here.</div>
            )}
            {recordings.slice(0, 12).map((r) => (
              <button
                key={r.folder}
                onClick={() => void window.api.openEditor(r.folder)}
                className="flex items-center justify-between px-4 py-2.5 text-left hover:bg-ink-800"
              >
                <span className="truncate">{r.name}</span>
                <span className="shrink-0 text-xs tabular-nums text-ink-400">
                  {r.durationMs !== null ? formatTime(r.durationMs) : 'Not opened yet'} ·{' '}
                  {new Date(r.createdAt).toLocaleString()}
                </span>
              </button>
            ))}
          </div>
          <button
            className="mt-2 self-start text-xs text-ink-400 hover:text-ink-200"
            onClick={() => void window.api.openRecordingsFolder()}
          >
            Show recordings folder
          </button>
        </main>

        <aside className="flex w-80 shrink-0 flex-col border-l border-ink-800 bg-ink-900 p-5">
          <div className="mb-3 aspect-video overflow-hidden rounded-xl bg-ink-800">
            {prefs.cameraDeviceId ? (
              <video
                ref={camVideo}
                autoPlay
                muted
                playsInline
                className="h-full w-full -scale-x-100 object-cover"
              />
            ) : (
              <div className="grid h-full place-items-center text-ink-500">
                <Camera size={28} />
              </div>
            )}
          </div>

          <Field
            label={
              <span className="flex items-center gap-1.5">
                <Camera size={12} /> Camera
              </span>
            }
          >
            <Select
              value={prefs.cameraDeviceId ?? ''}
              onChange={(v) => update({ cameraDeviceId: v || null })}
              options={[
                { value: '', label: 'No camera' },
                ...cameras.map((d, i) => ({ value: d.deviceId, label: d.label || `Camera ${i + 1}` }))
              ]}
            />
          </Field>
          <Field
            label={
              <span className="flex items-center gap-1.5">
                <Mic size={12} /> Microphone
              </span>
            }
          >
            <Select
              value={prefs.micDeviceId ?? ''}
              onChange={(v) => update({ micDeviceId: v || null })}
              options={[
                { value: '', label: 'No microphone' },
                ...mics.map((d, i) => ({ value: d.deviceId, label: d.label || `Microphone ${i + 1}` }))
              ]}
            />
          </Field>

          <div className="mt-2">
            <Toggle
              label="Show camera bubble"
              hint="Floating preview while recording (not captured)"
              checked={prefs.showCameraBubble}
              onChange={(v) => update({ showCameraBubble: v })}
            />
            <Toggle
              label="Show keyboard shortcuts"
              hint="Records ⌘/⌃/⌥ combos only — never plain typing"
              checked={prefs.recordKeys}
              onChange={(v) => update({ recordKeys: v })}
            />
          </div>

          <div className="mt-auto pt-4">
            <Button
              variant="danger"
              size="lg"
              className="w-full"
              disabled={!selected || starting}
              onClick={() => void start()}
            >
              <span className="h-2.5 w-2.5 rounded-full bg-white" /> Start recording
            </Button>
            <p className="mt-2 text-center text-xs text-ink-400">⌘⇧R to start or stop</p>
          </div>
        </aside>
      </div>
    </div>
  )
}
