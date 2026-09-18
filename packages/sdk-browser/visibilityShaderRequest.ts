import { LIGHT_SETTINGS, SHADOW_SLICE_FLOATS } from '../sdk-core/index.ts';
import type { WebgpuLightState } from './webgpuPagesStateLights.ts';
import { quartet } from './visibilityShaderMaps.ts';

/**
 * Ce qu'un pixel opaque demande aux textures virtuelles : UN rang de tuile, posé dans la cible de
 * retour de l'image que les transparents complètent, sous la règle commune de `TILE_REQUEST_WGSL`
 * (phase, carte choisie par la position, repli sur la base). Le pixel n'incrémente rien : pourquoi,
 * et ce que cela coûtait, est dit dans `webgpuTileReduce.ts`.
 *
 * L'ombre du soleil demande ainsi ses tuiles depuis l'écran : la passe de profondeur lit la
 * découpe au niveau de son texel d'ombre mais ne peut rien demander (`webgpuBlendRejetAnticipe.test.ts`).
 * Aux six cartes s'ajoutent donc, pour un pixel de matériau à masque, autant de choix que de
 * cascades : le triangle est projeté dans la cascade, la dérivée de la coordonnée par texel d'ombre
 * en sort — le calcul affine de `dpdx` dans la passe d'ombres — et le rang demandé est celui de ce
 * niveau. Les cascades sont la tranche du soleil telle que l'éclairage la lit
 * (`directShadowWgsl.ts`), recopiée dans l'uniforme de la passe : lier le tampon de tranches lui
 * donnerait un cycle de vie de plus au groupe de liaison — refait quand une ombre naît ou meurt —
 * pour cinq cents octets recopiés par image. Le nuanceur hôte déclare `uni.sun`, `uni.feedback`,
 * `PageInfo`, `vertUv`, `wrapOf` et `TILE_REQUEST_WGSL` avant ce bloc.
 */
const HEADER_WORDS = 24;
/** Mots de l'uniforme de la résolution : l'en-tête, puis la tranche du soleil. */
export const SHADE_UNIFORM_WORDS = HEADER_WORDS + SHADOW_SLICE_FLOATS;
export const SHADE_UNIFORM_BYTES = SHADE_UNIFORM_WORDS * 4;
/** Les choix d'un pixel : six cartes au niveau de la caméra, puis une cascade du soleil chacune. */
const CHOICES = 6 + LIGHT_SETTINGS.sunCascades;

export const SHADE_REQUEST_WGSL = `const SUN_CASCADES:u32=${LIGHT_SETTINGS.sunCascades}u;
/** La dérivée de la coordonnée par texel d'ombre de la cascade \`c\` (xy, zw), ou zéro si la cascade
 *  ne dessine pas ce point. */
fn cascadeGradient(c:u32,w0:vec4f,w1:vec4f,w2:vec4f,dUds:vec2f,dUdt:vec2f,wp:vec4f)->vec4f{
 if(c>=min(SUN_CASCADES,u32(uni.sun.info.x))){return vec4f(0.0);}
 let entry=uni.sun.faces[c];
 if(entry.rect.w<0.5){return vec4f(0.0);}
 let m=entry.viewProjection;
 // Orthographique : w vaut un, la position projetée est déjà normalisée.
 let p=m*wp;
 if(abs(p.x)>1.0||abs(p.y)>1.0||p.z<0.0||p.z>1.0){return vec4f(0.0);}
 let side=0.5*max(uni.sun.info.z,1.0);
 let s0=(m*w0).xy*side;let s1=(m*w1).xy*side;let s2=(m*w2).xy*side;
 let dxb=s1.x-s0.x;let dyb=s1.y-s0.y;let dxc=s2.x-s0.x;let dyc=s2.y-s0.y;let det=dxb*dyc-dxc*dyb;
 if(det==0.0){return vec4f(0.0);}
 let inv=1.0/det;
 return vec4f(dUds*(dyc*inv)+dUdt*(-dyb*inv),dUds*(-dxc*inv)+dUdt*(dxb*inv));
}
/** Le rang de tuile que ce pixel demande, plus un, ou zéro. */
fn shadeRequest(page:PageInfo,pos:vec2f,uv:vec2f,ddx:vec2f,ddy:vec2f,w0:vec4f,w1:vec4f,w2:vec4f,i0:u32,i1:u32,i2:u32,wp:vec4f)->u32{
 if((page.flags&12u)!=12u||!feedbackPhase(pos,uni.feedback)){return 0u;}
 let p=requestPick(pos,${CHOICES}u);
 if(p.sel>=6u&&(page.flags&128u)!=0u){
  let uva=vertUv(page.vertexBase,i0);
  let g=cascadeGradient(p.sel-6u,w0,w1,w2,vertUv(page.vertexBase,i1)-uva,vertUv(page.vertexBase,i2)-uva,wp);
  if(any(g!=vec4f(0.0))){return colorRequestIndex(page.mapIndex,uv,${quartet('base')},g.xy,g.zw,p.next);}
 }
 return mapRequest(p.sel,vec2u(page.mapIndex,page.emissiveIndex),vec4u(page.roughnessIndex,page.metalnessIndex,page.normalIndex,page.aoIndex),uv,page.wrapModes,ddx,ddy,p.next);
}`;

/**
 * Recopie dans l'uniforme la tranche d'ombre de la première lampe directionnelle qui en tient une,
 * telle que le tampon de tranches la porte ; sans elle, une tranche sans face.
 */
export function writeSunSlice(lights: WebgpuLightState, words: Float32Array) {
  const { store, shadows } = lights;
  const sun = words.subarray(HEADER_WORDS, HEADER_WORDS + SHADOW_SLICE_FLOATS);
  if (shadows)
    for (let slot = 0; slot < store.count; slot++) {
      const slice = store.sliceOf(slot);
      if (slice < 0 || store.light(store.ids[slot])?.kind !== 'directional') continue;
      const start = slice * SHADOW_SLICE_FLOATS;
      sun.set(shadows.sliceMirror.subarray(start, start + SHADOW_SLICE_FLOATS));
      return;
    }
  sun.fill(0);
}
