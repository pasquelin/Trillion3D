import { encodePage } from './encodePage.fixture.ts'

/** The position precision of a random page: its cells are `2^-4` centimetre, so the 200 metres its
 *  positions spread over (20000 centimetres, 320000 cells) fit the 21 bits of an axis a page holds
 *  on its grid — the default precision of 7 would span 2.56 million cells and be refused. */
const RANDOM_PRECISION = 4

/** A geometry page of `vertices` random vertices — signed zeros among them — with normals and
 *  texture coordinates on one page in two, so attribute names travel too. */
export function randomPage(random: () => number, vertices: number) {
  const position = new Float32Array(vertices * 3),
    normal = new Float32Array(vertices * 3),
    uv = new Float32Array(vertices * 2)
  for (let i = 0; i < position.length; i++)
    position[i] = random() < 0.05 ? -0 : (random() - 0.5) * 200
  for (let i = 0; i < normal.length; i++) normal[i] = random() < 0.1 ? -0 : random() * 2 - 1
  for (let i = 0; i < uv.length; i++) uv[i] = random()
  const indices = Array.from({ length: Math.max(1, Math.floor(vertices / 3)) * 3 }, (_, i) =>
    i < vertices ? i : Math.floor(random() * vertices),
  )
  const full = random() < 0.5
  const { data } = encodePage(
    indices,
    {
      POSITION: { itemSize: 3, array: position },
      ...(full
        ? { NORMAL: { itemSize: 3, array: normal }, TEXCOORD_0: { itemSize: 2, array: uv } }
        : {}),
    },
    RANDOM_PRECISION,
  )
  return data as Uint8Array
}
