//! The job's RAM budget bounds what the reader decodes, never the file: a bare file is mapped and
//! read in place whatever its size, a wrapped one unpacks under the budget, and the block index,
//! the packed images and the meshes the scene binary takes in stay under it too. Each overrun is
//! refused by name, with its bytes.
use super::*;
use std::borrow::Cow;
use std::io::{Seek, SeekFrom, Write};

/// A budget far below the file below: the smallest share a job is given.
const SMALL: usize = 64 << 20;

// Behaviour: a bare file past the old fixed 1 GiB ceiling reads under a budget sixteen times
// smaller. The file is sparse — a padding block the walk steps over —, so it costs no disk.
#[test]
fn a_bare_file_past_a_gigabyte_is_read_in_place_under_a_small_budget() {
    const PADDING: u32 = (1 << 30) + (1 << 20);
    let mut head = legacy_file(2.5);
    head.truncate(head.len() - 24);
    block(&mut head, b"TEST", 0, 0, &[]);
    let length = head.len() - 20;
    head[length..length + 4].copy_from_slice(&PADDING.to_le_bytes());
    let mut tail = Vec::new();
    block(&mut tail, b"ENDB", 0, 0, &[]);
    let root = output::scratch("blend", "sparse");
    let path = root.join("scene.blend");
    let mut written = fs::File::create(&path).expect("file");
    written.write_all(&head).expect("head");
    written
        .seek(SeekFrom::Current(i64::from(PADDING)))
        .expect("hole");
    written.write_all(&tail).expect("tail");
    drop(written);
    let map = crate::map_source(&path).expect("the map");
    assert!(map.len() > 1 << 30, "{} bytes", map.len());
    let read = BlendFile::open(&map, SMALL).expect("a bare file is read in place");
    assert!(
        matches!(read.bytes, Cow::Borrowed(_)),
        "nothing is copied into memory"
    );
    assert_eq!(read.held(), read.blocks.len() * file::INDEXED);
    let padding = read.of(*b"TEST").next().expect("the padding block");
    assert_eq!(padding.len, PADDING as usize);
    let data = read.of(*b"DATA").next().expect("the data block");
    assert_eq!(read.view(data).expect("its view").float("value", 0.0), 2.5);
    drop(map);
    fs::remove_dir_all(root).expect("cleanup");
}

// Behaviour: a gzip or Zstandard file that unpacks past the budget is refused by name, with the
// least bytes it needs and the budget it had; one byte more of budget and it unpacks.
#[test]
fn a_wrapped_file_past_the_budget_is_refused_with_the_bytes_it_needs() {
    let plain = surgery::fixture();
    let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
    encoder.write_all(&plain).expect("compression");
    let gzip = encoder.finish().expect("gzip frame");
    let budget = plain.len() - 1;
    for (case, wrapped) in [("gzip", gzip), ("zstd", surgery::wrapped())] {
        let refusal = BlendFile::open(&wrapped, budget)
            .err()
            .unwrap_or_else(|| panic!("{case}: past the budget, the file is refused"));
        assert_eq!(refusal.code, "blend-too-large", "{case}");
        let needs = format!("at least {} bytes", plain.len());
        let had = format!("{budget}-byte RAM budget");
        assert!(
            refusal.message.contains(&needs) && refusal.message.contains(&had),
            "{case}: {}",
            refusal.message
        );
        envelope::unwrap(&wrapped, plain.len()).expect("under the budget, it unpacks");
        let read = BlendFile::open(&wrapped, plain.len() + indexed(&plain))
            .unwrap_or_else(|e| panic!("{case}: room for its bytes and its index: {}", e.message));
        assert!(
            read.held() >= plain.len(),
            "{case}: the unpacked buffer is held"
        );
    }
}

// Behaviour: the block index is decoded data too. A file of more blocks than the budget can index
// is refused by name, with the bytes the index needs, before the index is built.
#[test]
fn a_block_index_past_the_budget_is_refused_by_name() {
    let bytes = legacy_file(2.5);
    let blocks = BlendFile::open(&bytes, BUDGET)
        .expect("the file")
        .blocks
        .len();
    let index = blocks * file::INDEXED;
    let refusal = BlendFile::open(&bytes, index - 1)
        .err()
        .expect("the index goes past the budget");
    assert_eq!(refusal.code, "blend-too-large");
    assert!(
        refusal.message.contains(&format!("at least {index} bytes")),
        "{}",
        refusal.message
    );
    BlendFile::open(&bytes, index).expect("with room for its index, the file opens");
}

/// What the fixture holds once open, read in place: its block index.
fn indexed(plain: &[u8]) -> usize {
    BlendFile::open(plain, BUDGET).expect("the fixture").held()
}

/// Where the fixture's packed PNG starts and ends, in its unpacked bytes.
fn packed_png(plain: &[u8]) -> (usize, usize) {
    let start = plain
        .windows(8)
        .position(|window| window == b"\x89PNG\r\n\x1a\n")
        .expect("the packed PNG");
    let end = start
        + plain[start..]
            .windows(4)
            .position(|window| window == b"IEND")
            .expect("its end")
        + 8;
    (start, end)
}

// Behaviour: a packed image the scene binary cannot take in under the budget refuses the scene
// by name, with the image and the bytes it needs; it is never dropped in silence.
#[test]
fn a_packed_image_past_the_budget_is_refused_by_name() {
    let plain = surgery::fixture();
    let (start, end) = packed_png(&plain);
    let budget = indexed(&plain) + end - start - 1;
    let (root, converted) = output::converted(&plain, "image-budget", budget);
    fs::remove_dir_all(root).expect("cleanup");
    let refusal = converted.expect_err("the image goes past the budget");
    assert_eq!(refusal.code, "blend-too-large");
    let needs = format!("needs {} bytes", end - start);
    assert!(
        refusal.message.contains("packed image") && refusal.message.contains(&needs),
        "{}",
        refusal.message
    );
}

// Behaviour: the geometry joins the scene binary under the same budget as the packed images. Room
// for the packed image alone, a mesh is refused by name, never poured past the budget.
#[test]
fn a_mesh_past_the_budget_is_refused_by_name() {
    let plain = surgery::fixture();
    let (start, end) = packed_png(&plain);
    let budget = indexed(&plain) + end - start;
    let (root, converted) = output::converted(&plain, "mesh-budget", budget);
    fs::remove_dir_all(root).expect("cleanup");
    let refusal = converted.expect_err("the geometry goes past the budget");
    assert_eq!(refusal.code, "blend-too-large");
    assert!(
        refusal.message.contains("blend: mesh "),
        "{}",
        refusal.message
    );
}
