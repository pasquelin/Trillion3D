// Les réservoirs de mémoire d'une série : ce que le banc demande au moteur, et ce que le moteur
// dit en avoir tenu. Les réservoirs sont fixes, en octets, comme les variables de la référence ;
// une valeur extrême est un cas de mesure, et le relevé dit comment le moteur l'a tenue.

/** Les réservoirs demandés par le banc, pour la page de mesure ; `null` laisse le défaut du moteur. */
export const reservoirs = ({
  maxPages,
  geometryPoolBytes,
  texturePoolBytes,
  geometryPoolCeilingBytes,
  poolVivant,
}) => ({ maxPages, geometryPoolBytes, texturePoolBytes, geometryPoolCeilingBytes, poolVivant });

/** Le pool de géométrie tel que le moteur l'a tenu, pour `mesure.json` ; `null` = non publié. */
export const poolGeometrie = (m) => ({
  octets: m.geometryPoolBytes ?? null,
  fentes: m.geometryPoolSlots ?? null,
  alloues: m.geometryPoolAllocatedBytes ?? null,
  borne: m.geometryPoolClamp ?? null,
  saturees: m.geometryPoolSaturated ?? null,
});
