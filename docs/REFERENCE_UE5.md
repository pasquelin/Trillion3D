# La référence en chiffres

Ce que la référence publie, en regard de ce que ce dépôt tient. Un seul objet : répondre « est-ce
qu'on a les mêmes chiffres qu'eux sur le web », sans supposition et sans chiffre inventé.

Trois familles, et elles ne se comparent pas de la même façon :

1. **Les constantes de structure** se comparent telles quelles : ce sont des nombres de format, pas
   des mesures. `test/integration/reference-ue5.test.mjs` les relit dans le code à chaque `pnpm test`
   et échoue quand l'une d'elles dérive de ce tableau.
2. **Les octets par triangle** se comparent par triangle, jamais par scène : la scène de la référence
   n'est pas la nôtre.
3. **Les millisecondes ne se comparent pas** : leur relevé est pris sur la console de la démo, le
   nôtre sur une carte de portable. `AGENTS.md` demande entrée, caméra, qualité, machine et budget
   identiques ; aucun des cinq ne l'est. Elles sont ici pour la FORME du profil — quelle passe pèse
   quoi — et pour le seul chiffre qui traverse les machines : le coût processeur par image.

Toutes les valeurs « référence » viennent du talk SIGGRAPH 2021 *A Deep Dive into Nanite Virtualized
Geometry* (Karis, Stubbe, Wihlidal), sauf les deux lignes marquées **(2)**, qui viennent d'une source
secondaire, et la phrase marquée **(3)**, qui n'est pas sourcée du tout. Aucun code, shader ni asset
de la référence n'est lu, cité ou porté ici — seulement ses chiffres publiés.

## 1. Structure — vérifié par le test

| Grandeur                      | La référence | Chez nous | Preuve                          |
| ----------------------------- | ------------ | --------- | ------------------------------- |
| Triangles par grappe          | 128          | 128       | `dag.rs:DAG_CLUSTER_TRIANGLES`  |
| Sommets par grappe            | —            | 255       | `dag.rs:DAG_CLUSTER_VERTICES`   |
| Grappes par groupe, plancher  | 8            | 8         | `dag.rs:DAG_GROUP_MIN`          |
| Grappes par groupe, plafond   | 32           | 32        | `dag.rs:DAG_GROUP_MAX`          |
| Page de diffusion             | 128 Kio (2)  | 128 Kio   | `lib.rs:STREAM_BUNDLE_BYTES`    |
| Objet d'amorçage              | —            | 1 Mio     | `lib.rs:BOOTSTRAP_BUNDLE_BYTES` |

Trois écarts que le tableau ne dit pas, et qu'aucun test ne rattrape aujourd'hui :

- **Le plancher de groupe n'est pas appliqué.** `dag/groups.rs` coupe tant qu'un groupe dépasse
  `DAG_GROUP_MAX` et ne regarde jamais `DAG_GROUP_MIN` : un groupe de deux grappes est accepté là où
  la référence en tient huit. Ligne Géométrie 16 du backlog.
- **`CLUSTER_TRIANGLES = 256` vit encore dans `lib.rs`**, morte, à côté du 128 qui compte. Même ligne.
- **Le budget de résidence se compte en pages, pas en octets.** La référence donne à son pool une
  taille fixe en mégaoctets — 512 Mo par défaut, hors pages racines **(2)** — et les pages racines y
  sont toujours résidentes. Nous épinglons les racines de la même façon (`pinned`, `docs/FORMAT.md`),
  mais le budget est un NOMBRE DE PAGES : deux machines aux mémoires différentes tiennent le même
  nombre de pages. C'est un choix, pas un oubli ; il devient faux le jour où une page n'a plus une
  taille à peu près constante.

## 2. Octets par triangle — la seule comparaison de mémoire qui tienne

La référence, sur *Lumen in the Land of Nanite* : 433 M triangles source deviennent 882 M triangles
Nanite (la hiérarchie double le compte), et cette géométrie pèse

