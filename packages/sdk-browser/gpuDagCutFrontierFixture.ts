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
 */
import { frustumExcludesBox, frustumPlanesToLocal } from '../sdk-core/index.ts';
import { flatHierarchy } from './gpuDagHierarchy.ts';
import { DAG_NODE_FLOATS, type DagRoot, type PackedDag } from './gpuDagTypes.ts';
import { dagScratch, projectedError } from './gpuDagOracleMath.ts';
import type { SelectionUniforms } from './gpuSelection.ts';

/** Une page de niveau `level`, posée sur une grille, avec la bande d'erreur de son remplaçant. */
function page(level: number, i: number, cote: number, etendue: number) {
  const rayon = etendue / cote;
  const cx = ((i % cote) / cote - 0.5) * etendue * 2,
    cy = (Math.floor(i / cote) / cote - 0.5) * etendue * 2;
  const parent = level + 1 < 8 ? 2 ** (level + 1) * 0.01 : null;
  return {
    url: `n${level}-${i}`,
    level,
    min: [cx - rayon, cy - rayon, -rayon],
    max: [cx + rayon, cy + rayon, rayon],
    sphere: [cx, cy, 0, rayon],
    lodError: 2 ** level * 0.01,
    parentError: parent,
    parentSphere: parent === null ? null : [cx, cy, 0, rayon * 2],
  };
}

/**
 * La hiérarchie du rangement, dont le plafond d'erreur est rempli : `flatHierarchy` le laisse à -1,
 * ce qui interdit tout élagage par l'erreur. Les nœuds sont numérotés par niveaux, donc les enfants
 * suivent leur parent : un parcours à rebours suffit à remonter le maximum du sous-arbre.
 */
function culling(pages: ReturnType<typeof page>[]) {
  const { nodes, stride } = flatHierarchy(pages);
  const count = nodes.length / stride;
  for (let n = count - 1; n >= 0; n--) {
    const base = n * stride;
    let plafond = 0;
    const enfants = nodes[base + 12];
    for (let c = 0; c < enfants; c++) {
      const fils = nodes[(nodes[base + 11] + c) * stride + 10];
      plafond = fils < 0 || plafond < 0 ? -1 : Math.max(plafond, fils);
    }
    for (let p = 0; p < nodes[base + 14]; p++) {
      const erreur = pages[nodes[base + 13] + p].parentError;
      plafond = erreur === null || plafond < 0 ? -1 : Math.max(plafond, erreur);
    }
    nodes[base + 10] = plafond;
  }
  return { nodes, stride };
}

/** `niveaux` étages de détail, chacun deux fois moins peuplé que le précédent. */
export function scenePages(feuilles: number, niveaux: number) {
  const pages: ReturnType<typeof page>[] = [];
  for (let level = niveaux - 1; level >= 0; level--) {
    const compte = Math.max(1, feuilles >> level),
      cote = Math.ceil(Math.sqrt(compte));
    for (let i = 0; i < compte; i++) pages.push(page(level, i, cote, 3));
  }
  return pages;
}

/** Les poses de la scène. La matrice monde vient de l'appelant : ce module ne connaît pas la
 *  bibliothèque de l'hôte, et la liste fermée de `test/engineNoThree.test.mjs` le lui interdit. */
export function sceneRoots(
  pages: ReturnType<typeof page>[],
  mondes: DagRoot['world'][],
): DagRoot[] {
  const cull = culling(pages);
  return mondes.map((world) => ({ world, pages: pages as DagRoot['pages'], culling: cull }));
}

export type Descente = {
  visites: number;
  internes: number;
  frontiereFeuilles: number;
  frontiereRejetees: number;
  candidats: number;
};

/**
 * La descente du noyau, rejouée au verdict près (`gpuDagLevelWgsl.ts`, `levelStep`), et comptée.
 * Elle ne sert pas à produire une coupe — l'oracle le fait déjà — mais à dire ce que chaque image
 * relit, et sous quelle forme.
 */
export function descenteComptee(packed: PackedDag, uniforms: SelectionUniforms): Descente {
  const { nodes, worlds, worldStretch } = packed;
  const ints = new Uint32Array(nodes.buffer);
  const stretchCamera = uniforms.cameraStretch ?? 1,
    focal = Math.max(uniforms.pixelScale[0], uniforms.pixelScale[1]),
    near = uniforms.near,
    seuil = uniforms.pixelError;
  const { view, world, viewMatrix } = dagScratch;
  view.fromArray(uniforms.view);
  const plans: Float64Array[] = [],
    vues: number[][] = [],
    etirements: number[] = [];
  for (let w = 0; w < packed.worldCount; w++) {
    world.fromArray(worlds.subarray(w * 16, w * 16 + 16));
    const local = new Float64Array(24);
    frustumPlanesToLocal(local, uniforms.planes, world.elements);
    plans.push(local);
    viewMatrix.multiplyMatrices(view, world);
    vues.push([...viewMatrix.elements]);
    etirements.push(worldStretch[w] * stretchCamera);
  }
  const compte: Descente = {
    visites: 0,
    internes: 0,
    frontiereFeuilles: 0,
    frontiereRejetees: 0,
    candidats: 0,
  };
  let file: number[] = [];
  for (const racine of packed.rootNodes) if (racine !== 0xffffffff) file.push(racine);
  while (file.length) {
    const suivante: number[] = [];
    for (const n of file) {
      compte.visites++;
      const base = n * DAG_NODE_FLOATS,
        w = ints[base + 12];
      if (
        frustumExcludesBox(
          plans[w],
          nodes[base],
          nodes[base + 1],
          nodes[base + 2],
          nodes[base + 4],
          nodes[base + 5],
          nodes[base + 6],
        )
      ) {
        compte.frontiereRejetees++;
        continue;
      }
      const plafond = nodes[base + 7];
      if (
        plafond >= 0 &&
        projectedError(
          plafond,
          nodes[base + 8],
          nodes[base + 9],
          nodes[base + 10],
          nodes[base + 11],
          vues[w],
          etirements[w],
          focal,
          near,
        ) <= seuil
      ) {
        compte.frontiereRejetees++;
        continue;
      }
      const enfants = ints[base + 15];
      if (enfants) {
        compte.internes++;
        for (let c = 0; c < enfants; c++) suivante.push(ints[base + 3] + c);
        continue;
      }
      compte.frontiereFeuilles++;
      compte.candidats += ints[base + 14];
    }
    file = suivante;
  }
  return compte;
}
