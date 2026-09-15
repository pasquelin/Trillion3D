// Les bornes que l'hôte relève après le rendu appartiennent à l'image qui vient de se dessiner :
// la ligne du profil n'est donc classée qu'à la fin de l'image, et seulement si elle a été remplie.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCpuStepProfile } from './cpuProfile.ts';
import { CPU_STEP, CPU_STEP_NAMES, endCpuFrame, hostCpuStep } from './webgpuPagesCpuSteps.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/** Ce que la clôture d'image lit, et rien d'autre : un profil, un drapeau, un numéro d'image. */
function banc() {
  const timing = {
    cpuProfile: createCpuStepProfile(CPU_STEP_NAMES),
    rowFilled: false,
    stages: undefined,
    cpuSample: undefined,
    lastCpuLogFrame: -1,
    lastCpuLogMs: 0,
  };
  const rt = {
    timing,
    run: { frame: 7 },
    diag: { traceEnabled: false },
  } as unknown as WebgpuPagesRuntime;
  return { rt, timing };
}

test('les quatre bornes de l’hôte ont chacune leur place dans la ligne du profil', () => {
  const { rt, timing } = banc();
  hostCpuStep(rt, 'arrivalsMs', 0.5);
  hostCpuStep(rt, 'pendingMs', 1.25);
  hostCpuStep(rt, 'retainMs', 0.75);
  hostCpuStep(rt, 'submitMs', 2);
  const row = timing.cpuProfile.row;
  assert.equal(row[CPU_STEP.arrivalsMs], 0.5);
  assert.equal(row[CPU_STEP.pendingMs], 1.25);
  assert.equal(row[CPU_STEP.retainMs], 0.75);
  assert.equal(row[CPU_STEP.submitMs], 2);
  assert.equal(
    new Set([
      CPU_STEP.arrivalsMs,
      CPU_STEP.pendingMs,
      CPU_STEP.retainMs,
      CPU_STEP.submitMs,
      CPU_STEP.worldMs,
      CPU_STEP.blendWorldMs,
      CPU_STEP.totalMs,
    ]).size,
    7,
    'aucune borne n’écrit sur la place d’une autre',
  );
});

test('une image qui n’a pas rempli sa ligne ne dépose rien, une image remplie la dépose une fois', () => {
  const { rt, timing } = banc();
  hostCpuStep(rt, 'pendingMs', 1.25);
  endCpuFrame(rt);
  assert.equal(timing.cpuProfile.summary(), null, 'une coupe processeur ne classe aucune ligne');

  timing.cpuProfile.row[CPU_STEP.worldMs] = 0.5;
  timing.cpuProfile.row[CPU_STEP.totalMs] = 4;
  timing.rowFilled = true;
  endCpuFrame(rt);
  endCpuFrame(rt);
  const resume = timing.cpuProfile.summary();
  assert.equal(resume?.frames, 1, 'la ligne est classée une fois, pas deux');
  assert.equal(resume?.steps.pendingMs.p50, 1.25, 'la borne de l’hôte est dans l’image');
  assert.equal(resume?.steps.worldMs.p50, 0.5);
  assert.equal(resume?.worst[0].frame, 7);
});
