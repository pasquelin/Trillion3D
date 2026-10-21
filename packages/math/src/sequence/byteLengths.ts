/** The bytes the tables `tables` hold together — typed arrays, or anything that tells its own
 *  `byteLength` —: what a host's `hostBytes` adds up, so a table added is added once. */
export function byteLengths(...tables: readonly { readonly byteLength: number }[]) {
  let bytes = 0
  for (const table of tables) bytes += table.byteLength
  return bytes
}
