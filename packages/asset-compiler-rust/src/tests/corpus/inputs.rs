//! How the document encodes the same surface: index widths, sparse and quantized accessors,
//! and where in space and at what scale it sits.
use super::shapes::Sheet;
use super::*;

fn sheet(seed: u64, name: &'static str, nx: usize, ny: usize) -> Case {
    let mut rng = seeded(seed);
    let amplitude = shapes::amplitude(&mut rng);
    let sheet = Sheet::new(&mut rng, nx, ny, amplitude);
    Case::new(name, sheet.positions, sheet.indices)
}

/// Fewer than 256 vertices: the narrowest index accessor.
fn indices_u8(seed: u64) -> Case {
    let mut case = sheet(seed, "inputs-indices-u8", 14, 14);
    case.index_kind = Indices::U8;
    case
}

fn indices_u16(seed: u64) -> Case {
    let mut case = sheet(seed, "inputs-indices-u16", 64, 64);
    case.index_kind = Indices::U16;
    case
}

fn indices_u32(seed: u64) -> Case {
    sheet(seed, "inputs-indices-u32", 96, 96)
}

/// No index accessor: three positions per triangle, in triangle order.
fn unindexed(seed: u64) -> Case {
    let source = sheet(seed, "inputs-unindexed", 64, 64);
    let positions: Vec<f32> = source
        .indices
        .iter()
        .flat_map(|&v| {
            [
                source.positions[v as usize * 3],
                source.positions[v as usize * 3 + 1],
                source.positions[v as usize * 3 + 2],
            ]
        })
        .collect();
    let corners = (0..(positions.len() / 3) as u32).collect();
    let mut case = Case::new("inputs-unindexed", positions, corners);
    case.index_kind = Indices::Unindexed;
    case
}

/// `POSITION` as a sparse accessor: a base with every fourth vertex missing, restored sparsely.
fn sparse_positions(seed: u64) -> Case {
    let mut case = sheet(seed, "inputs-sparse-positions", 64, 64);
    case.sparse_positions = true;
    case
}

/// `POSITION` as normalised `SHORT` under `KHR_mesh_quantization`: the values the accessor
/// decodes to are what the case holds, in `[-1, 1]`.
fn quantized_positions(seed: u64) -> Case {
    let mut case = sheet(seed, "inputs-quantized-positions", 64, 64);
    let extent = case.positions.iter().fold(0f32, |m, v| m.max(v.abs()));
    for value in &mut case.positions {
        *value = (*value / extent * 32767.0).round() / 32767.0;
    }
    case.quantized_positions = true;
    case
}

/// The sheet a million units from the origin: single precision keeps sixteen units of a
/// vertex spacing of one.
fn large_offset(seed: u64) -> Case {
    let mut case = sheet(seed, "inputs-large-offset", 64, 64);
    for value in &mut case.positions {
        *value += 1.0e6;
    }
    case
}

fn scaled(seed: u64, name: &'static str, scale: f32) -> Case {
    let mut case = sheet(seed, name, 64, 64);
    for value in &mut case.positions {
        *value *= scale;
    }
    case
}

/// A sixty-four millimetre object, in metres.
fn millimetre_scale(seed: u64) -> Case {
    scaled(seed, "inputs-millimetre-scale", 1.0e-3)
}

/// A sixty-four kilometre terrain, in metres.
fn kilometre_scale(seed: u64) -> Case {
    scaled(seed, "inputs-kilometre-scale", 1.0e3)
}

pub(super) fn cases() -> Vec<(Generator, Expect)> {
    vec![
        (indices_u8, Expect::ONE_ROOT),
        (indices_u16, Expect::ONE_ROOT),
        (indices_u32, Expect::ONE_ROOT),
        (unindexed, Expect::ONE_ROOT),
        (sparse_positions, Expect::ONE_ROOT),
        (quantized_positions, Expect::refused("INVALID_GLTF")),
        (large_offset, Expect::ONE_ROOT),
        (millimetre_scale, Expect::ONE_ROOT),
        (kilometre_scale, Expect::ONE_ROOT),
    ]
}
