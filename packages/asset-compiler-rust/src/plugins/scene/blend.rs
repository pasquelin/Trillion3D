//! Pilote de scène `blend` : un fichier Blender lu par sa propre description, vers un glTF 2.0.
//!
//! **Provenance et licence, écrites ici comme au journal.** Ce lecteur est écrit depuis la
//! description publique du format — l'entête `BLENDER`, la suite de blocs, et le bloc `DNA1` par
//! lequel chaque fichier décrit lui-même ses structures, leurs champs et leurs types. **Aucune
//! ligne, aucun en-tête et aucun algorithme du code source de Blender n'est repris** : le dépôt
//! n'en a pas besoin, le format s'auto-décrit. Lire un `.blend` n'impose aucune licence au lecteur
//! ni au contenu lu ; la licence de la scène importée reste celle de son auteur. Les deux seules
//! bibliothèques employées ne font que décompresser une enveloppe : `flate2` 1.1.10 (MIT OU
//! Apache-2.0, backend Rust pur) pour gzip, `ruzstd` 0.7.3 (MIT, Rust pur) pour Zstandard, toutes
//! deux déjà au `Cargo.toml` avec leur notice. Rien n'est déchiffré ni contourné.
//!
//! **Ce qu'il lit.** Les objets de type maillage et leur matrice monde — position, rotation
//! (quaternion, six ordres d'Euler, axe-angle), échelle, valeurs différées, chaîne des pères et
//! matrice d'accrochage —, les maillages par leurs attributs nommés (`position`, `.corner_vert`,
//! offsets de faces, `material_index`, `sharp_face`, première couche d'UV de l'auteur), triangulés
//! en éventail ; les matériaux par leur nœud `Principled BSDF` — couleur de base, métallicité,
//! rugosité, alpha, émission, normale — et les images qu'ils lient, y compris **empaquetées**, dont
//! les octets partent dans le binaire de la scène sans être touchés. Plusieurs objets qui partagent
//! un maillage partagent le maillage glTF : ce sont des instances.
//!
//! **Ce qu'il refuse, par son nom.** Un fichier à pointeurs de 32 bits ou en boutisme gros, une
//! variante d'entête de bloc qu'il ne décrit pas, un fichier tronqué ou plus gros que son plafond,
//! un `DNA1` illisible, un maillage hors de la disposition par attributs — celle de Blender 4.4 et
//! au-delà ; les fichiers plus anciens, qui rangeaient leur géométrie dans `MPoly`/`MLoop` et
//! `CustomData`, ne sont pas lus, faute de fichier de cette époque pour le prouver.
//!
//! **Ce qu'il compte au rapport sans le rendre.** Objets qui ne sont pas des maillages (courbes,
//! textes, métaballes, armatures, lampes, caméras), collections instanciées, modificateurs non
//! appliqués — le maillage de base sort alors tel quel —, entrées de nuanceur alimentées par un
//! calcul, émission au-delà de un, images hors de la racine servie ou hors du registre d'images,
//! remplacement de matériau par un objet, et scènes au-delà de la première.
use super::*;
use crate::import::{f32_bytes, normalise, write_scene, Bin, Report, Tables};
use crate::{hash, CompilerError};
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, HashMap},
    fs,
    sync::atomic::Ordering,
    time::Instant,
};

mod attrs;
mod build;
mod bytes;
mod convert;
mod dna;
mod envelope;
mod file;
mod images;
mod material;
mod mesh;
mod normals;
mod object;
mod out;
mod shading;
#[cfg(test)]
mod tests;
mod view;
mod walker;

use dna::{Dna, Field, Layout, POINTER};
use file::{BlendFile, Block};
use images::Images;
use mesh::Geometry;
use out::Out;
use view::At;

pub(super) static BLEND: Blend = Blend;
pub(super) struct Blend;
/// Le nom du format, tel qu'il voyage dans le manifeste et dans la clé du cache.
const NAME: &str = "blend";
/// Plafond de déballage d'un fichier : au-delà, l'enveloppe est refusée sans allouer.
const MAX_BYTES: usize = 1024 * 1024 * 1024;
/// Plafond de parcours d'une liste chaînée, pour qu'un fichier abîmé ne tourne pas en rond.
const MAX_LIST: usize = 1 << 20;

/// Un refus nommé du pilote. Tout ce que ce lecteur ne sait pas lire sort par là, avec un code
/// stable que `docs/COMPILER.md` décrit — jamais par une panique.
fn refused(code: &'static str, message: impl Into<String>) -> CompilerError {
    CompilerError::new(code, message)
}

impl Plugin for Blend {
    fn name(&self) -> &'static str {
        NAME
    }
    /// La version nomme la disposition lue et les deux décompresseurs : la changer invalide les
    /// caches, donc tout `.blend` déjà compilé est relu.
    fn version(&self) -> &'static str {
        "blend-sdna-attributes-flate2-1.1.10-ruzstd-0.7.3-gltf-3"
    }
    fn extensions(&self) -> &'static [&'static str] {
        &["blend"]
    }
}

impl ScenePlugin for Blend {
    /// L'entête d'un fichier non compressé. Un `.blend` compressé commence par l'entête de son
    /// enveloppe — gzip ou Zstandard —, que d'autres formats portent aussi : il n'est donc reconnu
    /// que par son extension, jamais par un nombre magique qu'il ne possède pas en propre.
    fn accepts_head(&self, head: &[u8]) -> bool {
        head.starts_with(envelope::MAGIC)
    }
    fn prepare(&self, request: &SceneRequest<'_>) -> Result<PreparedScene> {
        convert::convert(request, self).map(|directory| request.converted(directory))
    }
}
