//! The `.unitypackage` container facing a gzip stream that does not end as it promises.
use super::*;
use crate::plugins::scene::unitypackage::{unpack, UNITYPACKAGE};
use std::io::Read;

/// The GUID of a package asset, as the editor writes one.
const GUID: &str = "00000000000000000000000000000001";

/// A healthy package: a GUID directory, its target path and its bytes.
fn package() -> Vec<u8> {
    pack(&[
        (GUID, "pathname", b"Assets/checker.png"),
        (GUID, "asset", PNG),
    ])
}

/// The first bytes of a PNG, enough to stand for an asset.
const PNG: &[u8] = b"\x89PNG\r\n\x1a\n";

/// A package holding these `(guid, member, bytes)` entries, in this order.
fn pack(members: &[(&str, &str, &[u8])]) -> Vec<u8> {
    let mut builder = tar::Builder::new(flate2::write::GzEncoder::new(
        Vec::new(),
        flate2::Compression::default(),
    ));
    for (guid, member, bytes) in members {
        let mut header = tar::Header::new_ustar();
        header.set_mode(0o644);
        header.set_size(bytes.len() as u64);
        builder
            .append_data(&mut header, format!("{guid}/{member}"), *bytes)
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

/// A reader that counts the bytes it hands out.
struct Counting<R> {
    inner: R,
    read: u64,
}

impl<R: Read> Read for Counting<R> {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        let n = self.inner.read(buf)?;
        self.read += n as u64;
        Ok(n)
    }
}

/// The regular files left anywhere under `dir`.
fn files(dir: &Path) -> Vec<PathBuf> {
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for path in entries.flatten().map(|entry| entry.path()) {
        if path.is_dir() {
            out.extend(files(&path));
        } else {
            out.push(path);
        }
    }
    out
}

// Behaviour 5: the package is decompressed once — the extractor reads exactly the decompressed
// length, footer included — even when `pathname` comes after the members it places.
#[test]
fn a_package_is_decompressed_once_whatever_the_member_order() {
    let bytes = pack(&[
        (GUID, "asset", PNG),
        (GUID, "asset.meta", b"guid: 1"),
        (GUID, "pathname", b"Assets/checker.png\nAssets/old.png"),
    ]);
    let mut whole = Vec::new();
    flate2::read::GzDecoder::new(&bytes[..])
        .read_to_end(&mut whole)
        .expect("healthy gzip");
    let dir = scratch("une-passe");
    let root = dir.join("root");
    fs::create_dir_all(&root).expect("root");
    let cancelled = std::sync::atomic::AtomicBool::new(false);
    let request = SceneRequest {
        source: &dir,
        inputs: &[],
        cache: &dir,
        cancelled: &cancelled,
        progress: &|_| {},
    };
    let mut stream = Counting {
        inner: flate2::read::GzDecoder::new(&bytes[..]),
        read: 0,
    };
    let (entries, written) =
        unpack(&request, &mut stream, &dir, &root).expect("the package extracts");
    assert_eq!(
        stream.read,
        whole.len() as u64,
        "one decompression, to the end"
    );
    assert_eq!((entries, written), (3, (PNG.len() + 7) as u64));
    let asset = root.join("Assets").join("checker.png");
    assert_eq!(fs::read(&asset).expect("asset"), PNG);
    assert_eq!(
        fs::read(root.join("Assets").join("checker.png.meta")).expect("meta"),
        b"guid: 1"
    );
    assert_eq!(files(&root).len(), 2, "the pending area is gone");
    cleanup(dir);
}

// Behaviour 6: a refusal met after bytes were written — here a second asset whose target path
// climbs out — leaves no file anywhere under the cache.
#[test]
fn a_refusal_after_written_bytes_leaves_nothing_behind() {
    let bytes = pack(&[
        (GUID, "pathname", b"Assets/checker.png"),
        (GUID, "asset", PNG),
        ("00000000000000000000000000000002", "asset", PNG),
        (
            "00000000000000000000000000000002",
            "pathname",
            b"../outside.png",
        ),
    ]);
    let refused = outcome("repli", &UNITYPACKAGE, "repli.unitypackage", &bytes);
    assert_eq!(refused.code, "ARCHIVE_PATH_ESCAPE");
    assert!(
        files(&refused.dir.join("cache")).is_empty(),
        "nothing written stays"
    );
    assert!(!refused.dir.join("outside.png").exists());
    cleanup(refused.dir);
}
