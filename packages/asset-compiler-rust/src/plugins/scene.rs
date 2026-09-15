//! Contrat des pilotes de scène : reconnaître une source, en produire la scène intermédiaire.
//!
//! La scène intermédiaire est toujours la même chose — un glTF 2.0 et son binaire — que le pilote la
//! trouve telle quelle sous la source ou qu'il l'écrive dans le cache. Le compilateur ne lit rien
//! d'autre, et ne sait pas de quel format elle vient.
use super::Plugin;
use crate::{Options, Result};
use serde_json::Value;
use std::{
    path::{Path, PathBuf},
    sync::atomic::AtomicBool,
};

mod archive;
mod fbx;
mod gltf;
mod obj;
mod route;
mod ufbx_driver;
mod unity;
mod zip;

pub use route::{prepare_source, route, Routed, RoutedSource};

/// Version du contrat des pilotes de scène. La changer impose de relire chaque pilote.
pub const VERSION: &str = "scene-plugin-1";

/// Le registre : un pilote par format. Ajouter un format, c'est un module et une ligne ici.
pub static PLUGINS: &[&dyn ScenePlugin] =
    &[&gltf::GLTF, &fbx::FBX, &obj::OBJ, &unity::UNITY, &zip::ZIP];

/// Tout ce qu'un pilote reçoit pour préparer une scène.
pub struct SceneRequest<'a> {
    /// Le chemin donné au compilateur : un fichier ou un dossier.
    pub source: &'a Path,
    /// Les fichiers que ce pilote revendique, triés. Une source fichier n'en porte qu'un.
    pub inputs: &'a [PathBuf],
    /// Le cache où écrire une scène convertie. Rien n'est jamais écrit à côté de la source.
    pub cache: &'a Path,
    /// Annulation à vérifier à chaque frontière de travail bornée.
    pub cancelled: &'a AtomicBool,
    /// Rapport d'avancement nommé : un pilote publie ses étapes sous sa propre `phase`.
    pub progress: &'a (dyn Fn(Value) + Sync),
}

/// La scène intermédiaire, prête à charger.
pub enum PreparedScene {
    /// La source portait déjà `manifest.json` : elle est la scène intermédiaire, aucun pilote.
    Manifest,
    /// Le fichier glTF nommé se lit tel quel sous la source : le pilote n'a rien converti.
    InPlace(String),
    /// Le pilote a écrit `model.gltf`, `model.bin` et leur manifeste dans ce dossier du cache.
    Converted(PathBuf),
}

/// Un pilote de scène. Les erreurs sortent en `CompilerError` avec un code, jamais en panique ;
/// ce qui n'est pas interprétable est une entrée de rapport nommée, pas un échec silencieux.
pub trait ScenePlugin: Plugin + Sync {
    /// Reconnaît une source à ses premiers octets, pour un fichier dont l'extension ne dit rien.
    /// Un format texte, sans entête, rend `false` : seule son extension le désigne.
    fn accepts_head(&self, head: &[u8]) -> bool;
    /// Produit la scène intermédiaire à partir des fichiers revendiqués.
    fn prepare(&self, request: &SceneRequest<'_>) -> Result<PreparedScene>;
}

impl<'a> SceneRequest<'a> {
    pub(super) fn new(
        o: &'a Options,
        inputs: &'a [PathBuf],
        progress: &'a (dyn Fn(Value) + Sync),
    ) -> Self {
        Self {
            source: &o.source,
            inputs,
            cache: &o.cache,
            cancelled: &o.cancelled,
            progress,
        }
    }
}
