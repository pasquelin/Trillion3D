# Ventilation GPU des transparents et de la présentation

Ventiler, pas optimiser : aucune de ces variantes n'est un lot de performance. Chacune neutralise un
facteur et rend, par construction, une image de diagnostic.

## Comment les chiffres ont été obtenus

`node scripts/mesure/banc.mjs --moteur webgpu --avant <dist> --apres <dist> --variante-apres <v>
--vues sol,rue --images 60 --images-profil 120 --instances 12 --pixelError 0 --profil on
--camera-mobile`. Les deux côtés d'une campagne sont **le même dist** : seule la variante diffère, et
la référence est rejouée dans chaque campagne — aucun chiffre n'est comparé à une autre exécution.
Le détail de diagnostic est `trace` des deux côtés pour que les deux paient le même instrument.
Scène : cache du Lab, 12 instances, 1280 × 720, aucune lampe déclarée (`lampesActives: 0`), donc vue
sans éclairage. Sorties sous `.mesure/out/vent-<variante>/`.

La campagne a été lancée **depuis ce worktree**, pas depuis le dépôt principal : `diagnosticGpuVariant`
n'existe que sur cette branche et le harnais du dépôt principal ne saurait pas le passer. Ce harnais-ci
est celui de `develop` plus les seuls drapeaux `--variante` / `--variante-<côté>`.

## Les étapes se recouvrent-elles ?

Oui, et il faut dire lequel contient lequel. Les étapes sont **disjointes par définition** :
`stageMapping.ts` range chaque passe GPU dans exactement une étape, par son étiquette. Mais leurs
_durées mesurées_ se recouvrent : chaque passe est bornée par un horodatage de début et de fin
(`gpuTimingEncoder.ts`), et sur cet appareil à tuiles l'étage de sommets d'une passe démarre pendant
que l'étage de fragments de la précédente tourne encore.

Conséquence chiffrée (vue `rue`, p50) : somme des étapes 79,5 ms, image 56,1 ms (`gpuImageMs` =
`submittedMs`, la somme des enveloppes de soumission). L'excédent, 23,4 ms, vaut la présentation
(22,3 ms) à la marge près. **« Présentation » contient la queue de fragments de « transparents ».**
L'image honnête est `gpuImageMs`, jamais la somme.

## Tableau des variantes (p50 GPU, ms ; chaque ligne face à SA référence de campagne)

| Variante (vue `rue`)                        | transparents | présentation | image     | écart image |
| ------------------------------------------- | ------------ | ------------ | --------- | ----------- |
| référence                                   | 43,68        | 22,25        | 56,11     | —           |
| `transparents-plat` (fragment constant)     | **8,00**     | **0,43**     | **20,39** | 0 px        |
| référence                                   | 44,32        | 22,69        | 56,31     | —           |
| `transparents-sommets` (`discard` immédiat) | **7,94**     | **0,54**     | **21,18** | 0 px        |
| référence                                   | 43,16        | 21,50        | 55,75     | —           |
| `transparents-sans-couleur` (writeMask 0)   | 24,95        | 7,02         | 37,80     | 0 px        |
| référence                                   | 42,30        | 21,02        | 54,72     | —           |
| `transparents-surdessin` (comptage)         | 7,85         | 0,41         | 20,10     | 0 px        |
| référence                                   | 45,73        | 23,11        | 61,66     | —           |
| `presentation-hors-ecran`                   | 47,18        | **23,04**    | 62,07     | 0 px        |

Vue `sol` : mêmes rapports à moins de 5 % près (référence 42,5–44,2 / 21,6–22,7 ; `plat` 7,90 / 0,43).
Témoin A/A : 0 px partout. Seule la campagne `presentation-hors-ecran` est bruitée (A/A à 68,1 contre
55,4 ms sur `sol`, machine chargée) ; sa conclusion s'appuie sur `rue`, où son A/A tient.

## Conclusion chiffrée

- **Sommets, rasterisation et appels : 7,9 ms (18 %).** `sommets` (`discard` immédiat) et `plat`
  (couleur constante) donnent la même durée : ce qui reste quand le corps du fragment disparaît.
- **Corps de l'étage de fragments : 35,8 ms (82 %).** 43,7 − 7,9. Ce sont les six échantillonnages
  d'atlas (base, rugosité, métal, occlusion, normale, émissive), la reconstruction de repère
  tangent, la transmission et la conversion d'affichage de `BLEND_SHADER`.
- **Textures contre éclairage : l'éclairage vaut 0 ms ici**, par construction — aucune lampe n'est
  déclarée dans cette campagne, `declaredLighting` et `bounceLighting` ne sont pas appelés. Les
  35,8 ms sont donc du texturage et de la transmission, pas de la lumière. Une campagne `--lampes`
  reste à faire pour ventiler l'éclairage des transparents.
- **Écriture de couleur et mélange : 0 ms.** `sans-couleur` (24,95 ms) ne mesure PAS le coût du ROP :
  à masque nul le pilote élimine tout le code qui alimente la sortie, et les 18 ms gagnées sont du
  code mort, pas des écritures évitées. Le vrai coût du ROP est nul, et le comptage le prouve.
- **Surdessin : 0,000 fragment par pixel.** La requête d'occlusion compte **0 échantillon** passant
  le test de profondeur, sur 921 600 pixels, sur 123 relevés, aux deux poses. Le maximum par pixel
  n'est pas mesuré (une requête d'occlusion ne rend qu'une somme) et reste `null`. Corollaire vérifié
  indépendamment : les cinq variantes rendent une image **identique au pixel près** à la référence —
  la passe de mélange ne pose aucun pixel de ces deux images.
