/**
 * De quoi la descente est faite, image par image : sa FRONTIÈRE — les nœuds où elle s'arrête, feuille
 * retenue ou sous-arbre rejeté — et les nœuds INTERNES qu'elle traverse pour y arriver.
 *
 * C'est la mesure qui décide de la sélection persistante. Une coupe gardée d'une image à l'autre ne
 * peut économiser que les internes : la frontière, elle, doit être réexaminée à chaque image, puisque
 * l'erreur écran de chaque nœud change dès que la caméra bouge. Dans un arbre à `b` enfants les
 * internes valent `frontière / (b-1)`, et c'est donc le plafond de ce qu'une persistance exacte peut
 * rendre. Un nœud rejeté est seul à pouvoir se refermer sur son parent — les deux rejets sont
 * monotones vers le bas, donc un parent rejeté rejette tout son sous-arbre, et réciproquement un nœud
 * retenu a forcément un parent retenu, qu'il est inutile de tester.
 *
 * Elle compte aussi l'autre moitié du problème : le rejet PAR LE HAUT. Le nœud porte le PLAFOND
 * d'erreur du remplaçant depuis le manifeste — de quoi rejeter un sous-arbre trop fin — et, depuis
 * ce lot, le PLANCHER de l'erreur propre, que `cullingBounds` dérive des pages à la préparation et
 * que `packCullingNodes` range dans le nœud : de quoi rejeter aussi le trop grossier, comme la
 * coupe processeur le fait déjà (`pageSelectionCutNode.ts`). Rien du compilateur, rien du format.
 * Les deux descentes se lancent d'ici pour que la différence soit mesurée, pas déduite.
 */
import { DAG_NODE_FLOATS, type PackedDag } from './gpuDagTypes.ts';
import { dagNodeFloor, dagNodeVerdict, dagViewFrames, projectedError } from './gpuDagOracleMath.ts';
import { bandError, bandSphere, dagRecords, worldOf } from './gpuDagLayout.ts';
import type { SelectionUniforms } from './gpuSelection.ts';

export type Descente = {
  visites: number;
  internes: number;
  frontiereFeuilles: number;
  frontiereRejetees: number;
  candidats: number;
  /** Nœuds que le PLANCHER d'erreur du sous-arbre a rejetés, quand `plancher` est demandé. */
  plancherCoupe: number;
  /** Candidates réellement trop grossières, page par page : ce que le rejet par le haut VISE. */
  tropGrossieres: number;
};

/**
 * La descente du noyau, rejouée au verdict près (`gpuDagLevelWgsl.ts`, `levelStep`), et comptée.
 * Elle ne sert pas à produire une coupe — l'oracle le fait déjà — mais à dire ce que chaque image
 * relit, et sous quelle forme.
 *
 * `plancher` ajoute le rejet PAR LE HAUT et le fait vraiment : l'appelant lance les deux descentes et
 * soustrait. Compter le sous-arbre d'un nœud rejeté aurait surestimé la différence — les rejets plus
 * bas, tronc et plafond, y retirent déjà des pages que la descente n'aurait jamais listées. Le
 * plancher se lit dans le NŒUD EMPAQUETÉ, là où la carte le lit : le rangement est donc mesuré avec.
 */
export function descenteComptee(
  packed: PackedDag,
  uniforms: SelectionUniforms,
  plancher = false,
): Descente {
  const { nodes } = packed;
  const ints = new Uint32Array(nodes.buffer);
  // Le prologue par primitive et le verdict par nœud viennent de `gpuDagOracleMath.ts`, écrits une
  // seule fois pour l'oracle et pour ce comptage : ni l'un ni l'autre ne peut dériver du noyau seul.
  const frames = dagViewFrames(packed, uniforms);
  const compte: Descente = {
    visites: 0,
    internes: 0,
    frontiereFeuilles: 0,
    frontiereRejetees: 0,
    candidats: 0,
    plancherCoupe: 0,
    tropGrossieres: 0,
  };
  const records = dagRecords(packed);
  let file: number[] = [];
  for (const racine of packed.rootNodes) if (racine !== 0xffffffff) file.push(racine);
  while (file.length) {
    const suivante: number[] = [];
    for (const n of file) {
      compte.visites++;
      const enfants = dagNodeVerdict(frames, nodes, ints, n);
      if (enfants < 0) {
        compte.frontiereRejetees++;
        continue;
      }
      // Le PLANCHER d'erreur du sous-arbre, que le nœud ne porte pas encore comme il porte son
      // plafond : aucune de ses grappes n'est assez fine, il n'en sortira pas une candidate.
      if (plancher && dagNodeFloor(frames, nodes, ints, n) > frames.pixelError) {
        compte.plancherCoupe++;
        compte.frontiereRejetees++;
        continue;
      }
      if (enfants) {
        compte.internes++;
        const premier = ints[n * DAG_NODE_FLOATS + 3];
        for (let c = 0; c < enfants; c++) suivante.push(premier + c);
        continue;
      }
      compte.frontiereFeuilles++;
      const at = n * DAG_NODE_FLOATS;
      compte.candidats += ints[at + 14];
      // Ce que le rejet par le haut vise : une grappe dont l'erreur propre dépasse encore le seuil
      // est trop grossière, la coupe ne la prendra pas, et la descente l'a pourtant listée.
      for (let p = 0; p < ints[at + 14]; p++) {
        const i = ints[at + 13] + p,
          w = worldOf(records, i),
          sphere = bandSphere(records, i, 0);
        if (
          projectedError(
            bandError(records, i, 0),
            records.hot[sphere],
            records.hot[sphere + 1],
            records.hot[sphere + 2],
            records.hot[sphere + 3],
            frames.views[w],
            frames.stretches[w],
            frames.focal,
            frames.near,
          ) > frames.pixelError
        )
          compte.tropGrossieres++;
      }
    }
    file = suivante;
  }
  return compte;
}
