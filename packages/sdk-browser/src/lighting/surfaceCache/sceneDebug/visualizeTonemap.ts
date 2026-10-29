import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { linearToSrgb } from '../../../../../math/src/wgsl/color.ts'
import type { WebgpuPagesRuntime } from '../../../frame/backend/runtime.ts'
import { toneReadWgsl } from '../../toneLutRead.ts'
import { VIEW_WGSL } from '../../deferred/worldAtWgsl.ts'

/**
 * THE COLOUR A DEBUG VIEW SHOWS A LIGHT IN, over the display image: the light seen through the table the composition reads (`../../toneLut.ts`), the colour grade and the display
 * curve in one read, at the exposure the image is shown at, so a ray or a probe has the colour the surface it lights has; or, where the view asks for no tone mapping or the table
 * is not baked yet, the display's transfer alone. A kernel binds the view's uniform at `first`, the table at `first + 1` to `first + 3`.
 */
export const visualizeTonemapWgsl = (first: number) =>
  wgslBlock(
    `visualizeTonemap(${first})`,
    [VIEW_WGSL, toneReadWgsl(first + 1), linearToSrgb],
    `@group(0) @binding(${first}) var<uniform> view:View;
fn visualizeTonemap(light:vec3f,tonemap:bool)->vec3f{
 if(!tonemap){return linearToSrgb(light);}
 return toneShown(light*view.preExposure.y,u32(view.display.x));
}`,
  )

/** What a kernel binds for `visualizeTonemapWgsl`, in the order of its bindings, and whether the table is there to read; none where the view has no composition. */
export function visualizeTonemapBindings(rt: WebgpuPagesRuntime) {
  const deferred = rt.gpu.deferred
  if (!deferred) return undefined
  const table = deferred.toneLut
  return {
    resources: [
      { buffer: deferred.uniform },
      table.view(),
      table.sampler,
      { buffer: table.reading },
    ] satisfies GPUBindingResource[],
    baked: table.baked,
  }
}
