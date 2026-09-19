//! What a PSD **declares** around its pixels, and that the header alone does not say: the layer
//! count of the layers section, a sixteen-bit signed integer whose negative sign announces that
//! the composite's first alpha plane carries the document's transparency.
//!
//! Without that declaration, a plane more than the colour channels is a stored alpha channel,
//! that is a selection: taking it for transparency punched holes in the texture.
use super::super::super::image as registry;
use super::super::{fixture, rgba8};
use super::{avec_alpha, GRIS, MAX_ALLOC, RVB, SIZE};

/// Offset of the layers-section length in a PSD fixture whose two preceding sections are empty:
/// twenty-six header bytes, then two null four-byte lengths.
const LAYERS_AT: usize = 26 + 4 + 4;

/// The fixture, its empty layers section replaced by a section that carries a layer count — the
/// sixteen-bit signed integer by which Adobe's specification declares, by its sign, that the
/// composite's first alpha plane is the document's transparency. The driver reads only that
/// field and skips the rest of the section by its length: these cases therefore do not pretend
/// to write a whole layer record, they put in fault exactly the field that decides.
fn avec_compte_de_calques(name: &str, count: i16) -> Vec<u8> {
    let mut bytes = fixture("psd", name);
    let mut section = Vec::from(2u32.to_be_bytes());
    section.extend_from_slice(&count.to_be_bytes());
    bytes.splice(
        LAYERS_AT..LAYERS_AT + 4,
        (section.len() as u32)
            .to_be_bytes()
            .into_iter()
            .chain(section),
    );
    bytes
}

/// Pixels and named reasons of bytes built by the test.
fn decode(case: &str, bytes: &[u8]) -> (Vec<[u8; 4]>, Vec<&'static str>) {
    let decoded =
        registry::decode(bytes, MAX_ALLOC).unwrap_or_else(|erreur| panic!("{case}: {erreur}"));
    let raisons = decoded.notes.clone();
    let image = rgba8(decoded);
    assert_eq!(image.dimensions(), SIZE, "{case}");
    (image.pixels().map(|pixel| pixel.0).collect(), raisons)
}

// Reproduction of finding 54: a plane more than the colour channels is transparency only if the
// file declares it. Adobe's specification says so in the layer count — a signed integer whose
// negative announces “the first alpha channel carries the composite's transparency”. Without
// that declaration, the plane is a stored alpha channel, that is a selection: taking it for
// transparency punched holes in the texture. It is ignored and counted.
#[test]
fn an_extra_plane_is_transparency_only_if_the_file_declares_it() {
    // No layers section: both fixtures carry a selection, not a transparency.
    for (name, base) in [("rgba-rle.psd", RVB), ("gris-alpha-rle.psd", GRIS)] {
        let (rendus, raisons) = decode(name, &fixture("psd", name));
        assert_eq!(rendus, base.to_vec(), "{name}: alpha stays opaque");
        assert_eq!(raisons, vec!["psd-alpha-channel-ignored"], "{name}");
    }
    // Negative count: the composite does carry the document's transparency, alpha is honoured.
    let (rendus, raisons) = decode(
        "rgba-rle.psd -1",
        &avec_compte_de_calques("rgba-rle.psd", -1),
    );
    assert_eq!(rendus, avec_alpha(RVB));
    assert_eq!(raisons, vec!["psd-layers-flattened"]);
    // Positive count: layers exist but transparency is not declared. The plane becomes a
    // selection again, and both reasons count side by side.
    let (rendus, raisons) = decode(
        "rgba-rle.psd +2",
        &avec_compte_de_calques("rgba-rle.psd", 2),
    );
    assert_eq!(rendus, RVB.to_vec());
    assert_eq!(
        raisons,
        vec!["psd-alpha-channel-ignored", "psd-layers-flattened"]
    );
}

// Reproduction of finding 54, second half: the layer count was not read at all, while only the
// flattened composite comes out of the driver. A file that carries layers now says so, even
// when no alpha plane is in play.
#[test]
fn a_psd_s_layers_are_counted_since_only_the_composite_comes_out() {
    let (rendus, raisons) = decode("rgb-rle.psd +3", &avec_compte_de_calques("rgb-rle.psd", 3));
    assert_eq!(rendus, RVB.to_vec(), "the composite's pixels do not move");
    assert_eq!(raisons, vec!["psd-layers-flattened"]);
    // With no layer, nothing is counted: a three-channel composite is exactly what it says.
    assert!(decode("rgb-rle.psd", &fixture("psd", "rgb-rle.psd"))
        .1
        .is_empty());
}
