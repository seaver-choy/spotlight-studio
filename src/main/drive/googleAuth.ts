/**
 * Google OAuth 2.0 for desktop apps: the system browser + a loopback redirect + PKCE.
 * https://developers.google.com/identity/protocols/oauth2/native-app
 *
 * Only the `drive.file` scope is requested: the app can see and manage files it
 * created itself, and nothing else in the user's Drive.
 */
import { createHash, randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file'

export interface OAuthConfig {
  clientId: string
  /** Google issues a secret for "Desktop app" clients; it is not confidential for installed apps. */
  clientSecret?: string
  authUrl?: string
  tokenUrl?: string
  revokeUrl?: string
}

export interface TokenSet {
  accessToken: string
  /** Epoch ms. */
  expiresAt: number
  refreshToken: string
}

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke'

const b64url = (buf: Buffer): string => buf.toString('base64url')

const PAGE = (
  title: string,
  body: string
): string => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#0b0b0f;color:#ececf3;display:grid;place-items:center;height:100vh;margin:0}
main{text-align:center;max-width:420px}h1{font-size:20px}p{color:#9a9aae}</style></head>
<body><main><h1>${title}</h1><p>${body}</p></main></body></html>`

async function tokenRequest(
  cfg: OAuthConfig,
  params: Record<string, string>
): Promise<Record<string, unknown>> {
  const body = new URLSearchParams({ client_id: cfg.clientId, ...params })
  if (cfg.clientSecret) body.set('client_secret', cfg.clientSecret)
  const res = await fetch(cfg.tokenUrl ?? TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  })
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) {
    const msg = (json.error_description as string) || (json.error as string) || `HTTP ${res.status}`
    throw new Error(`Google sign-in failed: ${msg}`)
  }
  return json
}

/**
 * Opens the browser for consent and waits for the redirect back to a local port.
 * Resolves with tokens, or rejects on denial, timeout or abort.
 */
export async function authorize(
  cfg: OAuthConfig,
  openBrowser: (url: string) => unknown,
  opts: { timeoutMs?: number; signal?: AbortSignal } = {}
): Promise<TokenSet> {
  const verifier = b64url(randomBytes(32))
  const challenge = b64url(createHash('sha256').update(verifier).digest())
  const state = b64url(randomBytes(16))

  let server: Server | null = null
  const cleanup = (): void => {
    server?.close()
    server?.closeAllConnections?.()
    server = null
  }

  const code = await new Promise<{ code: string; redirectUri: string }>((resolve, reject) => {
    let redirectUri = ''
    const timer = setTimeout(
      () => {
        cleanup()
        reject(new Error('Google sign-in timed out. Please try again.'))
      },
      opts.timeoutMs ?? 5 * 60_000
    )
    const fail = (err: Error): void => {
      clearTimeout(timer)
      cleanup()
      reject(err)
    }
    opts.signal?.addEventListener('abort', () => fail(new Error('Google sign-in was canceled.')), {
      once: true
    })

    server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', redirectUri)
      if (url.pathname !== '/') {
        res.writeHead(404).end()
        return
      }
      const err = url.searchParams.get('error')
      const got = url.searchParams.get('code')
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      if (err || !got || url.searchParams.get('state') !== state) {
        res.end(
          PAGE(
            'Not connected',
            'Google Drive was not connected. You can close this tab and try again in Spotlight Studio.'
          )
        )
        fail(
          new Error(
            err === 'access_denied'
              ? 'Google sign-in was canceled.'
              : `Google sign-in failed: ${err ?? 'invalid response'}`
          )
        )
        return
      }
      res.end(PAGE('Google Drive connected', 'You can close this tab and go back to Spotlight Studio.'))
      clearTimeout(timer)
      resolve({ code: got, redirectUri })
      setTimeout(cleanup, 500)
    })
    server.on('error', fail)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server!.address() as AddressInfo
      redirectUri = `http://127.0.0.1:${port}`
      const auth = new URL(cfg.authUrl ?? AUTH_URL)
      auth.search = new URLSearchParams({
        client_id: cfg.clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: DRIVE_SCOPE,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state,
        access_type: 'offline',
        prompt: 'consent'
      }).toString()
      Promise.resolve(openBrowser(auth.toString())).catch((e: Error) => fail(e))
    })
  })

  const json = await tokenRequest(cfg, {
    code: code.code,
    code_verifier: verifier,
    redirect_uri: code.redirectUri,
    grant_type: 'authorization_code'
  })
  if (!json.refresh_token)
    throw new Error('Google did not return a refresh token. Please try connecting again.')
  return {
    accessToken: json.access_token as string,
    expiresAt: Date.now() + Number(json.expires_in ?? 3600) * 1000,
    refreshToken: json.refresh_token as string
  }
}

export async function refreshAccessToken(
  cfg: OAuthConfig,
  refreshToken: string
): Promise<{ accessToken: string; expiresAt: number }> {
  const json = await tokenRequest(cfg, { refresh_token: refreshToken, grant_type: 'refresh_token' })
  return {
    accessToken: json.access_token as string,
    expiresAt: Date.now() + Number(json.expires_in ?? 3600) * 1000
  }
}

export async function revokeToken(cfg: OAuthConfig, token: string): Promise<void> {
  await fetch(`${cfg.revokeUrl ?? REVOKE_URL}?token=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  }).catch(() => undefined)
}
