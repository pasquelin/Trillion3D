import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const browser = new URL('../packages/sdk-browser/', import.meta.url);

// LA LISTE FERMÉE DES FICHIERS DE `sdk-browser` QUI ONT LE DROIT D'IMPORTER LA BIBLIOTHÈQUE HÔTE.
//
// La règle est inversée : ce n'est plus une liste de fichiers surveillés, c'est la liste de TOUT ce
// qui peut encore nommer `three`. Un fichier hors liste ne l'importe pas — `import type` compris,
// parce qu'un type de calcul dans une signature suffit à replacer la bibliothèque de l'hôte au
// milieu d'un nombre que le moteur calcule. Trois familles seulement y ont droit.
//
//  1. LES MOTEURS TÉMOINS. Ils sont écrits avec la bibliothèque hôte, et c'est leur fonction : ils
//     sont la référence contre laquelle le moteur est comparé, image par image. Les réécrire
//     supprimerait la comparaison.
//  2. LES FRONTIÈRES DE L'HÔTE. La scène, la caméra, le renderer, les lampes appartiennent à
//     l'hôte : quelqu'un doit les créer, les lire, les reposer. Ces fichiers-là le font, une fois,
//     et rendent au moteur des tampons plats ou des structures qu'il possède.
//  3. LES RESSOURCES DE L'HÔTE. Matériaux, textures, géométries, maillages, couleurs, constantes de
//     face et d'enroulement : des objets que le moteur consulte sans jamais calculer avec.
//
// Y ajouter une ligne est une décision, pas un oubli ; en retirer une qui ne sert plus aussi — le
// second test échoue sur une ligne morte. Le contrat de pose caméra, lui, vit dans `cameraWorld.ts`
// et `test/engineStructure.test.mjs` ; la frontière de calcul du chargement, dans
// `test/engineNoThreeMath.test.mjs`.
const AUTORISES = {
  // 1. Moteurs témoins.
  autonomousGeometry: 'témoin autonome : il monte ses maillages avec la bibliothèque hôte',
  autonomousInstances: 'témoin autonome : ses instances portent des matrices de l’hôte',
  autonomousPages: 'témoin autonome : ses pages sont des géométries de l’hôte',
  autonomousRender: 'témoin autonome : il rend par le renderer de l’hôte',
  blendCopyMesh: 'témoin : la copie transparente est un maillage de l’hôte',
  clusterBatches: 'témoin par lots : il regroupe des géométries de l’hôte',
  clusterBatchesFixture: 'montage du témoin par lots',
  clusterBatchLayers: 'témoin par lots : couches de maillages de l’hôte',
  clusterBatchMesh: 'témoin par lots : il dérive un maillage de l’hôte',
  clusterBatchPrimitive: 'témoin par lots : une primitive de l’hôte par matériau',
  clusterBatchRange: 'témoin par lots : plages d’index d’une géométrie de l’hôte',
  clusterBatchSetup: 'témoin par lots : montage de ses primitives',
  clusterBatchUpdate: 'témoin par lots : réécriture de ses plages',
  comparison: 'témoin de comparaison : il compose deux images par une scène de l’hôte',
  exactPagesAttachment: 'témoin exact : il attache ses pages au graphe de l’hôte',
  exactPagesBackend: 'témoin exact : moteur écrit avec la bibliothèque hôte',
  exactPagesContractLights:
    'témoin exact : il traduit les lampes du contrat en lampes de la bibliothèque hôte',
  exactPagesMaterials: 'témoin exact : ses matériaux sont ceux de l’hôte',
  exactPagesMetrics: 'témoin exact : il compte ce que le renderer de l’hôte a soumis',
  exactPagesRender: 'témoin exact : il rend par le renderer de l’hôte',
  exactPagesRequests: 'témoin exact : ses demandes partent de son graphe de l’hôte',
  lightingObservationMeshes: 'témoin d’éclairage : maillages observés de l’hôte',
  lightingObservationResources: 'témoin d’éclairage : ses ressources sont celles de l’hôte',
  lightingObservationTransforms: 'témoin d’éclairage : poses de repos du graphe de l’hôte',
  referenceBackend: 'témoin de référence : le moteur de l’hôte, tel quel',
  threeBounds: 'témoin : les bornes telles que la bibliothèque hôte les calcule',
  threeLod: 'témoin : la sélection de niveau de détail de l’hôte, `LOD.update` compris',

  // 2. Frontières de l'hôte : scène, caméra, renderer, lampes, poses.
  backendCommon: 'frontière : il crée la scène que chaque moteur rend à l’hôte',
  cameraWorld: 'le contrat de pose caméra : le seul à traduire une caméra hôte en caméra moteur',
  explorerBackends: 'frontière : il monte les moteurs sur le renderer de l’hôte',
  explorerCamera: 'frontière : l’hôte POSE sa caméra, et relit `bounds` et `center`',
  explorerCameraApi: 'frontière : aller-retour de pose entre l’hôte et sa caméra',
  explorerCapabilities: 'frontière : il interroge le contexte du renderer de l’hôte',
  explorerCapture: 'frontière : il lit les pixels de la cible de l’hôte',
  explorerDisposeSource: 'frontière : il libère les ressources du graphe de l’hôte',
  explorerDraw: 'frontière : il appelle le renderer de l’hôte',
  explorerHeldFrame: 'frontière : il recompose l’image tenue dans une scène de l’hôte',
  explorerHostState: 'frontière : il restaure une pose enregistrée dans la caméra de l’hôte',
  explorerLifecycle: 'frontière : il crée et détruit le renderer de l’hôte',
  explorerPrepare: 'frontière : il prépare le graphe source de l’hôte',
  explorerRender: 'frontière : la boucle d’image de l’hôte, ses cibles et ses textures',
  explorerRenderFallback: 'frontière : le repli quand le renderer de l’hôte lève',
  explorerScene: 'frontière : il construit la scène préparée de l’hôte',
  frameGateCore: 'frontière : la porte d’image relit le nœud source de l’hôte',
  hostSceneLightState: 'frontière : les lampes déclarées deviennent des lampes de l’hôte',
  hostSceneWatch: 'frontière : elle relit les poses locales que l’hôte a écrites',
  hostWorldBounds: 'frontière : les bornes du graphe de l’hôte, rendues à plat',
  hostWorldMatrices: 'frontière : la résolution du graphe de l’hôte, rendue à plat',
  pageSelectionCollect: 'frontière : il parcourt le graphe source de l’hôte',
  replicateInstances: 'frontière : il réplique des nœuds du graphe de l’hôte',
  sceneLighting: 'frontière : les lampes du contrat posées dans la scène de l’hôte',
  sceneMeshes: 'frontière : il énumère les maillages du graphe de l’hôte',
  webgpuPagesSurfaceCapture: 'frontière : la capture entre par une caméra de l’hôte',
  webgpuPagesTransform: 'frontière : l’hôte déplace un sous-arbre de sa scène',

  // 2 bis. Montages de scènes de test et oracles qui parcourent le graphe de l'hôte.
  gpuDagOracleMath: 'oracle : il POSE une caméra hôte pour en dériver la caméra du moteur',
  pageRaster: 'oracle raster : il lit les maillages, matériaux et couleurs du graphe de l’hôte',
  pageSelectionBlendFixture: 'montage de scène de test : il pose la caméra et les matériaux',
  pageSelectionDagFixture: 'montage de scène de test : il pose la caméra et les matériaux',
  pagesBackendFixture: 'montage de test : il compte ce que des maillages de l’hôte dessinent',
  pagesBackendScenes: 'montage de scène de test : il pose la caméra',
  visibilityBufferFixture: 'montage de scène de test : il pose la caméra et les pages',
  webgpuCutRepriseFixture: 'montage de test : il pose la caméra hôte que cameraMoteur traduit',
  webgpuPagesTestOccluder: 'montage de scène de test : l’occulteur et sa caméra',
  webgpuPagesTestScenes: 'montage de scènes de test : maillages et matériaux',

  // 3. Ressources de l'hôte : matériaux, textures, géométries, couleurs, constantes de face.
  backendTypes: 'contrat : les ressources de l’hôte qu’un moteur reçoit',
  explorerOptions: 'contrat : les ressources de l’hôte que l’hôte déclare',
  explorerDiagnosticApi: 'il remplace les matériaux et géométries de l’hôte par ceux du diagnostic',
  explorerSceneApi: 'contrat : matériaux et poses que l’hôte réécrit sur sa scène',
  explorerViewportApi: 'frontière : la vue de capture est une caméra de l’hôte',
  frameCostAudit: 'constante de face du matériau hôte, et les compteurs de son renderer',
  gpuDagTypes: 'contrat : matériaux et matrices que l’hôte écrit',
  gpuSelection: 'constantes de face du matériau hôte',
  pageCone: 'constantes de face du matériau hôte',
  pageSelectionCutState: 'matériau de l’hôte porté par une page',
  pageSelectionHelpers: 'constante de face du matériau hôte',
  pageSelectionTypes: 'contrat : géométries, matériaux et matrices que l’hôte écrit',
  triangleDiagnostic: 'il colore une géométrie de l’hôte dans un matériau de l’hôte',
  visibilityLighting: 'couleur du matériau hôte',
  visibilityMath: 'attributs, textures et modes de répétition de l’hôte',
  visibilityRaster: 'constantes de face du matériau hôte',
  visibilityTypes: 'contrat : matériaux, textures et couleurs de l’hôte',
  visibilityWrapModes: 'modes de répétition de la texture hôte',
  webgpuAtlasCommon: 'textures de l’hôte rangées en atlas',
  webgpuAtlasJobs: 'textures de l’hôte à téléverser',
  webgpuBlendBuffers: 'attributs de géométrie de l’hôte',
  webgpuBlendDraw: 'constantes de face du matériau hôte',
  webgpuBlendPrepare: 'maillages et matériaux de l’hôte à préparer',
  webgpuBlendState: 'contrat : géométries, matériaux et matrices que l’hôte écrit',
  webgpuGeometryPrepare: 'géométries de l’hôte à préparer',
  webgpuMaterialTextures: 'textures du matériau hôte',
  webgpuPageRow: 'géométrie et textures de l’hôte d’une rangée',
  webgpuPagesHelpers: 'couleurs et gestion de couleur de l’hôte',
  webgpuPagesPipelineFor: 'constantes de face du matériau hôte',
  webgpuPagesPrepare: 'attributs de géométrie de l’hôte',
  webgpuPagesSetup: 'maillages de la scène de l’hôte',
  webgpuPagesStateGpu: 'contrat : géométries, textures et maillage de présentation de l’hôte',
  webgpuPagesStateVis: 'contrat : géométries et textures de l’hôte',
  webgpuPositions: 'attribut de position de la géométrie hôte',
  webgpuPresentationSetup: 'la présentation passe par une scène et un matériau de l’hôte',
  textureFrameViews: 'matrice monde de la racine hôte',
  textureUvSpan: 'attribut uv de la géométrie hôte',
  webgpuTexturePriority: 'textures du matériau hôte',
};

