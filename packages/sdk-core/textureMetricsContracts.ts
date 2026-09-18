/**
 * Ce que les textures virtuelles publient sur une image : le pool, les tuiles, le retour d'image.
 *
 * Ces champs vivent à part de `FrameMetrics` parce qu'ils décrivent une autre file que l'image :
 * les tuiles arrivent à leur rythme, bornées par octets et par image, et le pool est dimensionné
 * une fois. Tous facultatifs : un moteur sans textures les laisse absents, `null` dit « non
 * mesuré », jamais une estimation.
 */
export interface TextureFrameMetrics {
  /**
   * Le pool physique, fixe pour la session : ses octets — CALCULÉS depuis ses dimensions et son
   * format, WebGPU ne publiant pas la mémoire occupée —, ses couches par atlas, et ce qu'il porte.
   * `texturePoolBytes` ne dépend pas de la scène ; `textureResidentBytes` en est la part occupée,
   * queues épinglées comprises.
   */
  texturePoolBytes?: number | null;
  texturePoolLayers?: number | null;
  textureTilesResident?: number | null;
  textureResidentBytes?: number | null;
  /**
   * Le retour d'image : ce que les pixels ont demandé au dernier relevé. `textureTilesRequested` :
   * tuiles distinctes nommées ; `textureTilesAtLevel` : celles servies au niveau même que le pixel
   * appelle ; `textureMissingLevels` : niveaux de retard en moyenne sur les tuiles demandées — zéro
   * quand l'image est celle que le pool peut donner de mieux ; `textureTilesPending` : demandées
   * et pas encore servies à la fin de la passe.
   */
  textureTilesRequested?: number | null;
  textureTilesAtLevel?: number | null;
  textureMissingLevels?: number | null;
  textureTilesPending?: number | null;
  /**
   * Le diffuseur, depuis le début de la session. `textureTilesServed` : tuiles copiées dans le pool.
   * `textureTilesEvicted` : places reprises à une tuile moins regardée. `textureTilesRefused` :
   * tuiles qu'aucune place ne pouvait accueillir, tout ce que le pool porte ayant été regardé dans
   * l'image — le pool est trop petit pour la vue, et c'est publié, jamais compensé.
   * `textureBytesLastFrame` : octets de tuiles admis par la dernière passe.
   */
  textureTilesServed?: number | null;
  textureTilesEvicted?: number | null;
  textureTilesRefused?: number | null;
  textureBytesLastFrame?: number | null;
  /**
   * Les sources. `textureLevelReads` : niveaux cuits en lecture dans le cache. `textureLevelsDecoded`
   * : niveaux cuits décodés depuis le début. `textureLevelCacheBytes` : octets hôte des niveaux
   * décodés tenus pour en découper d'autres tuiles, sous un budget fixe. `textureScratchBuilds` :
   * textures de travail bâties pour une texture sans chaîne cuite, la source entière chaque fois.
   */
  textureLevelReads?: number | null;
  textureLevelsDecoded?: number | null;
  textureLevelCacheBytes?: number | null;
  textureScratchBuilds?: number | null;
}
