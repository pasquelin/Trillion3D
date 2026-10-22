//! One primitive's arrays as an assembly lays them (`flatten.rs`), and what a node's transform
//! does to them.
use super::spec::refused;
use crate::compiler::primitive::triangles;
use crate::compiler::source::node_transform::Mat4;
use crate::compiler::source::synth::attribute;
use crate::hlod::chain::place::{normal_rows, Normals};
use crate::proxy::placement::place;
use crate::*;
use trillion3d_math::matrix::linear::determinant;
use trillion3d_page_codec::MAX_UV_SETS;

/// One primitive's arrays: positions, and the attributes the compiler reads — normals, tangents,
/// each texture set, a colour as four channels — when it has them.
#[derive(Clone)]
pub(super) struct Piece {
    pub(super) positions: Vec<f32>,
    pub(super) indices: Vec<u32>,
    pub(super) normals: Option<Vec<f32>>,
    pub(super) tangents: Option<Vec<f32>>,
    pub(super) uvs: [Option<Vec<f32>>; MAX_UV_SETS],
    pub(super) colours: Option<Vec<f32>>,
}

/// A colour of three channels given an opaque fourth.
fn rgba(values: Vec<f32>, width: usize) -> Vec<f32> {
    if width == 4 {
        return values;
    }
    let mut out = Vec::with_capacity(values.len() / 3 * 4);
    for colour in values.chunks_exact(3) {
        out.extend_from_slice(colour);
        out.push(1.0);
    }
    out
}

impl Piece {
    /// The bytes its arrays hold.
    pub(super) fn bytes(&self) -> usize {
        let floats = |values: &Option<Vec<f32>>| values.as_ref().map_or(0, Vec::len);
        let attributes: usize = self.uvs.iter().map(floats).sum();
        let laid = self.positions.len() + self.indices.len() + attributes;
        4 * (laid + floats(&self.normals) + floats(&self.tangents) + floats(&self.colours))
    }

    /// The arrays of triangle primitive `p`; `None` for a primitive that draws no triangles. A
    /// primitive with bones or morph targets cannot be a part: an assembly is static.
    pub(super) fn read(g: &Value, bin: &[u8], p: &Value) -> Result<Option<Self>> {
        if p.get("mode").is_some_and(|mode| mode != 4) {
            return Ok(None);
        }
        let skinned = ["JOINTS_0", "WEIGHTS_0"]
            .iter()
            .any(|s| p.pointer(&format!("/attributes/{s}")).is_some());
        if skinned || p.get("targets").is_some() {
            return Err(refused(
                "a primitive",
                "an assembly is static: no bones, no morph targets",
            ));
        }
        let (positions, indices, _) = triangles::read(g, bin, p, None)?;
        let positions = positions.collect_f32()?;
        let count = positions.len() / 3;
        let floats =
            |semantic: &str, widths: &[usize]| attribute(g, bin, p, (semantic, widths), count);
        let mut uvs: [Option<Vec<f32>>; MAX_UV_SETS] = Default::default();
        for (set, slot) in uvs.iter_mut().enumerate() {
            *slot = floats(&format!("TEXCOORD_{set}"), &[2])?.map(|(values, _)| values);
        }
        Ok(Some(Self {
            normals: floats("NORMAL", &[3])?.map(|(values, _)| values),
            tangents: floats("TANGENT", &[4])?.map(|(values, _)| values),
            colours: floats("COLOR_0", &[3, 4])?.map(|(values, width)| rgba(values, width)),
            positions,
            indices,
            uvs,
        }))
    }
}

/// What a node's transform does to the arrays of a part: its matrix on the positions, its axes
/// without their scale on the normals and the tangents (`normal_rows`, as a placed object's normals
/// turn in the world's HLOD), and, when it mirrors, the triangles turned over and the tangents'
/// handedness reversed.
pub(super) struct Placement {
    matrix: Mat4,
    rows: [[f32; 3]; 3],
    mirrors: bool,
}

impl Placement {
    pub(super) fn of(matrix: Mat4) -> Self {
        let rows = normal_rows(&matrix, Normals::Axes).map(|row| row.map(|c| c as f32));
        Self {
            matrix,
            rows,
            mirrors: determinant(&matrix) < 0.0,
        }
    }

    /// `v` turned by the axes alone.
    fn turn(&self, v: [f32; 3]) -> [f32; 3] {
        let [x, y, z] = self.rows;
        [0, 1, 2].map(|c| x[c] * v[0] + y[c] * v[1] + z[c] * v[2])
    }

    /// The piece carried by the node.
    pub(super) fn carry(&self, piece: &Piece) -> Piece {
        let mut out = piece.clone();
        out.positions = Vec::new();
        place(&piece.positions, &self.matrix, &mut out.positions);
        for n in out.normals.iter_mut().flat_map(|n| n.chunks_exact_mut(3)) {
            n.copy_from_slice(&self.turn([n[0], n[1], n[2]]));
        }
        for t in out.tangents.iter_mut().flat_map(|t| t.chunks_exact_mut(4)) {
            let turned = self.turn([t[0], t[1], t[2]]);
            t[..3].copy_from_slice(&turned);
            if self.mirrors {
                t[3] = -t[3];
            }
        }
        if self.mirrors {
            out.indices
                .chunks_exact_mut(3)
                .for_each(|tri| tri.swap(1, 2));
        }
        out
    }
}
