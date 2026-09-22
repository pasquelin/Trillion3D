// Rendering one material fixture on each engine: the witness renderer, the prepared scene, and
// the two images compared point by point. Split from `materialPixelsPage.ts` (fixture run and
// comparison) to keep each file under the line gate.
import * as THREE from 'three';
import { asHostLibrary } from '../../packages/sdk-browser/hostResources.ts';
import { batisseur, engine, libere, type ScenePreparee } from './preuveSceneCommune.ts';
import { jusquaTenue } from './preuveSceneImage.ts';
import { SIZE, type Fixture } from './materialFixtures.ts';
import type { BackendFactory, BackendDiagnostic } from '../../packages/sdk-browser/backendTypes.ts';
import type * as SdkCore from '../../packages/sdk-core/index.ts';

/** Background the page and both engines clear to, so an uncovered pixel is one colour. */
export const CLEAR_COLOR = 0x2a303c;

/** The witness renderer, configured as the explorer configures its own. */
export function witnessRenderer(): { renderer: THREE.WebGLRenderer; canvas: HTMLCanvasElement } {
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  renderer.setPixelRatio(1);
  renderer.setSize(SIZE, SIZE, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMappingExposure = 1;
  return { renderer, canvas };
}

/** The fixture's square: a lit one carries normals, a normal-mapped one its tangents. */
function square(fixture: Fixture): THREE.PlaneGeometry {
  const geometry = new THREE.PlaneGeometry(2, 2);
  if (fixture.tangents)
    geometry.setAttribute(
      'tangent',
      new THREE.Float32BufferAttribute(Array.from({ length: 4 }, () => [1, 0, 0, 1]).flat(), 4),
    );
  return geometry;
}

/** The prepared scene of one fixture: its square, what stands behind it, and the sun when lit. */
export function sceneOf(fixture: Fixture, sun: THREE.Object3D): ScenePreparee {
  const builder = batisseur();
  const material = fixture.material();
  const mesh = new THREE.Mesh(square(fixture), material);
  if (fixture.back) mesh.rotation.y = Math.PI;
  builder.source.add(mesh);
  builder.ajoute(mesh, material.transparent ? 'clustered-blend' : 'exact-clusters', 1);
  if (fixture.behind !== undefined) {
    const back = new THREE.Mesh(
      new THREE.PlaneGeometry(4, 4),
      new THREE.MeshBasicMaterial({ color: fixture.behind }),
    );
    back.position.z = -1;
    builder.source.add(back);
    builder.ajoute(back, 'exact-clusters', 2);
  }
  if (fixture.lit) builder.source.add(sun);
  return builder.fini();
}

/** RGB at `(x, y)` of a bottom-left RGBA image of `SIZE` columns. */
export const rgbAt = (pixels: Uint8Array | number[], [x, y]: number[]): number[] =>
  Array.from(pixels.slice((y * SIZE + x) * 4, (y * SIZE + x) * 4 + 3));

/** The witness image of a prepared scene, drawn by the display chain of a Three engine; the
 *  witness copies the source's meshes and lights, so the scene is left for the engine. */
export function witnessImage(
  referenceBackend: BackendFactory,
  scene: ScenePreparee,
  renderer: THREE.WebGLRenderer,
  camera: THREE.PerspectiveCamera,
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
  renderer.render(asHostLibrary<THREE.Scene>(backend.scene), camera);
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
  camera: THREE.PerspectiveCamera,
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
