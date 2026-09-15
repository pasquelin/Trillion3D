//! Pilote de scène Alembic : un `.abc` de géométrie statique devient une scène intermédiaire glTF.
//!
//! **Provenance et licence, écrites ici comme dans le journal.** Le lecteur est écrit dans ce dépôt,
//! depuis la spécification publique d'Alembic et ses sources de référence, sous licence
//! BSD-3-Clause (Sony Pictures Imageworks, Lucasfilm) : conteneur Ogawa, métadonnées, objets,
//! propriétés composées, scalaires et tableaux, échantillons. Aucune bibliothèque n'est ajoutée au
//! dépôt pour ce format, aucun code ni SDK d'éditeur n'est repris, rien n'est déchiffré ni
//! contourné. La seule caisse Rust publique candidate, `ogawa-rs` 0.4.0 (MIT OU Apache-2.0), a été
//! évaluée et écartée : elle panique sur un type de donnée que ce corpus porte — le booléen d'un
//! `.inherits` —, indexe ses groupes sans borne, et ne plafonne aucune allocation, là où ce dépôt
//! exige qu'un fichier corrompu rende un refus nommé. La licence du contenu importé reste celle de
//! son auteur : ce pilote n'en accorde ni n'en retire aucune.
//!
//! **Ce qu'il lit.** La hiérarchie des `Xform` — premier échantillon, pile d'opérations composée,
//! héritage déclaré —, les `PolyMesh` — positions, faces, normales et coordonnées de texture, quelle
//! que soit leur portée —, les `SubD`, rendus comme les polygones plats qu'ils portent, et les
//! `FaceSet`, dont chacun donne un matériau au maillage qui le porte. Alembic ne décrit aucun
//! nuancier : un matériau y est un nom, et ce pilote ne lui invente donc ni couleur ni texture.
//!
//! **Ce qu'il compte au rapport sans le rendre** : courbes, points, surfaces NURBS, caméras,
//! lampes, objets d'un autre schéma, instances par référence, animation — seul le premier
//! échantillon est lu —, faces revendiquées par deux face sets, faces dégénérées, paramètres de
//! géométrie incohérents, et `.arbGeomParams`, qui porte ce que l'exportateur a bien voulu y mettre.
use super::*;
use crate::{hash_file, CompilerError};
use serde_json::json;
use std::{sync::atomic::Ordering, time::Instant};

mod archive;
mod convert;
mod geom;
mod kind;
mod mesh;
mod ogawa;
mod property;
mod scene;
#[cfg(test)]
mod tests;
mod values;
mod walk;
mod xform;

use archive::Archive;
use scene::Scene;
use walk::World;

pub(super) static ALEMBIC: Alembic = Alembic;
pub(super) struct Alembic;
/// Le nom du format, tel qu'il voyage dans le manifeste et dans la clé du cache.
const NAME: &str = "alembic";

/// Le fichier est un Alembic au conteneur HDF5 : un autre format d'emballage, que ce binaire ne lit
/// pas et n'imite pas. Le refus le nomme plutôt que de laisser croire à un fichier corrompu.
pub(super) const HDF5_UNSUPPORTED: &str = "alembic-hdf5-unsupported";
/// La structure du fichier ne tient pas : entête absente, bloc tronqué, pointeur hors du fichier.
pub(super) const FILE_INVALID: &str = "alembic-file-invalid";
/// Un bloc déclare plus d'octets ou d'enfants que le plafond d'allocation du pilote n'en admet.
pub(super) const SIZE_UNSUPPORTED: &str = "alembic-size-unsupported";
/// Une transformation ne se compose pas : opération inconnue, ou valeurs en nombre insuffisant.
pub(super) const VALUES_INVALID: &str = "alembic-values-invalid";
/// La topologie d'un maillage se contredit : coins hors de la table des positions, faces au-delà
/// des indices écrits, ou plus de coins que le plafond n'en admet.
pub(super) const TOPOLOGY_INVALID: &str = "alembic-topology-invalid";

impl Plugin for Alembic {
    fn name(&self) -> &'static str {
        NAME
    }
    /// La version nomme le lecteur — écrit ici, sur le conteneur Ogawa — et la génération de la
    /// conversion : la changer invalide les caches, donc toute scène Alembic déjà compilée est relue.
    fn version(&self) -> &'static str {
        "alembic-ogawa-1-gltf-2"
    }
    fn extensions(&self) -> &'static [&'static str] {
        &["abc"]
    }
}

impl ScenePlugin for Alembic {
    /// L'entête du conteneur Ogawa, pour un fichier que son nom ne désigne pas. Un `.abc` au
    /// conteneur HDF5 n'est pas reconnu ici : son extension l'amène au pilote, qui le refuse en le
    /// nommant — c'est plus utile qu'un format inconnu.
    fn accepts_head(&self, head: &[u8]) -> bool {
        head.starts_with(ogawa::MAGIC)
    }
    fn prepare(&self, request: &SceneRequest<'_>) -> Result<PreparedScene> {
        convert::convert(request, self).map(|directory| request.converted(directory))
    }
}
