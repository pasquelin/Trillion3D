// The resolve of a capture (`RESOLVE_WGSL`): the albedo a card keeps for a texel. The diffuse colour keeps all of its energy under the
// specular lobe (the energy preservation of the environment path is one there) and gains that lobe; the lobe's reflectance at normal
// incidence is the material's own specular.
import test from 'node:test'
import assert from 'node:assert/strict'
import { assertProgramAssembles } from '../../gpu/core/wgslNames.fixture.ts'
import { wgslF32 } from '../../../../math/src/wgsl/number.ts'
import { SHEEN_LTC_ALBEDO_ALONG_NORMAL } from '../../../../sdk-core/src/lighting/sheenLtc.ts'
import {
  COPY_COMPRESSED_WGSL,
  COPY_WGSL,
  RESAMPLE_LIGHTING_WGSL,
  RESOLVE_WGSL,
  copyEntryPoints,
} from './copyWgsl.ts'

test('the resolve assembles and reads the surfaces’ words beside their colours', () => {
  assertProgramAssembles(RESOLVE_WGSL, 'resolvePages', 'the capture resolve')
  assert.match(RESOLVE_WGSL, /@group\(0\) @binding\(9\) var capWords:texture_2d_array<u32>;/)
})

test('the diffuse colour keeps all of its energy under the specular lobe, and the lobe is added', () => {
  // The lobe is the energy table's, of roughness one along the normal, with the energy its single scattering misses restored.
  assert.match(RESOLVE_WGSL, /let lobe=lobeEnergy\(f0,f90,1\.0\);/)
  assert.match(RESOLVE_WGSL, /let restored=vec3f\(1\.0\)\+f0\*\(\(1\.0-e\.x\)\/e\.x\);/)
  assert.match(RESOLVE_WGSL, /return restored\*\(e\.x\*f0\+e\.y\*\(f90-f0\)\);/)
  assert.doesNotMatch(RESOLVE_WGSL, /ROUGH_LOBE/)
  // No energy preservation darkens the diffuse colour by the lobe's luminance.
  assert.doesNotMatch(RESOLVE_WGSL, /preserved/)
  assert.doesNotMatch(RESOLVE_WGSL, /fn luminance/)
  assert.match(RESOLVE_WGSL, /var diffuse=\(color-color\*metal\)\*layers\+lobe\*layers\+haze;/)
})

