# Reprise — session « Lumière »

## Règles de la session
- Fable chef, ne code pas ; Opus code ; Sonnet lit et raisonne (images, analyses) ; Haiku lance des commandes existantes, jamais de script. Réponses en 5 à 10 lignes, tableau seulement si la structure le justifie. Économie de jetons : un agent par lot, pas d'analyse préalable quand le constat existe déjà.
- Seul le Validateur fusionne `develop`, lance `npm run validate` et pousse. Lumière livre « branche, SHA, preuve » par message. Plus de verrou de mesure : un banc se lance directement, `uptime` noté, durées non retenues sous forte charge.
- Périmètre figé : uniquement le tableau ci-dessous ; tout lot nouveau se propose en une ligne et attend le go. Portes par lot : `tsc`, `check:changed`, `check:unused`, `check:lines`, `check:duplicates`, un test par comportement corrigé.
- Preuve selon le lot. Correction visuelle : reproduction du défaut, résultat attendu vérifié, 0 px hors de la zone affectée. Optimisation : A/A stable puis avant/après 0 px. Une correction peut changer l'image.
- Règles : `AGENTS.md`, `orchestration/SPEC_ECLAIRAGE.md`. Lab port 5174 jamais tué, `public/benchmark-assets` jamais écrit. `get_session self` avant toute action.

## Tableau de suivi (ordre d'exécution)
| # | Lot | État | Preuve attendue |
|---|---|---|---|
| 0 | Banc fiable. (a) `lights.json` demandé seulement si le manifeste le déclare, banc refuse un cache incomplet : codé, `lot/banc-fiable` 3058b3e (worktree `lot-banc-fiable`, base bdaaacf), portes vertes, preuve navigateur non jouée (`--vues sol --images 30 --pixelError 1`, attendu zéro 404, 0 px). (b) Instabilité A/A reproduite sur develop, caméra mobile, 8 lampes + soleil, 3 exécutions : 0 / 1 392 / 6 278 px au seuil 1, jusqu'à 28 261 px max 124 au seuil 0, 14 erreurs de page par exécution (`.mesure/out/aa-audit-{1,2,3}` du worktree de session). Cause à isoler par matrice, deux exécutions chacune : caméra fixe ; soleil seul ; lampes seules ; ombres off ; sans lampe ; puis lire les 14 erreurs de page | (a) à prouver, (b) matrice à jouer | zéro 404, A/A 0 px sur 3 exécutions |
| 1 | Occultants d'ombre hors champ : sélection propre aux occultants (`webgpuPagesEncodeShadowPass.ts`) | à faire | mur derrière la caméra ombre le sol visible |
| 2 | Atlas d'ombres libéré à la suppression d'une lampe (`sceneLightStore.ts`) + copies publiques détachées (`explorerLightApi.ts`) | à faire | ajout/suppression ×20 sans échec ; mutation d'une copie sans effet interne |
| 3 | Proxy lointain et rebond suivent les objets déplacés (`webgpuPagesTransform.ts`) | à faire | porte déplacée, ombre lointaine et rebond au nouvel endroit |
| 4 | Profondeur des tuiles pour les transparents devant le ciel (`gpuLightTilesShader.ts`) | à faire | contre-exemple de l'audit éclairé |
| 5 | Toutes les lampes contributrices par tuile, plus de plafond 32 (`gpuLightTilesShader.ts`) | à faire | 33 lampes, aucune perdue, oracle 0 |
| 6 | Tests d'ombre du rebond pour toutes les lampes (`bounceSurfaceWgsl.ts`) | à faire | pas de fuite à travers un mur avec 5 lampes |
| 7 | Rejet des occultants compté dans le budget d'ombres (`stageMapping.ts`) | à faire | relevé synthétique 2 + 1 ms → 3 ms |
| 8 | Optimisations : test d'ombre sauté lampe derrière la surface, atlas 64 Mio à la demande, proxy chargé seulement avec soleil, profondeurs d'ombre conservées si seule la couleur change | après 7 | A/A stable, 0 px |
| 9 | Reflet (`lot/reflet` 415c9e1, worktree `lot-reflet`) : chemin actif (2 surfaces, +2 ms) mais reflet on = off à 0 px, scène presque noire ; diagnostic arrêté | en pause, sur go | reflet des cubes visible sur le sol métallique, A/A 0 |
| 10 | Bissection GPU vue sol (3,65 → 6,49 ms à 0 px) : passes d'éclairage déjà sautées à 0 lampe, cause dans géométrie ou résolution, référence mesurée sous charge 15–26 | à faire, machine calme | rejouer `db44508` ×2, puis commits Hi-Z / transparents GPU / instances / eau, `--profil on` |
| 11 | Reflets flous, ombres colorées des semi-transparents, translucidité des feuilles, alpha binaire BLEND → MASK à l'import | après 9 | par lot |

## Références utiles
- Audit externe du 15 sept. 2026 sur bdaaacf : `/private/tmp/webgeometry-lighting-audit-bdaaacf/audit.md` (huit défauts, chiffres 1280 × 720, 8 ponctuelles + soleil, caméra mobile).
- Fixture miroir : `packages/asset-compiler-rust/fixtures/classes-materiaux/miroir.gltf`, cache `.mesure/cache-miroir` du worktree `lot-reflet`. Le harnais ne compare pas deux exécutions (reflet off / on) : juger à l'œil ou proposer une option.
- Trou de test connu : `webgpuBindBudget.test.ts` ne couvre pas `createDeferredLayouts`.

Supprimer ce fichier quand le tableau est vide.
