import type { GpuBuffer, WholeMesh } from '../../cluster/batchMesh.ts';
import { upload, type CachedAttribute } from './buffers.ts';

/** Four vec4 columns: one location each for the placement matrix. */
const COLUMNS = 4;
type Placed = CachedAttribute & { release?: () => void; owner?: Set<() => void> };

/**
 * The placement matrices of the instanced meshes the program draws: one buffer per mesh, uploaded
 * when its rows were written, freed when the mesh is given back.
 */
export class WebglClusterPlacements {
  private buffers = new Map<GpuBuffer, Placed>();
  private gl: WebGL2RenderingContext;
  private location: number;
  constructor(gl: WebGL2RenderingContext, location: number) {
    this.gl = gl;
    this.location = location;
  }
  /**
   * Points the bound vertex array at the matrices of `mesh`, one column per location, advancing
   * once per copy drawn — or at none for a mesh drawn once. `current` is what the array reads now;
   * it is pointed again only when that changes. Returns what it reads after.
   */
  bind(current: GpuBuffer | null, mesh?: Pick<WholeMesh, 'instanceMatrix' | 'released'>) {
    const gl = this.gl,
      location = this.location,
      source = mesh?.instanceMatrix ?? null;
    if (location < 0) return current;
    if (!source) {
      if (current) for (let c = 0; c < COLUMNS; c++) gl.disableVertexAttribArray(location + c);
      return null;
    }
    const entry = this.upload(source, mesh!.released);
    if (current === source) return current;
    gl.bindBuffer(gl.ARRAY_BUFFER, entry.buffer);
    for (let c = 0; c < COLUMNS; c++) {
      gl.enableVertexAttribArray(location + c);
      gl.vertexAttribPointer(location + c, 4, gl.FLOAT, false, 64, c * 16);
      gl.vertexAttribDivisor(location + c, 1);
    }
    return source;
  }
  /** The buffer of `source`, its rows sent again when written; a new one is freed with its mesh. */
  private upload(source: GpuBuffer, released?: Set<() => void>) {
    const known = this.buffers.get(source),
      entry: Placed = upload(this.gl, this.gl.ARRAY_BUFFER, source, known);
    if (known) return entry;
    this.buffers.set(source, entry);
    if (!released) return entry;
    entry.release = () => {
      this.buffers.delete(source);
      this.gl.deleteBuffer(entry.buffer);
    };
    entry.owner = released;
    released.add(entry.release);
    return entry;
  }
  dispose() {
    for (const entry of this.buffers.values()) {
      this.gl.deleteBuffer(entry.buffer);
      if (entry.release) entry.owner?.delete(entry.release);
    }
    this.buffers.clear();
  }
}
