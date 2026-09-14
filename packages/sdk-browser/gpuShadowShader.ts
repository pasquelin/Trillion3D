import {
  PAGE_BINDING,
  PAGE_INFO_WGSL,
  PAGE_LOOKUP_WGSL,
  PAGE_VERTEX_WGSL,
} from './visibilityPageWgsl.ts';

/**
 * Les passes de profondeur des ombres. Le groupe 0 est celui du raster du visibility buffer, à la
 * liaison près : même table de pages, même sélection de clusters, même tampon indirect. Seule la
 * matrice change, et elle vient du groupe 1 avec un décalage dynamique — une face par décalage.
 *
 * Il n'y a pas d'étage de fragment : la passe n'écrit que de la profondeur. Approximation nommée —
 * un matériau à masque d'opacité projette la silhouette entière de son cluster, jamais ses trous.
 */
export const SHADOW_DEPTH_SHADER = `${PAGE_INFO_WGSL}
${PAGE_BINDING.indices}
${PAGE_BINDING.positions}
${PAGE_BINDING.pages}
${PAGE_BINDING.uniforms}
${PAGE_BINDING.instances}
${PAGE_BINDING.slotOffsets}
struct ShadowView{viewProjection:mat4x4f,params:vec4f,}
@group(1) @binding(0) var<uniform> shadow:ShadowView;
${PAGE_LOOKUP_WGSL}
${PAGE_VERTEX_WGSL}
@vertex fn shadow_vs(@builtin(vertex_index) vertexIndex:u32,@builtin(instance_index) instanceIndex:u32)->@builtin(position) vec4f{
 let page=pages[drawPage(instanceIndex)];
 if(vertexIndex>=page.indexCount){return vec4f(0.0,0.0,2.0,1.0);}
 let id=indices[page.pageOffset+vertexIndex];
 return shadow.viewProjection*page.world*vec4f(vertPos(page.vertexBase,id),1.0);
}
/** Remet la tranche à la profondeur maximale sans effacer le reste de l'atlas. */
@vertex fn shadow_clear_vs(@builtin(vertex_index) i:u32)->@builtin(position) vec4f{
 return vec4f(f32(i32(i&1u)*4-1),f32(i32(i>>1u)*4-1),1.0,1.0);
}`;
