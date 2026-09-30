import type { Texture } from '../../../../sdk-core/src/index.ts';
import { sourceSize } from '../../texture/pictureSize.ts';
import { textureRgba } from '../../visibility/types.ts';
import type { HostMaterials } from '../../host/resources.ts';
import { followHostTexture, hostTextureWrites } from '../../host/textureImport.ts';
import type { WebglClusterTextures } from './textures.ts';
import { eachMap, type Material } from './materialMaps.ts';
import { textureTransferBytesFor, textureUploadMsFor } from '../../residency/transferBudgets.ts';

/** Bytes a map's picture sends: RGBA, one byte a channel; its mip chain is reduced on the GPU. */
const sentBytes = (width: number, height: number) => width * height * 4;
/** Bytes a map holds on the context: its picture, and a third more for its mip chain. */
const heldBytes = (width: number, height: number) => Math.ceil((sentBytes(width, height) * 4) / 3);

/** A map's texel size (`sourceSize`), or undefined while it has no picture to send. */
const pictureOf = (texture: Texture) =>
  textureRgba(texture) || texture.image ? sourceSize(texture) : undefined;

/**
 * WHAT A FRAME MAY UPLOAD OF THE MAPS (#840), WebGPU's tile budget on WebGL2: the bytes and the CPU
 * milliseconds the session declares (`maxTextureTransferBytesPerFrame`,
 * `maxTextureUploadMsPerFrame`), 16 MiB and 1 ms by default (`transferBudgets.ts`). A map a draw
 * binds is never refused — WebGL2 holds no coarser level of a map not yet sent, and drawn without
 * it the surface would lose its picture —, so what the budget holds is the queue's: the maps the
 * census orders ahead of any draw, each sent only if its bytes fit what the frame has left
 * (`fits`), then charged with them and the milliseconds it took. A map larger than the whole budget
 * is sent alone, in a frame that sent nothing else — as a WebGPU tile pass always lands one tile.
 * Each drain of the queue opens it before anything is uploaded (`beginFrame`).
 */
class WebglUploadBudget {
  private bytes = 0;
  private ms = 0;
  private budgetBytes = textureTransferBytesFor(undefined);
  private budgetMs = textureUploadMsFor(undefined);
  /** The session's budgets; none declared keeps the defaults. */
  declare(bytes: number | undefined, ms: number | undefined) {
    this.budgetBytes = textureTransferBytesFor(bytes);
    this.budgetMs = textureUploadMsFor(ms);
  }
  beginFrame() {
    this.bytes = this.ms = 0;
  }
  charge(bytes: number, ms: number) {
    this.bytes += bytes;
    this.ms += ms;
  }
  /** Whether the frame may upload a map of `bytes` ahead of its draws. */
  fits(bytes: number) {
    if (this.ms >= this.budgetMs) return false;
    return this.bytes + bytes <= this.budgetBytes || this.bytes === 0;
  }
}

/** What a map's first bind is called with. */
type Bind = [
  unit: number,
  texture: Texture,
  srgb: boolean,
  fallback: readonly number[] | undefined,
  reader: boolean,
];
/** A map queued ahead: its bind, and the bytes its picture sends. */
type Ahead = [...Bind, sent: number];

/**
 * THE MAPS UPLOADED AHEAD OF THE DRAWS (#840). A picture sent to WebGL2 is copied through the
 * context's transfer memory; a map uploaded at the first draw that shows it held that frame
 * 100–140 ms on sponza `rue`. The census orders every map of the declared surfaces (`eachMap`, the
 * draw's own walk: same textures, same keys), attached or not, until the maps it counts reach the
 * texture pool — the bytes the session grants; each frame then uploads the next ones, before its
 * draws, while they fit its budget (`WebglUploadBudget`) and only once the GPU passed the frame
 * before (`drain`). A map whose picture was not there yet at the census waits for it (`promote`):
 * the first drain that finds it sends it ahead of the draw that would have bound it, as that bind
 * is the hitch. Anything past the pool is left to its first draw; a refused one is sent again at
 * its next bind (`chainAllocated`, `mips.ts`).
 */
