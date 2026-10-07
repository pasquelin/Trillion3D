/** Bytes one catalogue entry is reckoned to hold beside its strings: the record and its place in
 *  the manifest's indexes (by url, by page id, by bundle), a fixed rule, never read from the
 *  machine. */
const TABLE_ENTRY_BYTES = 128
/** Bytes of a fingerprint's hexadecimal string. */
const SHA256_CHARS = 64

/** CPU bytes the manifest tables hold for the entry at `url`: its url and fingerprint as UTF-16
 *  strings, and its record in the indexes. */
export const manifestEntryBytes = (url: string) =>
  2 * (url.length + SHA256_CHARS) + TABLE_ENTRY_BYTES

/** CPU bytes the manifest tables of `pages` hold (`manifestEntryBytes` each). */
export const manifestTableBytes = (pages: Iterable<{ url: string }>) => {
  let bytes = 0
  for (const page of pages) bytes += manifestEntryBytes(page.url)
  return bytes
}
