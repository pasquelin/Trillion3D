// The engine side of the voxel brick proof (`voxel-trace.gpu.ts`): one brick of 4×4 voxels, one
// voxel thick, drawn by the real WebGPU engine as its box, each pixel tracing the brick's cells
// (`voxelWgsl.ts`, `voxelCellTrace`), beside a plain square on its top face. Its depth: the square a hair
// above the face covers every voxel, a hair below it none. Its normal: the brick and the square show
// the same normal view. Its shadow: lifted over a floor under a sun, it darkens the floor.
import * as G from '../../../packages/sdk-browser/src/scene/host/graph/graph.fixture.ts'
import { createSceneLightStore } from '../../../packages/sdk-core/src/scene/light/store.ts'
import {
  encodeVoxelPage,
  GEOMETRY_VOXEL,
  VOXEL_BRICK_CORNERS,
  VOXEL_BRICK_INDICES,
} from '../../../packages/sdk-core/src/page/voxelPage.ts'
import type { VoxelFile } from '../../../packages/sdk-core/src/contracts/voxel.ts'
import { manifestCulling } from '../../../packages/sdk-browser/src/geometry/dag/culling.fixture.ts'
import type { PageSurface } from '../../../packages/sdk-browser/src/geometry/pages/surface.ts'
import { OCT_BYTE_STEP } from '../../../packages/math/src/constants.ts'
import { clamp } from '../../../packages/math/src/scalar/reals.ts'
import { length3 } from '../../../packages/math/src/vector/vector.ts'
import { runOnDevice } from '../../kit/device/deviceProof.ts'
import { colorAt, untilHeld } from '../../kit/device/sceneImageProof.ts'
import * as K from '../../kit/device/sharedSceneProof.ts'

/** The voxels' side; the brick spans [-0.5, 0.5]² about its placement, one voxel thick. */
const SIDE = 0.25
/** How far the square stands from the brick's top face in the depth cases: 1/60 of a voxel's side,
 *  well past the depth's rounding — the trace writes the face's depth itself. */
const DEPTH_GAP = 0.004

/** A direction's octahedral bytes (`oct_encode`, upper half), and the unit vector they decode to. */
function octahedral(n: number[]) {
  const sum = n.reduce((total, c) => total + Math.abs(c), 0)
  const bytes = [0, 1].map((a) => clamp(Math.round((n[a] / sum + 1) * 127.5), 0, 254))
  const e = bytes.map((q) => q * OCT_BYTE_STEP - 1)
  const d = [e[0], e[1], 1 - Math.abs(e[0]) - Math.abs(e[1])]
  return { bytes, unit: d.map((c) => c / length3(d[0], d[1], d[2])) }
}

/** The normal every voxel carries: up, toward the camera, as its record decodes it. */
const NORMAL = octahedral([0, 0, 1])
/** The brick's top face, in its placement's units. */
const TOP = SIDE / 2

/** The brick as its page: 16 voxels of colour `rgb`, each with `NORMAL` — twelve bytes a voxel. */
function brickPage(rgb: number[]) {
  const bytes = new Uint8Array(16 + 16 * 12)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, 0xffff, true)
  view.setUint16(14, 0xffff, true)
  for (let k = 0; k < 16; k++)
    bytes.set([...rgb, 255, 255, 255, 0, 0, ...NORMAL.bytes, 0, 0], 16 + 12 * k)
  const origin: [number, number, number] = [-0.5, -0.5, -SIDE / 2]
  const group = { primitive: 0, group: 0, firstBrick: 0, bricks: 1, firstVoxel: 0, voxels: 16 }
  const voxels = { ...group, error: 0, parentError: Infinity, side: SIDE, origin }
  const file: VoxelFile = { groups: [voxels], view, brickBase: 0, voxelBase: 16 }
  return encodeVoxelPage(file, voxels, [0, 1], 0)
}

/** Makes primitive `rank` of `scene` the brick, served at its own address: what
 *  `readVoxelLevels` makes of a cache's brick, without a cache. */
function asBrick(scene: K.ScenePreparee, rank: number, served: Map<string, Uint8Array>) {
  const primitive = scene.metadata.primitives[rank]
  const { bytes, bricks, min, max } = brickPage([255, 0, 0])
  const url = `voxels-${rank}`,
    count = bricks * VOXEL_BRICK_INDICES,
    vertexCount = bricks * VOXEL_BRICK_CORNERS
  for (const page of primitive.pages) scene.indices.delete(page.url)
  const geometry = { url, sha256: 'proof', bytes: bytes.byteLength, vertexCount }
  const flags = { indexCount: count, flags: GEOMETRY_VOXEL, uncompressedBytes: bytes.byteLength }
  const band = { level: 0, lodError: 0, sphere: [0, 0, 0, 0.8], parentError: null }
  const links = { parentSphere: null, group: null, source: null }
  const cone = { axis: [0, 0, 1] as [number, number, number], angle: Math.PI }
  const page = { id: 0, url, sha256: 'proof', bytes: bytes.byteLength, count, min, max }
  primitive.pages = [
    { ...page, ...band, ...links, role: 'coarse', cone, geometry: { ...geometry, ...flags } },
  ]
  primitive.structure = { version: 1, roots: [0], groups: [] }
  primitive.culling = manifestCulling(primitive.pages)
  scene.indices.set(url, new Uint32Array(count))
  served.set(url, bytes)
}

