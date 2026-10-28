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

/** A sidecar reader's refusal: throws `INVALID_CACHE` naming the file's content. */
export type SidecarRefusal = (why: string) => never

/** The refusal of the reader of the sidecar file that holds `what`, as `assertSidecarSection` and
 *  `checkSidecarHead` name it. */
export const sidecarRefusal =
  (what: string): SidecarRefusal =>
  (why) => {
    throw new EngineError('INVALID_CACHE', `${what}: ${why}`, {})
  }

/** What `checkSidecarHead` checks a file's first two words against. */
export interface SidecarHead {
  /** The word at byte 0. */
  readonly magic: number
  /** The format's version at byte 4: one, or the first and the last this engine reads. */
  readonly version: number | readonly [number, number]
  /** The size of the head, in bytes. */
  readonly headBytes: number
  /** The file's content in the messages, as `assertSidecarSection` names it. */
  readonly what: string
}

/**
 * Checks the first words of a sidecar file and returns its version: a file shorter than its head or
 * of another magic throws `INVALID_CACHE`, one of a version this engine does not read
 * `UNSUPPORTED_FORMAT`.
 */
export function checkSidecarHead(bytes: Uint8Array, head: SidecarHead): number {
  const { magic, headBytes, what } = head
  if (bytes.byteLength < headBytes)
    throw new EngineError('INVALID_CACHE', `${what}: shorter than its head`, {})
  const words = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (words.getUint32(0, true) !== magic)
    throw new EngineError('INVALID_CACHE', `${what}: not a ${what} file`, {})
  const version = words.getUint32(4, true)
  const [first, last] =
    typeof head.version === 'number' ? [head.version, head.version] : head.version
  if (version < first || version > last)
    throw new EngineError(
      'UNSUPPORTED_FORMAT',
      `${what}: version ${version}, this engine reads ${first === last ? first : `${first} to ${last}`}`,
      {},
    )
  return version
}
