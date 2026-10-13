import { tileId } from '../../packages/sdk-browser/src/webgpu/tile/ids.ts'
import { tileLayout, tilesAt } from '../../packages/sdk-browser/src/texture/tiles.ts'
import type { TileTrace, TileTraceFrame, VsmTrace } from './trace.ts'

/**
 * GENERATED FLIGHTS over a textured ground, for the residency replay (`replay.ts`) where no
 * recorded trace is given: a camera flies over a plane cut into square patches, each patch wearing
 * one of `textures` textures of `side` texels, and each sampled pixel asks the tile its footprint
 * wants — the level whose texel covers the pixel, read off the ray's distance and its grazing angle,
 * as a sampler's derivatives would. One pixel in sixteen speaks a frame, its phase turning, as the
 * engine's reduction (`packages/sdk-browser/src/webgpu/tile/feedback.ts`). A cut moves the camera
 * at once: the frames after it converge.
 */
export type Flight = {
  name: string
  frames: number
  /** Screen pixels, and the vertical field of view in radians. */
  width: number
  height: number
  fov: number
  textures: number
  side: number
  /** Metres a patch spans: one texture across it. */
  patch: number
  /** The camera at frame `f`: position, yaw and pitch (radians, pitch below the horizon < 0). */
  camera(f: number): { x: number; y: number; z: number; yaw: number; pitch: number }
  /** Frames a cut lands at. */
  cuts: readonly number[]
}

const STRIDE = 4

/** The hit of pixel `(px, py)` on the ground at frame `f`: world position, distance and the cosine
 *  of its grazing angle; undefined above the horizon. */
function hit(flight: Flight, f: number, px: number, py: number) {
  const { x, y, z, yaw, pitch } = flight.camera(f)
  const tan = Math.tan(flight.fov / 2),
    aspect = flight.width / flight.height
  const sx = ((2 * (px + 0.5)) / flight.width - 1) * tan * aspect,
    sy = (1 - (2 * (py + 0.5)) / flight.height) * tan
  // Camera basis: forward along yaw tilted by pitch, right horizontal, up their cross.
  const [cp, sp, cy, sy0] = [Math.cos(pitch), Math.sin(pitch), Math.cos(yaw), Math.sin(yaw)]
  const forward = [cp * cy, cp * sy0, sp],
    right = [sy0, -cy, 0],
    up = [-sp * cy, -sp * sy0, cp]
  const d = [0, 1, 2].map((k) => forward[k] + sx * right[k] + sy * up[k])
  const length = Math.hypot(d[0], d[1], d[2])
  if (d[2] >= 0) return undefined
  const t = -z / d[2]
  return { wx: x + t * d[0], wy: y + t * d[1], distance: t * length, cos: -d[2] / length }
}

/** The texture of patch `(i, j)`: a fixed scatter over the textures. */
const textureOf = (flight: Flight, i: number, j: number) =>
  (((i * 73856093) ^ (j * 19349663)) >>> 0) % flight.textures

/** The texture feedback trace of `flight`. */
export function tileFlight(flight: Flight): TileTrace {
  const tail = tileLayout(flight.side, flight.side).tail,
    pixelAngle = flight.fov / flight.height
  const frames: TileTraceFrame[] = []
  for (let f = 0; f < flight.frames; f++) {
    const phase = f % (STRIDE * STRIDE),
      counts = new Map<number, number>()
    for (let py = phase >> 2; py < flight.height; py += STRIDE)
      for (let px = phase & 3; px < flight.width; px += STRIDE) {
        const at = hit(flight, f, px, py)
        if (!at) continue
        const i = Math.floor(at.wx / flight.patch),
          j = Math.floor(at.wy / flight.patch)
        const footprint = (at.distance * pixelAngle) / Math.max(at.cos, 1e-3)
        const level = Math.max(0, Math.floor(Math.log2((footprint * flight.side) / flight.patch)))
        if (level >= tail) continue
        const u = at.wx / flight.patch - i,
          v = at.wy / flight.patch - j
        const [across] = tilesAt(flight.side, flight.side, level)
        const id = tileId({
          slot: textureOf(flight, i, j),
          level,
          tx: Math.min(across - 1, Math.floor(u * across)),
          ty: Math.min(across - 1, Math.floor(v * across)),
        })
        counts.set(id, (counts.get(id) ?? 0) + 1)
      }
    frames.push({
      tiles: Uint32Array.from(counts.keys()),
      weights: Uint32Array.from(counts.values()),
      cut: flight.cuts.includes(f),
    })
  }
  return { name: flight.name, tails: Array(flight.textures).fill(tail), frames }
}

/** The shadow pages `flight` wants of a sun straight above, `levels` clipmap levels of pages
 *  `page` metres wide at level 0, each level twice the last: a pixel's level the first whose
 *  page is coarser than its footprint. */
export function vsmFlight(flight: Flight, levels = 8, page = 4): VsmTrace {
  const pixelAngle = flight.fov / flight.height,
    frames: VsmTrace['frames'][number][] = []
  for (let f = 0; f < flight.frames; f++) {
    const pages = new Set<number>()
    for (let py = 0; py < flight.height; py += STRIDE)
      for (let px = 0; px < flight.width; px += STRIDE) {
        const at = hit(flight, f, px, py)
        if (!at) continue
        const footprint = at.distance * pixelAngle * 128
        const level = Math.min(levels - 1, Math.max(0, Math.ceil(Math.log2(footprint / page))))
        const size = page * 2 ** level
        const gx = Math.floor(at.wx / size) & 4095,
          gy = Math.floor(at.wy / size) & 4095
        pages.add(((level << 24) | (gy << 12) | gx) >>> 0)
      }
    frames.push({ pages: Uint32Array.from(pages), cut: flight.cuts.includes(f) })
  }
  return { name: flight.name, frames }
}
