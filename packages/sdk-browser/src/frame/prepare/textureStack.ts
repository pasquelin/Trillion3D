import { siblingWords } from '../../materials/virtual/stacks.ts'
import type { TileTexture } from '../../materials/virtual/tileTexture.ts'
import type { takeMaterialTextures } from './textures.ts'

export type Census = ReturnType<typeof takeMaterialTextures>

/** Each texture's siblings (`../../materials/virtual/stacks.ts`), listed on the texture. */
export function stackTextures(
  atlases: Record<'color' | 'data', TileTexture[]>,
  siblings: Census['siblings'],
) {
  for (const kind of ['color', 'data'] as const)
    atlases[kind].forEach((texture, slot) => {
      texture.siblings = siblingWords(atlases, texture, siblings[kind][slot])
    })
}
