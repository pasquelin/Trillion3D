import { encodeGeometryPage } from '../../../../page-codec/src/geometryPage.ts';

/** A geometry page of `vertices` random vertices — signed zeros among them — with normals and
 *  texture coordinates on one page in two, so attribute names travel too. */
export function randomPage(random: () => number, vertices: number) {
  const position = new Float32Array(vertices * 3),
    normal = new Float32Array(vertices * 3),
    uv = new Float32Array(vertices * 2);
  for (let i = 0; i < position.length; i++)
    position[i] = random() < 0.05 ? -0 : (random() - 0.5) * 200;
  for (let i = 0; i < normal.length; i++) normal[i] = random() < 0.1 ? -0 : random() * 2 - 1;
  for (let i = 0; i < uv.length; i++) uv[i] = random();
  const indices = Array.from({ length: Math.max(1, Math.floor(vertices / 3)) * 3 }, (_, i) =>
    i < vertices ? i : Math.floor(random() * vertices),
  );
  const full = random() < 0.5;
  const { data } = encodeGeometryPage(indices, {
    POSITION: { itemSize: 3, array: position },
    ...(full
      ? { NORMAL: { itemSize: 3, array: normal }, TEXCOORD_0: { itemSize: 2, array: uv } }
      : {}),
  });
  return data as Uint8Array;
}
