import type { LocaleOverlay } from './entryOverlay.ts';

/** French overlay for the measurement entry point. */
export const worldGuidesFr: LocaleOverlay = {
  'measurement-entry': {
    title: 'Le point d’entrée de mesure',
    description:
      'Là où un témoin, un moteur de rendu forcé ou une session interne restent nommables — jamais par le point d’entrée publié `web-geometry`.',
    html: `<p>Une page importe <code>web-geometry</code> et ne voit jamais de moteur de rendu interne, de témoin ni de session interne : <code>createWorld</code> dessine avec un seul moteur de rendu, choisi sur la machine ou refusé nommément s’il est forcé et absent. Le banc, les preuves et les vues de comparaison ont encore besoin de nommer un témoin — Three.js nu, <code>THREE.LOD</code>, la session interne <code>openMeasuredWorld</code> — et c’est le seul rôle du point d’entrée de mesure séparé, <code>packages/sdk-browser/src/measurement/measurement.ts</code>.</p>
<p>Il réexporte tout ce que le point d’entrée publié expose, plus ce qu’un hôte n’a jamais besoin de voir : <code>openMeasuredWorld</code>/<code>createMeasuredWorldJob</code> (la session interne qu’un monde ouvre sur lui-même), les fabriques de moteurs (<code>referenceBackend</code>, <code>exactPagesBackend</code>, <code>threeLodBackend</code>, <code>webgpuPagesBackend</code>, <code>autonomousPagesBackend</code>), et des aides réservées à la mesure comme <code>replicateInstances</code>. Rien de tout cela n’atteint un monde publié, et rien n’est importé par une application.</p>`,
  },
};
