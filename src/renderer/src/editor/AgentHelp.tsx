import { useState, type ReactNode } from 'react'
import { Bot, Check, Copy, X } from 'lucide-react'
import { Button } from '../components/ui'

const EXAMPLES = [
  'Cut the dead air at the start and end of this recording.',
  'Speed up the parts where I’m not moving the mouse to 3×.',
  'Add a zoom whenever I click, but skip clicks in the dock.',
  'Add a text callout “Click Save” 1 second before I click the Save button.',
  'Start with the camera-only layout for the first 4 seconds, then switch to picture-in-picture.'
]

/**
 * Explains how to edit this recording with a coding agent such as Claude Code.
 * The agent edits project.json; the editor reloads it live.
 */
export function AgentHelp({ folder, onClose }: { folder: string; onClose: () => void }): ReactNode {
  const [copied, setCopied] = useState(false)
  const cmd = `cd "${folder}" && claude`
  const copy = async (): Promise<void> => {
    await navigator.clipboard.writeText(cmd)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-[560px] rounded-2xl border border-ink-700 bg-ink-900 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Bot size={18} /> Edit with an AI agent
          </h2>
          <button onClick={onClose} className="text-ink-400 hover:text-ink-100">
            <X size={18} />
          </button>
        </div>
        <p className="text-ink-300">
          Every edit lives in <code className="rounded bg-ink-800 px-1">project.json</code>, and each
          recording folder includes an <code className="rounded bg-ink-800 px-1">AGENTS.md</code> that
          explains the format. That means a coding agent such as Claude Code can edit your video for you.
          Changes show up here live, and you can undo them with ⌘Z.
        </p>
        <p className="mt-3 text-xs font-medium text-ink-300">Run this in a terminal:</p>
        <div className="mt-1 flex items-center gap-2 rounded-lg bg-ink-950 p-2 font-mono text-xs">
          <span className="min-w-0 flex-1 truncate select-text">{cmd}</span>
          <Button size="sm" onClick={() => void copy()}>
            {copied ? <Check size={13} /> : <Copy size={13} />}
          </Button>
        </div>
        <p className="mt-3 text-xs font-medium text-ink-300">Then ask, for example:</p>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-ink-300">
          {EXAMPLES.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      </div>
    </div>
  )
}