export class WebglTextureQueue {
  /** What a frame may upload of the queue, opened at each drain. */
  readonly budget = new WebglUploadBudget();
  private queue: Ahead[] = [];
  private next = 0;
  /** The declared maps still without a picture, until it arrives (`promote`). */
  private pending: Bind[] = [];
  /** The host writes `promote` last saw: none since, no picture can have arrived. */
  private seen = 0;
  /** The census' pool and the bytes it holds; a map promoted later obeys the same pool. */
  private poolBytes = 0;
  private held = 0;
  /** Queues `bind` into `into` if the pool has room left; false past the pool. */
  private admit(into: Ahead[], bind: Bind, [width, height]: [number, number]) {
    if (this.held >= this.poolBytes) return false;
    this.held += heldBytes(width, height);
    into.push([...bind, sentBytes(width, height)]);
    return true;
  }
  /** Orders the maps of `declared` within `poolBytes`. */
  order(declared: Iterable<HostMaterials>, poolBytes: number) {
    const materials = new Set<Material>(),
      counted = new Set<Texture>();
    this.queue.length = this.next = 0;
    this.pending.length = 0;
    this.poolBytes = poolBytes;
    this.held = 0;
    this.seen = hostTextureWrites();
    for (const material of declared)
      for (const one of Array.isArray(material) ? material : [material])
        materials.add(one as Material);
    for (const material of materials)
      eachMap(
        material,
        (unit, _map, texture, srgb, fallback, reader) => {
          if (!texture || counted.has(texture)) return;
          counted.add(texture);
          // Brought up to its host first: a picture written before the census, not followed yet,
          // would otherwise wait in `pending` for a later write that may never come.
          followHostTexture(texture);
          const bind: Bind = [unit, texture, srgb, fallback, reader],
            size = pictureOf(texture);
          // No picture yet: held until it arrives (`promote`). Past the pool: left to its first draw.
          if (size) this.admit(this.queue, bind, size);
          else this.pending.push(bind);
        },
        true,
      );
  }
  /** The end of the last frame's commands: the queue uploads again once the GPU passed it. */
  private fence: WebGLSync | null = null;
  /**
   * Moves the declared maps whose picture has arrived since the census into the queue, ahead of the
   * draws. Each drain does it before its uploads, so a map that arrived late is sent before the
   * draw that would have bound it — the bind this queue exists to keep off the frame. A map past
   * the pool is left to its first draw, as at the census.
   */
  private promote() {
    if (!this.pending.length || this.seen === hostTextureWrites()) return;
    this.seen = hostTextureWrites();
    // The pool only fills: once full, no waiting map can be queued any more.
    if (this.held >= this.poolBytes) {
      this.pending.length = 0;
      return;
    }
    const ready: Ahead[] = [];
    this.pending = this.pending.filter((bind) => {
      followHostTexture(bind[1]);
      const size = pictureOf(bind[1]);
      if (size) this.admit(ready, bind, size);
      return !size;
    });
    this.queue.splice(this.next, 0, ...ready);
  }
  /**
   * Before a frame's commands: moves in the maps whose picture arrived (`promote`), then uploads
   * the next ones while they fit its budget, once the GPU ran every command of the last frame. An
   * upload sent while the GPU process is behind waits for it: sponza `rue` held frames 90–120 ms
   * on one map sent after the frame's draws; sent before them, the GPU idle, the same map took a
   * millisecond.
   */
  drain(gl: WebGL2RenderingContext, textures: Pick<WebglClusterTextures, 'bind'>) {
    this.promote(); // no GL call: a picture that arrived is queued even while the GPU is behind
    if (this.fence && gl.getSyncParameter(this.fence, gl.SYNC_STATUS) !== gl.SIGNALED) return;
    const budget = this.budget;
    budget.beginFrame();
    while (this.next < this.queue.length && budget.fits(this.queue[this.next][5])) {
      const [unit, texture, srgb, fallback, reader, sent] = this.queue[this.next++],
        began = performance.now();
      textures.bind(unit, texture, srgb, fallback, reader);
      budget.charge(sent, performance.now() - began);
    }
  }
  /**
   * Before the session's first frame: the queue drained a budget per task, each task waiting for
   * the GPU to pass the last, so the frames find their maps sent (sponza `rue` drew one map first
   * bound mid-trajectory in a frame of 160–220 ms). The main thread is yielded between tasks.
   */
  async prepare(gl: WebGL2RenderingContext, textures: Pick<WebglClusterTextures, 'bind'>) {
    while (this.next < this.queue.length && !gl.isContextLost()) {
      this.drain(gl, textures);
      this.frameEnd(gl);
      gl.flush();
      await new Promise((resume) => setTimeout(resume, 0));
    }
  }
  /** After a frame's commands, while maps wait: the point the next drain waits for the GPU to
   *  pass. A fence not passed yet is kept, so a GPU always a frame behind still lets maps through. */
  frameEnd(gl: WebGL2RenderingContext) {
    const { fence } = this;
    if (fence && gl.getSyncParameter(fence, gl.SYNC_STATUS) !== gl.SIGNALED) return;
    if (fence) gl.deleteSync(fence);
    this.fence =
      this.next < this.queue.length ? gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0) : null;
  }
}