/** A shot: the scene `build` places, the brick its primitive `brick`, lit by `sun` or unlit. */
async function shot(
  device: GPUDevice,
  events: unknown[],
  build: (builder: ReturnType<typeof K.batisseur>) => number | undefined,
  sun = false,
) {
  const builder = K.batisseur()
  const rank = build(builder)
  const scene = builder.fini()
  const served = new Map<string, Uint8Array>()
  if (rank !== undefined) asBrick(scene, rank, served)
  const sceneLights = createSceneLightStore()
  if (sun)
    sceneLights.add({
      ...{ id: 'sun', kind: 'directional', direction: [-1, 0, -1], color: [1, 1, 1] },
      ...{ intensity: 3, angularRadius: 0.01, castsShadow: true },
    })
  const { backend, canvas } = K.engine(scene, device, (e) => void events.push(e), {
    sceneLights,
    pixelError: 1,
    readGeometryPage: async (url: string) => served.get(url)!,
  })
  try {
    await backend.prepare()
    return new Uint8Array((await untilHeld(backend, K.cameraFace())).settled)
  } finally {
    K.release(backend, canvas, scene)
  }
}

/** Three points a voxel across, off its edges, in each of the 16 voxels: on the top face. */
const SAMPLES = Array.from({ length: 144 }, (_, k) => {
  const voxel = k % 16,
    at = Math.floor(k / 16)
  const x = ((voxel & 3) + 0.5) * SIDE - 0.5 + ((at % 3) - 1) * 0.07
  const y = ((voxel >> 2) + 0.5) * SIDE - 0.5 + (Math.floor(at / 3) - 1) * 0.07
  return [x, y, TOP]
})

/** The square on the brick's top face, moved `gap` along its normal, wearing `surface`. */
function square(builder: ReturnType<typeof K.batisseur>, surface: PageSurface, gap: number) {
  builder.place(surface, 'exact-clusters', 0.7).position.set(0, 0, TOP + gap)
}

/** The brick at the origin wearing `surface`: its primitive's rank. */
const brick = (builder: ReturnType<typeof K.batisseur>, surface: PageSurface) => {
  G.sided(surface, G.DOUBLE_SIDE)
  builder.place(surface, 'exact-clusters', 0.5)
  return builder.source.children.length - 1
}

export type VoxelTraceProof = {
  /** Red (the brick) and green (the square) samples, the square in front, then behind. */
  front: { red: number; green: number }
  behind: { red: number; green: number }
  /** The largest channel gap between the brick's normal view and the square's, and the samples. */
  normalGap: number
  samples: number
  /** The floor's brightness where the brick's shadow falls, with the brick and without it, and
   *  away from it. */
  shadowed: number
  open: number
  lit: number
}

/** The samples of `pixels` that show the brick's red, and the square's green. */
const cover = (pixels: Uint8Array) => {
  const seen = SAMPLES.map(([x, y, z]) => colorAt(pixels, K.cameraFace(), x, y, z))
  const red = seen.filter(([r, g]) => r > 128 && g < 64).length
  return { red, green: seen.filter(([r, g]) => g > 128 && r < 64).length }
}

export const run = () =>
  runOnDevice<VoxelTraceProof>(async (device, events, result) => {
    const camera = K.cameraFace()
    const unlit = (color: number) => G.basicSurface({ color })
    for (const [name, gap] of [
      ['front', DEPTH_GAP],
      ['behind', -DEPTH_GAP],
    ] as const)
      result[name] = cover(
        await shot(device, events, (b) => {
          square(b, unlit(0x00ff00), gap)
          return brick(b, unlit(0xff0000))
        }),
      )
    const normals = () => G.familySurface('normal')
    const voxels = await shot(device, events, (b) => brick(b, normals()))
    const plane = await shot(device, events, (b) => void square(b, normals(), 0))
    result.samples = SAMPLES.length
    result.normalGap = Math.max(
      ...SAMPLES.flatMap(([x, y, z]) => {
        const a = colorAt(voxels, camera, x, y, z),
          b = colorAt(plane, camera, x, y, z)
        return a.map((c, i) => Math.abs(c - b[i]))
      }),
    )
    const grey = () => G.standardSurface({ color: 0xbbbbbb, roughness: 0.8 })
    const floor = (b: ReturnType<typeof K.batisseur>, withBrick: boolean) => {
      b.place(grey(), 'exact-clusters', 1.5)
      if (!withBrick) return undefined
      const rank = brick(b, grey())
      b.source.children[rank].position.set(0.6, 0, 0.6)
      b.source.children[rank].scale.set(0.5, 0.5, 0.5)
      return rank
    }
    const lum = (pixels: Uint8Array, x: number) =>
      colorAt(pixels, camera, x, 0).reduce((s, c) => s + c, 0) / 3
    const cast = await shot(device, events, (b) => floor(b, true), true)
    const bare = await shot(device, events, (b) => floor(b, false), true)
    result.shadowed = lum(cast, 0)
    result.open = lum(bare, 0)
    result.lit = lum(cast, -0.9)
  })
