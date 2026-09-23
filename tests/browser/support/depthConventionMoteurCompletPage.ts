// Page side of the "depth convention, full engine" proof: the same physical camera (near 2.8,
// far 12), a tilted transparent tile that crosses the near plane, and only the clip convention
// declared by the host changes — `coordinateSystem`, as a host flipping its renderer would.
// The engine no longer reads it: it composes its own projection, in reversed depth and infinite
// far plane (`readCameraWorld`, `depthConvention.ts`). The image must stay identical pixel for
// pixel, and the held image must STAY held — there is nothing left to recompute when the host
// changes its mind.
import * as THREE from 'three';
import { webgpuPagesBackend } from '../../../packages/sdk-browser/src/webgpu/pages/pages.ts';
import { cameraFace, libere, engine } from './preuveSceneCommune.ts';
import { difference, image, redCount } from './preuveSceneImage.ts';
import { executerPasses } from './preuveAppareil.ts';
import { sceneTransparente } from './transparentTransformScene.ts';

/**
 * Sequence for a given pass: pose a tilted tile under the WebGL convention, hold it, switch to
 * the WebGPU convention, hold it, return to WebGL, hold it. The physical view — position, look,
 * near, far, field — never changes.
 */
async function sequence(device: GPUDevice, pagine: boolean, evenements: unknown[]) {
  const s = sceneTransparente(pagine);
  const { backend, canvas } = engine(webgpuPagesBackend, s, device, (e) =>
    evenements.push({ pagine, ...e }),
  );
  const camera = cameraFace();
  camera.near = 2.8;
  camera.far = 12;
  camera.updateProjectionMatrix();
  const etapes: { name: string; tenue: boolean | null | undefined }[] = [];
  const etape = async (name: string) => {
    const { pixels, metriques } = await image(backend, camera);
    etapes.push({ name, tenue: metriques.frameHeld });
    return pixels;
  };
  try {
    await backend.prepare();
    // A tilt around Y takes the tile corners off the z = 0 plane: at near = 2.8, one of them
    // passes in front of the camera near plane rather than behind.
    const incline = new Float32Array(new THREE.Matrix4().makeRotationY(0.9).elements);
    if (!backend.setTransform) throw new Error('backend missing setTransform');
    backend.setTransform('vitre', incline);
    let webgl: Uint8Array | undefined;
    for (let i = 0; i < 6; i++) webgl = await etape('webgl-' + i);
    camera.coordinateSystem = THREE.WebGPUCoordinateSystem;
    camera.updateProjectionMatrix();
    let webgpu: Uint8Array | undefined;
    for (let i = 0; i < 6; i++) webgpu = await etape('webgpu-' + i);
    camera.coordinateSystem = THREE.WebGLCoordinateSystem;
    camera.updateProjectionMatrix();
    let retour: Uint8Array | undefined;
    for (let i = 0; i < 6; i++) retour = await etape('retour-' + i);
    if (!webgl || !webgpu || !retour) throw new Error('sequence produced no frame');
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
