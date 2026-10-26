import { EngineError } from './cache.ts'

/** The manifest's section of a sidecar file (`meshCards.bin`, `distanceFields.bin`, ...), as far as a load needs it:
 *  the format's version, the file and, for a file whose section is sized, its size. */
export interface SidecarSection {
  readonly version: number
  readonly file: string
  readonly bytes: number
}

/**
 * The manifest's section of a sidecar file, or undefined when the cache has none (a scene that builds
 * none writes neither the section nor the file); a section of another `version` throws
 * `UNSUPPORTED_FORMAT`, one that names no file — or, `sized`, no size — `INVALID_CACHE`. `what` names the
 * file's content in the messages.
 */
export function assertSidecarSection(
  section: unknown,
  version: number,
  what: string,
  sized = true,
): SidecarSection | undefined {
  if (section === undefined || section === null) return undefined
  if (typeof section !== 'object' || Array.isArray(section))
    throw new EngineError('INVALID_CACHE', `${what}: the section is not an object`, {})
  const named = section as Partial<SidecarSection>
  if (named.version !== version)
    throw new EngineError(
      'UNSUPPORTED_FORMAT',
      `${what}: version ${String(named.version)}, this engine reads ${version}`,
      {},
    )
  if (typeof named.file !== 'string' || !named.file || (sized && typeof named.bytes !== 'number'))
    throw new EngineError(
      'INVALID_CACHE',
      `${what}: the section names no file${sized ? ' or no size' : ''}`,
      {},
    )
  return named as SidecarSection
}
