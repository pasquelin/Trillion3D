// Page side of the held-frame proof: a real WebGL2 render on the engine's own surface attributes
// (`alpha: false` included), the witness adapter drawing a scene through the frame composer with
// the engine's display chain (sRGB output, the filmic curve once a light exists), and the real
// held-frame module.
//
// The complete image is composed then read at four points; the engine then declares its frame
// held, the composer puts the kept copy back, and the same points are read again. The readings
// must be identical byte for byte: the copy already carries the display output, so putting it back
// must neither encode nor tone-map it again — and must work at all on a drawing buffer without
// alpha, where a copy into an RGBA texture is refused.
import { asHostLibrary } from '../../../packages/sdk-browser/src/host/resources.ts';
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts';
import { createFrameComposer } from '../../../packages/sdk-browser/src/world/render/compose.ts';
import { createThreeSceneDraw } from '../../../bench/witnesses/three/sceneAdapter.ts';
import { threeGraph } from '../../../bench/witnesses/three/fromGraphNodes.ts';
import { onEngineContext } from './clusterPixels.ts';
import { baseCapabilities } from '../../../bench/witnesses/capabilities.ts';

const WIDTH = 256,
  HEIGHT = 192;
const POINTS = [
  [WIDTH >> 1, HEIGHT >> 1],
  [WIDTH >> 3, HEIGHT >> 3],
  [(7 * WIDTH) >> 3, (7 * HEIGHT) >> 3],
  [WIDTH >> 2, (3 * HEIGHT) >> 2],
];

/** RGBA bytes of the drawing buffer at the control points, read just after the compose. */
function read(gl: WebGL2RenderingContext) {
  return POINTS.map(([x, y]) => {
    const bytes = new Uint8Array(4);
    gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
    return [...bytes];
  });
}

/** Two planes of different colours, lit or not as the case asks. */
function sceneOf(lit: boolean) {
  const scene = new G.Scene();
  scene.background = new G.Color(0x171d28);
  const surface = (colour: number) =>
    lit ? G.standardSurface({ color: colour, roughness: 0.6 }) : G.basicSurface({ color: colour });
  const back = G.mesh(G.planeGeometry(4, 3), surface(0x336699));
  const square = G.mesh(G.planeGeometry(1, 1), surface(0xcc8844));
  square.position.set(-0.6, 0.4, 0.5);
  scene.add(back, square);
  if (lit) {
    const lamp = G.directionalLight(0xffffff, 2.5);
    lamp.position.set(1, 2, 3);
    scene.add(lamp, G.ambientLight(0xffffff, 0.3));
  }
  return scene;
}

/** The draw calls counted right after a draw: `null` only before the first frame, never here. */
const calls = (draw: ReturnType<typeof createThreeSceneDraw>) => {
  const counters = draw.counters();
  if (!counters) throw new Error('read before the first draw');
  return counters.calls;
};

/** One case: a complete image, then the same image held three times. Both readings. */
function heldCase(gl: WebGL2RenderingContext, lit: boolean) {
  const camera = G.perspectiveCamera(50, WIDTH / HEIGHT, 0.1, 100);
  camera.position.z = 3;
  camera.updateMatrixWorld(true);
  const world = sceneOf(lit);
  const draw = createThreeSceneDraw(
    gl,
    asHostLibrary<Parameters<typeof createThreeSceneDraw>[1]>(threeGraph(world)),
  );
  // A witness engine as the composer sees it: its scene, its light flag, its held-frame word.
  const engine = {
    id: 'witness',
    capabilities: baseCapabilities,
    scene: world,
    frameHeld: false,
    overBudget: false,
    prepare: async () => {},
    metrics: () => ({}),
    dispose: () => {},
    sceneLit: () => lit,
    render: draw.render,
    drawHostGeometry: draw.drawHostGeometry,
  };
  const compose = createFrameComposer(gl, camera);
  engine.render(camera);
  compose(engine, null);
  const complete = read(gl);
  const draws = calls(draw);
  engine.frameHeld = true;
  const held: number[][][] = [];
  // Several held images in a row: each puts back what it kept, without drifting.
  for (let i = 0; i < 3; i++) {
    compose(engine, null);
    held.push(read(gl));
  }
  const heldDraws = calls(draw);
  compose.dispose();
  draw.dispose();
  world.traverse((node) => {
    if (!(node instanceof G.Mesh)) return;
    node.geometry.dispose();
    [node.material].flat().forEach((material) => material.dispose());
  });
  return { lit, complete, held, draws, heldDraws };
}

export function execute() {
  return onEngineContext(WIDTH, HEIGHT, (gl) => ({
    alpha: gl.getContextAttributes()?.alpha,
    cases: [heldCase(gl, false), heldCase(gl, true)],
  }));
}
