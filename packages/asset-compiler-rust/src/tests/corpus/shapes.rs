//! Base surfaces of the corpus, each parameterised and drawn from the seed.
use super::*;

/// The quads a corpus sheet is cut into, unless the case needs another shape.
pub(super) const NX: usize = 64;
pub(super) const NY: usize = 64;

/// The relief amplitude of a case, drawn from its seed: never flat, never a cliff.
pub(super) fn amplitude(rng: &mut Xorshift) -> f32 {
    1.0 + rng.unit() * 4.0
}

/// A displaced grid of `(nx + 1) × (ny + 1)` vertices, `nx × ny` quads of two triangles.
pub(super) struct Sheet {
    pub nx: usize,
    pub positions: Vec<f32>,
    pub indices: Vec<u32>,
}
impl Sheet {
    /// The sheet's relief: a portable sine of the given amplitude, its frequencies and phases
    /// drawn from the seed.
    pub fn new(rng: &mut Xorshift, nx: usize, ny: usize, amplitude: f32) -> Self {
        let relief = Relief::new(rng, amplitude);
        let mut positions = Vec::with_capacity((nx + 1) * (ny + 1) * 3);
        for y in 0..=ny {
            for x in 0..=nx {
                positions.extend([x as f32, y as f32, relief.at(x, y)]);
            }
        }
        Sheet {
            nx,
            positions,
            indices: grid_indices(nx, ny, |x, y| (y * (nx + 1) + x) as u32),
        }
    }
    pub fn vertex(&self, x: usize, y: usize) -> u32 {
        (y * (self.nx + 1) + x) as u32
    }
    pub fn x_of(&self, vertex: usize) -> usize {
        vertex % (self.nx + 1)
    }
    pub fn y_of(&self, vertex: usize) -> usize {
        vertex / (self.nx + 1)
    }
}

/// The relief every sheet shares: `amplitude · sin(fx·x + px) · sin(fy·y + py)`.
pub(super) struct Relief {
    amplitude: f32,
    frequency: [f32; 2],
    phase: [f32; 2],
}
impl Relief {
    pub fn new(rng: &mut Xorshift, amplitude: f32) -> Self {
        Relief {
            amplitude,
            frequency: [0.2 + rng.unit() * 0.2, 0.2 + rng.unit() * 0.2],
            phase: [rng.unit() * 6.0, rng.unit() * 6.0],
        }
    }
    pub fn at(&self, x: usize, y: usize) -> f32 {
        self.amplitude
            * portable_sin(x as f32 * self.frequency[0] + self.phase[0])
            * portable_sin(y as f32 * self.frequency[1] + self.phase[1])
    }
}

/// A sheet in which every quad owns its four vertices, quad-major: vertex `4q + c` is corner
/// `c` (`c & 1` along x, `c >> 1` along y) of quad `q`. Positions coincide, indices never meet.
pub(super) struct Exploded {
    pub nx: usize,
    pub positions: Vec<f32>,
    pub indices: Vec<u32>,
}
impl Exploded {
    pub fn new(rng: &mut Xorshift, nx: usize, ny: usize, amplitude: f32) -> Self {
        let relief = Relief::new(rng, amplitude);
        let mut positions = Vec::with_capacity(nx * ny * 12);
        let mut indices = Vec::with_capacity(nx * ny * 6);
        for y in 0..ny {
            for x in 0..nx {
                let first = (positions.len() / 3) as u32;
                for corner in 0..4 {
                    let (cx, cy) = (x + (corner & 1), y + (corner >> 1));
                    positions.extend([cx as f32, cy as f32, relief.at(cx, cy)]);
                }
                indices.extend([first, first + 1, first + 2, first + 1, first + 3, first + 2]);
            }
        }
        Exploded {
            nx,
            positions,
            indices,
        }
    }
    /// The quad a vertex belongs to, as `(x, y)`.
    pub fn quad_of(&self, vertex: usize) -> (usize, usize) {
        let quad = vertex / 4;
        (quad % self.nx, quad / self.nx)
    }
    /// The corner of its quad a vertex is, as `(0 | 1, 0 | 1)`.
    pub fn corner_of(vertex: usize) -> (usize, usize) {
        ((vertex % 4) & 1, (vertex % 4) >> 1)
    }
}

/// A sheet cut into vertical bands of `width` columns: the column two bands meet on is written
/// once per band, so an attribute may step there. `band[v]` names the band of vertex `v`.
pub(super) struct Banded {
    pub positions: Vec<f32>,
    pub indices: Vec<u32>,
    pub x: Vec<usize>,
    pub y: Vec<usize>,
    pub band: Vec<usize>,
}
impl Banded {
    pub fn new(rng: &mut Xorshift, nx: usize, ny: usize, amplitude: f32, width: usize) -> Self {
        let relief = Relief::new(rng, amplitude);
        let (mut positions, mut x, mut y, mut band, mut indices) =
            (Vec::new(), Vec::new(), Vec::new(), Vec::new(), Vec::new());
        let bands = nx.div_ceil(width);
        for b in 0..bands {
            let (from, to) = (b * width, ((b + 1) * width).min(nx));
            let first = x.len();
            let columns = to - from + 1;
            for row in 0..=ny {
                for column in from..=to {
                    positions.extend([column as f32, row as f32, relief.at(column, row)]);
                    x.push(column);
                    y.push(row);
                    band.push(b);
                }
            }
            let mut local =
                grid_indices(to - from, ny, |cx, cy| (first + cy * columns + cx) as u32);
            indices.append(&mut local);
        }
        Banded {
            positions,
            indices,
            x,
            y,
            band,
        }
    }
}

/// Unit normal of the quad whose first vertex is `first`, from its two edges.
pub(super) fn face_normal(positions: &[f32], first: usize) -> [f32; 3] {
    let p = |v: usize| [positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]];
    let (a, b, c) = (p(first), p(first + 1), p(first + 2));
    let (u, w) = (
        [b[0] - a[0], b[1] - a[1], b[2] - a[2]],
        [c[0] - a[0], c[1] - a[1], c[2] - a[2]],
    );
    let n = [
        u[1] * w[2] - u[2] * w[1],
        u[2] * w[0] - u[0] * w[2],
        u[0] * w[1] - u[1] * w[0],
    ];
    let length = (n[0] * n[0] + n[1] * n[1] + n[2] * n[2]).sqrt();
    n.map(|c| c / length)
}
