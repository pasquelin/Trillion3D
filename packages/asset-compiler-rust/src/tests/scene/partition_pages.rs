//! The paged cell index (#750): the cells' records lie in pages beside the tables, which keep a
//! root of fixed size — the same bytes whatever the world — and a reused folder proves its cells
//! through those pages.
//!
//! Provenance: the synthetic grids of `partition.rs`, and the committed open-world cell
//! (`tests/fixtures/openworld-cell`) laid eight by eight, 250 m apart, as the open world lays its
//! cells; a synthetic halving tree for the index pages, which a cooked world reaches only past
//! eight pages of records.
use super::partition::{cells, compiled, grid};
use super::*;
use crate::compiler_tables::{read_records, write_pages, Region, FAN_OUT, PAGE_BYTES, SLOT_WIDTH};
use crate::tests::cache::reuse::compile_with_events;

/// Every page file in `directory`, parsed, with its size.
fn pages(directory: &Path) -> Vec<(usize, Value)> {
    let names = fs::read_dir(directory)
        .expect("folder")
        .map(|e| e.expect("entry").path());
    let pages = names.filter(|path| path.to_string_lossy().contains("scene-page-"));
    pages
        .map(|path| {
            let bytes = fs::read(path).expect("page");
            (bytes.len(), serde_json::from_slice(&bytes).expect("json"))
        })
        .collect()
}

/// The committed open-world cell laid `side` by `side`, compiled at full scope: its options, its
/// tables and its folder.
fn open_world(side: usize) -> (Options, Value, PathBuf) {
    let folder = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures/openworld-cell");
    let mut document = read_json(&folder.join("cell.gltf"));
    let cell = document["nodes"].as_array().expect("nodes").clone();
    let mut nodes = Vec::new();
    for at in 0..side * side {
        for node in &cell {
            let mut node = node.clone();
            node["translation"][0] =
                json!(node["translation"][0].as_f64().expect("x") + 250.0 * (at % side) as f64);
            node["translation"][2] =
                json!(node["translation"][2].as_f64().expect("z") + 250.0 * (at / side) as f64);
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

/// Removes the scratch folder a compiled world was written in.
fn clean(options: &Options) {
    fs::remove_dir_all(options.source.parent().expect("root")).expect("cleanup");
}

#[test]
fn the_root_has_one_size_whatever_the_world_and_every_page_its_limit() {
    let worlds = [
        compiled(grid(48, 4.0, 1.0), true),
        compiled(grid(48 * 4, 4.0, 1.0), true),
        open_world(8),
    ];
    let root = |tables: &Value| {
        serde_json::to_vec(&tables["partition"])
            .expect("json")
            .len()
    };
    for (_, tables, directory) in &worlds {
        assert_eq!(root(tables), root(&worlds[0].1), "the root's bytes");
        let slots = tables["partition"]["pages"].as_array().expect("slots");
        assert_eq!(slots.len(), FAN_OUT);
        assert!(slots
            .iter()
            .all(|slot| slot.as_str().expect("slot").len() == SLOT_WIDTH));
        for (bytes, page) in pages(directory) {
            assert!(bytes <= PAGE_BYTES, "a page of {bytes} bytes");
            assert!(page["pages"]
                .as_array()
                .is_none_or(|slots| slots.len() <= FAN_OUT));
        }
        let files = fs::read_dir(directory).expect("folder").filter(|entry| {
            let name = entry.as_ref().expect("entry").file_name();
            name.to_string_lossy().starts_with("scene-cell-")
        });
        assert_eq!(cells(directory).len(), files.count(), "every cell, once");
    }
    // Sixteen times the area, the same density: the whole tables, not only their root, keep
    // their bytes; the world lies in the cells.
    let tables = |at: usize| serde_json::to_vec(&worlds[at].1).expect("json").len();
    assert_eq!(
        tables(0),
        tables(1),
        "the core does not grow with the world"
    );
    assert!(cells(&worlds[1].2).len() > cells(&worlds[0].2).len());
    worlds.iter().for_each(|(options, ..)| clean(options));
}

/// The halving of `cells` in two, down to single cells: the shape `split.rs` records.
fn halving(cells: std::ops::Range<usize>) -> Region {
    let middle = cells.start + cells.len() / 2;
    let halves = (cells.len() > 1)
        .then(|| Box::new([halving(cells.start..middle), halving(middle..cells.end)]));
    Region { cells, halves }
}

#[test]
fn index_pages_list_at_most_the_fan_out_and_give_every_record_back_in_order() {
    let directory = scratch("pages", "index");
    let records: Vec<Value> = (0..300)
        .map(|at| json!({"url": format!("scene-cell-{at}.json"), "sha256": "0".repeat(64), "bytes": at, "parents": [[null, [0, 0, 0, 1, 1, 1]]], "meshes": [[0, 1]]}))
        .collect();
    let bounds = vec![[0.0, 0.0, 0.0, 1.0, 1.0, 1.0]; records.len()];
    let limit = 2048;
    let root = write_pages(&halving(0..300), &records, &bounds, &directory, limit).expect("pages");
    let written = pages(&directory);
    let index = written
        .iter()
        .filter(|(_, page)| page["pages"].is_array())
        .count();
    assert!(
        index > 0,
        "{} pages, {index} of them index pages",
        written.len()
    );
    for (bytes, page) in &written {
        match page["pages"].as_array() {
            Some(slots) => assert!(slots.len() <= FAN_OUT),
            None => assert!(*bytes <= limit, "a region page of {bytes} bytes"),
        }
    }
    let mut read = Vec::new();
    read_records(&directory, &root, "the root", &mut read).expect("records");
    assert_eq!(read, records, "every record, in cell order");
    // A page that is not the one its slot names is refused by name.
    let slot = root["pages"][0].as_str().expect("slot");
    let first = directory.join(format!("scene-page-{}.json", &slot[..64]));
    fs::write(&first, b"{}").expect("corrupt");
    let refused = read_records(&directory, &root, "the root", &mut Vec::new());
    assert!(refused
        .expect_err("refused")
        .contains("is not the page its slot names"));
    fs::remove_dir_all(directory).expect("cleanup");
}

#[test]
fn a_reused_folder_proves_its_cells_through_the_pages() {
    let (options, tables, directory) = compiled(grid(48, 4.0, 1.0), false);
    let (_, events) = compile_with_events(&options);
    assert_eq!(events[0]["completed"], 1, "reused: {events:?}");
    let slot = tables["partition"]["pages"][0].as_str().expect("slot");
    let page = directory.join(format!("scene-page-{}.json", &slot[..64]));
    let old = serde_json::to_vec(&json!({"version": 3})).expect("json");
    let corruptions: [(&str, PathBuf, &[u8]); 3] = [
        (
            "scene-cell-0.json",
            directory.join("scene-cell-0.json"),
            b"{}",
        ),
        ("is not the page its slot names", page, b"{}"),
        (
            "scene tables are not version 4",
            directory.join("scene-tables.json"),
            &old,
        ),
    ];
    for (reason, path, bytes) in corruptions {
        let intact = fs::read(&path).expect("product");
        fs::write(&path, bytes).expect("corrupt");
        let (second, events) = compile_with_events(&options);
        assert!(second["reused"].is_null(), "{reason}: not reused");
        let announced = events[0]["reason"].as_str().expect("reason");
        assert!(announced.contains(reason), "{reason}: {announced}");
        assert_eq!(
            fs::read(&path).expect("rebuilt"),
            intact,
            "{reason}: rebuilt"
        );
    }
    clean(&options);
}
