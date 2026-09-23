/**
 * The desert's own props, the ground each one needs (footprint, how much slope its plinth
 * absorbs, how deep it may sink) and the lamps it carries. Shared props used here are named by
 * their kit ids with a footprint of their base only: a palm stands on its trunk, not its crown.
 */
import type { PropMesh } from '../../plan/contract.ts';
import {
  partBounds,
  STAND_SIDE,
  standTolerance,
  STREET_LAMP_LIGHTS,
  type PropLamp,
} from '../../props/index.ts';
import { PLINTH, houseProps } from './houses.ts';
import { plantProps } from './plants.ts';
import { rockProps, CLIFF_FACE } from './rocks.ts';
import { FORECOURT_LAMPS, TRUCK_CANOPY_LAMPS } from './canopy.ts';
import { DINER_LAMPS, PRICE_SIGN_LAMPS, stationProps } from './station.ts';
import { HALL_LAMPS } from './hall.ts';
import { LANTERN_LAMPS, townProps } from './town.ts';
import { truckProps } from './trucks.ts';

/**
 * Ground a prop needs, in its own frame before instance scale: its base rectangle, the rise of
 * the terrain under it that its plinth or roots absorb, and how far below the lowest ground
 * under it its origin may sit (a boulder half-buried in scree).
 */
export type Footprint = {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  plinth: number;
  sink: number;
};

/** Every prop the desert builds, seeded. */
export const desertProps = (seed: number): PropMesh[] => [
  ...rockProps(seed),
  ...plantProps(seed + 1000),
  ...houseProps(seed + 2000),
  ...townProps(seed + 3000),
  ...stationProps(),
  ...truckProps(),
];

/** Ground needs by id prefix, first match wins; unlisted props take a 0.3 m tolerance. */
const NEEDS: readonly [prefix: string, plinth: number, sink: number][] = [
  ['desert/cliff-face', CLIFF_FACE.height, 0],
  ['desert/boulder', 0.9, 0.4],
  ['desert/hoodoo', 1.2, 0.5],
  ['desert/arch', 4, 1.5],
  ['desert/outcrop', 3, 1],
  ['desert/scree', 0.8, 0.2],
  ['desert/mud-plates', 0.3, 0.02],
  ['desert/house', PLINTH, 0],
  ['desert/courtyard', PLINTH, 0],
  ['desert/domed-hall', PLINTH, 0],
  ['desert/pool', PLINTH, 0],
  ['desert/forecourt', PLINTH, 0],
  ['desert/station-shop', PLINTH, 0],
  ['desert/diner', PLINTH, 0],
  ['desert/cactus', 0.5, 0.1],
  ['desert/dead-tree', 0.5, 0.1],
  ['desert/', 0.3, 0.05],
];

/** Props that hang in the air between others (the line's conductors): they have no footprint. */
const isAerial = (id: string) => id.startsWith('desert/line/span-');

/** Footprints of the region's own props, from their geometry. */
export function footprints(props: readonly PropMesh[]): Map<string, Footprint> {
  const out = new Map<string, Footprint>(SHARED);
  for (const p of props) {
    if (isAerial(p.id)) continue;
    const [min, max] = partBounds(p.parts),
      [, plinth, sink] = NEEDS.find(([prefix]) => p.id.startsWith(prefix)) ?? ['', 0.3, 0.05];
    out.set(p.id, { minX: min[0], maxX: max[0], minZ: min[2], maxZ: max[2], plinth, sink });
  }
  return out;
}

const square = (half: number, plinth: number, sink = 0): Footprint => ({
  minX: -half,
  maxX: half,
  minZ: -half,
  maxZ: half,
  plinth,
  sink,
});

/** The level palm grove (`props/stands.ts`): a date-palm plantation is levelled to irrigate. */
export const GROVE = 'tree-stand-palm-0';

/** Shared kit props the desert places, by the base they stand on (see the kit's modules). */
const SHARED: readonly [string, Footprint][] = [
  // A grove claims its square and buries no palm deeper than its bare trunk.
  [GROVE, square(STAND_SIDE / 2, standTolerance('palm'))],
  ['tree-palm-large', square(0.7, 0.6, 0.1)],
  ['tree-palm-small', square(0.4, 0.5, 0.1)],
  // Pylon and turbine footings are poured to the slope: 2 m and 1.5 m of foundation.
  ['power-pylon', square(3.6, 2)],
  ['wind-turbine-tower', square(2.4, 1.5)],
  ['street-lamp', square(0.2, 0.3)],
];

/** Lamps each prop carries, by id. */
export const PROP_LAMPS: ReadonlyMap<string, readonly PropLamp[]> = new Map([
  ['desert/forecourt', FORECOURT_LAMPS],
  ['desert/truck-canopy', TRUCK_CANOPY_LAMPS],
  ['desert/price-sign', PRICE_SIGN_LAMPS],
  ['desert/diner', DINER_LAMPS],
  ['desert/domed-hall', HALL_LAMPS],
  ['desert/lantern-post', LANTERN_LAMPS],
  ['street-lamp', STREET_LAMP_LIGHTS],
]);
