import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { PUBLIC_FAMILIES } from './engine-without-three-lists.ts'

const browser = new URL('../../packages/sdk-browser/src/', import.meta.url)

// COMPUTATION BOUNDARY OF LOADING AND EXPLORER.
// Engine numbers are computed by `sdk-core`, never by the host 3D library: same formulas,
// same float operation order, flat buffers, no allocations per frame. What the host OWNS remains its own
// (scene, camera, materials), and engine cannot COMPUTE using it: recomposing world matrix,
// box transformation, position extraction, inversion, decomposition. It also does not READ world matrices
// composed by host: engine's come from local poses (`packages/sdk-browser/src/scene/host/world/placements.ts`),
// and the only update serves host scene. Every line keeping a computation is named here with its rationale.

/** Batch files: scene loading, explorer, and their contracts. */
const M4A = [
  'session/engine/awaitEnginePages',
  'session/engine/common',
  'session/engine/types',
  'scene/drive/pagesBounds',
  'session/engine',
  'camera/session/camera',
  'api/cameraApi',
  'session/capabilities',
  'session/disposeSource',
  'frame/schedule/draw',
  'frame/schedule/sessionState',
  'session/lifecycle',
  'session/options',
  'session/prepare',
  'frame/schedule/render',
  'scene/drive/scene',
  'api/sceneApi',
  'api/viewportApi',
  'scene/host/scan/graphObjects',
  'scene/host/scan/hookCore',
  'scene/host/scan/hooks',
  'scene/host/scan/scan',
  'scene/host/scan/watch',
  'scene/host/world/bounds',
  'scene/host/world/rooted',
  'scene/host/world/matrices',
  'scene/host/world/placements',
  'geometry/selection/collect',
  'geometry/selection/helpers',
  'session/engine/pagesEngineScenes.fixture',
  'scene/replicateInstances',
  'scene/meshes',
  'geometry/pages/pool/geometryPrepare',
  'frame/prepare/prepare',
  'frame/prepare/setup',
].map((nom) => `${nom}.ts`)

/** Host library COMPUTATION methods and constructors, replaced by core. */
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
]

/** File -> exact line -> why this line is a host boundary and not a computation. */
const FRONTIERE: Record<string, Record<string, string>> = {
  'scene/host/world/matrices.ts': {
    'node.updateMatrixWorld(true)':
      'the scene belongs to the host: it stays up to date FOR IT, and the engine no longer reads it',
  },
  'camera/session/camera.ts': {
    'camera.updateMatrixWorld()': 'the host SETS its camera; the written pose is resolved once',
  },
  'frame/schedule/sessionState.ts': {
    'camera.updateMatrixWorld()': 'the session sets the pose it is handed into its camera',
  },
}

/** Lines triggering a pattern, comments excluded. */
const lignesFautives = (text: string): string[] =>
  text
    .split('\n')
    .filter((ligne) => !/^\s*(?:\/\/|\*|\/\*)/.test(ligne))
    .map((ligne) => ligne.trim())
    .filter((ligne) => CALCULS.some((motif) => ligne.includes(motif)))

test('loading and explorer no longer compute using the host library', async () => {
  const fuites: string[] = [],
    inutiles: string[] = []
  for (const file of M4A) {
    const text = await readFile(new URL(file, browser), 'utf8')
    const permis = FRONTIERE[file] ?? {},
      seen = new Set<string>()
    for (const ligne of lignesFautives(text)) {
      if (permis[ligne]) seen.add(ligne)
      else fuites.push(`${file} computes through the host library: ${ligne}`)
    }
    for (const ligne of Object.keys(permis))
      if (!seen.has(ligne))
        inutiles.push(`${file} declares a boundary that no longer exists: ${ligne}`)
  }
  assert.deepEqual(fuites, [], `boundary declared in ${import.meta.url}`)
  assert.deepEqual(inutiles, [], 'a vanished boundary is removed from the list')
})

test('each file in M4a batch still exists under its name', async () => {
  for (const file of M4A)
    await assert.doesNotReject(
      readFile(new URL(file, browser), 'utf8'),
      `${file} was renamed or deleted: the M4a lot list must follow`,
    )
})

// PAGE MATRIX IS COPIED, NEVER COMPUTED.
// `PageRec.matrix` and `ClusterRoot.world` are host library matrices filled by ENGINE (`packages/sdk-browser/src/scene/host/world/placements.ts`);
// the engine receives them from the host. What it does with them is closed:
// it reads the sixteen floats from `.elements` and passes them to core.
const CALCULE_UNE_MATRICE =
  /\.(?:matrix|matrixWorld|world|transform|normalMatrix)\??\.(?:clone|copy|multiply|premultiply|multiplyMatrices|invert|decompose|compose|applyMatrix4|transformDirection|setFromMatrixPosition|extractRotation|transpose|setPosition|makeRotationFromQuaternion)\s*\(/

/** The rule does not target the engine's own graph (`scene/host/graph/`): its nodes ARE host objects of
 *  the engine's making, whose matrices the core's `Matrix4` composes as the reference does — a
 *  host resolution the engine path still only reads. */
const HOST_GRAPH = /^host\/graph\//

/** File -> exact line -> why it SETS a host matrix instead of computing one. Empty since the
 *  second capture view became the host camera itself, read at the aspect ratio of the surface
 *  written into (`readCameraWorld`): no engine file composes into a host matrix any more. The
 *  boundary that gives a campaign its camera back writes the sixteen floats it was handed
 *  (`copyMatrix4`), which is a copy and not a composition. */
const ECRIT_L_HOST: Record<string, Record<string, string>> = {}

test('engine reads the host matrix, it does not compute with it', async () => {
  const fichiers = (await readdir(browser, { recursive: true })).filter(
    (nom) => nom.endsWith('.ts') && !nom.endsWith('.test.ts') && !PUBLIC_FAMILIES.test(nom),
  )
  assert.ok(fichiers.length > 100, 'the browser package must be found')
  const fuites: string[] = [],
    inutiles: string[] = []
  for (const file of fichiers) {
    if (HOST_GRAPH.test(file)) continue
    const permis = ECRIT_L_HOST[file] ?? {},
      seen = new Set<string>()
    const text = await readFile(new URL(file, browser), 'utf8')
    for (const ligne of text
      .split('\n')
      .filter((l) => !/^\s*(?:\/\/|\*|\/\*)/.test(l) && CALCULE_UNE_MATRICE.test(l))
      .map((l) => l.trim())) {
      if (permis[ligne]) seen.add(ligne)
      else fuites.push(`${file} computes a host matrix: ${ligne}`)
    }
    for (const ligne of Object.keys(permis))
      if (!seen.has(ligne))
        inutiles.push(`${file} declares a write that no longer exists: ${ligne}`)
  }
  assert.deepEqual(fuites, [], `boundary declared in ${import.meta.url}`)
  assert.deepEqual(inutiles, [], 'a vanished write is removed from the list')
})
