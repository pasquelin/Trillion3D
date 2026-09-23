/**
 * Every mesh the city owns, built once from the region's seed, with what placement reads of
 * each: footprints, heights, roofs. Shared props (trees, lamps, containers, boats) are placed
 * by their kit ids and never rebuilt here.
 */
import type { PropMesh } from '../../plan/contract.ts';
import { bridgePier, bridgeSpan } from './bridge-props.ts';
import { crossing, fountain, parkBlock, pavedBlock, sidewalkRing } from './ground-props.ts';
import { floodMast } from './floodlight.ts';
import { cranePortal, craneJib, quay, warehouse } from './harbour-props.ts';
import { gardenFence } from './house-parts.ts';
import { houses } from './houses.ts';
import { midrises } from './residential.ts';
import { rooftopProps } from './rooftop.ts';
import { chimney, neonSigns } from './signs.ts';
import { stadium } from './stadium.ts';
import { towers } from './towers.ts';

/** A superblock (the stadium's) spans two blocks and the street between them. */
export const superblockSize = ({ block, street }: { block: number; street: number }) =>
  2 * block + street;

export const IDS = {
  paved: 'city/block-paved',
  suburb: 'city/block-suburb',
  park: 'city/block-park',
  superblock: 'city/block-super',
  crossing: 'city/crossing',
} as const;

export type CityCatalog = ReturnType<typeof cityCatalog>;

/** Every city prop; block plinths take the grid's block size. */
export function cityCatalog(seed: number, grid: { block: number; street: number }) {
  const tower = towers(seed),
    midrise = midrises(seed + 100),
    house = houses(seed + 200),
    arena = stadium();
  const props: PropMesh[] = [
    ...tower.map((t) => t.prop),
    ...midrise.map((m) => m.prop),
    ...house.map((h) => h.prop),
    arena.prop,
    gardenFence(),
    pavedBlock(IDS.paved, grid.block),
    sidewalkRing(IDS.suburb, grid.block),
    parkBlock(IDS.park, grid.block),
    pavedBlock(IDS.superblock, superblockSize(grid)),
    crossing(IDS.crossing, grid.street),
    fountain(),
    ...rooftopProps(),
    ...neonSigns(),
    chimney(),
    quay(),
    cranePortal(),
    craneJib(),
    warehouse(),
    floodMast(),
    bridgeSpan(),
    bridgePier(),
  ];
  return { props, tower, midrise, house, stadium: arena };
}
