import { WAVE_LOCALS, WaveUniforms, waveProgram } from './waveCode.ts';
import { waveHeight } from './surface.ts';
import { Waves, type WaveSpec } from './waves.ts';

/** A generated wave function, run on the CPU: `(uniforms, px, pz, previous) -> [x, y, z]`. */
export type WaveKernel = (u: Float32Array, px: number, pz: number, previous: number) => number[];

/**
 * The neutral program of `waveCode.ts` printed as JavaScript, every statement rounded to 32 bits
 * (`Math.fround`): the GPU's arithmetic on the very statements the WGSL and GLSL printers emit.
 * Only a GPU's `sin`/`cos` error (WGSL: 2⁻¹¹ absolute on [-π, π]) is not reproduced.
 */
export function kernels(count: number): { offset: WaveKernel; normal: WaveKernel } {
  const F = Math.fround;
  const helpers = {
    sin: (x: number) => F(Math.sin(x)),
    cos: (x: number) => F(Math.cos(x)),
    floor: Math.floor,
    mix: (a: number, b: number, t: number) => F(F(a * F(1 - t)) + F(b * t)),
  };
  const [offset, normal] = waveProgram(count).map((fn) => {
    const body = [
      ...Object.entries(WAVE_LOCALS).map(([name, value]) => `let ${name} = ${value};`),
      ...fn.body.map(
        ([target, expression]) =>
          `${target} = F(${expression.replace(/W\((\d+)\)\.([xyzw])/g, (_, j: string, c: string) => `u[${Number(j) * 4 + 'xyzw'.indexOf(c)}]`)});`,
      ),
      `const v = [${fn.returns.join(', ')}];`,
      fn.normalize ? 'const l = Math.hypot(...v); return v.map((x) => F(x / l));' : 'return v;',
    ].join('\n');
    const make = new Function(
      'F',
      'sin',
      'cos',
      'floor',
      'mix',
      `return (u, px, pz, previous) => {${body}};`,
    );
    return make(F, helpers.sin, helpers.cos, helpers.floor, helpers.mix) as WaveKernel;
  });
  return { offset, normal };
}

/** An eight-wave ocean (the `high` tier): swell to chop, 2.6 m of crest, steepest allowed. */
export const OCEAN: WaveSpec[] = [
  { direction: [1, 0.2], wavelength: 60, amplitude: 1.0, steepness: 0.9 },
  { direction: [0.8, 0.6], wavelength: 31, amplitude: 0.55, steepness: 0.9 },
  { direction: [0.3, 1], wavelength: 18, amplitude: 0.35, steepness: 0.9 },
  { direction: [-0.5, 1], wavelength: 11, amplitude: 0.25, steepness: 0.9, phase: 1 },
  { direction: [1, -0.7], wavelength: 7.3, amplitude: 0.18, steepness: 0.9, phase: 2 },
  { direction: [-1, 0.4], wavelength: 5.1, amplitude: 0.12, steepness: 0.9, phase: 3 },
  { direction: [0.1, -1], wavelength: 3.7, amplitude: 0.08, steepness: 0.9, phase: 4 },
  { direction: [0.6, 0.9], wavelength: 2.6, amplitude: 0.05, steepness: 0.9, phase: 5 },
];

/**
 * The largest height gap, metres, between the CPU (`Waves.height` at the point the GPU drew) and
 * the generated code (the rest grid point `(x, z)` displaced in 32 bits), over a `side × side`
 * grid spanning `extent` metres each way, at `t`.
 */
export function heightGap(specs: WaveSpec[], t: number, extent: number, side: number) {
  const waves = new Waves(specs);
  const { offset } = kernels(waves.count);
  const u = new WaveUniforms(waves).update(t, 1 / 60);
  waves.setTime(t);
  let worst = 0;
  for (let i = 0; i < side; i++)
    for (let j = 0; j < side; j++) {
      const px = Math.fround(-extent + (2 * extent * i) / (side - 1) + 0.37 * j);
      const pz = Math.fround(-extent + (2 * extent * j) / (side - 1) + 0.53 * i);
      const [ox, oy, oz] = offset(u, px, pz, 0);
      const x = Math.fround(px + ox),
        z = Math.fround(pz + oz);
      worst = Math.max(worst, Math.abs(waveHeight(waves, x, z) - oy));
    }
  return worst;
}
