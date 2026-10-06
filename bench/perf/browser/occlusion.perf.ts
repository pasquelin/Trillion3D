// Sharing occluders and occlusion test of an entire cut.
import { createHizCounts } from '../../../packages/sdk-browser/src/hiz/counts.ts';
import { countUnoccluded } from '../../../packages/sdk-browser/src/hiz/unoccluded.ts';
import { splitOccludersInto } from '../../../packages/sdk-browser/src/hiz/split.ts';
import { buildHizPyramid } from '../../../packages/sdk-browser/src/hiz/depth.ts';
import { xorshiftRandom, measure, stress, rapport } from '../../core/index.ts';
import { boxes, camera, located } from './support/scenes.ts';
import {
  referenceCountUnoccluded,
  referenceSplitOccluders,
} from '../../oracles/browser/occlusion.ts';
import { engineCamera } from '../../../packages/sdk-browser/src/camera/camera.fixture.ts';
import type { SceneBox } from './support/scenes.ts';

const WIDTH = 640,
  HEIGHT = 360;
const alea = xorshiftRandom(29),
  depth = new Float32Array(WIDTH * HEIGHT);
for (let i = 0; i < depth.length; i++) depth[i] = alea() * 0.4 + 0.5;
const pyramide = buildHizPyramid(depth, WIDTH, HEIGHT);
const cam = camera(6, 0.1, WIDTH / HEIGHT),
  viewport: [number, number] = [WIDTH, HEIGHT];
const grande: SceneBox[] = boxes({ count: 20000 }),
  cas = (pages: SceneBox[], name: string) => ({ name, input: pages, size: pages.length });
const sets = [
  cas(grande, '20 000 boxes including degenerate'),
  cas(grande.slice(0, 1), 'one box'),
  cas([], 'no box'),
  cas(grande.filter((_, i) => i % 311 === 0).slice(0, 64), 'only near plane cuts'),
];

const urls = (pages: SceneBox[]) => pages.map((page) => page.url);
const occluders: SceneBox[] = [],
  rest: SceneBox[] = [];

const resSplit = await measure({
  name: 'splitOccluders',
  fichier: 'packages/sdk-browser/src/hiz/split.ts',
  cas: sets,
  calculation: (pages) => {
    splitOccludersInto(pages, located(pages.length), engineCamera(cam), viewport, occluders, rest);
    return { occluders: urls(occluders), rest: urls(rest) };
  },
  expected: (pages) => {
    const split = referenceSplitOccluders(pages, cam, viewport);
    return { occluders: urls(split.occluders), rest: urls(split.rest) };
  },
  options: { tours: 60, budgetMs: 1500 },
});

const resCount = await measure({
  name: 'countUnoccluded',
  fichier: 'packages/sdk-browser/src/hiz/unoccluded.ts',
  cas: sets,
  calculation: (pages) => {
    const counts = createHizCounts();
    return {
      kept: urls(
        countUnoccluded(
          pages,
          located(pages.length),
          pyramide,
          engineCamera(cam),
          viewport,
          counts,
        ),
      ),
      counts,
    };
  },
  expected: (pages) => {
    const counts = createHizCounts();
    return {
      kept: urls(referenceCountUnoccluded(pages, pyramide, cam, viewport, counts)),
      counts,
    };
  },
  options: { tours: 60, budgetMs: 1500 },
});

await stress({
  name: 'splitOccludersInto extremes',
  calculation: (p: SceneBox[]) =>
    splitOccludersInto(p, located(p.length), engineCamera(cam), viewport, [], []),
  extremes: [{ name: 'empty', input: [] }],
});

rapport(
  'occlusion',
  [resSplit, resCount],
  'A3 and A4 isolate exact same occluders and reject exact same boxes',
);
