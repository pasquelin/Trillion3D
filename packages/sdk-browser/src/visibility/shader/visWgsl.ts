import {
  MASK_KEEP_WGSL,
  PAGE_BINDING,
  PAGE_INFO_WGSL,
  PAGE_LOOKUP_WGSL,
  STIPPLE_WGSL,
} from './pageWgsl.ts';
import { PAGE_GEOMETRY_WGSL } from './pageGeometryWgsl.ts';
import {
  COLOR_SAMPLE_WGSL,
  TILE_POOL_WGSL,
  maskAlphaWgsl,
  tileDeclarations,
} from '../../webgpu/tile/wgsl.ts';
import { VIS_BINDINGS } from '../../webgpu/core/bindLayout.ts';
import { HIZ_REJECTED_WGSL } from '../../gpu/partition/contract.ts';
import { COMPUTE_ALL, COMPUTE_TAKES_WGSL } from '../../gpu/raster/contract.ts';

/**
 * Hardware raster of the visibility buffer, producer of the opaque and masked image. Under the
 * reference's share (`uni.computeSpan`), it leaves to the compute raster the triangles that
 * one takes — the same predicate, read on the same vertices — and draws all the others; at
 * zero, it draws the whole cut without reading one more vertex.
 */
export const VIS_SHADER = `${PAGE_INFO_WGSL}
${PAGE_BINDING.indices}
${PAGE_BINDING.positions}
${PAGE_BINDING.pages}
@group(0) @binding(${VIS_BINDINGS.flags}) var<storage, read> hizFlags:array<u32>;
${HIZ_REJECTED_WGSL}
${PAGE_BINDING.uniforms}
@group(0) @binding(${VIS_BINDINGS.uv}) var<storage, read> uvs:array<f32>;
${tileDeclarations(VIS_BINDINGS.color, 'color')}
@group(0) @binding(${VIS_BINDINGS.sampler}) var mapsSampler:sampler;
${PAGE_BINDING.instances}
${PAGE_BINDING.slotOffsets}
${TILE_POOL_WGSL}
${COLOR_SAMPLE_WGSL}
${maskAlphaWgsl(false)}
${PAGE_LOOKUP_WGSL}
struct VSOut{@builtin(position) position:vec4f,@location(0) @interpolate(flat) id:u32,@location(1) @interpolate(flat) instance:u32,@location(2) uv:vec2f,}
${PAGE_GEOMETRY_WGSL}
${MASK_KEEP_WGSL}
${STIPPLE_WGSL}
${COMPUTE_TAKES_WGSL}
/** True when this vertex belongs to no triangle of the page, or when the compute raster draws
 *  the whole cut: neither case reads a page word, so neither decodes the page header. */
fn hardwareIdle(page:PageInfo,vertexIndex:u32)->bool{
 return vertexIndex>=page.indexCount||uni.computeSpan>=${COMPUTE_ALL};
}
/** True when hardware leaves this vertex to the compute raster, which takes its triangle.
 *  Without a share, no extra vertex is read. */
fn hardwareSkips(page:PageInfo,h:ClusterHeader,vertexIndex:u32)->bool{
 if(uni.computeSpan<=0.0){return false;}
 let triangle=vertexIndex/3u;
 let ia=pageCorner(page,h,triangle*3u);let ib=pageCorner(page,h,triangle*3u+1u);let ic=pageCorner(page,h,triangle*3u+2u);
 let vp=uni.viewProj*page.world;
 return computeTakes(vp*vec4f(pagePosition(page,h,ia),1.0),vp*vec4f(pagePosition(page,h,ib),1.0),vp*vec4f(pagePosition(page,h,ic),1.0));
}
@vertex fn vis_vs(@builtin(vertex_index) vertexIndex:u32,@builtin(instance_index) instanceIndex:u32)->VSOut{
 var out:VSOut;
 let pageIndex=drawPage(instanceIndex);
 let page=pages[pageIndex];
 out.instance=pageIndex;out.uv=vec2f(0.0);
 if(hardwareIdle(page,vertexIndex)){out.position=vec4f(0.0,0.0,2.0,1.0);out.id=0u;return out;}
 let h=pageHeader(page);
 if(hardwareSkips(page,h,vertexIndex)){out.position=vec4f(0.0,0.0,2.0,1.0);out.id=0u;return out;}
 let id=pageCorner(page,h,vertexIndex);
 let p=pagePosition(page,h,id);
 let world=page.world*vec4f(p,1.0);
 out.position=uni.viewProj*world;
 out.id=page.packedBase|((vertexIndex/3u)&0xffu);
 if((page.flags&4u)!=0u){out.uv=pageUv(page,h,id);}
 return out;
}
@vertex fn vis_hiz_vs(@builtin(vertex_index) vertexIndex:u32,@builtin(instance_index) instanceIndex:u32)->VSOut{
 var out:VSOut;
 let pageIndex=drawPage(instanceIndex);
 let page=pages[pageIndex];
 out.instance=pageIndex;out.uv=vec2f(0.0);
 if(hizRejected(page.hizSlot)){out.position=vec4f(0.0,0.0,2.0,1.0);out.id=0u;return out;}
 if(hardwareIdle(page,vertexIndex)){out.position=vec4f(0.0,0.0,2.0,1.0);out.id=0u;return out;}
 let h=pageHeader(page);
 if(hardwareSkips(page,h,vertexIndex)){out.position=vec4f(0.0,0.0,2.0,1.0);out.id=0u;return out;}
 let id=pageCorner(page,h,vertexIndex);
 let p=pagePosition(page,h,id);
 let world=page.world*vec4f(p,1.0);
 out.position=uni.viewProj*world;
 out.id=page.packedBase|((vertexIndex/3u)&0xffu);
 if((page.flags&4u)!=0u){out.uv=pageUv(page,h,id);}
 return out;
}
struct VisHizOut{@location(0) id:u32,@location(1) depth:f32,}
@fragment fn vis_hiz_fs(in:VSOut)->VisHizOut{
 var out:VisHizOut;
 let gx=dpdx(in.uv);let gy=dpdy(in.uv);
 if(!maskKeep(pages[in.instance],in.uv,gx,gy,stippleOffset(in.position.xy))){discard;}
 out.id=in.id;out.depth=in.position.z;return out;
}
@fragment fn vis_fs(in:VSOut)->@location(0) u32{
 let gx=dpdx(in.uv);let gy=dpdy(in.uv);
 if(!maskKeep(pages[in.instance],in.uv,gx,gy,stippleOffset(in.position.xy))){discard;}
 return in.id;
}
`;
