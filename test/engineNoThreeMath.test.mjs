import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const browser = new URL('../packages/sdk-browser/', import.meta.url);

// LA FRONTIÈRE DES CALCULS DU CHARGEMENT ET DE L'EXPLORATEUR (lot M4a).
//
// Les nombres du moteur sont calculés par le socle de `sdk-core`, jamais par la bibliothèque 3D de
// l'hôte : mêmes formules, même ordre d'opérations flottantes, tampons plats, aucune allocation par
// image. Ce que l'hôte POSSÈDE reste à lui — sa scène, sa caméra, ses matériaux — et le moteur a le
// droit de lui demander de mettre son graphe à jour, puis de LIRE `matrixWorld`.
//
// Ce qu'il n'a plus le droit de faire, c'est de CALCULER par elle : recomposer une matrice monde,
// transformer une boîte, extraire une position, inverser, décomposer. Chaque ligne qui en garde une
// est nommée ici avec sa raison. Y ajouter une ligne est une décision, pas un oubli.

/** Les fichiers du lot : chargement d'une scène, explorateur, et leurs contrats. */
const M4A = [
  'awaitBackendPages',
  'backendCommon',
  'backendTypes',
  'explorerBackends',
  'explorerCamera',
  'explorerCameraApi',
  'explorerCapabilities',
  'explorerCapture',
  'explorerDisposeSource',
  'explorerDraw',
  'explorerHostState',
  'explorerLifecycle',
  'explorerOptions',
  'explorerPrepare',
  'explorerRender',
  'explorerRenderFallback',
  'explorerScene',
  'explorerSceneApi',
  'explorerViewportApi',
  'hostSceneLightState',
  'hostSceneWatch',
  'hostWorldBounds',
  'hostWorldMatrices',
  'pageSelectionCollect',
  'pageSelectionHelpers',
  'pagesBackendScenes',
  'replicateInstances',
  'sceneMeshes',
  'webgpuGeometryPrepare',
  'webgpuPagesPrepare',
  'webgpuPagesSetup',
  'webgpuPresentationSetup',
].map((nom) => `${nom}.ts`);

/** Les méthodes et constructeurs de CALCUL de la bibliothèque hôte, remplacés par le socle. */
const CALCULS = [
  '.updateMatrixWorld(',
  '.updateWorldMatrix(',
  '.multiplyMatrices(',
  '.applyMatrix4(',
  '.getWorldPosition(',
  '.getWorldQuaternion(',
  '.getBoundingSphere(',
  '.setFromProjectionMatrix(',
  '.invert(',
  '.determinant(',
  '.decompose(',
  '.compose(',
  '.getNormalMatrix(',
  '.setFromMatrixPosition(',
  'new THREE.Matrix4',
  'new THREE.Vector3',
  'new THREE.Box3',
  'new THREE.Sphere',
];

/** Fichier → ligne exacte → pourquoi cette ligne est une frontière de l'hôte et non un calcul. */
const FRONTIERE = {
  'hostWorldMatrices.ts': {
    'node.updateMatrixWorld(true);':
      'la frontière elle-même : la scène est à l’hôte, sa mise à jour aussi',
    'node.updateWorldMatrix(true, false);':
      'la même frontière, pour la seule chaîne d’ancêtres d’un nœud',
  },
  'explorerCamera.ts': {
    'const bounds = new THREE.Box3(':
      '`explorer.bounds` est rendu à l’hôte : le banc y calcule sa trajectoire',
    'new THREE.Vector3(flat[0], flat[1], flat[2]),': 'borne basse de cette boîte rendue à l’hôte',
    'new THREE.Vector3(flat[3], flat[4], flat[5]),': 'borne haute de cette boîte rendue à l’hôte',
    'const center = new THREE.Vector3(framingSphere[0], framingSphere[1], framingSphere[2]);':
      '`explorer.center` est rendu à l’hôte, et ses contrôles veulent une cible',
    'const homeOffset = new THREE.Vector3().fromArray(framing.offset);':
      'le décalage de la pose d’origine, que `resetHome` réécrit dans la caméra de l’hôte',
    'camera.updateMatrixWorld();': 'l’hôte POSE sa caméra ; la pose écrite est résolue une fois',
  },
  'explorerCameraApi.ts': {
    'camera.updateMatrixWorld();': 'retour à la pose d’origine : la caméra de l’hôte, reposée',
  },
  'explorerHostState.ts': {
    'const lookAtTarget = new THREE.Vector3().copy(center);':
      'la cible que l’hôte relit et réécrit entre deux poses',
    'camera.updateMatrixWorld();': 'l’hôte restaure une pose enregistrée dans sa caméra',
  },
  'explorerViewportApi.ts': {
    'const captureTarget = new THREE.Vector3();':
      'cible reprise d’une capture à l’autre : posée, jamais allouée par appel',
    'view.updateMatrixWorld();': 'la vue de capture est une caméra de l’hôte, posée puis résolue',
  },
};

