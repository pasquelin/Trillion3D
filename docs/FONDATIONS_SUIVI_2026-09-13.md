# Fondations WebGeometry — suivi de réalisation

Base : `b064ab0` (couverture GPU, audit et 310 tests Node vérifiés dans un arbre isolé). Cette branche de travail est `codex/virtualized-foundations`. Le répertoire principal contient d'autres modifications concurrentes ; seuls les commits de cette branche décrivent le présent chantier. Aucun résultat d'une campagne antérieure ne valide automatiquement ce code.

| Lot | Dépendance | État | Preuve requise |
| --- | --- | --- | --- |
| 1. Import glTF, QEM, identité des caches JS et Rust | Aucune | Partiel, `d0fd4f8` | Entrées invalides rejetées avant publication ; faces orientées ; changement de clé si l'algorithme change ; tests JS/Rust |
| 2. Pages autonomes de géométrie et format versionné | 1 | À faire | Décodage et rendu sans `source.bin` intégral, frontière de pages, compression et précision |
| 3. Streaming de géométrie et ressources matérielles | 2 | À faire | Résidence minimale, priorités, annulation, admission, éviction et budgets refusés en chaîne réelle |
| 4. Sélection et commandes courantes pilotées par GPU | 2–3 | À faire | Aucun readback CPU avant les commandes de l'image, oracle CPU et capture matérielle |
| 5. Hi-Z et rasterisation hybride | 4 | Partiel : mip conservateur ; validation matérielle ouverte | Occlusion/révélation, routage et pixels/profondeur/ID comparés sur matériel |
| 6. Scène dynamique, vues et surfaces pour GI | 3–5 | À faire | Mutations d'instances/ressources, capture consommée et restauration de vue |
| 7. Métriques communes, provenance et campagnes Lab | Tous | À faire | Quatre moteurs, scènes diverses, PNG, A/A puis référence, mesures bornées et limites explicites |

Les budgets de pages sont des allocations suivies, jamais une mesure de VRAM physique. Les statuts « À faire » ne sont ni simulés ni déclarés livrés. Le portage de Lumen et l'optimisation fine restent ultérieurs.

## Preuves du lot 1 et limites

- Les deux compilateurs rejettent l'accessor dont les données débordent sa vue locale, les strides invalides, les indices sparse mal ordonnés ou hors plage, ainsi que des contrats POSITION/indices invalides. Les tests intégrés vérifient l'absence de pointeur `ready` après une entrée invalide.
- L'éventail concave reproduit dans l'audit ne produit plus de face retournée avec la simplification JS ou Rust par endpoints. Le simplificateur rapide Rust passe cette fixture, mais aucune garantie générale de non-inversion, de non-intersection ou d'erreur de Hausdorff n'est revendiquée. Le modèle `qem-local-plus-child-max` reste une heuristique de sélection et doit être remplacé ou borné pour satisfaire la qualité LOD demandée.
- Les empreintes JS et Rust incluent désormais leurs implémentations et verrouillages de dépendances ; un changement de QEM ou de `package-lock.json` change l'empreinte JS dans le test. Le compilateur JS direct exige cette empreinte fournie par son adaptateur hôte. Les images externes ne sont pas incluses dans la clé de géométrie format 1.
- Validation locale de cette branche : `npm run build`, `npm test` (314/314), `npm run test:native` (38/38 en release), `npm run check:structure`, `npm run check:dts` et `npm run check:links` réussis. Un échec intermittent initial du test Rust multibuffer provenait de noms de fixtures fondés sur l'horloge : 80 000 lectures concurrentes ont produit 79 571 valeurs dupliquées sur cette machine. Un compteur atomique rend désormais ces noms uniques dans le processus ; la suite release repasse. Aucune nouvelle campagne matérielle ou comparaison d'image du Lab n'a encore été exécutée pour ces modifications.

## Preuves partielles du lot 5 et limites

- Les empreintes 33×19 entièrement couvertes peuvent désormais être rejetées par un mip réduit. Un pixel de fond au bord et une empreinte hors cible empêchent ce rejet ; la conversion des bornes en coordonnées de mip et en décalage du buffer GPU est contrôlée par test. Le même choix de niveau sert à l'oracle CPU et à l'encodage GPU. Le shader GPU lui-même n'a pas encore été validé par capture matérielle.
- Une copie intégrale de la pyramide précédente était allouée et écrite sans être jamais lue : elle a été retirée. Le jeu d'URL de pages visibles antérieurement reste consommé uniquement pour choisir les occludeurs de la première passe, qui produit une pyramide de l'image courante. Cela ne constitue pas une reprojection temporelle de la profondeur.
- Validation locale de ce lot : `npm run build`, `npm test` (318/318), `npm run check:structure`, `npm run check:dts`, `npm run check:links`. Tests GPU matériels, coupure de caméra, révélation et parité des pixels/profondeurs/ID encore ouverts.
