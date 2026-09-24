/**
 * Append-only file output for large glTF products: bytes are gathered into chunks of a few
 * megabytes and written in order, so a world of millions of triangles and hundreds of thousands
 * of nodes never becomes one string or one buffer in memory.
 */
import { open, type FileHandle } from 'node:fs/promises';

const FLUSH_BYTES = 4 * 1024 * 1024;

export type Sink = {
  /** Bytes written so far (flushed or pending). */
  readonly length: number;
  write(bytes: Uint8Array | string): Promise<void>;
  close(): Promise<void>;
};

/** An append-only sink on `path`, truncated first. */
export async function fileSink(path: string): Promise<Sink> {
  const handle: FileHandle = await open(path, 'w');
  let pending: Buffer[] = [],
    pendingBytes = 0,
    length = 0;
  const flush = async () => {
    if (!pendingBytes) return;
    const chunk = Buffer.concat(pending, pendingBytes);
    pending = [];
    pendingBytes = 0;
    await handle.write(chunk);
  };
  return {
    get length() {
      return length;
    },
    async write(bytes) {
      const buffer =
        typeof bytes === 'string'
          ? Buffer.from(bytes, 'utf8')
          : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      // The caller may reuse its array: keep a copy, not a view.
      pending.push(Buffer.from(buffer));
      pendingBytes += buffer.length;
      length += buffer.length;
      if (pendingBytes >= FLUSH_BYTES) await flush();
    },
    async close() {
      await flush();
      await handle.close();
    },
  };
}

/** Accessor and view tables of one binary buffer, written as data is appended. */
type BinaryTables = {
  bufferViews: { buffer: 0; byteOffset: number; byteLength: number; target: number }[];
  accessors: {
    bufferView: number;
    componentType: number;
    type: 'SCALAR' | 'VEC2' | 'VEC3';
    count: number;
    min?: number[];
    max?: number[];
  }[];
};

const ARRAY_BUFFER = 34962,
  ELEMENT_ARRAY_BUFFER = 34963,
  FLOAT = 5126,
  UNSIGNED_INT = 5125;

/** Appends vertex and index arrays to `bin`, 4-byte aligned, and records their accessors. */
export function binaryWriter(bin: Sink) {
  const tables: BinaryTables = { bufferViews: [], accessors: [] };
  const append = async (data: Float32Array | Uint32Array, target: number) => {
    const padding = (4 - (bin.length % 4)) % 4;
    if (padding) await bin.write(new Uint8Array(padding));
    tables.bufferViews.push({
      buffer: 0,
      byteOffset: bin.length,
      byteLength: data.byteLength,
      target,
    });
    await bin.write(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    return tables.bufferViews.length - 1;
  };
  return {
    tables,
    /** A VEC3 float attribute; `bounds` adds the min/max POSITION requires. */
    async vec3(data: Float32Array, bounds: boolean) {
      const bufferView = await append(data, ARRAY_BUFFER),
        entry: BinaryTables['accessors'][number] = {
          bufferView,
          componentType: FLOAT,
          type: 'VEC3',
          count: data.length / 3,
        };
      if (bounds) {
        entry.min = [Infinity, Infinity, Infinity];
        entry.max = [-Infinity, -Infinity, -Infinity];
        for (let i = 0; i < data.length; i++) {
          entry.min[i % 3] = Math.min(entry.min[i % 3], data[i]);
          entry.max[i % 3] = Math.max(entry.max[i % 3], data[i]);
        }
      }
      tables.accessors.push(entry);
      return tables.accessors.length - 1;
    },
    /** A VEC2 float attribute: texture coordinates. */
    async vec2(data: Float32Array) {
      const bufferView = await append(data, ARRAY_BUFFER);
      tables.accessors.push({
        bufferView,
        componentType: FLOAT,
        type: 'VEC2',
        count: data.length / 2,
      });
      return tables.accessors.length - 1;
    },
    async indices(data: Uint32Array) {
      const bufferView = await append(data, ELEMENT_ARRAY_BUFFER);
      tables.accessors.push({
        bufferView,
        componentType: UNSIGNED_INT,
        type: 'SCALAR',
        count: data.length,
      });
      return tables.accessors.length - 1;
    },
  };
}
