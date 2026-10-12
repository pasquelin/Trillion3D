// Two glass panes facing each other at an angle, over a floor, each with an opaque base at its foot
// (`glass.gpu.ts`): the real WebGPU engine on a built scene (`sharedSceneProof.ts`), the panes
// polished half-transparent metals, the floor and the bases unlit colours. Pane A stands on the left
// and looks to the right, pane B on the right, farther, and looks back at it. A ray reflected by A
// leaves toward B: it meets B's pane above its foot and B's base at it. The page renders the scene
// with both of B's parts, with B's pane alone, without B at all, with B alone and with no pane, and
// tells where on the image the exact mirror rays of the panes' pixels meet what they meet.
import { HALF_PI } from '../../../packages/math/src/constants.ts'
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts'
import { batisseur, square } from '../kit/sharedSceneProof.ts'
import { imageUnderSun } from '../kit/sceneImageProof.ts'
import { flipRows } from '../kit/patternImage.ts'
import { runOnDevice } from '../kit/deviceProof.ts'
import { EYE, HEIGHT, TARGET, WIDTH, crossing, mirror, pixelOf, rayOf } from './glassView.ts'
import type { V3 } from '../../../packages/sdk-browser/src/reflections/boxes.fixture.ts'

/** Pane A: its centre, its half-side and its yaw (its normal is `(sin yaw, 0, cos yaw)`). */
const A = { at: [-1.3, 0.7, -2.8] as V3, half: 0.7, yaw: 1.1 }
/** Pane B: standing where A's mirror rays go, turned back toward A. */
const B = { at: [2.6, 0.7, -4.6] as V3, half: 0.7, yaw: -1.15 }
/** The bases, flat squares at the feet of the panes, as wide as the panes. */
const BASE_A = { at: [-1.3, 0.01, -2.8] as V3, half: 1.4, color: 0xe08020 }
const BASE_B = { at: [2.6, 0.01, -4.6] as V3, half: 1.6, color: 0x20c040 }
const FLOOR = 0x808890
/** The colour of B's pane; A's is white. */
const PANE_B = 0xffc0c0

/** What stands in a scene: B's pane and its colour, B's base and its colour, and pane A. */
type Parts = { pane: boolean; base: boolean; a?: boolean; paneColor?: number; baseColor?: number }

/** The kinds of transparent surface the chain meets: a blended pane, a transmissive one, and the
 *  engine's water (a transmissive one that carries a volume). Each is a half-transparent polished
 *  metal, so that what it reflects is what the proof reads. */
export type GlassKind = 'blend' | 'transmission' | 'water'

const glass = (color: number, kind: GlassKind) =>
  kind === 'blend'
    ? G.standardSurface({
        color,
        metalness: 1,
        roughness: 0.04,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
        side: G.DOUBLE_SIDE,
      })
    : G.physicalSurface({
        color,
        metalness: 1,
        roughness: 0.04,
        transmission: 0.5,
        ior: 1,
        thickness: kind === 'water' ? 2 : 0,
        ...(kind === 'water' ? { attenuationColor: 0xb0d8d0, attenuationDistance: 20 } : {}),
        transparent: true,
        opacity: 1,
        depthWrite: false,
        side: G.DOUBLE_SIDE,
      })

function scene(
  { pane, base, a = true, paneColor = PANE_B, baseColor = BASE_B.color }: Parts,
  kind: GlassKind,
) {
  const builder = batisseur()
  const add = (
    surface: G.GraphSurface,
    pass: string,
    half: number,
    [x, y, z]: V3,
    rotation: Partial<Record<'x' | 'y', number>>,
  ) => {
    const mesh = G.mesh(square(half), surface)
    mesh.position.set(x, y, z)
    mesh.rotation.set(rotation.x ?? 0, rotation.y ?? 0, 0)
    builder.source.add(mesh)
    builder.add(mesh, pass, half)
  }
  const flat = (color: number) => G.basicSurface({ color, side: G.DOUBLE_SIDE })
  add(flat(FLOOR), 'exact-clusters', 90, [0, 0, -4], { x: -HALF_PI })
  add(flat(BASE_A.color), 'exact-clusters', BASE_A.half, BASE_A.at, { x: -HALF_PI })
  if (base) add(flat(baseColor), 'exact-clusters', BASE_B.half, BASE_B.at, { x: -HALF_PI })
  if (a) add(glass(0xffffff, kind), 'clustered-blend', A.half, A.at, { y: A.yaw })
  if (pane) add(glass(paneColor, kind), 'clustered-blend', B.half, B.at, { y: B.yaw })
  return builder.fini()
}

