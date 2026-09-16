import {
  PAGE_BINDING,
  PAGE_INFO_WGSL,
  PAGE_LOOKUP_WGSL,
  PAGE_MASK_WGSL,
  PAGE_VERTEX_WGSL,
} from './visibilityPageWgsl.ts';
import { ATLAS_SLOTS_WGSL, COLOR_ALPHA_WGSL, atlasTextures } from './webgpuAtlasWgsl.ts';
import { VIS_BINDINGS } from './webgpuBindLayout.ts';

/**
 * Les passes de profondeur des ombres. Le groupe 0 est celui du raster du visibility buffer, à la
 * liaison près : même table de pages, même sélection de clusters, même tampon indirect. Seule la
 * matrice change, et elle vient du groupe 1 avec un décalage dynamique — une face par décalage.
 *
 * L'étage de fragment n'écrit rien : il n'existe que pour écarter. Un matériau à masque d'opacité —
 * feuillage, grille, claustra — projette l'ombre de sa découpe et non la silhouette pleine de son
 * cluster, parce que le test de masque est celui du raster, au caractère près (`PAGE_MASK_WGSL`).
 *
 * Il écarte aussi l'enveloppe de l'émetteur : une lampe qui déclare un rayon n'accepte aucune
 * profondeur d'une surface plus proche de son centre que ce rayon. La règle est la distance
 * euclidienne au centre, donc l'exclusion est exactement la sphère annoncée — un plan proche relevé
 * en aurait retiré un cube. Une lampe sans rayon porte un rayon nul et rien n'est écarté.
 */
export const SHADOW_DEPTH_SHADER = `${PAGE_INFO_WGSL}
${PAGE_BINDING.indices}
${PAGE_BINDING.positions}
${PAGE_BINDING.pages}
${PAGE_BINDING.uniforms}
@group(0) @binding(${VIS_BINDINGS.uv}) var<storage, read> uvs:array<f32>;
${atlasTextures(VIS_BINDINGS.maps, 'maps')}
@group(0) @binding(${VIS_BINDINGS.sampler}) var mapsSampler:sampler;
${PAGE_BINDING.instances}
${PAGE_BINDING.slotOffsets}
@group(0) @binding(${VIS_BINDINGS.colorSlots}) var<storage, read> colorSlots:array<vec2u>;
struct ShadowView{viewProjection:mat4x4f,params:vec4f,emitter:vec4f,}
@group(1) @binding(0) var<uniform> shadow:ShadowView;
struct ShadowOut{@builtin(position) position:vec4f,@location(0) @interpolate(flat) instance:u32,@location(1) uv:vec2f,@location(2) fromEmitter:vec3f,}
${PAGE_LOOKUP_WGSL}
${PAGE_VERTEX_WGSL}
${ATLAS_SLOTS_WGSL}
${COLOR_ALPHA_WGSL}
${PAGE_MASK_WGSL}
@vertex fn shadow_vs(@builtin(vertex_index) vertexIndex:u32,@builtin(instance_index) instanceIndex:u32)->ShadowOut{
 var out:ShadowOut;
 let pageIndex=drawPage(instanceIndex);
 let page=pages[pageIndex];
 out.instance=pageIndex;out.uv=vec2f(0.0);out.fromEmitter=vec3f(0.0);
 if(vertexIndex>=page.indexCount){out.position=vec4f(0.0,0.0,2.0,1.0);return out;}
 let id=indices[page.pageOffset+vertexIndex];
 let vertex=vertPos(page.vertexBase,id);
 // Le produit de out.position n'est pas réassocié : la position monde est composée à part, sinon
 // la profondeur écrite ne serait plus celle d'avant ce lot, au bit près.
 out.position=shadow.viewProjection*page.world*vec4f(vertex,1.0);
 out.fromEmitter=(page.world*vec4f(vertex,1.0)).xyz-shadow.emitter.xyz;
 if((page.flags&4u)!=0u){out.uv=vertUv(page.vertexBase,id);}
 return out;
}
/** N'écrit aucune couleur : la passe n'a pas de cible. Il n'écarte que l'enveloppe et la découpe. */
@fragment fn shadow_fs(in:ShadowOut){
 let radius=shadow.emitter.w;
 if(radius>0.0&&dot(in.fromEmitter,in.fromEmitter)<radius*radius){discard;}
 if(!maskKeep(pages[in.instance],in.uv)){discard;}
}
/** Remet la tranche à la profondeur maximale sans effacer le reste de l'atlas. */
@vertex fn shadow_clear_vs(@builtin(vertex_index) i:u32)->@builtin(position) vec4f{
 return vec4f(f32(i32(i&1u)*4-1),f32(i32(i>>1u)*4-1),1.0,1.0);
}`;
