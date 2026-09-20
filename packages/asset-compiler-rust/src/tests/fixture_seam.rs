//! A textured, displaced sheet cut by a texture seam: the fixture of attribute-aware
//! simplification. The column at `nx / 2` is written twice, once per side, each copy carrying
//! its side's texture coordinate, so a coarse level can only keep the seam or cross it.
use super::*;

/// Texture coordinate of the left and right halves: the right half starts one whole texture
/// further, so any `u` in the open gap between the two ranges can only come from crossing.
pub(super) const SEAM_GAP: (f32, f32) = (0.5, 1.0);

/// Positions, unit normals, texture coordinates and indices of the sheet.
fn seam_sheet(nx: usize, ny: usize) -> (Vec<f32>, Vec<f32>, Vec<f32>, Vec<u32>) {
    let (mut positions, mut normals, mut uvs) = (Vec::new(), Vec::new(), Vec::new());
    let mut vertex = |x: usize, y: usize, right: bool| -> u32 {
        positions.extend([
            x as f32,
            y as f32,
            portable_sin(x as f32 * 0.31) * portable_sin(y as f32 * 0.27 + HALF_PI) * 3.0,
        ]);
        normals.extend([0.0, 0.0, 1.0]);
        let u = x as f32 / nx as f32 + if right { 1.0 } else { 0.0 };
        uvs.extend([u, y as f32 / ny as f32]);
        (positions.len() / 3 - 1) as u32
    };
    let half = nx / 2;
    // Column ranks: the seam column is emitted twice, the right copy after every left one.
    let left: Vec<Vec<u32>> = (0..=ny)
        .map(|y| (0..=nx).map(|x| vertex(x, y, x > half)).collect())
        .collect();
    let right_seam: Vec<u32> = (0..=ny).map(|y| vertex(half, y, true)).collect();
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
            let right = x >= half;
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

/// The seam sheet as a glTF fixture, compiled with `simplification`.
pub(super) fn seam_fixture(nx: usize, ny: usize, simplification: &str) -> (PathBuf, Options) {
    let (positions, normals, uvs, indices) = seam_sheet(nx, ny);
    let mut bin = Vec::new();
    let mut views = Vec::new();
    for column in [&positions, &normals, &uvs] {
        views.push(json!({"buffer":0,"byteOffset":bin.len(),"byteLength":column.len()*4}));
        bin.extend(column.iter().flat_map(|v| v.to_le_bytes()));
    }
    views.push(json!({"buffer":0,"byteOffset":bin.len(),"byteLength":indices.len()*4}));
    bin.extend(indices.iter().flat_map(|v| v.to_le_bytes()));
    let count = positions.len() / 3;
    let gltf = json!({"asset":{"version":"2.0"},"buffers":[{"uri":"seam.bin","byteLength":bin.len()}],"bufferViews":views,"accessors":[{"bufferView":0,"componentType":5126,"type":"VEC3","count":count},{"bufferView":1,"componentType":5126,"type":"VEC3","count":count},{"bufferView":2,"componentType":5126,"type":"VEC2","count":count},{"bufferView":3,"componentType":5125,"type":"SCALAR","count":indices.len()}],"meshes":[{"primitives":[{"attributes":{"POSITION":0,"NORMAL":1,"TEXCOORD_0":2},"indices":3}]}],"nodes":[{"mesh":0}],"materials":[],"images":[]});
    let (root, mut options) = gltf_fixture("seam", &gltf, &bin, indices.len() / 3);
    options.simplification = simplification.into();
    (root, options)
}
