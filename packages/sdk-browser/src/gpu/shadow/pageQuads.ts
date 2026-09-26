import { createCheckedShaderModule } from '../core/shaderModule.ts';
import { MAX_SHADOW_REGIONS as R } from './recordPack.ts';
import { SHADOW_FACE_STRIDE } from './batchBudget.ts';
import { shadowBatchWrites } from './batchWrites.ts';
import { RESTORE_WGSL, staticLayerEntries } from './staticLayer.ts';

/** Bytes of the region views at the head of the page data, before the pass order. */
const VIEW_BYTES = R * SHADOW_FACE_STRIDE;

/**
 * What the page quads read, in one storage binding: every region's view — a copy of its face
 * entry, `rect` its page's clip square in the whole atlas's, `o.xy` then `s.xy` (`recordPack.ts`)
 * —, then the batch's regions in pass order. Corner `i` of instance `k` is a corner of the page of
 * region `order[k]`, at far: two triangles over exactly its square of the atlas, which the clear
 * draws depth only and the restore overwrites with the static layer's texel (`restore_fs`).
 */
export const PAGE_QUAD_SHADER = `${RESTORE_WGSL}
struct PageView{viewProjection:mat4x4f,params:vec4f,emitter:vec4f,@size(160) rect:vec4f,}
struct PageData{views:array<PageView,${R}>,order:array<u32,${R}>,}
@group(1) @binding(0) var<storage, read> data:PageData;
@vertex fn page_quad_vs(@builtin(vertex_index) i:u32,@builtin(instance_index) k:u32)->@builtin(position) vec4f{
 let rect=data.views[data.order[k]].rect;
 let corner=vec2f(select(-1.0,1.0,((0x32u>>i)&1u)!=0u),select(-1.0,1.0,((0x2cu>>i)&1u)!=0u));
 return vec4f(corner*rect.zw+rect.xy,0.0,1.0);
}`;

export type ShadowPageQuads = Awaited<ReturnType<typeof createShadowPageQuads>>;

/**
 * THE PAGE QUADS of a shadow render pass (#815): every region of the pass that starts cleared to
 * far is one instance of a single draw, every region restored from the static layer one instance of
 * another — two draws a pass, whatever its regions, over the whole atlas's viewport.
 */
export async function createShadowPageQuads(device: GPUDevice) {
  const data = device.createBuffer({
    label: 'Trillion3D shadow page quads v1',
    size: VIEW_BYTES + R * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  try {
    const module = await createCheckedShaderModule(device, PAGE_QUAD_SHADER, 'PAGE_QUAD');
    const dataLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      ],
    });
    const none = device.createBindGroupLayout({ entries: [] });
    // The static layer's own layout: its groups bind here as they are.
    const layerLayout = device.createBindGroupLayout({ entries: staticLayerEntries() });
    const pipeline = (label: string, first: GPUBindGroupLayout, fragment?: string) =>
      device.createRenderPipeline({
        label: `Trillion3D shadow page ${label} v1`,
        layout: device.createPipelineLayout({ bindGroupLayouts: [first, dataLayout] }),
        vertex: { module, entryPoint: 'page_quad_vs' },
        fragment: fragment ? { module, entryPoint: fragment, targets: [] } : undefined,
        primitive: { topology: 'triangle-list', cullMode: 'none' },
        depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'always' },
      });
    const clear = pipeline('clear', none),
      restore = pipeline('restore', layerLayout, 'restore_fs');
    const empty = device.createBindGroup({ layout: none, entries: [] }),
      group = device.createBindGroup({
        layout: dataLayout,
        entries: [{ binding: 0, resource: { buffer: data } }],
      });
    return {
      /** Opens a batch of `regions` regions: their views, copied from the faces' entries once
       *  written, and their pass `order`. */
      begin(
        encoder: GPUCommandEncoder,
        faces: GPUBuffer,
        regions: number,
        order: Uint32Array<ArrayBuffer>,
      ) {
        encoder.copyBufferToBuffer(faces, 0, data, 0, regions * SHADOW_FACE_STRIDE);
        shadowBatchWrites(device).write(data, VIEW_BYTES, order, 0, regions);
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
        pass.setBindGroup(1, group);
        if (clears) {
          pass.setPipeline(clear);
          pass.setBindGroup(0, empty);
          pass.draw(6, clears, 0, first);
        }
        if (restores) {
          pass.setPipeline(restore);
          pass.setBindGroup(0, layer!);
          pass.draw(6, restores, 0, first + clears);
        }
        return +!!clears + +!!restores;
      },
      dispose: () => data.destroy(),
    };
  } catch (error) {
    data.destroy();
    throw error;
  }
}
