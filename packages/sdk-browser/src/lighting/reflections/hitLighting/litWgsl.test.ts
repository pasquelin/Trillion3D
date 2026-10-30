// The hit lighting's programs (`litWgsl.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { REFLECTION_HIT_LIT, REFLECTION_HIT_MATERIAL_WORD } from './constants.ts'
import {
  LIT_DIRECT_HOST,
  LIT_DIRECT_WGSL,
  LIT_FINISH_WGSL,
  LIT_PATH_HOST,
  litCompactProgram,
} from './litWgsl.ts'
import { LIT_MATERIAL_WGSL, LIT_RESOLVE_WGSL, litPathWgsl } from './pathWgsl.ts'
import { reflectionTraceShader } from '../trace/trace.ts'
import { reservedNames } from '../../../gpu/core/wgslNames.fixture.ts'

// The first pass is the path every host shares (`pathWgsl.ts`) under the reflections' kernel, the second the shared resolve under theirs: the guards read the two together.
const PATH = litPathWgsl(LIT_PATH_HOST)
const DIRECT_TEXT = `${LIT_DIRECT_WGSL.text}\n${LIT_DIRECT_HOST.text}\n${PATH.text}`
const FINISH_TEXT = `${LIT_FINISH_WGSL.text}\n${LIT_RESOLVE_WGSL.text}`

test('the compaction keeps the rays whose hit is marked and writes the key of its material with its sixteenth bit', () => {
  const text = litCompactProgram()
  assert.match(text, new RegExp(`litHits\\[record\\]&${REFLECTION_HIT_LIT}u`))
  assert.match(
    text,
    new RegExp(`\\(litHits\\[record\\+${REFLECTION_HIT_MATERIAL_WORD}u\\]&0x7fffu\\)\\|0x8000u`),
  )
  assert.match(text, /fn litDispatch/)
  assert.match(text, /lp\.width/)
})

test('the first pass traces from a thousandth short of the hit, lights it by the material’s whole response, and the force-opaque switch is the retrace’s, not the shadow rays’', () => {
  const text = DIRECT_TEXT
  assert.match(text, /max\(found-0\.001,0\.0\)/)
  assert.match(text, /standardLobe\(surface,N,V,normalize\(L\+V\),NdotL,1\.0\/NdotL\)/)
  assert.match(
    text,
    /retraceFlags=trace\.ray\.flags\|select\(0u,ST_FORCE_OPAQUE,hitLightHas\(HIT_LIGHT_FORCE_OPAQUE\)\)/,
  )
  const visible = text.slice(text.indexOf('fn litVisible'), text.indexOf('fn litLightRay'))
  assert.ok(!visible.includes('HIT_LIGHT_FORCE_OPAQUE'))
  // The shadow rays of the fractional mode pass the translucent surfaces by their coverage in the one traversal of the scene trace, whole translucent meshes included, and never loop.
  assert.match(visible, /ST_MEET_TRANSLUCENT\|ST_ACCUMULATE/)
  assert.match(visible, /return select\(stVisibility,vec3f\(0\.0\),seen\.hit\|\|!stComplete\)/)
  assert.ok(!visible.includes('for('))
  // The light's profile and function (in grey) weigh the whole of its contribution.
  assert.match(
    text,
    /let given=lightProfileOf\(light,P\)\*dot\(lightFunctionOf\(light,P\),vec3f\(1\.0\/3\.0\)\);/,
  )
  assert.match(text, /direct\+=given\*irradiance\*visible/)
  // A shadow ray toward the sun runs as far as the longest ray of the view, not to infinity.
  assert.match(text, /fn litSunReach\(\)->f32\{return reflectionView\.march\.w;\}/)
})

test('the passes over the list are dispatched in rows of the device’s workgroups, the normal is the trace’s own and the occlusion of an open hit is left out', () => {
  const compact = litCompactProgram()
  assert.match(compact, /let grid=groupGrid\(ceilDiv\(atomicLoad\(&litList\.count\),64u\)\)/)
  assert.match(compact, /litArgs\[4\]=grid\.y/)
  assert.match(DIRECT_TEXT, /let N=hit\.normal;/)
  assert.ok(!FINISH_TEXT.includes('pow('))
  assert.ok(!LIT_MATERIAL_WGSL.text.includes('opacity'))
  // The ray’s point and top normal come from the depth and the lobe alone, not the whole surface.
  assert.match(DIRECT_TEXT, /reflectingPointAt\(REFLECTION_LAYER,coord\)/)
})

test('the second pass adds the indirect light over pi on the diffuse colour and the rough share of the specular one, reads the cache over the ray’s cone and fogs from the surface it left', () => {
  const text = FINISH_TEXT
  assert.match(
    text,
    /\(colours\.xyz\+rough\)\*select\(vec3f\(0\.0\),cards\.radiance,cards\.valid\)\*0\.3183098861837907/,
  )
  assert.match(text, /reflectionHitSpread\(look\.cone\)/)
  assert.match(text, /reflectionOrigin=trace\.own\.P/)
  assert.match(text, /HIT_LIGHT_CAPTURES/)
})

