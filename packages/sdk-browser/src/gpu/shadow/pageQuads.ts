import { createCheckedShaderModule } from '../core/shaderModule.ts';
import { MAX_SHADOW_REGIONS as R } from './recordPack.ts';
import { SHADOW_FACE_STRIDE } from './batchBudget.ts';
import { shadowBatchWrites } from './batchWrites.ts';
import { staticLayerEntries } from './staticLayer.ts';

/** Bytes of the faces' entries, before the batch's pass order in the same buffer (`atlas.ts`). */
const ORDER_OFFSET = R * SHADOW_FACE_STRIDE;
/** Bytes of an entry the quads read up to its `rect`: the matrix, `params`, `emitter`. */
const RECT_OFFSET = 96;

/**
 * What the page quads read, in one storage binding — the face buffer: every region's view, `rect`
 * its page's clip square in the whole atlas's, `o.xy` then `s.xy` (`recordPack.ts`), then the
 * batch's regions in pass order. Corner `i` of instance `k` is a corner of the page of region
 * `order[k]`, at far: two triangles over exactly its square of the atlas, which the clear draws
 * depth only and the restore overwrites with the static layer's texel (`restore_fs`).
 */
export const PAGE_QUAD_SHADER = `struct PageView{viewProjection:mat4x4f,params:vec4f,emitter:vec4f,@size(${SHADOW_FACE_STRIDE - RECT_OFFSET}) rect:vec4f,}
struct PageData{views:array<PageView,${R}>,order:array<u32,${R}>,}
@group(0) @binding(0) var<storage, read> data:PageData;
@group(1) @binding(0) var layer:texture_depth_2d;
@vertex fn page_quad_vs(@builtin(vertex_index) i:u32,@builtin(instance_index) k:u32)->@builtin(position) vec4f{
 let rect=data.views[data.order[k]].rect;
 let corner=vec2f(select(-1.0,1.0,((0x32u>>i)&1u)!=0u),select(-1.0,1.0,((0x2cu>>i)&1u)!=0u));
 return vec4f(corner*rect.zw+rect.xy,0.0,1.0);
}
/** The pool and the layer are the same size, each bound at the page's layer: a texel reads its
 *  own twin. */
@fragment fn restore_fs(@builtin(position) p:vec4f)->@builtin(frag_depth) f32{
 return textureLoad(layer,vec2i(p.xy),0);
}`;

export type ShadowPageQuads = Awaited<ReturnType<typeof createShadowPageQuads>>;

/**
 * THE PAGE QUADS of a shadow render pass (#815): every region of the pass that starts cleared to
 * far is one instance of a single draw, every region restored from the static layer one instance of
 * another — two draws a pass, whatever its regions, over the whole atlas's viewport. They read the
 * face buffer `faces` (`atlas.ts`) as it is.
 */
export async function createShadowPageQuads(device: GPUDevice, faces: GPUBuffer) {
  const module = await createCheckedShaderModule(device, PAGE_QUAD_SHADER, 'PAGE_QUAD');
  const dataLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
    ],
  });
  // The static layer's own layout: its groups bind here as they are.
  const layerLayout = device.createBindGroupLayout({ entries: staticLayerEntries() });
  const pipeline = (label: string, layouts: GPUBindGroupLayout[], fragment?: string) =>
    device.createRenderPipeline({
      label: `Trillion3D shadow page ${label} v1`,
      layout: device.createPipelineLayout({ bindGroupLayouts: layouts }),
      vertex: { module, entryPoint: 'page_quad_vs' },
      fragment: fragment ? { module, entryPoint: fragment, targets: [] } : undefined,
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'always' },
    });
  const clear = pipeline('clear', [dataLayout]),
    restore = pipeline('restore', [dataLayout, layerLayout], 'restore_fs');
  const group = device.createBindGroup({
    layout: dataLayout,
    entries: [{ binding: 0, resource: { buffer: faces } }],
  });
  return {
    /** Writes a batch's pass `order` of its `regions` regions, after their faces. */
    begin(regions: number, order: Uint32Array<ArrayBuffer>) {
      shadowBatchWrites(device).write(faces, ORDER_OFFSET, order, 0, regions);
    },
    /**
     * Draws into `pass` the `clears` regions from rank `first` of the order, then the `restores`
     * after them, from the static layer's `layer` group. Returns the draws encoded.
     */
    encode(
      pass: GPURenderPassEncoder,
      first: number,
      clears: number,
      restores: number,
      layer?: GPUBindGroup,
    ) {
      pass.setBindGroup(0, group);
      if (clears) {
        pass.setPipeline(clear);
        pass.draw(6, clears, 0, first);
      }
      if (restores) {
        pass.setPipeline(restore);
        pass.setBindGroup(1, layer!);
        pass.draw(6, restores, 0, first + clears);
      }
      return +!!clears + +!!restores;
    },
  };
}
