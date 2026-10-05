//! What a page carries for the GPU deformation stage (#357): every vertex's joints and
//! weights, and each morph target's position and normal displacement — the streams, records and
//! bounds of the shared codec (`trillion3d_page_codec::deform`), written from the primitive's
//! `JOINTS_n`, `WEIGHTS_n` and `targets`.
use crate::geometry_page_cells::Cell;
use crate::shared_math::WordMap;
use crate::{CompilerError, Result};
use trillion3d_page_codec::deform::{Morph, Skin, MAX_MORPH_TARGETS, RAW_F32, WEIGHT_BITS};
use trillion3d_page_codec::writer::BitWriter;
use trillion3d_page_codec::{FLAG_MORPH, FLAG_SKIN, FLAG_SOFT_SOURCE};
/// One morph target of a primitive: its position displacement per vertex, three floats each, and
/// its normal displacement when it declares one.
pub struct MorphTarget {
    pub position: Vec<f32>,
    pub normal: Option<Vec<f32>>,
}
/// The deformation a primitive declares: its skin — all joints and weights per vertex —
/// and its morph targets, each over every vertex of the primitive.
#[derive(Default)]
pub struct Deformation {
    pub skin: Option<(Vec<u32>, Vec<f32>)>,
    pub influences: usize,
    pub targets: Vec<MorphTarget>,
    /// The soft body kind the node declares (`cloth`, `rope`, `volume`) when the index stream
    /// names its welded simulation vertices instead of bone joints.
    pub soft_source: Option<&'static str>,
}
/// A page's deformation: its records, and per local vertex the fields its streams hold — all
/// joint offsets and float32 weights, then six displacement cells per target.
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
            (Some((joints, _)), _) => joints.len() / self.influences,
            (None, Some(target)) => target.position.len() / 3,
            (None, None) => 0,
        }
    }
}

impl PageDeformation {
    /// The presence bits it adds to the page's flags.
    pub fn flags(&self) -> u32 {
        let skin = if self.skin.is_some() { FLAG_SKIN } else { 0 };
        let morph = if self.morphs.is_empty() {
            0
        } else {
            FLAG_MORPH
        };
        let source = if self.soft_source {
            FLAG_SOFT_SOURCE
        } else {
            0
        };
        source | skin | morph
    }
}

/// Each vertex's cells with the rank of its deformation fields among the distinct rows, and
/// those rows by rank: two vertices then merge only when they also deform alike.
pub fn join(cells: Vec<Cell>, fields: &[Vec<u32>]) -> (Vec<Cell>, Vec<&[u32]>) {
    let mut ranks = WordMap::<&[u32], u32>::default();
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
/// joints on the page's own base and width, weights and displacements as exact float32. A
/// rank past the source's is a vertex a solved reduction placed: it deforms as its `origin`.
pub fn page_deformation(
    deformation: &Deformation,
    original: &[u32],
    origin: &[u32],
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
        Some((joints, weights)) => Some(skin_fields(
            joints,
            weights,
            deformation.influences,
            original,
            &mut fields,
        )?),
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
        let moved = gather(&target.position);
        let bent = target.normal.as_ref().map(|values| gather(values));
        for (v, vertex) in fields.iter_mut().enumerate() {
            vertex.extend(moved[v * 3..v * 3 + 3].iter().map(|x| x.to_bits()));
            vertex.extend((0..3).map(|c| bent.as_ref().map_or(0, |b| b[v * 3 + c].to_bits())));
        }
        morphs.push(Morph {
            start: 0,
            position: RAW_F32,
            normal: RAW_F32,
        });
    }
    Ok(PageDeformation {
        skin,
        morphs,
        fields,
        soft_source: deformation.soft_source.is_some(),
    })
}

mod skin;
use skin::skin_fields;

/// Writes the streams of `unique` vertices (their field rows), skin first, then each target,
/// and records the word each target's streams start at among the page's streams.
pub fn write(page: &mut PageDeformation, unique: &[&[u32]], out: &mut BitWriter) {
    let mut column = 0;
    let mut stream = |bits: u32, out: &mut BitWriter| {
        out.stream(unique.iter().map(|row| row[column]), bits);
        column += 1;
    };
    if let Some(skin) = page.skin {
        (0..skin.influences).for_each(|_| stream(skin.bits, out));
        (0..skin.influences).for_each(|_| stream(WEIGHT_BITS, out));
    }
    for morph in &mut page.morphs {
        morph.start = out.words().len();
        for bits in morph.bits() {
            stream(bits, out);
        }
    }
}

mod reach;
mod soft;
#[cfg(test)]
#[path = "geometry_page_deform_tests.rs"]
mod tests;
