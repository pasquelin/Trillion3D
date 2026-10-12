import { createWorldModels } from './worldModels.ts'
import { createWorldRanks } from './worldRanks.ts'

/** The models of a world that loaded none: posing a model there writes nothing. */
export const noModels = () => createWorldModels(createWorldRanks())
