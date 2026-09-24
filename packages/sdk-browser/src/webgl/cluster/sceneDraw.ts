import {
  DEFAULT_TONE_MAPPING,
  TONE_MAPPING_RANK,
} from '../../../../sdk-core/src/scene/core/environment.ts';
import type { HostDrawOutput } from '../core/renderTarget.ts';
import type { HostCamera, HostDrawCamera } from '../../camera/world.ts';
import type { WholeMesh } from '../../cluster/batchMesh.ts';
import type { HostDrawScene } from '../../host/scene/graphNodes.ts';
import { firstMaterial } from '../../scene/materialSide.ts';
import type { ClusterDrawScene } from './batchDraw.ts';
import type { SceneCopy } from './copyCulling.ts';
import { WebglClusterOwner } from './owner.ts';

/** A node of the display graph, read by shape: a mesh is drawn whole, anything else is walked. */
type DisplayNode = Partial<SceneCopy> & {
  readonly isMesh?: boolean;
  readonly visible: boolean;
  readonly id: number;
  readonly renderOrder: number;
  readonly children: readonly DisplayNode[];
};
type DisplayScene = ClusterDrawScene & {
  readonly children: readonly DisplayNode[];
  onBeforeRender?(): void;
  onAfterRender?(): void;
};

/** View-space depth of a mesh's origin: what the draw order of see-through meshes reads. */
const depthOf = (mesh: DisplayNode, view: ArrayLike<number>) => {
  const m = mesh.matrix!.elements;
  return view[2] * m[12] + view[6] * m[13] + view[10] * m[14] + view[14];
};

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
 * surface) the draw is refused by name.
 */
export function createSceneDraw(
  gl: WebGL2RenderingContext | undefined,
  display: HostDrawScene,
  copies: readonly object[] = [],
) {
  const scene = display as unknown as DisplayScene;
  const copied = new Set(copies as readonly DisplayNode[]);
  // Reused from frame to frame: a draw allocates no list.
  const opaque: WholeMesh[] = [],
    seeThrough: DisplayNode[] = [];
  let owner: WebglClusterOwner | undefined,
    view: ArrayLike<number> = [],
    opened = false;
  const counters = { triangles: 0 };
  const collect = (node: DisplayNode) => {
    if (!node.visible) return;
    if (node.isMesh) {
      if (copied.has(node) || firstMaterial(node.material!)?.transparent) seeThrough.push(node);
      else opaque.push(node as WholeMesh);
    }
    for (const child of node.children) collect(child);
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
  const frontToBack = (a: DisplayNode, b: DisplayNode) =>
    a.renderOrder - b.renderOrder ||
    rankOf(a as WholeMesh) - rankOf(b as WholeMesh) ||
    depthOf(b, view) - depthOf(a, view) ||
    a.id - b.id;
  const backToFront = (a: DisplayNode, b: DisplayNode) =>
    a.renderOrder - b.renderOrder || depthOf(a, view) - depthOf(b, view) || a.id - b.id;
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
      scene.onBeforeRender?.();
      try {
        scene.updateMatrixWorld();
        opaque.length = seeThrough.length = 0;
        for (const child of scene.children) collect(child);
        view = drawCamera.view;
        (opaque as DisplayNode[]).sort(frontToBack);
        seeThrough.sort(backToFront);
        owner.draw(
          [],
          scene,
          drawCamera,
          output.toneMapped,
          true,
          opaque,
          seeThrough as readonly SceneCopy[],
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
