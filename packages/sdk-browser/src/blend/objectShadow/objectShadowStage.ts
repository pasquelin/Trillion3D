import { computeBufferEntry, computeUniformEntry } from '../../gpu/core/computeBindings.ts'
import { oncePerDevice } from '../../gpu/core/oncePerDevice.ts'
import { stageDescriptors, type FrontStagePipelines } from '../stagePipelines.ts'
import { stageOfCulls } from '../frontStage.ts'
import { radianceMarkBlendLayout } from '../radianceMarkStage.ts'
import {
  blendObjectShadowShader,
  cutsWater,
  OBJECT_SHADOW_DRAW_BINDING,
  OBJECT_SHADOW_MATERIALS_BINDING,
} from './objectShadowWgsl.ts'
import { TRANSLUCENT_SHADOW_FORMAT } from '../../lighting/shadows/perObject/translucentShadowRules.ts'
import type { Clipping } from '../../gpu/core/clipDistances.ts'
import type { SurfaceProgram } from '../../materials/graph/surfaceProgram.ts'
import { waterTableLayout } from '../water/waterExclusionTable.ts'
import { PLAIN_VARIANT, type BlendVariant } from '../variant.ts'
import { NO_WPO, type WpoSet } from '../../materials/graph/wpoProgram.ts'

/** The layers add: one for one, colour and alpha. */
const ADD: GPUBlendState = {
  color: { operation: 'add', srcFactor: 'one', dstFactor: 'one' },
  alpha: { operation: 'add', srcFactor: 'one', dstFactor: 'one' },
}

/** The stage's own group (after the blend items' group), once a device: the draw's uniform, read at a dynamic offset by both stages, and the
 *  materials' shadow properties, read by the fragment stage. */
export const objectShadowDrawLayout = oncePerDevice((device: GPUDevice) =>
  device.createBindGroupLayout({
    label: 'Trillion3D translucent object shadow depth',
    entries: [
      computeUniformEntry(
        OBJECT_SHADOW_DRAW_BINDING,
        { hasDynamicOffset: true },
        GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
      ),
      computeBufferEntry(
        OBJECT_SHADOW_MATERIALS_BINDING,
        'read-only-storage',
        GPUShaderStage.FRAGMENT,
      ),
    ],
  }),
)

/**
 * The depth stage's pipelines of a device's blend layout (`objectShadowWgsl.ts`): three culls on the mark stage's items group then the stage's own,
 * writing the two coefficient targets added, no depth. Described and compiled at the first ask, a frame's that has a subject. `clipping`, `graphs`
 * and `offsets` are the blend programs' (`createFrontStages`); with `world.exclusion` (a world that holds a water exclusion volume) the water's surface inside a volume that
 * excludes it is not drawn, the volumes' table bound in the water group (`WATER_GROUP`): the pipelines of a world without a volume are as ever.
 */
export function createObjectShadowStage(
  device: GPUDevice,
  clipping?: Clipping,
  graphs: readonly SurfaceProgram[] = [],
  offsets: WpoSet = NO_WPO,
  world: BlendVariant = PLAIN_VARIANT,
): FrontStagePipelines {
  const cut = cutsWater(world.exclusion, graphs)
  return stageOfCulls(device, () => {
    const module = device.createShaderModule({
      label: 'Trillion3D translucent object shadow depth',
      code: blendObjectShadowShader(clipping, graphs, offsets, world.exclusion),
    })
    const fragment = {
      module,
      entryPoint: 'fsObjectShadow',
      targets: [
        { format: TRANSLUCENT_SHADOW_FORMAT, blend: ADD },
        { format: TRANSLUCENT_SHADOW_FORMAT, blend: ADD },
      ],
    }
    // The pass holds no depth attachment: the descriptors' depth state is taken off.
    return stageDescriptors(device, module, radianceMarkBlendLayout(device), fragment, false, [
      objectShadowDrawLayout(device),
      ...(cut ? [waterTableLayout(device)] : []),
    ]).map(({ depthStencil: _depth, ...descriptor }) => descriptor)
  })
}
