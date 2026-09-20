// Page side of the "`setTransform` under a stale parent" proof: the real WebGPU engine, a real
// device, a real reread image. The host writes position, rotation and scale directly
// of the parent — never through `setTransform`, never followed by a manual `updateMatrixWorld` —
// so the only way the engine can see that change is the resolution it does itself before
// inverting the parent's matrix (`resolveHostNode`, in `setWebgpuTransform`).
import * as THREE from 'three';
import { webgpuPagesBackend } from '../../packages/sdk-browser/webgpuPages.ts';
import { cameraFace, difference, image, libere, engine, redCount } from './preuveSceneCommune.mjs';
import { executerPasses } from './preuveAppareil.mjs';
import { sceneTransparente } from './transparentTransformScene.mjs';

/** A column-major world matrix, pure translation on `x`. */
function translation(x) {
  return new Float32Array(new THREE.Matrix4().makeTranslation(x, 0, 0).elements);
}

/**
 * Sequence for a given pass: pose, dirty the parent without notifying, ask the same world pose
 * again, stabilise, dirty again and re-ask, ask another pose, then make the parent singular and
 * observe the named refusal.
 */
async function sequence(device, pagine, evenements) {
  const s = sceneTransparente(pagine);
  const { backend, canvas } = engine(webgpuPagesBackend, s, device, (e) =>
    evenements.push({ pagine, ...e }),
  );
  const camera = cameraFace(),
    pivot = s.source.getObjectByName('pivot'),
    etapes = [];
  const etape = async (name) => {
    const { pixels, metriques } = await image(backend, camera);
    etapes.push({ name, tenue: metriques.frameHeld, rouge: redCount(pixels) });
    return pixels;
  };
  try {
    await backend.prepare();
    backend.setTransform('vitre', translation(-0.8));
    let reference;
    for (let i = 0; i < 6; i++) reference = await etape('initial-' + i);
    // The host writes the parent WITHOUT going through `setTransform` or calling
    // `updateMatrixWorld`: its world matrix stays stale until something walks it up.
    pivot.position.set(10, 3, -2);
    pivot.rotation.set(0.2, -0.3, 0.4);
    pivot.scale.set(2, 0.7, 1.5);
    backend.setTransform('vitre', translation(-0.8));
    const dirty = await etape('parent-dirty');
    let stable;
    for (let i = 0; i < 6; i++) stable = await etape('stable-' + i);
    pivot.position.x = -12;
    backend.setTransform('vitre', translation(-0.8));
    const repete = await etape('repeat-after-parent');
    backend.setTransform('vitre', translation(0.8));
    const deplace = await etape('moved');
    pivot.scale.y = 0;
    let singulier = null;
    try {
      backend.setTransform('vitre', translation(0));
    } catch (error) {
      singulier = error.code ?? String(error);
    }
    return {
      pagine,
      etapes,
      initialRouge: redCount(reference),
      dirtyPixels: difference(reference, dirty),
      stablePixels: difference(reference, stable),
      repeatPixels: difference(reference, repete),
      movedPixels: difference(reference, deplace),
      singulier,
    };
  } finally {
    libere(backend, canvas, s);
  }
}

export async function executer() {
  return executerPasses(sequence);
}
