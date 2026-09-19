//! Colour profiles files carry, and that the contract output does not carry.
//!
//! `into_rgba8` yields bytes the rest of the chain reads as sRGB. A file can nevertheless
//! embed an ICC profile that says something else, and the driver used to drop it without a
//! word. This batch converts nothing — colour management is another job — but it counts.
//!
//! The three paths by which a profile arrives are covered here: a PNG's `iCCP` chunk, a JPEG's
//! APP2 segment, and a PSD's image resource 1039.
use super::super::image as registry;
use super::{declared, fixture};
use std::path::PathBuf;

const MAX_ALLOC: u64 = 4 * 1024 * 1024;
/// Reason the three paths count.
const IGNORED: &str = "image-icc-profile-ignored";

/// Description of a profile that is not the output's, and that of an sRGB profile.
const OTHER: &str = "Tirage papier";
const SRGB: &str = "sRGB IEC61966-2.1";

/// Named reasons of bytes built by the test.
fn notes(case: &str, bytes: &[u8]) -> Vec<&'static str> {
    registry::decode(bytes, MAX_ALLOC)
        .unwrap_or_else(|reason| panic!("{case} : {reason}"))
        .notes
}

// Reproduction of finding 58, PNG path: the `iCCP` chunk carries the profile name in the open,
// then the compressed profile. A name that is not that of the output's sRGB is counted; the
// name of an sRGB profile counts nothing, since there would be nothing to convert.
#[test]
fn a_png_icc_profile_is_counted_unless_it_names_srgb() {
    assert_eq!(declared("png", "icc-autre.png", MAX_ALLOC).1, vec![IGNORED]);
    assert!(declared("png", "icc-srgb.png", MAX_ALLOC).1.is_empty());
    // Both fixtures carry the reference drawing: a profile changes no pixel here.
    assert!(declared("png", "rgb8.png", MAX_ALLOC).1.is_empty());
}

// Reproduction of finding 58, JPEG path: the ICC specification carries the profile in APP2
// segments that open on “ICC_PROFILE\0”. The driver used to skip them all.
#[test]
fn a_jpeg_icc_profile_is_counted_unless_it_names_srgb() {
    let base = jpeg_sans_profil();
    assert!(notes("jpeg nu", &base).is_empty(), "no APP2 segment");
    assert_eq!(notes("jpeg autre", &avec_app2(&base, OTHER)), vec![IGNORED]);
    assert!(notes("jpeg sRGB", &avec_app2(&base, SRGB)).is_empty());
}

// Reproduction of finding 58, PSD path: image resource 1039 carries the document's ICC
// profile. The resources section was skipped by its length, without anything being read in it.
#[test]
fn a_psd_icc_profile_is_counted_unless_it_names_srgb() {
    let base = fixture("psd", "rgb-brut.psd");
    assert!(notes("psd nu", &base).is_empty(), "no resource");
    assert_eq!(
        notes("psd autre", &avec_ressource(&base, OTHER)),
        vec![IGNORED]
    );
    assert!(notes("psd sRGB", &avec_ressource(&base, SRGB)).is_empty());
}

/// Bytes of a profile, reduced to what the driver reads there: its description. A real profile
/// carries it in its `desc` tag, between its one-hundred-and-twenty-eight-byte header and its
/// curves; nothing else enters the decision, and the rest is not written here.
fn profil(description: &str) -> Vec<u8> {
    let mut out = Vec::from(*b"desc");
    out.extend_from_slice(&[0; 4]);
    out.extend_from_slice(&(description.len() as u32 + 1).to_be_bytes());
    out.extend_from_slice(description.as_bytes());
    out.push(0);
    out
}

/// JPEG of the preview golden, which carries no APP2 segment.
fn jpeg_sans_profil() -> Vec<u8> {
    let path =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("fixtures/apercus/atlas-couleur/lueur.jpg");
    std::fs::read(path).expect("lueur.jpg")
}

/// The same JPEG, an APP2 segment carrying a profile inserted behind its start-of-image
/// signature. A decoder skips application segments it does not know: the image stays the same.
fn avec_app2(base: &[u8], description: &str) -> Vec<u8> {
    let mut payload = Vec::from(*b"ICC_PROFILE\0");
    // Chunk number and their count: a single chunk, which carries the whole profile.
    payload.extend_from_slice(&[1, 1]);
    payload.extend_from_slice(&profil(description));
    let mut out = Vec::from(&base[..2]);
    out.extend_from_slice(&[0xff, 0xe2]);
    out.extend_from_slice(&(payload.len() as u16 + 2).to_be_bytes());
    out.extend_from_slice(&payload);
    out.extend_from_slice(&base[2..]);
    out
}

/// The PSD fixture, its empty resources section replaced by a section that carries resource
/// 1039. A resource block is the `8BIM` signature, the identifier on two bytes, a Pascal name
/// — empty here, so two null bytes —, the data length, then the data padded to an even length.
fn avec_ressource(base: &[u8], description: &str) -> Vec<u8> {
    let profil = profil(description);
    let mut block = Vec::from(*b"8BIM");
    block.extend_from_slice(&1039u16.to_be_bytes());
    block.extend_from_slice(&[0, 0]);
    block.extend_from_slice(&(profil.len() as u32).to_be_bytes());
    block.extend_from_slice(&profil);
    if block.len() % 2 != 0 {
        block.push(0);
    }
    let at = 26 + 4;
    let mut out = Vec::from(&base[..at]);
    out.extend_from_slice(&(block.len() as u32).to_be_bytes());
    out.extend_from_slice(&block);
    out.extend_from_slice(&base[at + 4..]);
    out
}
