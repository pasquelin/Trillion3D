/**
 * The renderers' side of the wave model (`waves.ts`): its uniforms, and its WGSL and GLSL code,
 * printed from one neutral program so the two languages cannot drift from each other or from the
 * CPU. The program is scalar and straight-line (the waves are unrolled), in the syntax both shading
 * languages share; a printer only adds declarations, the uniform reads and the function heads.
 */
import type { Waves } from './waves.ts';

/** vec4 slots per wave: `(dirX, dirZ, k, A)` then `(Q·A, phase now, phase before, 0)`. */
export const WAVE_VEC4S = 2;
/** The shading languages the code is printed in. */
export type WaveLanguage = 'wgsl' | 'glsl';
/** The generated functions, both `(px, pz, previous) -> vec3`: `previous` is 0 for the frame at
 *  `t`, 1 for the frame at `t - dt` (the motion vectors of temporal antialiasing). */
export const WAVE_FUNCTIONS = { offset: 'trWaveOffset', normal: 'trWaveNormal' } as const;

/**
 * The uniform words of a wave set at `t` and `t - dt`: `count × WAVE_VEC4S` vec4. Phases are
 * reduced to [0, 2π) in double precision before they become 32-bit, so a long session loses no
 * precision on the GPU. `update` allocates nothing.
 */
export class WaveUniforms {
  readonly data: Float32Array;
  private readonly waves: Waves;
  private readonly now: Float64Array;
  private readonly before: Float64Array;

  constructor(waves: Waves) {
    this.waves = waves;
    this.data = new Float32Array(waves.count * WAVE_VEC4S * 4);
    this.now = new Float64Array(waves.count);
    this.before = new Float64Array(waves.count);
  }

  update(t: number, dt: number) {
    const w = this.waves,
      d = this.data;
    w.phasesAt(t, this.now);
    w.phasesAt(t - dt, this.before);
    for (let i = 0; i < w.count; i++) {
      d.set([w.dirX[i], w.dirZ[i], w.k[i], w.amplitude[i]], i * 8);
      d.set([w.lateral[i], this.now[i], this.before[i], 0], i * 8 + 4);
    }
    return d;
  }
}

/** One statement of the neutral program: `target = expression`. In expressions, `W(j).c` reads
 *  component `c` of uniform vec4 `j`; `px`, `pz`, `previous` are the parameters. */
export type WaveStatement = readonly [target: string, expression: string];
/** A generated function: its statements, the three locals it returns, and whether it normalises. */
export interface WaveFunction {
  name: string;
  body: WaveStatement[];
  returns: readonly [string, string, string];
  normalize: boolean;
}

/** Locals of every function, all floats starting at the value given. */
export const WAVE_LOCALS = { f: 0, c: 0, s: 0, ox: 0, oy: 0, oz: 0, nx: 0, ny: 1, nz: 0 };

/** The statements that give wave `i`'s phase `f`, its cosine `c` and its sine `s`. The phase is
 *  brought back to [-π, π] first: a GPU's `sin` is only accurate there (WGSL: 2⁻¹¹ absolute). */
function phase(i: number): WaveStatement[] {
  const a = `W(${i * 2})`,
    b = `W(${i * 2 + 1})`;
  return [
    ['f', `${a}.z * (${a}.x * px + ${a}.y * pz) - mix(${b}.y, ${b}.z, previous)`],
    ['f', 'f - 6.2831855 * floor(f * 0.15915494 + 0.5)'],
    ['c', 'cos(f)'],
    ['s', 'sin(f)'],
  ];
}

/** The two functions of a set of `count` waves, as neutral programs. */
export function waveProgram(count: number): WaveFunction[] {
  const offset: WaveStatement[] = [],
    normal: WaveStatement[] = [];
  for (let i = 0; i < count; i++) {
    const a = `W(${i * 2})`,
      b = `W(${i * 2 + 1})`;
    offset.push(
      ...phase(i),
      ['ox', `ox + ${b}.x * ${a}.x * c`],
      ['oy', `oy + ${a}.w * s`],
      ['oz', `oz + ${b}.x * ${a}.y * c`],
    );
    normal.push(
      ...phase(i),
      ['nx', `nx - ${a}.x * ${a}.z * ${a}.w * c`],
      ['ny', `ny - ${a}.z * ${b}.x * s`],
      ['nz', `nz - ${a}.y * ${a}.z * ${a}.w * c`],
    );
  }
  return [
    { name: WAVE_FUNCTIONS.offset, body: offset, returns: ['ox', 'oy', 'oz'], normalize: false },
    { name: WAVE_FUNCTIONS.normal, body: normal, returns: ['nx', 'ny', 'nz'], normalize: true },
  ];
}

/** Floats printed so that both languages read them as floats. */
const literal = (value: number) => (Number.isInteger(value) ? `${value}.0` : `${value}`);

const SYNTAX = {
  wgsl: {
    head: (name: string) => `fn ${name}(px: f32, pz: f32, previous: f32) -> vec3<f32> {`,
    local: (name: string, value: number) => `  var ${name}: f32 = ${literal(value)};`,
    vec3: 'vec3<f32>',
  },
  glsl: {
    head: (name: string) => `vec3 ${name}(float px, float pz, float previous) {`,
    local: (name: string, value: number) => `  float ${name} = ${literal(value)};`,
    vec3: 'vec3',
  },
};

/**
 * The declaration of the waves' uniform array, `uniform` being its name. WGSL takes its bind
 * group and binding from the pipeline that includes it.
 */
export function waveUniformDeclaration(
  count: number,
  language: WaveLanguage,
  uniform: string,
  binding = { group: 0, binding: 0 },
) {
  const size = count * WAVE_VEC4S;
  return language === 'wgsl'
    ? `@group(${binding.group}) @binding(${binding.binding}) var<uniform> ${uniform}: array<vec4<f32>, ${size}>;`
    : `uniform vec4 ${uniform}[${size}];`;
}

/** The functions of a set of `count` waves in `language`, reading the uniform array `uniform`. */
export function waveCode(count: number, language: WaveLanguage, uniform: string) {
  const syntax = SYNTAX[language];
  const read = (text: string) =>
    text.replace(/W\((\d+)\)\.([xyzw])/g, (_, j: string, c: string) => `${uniform}[${j}].${c}`);
  return waveProgram(count)
    .map((fn) => {
      const value = `${syntax.vec3}(${fn.returns.join(', ')})`;
      return [
        syntax.head(fn.name),
        ...Object.entries(WAVE_LOCALS).map(([name, v]) => syntax.local(name, v)),
        ...fn.body.map(([target, expression]) => `  ${target} = ${read(expression)};`),
        `  return ${fn.normalize ? `normalize(${value})` : value};`,
        '}',
      ].join('\n');
    })
    .join('\n\n');
}
