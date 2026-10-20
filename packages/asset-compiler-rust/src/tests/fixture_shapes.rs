//! The shapes the fixtures are made of: a cube, a plain triangle and a displaced grid, each with
//! the document that declares it, and the portable sine and quad split the grids share.
use super::*;

pub(super) fn cube_fixture() -> (PathBuf, Options) {
    let mut bin = Vec::new();
    for value in [
        0f32, 0., 0., 1., 0., 0., 1., 1., 0., 0., 1., 0., 0., 0., 1., 1., 0., 1., 1., 1., 1., 0.,
        1., 1.,
    ] {
        bin.extend_from_slice(&value.to_le_bytes());
    }
    for value in [
        0u32, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1, 3, 2, 6, 3, 6, 7, 1, 5, 6, 1, 6,
        2, 0, 3, 7, 0, 7, 4,
    ] {
        bin.extend_from_slice(&value.to_le_bytes());
    }
    let gltf = json!({"asset":{"version":"2.0"},"buffers":[{"uri":"cube.bin","byteLength":bin.len()}],"bufferViews":[{"buffer":0,"byteOffset":0,"byteLength":96},{"buffer":0,"byteOffset":96,"byteLength":144}],"accessors":[{"bufferView":0,"componentType":5126,"type":"VEC3","count":8},{"bufferView":1,"componentType":5125,"type":"SCALAR","count":36}],"meshes":[{"primitives":[{"attributes":{"POSITION":0},"indices":1}]}],"nodes":[{"mesh":0}],"materials":[],"images":[]});
    gltf_fixture("cube", &gltf, &bin)
}

/// The binary of a plain triangle: its three positions, then its three indices.
pub(crate) fn triangle_bin() -> Vec<u8> {
    let mut bin = Vec::new();
    for value in [0f32, 0., 0., 1., 0., 0., 0., 1., 0.] {
        bin.extend_from_slice(&value.to_le_bytes());
    }
    for value in [0u32, 1, 2] {
        bin.extend_from_slice(&value.to_le_bytes());
    }
    bin
}

/// The document of `triangle_bin` in `buffer`: its two views and accessors, its one mesh, placed
/// by `nodes`.
pub(crate) fn triangle_gltf(buffer: Value, nodes: Value) -> Value {
    json!({
        "asset":{"version":"2.0"},
        "buffers":[buffer],
        "bufferViews":[
            {"buffer":0,"byteOffset":0,"byteLength":36},
            {"buffer":0,"byteOffset":36,"byteLength":12},
        ],
        "accessors":[
            {"bufferView":0,"componentType":5126,"type":"VEC3","count":3},
            {"bufferView":1,"componentType":5125,"type":"SCALAR","count":3},
        ],
        "meshes":[{"primitives":[{"attributes":{"POSITION":0},"indices":1}]}],
        "nodes":nodes,
    })
}

const HALF_PI: f32 = std::f32::consts::FRAC_PI_2;

/// A sine built from additions, multiplications and divisions only (Bhaskara's approximation), so
/// the fixture's vertices are bit-identical on every platform. `f32::sin` is not: each libm rounds
/// differently at the last bit, and a greedy DAG build turns that bit into a different root count.
pub(crate) fn portable_sin(t: f32) -> f32 {
    let tau = std::f32::consts::TAU;
    let x = t.rem_euclid(tau);
    let (x, sign) = if x > std::f32::consts::PI {
        (x - std::f32::consts::PI, -1.0)
    } else {
        (x, 1.0)
    };
    let a = x * (std::f32::consts::PI - x);
    sign * 16.0 * a / (5.0 * std::f32::consts::PI * std::f32::consts::PI - 4.0 * a)
}

/// Two triangles per quad of an `nx × ny` grid, corners named by `vertex(x, y)`: the one
/// quad split every grid fixture of the crate shares.
pub(crate) fn grid_indices(nx: usize, ny: usize, vertex: impl Fn(usize, usize) -> u32) -> Vec<u32> {
    let mut indices = Vec::with_capacity(nx * ny * 6);
    for y in 0..ny {
        for x in 0..nx {
            let (a, b, c, d) = (
                vertex(x, y),
                vertex(x + 1, y),
                vertex(x, y + 1),
                vertex(x + 1, y + 1),
            );
            indices.extend([a, b, c, b, d, c]);
        }
    }
    indices
}

pub(super) fn grid_fixture_displaced(nx: usize, ny: usize, amplitude: f32) -> (PathBuf, Options) {
    let mut positions = Vec::new();
    for y in 0..=ny {
        for x in 0..=nx {
            positions.extend([
                x as f32,
                y as f32,
                portable_sin(x as f32 * 0.31) * portable_sin(y as f32 * 0.27 + HALF_PI) * amplitude,
            ]);
        }
    }
    let indices = grid_indices(nx, ny, |x, y| (y * (nx + 1) + x) as u32);
    let mut bin = Vec::new();
    for value in &positions {
        bin.extend_from_slice(&value.to_le_bytes());
    }
    for value in &indices {
        bin.extend_from_slice(&value.to_le_bytes());
    }
    let pos_bytes = positions.len() * 4;
    let index_bytes = indices.len() * 4;
    let gltf = json!({"asset":{"version":"2.0"},"buffers":[{"uri":"grid.bin","byteLength":bin.len()}],"bufferViews":[{"buffer":0,"byteOffset":0,"byteLength":pos_bytes},{"buffer":0,"byteOffset":pos_bytes,"byteLength":index_bytes}],"accessors":[{"bufferView":0,"componentType":5126,"type":"VEC3","count":positions.len()/3},{"bufferView":1,"componentType":5125,"type":"SCALAR","count":indices.len()}],"meshes":[{"primitives":[{"attributes":{"POSITION":0},"indices":1}]}],"nodes":[{"mesh":0}],"materials":[],"images":[]});
    gltf_fixture("grid", &gltf, &bin)
}
