import type { PageRec } from '../../geometry/selection/types.ts'
import { createShadeCensus } from '../../visibility/passes/shadeCensus.ts'
import { FEATURE_CLASS_KEYS } from '../../visibility/shader/materialClass.ts'
import type { ShadeClasses } from '../../visibility/passes/shadePipelines.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'

/**
 * THE ENTRY OF AN OBJECT INTO THE GPU SCENE WAITS FOR ITS RESOLVE CLASSES, as a render proxy is
 * not created while the pipeline states it will draw with still precache. A source joining the
 * session (`joinCatalogued`) has no placement, no caster and no card — it is in no table of the
 * visibility, the shadow maps or the surface cache — until the pipelines of the classes its pages
 * are shaded by are compiled, the image's and the cards' (`compiledClasses`); then it enters, by
 * the usual way in, and the view is drawn with it. The frames are not held meanwhile: the object
 * does not exist for them.
 *
 * The classes of the graphs are not waited for here (`featureClasses`): a graph's class is a
 * program over the session's rasters, which the image's own path extends with the graph once the
 * object is in the scene (`followGraphRasters`), and its key is held by the census of the worn
 * surfaces, which does not wear the object yet. They are asked by the frames, as the displaced
 * classes and the set that writes the emission layer are (`askShadeClasses`,
 * `askDisplacedClasses`), which wait for them. So are the classes a material changed into after
 * the object joined: the frames are held on them.
 *
 * A class the device refuses to compile does not keep the object out for ever: it enters, its
 * surfaces unshaded (`dispatchClasses` skips a class that is not compiled), the refusal said
 * once by the frames (`takeRefusals`).
 */
export async function compiledClasses(
  classes: Pick<ShadeClasses, 'of' | 'cards'> | undefined,
  keys: readonly number[],
  withCards: boolean,
) {
  if (!classes) return
  const cards = withCards ? classes.cards() : undefined
  await Promise.allSettled(
    keys.flatMap((key) => [classes.of(key).prepare(), ...(cards ? [cards.of(key).prepare()] : [])]),
  )
}

/** The classes of the features alone, which the gate waits for (the graphs take keys past them). */
export const featureClasses = (keys: readonly number[]) =>
  keys.filter((key) => key < FEATURE_CLASS_KEYS)

/** The classes of the opaque `pages` of a source about to join, compiled before it does. */
export function objectClassesCompiled(rt: WebgpuPagesRuntime, pages: readonly PageRec[]) {
  const { vis } = rt
  if (!vis.shadeClasses) return Promise.resolve()
  const keys = createShadeCensus(pages, vis.geometryBlocks, vis).keys
  return compiledClasses(vis.shadeClasses, featureClasses(keys), !!rt.surfaceCache)
}
