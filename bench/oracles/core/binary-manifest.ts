// Oracle for batch F, binary manifest side: `packages/sdk-core/src/manifest/binaryLayout.ts:11-26` copied as is.

/** The former validation: a regular expression, then a second reading of the digest. */
function referenceHexDigits(sha: string) {
  if (sha.length !== 64 || !/^[0-9a-f]{64}$/.test(sha))
    throw new Error('A cache object digest is not 64 lowercase hexadecimal characters');
  return sha;
}

/** `writeSha` before batch F: validation then writing, each traversing the digest. */
export function referenceWriteSha(target: Uint8Array, slot: number, sha: string) {
  const text = referenceHexDigits(sha);
  for (let i = 0; i < 64; i++) target[slot * 64 + i] = text.charCodeAt(i);
}
