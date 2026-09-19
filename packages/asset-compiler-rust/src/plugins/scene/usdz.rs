//! USDZ driver, a container. A `.usdz` is an **uncompressed** ZIP whose every payload starts on
//! a multiple of sixty-four bytes: the wrapping serves to read a USD layer and its images in
//! place, never to shrink them. This driver extracts it under the cache, then yields to the
//! router what it extracted; it reads no geometry and re-encodes nothing.
//!
//! Provenance: AOUSD *OpenUSD Core Specification* for the package layout, PKWARE APPNOTE
//! 6.3.10 for the container, read by `archive/zip_reader.rs`, shared with the `zip` driver.
//!
//! The extracted directory carries the layer and the images beside it: the router recognises
//! the `usd` driver there, which resolves image URIs against that same directory. An archive
//! without a USD layer is refused by `SOURCE_FORMAT_UNKNOWN`, an archive that carries several
//! by `SOURCE_FORMAT_AMBIGUOUS`: it is the package that says which layer it delivers, not the
//! compiler that guesses it.
use super::*;
use crate::CompilerError;

pub(super) static USDZ: Usdz = Usdz;
pub(super) struct Usdz;

/// Alignment the specification requires of each entry's payload.
const ALIGNMENT: u64 = 64;
/// Compression method the specification requires: none.
const STORED: ::zip::CompressionMethod = ::zip::CompressionMethod::Stored;
/// The package is not laid out as the specification asks: an entry is compressed, or its
/// payload does not start on a multiple of sixty-four bytes.
const LAYOUT: &str = "USDZ_LAYOUT_INVALID";
/// The first entry of the package is not a USD layer: the package therefore does not say which
/// scene it delivers, and later entries are only its resources.
pub(super) const ROOT_LAYER: &str = "USDZ_ROOT_LAYER_MISSING";

impl Plugin for Usdz {
    fn name(&self) -> &'static str {
        "usdz"
    }
    /// The container reads no geometry: this version names the extractor, not a decoder.
    fn version(&self) -> &'static str {
        "usdz-aousd-1.0-zip-8.6.0-extract-1"
    }
    fn extensions(&self) -> &'static [&'static str] {
        &["usdz"]
    }
}

impl ScenePlugin for Usdz {
    /// A USDZ package is a ZIP: it starts with the header of a local entry. An empty package
    /// does not exist — it needs at least its layer — but the empty index header is recognised
    /// anyway, so the package is refused by saying so rather than ignored by the router.
    fn accepts_head(&self, head: &[u8]) -> bool {
        archive::zip_reader::accepts_head(head)
    }
    fn prepare(&self, request: &SceneRequest<'_>) -> Result<PreparedScene> {
        let source = archive::only_input(request, self)?;
        let layer = layout(source)?;
        archive::container(request, self, Some(&layer), |file, root| {
            archive::zip_reader::extract(request, file, root)
        })
    }
}

/// Judges the package layout before a byte is written, and yields the root layer it declares.
/// Each entry is stored as-is and its payload is aligned; an entry whose payload is not
/// announced is refused too, that is a local header the reader could not place. The
/// specification then wants the **first** entry to be the package's USD layer: it is the one
/// that carries the scene, and everything that follows it is only a resource.
fn layout(source: &Path) -> Result<String> {
    let mut archive = archive::zip_reader::open(source)?;
    let mut first: Option<String> = None;
    for index in 0..archive.len() {
        let entry = archive
            .by_index(index)
            .map_err(|error| archive::unreadable(source, error))?;
        if entry.compression() != STORED {
            return Err(refused(entry.name(), "is compressed"));
        }
        if entry.is_dir() {
            continue;
        }
        match entry.data_start() {
            Some(start) if start % ALIGNMENT == 0 => {}
            _ => {
                return Err(refused(
                    entry.name(),
                    "does not start on a 64-byte boundary",
                ))
            }
        }
        first.get_or_insert_with(|| entry.name().to_string());
    }
    first
        .filter(|name| is_layer(name))
        .ok_or_else(|| missing(source))
}

/// Is this name that of a USD layer? It is the `usd` driver's extensions that say so: it is
/// that driver that will read the layer, and they are declared only once.
fn is_layer(name: &str) -> bool {
    super::super::extension_of(name)
        .is_some_and(|extension| super::usd::USD.extensions().contains(&extension.as_str()))
}

/// Refusal of a package whose first entry is not a USD layer: it therefore does not say which
/// scene it delivers, and the compiler does not look for it among its resources.
fn missing(source: &Path) -> CompilerError {
    CompilerError::new(
        ROOT_LAYER,
        format!(
            "{}: the first entry of a USDZ package is its root USD layer; this package opens with something else",
            source.to_string_lossy()
        ),
    )
}

/// Refusal of a badly laid-out package, naming the entry at fault.
fn refused(name: &str, why: &str) -> CompilerError {
    CompilerError::new(
        LAYOUT,
        format!(
            "usdz entry {name:?} {why}; a USDZ package stores every file uncompressed and aligned"
        ),
    )
}
