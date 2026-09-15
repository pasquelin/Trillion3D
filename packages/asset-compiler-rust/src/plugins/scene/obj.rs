//! Pilote OBJ, d'après la spécification publiée, lu par ufbx. Le `.mtl` voisin est suivi par le
//! lecteur lui-même à partir de la ligne `mtllib` du fichier : ce n'est pas une source à part.
use super::ufbx_driver::UfbxDriver;

/// OBJ est un format texte sans entête : aucun nombre magique ne le reconnaît, seule l'extension.
pub(super) static OBJ: UfbxDriver = UfbxDriver {
    name: "obj",
    version: "obj-ufbx-0.11.3-gltf-2",
    extensions: &["obj"],
    magic: b"",
};
