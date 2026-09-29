import type { ClusterDrawMesh, WholeMesh } from '../../cluster/batchMesh.ts';
import { TONE_MAPPING_RANK } from '../../../../sdk-core/src/index.ts';
import { WebglClusterRenderer } from './renderer.ts';
import type { WebglClusterScene } from './lights.ts';
import type { SceneCopy } from './copyCulling.ts';
import type { HostDrawCamera } from '../../camera/world.ts';
import type { HostMaterials } from '../../host/resources.ts';
import type { BackendContext } from '../../backend/types.ts';
import { takeOutOfMemory } from '../core/allocation.ts';
import { outOfMemoryContext } from '../../residency/outOfMemory.ts';
import { sendEngineDiagnostic } from '../../diagnostic/engineDiagnostic.ts';
import { readDegraded, type MaterialDegraded, type ReadDegraded } from './validation.ts';

/** What the session grants the maps: the texture pool and a frame's upload budget. */
type TextureHosts = { texturePoolBytes: number } & Pick<
  BackendContext,
  'maxTextureTransferBytesPerFrame' | 'maxTextureUploadMsPerFrame'
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
    this.renderer = this.display = new WebglClusterRenderer(this.context);
    this.censused = false;
  };
  censused = false;
  /** Files every declared surface, hidden or not yet attached ones too — WebGPU's census at
   *  prepare (#42) —; a later one at bind. Then orders their maps within the texture pool, which
   *  the frames upload ahead of their draws under the session's budget (`textureQueue.ts`). */
  census(materials: Iterable<HostMaterials>, hosts: TextureHosts) {
    const declared = new Set(materials),
      { textures } = this.display;
    for (const material of declared) textures.file(material);
    textures.ahead.order(declared, hosts.texturePoolBytes);
    textures.budget.declare(
      hosts.maxTextureTransferBytesPerFrame,
      hosts.maxTextureUploadMsPerFrame,
    );
    this.censused = true;
  }
  /** Uploads the maps the census queued before any frame, a budget per task (`textureQueue.ts`). */
  prepareMaps() {
    const { textures } = this.display;
    return textures.ahead.prepare(this.context, textures, textures.budget);
  }
  /** Reads the surfaces drawn without a physical feature for `hear`, across context restores. */
  private degraded: ReadDegraded | undefined;
  /** Hears the refusal of a map (`gpu-out-of-memory`). */
  private onDiagnostic: BackendContext['onDiagnostic'];
  constructor(
    context: WebGL2RenderingContext,
    hear?: MaterialDegraded,
    onDiagnostic?: BackendContext['onDiagnostic'],
  ) {
    this.context = context;
    this.onDiagnostic = onDiagnostic;
    this.degraded = hear && readDegraded(hear);
    this.renderer = this.display = new WebglClusterRenderer(context);
    context.canvas.addEventListener('webglcontextrestored', this.restored);
  }
  /** The display curve of the frames to come, a rank of `TONE_MAPPING_RANK`. */
  toneCurve: number = TONE_MAPPING_RANK.aces;
  /** Image pixels per CSS pixel of the frames to come: the scale of a line's width. */
  pixelRatio = 1;
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
    if (linear) this.linear ??= new WebglClusterRenderer(this.context, this.display);
    const renderer = (this.renderer = linear ? this.linear! : this.display),
      { textures } = this.display;
    renderer.toneCurve = this.toneCurve;
    renderer.pass.pixelRatio = this.pixelRatio;
    // A map refused since the last frame: the maps uploaded ahead stop at half the pool.
    if (takeOutOfMemory(this.context, 'texture')) {
      const { before, after } = textures.ahead.outOfMemory();
      const refused = outOfMemoryContext('texture', before.allocatedBytes, after);
      sendEngineDiagnostic(this.onDiagnostic, 'gpu-out-of-memory', 'WebGL2 refused a map', refused);
    }
    // The maps uploaded ahead, first: the frame's commands not sent yet (`textureQueue.ts`).
    textures.budget.beginFrame();
    textures.ahead.drain(this.context, textures, textures.budget);
    const submitted = renderer.draw(
      meshes,
      scene,
      camera,
      toneMapped,
      srgbDestination,
      diagnosticMeshes,
      copies,
      this.degraded,
    );
    textures.ahead.frameEnd(this.context);
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
