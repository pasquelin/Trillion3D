import type { ClusterDrawMesh, WholeMesh } from '../../cluster/batchMesh.ts';
import { TONE_MAPPING_RANK } from '../../../../sdk-core/src/index.ts';
import { WebglClusterRenderer } from './renderer.ts';
import type { WebglClusterScene } from './lights.ts';
import type { SceneCopy } from './copyCulling.ts';
import type { HostDrawCamera } from '../../camera/world.ts';
import type { HostMaterials } from '../../host/resources.ts';
import type { BackendContext } from '../../backend/types.ts';
import { DEFAULT_TEXTURE_POOL_BUDGET } from '../../residency/pools.ts';
import { WebglTextureQueue } from './textureQueue.ts';
import { readDegraded, type MaterialDegraded, type ReadDegraded } from './validation.ts';

/** What the session grants the maps: the texture pool and a frame's upload budget. */
export type TextureHosts = Pick<
  BackendContext,
  'texturePoolBytes' | 'maxTextureTransferBytesPerFrame' | 'maxTextureUploadMsPerFrame'
>;

/**
 * The one draw owner of a session's paged clusters, diagnostic pages and scene copies. A draw
 * into the effect chain's linear target (`linear`) goes through a second program, made at the
 * first such draw, which shares the first's vertex arrays, maps and backdrop: a session that never
 * draws a chain compiles and binds exactly what it did without one.
 */
export class WebglClusterOwner {
  private display: WebglClusterRenderer;
  private linear: WebglClusterRenderer | undefined;
  /** The renderer of the last draw, whose counters the getters report. */
  private renderer: WebglClusterRenderer;
  private context: WebGL2RenderingContext;
  private restored = () => {
    this.release();
    this.renderer = this.display = new WebglClusterRenderer(this.context, this.degraded);
    this.censused = false;
  };
  censused = false;
  /** The maps the census orders ahead of the draws, under a frame's upload budget. */
  private ahead = new WebglTextureQueue();
  /** Files every declared surface, hidden or not yet attached ones too — WebGPU's census at
   *  prepare (#42) —; a later one at bind. Then orders their maps within the texture pool, which
   *  the frames upload ahead of their draws under the session's budget (`textureQueue.ts`). */
  census(materials: Iterable<HostMaterials>, hosts: TextureHosts) {
    const declared = new Set(materials);
    for (const material of declared) this.display.textures.file(material);
    this.ahead.order(declared, hosts.texturePoolBytes ?? DEFAULT_TEXTURE_POOL_BUDGET);
    this.ahead.budget.declare(
      hosts.maxTextureTransferBytesPerFrame,
      hosts.maxTextureUploadMsPerFrame,
    );
    this.censused = true;
  }
  /** Reads the surfaces drawn without a physical feature, or left out, for `hear`, across
   *  context restores: required, so no caller silently loses the notice. */
  private degraded: ReadDegraded;
  constructor(context: WebGL2RenderingContext, hear: MaterialDegraded) {
    this.context = context;
    this.degraded = readDegraded(hear);
    this.renderer = this.display = new WebglClusterRenderer(context, this.degraded);
    context.canvas.addEventListener('webglcontextrestored', this.restored);
  }
  /** Uploads the maps the census queued before any frame, a budget per task (`textureQueue.ts`). */
  prepareMaps() {
    return this.ahead.prepare(this.context, this.display.textures);
  }
  /** The display curve of the frames to come, a rank of `TONE_MAPPING_RANK`. */
  toneCurve: number = TONE_MAPPING_RANK.aces;
  /** Image pixels per CSS pixel of the frames to come: the scale of a line's width; and their
   *  texture level offset, zero at the display's size. */
  pixelRatio = 1;
  mipBias = 0;
  get backdropBytes() {
    return this.renderer.backdropBytes;
  }
  get copySubmissions() {
    return this.renderer.copySubmissions;
  }
  get backdropPasses() {
    return this.renderer.backdropPasses;
  }
  /** Triangles the last frame submitted, every pass included. */
  get submittedTriangles() {
    return this.renderer.triangles;
  }
  get backdropSubmissions() {
    return this.renderer.backdropSubmissions;
  }
  draw(
    meshes: readonly ClusterDrawMesh[],
    scene: WebglClusterScene,
    camera: HostDrawCamera,
    toneMapped: boolean,
    srgbDestination: boolean,
    diagnosticMeshes: readonly WholeMesh[] = [],
    copies: readonly SceneCopy[] = [],
    linear = false,
  ) {
    if (linear) this.linear ??= new WebglClusterRenderer(this.context, this.degraded, this.display);
    const renderer = (this.renderer = linear ? this.linear! : this.display);
    renderer.toneCurve = this.toneCurve;
    renderer.pass.pixelRatio = this.pixelRatio;
    renderer.pass.mipBias = this.mipBias;
    // The maps uploaded ahead, first: the frame's commands not sent yet (`textureQueue.ts`).
    this.ahead.drain(this.context, this.display.textures);
    const submitted = renderer.draw(
      meshes,
      scene,
      camera,
      toneMapped,
      srgbDestination,
      diagnosticMeshes,
      copies,
    );
    this.ahead.frameEnd(this.context);
    return submitted;
  }
  private release() {
    this.linear?.dispose();
    this.linear = undefined;
    this.display.dispose();
  }
  dispose() {
    this.context.canvas.removeEventListener('webglcontextrestored', this.restored);
    this.release();
  }
}
