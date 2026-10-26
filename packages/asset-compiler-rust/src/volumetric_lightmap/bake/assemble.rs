//! The layers of a baked volume as the file holds them (`format.rs`): where the finest bricks
//! stream by cells (`loadingCellSize`), the layers hold the coarser bricks alone — the indirection
//! volume then points every finest brick's place at the coarser brick over it — and each cell
//! holds the padded texels of its finest bricks.
use super::layout::{brick_origin, each_texel, texel_in, Layout, PADDED};
use super::settings::{BakeSettings, BRICK_SIZE};
use super::store::Store;
use super::trim::without;
use crate::volumetric_lightmap::{LightmapCell, VolumetricLightmapLayers};
use rayon::prelude::*;
use std::collections::BTreeMap;

/// The layers of `store`, laid out as `layout`, whole: every brick always loaded.
fn whole(layout: &Layout, store: &Store) -> VolumetricLightmapLayers {
    let bytes = |texels: &[[u8; 4]]| texels.iter().flatten().copied().collect::<Vec<u8>>();
    let high = [0, 1, 2].map(|k| layout.volume_min[k] + layout.volume_size[k]);
    VolumetricLightmapLayers {
        bounds: (layout.volume_min.map(|c| c as f32), high.map(|c| c as f32)),
        brick_size: BRICK_SIZE,
        indirection_dimensions: layout.indirection_dims,
        brick_dimensions: store.dims.map(|d| d as u32),
        indirection: layout.indirection.iter().flatten().copied().collect(),
        ambient: store.ambient.iter().flat_map(|a| a.to_le_bytes()).collect(),
        coefficients: std::array::from_fn(|k| bytes(&store.coefficients[k])),
        sky_bent_normal: if store.bent.is_empty() {
            Vec::new()
        } else {
            bytes(&store.bent)
        },
        directional_shadowing: store.shadowing.clone(),
        cell_texels: 0,
        cells: Vec::new(),
    }
}

/// The cell of the finest bricks `ranks`, the padded texels of each copied out of the atlas.
fn cell_of(
    layout: &Layout,
    store: &Store,
    (coordinates, ranks): ([u32; 3], &[usize]),
) -> LightmapCell {
    let texels = ranks.len() * PADDED.pow(3) as usize;
    let sky = if store.bent.is_empty() { 0 } else { texels * 4 };
    let mut cell = LightmapCell {
        coordinates,
        bricks: Vec::with_capacity(ranks.len()),
        ambient: Vec::with_capacity(texels * 4),
        coefficients: std::array::from_fn(|_| Vec::with_capacity(texels * 4)),
        sky_bent_normal: Vec::with_capacity(sky),
        directional_shadowing: Vec::with_capacity(texels),
    };
    for &rank in ranks {
        cell.bricks.push(layout.bricks[rank].position);
        let origin = brick_origin(rank);
        each_texel(|inside| store.push_texel_bytes(texel_in(store, origin, inside), &mut cell));
    }
    cell
}

/// The file's layers of the stitched `store`: whole, or the coarser bricks and the finest ones by
/// cell, as the settings say.
pub fn layers_of(
    layout: &Layout,
    store: &Store,
    settings: &BakeSettings,
) -> VolumetricLightmapLayers {
    let finest = layout.finest();
    let Some(side) = settings.cell_texels().filter(|_| !finest.is_empty()) else {
        return whole(layout, store);
    };
    // Keyed by (z, y, x) so the cells come in the file's order.
    let mut grouped: BTreeMap<(u32, u32, u32), Vec<usize>> = BTreeMap::new();
    for &rank in &finest {
        let [x, y, z] = layout.bricks[rank].position.map(|p| p / side);
        grouped.entry((z, y, x)).or_default().push(rank);
    }
    let groups: Vec<_> = grouped
        .into_iter()
        .map(|((z, y, x), ranks)| ([x, y, z], ranks))
        .collect();
    let dropped: Vec<bool> = (0..layout.bricks.len())
        .map(|r| layout.is_finest(r))
        .collect();
    let (base_layout, base_store) = without(layout, store, &dropped);
    let mut layers = whole(&base_layout, &base_store);
    layers.cell_texels = side;
    layers.cells = groups
        .par_iter()
        .map(|(coordinates, ranks)| cell_of(layout, store, (*coordinates, ranks)))
        .collect();
    layers
}
