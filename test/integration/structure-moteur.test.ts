import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
const core = new URL('../../packages/sdk-core/', import.meta.url);
const browser = new URL('../../packages/sdk-browser/', import.meta.url);
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

// THE CAMERA POSE CONTRACT BOUNDARY (`packages/sdk-browser/cameraWorld.ts`).
//
// The engine does not own the camera: the host hands it over, and it may be the child of a rig
// that nobody else ascends. A module that resolves the pose itself, or reads a LOCAL camera pose,
// then describes a different camera than the one from which the frame is rendered.
// These three lists are the boundary: outside them, pose is read only through the contract. Adding
// a file is a decision, not an oversight.

/** Who is allowed to RESOLVE a world pose, and for which subject. */
const RESOLVENT = {
  'cameraWorld.ts': 'the contract itself: the package’s only camera-pose resolution',
  'sceneLighting.ts': 'light target, not a camera',
  'webgpuPagesTransform.ts': 'scene subtree moved by the host, not a camera',
};

/** Who is allowed to touch a LOCAL camera pose, or resolve it via a Three accessor. */
const POSE_LOCALE = {
  'cameraWorld.ts': 'the contract: it is what translates local pose into world pose',
  'explorerCamera.ts': 'the host POSES its camera; the local pose is what it writes',
  'explorerCameraApi.ts': 'host round-trip: `homePose` returns what `setCameraPose` rewrites',
  'explorerHostState.ts': 'the host restores the local pose it had recorded',
  'gpuDagOraclePredicates.ts': 'the oracle POSES a parentless camera from a world position',
  'pageSelectionDagFixture.ts': 'test scene builder: it poses the camera',
  'pageSelectionBlendFixture.ts': 'test scene builder: it poses the camera',
  'visibilityBufferFixture.ts': 'test scene builder: it poses the camera',
  'webgpuCutRepriseFixture.ts': 'test scene builder: it poses the camera',
  'pagesBackendScenes.ts': 'test scene builder: it poses the camera',
  'webgpuPagesTestScenes.ts': 'test scene builder: it poses the camera',
};

/**
 * Who READS the resolved world pose, and how it reaches them.
 *
 * Since batch M3b, the per-frame path no longer reads the pose on a host camera: per-frame input
 * copies it ONCE into the engine camera (`readCameraWorld`), and downstream reads this structure —
 * `test/integration/moteur-sans-three.test.ts` forbids these files from importing host library.
 * Only the contract and the oracle traversing host graph remain here.
 */
const LISENT_LA_POSE = {
  'cameraWorld.ts': 'the contract',
  'pageRaster.ts': 'host-graph raster oracle — resolves (callable alone)',
};

const RESOUT = /\.updateWorldMatrix\s*\(/;
const RECEVEUR = String.raw`[A-Za-z_$]*[Cc]am[A-Za-z_$]*`;
const POSE_DIRECTE = new RegExp(
  `${RECEVEUR}\\??\\.(?:position|quaternion|rotation|getWorldPosition|getWorldQuaternion|getWorldDirection|updateMatrixWorld)\\b`,
);
const POSE_MONDE = new RegExp(`${RECEVEUR}\\??\\.matrixWorld(?:Inverse)?\\b`);

/** Lines triggering a pattern, comments excluded. */
const lignesFautives = (text, motif) =>
  text
    .split('\n')
    .filter((line) => !/^\s*(?:\/\/|\*|\/\*)/.test(line) && motif.test(line))
    .map((line) => line.trim());

test('camera pose is read only through the `cameraWorld.ts` contract', async () => {
  const fichiers = (await readdir(browser)).filter(
    (name) => name.endsWith('.ts') && !name.endsWith('.test.ts'),
  );
  assert.ok(fichiers.length > 100, 'the browser package must be found');
  const fuites = [];
  for (const file of fichiers) {
    const text = await readFile(new URL(file, browser), 'utf8');
    for (const [motif, permis, faute] of [
      [RESOUT, RESOLVENT, 'resolves the pose itself instead of calling `resolveCameraWorld`'],
      [POSE_DIRECTE, POSE_LOCALE, 'touches a camera local pose outside the contract'],
      [POSE_MONDE, LISENT_LA_POSE, 'reads world pose without being a declared consumer'],
    ]) {
      if (permis[file]) continue;
      for (const ligne of lignesFautives(text, motif)) fuites.push(`${file} ${faute} : ${ligne}`);
    }
  }
  assert.deepEqual(fuites, [], `contract boundary declared in ${import.meta.url}`);
});
