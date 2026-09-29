//! The root's lists (#575): the rows a view holds, bound by the view and not by the world, and the
//! core parents under each page. Each is checked against the cell files themselves, counted here
//! apart from the cook's own fold (`partition/pages/rows.rs`).
//!
//! Provenance: the compiled worlds of `partition_pages.rs`; a synthetic lattice of cells at one and
//! at sixteen times its area, which no compile needs.
use super::*;
use crate::compiler_tables::partition::pages::*;

/// The integer of hexadecimal digits `from..to` of `text`.
fn digits(text: &str, from: usize, to: usize) -> u64 {
    u64::from_str_radix(&text[from..to], 16).expect("hex")
}

/// Per mesh listed by `root`: its rank, its total and its rows at each rung.
fn listed(root: &Value) -> Vec<(u64, u64, Vec<u64>)> {
    let meshes = root["meshes"].as_array().expect("meshes").iter();
    let entry = |mesh: &Value| {
        let text = mesh.as_str().expect("hex");
        assert_eq!(text.len(), 16 + 8 * RUNGS, "fixed width");
        let rungs = (0..RUNGS).map(|k| digits(text, 16 + 8 * k, 24 + 8 * k));
        (digits(text, 0, 8), digits(text, 8, 16), rungs.collect())
    };
    meshes.map(entry).collect()
}

/// The nodes of each cell file a record names, as that file lists them.
fn nodes(directory: &Path, record: &Value) -> Vec<Value> {
    let file = read_json(&directory.join(record["url"].as_str().expect("url")));
    file["nodes"].as_array().expect("nodes").clone()
}

/// Whether two boxes meet.
fn meet(a: &[f64], b: &[f64]) -> bool {
    (0..3).all(|axis| a[axis] <= b[axis + 3] && b[axis] <= a[axis + 3])
}

/// The root of the compiled world in `directory`, against its cell files: every node counted per
/// mesh; the parents of the nodes under each slot; and, for the first rungs, the nodes of the cells
/// whose box meets a cube of that side around any cell never past the rows listed.
pub(super) fn assert_root(directory: &Path, root: &Value) {
    let records = read_records(directory, root).expect("records");
    let files: Vec<Vec<Value>> = records.iter().map(|r| nodes(directory, r)).collect();
    let mut totals = BTreeMap::<u64, u64>::new();
    for node in files.iter().flatten() {
        *totals
            .entry(node["mesh"].as_u64().expect("mesh"))
            .or_default() += 1;
    }
    let meshes = listed(root);
    let counted: Vec<(u64, u64)> = meshes.iter().map(|(m, n, _)| (*m, *n)).collect();
    assert_eq!(
        counted,
        totals.into_iter().collect::<Vec<_>>(),
        "every node"
    );
    for (slot, beside) in root["pages"]
        .as_array()
        .expect("slots")
        .iter()
        .zip(root["parents"].as_array().expect("parents"))
    {
        let mut pages = Vec::new();
        read_leaves(&CELL_PAGES, directory, &json!([slot]), "root", &mut pages).expect("pages");
        let under = pages
            .iter()
            .flat_map(|page| page["cells"].as_array().expect("cells"));
        let ranks: BTreeSet<u64> = under
            .flat_map(|record| nodes(directory, record))
            .filter_map(|node| node["parent"].as_u64())
            .collect();
        let expected: String = ranks.iter().map(|rank| format!("{rank:08x}")).collect();
        assert_eq!(beside, &json!(expected), "the parents under a slot");
    }
    let cube = f64::from_bits(digits(root["cube"].as_str().expect("cube"), 0, 16));
    for rung in 0..3 {
        let half = rung_side(cube, rung) / 2.0;
        for record in &records {
            let [_, bounds] = &record["parents"][0].as_array().expect("part")[..] else {
                panic!("a part")
            };
            let b: Vec<f64> = bounds
                .as_array()
                .expect("box")
                .iter()
                .filter_map(Value::as_f64)
                .collect();
            let centre = |axis: usize| (b[axis] + b[axis + 3]) / 2.0;
            let cube: Vec<f64> = (0..6)
                .map(|at| centre(at % 3) + if at < 3 { -half } else { half })
                .collect();
            let mut held = BTreeMap::<u64, u64>::new();
            for (other, nodes) in records.iter().zip(&files) {
                let parts = other["parents"].as_array().expect("parents").iter();
                let boxes = parts.map(|p| {
                    p[1].as_array()
                        .expect("box")
                        .iter()
                        .filter_map(Value::as_f64)
                        .collect::<Vec<_>>()
                });
                if boxes.into_iter().any(|other| meet(&other, &cube)) {
                    for node in nodes {
                        *held
                            .entry(node["mesh"].as_u64().expect("mesh"))
                            .or_default() += 1;
                    }
                }
            }
            for (mesh, _, rows) in &meshes {
                let near = held.get(mesh).copied().unwrap_or_default();
                assert!(
                    near <= rows[rung],
                    "{near} nodes near, {} rows at rung {rung}",
                    rows[rung]
                );
            }
        }
    }
    for (_, total, rows) in &meshes {
        assert!(
            rows.windows(2).all(|pair| pair[0] <= pair[1]),
            "wider holds more"
        );
        assert_eq!(rows[RUNGS - 1], *total, "the widest cube holds every node");
    }
}

/// A lattice of `side` × `side` cells, 10 m apart and each a 10 m square placing four nodes of
/// mesh 0 under the scene, as the cook records them.
fn lattice(side: usize) -> Vec<Value> {
    let cell = |at: usize| {
        let (x, z) = ((at % side) as f64 * 10.0, (at / side) as f64 * 10.0);
        json!({"parents": [[null, [x, 0.0, z, x + 10.0, 1.0, z + 10.0]]], "meshes": [[0, 4]]})
    };
    (0..side * side).map(cell).collect()
}

#[test]
fn the_rows_a_view_holds_are_the_same_at_one_and_sixteen_times_the_world() {
    let (small, large) = (view_rows(&lattice(16)), view_rows(&lattice(64)));
    assert_eq!(small.0, large.0, "the same widest cell");
    let rows = |(cube, meshes): &(String, Vec<String>)| {
        listed(&json!({"meshes": meshes, "cube": cube}))[0].clone()
    };
    let ((_, small_total, small_rows), (_, large_total, large_rows)) = (rows(&small), rows(&large));
    assert_eq!([small_total, large_total], [16 * 16 * 4, 64 * 64 * 4]);
    // A window of the rung narrower than the small world: the same rows, a part of either world.
    let cube = f64::from_bits(digits(&small.0, 0, 16));
    let within = (0..RUNGS).filter(|&rung| 1.5 * rung_side(cube, rung) < 160.0);
    for rung in within {
        assert_eq!(small_rows[rung], large_rows[rung], "rung {rung}");
        assert!(
            small_rows[rung] < small_total,
            "rung {rung} holds a part of the world"
        );
    }
    assert_eq!(large_rows[RUNGS - 1], large_total);
}