- **Nombre d'appels : 4232 (`rue`) et 4288 (`sol`) appels de mélange** pour 2116 maillages visibles
  (deux faces chacun), 9452 rejetés par le tronc — contre 15 appels pour tout le reste de l'image
  (`appelsDeDessin` 4247, `appelsDeMelange` 4232). Aucun ne pose un pixel.
- **Le verdict : « surdessin » est faux, « ombrage caché » est vrai.** Les 43 ms ne sont pas des
  transparents qui se recouvrent : ce sont des fragments entièrement cachés derrière l'opaque,
  ombrés en entier puis jetés par le test de profondeur. Le rejet anticipé ne s'applique pas parce
  que l'étage de fragments de `BLEND_SHADER` lie `proxy` en `read_write` : une écriture de stockage
  possible oblige l'appareil à ombrer avant de tester. Deux causes étaient soupçonnées, le `discard`
  de l'alpha-test et cette liaison ; **la mesure n'en retient qu'une** (levier 0 ci-dessous).
  `fsPlat`, qui n'a ni l'un ni l'autre, retombe à 7,9 ms sur exactement les mêmes commandes.

## Contenu réel de « Présentation »

Une seule passe : `WG HDR composition + present` (`deferredLighting.ts:166`) — un triangle plein
écran qui lit la cible HDR et écrit deux cibles UNORM, la cible de capture et la vue de la chaîne
d'échange. Pas de résolution différée à part, pas de résolution MSAA (aucun pipeline multiéchantillon
du dépôt), pas de copie de relecture (`imageReadbackDuringRender: false` ; `readGpuImage` n'est
appelé que par `flush()`, hors image mesurée), pas d'attente de `getCurrentTexture` dans la passe.

Ce que coûte vraiment la chaîne d'échange : **rien de mesurable**. `presentation-hors-ecran` ne
demande ni la vue de présentation ni la passe `WG direct present` ; la présentation vaut 23,04 ms
contre 23,11 ms pour sa référence, dans le bruit A/A de la campagne.

Ce que les 22 ms sont : **l'attente de leur entrée**. La présentation suit les transparents pas à
pas — 22 ms quand les transparents valent 44, 0,43 ms quand ils valent 8 — et l'excédent de la somme
des étapes sur l'image vaut exactement cette étape. Il n'y a pas 22 ms de présentation à optimiser ;
il y a 36 ms d'ombrage caché dont la présentation porte la queue.

## Trois leviers, par gain attendu

0. **Fait — la liaison en écriture était la seule cause.** Le proxy résident lié en `read_write` à
   l'étage de fragments du mélange interdisait le rejet anticipé ; passé en lecture seule (les deux
   compteurs du relevé restent à la résolution différée), campagne `--avant 18b27295` caméra mobile,
   même campagne des deux côtés : transparents 49,1 → 21,5 ms et présentation 24,5 → 0,7 ms (`rue`),
   46,5 → 21,0 et 22,4 → 0,8 (`sol`) ; image 66,2 → 34,7 et 63,3 → 34,1. Écart 0 px, coupe identique,
   témoin A/A 0 px. Le `discard` de l'alpha-test, lui, **ne coûte rien** : le retirer des deux chemins
   ne rend que 0,4 ms sur 21 (20,72 contre 21,16 ms, `rue`), dans le bruit de la campagne — la
   profondeur n'étant pas écrite, il n'empêche pas le test anticipé. Il reste donc en place, et aucune
   variante de pipeline n'a été créée. Caméra immobile : l'image est tenue (`frameHeld`), zéro appel
   de mélange, rien à chronométrer ; la preuve y est l'écart 0 px des deux vues.

1. ~~**Ne pas ombrer ce que la profondeur jette — ~36 ms.**~~ Rétablir le rejet de profondeur anticipé
   sur la passe de mélange : sortir le `discard` de l'alpha-test et l'écriture de stockage `proxy`
   de l'étage de fragments du cas courant (variantes de pipeline par matériau), ou faire précéder le
   mélange d'un test de profondeur. Justifié par `plat` et `sommets` à 7,9 ms, image identique, et
   par les 0 fragment comptés. La présentation suit : 22 → 0,4 ms. Image ~56 → ~21 ms.
2. **Occlure les grappes transparentes — ~7 ms et 4200 appels.** `webgpuTransparentCompact.ts` ne
   lit que le masque de la coupe ; il n'a ni Hi-Z ni requête d'occlusion, et `capabilities` déclare
   « occlusion culling » non supporté. Rien ne retire une grappe transparente entièrement cachée,
   alors que la pyramide Hi-Z de l'image existe déjà. Justifié par les 0 fragment et les 4232 appels.
3. **Réduire le nombre d'appels — une part des 7,9 ms.** 4232 appels de mélange contre 15 pour tout
   le reste. La ventilation ne sépare pas la soumission des appels de la rasterisation : la variante
   (d) « un seul appel par matériau » n'a pas été implémentée, l'ordre source par item étant la
   sémantique de la passe. Ce levier est le plancher qui restera après 1 et 2, à chiffrer à part.

## Le code de diagnostic

`packages/sdk-browser/diagnosticGpuVariant.ts` déclare les cinq variantes, les refuse hors
`diagnosticDetail: 'trace'` et refuse un nom inconnu (`diagnosticGpuVariant.test.ts`). Sans variante,
le moteur compile le module d'avant, encode les mêmes commandes et ne monte ni requête d'occlusion ni
compteur : aucun chemin de production n'est modifié. `webgpuBlendOverdraw.ts` porte le comptage,
publié dans `profilParEtape` sous l'étape « Transparents ».
