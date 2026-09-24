// Page side of the "`setTransform` under a stale parent" proof: the real WebGPU engine, a real
// device, a real reread image. The host writes position, rotation and scale directly
// of the parent — never through `setTransform`, never followed by a manual `updateMatrixWorld` —
// so the only way the engine can see that change is the resolution it does itself before
// inverting the parent's matrix (`resolveHostNode`, in `setWebgpuTransform`).
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts';
import { libere } from './sharedSceneProof.ts';
import { difference, image, redCount } from './sceneImageProof.ts';
import { executerPasses } from './deviceProof.ts';
import { ouvrePasse } from './transparentTransformScene.ts';

/** A column-major world matrix, pure translation on `x`. */
function translation(x: number): Float32Array {
  return new Float32Array(new G.Matrix4().makeTranslation(x, 0, 0).elements);
}

/**
 * Sequence for a given pass: pose, dirty the parent without notifying, ask the same world pose
 * again, stabilise, dirty again and re-ask, ask another pose, then make the parent singular and
 * observe the named refusal.
 */
async function sequence(device: GPUDevice, pagine: boolean, evenements: unknown[]) {
  const { s, backend, canvas, setTransform, camera } = ouvrePasse(device, pagine, evenements);
  const pivot = G.byName(s.source, 'pivot'),
    etapes: { name: string; tenue: boolean | null | undefined; rouge: number }[] = [];
  if (!pivot) throw new Error('scene missing pivot node');
  const etape = async (name: string) => {
    const { pixels, metriques } = await image(backend, camera);
    etapes.push({ name, tenue: metriques.frameHeld, rouge: redCount(pixels) });
    return pixels;
  };
  try {
    await backend.prepare();
    setTransform('vitre', translation(-0.8));
    let reference: Uint8Array | undefined;
    for (let i = 0; i < 6; i++) reference = await etape('initial-' + i);
    // The host writes the parent WITHOUT going through `setTransform` or calling
    // `updateMatrixWorld`: its world matrix stays stale until something walks it up.
    pivot.position.set(10, 3, -2);
    pivot.rotation.set(0.2, -0.3, 0.4);
    pivot.scale.set(2, 0.7, 1.5);
    setTransform('vitre', translation(-0.8));
    const dirty = await etape('parent-dirty');
    let stable: Uint8Array | undefined;
    for (let i = 0; i < 6; i++) stable = await etape('stable-' + i);
    pivot.position.x = -12;
    setTransform('vitre', translation(-0.8));
    const repete = await etape('repeat-after-parent');
    setTransform('vitre', translation(0.8));
    const deplace = await etape('moved');
    pivot.scale.y = 0;
    let singulier: string | null = null;
    try {
      setTransform('vitre', translation(0));
    } catch (error) {
      singulier = (error as { code?: string }).code ?? String(error);
    }
    if (!reference || !stable) throw new Error('sequence produced no frame');
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
