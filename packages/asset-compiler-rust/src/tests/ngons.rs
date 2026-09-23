//! The audit's U polygon, and what each driver yields of it.
//!
//! A fan from the first corner fills the hollow of a concave polygon: its
//! triangles leave the face, and the sum of their areas exceeds the written area.
//! This U of area seven used to yield eleven in the four drivers that write their
//! own geometry. The measurement is therefore shared here, with the ring, so each
//! driver proves itself on the same polygon and the same area.
use super::*;

/// The U polygon: eight corners, area seven, a fan of eleven.
pub(crate) const U_RING: [[f64; 2]; 8] = [
    [0.0, 0.0],
    [3.0, 0.0],
    [3.0, 3.0],
    [2.0, 3.0],
    [2.0, 1.0],
    [1.0, 1.0],
    [1.0, 3.0],
    [0.0, 3.0],
];

/// Area of a triangle, by half the length of the cross product of two of its sides.
pub(crate) fn triangle_area(a: [f64; 3], b: [f64; 3], c: [f64; 3]) -> f64 {
    let edge = |x: [f64; 3], y: [f64; 3]| [y[0] - x[0], y[1] - x[1], y[2] - x[2]];
    let (u, v) = (edge(a, b), edge(a, c));
    let square: f64 = (0..3)
        .map(|axis| {
            let (p, q) = ((axis + 1) % 3, (axis + 2) % 3);
            (u[p] * v[q] - u[q] * v[p]).powi(2)
        })
        .sum();
    square.sqrt() / 2.0
}

/// Rendered area of a mesh: the sum of the areas, taken in absolute value, of its
/// triangles. A triangle that left the polygon adds its own instead of merging,
/// and that is what shows.
pub(crate) fn rendered_area(positions: &[f32], indices: &[u32]) -> f64 {
    let point = |rank: u32| {
        let at = rank as usize * 3;
        [
            f64::from(positions[at]),
            f64::from(positions[at + 1]),
            f64::from(positions[at + 2]),
        ]
    };
    indices
        .as_chunks::<3>()
        .0
        .iter()
        .map(|face| triangle_area(point(face[0]), point(face[1]), point(face[2])))
        .sum()
}

/// Rendered area of a cut given as ranks of a ring.
pub(crate) fn cut_area(ring: &[[f64; 3]], triangles: &[[usize; 3]]) -> f64 {
    triangles
        .iter()
        .map(|[a, b, c]| triangle_area(ring[*a], ring[*b], ring[*c]))
        .sum()
}

/// Bytes of an accessor in the scene binary, with its component type.
fn accessor<'a>(gltf: &Value, bin: &'a [u8], rank: usize) -> (&'a [u8], u64) {
    let accessor = &gltf["accessors"][rank];
    let rank = accessor["bufferView"].as_u64().expect("buffer view") as usize;
    let view = &gltf["bufferViews"][rank];
    let from = view["byteOffset"].as_u64().unwrap_or(0) as usize;
    let length = view["byteLength"].as_u64().expect("length") as usize;
    (
        &bin[from..from + length],
        accessor["componentType"].as_u64().expect("component type"),
    )
}

/// Rendered area of the first primitive of the first mesh a driver wrote in the cache.
fn prepared_area(run: &GoldenRun, plugin: &str) -> f64 {
    let (_, gltf) = run.prepared(plugin);
    let bin = fs::read(run.prepared_dir(plugin).join("model.bin")).expect("model.bin");
    let primitive = &gltf["meshes"][0]["primitives"][0];
    let rank = |value: &Value| value.as_u64().expect("accessor") as usize;
    let (bytes, _) = accessor(&gltf, &bin, rank(&primitive["attributes"]["POSITION"]));
    let positions: Vec<f32> = bytes
        .as_chunks::<4>()
        .0
        .iter()
        .map(|word| f32::from_le_bytes(*word))
        .collect();
    let (bytes, component) = accessor(&gltf, &bin, rank(&primitive["indices"]));
    let width = if component == 5125 { 4 } else { 2 };
    let indices: Vec<u32> = bytes
        .chunks_exact(width)
        .map(|word| match width {
            4 => u32::from_le_bytes(word.try_into().expect("index")),
            _ => u32::from(u16::from_le_bytes(word.try_into().expect("index"))),
        })
        .collect();
    rendered_area(&positions, &indices)
}

/// Corners of the U, written as text: each corner between `open` and `close`, its
/// three numbers separated by `inner`, and the corners separated by `outer`.
fn corners(inner: &str, outer: &str, open: &str, close: &str) -> String {
    U_RING
        .iter()
        .map(|[x, y]| format!("{open}{x}{inner}{y}{inner}0{close}"))
        .collect::<Vec<String>>()
        .join(outer)
}

// Behaviour: the `ma` driver yields the area of the polygon it reads. The U of
// area seven used to come out as eleven, the fan from its first corner crossing
// the hollow; it now comes out as seven.
#[test]
fn the_ma_driver_keeps_the_area_of_a_concave_polygon() {
    let edges: String = (0..8)
        .map(|edge| format!("{edge} {} 0", (edge + 1) % 8))
        .collect::<Vec<String>>()
        .join("  ");
    let scene = format!(
        "//Maya ASCII 2024 scene\n\
         //Fixture written by hand from the public documentation of MEL commands: CC0-1.0.\n\
         requires maya \"2024\";\n\
         currentUnit -l centimeter -a degree -t film;\n\
         createNode transform -n \"U\";\n\
         createNode mesh -n \"UShape\" -p \"U\";\n\
         \tsetAttr -s 8 \".vt[0:7]\" -type \"float3\" {};\n\
         \tsetAttr -s 8 \".ed[0:7]\" {edges};\n\
         \tsetAttr -s 1 \".fc[0:0]\" -type \"polyFaces\"\n\
         \t\tf 8 0 1 2 3 4 5 6 7;\n",
        corners(" ", "  ", "", "")
    );
    let dir = scratch("ma", "ngone");
    let source = dir.join("u.ma");
    fs::write(&source, scene).expect("scene");
    let run = compile_golden_source(&source, "ma-ngone");
    let area = prepared_area(&run, "ma");
    fs::remove_dir_all(&dir).ok();
    assert!(
        (area - 7.0).abs() < 1e-5,
        "rendered area {area}, expected 7"
    );
}

// Behaviour: the `usd` driver does the same. The same U, written as a `.usda` layer, comes out as seven.
#[test]
fn the_usd_driver_keeps_the_area_of_a_concave_polygon() {
    let mesh = format!(
        "    def Mesh \"U\"\n    {{\n\
         \x20       int[] faceVertexCounts = [8]\n\
         \x20       int[] faceVertexIndices = [0, 1, 2, 3, 4, 5, 6, 7]\n\
         \x20       point3f[] points = [{}]\n\
         \x20       uniform token subdivisionScheme = \"none\"\n    }}\n",
        corners(", ", ", ", "(", ")")
    );
    let run = crate::tests::formats::usd::driver::compile_layer(
        "ngone",
        &crate::tests::formats::usd::driver::wrap("", &mesh),
    );
    let area = prepared_area(&run, "usd");
    assert!(
        (area - 7.0).abs() < 1e-5,
        "rendered area {area}, expected 7"
    );
}
