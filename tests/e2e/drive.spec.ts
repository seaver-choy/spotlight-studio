/**
 * Google Drive upload through the real UI, against a fake Google server:
 * connect (OAuth loopback + PKCE), export, resumable upload, share link, disconnect.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import { startFakeGoogle, type FakeGoogle } from '../support/fakeGoogle'

const root = resolve(__dirname, '../..')
const fixture = join(root, 'tests/fixtures/generated/drive')
const exportPath = join(root, 'tests/fixtures/generated/drive-export.mp4')
let g: FakeGoogle
let userData: string

test.beforeAll(async () => {
  execFileSync('node', [join(root, 'scripts/make-fixture.mjs'), fixture, '3'], { stdio: 'inherit' })
  rmSync(exportPath, { force: true })
  g = await startFakeGoogle()
  userData = mkdtempSync(join(tmpdir(), 'spotlight-e2e-'))
})
test.afterAll(async () => {
  await g?.close()
  rmSync(userData, { recursive: true, force: true })
})

test('exports and uploads to Google Drive with a share link', async () => {
  const app = await electron.launch({
    args: [root],
    env: {
      ...process.env,
      SPOTLIGHT_OPEN_FOLDER: fixture,
      SPOTLIGHT_EXPORT_PATH: exportPath,
      SPOTLIGHT_USER_DATA: userData,
      SPOTLIGHT_DRIVE_NO_PERSIST: '1',
      SPOTLIGHT_GOOGLE_CLIENT_ID: 'test-client',
      SPOTLIGHT_GOOGLE_CLIENT_SECRET: 'test-secret',
      SPOTLIGHT_GOOGLE_AUTH_URL: `${g.url}/auth`,
      SPOTLIGHT_GOOGLE_TOKEN_URL: `${g.url}/token`,
      SPOTLIGHT_GOOGLE_REVOKE_URL: `${g.url}/revoke`,
      SPOTLIGHT_GOOGLE_API_URL: g.url
    }
  })
  const win = await app.firstWindow()
  const errors: string[] = []
  win.on('pageerror', (e) => errors.push(e.message))

  await win.getByRole('button', { name: 'Export' }).click({ timeout: 60_000 })
  await win.getByRole('button', { name: '720p' }).click()
  await win.getByRole('button', { name: '30 fps' }).click()
  await win.getByRole('switch', { name: 'Upload to Google Drive' }).click()
  await expect(win.getByText('Anyone with the link can view')).toBeVisible()

  await win.getByRole('button', { name: 'Connect Google Drive' }).click()
  await expect(win.getByText(/demo@example\.com/)).toBeVisible({ timeout: 15_000 })

  await win.getByRole('button', { name: 'Export & upload' }).click()
  await expect(win.getByText('Uploaded to Google Drive')).toBeVisible({ timeout: 120_000 })
  await expect(win.getByRole('button', { name: 'Copied' })).toBeVisible()
  await win.screenshot({ path: join(root, 'tests/fixtures/generated/drive-uploaded.png') })

  const uploaded = [...g.files.values()].find((f) => f.mimeType === 'video/mp4')!
  const folder = [...g.files.values()].find((f) => f.name === 'Spotlight Studio')!
  expect(uploaded.name).toMatch(/\.mp4$/)
  expect(uploaded.parents).toEqual([folder.id])
  expect(Buffer.compare(uploaded.data, readFileSync(exportPath))).toBe(0)
  expect(uploaded.permissions).toEqual([{ role: 'reader', type: 'anyone' }])
  const clip = await app.evaluate(({ clipboard }) => clipboard.readText())
  expect(clip).toBe(`https://drive.google.com/file/d/${uploaded.id}/view`)

  await app.close()
  expect(errors).toEqual([])
})
