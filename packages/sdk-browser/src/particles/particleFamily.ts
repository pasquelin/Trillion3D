import { families } from '../host/families.ts'

/** The particles' code (`particleCode.ts`), which the frame that draws them waited for
 *  (`../host/families.ts`): a refused import is `FAMILY_LOAD_FAILED`, and the frame waits on. */
export const particleCode = () => families.particles.get()
