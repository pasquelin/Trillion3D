import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PUBLIC_FAMILIES } from './engine-without-three-lists.ts';
const core = new URL('../../packages/sdk-core/src/', import.meta.url);
const browser = new URL('../../packages/sdk-browser/src/', import.meta.url);
test('sdk-core excludes browser, UI and filesystem dependencies', async () => {
  const files = (await readdir(core, { recursive: true })).filter(
    (name) => name.endsWith('.ts') && !name.endsWith('.test.ts'),
  );
  assert.ok(files.length > 100, 'the core package must be found');
  for (const file of files) {
    const text = await readFile(new URL(file, core), 'utf8');
    assert.doesNotMatch(
      text,
      /from\s+['"](?:node:|react|electron|three|(?:\.\.\/)+sdk-browser|(?:\.\.\/)+sdk-node)/,
      file,
    );
    assert.doesNotMatch(
      text,
      /\b(?:document|window|HTMLElement|HTMLCanvasElement|GPUDevice)\b/,
      file,
    );
  }
});

// THE CAMERA POSE CONTRACT BOUNDARY (`camera/world.ts`).
//
// The engine does not own the camera: the host hands it over, and it may be the child of a rig
// that nobody else ascends. A module that resolves the pose itself, or reads a LOCAL camera pose,
// then describes a different camera than the one from which the frame is rendered.
// These three lists are the boundary: outside them, pose is read only through the contract. Adding
// a file is a decision, not an oversight.

/** Who is allowed to RESOLVE a world pose, and for which subject. */
const RESOLVENT: Record<string, string> = {
  'camera/world.ts': 'the contract itself: the package’s only camera-pose resolution',
  'lighting/sceneLighting.ts': 'light target, not a camera',
  'webgpu/pages/render/transform.ts': 'scene subtree moved by the host, not a camera',
  'physics/bodies.ts': 'a body the page moved, not a camera',
};

/** Who is allowed to touch a LOCAL camera pose, or resolve it via a Three accessor. */
const POSE_LOCALE: Record<string, string> = {
  'camera/world.ts': 'the contract: it is what translates local pose into world pose',
  'world/camera/camera.ts': 'the host POSES its camera; the local pose is what it writes',
  'camera/controls/pose.ts': 'the camera-controller boundary: a controller writes a local pose',
  'world/api/cameraApi.ts': 'host round-trip: `homePose` returns what `setCameraPose` rewrites',
  'world/render/hostState.ts': 'the host restores the local pose it had recorded',
  'gpu/dag/oracle/predicates.ts': 'the oracle POSES a parentless camera from a world position',
  'page/selection/dag.fixture.ts': 'test scene builder: it poses the camera',
  'page/selection/blend.fixture.ts': 'test scene builder: it poses the camera',
  'visibility/buffer.fixture.ts': 'test scene builder: it poses the camera',
  'webgpu/cut/resume.fixture.ts': 'test scene builder: it poses the camera',
  'backend/pagesBackendScenes.fixture.ts': 'test scene builder: it poses the camera',
  'webgpu/pages/testScenes.fixture.ts': 'test scene builder: it poses the camera',
};

/**
 * Who READS the resolved world pose, and how it reaches them.
 *
 * Since batch M3b, the per-frame path no longer reads the pose on a host camera: per-frame input
 * copies it ONCE into the engine camera (`readCameraWorld`), and downstream reads this structure —
 * `tests/integration/engine-without-three.test.ts` forbids these files from importing host library.
 * Only the contract and the oracle traversing host graph remain here.
 */
const LISENT_LA_POSE: Record<string, string> = {
  'camera/world.ts': 'the contract',
  'page/raster.ts': 'host-graph raster oracle — resolves (callable alone)',
  'physics/view.ts': 'the eye, facing and range the physics worker is sent, once they change',
};

const RESOUT = /\.updateWorldMatrix\s*\(/;
const RECEVEUR = String.raw`[A-Za-z_$]*[Cc]am[A-Za-z_$]*`;
const POSE_DIRECTE = new RegExp(
  `${RECEVEUR}\\??\\.(?:position|quaternion|rotation|getWorldPosition|getWorldQuaternion|getWorldDirection|updateMatrixWorld)\\b`,
);
const POSE_MONDE = new RegExp(`${RECEVEUR}\\??\\.matrixWorld(?:Inverse)?\\b`);

/** Lines triggering a pattern, comments excluded. */
const lignesFautives = (text: string, motif: RegExp): string[] =>
  text
    .split('\n')
    .filter((line) => !/^\s*(?:\/\/|\*|\/\*)/.test(line) && motif.test(line))
    .map((line) => line.trim());

test('camera pose is read only through the `camera/world.ts` contract', async () => {
  const fichiers = (await readdir(browser, { recursive: true })).filter(
    (name) => name.endsWith('.ts') && !name.endsWith('.test.ts') && !PUBLIC_FAMILIES.test(name),
  );
  assert.ok(fichiers.length > 100, 'the browser package must be found');
  const fuites: string[] = [];
  const regles: Array<[RegExp, Record<string, string>, string]> = [
    [RESOUT, RESOLVENT, 'resolves the pose itself instead of calling `resolveCameraWorld`'],
    [POSE_DIRECTE, POSE_LOCALE, 'touches a camera local pose outside the contract'],
    [POSE_MONDE, LISENT_LA_POSE, 'reads world pose without being a declared consumer'],
  ];
  for (const file of fichiers) {
    const text = await readFile(new URL(file, browser), 'utf8');
    for (const [motif, permis, faute] of regles) {
      if (permis[file]) continue;
      for (const ligne of lignesFautives(text, motif)) fuites.push(`${file} ${faute} : ${ligne}`);
    }
  }
  assert.deepEqual(fuites, [], `contract boundary declared in ${import.meta.url}`);
  const dead = [RESOLVENT, POSE_LOCALE, LISENT_LA_POSE].flatMap((list) =>
    Object.keys(list).filter((file) => !fichiers.includes(file)),
  );
  assert.deepEqual(dead, [], 'a declared file that no longer exists is removed from its list');
});
