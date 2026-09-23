//! Alembic scene driver: a static-geometry `.abc` becomes an intermediate glTF scene.
//!
//! **Provenance and licence, written here as in `docs/COMPILER.md` § "Input formats".** The reader is written in this
//! repository from Alembic's public specification and its reference sources, under the
//! BSD-3-Clause licence (Sony Pictures Imageworks, Lucasfilm): Ogawa container, metadata, objects,
//! compound properties, scalars and arrays, samples. No library is added to the repository for
//! this format, no vendor code or SDK is reused, nothing is deciphered or circumvented. The only
//! public Rust crate candidate, `ogawa-rs` 0.4.0 (MIT OR Apache-2.0), was evaluated and rejected:
//! it panics on a data type this corpus carries — the boolean of an `.inherits` —, indexes its
//! groups unbounded, and ceilings no allocation, where this repository requires a corrupted file
//! to yield a named refusal. The licence of the imported content remains that of its author: this
//! driver neither grants nor withdraws any.
//!
//! **What it reads.** The `Xform` hierarchy — first sample, composed operation stack, declared
//! inheritance —, `PolyMesh` — positions, faces, normals and texture coordinates, whatever their
//! scope —, `SubD`, rendered as the flat polygons they carry, and `FaceSet`, each of which gives
//! a material to the mesh that holds it. Alembic describes no shading network: a material is a
//! name, and this driver therefore invents neither colour nor texture for it.
//!
//! **What it counts on the report without returning it**: curves, points, NURBS surfaces, cameras,
//! lamps, objects of another schema, instances by reference, animation — only the first sample is
//! read —, faces claimed by two face sets, degenerate faces, inconsistent geometry parameters, and
//! `.arbGeomParams`, which carries whatever the exporter chose to put there.
use super::*;
use crate::{hash_file, CompilerError};
use serde_json::json;
use std::time::Instant;

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
/// The format name, as it travels in the manifest and in the cache key.
const NAME: &str = "alembic";

/// The file is an Alembic in the HDF5 container: another wrapping format, which this binary does
/// not read and does not imitate. The refusal names it rather than looking like a corrupted file.
pub(super) const HDF5_UNSUPPORTED: &str = "alembic-hdf5-unsupported";
/// The archive was never frozen: the writer did not close it, and what it holds is a work in progress.
pub(super) const NOT_FROZEN: &str = "alembic-archive-unfrozen";
/// The header declares a format version this reader does not read.
pub(super) const VERSION_UNSUPPORTED: &str = "alembic-version-unsupported";
/// The file structure does not hold: missing header, truncated block, pointer outside the file.
pub(super) const FILE_INVALID: &str = "alembic-file-invalid";
/// A block declares more bytes or children than the driver's allocation ceiling admits.
pub(super) const SIZE_UNSUPPORTED: &str = "alembic-size-unsupported";
/// A transform does not compose: unknown operation, or not enough values.
pub(super) const VALUES_INVALID: &str = "alembic-values-invalid";
/// A mesh's topology contradicts itself: corners outside the position table, faces beyond the
/// written indices, or more corners than the ceiling admits.
pub(super) const TOPOLOGY_INVALID: &str = "alembic-topology-invalid";

impl Plugin for Alembic {
    fn name(&self) -> &'static str {
        NAME
    }
    /// The version names the reader — written here, on the Ogawa container — and the conversion
    /// generation: changing it invalidates caches, so every already-compiled Alembic scene is reread.
    fn version(&self) -> &'static str {
        "alembic-ogawa-1-gltf-3"
    }
    fn extensions(&self) -> &'static [&'static str] {
        &["abc"]
    }
}

impl ScenePlugin for Alembic {
    /// The Ogawa container header, for a file its name does not designate. An HDF5 `.abc` is not
    /// recognised here: its extension brings it to the driver, which refuses it by name — more
    /// useful than an unknown format.
    fn accepts_head(&self, head: &[u8]) -> bool {
        head.starts_with(ogawa::MAGIC)
    }
    fn prepare(&self, request: &SceneRequest<'_>) -> Result<PreparedScene> {
        convert::convert(request, self).map(|directory| request.converted(directory))
    }
}
