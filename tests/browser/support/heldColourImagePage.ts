// Page side of the proof: a real WebGL render in Chromium on the engine's own surface — its
// context attributes, `alpha: false` included —, the witness adapter drawing a Three scene through
// the frame composer with the engine's display chain (sRGB output, ACES as soon as a light exists),
// and the real held-frame module.
//
// The complete image is composed then reread pixel for pixel; the engine then declares its frame
// held, the composer puts the kept copy back, and the same points are reread. The two readings
// must be identical byte for byte: the copy already carries the display output, putting it back
// must neither re-encode nor re-tone-map it — and must work at all on a drawing buffer without
// alpha, where a copy into an RGBA texture through `copyTexSubImage2D` was refused.
import { asHostLibrary } from '../../../packages/sdk-browser/src/host/resources.ts';
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts';
import { createFrameComposer } from '../../../packages/sdk-browser/src/world/render/compose.ts';
import { createThreeSceneDraw } from '../../../bench/witnesses/three/sceneAdapter.ts';
import { threeGraph } from '../../../bench/witnesses/three/fromGraphNodes.ts';
import { WEBGL_CONTEXT_ATTRIBUTES } from '../../../packages/sdk-browser/src/webgl/core/surface.ts';
import { baseCapabilities } from '../../../bench/witnesses/capabilities.ts';

const LARGEUR = 256,
  HAUTEUR = 192;
const POINTS = [
  [LARGEUR >> 1, HAUTEUR >> 1],
  [LARGEUR >> 3, HAUTEUR >> 3],
  [(7 * LARGEUR) >> 3, (7 * HAUTEUR) >> 3],
  [LARGEUR >> 2, (3 * HAUTEUR) >> 2],
];

/** RGBA bytes of the draw buffer at the control points, reread just after submit. */
function lire(gl: WebGL2RenderingContext) {
  return POINTS.map(([x, y]) => {
    const octets = new Uint8Array(4);
    gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, octets);
    return [...octets];
  });
}

/** Two planes of different colours, lit or not according to what the case asks. */
function scene(eclairee: boolean) {
  const scene = new G.GraphScene();
  scene.background = new G.Color(0x171d28);
  const materiau = (couleur: number) =>
    eclairee
      ? G.standardSurface({ color: couleur, roughness: 0.6 })
      : G.basicSurface({ color: couleur });
  const fond = G.mesh(G.planeGeometry(4, 3), materiau(0x336699));
  const carre = G.mesh(G.planeGeometry(1, 1), materiau(0xcc8844));
  carre.position.set(-0.6, 0.4, 0.5);
  scene.add(fond, carre);
  if (eclairee) {
    const lampe = G.directionalLight(0xffffff, 2.5);
    lampe.position.set(1, 2, 3);
    scene.add(lampe, G.ambientLight(0xffffff, 0.3));
  }
  return scene;
}

/** The counters right after a draw: `null` only before the first frame, never here. */
const calls = (dessin: ReturnType<typeof createThreeSceneDraw>) => {
  const counters = dessin.counters();
  if (!counters) throw new Error('draw before render');
  return counters.calls;
};

/** One case: a complete image, then the same image held. Returns both pixel readings. */
function cas(gl: WebGL2RenderingContext, eclairee: boolean) {
  const camera = G.perspectiveCamera(50, LARGEUR / HAUTEUR, 0.1, 100);
  camera.position.z = 3;
  camera.updateMatrixWorld(true);
  const monde = scene(eclairee);
  const dessin = createThreeSceneDraw(
    gl,
    asHostLibrary<Parameters<typeof createThreeSceneDraw>[1]>(threeGraph(monde)),
  );
  // A witness engine as the composer sees it: its scene, its light flag, its held-frame word.
  const moteur = {
    id: 'witness',
    capabilities: baseCapabilities,
    scene: monde,
    frameHeld: false,
    overBudget: false,
    prepare: async () => {},
    metrics: () => ({}),
    dispose: () => {},
    sceneLit: () => eclairee,
    render: dessin.render,
    drawHostGeometry: dessin.drawHostGeometry,
  };
  const compose = createFrameComposer(gl, camera);
  moteur.render(camera);
  compose(moteur, null);
  const complete = lire(gl);
  const dessins = calls(dessin);
  moteur.frameHeld = true;
  const readings: number[][][] = [];
  // Several held images in a row: each puts back what it kept, without drifting.
  for (let i = 0; i < 3; i++) {
    compose(moteur, null);
    readings.push(lire(gl));
  }
  const dessinsTenus = calls(dessin);
  compose.dispose();
  dessin.dispose();
  monde.traverse((objet) => {
    if (!(objet instanceof G.GraphMesh)) return;
    objet.geometry.dispose();
    (Array.isArray(objet.material) ? objet.material : [objet.material]).forEach((m) => m.dispose());
  });
  return { eclairee, complete, tenues: readings, dessins, dessinsTenus };
}

export async function executer() {
  const canvas = document.createElement('canvas');
  canvas.width = LARGEUR;
  canvas.height = HAUTEUR;
  document.body.append(canvas);
  const gl = canvas.getContext('webgl2', WEBGL_CONTEXT_ATTRIBUTES);
  if (!gl) return { erreur: 'WebGL2 unavailable' };
  try {
    const attributes = gl.getContextAttributes();
    return {
      alpha: attributes ? attributes.alpha : undefined,
      cas: [cas(gl, false), cas(gl, true)],
    };
  } catch (error) {
    return { erreur: String(error) + (error instanceof Error ? (error.stack ?? '') : '') };
  } finally {
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    canvas.remove();
  }
}
