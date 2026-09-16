/**
 * Erreur écran du noyau de sélection du DAG, en WGSL : la borne `screenErrorBound` de sdk-core
 * (preuve au site de la formule, `projectionOracles.ts`), mêmes opérandes et même ordre, en f32.
 * Miroir CPU : `projectedError` de `gpuDagOracleMath.ts`. Les déclarations de module WGSL se
 * lisent dans n'importe quel ordre : ce morceau s'ajoute au texte de `gpuDagShader.ts`.
 *
 * `REFERENCE_ERROR` est le commutateur d'EXPÉRIENCE décrit dans `screenErrorVariant.ts` : une
 * constante de module, fausse dans le texte livré — le nuanceur par défaut est donc inchangé, la
 * branche étant éliminée à la compilation. `withScreenErrorVariant` la met à vrai pour la campagne
 * qui mesure la métrique de la référence externe, miroir exact de `referenceScreenError`.
 */
import type { ScreenErrorVariant } from '../sdk-core/index.ts';

/** La déclaration que `withScreenErrorVariant` retourne, écrite une fois pour les deux. */
export const REFERENCE_ERROR_DECL = 'const REFERENCE_ERROR:bool=false;';

export const DAG_ERROR_WGSL = `
${REFERENCE_ERROR_DECL}
/** Majorant du déplacement écran de tout point de la sphère déplacé d'au plus \`error\` : profondeur
 *  minimale m, distance a l'axe l, rayon et erreur etires rho et delta,
 *  E = (delta*f/m)*(sqrt(m*m+(l+rho)^2)/(m-delta)) ; plan proche atteint : INF.
 *  Sous \`REFERENCE_ERROR\`, la projection simple de la reference externe : delta*f/profondeur. */
fn projected(error:f32,sphere:vec4f,e:mat4x4f,stretch:f32,focal:f32)->f32{
 if(error==0.0){return 0.0;}
 if(!(error>0.0)){return INF;}
 let v=(e*vec4f(sphere.xyz,1.0)).xyz;
 if(REFERENCE_ERROR){
  let depth=-v.z;
  if(!(depth>uni.near)){return INF;}
  let delta=error*stretch;
  return (delta*focal)/depth;
 }
 let reach=sphere.w*stretch;let shift=error*stretch;
 let nearest=-v.z-reach;let closest=nearest-shift;let side=sqrt(v.x*v.x+v.y*v.y)+reach;
 if(!(closest>uni.near)){return INF;}
 let slant=sqrt(nearest*nearest+side*side);
 if(!(slant>=nearest&&slant<INF)){return INF;}
 return ((shift*focal)/nearest)*(slant/closest);
}
fn selects(cluster:Cluster,e:mat4x4f,stretch:f32,focal:f32,threshold:f32)->bool{
 if(projected(cluster.lodError,cluster.sphere,e,stretch,focal)>threshold){return false;}
 return projected(cluster.parentError,cluster.parentSphere,e,stretch,focal)>threshold;
}
fn focalPixels()->f32{return max(uni.pixelScale.x,uni.pixelScale.y);}
`;

/**
 * Le texte du nuanceur pour une variante donnée : rendu tel quel pour la nôtre, une seule
 * déclaration retournée pour celle de la référence externe. Rien d'autre ne change de caractère.
 */
export function withScreenErrorVariant(code: string, variant: ScreenErrorVariant): string {
  if (variant !== 'reference') return code;
  const at = code.indexOf(REFERENCE_ERROR_DECL);
  if (at < 0) throw new Error('declaration REFERENCE_ERROR absente du nuanceur');
  return (
    code.slice(0, at) +
    'const REFERENCE_ERROR:bool=true;' +
    code.slice(at + REFERENCE_ERROR_DECL.length)
  );
}
