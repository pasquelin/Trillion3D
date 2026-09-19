import {
  PAGE_BINDING,
  PAGE_INFO_WGSL,
  PAGE_LOOKUP_WGSL,
  PAGE_MASK_WGSL,
  PAGE_VERTEX_WGSL,
} from './visibilityPageWgsl.ts';
import {
  COLOR_SAMPLE_WGSL,
  TILE_POOL_WGSL,
  maskAlphaWgsl,
  tileDeclarations,
} from './webgpuTileWgsl.ts';
import { VIS_BINDINGS } from './webgpuBindLayout.ts';
import { HIZ_REJECTED_WGSL } from './gpuPartitionContract.ts';
import { COMPUTE_ALL, COMPUTE_TAKES_WGSL } from './gpuRasterContract.ts';

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
${PAGE_VERTEX_WGSL}
${PAGE_MASK_WGSL}
${COMPUTE_TAKES_WGSL}
/** True when hardware does not draw this vertex: off the page, or of a triangle the
 *  compute raster takes. Without a share, nor under COMPUTE_ALL, no extra vertex is read. */
fn hardwareSkips(page:PageInfo,vertexIndex:u32)->bool{
 if(vertexIndex>=page.indexCount||uni.computeSpan>=${COMPUTE_ALL}){return true;}
 if(uni.computeSpan<=0.0){return false;}
 let triangle=vertexIndex/3u;
 let ia=indices[page.pageOffset+triangle*3u];let ib=indices[page.pageOffset+triangle*3u+1u];let ic=indices[page.pageOffset+triangle*3u+2u];
 let vp=uni.viewProj*page.world;
 return computeTakes(vp*vec4f(vertPos(page.vertexBase,ia),1.0),vp*vec4f(vertPos(page.vertexBase,ib),1.0),vp*vec4f(vertPos(page.vertexBase,ic),1.0));
}
@vertex fn vis_vs(@builtin(vertex_index) vertexIndex:u32,@builtin(instance_index) instanceIndex:u32)->VSOut{
 var out:VSOut;
 let pageIndex=drawPage(instanceIndex);
 let page=pages[pageIndex];
 out.instance=pageIndex;out.uv=vec2f(0.0);
 if(hardwareSkips(page,vertexIndex)){out.position=vec4f(0.0,0.0,2.0,1.0);out.id=0u;return out;}
 let id=indices[page.pageOffset+vertexIndex];
 let p=vertPos(page.vertexBase,id);
 let world=page.world*vec4f(p,1.0);
 out.position=uni.viewProj*world;
 out.id=page.packedBase|((vertexIndex/3u)&0xffu);
 if((page.flags&4u)!=0u){out.uv=vertUv(page.vertexBase,id);}
 return out;
}
@vertex fn vis_hiz_vs(@builtin(vertex_index) vertexIndex:u32,@builtin(instance_index) instanceIndex:u32)->VSOut{
 var out:VSOut;
 let pageIndex=drawPage(instanceIndex);
 let page=pages[pageIndex];
 out.instance=pageIndex;out.uv=vec2f(0.0);
 if(hizRejected(page.hizSlot)){out.position=vec4f(0.0,0.0,2.0,1.0);out.id=0u;return out;}
 if(hardwareSkips(page,vertexIndex)){out.position=vec4f(0.0,0.0,2.0,1.0);out.id=0u;return out;}
 let id=indices[page.pageOffset+vertexIndex];
 let p=vertPos(page.vertexBase,id);
 let world=page.world*vec4f(p,1.0);
 out.position=uni.viewProj*world;
 out.id=page.packedBase|((vertexIndex/3u)&0xffu);
 if((page.flags&4u)!=0u){out.uv=vertUv(page.vertexBase,id);}
 return out;
}
struct VisHizOut{@location(0) id:u32,@location(1) depth:f32,}
@fragment fn vis_hiz_fs(in:VSOut)->VisHizOut{
 var out:VisHizOut;
 let gx=dpdx(in.uv);let gy=dpdy(in.uv);
 if(!maskKeep(pages[in.instance],in.uv,gx,gy)){discard;}
 out.id=in.id;out.depth=in.position.z;return out;
}
@fragment fn vis_fs(in:VSOut)->@location(0) u32{
 let gx=dpdx(in.uv);let gy=dpdy(in.uv);
 if(!maskKeep(pages[in.instance],in.uv,gx,gy)){discard;}
 return in.id;
}
`;
