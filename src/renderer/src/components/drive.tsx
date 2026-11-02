import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Cloud, CloudOff, Loader2, LogOut } from 'lucide-react'
import type { DriveStatus } from '@shared/ipc'
import { Button } from './ui'

export interface DriveState {
  status: DriveStatus | null
  connecting: boolean
  error: string | null
  connect(): Promise<boolean>
  cancel(): void
  disconnect(): Promise<void>
}

export function useDrive(): DriveState {
  const [status, setStatus] = useState<DriveStatus | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void window.api.driveStatus().then(setStatus)
    const onFocus = (): void => void window.api.driveStatus().then(setStatus)
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  const connect = useCallback(async () => {
    setError(null)
    setConnecting(true)
    try {
      setStatus(await window.api.driveConnect())
      return true
    } catch (e) {
      setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
      return false
    } finally {
      setConnecting(false)
    }
  }, [])

  const cancel = useCallback(() => void window.api.driveCancelConnect(), [])
  const disconnect = useCallback(async () => setStatus(await window.api.driveDisconnect()), [])

  return { status, connecting, error, connect, cancel, disconnect }
}

/** Compact connect/disconnect control for headers. */
export function DriveButton({ drive }: { drive: DriveState }): ReactNode {
  const [menu, setMenu] = useState(false)
  const { status } = drive
  if (!status || !status.configured) return null
  if (drive.connecting) {
    return (
      <Button
        variant="ghost"
        size="sm"
        onClick={drive.cancel}
        title="Waiting for you to sign in in your browser. Click to cancel."
      >
        <Loader2 size={14} className="animate-spin" /> Waiting for Google…
      </Button>
    )
  }
  if (!status.connected) {
    return (
      <Button
        variant="ghost"
        size="sm"
        onClick={() => void drive.connect()}
        title="Upload exports to Google Drive"
      >
        <CloudOff size={14} /> Connect Google Drive
      </Button>
    )
  }
  return (
    <div className="relative">
      <Button variant="ghost" size="sm" onClick={() => setMenu((v) => !v)} title="Google Drive">
        <Cloud size={14} className="text-emerald-400" /> {status.email ?? 'Google Drive'}
      </Button>
      {menu && (
        <>
          <div className="no-drag fixed inset-0 z-30" onClick={() => setMenu(false)} />
          <div className="no-drag absolute right-0 top-full z-40 mt-1 w-56 rounded-lg border border-ink-700 bg-ink-850 p-1 shadow-xl">
            <p className="px-2.5 py-1.5 text-xs text-ink-400">
              Exports can upload to “Spotlight Studio” in your Drive.
            </p>
            <button
              onClick={() => {
                setMenu(false)
                void drive.disconnect()
              }}
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] hover:bg-ink-700"
            >
              <LogOut size={14} /> Disconnect Google Drive
            </button>
          </div>
        </>
      )}
    </div>
  )
}
