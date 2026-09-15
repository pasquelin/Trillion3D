import {
  PAGE_BINDING,
  PAGE_INFO_WGSL,
  PAGE_LOOKUP_WGSL,
  PAGE_VERTEX_WGSL,
} from './visibilityPageWgsl.ts';
import { ATLAS_SLOTS_WGSL, COLOR_ALPHA_WGSL, atlasTextures } from './webgpuAtlasWgsl.ts';
import { VIS_BINDINGS } from './webgpuBindLayout.ts';

export const VIS_SHADER = `${PAGE_INFO_WGSL}
${PAGE_BINDING.indices}
${PAGE_BINDING.positions}
${PAGE_BINDING.pages}
@group(0) @binding(${VIS_BINDINGS.flags}) var<storage, read> hizFlags:array<u32>;
${PAGE_BINDING.uniforms}
@group(0) @binding(${VIS_BINDINGS.uv}) var<storage, read> uvs:array<f32>;
${atlasTextures(VIS_BINDINGS.maps, 'maps')}
@group(0) @binding(${VIS_BINDINGS.sampler}) var mapsSampler:sampler;
${PAGE_BINDING.instances}
${PAGE_BINDING.slotOffsets}
@group(0) @binding(${VIS_BINDINGS.colorSlots}) var<storage, read> colorSlots:array<vec2u>;
${ATLAS_SLOTS_WGSL}
${COLOR_ALPHA_WGSL}
${PAGE_LOOKUP_WGSL}
struct VSOut{@builtin(position) position:vec4f,@location(0) @interpolate(flat) id:u32,@location(1) @interpolate(flat) instance:u32,@location(2) uv:vec2f,}
${PAGE_VERTEX_WGSL}
fn vertUv(base:u32,idx:u32)->vec2f{let i=(base+idx)*2u;return vec2f(uvs[i],uvs[i+1u]);}
fn wrapCoord(t:f32,repeat:bool)->f32{return select(clamp(t,0.0,1.0),fract(t),repeat);}
fn maskKeep(page:PageInfo,uv:vec2f)->bool{
 if((page.flags&128u)==0u||(page.flags&8u)==0u){return true;}
 let raw=vec2f(wrapCoord(uv.x,(page.flags&32u)!=0u),wrapCoord(uv.y,(page.flags&64u)!=0u));
 // Chaque niveau progressif préserve la couverture du seuil, donc la découpe est juste dès le
 // premier niveau reçu ; une couche prête relit le niveau 0, exactement comme avant ce lot.
 return colorAlpha(page.mapIndex,page.uvScale,raw)>=page.baseColor.w;
}
fn computeTriangle(page:PageInfo,triangle:u32)->bool{
 if(uni.smallThreshold<=0.0||triangle*3u+2u>=page.indexCount){return false;}
 let ia=indices[page.pageOffset+triangle*3u];let ib=indices[page.pageOffset+triangle*3u+1u];let ic=indices[page.pageOffset+triangle*3u+2u];
 let a=uni.viewProj*page.world*vec4f(vertPos(page.vertexBase,ia),1.0);
 let b=uni.viewProj*page.world*vec4f(vertPos(page.vertexBase,ib),1.0);
 let c=uni.viewProj*page.world*vec4f(vertPos(page.vertexBase,ic),1.0);
 if(a.w<=0.0||b.w<=0.0||c.w<=0.0||a.z<0.0||b.z<0.0||c.z<0.0||a.z>a.w||b.z>b.w||c.z>c.w){return false;}
 let pa=vec2f((a.x/a.w*0.5+0.5)*uni.viewport.x,(1.0-(a.y/a.w*0.5+0.5))*uni.viewport.y);
 let pb=vec2f((b.x/b.w*0.5+0.5)*uni.viewport.x,(1.0-(b.y/b.w*0.5+0.5))*uni.viewport.y);
 let pc=vec2f((c.x/c.w*0.5+0.5)*uni.viewport.x,(1.0-(c.y/c.w*0.5+0.5))*uni.viewport.y);
 let lo=min(pa,min(pb,pc));let hi=max(pa,max(pb,pc));
 return lo.x>=0.0&&lo.y>=0.0&&hi.x<uni.viewport.x&&hi.y<uni.viewport.y&&hi.x-lo.x<=uni.smallThreshold&&hi.y-lo.y<=uni.smallThreshold;
}
@vertex fn vis_vs(@builtin(vertex_index) vertexIndex:u32,@builtin(instance_index) instanceIndex:u32)->VSOut{
 var out:VSOut;
 let pageIndex=drawPage(instanceIndex);
 let page=pages[pageIndex];
 out.instance=pageIndex;out.uv=vec2f(0.0);
 if(vertexIndex>=page.indexCount||computeTriangle(page,vertexIndex/3u)){out.position=vec4f(0.0,0.0,2.0,1.0);out.id=0u;return out;}
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
 if(page.hizSlot!=0xffffffffu&&hizFlags[page.hizSlot]!=0u){out.position=vec4f(0.0,0.0,2.0,1.0);out.id=0u;return out;}
 if(vertexIndex>=page.indexCount||computeTriangle(page,vertexIndex/3u)){out.position=vec4f(0.0,0.0,2.0,1.0);out.id=0u;return out;}
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
 if(!maskKeep(pages[in.instance],in.uv)){discard;}
 out.id=in.id;out.depth=in.position.z;return out;
}
@fragment fn vis_fs(in:VSOut)->@location(0) u32{
 if(!maskKeep(pages[in.instance],in.uv)){discard;}
 return in.id;
}
`;
