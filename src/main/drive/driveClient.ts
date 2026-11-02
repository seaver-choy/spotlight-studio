/**
 * Minimal Google Drive v3 client: folder lookup/creation, resumable uploads with
 * progress and cancel, and link sharing. Uses global fetch (Node / Electron main).
 * https://developers.google.com/drive/api/guides/manage-uploads#resumable
 */
import { open, stat } from 'node:fs/promises'
import { basename } from 'node:path'

export interface DriveFile {
  id: string
  name: string
  webViewLink: string
}

export interface UploadOptions {
  name?: string
  folderId?: string
  mimeType?: string
  /** Bytes per request. Must be a multiple of 256 KiB. */
  chunkSize?: number
  onProgress?: (sent: number, total: number) => void
  signal?: AbortSignal
}

const FOLDER_MIME = 'application/vnd.google-apps.folder'
const CHUNK_UNIT = 256 * 1024

export class DriveError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

export class DriveClient {
  constructor(
    /** Returns a valid access token; `force` asks for a refreshed one (after a 401). */
    private readonly getToken: (force?: boolean) => Promise<string>,
    private readonly base = 'https://www.googleapis.com'
  ) {}

  private async request(path: string, init: RequestInit = {}, retry = true): Promise<Response> {
    const token = await this.getToken()
    const res = await fetch(path.startsWith('http') ? path : `${this.base}${path}`, {
      ...init,
      headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` }
    })
    if (res.status === 401 && retry) {
      await this.getToken(true)
      return this.request(path, init, false)
    }
    return res
  }

  private async json<T>(res: Response): Promise<T> {
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
      throw new DriveError(body?.error?.message ?? `Google Drive error (HTTP ${res.status})`, res.status)
    }
    return (await res.json()) as T
  }

  async about(): Promise<{ email: string; name: string }> {
    const res = await this.request('/drive/v3/about?fields=user(emailAddress,displayName)')
    const j = await this.json<{ user: { emailAddress: string; displayName: string } }>(res)
    return { email: j.user.emailAddress, name: j.user.displayName }
  }

  /** Returns the id of a folder with this name created by the app, creating it if needed. */
  async ensureFolder(name: string, knownId?: string | null): Promise<string> {
    if (knownId) {
      const res = await this.request(`/drive/v3/files/${encodeURIComponent(knownId)}?fields=id,trashed`)
      if (res.ok) {
        const f = (await res.json()) as { id: string; trashed?: boolean }
        if (!f.trashed) return f.id
      }
    }
    const q = `name = '${name.replace(/'/g, "\\'")}' and mimeType = '${FOLDER_MIME}' and trashed = false`
    const found = await this.json<{ files: Array<{ id: string }> }>(
      await this.request(`/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)&spaces=drive`)
    )
    if (found.files.length) return found.files[0].id
    const created = await this.json<{ id: string }>(
      await this.request('/drive/v3/files?fields=id', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, mimeType: FOLDER_MIME })
      })
    )
    return created.id
  }

  /** Resumable upload of a local file. */
  async uploadFile(path: string, opts: UploadOptions = {}): Promise<DriveFile> {
    const total = (await stat(path)).size
    const chunk = Math.max(
      CHUNK_UNIT,
      Math.floor((opts.chunkSize ?? 16 * 1024 * 1024) / CHUNK_UNIT) * CHUNK_UNIT
    )
    const mimeType = opts.mimeType ?? 'video/mp4'
    const metadata = {
      name: opts.name ?? basename(path),
      mimeType,
      ...(opts.folderId ? { parents: [opts.folderId] } : {})
    }

    const init = await this.request(
      '/upload/drive/v3/files?uploadType=resumable&fields=id,name,webViewLink',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Type': mimeType,
          'X-Upload-Content-Length': String(total)
        },
        body: JSON.stringify(metadata),
        signal: opts.signal
      }
    )
    if (!init.ok) await this.json(init)
    const session = init.headers.get('location')
    if (!session) throw new DriveError('Google Drive did not start the upload.', init.status)

    const fh = await open(path, 'r')
    try {
      let offset = 0
      let failures = 0
      opts.onProgress?.(0, total)
      for (;;) {
        if (opts.signal?.aborted) throw new DOMException('Upload canceled', 'AbortError')
        const len = Math.min(chunk, total - offset)
        const buf = Buffer.alloc(len)
        if (len > 0) await fh.read(buf, 0, len, offset)
        let res: Response
        try {
          res = await this.request(session, {
            method: 'PUT',
            headers: {
              'Content-Length': String(len),
              'Content-Range': total === 0 ? 'bytes */0' : `bytes ${offset}-${offset + len - 1}/${total}`
            },
            body: buf,
            signal: opts.signal
          })
        } catch (err) {
          if (opts.signal?.aborted || ++failures > 5) throw err
          await new Promise((r) => setTimeout(r, 500 * 2 ** failures))
          offset = await this.resumeOffset(session, total)
          continue
        }
        if (res.status === 308) {
          // Incomplete: the Range header says how much Google has.
          const range = res.headers.get('range')
          offset = range ? Number(range.split('-')[1]) + 1 : 0
          failures = 0
          opts.onProgress?.(offset, total)
          continue
        }
        if (res.status >= 500 && ++failures <= 5) {
          await new Promise((r) => setTimeout(r, 500 * 2 ** failures))
          offset = await this.resumeOffset(session, total)
          continue
        }
        const file = await this.json<DriveFile>(res)
        opts.onProgress?.(total, total)
        return file
      }
    } finally {
      await fh.close()
    }
  }

  /** Ask the upload session how many bytes it has (after a network error). */
  private async resumeOffset(session: string, total: number): Promise<number> {
    const res = await this.request(session, {
      method: 'PUT',
      headers: { 'Content-Range': `bytes */${total}` }
    })
    if (res.status === 308) {
      const range = res.headers.get('range')
      return range ? Number(range.split('-')[1]) + 1 : 0
    }
    if (res.ok) return total
    return 0
  }

  /** Make the file viewable by anyone with the link. */
  async shareWithLink(fileId: string): Promise<void> {
    const res = await this.request(`/drive/v3/files/${encodeURIComponent(fileId)}/permissions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'reader', type: 'anyone' })
    })
    await this.json(res)
  }
}
