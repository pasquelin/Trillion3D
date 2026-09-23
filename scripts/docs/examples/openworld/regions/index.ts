/**
 * The open world's regions (#332), in the order the plan composes their height refinements.
 * Each is a `RegionModule` of its own folder; the world is whatever this list holds.
 */
import type { RegionModule } from '../plan/contract.ts';
import { airportRegion } from './airport/index.ts';
import { cityRegion } from './city/index.ts';
import { coastRegion } from './coast/index.ts';
import { countrysideRegion } from './countryside/index.ts';
import { desertRegion } from './desert/index.ts';
import { mountainsRegion } from './mountains/index.ts';

export const REGIONS: readonly RegionModule[] = [
  mountainsRegion,
  desertRegion,
  countrysideRegion,
  cityRegion,
  airportRegion,
  coastRegion,
];
