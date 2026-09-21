// Memory reservoirs of a series: what the bench asks of the engine, and what the engine says it
// held. Reservoirs are fixed, in bytes, like the reference's variables; an extreme value is a
// measurement case, and the reading says how the engine held it.

/** Reservoirs requested by the bench, for the measurement page; `null` leaves the engine default. */
export const reservoirs = ({
  maxPages,
  geometryPoolBytes,
  texturePoolBytes,
  geometryPoolCeilingBytes,
  poolVivant,
}) => ({ maxPages, geometryPoolBytes, texturePoolBytes, geometryPoolCeilingBytes, poolVivant });

/** The geometry pool as the engine held it, for `mesure.json`; `null` = unpublished. */
export const poolGeometrie = (m) => ({
  octets: m.geometryPoolBytes ?? null,
  fentes: m.geometryPoolSlots ?? null,
  alloues: m.geometryPoolAllocatedBytes ?? null,
  borne: m.geometryPoolClamp ?? null,
  saturees: m.geometryPoolSaturated ?? null,
});

/** The page budget as the last frame saw it: the cap asked, the pages held, whether the requested
 *  cut fits, and the rung of the screen-error ladder the image is drawn at (0 when it fits). */
export const budgetPages = (m, maxPages) => ({
  demande: maxPages ?? null,
  residentes: m.residentPages ?? null,
  couvertureLimiteeParBudget: m.coverageBudgetLimited ?? null,
  seuilBudget: m.budgetPixelError ?? null,
});