| Forme                   | Total    | Par triangle Nanite |
| ----------------------- | -------- | ------------------- |
| Brute (flottants pleins)| 25,90 Go | 29,4 o              |
| Format mémoire          | 7,67 Go  | 8,7 o               |
| Format mémoire comprimé | 6,77 Go  | 7,7 o               |
| Format disque           | 4,61 Go  | 5,6 o (leur chiffre)|

Soit 11,4 octets par triangle SOURCE, et « 1 M de triangles = ~10,9 Mo sur disque ».

Comment ils y arrivent, et où nous en sommes :

| Poste                | La référence                                  | Chez nous                                  |
| -------------------- | --------------------------------------------- | ------------------------------------------ |
| Indices              | base + deux décalages de 5 bits, ~17 bits/tri | 3 × `u32` = 96 bits/tri (`docs/FORMAT.md`) |
| Indices, sur disque  | ~5 bits/tri                                   | identiques, meshopt par-dessus             |
| Positions            | quantifiées sur grille objet                  | flottants bruts                            |
| Normales             | octaédriques                                  | brutes                                     |
| Tangentes            | implicites, **0 bit**                         | non portées                                |
| Sommets, total       | —                                             | ~48 o/tri (backlog Géométrie 11)           |

**Le verdict : non.** Leur format mémoire tient à 8,7 octets par triangle, le nôtre à une
cinquantaine — un facteur ~6 sur la géométrie. La cible du dépôt (≤ 12 o/tri, `docs/SPEC_MOTEUR_SANS_THREE.md` C5)
est du bon ordre ; le travail qui l'atteint n'est pas fait, et c'est la ligne Géométrie 11.

Hors géométrie, l'écart est plus grand encore : 7,56 Go de RGBA brut pour les textures d'Emerald,
là où la référence tient un pool physique de taille fixe, comprimé à la cuisson **(3)** (Textures
T2bis, T4, T5).

## 3. Millisecondes — la forme, pas le verdict

Leur profil, démo PS5, résolution moyenne 2496 × 1404 remontée en 4K, **25 M de triangles rastérisés
par image quelle que soit la scène** :

