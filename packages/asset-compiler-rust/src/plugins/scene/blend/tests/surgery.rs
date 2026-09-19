//! Reproducing a defect on the CC0 fixture, without Blender and without writing into `fixtures/`.
//!
//! The fixture is unpacked from its wrapping, then patched **through the SDNA it itself carries**:
//! no offset is hardcoded here either, each field is found by its name as the driver does. A
//! rewritten pointer, a rewritten float, a duplicated block: these are files Blender could have
//! written, and the driver rereads them by the same path as the original fixture.
use super::*;

/// The header of a sixty-four-bit-field block, that of the fixture.
const HEADER: usize = 32;
/// The original address given to the added block: it belongs to no block of the fixture.
const SPARE: u64 = 0xB1E0_0000_0000_0001;

/// The bytes of the CC0 fixture, unpacked from their Zstandard wrapping.
pub(super) fn fixture() -> Vec<u8> {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("fixtures/blend/procedural-materials/scene.blend");
    let raw = fs::read(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    envelope::unwrap(&raw, MAX_BYTES).expect("the fixture wrapping")
}

/// The original address of the block identified by this name, genre prefix included.
pub(super) fn named(file: &BlendFile, name: &str) -> u64 {
    file.blocks
        .iter()
        .find(|block| file.view(block).is_some_and(|view| view.id_name() == name))
        .map(|block| block.old)
        .unwrap_or_else(|| panic!("no block named {name}"))
}

/// The rank, in the file's bytes, where a field of a block starts — the path walking nested
/// structures, such as `["id", "name"]`.
pub(super) fn field(file: &BlendFile, old: u64, path: &[&str]) -> usize {
    let block = file.at(old).expect("the requested block");
    let mut layout = file.dna.layout(block.sdna).expect("its layout");
    let mut at = block.start;
    for (rank, step) in path.iter().enumerate() {
        let field = layout.field(step).unwrap_or_else(|| panic!("field {step}"));
        at += field.offset;
        if rank + 1 < path.len() {
            let kind = file.dna.index(&field.kind).expect("field type");
            layout = file.dna.layout(kind).expect("its layout");
        }
    }
    at
}

/// Rewrites bytes at a given rank of the file.
pub(super) fn put(bytes: &mut [u8], at: usize, value: &[u8]) {
    bytes[at..at + value.len()].copy_from_slice(value);
}

/// The address of a named input or output of a node of a material's graph.
pub(super) fn socket(
    file: &BlendFile,
    material: &str,
    node: &str,
    side: &str,
    wanted: &str,
) -> u64 {
    tree(file, material)
        .list("nodes")
        .into_iter()
        .filter(|held| held.text("name") == node)
        .flat_map(|held| held.list(side))
        .find(|held| held.text("identifier") == wanted)
        .map(|held| held.old)
        .unwrap_or_else(|| panic!("{node} has no {side} named {wanted}"))
}

/// The rank of a field of a graph link, the link being found by the input it feeds.
pub(super) fn link_field(file: &BlendFile, material: &str, tosock: u64, name: &str) -> usize {
    let link = tree(file, material)
        .list("links")
        .into_iter()
        .find(|link| link.pointer("tosock") == tosock)
        .expect("the requested link");
    field(file, link.old, &[name])
}

/// The rank of the declared value of a node input: it lives in the block its `default_value`
/// field designates.
pub(super) fn declared_field(file: &BlendFile, socket: u64, name: &str) -> usize {
    let held = file
        .at(socket)
        .and_then(|block| file.view(block))
        .expect("the input");
    field(file, held.pointer("default_value"), &[name])
}

/// The fixture whose SDNA no longer describes the named field: its name is rewritten in the name
/// section, at equal length. That is exactly what a file written before this field carries.
pub(super) fn without_field(name: &str) -> Vec<u8> {
    let mut bytes = fixture();
    let needle: Vec<u8> = format!("{name}\0").into_bytes();
    let mut renamed = needle.clone();
    let last = renamed.len() - 2;
    renamed[last] = b'_';
    let found: Vec<usize> = bytes
        .windows(needle.len())
        .enumerate()
        .filter(|(_, window)| *window == needle.as_slice())
        .map(|(at, _)| at)
        .collect();
    assert!(!found.is_empty(), "the SDNA does not name {name}");
    for at in found {
        put(&mut bytes, at, &renamed);
    }
    bytes
}

/// The node graph of a named material.
fn tree<'a>(file: &'a BlendFile, material: &str) -> At<'a> {
    file.at(named(file, material))
        .and_then(|block| file.view(block))
        .expect("the material")
        .follow("nodetree")
        .expect("its graph")
}

/// The fixture augmented with a mesh object that no collection of the scene holds: the block of
/// an existing object, copied under another address and another name, slipped in before `ENDB`.
pub(super) fn with_stray_object(name: &[u8]) -> Vec<u8> {
    let mut bytes = fixture();
    let (mut data, sdna, at, end) = {
        let file = BlendFile::open(&bytes, MAX_BYTES).expect("the fixture");
        let old = named(&file, "OBSharedMesh_0");
        let block = file.at(old).expect("its block");
        let data = bytes[block.start..block.start + block.len].to_vec();
        let at = field(&file, old, &["id", "name"]) - block.start;
        let end = file.of(*b"ENDB").next().expect("the ENDB block").start - HEADER;
        (data, block.sdna as u32, at, end)
    };
    data[at..at + name.len()].copy_from_slice(name);
    data[at + name.len()] = 0;
    let mut added = b"OB\0\0".to_vec();
    added.extend_from_slice(&sdna.to_le_bytes());
    added.extend_from_slice(&SPARE.to_le_bytes());
    added.extend_from_slice(&(data.len() as u64).to_le_bytes());
    added.extend_from_slice(&1u64.to_le_bytes());
    added.extend_from_slice(&data);
    bytes.splice(end..end, added);
    bytes
}

/// The fixture whose first mesh's `sharp_face` attribute becomes a `sharp_edge`: same store,
/// same value block, only the name and the domain are rewritten — through the file's SDNA, as
/// everywhere here. `hard` says whether the edges thus marked all are, or none.
pub(super) fn with_sharp_edges(hard: bool) -> Vec<u8> {
    let mut bytes = fixture();
    let (name_at, domain_at, width, values_at, count) = {
        let file = BlendFile::open(&bytes, MAX_BYTES).expect("the fixture");
        let mesh = file
            .of(*b"ME\0\0")
            .next()
            .and_then(|block| file.view(block))
            .expect("a mesh of the fixture");
        let storage = mesh
            .inner("attribute_storage")
            .expect("its attribute store");
        let head = storage.follow("dna_attributes").expect("its attributes");
        let entry = (0..storage.int("dna_attributes_num", 0).max(0) as usize)
            .filter_map(|rank| head.item(rank))
            .find(|entry| {
                entry.file.text_at(entry.pointer("name")).as_deref() == Some("sharp_face")
            })
            .expect("the fixture's sharp_face attribute");
        let domain = entry.layout.field("domain").expect("the domain field");
        let data = entry.follow("data").expect("the value block");
        let values = file.at(data.pointer("data")).expect("its bytes");
        (
            file.at(entry.pointer("name")).expect("the name").start,
            entry.base + domain.offset,
            domain.unit,
            values.start,
            (data.int("size", 0).max(1) as usize).min(values.len),
        )
    };
    put(&mut bytes, name_at, b"sharp_edge\0");
    put(&mut bytes, domain_at, &1u64.to_le_bytes()[..width]);
    put(&mut bytes, values_at, &vec![u8::from(hard); count]);
    bytes
}
