// Fog is a term of the one lighting model (#345): every program that lights a surface — the
// opaque resolve with and without bounce, the blended and transmissive surfaces — hands
// its lit colour through `fogged` before the display chain, measured from
// the eye each pass carries. An unlit material is fogged too; a normal or depth
// material, the diagnostic views and the composition are left as they were.
import test from 'node:test'
import assert from 'node:assert/strict'
import { CONTRACT_COMPOSITIONS } from './deferred/shaders.ts'
import { BLEND_VIEW_SIZE, BLEND_VIEW_WGSL } from '../blend/viewLayout.ts'
import { SHADE_SHADER } from '../visibility/shader/shadeWgsl.ts'
import {
  BLEND_SHADER,
  BOUNCE_LIGHTING_SHADER,
  DIRECT_LIGHTING_SHADER,
  TRANSMIT_SHADER,
  UNLIT_LIGHTING_SHADER,
} from '../gpu/core/shaderTexts.fixture.ts'
import { wgslSource } from '../../../math/src/wgsl/source.fixture.ts'

test('the opaque resolve fogs its lit sum at the pixel, from the eye in display.yzw', () => {
  for (const shader of [DIRECT_LIGHTING_SHADER, BOUNCE_LIGHTING_SHADER])
    assert.match(
      shader,
      /var rgb=litSurface\(lit,indirect\[0\],[^\n]*,indirect\[1\],emissive\.rgb,[^;]*\);[^]*?if\(\(surfaceFlag&128u\)==0u\)\{rgb=fogged\(rgb,P,view\.display\.yzw\);\}/,
    )
  // An unlit or matcap surface (flag 1) is fogged; a diagnostic, normal or depth one (flag 3) is not.
  for (const shader of [DIRECT_LIGHTING_SHADER, BOUNCE_LIGHTING_SHADER]) {
    assert.match(shader, /if\(flag==3u\)\{return vec4f\(base\.rgb,1\.0\);\}/)
    assert.match(
      shader,
      /if\(flag==1u\)\{var rgb=base\.rgb;if\(\(surfaceFlag&128u\)==0u\)\{rgb=fogged\(rgb,P,view\.display\.yzw\);\}/,
    )
  }
  assert.match(
    SHADE_SHADER,
    /select\(3u,1u\|select\(0u,128u,\(page\.flags&1048576u\)!=0u\),model==4u\)/,
  )
  assert.doesNotMatch(UNLIT_LIGHTING_SHADER, /fogged/)
  for (const shader of Object.values(CONTRACT_COMPOSITIONS.plain))
    assert.doesNotMatch(shader, /fogged/)
})

test('blended and transmissive surfaces, lit or unlit, are fogged from the eye of the blend view', () => {
  // The lit sum (`litSurface`, the thin subsurface's back light included) closes inside the lit
  // branch (a shadow catcher keeps its colour); the fog closes the branch that skips the unlit
  // view, which keeps what it emits.
  assert.match(
    BLEND_SHADER,
    /if\(!unlit\)\{\s+if\(blendLit\(flags\)\)\{[^]*?rgb=litSurface\([^;]*s\.emissive,[^;]+\);\s+\}\s+\}\s+\/\/.*\s+if\(\(flags&1048576u\)==0u\)\{rgb=fogged\(rgb,in\.view,uni\.eye\.xyz\);\}\s+\}else\{rgb\+=s\.emissive;\}/,
  )
  assert.match(TRANSMIT_SHADER, /let fogFree=unlit\|\|\(flags&1048576u\)!=0u;/)
  assert.match(
    TRANSMIT_SHADER,
    /select\(fogOver\(in\.view,uni\.eye\.xyz\),vec4f\(0\.0,0\.0,0\.0,1\.0\),fogFree\)/,
  )
  // The eye is the view's last vec4: 160 bytes of fields before it, 16 of its own; the pixel
  // ratio a line's width is scaled by (#348), the texture level offset (#816) and the display
  // layers' exposure and curve (#558) follow it, in the struct's 16-byte alignment.
  assert.match(
    wgslSource(BLEND_VIEW_WGSL),
    /pixelRatio:f32,mipBias:f32,exposure:f32,toneCurve:u32,pixelError:f32,\}/,
  )
  assert.equal(BLEND_VIEW_SIZE, 192)
})
