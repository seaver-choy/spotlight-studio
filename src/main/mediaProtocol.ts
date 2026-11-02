/**
 * `ss-media://local/<encoded absolute path>` — streams local media files to the
 * renderer with HTTP range support, so <video> elements can seek and mediabunny
 * can read files lazily without loading them fully into memory.
 */
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { Readable } from 'node:stream'
import { protocol } from 'electron'
import { MEDIA_SCHEME } from '@shared/ipc'

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif'
}

const allowedRoots = new Set<string>()

/** Only files inside these folders can be served (recordings root + opened projects). */
export function allowMediaRoot(folder: string): void {
  allowedRoots.add(resolve(folder))
}

function isAllowed(path: string): boolean {
  const p = resolve(path)
  for (const root of allowedRoots) if (p === root || p.startsWith(root + sep)) return true
  return false
}

export function registerMediaSchemePrivileges(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: MEDIA_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        bypassCSP: true,
        corsEnabled: true
      }
    }
  ])
}

export function handleMediaProtocol(): void {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    try {
      const url = new URL(request.url)
      const path = decodeURIComponent(url.pathname.replace(/^\//, ''))
      if (!isAllowed(path)) return new Response('Forbidden', { status: 403 })
      const info = await stat(path)
      const size = info.size
      const type = MIME[extname(path).toLowerCase()] ?? 'application/octet-stream'
      const headers: Record<string, string> = {
        'Content-Type': type,
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache'
      }
      const range = request.headers.get('range')
      const m = range ? /bytes=(\d*)-(\d*)/.exec(range) : null
      if (m && size > 0) {
        let start = m[1] ? parseInt(m[1], 10) : 0
        let end = m[2] ? parseInt(m[2], 10) : size - 1
        if (!m[1] && m[2]) {
          // Suffix range: last N bytes.
          start = Math.max(0, size - parseInt(m[2], 10))
          end = size - 1
        }
        end = Math.min(end, size - 1)
        if (start > end || start >= size) {
          return new Response(null, {
            status: 416,
            headers: { ...headers, 'Content-Range': `bytes */${size}` }
          })
        }
        const body = Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream
        return new Response(body, {
          status: 206,
          headers: {
            ...headers,
            'Content-Range': `bytes ${start}-${end}/${size}`,
            'Content-Length': String(end - start + 1)
          }
        })
      }
      const body = Readable.toWeb(createReadStream(path)) as ReadableStream
      return new Response(body, { status: 200, headers: { ...headers, 'Content-Length': String(size) } })
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })
}
