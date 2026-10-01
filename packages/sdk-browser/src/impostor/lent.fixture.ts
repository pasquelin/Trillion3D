// The impostor family's modules tested alone, outside the bundle: lent the core's pieces once, as
// `loadImpostorCode` lends them when the family arrives (`borrowed.ts`). A test imports it first.
import * as lent from './lent.ts';
import { lend } from './borrowed.ts';

lend(lent);