/** Les lignes qui déclenchent un motif, commentaires exclus : un commentaire cite, il ne calcule pas. */
const lignesFautives = (texte) =>
  texte
    .split('\n')
    .filter((ligne) => !/^\s*(?:\/\/|\*|\/\*)/.test(ligne))
    .map((ligne) => ligne.trim())
    .filter((ligne) => CALCULS.some((motif) => ligne.includes(motif)));

test('le chargement et l’explorateur ne calculent plus par la bibliothèque de l’hôte', async () => {
  const fuites = [],
    inutiles = [];
  for (const file of M4A) {
    const texte = await readFile(new URL(file, browser), 'utf8');
    const permis = FRONTIERE[file] ?? {},
      vues = new Set();
    for (const ligne of lignesFautives(texte)) {
      if (permis[ligne]) vues.add(ligne);
      else fuites.push(`${file} calcule par la bibliothèque de l’hôte : ${ligne}`);
    }
    for (const ligne of Object.keys(permis))
      if (!vues.has(ligne))
        inutiles.push(`${file} déclare une frontière qui n’existe plus : ${ligne}`);
  }
  assert.deepEqual(fuites, [], `frontière déclarée dans ${import.meta.url}`);
  assert.deepEqual(inutiles, [], 'une frontière disparue se retire de la liste');
});

test('chaque fichier du lot M4a existe encore sous son nom', async () => {
  for (const file of M4A)
    await assert.doesNotReject(
      readFile(new URL(file, browser), 'utf8'),
      `${file} a été renommé ou supprimé : la liste du lot M4a doit suivre`,
    );
});

// LA MATRICE QUE L'HÔTE ÉCRIT EST RECOPIÉE, JAMAIS CALCULÉE.
//
// `RenderBackend.addInstance/updateInstance`, `PageRec.matrix` et `ClusterRoot.world` restent des
// objets de la bibliothèque hôte : c'est l'hôte qui les écrit, et les aplatir l'obligerait à changer
// ce qu'il tend. Ce que le moteur en fait est fermé : il lit les seize flottants de `.elements` et
// les donne au socle. Aucune multiplication, inversion, décomposition ni recopie par la bibliothèque
// hôte ne survit hors des témoins et des lignes nommées ici, qui ÉCRIVENT une pose de l'hôte.
const CALCULE_UNE_MATRICE =
  /\.(?:matrix|matrixWorld|world|transform|normalMatrix)\??\.(?:clone|copy|multiply|premultiply|multiplyMatrices|invert|decompose|compose|applyMatrix4|transformDirection|setFromMatrixPosition|extractRotation|transpose|setPosition|makeRotationFromQuaternion)\s*\(/;

/** Les témoins sont écrits avec la bibliothèque hôte : la règle ne les vise pas. */
const TEMOINS =
  /^(?:referenceBackend|threeLod|threeBounds|exactPages|autonomous|clusterBatch|blendCopyMesh|comparison|lightingObservation)/;

/** Fichier → ligne exacte → pourquoi elle POSE une matrice de l'hôte au lieu d'en calculer une. */
const ECRIT_L_HOTE = {
  'cameraWorld.ts': {
    'into.matrix.copy(camera.matrixWorld);':
      'la copie détachée d’une caméra hôte : elle POSE la pose monde, elle ne la calcule pas',
    'into.matrixWorld.copy(into.matrix);': 'la même copie, résolue sur place faute de parent',
  },
};

test('le moteur lit la matrice de l’hôte, il ne calcule pas avec', async () => {
  const fichiers = (await readdir(browser)).filter(
    (nom) => nom.endsWith('.ts') && !nom.endsWith('.test.ts'),
  );
  assert.ok(fichiers.length > 100, 'le paquet navigateur doit être trouvé');
  const fuites = [],
    inutiles = [];
  for (const file of fichiers) {
    if (TEMOINS.test(file)) continue;
    const permis = ECRIT_L_HOTE[file] ?? {},
      vues = new Set();
    const texte = await readFile(new URL(file, browser), 'utf8');
    for (const ligne of texte
      .split('\n')
      .filter((l) => !/^\s*(?:\/\/|\*|\/\*)/.test(l) && CALCULE_UNE_MATRICE.test(l))
      .map((l) => l.trim())) {
      if (permis[ligne]) vues.add(ligne);
      else fuites.push(`${file} calcule une matrice de l’hôte : ${ligne}`);
    }
    for (const ligne of Object.keys(permis))
      if (!vues.has(ligne))
        inutiles.push(`${file} déclare une écriture qui n’existe plus : ${ligne}`);
  }
  assert.deepEqual(fuites, [], `frontière déclarée dans ${import.meta.url}`);
  assert.deepEqual(inutiles, [], 'une écriture disparue se retire de la liste');
});
