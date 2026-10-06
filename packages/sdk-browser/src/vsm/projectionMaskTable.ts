/**
 * The compact shadow mask: a light's lane is 8 bits of an `r32uint` texel, four lights a
 * layer. A lane holds what the projection's trace counted (`vsmMaskCode`, `projectionWgsl.ts`):
 * 0 where no ray was traced (factor 1), else its rays n (high nibble, 1 ≤ n ≤ 15) and the k of them
 * that missed (low nibble, k ≤ n), the factor k / n. The opaque resolve decodes a lane through
 * this table (`vsmMaskFactor`, `lighting/direct/shadowWgsl.ts`): 256 factors, filled once per
 * device by `f32(k) / f32(n)` — the projection's own expression — stored into an `rgba16float`
 * storage texture, the format and the store the mask was written with before: each decoded
 * factor is the half float the mask held, by the device's own conversion, never a rounding of
 * ours. A factor the traces reach takes no other value than the one it had.
 */

import { preparedComputePipeline, started } from '../lighting/deferred/fullscreen.ts';
import { VSM_MASK_TABLE_TEXELS, VSM_MASK_TABLE_WGSL } from './projectionWgsl.ts';

/** The opaque resolve's binding of the table (`lighting/deferred/setup.ts`). */
export const VSM_MASK_TABLE_BINDING = 21;
/** The opaque resolve's binding of the mask's tile words (`vsmMaskFactor`), past the receiver's. */
export const VSM_MASK_TILES_BINDING = 29;
/** The resolve's read of the table, at `binding`. */
export const vsmMaskTableReadWgsl = (binding: number) => /* wgsl */ `
@group(0) @binding(${binding}) var vsmMaskTable:texture_2d<f32>;
fn vsmMaskDecode(code:u32)->f32{return textureLoad(vsmMaskTable,vec2u(code>>2u,0u),0)[code&3u];}`;

/** The decode table of `device`: its pipeline compiled off the frame from now (`started`), its
 *  fill encoded and submitted on its own, once (`fill`), by the first frame that binds a program
 *  reading a mask — before that frame's own submit, whatever becomes of its encoder. The caller
 *  frees the texture. */
export function createVsmMaskTable(device: GPUDevice) {
  const label = 'Trillion3D VSM mask table';
  const texture = device.createTexture({
    label,
    size: [VSM_MASK_TABLE_TEXELS, 1],
    format: 'rgba16float',
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
  });
  const layout = device.createBindGroupLayout({
    label,
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.COMPUTE,
        storageTexture: { access: 'write-only', format: 'rgba16float' },
      },
    ],
  });
  const pipeline = started(
    preparedComputePipeline(device, {
      label,
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      compute: {
        module: device.createShaderModule({ label, code: VSM_MASK_TABLE_WGSL }),
        entryPoint: 'vsmMaskTableFill',
      },
    }),
  );
  const group = device.createBindGroup({
    label,
    layout,
    entries: [{ binding: 0, resource: texture.createView() }],
  });
  let filled = false;
  return {
    texture,
    view: texture.createView(),
    /** Fills the table in its own submit, the first time only: submitted, it holds for good. */
    fill() {
      if (filled) return;
      const encoder = device.createCommandEncoder({ label });
      const pass = encoder.beginComputePass({ label });
      pass.setPipeline(pipeline.get());
      pass.setBindGroup(0, group);
      pass.dispatchWorkgroups(1);
      pass.end();
      device.queue.submit([encoder.finish()]);
      filled = true;
    },
  };
}
