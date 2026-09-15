# Mesures de performance

Historique des mesures prises par la boucle. Vide à `init` au sens du protocole (pas de médiane
de 5) ; une observation isolée est consignée ci-dessous car elle a coûté une vraie exécution et
sert de point de départ, **pas** de baseline.

## 2026-09-15 — compilateur natif, scène Emerald, une exécution (non une médiane)

- Commande : voir `.agents/loop-profile.md`, section « Mesure du compilateur natif ».
- Binaire : `packages/asset-compiler-rust/target/release/web-geometry-compiler`, construit par
  `npm run build:native` sur `develop` à `2f4224e`.
- Résultat : `wallMs` 22136,09 (métrique interne du compilateur), `real 22.67 s` /
  `user 19.31 s` / `sys 13.83 s` (`/usr/bin/time -p`) ; `clusterHierarchyPagesMs` 20640,94,
  `importMs` 1494,998 ; 10 046 405 triangles source = triangles sélectionnés, 281 primitives,
  1030 nœuds, `status: ready`.
- Conditions : machine partagée avec d'autres sessions actives au moment de la mesure (voir
  `ps aux` cité dans le profil) — **pas** les conditions du protocole de mesure. Ne pas comparer
  ce chiffre à une mesure future sans le refaire dans des conditions contrôlées.
- Cache de sortie : scratchpad de session, supprimé après la mesure (751 Mo). Jamais écrit dans
  `render-tech-lab`.

## 2026-09-15 — compilateur natif, scène Emerald, comparaison `9a7821a` ↔ `develop` (MESURE INCOMPLÈTE — 2/5 exécutions par côté)

