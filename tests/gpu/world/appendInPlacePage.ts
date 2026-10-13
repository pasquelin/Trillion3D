// Page of the append-in-place proof: a world draws a batch, then a second source wearing another
// material is added to the scene — the same geometry, so the same primitive the session holds —,
// and the image is the one of a world opened on both at once. The session is never opened again.
import { geometry } from '../../../packages/sdk-core/src/world/geometry/index.ts'
import { material } from '../../../packages/sdk-core/src/world/material/index.ts'
import { joined, row } from './appendProof.ts'

const ball = geometry.sphere(0.6, 16, 12)
const crate = geometry.box(0.9, 0.9, 0.9)
const paints = [0xb04a3a, 0x3a7ab0].map((color) => material.meshStandard({ color, roughness: 0.7 }))

/** A world draws a row, a second row joins it while it runs, and the image is that of a world
 *  opened on both: `shape` the second row's geometry. */
const joinedRow = (shape: typeof ball) =>
  joined(
    (world) => row(world, ball, paints[0], 0, 5),
    (world) => row(world, shape, paints[1], -2, 5),
  )

/** Another material on the geometry the session draws. */
export const run = () => joinedRow(ball)

/** A geometry the session does not hold. */
export const runGeometry = () => joinedRow(crate)
