/**
 * Every prop the coast builds for itself, and what the placement needs to know of each: how it
 * meets the ground, and the lamps it carries. Shared props (trees, rocks, benches, street lamps,
 * sailboats, motorboats) are placed by their kit ids and never rebuilt here.
 */
import type { PropMesh } from '../../../plan/contract.ts';
import { STREET_LAMP_LIGHTS, type PropLamp } from '../../../props/index.ts';
import { beachProps } from './beach.ts';
import { bridgeBay } from './bridge.ts';
import { cafeProps, CAFE_LAMPS } from './cafe.ts';
import { cliffFace, seaStack } from './cliff.ts';
import { houseProps } from './houses.ts';
import { LIGHTHOUSE_LAMPS, lighthouse, lighthouseLantern } from './lighthouse.ts';
import { marineProps } from './marine.ts';
import { duneProps } from './dune.ts';
import { PIER_HEAD_LAMPS, PIER_LAMPS, pierProps } from './pier.ts';
import { QUAY_LAMPS, quayProps } from './quay.ts';

export const CLIFF_FACES = ['a', 'b', 'c', 'd', 'e', 'f'].map((k) => `coast-cliff-${k}`);
export const SEA_STACKS = ['a', 'b', 'c'].map((k) => `coast-sea-stack-${k}`);

/** All of the coast's own props, in a fixed order. */
export const coastProps = (seed: number): PropMesh[] => [
  ...CLIFF_FACES.map((id, i) => cliffFace(id, seed + i * 1000)),
  ...SEA_STACKS.map((id, i) => seaStack(id, seed + 20_000 + i * 1000)),
  lighthouse(seed + 30_000),
  lighthouseLantern(),
  ...houseProps(seed + 40_000),
  ...beachProps(),
  ...cafeProps(),
  ...pierProps(),
  ...quayProps(),
  ...marineProps(),
  ...duneProps(seed + 50_000),
  bridgeBay(),
];

/**
 * How a prop meets the world: `ground` stands on the lowest ground under its footprint;
 * `deck` floats at a fixed walking level over water or sand (pier, quay); `water` floats on the
 * sea; `face` dresses a cliff and sinks into it by design; `fitted` stands where its caller
 * fitted it (a forest patch on its slope, the lantern on its tower).
 */
export type Seat = 'ground' | 'deck' | 'water' | 'face' | 'fitted';

export function seatOf(id: string): Seat {
  // The lantern rides its tower, at the tower's origin, not on the ground under its own footprint.
  if (id.startsWith('tree-stand-') || id === 'coast-lighthouse-lantern') return 'fitted';
  if (id.startsWith('coast-cliff') || id.startsWith('coast-sea-stack')) return 'face';
  if (/^coast-(pier|quay|bridge)/.test(id)) return 'deck';
  if (/boat|buoy/.test(id)) return 'water';
  return 'ground';
}

/** The lamps each lamp-carrying prop declares, by prop id. */
export const PROP_LAMPS: Readonly<Record<string, readonly PropLamp[]>> = {
  'coast-lighthouse': LIGHTHOUSE_LAMPS,
  'coast-pier-bay-lamps': PIER_LAMPS,
  'coast-pier-head': PIER_HEAD_LAMPS,
  'coast-quay-bay-lamp': QUAY_LAMPS,
  'coast-cafe-blue': CAFE_LAMPS,
  'coast-cafe-red': CAFE_LAMPS,
  'street-lamp': STREET_LAMP_LIGHTS,
};
