// The generated FAMILY of the run-time proxy's proof: every case is drawn from a seed — the shapes, their
// sizes, positions and count (1 to 50), emitting or dark, opaque or blended, still or moving, the floor's
// roughness and metal, the camera from grazing to straight down. No case is a special one: the pose at which
// a black disc showed under a lamp's globe is whatever the seed makes it, one among the others.
import { lcgRandom, type Random } from '../../../packages/math/src/sequence/random.ts'

type ShapeKind = 'sphere' | 'box' | 'torus' | 'post' | 'quad' | 'disc' | 'morph' | 'skinned'
export type Rgb = [number, number, number]

/** A shape of the scene, in its own frame (axes along x, y, z, the post and the torus along y): `size`
 *  its half extents (sphere: radius in x; box: half sides; torus: ring radius, tube radius; post, skinned: radius,
 *  half height; quad: half sides in x, z; disc: radius; morph: the sphere's radius). The pose is `yaw`
 *  about y, then `pitch` about x. */
export type Shape = {
  kind: ShapeKind
  size: [number, number, number]
  centre: [number, number, number]
  yaw: number
  pitch: number
  /** What it emits, linear; zero for a dark body. */
  emission: Rgb
  albedo: Rgb
  /** 1 opaque; under 1 the shape is blended. */
  opacity: number
  /** Where a moving shape ends: its centre plus this; zero for a still one. A `skinned` post stays where it
   *  is and its upper bone moves by this, bending it (the lower bone holds, the weights are linear in height). */
  move: [number, number, number]
  /** A morph target's weight (`morph` shapes): the sphere is stretched to `1 + 0.6 w` along y. */
  weight: number
}

export type FamilyCase = {
  seed: number
  shapes: Shape[]
  floor: { metal: boolean; roughness: number; albedo: Rgb }
  eye: [number, number, number]
  target: [number, number, number]
  fov: number
  temporal: boolean
}

const KINDS: ShapeKind[] = ['sphere', 'box', 'torus', 'post', 'quad', 'disc', 'morph', 'skinned']
/** The pixels between two read ones of the image, along each axis. */
export const GRID = 12
/** The cases of the family, as many as the proof draws. */
export const FAMILY_SIZE = 28

const between = (r: Random, low: number, high: number) => low + (high - low) * r()
const colour = (r: Random): Rgb => [between(r, 0.1, 1), between(r, 0.1, 1), between(r, 0.1, 1)]

function shape(r: Random, extent: number): Shape {
  const kind = KINDS[Math.floor(r() * KINDS.length)]
  const scale = between(r, 0.15, 1.4)
  const size: Shape['size'] =
    kind === 'box'
      ? [scale, scale * between(r, 0.3, 1.5), scale * between(r, 0.3, 1.5)]
      : kind === 'torus'
        ? [scale, scale * between(r, 0.15, 0.4), 0]
        : kind === 'post' || kind === 'skinned'
          ? [scale * 0.12, scale * between(r, 1, 3), 0]
          : kind === 'quad'
            ? [scale, scale * between(r, 0.4, 1.2), 0]
            : [scale, 0, 0]
  const reach = size[0] + size[1] + size[2]
  // Above the floor whatever the pose: a body's lowest point clears it.
  const y = Math.max(reach * 1.05, between(r, 0.2, 4))
  const emits = r() < 0.65
  const blended = r() < 0.2
  const moving = r() < 0.25
  return {
    kind,
    size,
    centre: [between(r, -extent, extent), y, between(r, -extent, extent)],
    yaw: kind === 'skinned' ? 0 : between(r, 0, 6.28),
    pitch: kind === 'quad' || kind === 'disc' || kind === 'box' ? between(r, -0.6, 0.6) : 0,
    emission: emits ? (colour(r).map((c) => c * between(r, 0.5, 8)) as Rgb) : [0, 0, 0],
    albedo: colour(r),
    opacity: blended ? between(r, 0.25, 0.8) : 1,
    move:
      kind === 'skinned'
        ? [between(r, -1.2, 1.2), 0, between(r, -1.2, 1.2)]
        : moving
          ? [between(r, -1, 1), between(r, 0, 0.6), between(r, -1, 1)]
          : [0, 0, 0],
    weight: kind === 'morph' ? between(r, 0.2, 1) : 0,
  }
}

/** Case `index` of the family: a pure function of its index. */
export function familyCase(index: number): FamilyCase {
  const seed = 0x51ed + index * 7919
  const r = lcgRandom(seed)
  // A few draws first: the generator's first outputs are too alike across neighbouring seeds.
  for (let k = 0; k < 4; k++) r()
  const count = 1 + Math.floor(r() ** 2 * 50)
  const extent = between(r, 1.5, 6)
  const shapes = Array.from({ length: count }, () => shape(r, extent))
  const elevation = between(r, 0.12, 1.5)
  const azimuth = between(r, 0, 6.28)
  const distance = between(r, 7, 15)
  const aim: FamilyCase['target'] = [between(r, -1, 1), between(r, 0, 2), between(r, -1, 1)]
  return {
    seed,
    shapes,
    floor: {
      metal: r() < 0.55,
      roughness: r() < 0.25 ? 0.02 : between(r, 0, 0.6),
      albedo: [1, 1, 1],
    },
    eye: [
      aim[0] + distance * Math.cos(elevation) * Math.cos(azimuth),
      Math.max(1, aim[1] + distance * Math.sin(elevation)),
      aim[2] + distance * Math.cos(elevation) * Math.sin(azimuth),
    ],
    target: aim,
    fov: between(r, 35, 70),
    temporal: r() < 0.5,
  }
}
