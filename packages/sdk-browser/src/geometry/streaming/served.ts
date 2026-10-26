/** Bytes served at an address of their own (`urls` keeps it, to revoke it), with the digest the
 *  page reader checks. */
export function served(bytes: ArrayBuffer, sha256: string, urls: string[]) {
  const url = URL.createObjectURL(new Blob([bytes]))
  urls.push(url)
  return { url, sha256, bytes: bytes.byteLength }
}
