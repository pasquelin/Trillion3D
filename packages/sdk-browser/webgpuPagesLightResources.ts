import type { DirectLightResources } from './deferredLightingProgram.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';
import type { WebgpuLightState } from './webgpuPagesStateLights.ts';

const EVERYWHERE_MIN = [-1e30, -1e30, -1e30],
  EVERYWHERE_MAX = [1e30, 1e30, 1e30];

/**
 * Une tuile de couleur de plus est résidente : la découpe alpha que les cartes d'ombre lisent vient
 * de changer pour toute surface qui porte cette texture, et une carte dessinée au niveau d'avant
 * décrirait un feuillage qui n'est plus celui de l'image. Toutes les pages repartent donc en
 * attente, sous le budget ordinaire de l'étape Ombres. Sans ce signal, deux exécutions identiques
 * rendaient deux ombres différentes, selon le moment où chaque page avait été dessinée.
 */
export function shadowsFollowTextures(lights: WebgpuLightState) {
  lights.plan.worldChanged(EVERYWHERE_MIN, EVERYWHERE_MAX);
}

/**
 * Serves tiles requested by the previous image, except during a pose barrier: the shadow
 * drain replays the image without admitting new ones. An arriving tile invalidates every
 * map (`shadowsFollowTextures`) and the queue would never empty (#25).
 */
export function pumpResidentTiles(
  textures: { pump: (frame: number) => void } | undefined,
  frame: number,
  converging: boolean,
) {
  if (!converging) textures?.pump(frame);
}

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
