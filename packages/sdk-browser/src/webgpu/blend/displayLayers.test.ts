// #558: what is drawn in front of (or behind) a multiply surface, where the display mask is set,
// ends as the witness (three@0.174) shows it — at least as close as develop, which blended every
// layer in linear light. One pixel follows each system: the witness's canvas of display values,
// develop's lit target through the tone curve, and this branch's lit target, tint and added value
// through the shipped route (`displayRun.fixture.ts`) and the pipelines' own blend states, composed
// as the display filter pass composes them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { blend, close, display, written, type Rgba } from './blendModel.fixture.ts';
import { ADD_EQUATIONS, TINT_EQUATIONS } from './equations.ts';
import { ACES, displayRoute } from './displayRun.fixture.ts';
import { ALPHA_BLEND } from './stagePipelines.ts';
import { BLENDS } from '../../particles/drawWords.ts';
import { waterCompositeTargets } from '../water/compositeTargets.ts';
import { blendTargets } from './blendTargets.ts';
import { particleTargets } from '../../particles/particleTargets.ts';

type Pixel = { lit: Rgba; tint: Rgba; add: Rgba };
type Layer = {
  /** The witness's canvas after the layer, from its display value `canvas`. */
  witness: (canvas: number[]) => number[];
  /** Develop's lit target after the layer. */
  develop: (lit: Rgba) => Rgba;
  /** This branch's lit target, tint and added value after the layer, `masked` or not. */
  routed: (pixel: Pixel, masked: number) => Pixel;
};

const rgb = (value: Rgba | number[]) => value.slice(0, 3);
const rgba = ([r, g, b]: number[], a: number): Rgba => [r, g, b, a];
const clamp = (values: number[]) => values.map((v) => Math.min(1, Math.max(0, v)));
const scale = (values: number[], k: number) => values.map((v) => v * k);

/** A layer of straight colour `colour` through `targets` (lit, tint, added value); `premultiplied`
 *  as a particle writes it; `develop`, the lit target's state on develop. */
function layer(
  colour: Rgba,
  targets: GPUColorTargetState[],
  develop: GPUBlendState,
  kind: 1 | 2 = 1,
  premultiplied = false,
): Layer {
  const out = premultiplied ? rgba(scale(rgb(colour), colour[3]), colour[3]) : colour;
  const shown = display(colour),
    adds = develop.color.dstFactor === 'one';
  const [tint, add] = targets.slice(1).map((target) => target.blend!);
  return {
    witness: (canvas) =>
      clamp(
        canvas.map((d, c) =>
          kind === 2 ? d * shown[c] : d * (adds ? 1 : 1 - colour[3]) + shown[c] * colour[3],
        ),
      ),
    develop: (value) => blend(develop, out, value),
    routed: (pixel, masked) => {
      const r = displayRoute[kind](rgb(colour), 1, ACES, false, colour[3], masked);
      const kept = rgba(premultiplied ? scale(rgb(out), r.keep) : rgb(out), out[3] * r.keep);
      return {
        lit: written(targets[0], kept, pixel.lit),
        tint: blend(tint, r.tint, pixel.tint),
        add: blend(add, r.add, pixel.add),
      };
    },
  };
}

/** The blend pass's layer of `mode`: lit target, tint and added value of its filtered pipeline. */
const blendLayer = (mode: 'normal' | 'additive' | 'multiply', colour: Rgba) => {
  const targets = blendTargets(mode, 0xf, true, true);
  return layer(
    colour,
    [targets[0]!, ...targets.slice(-2).map((target) => target!)],
    blendTargets(mode, 0xf, true)[0]!.blend!,
    mode === 'multiply' ? 2 : 1,
  );
};

const paper: Rgba = [0.89, 0.85, 0.78, 1];
const filter = blendLayer('multiply', [0.1, 0.3, 0.9, 1]);

/** The three results of `layers` drawn in order over `base`, the mask set or not. */
function onePixel(base: Rgba, layers: Layer[], masked = 1) {
  let canvas = display(base),
    lit = base,
    pixel: Pixel = { lit: base, tint: [1, 1, 1, 1], add: [0, 0, 0, 0] };
  for (const each of layers) {
    canvas = each.witness(canvas);
    lit = each.develop(lit);
    pixel = each.routed(pixel, masked);
  }
  // The display filter pass: the composed lit target times the tint, plus the added value.
  const tinted = blend(TINT_EQUATIONS.multiply!, pixel.tint, rgba(display(pixel.lit), 1));
  const shown = clamp(rgb(blend(ADD_EQUATIONS.additive!, pixel.add, tinted)));
  return { witness: canvas, develop: display(lit), routed: shown };
}

/** The routed pixel is the witness's, and never farther from it than develop's, which is off. */
function assertWitness(name: string, base: Rgba, layers: Layer[]) {
  const { witness, develop, routed } = onePixel(base, layers);
  close(routed, witness, name, 1e-5);
  for (let c = 0; c < 3; c++)
    assert.ok(
      Math.abs(routed[c] - witness[c]) <= Math.abs(develop[c] - witness[c]) + 1e-9,
      `${name} ${c}`,
    );
  assert.ok(
    Math.max(...witness.map((w, c) => Math.abs(develop[c] - w))) > 0.02,
    `${name}: develop is off`,
  );
}

test('a normal surface over or under a multiply one shows the witness', () => {
  // A dark glass in front of the filter over bright paper: a lift of the filter by its coverage
  // alone showed the paper through it.
  for (const glass of [
    [0.02, 0.02, 0.02, 0.5],
    [0.9, 0.2, 0.1, 0.6],
  ] as Rgba[]) {
    assertWitness('normal over multiply', paper, [filter, blendLayer('normal', glass)]);
    assertWitness('normal under multiply', paper, [blendLayer('normal', glass), filter]);
  }
});

test('an additive surface over a multiply one is not dimmed', () => {
  assertWitness('additive over multiply', paper, [
    filter,
    blendLayer('additive', [0.3, 0.25, 0.1, 0.7]),
  ]);
});

test('particles and water over a multiply surface show the witness', () => {
  const smoke: Rgba = [0.5, 0.5, 0.55, 0.6],
    fire: Rgba = [2, 0.8, 0.2, 0.5],
    water: Rgba = [0.05, 0.2, 0.3, 0.8];
  const particle = (colour: Rgba, kind: 'premultiplied' | 'additive') =>
    layer(colour, particleTargets(kind, true), BLENDS[kind], 1, true);
  assertWitness('smoke over multiply', paper, [filter, particle(smoke, 'premultiplied')]);
  assertWitness('fire over multiply', paper, [filter, particle(fire, 'additive')]);
  assertWitness('water over multiply', paper, [
    filter,
    layer(water, waterCompositeTargets(false, true), ALPHA_BLEND),
  ]);
});

test('where no filter covers the pixel, every layer draws as develop does', () => {
  const layers = [
    blendLayer('normal', [0.9, 0.2, 0.1, 0.6]),
    blendLayer('additive', [0.3, 0.25, 0.1, 0.7]),
  ];
  const { develop, routed } = onePixel(paper, layers, 0);
  close(routed, develop, 'unmasked');
});
