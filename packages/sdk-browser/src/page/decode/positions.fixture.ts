/**
 * Inputs of the CMP-10 equivalence harness (`positions.test.ts`, #960): seeded flat-shaded and
 * smooth height fields, the signed zeros, NaN and infinities, the empty page and the largest one,
 * each reduced to the digest of its decoded block and its page bytes.
 */
import { createHash } from 'node:crypto';
import { encodeGeometryPage } from '../../../../page-codec/geometryPage.ts';
import type { PageAttributes } from '../../../../page-codec/pageAttributes.ts';
import { decodeGeometryPage } from './geometryPage.ts';

export type Mesh = { indices: number[]; attributes: PageAttributes; exponent: number };

function xorshift(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 2 ** 32;
  };
}

/** A `side × side` height field; `flat` gives each triangle its own vertices under its normal. */
function field(rand: () => number, side: number, flat: boolean, uv: boolean, color: boolean) {
  const step = 0.05 + rand() * 2,
    heights = Array.from({ length: side * side }, () => rand() * 3 - 1.5);
  const corner = (i: number) => [(i % side) * step, heights[i], Math.floor(i / side) * step];
  const grid: number[] = [];
  for (let y = 0; y < side - 1; y++)
    for (let x = 0; x < side - 1; x++) {
      const a = y * side + x;
      grid.push(a, a + side, a + 1, a + 1, a + side, a + side + 1);
    }
  const positions: number[] = [],
    normals: number[] = [];
  let indices = grid;
  if (flat) {
    indices = grid.map((_, i) => i);
    for (let t = 0; t < grid.length; t += 3) {
      const [a, b, c] = [0, 1, 2].map((k) => corner(grid[t + k]));
      const u = b.map((v, k) => v - a[k]),
        v = c.map((w, k) => w - a[k]);
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      for (const p of [a, b, c]) {
        positions.push(...p);
        normals.push(...n);
      }
    }
  } else
    for (let i = 0; i < side * side; i++) {
      positions.push(...corner(i));
      normals.push(0, 1, 0);
    }
  const attributes: PageAttributes = {
    POSITION: { itemSize: 3, array: new Float32Array(positions) },
    NORMAL: { itemSize: 3, array: new Float32Array(normals) },
  };
  const along = (f: (p: number) => number[], size: number) => ({
    itemSize: size,
    array: new Float32Array(Array.from({ length: positions.length / 3 }, (_, i) => f(i)).flat()),
  });
  const p = (i: number, k: number) => positions[i * 3 + k];
  if (uv) attributes.TEXCOORD_0 = along((i) => [p(i, 0) * 0.1, p(i, 2) * 0.1], 2);
  if (color) attributes.COLOR_0 = along((i) => [p(i, 0) * 0.1, p(i, 2) * 0.1, 0.5, 1], 4);
  return { indices, attributes };
}

/** Every case by name: random flat-shaded and smooth meshes, then the edges. */
export function cases(): [string, Mesh][] {
  const rand = xorshift(960),
    out: [string, Mesh][] = [];
  const mesh = (m: ReturnType<typeof field>, exponent: number) => ({ ...m, exponent });
  for (let i = 0; i < 40; i++) {
    const side = 2 + Math.floor(rand() * 11),
      flags = Math.floor(rand() * 4);
    const m = field(rand, side, i % 3 !== 2, !!(flags & 1), !!(flags & 2));
    out.push([`random ${i}`, mesh(m, -12 + Math.floor(rand() * 8))]);
  }
  const zeros = field(rand, 5, true, false, false);
  const zeroed = zeros.attributes.POSITION!.array as Float32Array;
  zeroed.forEach((_, i) => (zeroed[i] = i % 2 ? 0 : -0));
  out.push(['signed zeros', mesh(zeros, -10)]);
  for (const [name, bad] of [
    ['NaN', NaN],
    ['+Inf', Infinity],
    ['-Inf', -Infinity],
  ] as const) {
    const m = field(rand, 4, true, true, false);
    (m.attributes.POSITION!.array as Float32Array)[7] = bad;
    out.push([`${name} position`, mesh(m, -10)]);
  }
  out.push(['empty', { ...mesh(field(rand, 3, true, false, false), -10), indices: [] }]);
  for (const [name, corners] of [
    ['65,535 vertices', 65535],
    ['65,538 vertices', 65538],
  ] as const) {
    const m = field(xorshift(106), 106, true, true, true);
    out.push([name, { ...mesh(m, -10), indices: m.indices.slice(0, corners) }]);
  }
  for (const [name, span] of [
    ['widest range', 16777215],
    ['range past 24 bits', 16777216],
  ] as const) {
    const m = field(rand, 2, true, false, false),
      array = m.attributes.POSITION!.array as Float32Array;
    array.fill(0);
    array[0] = span;
    out.push([name, mesh(m, 0)]);
  }
  return out;
}

/** What a mesh becomes: the digest of the decoded block and the page bytes, or the refusal. */
export function outcome({ indices, attributes, exponent }: Mesh): [string, number] {
  try {
    const { data } = encodeGeometryPage(indices, attributes, exponent);
    const decoded = decodeGeometryPage(data as Uint8Array, 1 << 28);
    const block = new Uint8Array(decoded.indices.buffer);
    return [createHash('sha256').update(block).digest('hex').slice(0, 16), data.length];
  } catch (error) {
    return [(error as Error).message, 0];
  }
}
