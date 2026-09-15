//! Le polygone en U de l'audit, et ce que chaque pilote en rend.
//!
//! Un éventail depuis le premier coin remplit le creux d'un polygone concave : ses triangles sortent
//! de la face, et la somme de leurs aires dépasse l'aire écrite. Ce U d'aire sept en rendait onze
//! dans les quatre pilotes qui écrivent eux-mêmes leur géométrie. La mesure est donc partagée ici,
//! avec l'anneau, pour que chaque pilote se prouve sur le même polygone et la même aire.
use super::*;

/// Le polygone en U : huit coins, aire sept, un éventail à onze.
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

/// L'aire d'un triangle, par la moitié de la longueur du produit vectoriel de deux de ses côtés.
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

/// L'aire rendue d'un maillage : la somme des aires, prises en valeur absolue, de ses triangles.
/// Un triangle sorti du polygone ajoute la sienne au lieu de s'y fondre, et c'est ce qui se voit.
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

/// L'aire rendue d'un découpage donné en rangs d'un anneau.
pub(crate) fn cut_area(ring: &[[f64; 3]], triangles: &[[usize; 3]]) -> f64 {
    triangles
        .iter()
        .map(|[a, b, c]| triangle_area(ring[*a], ring[*b], ring[*c]))
        .sum()
}

/// Les octets d'un accesseur dans le binaire de la scène, avec son type de composant.
fn accessor<'a>(gltf: &Value, bin: &'a [u8], rank: usize) -> (&'a [u8], u64) {
    let accessor = &gltf["accessors"][rank];
    let rank = accessor["bufferView"].as_u64().expect("vue de tampon") as usize;
    let view = &gltf["bufferViews"][rank];
    let from = view["byteOffset"].as_u64().unwrap_or(0) as usize;
    let length = view["byteLength"].as_u64().expect("longueur") as usize;
    (
        &bin[from..from + length],
        accessor["componentType"]
            .as_u64()
            .expect("type de composant"),
    )
}

/// L'aire rendue de la première primitive du premier maillage qu'un pilote a écrit dans le cache.
fn prepared_area(run: &GoldenRun, plugin: &str) -> f64 {
    let (_, gltf) = run.prepared(plugin);
    let bin = fs::read(run.prepared_dir(plugin).join("model.bin")).expect("model.bin");
    let primitive = &gltf["meshes"][0]["primitives"][0];
    let rank = |value: &Value| value.as_u64().expect("accesseur") as usize;
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
            4 => u32::from_le_bytes(word.try_into().expect("indice")),
            _ => u32::from(u16::from_le_bytes(word.try_into().expect("indice"))),
        })
        .collect();
    rendered_area(&positions, &indices)
}

/// Les coins du U, écrits en texte : chaque coin entre `open` et `close`, ses trois nombres
/// séparés par `inner`, et les coins séparés par `outer`.
fn corners(inner: &str, outer: &str, open: &str, close: &str) -> String {
    U_RING
        .iter()
        .map(|[x, y]| format!("{open}{x}{inner}{y}{inner}0{close}"))
        .collect::<Vec<String>>()
        .join(outer)
}

// Comportement : le pilote `ma` rend l'aire du polygone qu'il lit. Le U d'aire sept sortait à onze,
// l'éventail depuis son premier coin traversant le creux ; il sort maintenant à sept.
#[test]
fn the_ma_driver_keeps_the_area_of_a_concave_polygon() {
    let edges: String = (0..8)
        .map(|edge| format!("{edge} {} 0", (edge + 1) % 8))
        .collect::<Vec<String>>()
        .join("  ");
    let scene = format!(
        "//Maya ASCII 2024 scene\n\
         //Fixture écrite à la main depuis la documentation publique des commandes MEL : CC0-1.0.\n\
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
    let dir = std::env::temp_dir().join(format!("wg-ma-ngone-{}", std::process::id()));
    fs::create_dir_all(&dir).expect("dossier");
    let source = dir.join("u.ma");
    fs::write(&source, scene).expect("scène");
    let run = compile_golden_source(&source, "ma-ngone");
    let area = prepared_area(&run, "ma");
    fs::remove_dir_all(&dir).ok();
    assert!((area - 7.0).abs() < 1e-5, "aire rendue {area}, attendue 7");
}

// Comportement : le pilote `usd` en fait autant. Le même U, écrit en couche `.usda`, sort à sept.
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
    let run = usd_driver::compile_layer("ngone", &usd_driver::wrap("", &mesh));
    let area = prepared_area(&run, "usd");
    assert!((area - 7.0).abs() < 1e-5, "aire rendue {area}, attendue 7");
}
