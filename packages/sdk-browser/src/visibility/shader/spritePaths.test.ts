// #364: every path that draws a sprite turns its quad with the one text (`spriteWgsl.ts`), reads
// the sprite's words where its row, item or uniform carries them, and the shadow passes draw no
// sprite, as the reference's casts none. A surface that is no sprite carries zeros and draws as
// before: its expressions stay, character for character, what they were.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SPRITE_GLSL, SPRITE_WGSL, writeSpriteWords } from './spriteWgsl.ts';
import { PAGE_INFO_STRUCT_WGSL } from './pageWgsl.ts';
import { PAGE_GEOMETRY_WGSL } from './pageGeometryWgsl.ts';
import { VIS_SHADER } from './visWgsl.ts';
import { SHADE_SHADER } from './shadeWgsl.ts';
import { rasterSource } from '../../gpu/raster/shader.ts';
import { SHADOW_DEPTH_SHADER } from '../../gpu/shadow/shader.ts';
import { BLEND_SHADER } from '../../webgpu/blend/shader.ts';
import { BLEND_ITEM_WGSL } from '../../webgpu/blend/items.ts';
import { CLUSTER_VERTEX } from '../../webgl/cluster/shaders.ts';
import { SHADER as FALLBACK_SHADER } from '../../webgpu/pages/prepare/shaders.ts';
import { ROW_SPRITE_WORD } from '../../webgpu/row/pageRow.ts';

test('a surface writes its sprite words: its turn and its size rule, zeros when it is none', () => {
  const words = [9, 9, 9, 9];
  writeSpriteWords(words, 1, { rotation: 0.5, sizeAttenuation: true });
  assert.deepEqual(words, [9, 0.5, 1, 9]);
  writeSpriteWords(words, 1, { rotation: -2, sizeAttenuation: false });
  assert.deepEqual(words, [9, -2, -1, 9]);
  writeSpriteWords(words, 1, undefined);
  assert.deepEqual(words, [9, 0, 0, 9]);
});

test('the WGSL and GLSL texts are statement for statement the same formula', () => {
  const body = (text: string) =>
    text
      .slice(text.indexOf('{'))
      .replace(/\b(let|var|float|vec[234]) /g, '')
      .replace(/(vec[234])f\(/g, '$1(')
      .replace(/[{};\s]/g, '');
  assert.equal(body(SPRITE_WGSL), body(SPRITE_GLSL));
});

test('every WebGPU raster turns a sprite page, the shadow passes skip it', () => {
  assert.match(PAGE_INFO_STRUCT_WGSL, /normalScale:f32,sprite:vec2f,padMetalUv/);
  assert.equal(ROW_SPRITE_WORD, 36, 'the row words of PageInfo.sprite');
  assert.ok(PAGE_GEOMETRY_WGSL.includes(SPRITE_WGSL));
  // The compute raster and the hardware skip test read `pageClip`, which turns a sprite page.
  assert.ok(
    PAGE_GEOMETRY_WGSL.includes(
      ' if(page.sprite.y!=0.0){return uni.viewProj*pageSprite(page,pagePosition(page,h,vertex));}\n let clip=vp*vec4f(pagePosition(page,h,vertex),1.0);',
    ),
  );
  assert.ok(rasterSource(4, 16).includes('let ca=pageClip(vp,page,h,ia);'));
  // Both hardware vertex stages, after the untouched triangle and line expressions.
  const hardware =
    ' out.position=uni.viewProj*world;\n if(page.lineWidth>0.0){out.position=pageLine(page,h,id,uni.viewProj*page.world,out.position);}\n if(page.sprite.y!=0.0){out.position=uni.viewProj*pageSprite(page,p);}';
  assert.equal(VIS_SHADER.split(hardware).length - 1, 2);
  // The resolve rebuilds the turned triangle, and shades its turned world positions.
  assert.ok(
    SHADE_SHADER.includes(
      ' if(page.sprite.y!=0.0){w0=pageSprite(page,p0);w1=pageSprite(page,p1);w2=pageSprite(page,p2);}\n var c0=uni.viewProj*w0;',
    ),
  );
  assert.ok(SHADOW_DEPTH_SHADER.includes('||kind!=blended||page.sprite.y!=0.0){out.position='));
});

test('the transparent pass, the fallback and WebGL2 turn a sprite with the same text', () => {
  assert.match(BLEND_ITEM_WGSL, /dash:vec2f,sprite:vec2f,\}/);
  assert.ok(BLEND_SHADER.includes(SPRITE_WGSL));
  assert.ok(
    BLEND_SHADER.includes(
      ' out.position=uni.viewProj*world;out.view=world.xyz;\n // A line quad widens on screen',
    ),
  );
  assert.ok(
    BLEND_SHADER.includes(
      ' if(it.sprite.y!=0.0){let s=spriteAt(uni.viewProj,it.world,vec2f(positions[id*3u],positions[id*3u+1u]),it.sprite);out.position=uni.viewProj*s;out.view=s.xyz;}',
    ),
  );
  assert.ok(FALLBACK_SHADER.includes(SPRITE_WGSL));
  assert.ok(FALLBACK_SHADER.includes('dash:vec2f,sprite:vec2f,}'));
  assert.ok(
    FALLBACK_SHADER.includes(
      ' if(uni.sprite.y!=0.0){let s=spriteAt(uni.viewProj,uni.world,local.xy,uni.sprite);out.position=uni.viewProj*s;out.view=s.xyz;}',
    ),
  );
  assert.ok(CLUSTER_VERTEX.includes(SPRITE_GLSL));
  assert.ok(CLUSTER_VERTEX.includes('uniform vec2 viewport,sprite;'));
  assert.ok(
    CLUSTER_VERTEX.includes(
      'if(sprite.y!=0.0){view=spriteAt(projectionMatrix,instanced?modelViewMatrix*instanceMatrix:modelViewMatrix,position.xy,sprite);\ntoEye=-view.xyz;gl_Position=projectionMatrix*view;}}',
    ),
  );
});
