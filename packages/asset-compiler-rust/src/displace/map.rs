//! A displacement map: a height image of at most `MAX_DISPLACEMENT_MAP_SIZE` texels a side, its
//! first channel read as a height, and what a displacement reads of it — the height at a point
//! (`DisplacementMap::sample`), bilinearly filtered over the half-texel-shifted grid, and the range
//! of heights a rectangle of the image reaches (`DisplacementMap::bounds`), from a chain of the
//! least and the most of each block of texels, level by level (`mips`). Both are the displacement
//! itself: a height less the map's `center`, times its `magnitude`.
//!
//! The image and its chain (`HeightImage`) hold heights only, each as its source holds it — a byte,
//! a 16-bit word or a float —, and are shared by every map that reads the texture, whatever its
//! magnitude and centre (`DisplacementMap::over`).
use super::abi::MAX_DISPLACEMENT_MAP_SIZE;
use std::sync::Arc;

/// The heights of an image's first channel, each as its source holds it: a byte over 255, a 16-bit
/// word over 65535, a float as it is.
#[derive(Debug)]
pub(crate) enum Heights {
    Bytes(Vec<u8>),
    Words(Vec<u16>),
    Floats(Vec<f32>),
}

impl Heights {
    fn len(&self) -> usize {
        match self {
            Self::Bytes(heights) => heights.len(),
            Self::Words(heights) => heights.len(),
            Self::Floats(heights) => heights.len(),
        }
    }

    /// The height of texel `at`.
    fn get(&self, at: usize) -> f32 {
        match self {
            Self::Bytes(heights) => f32::from(heights[at]) / 255.0,
            Self::Words(heights) => f32::from(heights[at]) / 65535.0,
            Self::Floats(heights) => heights[at],
        }
    }
}

/// A height image and the chain of the least and the most height of its blocks.
#[derive(Debug)]
pub(crate) struct HeightImage {
    width: usize,
    height: usize,
    /// Whether each axis wraps past the image's edge, else it holds its last texel.
    wrap: [bool; 2],
    /// The levels of the chain, the image's own the first: one past the cells' levels.
    levels: u32,
    /// The height of each texel, row by row from the top.
    texels: Heights,
    /// The least and the most height of each cell of each level from the second, the cells of a
    /// level a block of two by two of the one before it, those at the edge of an odd side one wide.
    mips: Vec<Vec<[f32; 2]>>,
}

impl HeightImage {
    /// The image of the `texels` of `width` by `height`, `wrap` saying for each axis whether it
    /// wraps; none for an image that has no texel, or more than `MAX_DISPLACEMENT_MAP_SIZE` on a
    /// side, or the wrong number of texels, which displaces nothing (`DisplacementMap::over`).
    pub(crate) fn new(
        texels: Heights,
        (width, height): (usize, usize),
        wrap: [bool; 2],
    ) -> Option<Arc<Self>> {
        let size = MAX_DISPLACEMENT_MAP_SIZE;
        let fits = (1..=size).contains(&width) && (1..=size).contains(&height);
        if !fits || texels.len() != width * height {
            return None;
        }
        let mut image = Self {
            width,
            height,
            wrap,
            levels: 1,
            texels,
            mips: Vec::new(),
        };
        image.chain();
        Some(Arc::new(image))
    }

    /// The image of one black texel.
    fn blank() -> Arc<Self> {
        Arc::new(Self {
            width: 1,
            height: 1,
            wrap: [true; 2],
            levels: 1,
            texels: Heights::Floats(vec![0.0]),
            mips: Vec::new(),
        })
    }

    /// The chain of the least and the most height, from 2 × 2 blocks of the image, then of each
    /// level, to a level of one cell; none for an image of one texel.
    fn chain(&mut self) {
        if self.width == 1 && self.height == 1 {
            return;
        }
        let (mut before_x, mut before_y) = (self.width, self.height);
        let mut level = 1;
        loop {
            let cells_x = self.cells(self.width, level);
            let cells_y = self.cells(self.height, level);
            let mut cells = Vec::with_capacity(cells_x * cells_y);
            for y in 0..cells_y {
                for x in 0..cells_x {
                    let (x0, y0) = (2 * x, 2 * y);
                    let (x1, y1) = ((x0 + 1).min(before_x - 1), (y0 + 1).min(before_y - 1));
                    let block = [(x0, y0), (x1, y0), (x0, y1), (x1, y1)];
                    cells.push(self.block(&block, before_x, level));
                }
            }
            self.mips.push(cells);
            (before_x, before_y) = (cells_x, cells_y);
            self.levels += 1;
            if cells_x == 1 && cells_y == 1 {
                return;
            }
            level += 1;
        }
    }

    /// The cells along a side of `texels` at `level` (from 1).
    fn cells(&self, texels: usize, level: u32) -> usize {
        ((texels - 1) >> level) + 1
    }

    /// The least and the most height of the four cells `block` of the level below `level`, the
    /// level below laid `across` cells wide: the texels themselves under the first level.
    fn block(&self, block: &[(usize, usize); 4], across: usize, level: u32) -> [f32; 2] {
        let mut range = [f32::INFINITY, f32::NEG_INFINITY];
        for &(x, y) in block {
            let [low, high] = match level {
                1 => [self.texels.get(x + y * self.width); 2],
                _ => self.mips[level as usize - 2][x + y * across],
            };
            range = [range[0].min(low), range[1].max(high)];
        }
        range
    }

