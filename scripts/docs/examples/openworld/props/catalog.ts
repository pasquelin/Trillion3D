/**
 * Every shared prop of the open world, built once from one seed. Regions place them by id and
 * build their own props from the same kit (`props/index.ts`).
 */
import type { PropMesh } from '../plan/contract.ts';
import { boats } from './boats.ts';
import { container, gantryCrane } from './harbour.ts';
import { powerPylon, windTurbineRotor, windTurbineTower } from './industry.ts';
import { bushes, rocks } from './organic.ts';
import { streetProps } from './street.ts';
import { forestStands } from './stands.ts';
import { SURFACES } from './surfaces.ts';
import { trees } from './trees.ts';

/** All shared props, in a fixed order; ids are unique. */
export const sharedProps = (seed: number): PropMesh[] => [
  ...trees(seed),
  ...bushes(seed + 1),
  ...rocks(seed + 2),
  ...streetProps(),
  powerPylon(),
  windTurbineTower(),
  windTurbineRotor(),
  container(SURFACES.containerRed, 'container-red'),
  container(SURFACES.containerBlue, 'container-blue'),
  gantryCrane(),
  ...boats(seed + 3),
  ...forestStands(seed).meshes,
];
