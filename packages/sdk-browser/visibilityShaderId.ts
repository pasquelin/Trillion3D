import {
  PAGE_BINDING,
  PAGE_INFO_WGSL,
  PAGE_LOOKUP_WGSL,
  PAGE_MASK_WGSL,
  PAGE_VERTEX_WGSL,
} from './visibilityPageWgsl.ts';
import { ATLAS_SLOTS_WGSL, COLOR_ALPHA_WGSL, atlasTextures } from './webgpuAtlasWgsl.ts';
import { VIS_BINDINGS } from './webgpuBindLayout.ts';
import { HIZ_REJECTED_WGSL } from './gpuPartitionContract.ts';
import { COMPUTE_ALL, COMPUTE_TAKES_WGSL } from './gpuRasterContract.ts';

/**
 * Le raster matériel du tampon de visibilité, producteur de l'image opaque et masquée. Sous le
 * partage de la référence (`uni.computeSpan`), il laisse au raster de calcul les triangles que
 * celui-ci prend — le même prédicat, lu sur les mêmes sommets — et dessine tous les autres ; à
 * zéro, il dessine toute la coupe sans lire un sommet de plus.
 */
export const VIS_SHADER = `${PAGE_INFO_WGSL}
${PAGE_BINDING.indices}
${PAGE_BINDING.positions}
${PAGE_BINDING.pages}
@group(0) @binding(${VIS_BINDINGS.flags}) var<storage, read> hizFlags:array<u32>;
${HIZ_REJECTED_WGSL}
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
${PAGE_MASK_WGSL}
${COMPUTE_TAKES_WGSL}
/** Vrai quand le matériel ne dessine pas ce sommet : hors de la page, ou d'un triangle que le
 *  raster de calcul prend. Sans partage, ni sous \`COMPUTE_ALL\`, aucun sommet de plus n'est lu. */
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
 if(!maskKeep(pages[in.instance],in.uv)){discard;}
 out.id=in.id;out.depth=in.position.z;return out;
}
@fragment fn vis_fs(in:VSOut)->@location(0) u32{
 if(!maskKeep(pages[in.instance],in.uv)){discard;}
 return in.id;
}
`;
