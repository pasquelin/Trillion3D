import type { Scene } from '../../../packages/sdk-browser/src/world/core/scene.ts'
import { createDrawLists } from '../../../packages/sdk-browser/src/webgl/cluster/drawLists.ts'
import { sceneRead } from '../../../packages/sdk-browser/src/webgl/cluster/sceneDraw.ts'
import type { WebglClusterScene } from '../../../packages/sdk-browser/src/webgl/cluster/lights.ts'

const kept = new WeakMap<Scene, WebglClusterScene>()
/** A display graph as a WebGL2 draw outside `createSceneDraw` reads it — a witness, a test page:
 *  one set of draw lists per graph, brought to the graph at each read, never a walk of its own. */
export function keptClusterScene(display: Scene) {
  let read = kept.get(display)
  if (!read) {
    const lists = createDrawLists(display, [])
    kept.set(display, (read = sceneRead(display, () => (lists.refresh(), lists.lights))))
  }
  return read
}
