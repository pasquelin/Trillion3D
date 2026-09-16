//! Pilote de scène `ma` (Maya ASCII) : un fichier de commandes MEL devient une scène intermédiaire
//! glTF. **Aucune commande n'est exécutée** : le fichier est lu comme des données.
//!
//! **Provenance et licence, écrites ici comme dans `FORMATS.md`.** Ce lecteur est écrit dans ce dépôt
//! depuis la documentation publique d'Autodesk : la forme d'un `.ma` — une suite de commandes MEL
//! terminées par `;` —, les commandes `requires`, `currentUnit`, `createNode`, `setAttr`,
//! `connectAttr`, `parent` et `fileInfo`, et les noms d'attributs des nœuds `transform`, `mesh`,
//! `lambert`, `phong`, `blinn`, `standardSurface`, `file`, `place2dTexture`, `bump2d` et
//! `shadingEngine`. **Aucune ligne de code ni aucun SDK d'Autodesk n'est repris**, aucune caisse
//! n'est ajoutée au dépôt pour ce format, rien n'est déchiffré ni contourné. La licence de la scène
//! importée reste celle de son auteur.
//!
//! **Sûreté.** Un `.ma` est un programme : il peut porter des scripts. Ce pilote n'en est pas un
//! interpréteur. Il ne reconnaît que les commandes du sous-ensemble ci-dessus et **compte toutes les
//! autres par leur nom** dans `unsupported` du manifeste — `python`, `eval`, `source`, `scriptJob`
//! et tout inconnu compris. Aucune substitution, aucune expression, aucun script n'est évalué ; un
//! nœud `scriptNode` est un nœud compté comme un autre, son texte n'est jamais lu comme du code.
//!
//! **Ce qu'il lit.** La hiérarchie des `transform`, chacun identifié par son chemin de scène
//! `|pere|enfant` comme dans Maya, et posé par la composition complète du format — matrice du père
//! décalé, translation, pivots, rotation dans l'ordre déclaré par `rotateOrder`, axe de rotation,
//! cisaillement, échelle, chacun écrit d'un bloc ou composante par composante —, `inheritsTransform`
//! et la visibilité comprises ; les `mesh` par leurs sommets `.vt`, leurs arêtes `.ed`, leurs faces
//! `.fc` (découpées par oreilles dans le plan de leur normale), le premier jeu
//! d'UV `.uvst[0].uvsp`, les normales `.n` quand elles y sont et le drapeau de dureté de chaque
//! arête sinon ; les matériaux `lambert`, `phong`,
//! `blinn` et `standardSurface` vers `pbrMetallicRoughness` ; les nœuds `file` liés par
//! `connectAttr`, avec le mode de répétition de leur `place2dTexture` ; la liaison matériau ↔
//! maillage par les `shadingEngine` (`.iog` vers `.dsm`), y compris par groupes de faces ; et
//! `currentUnit -l`, dont le facteur vers le mètre est porté par la racine de la scène. Maya écrit
//! ses scènes l'axe `Y` en haut, comme glTF.
//!
//! **Ce qu'il compte au rapport sans le rendre** : voir les constantes `ma-*` de `report.rs`.
use super::*;
use crate::import::{Report, SceneTables as Scene};
use crate::CompilerError;
use serde_json::json;
use std::{
    collections::{BTreeMap, HashMap},
    fs,
    sync::atomic::Ordering,
    time::Instant,
};

mod attr;
mod build;
mod command;
mod convert;
mod document;
mod faces;
mod lex;
mod material;
mod mesh;
mod normal;
mod report;
mod shading;
#[cfg(test)]
mod tests;
mod texture;
mod value;
mod xform;

use build::World;
use command::Command;
use document::{Document, Node};
use lex::Token;
use shading::Graph;
use value::Attr;

pub(super) static MA: Ma = Ma;
pub(super) struct Ma;

/// Le nom du format, tel qu'il voyage dans le manifeste et dans la clé du cache.
const NAME: &str = "ma";
/// La première ligne qu'Autodesk écrit en tête d'un fichier Maya ASCII.
const HEADER: &str = "//Maya ASCII";

/// Le fichier n'est pas un Maya ASCII : sa première ligne ne l'annonce pas, ou une chaîne littérale
/// n'est jamais refermée — un fichier coupé au milieu d'un nom ne se lit pas jusqu'au bout.
pub(super) const FILE_INVALID: &str = "ma-file-invalid";
/// Le fichier, ou l'un de ses tableaux, dépasse le plafond d'allocation du pilote.
pub(super) const SIZE_UNSUPPORTED: &str = "ma-size-unsupported";

/// Le plafond du fichier lu : un texte de commandes au-delà n'est pas chargé en mémoire.
const MAX_BYTES: u64 = 512 * 1024 * 1024;
/// Le plafond d'un tableau d'attribut, en éléments : un indice absurde ne fait pas allouer.
pub(super) const MAX_ELEMENTS: usize = 16 << 20;

impl Plugin for Ma {
    fn name(&self) -> &'static str {
        NAME
    }
    /// La version nomme le lecteur — écrit ici, sur le sous-ensemble de commandes MEL documenté — et
    /// la génération de la conversion : la changer invalide les caches, donc toute scène Maya ASCII
    /// déjà compilée est relue.
    fn version(&self) -> &'static str {
        "ma-mel-subset-1-gltf-6"
    }
    fn extensions(&self) -> &'static [&'static str] {
        &["ma"]
    }
}

impl ScenePlugin for Ma {
    /// Maya annonce ses fichiers texte par une première ligne fixe : un fichier que son nom ne
    /// désigne pas est donc reconnu quand même.
    fn accepts_head(&self, head: &[u8]) -> bool {
        head.starts_with(HEADER.as_bytes())
    }
    fn prepare(&self, request: &SceneRequest<'_>) -> Result<PreparedScene> {
        convert::convert(request, self).map(|directory| request.converted(directory))
    }
}

/// Le fichier demandé. Un dossier qui porte plusieurs `.ma` est une ambiguïté : le compilateur ne
/// choisit pas la scène à la place de l'appelant, qui lui désigne un fichier précis comme source.
fn source_file(inputs: &[PathBuf]) -> Result<&Path> {
    if let [one] = inputs {
        return Ok(one.as_path());
    }
    Err(CompilerError::new(
        "SOURCE_FORMAT_AMBIGUOUS",
        format!(
            "ma: name the Maya ASCII file to compile; this source carries {} of them",
            inputs.len()
        ),
    ))
}
