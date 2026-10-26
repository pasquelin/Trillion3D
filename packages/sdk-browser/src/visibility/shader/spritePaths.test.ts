// Every path that draws a sprite turns its quad with the one text (`spriteWgsl.ts`), reads
// the sprite's words where its row, item or uniform carries them. The shadow passes draw no
// sprite, since a sprite casts no shadow, because no light cut selects one
// (`spriteShadowCut.test.ts`): their vertex stage reads no sprite word. A surface that is no sprite carries zeros and draws as
// before: its expressions stay, character for character, what they were.
import test from 'node:test'
import assert from 'node:assert/strict'
import { SPRITE_WGSL, writeSpriteWords } from './spriteWgsl.ts'
import { PAGE_SCREEN_WGSL } from './pageGeometryWgsl.ts'
import { PAGE_SHAPE_WGSL } from './pageShapeWgsl.ts'
import { VIS_SHADER } from './visShader.fixture.ts'
import { SHADE_SHADER } from './shadeWgsl.ts'
import { DAG_VISIBLE_WGSL } from '../../geometry/dag/shader/visibleWgsl.ts'
import { FLAG_LINE, FLAG_SPRITE, FLAG_VOXEL } from '../types.ts'
import { BLEND_ITEM_WGSL } from '../../blend/items.ts'
import { BLEND_SHADER } from '../../gpu/core/shaderTexts.fixture.ts'
import { wgslSource } from '../../../../math/src/wgsl/source.fixture.ts'
import { PAGE_INFO } from '../pageInfo.ts'

test('a surface writes its sprite words: its turn and its size rule, zeros when it is none', () => {
  const words = [9, 9, 9, 9]
  writeSpriteWords(words, 1, { rotation: 0.5, sizeAttenuation: true })
  assert.deepEqual(words, [9, 0.5, 1, 9])
  writeSpriteWords(words, 1, { rotation: -2, sizeAttenuation: false })
  assert.deepEqual(words, [9, -2, -1, 9])
  writeSpriteWords(words, 1, undefined)
  assert.deepEqual(words, [9, 0, 0, 9])
})

test('every raster turns a sprite page off its record, the shadow vertex stage is as before', () => {
  // A row carries no sprite word: its flag, and its surface's record its turn and size rule.
  assert.ok(!('sprite' in PAGE_INFO.at))
  assert.match(wgslSource(PAGE_SHAPE_WGSL), /if\(\(page\.flags&\d+u\)==0u\)\{return PageShape/)
  assert.ok(wgslSource(PAGE_SHAPE_WGSL).includes('return PageShape(m.sprite,m.lineWidth);'))
  assert.ok(wgslSource(PAGE_SCREEN_WGSL).includes(SPRITE_WGSL.text))
  // A pass that reads `pageClip` turns a sprite page.
  assert.ok(
    wgslSource(PAGE_SCREEN_WGSL).includes(
      ' if(shape.sprite.y!=0.0){return uni.viewProj*pageSprite(page,pagePosition(page,h,vertex),shape.sprite);}\n let clip=vp*vec4f(pagePosition(page,h,vertex),1.0);',
    ),
  )
  // The one text, not a name some pass declares its own way: the name sweep proves only a name.
  for (const shader of [VIS_SHADER, SHADE_SHADER])
    assert.ok(shader.includes(PAGE_SCREEN_WGSL.text) && shader.includes(PAGE_SHAPE_WGSL.text))
  // A sprite cluster is the hardware raster's, as a line's and a voxel's: the cut never lists it
  // for the software raster, which draws no turned quad.
  assert.ok(
    wgslSource(DAG_VISIBLE_WGSL).includes(
      `const FORCE_HARDWARE:u32=${FLAG_LINE | FLAG_SPRITE | FLAG_VOXEL}u;`,
    ),
  )
  // The one hardware vertex stage, both halves', after the untouched triangle and line expressions.
  const hardware =
    ' out.position=uni.viewProj*world;\n if(shape.lineWidth>0.0){out.position=pageLine(page,h,id,uni.viewProj*page.world,out.position,shape.lineWidth);}\n if(shape.sprite.y!=0.0){out.position=uni.viewProj*pageSprite(page,p,shape.sprite);}'
  assert.equal(VIS_SHADER.split(hardware).length - 1, 1)
  // The resolve rebuilds the turned triangle, and shades its turned world positions.
  assert.ok(
    SHADE_SHADER.includes(
      ' if(shape.sprite.y!=0.0){w0=pageSprite(page,p0,shape.sprite);w1=pageSprite(page,p1,shape.sprite);w2=pageSprite(page,p2,shape.sprite);}\n var c0=shadeViewProj()*w0;',
    ),
  )
})

test('the transparent pass turns a sprite with the shared text', () => {
  // Its sprite words are its surface's record's, read by its vertex stage.
  assert.doesNotMatch(wgslSource(BLEND_ITEM_WGSL), /sprite/)
  assert.ok(BLEND_SHADER.includes(SPRITE_WGSL.text))
  assert.ok(
    BLEND_SHADER.includes(
      ' out.position=uni.viewProj*world;out.view=world.xyz;\n // A line quad widens on screen',
    ),
  )
  assert.ok(
    BLEND_SHADER.includes(
      ' if(m.sprite.y!=0.0){let s=spriteAt(uni.viewProj,it.world,p.xy,m.sprite);out.position=uni.viewProj*s;out.view=s.xyz;}',
    ),
  )
})
