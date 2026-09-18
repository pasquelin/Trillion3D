//! Pilote FBX. Lecture par ufbx (MIT), jamais par le SDK Autodesk ; la version d'ufbx est figée
//! dans `Cargo.toml` et nommée dans la version du pilote, pour que l'identité du cache la suive.
use super::ufbx_driver::UfbxDriver;

/// « Kaydara FBX Binary » ouvre tout FBX binaire. Un FBX ASCII n'a pas cet entête : son extension
/// seule le désigne, ce que le routeur essaie en premier.
pub(super) static FBX: UfbxDriver = UfbxDriver {
    name: "fbx",
    version: "fbx-ufbx-0.11.3-gltf-7",
    extensions: &["fbx"],
    magic: b"Kaydara FBX Binary",
};