test('the passes name no reserved word and hold no backtick', () => {
  for (const text of [DIRECT_TEXT, FINISH_TEXT, LIT_MATERIAL_WGSL.text]) {
    assert.deepEqual(reservedNames(text), [])
    assert.ok(!text.includes('`'))
  }
  assert.deepEqual(reservedNames(litCompactProgram()), [])
})

test('the scene stage through the triangles holds no hit lighting code unless it is asked for it', () => {
  const none = reflectionTraceShader(false, true)
  assert.ok(
    !none.includes('litDirect') && !none.includes('litMaterialKey') && !none.includes('hitLightOn'),
  )
  assert.ok(!none.includes('|=2147483648u'))
  const direct = reflectionTraceShader(
    false,
    true,
    'none',
    'r32uint',
    undefined,
    undefined,
    'direct',
  )
  assert.ok(
    direct.includes('fn litDirect') && direct.includes('litMaterialKey(hit.placement,hit.record)'),
  )
  assert.ok(direct.includes('|=2147483648u'))
  const finish = reflectionTraceShader(
    false,
    true,
    'none',
    'r32uint',
    undefined,
    undefined,
    'finish',
  )
  assert.ok(finish.includes('fn litFinish') && !finish.includes('fn litDirect'))
})

test('the accumulating shadow rays pass a translucent surface by what the resolver of the hit’s material words says, an HLOD actor’s own included, and only the hit lighting’s program has them', () => {
  const direct = reflectionTraceShader(
    false,
    true,
    'none',
    'r32uint',
    undefined,
    undefined,
    'direct',
  )
  assert.match(
    direct,
    /fn stAccumulates\(placement:u32,record:u32\)->bool\{\s*if\(\(stRay\.flags&ST_ACCUMULATE\)==0u\)\{return false;\}\s*let material=stMaterialWordOf\(placement,record\);/,
  )
  assert.match(
    direct,
    /stVisibility\*=vec3f\(1\.0-opacity\)\+stVec3\(material\+8u\)\*opacity;\s+if\(any\(stVisibility>vec3f\(0\.0\)\)\)\{return true;\}\s+stVisibility=vec3f\(0\.0\);/,
  )
  assert.equal(direct.match(/fn stAccumulates/g)?.length, 1)
  assert.equal(direct.match(/fn stMaskWord/g)?.length, 1)
  // One resolver of the hit's material words, read by the material, its key, its translucency and the shadow rays: no copy of it, no copy of the vector read.
  assert.equal(direct.match(/fn stMaterialWordOf/g)?.length, 1)
  assert.equal(direct.match(/stMaterialWordOf\(placement,record\)/g)?.length, 4)
  assert.ok(!LIT_MATERIAL_WGSL.text.includes('litMaterialWord'))
  assert.ok(!LIT_MATERIAL_WGSL.text.includes('litMaterialFloat3'))
  assert.ok(!LIT_MATERIAL_WGSL.text.includes('stMaskWord'))
  const none = reflectionTraceShader(false, true)
  assert.ok(!none.includes('stVisibility') && none.includes('{return false;}'))
})

test('a path of several reflection bounces lights each vertex as the first, weighs it by the top layer’s reflectance met, and the second pass reads every vertex', () => {
  const text = DIRECT_TEXT
  // The path ends on rough surfaces by the roughness it accumulated, and goes on along a ray reflected on a visible normal of the lobe.
  assert.match(text, /pathRoughness=1\.0-\(1\.0-pathRoughness\)\*\(1\.0-material\.roughness\)/)
  assert.match(text, /litTraceShare\(pathRoughness\*pathRoughness\)/)
  assert.match(
    text,
    /top=environmentBrdf\(material\.specular,envBrdfF90\(material\.specular\),material\.roughness,saturate\(dot\(N,V\)\)\)/,
  )
  assert.match(text, /through\*=material\.coverage\*top;/)
  assert.ok(!text.includes('through*=material.specular') && !text.includes('through*=top;'))
  // The lights draw from a copy of the path's own sequence, once a light; a ray that leaves with its walk unfinished is black, not the sky.
  assert.match(text, /var lightRng=rng;/)
  assert.match(text, /litLightRay\(light,P,&lightRng\)/)
  assert.ok(!text.includes('ptRandCreateDiffused(g,reflectionView.temporal.y,rank'))
  assert.match(
    text,
    /else if\(kk>0u\|\|seg>0u\)\{\s+if\(stComplete\)\{[^}]*litPack\(refractThrough\*through,select\(4\.0,2\.0,kk==0u\)\)[^}]*\}else\{[^}]*litPack\(vec3f\(0\.0\),3\.0\)/,
  )
  assert.match(
    text,
    /visibleGgxHalf\(e,vec2f\(material\.roughness\*material\.roughness\),tangentV\)/,
  )
  assert.match(text, /e\.y\*=1\.0-0\.1;/)
  // The specular terms of a vertex keep the share the next ray does not carry; the sky is left to the second pass.
  assert.match(text, /litPack\(weight\*0\.45\*material\.specular\*\(1\.0-next\),0\.0\)/)
  assert.match(
    text,
    /out0=vec4u\(litPack\(refractThrough\*through,select\(4\.0,2\.0,kk==0u\)\),0u,0u\);/,
  )
  const finish = FINISH_TEXT
  assert.match(finish, /for\(var k=0u;k<hitLightVertices\(\);k\+\+\)/)
  assert.match(finish, /radiance\+=base\.xyz\*skyRadianceAt\(D,0\.0\);/)
  assert.match(finish, /scPlacementMeshCards\(scHitPlacement\(object\)\)/)
  // One vertex keeps the two vec4u a trace and the first hit's record.
  assert.match(
    reflectionTraceShader(false, true, 'none', 'r32uint', undefined, undefined, 'direct'),
    /fn litSlot\(g:vec2u\)->u32\{return \(g\.y\*reflectionGridSize\(\)\.x\+g\.x\)\*\(2u\+4u\*\(hitLightVertices\(\)-1u\)\);\}/,
  )
})

