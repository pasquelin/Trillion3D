import { BOUNCE_SETTINGS, type BounceCascades, type BounceOccupancy } from '../sdk-core/index.ts';

/**
 * L'ordonnanceur des sondes : qui travaille à cette image, et jusqu'où.
 *
 * Le lot total vient du budget en millisecondes ; c'est ici qu'il se répartit entre les niveaux, aux
 * parts publiées — le plus fin entoure la caméra, c'est celui que l'image lit le plus, il en reçoit
 * le plus. Chaque niveau avance son propre curseur en rond sur ses sondes et compte ses tours : le
 * rebond n'est réputé convergé que lorsque le plus lent des niveaux a fini le sien.
 *
 * Le curseur **saute les mailles qui ne méritent pas de sonde** — le ciel vide, le cœur plein d'un
 * bloc —, que la carte d'occupation connaît avant l'image. C'est ce qui fait qu'une petite pièce
 * balaie ses quelques dizaines de sondes utiles en une image au lieu de parcourir un cube entier,
 * et c'est aussi ce qui donne la priorité demandée : ce qui entoure la caméra et touche de la
 * géométrie passe avant le reste.
 *
 * Aucune allocation par image : la file et les curseurs sont posés une fois pour toutes.
 */
export function createBounceSchedule(cascades: BounceCascades, occupancy: BounceOccupancy) {
  const levels = cascades.levels.length;
  const side = cascades.size;
  const cursors = new Uint32Array(levels);
  const rounds = new Uint32Array(levels);
  const capacity =
    Math.max(1, Math.floor(BOUNCE_SETTINGS.raysPerFrame / BOUNCE_SETTINGS.raysPerProbe)) + levels;
  const queue = new Uint32Array(capacity);
  const cell = [0, 0, 0];
  /** Vrai quand le rang d'un niveau tient une maille qui mérite une sonde. */
  const holds = (level: number, index: number) => {
    const base = cascades.levels[level].base;
    let rank = index;
    for (let axis = 0; axis < 3; axis++) {
      const wrapped = rank % side;
      rank = (rank - wrapped) / side;
      cell[axis] = base[axis] + ((((wrapped - base[axis]) % side) + side) % side);
    }
    return occupancy.occupied(level, cell[0], cell[1], cell[2]);
  };
  /** Images du dernier tour complet de chaque niveau : mesurées, jamais estimées. */
  const roundFrames = new Uint32Array(levels).fill(1);
  const elapsed = new Uint32Array(levels);
  return {
    queue,
    /** Tours complets du plus lent des niveaux depuis la dernière invalidation. */
    get sweeps() {
      return rounds.reduce((slowest, value) => Math.min(slowest, value), rounds[0] ?? 0);
    },
    /** Images d'un tour complet, la plus longue des mesures des niveaux : la borne du retard. */
    get sweepFrames() {
      return roundFrames.reduce((slowest, value) => Math.max(slowest, value), 1);
    },
    /** Une lampe a changé, ou la cascade a glissé : tout le monde repart du début. */
    restart() {
      cursors.fill(0);
      rounds.fill(0);
      elapsed.fill(0);
    },
    /**
     * La file de l'image : les rangs à mettre à jour, niveau par niveau, dans la limite du lot.
     * Rend le nombre de groupes à lancer. Chaque niveau examine au plus ses propres sondes une
     * fois : la boucle est bornée avant l'image, comme toutes les autres (X2).
     */
    plan(total: number) {
      const shares = cascades.shareOf(total);
      let groups = 0;
      for (let level = 0; level < levels; level++) {
        let taken = 0;
        elapsed[level]++;
        for (
          let examined = 0;
          examined < cascades.probesPerLevel && taken < shares[level] && groups < capacity;
          examined++
        ) {
          const index = cursors[level];
          cursors[level] = index + 1;
          if (cursors[level] >= cascades.probesPerLevel) {
            cursors[level] = 0;
            rounds[level]++;
            roundFrames[level] = Math.max(1, elapsed[level]);
            elapsed[level] = 0;
          }
          if (!holds(level, index)) continue;
          queue[groups++] = level * cascades.probesPerLevel + index;
          taken++;
        }
      }
      return groups;
    },
  };
}
