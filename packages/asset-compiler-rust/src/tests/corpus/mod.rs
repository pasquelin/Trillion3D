//! Generated corpus: every kind of mesh an artist can hand the compiler, each built from a seed
//! and its parameters, none hand-picked. A case is a function of the seed; `invariants.rs` and `islands.rs` hold
//! what the DAG builder guarantees on it, `cache.rs` what the compiled cache guarantees, and
//! `run.rs` asserts both on every case of every family.
use super::*;

mod attributes;
mod cache;
mod gltf;
mod inputs;
mod invariants;
mod islands;
mod materials;
mod run;
mod shapes;
mod solids;
mod topology;
mod uv;
mod uv_degenerate;

/// xorshift64, seeded: the same case on every platform, no libm in the way.
pub(super) struct Rng(u64);
impl Rng {
    pub fn new(seed: u64) -> Self {
        Self(seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1)
    }
    pub fn next(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.0 = x;
        x
    }
    /// A float in `[0, 1)`.
    pub fn unit(&mut self) -> f32 {
        (self.next() >> 40) as f32 / (1u64 << 24) as f32
    }
    /// An integer in `[low, high]`.
    pub fn between(&mut self, low: usize, high: usize) -> usize {
        low + (self.next() % (high - low + 1) as u64) as usize
    }
}

/// How the triangles are written to the document.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(super) enum Indices {
    U8,
    U16,
    U32,
    /// No index accessor: the positions are written per corner.
    Unindexed,
}

/// One material of the case, as the document declares it.
#[derive(Clone, Copy)]
pub(super) struct Material {
    pub alpha_mode: &'static str,
    pub double_sided: bool,
}
impl Material {
    pub const OPAQUE: Material = Material {
        alpha_mode: "OPAQUE",
        double_sided: false,
    };
}

/// A mesh as an artist hands it: positions, the attributes it carries, its triangles, the
/// material slot of each, and how the document is to be written.
pub(super) struct Case {
    pub name: &'static str,
    pub positions: Vec<f32>,
    pub normals: Option<Vec<f32>>,
    pub uv0: Option<Vec<f32>>,
    pub uv1: Option<Vec<f32>>,
    /// Width (3 or 4) and values of `COLOR_0`.
    pub colours: Option<(usize, Vec<f32>)>,
    pub tangents: Option<Vec<f32>>,
    pub indices: Vec<u32>,
    pub index_kind: Indices,
    /// Material slot of every triangle; empty when the case declares no material.
    pub slot_of: Vec<u32>,
    pub materials: Vec<Material>,
    /// `POSITION` written as a sparse accessor over a base with holes.
    pub sparse_positions: bool,
    /// `POSITION` written as normalised `SHORT` under `KHR_mesh_quantization`.
    pub quantized_positions: bool,
}
impl Case {
    pub fn new(name: &'static str, positions: Vec<f32>, indices: Vec<u32>) -> Self {
        Self {
            name,
            positions,
            normals: None,
            uv0: None,
            uv1: None,
            colours: None,
            tangents: None,
            indices,
            index_kind: Indices::U32,
            slot_of: Vec::new(),
            materials: Vec::new(),
            sparse_positions: false,
            quantized_positions: false,
        }
    }
    pub fn vertex_count(&self) -> usize {
        self.positions.len() / 3
    }
    /// The triangles of each primitive the document declares: one per material, or one in all.
    pub fn primitives(&self) -> Vec<Vec<u32>> {
        if self.materials.is_empty() {
            return vec![self.indices.clone()];
        }
        let mut out = vec![Vec::new(); self.materials.len()];
        for (triangle, corners) in self.indices.chunks(3).enumerate() {
            out[self.slot_of[triangle] as usize].extend_from_slice(corners);
        }
        out
    }
    /// The page attributes of the case, in the order the page format writes them.
    pub fn attributes(&self) -> Vec<geometry_page::Attribute> {
        let mut out = Vec::new();
        let mut push = |flag, width, values: &Option<Vec<f32>>| {
            if let Some(values) = values {
                out.push(geometry_page::Attribute {
                    flag,
                    width,
                    values: values.clone(),
                });
            }
        };
        push(geometry_page::FLAG_NORMAL, 3, &self.normals);
        push(geometry_page::FLAG_UV, 2, &self.uv0);
        push(geometry_page::FLAG_UV1, 2, &self.uv1);
        if let Some((width, values)) = &self.colours {
            out.push(geometry_page::Attribute {
                flag: geometry_page::FLAG_COLOR,
                width: *width,
                values: values.clone(),
            });
        }
        out
    }
}

/// What the DAG builder guarantees on a case: one root per primitive, or a stall the report
/// names by its tally key.
#[derive(Clone, Copy)]
pub(super) enum Roots {
    One,
    Stalled(&'static str),
}

/// What the corpus asserts on a case: its roots, and the code the compiler refuses it with when
/// the document is one it does not accept.
#[derive(Clone, Copy)]
pub(super) struct Expect {
    pub roots: Roots,
    pub refused: Option<&'static str>,
}
impl Expect {
    pub const ONE_ROOT: Expect = Expect {
        roots: Roots::One,
        refused: None,
    };
    pub const fn stalled(key: &'static str) -> Expect {
        Expect {
            roots: Roots::Stalled(key),
            refused: None,
        }
    }
    pub const fn refused(code: &'static str) -> Expect {
        Expect {
            roots: Roots::One,
            refused: Some(code),
        }
    }
}

pub(super) type Generator = fn(u64) -> Case;
