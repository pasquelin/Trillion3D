# Rendu GPU et surfaces séparées — plan d’intégration

**Objectif autorisé :** intégrer directement dans le moteur la présentation GPU, la séparation matériaux/éclairage et une capture de surface depuis une autre caméra, avec logs. Les essais visuels et mesures seront réalisés ensuite dans le Lab.

**Architecture :** conserver les pages, la sélection LOD et le cache existants. La visibilité alimente des textures de surfaces versionnées ; l’éclairage produit une image HDR ; la transparence est composée en linéaire puis la présentation applique ACES/sRGB. Les textures restent sur le GPU pendant le rendu. Three.js reste l’adaptateur des scènes.

**Contraintes :** préserver le travail présent ; aucun commit/push ; ne pas modifier le Lab ni le compilateur ; ne pas annoncer Lumen, la parité avec le moteur de référence, une mesure GPU ou de VRAM physique non exécutée. Les capacités manquantes restent explicites. Les ressources ont un propriétaire, une limite, une destruction et une erreur observable. Exécution dans le moteur demandée par l’utilisateur.

## Lots et vérification

- [x] Contrats et tests : étendre `backendTypes.ts`, réexporter ces types depuis `index.ts` ; tests de l’absence de readback image pendant render, des sorties de surface, des captures et des erreurs/budgets. Exécuter les tests avant implémentation.
- [x] Surfaces/éclairage : `surfaceBuffer.ts` pour les ressources, `sceneLighting.ts` pour l’adaptation et le stockage des lumières, `deferredLighting.ts` pour les passes GPU. Adapter `visibilityBuffer.ts` et `webgpuPages.ts`. Tests de transformation des lumières, dimensionnement et durée de vie des ressources.
- [x] Présentation : `gpuPresentation.ts` pour présenter et capturer explicitement une texture. Canvas hôte direct dans les sessions WebGPU seules ; canvas GPU intermédiaire pour la composition Three des sessions mixtes. `flush()` prépare la capture synchrone utilisée par le Lab ; refuser une capture périmée. Aucun readback image dans render.
- [x] Seconde vue : produire une capture opaque GPU possédée par l’appelant depuis une caméra indépendante ; réutiliser les ressources géométriques ; préserver la caméra principale ; refuser les pages manquantes et borner les captures vivantes. Journaliser le travail et sa restauration.
- [x] Suivi : phases structurées via `onDiagnostic`, compteurs à fréquence bornée, erreurs dédupliquées, coûts d’allocation séparés de la VRAM physique. Aucun logging par triangle/page/frame.
- [x] Validation locale : tests ciblés, build TypeScript, suite Node, structure et déclarations publiques. Mettre à jour `SDK.md` avec API, limites et protocole Lab. Les résultats navigateur/performance restent non exécutés jusqu’à la recette Lab.


## Résultat de validation locale

Build TypeScript et 292 tests Node réussis ; structure sans DOM du cœur, déclarations publiques, liens documentaires et diff vérifiés. Revue indépendante statique effectuée ; correction du repli de transparence HDR, de la capture des sessions mixtes et de la garde de restauration de la vue secondaire. Le Lab et l’exécution GPU des shaders restent non exécutés. Les comparaisons d’image et de performance restent à faire, sans verdict de gain.
