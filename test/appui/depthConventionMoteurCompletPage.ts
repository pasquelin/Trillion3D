// Page side of the "depth convention, full engine" proof: the same physical camera (near 2.8,
// far 12), a tilted transparent tile that crosses the near plane, and only the clip convention
// declared by the host changes — `coordinateSystem`, as a host flipping its renderer would.
// The engine no longer reads it: it composes its own projection, in reversed depth and infinite
// far plane (`readCameraWorld`, `depthConvention.ts`). The image must stay identical pixel for
// pixel, and the held image must STAY held — there is nothing left to recompute when the host
// changes its mind.
import * as THREE from 'three';
import { webgpuPagesBackend } from '../../packages/sdk-browser/webgpuPages.ts';
import { cameraFace, difference, image, libere, engine, redCount } from './preuveSceneCommune.ts';
import { executerPasses } from './preuveAppareil.ts';
import { sceneTransparente } from './transparentTransformScene.ts';

/**
 * Sequence for a given pass: pose a tilted tile under the WebGL convention, hold it, switch to
 * the WebGPU convention, hold it, return to WebGL, hold it. The physical view — position, look,
 * near, far, field — never changes.
 */
async function sequence(device, pagine, evenements) {
  const s = sceneTransparente(pagine);
  const { backend, canvas } = engine(webgpuPagesBackend, s, device, (e) =>
    evenements.push({ pagine, ...e }),
  );
  const camera = cameraFace();
  camera.near = 2.8;
  camera.far = 12;
  camera.updateProjectionMatrix();
  const etapes = [];
  const etape = async (name) => {
    const { pixels, metriques } = await image(backend, camera);
    etapes.push({ name, tenue: metriques.frameHeld });
    return pixels;
  };
  try {
    await backend.prepare();
    // A tilt around Y takes the tile corners off the z = 0 plane: at near = 2.8, one of them
    // passes in front of the camera near plane rather than behind.
    const incline = new Float32Array(new THREE.Matrix4().makeRotationY(0.9).elements);
    backend.setTransform('vitre', incline);
    let webgl;
    for (let i = 0; i < 6; i++) webgl = await etape('webgl-' + i);
    camera.coordinateSystem = THREE.WebGPUCoordinateSystem;
    camera.updateProjectionMatrix();
    let webgpu;
    for (let i = 0; i < 6; i++) webgpu = await etape('webgpu-' + i);
    camera.coordinateSystem = THREE.WebGLCoordinateSystem;
    camera.updateProjectionMatrix();
    let retour;
    for (let i = 0; i < 6; i++) retour = await etape('retour-' + i);
    return {
      pagine,
      etapes,
      rougeWebgl: redCount(webgl),
      versWebgpu: difference(webgl, webgpu),
      versRetour: difference(webgl, retour),
    };
  } finally {
    libere(backend, canvas, s);
  }
}

export async function executer() {
  return executerPasses(sequence);
}
