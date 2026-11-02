import { useState, type ReactNode } from 'react'
import {
  Columns2,
  Image as ImageIcon,
  Monitor,
  MousePointer2,
  PictureInPicture2,
  Sparkles,
  Trash2,
  User
} from 'lucide-react'
import type { Annotation, LayoutPreset, Project } from '@shared/project'
import {
  Button,
  ColorInput,
  Field,
  SectionTitle,
  Segmented,
  Select,
  Slider,
  Toggle,
  cx
} from '../components/ui'
import { useEditor } from './store'

const LAYOUTS: Array<{ value: LayoutPreset; label: string; icon: ReactNode }> = [
  { value: 'screen', label: 'Screen', icon: <Monitor size={16} /> },
  { value: 'pip', label: 'Bubble', icon: <PictureInPicture2 size={16} /> },
  { value: 'side-by-side', label: 'Side', icon: <Columns2 size={16} /> },
  { value: 'camera', label: 'Camera', icon: <User size={16} /> }
]

const GRADIENTS: Array<[string, string]> = [
  ['#5B5BF7', '#C847E8'],
  ['#0EA5E9', '#22D3EE'],
  ['#F97316', '#EC4899'],
  ['#10B981', '#3B82F6'],
  ['#111827', '#374151'],
  ['#FDE68A', '#F472B6'],
  ['#1E1B4B', '#7C3AED'],
  ['#F8FAFC', '#CBD5E1']
]

export function LayoutPicker({
  value,
  onChange,
  disabled
}: {
  value: LayoutPreset
  onChange: (v: LayoutPreset) => void
  disabled?: boolean
}): ReactNode {
  return (
    <div className="grid grid-cols-4 gap-1.5">
      {LAYOUTS.map((l) => (
        <button
          key={l.value}
          disabled={disabled && l.value !== 'screen'}
          onClick={() => onChange(l.value)}
          className={cx(
            'flex flex-col items-center gap-1 rounded-lg border py-2 text-[11px] disabled:opacity-30',
            value === l.value
              ? 'border-accent bg-accent/15 text-white'
              : 'border-ink-700 text-ink-300 hover:border-ink-500'
          )}
        >
          {l.icon}
          {l.label}
        </button>
      ))}
    </div>
  )
}

function useUpdate(): (fn: (p: Project) => void, key?: string) => void {
  return useEditor((s) => s.update)
}

