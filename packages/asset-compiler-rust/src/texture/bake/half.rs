//! The cook of a floating image: its half-float chain (`hdr.rs`), the tail the sidecar carries and
//! the levels above it written as files, once, under the image's fingerprint.
//!
//! Only the colour roles read it — the base colour and the emissive map, the maps whose values
//! may pass one. A role read from the data atlas (metal-roughness, normal, occlusion, height) has
//! no half-float pool: its readers go unbaked and the report says so. Nothing here is gated: the
//! texels are the image's own, rounded to half-float — or, for a texture whose setting is
//! `hdrCompressed` (`setting.rs`), to BC6H blocks beside the half-float tail (`blocks/bc6h.rs`).
use super::write::{write_levels, LEVEL_WRITE_FAILED};
use super::{stored_family, Baked};
use crate::texture::blocks::{encode_hdr, encode_texels, BlockFormat, Layout};
use crate::texture::collect::AtlasTexture;
use crate::texture::hdr::{self, HALF_FILE};

use crate::texture::reduce::AtlasKind;
use crate::texture::setting::Route;
use crate::texture::*;

/// A floating image read by a data role: no chain, named in the report.
const DATA_UNSUPPORTED: &str = "image-float-data-unsupported";

/// The key a half-float chain's files live under: the source's fingerprint, the atlas and the
/// file format the chain's levels are written in.
fn key(sha256: &str, file: &str) -> String {
    crate::hash(format!("{sha256}-{file}").as_bytes())
}

/// The linear texels of a byte image read as a floating one: the colours decoded by the sRGB
/// curve, alpha as it is — what a byte texture asking for a floating-point setting holds.
pub(super) fn from_bytes(image: &image::RgbaImage) -> Vec<f32> {
    let (srgb, linear) = (crate::texture::srgb_table(), crate::texture::linear_table());
    image
        .as_raw()
        .iter()
        .enumerate()
        .map(|(i, &byte)| (if i % 4 == 3 { linear } else { srgb })[byte as usize])
        .collect()
}

/// What a floating chain's cook brings to its sidecar entries: the key its files live under, its
/// atlas, its first carried level and the levels baked, the tail's texels and blocks with the
/// layouts that name them, and the notes the cook made.
struct Written<'a> {
    key: &'a str,
    kind: AtlasKind,
    levels: (u32, u32),
    pixels: &'a [u8],
    layouts: [Option<Layout>; FAMILIES],
    blocks: &'a [Vec<u8>; FAMILIES],
    notes: Vec<&'static str>,
}

/// The sidecar entry of every reader of a floating image of `(width, height)` for the chain
/// `written` names.
fn finish(
    readers: &[&AtlasTexture],
    (size, provenance, image_index): ((u32, u32), PreviewSource, usize),
    written: Written<'_>,
) -> std::result::Result<Baked, &'static str> {
    let previews = super::entries(
        readers,
        (size, provenance, image_index, written.levels.0),
        (written.key, written.kind),
        written.levels.1,
        (written.pixels, written.layouts, written.blocks),
    )?;
    Ok(Baked {
        previews,
        notes: written.notes,
        ..Baked::default()
    })
}

/// The chains of a floating image `data`, `width` × `height` linear RGBA texels: the colour readers
/// of `readers` follow their route (`Float`: half-float RGBA, `FloatBlocks`: BC6H, `Float32`: exact
/// 32-bit RGBA; any other route, half-float RGBA, a colour reader of one channel included), a data
/// reader of one channel (`HalfSingle`, `SingleFloat`) its own; any other data reader has no pool.
pub(super) fn cook_float(
    o: &Options,
    dims: (u32, u32, &[f32]),
    from: (&str, PreviewSource, usize),
    readers: &[(&AtlasTexture, Route)],
) -> std::result::Result<Baked, &'static str> {
    let pick = |kind: AtlasKind, wanted: &dyn Fn(Route) -> bool| -> Vec<&AtlasTexture> {
        readers
            .iter()
            .filter(|(r, route)| r.kind == kind && wanted(*route))
            .map(|&(r, _)| r)
            .collect()
    };
    let mut baked = Baked::default();
    let mut cooked = Vec::new();
    for (blocks, wanted) in [
        (
            false,
            &(|r: Route| !matches!(r, Route::FloatBlocks | Route::Float32))
                as &dyn Fn(Route) -> bool,
        ),
        (true, &|r: Route| r == Route::FloatBlocks),
    ] {
        let group = pick(AtlasKind::Color, wanted);
        if !group.is_empty() {
            cooked.push(cook(o, dims, from, &group, blocks)?);
        }
    }
    for route in [Route::Float32, Route::SingleFloat, Route::HalfSingle] {
        let kind = if route == Route::Float32 {
            AtlasKind::Color
        } else {
            AtlasKind::Data
        };
        let group = pick(kind, &|r: Route| r == route);
        if !group.is_empty() {
            cooked.push(cook_exact(o, dims, from, (&group, kind), route)?);
        }
    }
    for part in cooked {
        baked.previews.extend(part.previews);
        for note in part.notes {
            baked.add_note(note);
        }
    }
    if baked.previews.is_empty() {
        return Err(DATA_UNSUPPORTED);
    }
    if baked.previews.len() < readers.len() {
        baked.add_note(DATA_UNSUPPORTED);
    }
    baked.previews.sort_by_key(|p| p.texture);
    Ok(baked)
}

