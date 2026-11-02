/**
 * Records a canvas + tone with Chromium's real MediaRecorder (same MIME preferences as
 * the control bar), then opens it in the editor. This covers the "raw MediaRecorder
 * output → remux → seekable project" path without needing Screen Recording permission.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

const root = resolve(__dirname, '../..')
const folder = join(root, 'tests/fixtures/generated/mediarecorder')

test('MediaRecorder output opens in the editor', async () => {
  rmSync(folder, { recursive: true, force: true })
  mkdirSync(folder, { recursive: true })
  const app = await electron.launch({ args: [root], env: { ...process.env, SPOTLIGHT_OPEN_FOLDER: folder } })
  const win = await app.firstWindow()
  await expect(win.getByText('Couldn’t open this recording')).toBeVisible({ timeout: 30_000 })

  const result = await win.evaluate(async (dir) => {
    const mimes = [
      'video/mp4;codecs=avc1.640033,mp4a.40.2',
      'video/mp4;codecs=avc1,mp4a.40.2',
      'video/mp4;codecs=avc1,opus',
      'video/mp4',
      'video/webm;codecs=vp9,opus',
      'video/webm'
    ]
    const mime = mimes.find((m) => MediaRecorder.isTypeSupported(m))!
    const canvas = document.createElement('canvas')
    canvas.width = 1280
    canvas.height = 800
    const ctx = canvas.getContext('2d')!
    let frame = 0
    const draw = setInterval(() => {
      ctx.fillStyle = `hsl(${(frame * 6) % 360} 70% 50%)`
      ctx.fillRect(0, 0, 1280, 800)
      ctx.fillStyle = '#fff'
      ctx.font = '120px sans-serif'
      ctx.fillText(String(frame++), 100, 400)
    }, 1000 / 30)
    const ac = new AudioContext()
    const osc = ac.createOscillator()
    const dest = ac.createMediaStreamDestination()
    osc.connect(dest)
    osc.start()
    const stream = new MediaStream([
      ...canvas.captureStream(30).getVideoTracks(),
      ...dest.stream.getAudioTracks()
    ])
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8e6 })
    const ext = mime.includes('mp4') ? 'mp4' : 'webm'
    const handle = await window.api.fileOpen(`${dir}/screen.raw.${ext}`)
    let pos = 0
    let queue = Promise.resolve()
    rec.ondataavailable = (e) => {
      queue = queue.then(async () => {
        const buf = new Uint8Array(await e.data.arrayBuffer())
        await window.api.fileWrite(handle, pos, buf)
        pos += buf.byteLength
      })
    }
    await new Promise<void>((r) => {
      rec.onstart = () => r()
      rec.start(1000)
    })
    await new Promise((r) => setTimeout(r, 3000))
    await new Promise<void>((r) => {
      rec.onstop = () => r()
      rec.stop()
    })
    await queue
    await window.api.fileClose(handle)
    clearInterval(draw)
    osc.stop()
    return { mime: rec.mimeType || mime, ext }
  }, folder)
  console.log('MediaRecorder MIME:', result.mime)

  writeFileSync(
    join(folder, 'recording.json'),
    JSON.stringify({
      version: 1,
      createdAt: new Date().toISOString(),
      source: { kind: 'window', name: 'Canvas' },
      screen: { file: `screen.raw.${result.ext}`, mime: result.mime },
      camera: null,
      hasCursor: false
    })
  )
  await win.reload()
  await expect(win.getByRole('button', { name: 'Export' })).toBeVisible({ timeout: 60_000 })
  await app.close()

  const project = JSON.parse(readFileSync(join(folder, 'project.json'), 'utf8'))
  // The raw file was remuxed into a proper MP4 with a real duration.
  expect(project.sources.screen.file).toBe('screen.mp4')
  expect(existsSync(join(folder, `screen.raw.${result.ext}`))).toBe(false)
  expect(project.sources.screen.width).toBe(1280)
  expect(project.sources.screen.durationMs).toBeGreaterThan(2500)
  expect(project.sources.screen.durationMs).toBeLessThan(4000)
  expect(project.sources.screen.hasAudio).toBe(true)
})
