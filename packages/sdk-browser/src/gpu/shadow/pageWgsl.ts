import { depthRestoreWgsl } from '../core/depthRestoreWgsl.ts';
import { MAX_SHADOW_REGIONS as R, SHADOW_FACE_READ_BYTES as RECT_OFFSET } from './recordPack.ts';
import { SHADOW_FACE_STRIDE } from './batchBudget.ts';
import { TRANSMITTANCE_CLEAR_WGSL } from './transmittance.ts';

// The page quads of a render pass (`pageQuads.ts`).

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
${depthRestoreWgsl(1)}
@vertex fn page_quad_vs(@builtin(vertex_index) i:u32,@builtin(instance_index) k:u32)->@builtin(position) vec4f{
 let rect=data.views[data.order[k]].rect;
 let corner=vec2f(select(-1.0,1.0,((0x32u>>i)&1u)!=0u),select(-1.0,1.0,((0x2cu>>i)&1u)!=0u));
 return vec4f(corner*rect.zw+rect.xy,0.0,1.0);
}
/** A page of the transmittance layer cleared: all the light, and far. */
@fragment fn transmittance_clear_fs()->@location(0) vec4f{
 return ${TRANSMITTANCE_CLEAR_WGSL};
}`;
