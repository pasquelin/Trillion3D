import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
const core = new URL('../packages/sdk-core/', import.meta.url);
const browser = new URL('../packages/sdk-browser/', import.meta.url);
test('sdk-core excludes browser, UI and filesystem dependencies', async () => {
  for (const file of (await readdir(core)).filter(
    (name) => name.endsWith('.ts') && !name.endsWith('.test.ts'),
  )) {
    const text = await readFile(new URL(file, core), 'utf8');
    assert.doesNotMatch(
      text,
      /from\s+['"](?:node:|react|electron|three|\.\.\/sdk-browser|\.\.\/sdk-node)/,
      file,
    );
    assert.doesNotMatch(
      text,
      /\b(?:document|window|HTMLElement|HTMLCanvasElement|GPUDevice)\b/,
      file,
    );
  }
});

// LA FRONTIÈRE DU CONTRAT DE POSE CAMÉRA (`packages/sdk-browser/cameraWorld.ts`).
//
// Le moteur ne possède pas la caméra : l'hôte la lui tend, et elle peut être l'enfant d'un rig que
// personne d'autre que lui ne remonte. Un module qui résout la pose lui-même, ou qui lit une pose
// LOCALE de caméra, décrit alors une autre caméra que celle depuis laquelle l'image est dessinée.
// Ces trois listes sont la frontière : hors d'elles, la pose ne se lit que par le contrat. Y ajouter
// un fichier est une décision, pas un oubli — c'est ce qui manquait quand `explorerFrameDiagnostic`
// s'est mis à publier `camera.position`.

/** Qui a le droit de RÉSOUDRE une pose monde, et pour quel sujet. */
const RESOLVENT = {
  'cameraWorld.ts': 'le contrat lui-même : la seule résolution de pose caméra du paquet',
  'sceneLighting.ts': 'cible de lampe, pas de caméra',
  'hostSceneLightState.ts': 'cible de lampe, pas de caméra',
  'webgpuPagesTransform.ts': 'sous-arbre de scène déplacé par l’hôte, pas de caméra',
};

/** Qui a le droit de toucher une pose LOCALE de caméra, ou de la résoudre par un accesseur Three. */
const POSE_LOCALE = {
  'cameraWorld.ts': 'le contrat : c’est lui qui traduit la pose locale en pose monde',
  'explorerCamera.ts': 'l’hôte POSE sa caméra ; la pose locale est ce qu’il écrit',
  'explorerCameraApi.ts': 'aller-retour d’hôte : `homePose` rend ce que `setCameraPose` réécrit',
  'explorerHostState.ts': 'l’hôte restaure la pose locale qu’il avait enregistrée',
  'gpuDagOraclePredicates.ts': 'l’oracle POSE une caméra sans parent depuis une position monde',
  'pageSelectionDagFixture.ts': 'monteur de scène de test : il pose la caméra',
  'pageSelectionBlendFixture.ts': 'monteur de scène de test : il pose la caméra',
  'visibilityBufferFixture.ts': 'monteur de scène de test : il pose la caméra',
  'pagesBackendScenes.ts': 'monteur de scène de test : il pose la caméra',
  'webgpuPagesTestScenes.ts': 'monteur de scène de test : il pose la caméra',
};

/** Qui LIT la pose monde résolue, et par où elle lui arrive. */
const LISENT_LA_POSE = {
  'cameraWorld.ts': 'le contrat',
  'gpuSelection.ts': 'sélection GPU — résout (appelable seule)',
  'pageSelectionCut.ts': 'coupe CPU — résout (appelable seule)',
  'pageSelectionDiagnostic.ts': 'erreur écran affichée — résout (appelable seule)',
  'pageSelectionRequests.ts': 'seuil adaptatif — résout (appelable seule)',
  'hizProjection.ts': 'rectangles Hi-Z — résout (appelable seule)',
  'hizProjectionHold.ts': 'tenue des rectangles projetés — résout (appelable seule)',
  'hizDepth.ts': 'profondeur Hi-Z — résout (appelable seule)',
  'pageCone.ts': 'rejet de cône — résout (appelable seule)',
  'pageRaster.ts': 'oracle raster — résout (appelable seule)',
  'visibilityRaster.ts': 'raster de visibilité — résout (appelable seule)',
  'visibilityShade.ts': 'ombrage du tampon de visibilité — résout (appelable seule)',
  'visibilityLighting.ts': 'éclairage CPU — pose reçue de `visibilityShade`',
  'viewFingerprint.ts': 'empreinte de vue — pose reçue de l’entrée d’image',
  'streamingPriority.ts': 'priorité de streaming — pose reçue de l’entrée d’image',
  'webgpuPagesEncodeDraws.ts': 'encodage des tirages — pose reçue de l’entrée d’image',
  'webgpuPagesEncodeLights.ts': 'encodage des lumières — pose reçue de l’entrée d’image',
  'webgpuPagesEncodeShadows.ts': 'encodage des ombres — pose reçue de l’entrée d’image',
  'webgpuPagesEncodeBlend.ts': 'encodage des transparents — pose reçue de l’entrée d’image',
  'webgpuBlendUniforms.ts': 'uniformes des transparents — pose reçue de l’entrée d’image',
};

const RESOUT = /\.updateWorldMatrix\s*\(/;
const RECEVEUR = String.raw`[A-Za-z_$]*[Cc]am[A-Za-z_$]*`;
const POSE_DIRECTE = new RegExp(
  `${RECEVEUR}\\??\\.(?:position|quaternion|rotation|getWorldPosition|getWorldQuaternion|getWorldDirection|updateMatrixWorld)\\b`,
);
const POSE_MONDE = new RegExp(`${RECEVEUR}\\??\\.matrixWorld(?:Inverse)?\\b`);

/** Les lignes qui déclenchent un motif, commentaires exclus : un commentaire cite, il ne lit pas. */
const lignesFautives = (text, motif) =>
  text
    .split('\n')
    .filter((line) => !/^\s*(?:\/\/|\*|\/\*)/.test(line) && motif.test(line))
    .map((line) => line.trim());

test('la pose de la caméra ne se lit que par le contrat `cameraWorld.ts`', async () => {
  const fichiers = (await readdir(browser)).filter(
    (name) => name.endsWith('.ts') && !name.endsWith('.test.ts'),
  );
  assert.ok(fichiers.length > 100, 'le paquet navigateur doit être trouvé');
  const fuites = [];
  for (const file of fichiers) {
    const text = await readFile(new URL(file, browser), 'utf8');
    for (const [motif, permis, faute] of [
      [RESOUT, RESOLVENT, 'résout la pose lui-même au lieu d’appeler `resolveCameraWorld`'],
      [POSE_DIRECTE, POSE_LOCALE, 'touche la pose locale d’une caméra hors du contrat'],
      [POSE_MONDE, LISENT_LA_POSE, 'lit la pose monde sans être un consommateur déclaré'],
    ]) {
      if (permis[file]) continue;
      for (const ligne of lignesFautives(text, motif)) fuites.push(`${file} ${faute} : ${ligne}`);
    }
  }
  assert.deepEqual(fuites, [], `frontière du contrat déclarée dans ${import.meta.url}`);
});
