/**
 * End-to-end: open a synthetic recording in the real app, check the first-open
 * processing (remux + auto-zoom), then export an MP4 and verify it with ffprobe.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

const root = resolve(__dirname, '../..')
const fixture = join(root, 'tests/fixtures/generated/e2e')
const exportPath = join(root, 'tests/fixtures/generated/e2e-export.mp4')

test.beforeAll(() => {
  execFileSync('node', [join(root, 'scripts/make-fixture.mjs'), fixture, '6'], { stdio: 'inherit' })
  rmSync(exportPath, { force: true })
})

test('opens a recording, edits and exports it', async () => {
  const app = await electron.launch({
    args: [root],
    env: {
      ...process.env,
      SPOTLIGHT_OPEN_FOLDER: fixture,
      SPOTLIGHT_EXPORT_PATH: exportPath,
      SPOTLIGHT_USER_DATA: join(root, 'tests/fixtures/generated/userdata')
    }
  })
  const win = await app.firstWindow()
  const errors: string[] = []
  win.on('pageerror', (e) => errors.push(e.message))
  win.on('console', (m) => m.type() === 'error' && errors.push(m.text()))

  await expect(win.getByRole('button', { name: 'Export' })).toBeVisible({ timeout: 60_000 })

  // First open: raw files were remuxed and a project was created with auto-zooms.
  expect(existsSync(join(fixture, 'screen.mp4'))).toBe(true)
  expect(existsSync(join(fixture, 'camera.mp4'))).toBe(true)
  const project = JSON.parse(readFileSync(join(fixture, 'project.json'), 'utf8'))
  expect(project.zooms.length).toBeGreaterThan(0)
  expect(project.sources.screen.width).toBe(1920)
  expect(project.sources.camera.offsetMs).toBe(40)

  // Add a highlight and split the clip, to exercise editing.
  await win.getByRole('button', { name: 'Highlight' }).click()
  await win.getByRole('button', { name: 'Text callout' }).click()
  await win.keyboard.press('ArrowRight')
  await win.screenshot({ path: join(root, 'tests/fixtures/generated/editor.png') })

  // Autosave persists the edit.
  await expect
    .poll(() => JSON.parse(readFileSync(join(fixture, 'project.json'), 'utf8')).annotations.length, {
      timeout: 5000
    })
    .toBe(1)

  // External edit (as an AI agent would do) is picked up live.
  const edited = JSON.parse(readFileSync(join(fixture, 'project.json'), 'utf8'))
  edited.name = 'Edited by agent'
  edited.annotations[0].text = 'Agent text'
  writeFileSync(join(fixture, 'project.json'), JSON.stringify(edited, null, 2))
  await expect(win.locator('header input')).toHaveValue('Edited by agent', { timeout: 10_000 })
  await expect(win.getByText('Text: Agent text')).toBeVisible()

  // Export.
  await win.getByRole('button', { name: 'Export' }).click()
  await win.getByRole('button', { name: '720p' }).click()
  await win.getByRole('button', { name: '30 fps' }).click()
  await win.getByRole('button', { name: 'Export MP4' }).click()
  await expect(win.getByText(/Export finished/)).toBeVisible({ timeout: 120_000 })
  await app.close()

  const probe = JSON.parse(
    execFileSync('ffprobe', [
      '-v',
      'error',
      '-show_streams',
      '-show_format',
      '-of',
      'json',
      exportPath
    ]).toString()
  )
  const video = probe.streams.find((s: { codec_type: string }) => s.codec_type === 'video')
  const audio = probe.streams.find((s: { codec_type: string }) => s.codec_type === 'audio')
  expect(video.codec_name).toBe('h264')
  expect(video.width).toBe(1280)
  expect(video.height).toBe(720)
  expect(audio).toBeTruthy()
  expect(Number(probe.format.duration)).toBeGreaterThan(5.5)
  expect(Number(probe.format.duration)).toBeLessThan(6.5)
  expect(errors.filter((e) => !/Autofill|DevTools/.test(e))).toEqual([])
})

test('home window renders', async () => {
  const app = await electron.launch({
    args: [root],
    env: { ...process.env, SPOTLIGHT_USER_DATA: join(root, 'tests/fixtures/generated/userdata') }
  })
  const win = await app.firstWindow()
  const errors: string[] = []
  win.on('pageerror', (e) => errors.push(e.message))
  await expect(win.getByRole('button', { name: /Start recording/ })).toBeVisible({ timeout: 30_000 })
  await expect(win.getByText('What do you want to record?')).toBeVisible()
  await win.screenshot({ path: join(root, 'tests/fixtures/generated/home.png') })
  await app.close()
  expect(errors).toEqual([])
})
