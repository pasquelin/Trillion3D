// The scene's faces of a frame of boxes (`boxFrame.ts`), for the rig's scene stage (`rigRuntime.ts`): each box that is not a mirror one
// face of twelve triangles, giving the radiance its lit colour is, so that a ray the screen cannot answer finds what the screen would show.
import type { Box } from '../../../packages/sdk-browser/src/lighting/reflections/boxes.fixture.ts'
import type { Block } from './boxFrame.ts'
import type { RigFace } from './rigRuntime.ts'

/** The four corners of the face of `box` that looks along `axis`, on its high side or its low one, wound around. */
function corners(box: Box, axis: number, high: boolean) {
  const [u, v] = [0, 1, 2].filter((a) => a !== axis)
  return [
    [box.low[u], box.low[v]],
    [box.high[u], box.low[v]],
    [box.high[u], box.high[v]],
    [box.low[u], box.high[v]],
  ].map(([cu, cv]) => {
    const point = [0, 0, 0]
    point[axis] = high ? box.high[axis] : box.low[axis]
    point[u] = cu
    point[v] = cv
    return point
  })
}

/** The twelve triangles of the surface of `box`, nine floats each, in metres. */
export function boxTriangles(box: Box) {
  const triangles: number[] = []
  for (let axis = 0; axis < 3; axis++)
    for (const high of [false, true]) {
      const [a, b, c, d] = corners(box, axis, high)
      triangles.push(...a, ...b, ...c, ...a, ...c, ...d)
    }
  return Float32Array.from(triangles)
}

/** The faces of `blocks` that are not mirrors, in their order, each giving its colour. */
export function blockFaces(blocks: readonly Block[]): RigFace[] {
  return blocks
    .filter((block) => !block.mirror)
    .map(({ box, color }) => ({ triangles: boxTriangles(box), radiance: color }))
}
