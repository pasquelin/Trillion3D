# Fondations WebGeometry — suivi de réalisation

Base actuelle : `bffee67` (diagnostics et provenance intégrés sur `main`). Cette branche de travail est `codex/virtualized-foundations`. Les commits de cette branche décrivent le présent chantier ; `main` reste inchangé par ces travaux. Aucun résultat d'une campagne antérieure ne valide automatiquement ce code.

| Lot | Dépendance | État | Preuve requise |
| --- | --- | --- | --- |
| 1. Import glTF, QEM, identité des caches JS et Rust | Aucune | Partiel, `77fbbb7` | Entrées invalides rejetées avant publication ; faces orientées ; changement de clé si l'algorithme change ; tests JS/Rust |
| 2. Pages autonomes de géométrie et format versionné | 1 | À faire | Décodage et rendu sans `source.bin` intégral, frontière de pages, compression et précision |
| 3. Streaming de géométrie et ressources matérielles | 2 | Partiel : file priorisée, transferts bornés, requêtes partagées et annulation | Résidence minimale, ressources matérielles, admission et éviction en chaîne réelle |
| 4. Sélection et commandes courantes pilotées par GPU | 2–3 | Partiel : regroupement des dessins par groupes GPU parallèles | Aucun readback CPU avant les commandes de l'image, sélection parallèle et capture matérielle complète |
| 5. Hi-Z et rasterisation hybride | 4 | Partiel : mip conservateur ; validation matérielle ouverte | Occlusion/révélation, routage et pixels/profondeur/ID comparés sur matériel |
| 6. Scène dynamique, vues et surfaces pour GI | 3–5 | Partiel : transformations d'instances propagées aux chemins de rendu | Ajout/retrait et mutation des ressources, capture consommée et restauration de vue |
| 7. Métriques communes, provenance et campagnes Lab | Tous | Partiel : diagnostics et empreinte de build sur `main` | Quatre moteurs, scènes diverses, PNG, A/A puis référence, mesures bornées et limites explicites |

Les budgets de pages sont des allocations suivies, jamais une mesure de VRAM physique. Les statuts « À faire » ne sont ni simulés ni déclarés livrés. Le portage de Lumen et l'optimisation fine restent ultérieurs.

Après intégration de `main`, `npm run build`, `npm test` (336/336), `npm run check:structure`, `npm run check:dts` et `npm run check:links` réussissent. Le test matériel du regroupement GPU a réussi sur Apple Metal. Ces validations ne remplacent pas les campagnes d'images complètes du Lab.

## Streaming et transformations : preuve partielle

- Les lectures de pages partagent une file priorisée et dédupliquée. La concurrence et la somme des tailles déclarées en transfert sont bornées ; une page plus grande que la limite est admise seule pour éviter une attente permanente. Une annulation retire son demandeur et interrompt le transfert uniquement s'il n'en reste aucun. Les tests couvrent la priorité et une requête partagée annulée.
- Les matrices d'instances existantes sont relues à chaque rendu dans les chemins de référence, exact, ThreeLOD et WebGPU. Une matrice modifiée invalide le résultat différé de sélection GPU ainsi que l'historique Hi-Z. Les tests couvrent les trois chemins CPU et l'invalidation de sélection GPU. L'ajout ou le retrait d'instances reste à construire.
- Validation de ce lot : `npm run build`, `npm test` (322/322), `npm run check:structure`, `npm run check:dts`, `npm run check:links`. Aucune campagne matérielle ni comparaison d'images n'a été exécutée pour ce lot.

## Regroupement GPU : preuve partielle

