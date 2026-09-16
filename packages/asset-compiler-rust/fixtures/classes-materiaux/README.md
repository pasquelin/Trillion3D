# Scènes de mesure — les classes de matériau

Aucune scène du banc ne porte les classes que le moteur distingue : Emerald n'a que du feuillage en
mélange, ni découpe ni surface transmissive. Ces deux scènes glTF minimales les portent, chacune
assez subdivisée pour donner plusieurs clusters et donc une vraie coupe de DAG. Aucune texture : la
classe se lit sur le matériau seul, et chaque scène reste deux fichiers lisibles.

## `classes-materiaux` — opaque, découpe, mélange

| maillage | matériau | classe | rangement du compilateur |
|---|---|---|---|
| `opaque0..2` | `beton` | opaque | `exact-clusters` |
| `grille` | `grillage`, `alphaMode: MASK`, `alphaCutoff 0.5` | découpe | `exact-clusters` |
| `vitre` | `vitre`, `alphaMode: BLEND` | mélange | `clustered-blend` |

4 516 triangles. C'est la scène que le harnais mesure.

## `transmission` — la quatrième classe, et de quoi la voir

| maillage | matériau | classe | rangement du compilateur |
|---|---|---|---|
| `fond` | `fond`, opaque | opaque | `exact-clusters` |
| `bloc0..2` | `beton`, opaque | opaque | `exact-clusters` |
| `eau` | `eau`, `KHR_materials_transmission` 1,0, `KHR_materials_ior` 1,33, `KHR_materials_volume` (épaisseur 2,5, distance 6, couleur 0,35/0,72/0,68) | transmission | `shared-blend` |

2 880 triangles. Un plan d'eau à `y = 0` au-dessus d'un sol à `y = -2,5` et de trois blocs, dont deux
percent la surface : ce qu'on regarde est la déviation du fond sous l'eau contre la ligne droite du
bloc au-dessus d'elle, et la teinte que la distance d'atténuation lui donne. Une scène sans rien
derrière l'eau n'aurait rien prouvé du tout.

Le compilateur range l'eau en `shared-blend` : hors du DAG, une primitive = un maillage entier,
ordre source conservé. Cette primitive n'a donc aucun cluster, donc aucune bande d'erreur, et
`assertCacheIdentity` l'accepte à ce titre depuis le lot de l'eau ; une primitive `shared-blend` qui
porterait quand même des pages reste refusée.

## `emetteur-sphere` — l'exclusion sphérique de l'émetteur

| maillage | matériau | rôle |
|---|---|---|
| `sol` | `sol`, opaque | reçoit l'ombre |
| `occultant-diagonale` | `occultant`, opaque | à 0,3121 m du centre de la lampe (0,19 ; 0,18 ; 0,17 relatif) — hors de la sphère de rayon 0,20 m |
| `occultant-proche` | `occultant`, opaque | à 0,15 m du centre de la lampe — dans la sphère |
| `enveloppe-lampe` | `enveloppe`, `emissiveFactor` non nul | le luminaire autour de la lampe : six sommets à 0,20 m de son centre |

34 triangles, une lampe ponctuelle (`lampe`, `KHR_lights_punctual`, portée 3 m). Le glTF ne déclare
aucun rayon : `KHR_lights_punctual` n'en porte pas (`docs/SDK.md`). C'est le compilateur qui écrit
`"emitterRadius": 0.2` dans `lights.json`, mesuré sur `enveloppe-lampe` — le frère émissif de la
lampe, un octaèdre dont les six sommets sont à 0,20 m de son centre — et compté sous
`light-emitter-radius-derived`. Rien n'est ajouté à la main : `loadImportedLights`
(`packages/sdk-browser/importedLights.ts`) valide la valeur par le même contrat que les lampes de
l'hôte. Reproduction de l'audit VERIFICATION_STABILISATION_5896648_2026-09-16 (défaut 4) :
`occultant-diagonale` est hors de la sphère mais tombait dans le cube que l'ancien plan proche
excluait ; `occultant-proche` tombe dans les deux, avant comme après, et traverse l'enveloppe —
c'est le mur qui coupe le verre, et il occulte au-delà d'elle.

## Compiler et mesurer

Depuis la racine du dépôt :

```
cargo build --release --locked --manifest-path packages/asset-compiler-rust/Cargo.toml
./packages/asset-compiler-rust/target/release/web-geometry-compiler \
  packages/asset-compiler-rust/fixtures/classes-materiaux/<nom>.gltf <CACHE> full 1000000 /assets

node scripts/mesure/banc.mjs --moteur webgpu --avant <ref> --apres <ref> \
     --cache-avant <CACHE> --cache-apres <CACHE> --vues generale,detail \
     --images 60 --pixelError 0,1
```

`<CACHE>` est le dossier « derived » : celui qui reçoit `native/full/manifest.json`. Il vit hors du
dépôt (`.mesure/` par exemple) ; rien n'est écrit dans les ressources du banc.
