# Scène de mesure — les trois classes de matériau

Une scène glTF minimale qui porte les trois classes que le moteur distingue, parce qu'aucune scène
du banc ne les porte toutes : Emerald n'a que du feuillage en mélange, ni découpe ni surface
transmissive.

| maillage | matériau | classe | rangement du compilateur |
|---|---|---|---|
| `opaque0..2` | `beton` | opaque | `exact-clusters` |
| `grille` | `grillage`, `alphaMode: MASK`, `alphaCutoff 0.5` | découpe | `exact-clusters` |
| `vitre` | `vitre`, `alphaMode: BLEND` | mélange | `clustered-blend` |
| `eau` | `eau`, `KHR_materials_transmission` | transmission | `shared-blend` |

5 668 triangles au total, chaque maillage assez subdivisé pour donner plusieurs clusters et donc une
vraie coupe de DAG. Aucune texture : la classe se lit sur le matériau seul, et la scène reste deux
fichiers lisibles.

Compilation, depuis la racine du dépôt :

```
cargo build --release --locked --manifest-path packages/asset-compiler-rust/Cargo.toml
./packages/asset-compiler-rust/target/release/web-geometry-compiler \
  packages/asset-compiler-rust/fixtures/classes-materiaux/classes-materiaux.gltf \
  <CACHE> full 1000000 /assets
```

Mesure avec le harnais commun, les deux côtés lisant ce cache :

```
node scripts/mesure/banc.mjs --moteur webgpu --avant <ref> --apres <ref> \
     --cache-avant <CACHE> --cache-apres <CACHE> --vues generale,detail \
     --images 60 --pixelError 0,1
```

`<CACHE>` est le dossier « derived » : celui qui reçoit `native/full/manifest.json`. Il vit hors du
dépôt (`.mesure/` par exemple) ; rien n'est écrit dans les ressources du banc.
