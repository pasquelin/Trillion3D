import assert from 'node:assert/strict';

const REQUIRED_PASSES = [
  'WG visibility primary',
  'WG material surfaces v1',
  'WG deferred lighting',
  'WG transparents',
  'WG HDR composition + present',
];

const CPU_FIELDS = [
  'totalMs',
  'lightsMs',
  'selectionMs',
  'residencyScheduleAndTargetsMs',
  'encodeSubmitMs',
  'transparentEncodeMs',
];

/** Les durées GPU par passe, quand l'appareil sait les rendre : réelles, complètes, sans passe de
 *  présentation en double. */
function checkGpuTimings(result) {
  const status = result.events.find(
    (event) => event.stage === 'emerald' && event.phase === 'gpu-timing-status',
  );
  assert.ok(status, 'timing availability must be reported');
  if (!status.context.available) return;
  const timings = result.events.filter(
    (event) => event.stage === 'emerald' && event.phase === 'gpu-timing',
  );
  assert.ok(timings.length >= 6, 'real timestamp samples required');
  assert.ok(
    !result.events.some((event) => event.phase === 'gpu-timing-unavailable'),
    'timestamp readback failed',
  );
  assert.ok(
    timings.every((event) =>
      event.context.passes.every((pass) =>
        pass.gpuMs === null
          ? pass.reason === 'invalid-timestamps'
          : Number.isFinite(pass.gpuMs) && pass.gpuMs >= 0,
      ),
    ),
  );
  assert.ok(
    timings.some((event) => event.context.sumPassMs !== null),
    'at least one complete GPU sample required',
  );
  for (const label of REQUIRED_PASSES)
    assert.ok(
      timings.some((event) =>
        event.context.passes.some((pass) => pass.name === label && pass.gpuMs !== null),
      ),
      label + ' valid timestamp missing',
    );
  assert.ok(
    timings.every(
      (event) => !event.context.passes.some((pass) => pass.name === 'WG direct present'),
    ),
    'normal rendering must not copy the composed image in a second presentation pass',
  );
  console.log('PASS: ' + timings.length + ' real GPU pass timing samples');
}

/** Les étapes CPU de chaque image mesurée : toutes présentes, toutes des durées positives. */
function checkCpuTimings(result) {
  const cpuSamples = result.events
    .filter((event) => event.stage === 'emerald')
    .flatMap((event) =>
      event.phase === 'cpu-timing'
        ? [event.context]
        : event.phase === 'frame' && event.context?.cpu
          ? [event.context.cpu]
          : [],
    );
  assert.ok(cpuSamples.length, 'CPU stages required in trace frames or summary timing events');
  for (const sample of cpuSamples)
    for (const field of CPU_FIELDS)
      assert.ok(
        Number.isFinite(sample[field]) && sample[field] >= 0,
        `CPU ${field} must be a measured nonnegative duration`,
      );
}

/** Contrôles de durées du mode `flush` : le mode `live` ne mesure rien, il prouve une image. */
export function checkCaptureTimings(result) {
  checkGpuTimings(result);
  checkCpuTimings(result);
}
