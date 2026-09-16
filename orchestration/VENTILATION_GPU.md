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
   de mélange, rien à chronométrer ; la preuve y est l'écart 0 px des deux vues. Le levier « ne pas
   ombrer ce que la profondeur jette », qui attendait ~36 ms, est donc clos par là.

1. ~~**Occlure les grappes transparentes — ~7 ms et 4200 appels.**~~ **Fait, et bien plus que 7 ms.**
   La compaction des transparents teste chaque grappe contre la pyramide Hi-Z de l'image avec les
   MÊMES règles que la partition opaque — la même projection conservatrice (`gpuBoxProjectWgsl.ts`),
   le même choix de mip et le même dépouillement (`gpuHizRectWgsl.ts`), et le MÊME tampon d'uniforme,
   celui que la partition vient d'écrire. Une grappe entièrement derrière l'opaque sort de la table ;
   l'ordre des retenues ne bouge pas. Campagne `--avant dd3d604d` caméra mobile, même campagne des
   deux côtés : transparents 21,25 → 0,21 ms et présentation 0,65 → 0,02 ms (`rue`), 20,75 → 0,20 et
   0,67 → 0,03 (`sol`) ; image 33,05 → 13,15 et 32,98 → 13,90. Écart 0 px, coupe identique, témoin
   A/A 0 px ; caméra immobile, l'image est tenue, 0 px des deux vues. Preuve par grappe :
   `test/partitionGpuConservatrice.browser.mjs` rejoue la référence double précision sur la
   profondeur relue — 6 391 446 grappes retirées sur 32 225 760 examinées, 30 poses, 0 violation.
   Le nombre d'appels, lui, NE bouge pas (4232 / 4288) : ils dessinent zéro instance.
2. **Réduire le nombre d'appels — plancher atteint, rien à gagner.** Exactement DEUX appels par item
   visible (4232 pour 2116, 4288 pour 2144) : chaque item est double face et ses deux appels
   demandent deux pipelines opposés, jamais fusionnables ; entre deux items, `drawBlendPass` repose
   un groupe de liaison, les décalages d'uniforme et de volume étant par item. La fusion des appels
   CONSÉCUTIFS partageant pipeline, liaison et couche vaut donc 0 %. Le prix restant est borné :
   0,21 ms GPU pour toute la passe, et 1,9 ms processeur d'encodage qui demanderait des paramètres
   par item indexés par instance, pas une fusion d'appels.

## Le code de diagnostic

`packages/sdk-browser/diagnosticGpuVariant.ts` déclare les sept variantes — cinq pour le mélange et
la présentation, deux qui réencodent la coupe —, les refuse hors `diagnosticDetail: 'trace'` et
refuse un nom inconnu (`diagnosticGpuVariant.test.ts`). Sans variante, le moteur compile le module
d'avant, encode les mêmes commandes et ne monte ni requête d'occlusion ni compteur : aucun chemin de
production n'est modifié. `webgpuBlendOverdraw.ts` porte le comptage, publié dans `profilParEtape`
sous l'étape « Transparents ».

## Sélection : ventilation par noyau, et le levier qu'elle a désigné

Ventilée en ouvrant une passe par lancement (même build, `--apres dist`, `rue`, p50 GPU, ms). La
somme de ces enveloppes (3,24 ms) est plus petite que l'enveloppe de la passe unique que la
production encode (6,77 ms) : la différence est de l'attente que les horodatages par passe
n'attribuent à aucun noyau. **Ce tableau donne le poids relatif des noyaux, pas leur part des
6,8 ms.** L'image, elle, ne bouge pas quand on découpe : 13,49 ms des deux façons.

| noyau         | fils avant          | fils après | ms avant | ms après |
| ------------- | ------------------- | ---------- | -------- | -------- |
| `dagReset`    | 12                  | 12         | 0,007    | 0,007    |
| `dagPlanes`   | 12                  | 12         | 0,041    | 0,041    |
| `dagNodes`    | nœuds de coupe      | idem       | 0,189    | 0,185    |
| `dagWanted`   | 1 959 792           | idem       | 0,447    | 0,460    |
| `dagArgs`     | —                   | 1          | —        | 0,004    |
| `dagEscalate` | 1 959 792 × 3       | 378 479 ×3 | 1,301    | 0,235    |
| `dagCheck`    | 1 959 792           | 378 479    | 0,429    | 0,069    |
| `dagMask`     | 1 959 792           | 378 479    | 0,438    | 0,100    |
| compaction    | 30 622 + 1 + 1,96 M | idem       | 0,301    | 0,302    |
| **total**     |                     |            | **3,24** | **1,40** |

