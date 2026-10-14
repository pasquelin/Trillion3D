// Page of the ray query's diagnostic probe (`raycastProbe.gpu.ts`): the ray proof's scene
// (`raycastPage.ts`), its first ray cast as the proof casts it, then the same rays traced by the
// engine's counting kernel (`Engine.rayAudit`): each hit and the work it took, what the GPU read of
// each placement — its frame row, its root node, its world —, the records the host built, and,
// beside them, the oracle's triangle and the record the hit should have read.
import { Vector3 } from '../../../packages/sdk-core/src/world/math/vector3.ts'
import { Ray } from '../../../packages/sdk-core/src/world/math/volumes.ts'
import { sessionOf } from '../../../packages/sdk-browser/src/world/core/worldSession.ts'
import { drawnTriangles, nearestTriangle } from './raycastOracle.ts'
import { frame, open } from './appendProof.ts'
import { build, RAYS } from './raycastPage.ts'

/** The first three rays of the proof, the still quad's: its world ray, unit direction. */
const probed = RAYS.slice(0, 3).map(({ name, origin, direction }) => {
  const unit = new Vector3(...(direction as [number, number, number])).normalize()
  return { name, origin, direction: [unit.x, unit.y, unit.z] }
})

export async function run() {
  const { world, close } = open()
  try {
    await world.ready
    const meshes = build(world)
    await frame(world)
    const rays = probed.map(
      ({ origin, direction }) =>
        new Ray(
          new Vector3(...(origin as [number, number, number])),
          new Vector3(...(direction as [number, number, number])),
        ),
    )
    // The proof's own first cast: the queue's first batch, as it answered.
    const cast = await world.raycast(rays[0])
    const audit = await sessionOf(world).engine.rayAudit?.(rays)
    if (!audit) return { error: 'no ray audit: the session cannot trace', errors: [] }
    // What the oracle meets, and the record the still quad's leaf names: its first page and shift.
    const oracle = probed.map(({ name, origin, direction }) => {
      const met = nearestTriangle(drawnTriangles(meshes.still), origin, direction)
      return met && { name, distance: met.distance, rank: met.triangle.rank, normal: met.normal }
    })
    const still = audit.placements.find(({ source }) => source === 'still')
    const page = still && still.frame.pageBase + still.rootNode.firstPage
    const record = still && page !== undefined ? (page + still.frame.recordShift) >>> 0 : undefined
    return {
      cast: cast && { object: cast.object.name, distance: cast.distance, face: cast.face },
      oracle,
      expected: still && {
        placement: still.placement,
        page,
        record,
        leaf: still.rootNode.childCount === 0,
        words: record === undefined ? null : (audit.records[record] ?? null),
      },
      audit,
      errors: [],
    }
  } catch (error) {
    return { error: error instanceof Error ? error.stack : String(error) }
  } finally {
    close()
  }
}
