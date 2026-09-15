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

mod alembic;
mod archive;
mod fbx;
mod gltf;
mod obj;
mod route;
mod ufbx_driver;
mod unity;
mod unitypackage;
mod zip;

pub use route::{prepare_source, route, Routed, RoutedSource};

/// Version du contrat des pilotes de scène. La changer impose de relire chaque pilote.
pub const VERSION: &str = "scene-plugin-2";

/// Le registre : un pilote par format. Ajouter un format, c'est un module et une ligne ici.
pub static PLUGINS: &[&dyn ScenePlugin] = &[
    &gltf::GLTF,
    &fbx::FBX,
    &obj::OBJ,
    &unity::UNITY,
    &zip::ZIP,
    &unitypackage::UNITYPACKAGE,
    &alembic::ALEMBIC,
];

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

/// Le dossier contre lequel les URI relatives d'images d'une source se résolvent : la source
/// elle-même quand c'est un dossier, le dossier qui la porte quand c'est un fichier.
///
/// C'est la seule règle du dépôt sur ce point, et elle vaut des deux côtés : un pilote y trouve les
/// octets des images qu'il référence et en tire des URI relatives à cette racine, le compilateur y
/// relit ces mêmes octets pour en calculer les aperçus. Un pilote qui écrit sa scène intermédiaire
/// ailleurs — dans le cache — n'y déplace pas ses images : la scène convertie emporte donc sa racine.
pub fn image_root(source: &Path) -> PathBuf {
    if !source.is_file() {
        return source.to_path_buf();
    }
    source
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .map_or_else(|| PathBuf::from("."), Path::to_path_buf)
}

/// La scène intermédiaire, prête à charger.
pub enum PreparedScene {
    /// La source portait déjà `manifest.json` : elle est la scène intermédiaire, aucun pilote.
    Manifest,
    /// Le fichier glTF nommé se lit tel quel sous la source : le pilote n'a rien converti.
    InPlace(String),
    /// Le pilote a écrit `model.gltf`, `model.bin` et leur manifeste dans `directory`, sous le
    /// cache. `images` reste la racine où ses URI d'images se résolvent, qui n'a pas bougé.
    Converted { directory: PathBuf, images: PathBuf },
}

impl PreparedScene {
    /// Une scène écrite dans `directory`, dont les URI d'images se résolvent sous `images`.
    pub fn converted(directory: PathBuf, images: &Path) -> Self {
        Self::Converted {
            directory,
            images: images.to_path_buf(),
        }
    }
    /// La racine de résolution des images de cette scène. `source` est le chemin donné au
    /// compilateur, dont une scène non convertie ne s'écarte jamais.
    pub fn images(&self, source: &Path) -> PathBuf {
        match self {
            Self::Converted { images, .. } => images.clone(),
            Self::Manifest | Self::InPlace(_) => image_root(source),
        }
    }
}

/// Un pilote de scène. Les erreurs sortent en `CompilerError` avec un code, jamais en panique ;
/// ce qui n'est pas interprétable est une entrée de rapport nommée, pas un échec silencieux.
pub trait ScenePlugin: Plugin + Sync {
    /// Reconnaît une source à ses premiers octets, pour un fichier dont l'extension ne dit rien.
    /// Un format texte, sans entête, rend `false` : seule son extension le désigne.
    fn accepts_head(&self, head: &[u8]) -> bool;
    /// Produit la scène intermédiaire à partir des fichiers revendiqués.
    fn prepare(&self, request: &SceneRequest<'_>) -> Result<PreparedScene>;
    /// Les entrées d'un dossier que ce pilote revendique comme **projet** : un arbre entier dont il
    /// est la source, et dont les fichiers trouvés dessous ne sont que des entrées. Un pilote de
    /// fichiers, le cas ordinaire, rend `None` et laisse le routeur regarder les fichiers.
    fn project_inputs(&self, _directory: &Path) -> Option<Vec<PathBuf>> {
        None
    }
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
    /// La scène que ce pilote vient d'écrire dans `directory`, avec la racine où les URI d'images
    /// qu'il y a inscrites se résolvent : celle de la source qu'il a lue, pas celle du cache.
    pub fn converted(&self, directory: PathBuf) -> PreparedScene {
        PreparedScene::converted(directory, &image_root(self.source))
    }
}
