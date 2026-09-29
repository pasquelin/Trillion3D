import {
  isClusterDrawMesh,
  type ClusterDraw,
  type GpuBuffer,
  type WholeMesh,
} from '../../cluster/batchMesh.ts';
import { isInstancedNode } from '../../host/graph/kinds.ts';
import { WebglPageArena, type ArenaAttribute } from './pageArena.ts';
import { ATTRIBUTES, drawnAttribute } from './geometry.ts';

/** What the arenas read of a mesh's geometry. */
type Geometry = WholeMesh['geometry'];

/** A page placed in an arena: its ranges, and the buffers and versions it was placed from. */
export type ArenaSlot = {
  arena: WebglPageArena;
  vertex: number;
  vertices: number;
  /** First index in the arena's index buffer, indices reserved, and indices drawn. */
  first: number;
  reserved: number;
  count: number;
  sources: (GpuBuffer | undefined)[];
  versions: number[];
  release: () => void;
  checked: number;
};

/**
 * THE SHARED BUFFERS OF THE PAGES (#840): every mesh drawn once, of an engine geometry — one that
 * announces its release — with 32-bit indices and float attributes, is placed in the arena of its
 * vertex layout (`pageArena.ts`) instead of buffers of its own, and freed from it with its
 * geometry. Any other mesh — instanced, a batch record, a host geometry, packed attributes — keeps
 * its own (`geometry.ts`), and is drawn exactly as before. A geometry rewritten once placed —
 * read once a frame — leaves for buffers of its own, where a rewrite sends only what changed.
 */
export class WebglPageArenas {
  private arenas = new Map<string, WebglPageArena>();
  private slots = new Map<Geometry, ArenaSlot>();
  private refused = new WeakSet<Geometry>();
  private gl: WebGL2RenderingContext;
  private locations: Record<string, number>;
  private frame = 0;
  constructor(gl: WebGL2RenderingContext, locations: Record<string, number>) {
    this.gl = gl;
    this.locations = locations;
  }
  /** A new frame: every placement is checked again at its first draw. */
  beginFrame() {
    this.frame++;
  }
  /** Where `mesh` is drawn from: its arena slot, or undefined when it keeps its own buffers. */
  slot(mesh: ClusterDraw) {
    if (isClusterDrawMesh(mesh) || isInstancedNode(mesh)) return;
    const geometry = (mesh as WholeMesh).geometry;
    let slot = this.slots.get(geometry);
    if (slot && slot.checked !== this.frame && !this.current(slot, geometry)) {
      this.free(geometry, slot);
      this.refused.add(geometry);
      slot = undefined;
    }
    slot ??= this.refused.has(geometry) ? undefined : this.place(geometry);
    if (slot) slot.checked = this.frame;
    return slot;
  }
  private current(slot: ArenaSlot, geometry: Geometry) {
    const { sources, versions } = slot;
    if (sources[0] !== geometry.index || versions[0] !== geometry.index?.version) return false;
    for (let i = 0; i < ATTRIBUTES.length; i++) {
      const attribute = this.read(geometry, i);
      if (attribute !== sources[i + 1] || (attribute && attribute.version !== versions[i + 1]))
        return false;
    }
    return true;
  }
  /** The attribute `i` of `ATTRIBUTES` the program reads off `geometry`, if any. */
  private read(geometry: Geometry, i: number) {
    return this.locations[ATTRIBUTES[i]] < 0 ? undefined : drawnAttribute(geometry, ATTRIBUTES[i]);
  }
  private place(geometry: Geometry) {
    const index = geometry.index,
      released = geometry.released,
      position = geometry.attributes.position;
    if (!index || !(index.array instanceof Uint32Array) || !released || !position)
      return void this.refused.add(geometry);
    const layout: ArenaAttribute[] = [],
      arrays: ArrayBufferView[] = [],
      sources: (GpuBuffer | undefined)[] = [index],
      versions = [index.version];
    for (let i = 0; i < ATTRIBUTES.length; i++) {
      const attribute = this.read(geometry, i);
      sources.push(attribute);
      versions.push(attribute?.version ?? -1);
      if (!attribute) continue;
      if (!(attribute.array instanceof Float32Array) || attribute.normalized)
        return void this.refused.add(geometry);
      const name = ATTRIBUTES[i];
      layout.push({ name, location: this.locations[name], size: attribute.itemSize });
      arrays.push(attribute.array);
    }
    const key = layout.map(({ name, size }) => `${name}${size}`).join(','),
      arena = this.arena(key, layout),
      vertices = position.count,
      { vertex, first } = arena.place(arrays, vertices, index.array);
    const slot: ArenaSlot = {
      arena,
      vertex,
      vertices,
      first,
      reserved: index.array.length,
      count: index.count,
      sources,
      versions,
      release: () => this.free(geometry, slot),
      checked: this.frame,
    };
    released.add(slot.release);
    this.slots.set(geometry, slot);
    return slot;
  }
  private arena(key: string, layout: readonly ArenaAttribute[]) {
    let arena = this.arenas.get(key);
    if (!arena) {
      const made = new WebglPageArena(this.gl, layout, () => this.lose(key, made));
      this.arenas.set(key, (arena = made));
    }
    return arena;
  }
  private free(geometry: Geometry, slot: ArenaSlot) {
    geometry.released?.delete(slot.release);
    this.slots.delete(geometry);
    slot.arena.release(slot.vertex, slot.vertices, slot.first, slot.reserved);
  }
  /** A growth refused: the arena is given up, its pages placed again at their next draw. */
  private lose(key: string, arena: WebglPageArena) {
    if (this.arenas.get(key) !== arena) return;
    this.arenas.delete(key);
    for (const [geometry, slot] of this.slots)
      if (slot.arena === arena) {
        geometry.released?.delete(slot.release);
        this.slots.delete(geometry);
      }
    arena.dispose();
  }
  dispose() {
    for (const [key, arena] of this.arenas) this.lose(key, arena);
  }
}