function cameraOf() {
  const camera = G.perspectiveCamera(55, WIDTH / HEIGHT, 0.1, 100)
  camera.position.set(...EYE)
  camera.lookAt(...TARGET)
  camera.updateMatrixWorld(true)
  return camera
}

/** The held image of `parts`: RGBA bytes, the top row first. */
async function imageOf(device: GPUDevice, events: unknown[], parts: Parts, kind: GlassKind) {
  const { held, pixels } = await imageUnderSun(device, events, scene(parts, kind), cameraOf(), {
    viewport: [WIDTH, HEIGHT],
  })
  return { held, pixels: Array.from(flipRows(pixels, WIDTH)) }
}

/** What the page reports: the held images, and for the pixels of a pane that see something (pairs
 *  of the pixel and the pixel where its exact mirror ray meets what it sees, in the open): A's
 *  pixels that see B's pane (`seesPane`) and B's base (`seesBase`), B's pixels that see the floor or
 *  a base (`alone`, over the images of B without A), and the pixels of B's base that B's pane covers. */
export type GlassReading = {
  size: [number, number]
  held: boolean[]
  images: Record<'full' | 'tinted' | 'rebased' | 'without' | 'alone' | 'bare', number[]>
  seesPane: [number, number][]
  seesBase: [number, number][]
  seesFloor: [number, number][]
  behindPane: number[]
}

export const run = (kind: GlassKind) =>
  runOnDevice<GlassReading>(async (device, events, result) => {
    const scenes = {
      full: { pane: true, base: true },
      tinted: { pane: true, base: true, paneColor: 0xc0d0ff },
      rebased: { pane: true, base: true, baseColor: 0xc03030 },
      without: { pane: false, base: false },
      alone: { pane: true, base: true, a: false },
      bare: { pane: false, base: true, a: false },
    }
    result.size = [WIDTH, HEIGHT]
    result.held = []
    result.images = {} as GlassReading['images']
    for (const [name, parts] of Object.entries(scenes) as [keyof typeof scenes, Parts][]) {
      const { held, pixels } = await imageOf(device, events, parts, kind)
      result.held.push(held)
      result.images[name] = pixels
    }
    result.seesPane = []
    result.seesBase = []
    result.seesFloor = []
    result.behindPane = []
    const onBase = (p: V3) =>
      Math.abs(p[0] - BASE_B.at[0]) < BASE_B.half && Math.abs(p[2] - BASE_B.at[2]) < BASE_B.half
    for (let y = 0; y < HEIGHT; y++)
      for (let x = 0; x < WIDTH; x++) {
        const d = rayOf(x, y)
        const ground = d[1] < 0 ? -EYE[1] / d[1] : Infinity
        const hitB = crossing(EYE, d, B)
        if (onBase([EYE[0] + d[0] * ground, 0, EYE[2] + d[2] * ground]) && hitB && hitB.t < ground)
          result.behindPane.push(y * WIDTH + x)
        for (const [pane, other, list] of [
          [A, B, 'A'],
          [B, A, 'B'],
        ] as const) {
          const own = crossing(EYE, d, pane),
            other_ = crossing(EYE, d, other)
          if (!own || (other_ && other_.t < own.t)) continue
          const r = mirror(d, pane.yaw)
          const floorT = r[1] < 0 ? -own.p[1] / r[1] : Infinity
          const point = (t: number): V3 => [
            own.p[0] + r[0] * t,
            own.p[1] + r[1] * t,
            own.p[2] + r[2] * t,
          ]
          const at = y * WIDTH + x
          if (list === 'A') {
            const paneHit = crossing(own.p, r, B)
            if (paneHit && paneHit.t < floorT) {
              const h = pixelOf(paneHit.p)
              if (h >= 0) result.seesPane.push([at, h])
            } else if (floorT < Infinity && onBase(point(floorT))) {
              const h = pixelOf(point(floorT))
              if (h >= 0) result.seesBase.push([at, h])
            }
          } else if (floorT < Infinity) {
            const h = pixelOf(point(floorT))
            if (h >= 0) result.seesFloor.push([at, h])
          }
        }
      }
  })
