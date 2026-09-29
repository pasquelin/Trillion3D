use crate::proxy::assemble::assemble;
use crate::proxy::SCENE_PROXY_HEADER_WORDS;
#[path = "share_fixture.rs"]
pub(crate) mod fixture;
use fixture::{binary_fixture, flat_file, lattice, plate};

#[test]
fn a_thousand_instances_store_under_half_the_flat_bytes() {
    let proxy = lattice(1000, plate());
    let (bytes, flat) = (proxy.encode().len(), flat_file(&proxy).len());
    let shared = proxy.sharing.instances.len();
    eprintln!("proxy.bin: develop {flat} B, branch {bytes} B, {shared}/1000 instances shared");
    assert!(bytes * 2 < flat, "sharing must at least halve the file");
    assert!(
        proxy.sharing.positions.len() < proxy.triangle_count(),
        "eighth turns stay flat"
    );
}

/// The writer's bytes for 60 copies of one triangle, and develop's flat file of the same proxy:
/// `sdk-core/src/scene/core/proxy.test.ts` reads the first and must find the second.
/// `cargo run --example proxy_sharing` regenerates both.
#[test]
fn the_shared_file_the_reader_expands_is_the_committed_one() {
    let proxy = binary_fixture();
    assert!(
        !proxy.sharing.instances.is_empty()
            && proxy.sharing.positions.len() < proxy.triangle_count()
    );
    let root = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../sdk-core/src/scene/core/fixtures");
    for (name, bytes) in [
        ("proxy-v4.bin", proxy.encode()),
        ("proxy-flat.bin", flat_file(&proxy)),
    ] {
        assert_eq!(
            std::fs::read(root.join(name)).expect("fixture"),
            bytes,
            "{name}"
        );
    }
}

#[test]
fn no_instance_writes_the_header_and_empty_group_sentinel() {
    let bytes = assemble(&[], Vec::new(), Vec::new()).encode();
    assert_eq!(bytes.len(), SCENE_PROXY_HEADER_WORDS * 4 + 4);
    assert!(
        bytes[8..].iter().all(|byte| *byte == 0),
        "no triangle, node, shape or instance"
    );
}
