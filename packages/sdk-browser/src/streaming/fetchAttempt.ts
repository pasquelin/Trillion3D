/**
 * THE CHECK OF A TRANSFER'S PAGES: the bytes one request brought, checked against what each of its
 * pages announced — a page's file whole, or each range where it lies in the ranges read end to end
 * (`../cluster/verified.ts`) —, each check told to the diagnostics that listen.
 */
import { verifiedRun } from '../cluster/verified.ts'
import type { StreamContext, StreamPage } from './types.ts'

/** `buffer`, the bytes one request read for `pages`, checked against what each announced, each
 *  check told: each page's bytes to keep, or its refusal (`corruptObject`). */
export async function checkedPages(
  { emit }: StreamContext,
  pages: readonly StreamPage[],
  buffer: ArrayBuffer,
) {
  const actualBytes = buffer.byteLength
  const run = pages.map(({ url, bytes, sha256, range }) => {
    return { url, bytes, sha256, offset: range?.offset ?? 0 }
  })
  const checked = await verifiedRun(run, buffer)
  checked.forEach(({ bytes, found }, at) => {
    const { url, bytes: expectedBytes, sha256: expectedHash } = pages[at],
      hashMatches = bytes !== undefined
    emit?.(
      'page-hash-check',
      hashMatches ? 'Page hash and size verified' : 'Page verification failed',
      () => ({
        ...{ version: 1, url, expectedBytes, actualBytes, expectedHash, actualHash: found ?? null },
        ...{ sizeMatches: hashMatches || found !== undefined, hashMatches },
      }),
    )
    if (!hashMatches)
      emit?.('page-corruption', 'Corrupt page or unexpected size', () => ({ version: 1, url }))
  })
  return checked
}
