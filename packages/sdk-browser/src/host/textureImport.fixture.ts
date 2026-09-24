import type { Texture } from '../../../sdk-core/src/index.ts';
import { followHostTexture, hostTextureWritten } from './textureImport.ts';

/** A host write announced, then followed: what the engine's writers and each render do. */
export function followWritten(record: Texture) {
  hostTextureWritten();
  followHostTexture(record);
}
