//! The other half of the golden: what the driver refuses, and under which name it reports it. A
//! KTX2 outside the list does not panic and interrupts no compilation — it lets the engine fall
//! back on its white, and the manifest counts the reason. Each refusal is checked by its reason
//! code.
use super::super::super::image as registry;
use super::super::fixture;
use super::{bytes, valid, MAX_ALLOC, RGBA8_SRGB, SIDE};
use std::path::PathBuf;

// Driver contract: the format is recognised by the extension as by the identifier, and
// everything that is not declared comes out as a named report reason, never as a panic.
#[test]
fn a_ktx2_outside_the_list_or_truncated_comes_out_as_a_report_reason_never_as_a_panic() {
    for extension in ["ktx2", "KTX2"] {
        let path = PathBuf::from(format!("albedo.{extension}"));
        let decoder = registry::by_extension(&path).expect("claimed");
        assert_eq!(decoder.name(), "ktx2", "{extension}");
        assert_eq!(decoder.mime(), "image/ktx2");
    }
    // Forty bytes of eight thousand: the identifier is there, the header is not.
    let truncated = fixture("ktx2", "tronque.ktx2");
    assert_eq!(
        registry::by_head(&truncated).map(|d| d.name()),
        Some("ktx2")
    );
    assert_eq!(
        registry::decode(&truncated, MAX_ALLOC).err(),
        Some("ktx2-header-truncated")
    );
    // A level index announced but absent is the same cut, seen further on.
    let promised = bytes::chain(RGBA8_SRGB, SIDE, SIDE, &[0u8; 64], 4);
    assert_eq!(
        registry::decode(&promised[..100], MAX_ALLOC).err(),
        Some("ktx2-header-truncated")
    );
    invalid_headers();
    layouts_and_schemes();
    truncated_data(promised);
}

/// Header present but outside domain. The identifier is checked here too: called by the
/// extension, a driver can receive bytes it would not have claimed by their head.
fn invalid_headers() {
    let mut foreign = valid();
    foreign[0] = 0;
    for (case, file) in [
        ("identifier", foreign),
        ("zero width", bytes::patched(valid(), bytes::WIDTH, 0)),
        ("typeSize", bytes::patched(valid(), bytes::TYPE_SIZE, 4)),
        ("absurd levels", bytes::patched(valid(), bytes::LEVELS, 40)),
        (
            "level in the index",
            bytes::patched64(valid(), bytes::HEADER_END, 8),
        ),
    ] {
        let plugin = registry::by_extension(&PathBuf::from("albedo.ktx2")).expect("claimed");
        assert_eq!(
            plugin.decode(&file, MAX_ALLOC).err(),
            Some("ktx2-header-invalid"),
            "{case}"
        );
    }
}

/// Layouts, supercompressions and `vkFormat` outside the declared lists, each by its name.
fn layouts_and_schemes() {
    for (case, at, value) in [
        ("one dimension", bytes::HEIGHT, 0),
        ("volume", bytes::DEPTH, 4),
        ("array", bytes::LAYERS, 6),
        ("cube", bytes::FACES, 6),
    ] {
        assert_eq!(
            registry::decode(&bytes::patched(valid(), at, value), MAX_ALLOC).err(),
            Some("ktx2-layout-unsupported"),
            "{case}"
        );
    }
    // ZLIB, then a number the specification has not assigned.
    for scheme in [3, 9] {
        let file = bytes::patched(valid(), bytes::SUPERCOMPRESSION, scheme);
        assert_eq!(
            registry::decode(&file, MAX_ALLOC).err(),
            Some("ktx2-supercompression-unsupported"),
            "scheme {scheme}"
        );
    }
    // Signed variants, float BC6H, byte orders other than RGBA, channels of more than eight
    // bits, and ASTC footprints other than 4 × 4.
    for (case, format) in [
        ("signed bc4", 140),
        ("float bc6h", 143),
        ("bgra8", 44),
        ("float rgba16", 97),
        ("astc 5x4", 159),
    ] {
        let file = bytes::patched(valid(), bytes::FORMAT, format);
        assert_eq!(
            registry::decode(&file, MAX_ALLOC).err(),
            Some("ktx2-format-unsupported"),
            "{case}"
        );
    }
}

/// What is missing: the announced chain, the announced level, room under the allocation
/// ceiling, and a Basis Universal payload the transcoder does not recognise.
fn truncated_data(promised: Vec<u8>) {
    for (case, file) in [
        ("chain", promised),
        (
            "level outside the file",
            bytes::patched64(valid(), bytes::HEADER_END + 8, 10_000),
        ),
        (
            "short level",
            bytes::container(RGBA8_SRGB, SIDE, SIDE, &[0u8; 63]),
        ),
    ] {
        assert_eq!(
            registry::decode(&file, MAX_ALLOC).err(),
            Some("ktx2-data-truncated"),
            "{case}"
        );
    }
    // The allocation ceiling is a refusal, never an allocation attempted: 4 × 4 texels make
    // sixty-four bytes of RGBA8, one more than this ceiling. Both paths check it before reading
    // anything.
    let basis = bytes::patched(valid(), bytes::FORMAT, 0);
    for (case, file) in [
        ("named vkFormat", valid()),
        ("basis payload", basis.clone()),
    ] {
        assert_eq!(
            registry::decode(&file, 63).err(),
            Some("ktx2-image-too-large"),
            "{case}"
        );
    }
    assert_eq!(
        registry::decode(&basis, MAX_ALLOC).err(),
        Some("ktx2-transcode-failed"),
        "a payload the transcoder does not recognise"
    );
}
