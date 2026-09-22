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

pub(super) use crate::bench_calculs::inputs::Xorshift;

/// The generator of a case: the benches' xorshift, its seed spread over the whole state so that
/// neighbouring seeds draw unrelated cases. The same case on every platform, no libm in the way.
pub(super) fn seeded(seed: u64) -> Xorshift {
    Xorshift::new(seed.wrapping_mul(0x9E37_79B9_7F4A_7C15))
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
    /// Whether a material samples `TEXCOORD_0` and `TEXCOORD_1`. A set the case carries and no
    /// material samples stays out of the pages and out of the seam weld.
    pub sampled: [bool; 2],
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
            sampled: [true; 2],
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
    /// Width and values of the attribute the document names `name`, when the case carries it.
    pub fn values(&self, name: &str) -> Option<(usize, &[f32])> {
        let (width, values) = match name {
            "NORMAL" => (3, self.normals.as_ref()?),
            "TEXCOORD_0" => (2, self.uv0.as_ref()?),
            "TEXCOORD_1" => (2, self.uv1.as_ref()?),
            "TANGENT" => (4, self.tangents.as_ref()?),
            "COLOR_0" => {
                let (width, values) = self.colours.as_ref()?;
                (*width, values)
            }
            _ => return None,
        };
        Some((width, values))
    }
    /// Whether the pages carry the attribute flagged `flag`: every one but a texture set no
    /// material samples.
    fn carried(&self, flag: u32) -> bool {
        match flag {
            geometry_page::FLAG_UV => self.sampled[0],
            geometry_page::FLAG_UV1 => self.sampled[1],
            _ => true,
        }
    }
    /// The attributes the pages carry, in the order the page format writes them.
    pub fn attributes(&self) -> Vec<geometry_page::Attribute> {
        geometry_page::PAGE_ATTRIBUTES
            .iter()
            .filter(|&&(_, _, flag)| self.carried(flag))
            .filter_map(|&(name, _, flag)| {
                let (width, values) = self.values(name)?;
                Some(geometry_page::Attribute {
                    flag,
                    width,
                    values: values.to_vec(),
                })
            })
            .collect()
    }
    /// The texture sets the pages carry, by name: those the seam weld keeps apart.
    pub fn uv_sets(&self) -> Vec<(&'static str, &[f32])> {
        geometry_page::PAGE_ATTRIBUTES
            .iter()
            .filter(|&&(_, _, flag)| {
                (flag == geometry_page::FLAG_UV || flag == geometry_page::FLAG_UV1)
                    && self.carried(flag)
            })
            .filter_map(|&(name, _, _)| Some((name, self.values(name)?.1)))
            .collect()
    }
}

/// What the DAG builder guarantees on a case: one root per primitive, or a stall whose every
/// group carries one of the causes the case accepts.
#[derive(Clone, Copy)]
pub(super) enum Roots {
    One,
    Stalled(&'static [&'static str]),
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
    pub const fn stalled(causes: &'static [&'static str]) -> Expect {
        Expect {
            roots: Roots::Stalled(causes),
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
