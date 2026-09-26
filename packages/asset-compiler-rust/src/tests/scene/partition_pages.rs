//! The paged cell index (#750): the cells' records lie in pages beside the tables, whose root has
//! the same bytes whatever the world, and a reused folder proves its cells through those pages.
//!
//! Provenance: the grids of `partition.rs`; the committed open-world cell
//! (`tests/fixtures/openworld-cell`) laid eight by eight, 250 m apart; a synthetic halving tree for
//! the index pages, which a cooked world reaches only past eight pages of records.
use super::partition::{cells, compiled, grid};
use super::*;
use crate::compiler_tables::{read_records, write_pages, Region, FAN_OUT, PAGE_BYTES};
use crate::tests::cache::reuse::compile_with_events;

/// Every page file in `directory`: its size and its body.
fn pages(directory: &Path) -> Vec<(usize, Value)> {
    let files = fs::read_dir(directory)
        .expect("folder")
        .map(|e| e.expect("entry").path());
    let pages = files.filter(|path| path.to_string_lossy().contains("scene-page-"));
    let read = |path| fs::read(path).expect("page");
    pages
        .map(read)
        .map(|b| (b.len(), serde_json::from_slice(&b).expect("json")))
        .collect()
}

/// The committed open-world cell laid `side` by `side`, compiled at full scope.
fn open_world(side: usize) -> (Options, Value, PathBuf) {
    let folder = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures/openworld-cell");
    let mut document = read_json(&folder.join("cell.gltf"));
    let cell = document["nodes"].as_array().expect("nodes").clone();
    let mut nodes = Vec::new();
    for at in 0..side * side {
        for mut node in cell.iter().cloned() {
            let moved = |axis: usize, by: usize| {
                node["translation"][axis].as_f64().expect("t") + 250.0 * by as f64
            };
            (node["translation"][0], node["translation"][2]) =
                (json!(moved(0, at % side)), json!(moved(2, at / side)));
            nodes.push(node);
        }
    }
    document["scenes"] = json!([{"nodes": (0..nodes.len()).collect::<Vec<_>>()}]);
    document["nodes"] = json!(nodes);
    let bin = fs::read(folder.join("cell.bin")).expect("bin");
    let (_root, mut options) = gltf_fixture("cell", &document, &bin);
    (options.scope, options.simplification) = ("full".into(), "none".into());
    let result = compile(&options, |_| {}).expect("compile");
    let directory = options.key_directory(result["key"].as_str().expect("key"));
    let tables = read_json(&directory.join("scene-tables.json"));
    (options, tables, directory)
}

#[test]
fn the_root_has_one_size_whatever_the_world_and_every_page_its_limit() {
    let worlds = [
        compiled(grid(48, 4.0, 1.0), true),
        compiled(grid(192, 4.0, 1.0), true),
        open_world(8),
    ];
    let size = |value: &Value| serde_json::to_vec(value).expect("json").len();
    let root = size(&worlds[0].1["partition"]);
    for (options, tables, directory) in &worlds {
        assert_eq!(size(&tables["partition"]), root, "the root's bytes");
        let largest = pages(directory).into_iter().map(|(bytes, _)| bytes).max();
        assert!(largest <= Some(PAGE_BYTES), "{largest:?} bytes");
        let files = fs::read_dir(directory)
            .expect("folder")
            .map(|e| e.expect("entry").file_name());
        let files = files.filter(|name| name.to_string_lossy().starts_with("scene-cell-"));
        assert_eq!(cells(directory).len(), files.count(), "every cell, once");
        fs::remove_dir_all(options.source.parent().expect("root")).expect("cleanup");
    }
    // Sixteen times the area at the same density: the whole tables keep their bytes.
    let (small, large) = (size(&worlds[0].1), size(&worlds[1].1));
    assert_eq!(small, large, "the core does not grow with the world");
}

/// The halving of `cells` in two down to single cells: the shape `split.rs` records.
fn halving(cells: std::ops::Range<usize>) -> Region {
    let middle = cells.start + cells.len() / 2;
    let halves = (cells.len() > 1)
        .then(|| Box::new([halving(cells.start..middle), halving(middle..cells.end)]));
    Region { cells, halves }
}

#[test]
fn index_pages_list_at_most_the_fan_out_and_give_every_record_back_in_order() {
    let directory = scratch("pages", "index");
    let record = |at| json!({"url": format!("scene-cell-{at}.json"), "sha256": "0".repeat(64), "bytes": at, "parents": [], "meshes": [[0, 1]]});
    let records: Vec<Value> = (0..300).map(record).collect();
    let bounds = vec![[0.0, 0.0, 0.0, 1.0, 1.0, 1.0]; records.len()];
    let root = write_pages(&halving(0..300), &records, &bounds, &directory, 2048).expect("pages");
    let written = pages(&directory);
    let index = written.iter().filter(|(_, page)| page["pages"].is_array());
    assert!(index.count() > 0, "index pages are written");
    for (bytes, page) in &written {
        match page["pages"].as_array() {
            Some(slots) => assert!(slots.len() <= FAN_OUT),
            None => assert!(*bytes <= 2048, "a region page of {bytes} bytes"),
        }
    }
    let mut read = Vec::new();
    read_records(&directory, &root, "the root", &mut read).expect("records");
    assert_eq!(read, records, "every record, in cell order");
    fs::remove_dir_all(directory).expect("cleanup");
}

#[test]
fn a_reused_folder_proves_its_cells_through_the_pages() {
    let (options, tables, directory) = compiled(grid(48, 4.0, 1.0), false);
    let (_, events) = compile_with_events(&options);
    assert_eq!(events[0]["completed"], 1, "reused whole");
    let slot = tables["partition"]["pages"][0].as_str().expect("slot");
    let page = format!("scene-page-{}.json", &slot[..64]);
    let old = serde_json::to_vec(&json!({"version": 3})).expect("json");
    for (name, bytes, reason) in [
        ("scene-cell-0.json", &b"{}"[..], "scene-cell-0.json"),
        (page.as_str(), b"{}", "is not the page its slot names"),
        ("scene-tables.json", &old, "scene tables are not version 4"),
    ] {
        let intact = fs::read(directory.join(name)).expect("product");
        fs::write(directory.join(name), bytes).expect("corrupt");
        let (second, events) = compile_with_events(&options);
        assert!(second["reused"].is_null(), "{reason}: not reused");
        let announced = events[0]["reason"].as_str().expect("reason");
        assert!(announced.contains(reason), "{reason}: {announced}");
        let rebuilt = fs::read(directory.join(name)).expect("rebuilt");
        assert_eq!(rebuilt, intact, "{reason}");
    }
    fs::remove_dir_all(options.source.parent().expect("root")).expect("cleanup");
}
