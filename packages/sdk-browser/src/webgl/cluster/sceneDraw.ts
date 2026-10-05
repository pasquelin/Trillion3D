import { EngineError } from '../../../../sdk-core/src/index.ts';
import type { HostMaterials } from '../../host/resources.ts';
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
import { WebglClusterOwner, type TextureHosts } from './owner.ts';
import type { DeformationSource } from './deformation.ts';
import { createDrawOrder } from './drawOrder.ts';
import { loadHostVertices, meshes } from '../../scene/meshes.ts';
import { DEFAULT_PIXEL_RATIO } from '../../backend/common.ts';
import type { BackendHostDraw } from '../../backend/hostDraw.ts';
import type { BackendContext } from '../../backend/types.ts';
import { linearRefusalOf } from './linearRefusal.ts';
import { createDrawLists } from './drawLists.ts';
import { degradedHearer } from '../../world/diagnostic/materialNotices.ts';
import { upscaleMipBias } from '../../taa/jitter.ts';
import type { Light } from '../../../../sdk-core/src/world/light/light.ts';
/** What a WebGL2 frame reads of a display graph: its lights as `lights` gives them (the draw
 *  lists', none while the graph itself is hidden), its background and fog as they stand when the
 *  frame reads them. */
export const sceneRead = (display: Scene, lights: () => readonly Light[]): WebglClusterScene => ({
  get lights() {
    return lights();
  },
  get background() {
    return display.background;
  },
  get fog() {
    return display.fog;
  },
});
/** A drawn node, the engine's mesh, read by shape: drawn whole. */
type DrawnNode = Partial<SceneCopy> & {
  readonly matrixWorld: SceneCopy['matrixWorld'];
  readonly renderOrder: number;
};
/** What the session gives the draw: its pixel ratio, its degraded-surface notice and its
 *  diagnostics, where that notice is said when the session gives none, the texture bytes its
 *  census may upload ahead and a frame's upload budget (`textureQueue.ts`). */
type DrawHosts = Pick<BackendContext, 'pixelRatio' | 'materialDegraded' | 'onDiagnostic'> &
  TextureHosts & { deformation?: () => DeformationSource | undefined };
/** A scene draw hands the program no page batch: shared, so a frame allocates no empty list. */
const NO_BATCHES: readonly never[] = [];

/**
 * THE ENGINE'S DRAW OF A DISPLAY GRAPH: every visible mesh the graph holds, drawn whole by the
 * engine's program (`owner.ts`) in the scene's draw order — the opaque meshes by
 * `renderOrder`, surface and depth, then the see-through ones and the transparent copies `copies` names, by
 * `renderOrder` and from the farthest to the nearest; the program splits them into its
 * transmission and blend passes. The lights come from the same lists, the background off the graph.
 *
 * `render(camera)` opens the frame: it zeroes the counters, so that a frame the composer held — nothing
 * drawn — publishes nothing, never the previous draw; `counters()` is `null` before the first frame.
 * The graph's matrices and lists (`drawLists.ts`: the matrices of the subtrees that changed, the lists
 * walked again only when the graph changed shape) are brought up to date once per drawn image, at the
 * first of `host.linearRefusal` and `host.drawHostGeometry`: never on a held frame, and never in
 * `render`, which runs before the engine's frame writes the graph
 * (`../../backend/autonomous/pages.ts`). Asked first, that runs before `onBeforeRender`, whose one hook
 * (`../../lighting/unlitAlbedo.ts`) writes no field the lists read. Without a context (a session that
 * never draws on the host surface) the draw is refused by name. `pixelRatio`, read each frame, scales a
 * line's CSS-pixel width to the image's pixels; `materialDegraded` hears a surface drawn without a
 * physical feature or left out of the frame, said on `onDiagnostic` when the session gives no hearer.
 */
export function createSceneDraw(
  gl: WebGL2RenderingContext | undefined,
  display: Scene,
  copies: readonly object[] = [],
  { pixelRatio = () => DEFAULT_PIXEL_RATIO, ...hosts }: DrawHosts = {},
  declared: () => Iterable<HostMaterials> = () => meshes(display).map((mesh) => mesh.material),
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
  // What the frame reads of the graph: its lights from the lists, never from a walk of its own.
  const read = sceneRead(display, () => lists.lights);
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
      owner = censused(gl);
      owner.toneCurve = TONE_MAPPING_RANK[output.toneMapping ?? DEFAULT_TONE_MAPPING];
      // Drawn below the display (`world.renderScale`), a line keeps its display width and a
      // texture its display density.
      const shown = output.displayWidth ?? output.width;
      owner.pixelRatio = pixelRatio() * (output.width / shown);
      owner.mipBias = upscaleMipBias(output.width, shown);
      owner.deformation = hosts.deformation?.();
      display.onBeforeRender?.();
      try {
        walk();
        multiplyMatrix4Typed(screen, drawCamera.projection, drawCamera.view);
        order(opaque, seeThrough, screen);
        // A linear output is the effect chain's: its own program, which leaves the curve and the
        // encoding to the chain and marks the surfaces the curve skips.
        owner.draw(
          NO_BATCHES,
          read,
          drawCamera,
          output.toneMapped,
          !output.linear,
          opaque,
          seeThrough as readonly SceneCopy[],
          output.linear,
          output.pass,
        );
      } finally {
        // A second draw of the same image — a capture — walks again, as every draw did.
        walked = false;
        display.onAfterRender?.();
      }
      counters.triangles = owner.submittedTriangles;
    },
  };
  /** The owner, made at first need, its census taken at its first frame or preparation. */
  const censused = (context: WebGL2RenderingContext) => {
    owner ??= new WebglClusterOwner(context, degradedHearer(hosts));
    if (!owner.censused) owner.census(declared(), hosts);
    return owner;
  };
  return {
    /** Before the first frame: the host vertices of the copies drawn whole, which no session
     *  fetches up front, the program made, and the declared maps uploaded, a budget per task
     *  (`textureQueue.ts`), so no frame of the session waits on its first maps. */
    async prepare() {
      await Promise.all([
        loadHostVertices(copies as Parameters<typeof loadHostVertices>[0]),
        gl && censused(gl).prepareMaps(),
      ]);
    },
    render(_camera: HostCamera) {
      counters.triangles = 0;
      opened = true;
      walked = false;
    },
    materials: {
      async admitMaterial(material: HostMaterials) {
        if (!gl) throw new EngineError('UNSUPPORTED_SCENE_UPDATE', 'no WebGL context is open', {});
        const upload = censused(gl).admitMaterial(material);
        hosts.onDiagnostic?.({
          phase: 'material-texture-appended',
          message: 'A runtime map was uploaded',
          context: upload,
        });
      },
      releaseMaterial: (material: HostMaterials) => owner?.releaseMaterial(material),
    },
    host,
    counters: () => (opened ? counters : null),
    textureRoom: () => owner?.textureRoom ?? 0, // the impostor atlases' (`owner.ts`)
    dispose() {
      lists.dispose();
      owner = void owner?.dispose();
    },
  };
}
