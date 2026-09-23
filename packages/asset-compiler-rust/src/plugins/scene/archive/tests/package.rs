//! The `.unitypackage` container facing a gzip stream that does not end as it promises.
use super::*;
use crate::plugins::scene::unitypackage::UNITYPACKAGE;

/// The GUID of a package asset, as the editor writes one.
const GUID: &str = "00000000000000000000000000000001";

/// A healthy package: a GUID directory, its target path and its bytes.
fn package() -> Vec<u8> {
    let mut builder = tar::Builder::new(flate2::write::GzEncoder::new(
        Vec::new(),
        flate2::Compression::default(),
    ));
    for (member, bytes) in [
        ("pathname", &b"Assets/checker.png"[..]),
        ("asset", &b"\x89PNG\r\n\x1a\n"[..]),
    ] {
        let mut header = tar::Header::new_ustar();
        header.set_mode(0o644);
        header.set_size(bytes.len() as u64);
        builder
            .append_data(&mut header, format!("{GUID}/{member}"), bytes)
            .expect("package entry");
    }
    builder
        .into_inner()
        .expect("end of tar")
        .finish()
        .expect("end of gzip")
}

/// The same bytes, whose gzip footer lies: each variant is that of an interrupted transfer or of
/// a disk that returned something other than what it had been given.
fn damaged(kind: &str) -> Vec<u8> {
    let mut bytes = package();
    let end = bytes.len();
    match kind {
        // The stream stops before its footer: the last bytes were never written.
        "tronque" => bytes.truncate(end - 8),
        // The footer's digest no longer matches that of the decompressed bytes.
        "crc" => bytes[end - 8] ^= 0xff,
        // The size announced by the footer no longer matches that of the decompressed bytes.
        _ => bytes[end - 4] ^= 0xff,
    }
    bytes
}

// Behaviour 4: a healthy package reaches routing of what it holds — here an image, which no
// scene driver claims —, and none of the three lying-footer forms gets there: the stream is
// read to the end, and what does not finish is refused under the unreadable-archive name.
#[test]
fn a_package_whose_gzip_footer_lies_is_refused_as_unreadable() {
    let sain = outcome(
        "paquet-sain",
        &UNITYPACKAGE,
        "sain.unitypackage",
        &package(),
    );
    assert_eq!(
        sain.code, "SOURCE_FORMAT_UNKNOWN",
        "the healthy package reads whole"
    );
    cleanup(sain.dir);
    for kind in ["tronque", "crc", "isize"] {
        let abime = outcome(kind, &UNITYPACKAGE, "abime.unitypackage", &damaged(kind));
        assert_eq!(abime.code, UNREADABLE, "gzip footer « {kind} »");
        assert!(extracted(&abime.dir).is_empty(), "gzip footer « {kind} »");
        cleanup(abime.dir);
    }
}
