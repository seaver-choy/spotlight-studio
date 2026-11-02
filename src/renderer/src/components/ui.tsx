import type { ButtonHTMLAttributes, ReactNode } from 'react'

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg' }): ReactNode {
  return (
    <button
      {...rest}
      className={cx(
        'no-drag inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40',
        size === 'sm' && 'h-7 px-2.5 text-xs',
        size === 'md' && 'h-8 px-3 text-[13px]',
        size === 'lg' && 'h-11 px-5 text-sm',
        variant === 'primary' && 'bg-accent text-white hover:bg-accent-strong',
        variant === 'secondary' && 'bg-ink-700 text-ink-100 hover:bg-ink-600',
        variant === 'ghost' && 'text-ink-200 hover:bg-ink-700 hover:text-ink-100',
        variant === 'danger' && 'bg-rec text-white hover:brightness-110',
        className
      )}
    />
  )
}

export function Toggle({
  checked,
  onChange,
  label,
  hint
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: ReactNode
  hint?: ReactNode
}): ReactNode {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-3 py-1.5">
      <span className="flex flex-col">
        <span className="text-ink-100">{label}</span>
        {hint && <span className="text-xs text-ink-400">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cx(
          'relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors',
          checked ? 'bg-accent' : 'bg-ink-600'
        )}
      >
        <span
          className={cx(
            'absolute left-0 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform',
            checked ? 'translate-x-4.5' : 'translate-x-0.5'
          )}
        />
      </button>
    </label>
  )
}

export function Field({ label, children }: { label: ReactNode; children: ReactNode }): ReactNode {
  return (
    <div role="group" className="flex flex-col gap-1.5 py-1.5">
      <span className="text-xs font-medium text-ink-300">{label}</span>
      {children}
    </div>
  )
}

export function Select<T extends string>({
  value,
  onChange,
  options
}: {
  value: T
  onChange: (v: T) => void
  options: Array<{ value: T; label: string }>
}): ReactNode {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className="h-8 w-full rounded-lg border border-ink-600 bg-ink-800 px-2 text-[13px] text-ink-100 outline-none focus:border-accent"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 0.01,
  onChange,
  format
}: {
  label: ReactNode
  value: number
  min: number
  max: number
  step?: number
  onChange: (v: number) => void
  format?: (v: number) => string
}): ReactNode {
  return (
    <label className="flex flex-col gap-1 py-1.5">
      <span className="flex justify-between text-xs">
        <span className="font-medium text-ink-300">{label}</span>
        <span className="tabular-nums text-ink-400">{format ? format(value) : value.toFixed(2)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  )
}

export function ColorInput({ value, onChange }: { value: string; onChange: (v: string) => void }): ReactNode {
  return (
    <input
      type="color"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-8 w-10 cursor-pointer rounded-md border border-ink-600 bg-ink-800 p-0.5"
    />
  )
}

export function Segmented<T extends string>({
  value,
  onChange,
  options
}: {
  value: T
  onChange: (v: T) => void
  options: Array<{ value: T; label: ReactNode; title?: string }>
}): ReactNode {
  return (
    <div className="flex rounded-lg bg-ink-800 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cx(
            'flex h-7 flex-1 items-center justify-center gap-1 rounded-md px-2 text-xs font-medium transition-colors',
            value === o.value ? 'bg-ink-600 text-white shadow' : 'text-ink-300 hover:text-ink-100'
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function SectionTitle({ children }: { children: ReactNode }): ReactNode {
  return (
    <h3 className="mb-1 mt-4 text-[11px] font-semibold uppercase tracking-wider text-ink-400 first:mt-0">
      {children}
    </h3>
  )
}

export function formatTime(ms: number, withMs = false): string {
  const total = Math.max(0, ms) / 1000
  const m = Math.floor(total / 60)
  const s = Math.floor(total % 60)
  const base = `${m}:${String(s).padStart(2, '0')}`
  if (!withMs) return base
  return `${base}.${String(Math.floor((total % 1) * 10))}`
}
