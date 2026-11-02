import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DriveClient } from '../../src/main/drive/driveClient'
import { authorize, DRIVE_SCOPE, refreshAccessToken, type OAuthConfig } from '../../src/main/drive/googleAuth'
import { startFakeGoogle, type FakeGoogle } from '../support/fakeGoogle'

let g: FakeGoogle
let cfg: OAuthConfig
let dir: string

beforeAll(async () => {
  g = await startFakeGoogle()
  cfg = {
    clientId: 'test-client',
    clientSecret: 'test-secret',
    authUrl: `${g.url}/auth`,
    tokenUrl: `${g.url}/token`,
    revokeUrl: `${g.url}/revoke`
  }
  dir = mkdtempSync(join(tmpdir(), 'spotlight-drive-'))
})
afterAll(async () => {
  await g.close()
  rmSync(dir, { recursive: true, force: true })
})

/** Stands in for the browser: follows the consent redirect back to the loopback server. */
const browser = (url: string): Promise<Response> => fetch(url)

describe('googleAuth', () => {
  it('runs the loopback + PKCE flow and requests only drive.file', async () => {
    let authUrl = ''
    const tokens = await authorize(cfg, (u) => {
      authUrl = u
      return browser(u)
    })
    const q = new URL(authUrl).searchParams
    expect(q.get('scope')).toBe(DRIVE_SCOPE)
    expect(q.get('code_challenge_method')).toBe('S256')
    expect(q.get('redirect_uri')).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    expect(q.get('access_type')).toBe('offline')
    expect(tokens.refreshToken).toBe('rt_fake')
    expect(tokens.expiresAt).toBeGreaterThan(Date.now())
  })

  it('rejects when the user denies access', async () => {
    const deny = async (u: string): Promise<void> => {
      const redirect = new URL(new URL(u).searchParams.get('redirect_uri')!)
      redirect.searchParams.set('error', 'access_denied')
      await fetch(redirect)
    }
    await expect(authorize(cfg, deny)).rejects.toThrow(/canceled/)
  })

  it('rejects a redirect with the wrong state (CSRF)', async () => {
    const forged = async (u: string): Promise<void> => {
      const redirect = new URL(new URL(u).searchParams.get('redirect_uri')!)
      redirect.searchParams.set('code', 'x')
      redirect.searchParams.set('state', 'forged')
      await fetch(redirect)
    }
    await expect(authorize(cfg, forged)).rejects.toThrow(/failed/)
  })

  it('can be aborted while waiting for the browser', async () => {
    const ctrl = new AbortController()
    const p = authorize(cfg, () => setTimeout(() => ctrl.abort(), 20), { signal: ctrl.signal })
    await expect(p).rejects.toThrow(/canceled/)
  })

  it('refreshes access tokens', async () => {
    const t = await refreshAccessToken(cfg, 'rt_fake')
    expect(t.accessToken).toMatch(/^at_/)
    await expect(refreshAccessToken(cfg, 'bad')).rejects.toThrow(/invalid_grant/)
  })
})

describe('DriveClient', () => {
  let token = ''
  const getToken = async (force?: boolean): Promise<string> => {
    if (!token || force) token = (await refreshAccessToken(cfg, 'rt_fake')).accessToken
    return token
  }
  const drive = (): DriveClient => new DriveClient(getToken, g.url)

  it('creates the app folder once and reuses it', async () => {
    const a = await drive().ensureFolder('Spotlight Studio')
    const b = await drive().ensureFolder('Spotlight Studio')
    const c = await drive().ensureFolder('Spotlight Studio', a)
    expect(b).toBe(a)
    expect(c).toBe(a)
    expect([...g.files.values()].filter((f) => f.name === 'Spotlight Studio')).toHaveLength(1)
  })

  it('uploads in chunks with progress, survives a 503 and an expired token, and shares by link', async () => {
    const data = randomBytes(256 * 1024 * 3 + 12345)
    const path = join(dir, 'demo.mp4')
    writeFileSync(path, data)
    const folder = await drive().ensureFolder('Spotlight Studio')
    const progress: number[] = []
    g.failNextChunks(1, 503)
    const refreshesBefore = g.stats.refreshes
    // Expire the token mid-upload: the client must refresh and continue.
    const d = drive()
    const p = d.uploadFile(path, {
      name: 'My demo.mp4',
      folderId: folder,
      chunkSize: 256 * 1024,
      onProgress: (s) => progress.push(s)
    })
    g.expireNextTokens(1)
    const file = await p
    await d.shareWithLink(file.id)

    const stored = g.files.get(file.id)!
    expect(stored.name).toBe('My demo.mp4')
    expect(stored.parents).toEqual([folder])
    expect(stored.mimeType).toBe('video/mp4')
    expect(Buffer.compare(stored.data, data)).toBe(0)
    expect(stored.permissions).toEqual([{ role: 'reader', type: 'anyone' }])
    expect(file.webViewLink).toBe(`https://drive.google.com/file/d/${file.id}/view`)
    expect(progress.at(-1)).toBe(data.length)
    expect(progress).toEqual([...progress].sort((a, b) => a - b))
    expect(g.stats.chunkPuts).toBeGreaterThanOrEqual(5) // 4 chunks + the failed one
    expect(g.stats.refreshes).toBeGreaterThan(refreshesBefore)
  })

  it('cancels an upload', async () => {
    const path = join(dir, 'big.mp4')
    writeFileSync(path, randomBytes(256 * 1024 * 8))
    const ctrl = new AbortController()
    const p = drive().uploadFile(path, {
      chunkSize: 256 * 1024,
      signal: ctrl.signal,
      onProgress: (s) => s > 0 && ctrl.abort()
    })
    await expect(p).rejects.toThrow(/cancel|abort/i)
  })
})