function SelectionPanel(): ReactNode {
  const project = useEditor((s) => s.project)!
  const selection = useEditor((s) => s.selection)
  const update = useUpdate()
  const del = useEditor((s) => s.deleteSelection)
  if (!selection) return null

  const header = (title: string): ReactNode => (
    <div className="mb-2 flex items-center justify-between">
      <h3 className="text-sm font-semibold">{title}</h3>
      <Button size="sm" variant="ghost" onClick={del} title="Delete (⌫)">
        <Trash2 size={13} />
      </Button>
    </div>
  )

  if (selection.kind === 'clip') {
    const c = project.clips.find((x) => x.id === selection.id)
    if (!c) return null
    return (
      <div className="border-b border-ink-800 p-4">
        {header('Clip')}
        <Field label="Speed">
          <Segmented
            value={String(c.speed)}
            onChange={(v) => update((p) => void (p.clips.find((x) => x.id === c.id)!.speed = Number(v)))}
            options={['0.5', '1', '1.5', '2', '3', '4'].map((v) => ({ value: v, label: `${v}×` }))}
          />
        </Field>
        <p className="text-xs text-ink-400">
          Audio is muted in sped-up or slowed-down clips. Delete a clip to cut it out.
        </p>
      </div>
    )
  }

  if (selection.kind === 'zoom') {
    const z = project.zooms.find((x) => x.id === selection.id)
    if (!z) return null
    const set = (patch: Partial<typeof z>, key?: string): void =>
      update((p) => {
        const t = p.zooms.find((x) => x.id === z.id)
        if (t) Object.assign(t, patch, { auto: false })
      }, key)
    return (
      <div className="border-b border-ink-800 p-4">
        {header('Zoom')}
        <Slider
          label="Zoom level"
          value={z.scale}
          min={1.1}
          max={4}
          step={0.1}
          onChange={(v) => set({ scale: v }, `zoom-scale-${z.id}`)}
          format={(v) => `${v.toFixed(1)}×`}
        />
        <Field label="Focus">
          <Segmented
            value={z.mode}
            onChange={(v) => set({ mode: v })}
            options={[
              { value: 'follow', label: 'Follow cursor' },
              { value: 'fixed', label: 'Fixed point' }
            ]}
          />
        </Field>
        {z.mode === 'fixed' && (
          <p className="text-xs text-ink-400">Click on the preview to choose where to zoom.</p>
        )}
      </div>
    )
  }

  if (selection.kind === 'layout') {
    const l = project.layouts.find((x) => x.id === selection.id)
    if (!l) return null
    return (
      <div className="border-b border-ink-800 p-4">
        {header('Layout change')}
        <LayoutPicker
          value={l.layout}
          disabled={!project.sources.camera}
          onChange={(v) => update((p) => void (p.layouts.find((x) => x.id === l.id)!.layout = v))}
        />
      </div>
    )
  }

  const a = project.annotations.find((x) => x.id === selection.id)
  if (!a) return null
  const set = (patch: Partial<Annotation>, key?: string): void =>
    update((p) => {
      const t = p.annotations.find((x) => x.id === a.id)
      if (t) Object.assign(t, patch)
    }, key)
  const titles: Record<Annotation['kind'], string> = {
    text: 'Text',
    arrow: 'Arrow',
    rect: 'Box',
    highlight: 'Highlight',
    blur: 'Blur'
  }
  return (
    <div className="border-b border-ink-800 p-4">
      {header(titles[a.kind])}
      {a.kind === 'text' && (
        <Field label="Text">
          <textarea
            value={a.text}
            rows={2}
            onChange={(e) => set({ text: e.target.value }, `text-${a.id}`)}
            className="w-full resize-none rounded-lg border border-ink-600 bg-ink-800 p-2 text-[13px] outline-none focus:border-accent"
          />
        </Field>
      )}
      {a.kind !== 'blur' && (
        <Field label="Color">
          <ColorInput value={a.color} onChange={(v) => set({ color: v }, `color-${a.id}`)} />
        </Field>
      )}
      {a.kind === 'text' && (
        <Slider
          label="Size"
          value={a.fontSize}
          min={16}
          max={120}
          step={1}
          onChange={(v) => set({ fontSize: v }, `fs-${a.id}`)}
          format={(v) => `${v}px`}
        />
      )}
      {(a.kind === 'arrow' || a.kind === 'rect') && (
        <Slider
          label="Thickness"
          value={a.strokeWidth}
          min={2}
          max={24}
          step={1}
          onChange={(v) => set({ strokeWidth: v }, `sw-${a.id}`)}
          format={(v) => `${v}px`}
        />
      )}
      <p className="mt-1 text-xs text-ink-400">
        Drag it on the preview to position it. Drag its edges on the timeline to change timing.
      </p>
    </div>
  )
}

