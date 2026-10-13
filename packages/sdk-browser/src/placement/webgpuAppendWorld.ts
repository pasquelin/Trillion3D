/**
 * THE WORLD DAG OF A MODEL JOINS THE WEBGPU SESSION IN PLACE. A world that gains a model cut in
 * cells, cooked with its world DAG (`scene/worldRoots.ts`), draws that model's far cells by the
 * DAG's super-roots, as a scene opened on it alone does: the DAG is the cut's one world root
 * (`prepare/worldRoot.ts`), posed by its model's world, its pages catalogued behind those the
 * session holds and laid out in the pool by the functions that take a source's (`growCatalogue`,
 * `growWebgpuPagePool`), the pool's cover holding what the open's does. It joins the cut as a root
 * the running cut cannot append — its links reach every placement (`packWorldLinks`) —: a cut is
 * made beside it over every root (`webgpuGrowth.ts`), each placement linked to the object its row
 * places (`linkWorldObjects`) when it is made, the roots each held cell needs following the cells
 * once it is the session's (`followWorldRoot`). The cut draws one world DAG: a session that draws
 * one already takes no other, and the cells of that model are drawn by their objects alone.
 */
import type { WorldRootsHold } from '../scene/worldRoots.ts'
import { collectedSink } from '../page/selection/collect.ts'
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts'
import { worldDagRoot, worldFits } from '../webgpu/pages/prepare/worldRoot.ts'
import {
  catalogueRefusal,
  growCatalogue,
  holdCatalogueCover,
} from '../webgpu/pages/prepare/catalogueGrowth.ts'
import { growWebgpuPagePool } from '../webgpu/pages/io/memory.ts'
import { growthOf, joinGrownRoots } from './webgpuGrowth.ts'

/** Why the world DAG cannot join, said by name; the session draws what it drew. */
const CLOSED = 'the session holds no GPU cut: it is closing or its device is lost'

/** The session draws the world DAG `hold` holds, once its model's sources joined (they wear its
 *  pages): `undefined` once its root waits to join the cut — or when there is nothing to draw:
 *  no DAG, none of its pages worn, another DAG the session draws —, else the refusal by name. */
export async function addWebgpuWorldRoots(
  rt: WebgpuPagesRuntime,
  hold: WorldRootsHold,
): Promise<string | undefined> {
  const { gpu, run, setup, context, layout } = rt
  if (!gpu.device || run.lost || !run.gpuSelection) return CLOSED
  const dag = hold.drawn?.dag
  if (!dag || context.worldRoots) return undefined
  const roots = [...layout.selectionRoots, ...(growthOf(rt)?.roots ?? [])]
  if (!worldFits(dag, roots)) return 'the world DAG would pass the pages a key names'
  const root = worldDagRoot(hold, setup.collector.sources, roots)
  if (!root) return undefined
  const into = collectedSink()
  into.roots.push(root)
  into.allPages.push(...root.pages)
  const full = catalogueRefusal(rt, into.allPages)
  if (full) return full
  const { grown, cover } = growCatalogue(rt, into)
  if (!(await growWebgpuPagePool(rt, grown))) return 'the device refused the size of the page pool'
  rt.signal.throwIfAborted()
  if (run.lost || !run.gpuSelection) return CLOSED
  holdCatalogueCover(rt, cover)
  // The cut that packs it links the placements to its objects, and the cells it draws far read it.
  context.worldRoots = hold
  joinGrownRoots(rt, into.roots, [])
  return undefined
}
