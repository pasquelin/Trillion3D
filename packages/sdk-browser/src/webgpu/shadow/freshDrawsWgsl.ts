import { TRANSMITTANCE_CLEAR_WGSL } from '../../gpu/shadow/transmittance.ts';
import { depthRestoreWgsl } from '../../gpu/core/depthRestoreWgsl.ts';
import { FRESH_CLEAR, FRESH_MOVING_PAIR } from './freshLayout.ts';

/**
 * THE DRAWS OF THE PAGES THE GPU DRAWS ITSELF (#1275), entries of the shadow depth shader
 * (`../../gpu/shadow/shader.ts`), whose casters' corners they place (`shadowVertexIn`). WebGPU has
 * no indirect viewport: a layer's pass covers the whole layer, and each draw carries its layer in
 * its first vertex (`FRESH_LAYER_SHIFT`, `freshLayout.ts`).
 *
 * - `shadow_fresh_clear_vs`: instance `i` is the layer's `i`-th region, its page's square at far —
 *   the depth cleared, or, with `shadow_fresh_clear_fs`, the transmittance layer's page all light.
 * - `shadow_fresh_vs`, `shadow_fresh_blend_vs`: instance `i` is the `i`-th pair the cull kept
 *   (`freshCullWgsl.ts`), a caster row of a region, drawn by that region's view; a pair of another
 *   layer draws nothing. Its clip square is carried onto the page's square of the layer, after the
 *   sun's snap (`freshPlace`), and the fragment keeps the page's texels alone (`freshInPage`).
 * - `shadow_fresh_static_vs`, `shadow_fresh_moving_vs`: the same, of the still casters alone —
 *   the static layer's draw —, or of the moving ones alone, over the page restored from that layer
 *   (`restore_fs`, group 3): as the reference engine renders a new page's static casters into its
 *   static cache and merges them under the dynamic ones, the still geometry is drawn once (#831).
 */
