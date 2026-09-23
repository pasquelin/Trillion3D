/** Every prop the airport builds itself, in a fixed order; shared props are placed by id. */
import type { PropMesh } from '../../plan/contract.ts';
import { fieldProps } from './field-props.ts';
import { fuelProps } from './fuel.ts';
import { gseProps } from './gse.ts';
import { hangar, HANGARS } from './hangar.ts';
import { jetBridge } from './jetbridge.ts';
import { landmarkProps } from './landmarks.ts';
import { lightProps } from './light-props.ts';
import { markingProps } from './marking-props.ts';
import { office, OFFICES } from './offices.ts';
import { terminalBay } from './terminal.ts';
import { terminalHall } from './terminal-hall.ts';
import { controlTower, radarProps } from './tower.ts';

/** `characters`: the designator characters the runways need, one glyph prop each. */
export const airportProps = (characters: readonly string[]): PropMesh[] => [
  terminalHall(),
  terminalBay(),
  jetBridge(),
  hangar('airport/hangar', HANGARS.standard),
  hangar('airport/hangar-wide', HANGARS.wide),
  controlTower(),
  ...radarProps(),
  ...landmarkProps(),
  office('airport/office-long', OFFICES.long),
  office('airport/office-tower', OFFICES.tower),
  ...fuelProps(),
  ...gseProps(),
  ...lightProps(),
  ...fieldProps(),
  ...markingProps(characters),
];
