export const demoDetailsFr = {
  'composeMatrix4(out, position, quaternion, scale)':
    'composeMatrix4(out, position, quaternion, scale)',
  'column-major; the translation is [12..14]': 'ordre colonne ; la translation occupe [12..14]',
  'scale of B': 'échelle de B',
  'normalMatrix3(out, m) — nine numbers, column-major':
    'normalMatrix3(out, m) — neuf nombres en ordre colonne',
  "the engine's singularity rule": 'règle de singularité du moteur',
  'regular: the inverse-transpose, at the reference bits':
    'régulier : inverse transposée, aux bits de la référence',
  'uniformScaleMatrix4(out, s, center) — the centre stays put':
    'uniformScaleMatrix4(out, s, center) — le centre reste fixe',
  'a and b, seen from above (x to the right, z down)':
    'a et b vus du dessus (x vers la droite, z vers le bas)',
  'its length': 'sa longueur',
  'a, b and their cross product, from above': 'a, b et leur produit vectoriel vus du dessus',
  'Math.sqrt of it — the reference length, bit for bit':
    'sa racine Math.sqrt — longueur de référence, bit pour bit',
  'length of the normalised vector': 'longueur du vecteur normalisé',
  'all three at zero: nothing changes — the divisor is `length || 1`':
    'trois zéros : rien ne change, le diviseur vaut `length || 1`',
  'addScaledVector3(out, a, s) onto (1, 1, 1)': 'addScaledVector3(out, a, s) ajouté à (1, 1, 1)',
  'transformDirectionVector3 — normalised, translation ignored':
    'transformDirectionVector3 — normalisé, translation ignorée',
  'applyMatrix3Vector3 on the 3×3 block — not normalised':
    'applyMatrix3Vector3 sur le bloc 3×3 — non normalisé',
  'the world from above, each box coloured by what the engine decided':
    'le monde vu du dessus, chaque boîte colorée selon la décision du moteur',
  'frustumClipBox — 0 outside, 1 straddling, 2 entirely inside':
    'frustumClipBox — 0 dehors, 1 à cheval, 2 entièrement dedans',
  'clipPlanesFromMatrix — the same planes, unnormalised':
    'clipPlanesFromMatrix — les mêmes plans non normalisés',
  'the tree from above: the root and its children, after one update':
    'l’arbre vu du dessus : la racine et ses enfants après une mise à jour',
  'the child, before and after the root moves':
    'l’enfant avant et après le déplacement de la racine',
  'the child, attached then detached': 'l’enfant, d’abord attaché puis détaché',
  'matrices do not move until the next update, like the reference `add`':
    'les matrices ne bougent qu’à la prochaine mise à jour, comme le `add` de référence',
  'the batch against the unit function it repeats':
    'le lot comparé à la fonction unitaire qu’il répète',
  'frame.view — the inverse of the camera world matrix':
    'frame.view — inverse de la matrice monde de la caméra',
  'DIAGNOSTICS — the engine says which modes it can produce, and why not':
    'DIAGNOSTICS — le moteur indique les modes disponibles et la raison des absences',
  'LOD_QUALITY, as the engine holds it': 'LOD_QUALITY tel que le conserve le moteur',
  'near 1, clear 0': 'proche 1, effacement 0',
  'negative: the transform mirrors, and the draw swaps front and back':
    'négatif : la transformation crée un miroir et le dessin échange faces avant et arrière',
  'null — the adjugate itself is replaced by zero':
    'null — l’adjointe elle-même est remplacée par zéro',
  'singular: the adjugate as-is, so the flattened surface keeps a normal':
    'singulier : l’adjointe telle quelle conserve une normale à la surface aplatie',
  'no finite scale: nine zeros': 'aucune échelle finie : neuf zéros',
  'rejected: every normal of that cluster faces away from the viewer':
    'rejetée : toutes les normales de cette grappe tournent le dos à l’observateur',
  'JS keeps the work: under five samples, or the lead is not a burst':
    'JS conserve le travail : moins de cinq échantillons ou avance trop peu durable',
  'nodeWorldDirection (object, +z)': 'nodeWorldDirection (objet, +z)',
  'nodeWorldDirection (viewer, −z)': 'nodeWorldDirection (observateur, −z)',
  root: 'racine',
  forward: 'avant',
  'the colour': 'la couleur',
  '4 of 4 boxes survive the six planes': 'les 4 boîtes sur 4 franchissent les six plans',
  'Adaptive mode — pixelError 2, anisotropy source, adaptive':
    'Mode adaptatif — pixelError 2, anisotropie source, adaptatif',
  'Balanced quality — pixelError 4, anisotropy source':
    'Qualité équilibrée — pixelError 4, anisotropie source',
  'High quality — pixelError 1, anisotropy maximum':
    'Haute qualité — pixelError 1, anisotropie maximale',
  'Maximum source detail — pixelError 0, anisotropy source':
    'Détail source maximal — pixelError 0, anisotropie source',
  'COLUMN_KIND — every column of the binary manifest, by storage':
    'COLUMN_KIND — chaque colonne du manifeste binaire par stockage',
  'adaptivePixelError(base, speed, radius) on the adaptive preset':
    'adaptivePixelError(base, speed, radius) sur le préréglage adaptatif',
  'an angle at or above π/2 never rejects': 'un angle supérieur ou égal à π/2 ne rejette jamais',
  'after updateNodeMatrixWorld(tree, root)': 'après updateNodeMatrixWorld(tree, root)',
  'available — Attached index pages; missing pages are not drawn; not physical VRAM':
    'disponible — pages d’indices attachées ; les pages absentes ne sont pas dessinées ; ce n’est pas la VRAM physique',
  'available — Filled unique color per submitted triangle, not GL_LINES wireframe':
    'disponible — couleur pleine unique par triangle soumis, sans fil de fer GL_LINES',
  'available — Level-0 clusters vs coarser DAG reductions actually selected this frame':
    'disponible — grappes de niveau 0 face aux réductions du DAG choisies pour cette image',
  'available — Per-cluster screen error projected through the cluster sphere, as the cut uses it':
    'disponible — erreur écran par grappe projetée par sa sphère, telle que la coupe l’emploie',
  'available — Selected visible pages; rejected hierarchy nodes are counted, not drawn':
    'disponible — pages visibles sélectionnées ; les nœuds rejetés sont comptés, pas dessinés',
  'available — Stable primitive/page ID, exact-cluster backend only':
    'disponible — identité primitive/page stable, backend de grappes exactes uniquement',
  'available — glTF materials': 'disponible — matériaux glTF',
  'unavailable — No fragment counter': 'indisponible — aucun compteur de fragments',
  'unavailable — Texture mip residency not instrumented':
    'indisponible — résidence des mips de texture non instrumentée',
  'child 0 world position': 'position monde de l’enfant 0',
  'child 1 world position': 'position monde de l’enfant 1',
  'child 2 world position': 'position monde de l’enfant 2',
  'column 0': 'colonne 0',
  'column 1': 'colonne 1',
  'column 2': 'colonne 2',
  'out = a, aliased': 'out = a, même tampon',
  'clock resolution the measurement rests on (ms)':
    'résolution de l’horloge sur laquelle repose la mesure (ms)',
  'decomposeMatrix4 of that matrix — the round trip':
    'decomposeMatrix4 de cette matrice — l’aller-retour',
  'depth against distance: it falls from 1 at the near plane toward 0 at infinity':
    'profondeur selon la distance : elle va de 1 au plan proche vers 0 à l’infini',
  'depth at the near plane (0.1 m)': 'profondeur au plan proche (0,1 m)',
  'depth at 1 m': 'profondeur à 1 m',
  'depth at 10 m': 'profondeur à 10 m',
  'depth at 100 m': 'profondeur à 100 m',
  'depth at 1000 m': 'profondeur à 1 000 m',
  'depth at 100000 m': 'profondeur à 100 000 m',
  'direction of a (rad)': 'direction de a (rad)',
  'direction of b (rad)': 'direction de b (rad)',
  'radius of what is on screen (m)': 'rayon de ce qui est à l’écran (m)',
  'rotation about y (rad)': 'rotation autour de y (rad)',
  'rotation of A (rad)': 'rotation de A (rad)',
  'the direction (1, 0, 0) under that matrix': 'la direction (1, 0, 0) sous cette matrice',
  'the identity written at offset 16 of one large buffer':
    'l’identité écrite au décalage 16 d’un grand tampon',
  'x of the last node — the sum 0 + 1 + … + (n − 1)':
    'x du dernier nœud — somme 0 + 1 + … + (n − 1)',
  'transformHomogeneousPoint — four components': 'transformHomogeneousPoint — quatre composantes',
  'matrixAtRenderOrigin — the same matrix, applied at the origin':
    'matrixAtRenderOrigin — même matrice appliquée à l’origine',
  'viewToRenderOrigin — the view without its translation':
    'viewToRenderOrigin — vue sans sa translation',
  'worldToRenderOrigin, subtracted first': 'worldToRenderOrigin, soustraction avant écriture',
  before: 'avant',
  after: 'après',
  left: 'gauche',
  right: 'droite',
  top: 'haut',
  bottom: 'bas',
  centre: 'centre',
  surface: 'surface',
  target: 'cible',
  viewer: 'observateur',
  expected: 'attendu',
  orientation: 'orientation',
  products: 'produits',
  nodes: 'nœuds',
};