test('the refraction events are stretches of the path: the translucent surfaces are met, the path goes on straight past the first surface of a stretch, weighed by what its coverage lets through', () => {
  const text = DIRECT_TEXT
  assert.match(text, /let vertices=hitLightVertices\(\);/)
  assert.match(text, /nextRefract=vec3f\(1\.0-material\.coverage\);/)
  assert.match(text, /let weight=refractThrough\*through\*material\.coverage;/)
  assert.match(text, /through\*=material\.coverage\*top;/)
  assert.match(text, /refractThrough\*=nextRefract;/)
  assert.match(text, /!any\(refractThrough>=vec3f\(0\.01\)\)/)
  assert.match(text, /seg>=refractions/)
  // The next stretch begins past the first surface of this one, in the direction the path began in.
  assert.match(text, /refractOrigin=P\+0\.0005\*D;/)
  // The retrace culls back faces like the first trace: no unlit back-face branch is left.
  assert.ok(
    !text.includes('hit.frontFace') && !text.includes('refractOrigin=origin+D*hit.distance'),
  )
  assert.match(text, /origin=refractOrigin;\s+D=refractDir;/)
  // A vertex passed without light is skipped by the second pass; the sky is weighed by both throughputs.
  assert.match(text, /litPack\(vec3f\(0\.0\),3\.0\)/)
  assert.match(text, /select\(4\.0,2\.0,kk==0u\)/)
  // A sky met after a reflection bounce lets the path go on in its next stretch; one that began a stretch ends it.
  assert.match(FINISH_TEXT, /if\(base\.w>2\.5&&base\.w<3\.5\)\{continue;\}/)
  assert.match(FINISH_TEXT, /if\(base\.w<3\.0\)\{break;\}\s+continue;/)
  assert.match(FINISH_TEXT, /for\(var k=0u;k<hitLightVertices\(\);k\+\+\)/)
  // The path's radiance holds the vertices of every stretch.
  assert.match(
    reflectionTraceShader(false, true, 'none', 'r32uint', undefined, undefined, 'direct'),
    /\(2u\+4u\*\(hitLightVertices\(\)-1u\)\)/,
  )
})

test('the scene stage meets the translucent surfaces and has the hit lighting light them only where the path goes through them', () => {
  const lit = reflectionTraceShader(false, true, 'none', 'r32uint', undefined, undefined, 'direct')
  // Only where the hit lighting runs this image (the view tells so while its kernels compile).
  assert.match(
    lit,
    /select\(ST_SKIP_TRANSLUCENT,ST_MEET_TRANSLUCENT,hitLightOn\(\)&&hitLightRefractions\(\)>0u\)/,
  )
  assert.match(
    lit,
    /hitLightOn\(\)&&hitLightRefractions\(\)>0u&&litTranslucent\(hit\.placement,hit\.record\)/,
  )
  const none = reflectionTraceShader(false, true)
  assert.ok(
    !none.includes('hitLightRefractions') && none.includes('ST_SKIP_TRANSLUCENT|ST_CULL_BACK'),
  )
})

test('the first pass holds the light under the view’s pre-exposure, the second divides it out, and the exposure the lights are read under is the view’s', () => {
  const program = (entry: 'direct' | 'finish') =>
    reflectionTraceShader(false, true, 'none', 'r32uint', undefined, undefined, entry)
  const scale = /fn litScale\(\)->f32\{return max\(view\.preExposure\.x,1\.0e-6\);\}/
  const direct = program('direct')
  const finish = program('finish')
  assert.match(direct, scale)
  assert.match(direct, /let exposure=reflectionView\.radiance\.z;/)
  assert.match(
    DIRECT_TEXT,
    /litPack\(min\(weight\*\(material\.emissive\+direct\)\*litScale\(\),vec3f\(65504\.0\)\),1\.0\)/,
  )
  assert.match(finish, scale)
  assert.match(FINISH_TEXT, /radiance\+=base\.xyz\/litScale\(\);/)
})
