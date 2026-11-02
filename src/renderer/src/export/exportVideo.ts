/**
 * Renders the edited video to an MP4 file using WebCodecs (via mediabunny).
 * Frames are decoded from the raw media, composited with renderFrame() — the same
 * function the preview uses — and encoded to H.264 + AAC.
 */
import {
  AudioBufferSink,
  AudioBufferSource,
  CanvasSource,
  canEncodeVideo,
  getFirstEncodableAudioCodec,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  QUALITY_MEDIUM,
  QUALITY_VERY_HIGH,
  StreamTarget,
  VideoSampleSink,
  type InputAudioTrack,
  type VideoSample
} from 'mediabunny'
import { mediaUrl } from '@shared/ipc'
import { outputSize, type CursorData, type Project } from '@shared/project'
import { clipTimelineDuration, timelineDuration, timelineToSource } from '@shared/timeMap'
import { createScene, renderFrame, type FrameImage } from '../compositor/renderFrame'
import { fileWritable, join, openInput } from '../lib/media'

export interface ExportOptions {
  height: 720 | 1080 | 1440 | 2160
  fps: 30 | 60
  quality: 'medium' | 'high' | 'very-high'
}

export interface ExportProgress {
  progress: number
  frame: number
  frames: number
}

function sampleImage(s: VideoSample | null): FrameImage | null {
  if (!s) return null
  return { image: s.toCanvasImageSource(), width: s.displayWidth, height: s.displayHeight }
}

async function loadImage(url: string): Promise<FrameImage | null> {
  try {
    const blob = await (await fetch(url)).blob()
    const bmp = await createImageBitmap(blob)
    return { image: bmp, width: bmp.width, height: bmp.height }
  } catch {
    return null
  }
}

/** Yields timeline-ordered audio buffers: source audio for 1× clips, silence otherwise. */
async function* timelineAudio(project: Project, track: InputAudioTrack): AsyncGenerator<AudioBuffer> {
  const sink = new AudioBufferSink(track)
  const sampleRate = await track.getSampleRate()
  const channels = await track.getNumberOfChannels()
  const make = (frames: number): AudioBuffer =>
    new AudioBuffer({ length: Math.max(1, frames), numberOfChannels: channels, sampleRate })

  for (const clip of project.clips) {
    const expected = Math.round((clipTimelineDuration(clip) / 1000) * sampleRate)
    let produced = 0
    if (clip.speed === 1) {
      const s0 = clip.sourceStart / 1000
      const s1 = clip.sourceEnd / 1000
      for await (const wrapped of sink.buffers(s0, s1)) {
        const buf = wrapped.buffer
        // Trim the buffer to the clip boundaries.
        const from = Math.max(0, Math.round((s0 - wrapped.timestamp) * sampleRate))
        const to = Math.min(buf.length, Math.round((s1 - wrapped.timestamp) * sampleRate))
        let n = Math.min(to - from, expected - produced)
        if (n <= 0) continue
        // Fill any gap before this buffer with silence.
        const startAt = Math.round((wrapped.timestamp + from / sampleRate - s0) * sampleRate)
        if (startAt > produced + 1) {
          const gap = Math.min(startAt - produced, expected - produced)
          yield make(gap)
          produced += gap
          n = Math.min(n, expected - produced)
          if (n <= 0) continue
        }
        const out = make(n)
        for (let c = 0; c < channels; c++) {
          const src = buf.getChannelData(Math.min(c, buf.numberOfChannels - 1))
          out.copyToChannel(src.subarray(from, from + n), c)
        }
        produced += n
        yield out
      }
    }
    // Pad (silent clips, or missing audio at the end).
    while (produced < expected) {
      const n = Math.min(sampleRate, expected - produced)
      produced += n
      yield make(n)
    }
  }
}