export function Inspector(): ReactNode {
  const project = useEditor((s) => s.project)!
  const folder = useEditor((s) => s.folder)
  const update = useUpdate()
  const regenerate = useEditor((s) => s.regenerateAutoZooms)
  const cursor = useEditor((s) => s.cursor)
  const [tab, setTab] = useState<'layout' | 'style' | 'cursor'>('layout')
  const bg = project.background
  const cam = project.camera
  const fx = project.cursorFx
  const hasCamera = !!project.sources.camera

  const chooseImage = async (): Promise<void> => {
    const path = await window.api.chooseImage()
    if (!path) return
    const ext = path.split('.').pop() ?? 'png'
    const name = await window.api.copyInto(folder, path, `background.${ext}`)
    update((p) => {
      p.background.type = 'image'
      p.background.image = name
    })
  }

  return (
    <aside className="flex w-80 shrink-0 flex-col overflow-y-auto border-l border-ink-800 bg-ink-900">
      <SelectionPanel />
      <div className="p-4 pb-2">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'layout', label: 'Layout' },
            { value: 'style', label: 'Style' },
            { value: 'cursor', label: 'Cursor' }
          ]}
        />
      </div>
      <div className="px-4 pb-6">
        {tab === 'layout' && (
          <>
            <SectionTitle>Default layout</SectionTitle>
            <LayoutPicker
              value={hasCamera ? project.defaultLayout : 'screen'}
              disabled={!hasCamera}
              onChange={(v) => update((p) => void (p.defaultLayout = v))}
            />
            {!hasCamera && <p className="mt-2 text-xs text-ink-400">This recording has no camera track.</p>}
            <p className="mt-2 text-xs text-ink-400">
              Use “Layout” in the toolbar to switch layouts for part of the video.
            </p>

            {hasCamera && (
              <>
                <SectionTitle>Camera</SectionTitle>
                <Field label="Shape">
                  <Segmented
                    value={cam.shape}
                    onChange={(v) => update((p) => void (p.camera.shape = v))}
                    options={[
                      { value: 'circle', label: 'Circle' },
                      { value: 'rounded', label: 'Rounded' },
                      { value: 'square', label: 'Square' }
                    ]}
                  />
                </Field>
                <Slider
                  label="Bubble size"
                  value={cam.size}
                  min={0.1}
                  max={0.5}
                  onChange={(v) => update((p) => void (p.camera.size = v), 'cam-size')}
                  format={(v) => `${Math.round(v * 100)}%`}
                />
                <Field label="Bubble position">
                  <Segmented
                    value=""
                    onChange={(v) =>
                      update((p) => {
                        const [x, y] = v.split(',').map(Number)
                        p.camera.x = x
                        p.camera.y = y
                      })
                    }
                    options={[
                      { value: '0.12,0.18', label: '↖' },
                      { value: '0.88,0.18', label: '↗' },
                      { value: '0.12,0.8', label: '↙' },
                      { value: '0.88,0.8', label: '↘' }
                    ]}
                  />
                </Field>
                <Field label="Side-by-side camera position">
                  <Segmented
                    value={cam.side}
                    onChange={(v) => update((p) => void (p.camera.side = v))}
                    options={[
                      { value: 'left', label: 'Left' },
                      { value: 'right', label: 'Right' }
                    ]}
                  />
                </Field>
                <Slider
                  label="Side-by-side camera width"
                  value={cam.sideRatio}
                  min={0.2}
                  max={0.6}
                  onChange={(v) => update((p) => void (p.camera.sideRatio = v), 'cam-side')}
                  format={(v) => `${Math.round(v * 100)}%`}
                />
                <Toggle
                  label="Mirror camera"
                  checked={cam.mirror}
                  onChange={(v) => update((p) => void (p.camera.mirror = v))}
                />
                <Slider
                  label="Border"
                  value={cam.borderWidth}
                  min={0}
                  max={12}
                  step={1}
                  onChange={(v) => update((p) => void (p.camera.borderWidth = v), 'cam-border')}
                  format={(v) => `${v}px`}
                />
                <Field label="Border color">
                  <ColorInput
                    value={cam.borderColor}
                    onChange={(v) => update((p) => void (p.camera.borderColor = v), 'cam-bc')}
                  />
                </Field>
              </>
            )}
          </>
        )}

        {tab === 'style' && (
          <>
            <SectionTitle>Format</SectionTitle>
            <Select
              value={project.aspect}
              onChange={(v) => update((p) => void (p.aspect = v))}
              options={[
                { value: '16:9', label: 'Widescreen 16:9' },
                { value: '9:16', label: 'Vertical 9:16 (Shorts, Reels)' },
                { value: '1:1', label: 'Square 1:1' },
                { value: '4:3', label: 'Standard 4:3' },
                { value: 'source', label: 'Match recording' }
              ]}
            />
            <SectionTitle>Background</SectionTitle>
            <div className="grid grid-cols-4 gap-2">
              {GRADIENTS.map((g) => (
                <button
                  key={g.join()}
                  onClick={() =>
                    update((p) => {
                      p.background.type = 'gradient'
                      p.background.colors = [g[0], g[1]]
                    })
                  }
                  className={cx(
                    'h-10 rounded-lg ring-2',
                    bg.type === 'gradient' && bg.colors[0] === g[0] && bg.colors[1] === g[1]
                      ? 'ring-accent'
                      : 'ring-transparent'
                  )}
                  style={{ background: `linear-gradient(135deg, ${g[0]}, ${g[1]})` }}
                />
              ))}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <ColorInput
                value={bg.colors[0]}
                onChange={(v) =>
                  update((p) => void (p.background.colors = [v, p.background.colors[1]]), 'bg-c0')
                }
              />
              <ColorInput
                value={bg.colors[1]}
                onChange={(v) =>
                  update((p) => void (p.background.colors = [p.background.colors[0], v]), 'bg-c1')
                }
              />
              <Select
                value={bg.type}
                onChange={(v) =>
                  v === 'image' && !bg.image
                    ? void chooseImage()
                    : update((p) => void (p.background.type = v))
                }
                options={[
                  { value: 'gradient', label: 'Gradient' },
                  { value: 'solid', label: 'Solid' },
                  { value: 'image', label: 'Image' }
                ]}
              />
            </div>
            <Button size="sm" variant="ghost" className="mt-2" onClick={() => void chooseImage()}>
              <ImageIcon size={13} /> Use an image…
            </Button>
            {bg.type === 'gradient' && (
              <Slider
                label="Angle"
                value={bg.angle}
                min={0}
                max={360}
                step={1}
                onChange={(v) => update((p) => void (p.background.angle = v), 'bg-angle')}
                format={(v) => `${v}°`}
              />
            )}
            <Slider
              label="Padding"
              value={bg.padding}
              min={0}
              max={0.2}
              onChange={(v) => update((p) => void (p.background.padding = v), 'bg-pad')}
              format={(v) => `${Math.round(v * 100)}%`}
            />
            <Slider
              label="Corner radius"
              value={bg.radius}
              min={0}
              max={48}
              step={1}
              onChange={(v) => update((p) => void (p.background.radius = v), 'bg-rad')}
              format={(v) => `${v}px`}
            />
            <Slider
              label="Shadow"
              value={bg.shadow}
              min={0}
              max={1}
              onChange={(v) => update((p) => void (p.background.shadow = v), 'bg-shadow')}
              format={(v) => `${Math.round(v * 100)}%`}
            />
          </>
        )}

        {tab === 'cursor' && (
          <>
            {!cursor && (
              <p className="mb-3 rounded-lg bg-ink-800 p-3 text-xs text-ink-300">
                No cursor data for this recording (window recordings don’t include it). Record a full screen
                to use these effects.
              </p>
            )}
            {cursor && cursor.clicks.length === 0 && (
              <p className="mb-3 rounded-lg bg-ink-800 p-3 text-xs text-ink-300">
                No clicks were captured. Grant the Accessibility permission to capture clicks for auto-zoom
                and ripples.
              </p>
            )}
            <SectionTitle>Auto-zoom</SectionTitle>
            <p className="mb-2 text-xs text-ink-400">
              Zooms in where you click and follows your cursor. You can edit each zoom on the timeline.
            </p>
            <Button size="sm" onClick={regenerate} disabled={!cursor}>
              <Sparkles size={13} /> Regenerate auto-zooms
            </Button>
            <SectionTitle>Effects</SectionTitle>
            <Toggle
              label="Click ripples"
              checked={fx.clickRipple}
              onChange={(v) => update((p) => void (p.cursorFx.clickRipple = v))}
            />
            {fx.clickRipple && (
              <Field label="Ripple color">
                <ColorInput
                  value={fx.rippleColor}
                  onChange={(v) => update((p) => void (p.cursorFx.rippleColor = v), 'fx-rc')}
                />
              </Field>
            )}
            <Toggle
              label="Cursor glow"
              hint="A soft halo that makes the cursor easy to follow"
              checked={fx.glow}
              onChange={(v) => update((p) => void (p.cursorFx.glow = v))}
            />
            {fx.glow && (
              <Field label="Glow color">
                <ColorInput
                  value={fx.glowColor}
                  onChange={(v) => update((p) => void (p.cursorFx.glowColor = v), 'fx-gc')}
                />
              </Field>
            )}
            <Toggle
              label="Spotlight"
              hint="Dims everything except the area around the cursor"
              checked={fx.spotlight}
              onChange={(v) => update((p) => void (p.cursorFx.spotlight = v))}
            />
            {fx.spotlight && (
              <>
                <Slider
                  label="Spotlight size"
                  value={fx.spotlightRadius}
                  min={0.04}
                  max={0.4}
                  onChange={(v) => update((p) => void (p.cursorFx.spotlightRadius = v), 'fx-sr')}
                  format={(v) => `${Math.round(v * 100)}%`}
                />
                <Slider
                  label="Dim"
                  value={fx.spotlightDim}
                  min={0.1}
                  max={0.9}
                  onChange={(v) => update((p) => void (p.cursorFx.spotlightDim = v), 'fx-sd')}
                  format={(v) => `${Math.round(v * 100)}%`}
                />
              </>
            )}
            <Toggle
              label="Keyboard shortcuts"
              hint="Shows ⌘/⌃/⌥ combos you pressed"
              checked={fx.keystrokes}
              onChange={(v) => update((p) => void (p.cursorFx.keystrokes = v))}
            />
            <div className="mt-4 flex items-center gap-2 text-xs text-ink-400">
              <MousePointer2 size={12} />{' '}
              {cursor
                ? `${cursor.clicks.length} clicks · ${cursor.keys.length} shortcuts captured`
                : 'No cursor data'}
            </div>
          </>
        )}
      </div>
    </aside>
  )
}
