//! Pilote de scène Unity : un projet exporté tel quel devient une scène intermédiaire glTF.
//!
//! **Condition juridique, écrite ici comme dans le journal.** Ce pilote ne lit que des *données* :
//! la sérialisation YAML documentée par Unity pour `.unity`, `.prefab`, `.mat` et `.meta`. Aucun
//! script C#, aucun assembly, aucune bibliothèque, aucun SDK et aucun shader de l'éditeur n'est lu,
//! exécuté, repris ni redistribué ; rien n'est déchiffré ni contourné. Le lecteur YAML est
//! `yaml-rust2` (MIT OU Apache-2.0), version figée dans `Cargo.toml`. Les maillages viennent des
//! fichiers modèles du projet, lus par leur propre pilote — jamais par celui-ci. La licence du
//! contenu importé reste celle de son auteur : ce pilote n'en accorde ni n'en retire aucune.
//!
//! Ce qu'il lit : la hiérarchie des `Transform`, les `MeshFilter` et `MeshRenderer`, les instances
//! de prefab et leurs retouches, les `LODGroup` (niveau le plus fin seulement), les matériaux
//! Standard, URP Lit et HDRP Lit, et les textures que le registre d'images sait décoder.
//! Ce qu'il compte au rapport sans le rendre : lampes, caméras, terrains, particules, scripts,
//! rendus animés, objets inactifs, niveaux de LOD écartés, retouches de prefab autres que la
//! transformation, cartes métal/lissage empaquetées et textures hors registre.
use super::*;
use crate::import::{f32_bytes, normalise, write_scene, Bin, Report, Tables};
use crate::{hash, hash_file, CompilerError};
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    fs,
    rc::Rc,
    sync::atomic::Ordering,
    time::Instant,
};
use yaml_rust2::yaml::Yaml;

mod assets;
mod build;
mod builtin;
mod convert;
mod materials;
mod merge;
mod models;
mod output;
mod prefab;
mod project;
mod render;
mod textures;
mod transform;
mod yaml;

use build::*;
use builtin::*;
use convert::convert;
use merge::Parts;
use models::Models;
use output::Scene;
use project::{assets_root, read_text, Project};
use textures::Textures;
use transform::Trs;
use yaml::*;

pub(super) static UNITY: Unity = Unity;
pub(super) struct Unity;
/// Le nom du format, tel qu'il voyage dans le manifeste et dans la clé du cache.
const NAME: &str = "unity";

impl Plugin for Unity {
    fn name(&self) -> &'static str {
        NAME
    }
    /// La version nomme le lecteur YAML et la génération de la conversion : la changer invalide les
    /// caches, donc toute scène Unity déjà compilée est relue.
    fn version(&self) -> &'static str {
        "unity-yaml-rust2-0.13-gltf-1"
    }
    fn extensions(&self) -> &'static [&'static str] {
        &["unity"]
    }
}

impl ScenePlugin for Unity {
    /// L'entête d'un fichier de données Unity : la directive de tag que l'éditeur écrit en tête de
    /// chaque fichier sérialisé.
    fn accepts_head(&self, head: &[u8]) -> bool {
        head.windows(12).any(|window| window == b"tag:unity3d.")
    }
    fn prepare(&self, request: &SceneRequest<'_>) -> Result<PreparedScene> {
        convert(request, self).map(|directory| request.converted(directory))
    }
}

/// Ce qu'un parcours a sous la main : la scène en construction, l'index du projet, et de quoi
/// demander un modèle au registre.
struct World<'a> {
    scene: &'a mut Scene,
    project: &'a Project,
    cache: &'a Path,
    cancelled: &'a AtomicBool,
    progress: &'a (dyn Fn(Value) + Sync),
}
impl World<'_> {
    /// L'annulation, vérifiée à chaque objet : le parcours s'arrête, `convert` refuse ensuite.
    fn check(&self) -> Option<()> {
        (!self.cancelled.load(Ordering::Relaxed)).then_some(())
    }
}
