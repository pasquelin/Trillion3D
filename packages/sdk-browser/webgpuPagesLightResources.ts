import type { DirectLightResources } from './deferredLightingProgram.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/**
 * Vrai quand l'image doit être éclairée par les lampes déclarées. Faux dans la vue sans éclairage,
 * qu'elle soit demandée par l'hôte ou qu'elle vienne du défaut d'une scène sans lampe : dans les
 * deux cas le programme du contrat n'a rien à faire, et l'albédo brut sort tel quel.
 */
export function wantsContractLighting(rt: WebgpuPagesRuntime) {
  const { store } = rt.lights;
  return store.count > 0 && !store.unlit;
}

const contractResources: DirectLightResources = {};

/**
 * Les ressources du contrat que la passe différée lie, ou rien quand elles n'existent pas. Chacune
 * est rendue telle qu'elle est tenue ailleurs, jamais recopiée ni reconstruite : la passe compare
 * ce qu'on lui donne à ce qu'elle a lié, et ne refait son groupe de liaison que si cela a changé.
 * L'objet est lui aussi réutilisé d'une image à l'autre : la passe n'alloue rien.
 */
export function directLightResources(rt: WebgpuPagesRuntime) {
  const { lights } = rt,
    active = wantsContractLighting(rt);
  contractResources.tiles = active ? lights.tiles?.buffer : undefined;
  contractResources.slices = active ? lights.shadows?.sliceBuffer : undefined;
  contractResources.atlas = active ? lights.shadows?.view : undefined;
  // La grille n'est liée que si elle existe : sans elle, la passe différée compile et lie le
  // programme du contrat seul, exactement celui d'avant le lot du rebond.
  const bounce = active ? rt.bounce.probes : undefined;
  contractResources.bounceGrid = bounce?.uniform;
  contractResources.probes = bounce?.probes;
  // Le proxy de l'ombre lointaine : lié seulement s'il existe, sans quoi les remplacements de zéro
  // du programme du contrat laissent la surface lointaine éclairée comme avant ce lot.
  const sunFar = active ? rt.sunFar.gpu : undefined;
  contractResources.proxy = sunFar?.buffers();
  contractResources.sunFarState = contractResources.proxy ? sunFar?.state : undefined;
  return contractResources;
}