export async function exportVideo(
  folder: string,
  project: Project,
  cursor: CursorData | null,
  path: string,
  opts: ExportOptions,
  onProgress: (p: ExportProgress) => void,
  signal: AbortSignal
): Promise<void> {
  const { width: W, height: H } = outputSize(project, opts.height)
  if (!(await canEncodeVideo('avc', { width: W, height: H }))) {
    throw new Error(`This computer can't encode H.264 at ${W}×${H}. Try a lower resolution.`)
  }

  const canvas = new OffscreenCanvas(W, H)
  const ctx = canvas.getContext('2d', { alpha: false })!
  const scene = createScene(project, cursor)

  const screenInput = openInput(join(folder, project.sources.screen.file))
  const camera = project.sources.camera
  const cameraInput = camera ? openInput(join(folder, camera.file)) : null
  const background =
    project.background.type === 'image' && project.background.image
      ? await loadImage(mediaUrl(join(folder, project.background.image)))
      : null

  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: false }),
    target: new StreamTarget(await fileWritable(path), { chunked: true, chunkSize: 8 * 1024 * 1024 })
  })

  try {
    const screenTrack = await screenInput.getPrimaryVideoTrack()
    if (!screenTrack) throw new Error('The screen recording has no video track.')
    const cameraTrack = cameraInput ? await cameraInput.getPrimaryVideoTrack() : null
    const audioTrack = await screenInput.getPrimaryAudioTrack()

    const quality =
      opts.quality === 'very-high'
        ? QUALITY_VERY_HIGH
        : opts.quality === 'high'
          ? QUALITY_HIGH
          : QUALITY_MEDIUM
    const videoSource = new CanvasSource(canvas, { codec: 'avc', quality, keyFrameInterval: 2 })
    output.addVideoTrack(videoSource, { frameRate: opts.fps })

    let audioSource: AudioBufferSource | null = null
    let audioGen: AsyncGenerator<AudioBuffer> | null = null
    if (audioTrack) {
      const codec = await getFirstEncodableAudioCodec(['aac', 'opus'], {
        numberOfChannels: 2,
        sampleRate: 48000
      })
      if (codec) {
        audioSource = new AudioBufferSource({ codec, quality: QUALITY_HIGH })
        output.addAudioTrack(audioSource)
        audioGen = timelineAudio(project, audioTrack)
      }
    }

    await output.start()

    const duration = timelineDuration(project.clips)
    const frames = Math.max(1, Math.ceil((duration / 1000) * opts.fps))
    const frameMs = 1000 / opts.fps
    const sourceTimes = Array.from(
      { length: frames },
      (_, i) => timelineToSource(project.clips, i * frameMs).source
    )

    const screenSamples = new VideoSampleSink(screenTrack).samplesAtTimestamps(
      sourceTimes.map((s) => s / 1000)
    )
    const cameraSamples =
      cameraTrack && camera
        ? new VideoSampleSink(cameraTrack).samplesAtTimestamps(
            sourceTimes.map((s) => Math.max(0, (s - camera.offsetMs) / 1000))
          )
        : null

    let audioAddedSec = 0
    let audioDone = !audioGen
    const pumpAudio = async (untilSec: number): Promise<void> => {
      while (!audioDone && audioAddedSec < untilSec) {
        if (signal.aborted) return
        const r = await audioGen!.next()
        if (r.done) {
          audioDone = true
          break
        }
        await audioSource!.add(r.value)
        audioAddedSec += r.value.duration
      }
    }

    for (let i = 0; i < frames; i++) {
      if (signal.aborted) throw new DOMException('Export canceled', 'AbortError')
      const t = i * frameMs
      await pumpAudio(t / 1000 + 1)
      const [scr, cam] = await Promise.all([
        screenSamples.next(),
        cameraSamples ? cameraSamples.next() : Promise.resolve(null)
      ])
      const screenSample = scr.done ? null : scr.value
      const cameraSample = cam && !cam.done ? cam.value : null
      try {
        renderFrame(
          ctx,
          W,
          H,
          scene,
          {
            screen: sampleImage(screenSample),
            camera: sampleImage(cameraSample),
            backgroundImage: background
          },
          sourceTimes[i]
        )
      } finally {
        screenSample?.close()
        cameraSample?.close()
      }
      await videoSource.add(t / 1000, frameMs / 1000)
      if (i % 5 === 0 || i === frames - 1) onProgress({ progress: (i + 1) / frames, frame: i + 1, frames })
    }
    await pumpAudio(Infinity)
    await screenSamples.return(undefined)
    await cameraSamples?.return(undefined)
    await output.finalize()
  } catch (err) {
    if (output.state !== 'finalized' && output.state !== 'canceled')
      await output.cancel().catch(() => undefined)
    throw err
  } finally {
    screenInput.dispose()
    cameraInput?.dispose()
  }
}
