// Le témoin Three.js NU : un rendu naïf de la même scène, sans rien du SDK. Ce module est SERVI à la
// page (montage `/mesure/`) et n'importe que `three`, depuis `/vendor/three/`, donc depuis les
// dépendances de dev du banc — jamais du moteur. Le jour où les adaptateurs Three quittent
// `packages/`, cette page ne bouge pas : c'est ce qui la rend indépendante.
//
// Ce qu'il rend : le glTF source chargé tel quel, `MeshStandardMaterial` de Three, tout dessiné à
// chaque image sans sélection ni diffusion, les lampes du contrat posées en Three. Ce qu'il ne rend
// pas, nommé : ni cascades, ni antialiasing temporel, ni rebond, ni instances, ni niveau de détail.
// La boucle de mesure et ce qu'elle relève sont dans `pageThreeMesure.mjs`.
import { mesurerThree } from './pageThreeMesure.mjs';

/** Une vue, un seuil (ignoré : Three n'a pas de seuil), la capture. Même contrat que `measureView`. */
export const measureView = (options) => mesurerThree(options);
