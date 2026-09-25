// #456: a shadow shows no seam where its filter crosses a border — a page's, where each tap is
// split along the seam between two physical pages, or a point light's face's, where the offset
// point picks the face it lies in. The fixtures restate the lines pinned here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SHADOW_PAGE } from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { SHADOW_WGSL, pcf, pointLampOver } from './shadowBias.fixture.ts';
import { pagedPcf } from './shadowPages.fixture.ts';

/** `shadowPcf`'s split of a tap along a page seam: what `pagedPcf` restates. */
const SPLIT = [
  ' let edge=(t-1.5<first)|(t+1.5>=first+SHADOW_PAGE);',
  ' let up=t-first>=vec2f(0.5*SHADOW_PAGE);',
  '  let h=clamp(at,first+0.5,first+SHADOW_PAGE-0.5);',
  '  let n=select(min(at,seam-0.5),max(at,seam+0.5),up);',
  '  let w=saturate(0.5+(seam-at)*toward);',
  '  var sum=w.x*w.y*shadowCompare(offset,h,reference);',
  '  if(edge.x){sum+=(1.0-w.x)*w.y*shadowCompare(nx.xy,vec2f(select(h.x,n.x,nx.z>0.0),h.y),reference);}',
  '  if(edge.y){sum+=w.x*(1.0-w.y)*shadowCompare(ny.xy,vec2f(h.x,select(h.y,n.y,ny.z>0.0)),reference);}',
  '  if(all(edge)){sum+=(1.0-w.x)*(1.0-w.y)*shadowCompare(nd.xy,select(h,n,nd.z>0.0),reference);}',
];

test('the page split restated by the fixture is the shader’s', () => {
  for (const line of SPLIT) assert.ok(SHADOW_WGSL.includes(line), line);
});

test('a filter across a page border reads the same depths as one inside a page', () => {
  // The home page and its eight neighbours, each placed anywhere in the pool.
  const S = SHADOW_PAGE,
    pages = new Map<string, [number, number]>(),
    anchors = new Map<string, [number, number]>();
  [
    [0, 0, 5, 2],
    [1, 0, 0, 7],
    [0, 1, 3, 3],
    [1, 1, 6, 0],
    [-1, 0, 1, 1],
    [0, -1, 2, 5],
    [-1, -1, 4, 4],
    [1, -1, 7, 7],
    [-1, 1, 0, 3],
  ].forEach(([px, py, ax, ay]) => {
    pages.set(`${px},${py}`, [ax * S, ay * S]);
    anchors.set(`${ax},${ay}`, [px, py]);
  });
  const placed = (px: number, py: number) => pages.get(`${px},${py}`);
  // A caster's edge across a corner of the home page, over a sloped receiver.
  const map = (x: number, y: number) => (0.37 * x + 0.61 * y < 125 ? 1 : 5 + 0.01 * x - 0.02 * y);
  const atlas = (x: number, y: number) => {
    const ax = Math.floor(x / S),
      ay = Math.floor(y / S),
      page = anchors.get(`${ax},${ay}`);
    return page ? map((page[0] - ax) * S + x, (page[1] - ay) * S + y) : -1e9;
  };
  for (const reference of [3, 4.9])
    for (let i = 0; i < 40; i++)
      for (const t of [
        [S - 2 + i * 0.07, 64.3],
        [1.9 - i * 0.07, 20.2],
        [60.1, S - 2 + i * 0.07],
        [S - 2 + i * 0.07, S - 1.9 + i * 0.05],
        [1.9 - i * 0.05, 1.8 - i * 0.07],
      ] as [number, number][])
        assert.equal(pagedPcf(t, reference, placed, atlas), pcf(t, map, reference), `${t}`);
});

test('a point light’s shadow crosses a face border without a seam', () => {
  // The light 2 m over the floor: its bottom face meets its side faces on the lines |x| = 2 and
  // |z| = 2 of the floor. A slab 1 m up shadows the whole floor, the border included.
  const up = [0, 1, 0],
    floor = { at: [0, 0, 0], normal: up };
  const alone = pointLampOver([0, 2, 0], [floor]),
    shaded = pointLampOver([0, 2, 0], [floor, { at: [0, 1, 0], normal: up }]);
  for (const mip of [0, 2, 5])
    for (let k = -40; k <= 40; k++)
      for (const [x, z] of [
        [2, 0],
        [2, 1.9],
        [0.7, 2],
        [2, 2],
      ]) {
        const P = [x + k * 7e-4, 0, z - k * 3e-4];
        const { ndc, lit } = alone(P, up, mip);
        assert.ok(Math.abs(ndc[0]) <= 1 && Math.abs(ndc[1]) <= 1, `${P}: read off its face`);
        assert.equal(lit, 1, `${P}, mip ${mip}: the floor shades itself`);
        assert.equal(shaded(P, up, mip).lit, 0, `${P}, mip ${mip}: a seam of light`);
      }
});
