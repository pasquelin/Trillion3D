import test from 'node:test'
import assert from 'node:assert/strict'
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts'
import { entryLevel, packEntry, tileLayout, tilesAt, type TileLayout } from '../../texture/tiles.ts'
import { random } from '../../page/cut/cutRuleChecks.fixture.ts'
import { createWebgpuTilePageTable, type TileKey } from './pageTable.ts'

/** develop's table edits over a copy of the words, its full descent: the frozen oracle. */
function oracle(words: Uint32Array, layouts: TileLayout[]) {
  const levelsAt = words[3]
  const start = (slot: number, level: number) => words[levelsAt + slot * 16 + level]
  const at = ({ slot, level, tx, ty }: TileKey) => {
    const [tw, th] = tilesAt(layouts[slot].width, layouts[slot].height, level)
    if (tx >= tw || ty >= th) throw new Error('TEXTURE_TILE_OUT_OF_LEVEL')
    return start(slot, level) + ty * tw + tx
  }
  const descend = (key: TileKey, visit: (index: number) => void) => {
    const layout = layouts[key.slot]
    for (let level = key.level - 1; level >= 0; level--) {
      const shift = key.level - level,
        [tw, th] = tilesAt(layout.width, layout.height, level)
      const [x1, y1] = [Math.min(tw, (key.tx + 1) << shift), Math.min(th, (key.ty + 1) << shift)]
      for (let y = key.ty << shift; y < y1; y++)
        for (let x = key.tx << shift; x < x1; x++) visit(start(key.slot, level) + y * tw + x)
    }
  }
  const edits = {
    setTile(key: TileKey, word: number) {
      words[at(key)] = word
      descend(key, (i) => {
        if (words[i] === 0 || entryLevel(words[i]) > key.level) words[i] = word
      })
    },
    clearTile(key: TileKey) {
      const leaving = words[at(key)]
      let replacement = 0
      for (let level = key.level + 1; level < layouts[key.slot].tail; level++) {
        const shift = level - key.level,
          [tw, th] = tilesAt(layouts[key.slot].width, layouts[key.slot].height, level)
        const [tx, ty] = [key.tx >> shift, key.ty >> shift]
        // An orphan edge tile skips the levels where it has no parent.
        if (tx >= tw || ty >= th) continue
        const word = words[at({ ...key, level, tx, ty })]
        if (word !== 0 && entryLevel(word) === level) {
          replacement = word
          break
        }
      }
      words[at(key)] = replacement
      descend(key, (i) => {
        if (words[i] === leaving) words[i] = replacement
      })
    },
    /** A resident tile placed again — an atlas resize moves it —: its entry and every entry it
     *  served take the new place, none stays at the old one. */
    place(key: TileKey, word: number) {
      const old = words[at(key)]
      if (old === 0 || entryLevel(old) !== key.level) return edits.setTile(key, word)
      words[at(key)] = word
      descend(key, (i) => {
        if (words[i] === old) words[i] = word
      })
    },
  }
  return edits
}

/** A device whose buffer is a copy the flushes write into, and the writes each flush made. */
function shadowDevice() {
  installGpuGlobals()
  let shadow = new Uint32Array(0),
    writes = 0
  const queue = {
    writeBuffer(_: unknown, offset: number, data: Uint32Array, from = 0, size?: number) {
      const words = data.subarray(from, size === undefined ? undefined : from + size)
      shadow.set(words, offset / 4)
      writes++
    },
  }
  const device = {
    queue,
    createBuffer: ({ size }: { size: number }) => {
      shadow = new Uint32Array(size / 4)
      return { destroy() {} }
    },
  } as unknown as GPUDevice
  return { device, shadow: () => shadow, writes: () => writes, reset: () => (writes = 0) }
}

// The capped descent prunes a subtree already served at the tile's level or finer. The
// table stays develop's, word for word, on arrivals, departures and moves, over layouts whose
// last tiles have no parent (769, 2049): an orphan leaves to its finest ancestor that exists.
test('flushing only the changed words keeps the GPU table develop’s, word for word, in at most 64 writes', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const next = random(seed)
    const layouts = [
      tileLayout(1, 1),
      tileLayout(4096, 4096),
      tileLayout(2048, 700),
      tileLayout(512, 512),
      tileLayout(769, 2049),
    ]
    const gpu = shadowDevice()
    const table = createWebgpuTilePageTable(gpu.device, layouts, {
      kind: 'color',
      feedbackOffset: 0,
    })
    const expected = table.words.slice(),
      develop = oracle(expected, layouts)
    const placed: TileKey[] = []
    for (let op = 0; op < 400; op++) {
      const slot = 1 + Math.floor(next() * 4),
        layout = layouts[slot]
      const level = Math.floor(next() * layout.tail)
      const [tw, th] = tilesAt(layout.width, layout.height, level)
      let key: TileKey = { slot, level, tx: Math.floor(next() * tw), ty: Math.floor(next() * th) }
      // Mostly arrivals; departures of placed tiles; a placed tile placed again elsewhere.
      const roll = next()
      if (roll < 0.3 && placed.length) {
        key = placed.splice(Math.floor(next() * placed.length), 1)[0]
        develop.clearTile(key)
        table.clearTile(key)
      } else {
        if (roll < 0.4 && placed.length) key = placed[Math.floor(next() * placed.length)]
        const place = {
          x: Math.floor(next() * 30),
          y: Math.floor(next() * 30),
          layer: Math.floor(next() * 8),
        }
        table.setTile(key, place)
        develop.place(key, packEntry(place, key.level))
        placed.push(key)
      }
      assert.deepEqual(table.words, expected, `seed ${seed}, operation ${op}`)
      if (next() < 0.2) {
        gpu.reset()
        table.flush(gpu.device)
        assert.deepEqual(gpu.shadow(), table.words, `seed ${seed}: the GPU reads the table`)
        assert.ok(gpu.writes() <= 64, `${gpu.writes()} writes in one flush`)
      }
    }
  }
})
