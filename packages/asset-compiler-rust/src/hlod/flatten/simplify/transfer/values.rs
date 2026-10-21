//! The transfer's grid of values (`Values`), texel by texel, row by row: the base colour, and
//! each other image where the layer's maps bake it — the coverage (the base image's alpha, the
//! opacity or the mask), the normal, the metal-roughness map's specular, roughness and metallic
//! together, the emission —, and which texels hold a valid value; grown into the texels none holds
//! (`dilated`, or, without dilation, `defaulted`), down sampled to each image's own side
//! (`downsampled`) and written as bytes.
use super::colour::{quantized, srgb, Linear};
use super::row::Row;
use super::{dilate, resample};
use crate::dag::srgb_byte;
use crate::hlod::flatten::bake::{Coverage, Maps, METALLIC, ROUGHNESS};
use crate::hlod::flatten::Sides;
use crate::plugins::scene::cancel::check;
use std::sync::atomic::AtomicBool;
use trillion3d_math::scalar::unit_to_byte;

/// What a texel no valid value reaches holds without dilation: opaque black, and the frame's own
/// normal — tangent-space up —; no coverage, zero specular, roughness, metallic and emission.
const BLACK: Linear = [0.0, 0.0, 0.0, 1.0];
const UP: Linear = [0.5, 0.5, 1.0, 1.0];

/// The grid's values: each image's, and which texels hold a valid value. The metal-roughness
/// map's hold the specular, the roughness and the metallic, in that order.
pub(super) struct Values {
    base: Vec<Linear>,
    coverage: Option<Vec<[f32; 1]>>,
    normal: Option<Vec<Linear>>,
    metal: Option<Vec<[f32; 3]>>,
    emission: Option<Vec<Linear>>,
    valid: Vec<bool>,
}

/// `grid`, `from` texels square, down sampled to `to` texels square where the two differ;
/// whether it was.
fn reduced<const N: usize>(grid: &mut Vec<[f32; N]>, from: usize, to: usize) -> bool {
    if to == from {
        return false;
    }
    *grid = resample::downsampled(grid.as_slice(), from, to);
    true
}

impl Values {
    /// The grid's `rows` joined, the images `maps` bakes kept.
    pub(super) fn of(rows: Vec<Row>, maps: Maps) -> Self {
        let mut all = Row::default();
        for row in rows {
            all.base.extend(row.base);
            all.coverage.extend(row.coverage);
            all.normal.extend(row.normal);
            all.metal.extend(row.metal);
            all.emission.extend(row.emission);
            all.valid.extend(row.valid);
        }
        Self {
            base: all.base,
            coverage: (maps.coverage() != Coverage::Opaque).then_some(all.coverage),
            normal: maps.normal.then_some(all.normal),
            metal: maps.metal_rough().then_some(all.metal),
            emission: maps.emissive.then_some(all.emission),
            valid: all.valid,
        }
    }

    /// Every value grown ring by ring into the texels not yet valid (`dilate`), the grid `side`
    /// texels square, until none is left — or a ring fills nothing, where the method would go on
    /// forever; `Err` when `cancelled` is raised between two rings.
    pub(super) fn dilated(&mut self, side: usize, cancelled: &AtomicBool) -> crate::Result<()> {
        // The first ring from every texel, each next one from the neighbours of the last.
        let mut ring = match self.valid.contains(&false) {
            true => dilate::ring(&self.valid, side),
            false => Vec::new(),
        };
        while !ring.is_empty() {
            check(cancelled)?;
            dilate::fill(&mut self.base, side, &ring);
            if let Some(coverage) = &mut self.coverage {
                dilate::fill(coverage, side, &ring);
            }
            if let Some(normal) = &mut self.normal {
                dilate::fill(normal, side, &ring);
            }
            if let Some(metal) = &mut self.metal {
                dilate::fill(metal, side, &ring);
            }
            if let Some(emission) = &mut self.emission {
                dilate::fill(emission, side, &ring);
            }
            ring.iter().for_each(|&(at, _)| self.valid[at] = true);
            ring = dilate::next_ring(&self.valid, side, &ring);
        }
        Ok(())
    }

    /// Each texel not valid given the values of no dilation (`BLACK`, `UP`, zero).
    pub(super) fn defaulted(&mut self) {
        for at in (0..self.valid.len()).filter(|&at| !self.valid[at]) {
            self.base[at] = BLACK;
            if let Some(coverage) = &mut self.coverage {
                coverage[at] = [0.0];
            }
            if let Some(normal) = &mut self.normal {
                normal[at] = UP;
            }
            if let Some(metal) = &mut self.metal {
                metal[at] = [0.0; 3];
            }
            if let Some(emission) = &mut self.emission {
                emission[at] = [0.0; 4];
            }
        }
    }

    /// Every image down sampled from `from` texels square to its own side of `sides`
    /// (`resample`) — the coverage with the base colour —, the normal made unit again.
    pub(super) fn downsampled(&mut self, from: usize, sides: &Sides) {
        reduced(&mut self.base, from, sides.base);
        if let Some(coverage) = &mut self.coverage {
            reduced(coverage, from, sides.base);
        }
        if let Some(normal) = &mut self.normal {
            if reduced(normal, from, sides.normal) {
                resample::renormalized(normal);
            }
        }
        if let Some(metal) = &mut self.metal {
            reduced(metal, from, sides.metal_rough);
        }
        if let Some(emission) = &mut self.emission {
            reduced(emission, from, sides.emission);
        }
    }

    /// The base image's bytes: the colour in sRGB, the alpha the coverage where the maps bake one,
    /// else opaque.
    pub(super) fn base_bytes(&self) -> Vec<u8> {
        (0..self.base.len())
            .flat_map(|at| {
                let [r, g, b, _] = srgb(self.base[at]);
                let alpha = (self.coverage.as_ref()).map_or(255, |c| srgb_byte(c[at][0]));
                [r, g, b, alpha]
            })
            .collect()
    }

    /// The normal map's bytes, where the maps bake one: each channel quantized.
    pub(super) fn normal_bytes(&self) -> Option<Vec<u8>> {
        (self.normal.as_ref()).map(|n| n.iter().flat_map(|&c| quantized(c)).collect())
    }

    /// The metal-roughness map's bytes, where the maps bake one: a baked specular, roughness or
    /// metallic in sRGB, a specular not baked zero, a roughness or metallic not baked its constant.
    pub(super) fn metal_rough_bytes(&self, maps: Maps) -> Option<Vec<u8>> {
        let byte = |baked: bool, value: f32, constant: f64| match baked {
            true => srgb_byte(value),
            false => unit_to_byte(constant),
        };
        (self.metal.as_ref()).map(|metal| {
            metal
                .iter()
                .flat_map(|&[specular, roughness, metallic]| {
                    [
                        if maps.specular {
                            srgb_byte(specular)
                        } else {
                            0
                        },
                        byte(maps.roughness, roughness, ROUGHNESS),
                        byte(maps.metallic, metallic, METALLIC),
                        255,
                    ]
                })
                .collect()
        })
    }

    /// The emission map's bytes, where the maps bake one: each colour channel in sRGB, opaque.
    pub(super) fn emission_bytes(&self) -> Option<Vec<u8>> {
        (self.emission.as_ref()).map(|emission| {
            emission
                .iter()
                .flat_map(|&[r, g, b, _]| [srgb_byte(r), srgb_byte(g), srgb_byte(b), 255])
                .collect()
        })
    }
}
