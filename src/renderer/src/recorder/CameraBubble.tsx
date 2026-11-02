import { useEffect, useRef, type ReactNode } from 'react'

/** Circular, draggable camera preview shown while recording (excluded from capture). */
export function CameraBubble(): ReactNode {
  const video = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const q = new URLSearchParams(window.location.hash.split('?')[1] ?? '')
    const deviceId = q.get('camera')
    let stream: MediaStream | null = null
    let cancelled = false
    if (deviceId) {
      navigator.mediaDevices
        .getUserMedia({ video: { deviceId: { exact: deviceId }, width: 480, height: 480 } })
        .then((s) => {
          if (cancelled) return s.getTracks().forEach((t) => t.stop())
          stream = s
          if (video.current) video.current.srcObject = s
        })
        .catch(() => undefined)
    }
    return () => {
      cancelled = true
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  return (
    <div className="drag h-full w-full p-2">
      <div className="h-full w-full overflow-hidden rounded-full border-4 border-white/90 bg-ink-800 shadow-2xl">
        <video ref={video} autoPlay muted playsInline className="h-full w-full -scale-x-100 object-cover" />
      </div>
    </div>
  )
}
