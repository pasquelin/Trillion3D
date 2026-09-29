//! What a page carries for the GPU deformation stage (#357): each vertex's four joints and
//! weights, and each morph target's position and normal displacement — the streams, records and
//! bounds of the shared codec (`trillion3d_page_codec::deform`), written from the primitive's
//! `JOINTS_0`, `WEIGHTS_0` and `targets`.
use crate::geometry_page_cells::Cell;
use crate::geometry_page_quant::quantize;
use crate::{CompilerError, Result};
use std::collections::HashMap;
use trillion3d_page_codec::bits::{bits_for, Quant};
use trillion3d_page_codec::deform::{
    Morph, Skin, INFLUENCES, MAX_JOINT_BITS, MAX_MORPH_TARGETS, WEIGHT_BITS, WEIGHT_SCALE,
};
use trillion3d_page_codec::writer::BitWriter;
use trillion3d_page_codec::{FLAG_MORPH, FLAG_SKIN};
/// Normal displacements sit on a grid of 2^-10: finer than the octahedral byte they bend.
pub const MORPH_NORMAL_EXPONENT: i32 = -10;
/// One morph target of a primitive: its position displacement per vertex, three floats each, and
/// its normal displacement when it declares one.
pub struct MorphTarget {
    pub position: Vec<f32>,
    pub normal: Option<Vec<f32>>,
}
/// The deformation a primitive declares: its skin — four joints and four weights per vertex —
/// and its morph targets, each over every vertex of the primitive.
#[derive(Default)]
pub struct Deformation {
    pub skin: Option<(Vec<u32>, Vec<f32>)>,
    pub targets: Vec<MorphTarget>,
    /// The index stream names welded simulation vertices instead of bone joints.
    pub soft_source: bool,
}
/// A page's deformation: its records, and per local vertex the fields its streams hold — four
/// joint offsets and three weights, then six displacement cells per target.
pub struct PageDeformation {
    pub skin: Option<Skin>,
    pub morphs: Vec<Morph>,
    pub fields: Vec<Vec<u32>>,
    pub soft_source: bool,
}

impl Deformation {
    /// Vertices its arrays cover: the source's, zero when it deforms nothing.
    pub fn vertices(&self) -> usize {
        match (&self.skin, self.targets.first()) {
            (Some((joints, _)), _) => joints.len() / INFLUENCES,
            (None, Some(target)) => target.position.len() / 3,
            (None, None) => 0,
        }
    }
}

impl PageDeformation {
    /// The presence bits it adds to the page's flags.
    pub fn flags(&self) -> u32 {
        let skin = if self.skin.is_some() { FLAG_SKIN } else { 0 };
        let source = if self.soft_source {
            trillion3d_page_codec::FLAG_SOFT_SOURCE
        } else {
            0
        };
        source
            | skin
            | if self.morphs.is_empty() {
                0
            } else {
                FLAG_MORPH
            }
    }
}

/// Each vertex's cells with the rank of its deformation fields among the distinct rows, and
/// those rows by rank: two vertices then merge only when they also deform alike.
pub fn join(cells: Vec<Cell>, fields: &[Vec<u32>]) -> (Vec<Cell>, Vec<&[u32]>) {
    let mut ranks = HashMap::<&[u32], u32>::new();
    let mut table = Vec::new();
    let cells = (cells.into_iter().zip(fields))
        .map(|(cell, row)| {
            let extra = *ranks.entry(row).or_insert_with(|| {
                table.push(row.as_slice());
                table.len() as u32 - 1
            });
            Cell { extra, ..cell }
        })
        .collect();
    (cells, table)
}

