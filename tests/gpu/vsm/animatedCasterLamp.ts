// The desk lamp of the animated caster page: its paints, its jointed hierarchy, the clip that hops it across the desk, and its pose read and written.
import { geometry } from '../../../packages/sdk-core/src/world/geometry/index.ts'
import { material } from '../../../packages/sdk-core/src/world/material/index.ts'
import { object } from '../../../packages/sdk-core/src/world/object/index.ts'
import { animation } from '../../../packages/sdk-core/src/world/animation/family.ts'
import type { Object3D } from '../../../packages/sdk-core/src/world/object/object3d.ts'

/** One hop's stride across the desk. */
const STRIDE = 1.6

/** What the keyed tracks write: the hero's place and heading, the three joint angles. */
export type Pose = {
  x: number
  y: number
  heading: number
  lower: number
  upper: number
  head: number
}

export const paint = (color: string, roughness = 0.6, metalness = 0, extra = {}) =>
  material.meshStandard({ color, roughness, metalness, ...extra })

const lampPaint = {
  body: paint('#e8e2d6', 0.35, 0.1),
  joint: paint('#2c2e33', 0.3, 0.9),
  bulb: paint('#000000', 0.4, 0, { emissive: '#fff1c8', emissiveIntensity: 6 }),
}

/** The lamp: a base and two arms and a shade, each joint a named group. */
export function lamp() {
  const root = object.group()
  const part = (name: string, parent: Object3D, y: number) => {
    const joint = object.group()
    joint.name = name
    joint.position.y = y
    parent.add(joint)
    return joint
  }
  const add = (
    shape: ReturnType<typeof geometry.box>,
    paintOf: ReturnType<typeof paint>,
    at: [number, number, number],
    parent: Object3D,
  ) => {
    const mesh = object.mesh(shape, paintOf)
    mesh.position.set(...at)
    parent.add(mesh)
    return mesh
  }
  add(geometry.cylinder(0.42, 0.48, 0.12, 40), lampPaint.body, [0, 0.06, 0], root)
  const lower = part('lower', root, 0.16),
    upper = part('upper', lower, 1),
    head = part('head', upper, 0.9)
  add(geometry.sphere(0.09, 16, 12), lampPaint.joint, [0, 0, 0], lower)
  add(geometry.cylinder(0.045, 0.045, 1, 12), lampPaint.body, [0, 0.5, 0], lower)
  add(geometry.sphere(0.08, 16, 12), lampPaint.joint, [0, 0, 0], upper)
  add(geometry.cylinder(0.04, 0.04, 0.9, 12), lampPaint.body, [0, 0.45, 0], upper)
  add(geometry.sphere(0.07, 16, 12), lampPaint.joint, [0, 0, 0], head)
  add(
    geometry.cylinder(0.1, 0.32, 0.45, 32, 1, true),
    lampPaint.body,
    [0.26, 0, 0],
    head,
  ).rotation.set(0, 0, Math.PI / 2)
  add(geometry.sphere(0.12, 20, 14), lampPaint.bulb, [0.38, 0, 0], head)
  return root
}

// One hop, keyed by hand: time (s), height, share of the stride, the three joint angles.
const HOP = [
  [0.0, 0.0, 0.0, -0.3, 1.3, -1.5],
  [0.25, 0.0, 0.0, -0.7, 2.1, -1.9],
  [0.42, 0.15, 0.12, 0.1, 0.3, -0.7],
  [0.68, 1.1, 0.6, -0.2, 1.0, -1.0],
  [0.92, 0.0, 1.0, -0.15, 0.9, -1.2],
  [1.08, 0.0, 1.0, -0.65, 2.0, -1.9],
  [1.25, 0.0, 1.0, -0.3, 1.3, -1.5],
]
// Turning round: the head lifts to look, the body swings half a turn.
const TURN = [
  [0.3, 0.0, -0.25, 1.0, -0.6, 0],
  [0.75, 0.0, -0.3, 1.2, -1.2, 1],
  [0.95, 0.0, -0.3, 1.3, -1.5, 1],
]

/** The example's keys laid end to end: three hops across the desk, a turn, three back, a turn. */
export function hopClip() {
  const times: number[] = [],
    rows: Pose[] = []
  const key = (time: number, row: Pose) => (times.push(time), rows.push(row))
  let clock = 0,
    x = -2.4,
    heading = 0
  key(0, { x, y: 0, heading, lower: HOP[0][3], upper: HOP[0][4], head: HOP[0][5] })
  for (const direction of [1, -1]) {
    for (let hop = 0; hop < 3; hop++) {
      for (const [t, y, share, lower, upper, head] of HOP.slice(1))
        key(clock + t, { x: x + direction * share * STRIDE, y, heading, lower, upper, head })
      clock += HOP[HOP.length - 1][0]
      x += direction * STRIDE
    }
    for (const [t, y, lower, upper, head, turned] of TURN)
      key(clock + t, { x, y, heading: heading + turned * Math.PI, lower, upper, head })
    clock += TURN[TURN.length - 1][0]
    heading += Math.PI
  }
  const tracks = [
    ['.position.x', 'x'],
    ['.position.y', 'y'],
    ['.rotation.y', 'heading'],
    ['lower.rotation.z', 'lower'],
    ['upper.rotation.z', 'upper'],
    ['head.rotation.z', 'head'],
  ] as const
  return animation.clip(
    'linear',
    clock,
    tracks.map(([path, field]) =>
      animation.numberTrack(
        path,
        times,
        rows.map((row) => row[field]),
      ),
    ),
  )
}

/** The hero's pose, read where the clip wrote it. */
export const poseOf = (hero: Object3D): Pose => ({
  x: hero.position.x,
  y: hero.position.y,
  heading: hero.rotation.y,
  lower: hero.getObjectByName('lower')!.rotation.z,
  upper: hero.getObjectByName('upper')!.rotation.z,
  head: hero.getObjectByName('head')!.rotation.z,
})

/** Writes a pose into the hero's nodes, as a frame loop of a page does. */
export function writePose(hero: Object3D, pose: Pose) {
  hero.position.set(pose.x, pose.y, 0.3)
  hero.rotation.y = pose.heading
  hero.getObjectByName('lower')!.rotation.z = pose.lower
  hero.getObjectByName('upper')!.rotation.z = pose.upper
  hero.getObjectByName('head')!.rotation.z = pose.head
}
