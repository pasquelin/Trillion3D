import { NO_SIGHT } from './tessellation.ts'
import {
  TESS_UNIFORM,
  writeTessellationUniform,
  type TessellationCapacity,
  type TessellationSettings,
  type TessellationSight,
  type TessellationView,
} from './uniform.ts'

/** What a test gives the uniform besides the view: the settings, the capacity, the regions and the
 *  occlusion test's views, each a plain value where unset. */
export type UniformGiven = {
  settings?: TessellationSettings
  capacity?: TessellationCapacity
  regions?: Parameters<typeof writeTessellationUniform>[5]
  sight?: TessellationSight
}

/** The uniform for `view` written into fresh words (`floats`, and `ints` over the same buffer), the
 *  rest of `given` as a pass that tests no pyramid would write it. */
export function writtenUniform(view: TessellationView, given: UniformGiven = {}) {
  const floats = new Float32Array(TESS_UNIFORM.words),
    ints = new Uint32Array(floats.buffer)
  writeTessellationUniform(
    floats,
    ints,
    view,
    given.settings ?? { tessellationDicingRate: 2, tessellationMaxPatchesPerGroup: 8 },
    given.capacity ?? { candidate: 1, visible: 1, records: 1 },
    given.regions ?? {
      args: 0,
      queue: 0,
      visible: 0,
      occluded: 0,
      windows: 0,
      dispatch: 0,
      disp: 0,
      list: 0,
      lost: 0,
      layered: false,
    },
    given.sight ?? NO_SIGHT,
  )
  return { floats, ints }
}
