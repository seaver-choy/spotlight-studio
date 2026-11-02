/**
 * The floating control bar. It also owns the actual recording: it captures the screen
 * (+ mic) and the camera as two separate MediaRecorder streams and streams the chunks
 * to the main process, which writes them to disk.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Pause, Play, RotateCcw, Square, Trash2 } from 'lucide-react'
import type { RecordingSession } from '@shared/ipc'
import { cx } from '../components/ui'

const SCREEN_MIMES = [
  'video/mp4;codecs=avc1.640033,mp4a.40.2',
  'video/mp4;codecs=avc1,mp4a.40.2',
  'video/mp4;codecs=avc1,opus',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm'
]
const SCREEN_MIMES_NO_AUDIO = [
  'video/mp4;codecs=avc1.640033',
  'video/mp4;codecs=avc1',
  'video/mp4',
  'video/webm;codecs=vp9',
  'video/webm'
]
const CAMERA_MIMES = [
  'video/mp4;codecs=avc1.640028',
  'video/mp4;codecs=avc1',
  'video/mp4',
  'video/webm;codecs=vp9',
  'video/webm'
]

function pickMime(list: string[]): string {
  return list.find((m) => MediaRecorder.isTypeSupported(m)) ?? ''
}

type Phase = 'preparing' | 'countdown' | 'recording' | 'paused' | 'saving'

interface Rec {
  screen: MediaRecorder
  camera: MediaRecorder | null
  streams: MediaStream[]
  queue: Promise<void>
}

function startRecorder(r: MediaRecorder): Promise<number> {
  return new Promise((resolve) => {
    r.addEventListener('start', () => resolve(Date.now()), { once: true })
    r.start(1000)
  })
}

function stopRecorder(r: MediaRecorder | null): Promise<void> {
  if (!r || r.state === 'inactive') return Promise.resolve()
  return new Promise((resolve) => {
    r.addEventListener('stop', () => resolve(), { once: true })
    r.stop()
  })
}

export function ControlBar(): ReactNode {
  const [phase, setPhase] = useState<Phase>('preparing')
  const [elapsed, setElapsed] = useState(0)
  const [level, setLevel] = useState(0)
  const session = useRef<RecordingSession | null>(null)
  const media = useRef<{ screen: MediaStream; mic: MediaStream | null; camera: MediaStream | null } | null>(
    null
  )
  const rec = useRef<Rec | null>(null)
  const clock = useRef({ startedAt: 0, pausedAt: 0, pausedTotal: 0 })

  const fail = useCallback((msg: string) => {
    media.current?.screen.getTracks().forEach((t) => t.stop())
    media.current?.mic?.getTracks().forEach((t) => t.stop())
    media.current?.camera?.getTracks().forEach((t) => t.stop())
    void window.api.recorderError(msg)
  }, [])

  // 1. Acquire streams, then tell main we're ready (main shows the countdown).
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const s = await window.api.getSession()
      if (!s || cancelled) return
      session.current = s
      const { config, capture } = s
      try {
        const screen = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            // Electron's desktop capture constraints.
            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: config.sourceId,
              maxWidth: Math.max(capture.width, 1920),
              maxHeight: Math.max(capture.height, 1080),
              minFrameRate: 30,
              maxFrameRate: 60
            }
          } as unknown as MediaTrackConstraints
        })
        const mic = config.micDeviceId
          ? await navigator.mediaDevices
              .getUserMedia({
                audio: {
                  deviceId: config.micDeviceId === 'default' ? undefined : { exact: config.micDeviceId },
                  echoCancellation: true,
                  noiseSuppression: true,
                  autoGainControl: true
                }
              })
              .catch(() => null)
          : null
        const camera = config.cameraDeviceId
          ? await navigator.mediaDevices
              .getUserMedia({
                video: {
                  deviceId: { exact: config.cameraDeviceId },
                  width: { ideal: 1920 },
                  height: { ideal: 1080 },
                  frameRate: { ideal: 30 }
                }
              })
              .catch(() => null)
          : null
        if (cancelled) return
        media.current = { screen, mic, camera }

        if (mic) {
          const ac = new AudioContext()
          const an = ac.createAnalyser()
          an.fftSize = 512
          ac.createMediaStreamSource(mic).connect(an)
          const buf = new Uint8Array(an.fftSize)
          const tick = (): void => {
            an.getByteTimeDomainData(buf)
            let peak = 0
            for (const v of buf) peak = Math.max(peak, Math.abs(v - 128) / 128)
            setLevel((l) => Math.max(peak, l * 0.85))
            if (!cancelled) requestAnimationFrame(tick)
          }
          tick()
        }
        setPhase('countdown')
        await window.api.recorderReady()
      } catch (e) {
        fail(`Could not start capture: ${(e as Error).message}. Check the Screen Recording permission.`)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [fail])

  // 2. Main says go → start both recorders at (nearly) the same moment.
  useEffect(
    () =>
      window.api.onRecorderBegin(async () => {
        const m = media.current
        const s = session.current
        if (!m || !s) return
        try {
          const screenStream = new MediaStream([
            ...m.screen.getVideoTracks(),
            ...(m.mic?.getAudioTracks() ?? [])
          ])
          const screenMime = pickMime(m.mic ? SCREEN_MIMES : SCREEN_MIMES_NO_AUDIO)
          const settings = m.screen.getVideoTracks()[0].getSettings()
          const px = (settings.width ?? 1920) * (settings.height ?? 1080)
          const screenRec = new MediaRecorder(screenStream, {
            mimeType: screenMime || undefined,
            videoBitsPerSecond: Math.min(30e6, Math.max(8e6, px * 3)),
            audioBitsPerSecond: 160_000
          })
          const cameraMime = m.camera ? pickMime(CAMERA_MIMES) : null
          const cameraRec = m.camera
            ? new MediaRecorder(m.camera, { mimeType: cameraMime || undefined, videoBitsPerSecond: 6e6 })
            : null
          const r: Rec = {
            screen: screenRec,
            camera: cameraRec,
            streams: [screenStream],
            queue: Promise.resolve()
          }
          const push = (track: 'screen' | 'camera') => (e: BlobEvent) => {
            if (e.data.size === 0) return
            r.queue = r.queue.then(async () => window.api.recorderChunk(track, await e.data.arrayBuffer()))
          }
          screenRec.ondataavailable = push('screen')
          if (cameraRec) cameraRec.ondataavailable = push('camera')
          rec.current = r

          const [screenStartedAt, cameraStartedAt] = await Promise.all([
            startRecorder(screenRec),
            cameraRec ? startRecorder(cameraRec) : Promise.resolve(null)
          ])
          clock.current = { startedAt: screenStartedAt, pausedAt: 0, pausedTotal: 0 }
          await window.api.recorderStarted({
            screenMime: screenRec.mimeType || screenMime,
            cameraMime: cameraRec ? cameraRec.mimeType || cameraMime : null,
            screenStartedAt,
            cameraStartedAt
          })
          setPhase('recording')
        } catch (e) {
          fail(`Recording failed: ${(e as Error).message}`)
        }
      }),
    [fail]
  )

  // Timer.
  useEffect(() => {
    if (phase !== 'recording') return
    const id = setInterval(() => {
      const c = clock.current
      setElapsed(Date.now() - c.startedAt - c.pausedTotal)
    }, 200)
    return () => clearInterval(id)
  }, [phase])

  const releaseMedia = (): void => {
    const m = media.current
    m?.screen.getTracks().forEach((t) => t.stop())
    m?.mic?.getTracks().forEach((t) => t.stop())
    m?.camera?.getTracks().forEach((t) => t.stop())
  }

  const stop = useCallback(async () => {
    const r = rec.current
    if (!r || phase === 'saving') return
    setPhase('saving')
    await Promise.all([stopRecorder(r.screen), stopRecorder(r.camera)])
    await r.queue
    releaseMedia()
    await window.api.recorderFinished()
  }, [phase])

  useEffect(() => window.api.onRecorderStopRequest(() => void stop()), [stop])

  const togglePause = async (): Promise<void> => {
    const r = rec.current
    if (!r) return
    if (phase === 'recording') {
      r.screen.pause()
      r.camera?.pause()
      clock.current.pausedAt = Date.now()
      await window.api.recorderPause()
      setPhase('paused')
    } else if (phase === 'paused') {
      r.screen.resume()
      r.camera?.resume()
      clock.current.pausedTotal += Date.now() - clock.current.pausedAt
      await window.api.recorderResume()
      setPhase('recording')
    }
  }

  const discard = async (restart: boolean): Promise<void> => {
    const r = rec.current
    if (r) {
      r.screen.ondataavailable = null
      if (r.camera) r.camera.ondataavailable = null
      await Promise.all([stopRecorder(r.screen), stopRecorder(r.camera)])
    }
    releaseMedia()
    if (restart) await window.api.recorderRestart()
    else await window.api.recorderCancel()
  }

  const mm = Math.floor(elapsed / 60000)
  const ss = Math.floor((elapsed / 1000) % 60)
  const live = phase === 'recording' || phase === 'paused'

  return (
    <div className="flex h-full items-center justify-center p-1.5">
      <div className="drag flex h-full w-full items-center gap-1 rounded-2xl border border-white/10 bg-ink-900/95 px-2 shadow-2xl backdrop-blur">
        <button
          onClick={() => void stop()}
          disabled={!live}
          title="Stop and edit (⌘⇧R)"
          className="no-drag flex h-10 items-center gap-2 rounded-xl bg-rec px-3 font-semibold text-white hover:brightness-110 disabled:opacity-50"
        >
          <Square size={13} fill="currentColor" />
          <span className="w-11 text-left tabular-nums">
            {phase === 'preparing'
              ? '…'
              : phase === 'countdown'
                ? 'Ready'
                : phase === 'saving'
                  ? 'Saving'
                  : `${mm}:${String(ss).padStart(2, '0')}`}
          </span>
        </button>
        <div
          className="mx-1 flex h-8 w-1.5 flex-col-reverse overflow-hidden rounded-full bg-ink-700"
          title="Microphone level"
        >
          <div
            className="w-full rounded-full bg-emerald-400 transition-[height] duration-75"
            style={{ height: `${Math.min(100, level * 140)}%` }}
          />
        </div>
        <button
          onClick={() => void togglePause()}
          disabled={!live}
          title={phase === 'paused' ? 'Resume' : 'Pause'}
          className={cx(
            'no-drag grid h-10 w-10 place-items-center rounded-xl text-ink-100 hover:bg-ink-700 disabled:opacity-40',
            phase === 'paused' && 'text-amber-300'
          )}
        >
          {phase === 'paused' ? <Play size={17} /> : <Pause size={17} />}
        </button>
        <button
          onClick={() => void discard(true)}
          disabled={!live}
          title="Restart"
          className="no-drag grid h-10 w-10 place-items-center rounded-xl text-ink-100 hover:bg-ink-700 disabled:opacity-40"
        >
          <RotateCcw size={16} />
        </button>
        <button
          onClick={() => void discard(false)}
          disabled={phase === 'saving'}
          title="Discard"
          className="no-drag grid h-10 w-10 place-items-center rounded-xl text-ink-100 hover:bg-ink-700 disabled:opacity-40"
        >
          <Trash2 size={16} />
        </button>
        <div className="ml-auto pr-2 text-[11px] text-ink-400">
          {phase === 'paused' ? 'Paused' : 'Spotlight'}
        </div>
      </div>
    </div>
  )
}
