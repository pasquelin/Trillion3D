import { runtime } from './frame.fixture.ts';
import { stillTurn, stochasticPhase } from './frameState.ts';
import { convergeStillPhase, restartTaaOnSettle, taaArrivals } from './frame.ts';
import { restartTaaAverage, restartTaaOnLanding } from './landing.ts';
import { taaStillFrames } from './jitter.ts';

/** One step of a scripted sequence: an image (`q` quiet, `m` moving), or what happens between. */
export type Step =
  | 'q'
  | 'm'
  | 'shadow'
  | 'tile'
  | 'view'
  | 'drop'
  | 'refine'
  | 'settled'
  | 'scene'
  | 'rest'
  | `scale ${number}`
  | `replay ${number}`;

/** Runs `steps` on a fresh runtime and records, after each image, what the still average is:
 *  [still count, jitter rank, history, stochastic phase, still turn, arrivals, sampled rank, and the
 *  uniform's share, moving flag and stochastic slot]. Between-steps events record nothing. */
export function runOracle(steps: Step[]) {
  const { rt, temporal, frame } = runtime();
  const state = temporal.frame;
  const saved = { ...state, quiet: false };
  Object.assign(temporal, {
    checkpoint(quiet: boolean) {
      Object.assign(saved, {
        sample: state.sample,
        stochasticSample: state.stochasticSample,
        stillFrames: state.stillFrames,
        hasHistory: state.hasHistory,
        sampledRank: state.sampledRank,
        quiet,
      });
    },
    replay() {
      Object.assign(state, {
        sample: saved.sample,
        stochasticSample: saved.stochasticSample,
        stillFrames: saved.stillFrames,
        hasHistory: saved.hasHistory,
        sampledRank: saved.sampledRank,
      });
      return saved.quiet;
    },
  });
  Object.assign(rt.run.gate, { temporalRevision: 0 });
  const out: string[] = [];
  const image = (quiet: boolean, converging = false, record = true) => {
    const u = frame(quiet);
    if (record)
      out.push(
        [
          state.stillFrames,
          state.sample,
          +state.hasHistory,
          stochasticPhase(state),
          +stillTurn(state).toFixed(6),
          taaArrivals(rt),
          state.sampledRank,
          u ? +u[36].toFixed(6) : 'none',
          u ? u[58] : 'none',
          u ? u[59] : 'none',
          +converging,
        ].join(' '),
      );
  };
  for (const step of steps) {
    if (step === 'q') image(true);
    else if (step === 'm') image(false);
    else if (step === 'shadow') rt.lights.vsm!.settle.renderedTotal += 2;
    else if (step === 'tile') restartTaaOnLanding(rt, 1);
    else if (step === 'view') (rt.run.gate as { temporalRevision: number }).temporalRevision++;
    else if (step === 'drop') restartTaaAverage(state);
    else if (step === 'refine') restartTaaOnSettle(rt, true);
    else if (step === 'settled') restartTaaOnSettle(rt, false);
    else if (step === 'scene') rt.run.gate.revisions.scene++;
    else if (step === 'rest') {
      while (state.stillFrames < taaStillFrames(state.phases) - 1) image(true, false, false);
      image(true);
    } else if (step.startsWith('scale')) rt.scale.set(Number(step.slice(6)));
    else if (step.startsWith('replay')) {
      rt.run.textureConverging = true;
      for (let phase = 1; phase <= Number(step.slice(7)); phase++) {
        convergeStillPhase(rt, phase);
        image(false, true);
      }
      convergeStillPhase(rt, null);
      rt.run.textureConverging = false;
    }
  }
  return out;
}