    /// The texel `(x, y)` of the image brought back inside it: held at its edge, or wrapped around
    /// it, by axis.
    fn address(&self, x: i64, y: i64) -> (usize, usize) {
        let along = |at: i64, size: usize, wrap: bool| {
            let size = size as i64;
            let inside = if wrap {
                at.rem_euclid(size)
            } else {
                at.clamp(0, size - 1)
            };
            inside as usize
        };
        (
            along(x, self.width, self.wrap[0]),
            along(y, self.height, self.wrap[1]),
        )
    }

    /// The height of the texel `(x, y)`.
    fn texel(&self, x: i64, y: i64) -> f32 {
        let (x, y) = self.address(x, y);
        self.texels.get(x + y * self.width)
    }

    /// The least and the most height of the cell of `level` (from 1) the texel `(x, y)` lies in.
    fn cell(&self, x: i64, y: i64, level: u32) -> [f32; 2] {
        let (x, y) = self.address(x, y);
        let across = self.cells(self.width, level);
        self.mips[level as usize - 1][(x >> level) + (y >> level) * across]
    }
}

/// A height image and the displacement it makes.
#[derive(Debug)]
pub(crate) struct DisplacementMap {
    image: Arc<HeightImage>,
    magnitude: f32,
    center: f32,
}

impl DisplacementMap {
    /// The map of `image` whose displacement is `(height − center) · magnitude`; the map of no
    /// image displaces nothing: one black texel, no magnitude.
    pub(crate) fn over(image: Option<Arc<HeightImage>>, (magnitude, center): (f32, f32)) -> Self {
        match image {
            Some(image) => Self {
                image,
                magnitude,
                center,
            },
            None => Self {
                image: HeightImage::blank(),
                magnitude: 0.0,
                center: 0.0,
            },
        }
    }

    /// The map of the float `texels` of an image of `width` by `height` (`HeightImage::new`).
    #[cfg(test)]
    pub(crate) fn new(
        texels: Vec<f32>,
        size: (usize, usize),
        displacement: (f32, f32),
        wrap: [bool; 2],
    ) -> Self {
        Self::over(
            HeightImage::new(Heights::Floats(texels), size, wrap),
            displacement,
        )
    }

    /// Whether `other` reads the very image this does.
    #[cfg(test)]
    pub(crate) fn shares(&self, other: &Self) -> bool {
        Arc::ptr_eq(&self.image, &other.image)
    }

    /// The texels along x and along y.
    pub(crate) fn size(&self) -> (usize, usize) {
        (self.image.width, self.image.height)
    }

    /// The displacement a height makes.
    fn displaced(&self, height: f32) -> f32 {
        (height - self.center) * self.magnitude
    }

    /// The displacement at the texel `(x, y)`.
    fn texel(&self, x: i64, y: i64) -> f32 {
        self.displaced(self.image.texel(x, y))
    }

    /// The displacements of the least and of the most height of the cell of `level` (from 1) the
    /// texel `(x, y)` lies in, either end the greater of the two where the magnitude is negative.
    fn cell(&self, x: i64, y: i64, level: u32) -> [f32; 2] {
        let [low, high] = self.image.cell(x, y, level);
        [self.displaced(low), self.displaced(high)]
    }

    /// The displacement at texture coordinates `uv`: the four texels around the point, on a grid
    /// shifted by half a texel, weighed bilinearly.
    pub(crate) fn sample(&self, uv: [f32; 2]) -> f32 {
        let x = uv[0] * self.image.width as f32 - 0.5;
        let y = uv[1] * self.image.height as f32 - 0.5;
        let (x0, y0) = (x.floor() as i64, y.floor() as i64);
        let (x1, y1) = (x0.saturating_add(1), y0.saturating_add(1));
        let wx1 = x - x0 as f32;
        let wy1 = y - y0 as f32;
        let (wx0, wy0) = (1.0 - wx1, 1.0 - wy1);
        self.texel(x0, y0) * wx0 * wy0
            + self.texel(x1, y0) * wx1 * wy0
            + self.texel(x0, y1) * wx0 * wy1
            + self.texel(x1, y1) * wx1 * wy1
    }

    /// The least and the most displacement the texture coordinates of the rectangle from `low` to
    /// `high` reach, bilinear filtering included: the four texels, or cells of the level whose
    /// cell is wide enough that they cover the rectangle, around its corners.
    pub(crate) fn bounds(&self, low: [f32; 2], high: [f32; 2]) -> [f32; 2] {
        let scaled = |uv: [f32; 2]| {
            [
                uv[0] * self.image.width as f32 - 0.5,
                uv[1] * self.image.height as f32 - 0.5,
            ]
        };
        let (low, high) = (scaled(low), scaled(high));
        let (x0, y0) = (low[0].floor() as i64, low[1].floor() as i64);
        let (x1, y1) = (
            (high[0].floor() as i64).saturating_add(1),
            (high[1].floor() as i64).saturating_add(1),
        );
        let wide = x1.saturating_sub(x0).max(y1.saturating_sub(y0));
        let wide = wide.clamp(0, i64::from(u32::MAX)) as u32;
        let mut level = wide.checked_ilog2().unwrap_or(0);
        let straddles = |from: i64, to: i64| (to >> level) - (from >> level) > 1;
        if straddles(x0, x1) || straddles(y0, y1) {
            level += 1;
        }
        level = level.min(self.image.levels - 1);
        let corners = [(x0, y0), (x1, y0), (x0, y1), (x1, y1)];
        let mut range = [f32::INFINITY, f32::NEG_INFINITY];
        for (x, y) in corners {
            let [near, far] = match level {
                0 => [self.texel(x, y); 2],
                _ => self.cell(x, y, level),
            };
            range = [range[0].min(near).min(far), range[1].max(near).max(far)];
        }
        range
    }
}
