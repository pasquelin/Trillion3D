/**
 * Every mesh the mountains build before any placement, in a fixed order. The layout adds the
 * few that depend on the land (the waterfall, the cables, bridge spans, portals sized to a road).
 */
import type { PropMesh } from '../../plan/contract.ts';
import { cabin, pylon, PYLON_HEIGHTS, station } from './cableway.ts';
import { chalet, type ChaletSpec } from './chalet.ts';
import { church } from './church.ts';
import { boulders, conifers, crags, lanternPost, snowPole, summitCross } from './nature.ts';
import { observatoryBase, observatoryDome } from './observatory.ts';
import { MOUNTAIN_SURFACES as S } from './surfaces.ts';

/** The village's chalets, the lake's refuge and the hotel (last). */
export const CHALETS: readonly ChaletSpec[] = [
  {
    id: 'mountains/chalet-a',
    width: 10,
    depth: 12,
    storeys: 1,
    rise: 3.4,
    shutter: S.shutterGreen,
    sideBalcony: false,
    litEvery: 3,
  },
  {
    id: 'mountains/chalet-b',
    width: 12,
    depth: 11,
    storeys: 2,
    rise: 3.8,
    shutter: S.shutterRed,
    sideBalcony: false,
    litEvery: 4,
  },
  {
    id: 'mountains/chalet-c',
    width: 9,
    depth: 9,
    storeys: 1,
    rise: 3.0,
    shutter: S.shutterGreen,
    sideBalcony: true,
    litEvery: 2,
  },
  {
    id: 'mountains/chalet-d',
    width: 14,
    depth: 13,
    storeys: 2,
    rise: 4.4,
    shutter: S.shutterRed,
    sideBalcony: true,
    litEvery: 3,
  },
  {
    id: 'mountains/chalet-e',
    width: 8,
    depth: 8,
    storeys: 1,
    rise: 2.8,
    shutter: S.shutterGreen,
    sideBalcony: false,
    litEvery: 5,
  },
  {
    id: 'mountains/refuge',
    width: 11,
    depth: 8,
    storeys: 1,
    rise: 2.6,
    shutter: S.shutterRed,
    sideBalcony: false,
    litEvery: 2,
    board: [0.6, 0.5],
  },
  {
    id: 'mountains/hotel',
    width: 24,
    depth: 15,
    storeys: 3,
    rise: 5.5,
    shutter: S.shutterRed,
    sideBalcony: true,
    litEvery: 2,
    board: [0.8, 0.6],
  },
];

export const mountainProps = (seed: number): PropMesh[] => [
  ...CHALETS.map(chalet),
  church(),
  observatoryBase(),
  observatoryDome(),
  station(),
  ...PYLON_HEIGHTS.map(pylon),
  cabin(),
  ...boulders(seed),
  ...crags(seed + 100),
  ...conifers(seed + 200),
  snowPole(),
  lanternPost(),
  summitCross(),
];