**Protocole demandé** : 5 exécutions alternées par binaire (A,B,A,B,…), médiane de 5, plancher de
bruit sur 5 exécutions identiques. **Non respecté** : la machine était chargée bien au-delà du
seuil (12 cœurs, load 1 min entre 58 et 88 pendant la mesure) et la mesure de fond a été arrêtée
sur instruction explicite du coordinateur (« si la mesure n'est pas terminée, ne boucle pas »)
après seulement 2 exécutions alternées par côté (A,B,A,B) sur les 5 demandées. **Ce qui suit
n'est pas une baseline conforme au protocole** — à refaire en entier (5+5, machine calme) avant
toute décision de régression/gain.

- Binaire A (`9a7821a`) : `git worktree add <scratchpad>/wt-9a7821a 9a7821a`, puis
  `DEVELOPER_DIR=/Library/Developer/CommandLineTools cargo build --release --locked
  --manifest-path packages/asset-compiler-rust/Cargo.toml` dans ce worktree.
- Binaire B (`develop`) : construit à `8ed6b8d` (`cargo build --release --locked` dans le dépôt
  principal). `develop` a avancé à `4d466dd` depuis, mais `git diff --stat 8ed6b8d..4d466dd` ne
  touche que `.agents/loop-code/BACKLOG.md` et `.agents/loop-code/INVENTAIRE.md` — aucun fichier
  source du compilateur n'a changé, le binaire B reste représentatif de `develop` à `4d466dd`.
- Commande de compilation (identique aux deux binaires, source Emerald, cache scratchpad jetable) :
  ```
  web-geometry-compiler \
    /Users/pasquelin/Applications/render-tech-lab/public/benchmark-assets/emerald-square \
    <scratchpad>/cache-<A|B>-<n> full 150000 8 32768 /assets/emerald/ qem-endpoints
  ```
  Chaque exécution mesurée avec `/usr/bin/time -l`, cache supprimé (`rm -rf`) immédiatement après
  chaque exécution, avant la suivante.

### Runs bruts (n=2 par côté, au lieu de 5)

| Run | real (s) | user (s) | sys (s) | RSS max (Mo) | cache (Mo, `du -sk`) | `wallMs` (CLI) | `importMs` | `clusterHierarchyPagesMs` | charge avant → après |
|---|---|---|---|---|---|---|---|---|---|
| A#1 | 23.43 | 12.92 | 12.82 | 1100.6 | 742.6 | 21404.9628 | 1879.7262 | 19525.0502 | 67.88 → 72.76 |
| A#2 | 29.60 | 12.67 | 12.30 | 1065.0 | 742.6 | 26853.5923 | 4537.0672 | 22316.3174 | 76.44 → 82.14 |
| B#1 | 52.58 | 20.26 | 12.48 | 1280.6 | 751.2 | 50888.4180 | 6180.2827 | 44707.7309 | 78.71 → 69.40 |
| B#2 | 57.27 | 20.25 | 13.44 | 1192.7 | 751.2 | 55226.5254 | 4913.1718 | 50313.1898 | 70.03 → 57.16 |

`status` toujours `ready`, `sourceTriangles`/`selectedTriangles` toujours 10 046 405, 281
primitives, 1030 nœuds — identique aux deux binaires (pas de divergence fonctionnelle observée).

### « Médiane » sur 2 valeurs (PAS une médiane de 5 — indicatif seulement), min, max, Δ% B vs A

| Métrique | A médiane(n=2) | A min | A max | B médiane(n=2) | B min | B max | Δ% B vs A |
|---|---|---|---|---|---|---|---|
| real (s) | 26.515 | 23.43 | 29.60 | 54.925 | 52.58 | 57.27 | +107.15 % |
| user (s) | 12.795 | 12.67 | 12.92 | 20.255 | 20.25 | 20.26 | +58.30 % |
| sys (s) | 12.560 | 12.30 | 12.82 | 12.960 | 12.48 | 13.44 | +3.18 % |
| RSS max (Mo) | 1082.8 | 1065.0 | 1100.6 | 1236.6 | 1192.7 | 1280.6 | +14.21 % |
| cache (Mo) | 742.6 | 742.6 | 742.6 | 751.2 | 751.2 | 751.2 | +1.15 % |
| `wallMs` (CLI) | 24129.278 | 21404.963 | 26853.592 | 53057.472 | 50888.418 | 55226.525 | +119.89 % |
| `importMs` (CLI) | 3208.397 | 1879.726 | 4537.067 | 5546.727 | 4913.172 | 6180.283 | +72.88 % |
| `clusterHierarchyPagesMs` (CLI) | 20920.684 | 19525.050 | 22316.317 | 47510.460 | 44707.731 | 50313.190 | +127.10 % |

**Plancher de bruit : non mesurable selon le protocole** (il faut 5 exécutions identiques sans
changement de code ; seules 2 exécutions par côté ont pu tourner). À titre indicatif seulement
(pas un plancher au sens du protocole) : l'écart max/min des 2 exécutions A seules est déjà de
6.17 s sur `real` (23.43 → 29.60 s, +26.4 % relatif au min) et de 5448.6 ms sur `wallMs`
(+25.5 %) — la machine était donc très bruitée même sans rien changer de code.

### Verdict factuel

**Non concluant au sens du protocole** : échantillon de 2 exécutions par côté au lieu de 5,
protocole de mesure non respecté (`protocole-mesure.md` : « interdiction de conclure sans
mesure conforme »). L'écart brut observé (B ~2× plus lent que A sur `real`, `wallMs` et
`clusterHierarchyPagesMs`) est très supérieur au bruit indicatif mesuré sur A seul (~25-26 %),
ce qui n'exclut pas un vrai écart, mais la charge machine extrême pendant la mesure (load 1 min
entre 58 et 88 sur 12 cœurs, 5 à 7× le nombre de cœurs) et l'absence d'alternance complète
interdisent toute conclusion de régression ou de gain. **À refaire intégralement** (5+5 exécutions,
plancher de bruit sur 5, machine calme) avant toute décision.

L'étape qui a le plus bougé entre les deux binaires, sur les 2 exécutions disponibles, est
`clusterHierarchyPagesMs` (+127.10 % médiane sur n=2) — cohérent avec le chantier « textures
progressives » évoqué dans le profil comme motif de la baseline `9a7821a`, mais non confirmé faute
d'échantillon suffisant.

## Moteur de rendu (WebGL/WebGPU)

Aucune mesure prise à cet `init`. Outil : `node scripts/mesure/banc.mjs …` (voir
`scripts/mesure/README.md` et `.agents/loop-profile.md`). Non exécuté : hors périmètre de
l'audit compilateur demandé, et machine déjà occupée par d'autres sessions au moment de l'audit.
