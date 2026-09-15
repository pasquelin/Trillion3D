import {
  PAGE_BINDING,
  PAGE_INFO_WGSL,
  PAGE_LOOKUP_WGSL,
  PAGE_MASK_WGSL,
  PAGE_PREVIEW_BINDING,
  PAGE_VERTEX_WGSL,
} from './visibilityPageWgsl.ts';

/**
 * Les passes de profondeur des ombres. Le groupe 0 est celui du raster du visibility buffer, à la
 * liaison près : même table de pages, même sélection de clusters, même tampon indirect. Seule la
 * matrice change, et elle vient du groupe 1 avec un décalage dynamique — une face par décalage.
 *
 * L'étage de fragment n'écrit rien : il n'existe que pour la découpe. Un matériau à masque
 * d'opacité — feuillage, grille, claustra — projette l'ombre de sa découpe et non la silhouette
 * pleine de son cluster, parce que le test de masque est celui du raster, au caractère près
 * (`PAGE_MASK_WGSL`). Un cluster sans masque sort du fragment sans rien lire.
 */
export const SHADOW_DEPTH_SHADER = `${PAGE_INFO_WGSL}
${PAGE_BINDING.indices}
${PAGE_BINDING.positions}
${PAGE_BINDING.pages}
${PAGE_BINDING.uniforms}
@group(0) @binding(5) var<storage, read> uvs:array<f32>;
@group(0) @binding(6) var maps:texture_2d_array<f32>;
@group(0) @binding(7) var mapsSampler:sampler;
${PAGE_BINDING.instances}
${PAGE_BINDING.slotOffsets}
${PAGE_PREVIEW_BINDING}
struct ShadowView{viewProjection:mat4x4f,params:vec4f,}
@group(1) @binding(0) var<uniform> shadow:ShadowView;
struct ShadowOut{@builtin(position) position:vec4f,@location(0) @interpolate(flat) instance:u32,@location(1) uv:vec2f,}
${PAGE_LOOKUP_WGSL}
${PAGE_VERTEX_WGSL}
${PAGE_MASK_WGSL}
@vertex fn shadow_vs(@builtin(vertex_index) vertexIndex:u32,@builtin(instance_index) instanceIndex:u32)->ShadowOut{
 var out:ShadowOut;
 let pageIndex=drawPage(instanceIndex);
 let page=pages[pageIndex];
 out.instance=pageIndex;out.uv=vec2f(0.0);
 if(vertexIndex>=page.indexCount){out.position=vec4f(0.0,0.0,2.0,1.0);return out;}
 let id=indices[page.pageOffset+vertexIndex];
 out.position=shadow.viewProjection*page.world*vec4f(vertPos(page.vertexBase,id),1.0);
 if((page.flags&4u)!=0u){out.uv=vertUv(page.vertexBase,id);}
 return out;
}
/** N'écrit aucune couleur : la passe n'a pas de cible. Il ne sert qu'à écarter la découpe. */
@fragment fn shadow_fs(in:ShadowOut){
 if(!maskKeep(pages[in.instance],in.uv)){discard;}
}
/** Remet la tranche à la profondeur maximale sans effacer le reste de l'atlas. */
@vertex fn shadow_clear_vs(@builtin(vertex_index) i:u32)->@builtin(position) vec4f{
 return vec4f(f32(i32(i&1u)*4-1),f32(i32(i>>1u)*4-1),1.0,1.0);
}`;
