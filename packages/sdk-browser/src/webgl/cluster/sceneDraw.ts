import type { GraphScene } from '../../host/graph/scene.ts';
import {
  DEFAULT_TONE_MAPPING,
  TONE_MAPPING_RANK,
} from '../../../../sdk-core/src/scene/core/environment.ts';
import { multiplyMatrix4Typed } from '../../../../sdk-core/src/math/matrix/matrix4Typed.ts';
import type { HostDrawOutput } from '../core/renderTarget.ts';
import type { HostCamera, HostDrawCamera } from '../../camera/world.ts';
import type { WholeMesh } from '../../cluster/batchMesh.ts';
import { firstMaterial } from '../../scene/materialSide.ts';
import type { WebglClusterScene } from './lights.ts';
import type { SceneCopy } from './copyCulling.ts';
import { WebglClusterOwner } from './owner.ts';
import { depthOf } from './meshDepth.ts';
import { DEFAULT_PIXEL_RATIO } from '../../backend/common.ts';

/** The scene the owner reads for its lights and background, its world matrices resolved
 *  before the read. */
export type ClusterDrawScene = WebglClusterScene & { updateMatrixWorld(): void };

/** A node of the display graph, read by shape: a mesh is drawn whole, anything else is walked. */
type DisplayNode = Partial<SceneCopy> & {
  readonly matrixWorld: SceneCopy['matrixWorld'];
  readonly kind?: string;
  readonly visible: boolean;
  readonly renderOrder: number;
  readonly children: readonly DisplayNode[];
};
/** A drawn node: the engine's mesh, numbered in creation order (a group or a bare node is not). */
type DrawnNode = DisplayNode & { readonly serial: number };
type DisplayScene = ClusterDrawScene & {
  readonly children: readonly DisplayNode[];
  onBeforeRender?(): void;
  onAfterRender?(): void;
};

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
 * `null` before the first frame. Without a context (a session that never draws on the host
 * surface) the draw is refused by name. `pixelRatio`, read each frame, scales a line's CSS-pixel
 * width to the image's pixels.
 */
export function createSceneDraw(
  gl: WebGL2RenderingContext | undefined,
  display: GraphScene,
  copies: readonly object[] = [],
  pixelRatio: () => number = () => DEFAULT_PIXEL_RATIO,
) {
  const scene: DisplayScene = display;
  // The copies list grows with the placement rows (`growBlendCopies`): the set follows it.
  const copied = new Set<DisplayNode>();
  const followCopies = () => {
    for (let i = copied.size; i < copies.length; i++) copied.add(copies[i] as DisplayNode);
  };
  // Reused from frame to frame: a draw allocates no list. `hidden`: the meshes not drawn, whose
  // surfaces still read their maps — a map's mip rule never follows visibility (#42).
  const opaque: WholeMesh[] = [],
    seeThrough: DrawnNode[] = [],
    hidden: WholeMesh[] = [];
  let owner: WebglClusterOwner | undefined,
    opened = false;
  // The projection times the view, and each drawn mesh's depth, read once a frame.
  const screen = new Float64Array(16),
    depths = new Map<DisplayNode, number>();
  const depth = (node: DisplayNode) => depths.get(node)!;
  const counters = { triangles: 0 };
  const collect = (node: DisplayNode, shown: boolean) => {
    const drawn = shown && node.visible;
    if (node.kind === 'mesh' || node.kind === 'instancedMesh') {
      if (!drawn) hidden.push(node as WholeMesh);
      else if (copied.has(node) || firstMaterial(node.material!)?.transparent)
        seeThrough.push(node as DrawnNode);
      else opaque.push(node as WholeMesh);
      if (drawn) depths.set(node, depthOf(node, screen));
    }
    for (const child of node.children) collect(child, drawn);
  };
  // Opaque meshes of one order are grouped by surface, numbered as first met, as the reference
  // groups them by the surfaces it numbers as it meets them — a run of one surface binds it once
  // —, then drawn from the nearest; a tie is broken by the node's number, as the reference's is.
  const ranks = new WeakMap<object, number>();
  let nextRank = 0;
  const rankOf = (mesh: WholeMesh) => {
    const surface = mesh.material as object;
    let rank = ranks.get(surface);
    if (rank === undefined) ranks.set(surface, (rank = nextRank++));
    return rank;
  };
  const frontToBack = (a: DrawnNode, b: DrawnNode) =>
    a.renderOrder - b.renderOrder ||
    rankOf(a as WholeMesh) - rankOf(b as WholeMesh) ||
    depth(a) - depth(b) ||
    a.serial - b.serial;
  const backToFront = (a: DrawnNode, b: DrawnNode) =>
    a.renderOrder - b.renderOrder || depth(b) - depth(a) || a.serial - b.serial;
  return {
    render(_camera: HostCamera) {
      counters.triangles = 0;
      opened = true;
    },
    drawHostGeometry(drawCamera: HostDrawCamera, output: HostDrawOutput) {
      if (!gl) throw new Error('HOST_SURFACE_MISSING');
      if (!opened) throw new Error('Draw before render');
      owner ??= new WebglClusterOwner(gl);
      owner.toneCurve = TONE_MAPPING_RANK[output.toneMapping ?? DEFAULT_TONE_MAPPING];
      owner.pixelRatio = pixelRatio();
      scene.onBeforeRender?.();
      try {
        scene.updateMatrixWorld();
        opaque.length = seeThrough.length = hidden.length = 0;
        depths.clear();
        followCopies();
        multiplyMatrix4Typed(screen, drawCamera.projection, drawCamera.view);
        for (const child of scene.children) collect(child, true);
        (opaque as DrawnNode[]).sort(frontToBack);
        seeThrough.sort(backToFront);
        // A linear output is the effect chain's: its own program, which leaves the curve and the
        // encoding to the chain and marks the surfaces the curve skips.
        owner.draw(
          NO_BATCHES,
          scene,
          drawCamera,
          output.toneMapped,
          !output.linear,
          opaque,
          seeThrough as readonly SceneCopy[],
          output.linear,
          hidden,
        );
      } finally {
        scene.onAfterRender?.();
      }
      counters.triangles = owner.submittedTriangles;
    },
    counters: () => (opened ? counters : null),
    dispose() {
      owner?.dispose();
      owner = undefined;
    },
  };
}