Taux d'occupation : 378 479 grappes vivantes sur 1 959 792, soit **19,3 %** — 1 581 313 tombent par
leur nœud de coupe ou par le tronc (compteurs `grappesRejetees` / `grappesDuDag` de l'étape). Les
cinq noyaux qui suivaient `dagWanted` les visitaient toutes et relisaient 112 octets par grappe pour
refaire le même rejet : c'était de la bande passante, pas du calcul.

**Fait — répartition indirecte sur les grappes vivantes.** `dagWanted`, qui les parcourt toutes de
toute façon, dépose l'indice de chaque survivante dans une liste ; `dagArgs` en tire le nombre de
groupes ; les cinq noyaux se répartissent indirectement dessus. Même verdict : tous commençaient par
`visible`, et une grappe absente de la liste est exactement une grappe dont `visible` était faux.
Campagne `--avant fa876ed0` caméra mobile, même campagne des deux côtés : sélection 6,98 → 5,39 ms
et image 14,57 → 13,01 (`sol`), 6,77 → 5,01 et 13,50 → 11,74 (`rue`). Écart 0 px, coupe identique au
hachage près, témoin A/A 0 px ; caméra immobile, 0 px et même coupe des deux vues. Aucun tampon de
stockage de plus : la liste prolonge `flags`, le compteur prolonge `work`, et les trois mots de
l'argument sont recopiés vers un tampon `INDIRECT` de seize octets — WebGPU refuse un tampon à la
fois écrit et lu comme argument dans une même portée, d'où la coupure entre les deux passes.

**Les 3,6 ms d'attente n'appartiennent pas à la sélection.** Mesuré par répétition idempotente, la
seule soustraction qui ne change pas l'image : `selection-doublee` réencode toute la coupe avant
celle qui compte, `selection-tete-doublee` sa tête seule, et chaque noyau repartant de la remise à
zéro, l'état final est celui d'une exécution unique (0 px, même coupe, mêmes compteurs Hi-Z). `rue`,
caméra mobile, même dist des deux côtés : référence 5,05 / 5,09 ms, doublée 6,54 et 6,85 — une coupe
entière vaut donc **1,5 à 1,8 ms**, ce que la somme des noyaux (1,40 ms) disait déjà. Tête doublée :
5,66 et 5,84 contre 5,05, soit 0,6 à 0,8 ms pour préparation + nœuds + grappes voulues. L'enveloppe
de 5,0 ms sur-rapporte donc de ~3,4 ms : ses deux passes ouvrent le tampon de commandes et couvrent
ce que l'appareil finit de l'image précédente, comme « présentation » couvre la queue des
transparents. **Il n'y a pas 5 ms à gagner dans la sélection, il y en a 1,5.**

**Fait — trois lancements de moins sur treize.** La préparation porte seuils, plans et comptes de
bloc d'un seul coup ; le compte de groupes de la liste vivante se tient au fil des ajouts (le rang
multiple de 64 l'incrémente) au lieu d'un noyau d'un seul fil ; le masque compte lui-même les
dessinées de son bloc, ce qui retire un noyau et deux millions de drapeaux relus. Campagne
`--avant cc3b5033` caméra mobile, machine chargée : sélection 5,84 → 5,08 et image 14,19 → 12,84
(`sol`), 5,26 → 5,44 et 12,36 → 12,67 (`rue`), témoin A/A 5,27 et 12,32 — **le gain est dans le
bruit**, ce que la mesure ci-dessus prédit. Écart 0 px, coupe identique au hachage, caméra immobile
0 px et même coupe.

**Reste, non fait.** `dagWanted` domine le peu qui reste : 64 octets de grappe et 48 de cône par
grappe, dont 80 % tombent. Un mot compact par grappe (nœud, drapeaux, monde) éviterait
l'enregistrement des rejetées — à mesurer contre les 0,6 ms que vaut toute la tête. La coupe
incrémentale n'a pas été tentée : le seuil par primitive est un point fixe global (`atomicMax` sur
`work[w]`) qu'une frontière seule ne sait pas reproduire sans revisiter ses contributeurs.
