import type { DrawnTriangles } from '../../../../sdk-core/src/world/geometry/drawn.ts';
import type { Recut } from './runtimeCut.ts';

/** The words before the arrays: five lengths, whether the pages keep a cone, whether a blended
 *  material wears them, the length of a recut's `ends`, its two inputs as 64-bit floats, a
 *  deformation's influences and targets, then whether the triangles are held (#573). */
const HEADER_WORDS = 16;
const drawnCones = (d: DrawnTriangles) => !d.lines && d.spriteRadius === undefined;

/** How a cut takes drawn triangles beside their content: the compiled primitive they `recut`, or
 *  `held`, faces that move after the cut — a dynamic geometry's (#573), a mesh the waves carry
 *  (#357) —, cut in compact runs when blended (`cutDrawnTriangles`). */
export type CutWay = { recut?: Recut; held?: boolean };

/** Drawn triangles as one buffer: its header (`HEADER_WORDS`), then the five arrays and a recut's
 *  `ends`, every one four-byte wide. `blended` is part of the content: its pages sit on a finer
 *  grid. A recut keeps no cone: its pages keep the compiled ones. */
export function packDrawn(
  drawn: DrawnTriangles,
  blended: boolean,
  { recut, held = false }: CutWay = {},
): ArrayBuffer {
  const parts = [drawn.positions, drawn.normals, drawn.uvs, drawn.colors, drawn.indices];
  parts.push(recut?.ends ?? null);
  const deformation = drawn.deformation;
  if (deformation?.joints && deformation.weights)
    parts.push(deformation.joints, deformation.weights);
  for (const target of deformation?.targets ?? []) parts.push(target.positions, target.normals);
  const lengths = parts.map((part) => part?.length ?? 0);
  const packed = new Uint32Array(HEADER_WORDS + lengths.reduce((a, b) => a + b, 0));
  packed.set([...lengths.slice(0, 5), Number(!recut && drawnCones(drawn)), Number(blended)]);
  packed[7] = lengths[5];
  packed[12] = deformation?.joints && deformation.weights ? (deformation.influences ?? 4) : 0;
  packed[13] = deformation?.targets.length ?? 0;
  packed[14] = Number(held);
  new Float64Array(packed.buffer, 32, 2).set([recut?.finestError ?? 0, recut?.scale ?? 0]);
  let at = HEADER_WORDS;
  for (const part of parts)
    if (part) {
      packed.set(new Uint32Array(part.buffer, part.byteOffset, part.length), at);
      at += part.length;
    }
  return packed.buffer;
}

/** The triangles `packDrawn` wrote, as views on its buffer, whether their pages keep a cone,
 *  whether a blended material wears them, whether they are held, and the recut they are, if any. */
export function unpackDrawn(buffer: ArrayBuffer): {
  drawn: DrawnTriangles;
  cones: boolean;
  blended: boolean;
  held: boolean;
  recut?: Recut;
} {
  const header = new Uint32Array(buffer, 0, HEADER_WORDS),
    cones = header[5] === 1,
    blended = header[6] === 1,
    held = header[14] === 1;
  let at = header.byteLength;
  const take = <T>(make: (b: ArrayBuffer, offset: number, length: number) => T, i: number) => {
    const view = header[i] ? make(buffer, at, header[i]) : null;
    at += header[i] * 4;
    return view;
  };
  const float = (b: ArrayBuffer, offset: number, length: number) =>
    new Float32Array(b, offset, length);
  const words = (b: ArrayBuffer, offset: number, length: number) =>
    new Uint32Array(b, offset, length);
  const drawn: DrawnTriangles = {
    positions: take(float, 0)!,
    // A recut of a primitive without normals carries none: its pages have none either.
    normals: take(float, 1) ?? new Float32Array(0),
    uvs: take(float, 2),
    colors: take(float, 3),
    indices: take(words, 4)!,
  };
  const ends = take(words, 7);
  const vertices = drawn.positions.length / 3;
  const list = (length: number) => {
    const view = new Float32Array(buffer, at, length);
    at += length * 4;
    return view;
  };
  if (header[12] || header[13])
    drawn.deformation = {
      ...(header[12]
        ? {
            joints: list(vertices * header[12]),
            weights: list(vertices * header[12]),
            influences: header[12],
          }
        : {}),
      targets: Array.from({ length: header[13] }, () => ({
        positions: list(vertices * 3),
        normals: list(vertices * 3),
      })),
    };
  if (!ends) return { drawn, cones, blended, held };
  const [finestError, scale] = new Float64Array(buffer, 32, 2);
  return { drawn, cones, blended, held, recut: { ends, finestError, scale } };
}