export const SHADOW_FRESH_DRAWS_WGSL = `
/** A GPU page's view as the depth pass reads a face, then its page's clip square in the layer's. */
struct FreshView{view:ShadowView,rect:vec4f,}
/** Clip position \`p\` of \`page\`'s clip square, carried onto its square of the layer's. */
fn freshPlace(page:FreshView,p:vec4f)->vec4f{return vec4f(p.xy*page.rect.zw+page.rect.xy*p.w,p.z,p.w);}
/** The first layer texel of \`view\`'s page. */
fn pageFirst(view:ShadowView)->vec2f{return round(view.params.xy*view.params.w/view.params.z);}
/** Whether layer texel \`at\` lies in \`view\`'s page. */
fn pageHolds(view:ShadowView,at:vec2f)->bool{
 let q=at-pageFirst(view);
 return all(q>=vec2f(0.0))&&all(q<vec2f(view.params.w));
}
/** Whether layer texel \`at\` lies in \`page\`. */
fn freshInPage(page:FreshView,at:vec2f)->bool{return pageHolds(page.view,at);}
/** The \`instance\`-th pair's caster at corner \`vertexIndex\`, if its region lies in the draw's layer. */
/** Which casters a draw keeps (\`freshCaster\`): every one, the still ones, or the moving ones. */
const FRESH_ALL:u32=0u;const FRESH_STILL:u32=1u;const FRESH_MOVING:u32=2u;
fn freshCaster(vertexIndex:u32,instance:u32,blended:bool,keep:u32)->ShadowOut{
 let layer=vertexIndex>>FRESH_LAYER_SHIFT;let word=freshPairs[2u*instance];let k=word&${FRESH_MOVING_PAIR - 1}u;
 let first=freshArgs[FRESH_LAYER_STARTS+layer];
 if(k<first||k>=first+freshArgs[freshDraw(layer,${FRESH_CLEAR}u)+1u]||(keep==FRESH_STILL&&word!=k)||(keep==FRESH_MOVING&&word==k)){return ShadowOut(vec4f(0.0,0.0,2.0,1.0),0u,vec2f(0.0),vec3f(0.0),0u);}
 let page=freshFaces[k];
 var out=shadowVertexIn(page.view,vertexIndex&FRESH_CORNER_MASK,freshPairs[2u*instance+1u],blended);
 out.position=freshPlace(page,out.position);out.region=k;
 return out;
}
@vertex fn shadow_fresh_vs(@builtin(vertex_index) vertexIndex:u32,@builtin(instance_index) instanceIndex:u32)->ShadowOut{
 return freshCaster(vertexIndex,instanceIndex,false,FRESH_ALL);
}
@vertex fn shadow_fresh_static_vs(@builtin(vertex_index) vertexIndex:u32,@builtin(instance_index) instanceIndex:u32)->ShadowOut{
 return freshCaster(vertexIndex,instanceIndex,false,FRESH_STILL);
}
@vertex fn shadow_fresh_moving_vs(@builtin(vertex_index) vertexIndex:u32,@builtin(instance_index) instanceIndex:u32)->ShadowOut{
 return freshCaster(vertexIndex,instanceIndex,false,FRESH_MOVING);
}
@vertex fn shadow_fresh_blend_vs(@builtin(vertex_index) vertexIndex:u32,@builtin(instance_index) instanceIndex:u32)->ShadowOut{
 return freshCaster(vertexIndex,instanceIndex,true,FRESH_ALL);
}
@vertex fn shadow_fresh_clear_vs(@builtin(vertex_index) vertexIndex:u32,@builtin(instance_index) instanceIndex:u32)->@builtin(position) vec4f{
 let layer=vertexIndex>>FRESH_LAYER_SHIFT;let i=vertexIndex&FRESH_CORNER_MASK;
 let rect=freshFaces[freshArgs[FRESH_LAYER_STARTS+layer]+instanceIndex].rect;
 let corner=vec2f(select(-1.0,1.0,((0x32u>>i)&1u)!=0u),select(-1.0,1.0,((0x2cu>>i)&1u)!=0u));
 return vec4f(corner*rect.zw+rect.xy,0.0,1.0);
}
/** A texel of the region's page, as \`shadow_fs\` keeps it. */
@fragment fn shadow_fresh_fs(in:ShadowOut){
 let gx=dpdx(in.uv);let gy=dpdy(in.uv);let page=freshFaces[in.region];
 if(!freshInPage(page,in.position.xy)||!shadowKeepAt(page.view.emitter,in,gx,gy)){discard;}
}
/** A blended caster's texel of \`view\`'s page, at the transmittance layer's half resolution, as
 *  \`shadow_blend_fs\` keeps and tints it: the GPU pages' and the moving groups' (\`groupWgsl.ts\`). */
fn pageBlendTexel(view:ShadowView,in:ShadowOut,front:bool)->vec4f{
 let gx=dpdx(in.uv);let gy=dpdy(in.uv);
 if(!pageHolds(view,in.position.xy*2.0)||!shadowKeepAt(view.emitter,in,gx,gy)||shadowHiddenByOpaque(in.position)){discard;}
 let caster=pages[in.instance];
 if(!volumeBoundary(caster,front)){discard;}
 return blendTransmittance(caster,in.uv,gx,gy,shadowBlendRay(view,in));
}
@fragment fn shadow_fresh_blend_fs(in:ShadowOut,@builtin(front_facing) front:bool)->@location(0) vec4f{
 return pageBlendTexel(freshFaces[in.region].view,in,front);
}
/** The static layer's layer the pass draws in: a page restored from it takes its texels' depth. */
${depthRestoreWgsl(3)}/** A page of the transmittance layer cleared: all the light, and far. */
@fragment fn shadow_fresh_clear_fs()->@location(0) vec4f{return ${TRANSMITTANCE_CLEAR_WGSL};}`;
