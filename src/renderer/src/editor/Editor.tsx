import { useEffect, useState, type ReactNode } from 'react'
import {
  ArrowUpRight,
  Bot,
  Download,
  EyeOff,
  Highlighter,
  Layout,
  Loader2,
  Pause,
  Play,
  Redo2,
  Scissors,
  Square,
  Trash2,
  Type,
  Undo2,
  X,
  ZoomIn
} from 'lucide-react'
import type { AnnotationKind, LayoutPreset } from '@shared/project'
import { timelineDuration } from '@shared/timeMap'
import { Button, cx, formatTime } from '../components/ui'
import { join } from '../lib/media'
import { AgentHelp } from './AgentHelp'
import { ExportDialog } from './ExportDialog'
import { Inspector } from './Inspector'
import { openProject } from './loadProject'
import { Preview } from './Preview'
import { useEditor } from './store'
import { Timeline } from './Timeline'

function Menu({
  label,
  icon,
  items
}: {
  label: string
  icon: ReactNode
  items: Array<{ label: string; icon?: ReactNode; onClick: () => void; disabled?: boolean }>
}): ReactNode {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <Button size="sm" variant="ghost" onClick={() => setOpen((v) => !v)}>
        {icon} {label}
      </Button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full left-0 z-40 mb-1 min-w-44 rounded-lg border border-ink-700 bg-ink-850 p-1 shadow-xl">
            {items.map((it) => (
              <button
                key={it.label}
                disabled={it.disabled}
                onClick={() => {
                  setOpen(false)
                  it.onClick()
                }}
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] hover:bg-ink-700 disabled:opacity-40"
              >
                {it.icon}
                {it.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function TimeReadout(): ReactNode {
  const playhead = useEditor((s) => s.playhead)
  const project = useEditor((s) => s.project)!
  return (
    <span className="tabular-nums text-ink-300">
      {formatTime(playhead, true)}{' '}
      <span className="text-ink-500">/ {formatTime(timelineDuration(project.clips), true)}</span>
    </span>
  )
}

function Toolbar({
  zoomLevel,
  setZoomLevel
}: {
  zoomLevel: number
  setZoomLevel: (v: number) => void
}): ReactNode {
  const s = useEditor()
  const project = s.project!
  const hasCamera = !!project.sources.camera
  const addNote = (k: AnnotationKind) => () => s.addAnnotation(k)
  const addLayout = (l: LayoutPreset) => () => s.addLayout(l)
  return (
    <div className="flex h-11 shrink-0 items-center gap-1 border-t border-ink-800 bg-ink-900 px-3">
      <Button
        size="sm"
        variant="ghost"
        onClick={() => s.setPlaying(!s.playing)}
        title="Play/Pause (Space)"
        className="w-9"
      >
        {s.playing ? <Pause size={16} /> : <Play size={16} />}
      </Button>
      <TimeReadout />
      <div className="mx-2 h-5 w-px bg-ink-700" />
      <Button size="sm" variant="ghost" onClick={s.splitAtPlayhead} title="Split at playhead (S)">
        <Scissors size={14} /> Split
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={s.deleteSelection}
        disabled={!s.selection}
        title="Delete selection (⌫)"
      >
        <Trash2 size={14} />
      </Button>
      <div className="mx-2 h-5 w-px bg-ink-700" />
      <Button size="sm" variant="ghost" onClick={s.addZoom} title="Add zoom at playhead (Z)">
        <ZoomIn size={14} /> Zoom
      </Button>
      <Menu
        label="Layout"
        icon={<Layout size={14} />}
        items={[
          { label: 'Screen only', onClick: addLayout('screen') },
          { label: 'Picture-in-picture', onClick: addLayout('pip'), disabled: !hasCamera },
          { label: 'Side by side', onClick: addLayout('side-by-side'), disabled: !hasCamera },
          { label: 'Camera only', onClick: addLayout('camera'), disabled: !hasCamera }
        ]}
      />
      <Menu
        label="Highlight"
        icon={<Highlighter size={14} />}
        items={[
          { label: 'Text callout', icon: <Type size={14} />, onClick: addNote('text') },
          { label: 'Arrow', icon: <ArrowUpRight size={14} />, onClick: addNote('arrow') },
          { label: 'Box', icon: <Square size={14} />, onClick: addNote('rect') },
          { label: 'Spotlight area', icon: <Highlighter size={14} />, onClick: addNote('highlight') },
          { label: 'Blur (redact)', icon: <EyeOff size={14} />, onClick: addNote('blur') }
        ]}
      />
      <div className="mx-2 h-5 w-px bg-ink-700" />
      <Button size="sm" variant="ghost" onClick={s.undo} disabled={!s.past.length} title="Undo (⌘Z)">
        <Undo2 size={14} />
      </Button>
      <Button size="sm" variant="ghost" onClick={s.redo} disabled={!s.future.length} title="Redo (⇧⌘Z)">
        <Redo2 size={14} />
      </Button>
      <div className="ml-auto flex items-center gap-2 text-xs text-ink-400">
        Timeline zoom
        <input
          type="range"
          min={1}
          max={12}
          step={0.1}
          value={zoomLevel}
          onChange={(e) => setZoomLevel(Number(e.target.value))}
          className="w-28"
        />
      </div>
    </div>
  )
}

function useShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement
      if (target.closest('input, textarea, select')) return
      const s = useEditor.getState()
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) s.redo()
        else s.undo()
      } else if (e.code === 'Space') {
        e.preventDefault()
        s.setPlaying(!s.playing)
      } else if (!mod && e.key.toLowerCase() === 's') {
        s.splitAtPlayhead()
      } else if (!mod && e.key.toLowerCase() === 'z') {
        s.addZoom()
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        s.deleteSelection()
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault()
        const step = e.shiftKey ? 1000 : 1000 / 30
        s.seek(s.playhead + (e.key === 'ArrowLeft' ? -step : step))
      } else if (e.key === 'Escape') {
        s.select(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

/** Debounced autosave of project.json. */
function useAutosave(): void {
  const project = useEditor((s) => s.project)
  const folder = useEditor((s) => s.folder)
  const fromDisk = useEditor((s) => s.fromDisk)
  useEffect(() => {
    if (!project || !folder || project === fromDisk) return
    const id = setTimeout(
      () => void window.api.writeText(join(folder, 'project.json'), JSON.stringify(project, null, 2)),
      500
    )
    return () => clearTimeout(id)
  }, [project, folder, fromDisk])
}

export function Editor(): ReactNode {
  const folder = window.api.getEditorFolder() ?? ''
  const project = useEditor((s) => s.project)
  const notice = useEditor((s) => s.notice)
  const [status, setStatus] = useState<string>('Opening…')
  const [error, setError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [agentHelp, setAgentHelp] = useState(false)
  const [zoomLevel, setZoomLevel] = useState(1)

  useEffect(() => {
    let cancelled = false
    openProject(folder, setStatus)
      .then(({ project, cursor }) => {
        if (cancelled) return
        useEditor.getState().load(folder, project, cursor)
        window.api.setTitle(`${project.name} — Spotlight Studio`)
        void window.api.watchProject(folder)
      })
      .catch((e) => {
        console.error(e)
        setError((e as Error).message)
      })
    const off = window.api.onProjectChanged((text) => useEditor.getState().replaceFromDisk(text))
    return () => {
      cancelled = true
      off()
    }
  }, [folder])

  useEffect(() => {
    if (!notice) return
    const id = setTimeout(() => useEditor.getState().setNotice(null), 6000)
    return () => clearTimeout(id)
  }, [notice])

  useShortcuts()
  useAutosave()

  if (error) {
    return (
      <div className="grid h-full place-items-center p-8">
        <div className="max-w-md text-center">
          <p className="mb-2 font-semibold">Couldn’t open this recording</p>
          <p className="text-ink-400">{error}</p>
        </div>
      </div>
    )
  }

  if (!project) {
    return (
      <div className="drag grid h-full place-items-center">
        <div className="flex items-center gap-2 text-ink-300">
          <Loader2 className="animate-spin" size={18} /> {status}
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <header className="drag flex h-12 shrink-0 items-center gap-3 border-b border-ink-800 pl-20 pr-3">
        <input
          className="no-drag w-72 rounded-md bg-transparent px-2 py-1 font-semibold outline-none hover:bg-ink-800 focus:bg-ink-800"
          value={project.name}
          onChange={(e) => useEditor.getState().update((p) => void (p.name = e.target.value), 'rename')}
        />
        <div className="ml-auto flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setAgentHelp(true)}
            title="Edit this video with an AI agent like Claude Code"
          >
            <Bot size={14} /> Edit with AI
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void window.api.reveal(join(folder, 'project.json'))}
          >
            Show files
          </Button>
          <Button variant="primary" size="sm" onClick={() => setExporting(true)}>
            <Download size={14} /> Export
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <Preview />
          <Toolbar zoomLevel={zoomLevel} setZoomLevel={setZoomLevel} />
          <Timeline zoomLevel={zoomLevel} />
        </div>
        <Inspector />
      </div>

      {notice && (
        <div
          className={cx(
            'fixed bottom-4 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-xl border border-ink-600 bg-ink-800 px-4 py-2.5 shadow-2xl'
          )}
        >
          <span className="max-w-xl text-[13px]">{notice}</span>
          <button
            className="text-ink-400 hover:text-ink-100"
            onClick={() => useEditor.getState().setNotice(null)}
          >
            <X size={14} />
          </button>
        </div>
      )}
      {exporting && <ExportDialog onClose={() => setExporting(false)} />}
      {agentHelp && <AgentHelp folder={folder} onClose={() => setAgentHelp(false)} />}
    </div>
  )
}
