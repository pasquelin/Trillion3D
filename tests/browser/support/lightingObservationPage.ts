// The transport experiment's observation on the engine's program, against the host shader
// material that drew it before: same GLSL, same meshes, same textures and uniforms, one image
// drawn twice — by the engine on its context, by the host renderer on its own canvas.
import * as THREE from 'three';
import { experimentScene, hostSource, renderState } from './lightingObservationScene.ts';
import { createLightingExperimentBackend } from '../../kit/lighting/experimentBackend.ts';
import { createObservationResources } from '../../kit/lighting/resources.ts';
import { createObservationMeshes } from '../../kit/lighting/meshes.ts';
import { createObservationDraw } from '../../kit/lighting/draw.ts';
import { updateObservation } from '../../kit/lighting/update.ts';
import { fragmentShader, vertexShader } from '../../kit/lighting/shaders.ts';
import { createFrameComposer } from '../../../packages/sdk-browser/src/world/render/compose.ts';
import {
  createHostDrawCamera,
  readHostDrawCamera,
} from '../../../packages/sdk-browser/src/camera/world.ts';
import { MANIFEST_IDENTITY } from '../../../packages/sdk-browser/src/backend/pagesBackend.fixture.ts';
import type { ObservationResources, ObservationTexture } from '../../kit/lighting/resources.ts';
import type { ObservationMeshes } from '../../kit/lighting/meshes.ts';

const SIZE = 96;

const canvas = () => Object.assign(document.createElement('canvas'), { width: SIZE, height: SIZE });
const pixels = (gl: WebGL2RenderingContext) => {
  const out = new Uint8Array(SIZE * SIZE * 4);
  gl.readPixels(0, 0, SIZE, SIZE, gl.RGBA, gl.UNSIGNED_BYTE, out);
  return out;
};
const floatTexture = ({ data, width, height }: ObservationTexture) => {
  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.FloatType);
  texture.minFilter = texture.magFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  return texture;
};

/** The host shader material drawing the same records on the host renderer. */
function witnessPixels(
  resources: ObservationResources,
  meshes: ObservationMeshes,
  camera: THREE.PerspectiveCamera,
) {
  const renderer = new THREE.WebGLRenderer({ canvas: canvas(), antialias: false });
  renderer.setSize(SIZE, SIZE, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const { uniforms } = resources,
    scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  const shared = {
    indirectCache: { value: floatTexture(resources.texture) },
    cacheSize: { value: new THREE.Vector2(...uniforms.cacheSize) },
    surfaceData: { value: floatTexture(resources.surfaceTexture) },
    sphere: { value: new THREE.Vector4(...uniforms.sphere) },
    sphereRoughness: { value: uniforms.sphereRoughness },
    reflectionSamples: { value: uniforms.reflectionSamples },
    experimentExposure: { value: uniforms.experimentExposure },
    emitterCount: { value: uniforms.emitterCount },
    emitterIndices: { value: uniforms.emitterIndices },
    directLightSamples: { value: uniforms.directLightSamples },
    directLightGrid: { value: uniforms.directLightGrid },
    bvhData: { value: floatTexture(resources.bvhTexture) },
    useBvh: { value: uniforms.useBvh },
  };
  for (const copy of meshes.copies) {
    // `copy.geometry` is the engine's low-level contract (`WholeMesh['geometry']`), but it is
    // built straight from a source `THREE.Mesh`'s own geometry (`createObservationMeshes`),
    // never rebuilt: the witness needs the real instance back to draw it with the library.
    if (!(copy.geometry instanceof THREE.BufferGeometry))
      throw new Error('the observed copy did not keep its source geometry instance');
    const mesh = new THREE.Mesh(
      copy.geometry,
      new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader: fragmentShader(resources.surfaceCount),
        uniforms: { ...shared, primarySurface: { value: copy.surface } },
        side: THREE.DoubleSide,
      }),
    );
    mesh.matrixAutoUpdate = false;
    mesh.matrix.fromArray(copy.matrix.elements);
    scene.add(mesh);
  }
  renderer.render(scene, camera);
  const context = renderer.getContext();
  if (!(context instanceof WebGL2RenderingContext))
    throw new Error('the witness renderer requires a WebGL2 context');
  const out = pixels(context);
  renderer.dispose();
  return out;
}

const compare = (a: Uint8Array, b: Uint8Array) => {
  let max = 0,
    differing = 0;
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i] - b[i]);
    if (d) differing++;
    if (d > max) max = d;
  }
  return { max, differing };
};

export async function execute() {
  const gl = canvas().getContext('webgl2', { antialias: false });
  if (!gl) return { unavailable: 'WebGL2 unavailable' };
  const scene = experimentScene(),
    state = renderState(scene),
    source = hostSource(scene),
    camera = new THREE.PerspectiveCamera(60, 1, 0.1, 20);
  camera.updateMatrixWorld();
  // The engine's pass alone, on the records the backend builds.
  const resources = createObservationResources(state),
    meshes = createObservationMeshes(state, resources, source);
  updateObservation(state, resources, meshes);
  const draw = createObservationDraw(gl, resources, meshes);
  gl.viewport(0, 0, SIZE, SIZE);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  const output = { toneMapped: true, framebuffer: null, width: SIZE, height: SIZE };
  draw.drawHostGeometry(readHostDrawCamera(createHostDrawCamera(), camera), output);
  const engine = pixels(gl);
  draw.dispose();
  const witness = witnessPixels(resources, meshes, camera);
  // The public backend, composed like any engine of the explorer.
  const backend = createLightingExperimentBackend(state)({
    source,
    webglContext: gl,
    metadata: { ...MANIFEST_IDENTITY, primitives: [] },
    indices: new Map(),
    associations: new Map(),
  });
  await backend.prepare();
  backend.render(camera);
  const compose = createFrameComposer(gl, camera);
  compose(backend, null);
  const composed = pixels(gl);
  const metrics = backend.metrics(),
    capabilities = backend.capabilities;
  compose.dispose();
  backend.dispose();
  let lit = 0;
  for (let i = 0; i < engine.length; i += 4) if (engine[i] + engine[i + 1] + engine[i + 2]) lit++;
  return {
    litPixels: lit,
    againstWitness: compare(engine, witness),
    composedAgainstEngine: compare(composed, engine),
    drawCalls: metrics.drawCalls,
    triangles: metrics.submittedTriangles,
    meshesInHostScene: backend.scene.children.length,
    renderer: capabilities.renderer,
  };
}
