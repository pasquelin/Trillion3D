// What the shadow maps' CPU plan and its passes leave in the GPU's buffers, over three frames of
// random suns, spots and point lights that move under a moving eye (`planFrames.fixture.ts`): the
// same bytes, frame by frame, as the plan built before its scratch was kept (S20). The digests
// were taken on that plan; a change of what the GPU reads changes them. Retaken when the uniform
// block, then the projection record, lost the fields no shader read, when the record's flags
// took the bits in a row, and when the invalidation lost its primitive words (an instance's word 15
// a pad, 0), and when the invalidation's payload became the map id alone (it was the id shifted
// above eight flag bits) and the next-data flags lost the id-valid bit no shader read (an old
// frame's digest, those words read back as they are now, is the digest below), and when the
// vertex-displacement fields no host set left the record (its dither scale and mip level a word
// lower, two pad words after), the uniform block (word 14 a pad, 0) and the instance flags (the
// cached-as-dynamic bit from 6 to 1): every other buffer, every word a shader reads, every flag, kept.
// Retaken when the world-to-light rotation was built from the direction's axes rather than angles
// in degrees (an image change, class 2): the suns' and spots' matrices and the suns' level
// centres move by under 1e-7 of their scale, nearer the exact rotation; no page, offset or other
// buffer moves. Retaken when a spot's outer cone was clamped in radians rather than through
// degrees and an f32 pi (class 2): ten spot records' matrices move by under 1.4e-7 of their scale.
// Retaken when a record's level and level count took a word each (they shared one, the level
// offset by a constant): a sun's level and count read as before, a local light's count too, its
// level 0 where no shader reads it; every other word kept.
// Retaken when the record's fields took another order, the words a light keeps first: each
// record's words the same, permuted field by field; every other buffer kept.
// Retaken when the pool's buffers took their names here (the digest hashes each label): the
// same bytes in every buffer.
// Retaken when the uniform block took its words by role, 208 bytes for 224: the same words
// permuted, its pads gone; every other buffer kept.
// Retaken when the next-map table was compared on the records its ids dropped or took alone: a
// record dropped past the frame's count is zeroed that frame, where it was left until the count
// reached it again — seed 1's third frame, records 8234 to 8238 of a count of 8234, words no shader
// reads (`prevHandle.id < nextMapCount`); every word read, and every other buffer, kept.
// Retaken when the invalidation read its rows' width off `num_workgroups` (`flatIndex`): its params'
// third word, the width it carried, a pad, 0 — seed 2's third frame; every other word kept.
// Retaken when the per-page thread-per-id bin read its rows' width off `num_workgroups` too: its
// params' third word, the row pitch it carried, a pad, 0; every other word and buffer kept.
import test from 'node:test'
import assert from 'node:assert/strict'
import { planFrames, randomWorld, seeded } from './planFrames.fixture.ts'

const DIGESTS: Record<number, string[]> = {
  1: [
    '5f9fcbad2310bf24be7defe5dc3f359ed4ea8db31c6943bc3140126ab201e3d1',
    '39d2f9cd7d229efb39c75705070cfb0150a4a03d3be5b19d229b08a252c721dd',
    'd742542eb8c42384251021a7e2be4a238347dc6e0d260dbfc90c78007eb274ef',
  ],
  2: [
    '6f1d70f9e26b0eb55cf2dffc6b735dfab1f7a27eb6d4bc8a9232cb0f539cb203',
    '7c1efdf7558dd2f964a8f2c0dc4726b82f29a550a33f2ccb62e85f7a5d8f333a',
    '404726114ac50fa65b9929bf5e47a247e253e13d40b68a967a4a19d6129fa69c',
  ],
}

for (const seed of [1, 2])
  test(`seed ${seed}: three frames leave the same bytes in every buffer they write`, () => {
    const random = seeded(seed)
    const run = planFrames()
    const eye: [number, number, number] = [0, 2, 0]
    const digests: string[] = []
    let world = randomWorld(random, eye)
    for (let f = 0; f < 3; f++) {
      // Each frame the eye walks and some lights keep their last pose: cached and invalidated maps.
      const next = randomWorld(random, [eye[0] + f * 3, eye[1], eye[2] - f * 2])
      world = {
        ...next,
        lights: next.lights.map((light, k) => (random() < 0.4 ? world.lights[k] : light)),
      }
      run.frame(world)
      digests.push(run.digest())
    }
    assert.deepEqual(digests, DIGESTS[seed])
  })
