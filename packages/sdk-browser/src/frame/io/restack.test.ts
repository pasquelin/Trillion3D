// A map that joins a material after open lists the stack it joins to the maps already in the atlases (`restack.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { restackMaterial } from './restack.ts'
import { siblingRef, siblingWord } from '../../materials/virtual/page/pageTable.ts'
import type { Texture } from '../../../../sdk-core/src/texture/contract.ts'
import type { TileTexture } from '../../materials/virtual/tileTexture.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'

const texture = () =>
  ({
    channel: 0,
    wrapS: 'repeat',
    wrapT: 'repeat',
    magFilter: 'linear',
    minFilter: 'linearMipLinear',
    anisotropy: 1,
    transform: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  }) as unknown as Texture
const sized = (side: number) => ({ layout: { width: side, height: side } }) as TileTexture

test('the maps of a material in the atlases are listed to each other, by the bias of their sizes', () => {
  const map = texture(),
    normal = texture()
  const calls: unknown[] = []
  const rt = {
    vis: {
      mapLayer: new Map([[map, 1]]),
      dataLayer: new Map([[normal, 1]]),
      textures: {
        color: { textures: [sized(1), sized(2048)] },
        data: { textures: [sized(1), sized(1024)] },
        stack: (joins: unknown[]) => calls.push(...joins),
      },
    },
  } as unknown as WebgpuPagesRuntime
  restackMaterial(rt, { map, normalMap: normal } as never)
  assert.deepEqual(calls, [
    { kind: 'color', slot: 1, words: [siblingWord(siblingRef('data', 1), 1)] },
    { kind: 'data', slot: 1, words: [siblingWord(siblingRef('color', 1), -1)] },
  ])
})

test('a material whose maps lie alone in the atlases lists nothing', () => {
  const map = texture()
  const calls: unknown[] = []
  const rt = {
    vis: {
      mapLayer: new Map([[map, 1]]),
      dataLayer: new Map(),
      textures: {
        color: { textures: [sized(1), sized(512)] },
        data: { textures: [sized(1)] },
        stack: (...a: unknown[]) => calls.push(a),
      },
    },
  } as unknown as WebgpuPagesRuntime
  restackMaterial(rt, { map } as never)
  assert.equal(calls.length, 0)
})
