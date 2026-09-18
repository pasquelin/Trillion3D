import { EngineError } from './cacheContracts.ts';
import { PREVIEW_ATLAS_NAMES } from './manifestBinaryFormat.ts';

/**
 * L'adresse d'un niveau cuit, depuis le gabarit que le manifeste publie (`textures.url`) : `{sha}`
 * est l'empreinte des octets sources de l'image, `{kind}` le nom de l'atlas, `{level}` le rang du
 * niveau. Le gabarit vient du compilateur et le moteur ne connaît pas la disposition du cache ;
 * une seule vérité, comme pour les pages. Un gabarit sans ses trois champs est refusé : une
 * adresse qui n'en varie pas servirait la même image à toutes les textures.
 */
export function textureLevelUrl(template: string, sha256: string, atlas: number, level: number) {
  const kind = PREVIEW_ATLAS_NAMES[atlas];
  if (kind === undefined)
    throw new EngineError('INVALID_CACHE', 'A texture level names an unknown atlas', { atlas });
  if (!/^[0-9a-f]{64}$/.test(sha256) || !Number.isInteger(level) || level < 0)
    throw new EngineError('INVALID_CACHE', 'A texture level has an invalid address', {
      sha256,
      level,
    });
  for (const field of ['{sha}', '{kind}', '{level}'])
    if (!template.includes(field))
      throw new EngineError('INVALID_CACHE', 'The texture level template lacks a field', {
        template,
        field,
      });
  return template
    .replace('{sha}', sha256)
    .replace('{kind}', kind)
    .replace('{level}', String(level));
}
