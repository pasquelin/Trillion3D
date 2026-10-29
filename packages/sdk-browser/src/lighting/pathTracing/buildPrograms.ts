import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { skyLightReadWgsl, type SkyLightBindings } from '../../modules/sky/skyLight/read.ts'
import { SKY_READ_WGSL } from '../atmosphere/skyReadWgsl.ts'
import { PT_BUILD_LIGHT_GRID_WGSL, PT_GRID_PARAMS_WGSL } from './lightGridWgsl.ts'
import { PT_LIGHT_TABLE_STRUCT } from './lightTable.ts'
import { PT_LIGHT_STRUCT_WGSL } from './lightsWgsl.ts'
import { PT_SKY_KERNELS_WGSL } from './skyWgsl.ts'

/** The bindings of the light grid's program: its parameters, the lights (with the energy table before them, as the trace binds them) and the two outputs. */
export const PT_GRID_BUILD_BINDINGS = { params: 0, lights: 1, grid: 2, gridData: 3 } as const

const G = PT_GRID_BUILD_BINDINGS

/** The program that makes the light grid (`ptBuildLightGrid`). */
export const PT_GRID_BUILD_WGSL = wgslProgram(
  `@group(0) @binding(${G.params}) var<uniform> ptGridParams:PtGridParams;
${PT_LIGHT_TABLE_STRUCT}
@group(0) @binding(${G.lights}) var<storage,read> directLights:PtLightTable;
@group(0) @binding(${G.grid}) var ptLightGridOut:texture_storage_2d_array<r32uint,write>;
@group(0) @binding(${G.gridData}) var ptLightGridDataOut:texture_storage_2d<r32uint,write>;`,
  [PT_GRID_PARAMS_WGSL, PT_LIGHT_STRUCT_WGSL, PT_BUILD_LIGHT_GRID_WGSL],
)

/** The sky light's bindings in the program that makes the sky's table: group 0, the cube, its sampler, the harmonics and the light's uniform. */
export const PT_SKY_BINDINGS: SkyLightBindings = {
  group: 0,
  cube: 0,
  sampler: 1,
  harmonics: 2,
  params: 3,
}

/** The program that makes the sky's table (`ptSkyPrepare`, `ptSkyMip`, `ptSkyCompensate`). */
export const PT_SKY_BUILD_WGSL = wgslProgram('', [
  skyLightReadWgsl(PT_SKY_BINDINGS),
  SKY_READ_WGSL,
  PT_SKY_KERNELS_WGSL(PT_SKY_BINDINGS),
])
