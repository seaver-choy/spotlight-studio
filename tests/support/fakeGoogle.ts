/**
 * A tiny fake of the Google OAuth + Drive v3 endpoints the app uses, for tests.
 * Implements the resumable upload protocol (308 + Range) faithfully enough to
 * exercise chunking, retries and token refresh.
 */
import { createHash, randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

export interface FakeFile {
  id: string
  name: string
  mimeType: string
  parents: string[]
  data: Buffer
  permissions: Array<{ role: string; type: string }>
}

export interface FakeGoogle {
  url: string
  files: Map<string, FakeFile>
  /** Fail the next N chunk PUTs with this status. */
  failNextChunks: (n: number, status: number) => void
  /** Reject the next N API calls with 401. */
  expireNextTokens: (n: number) => void
  stats: { tokenRequests: number; refreshes: number; chunkPuts: number; revoked: string[] }
  close: () => Promise<void>
}

const readBody = (req: IncomingMessage): Promise<Buffer> =>
  new Promise((resolve) => {
    const parts: Buffer[] = []
    req.on('data', (c: Buffer) => parts.push(c))
    req.on('end', () => resolve(Buffer.concat(parts)))
  })

export async function startFakeGoogle(): Promise<FakeGoogle> {
  const files = new Map<string, FakeFile>()
  const codes = new Map<string, string>() // code → code_challenge
  const sessions = new Map<
    string,
    {
      meta: { name: string; mimeType: string; parents?: string[] }
      total: number
      data: Buffer[]
      received: number
    }
  >()
  const validTokens = new Set<string>()
  const stats = { tokenRequests: 0, refreshes: 0, chunkPuts: 0, revoked: [] as string[] }
  let failChunks = { n: 0, status: 503 }
  let expire = 0
  let url = ''

  const issue = (): string => {
    const t = `at_${randomBytes(6).toString('hex')}`
    validTokens.add(t)
    return t
  }

  const server: Server = createServer(async (req, res) => {
    const u = new URL(req.url ?? '/', url)
    const json = (status: number, body: unknown, headers: Record<string, string> = {}): void => {
      res.writeHead(status, { 'Content-Type': 'application/json', ...headers })
      res.end(JSON.stringify(body))
    }

    // --- OAuth ---
    if (u.pathname === '/auth') {
      const code = `code_${randomBytes(4).toString('hex')}`
      codes.set(code, u.searchParams.get('code_challenge') ?? '')
      const back = new URL(u.searchParams.get('redirect_uri')!)
      back.searchParams.set('code', code)
      back.searchParams.set('state', u.searchParams.get('state') ?? '')
      res.writeHead(302, { Location: back.toString() })
      return res.end()
    }
    if (u.pathname === '/token') {
      stats.tokenRequests++
      const form = new URLSearchParams((await readBody(req)).toString())
      if (form.get('grant_type') === 'authorization_code') {
        const challenge = codes.get(form.get('code') ?? '')
        const verifier = form.get('code_verifier') ?? ''
        const computed = createHash('sha256').update(verifier).digest('base64url')
        if (!challenge || challenge !== computed) return json(400, { error: 'invalid_grant' })
        codes.delete(form.get('code')!)
        return json(200, {
          access_token: issue(),
          expires_in: 3600,
          refresh_token: 'rt_fake',
          token_type: 'Bearer'
        })
      }
      if (form.get('grant_type') === 'refresh_token') {
        stats.refreshes++
        if (form.get('refresh_token') !== 'rt_fake') return json(400, { error: 'invalid_grant' })
        return json(200, { access_token: issue(), expires_in: 3600 })
      }
      return json(400, { error: 'unsupported_grant_type' })
    }
    if (u.pathname === '/revoke') {
      stats.revoked.push(u.searchParams.get('token') ?? '')
      return json(200, {})
    }

    // --- Drive (auth required) ---
    const token = (req.headers.authorization ?? '').replace(/^Bearer /, '')
    if (expire > 0 || !validTokens.has(token)) {
      if (expire > 0) {
        expire--
        validTokens.delete(token)
      }
      return json(401, { error: { message: 'Invalid Credentials' } })
    }

    if (u.pathname === '/drive/v3/about') {
      return json(200, { user: { emailAddress: 'demo@example.com', displayName: 'Demo User' } })
    }
    if (u.pathname === '/drive/v3/files' && req.method === 'GET') {
      const q = u.searchParams.get('q') ?? ''
      const name = /name = '([^']+)'/.exec(q)?.[1]
      const list = [...files.values()].filter(
        (f) => (!name || f.name === name) && (!q.includes('folder') || f.mimeType.endsWith('folder'))
      )
      return json(200, { files: list.map((f) => ({ id: f.id })) })
    }
    if (u.pathname === '/drive/v3/files' && req.method === 'POST') {
      const meta = JSON.parse((await readBody(req)).toString())
      const id = `folder_${files.size + 1}`
      files.set(id, {
        id,
        name: meta.name,
        mimeType: meta.mimeType,
        parents: [],
        data: Buffer.alloc(0),
        permissions: []
      })
      return json(200, { id })
    }
    const perm = /^\/drive\/v3\/files\/([^/]+)\/permissions$/.exec(u.pathname)
    if (perm && req.method === 'POST') {
      const f = files.get(perm[1])
      if (!f) return json(404, { error: { message: 'File not found' } })
      f.permissions.push(JSON.parse((await readBody(req)).toString()))
      return json(200, { id: 'anyoneWithLink' })
    }
    const fileGet = /^\/drive\/v3\/files\/([^/]+)$/.exec(u.pathname)
    if (fileGet && req.method === 'GET') {
      const f = files.get(fileGet[1])
      return f ? json(200, { id: f.id, trashed: false }) : json(404, { error: { message: 'File not found' } })
    }
    if (
      u.pathname === '/upload/drive/v3/files' &&
      req.method === 'POST' &&
      u.searchParams.get('uploadType') === 'resumable'
    ) {
      const meta = JSON.parse((await readBody(req)).toString())
      const sid = randomBytes(6).toString('hex')
      sessions.set(sid, {
        meta,
        total: Number(req.headers['x-upload-content-length']),
        data: [],
        received: 0
      })
      res.writeHead(200, { Location: `${url}/session/${sid}` })
      return res.end()
    }
    const sess = /^\/session\/(\w+)$/.exec(u.pathname)
    if (sess && req.method === 'PUT') {
      const s = sessions.get(sess[1])
      if (!s) return json(404, { error: { message: 'No such session' } })
      const body = await readBody(req)
      const range = String(req.headers['content-range'] ?? '')
      if (range.startsWith('bytes */')) {
        // Status query.
        if (s.received >= s.total) return json(200, {})
        res.writeHead(308, s.received > 0 ? { Range: `bytes=0-${s.received - 1}` } : {})
        return res.end()
      }
      stats.chunkPuts++
      if (failChunks.n > 0) {
        failChunks.n--
        return json(failChunks.status, { error: { message: 'Backend error' } })
      }
      const m = /bytes (\d+)-(\d+)\/(\d+)/.exec(range)
      if (!m || Number(m[1]) !== s.received) return json(400, { error: { message: `Bad range ${range}` } })
      s.data.push(body)
      s.received += body.length
      if (s.received < s.total) {
        res.writeHead(308, { Range: `bytes=0-${s.received - 1}` })
        return res.end()
      }
      const id = `file_${files.size + 1}`
      const f: FakeFile = {
        id,
        name: s.meta.name,
        mimeType: s.meta.mimeType,
        parents: s.meta.parents ?? [],
        data: Buffer.concat(s.data),
        permissions: []
      }
      files.set(id, f)
      sessions.delete(sess[1])
      return json(200, { id, name: f.name, webViewLink: `https://drive.google.com/file/d/${id}/view` })
    }
    json(404, { error: { message: `Unhandled ${req.method} ${u.pathname}` } })
  })

  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return {
    url,
    files,
    stats,
    failNextChunks: (n, status) => (failChunks = { n, status }),
    expireNextTokens: (n) => (expire = n),
    close: () =>
      new Promise((r) => {
        server.closeAllConnections()
        server.close(() => r())
      })
  }
}
