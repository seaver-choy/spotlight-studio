import {
  ALL_FORMATS,
  Conversion,
  Input,
  Mp4OutputFormat,
  Output,
  StreamTarget,
  UrlSource,
  type StreamTargetChunk
} from 'mediabunny'
import { mediaUrl } from '@shared/ipc'

export function join(folder: string, file: string): string {
  return `${folder.replace(/\/+$/, '')}/${file}`
}

/** A WritableStream that writes positioned chunks to a file via the main process. */
export async function fileWritable(path: string): Promise<WritableStream<StreamTargetChunk>> {
  const handle = await window.api.fileOpen(path)
  let closed = false
  const close = async (): Promise<void> => {
    if (closed) return
    closed = true
    await window.api.fileClose(handle)
  }
  return new WritableStream<StreamTargetChunk>({
    write: (chunk) => window.api.fileWrite(handle, chunk.position, chunk.data),
    close,
    abort: close
  })
}

export function openInput(path: string): Input {
  return new Input({ formats: ALL_FORMATS, source: new UrlSource(mediaUrl(path)) })
}

export interface VideoInfo {
  width: number
  height: number
  durationMs: number
  hasAudio: boolean
}

export async function probe(path: string): Promise<VideoInfo> {
  const input = openInput(path)
  try {
    const video = await input.getPrimaryVideoTrack()
    if (!video) throw new Error(`No video track in ${path}`)
    const audio = await input.getPrimaryAudioTrack()
    const duration = await input.computeDuration()
    return {
      width: await video.getDisplayWidth(),
      height: await video.getDisplayHeight(),
      durationMs: Math.round(duration * 1000),
      hasAudio: !!audio
    }
  } finally {
    input.dispose()
  }
}

/**
 * MediaRecorder output lacks a proper index/duration, which breaks seeking.
 * Remux (no re-encode) into a regular MP4.
 */
export async function remuxToMp4(src: string, dest: string, onProgress?: (p: number) => void): Promise<void> {
  const input = openInput(src)
  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: false }),
    target: new StreamTarget(await fileWritable(dest), { chunked: true, chunkSize: 8 * 1024 * 1024 })
  })
  try {
    const conversion = await Conversion.init({ input, output, showWarnings: false })
    if (!conversion.isValid) {
      throw new Error(`Cannot convert ${src}: ${conversion.discardedTracks.map((t) => t.reason).join(', ')}`)
    }
    if (onProgress) conversion.onProgress = (p) => onProgress(p)
    await conversion.execute()
  } finally {
    input.dispose()
  }
}
