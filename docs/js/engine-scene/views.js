/**
 * What each diagnostic view of the garden shows, what to try and what to observe.
 * @type {Record<'en' | 'fr', Record<(typeof import('./diagnosticModes.js').DIAGNOSTIC_MODES)[number], [string, string, string]>>}
 */
export const sceneViews = {
  en: {
    beauty: [
      'The finished lit image.',
      'Change light intensity and shadows.',
      'Materials respond while geometry stays identical.',
    ],
    clusters: [
      'One stable colour per selected cluster.',
      'Orbit and move closer to a ring.',
      'The cut replaces coarse clusters with finer ones.',
    ],
    pages: [
      'The attached geometry pages.',
      'Orbit until another side enters view.',
      'Only resident pages can contribute triangles.',
    ],
    wireframe: [
      'One filled colour per submitted triangle.',
      'Zoom into a curved silhouette.',
      'Triangles become finer where the source carries detail.',
    ],
    lod: [
      'Exact leaves against coarser DAG reductions.',
      'Zoom slowly toward the plinth.',
      'The selected level follows projected error.',
    ],
    'screen-error': [
      'Projected error used by the DAG cut.',
      'Move toward and away from the rings.',
      'The value changes with distance and cluster bounds.',
    ],
    materials: [
      'One colour per material class: the pass that resolved the pixel.',
      'Switch from Image: four materials, one colour.',
      'Same features — vertex normals, two-sided, no map — make one class and one pass; maps and cut-outs would add classes.',
    ],
    visibility: [
      'Pages selected as visible this frame.',
      'Orbit behind the sculptures.',
      'Rejected hierarchy nodes are counted, not drawn.',
    ],
  },
  fr: {
    beauty: [
      'L’image finale éclairée.',
      'Changez l’intensité et les ombres.',
      'Les matériaux réagissent sans changer la géométrie.',
    ],
    clusters: [
      'Une couleur stable par grappe sélectionnée.',
      'Tournez puis approchez-vous d’un anneau.',
      'La coupe remplace les grappes grossières par des grappes plus fines.',
    ],
    pages: [
      'Les pages de géométrie attachées.',
      'Tournez jusqu’à faire entrer un autre côté dans le champ.',
      'Seules les pages résidentes peuvent fournir des triangles.',
    ],
    wireframe: [
      'Une couleur pleine par triangle soumis.',
      'Zoomez sur une silhouette courbe.',
      'Les triangles se resserrent là où la source porte du détail.',
    ],
    lod: [
      'Les feuilles exactes face aux réductions du DAG.',
      'Approchez-vous lentement du socle.',
      'Le niveau choisi suit l’erreur projetée.',
    ],
    'screen-error': [
      'L’erreur projetée utilisée par la coupe du DAG.',
      'Avancez et reculez devant les anneaux.',
      'La valeur varie avec la distance et les bornes des grappes.',
    ],
    materials: [
      'Une couleur par classe de matériau : la passe qui a résolu le pixel.',
      'Passez de Image à cette vue : quatre matériaux, une couleur.',
      'Mêmes traits — normales, deux faces, aucune carte — donc une classe et une passe ; cartes et découpes ajouteraient des classes.',
    ],
    visibility: [
      'Les pages déclarées visibles dans cette image.',
      'Tournez derrière les sculptures.',
      'Les nœuds hiérarchiques rejetés sont comptés, pas dessinés.',
    ],
  },
};
