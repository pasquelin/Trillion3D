//! The simplified mesh's triangles laid out at their atlas coordinates on a grid of texels
//! (`Raster`), as the method maps a texel to the mesh: the grid the atlas's side times the samples
//! a side, each triangle's box of texels widened by a padding and held inside the grid, a triangle
//! of the mesh without area (four times its squared area under a millionth of a square
//! centimetre) skipped. A texel takes the first triangle, in the mesh's order, whose box holds it
//! and that holds its centre — every scaled distance at or past zero, so a counter-clockwise
//! triangle —, its barycentric weights there; a texel no such triangle holds takes the triangle
//! nearest its centre among those whose box holds it, the first of equal ones, at the point of
//! its edges nearest the centre (`Texel`).
//!
//! The grid is made a band of rows at a time (`Raster::band`), each band reading only the triangles
//! whose box meets it, in the mesh's order: the bands are independent, and each texel is what the
//! triangles taken in order leave in it.
use super::plane::{bounds, nearest, scaled, weights, Point};
use crate::hlod::flatten::simplify::proxy::Proxy;
use rayon::prelude::*;
use trillion3d_math::vector::vec3::cross;
use trillion3d_math::vector::vecn::{squared_length, sub};

/// Four times a triangle's squared area, square centimetres squared, under which it has none.
const FLAT: f64 = 1e-6;

/// What a texel maps to: the triangle, none (`-1`) when no triangle's box holds it; its distance to
/// it in the atlas's unit square, negative inside; its barycentric weights there.
#[derive(Clone, Copy)]
pub(super) struct Texel {
    pub distance: f64,
    pub triangle: i32,
    pub weights: [f64; 3],
}

impl Texel {
    /// A texel no triangle's box holds.
    const NONE: Self = Self {
        distance: f64::MAX,
        triangle: -1,
        weights: [0.0; 3],
    };

    /// Whether a triangle holds the texel's centre.
    pub(super) fn inside(&self) -> bool {
        self.distance < 0.0
    }
}

/// A triangle as the raster lays it: its corners' atlas coordinates, and its box of texels, from
/// its low corner up to, not including, its high one.
struct Laid {
    corners: [Point; 3],
    low: [usize; 2],
    high: [usize; 2],
}

/// The mesh's triangles on a grid (module doc): the grid's side in texels, the rows a band holds,
/// each triangle laid out, none for one without area, and per band the triangles whose box meets
/// it, in order.
pub(super) struct Raster {
    pub width: usize,
    pub rows: usize,
    laid: Vec<Option<Laid>>,
    bands: Vec<Vec<u32>>,
}

/// Triangle `t` of `proxy` on a grid of `width` texels a side, its box widened by `padding`
/// texels; none when it has no area.
fn laid_out(proxy: &Proxy, t: usize, width: usize, padding: i32) -> Option<Laid> {
    let [a, b, c] = proxy.corners(t);
    let wedge = cross(sub(b, a).map(f64::from), sub(c, a).map(f64::from));
    if f64::from(squared_length(wedge) as f32) < FLAT {
        return None;
    }
    let ends = [0, 1, 2].map(|k| proxy.indices[3 * t + k] as usize);
    let corners = ends.map(|v| proxy.uvs[v].map(f64::from));
    let [low, high] = bounds(corners);
    let (side, most) = (width as f64, width as i32);
    let low = low.map(|x| ((x * side).floor() as i32 - padding).max(0) as usize);
    let high = high.map(|x| ((x * side).ceil() as i32 + padding).min(most).max(0) as usize);
    Some(Laid { corners, low, high })
}

impl Raster {
    /// `proxy`'s triangles on a grid of `side` times the side of `samples` (`⌈√samples⌉`) texels
    /// a side, each box widened by `padding` texels, a band as many rows as a side of samples.
    pub(super) fn of(proxy: &Proxy, side: usize, (padding, samples): (i32, usize)) -> Self {
        let rows = (samples as f32).sqrt().ceil() as usize;
        let width = side * rows;
        let laid: Vec<Option<Laid>> = (0..proxy.indices.len() / 3)
            .into_par_iter()
            .map(|t| laid_out(proxy, t, width, padding))
            .collect();
        let mut bands = vec![Vec::new(); side];
        for (t, each) in laid.iter().enumerate() {
            let Some(each) = each.as_ref().filter(|l| l.low[0] < l.high[0]) else {
                continue;
            };
            if each.low[1] < each.high[1] {
                let (first, last) = (each.low[1] / rows, (each.high[1] - 1) / rows);
                (first..=last).for_each(|b| bands[b].push(t as u32));
            }
        }
        Self {
            width,
            rows,
            laid,
            bands,
        }
    }

    /// The texels of band `band`, its rows in order, each row's texels in order (module doc).
    pub(super) fn band(&self, band: usize) -> Vec<Texel> {
        let mut texels = vec![Texel::NONE; self.rows * self.width];
        self.fill(band, &mut texels);
        texels
    }

    /// Every band's texels end to end, the bands made in parallel each in its own place.
    pub(super) fn all(&self) -> Vec<Texel> {
        let each = self.rows * self.width;
        let mut texels = vec![Texel::NONE; self.bands.len() * each];
        (texels.par_chunks_mut(each).enumerate()).for_each(|(band, out)| self.fill(band, out));
        texels
    }

    /// Band `band`'s texels written into `texels`, which hold no triangle yet.
    fn fill(&self, band: usize, texels: &mut [Texel]) {
        let delta = 1.0 / self.width as f64;
        let (top, bottom) = (band * self.rows, (band + 1) * self.rows);
        for &t in &self.bands[band] {
            let Some(laid) = &self.laid[t as usize] else {
                continue;
            };
            for y in laid.low[1].max(top)..laid.high[1].min(bottom) {
                for x in laid.low[0]..laid.high[0] {
                    let texel = &mut texels[(y - top) * self.width + x];
                    let centre = [delta * (x as f64 + 0.5), delta * (y as f64 + 0.5)];
                    taken(texel, t as i32, laid.corners, centre);
                }
            }
        }
    }
}

/// `texel`, of centre `centre`, as triangle `t` of corners `corners` leaves it (module doc).
fn taken(texel: &mut Texel, t: i32, corners: [Point; 3], centre: Point) {
    if texel.inside() {
        return;
    }
    let d = scaled(corners, centre);
    if d[0] >= 0.0 && d[1] >= 0.0 && d[2] >= 0.0 {
        *texel = Texel {
            distance: -1.0,
            triangle: t,
            weights: weights(corners, d),
        };
        return;
    }
    let (point, squared) = nearest(corners, centre);
    let distance = squared.sqrt();
    if distance < texel.distance {
        *texel = Texel {
            distance,
            triangle: t,
            weights: weights(corners, scaled(corners, point)),
        };
    }
}
