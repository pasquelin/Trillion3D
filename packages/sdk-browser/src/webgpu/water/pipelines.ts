import { reflectionLayout } from '../../reflections/layout.ts'
import { waterSurfaceTargets } from './surfaceTargets.ts'
import { createCheckedShaderModule } from '../../gpu/core/shaderModule.ts'
import { deferredLayoutEntries } from '../../lighting/deferred/setup.ts'
import { preparedPipeline } from '../../lighting/deferred/fullscreen.ts'
import { readOnly } from '../core/bindLayout.ts'
import { blendStagePipelines } from '../blend/stagePipelines.ts'
import { WATER_BINDINGS, waterCompositeShader } from './compositeWgsl.ts'
import { waterRoutedShader } from './routedWgsl.ts'
import { displayMaskLayout } from '../blend/displayFilter.ts'
import { waterCompositeTargets } from './compositeTargets.ts'
import { createReach, type Reach } from '../blend/reach.ts'
import { variantLabel, type ContractKey } from '../../lighting/deferred/contractVariants.ts'

/**
 * Surface stage: the blend module's vertex stage and `fsWater`, on the blend bind group layout —
 * nothing else is bound for it. Depth is tested AND written, against the opaque depth copied in:
 * the nearest surface of a pixel is the one the composite lights, and a surface behind an opaque
 * never reaches it. No blend: the targets carry material values, not colour.
 */
export const createWaterSurfacePipelines = (
  device: GPUDevice,
  module: GPUShaderModule,
  layout: GPUBindGroupLayout,
  feedback = true,
) =>
  blendStagePipelines(
    device,
    module,
    layout,
    {
      module,
      entryPoint: feedback ? 'fsWater' : 'fsWaterWithoutFeedback',
      targets: waterSurfaceTargets(feedback),
    },
    true,
  )

/** Layout of the composite: the deferred bounce layout — the water word, a colour, in the flags'
 *  place —, then what `waterCompositeShader` alone declares. */
export function createWaterCompositeLayout(device: GPUDevice) {
  const b = WATER_BINDINGS,
    fragment = GPUShaderStage.FRAGMENT,
    word: GPUTextureBindingLayout = { sampleType: 'unfilterable-float' }
  return device.createBindGroupLayout({
    label: 'Trillion3D water composite',
    entries: [
      ...deferredLayoutEntries(true, true, false).map((entry) =>
        entry.binding === b.word ? { ...entry, texture: word } : entry,
      ),
      { binding: b.backdrop, visibility: fragment, texture: { sampleType: 'unfilterable-float' } },
      { binding: b.backdropDepth, visibility: fragment, texture: { sampleType: 'depth' } },
      { binding: b.uniform, visibility: fragment, buffer: { type: 'uniform' } },
      { binding: b.volumes, visibility: fragment, buffer: readOnly },
    ],
  })
}

/** Each composite's entry point, indexed as `createWaterComposites` caches them. */
const COMPOSE_ENTRIES = [
  'composeWater',
  'composeWaterRouted',
  'composeWaterReactive',
  'composeWaterRoutedReactive',
]

/**
 * The composite pipelines of one pass: a fullscreen triangle into the HDR target, blended exactly
 * as the forward transmission pass was — source alpha over what the frame already holds, which at a
 * water pixel is the frozen backdrop itself; a pixel with no water discards, and the target keeps
 * its value. What the scene reaches (`reach`) is compiled here, off the frame: the plain composite,
 * the one routed through the display layers (`waterRoutedShader`: the tint and the added value of a
 * normal layer) and the ones carrying the reactive value (`asIsShare.ts`) as a last output; one that
 * appears later starts its compile at the change, and a frame that gets there first makes it.
 * A reference session's (`unbounded`) walk the mirror ray whole (`waterCompositeShader`). The
 * light code is the one `key` leaves in, as the opaque resolve's (`createLitVariants`, `frame.ts`).
 */
export async function createWaterComposites(
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  unbounded = false,
  key: Partial<ContractKey> = {},
  reach: Reach = createReach({ modes: [], share: false, filtered: false }),
) {
  const suffix = `${unbounded ? '_UNBOUNDED' : ''}${variantLabel(key)}`
  const module = await createCheckedShaderModule(
    device,
    waterCompositeShader(unbounded, key),
    `WATER_COMPOSITE${suffix}`,
  )
  const layouts = [layout, reflectionLayout(device)]
  const routedLabel = `WATER_ROUTED${suffix}`
  let routedModule: GPUShaderModule | undefined
  const describe = (filtered: boolean, share: boolean, entryPoint: string) => {
    const code = filtered
      ? (routedModule ??= device.createShaderModule({
          label: routedLabel,
          code: waterRoutedShader(unbounded, key),
        }))
      : module
    const bindGroupLayouts = filtered ? [...layouts, displayMaskLayout(device)] : layouts
    return {
      layout: device.createPipelineLayout({ bindGroupLayouts }),
      vertex: { module: code, entryPoint: 'fullscreen' },
      fragment: {
        module: code,
        entryPoint,
        ...(filtered && { constants: { DISPLAY_ROUTE: 1 } }),
        targets: waterCompositeTargets(share, filtered),
      },
      primitive: { topology: 'triangle-list' },
    } satisfies GPURenderPipelineDescriptor
  }
  // The display route is the low bit, the share the one above: 0 base, 1 routed, 2 share, 3 both.
  const slots: ReturnType<typeof preparedPipeline>[] = []
  const slotOf = (slot: number) =>
    (slots[slot] ??= preparedPipeline(
      device,
      describe(!!(slot & 1), !!(slot & 2), COMPOSE_ENTRIES[slot]),
    ))
  /** Compiles off the frame the composites the scene reaches (`reach.ts`): the shares in play,
   *  with the display layers when they can be on. A frame that finds one missing makes it itself. */
  const catchUp = () => {
    const { shares, filtered } = reach.state
    const wanted = [...shares].flatMap((share) =>
      (filtered ? [false, true] : [false]).map((layers) => +layers + 2 * +share),
    )
    return Promise.all(wanted.map((slot) => slotOf(slot).prepare()))
  }
  reach.onChange(catchUp)
  await catchUp()
  return { at: (filtered: boolean, share: boolean) => slotOf(+filtered + 2 * +share).get() }
}
