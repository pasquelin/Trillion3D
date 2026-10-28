// The scenarios `parity:<path>` and `parity:all`: the camera paths of the parity file
// (`PARITY_PATHS`, one file read by both engines being compared), frame for frame. Each path is
// played as the file gives it — the eye and its target of every image in metres, the clip's time of
// every image, the field of view and the planes once —, after its warm-up held on the first pose, at
// the file's frame rate and size; the images the file asks to capture are written under their number.
// The page is the run's first argument; `PARITY_PAGE` gives one when the run is given none.
import { existsSync } from 'node:fs'
import { readJson } from '../../../scripts/git/repository-files.ts'
import { benchMixers, type BenchMixer } from '../page/page.ts'
import type { Scenario, Segment } from './scenario.ts'

/** The columns of a row, in the order the file gives them (`frameColumns`). */
export const PARITY_COLUMNS = [
  'frame',
  't',
  'px',
  'py',
  'pz',
  'tx',
  'ty',
  'tz',
  'animTime',
] as const
/** One image of a path: its number, its time, the eye, the point it looks at, the clip's time. */
type ParityRow = readonly [
  frame: number,
  t: number,
  px: number,
  py: number,
  pz: number,
  tx: number,
  ty: number,
  tz: number,
  animTime: number,
]

/** A path as a segment plays it: its images, the camera's optics, the images to capture (their index
 *  in `rows`), the rate they are drawn at. */
export type ParityTrack = {
  rows: readonly ParityRow[]
  fov: number
  near: number
  far: number
  fps: number
  shots: readonly number[]
}

/** What the parity file holds, as the bench reads it. */
export type ParityFile = {
  fps: number
  width: number
  height: number
  near: number
  far: number
  fov: number
  warmup: number
  paths: Record<string, { rows: readonly ParityRow[]; shots: readonly number[] }>
}

function fail(message: string): never {
  throw new Error(`BENCH_PARITY: ${message}`)
}

/** The parity file at `file`, checked: its schema, its columns, every row nine numbers, the images to capture inside their path. */
export function readParityFile(file = process.env.PARITY_PATHS): ParityFile {
  if (!file || !existsSync(file)) fail(`no parity file: PARITY_PATHS names ${file ?? 'none'}`)
  const json = readJson(file)
  if (json.schema !== 'parity-paths/1') fail(`${file}: schema ${json.schema}, not parity-paths/1`)
  if (JSON.stringify(json.frameColumns) !== JSON.stringify(PARITY_COLUMNS))
    fail(`${file}: the columns are ${json.frameColumns}, not ${PARITY_COLUMNS}`)
  const paths: ParityFile['paths'] = {}
  for (const [name, path] of Object.entries<{ rows: ParityRow[]; shots?: number[] }>(json.paths)) {
    const { rows, shots = [] } = path
    if (!rows.length) fail(`path ${name} has no image`)
    rows.forEach((row, at) => {
      if (row.length !== PARITY_COLUMNS.length || !row.every(Number.isFinite) || row[0] !== at)
        fail(`path ${name}, image ${at}: not ${PARITY_COLUMNS.length} numbers numbered ${at}`)
    })
    for (const shot of shots)
      if (!Number.isInteger(shot) || shot < 0 || shot >= rows.length)
        fail(`path ${name}: the capture of image ${shot} lies outside its ${rows.length} images`)
    paths[name] = { rows, shots }
  }
  const count = (name: string, atLeast = 1) => {
    const value = json[name]
    if (!Number.isInteger(value) || value < atLeast)
      fail(`${file}: ${name} ${value}, not a whole number from ${atLeast}`)
    return value as number
  }
  const length = (name: string) => {
    const value = json[name]
    if (!(value > 0) || !Number.isFinite(value))
      fail(`${file}: ${name} ${value}, not a positive number`)
    return value as number
  }
  return {
    fps: length('fps'),
    width: count('width'),
    height: count('height'),
    near: length('near'),
    far: length('far'),
    fov: length('fovVerticalDegrees'),
    warmup: count('warmupFrames', 0),
    paths,
  }
}

/** The segments of path `name`: its warm-up, the first pose held for the file's frames and its clip
 *  time held at the first image's, unmeasured; then the path, measured and captured at its shots. */
function pathSegments(file: ParityFile, name: string): Segment[] {
  const path = file.paths[name]
  if (!path) fail(`no path ${name}; one of ${Object.keys(file.paths).join(', ')}`)
  const { fps, fov, near, far } = file
  const track = (rows: readonly ParityRow[], shots: readonly number[]): ParityTrack => ({
    rows,
    fov,
    near,
    far,
    fps,
    shots,
  })
  const warm: Segment[] = file.warmup
    ? [
        {
          name: `${name} warm`,
          frames: file.warmup,
          measure: false,
          track: track(Array(file.warmup).fill(path.rows[0]), []),
        },
      ]
    : []
  return [
    ...warm,
    {
      name,
      frames: path.rows.length,
      capture: true,
      track: track(path.rows, path.shots),
    },
  ]
}

/** The scenario `parity:<name>`: path `name` of the parity file, or every path one after the other for `all`. */
export function parityScenario(name: string): Scenario {
  const file = readParityFile()
  const names = name === 'all' ? Object.keys(file.paths) : [name]
  return {
    name: `parity:${name}`,
    page: process.env.PARITY_PAGE,
    // The warm-up is the paths' own.
    warm: 0,
    display: { width: file.width, height: file.height, ratio: 1 },
    segments: names.flatMap((path) => pathSegments(file, path)),
  }
}

/** The camera of an image: where it stands, what it looks at, the field it sees. */
export function parityPose(track: ParityTrack, i: number) {
  const [, , px, py, pz, tx, ty, tz] = track.rows[i]
  return { position: [px, py, pz], target: [tx, ty, tz], fov: track.fov } as const
}

/** The clip's action as the page makes it: found on the mixers the bench saw the page create
 *  (`benchMixers`, `../page/page.ts`) — the one animating the page's scene. */
export type ClipAction = ReturnType<BenchMixer['clipAction']>

/** The page's clip action; refuses a page that made none, a parity path being meant for the clip's scene. */
export function pageClipAction(mixers: readonly BenchMixer[] = benchMixers()): ClipAction {
  for (const mixer of mixers) {
    const [clip] = mixer.root.animations ?? []
    if (clip) return mixer.clipAction(clip)
  }
  return fail('the page made no animation mixer with a clip: a parity path is played on the clip')
}

/** Poses image `i` of `track` as the page poses its paths: the camera, the controls on its target,
 *  the clip stopped and sought to the image's time (`motion.stop().seek(time)`). */
export function poseParity(
  world: {
    camera: { set(pose: object): void }
    controls?: { target: { set(...target: number[]): unknown }; update(): unknown } | null
    invalidate(): void
  },
  motion: ClipAction,
  track: ParityTrack,
  i: number,
) {
  const pose = parityPose(track, i)
  world.camera.set(pose)
  world.controls?.target.set(...pose.target)
  world.controls?.update()
  motion.stop().seek(track.rows[i][8])
  world.invalidate()
}
