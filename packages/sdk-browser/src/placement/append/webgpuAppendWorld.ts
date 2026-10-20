/**
 * THE WORLD DAG OF A MODEL JOINS THE WEBGPU SESSION IN PLACE. A world that gains a model cut in
 * cells, cooked with its world HLOD (`geometry/hlod/worldRoots.ts`), draws that model's hidden HLOD 0 cells
 * by their HLOD actors, as a scene opened on it alone does: the DAG is the cut's one world root
 * (`prepare/worldRoot.ts`), a root per placement of its model, each posed by its placement's world
 * — a placement added later adds a root as any row grown does (`../growth/growth.ts`) —, its pages catalogued
 * behind those the session holds and laid out in the pool by the functions that take a source's
 * (`growCatalogue`, `growWebgpuPagePool`), its actors' textures taken into the atlas as a source's
 * are (`appendSurfaceTextures`), the pool's cover holding what the open's does. It joins
 * the cut as a root the running cut cannot append — its links reach every placement
 * (`packWorldLinks`) —: a cut is made beside it over every root (`../growth/webgpuGrowth.ts`), each placement
 * linked to the HLOD 0 cell its row lies in (`linkWorldCells`) when it is made, the roots each held
 * HLOD cell holds following the cells once it is the session's (`coverHeldRoots`). The cut draws one
 * world DAG: a session that draws one already takes no other, and the cells of that model are drawn
 * by their placements alone.
 */
import type { WorldRootsHold } from '../../geometry/hlod/worldRoots.ts'
import { collectedSink } from '../../geometry/selection/collect.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { worldDagRoots, worldFits, worldInstances } from '../../frame/prepare/worldRoot.ts'
import { catalogueRefusal } from '../../frame/prepare/catalogueGrowth.ts'
import { appendSurfaceTextures, CLOSED, closed, joinCatalogued, shut } from './webgpuAppend.ts'

/** The session draws the world DAG `hold` holds, once its model's sources joined: `undefined` once
 *  its root waits to join the cut — or when there is nothing to draw: no DAG, no actor's surface
 *  built, another DAG the session draws —, else the refusal by name. */
export async function addWebgpuWorldRoots(
  rt: WebgpuPagesRuntime,
  hold: WorldRootsHold,
): Promise<string | undefined> {
  const { context, layout } = rt
  if (shut(rt)) return CLOSED
  const dag = hold.dag
  if (!dag || context.worldRoots) return undefined
  const roots = [...layout.selectionRoots, ...(rt.growth?.roots ?? [])]
  if (!worldFits(dag, roots, worldInstances(hold)))
    return 'the world DAG would pass the pages a key names'
  const placed = worldDagRoots(hold, roots)
  if (!placed.length) return undefined
  const into = collectedSink()
  into.roots.push(...placed)
  into.allPages.push(...placed[0].pages)
  const full = catalogueRefusal(rt, into.allPages)
  if (full) return full
  // Its actors' flattened materials read their atlases from its model's cache, as a source's do.
  for (const surface of hold.surfaces) await appendSurfaceTextures(rt, surface)
  if (closed(rt)) return CLOSED
  const refused = await joinCatalogued(rt, into, [])
  // The cut that packs it links the placements to its objects, and the cells it draws far read it.
  if (!refused) context.worldRoots = hold
  return refused
}
