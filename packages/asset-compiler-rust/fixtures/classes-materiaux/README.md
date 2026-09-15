# Scènes de mesure — les trois classes de matériau

Aucune scène du banc ne porte les trois classes que le moteur distingue : Emerald n'a que du
feuillage en mélange, ni découpe ni surface transmissive. Ces deux scènes glTF minimales les
portent, chacune assez subdivisée pour donner plusieurs clusters et donc une vraie coupe de DAG.
Aucune texture : la classe se lit sur le matériau seul, et chaque scène reste deux fichiers
lisibles.

## `classes-materiaux` — opaque, découpe, mélange

| maillage | matériau | classe | rangement du compilateur |
|---|---|---|---|
| `opaque0..2` | `beton` | opaque | `exact-clusters` |
| `grille` | `grillage`, `alphaMode: MASK`, `alphaCutoff 0.5` | découpe | `exact-clusters` |
| `vitre` | `vitre`, `alphaMode: BLEND` | mélange | `clustered-blend` |

4 516 triangles. C'est la scène que le harnais mesure.

## `transmission` — la classe que le moteur ne dessine pas encore

Un plan d'eau seul, `KHR_materials_transmission`. Le compilateur le range en `shared-blend` : hors
du DAG, une primitive = un maillage entier. **Le cache qui en résulte est refusé au chargement** :
`assertCacheIdentity` exige une bande d'erreur par cluster de *chaque* primitive, et une primitive
`shared-blend` n'en a pas par construction (`Cache without a cluster DAG cannot be used: primitive
0/0 has no per-cluster error band`). C'est donc la première chose à corriger avant d'écrire la passe
de transmission, et la scène est ici pour le fixer noir sur blanc.

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
