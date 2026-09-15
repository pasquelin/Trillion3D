// Oracle du lot F, côté manifeste binaire : `manifestBinaryLayout.ts:11-26` recopié tel quel.

/** L'ancienne validation : une expression régulière, puis une seconde lecture de l'empreinte. */
function referenceHexDigits(sha) {
  if (sha.length !== 64 || !/^[0-9a-f]{64}$/.test(sha))
    throw new Error('A cache object digest is not 64 lowercase hexadecimal characters');
  return sha;
}

/** `writeSha` avant le lot F : validation puis écriture, chacune parcourant l'empreinte. */
export function referenceWriteSha(target, slot, sha) {
  const text = referenceHexDigits(sha);
  for (let i = 0; i < 64; i++) target[slot * 64 + i] = text.charCodeAt(i);
}
