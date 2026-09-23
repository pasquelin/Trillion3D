import { writeFile } from 'node:fs/promises';
import { crc32 } from 'node:zlib';
import type { Mesh } from './mesh.ts';

/** A number as a USD layer prints it: at most three decimals, no trailing zero, no `-0`. */
const decimal = (value: number) => String(Math.round(value * 1000) / 1000 + 0);

const vectors = (values: readonly number[]) => {
  const tuples: string[] = [];
  for (let v = 0; v < values.length; v += 3)
    tuples.push(`(${decimal(values[v])}, ${decimal(values[v + 1])}, ${decimal(values[v + 2])})`);
  return tuples.join(', ');
};

/** One triangle mesh prim of a USD text layer, bound to `material` under `materials` if given. */
export function usdMesh(name: string, mesh: Mesh, material?: string) {
  const binding = material ? `\n            rel material:binding = <${material}>` : '';
  return `        def Mesh "${name}"
        {
            uniform bool doubleSided = 0
            int[] faceVertexCounts = [${Array(mesh.indices.length / 3)
              .fill(3)
              .join(', ')}]
            int[] faceVertexIndices = [${mesh.indices.join(', ')}]
            normal3f[] normals = [${vectors(mesh.normals)}] (
                interpolation = "vertex"
            )
            point3f[] points = [${vectors(mesh.positions)}]
            uniform token subdivisionScheme = "none"${binding}
        }
`;
}

/**
 * Writes a USDZ package to `path`: a ZIP whose entries are stored uncompressed and whose
 * payloads each start on a 64-byte boundary, padded by an extra field, as the format requires.
 */
export async function writeUsdz(path: string, entries: readonly (readonly [string, Buffer])[]) {
  const records: Buffer[] = [],
    directory: Buffer[] = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const file = Buffer.from(name),
      pad = (64 - ((offset + 30 + file.length + 4) % 64)) % 64,
      extra = Buffer.alloc(4 + pad),
      crc = crc32(data),
      local = Buffer.alloc(30),
      central = Buffer.alloc(46);
    extra.writeUInt16LE(0x1986, 0);
    extra.writeUInt16LE(pad, 2);
    // Signature, version, flags, method (stored), time, date, then CRC and both sizes.
    local.writeUInt32LE(0x04034b50, 0);
    [20, 0, 0, 0, 0x21].forEach((value, i) => local.writeUInt16LE(value, 4 + i * 2));
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(file.length, 26);
    local.writeUInt16LE(extra.length, 28);
    central.writeUInt32LE(0x02014b50, 0);
    [20, 20, 0, 0, 0, 0x21].forEach((value, i) => central.writeUInt16LE(value, 4 + i * 2));
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(file.length, 28);
    central.writeUInt32LE(offset, 42);
    records.push(local, file, extra, data);
    directory.push(central, file);
    offset += local.length + file.length + extra.length + data.length;
  }
  const size = directory.reduce((sum, part) => sum + part.length, 0),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(size, 12);
  end.writeUInt32LE(offset, 16);
  await writeFile(path, Buffer.concat([...records, ...directory, end]));
}
