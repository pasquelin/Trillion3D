//! An atlas made ready for the card: empty texels dilated inside their frame, every map's mip
//! chain reduced by the texture rule (`texture_preview::reduce::chain`) down to frames of four
//! texels — the colour map as a coverage chain, whose levels keep level 0's coverage (#44) —,
//! each level stored as a
//! lossless PNG object, content-addressed like every cache object.
use super::bake::Atlas;
use crate::cutout::CUTOUT_ALPHA;
use crate::physics_cook::cut::store_shape;
use crate::texture_preview::coverage::cutoff_byte;
use crate::texture_preview::{png, preview_level_size, reduce::chain, AtlasKind};
use crate::{Options, Result};
use rayon::prelude::*;
use serde_json::{json, Value};
use std::collections::VecDeque;

/// Smallest frame side a level keeps, in texels. Below it a bilinear tap of a frame reads its
/// neighbours, views of other directions, and the coverage rule's median of four holds opaque
/// texels no scale cuts (a 64-texel frame at 2 texels: 0.272 covered against 0.249 at level 0):
/// the chain stops there, and a smaller card samples its last level.
pub(crate) const FRAME_FLOOR: usize = 4;

/// The maps' names in the report, and the chain each is reduced as.
pub(crate) fn kinds() -> [(&'static str, AtlasKind); 3] {
    [
        (
            "colourCoverage",
            AtlasKind::Coverage(cutoff_byte(CUTOUT_ALPHA as f32, 1.0)),
        ),
        ("normalDepth", AtlasKind::Data),
        ("orm", AtlasKind::Data),
    ]
}

impl Atlas {
    /// Every empty texel takes the maps of the nearest covered one of its own frame (breadth
    /// first), coverage kept at 0: filtering at a silhouette then blends no black fringe, and
    /// the texel of another frame never bleeds in.
    pub fn dilate(&mut self) {
        let (frame, side) = (self.capture.side, self.side);
        let covered = |maps: &[Vec<u8>; 3], t: usize| maps[0][t * 4 + 3] > 0;
        let mut filled: Vec<bool> = (0..side * side).map(|t| covered(&self.maps, t)).collect();
        let mut queue: VecDeque<usize> = (0..side * side).filter(|&t| filled[t]).collect();
        while let Some(t) = queue.pop_front() {
            let (x, y) = (t % side, t / side);
            let (fx, fy) = (x - x % frame, y - y % frame);
            let steps = [(-1i64, 0i64), (1, 0), (0, -1), (0, 1)];
            for (dx, dy) in steps {
                let (nx, ny) = (x as i64 + dx, y as i64 + dy);
                let inside = |v: i64, f: usize| v >= f as i64 && v < (f + frame) as i64;
                if !inside(nx, fx) || !inside(ny, fy) {
                    continue;
                }
                let n = ny as usize * side + nx as usize;
                if filled[n] {
                    continue;
                }
                filled[n] = true;
                for (m, map) in self.maps.iter_mut().enumerate() {
                    let texel: [u8; 4] = std::array::from_fn(|c| map[t * 4 + c]);
                    let alpha = if m == 0 { 0 } else { texel[3] };
                    map[n * 4..n * 4 + 4].copy_from_slice(&[texel[0], texel[1], texel[2], alpha]);
                }
                queue.push_back(n);
            }
        }
    }

    /// The mip chain of map `m`, level 0 first, down to frames of `FRAME_FLOOR` texels a side.
    pub fn chain(&self, m: usize) -> Vec<Vec<u8>> {
        let side = self.side as u32;
        let image = image::RgbaImage::from_raw(side, side, self.maps[m].clone())
            .expect("an atlas map holds side² RGBA8 texels");
        let mut levels = chain(&image, kinds()[m].1);
        levels.truncate((self.capture.side / FRAME_FLOOR).ilog2() as usize + 1);
        levels
    }

    /// Stores every level of every map, the three in parallel; returns the report's `maps`, one
    /// object a map, each with its chain kind and one descriptor a level, and their bytes.
    pub fn store(&self, o: &Options) -> Result<(Value, usize)> {
        if let Some(objects) = crate::compiler_storage::object_path(o, "").parent() {
            std::fs::create_dir_all(objects)?;
        }
        let map = |m: usize| -> Result<(Value, usize)> {
            let (mut levels, mut bytes) = (Vec::new(), 0);
            for (level, pixels) in self.chain(m).iter().enumerate() {
                let size = preview_level_size(self.side as u32, self.side as u32, level as u32);
                let mut descriptor = store_shape(o, &png(pixels, size)?)?;
                bytes += descriptor["bytes"].as_u64().unwrap_or(0) as usize;
                descriptor["width"] = json!(size.0);
                descriptor["height"] = json!(size.1);
                levels.push(descriptor);
            }
            Ok((
                json!({"kind": kinds()[m].1.name(), "levels": levels}),
                bytes,
            ))
        };
        let stored: Vec<(Value, usize)> = (0..3).into_par_iter().map(map).collect::<Result<_>>()?;
        let mut maps = serde_json::Map::new();
        for ((name, _), (entry, _)) in kinds().into_iter().zip(&stored) {
            maps.insert(name.into(), entry.clone());
        }
        Ok((Value::Object(maps), stored.iter().map(|s| s.1).sum()))
    }
}
