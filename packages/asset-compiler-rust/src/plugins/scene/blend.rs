//! `blend` scene driver: a Blender file read by its own description, to a glTF 2.0.
//!
//! **Provenance and licence, written here as in `docs/COMPILER.md` § "Input formats".** This reader is written from the
//! public description of the format — the `BLENDER` header, the sequence of blocks, and the `DNA1`
//! block by which each file describes its own structures, their fields and their types. **No
//! line, header or algorithm of Blender's source code is reused**: the repository does not need
//! it, the format describes itself. Reading a `.blend` imposes no licence on the reader nor on
//! the content read; the licence of the imported scene remains that of its author. The only two
//! libraries used only decompress a wrapping: `flate2` 1.1.10 (MIT OR Apache-2.0, pure-Rust
//! backend) for gzip, `ruzstd` 0.7.3 (MIT, pure Rust) for Zstandard, both already in `Cargo.toml`
//! with their notice. Nothing is deciphered or circumvented.
//!
//! **What it reads.** The file's active scene — the one its global block designates —, by its
//! master collection and the child collections the view layer does not exclude: the mesh-type
//! objects they hold and their world matrix — position, rotation (quaternion, six Euler orders,
//! axis-angle), scale, deferred values, parent chain and parenting matrix —, meshes by their named
//! attributes (`position`, `.corner_vert`, face offsets, `material_index`, `sharp_face`, the
//! author's first UV layer, whose V coordinate is flipped for glTF's origin), fan-triangulated;
//! materials by their `Principled BSDF` node — base colour, metallic, roughness, alpha, emission,
//! normal — reached from the graph's active output, and the images they link, including **packed**
//! ones, whose bytes go into the scene binary untouched. Several objects that share a mesh share
//! the glTF mesh: they are instances.
//!
//! Lamps of the four types Blender writes — point, sun, spot, area — are imported with their
//! power, colour, cone and the emitter radius their `Lamp` block declares.
//!
//! **What it refuses, by name.** A file with 32-bit pointers or big-endian, a block-header variant
//! it does not describe, a truncated file or one larger than its ceiling, an unreadable `DNA1`, a
//! mesh outside the attribute layout — that of Blender 4.4 and beyond; older files, which stored
//! their geometry in `MPoly`/`MLoop` and `CustomData`, are not read, for lack of a file of that
//! era to prove it.
//!
//! **What it counts on the report without returning it.** Objects that are not meshes (curves,
//! texts, metaballs, armatures, cameras), instanced collections, unapplied modifiers — the base
//! mesh then comes out as-is —, shader inputs fed by a computation, emission beyond one, images
//! outside the served root or outside the image register, material replacement by an object,
//! scenes beyond the first, objects that no collection of the active scene holds, a surface
//! shader without a PBR equivalent, and opacity taken from another image or another channel than
//! the alpha of the base colour.
use super::*;
use crate::import::{f32_bytes, normalise, write_scene, Bin, Report, Tables};
use crate::plugins::scene::{cancel, normals};
use crate::{hash, CompilerError};
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    fs,
    sync::atomic::{AtomicBool, Ordering},
    time::Instant,
};

mod active;
mod alpha;
mod attrs;
mod build;
mod bytes;
mod convert;
mod dna;
mod envelope;
mod file;
mod images;
mod light;
mod material;
mod mesh;
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
/// The format name, as it travels in the manifest and in the cache key.
const NAME: &str = "blend";
/// Unpacking ceiling of a file: beyond it, the wrapping is refused without allocating.
const MAX_BYTES: usize = 1024 * 1024 * 1024;
/// Ceiling of a linked-list walk, so a damaged file does not loop.
const MAX_LIST: usize = 1 << 20;

/// A named refusal of the driver. Everything this reader cannot read comes out here, with a
/// stable code that `docs/COMPILER.md` describes — never by a panic.
fn refused(code: &'static str, message: impl Into<String>) -> CompilerError {
    CompilerError::new(code, message)
}

impl Plugin for Blend {
    fn name(&self) -> &'static str {
        NAME
    }
    /// The version names the layout read and the two decompressors: changing it invalidates
    /// caches, so every already-compiled `.blend` is reread.
    fn version(&self) -> &'static str {
        "blend-sdna-attributes-flate2-1.1.10-ruzstd-0.7.3-gltf-9"
    }
    fn extensions(&self) -> &'static [&'static str] {
        &["blend"]
    }
}

impl ScenePlugin for Blend {
    /// The header of an uncompressed file. A compressed `.blend` starts with the header of its
    /// wrapping — gzip or Zstandard —, which other formats also carry: it is therefore recognised
    /// only by its extension, never by a magic number it does not own.
    fn accepts_head(&self, head: &[u8]) -> bool {
        head.starts_with(envelope::MAGIC)
    }
    fn prepare(&self, request: &SceneRequest<'_>) -> Result<PreparedScene> {
        convert::convert(request, self).map(|directory| request.converted(directory))
    }
}