/// The chain of a floating image `data` kept exactly in the float layout `route` names — `Float32`
/// (four 32-bit channels, the half-float atlas), `SingleFloat` (the red as 32-bit floats),
/// `HalfSingle` (the red as half-floats) — for the `readers` of atlas `kind`: its levels above the
/// tail are files of 4 × 4 squares of texels, the tail in the stored family's column; the sidecar's
/// own texels hold a rough copy (half-float RGBA, or grey bytes) for a reader that has no use of the
/// floats.
pub(super) fn cook_exact(
    o: &Options,
    (width, height, data): (u32, u32, &[f32]),
    (sha256, provenance, image_index): (&str, PreviewSource, usize),
    (readers, kind): (&[&AtlasTexture], AtlasKind),
    route: Route,
) -> std::result::Result<Baked, &'static str> {
    let (layout, texel_bytes, store, entry_kind): (
        Layout,
        usize,
        fn(&[f32]) -> Vec<u8>,
        AtlasKind,
    ) = match route {
        Route::Float32 => (Layout::Float32, 16, hdr::pack_f32, AtlasKind::Hdr),
        Route::SingleFloat => (Layout::SingleFloat, 4, hdr::pack_red_f32, kind),
        _ => (Layout::HalfSingle, 2, hdr::pack_red_half, kind),
    };
    let file = BlockFormat::STORED.file_name(layout);
    let first_level = preview_first_level(width, height);
    let key = key(sha256, file);
    let (levels, proxy) = {
        let _t = crate::support::perf::Timer::new(crate::support::perf::Phase::TextureBake);
        let proxy: fn(&[f32]) -> Vec<u8> = if route == Route::Float32 {
            hdr::pack
        } else {
            hdr::proxy_rgba8
        };
        (
            hdr::chain_with(width, height, data, store),
            hdr::chain_with(width, height, data, proxy),
        )
    };
    let blocks_of = |level: usize| {
        let (w, h) = preview_level_size(width, height, level as u32);
        encode_texels(&levels[level], w, h, texel_bytes)
    };
    let written = {
        let _t = crate::support::perf::Timer::new(crate::support::perf::Phase::TextureWrite);
        write_levels(
            o,
            &key,
            entry_kind,
            (width, height),
            file,
            first_level,
            |level, (w, h)| Ok(tile_records(&blocks_of(level), w, h, layout_cell(layout))),
        )
    };
    let mut notes = Vec::new();
    if written.is_err() {
        notes.push(LEVEL_WRITE_FAILED);
    }
    let baked_levels = written.as_ref().map_or(0, |&count| count);
    // The exact tail is kept only with the files it sits beside, as every layout's.
    let (layouts, tail) = stored_family(
        layout,
        written.is_ok().then(|| {
            (first_level as usize..levels.len())
                .flat_map(blocks_of)
                .collect()
        }),
    );
    let pixels = proxy[first_level as usize..].concat();
    finish(
        readers,
        ((width, height), provenance, image_index),
        Written {
            key: &key,
            kind: entry_kind,
            levels: (first_level, baked_levels),
            pixels: &pixels,
            layouts,
            blocks: &tail,
            notes,
        },
    )
}

/// The chain of a floating image `data`, `width` × `height` linear RGBA texels — its bytes'
/// fingerprint `sha256`, read from `provenance`, the image `image_index` of the glTF — for the
/// colour readers `colour`, in BC6H beside the half-float tail when `blocks` (and the job cooks the
/// stored family), in half-float texels otherwise.
pub(super) fn cook(
    o: &Options,
    (width, height, data): (u32, u32, &[f32]),
    (sha256, provenance, image_index): (&str, PreviewSource, usize),
    colour: &[&AtlasTexture],
    blocks: bool,
) -> std::result::Result<Baked, &'static str> {
    let blocks = blocks && !o.texture_formats.is_empty();
    let file = if blocks {
        BlockFormat::STORED.file_name(Layout::Hdr)
    } else {
        HALF_FILE
    };
    let levels = {
        let _t = crate::support::perf::Timer::new(crate::support::perf::Phase::TextureBake);
        hdr::chain(width, height, data)
    };
    let first_level = preview_first_level(width, height);
    let key = key(sha256, file);
    let encode = |level: usize, (w, h): (u32, u32)| {
        if blocks {
            tile_records(&encode_hdr(&levels[level], w, h), w, h, BLOCK_CELL)
        } else {
            tile_records(&levels[level], w, h, HALF_CELL)
        }
    };
    let written = {
        let _t = crate::support::perf::Timer::new(crate::support::perf::Phase::TextureWrite);
        write_levels(
            o,
            &key,
            AtlasKind::Hdr,
            (width, height),
            file,
            first_level,
            |level, size| Ok(encode(level, size)),
        )
    };
    let mut notes = Vec::new();
    if written.is_err() {
        notes.push(LEVEL_WRITE_FAILED);
    }
    let baked_levels = written.as_ref().map_or(0, |&count| count);
    let pixels = levels[first_level as usize..].concat();
    // The tail's blocks, kept only with the files they sit beside.
    let (layouts, tail) = stored_family(
        Layout::Hdr,
        (blocks && written.is_ok()).then(|| {
            (first_level as usize..levels.len())
                .flat_map(|level| {
                    let (w, h) = preview_level_size(width, height, level as u32);
                    encode_hdr(&levels[level], w, h)
                })
                .collect()
        }),
    );
    finish(
        colour,
        ((width, height), provenance, image_index),
        Written {
            key: &key,
            kind: AtlasKind::Hdr,
            levels: (first_level, baked_levels),
            pixels: &pixels,
            layouts,
            blocks: &tail,
            notes,
        },
    )
}
