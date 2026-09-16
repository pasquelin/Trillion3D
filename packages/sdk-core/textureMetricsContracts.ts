/**
 * Ce que la pompe de textures, les atlas et la résidence des mips publient sur une image.
 *
 * Ces champs vivent à part de `FrameMetrics` parce qu'ils décrivent une autre file que l'image :
 * le transfert découpé des textures avance à son rythme, borné par octets et par image, et les
 * atlas sont dimensionnés une fois. Tous facultatifs : un moteur sans textures les laisse absents,
 * `null` dit « non mesuré », jamais une estimation.
 */
export interface TextureFrameMetrics {
  /**
   * Le transfert découpé des textures source vers les atlas, compté par la pompe elle-même. Champs
   * facultatifs ajoutés après coup : un lecteur plus ancien les ignore, un moteur qui ne découpe pas
   * ses transferts les laisse absents, et `null` dit « non mesuré », jamais une estimation.
   *
   * `textureUploaded` : textures transférées en entier, dernière tranche comprise.
   * `texturePending` : textures encore en file, entamées ou intactes.
   * `textureInFlight` : textures dont une tranche au moins est passée et qui en attendent d'autres.
   * `textureSlicesUploaded` : tranches réellement transférées depuis le début de la session.
   * `textureBytesLastFrame` : octets admis par la dernière passe de la pompe. Le budget
   * `maxTextureTransferBytesPerFrame` le borne à une ligne de texture près : la ligne est l'unité
   * indivisible d'une tranche et la première ligne d'une image passe même si elle dépasse à elle
   * seule le budget, sans quoi une texture plus large que le budget n'avancerait jamais.
   * `textureSkipped` : niveaux sortis de la file après trois refus de transfert de l'appareil.
   * Une texture trop grosse pour le budget d'une image n'y est jamais comptée : elle est découpée.
   * `textureLevelsUploaded` : niveaux progressifs transférés en entier, ceux que le sidecar porte
   * entre l'aperçu le plus grossier et la pleine résolution.
   */
  textureUploaded?: number | null;
  texturePending?: number | null;
  textureInFlight?: number | null;
  textureSlicesUploaded?: number | null;
  textureBytesLastFrame?: number | null;
  textureSkipped?: number | null;
  textureLevelsUploaded?: number | null;
  /**
   * Les octets que les atlas de matériaux occupent en mémoire graphique, **calculés** depuis les
   * dimensions, le nombre de couches, la chaîne de mips et le format de chaque classe allouée — ce
   * ne sont pas des octets mesurés sur l'appareil, que WebGPU ne publie pas. `vramBytes` reste
   * `null` tant que rien ne le mesure vraiment.
   *
   * `textureAtlasBytesCalculated` : total des deux atlas. `textureAtlasClassBytesCalculated` : le
   * détail par classe, atlas couleur d'abord puis atlas de données. `textureAtlasClassesUsed` :
   * classes réellement peuplées, une seule valant l'allocation à la taille maximale.
   */
  textureAtlasBytesCalculated?: number | null;
  textureAtlasClassBytesCalculated?: number[] | null;
  textureAtlasClassesUsed?: number | null;
  /**
   * Ce que l'écran demande des textures et ce que la session engage pour le servir.
   * `textureResidentBytes` : octets engagés sur la carte, niveaux achevés et lignes déjà écrites.
   * `textureBudgetBytes` : la borne posée par l'hôte ou tirée des limites de l'appareil.
   * `textureAtWantedLevel` sur `textureLayers` : couches dont le niveau de mip que l'écran réclame
   * est résident, sur le nombre de couches de la scène. `textureMissingLevels` : niveaux manquants
   * en moyenne sur les couches visibles. `textureEvictions` : transferts en cours défaits pour
   * laisser passer plus utile ; aucun niveau achevé n'est jamais défait.
   */
  textureResidentBytes?: number | null;
  textureBudgetBytes?: number | null;
  textureAtWantedLevel?: number | null;
  textureLayers?: number | null;
  textureMissingLevels?: number | null;
  textureEvictions?: number | null;
}
