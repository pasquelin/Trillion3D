import {
  MASK_KEEP_WGSL,
  PAGE_BINDING,
  PAGE_INFO_WGSL,
  PAGE_LOOKUP_WGSL,
} from '../../visibility/shader/pageWgsl.ts';
import { PAGE_GEOMETRY_WGSL } from '../../visibility/shader/pageGeometryWgsl.ts';
import {
  COLOR_SAMPLE_WGSL,
  TILE_POOL_WGSL,
  maskAlphaWgsl,
  tileDeclarations,
} from '../../webgpu/tile/wgsl.ts';
import { VIS_BINDINGS } from '../../webgpu/core/bindLayout.ts';
import { FLAG_BLEND_CASTER } from '../../visibility/types.ts';
import { BLEND_COVERAGE_WGSL } from './blendCoverage.ts';

/**
 * Shadow depth passes. Group 0 is that of the visibility-buffer raster, but for one binding:
 * same page table, same cluster selection, same indirect buffer. Only the matrix changes, and
 * it comes from group 1 with a dynamic offset — one face per offset.
 *
 * The fragment stage writes nothing: it exists only to discard. An opacity-mask material —
 * foliage, grille, lattice — casts the shadow of its cutout and not the full silhouette of its
 * cluster, because the mask test is the raster's (`MASK_KEEP_WGSL`), read at the map level the
 * shadow texel asks for — its derivatives, not the camera's.
 *
 * A blended cluster casts from a row only this pass reads (`FLAG_BLEND_CASTER`,
 * `../../webgpu/row/blendCasters.ts`): it keeps the share of its texels its coverage names
 * (`blendCoverage.ts`), and the PCF of the read turns that share into a partial shadow.
 *
 * It also discards the emitter envelope: a light that declares a radius accepts no depth from a
 * surface closer to its centre than that radius. The rule is Euclidean distance to the centre,
 * so the exclusion is exactly the announced sphere — a raised near plane would have cut a cube.
 * A light without a radius carries a zero radius and nothing is discarded.
 */
export const SHADOW_DEPTH_SHADER = `${PAGE_INFO_WGSL}
${PAGE_BINDING.indices}
${PAGE_BINDING.positions}
${PAGE_BINDING.pages}
${PAGE_BINDING.uniforms}
@group(0) @binding(${VIS_BINDINGS.uv}) var<storage, read> uvs:array<f32>;
${tileDeclarations(VIS_BINDINGS.color, 'color')}
@group(0) @binding(${VIS_BINDINGS.sampler}) var mapsSampler:sampler;
${PAGE_BINDING.instances}
${PAGE_BINDING.slotOffsets}
struct ShadowView{viewProjection:mat4x4f,params:vec4f,emitter:vec4f,}
@group(1) @binding(0) var<uniform> shadow:ShadowView;
struct ShadowOut{@builtin(position) position:vec4f,@location(0) @interpolate(flat) instance:u32,@location(1) uv:vec2f,@location(2) fromEmitter:vec3f,}
${PAGE_LOOKUP_WGSL}
${PAGE_GEOMETRY_WGSL}
${TILE_POOL_WGSL}
${COLOR_SAMPLE_WGSL}
${maskAlphaWgsl(true)}
${MASK_KEEP_WGSL}
${BLEND_COVERAGE_WGSL}
@vertex fn shadow_vs(@builtin(vertex_index) vertexIndex:u32,@builtin(instance_index) instanceIndex:u32)->ShadowOut{
 var out:ShadowOut;
 let pageIndex=drawPage(instanceIndex);
 let page=pages[pageIndex];
 out.instance=pageIndex;out.uv=vec2f(0.0);out.fromEmitter=vec3f(0.0);
 if(vertexIndex>=page.indexCount){out.position=vec4f(0.0,0.0,2.0,1.0);return out;}
 let h=pageHeader(page);
 let id=pageCorner(page,h,vertexIndex);
 let vertex=pagePosition(page,h,id);
 // The out.position product is not reassociated: world position is composed apart, otherwise
 // the written depth would no longer be that from before this batch, to the bit.
 out.position=shadow.viewProjection*page.world*vec4f(vertex,1.0);
 out.fromEmitter=(page.world*vec4f(vertex,1.0)).xyz-shadow.emitter.xyz;
 if((page.flags&4u)!=0u){out.uv=pageUv(page,h,id);}
 return out;
}
/** Writes no colour: the pass has no target. It only discards the envelope, the cutout and the
 *  texels a blended caster lets the light through. */
@fragment fn shadow_fs(in:ShadowOut){
 let gx=dpdx(in.uv);let gy=dpdy(in.uv);
 let radius=shadow.emitter.w;
 if(radius>0.0&&dot(in.fromEmitter,in.fromEmitter)<radius*radius){discard;}
 if(!maskKeep(pages[in.instance],in.uv,1.0,gx,gy,0.0)){discard;}
 let blended=(pages[in.instance].flags&${FLAG_BLEND_CASTER}u)!=0u;
 if(blended&&!blendCasterKeep(pages[in.instance],in.uv,gx,gy,in.position.xy)){discard;}
}
/** Resets the slice to FAR without clearing the rest of the atlas. Face depth is reverse-Z
 *  like the camera's (\`../../camera/depthConvention.ts\`): far is zero. */
@vertex fn shadow_clear_vs(@builtin(vertex_index) i:u32)->@builtin(position) vec4f{
 return vec4f(f32(i32(i&1u)*4-1),f32(i32(i>>1u)*4-1),0.0,1.0);
}`;
