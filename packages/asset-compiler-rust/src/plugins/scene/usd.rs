//! Pilote de scène USD : une couche `.usda` (texte), `.usdc` (binaire « crate ») ou `.usd` devient
//! la scène intermédiaire glTF. La composition — sous-couches, références, héritages, variantes,
//! instances — est faite avant lecture, et ce module ne lit que la scène composée.
//!
//! **Provenance.** Spécification publique : *OpenUSD Core Specification* de l'AOUSD, dont la
//! grammaire du texte et le format « crate » binaire. Lecture par la caisse `openusd` 0.7.0 (MIT,
//! dépôt `mxpv/openusd`), version figée dans `Cargo.toml` : implémentation Rust native, sans
//! dépendance C++, qui lit `usda`, `usdc` et compose les couches. Aucun code ni SDK d'éditeur n'est
//! repris, et rien n'est réencodé : ce pilote lit, il n'écrit jamais à côté de la source.
//!
//! **Pourquoi une caisse plutôt qu'un lecteur écrit ici.** Les deux voies étaient ouvertes. Le
//! format « crate » est une base de données compressée — tables de jetons, de chaînes, de champs, de
//! chemins et de spécifications, entiers compressés et LZ4 — et la composition USD (LIVRPS,
//! édition de listes, instanciation) est un moteur à elle seule : la réécrire ici aurait fait
//! plusieurs milliers de lignes pour un résultat moins sûr. `openusd` est permissive, en Rust pur,
//! maintenue, et ses propres dépendances le sont toutes (MIT ou Apache-2.0).
//!
//! **Ce qu'il rend** : la hiérarchie `Xform` et `Scope`, les `Mesh` polygonaux triangulés, leurs
//! normales et leur `primvars:st`, les `GeomSubset` de la famille `materialBind` en primitives
//! distinctes, les instances (un maillage glTF par prototype), les matériaux `UsdPreviewSurface` et
//! leurs textures `UsdUVTexture`, le `defaultPrim`, `metersPerUnit` et `upAxis`.
//! **Ce qu'il compte au rapport sans le rendre** : voir les constantes `usd-*` de `world.rs`.
use super::*;
use crate::import::SceneTables as Scene;
use crate::CompilerError;
use openusd::{sdf, usd};
use serde_json::json;
use std::{
    collections::{BTreeMap, HashMap},
    fs,
    sync::atomic::Ordering,
    time::Instant,
};

mod convert;
mod extras;
mod layer;
mod material;
mod matrix;
mod mesh;
mod opacity;
mod primvar;
mod read;
mod sampling;
mod subset;
mod surface;
mod texture;
mod visit;
mod world;
mod xform;

use world::World;

pub(super) static USD: Usd = Usd;
pub(super) struct Usd;

/// Le nom du format, tel qu'il voyage dans le manifeste et dans la clé du cache.
const NAME: &str = "usd";
/// L'entête d'une couche USD texte. La spécification impose cette ligne en tête du fichier.
const TEXT_MAGIC: &[u8] = b"#usda ";
/// L'entête d'une couche USD binaire, format « crate ».
const CRATE_MAGIC: &[u8] = b"PXR-USDC";

impl Plugin for Usd {
    fn name(&self) -> &'static str {
        NAME
    }
    /// La version nomme le lecteur et la génération de la conversion : la changer invalide les
    /// caches, donc toute scène USD déjà compilée est relue.
    fn version(&self) -> &'static str {
        "usd-openusd-0.7.0-gltf-6"
    }
    fn extensions(&self) -> &'static [&'static str] {
        &["usd", "usda", "usdc"]
    }
}

impl ScenePlugin for Usd {
    /// `.usd` ne dit pas laquelle des deux sérialisations le fichier porte : les deux entêtes sont
    /// reconnues, et un fichier sans extension connue l'est par elles seules.
    fn accepts_head(&self, head: &[u8]) -> bool {
        head.starts_with(TEXT_MAGIC) || head.starts_with(CRATE_MAGIC)
    }
    fn prepare(&self, request: &SceneRequest<'_>) -> Result<PreparedScene> {
        convert::convert(request, self).map(|directory| request.converted(directory))
    }
}

/// La couche demandée. Un dossier qui porte plusieurs fichiers USD est une ambiguïté : le
/// compilateur ne choisit pas la couche racine à la place de l'appelant, qui lui en désigne une.
fn source_file(inputs: &[PathBuf]) -> Result<&Path> {
    match inputs {
        [one] => Ok(one.as_path()),
        [] => Err(CompilerError::new(
            "SOURCE_FORMAT_UNKNOWN",
            "usd: a .usd, .usda or .usdc layer is required",
        )),
        many => {
            let names: Vec<String> = many
                .iter()
                .map(|file| {
                    file.file_name()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .into()
                })
                .collect();
            Err(CompilerError::new(
                "SOURCE_FORMAT_AMBIGUOUS",
                format!(
                    "usd: this directory carries {} USD layers ({}); name the one to compile by giving its file as the source",
                    names.len(),
                    names.join(", ")
                ),
            ))
        }
    }
}
