/**
 * THE CHECK OF A CACHE OBJECT'S BYTES AGAINST WHAT ITS MANIFEST ANNOUNCED, one for every read —
 * a load's (`fetchVerified`), the session's queue (`../streaming/fetchAttempt.ts`), the world top
 * at open —: its size, the cheaper refusal, then its fingerprint, taken where the bytes landed
 * (`verifyPageBytes`), each page where it lies in the bytes one request read, never copied.
 */
import { EngineError } from '../../../sdk-core/src/index.ts'
import { verifyPageBytes } from '../page/work/host.ts'

/** What a cache object announced: its size and fingerprint. */
type Announced = { bytes: number; sha256: string }

/** A cache object that is not what its manifest announced: its code and facts, whichever it is. */
const corruptObject = (
  url: string,
  announced: Announced,
  bytes: number,
  sha256: string | undefined,
) =>
  new EngineError(
    'INVALID_CACHE',
    sha256 !== undefined
      ? `Corrupt cache object: SHA-256 ${sha256}, ${announced.sha256} announced`
      : `Corrupt cache object: ${bytes} bytes received, ${announced.bytes} announced`,
    {
      url,
      bytes,
      expected: announced.bytes,
      sha256: sha256 ?? null,
      expectedSha256: announced.sha256,
    },
  )

/** A page of a read: its name, where it lies in its file (0 for a file read whole), its size and
 *  fingerprint. */
type RunPage = Announced & { url: string; offset: number }
/** What a page's check found: its bytes, or its refusal, and the fingerprint found. */
type Checked = { bytes?: Uint8Array; refused?: EngineError; found?: string }

/** `buffer`, the bytes of `pages`' file from the first's offset to the last's end, each page
 *  checked where it lies against its own size and fingerprint: each page's bytes viewed on the
 *  buffer, or its refusal, and the fingerprint found. A buffer of another length refuses them all. */
export async function verifiedRun(
  pages: readonly RunPage[],
  buffer: ArrayBuffer,
): Promise<Checked[]> {
  const from = pages[0].offset,
    spans: number[] = []
  for (const { offset, bytes } of pages) spans.push(offset - from, offset - from + bytes)
  if (buffer.byteLength !== spans[spans.length - 1])
    return pages.map((page) => ({
      refused: corruptObject(page.url, page, buffer.byteLength, undefined),
      found: undefined,
    }))
  const views = pages.map((page, at) => new Uint8Array(buffer, spans[2 * at], page.bytes))
  const digests = await Promise.all(views.map((view) => verifyPageBytes(view)))
  return pages.map((page, at) => {
    const found = digests[at]
    if (found !== page.sha256)
      return { refused: corruptObject(page.url, page, page.bytes, found), found }
    return { bytes: views[at], found }
  })
}
