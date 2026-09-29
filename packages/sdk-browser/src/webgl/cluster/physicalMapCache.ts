import type { Texture } from '../../../../sdk-core/src/index.ts';
export type PhysicalMapEntry = {
  texture: WebGLTexture;
  bytes: number;
  sources: readonly Texture[];
  owners: Set<object>;
};
/** Shared immutable image tuples, retained only by live material declarations. */
export class PhysicalMapCache {
  readonly tuples = new Map<string, PhysicalMapEntry>();
  private owners = new Map<object, string>();
  private gl: WebGL2RenderingContext;
  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
  }
  get bytes() {
    return [...this.tuples.values()].reduce((sum, entry) => sum + entry.bytes, 0);
  }
  retain(owner: object, key: string) {
    if (this.owners.get(owner) !== key) this.release(owner);
    this.owners.set(owner, key);
    const entry = this.tuples.get(key)!;
    entry.owners.add(owner);
    return entry;
  }
  release(owner: object) {
    const key = this.owners.get(owner);
    if (key === undefined) return;
    this.owners.delete(owner);
    const entry = this.tuples.get(key)!;
    entry.owners.delete(owner);
    if (!entry.owners.size) this.drop(key);
  }
  drop(key: string) {
    const entry = this.tuples.get(key);
    if (!entry) return;
    for (const owner of entry.owners) this.owners.delete(owner);
    this.tuples.delete(key);
    this.gl.deleteTexture(entry.texture);
  }
  releaseTexture(texture: Texture) {
    for (const [key, entry] of this.tuples) if (entry.sources.includes(texture)) this.drop(key);
  }
  census(declared: ReadonlySet<object>) {
    for (const owner of this.owners.keys()) if (!declared.has(owner)) this.release(owner);
  }
  dispose() {
    for (const key of this.tuples.keys()) this.drop(key);
  }
}
