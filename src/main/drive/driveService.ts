/**
 * Google Drive integration for the app: connect/disconnect, token persistence
 * (refresh token encrypted with the OS keychain via safeStorage), and uploads.
 */
import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, safeStorage, shell, type WebContents } from 'electron'
import type { DriveStatus, DriveUploadResult } from '@shared/ipc'
import { DriveClient } from './driveClient'
import { authorize, refreshAccessToken, revokeToken, type OAuthConfig } from './googleAuth'

const FOLDER_NAME = 'Spotlight Studio'

interface Account {
  email: string
  name: string
  folderId: string | null
}

/** On disk: the account plus the refresh token encrypted with safeStorage (base64). */
interface Stored extends Account {
  refreshToken: string
}

function config(): OAuthConfig | null {
  const clientId = process.env['SPOTLIGHT_GOOGLE_CLIENT_ID'] || import.meta.env.MAIN_VITE_GOOGLE_CLIENT_ID
  const clientSecret =
    process.env['SPOTLIGHT_GOOGLE_CLIENT_SECRET'] || import.meta.env.MAIN_VITE_GOOGLE_CLIENT_SECRET
  if (!clientId) return null
  return {
    clientId,
    clientSecret: clientSecret || undefined,
    // Test hooks: point at a fake Google server.
    authUrl: process.env['SPOTLIGHT_GOOGLE_AUTH_URL'] || undefined,
    tokenUrl: process.env['SPOTLIGHT_GOOGLE_TOKEN_URL'] || undefined,
    revokeUrl: process.env['SPOTLIGHT_GOOGLE_REVOKE_URL'] || undefined
  }
}

const storePath = (): string => join(app.getPath('userData'), 'google-drive.json')

let stored: Account | null | undefined
let refreshToken: string | null = null
let access: { token: string; expiresAt: number } | null = null
let connecting: AbortController | null = null
const uploads = new Map<string, AbortController>()

async function load(): Promise<Account | null> {
  if (stored !== undefined) return stored
  try {
    const { refreshToken: enc, ...account } = JSON.parse(await readFile(storePath(), 'utf8')) as Stored
    refreshToken = safeStorage.decryptString(Buffer.from(enc, 'base64'))
    stored = account
  } catch {
    stored = null
  }
  return stored
}

async function save(s: Account, token: string): Promise<void> {
  stored = s
  refreshToken = token
  // Keep for this session only if there's no OS keychain (or in tests).
  if (!safeStorage.isEncryptionAvailable() || process.env['SPOTLIGHT_DRIVE_NO_PERSIST']) return
  const enc = safeStorage.encryptString(token).toString('base64')
  await writeFile(storePath(), JSON.stringify({ ...s, refreshToken: enc }), { mode: 0o600 })
}

async function accessToken(force = false): Promise<string> {
  const cfg = config()
  if (!cfg || !refreshToken) throw new Error('Google Drive is not connected.')
  if (!force && access && access.expiresAt - Date.now() > 60_000) return access.token
  try {
    const t = await refreshAccessToken(cfg, refreshToken)
    access = { token: t.accessToken, expiresAt: t.expiresAt }
    return access.token
  } catch (err) {
    // A revoked/expired refresh token means the user must reconnect.
    if (/invalid_grant/i.test((err as Error).message)) await forget()
    throw err
  }
}

const client = (): DriveClient =>
  new DriveClient(accessToken, process.env['SPOTLIGHT_GOOGLE_API_URL'] || undefined)

async function forget(): Promise<void> {
  stored = null
  refreshToken = null
  access = null
  await rm(storePath(), { force: true })
}

export async function driveStatus(): Promise<DriveStatus> {
  const s = await load()
  return { configured: !!config(), connected: !!s && !!refreshToken, email: s?.email ?? null }
}

export async function driveConnect(): Promise<DriveStatus> {
  const cfg = config()
  if (!cfg) throw new Error('Google Drive is not set up in this build. See docs/google-drive.md.')
  connecting?.abort()
  const ctrl = new AbortController()
  connecting = ctrl
  try {
    // With a fake local Google (tests), "open the browser" by requesting the URL directly.
    const fakeAuth = cfg.authUrl?.startsWith('http://127.0.0.1')
    const open = (url: string): Promise<unknown> => (fakeAuth ? fetch(url) : shell.openExternal(url))
    const tokens = await authorize(cfg, open, { signal: ctrl.signal })
    access = { token: tokens.accessToken, expiresAt: tokens.expiresAt }
    refreshToken = tokens.refreshToken
    const me = await client().about()
    await save({ email: me.email, name: me.name, folderId: null }, tokens.refreshToken)
    return driveStatus()
  } finally {
    if (connecting === ctrl) connecting = null
  }
}

export function driveCancelConnect(): void {
  connecting?.abort()
}

export async function driveDisconnect(): Promise<DriveStatus> {
  const cfg = config()
  if (cfg && refreshToken) await revokeToken(cfg, refreshToken)
  await forget()
  return driveStatus()
}

export async function driveUpload(
  sender: WebContents,
  uploadId: string,
  path: string,
  opts: { name?: string; share: boolean }
): Promise<DriveUploadResult> {
  const s = await load()
  if (!s || !refreshToken) throw new Error('Google Drive is not connected.')
  const ctrl = new AbortController()
  uploads.set(uploadId, ctrl)
  try {
    const drive = client()
    const folderId = await drive.ensureFolder(FOLDER_NAME, s.folderId)
    if (folderId !== s.folderId) await save({ ...s, folderId }, refreshToken)
    let last = 0
    const file = await drive.uploadFile(path, {
      name: opts.name,
      folderId,
      signal: ctrl.signal,
      onProgress: (sent, total) => {
        const now = Date.now()
        if (now - last < 150 && sent < total) return
        last = now
        if (!sender.isDestroyed()) sender.send('drive:progress', { uploadId, sent, total })
      }
    })
    if (opts.share) await drive.shareWithLink(file.id)
    return { id: file.id, link: file.webViewLink, shared: opts.share }
  } finally {
    uploads.delete(uploadId)
  }
}

export function driveCancelUpload(uploadId: string): void {
  uploads.get(uploadId)?.abort()
}
