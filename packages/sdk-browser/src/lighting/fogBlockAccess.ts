import { ATMOSPHERE_SLOT } from '../../../sdk-core/src/scene/core/atmospherePack.ts'

/**
 * How the fog's shader text names the blocks of the light buffer it reads, written once for the
 * analytic fog (`./fogShader.ts`) and the way it is laid over a point (`./fogCompose.ts`): a slot of the
 * fog block, of the atmosphere's block and of the fog volume's view block, and whether an atmosphere
 * shows.
 */
export const fog = (slot: number) => `directLights.fog[${slot}]`
export const air = (slot: number) => `directLights.atmosphere[${slot}]`
/** The slot `slot` of the fog volume's view block, a `vec4f`. */
export const view = (slot: number) => `directLights.fogView[${slot}]`
/** Whether an atmosphere shows: its planet's block is written. */
export const AIR_SHOWN = `${air(ATMOSPHERE_SLOT.planet)}.x!=0.0`
