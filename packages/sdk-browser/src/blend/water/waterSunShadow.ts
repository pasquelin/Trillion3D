import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { preparedPipeline } from '../../lighting/deferred/fullscreen.ts'
import { WATER_SHADOW_BINDINGS as S } from './waterLayout.ts'
import { WATER_MATH_WGSL } from './waterMathWgsl.ts'
import { waterTileVertexWgsl } from './waterTileWgsl.ts'

/**
 * THE SUN'S SHADOW ON THE WATER, laid on its separated sun: a draw over the tiles that hold water (the list,
 * `waterTileVertex`) of the share of the forward sun's shadow the projection wrote at each pixel
 * (`water.filters.z` the layer of its mask), blended as `destination · source` so that the separated sun the
 * shading wrote is multiplied by it, and the composite then adds the shadowed sun. The pixels of a tile that
 * hold no water hold a black sun and stay black.
 */
export const SUN_SHADOW_WGSL = wgslBlock(
  'WATER_SUN_SHADOW_WGSL',
  [WATER_MATH_WGSL, waterTileVertexWgsl(0, S.tiles)],
  `@group(0) @binding(${S.params}) var<uniform> water:WaterParams;
@group(0) @binding(${S.mask}) var sunShadow:texture_2d_array<f32>;
@fragment fn fsWaterSunShadow(@builtin(position) position:vec4f)->@location(0) vec4f{
 let share=textureLoad(sunShadow,vec2i(position.xy),i32(water.filters.z),0).x;
 return vec4f(vec3f(share),1.0);
}`,
)

/** The draw's pipeline over `format` on the group layout `layout` (`WATER_SHADOW_BINDINGS`). */
export function sunShadowStage(
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  format: GPUTextureFormat,
) {
  const module = device.createShaderModule({
    label: 'Trillion3D water sun shadow',
    code: wgslModule(SUN_SHADOW_WGSL),
  })
  return {
    layout,
    pipeline: preparedPipeline(device, {
      label: 'Trillion3D water sun shadow',
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      vertex: { module, entryPoint: 'waterTileVertex' },
      fragment: {
        module,
        entryPoint: 'fsWaterSunShadow',
        targets: [
          {
            format,
            blend: {
              color: { srcFactor: 'zero', dstFactor: 'src', operation: 'add' },
              alpha: { srcFactor: 'zero', dstFactor: 'one', operation: 'add' },
            },
          },
        ],
      },
      primitive: { topology: 'triangle-list' },
    }),
  }
}
