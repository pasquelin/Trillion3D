// the probe batch encoded by a bounce image, and the control loop of this batch on the
// "Bounce" stage duration measured on the GPU.
import { bounceBatchOf, createBounceBudget } from '../../../packages/sdk-core/src/bounce/budget.ts';
import { xorshiftRandom, measure, rapport } from '../../core/index.ts';
import { referenceBounceBatch, referenceBudgetSequence } from '../../oracles/core/bounce-probes.ts';
import type { ReferenceBudget } from '../../oracles/core/bounce-probes.ts';

const alea = xorshiftRandom(101);

interface Charge {
  ceiling: number;
  load: number;
}

// Output belongs to the test case: the timer only measures engine calls.
const paires = (list: Charge[]) => ({ list, output: new Float64Array(list.length) });
const lot =
  (calcule: (ceiling: number, load: number) => number) =>
  ({ list, output }: { list: Charge[]; output: Float64Array }) => {
    for (let i = 0; i < list.length; i++) output[i] = calcule(list[i].ceiling, list[i].load);
    return output;
  };

const mesureLot = await measure({
  name: 'bounce batch',
  fichier: 'packages/sdk-core/src/bounce/budget.ts',
  cas: [
    {
      name: '10 000 pairs',
      input: paires(
        Array.from({ length: 10000 }, () => ({
          ceiling: 100 + Math.floor(alea() * 1000),
          load: alea(),
        })),
      ),
      size: 10000,
    },
    {
      name: 'extremes',
      input: paires([
        { ceiling: 0, load: 0 },
        { ceiling: -1, load: -1 },
        { ceiling: NaN, load: 0 },
        { ceiling: Infinity, load: 1 },
      ]),
      size: 4,
    },
  ],
  calculation: lot(bounceBatchOf),
  expected: lot(referenceBounceBatch),
  options: { tours: 100 },
});

// Samples arrive once every three or twelve frames, sometimes not at all, sometimes bad: the
// sequence mixes durations, nulls, zeroes and non-finites, and the oracle replays the closed
// loop sample by sample. Three output arrays, one per published field.
const SANS_RELEVE: (number | null)[] = [null, 0, -1, NaN, Infinity];
const observations = (count: number) => ({
  list: Array.from({ length: count }, () =>
    alea() < 0.3 ? SANS_RELEVE[Math.floor(alea() * SANS_RELEVE.length)] : 1 + alea() * 4,
  ),
  loads: new Float64Array(count),
  lasts: new Float64Array(count),
  samples: new Float64Array(count),
});

/** The fields `suit` reads and drives, shared by `createBounceBudget`'s `BounceBudget` and the
 *  oracle's `ReferenceBudget` — the two engines this bench sets against each other. */
type BudgetLike = ReferenceBudget;

interface Observations {
  list: (number | null)[];
  loads: Float64Array;
  lasts: Float64Array;
  samples: Float64Array;
}

const suit = (observe: (budgetMs: number) => BudgetLike) => (input: Observations) => {
  const budget = observe(2);
  for (let i = 0; i < input.list.length; i++) {
    budget.observe(input.list[i]);
    input.loads[i] = budget.load;
    input.lasts[i] = budget.lastMs ?? -1;
    input.samples[i] = budget.samples;
  }
  return [input.loads, input.lasts, input.samples];
};

const mesureBudget = await measure({
  name: 'budget control loop',
  fichier: 'packages/sdk-core/src/bounce/budget.ts',
  cas: [
    { name: '100 observations', input: observations(100), size: 100 },
    { name: 'no sample', input: observations(20), size: 20 },
  ],
  calculation: suit(createBounceBudget),
  expected: suit(referenceBudgetSequence),
  options: { tours: 100 },
});

rapport(
  'rebond-sondes',
  [mesureLot, mesureBudget],
  'the bounce batch and budget return the same values',
);
