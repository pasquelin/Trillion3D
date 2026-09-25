// Rendering one material fixture on each renderer: the witness renderer, the prepared scene, and
// the images compared point by point. Split from `materialPixelsPage.ts` (fixture run and
// comparison) to keep each file under the line gate.
import * as THREE from 'three';
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts';
import { asHostLibrary } from '../../../packages/sdk-browser/src/host/resources.ts';
import { batisseur, engine, libere, type ScenePreparee } from './sharedSceneProof.ts';
import { jusquaTenue, PLAFOND } from './sceneImageProof.ts';
import { SIZE, type Fixture } from './materialFixtureShape.ts';
import { pagedManifest } from '../../../packages/sdk-browser/src/backend/autonomous/geometryPages.fixture.ts';
import { createFrameComposer } from '../../../packages/sdk-browser/src/world/render/compose.ts';
import type {
  BackendFactory,
  BackendDiagnostic,
} from '../../../packages/sdk-browser/src/backend/types.ts';
import type * as SdkCore from '../../../packages/sdk-core/src/index.ts';

/** Background the page and both engines clear to, so an uncovered pixel is one colour. */
export const CLEAR_COLOR = 0x2a303c;

/** The witness renderer, configured as the explorer configures its own. */
export function witnessRenderer(): { renderer: THREE.WebGLRenderer; canvas: HTMLCanvasElement } {
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  renderer.setPixelRatio(1);
  renderer.setSize(SIZE, SIZE, false);
  renderer.outputColorSpace = G.HOST_COLOUR_SPACE_SRGB;
  renderer.toneMappingExposure = 1;
  return { renderer, canvas };
}

/** The fixture's square: a lit one carries normals, a normal-mapped one its tangents. */
function square(fixture: Fixture): G.Geometry {
  const geometry = G.planeGeometry(2, 2);
  if (fixture.tangents)
    geometry.setAttribute(
      'tangent',
      G.floatAttribute(Array.from({ length: 4 }, () => [1, 0, 0, 1]).flat(), 4),
    );
  return geometry;
}

/**
 * The witness renderer's own camera: the library's copy of the engine camera, its optics and
 * its world pose. This page is served alone, without the witnesses' `fromGraph` copies.
 */
function witnessCamera(camera: G.GraphCamera) {
  const copy = new THREE.PerspectiveCamera(camera.fov, camera.aspect, camera.near, camera.far);
  copy.matrixAutoUpdate = false;
  copy.matrix.fromArray(camera.matrixWorld.elements);
  copy.updateMatrixWorld(true);
  return copy;
}

/** The prepared scene of one fixture: its square, what stands behind it, and the sun when lit. */
export function sceneOf(fixture: Fixture, sun: G.Object3D): ScenePreparee {
  const builder = batisseur();
  const material = fixture.material();
  const mesh = G.mesh(square(fixture), material);
  if (fixture.back) mesh.rotation.y = Math.PI;
  if (fixture.tilt) mesh.rotation.x = fixture.tilt;
  builder.source.add(mesh);
  builder.ajoute(mesh, material.transparent ? 'clustered-blend' : 'exact-clusters', 1);
  if (fixture.behind !== undefined) {
    const back = G.mesh(G.planeGeometry(4, 4), G.basicSurface({ color: fixture.behind }));
    back.position.z = -1;
    builder.source.add(back);
    builder.ajoute(back, 'exact-clusters', 2);
  }
  if (fixture.lit) builder.source.add(sun);
  return builder.fini();
}

/** RGB at `(x, y)` of a bottom-left RGBA image of `SIZE` columns. */
export const rgbAt = (pixels: ArrayLike<number>, [x, y]: number[]): number[] =>
  [0, 1, 2].map((k) => pixels[(y * SIZE + x) * 4 + k]);

/** The witness image of a prepared scene, drawn by the display chain of a Three engine; the
 *  witness copies the source's meshes and lights, so the scene is left for the engine. */
export function witnessImage(
  referenceBackend: BackendFactory,
  scene: ScenePreparee,
  renderer: THREE.WebGLRenderer,
  camera: G.GraphCamera,
): Uint8Array {
  const backend = referenceBackend({
    source: scene.source,
    metadata: scene.metadata,
    indices: scene.indices,
    associations: scene.associations,
    clearColor: CLEAR_COLOR,
  });
  renderer.toneMapping = backend.sceneLit!() ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
  backend.render(camera);
  renderer.render(asHostLibrary<THREE.Scene>(backend.scene), witnessCamera(camera));
  const pixels = new Uint8Array(SIZE * SIZE * 4);
  const gl = renderer.getContext();
  gl.readPixels(0, 0, SIZE, SIZE, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  backend.dispose();
  return pixels;
}

/** The engine image of a prepared scene, held when the engine holds it, the last rendered one
 *  otherwise; releases the scene. */
export async function engineImage(
  webgpuPagesBackend: BackendFactory,
  scene: ScenePreparee,
  device: GPUDevice,
  sceneLights: SdkCore.SceneLightStore,
  camera: G.GraphCamera,
  events: BackendDiagnostic[],
): Promise<{ pixels: number[] | undefined; held: boolean; dataUrl: string }> {
  const { backend, canvas } = engine(
    webgpuPagesBackend,
    scene,
    device,
    (e: BackendDiagnostic) => events.push(e),
    {
      clearColor: CLEAR_COLOR,
      sceneLights,
    },
  );
  try {
    await backend.prepare();
    const { tenue, rendue } = await jusquaTenue(backend, camera);
    return { pixels: tenue ?? rendue, held: tenue !== null, dataUrl: canvas.toDataURL() };
  } finally {
    libere(backend, canvas, scene);
  }
}

/** The WebGL2 engine image of a prepared scene: the shipping autonomous backend reading each page
 *  encoded from the scene's geometry, composed on its own canvas the way a world composes it.
 *  Rendered until the engine holds its frame, as `jusquaTenue` waits on WebGPU; releases the
 *  scene. */
export async function webgl2Image(
  autonomousPagesBackend: BackendFactory,
  scene: ScenePreparee,
  sceneLights: SdkCore.SceneLightStore,
  camera: G.GraphCamera,
): Promise<{ pixels: Uint8Array; held: boolean; dataUrl: string }> {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  document.body.append(canvas);
  const gl = canvas.getContext('webgl2');
  if (!gl) throw new Error('WebGL2 unavailable');
  const { metadata, readGeometryPage } = pagedManifest(scene.metadata, scene.geometries);
  const backend = autonomousPagesBackend({
    source: scene.source,
    metadata,
    indices: new Map(),
    associations: scene.associations,
    readGeometryPage,
    viewport: [SIZE, SIZE],
    webglContext: gl,
    clearColor: CLEAR_COLOR,
    sceneLights,
  });
  const draw = createFrameComposer(gl, camera);
  const frame = () => {
    backend.render(camera);
    draw(backend, null);
    const pixels = new Uint8Array(SIZE * SIZE * 4);
    gl.readPixels(0, 0, SIZE, SIZE, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    return pixels;
  };
  try {
    await backend.prepare();
    let pixels = frame(),
      held = backend.frameHeld === true;
    for (let i = 1; i < PLAFOND && !held; i++) {
      await backend.flush?.();
      pixels = frame();
      held = backend.frameHeld === true;
    }
    return { pixels, held, dataUrl: canvas.toDataURL() };
  } finally {
    draw.dispose();
    libere(backend, canvas, scene);
  }
}
