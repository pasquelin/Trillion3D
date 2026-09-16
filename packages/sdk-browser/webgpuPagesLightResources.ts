import type { DirectLightResources } from './deferredLightingProgram.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/**
 * Vrai quand l'image doit être éclairée par les lampes déclarées. Faux dans la seule vue sans
 * éclairage : `unlit` demandée par l'hôte, ou `auto` sur une scène sans lampe — là, l'albédo brut
 * sort tel quel.
 *
 * Le nombre de lampes n'entre pas dans la décision. Une vue `lit` explicitement demandée éclaire
 * même sans lampe : le contrat sort alors du noir, émissifs conservés, et c'est la réponse juste —
 * une scène qu'aucune source n'éclaire est noire. La faire retomber sur l'albédo rendait une pièce
 * claire quand l'hôte venait d'éteindre toutes ses lampes, sans qu'aucune extinction se voie.
 */
export function wantsContractLighting(rt: WebgpuPagesRuntime) {
  return !rt.lights.store.unlit;
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
  // laissent la surface lointaine éclairée sans ombre portée. Les deux passes qui éclairent lisent
  // cette même résolution, donc elles lient le même tampon et tirent le même rayon.
  contractResources.proxy = active ? rt.sunFar.gpu?.buffer() : undefined;
  return contractResources;
}
