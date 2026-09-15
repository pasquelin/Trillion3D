# Reprise — session « Lumière » (état au 15 sept. 2026, 20 h)

## Rôles

Fable chef, ne code pas ; Opus code ; Sonnet lit/teste/mesure. Réponses en 5 à 10 lignes. Règles : `AGENTS.md`, spec `orchestration/SPEC_ECLAIRAGE.md`. Seul le Validateur fusionne `develop`, lance `npm run validate` et pousse ; Lumière livre branche + SHA + preuve. Portes par lot : `tsc`, `check:changed`, `check:unused`, `check:lines`, `check:duplicates`, preuve d'image. Verrou `.claude/mesure.lock` : `mkdir`, fichier `proprietaire` (« lumiere <lot> date »), charge < 4 sinon pas de mesure, libération par le seul titulaire, jamais d'attente en boucle, jamais de banc sans verrou. Lab port 5174 jamais tué, `public/benchmark-assets` jamais écrit. Sessions : Lumière, Geometry, Calculs, Compilateur, Validateur — `ListAgents` puis `get_session self` d'abord.

## Branches prêtes à livrer

- `lot/reflet` cdf8a36 (worktree `lot-reflet`, base 9abd53f, portes vertes). Preuve à jouer sous verrou : banc miroir `--moteur webgpu --cache-avant/apres .mesure/cache-miroir --vues generale,detail --images 60 --pixelError 0,1 --reflet off` puis `on`, diff des PNG, `surfacesReflechissantes` > 0, `incidentsGpu` nul. Touche `webgpuPagesEncodeBlend.ts` sur 4 lignes : Geometry rebase `lot/blend-encodage` dessus.
- `lot/blend-fidelite` 8a69712 (worktree `lot-blend-fidelite`, base 9abd53f, correctif de normale du nuanceur de mélange, changement d'image voulu). Preuve à jouer depuis ce worktree :
  ```
  node scripts/mesure/banc.mjs --moteur webgpu --moteur-avant webgl --avant f51efc4 --apres f51efc4 --vues generale,sol,rue --soleil --ombres off --cache-avant /Users/pasquelin/Applications/webGeometry/.mesure/cache-classes/classes-materiaux-derived --cache-apres /Users/pasquelin/Applications/webGeometry/.mesure/cache-classes/classes-materiaux-derived --out .mesure/out/blend-fidelite
  ```
  Vue générale attendue au bruit, sol et rue ≤ 1/255.

## Bissection GPU, vue sol (3,65 → 6,49 ms à 0 px)

Ombres, rebond, tuiles et ombre lointaine déjà écartées à 0 lampe active ; la cause est dans la géométrie ou la résolution. Plan (scratchpad de la session) : rejouer `db44508` deux fois au calme, `--lampes-fichier off`, puis bissection par commits (Hi-Z, transparents GPU, instances, eau), cache figé, profil par étape `--profil on`.

## Suite du plan

Reflets flous → ombres colorées des semi-transparents et translucidité des feuilles → import : alpha binaire déclaré BLEND → MASK (avec Compilateur) → optimisation mesurée. Trou de test : `webgpuBindBudget.test.ts` ne couvre pas `createDeferredLayouts`.

Supprimer ce fichier quand tout est livré.
