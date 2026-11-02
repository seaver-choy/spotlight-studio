#!/usr/bin/env node
/**
 * Generates a synthetic recording folder (needs ffmpeg on PATH) for testing the
 * editor and exporter without recording your screen:
 *   node scripts/make-fixture.mjs [outDir] [seconds]
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const out = resolve(process.argv[2] ?? 'tests/fixtures/generated/demo')
const secs = Number(process.argv[3] ?? 8)
rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })

const ff = (...args) =>
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' })

// "Screen": 1920x1200 test pattern + a tone, H.264/AAC in MP4 (like MediaRecorder's MP4 output).
ff(
  '-f',
  'lavfi',
  '-i',
  `testsrc2=size=1920x1200:rate=30:duration=${secs}`,
  '-f',
  'lavfi',
  '-i',
  `sine=frequency=440:sample_rate=48000:duration=${secs}`,
  '-c:v',
  'libx264',
  '-pix_fmt',
  'yuv420p',
  '-g',
  '60',
  '-c:a',
  'aac',
  '-shortest',
  join(out, 'screen.raw.mp4')
)
// "Camera": 640x480 VP8 WebM (like MediaRecorder's WebM output).
ff(
  '-f',
  'lavfi',
  '-i',
  `testsrc=size=640x480:rate=30:duration=${secs}`,
  '-c:v',
  'libvpx',
  '-b:v',
  '1M',
  join(out, 'camera.raw.webm')
)

// Cursor: a figure-eight path with a few clicks and a shortcut.
const samples = []
for (let t = 0; t <= secs * 1000; t += 1000 / 60) {
  const a = (t / 1000) * 0.8
  samples.push([
    Math.round(t),
    +(0.5 + 0.35 * Math.sin(a)).toFixed(4),
    +(0.5 + 0.3 * Math.sin(2 * a)).toFixed(4)
  ])
}
const at = (t) => samples.find((s) => s[0] >= t)
const clicks = [1500, 1900, 5200].map((t) => ({ t, x: at(t)[1], y: at(t)[2], button: 1 }))
writeFileSync(
  join(out, 'cursor.json'),
  JSON.stringify({ version: 1, samples, clicks, keys: [{ t: 3000, label: '⌘S' }] })
)
writeFileSync(
  join(out, 'recording.json'),
  JSON.stringify(
    {
      version: 1,
      createdAt: new Date().toISOString(),
      source: { kind: 'screen', name: 'Fixture' },
      screen: { file: 'screen.raw.mp4', mime: 'video/mp4' },
      camera: { file: 'camera.raw.webm', mime: 'video/webm', offsetMs: 40 },
      hasCursor: true
    },
    null,
    2
  )
)
console.log(out)
