import { depthRestoreWgsl } from '../core/depthRestoreWgsl.ts';
import { MAX_SHADOW_REGIONS as R, SHADOW_FACE_READ_BYTES as RECT_OFFSET } from './recordPack.ts';
import { SHADOW_FACE_STRIDE } from './batchBudget.ts';
import { TRANSMITTANCE_CLEAR_WGSL } from './transmittance.ts';

// The two page draws of the shadow pool: the move of a resized pool (`pageMoves.ts`) and the page
// quads of a render pass (`pageQuads.ts`).

/**
 * Each instance is one page moved: two triangles over its square of the target layer, whose
 * fragments write the depth of the texel at the same place of the page in the source — texel for
 * texel, as the restore does (`../core/depthRestoreWgsl.ts`), only shifted. WebGPU copies a depth
 * texture whole, never a region of it.
 */
export const PAGE_MOVE_SHADER = `struct Move{was:vec4u,now:vec4u,}
@group(0) @binding(0) var<storage,read> moves:array<Move>;
@group(0) @binding(1) var pool:texture_depth_2d_array;
struct Moved{@builtin(position) p:vec4f,@location(0) @interpolate(flat) shift:vec3i,}
@vertex fn move_vs(@builtin(vertex_index) i:u32,@builtin(instance_index) k:u32)->Moved{
 let m=moves[k];
 let corner=vec2f(f32((0x32u>>i)&1u),f32((0x2cu>>i)&1u));
 let texel=(vec2f(m.now.xy)+corner*f32(m.was.w))/f32(m.now.w);
 return Moved(vec4f(texel.x*2.0-1.0,1.0-texel.y*2.0,0.0,1.0),vec3i(vec2i(m.was.xy)-vec2i(m.now.xy),i32(m.was.z)));
}
@fragment fn move_fs(v:Moved)->@builtin(frag_depth) f32{
 return textureLoad(pool,vec2i(v.p.xy)+v.shift.xy,v.shift.z,0);
}`;

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