- Le regroupement stable en six catégories calcule les comptes par groupes de 64 pages, leurs préfixes, puis distribue les pages en parallèle. La petite passe de préfixes par groupes reste séquentielle ; la sélection de hiérarchie et la préparation de la table de dessin passent encore par le CPU. Le regroupement seul ne constitue donc pas une chaîne de rendu entièrement pilotée par GPU.
- Le shader réel a produit sur Chrome/WebGPU et Apple Metal (`metal-3`) les mêmes 130 identifiants ordonnés et six commandes indirectes que l'oracle CPU, y compris aux frontières des groupes. Commande : `LAB_ROOT=/Users/pasquelin/Applications/render-tech-lab node --experimental-strip-types test/webgpuDraw.browser.mjs`.

## Preuves du lot 1 et limites

- Les deux compilateurs rejettent l'accessor dont les données débordent sa vue locale, les strides invalides, les indices sparse mal ordonnés ou hors plage, ainsi que des contrats POSITION/indices invalides. Les tests intégrés vérifient l'absence de pointeur `ready` après une entrée invalide.
- L'éventail concave reproduit dans l'audit ne produit plus de face retournée avec la simplification JS ou Rust par endpoints. Le simplificateur rapide Rust passe cette fixture, mais aucune garantie générale de non-inversion, de non-intersection ou d'erreur de Hausdorff n'est revendiquée. Le modèle `qem-local-plus-child-max` reste une heuristique de sélection et doit être remplacé ou borné pour satisfaire la qualité LOD demandée.
- Les empreintes JS et Rust incluent désormais leurs implémentations et verrouillages de dépendances ; un changement de QEM ou de `package-lock.json` change l'empreinte JS dans le test. Le compilateur JS direct exige cette empreinte fournie par son adaptateur hôte. Les images externes ne sont pas incluses dans la clé de géométrie format 1.
- Validation locale de cette branche : `npm run build`, `npm test` (314/314), `npm run test:native` (38/38 en release), `npm run check:structure`, `npm run check:dts` et `npm run check:links` réussis. Un échec intermittent initial du test Rust multibuffer provenait de noms de fixtures fondés sur l'horloge : 80 000 lectures concurrentes ont produit 79 571 valeurs dupliquées sur cette machine. Un compteur atomique rend désormais ces noms uniques dans le processus ; la suite release repasse. Aucune nouvelle campagne matérielle ou comparaison d'image du Lab n'a encore été exécutée pour ces modifications.

## Preuves partielles du lot 5 et limites

- Les empreintes 33×19 entièrement couvertes peuvent désormais être rejetées par un mip réduit. Un pixel de fond au bord et une empreinte hors cible empêchent ce rejet ; la conversion des bornes en coordonnées de mip et en décalage du buffer GPU est contrôlée par test. Le même choix de niveau sert à l'oracle CPU et à l'encodage GPU. Le shader de rejet a été exercé sur Apple Metal ; la capture complète de l'image reste ouverte.
- Une copie intégrale de la pyramide précédente était allouée et écrite sans être jamais lue : elle a été retirée. Le jeu d'URL de pages visibles antérieurement reste consommé uniquement pour choisir les occludeurs de la première passe, qui produit une pyramide de l'image courante. Cela ne constitue pas une reprojection temporelle de la profondeur.
- Validation locale de ce lot : `npm run build`, `npm test` (318/318), `npm run check:structure`, `npm run check:dts`, `npm run check:links`. `LAB_ROOT=/Users/pasquelin/Applications/render-tech-lab node --experimental-strip-types test/webgpuHiz.browser.mjs` exécute le shader réel sur Chrome/WebGPU et l'adaptateur Apple Metal (`metal-3`) : zone 33×19 couverte → rejet, trou au bord → conservation, plan proche coupé → conservation, sans erreur GPU. Le rapport local `benchmark-runs/webgpu-hiz/result.json` contient l'empreinte SHA-256 `4ce3ffe0e3ebc1262ac2720f8fb2fc48366c6fd4941bb9effec6a49289a52ab2` du shader exécuté. La construction de la pyramide GPU, la coupure de caméra, la révélation et la parité pixels/profondeurs/ID du Lab restent ouvertes.
