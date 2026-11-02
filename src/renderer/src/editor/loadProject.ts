/**
 * Opens a recording folder. The first time, it finalizes the raw recordings
 * (remux to seekable MP4), then builds the initial project.json with auto-zooms.
 */
import type { RecordingMeta } from '@shared/ipc'
import {
  CursorDataSchema,
  newId,
  parseProject,
  PROJECT_VERSION,
  type CursorData,
  type Project
} from '@shared/project'
import { generateAutoZooms } from '@shared/zoom'
import { join, probe, remuxToMp4 } from '../lib/media'

async function readJson<T>(path: string): Promise<T | null> {
  const text = await window.api.readText(path)
  if (text === null) return null
  return JSON.parse(text) as T
}

async function finalizeTrack(
  folder: string,
  rawFile: string,
  finalFile: string,
  onStatus: (s: string) => void
): Promise<string> {
  const finalPath = join(folder, finalFile)
  if (await window.api.exists(finalPath)) return finalFile
  const rawPath = join(folder, rawFile)
  if (!(await window.api.exists(rawPath))) throw new Error(`Missing ${rawFile}`)
  try {
    await remuxToMp4(rawPath, finalPath, (p) => onStatus(`Preparing ${finalFile} — ${Math.round(p * 100)}%`))
    const info = await probe(finalPath)
    if (info.durationMs <= 0) throw new Error('empty output')
    await window.api.removeFile(rawPath)
    return finalFile
  } catch (err) {
    console.warn(`[load] remux of ${rawFile} failed, using raw file`, err)
    await window.api.removeFile(finalPath)
    return rawFile
  }
}

export async function loadCursor(folder: string, file: string | null): Promise<CursorData | null> {
  if (!file) return null
  const json = await readJson<unknown>(join(folder, file))
  if (!json) return null
  const parsed = CursorDataSchema.safeParse(json)
  return parsed.success ? parsed.data : null
}

export async function createProject(folder: string, onStatus: (s: string) => void): Promise<Project> {
  const meta = await readJson<RecordingMeta>(join(folder, 'recording.json'))
  if (!meta) throw new Error('This folder is not a Spotlight Studio recording (recording.json is missing).')

  onStatus('Preparing screen recording…')
  const screenFile = await finalizeTrack(folder, meta.screen.file, 'screen.mp4', onStatus)
  const screen = await probe(join(folder, screenFile))

  let camera: Project['sources']['camera'] = null
  if (meta.camera) {
    onStatus('Preparing camera recording…')
    try {
      const camFile = await finalizeTrack(folder, meta.camera.file, 'camera.mp4', onStatus)
      const cam = await probe(join(folder, camFile))
      camera = { file: camFile, width: cam.width, height: cam.height, offsetMs: meta.camera.offsetMs }
    } catch (err) {
      console.warn('[load] camera unavailable', err)
    }
  }

  const cursorFile = meta.hasCursor ? 'cursor.json' : null
  const cursor = await loadCursor(folder, cursorFile)
  const durationMs = screen.durationMs

  const project = parseProject({
    version: PROJECT_VERSION,
    name: `Recording ${new Date(meta.createdAt).toLocaleString()}`,
    createdAt: meta.createdAt,
    sources: {
      screen: {
        file: screenFile,
        width: screen.width,
        height: screen.height,
        durationMs,
        hasAudio: screen.hasAudio
      },
      camera,
      cursor: cursor ? cursorFile : null
    },
    clips: [{ id: newId('clip'), sourceStart: 0, sourceEnd: durationMs, speed: 1 }],
    defaultLayout: camera ? 'pip' : 'screen',
    zooms: generateAutoZooms(cursor, durationMs, () => newId('zoom'))
  })
  await window.api.writeText(join(folder, 'project.json'), JSON.stringify(project, null, 2))
  return project
}

export async function openProject(
  folder: string,
  onStatus: (s: string) => void
): Promise<{ project: Project; cursor: CursorData | null }> {
  const text = await window.api.readText(join(folder, 'project.json'))
  const project = text ? parseProject(JSON.parse(text)) : await createProject(folder, onStatus)
  const cursor = await loadCursor(folder, project.sources.cursor)
  return { project, cursor }
}