const IMPORTE_HOTE = /^\s*(?:import|export)\b[^\n]*\bfrom\s+['"]three['"]/m;

const sources = async () =>
  (await readdir(browser)).filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'));

test('seuls les fichiers déclarés importent la bibliothèque hôte', async () => {
  const fichiers = await sources();
  assert.ok(fichiers.length > 100, 'le paquet navigateur doit être trouvé');
  const fuites = [];
  for (const file of fichiers) {
    if (AUTORISES[file.slice(0, -3)]) continue;
    const texte = await readFile(new URL(file, browser), 'utf8');
    if (IMPORTE_HOTE.test(texte)) fuites.push(file);
  }
  assert.deepEqual(fuites, [], `liste fermée déclarée dans ${import.meta.url}`);
});

test('aucune ligne morte : chaque fichier déclaré existe et importe encore', async () => {
  const fichiers = new Set(await sources());
  const morts = [];
  for (const [nom, raison] of Object.entries(AUTORISES)) {
    const file = `${nom}.ts`;
    assert.ok(raison.length > 10, `${file} doit dire pourquoi`);
    if (!fichiers.has(file)) morts.push(`${file} n’existe plus`);
    else if (!IMPORTE_HOTE.test(await readFile(new URL(file, browser), 'utf8')))
      morts.push(`${file} n’importe plus la bibliothèque hôte : retirer sa ligne`);
  }
  assert.deepEqual(morts, [], 'une autorisation qui ne sert plus se retire de la liste');
});

test('`cameraWorld.ts` reste la seule traduction de caméra hôte en caméra moteur', async () => {
  const texte = await readFile(new URL('cameraWorld.ts', browser), 'utf8');
  assert.match(texte, /export type HostCamera = THREE\.PerspectiveCamera/);
  assert.match(texte, /export function readCameraWorld\(/);
  for (const champ of ['world', 'projection', 'view', 'viewProjection', 'planes', 'eye'])
    assert.match(texte, new RegExp(`\\b${champ}\\b`), champ);
});
