// The CPU oracle of a row's detail words, which the rows pass writes (`composeLod`,
// `../../placement/gpuComposeDerivedWgsl.ts`): the world error of its own form and of the coarser
// one that replaces it, each at its level-of-detail sphere's world centre, as the GPU cut projects
// them (`../../gpu/dag/shader/error.ts`), the cut rule's residency folded in
// (`../../page/cut/rule.ts`): a row not `ready` carries a parent error of 0, so no page draws it;
// one whose finer group is not ready, an own error of 0, so every page that reaches it draws it. A
// row with no record — a blended caster's is given none — or of a cache without errors is drawn by
// every page. The word tests hold the shader to it.
import { transformAffinePoint } from '../../../../sdk-core/src/index.ts'
import { FINITE_SENTINEL } from '../../../../math/src/constants.ts'
import { writeSplitDouble } from '../../../../math/src/float/splitDouble.ts'
import { boxRadius } from '../../../../math/src/geometry/box.ts'
import { worldStretch } from '../../page/cut/logic.ts'
import type { PageRec } from '../../page/selection/selection.ts'
import type { Placements } from '../../page/selection/placements.ts'
import {
  LOD_BIT,
  LOD_INPUT,
  ROW_LOD_FLOATS,
  ROW_LOD_INPUT_DOUBLES,
  rowLodInputs,
} from './rowLodWords.ts'

const centre = new Float64Array(3)

/** The world centre of local sphere `sphere` and its world error `error`, at `out[at]`. */
function writeError(
  out: Float32Array,
  at: number,
  e: ArrayLike<number>,
  sphere: ArrayLike<number>,
  error: number,
) {
  transformAffinePoint(centre, e, sphere[0], sphere[1], sphere[2], 0)
  for (let axis = 0; axis < 3; axis++) writeSplitDouble(out, at + axis, at + 8 + axis, centre[axis])
  out[at + 3] = error
}

const inputs = new Float64Array(ROW_LOD_INPUT_DOUBLES)
const IDENTITY = new Float64Array(16)

/** Row `row`'s detail words at its root's world, its stretch (`worldStretch`) and the radius of
 *  its world box, from its inputs (`rowLodInputs`). */
export function writeRowLod(
  out: Float32Array,
  row: number,
  rec: PageRec | undefined,
  root: (Placements[number] & { readonly worldBox?: ArrayLike<number> }) | undefined,
  ready = true,
  childReady = true,
) {
  rowLodInputs(inputs, 0, rec, root, ready, childReady)
  const at = row * ROW_LOD_FLOATS,
    e = root?.world.elements ?? IDENTITY,
    scale = root ? worldStretch(root) : 1,
    box = root?.worldBox
  out.fill(0, at, at + ROW_LOD_FLOATS)
  // A row with no coarser form carries `FINITE_SENTINEL` as its parent's error: every page
  // wants finer.
  out[at + 7] = FINITE_SENTINEL
  const flags = inputs[LOD_INPUT.flags]
  // The object's bounding radius: the screen-size cull is an instance test.
  if (flags & LOD_BIT.hasBox && box) out[at + 18] = boxRadius(box)
  if (!(flags & LOD_BIT.has)) return
  const sphere = inputs.subarray(LOD_INPUT.sphere, LOD_INPUT.sphere + 4)
  writeError(out, at, e, sphere, flags & LOD_BIT.childReady ? inputs[LOD_INPUT.own] * scale : 0)
  out[at + 16] = sphere[3] * scale
  if (!(flags & LOD_BIT.ready)) out[at + 7] = 0
  else if (flags & LOD_BIT.hasParent) {
    const parent = inputs.subarray(LOD_INPUT.parentSphere, LOD_INPUT.parentSphere + 4)
    writeError(out, at + 4, e, parent, inputs[LOD_INPUT.parent] * scale)
    out[at + 17] = parent[3] * scale
  }
}