test('only a subsurface surface or a thin double-sided sheet adds what it transmits, as the slab of its mean free path lets it through; the sheet’s back is a Lambert one more', () => {
  assert.match(RESOLVE_WGSL, /if\(\(flags&32u\)!=0u\)\{/)
  assert.match(RESOLVE_WGSL, /let transmitted=slabTransmittance\(thin\.xyz\);/)
  assert.match(
    RESOLVE_WGSL,
    /diffuse\+=select\(transmitted\*INVERSE_PI,transmitted,pixelModelOf\(flags\)==\d+u\);/,
  )
  // The transmission is no longer added whatever the layer holds (the skin’s, the profile’s and the eye’s data are not a colour that lets light through).
  assert.doesNotMatch(RESOLVE_WGSL, /diffuse\+=thin\.xyz/)
  // A colour one metre of slab keeps: the extinction it gives, its free path, the extinction of that path, the floor of a millionth.
  assert.match(
    RESOLVE_WGSL,
    /return exp\(-max\(vec3f\(1e-6\),vec3f\(1\.0\)\/max\(vec3f\(1e-12\),freePath\)\)\);/,
  )
})

test('the lobe’s reflectance is the material’s: 0.08 times the specular its flags hold, the base colour for a metal', () => {
  assert.match(
    RESOLVE_WGSL,
    /let flags=textureLoad\(capWords,p,0,0\)\.x;\n\s*surfaceSpecular=specularOfFlags\(flags\);\n/,
  )
  // A cloth's lobe is scaled down by its fuzz's amount, the fuzz taking its place.
  assert.match(
    RESOLVE_WGSL,
    /let cloth=physical&&lobeIsCloth\(texel\);\n\s*let f0=surfaceF0\(color,metal\)\*\(1\.0-select\(0\.0,packedCloth\(texel\),cloth\)\);/,
  )
  assert.match(RESOLVE_WGSL, /return mix\(vec3f\(0\.08\*surfaceSpecular\),rgb,metal\);/)
  assert.doesNotMatch(RESOLVE_WGSL, /mix\(vec3f\(0\.04\)/)
})

test('the resolve binds the lobes and the energy table’s column along the normal beside the words', () => {
  assert.match(RESOLVE_WGSL, /@group\(0\) @binding\(10\) var capLobes:texture_2d<u32>;/)
  assert.match(
    RESOLVE_WGSL,
    /@group\(0\) @binding\(11\) var<storage,read> energyAlongNormal:array<vec2f>;/,
  )
})

test('a clear coat adds the energy of a dielectric lobe at its roughness, restored for its missing scattering, and the layers under it keep the rest', () => {
  // A dielectric's reflectances; the energy is W * (E * F0 + Ef * (F90 - F0)) with W = 1 + F0 * (1 - E) / E.
  assert.ok(RESOLVE_WGSL.includes(`const HAZE_F0:f32=${wgslF32(0.04)};`))
  assert.ok(RESOLVE_WGSL.includes(`const HAZE_F90:f32=${wgslF32(1)};`))
  assert.match(
    RESOLVE_WGSL,
    /fn coatEnergy\(roughness:f32\)->f32\{return lobeEnergy\(vec3f\(HAZE_F0\),vec3f\(HAZE_F90\),roughness\)\.x;\}/,
  )
  // The weight keeps seven bits and the roughness eight, no less than a thousandth, as a packed BSDF holds them.
  assert.match(RESOLVE_WGSL, /floor\(saturate\(unpack2x16unorm\(texel\.z\)\.y\)\*127\.0\)\/127\.0/)
  assert.match(
    RESOLVE_WGSL,
    /clamp\(floor\(saturate\(bitcast<f32>\(texel\.w\)\)\*255\.0\)\/255\.0,0\.001,1\.0\)/,
  )
  assert.match(RESOLVE_WGSL, /layers=mix\(1\.0,saturate\(1\.0-coat\.energy\),coat\.weight\);/)
  assert.match(RESOLVE_WGSL, /haze=coat\.weight\*coat\.energy;/)
})

test('a cloth texel of the lobes target is no clear coat: only a pixel whose flags say it has a lobe, and whose texel is not a cloth’s, reads a coat', () => {
  assert.match(
    RESOLVE_WGSL,
    /let physical=\(flags&64u\)!=0u;\n\s*let texel=textureLoad\(capLobes,p,0\);\n\s*let cloth=physical&&lobeIsCloth\(texel\);/,
  )
  assert.match(RESOLVE_WGSL, /\}else if\(physical\)\{\n\s*let coat=coatOf\(texel\);/)
  assert.match(RESOLVE_WGSL, /fn lobeIsCloth\(w:vec4u\)->bool\{return w\.w==2147483648u;\}/)
  // The coat's layers and haze are set inside that branch alone, before the diffuse colour is made.
  const branch = RESOLVE_WGSL.slice(RESOLVE_WGSL.indexOf('}else if(physical){'))
  assert.ok(branch.indexOf('layers=mix(') < branch.indexOf('var diffuse='))
})

test('the lookup along the normal blends the two rows around the roughness, the first and last rows holding beyond the table', () => {
  assert.match(RESOLVE_WGSL, /let row=clamp\(roughness\*ENERGY_ROWS-0\.5,0\.0,ENERGY_ROWS-1\.0\);/)
  assert.match(RESOLVE_WGSL, /const ENERGY_ROWS:f32=32\.0;/)
})

test('a cloth’s fuzz sends back the albedo of its lobe along the normal at half way between the surface’s roughness and one, floored', () => {
  assert.ok(
    RESOLVE_WGSL.includes(
      `fn sheenFuzzRoughness(rough:f32)->f32{return clamp(0.5+0.5*rough,${wgslF32(0.02)},1.0);}`,
    ),
  )
  assert.match(
    RESOLVE_WGSL,
    /if\(cloth\)\{\n\s*let amount=packedCloth\(texel\);\n\s*let fuzzAlbedo=sheenLtcAlbedoAlongNormal\(sheenFuzzRoughness\(surface\.w\)\);\n\s*fuzzKeep=mix\(1\.0,1\.0-fuzzAlbedo,amount\);\n\s*fuzzAdded=packedFuzz\(texel\)\*fuzzAlbedo\*amount;/,
  )
})

test('the fuzz scales the whole of the diffuse colour — the lobes, the haze and the subsurface colour included — then adds its own', () => {
  const body = RESOLVE_WGSL.slice(RESOLVE_WGSL.indexOf('fn resolvePages'))
  const statements = [
    'var diffuse=(color-color*metal)*layers+lobe*layers+haze;',
    'diffuse+=select(transmitted*INVERSE_PI',
    'diffuse=diffuse*fuzzKeep+fuzzAdded;',
    'albedo=vec4f(sqrt(max(diffuse,vec3f(0.0))),1.0);',
  ].map((statement) => body.indexOf(statement))
  assert.ok(statements.every((at) => at >= 0))
  assert.deepEqual(
    statements,
    [...statements].sort((a, b) => a - b),
  )
  // A surface with no fuzz keeps all it has and adds nothing.
  assert.match(body, /var fuzzKeep=1\.0;var fuzzAdded=vec3f\(0\.0\);/)
})

test('the albedo of the sheen lobe along the normal is the last row of the table, 32 floats, blended between the texel centres around the root of the roughness', () => {
  assert.ok(
    RESOLVE_WGSL.includes(
      `const SHEEN_LTC_ALBEDO_ALONG_NORMAL=array<f32,32>(${Array.from(SHEEN_LTC_ALBEDO_ALONG_NORMAL, wgslF32).join(',')});`,
    ),
  )
  assert.match(RESOLVE_WGSL, /let column=clamp\(sqrt\(roughness\),0\.0,1\.0\)\*31\.0;/)
  assert.match(RESOLVE_WGSL, /min\(low\+1u,31u\)\],column-floor\(column\)\)/)
})

test('the copy has an entry point for each layer, the depth, the albedo, the normal then the emission, each storing its own layer; a compressed atlas copies its depth alone', () => {
  const layers = ['Depth', 'Albedo', 'Normal', 'Emissive']
  assert.deepEqual(
    copyEntryPoints(false),
    layers.map((layer) => `copy${layer}`),
  )
  assert.deepEqual(copyEntryPoints(true), ['copyDepth'])
  for (const entry of copyEntryPoints(false)) assertProgramAssembles(COPY_WGSL, entry, 'the copy')
  assertProgramAssembles(COPY_COMPRESSED_WGSL, 'copyDepth', 'the compressed copy')
  const stores = (code: string) => [...code.matchAll(/textureStore\((out\w+),/g)].map((m) => m[1])
  assert.deepEqual(stores(COPY_WGSL), ['outDepth', 'outAlbedo', 'outNormal', 'outEmissive'])
  assert.deepEqual(stores(COPY_COMPRESSED_WGSL), ['outDepth'])
  const entries = (code: string) => [...code.matchAll(/fn (copy\w+)\(/g)].map((m) => m[1])
  assert.deepEqual(entries(COPY_WGSL), copyEntryPoints(false), 'declared in the order dispatched')
})

test('the light-carrying resample stores the direct and indirect light as soon as it has read them, before it merges the tile’s shadow factors', () => {
  const body = RESAMPLE_LIGHTING_WGSL.slice(
    RESAMPLE_LIGHTING_WGSL.indexOf('for(var i=0u;i<FACTOR_TILE_WORDS;i++){factors[i]'),
  )
  const statements = [
    'textureStore(outDirect,at,vec4u(packLight(direct)',
    'textureStore(outIndirect,at,vec4u(packLight(indirect)',
    'atomicAnd(&keptFactors[i],factors[i])',
    'framesSum[lane]=frames;',
  ].map((statement) => body.indexOf(statement))
  assert.ok(statements.every((at) => at >= 0))
  assert.deepEqual(
    statements,
    [...statements].sort((a, b) => a - b),
  )
})
