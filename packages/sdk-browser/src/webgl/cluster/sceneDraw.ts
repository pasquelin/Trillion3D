import type { Scene } from '../../world/core/scene.ts';
import {
  DEFAULT_TONE_MAPPING,
  TONE_MAPPING_RANK,
} from '../../../../sdk-core/src/scene/core/environment.ts';
import { multiplyMatrix4Typed } from '../../../../sdk-core/src/math/matrix/matrix4Typed.ts';
import type { HostDrawOutput } from '../core/renderTarget.ts';
import type { HostCamera, HostDrawCamera } from '../../camera/world.ts';
import type { WholeMesh } from '../../cluster/batchMesh.ts';
import type { WebglClusterScene } from './lights.ts';
import type { SceneCopy } from './copyCulling.ts';
import { WebglClusterOwner } from './owner.ts';
import { createDrawOrder } from './drawOrder.ts';
import { meshes } from '../../scene/meshes.ts';
import { DEFAULT_PIXEL_RATIO } from '../../backend/common.ts';
import type { BackendHostDraw } from '../../backend/hostDraw.ts';
import type { BackendContext } from '../../backend/types.ts';
import { linearRefusalOf } from './linearRefusal.ts';
import { createDrawLists } from './drawLists.ts';

/** The scene the owner reads for its lights and background, its world matrices resolved
 *  before the read. */
export type ClusterDrawScene = WebglClusterScene & { updateMatrixWorld(): void };

/** A drawn node, the engine's mesh, read by shape: drawn whole. */
type DrawnNode = Partial<SceneCopy> & {
  readonly matrixWorld: SceneCopy['matrixWorld'];
  readonly renderOrder: number;
};

/** What the session gives the draw: its pixel ratio and its degraded-surface notice. */
type DrawHosts = Pick<BackendContext, 'pixelRatio' | 'materialDegraded'>;

/** A scene draw hands the program no page batch: shared, so a frame allocates no empty list. */
const NO_BATCHES: readonly never[] = [];

/**
 * THE ENGINE'S DRAW OF A DISPLAY GRAPH: every visible mesh the graph holds, drawn whole by the
 * engine's program (`owner.ts`) in the order the reference draws a scene — the opaque meshes by
 * `renderOrder`, surface and depth, then the see-through ones and the transparent copies `copies` names, by
 * `renderOrder` and from the farthest to the nearest; the program splits them into its
 * transmission and blend passes. The lights and the background are read off the same graph.
 *
 * `render(camera)` opens the frame: it zeroes the counters, so that a frame
 * the composer held — nothing drawn — publishes nothing, never the previous draw; `counters()` is
 * `null` before the first frame. The graph's matrices and lists (`drawLists.ts`: the matrices of
 * the subtrees that changed, the lists walked again only when the graph changed shape) are brought up to date once per drawn image, at the first of
 * `host.linearRefusal` and `host.drawHostGeometry`: never on a held frame, and never in `render`,
 * which runs before the engine's frame writes the graph (`../../backend/autonomous/pages.ts`). Asked
 * first, that runs before `onBeforeRender`, whose one hook (`../../lighting/unlitAlbedo.ts`) writes
 * no field the lists read. Without a context (a session that never draws on the host
 * surface) the draw is refused by name. `pixelRatio`, read each frame, scales a line's CSS-pixel
 * width to the image's pixels; `materialDegraded` hears a surface drawn without a physical feature.
 */
export function createSceneDraw(
  gl: WebGL2RenderingContext | undefined,
  display: Scene,
  copies: readonly object[] = [],
  { pixelRatio = () => DEFAULT_PIXEL_RATIO, materialDegraded }: DrawHosts = {},
) {
  // The graph's lists, walked again only when it changed shape (`drawLists.ts`); the draw sorts
  // copies of them, reused from frame to frame: a draw allocates no list.
  const lists = createDrawLists(display, copies);
  const opaque: (WholeMesh & DrawnNode)[] = [],
    seeThrough: DrawnNode[] = [];
  let owner: WebglClusterOwner | undefined,
    opened = false,
    walked = false;
  // The projection times the view, read once a frame, and the order it sorts the draws in.
  const screen = new Float64Array(16),
    order = createDrawOrder();
  const counters = { triangles: 0 };
  /** The image's one pass over what changed: its world matrices, then what it draws, sorted later. */
  const walk = () => {
    if (walked) return;
    walked = true;
    lists.refresh();
    opaque.length = seeThrough.length = 0;
    for (const mesh of lists.opaque) opaque.push(mesh);
    for (const mesh of lists.seeThrough) seeThrough.push(mesh);
  };
  const host: Required<BackendHostDraw> = {
    // Only a see-through mesh can refuse: the list of them, in graph order.
    linearRefusal() {
      walk();
      for (const node of lists.seeThrough) {
        const mode = linearRefusalOf(node);
        if (mode) return mode;
      }
    },
    drawHostGeometry(drawCamera: HostDrawCamera, output: HostDrawOutput) {
      if (!gl) throw new Error('HOST_SURFACE_MISSING');
      if (!opened) throw new Error('Draw before render');
      owner ??= new WebglClusterOwner(gl, materialDegraded);
      if (!owner.censused) owner.census(meshes(display));
      owner.toneCurve = TONE_MAPPING_RANK[output.toneMapping ?? DEFAULT_TONE_MAPPING];
      owner.pixelRatio = pixelRatio();
      display.onBeforeRender?.();
      try {
        walk();
        multiplyMatrix4Typed(screen, drawCamera.projection, drawCamera.view);
        order(opaque, seeThrough, screen);
        // A linear output is the effect chain's: its own program, which leaves the curve and the
        // encoding to the chain and marks the surfaces the curve skips.
        owner.draw(
          NO_BATCHES,
          display,
          drawCamera,
          output.toneMapped,
          !output.linear,
          opaque,
          seeThrough as readonly SceneCopy[],
          output.linear,
        );
      } finally {
        // A second draw of the same image — a capture — walks again, as every draw did.
        walked = false;
        display.onAfterRender?.();
      }
      counters.triangles = owner.submittedTriangles;
    },
  };
  return {
    render(_camera: HostCamera) {
      counters.triangles = 0;
      opened = true;
      walked = false;
    },
    host,
    counters: () => (opened ? counters : null),
    dispose() {
      lists.dispose();
      owner?.dispose();
      owner = undefined;
    },
  };
}
