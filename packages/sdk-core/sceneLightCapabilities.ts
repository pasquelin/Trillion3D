/**
 * Ce qu'un moteur sait réellement faire des lampes du contrat. Un appel accepté par le magasin n'est
 * pas une preuve d'éclairage : un moteur qui ne relit pas le magasin laisse l'image telle quelle, et
 * l'hôte doit pouvoir le savoir avant de croire son image. Chaque champ est ce que le moteur ACTIF
 * applique, jamais ce que le contrat publie.
 */
export interface LightingCapabilities {
  /** Les lampes déclarées éclairent réellement l'image de ce moteur. */
  sceneLights: boolean;
  /** `setLightingView` change réellement l'image de ce moteur. */
  lightingView: boolean;
  /** Les lampes de ce moteur portent des ombres. */
  shadows: boolean;
  /** `setTransform` déplace réellement un nœud nommé sur ce moteur. */
  transforms: boolean;
  /** Ce que le moteur ne fait pas et pourquoi, en une phrase ; absent quand tout est appliqué. */
  reason?: string;
}
