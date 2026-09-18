import { LIGHT_SETTINGS, SHADOW_SLICE_FLOATS } from '../sdk-core/index.ts';
import type { WebgpuLightState } from './webgpuPagesStateLights.ts';
import { WRAP_MAP } from './visibilityWrapModes.ts';

/**
 * Ce que l'ombre du soleil demande aux textures virtuelles, dit par l'écran.
 *
 * La passe de profondeur des ombres lit la découpe d'un feuillage au niveau que son texel d'ombre
 * demande (`maskAlpha`, `webgpuTileWgsl.ts`), mais elle ne peut rien demander : écrire en mémoire
 * depuis son étage de fragments lui coûterait son rejet anticipé (`webgpuBlendRejetAnticipe.test.ts`).
 * C'est la résolution matérielle qui demande pour elle, comme la référence marque ses pages d'ombre
 * depuis le tampon de profondeur de la vue : pour un pixel de matériau à masque dont c'est la phase,
 * et pour chaque cascade dont la carte contient le point, elle projette le triangle dans la cascade,
 * en tire la dérivée de la coordonnée par texel d'ombre — le même calcul affine que `dpdx` dans la
 * passe d'ombres — et compte la tuile de ce niveau.
 *
 * Les cascades sont la tranche du soleil telle que l'éclairage la lit (`directShadowWgsl.ts`) — même
 * structure `ShadowSlice`, mêmes règles : `rect.w` pour une face jamais dessinée, `info.x` faces,
 * `info.z` côté —, recopiée mot pour mot dans l'uniforme de la passe à chaque image. Une copie, pas
 * une seconde géométrie : la passe matériaux lie déjà les huit tampons de stockage que WebGPU
 * garantit, et le tampon de tranches ne peut pas s'y ajouter. Sans soleil à ombre, la tranche
 * recopiée n'a aucune face et rien n'est demandé. Le nuanceur hôte déclare `uni.sun`, `PageInfo`,
 * `vertUv` et le retour d'image (`TILE_FEEDBACK_WGSL`) avant ce bloc.
 */
const HEADER_WORDS = 24;
/** Mots de l'uniforme de la résolution : l'en-tête, puis la tranche du soleil. */
export const SHADE_UNIFORM_WORDS = HEADER_WORDS + SHADOW_SLICE_FLOATS;
export const SHADE_UNIFORM_BYTES = SHADE_UNIFORM_WORDS * 4;

export const SHADE_SHADOW_REQUEST_WGSL = `const SUN_CASCADES:u32=${LIGHT_SETTINGS.sunCascades}u;
/** Les tuiles de la carte de base que l'ombre de ce pixel lit, dans chaque cascade qui le dessine :
 *  \`s\` et \`w\` sont l'en-tête et la coordonnée déjà ramenée de la carte, \`wp\` le point monde. */
fn shadowRequests(page:PageInfo,s:TileSlot,w:vec2f,w0:vec4f,w1:vec4f,w2:vec4f,i0:u32,i1:u32,i2:u32,wp:vec4f){
 if((page.flags&128u)==0u){return;}
 let side=max(uni.sun.info.z,1.0);
 let uva=vertUv(page.vertexBase,i0);let dUds=vertUv(page.vertexBase,i1)-uva;let dUdt=vertUv(page.vertexBase,i2)-uva;
 for(var c=0u;c<min(SUN_CASCADES,u32(uni.sun.info.x));c++){
  let entry=uni.sun.faces[c];
  if(entry.rect.w<0.5){continue;}
  let m=entry.viewProjection;
  // Orthographique : w vaut un, la position projetée est déjà normalisée.
  let p=m*wp;
  if(abs(p.x)>1.0||abs(p.y)>1.0||p.z<0.0||p.z>1.0){continue;}
  let s0=(m*w0).xy*0.5*side;let s1=(m*w1).xy*0.5*side;let s2=(m*w2).xy*0.5*side;
  let dxb=s1.x-s0.x;let dyb=s1.y-s0.y;let dxc=s2.x-s0.x;let dyc=s2.y-s0.y;let det=dxb*dyc-dxc*dyb;
  if(det==0.0){continue;}
  let inv=1.0/det;
  let ddx=dUds*(dyc*inv)+dUdt*(-dyb*inv);let ddy=dUds*(-dxc*inv)+dUdt*(dxb*inv);
  colorFeedbackAt(s,w,ddx,ddy);
 }
}`;

/** Le quartet d'adressage de la carte de base, celui que la découpe applique. */
export const SHADOW_REQUEST_WRAP = `wrapOf(page.wrapModes,${WRAP_MAP.base}u)`;

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