/// The page's deformation over its vertices `original` (primitive ranks, in local order):
/// joints on the page's own base and width, displacements on the primitive's position grid. A
/// rank past the source's is a vertex a solved reduction placed: it deforms as its `origin`.
pub fn page_deformation(
    deformation: &Deformation,
    original: &[u32],
    origin: &[u32],
    position_exponent: i32,
) -> Result<PageDeformation> {
    let source = deformation.vertices();
    let original: Vec<u32> = (original.iter())
        .map(|&v| match (v as usize).checked_sub(source) {
            Some(placed) if source > 0 => origin[placed],
            _ => v,
        })
        .collect();
    let original = original.as_slice();
    let mut fields = vec![Vec::new(); original.len()];
    let skin = match &deformation.skin {
        None => None,
        Some((joints, weights)) => Some(skin_fields(joints, weights, original, &mut fields)?),
    };
    if deformation.targets.len() > MAX_MORPH_TARGETS {
        return Err(CompilerError::new(
            "PAGE_MORPH_TARGETS",
            "A primitive has more morph targets than a page carries",
        ));
    }
    let mut morphs = Vec::with_capacity(deformation.targets.len());
    for target in &deformation.targets {
        let gather = |values: &[f32]| -> Vec<f32> {
            let at = |v: u32| &values[v as usize * 3..v as usize * 3 + 3];
            original
                .iter()
                .flat_map(|&v| at(v).iter().copied())
                .collect()
        };
        let (position, moved) = quantize::<3>(&gather(&target.position), position_exponent)?;
        let (normal, bent) = match &target.normal {
            Some(normals) => quantize::<3>(&gather(normals), MORPH_NORMAL_EXPONENT)?,
            None => (
                Quant::flat(MORPH_NORMAL_EXPONENT),
                vec![[0; 3]; original.len()],
            ),
        };
        for (vertex, (m, b)) in fields.iter_mut().zip(moved.iter().zip(&bent)) {
            vertex.extend(m.iter().chain(b));
        }
        morphs.push(Morph {
            start: 0,
            position,
            normal,
        });
    }
    Ok(PageDeformation {
        skin,
        morphs,
        fields,
        soft_source: deformation.soft_source,
    })
}

fn skin_fields(
    joints: &[u32],
    weights: &[f32],
    original: &[u32],
    fields: &mut [Vec<u32>],
) -> Result<Skin> {
    let at = |v: u32| v as usize * INFLUENCES..(v as usize + 1) * INFLUENCES;
    let used = original.iter().flat_map(|&v| joints[at(v)].iter().copied());
    let (base, top) = used.fold((u32::MAX, 0), |(lo, hi), j| (lo.min(j), hi.max(j)));
    let bits = bits_for(top - base);
    if bits > MAX_JOINT_BITS || top > 0xffff {
        return Err(CompilerError::new(
            "PAGE_JOINT_RANGE",
            "A page names a joint past 65,535",
        ));
    }
    for (vertex, &v) in fields.iter_mut().zip(original) {
        let share: [f32; INFLUENCES] = weights[at(v)].try_into().expect("four weights");
        vertex.extend(joints[at(v)].iter().map(|j| j - base));
        vertex.extend(&quantize_weights(share)[..3]);
    }
    Ok(Skin { base, bits })
}

/// Writes the streams of `unique` vertices (their field rows), skin first, then each target,
/// and records the word each target's streams start at among the page's streams.
pub fn write(page: &mut PageDeformation, unique: &[&[u32]], out: &mut BitWriter) {
    let mut column = 0;
    let mut stream = |bits: u32, out: &mut BitWriter| {
        out.stream(unique.iter().map(|row| row[column]), bits);
        column += 1;
    };
    if let Some(skin) = page.skin {
        (0..INFLUENCES).for_each(|_| stream(skin.bits, out));
        (0..3).for_each(|_| stream(WEIGHT_BITS, out));
    }
    for morph in &mut page.morphs {
        morph.start = out.words().len();
        for bits in morph.bits() {
            stream(bits, out);
        }
    }
}

mod reach;
mod weights;
pub use weights::quantize_weights;
mod soft;
#[cfg(test)]
#[path = "geometry_page_deform_tests.rs"]
mod tests;
