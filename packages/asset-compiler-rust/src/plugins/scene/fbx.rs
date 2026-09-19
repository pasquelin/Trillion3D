//! FBX driver. Read through ufbx (MIT), never through the Autodesk SDK; ufbx's version is
//! pinned in `Cargo.toml` and named in the driver's version, so that the cache identity
//! follows it.
use super::ufbx_driver::UfbxDriver;

/// "Kaydara FBX Binary" opens every binary FBX. An ASCII FBX has no such header: its
/// extension alone names it, which the router tries first.
pub(super) static FBX: UfbxDriver = UfbxDriver {
    name: "fbx",
    version: "fbx-ufbx-0.11.3-gltf-7",
    extensions: &["fbx"],
    magic: b"Kaydara FBX Binary",
};
