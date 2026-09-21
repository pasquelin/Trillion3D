//! The sheets of attribute-aware simplification: a textured, displaced one cut by a texture
//! seam, and a flat one under a single chart. In the seam sheet the column at `nx / 2` is
//! written twice, once per side, each copy carrying its side's texture coordinate, so a coarse
//! level can only keep the seam or cross it.
use super::*;

/// Texture coordinate of the left and right halves: the right half starts one whole texture
/// further, so any `u` in the open gap between the two ranges can only come from crossing.
pub(super) const SEAM_GAP: (f32, f32) = (0.5, 1.0);

/// How the sheet is laid out: `Seam` displaces it and cuts it with a texture seam down the
/// middle column, carried by the named coordinate set; `Flat` is the same grid in one plane,
/// under one continuous chart, where the attribute solve has nothing to move.
#[derive(Clone, Copy, PartialEq)]
pub(super) enum Sheet {
    Seam(&'static str),
    Flat,
}

/// Positions, unit normals, texture coordinates and indices of the sheet.
pub(super) fn seam_sheet(
    nx: usize,
    ny: usize,
    flat: bool,
) -> (Vec<f32>, Vec<f32>, Vec<f32>, Vec<u32>) {
    let (mut positions, mut normals, mut uvs) = (Vec::new(), Vec::new(), Vec::new());
    let mut vertex = |x: usize, y: usize, right: bool| -> u32 {
        let z = if flat {
            0.0
        } else {
            portable_sin(x as f32 * 0.31) * portable_sin(y as f32 * 0.27 + HALF_PI) * 3.0
        };
        positions.extend([x as f32, y as f32, z]);
        normals.extend([0.0, 0.0, 1.0]);
        let u = x as f32 / nx as f32 + if right { 1.0 } else { 0.0 };
        uvs.extend([u, y as f32 / ny as f32]);
        (positions.len() / 3 - 1) as u32
    };
    let half = nx / 2;
    // Column ranks: the seam column is emitted twice, the right copy after every left one.
    let left: Vec<Vec<u32>> = (0..=ny)
        .map(|y| (0..=nx).map(|x| vertex(x, y, !flat && x > half)).collect())
        .collect();
    let right_seam: Vec<u32> = if flat {
        Vec::new()
    } else {
        (0..=ny).map(|y| vertex(half, y, true)).collect()
    };
    let corner = |x: usize, y: usize, right_of_seam: bool| {
        if x == half && right_of_seam {
            right_seam[y]
        } else {
            left[y][x]
        }
    };
    let mut indices = Vec::new();
    for y in 0..ny {
        for x in 0..nx {
            let right = !flat && x >= half;
            let (a, b, c, d) = (
                corner(x, y, right),
                corner(x + 1, y, right),
                corner(x, y + 1, right),
                corner(x + 1, y + 1, right),
            );
            indices.extend([a, b, c, b, d, c]);
        }
    }
    (positions, normals, uvs, indices)
}

/// The sheet as a glTF fixture, compiled with `simplification`. Under `Sheet::Seam` the named
/// set carries the seam and the other, when it is the first, is continuous across the column.
pub(super) fn seam_fixture(
    nx: usize,
    ny: usize,
    simplification: &str,
    sheet: Sheet,
) -> (PathBuf, Options) {
    let flat = sheet == Sheet::Flat;
    let (positions, normals, uvs, indices) = seam_sheet(nx, ny, flat);
    // The continuous set: the position's own plane, no gap anywhere.
    let chart: Vec<f32> = positions
        .as_chunks::<3>()
        .0
        .iter()
        .flat_map(|[x, y, _]| [x / nx as f32, y / ny as f32])
        .collect();
    let (set0, set1): (&[f32], Option<&[f32]>) = match sheet {
        Sheet::Seam("TEXCOORD_1") => (&chart, Some(&uvs)),
        Sheet::Seam(_) => (&uvs, None),
        Sheet::Flat => (&chart, None),
    };
    let mut bin = Vec::new();
    let mut views = Vec::new();
    let mut accessors = Vec::new();
    let mut attributes = serde_json::Map::new();
    let columns = [
        ("POSITION", &positions[..]),
        ("NORMAL", &normals[..]),
        ("TEXCOORD_0", set0),
    ]
    .into_iter()
    .chain(set1.map(|set| ("TEXCOORD_1", set)));
    for (name, column) in columns {
        views.push(json!({"buffer":0,"byteOffset":bin.len(),"byteLength":column.len()*4}));
        bin.extend(column.iter().flat_map(|v| v.to_le_bytes()));
        let kind = if name.starts_with("TEXCOORD") {
            "VEC2"
        } else {
            "VEC3"
        };
        attributes.insert(name.into(), json!(accessors.len()));
        accessors.push(json!({"bufferView":views.len()-1,"componentType":5126,"type":kind,"count":positions.len()/3}));
    }
    views.push(json!({"buffer":0,"byteOffset":bin.len(),"byteLength":indices.len()*4}));
    bin.extend(indices.iter().flat_map(|v| v.to_le_bytes()));
    accessors.push(json!({"bufferView":views.len()-1,"componentType":5125,"type":"SCALAR","count":indices.len()}));
    let gltf = json!({"asset":{"version":"2.0"},"buffers":[{"uri":"seam.bin","byteLength":bin.len()}],"bufferViews":views,"accessors":accessors,"meshes":[{"primitives":[{"attributes":attributes,"indices":accessors.len()-1}]}],"nodes":[{"mesh":0}],"materials":[],"images":[]});
    let (root, mut options) = gltf_fixture("seam", &gltf, &bin, indices.len() / 3);
    options.simplification = simplification.into();
    (root, options)
}
