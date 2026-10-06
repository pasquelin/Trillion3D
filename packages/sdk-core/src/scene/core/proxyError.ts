import { EngineError } from '../../contracts/index.ts'

/** A malformed resident proxy must be refused before its columns reach a ray. */
export const invalidProxy = (message: string, details: Record<string, unknown>) =>
  new EngineError('INVALID_CACHE', message, details)