| Passe                     | Coût       | Notre équivalent                  |
| ------------------------- | ---------- | --------------------------------- |
| Clear VisBuffer           | 66 µs      | —                                 |
| Main Pass : InstanceCull  | 108 µs (1) | tri d'instances                   |
| Main Pass : ClusterCull   | 406 µs     | descente DAG sur la carte         |
| Main Pass : Rasterize     | 1 148 µs   | raster matériel (5)               |
| BuildHZB                  | 99 µs      | pyramide Hi-Z                     |
| Post Pass : InstanceCull  | 125 µs     | — (nous n'avons pas la 2e passe)  |
| Post Pass : ClusterCull   | 102 µs     | —                                 |
| Post Pass : Rasterize     | 183 µs     | —                                 |
| **VisBuffer complet**     | **~2,5 ms**|                                   |
| DepthExport               | 217 µs     |                                   |
| Emit GBuffer              | 2 084 µs   | passe matériaux                   |
| **Passe matériaux**       | **~2 ms**  | 1 dessin par matériau             |
| Antialiasing temporel (4) | non publié | `WG temporal antialiasing`        |

(1) La diapositive imprime « 108ms » ; la somme des passes et le total annoncé de 2,5 ms disent
microsecondes. Nous retenons 108 µs.

(4) Leur image est rendue à 2496 × 1404 avec gigue et remontée en 4K par accumulation temporelle ;
la nôtre accumule à résolution native, sans remontée, et sa passe ne se lit que par différence
d'enveloppe (Lumière 16). Aucun coût publié de leur côté pour cette passe seule : la ligne dit
qu'elle existe des deux côtés, pas ce qu'elle vaut.

(5) Leur raster est double : les petits triangles en calcul, les grands au matériel. Le nôtre est
matériel seul en production depuis le 18 sept. 2026 (Géométrie 26 dans `TODO.md`, mesures
comprises) ; le raster de calcul pour toute la coupe ne reste joignable que par la variante de
diagnostic `raster-calcul`. La coupe petits/grands, admise par budget de temps mesuré, est le point
(2) de cette même ligne du backlog.

Ce qu'on peut en tirer sans tricher :

- **Le processeur.** Leur chiffre est « nearly zero CPU time » : tout est piloté par la carte, et le
  coût processeur ne dépend pas du nombre d'objets. Le nôtre, mesuré le 17 sept. 2026 sur
  `emerald-square`, est de **0,5 à 2,8 ms par image** — coupe, relevé et résidence compris. Celui-là
  se compare d'une machine à l'autre, parce qu'il est censé être nul ; il ne l'est pas. C'est la
  ligne Géométrie 1.
- **Les appels de dessin.** Eux : un par matériau, sur la passe différée. Nous : un seul pour les
  252 primitives en grappes exactes, mais un par item et par face pour les 29 primitives déclarées en
  mélange — jusqu'à 1 928 dès qu'elles entrent dans le champ, et 8 FPS observés au Lab en balayant la
  pelouse. C'est le plus court chemin vers leur profil, et c'est la ligne Compilateur 10.
- **Les millisecondes GPU, elles, ne concluent rien** tant que la comparaison n'est pas jouée sur la
  même machine. La seule version honnête reste : installer la référence, exporter la même scène des
  deux côtés, même pose, même résolution, relever les deux profils sur CE matériel. Tant que ce n'est
  pas fait, toute ligne « nous vs eux » en millisecondes est une supposition, et `AGENTS.md`
  l'interdit.

## 4. Réponse courte

| | Même chiffre ? |
| --- | --- |
| Structure du DAG et des pages | **Oui**, aux trois écarts du §1 près |
| Octets par triangle | **Non** : ~6× au-dessus |
| Budget mémoire fixe | **Non** : compté en pages, et 7,56 Go de textures brutes à côté |
| Coût processeur par image | **Non** : 0,5–2,8 ms contre ~0 |
| Millisecondes GPU | **Inconnu**, et le restera tant que la campagne du §3 n'est pas jouée |

## Sources

- Brian Karis, Rune Stubbe, Graham Wihlidal, *A Deep Dive into Nanite Virtualized Geometry*, SIGGRAPH
  2021 Advances in Real-Time Rendering in Games —
  <https://advances.realtimerendering.com/s2021/Karis_Nanite_SIGGRAPH_Advances_2021_final.pdf>.
  Grappes de 128 triangles, groupes de 8 à 32, pages de taille fixe et page racine toujours
  résidente, ~17 bits/tri en mémoire et ~5 bits/tri sur disque, tangentes implicites, tableau de
  performance et bilan mémoire de *Lumen in the Land of Nanite*.
- **(2)** Taille de page de 128 Kio : *From Navisworks to Nanite*, thecandidstartup.org —
  <https://www.thecandidstartup.org/2023/04/03/nanite-graphics-pipeline.html>. Pool de diffusion de
  512 Mo par défaut, hors pages racines : `r.Nanite.Streaming.StreamingPoolSize`, Unreal Directive —
  <https://unrealdirective.com/resources/console-variables/r-nanite-streaming-streamingpoolsize/>.
  Source secondaire : le talk dit « pages de taille fixe » sans donner la taille.
- **(3)** **Non sourcée.** Le talk ci-dessus ne parle que de géométrie : il ne décrit pas le système
  de textures de la référence, qui en est un autre. La phrase du §2 sur le pool de textures de taille
  fixe comprimé à la cuisson n'est adossée à aucune source ici, et
  `test/integration/reference-ue5.test.mjs` ne vérifie aucune constante de texture. À sourcer ou à
  retirer ; tant qu'elle porte ce marqueur, elle ne vaut pas les lignes du §1.
