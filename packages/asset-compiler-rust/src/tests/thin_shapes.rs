//! A family of scenes of thin closed shapes the tests generate, every one a building in small: a
//! box for its ground floor; walls of octagonal logs, with slabs and a row of upright boards
//! standing apart from each other and from the rest, like an arcade's columns; and a roof of
//! staggered shingles lapped by a third of their length under a ridge cap, thousands of closed
//! parts each below a coarse level's error that together cover a wide surface. Every part is a
//! closed solid facing out (`closed_solids.rs`). Drawn from a seed, a case is the same bytes on
//! every platform.
use super::closed_solids::{block, log, slab};
use super::random::Xorshift;
use super::scene_document::{SceneDocument, Surface};

/// One case of the family, in metres.
#[derive(Clone, Debug)]
pub(crate) struct ThinShapes {
    /// The box's footprint and height.
    pub width: f64,
    pub depth: f64,
    pub ground: f64,
    /// Logs on each wall, their radius and the quads along one.
    pub logs: usize,
    pub log_radius: f64,
    pub log_segments: usize,
    /// How far the slab on each long side reaches past the logs, the boards along its outer
    /// edge, their height and the slab's and boards' thickness.
    pub reach: f64,
    pub boards: usize,
    pub board_height: f64,
    pub slab: f64,
    /// The roof: the ridge's rise above the eaves, the overhang past the walls, a shingle's
    /// width and its length along the slope, and its thickness.
    pub rise: f64,
    pub overhang: f64,
    pub shingle: [f64; 2],
    pub thickness: f64,
}

impl ThinShapes {
    /// The first case: boards 1.08 m across standing 0.4 m apart, logs 0.24 m wide, a roof of
    /// shingles 0.6 by 0.5 m.
    pub const FIRST: ThinShapes = ThinShapes {
        width: 8.0,
        depth: 6.0,
        ground: 2.8,
        logs: 6,
        log_radius: 0.12,
        log_segments: 8,
        reach: 1.3,
        boards: 10,
        board_height: 1.0,
        slab: 0.1,
        rise: 2.6,
        overhang: 1.0,
        shingle: [0.6, 0.5],
        thickness: 0.03,
    };

    /// A case drawn from `seed`: every size within a building's range, none hand-picked.
    pub fn drawn(seed: u64) -> ThinShapes {
        let mut rng = Xorshift::new(seed.wrapping_mul(trillion3d_math::GOLDEN));
        let mut within = |low: f64, high: f64| low + f64::from(rng.unit()) * (high - low);
        ThinShapes {
            width: within(6.0, 12.0),
            depth: within(5.0, 9.0),
            ground: within(2.4, 3.4),
            logs: within(4.0, 8.99) as usize,
            log_radius: within(0.09, 0.16),
            log_segments: within(6.0, 12.99) as usize,
            reach: within(0.9, 1.6),
            boards: within(8.0, 16.99) as usize,
            board_height: within(0.8, 1.3),
            slab: within(0.06, 0.14),
            rise: within(1.8, 3.4),
            overhang: within(0.5, 1.3),
            shingle: [within(0.4, 0.7), within(0.35, 0.6)],
            thickness: within(0.02, 0.05),
        }
    }

    /// The family the scene tests cook: the first case and two drawn.
    pub fn family() -> [ThinShapes; 3] {
        [Self::FIRST, Self::drawn(1), Self::drawn(2)]
    }

    /// The ground floor: one box, twelve triangles.
    fn ground_floor(&self) -> Surface {
        let (w, d) = (self.width / 2.0, self.depth / 2.0);
        slab([-w, 0.0, -d], [w, self.ground, d])
    }

    /// The walls of logs, and on each long side a slab reaching past them with its row of
    /// boards, each board apart from the others.
    fn wood(&self) -> Surface {
        let (w, d, r) = (self.width / 2.0, self.depth / 2.0, self.log_radius);
        let mut parts = Vec::new();
        for k in 0..self.logs {
            let y = self.ground + r * (1 + 2 * k) as f64;
            for side in [-1.0, 1.0] {
                let length = self.width + 2.0 * r;
                parts.push(log(0, [-w - r, y, side * d], length, r, self.log_segments));
                parts.push(log(2, [side * w, y, -d], self.depth, r, self.log_segments));
            }
        }
        let pitch = self.width / self.boards as f64;
        for side in [-1.0, 1.0] {
            let (inner, outer) = (d + r, d + self.reach);
            let z = |a: f64, b: f64| if side > 0.0 { (a, b) } else { (-b, -a) };
            let (z0, z1) = z(inner, outer);
            let (b0, b1) = z(outer - self.slab, outer);
            let top = self.ground + self.slab;
            parts.push(slab([-w, self.ground, z0], [w, top, z1]));
            for board in 0..self.boards {
                let x = -w + board as f64 * pitch;
                let height = top + self.board_height;
                parts.push(slab([x, top, b0], [x + pitch / 2.0, height, b1]));
            }
        }
        Surface::merged(&parts)
    }

    /// The roof over the walls, ridge along x: two slopes of staggered shingles, each row
    /// lapping the one below by a third of a shingle's length, under a ridge cap.
    fn roof(&self) -> Surface {
        let eaves = self.ground + 2.0 * self.log_radius * self.logs as f64;
        let run = self.depth / 2.0 + self.overhang;
        let slope = (self.rise * self.rise + run * run).sqrt();
        let (cos, sin) = (run / slope, self.rise / slope);
        let along = self.width + 2.0 * self.overhang;
        let [bw, bl] = self.shingle;
        let lap = bl * (2.0 / 3.0);
        let rows = ((slope - bl) / lap).ceil() as usize + 1;
        let mut parts = Vec::new();
        for side in [1.0, -1.0] {
            for row in 0..rows {
                let s = (slope - bl / 2.0).min(bl / 2.0 + row as f64 * lap);
                let odd = (row % 2) as f64;
                let start = -along / 2.0 - odd * bw / 2.0 + bw / 2.0;
                let y = eaves + self.rise - s * sin + 0.02 + odd * 0.005;
                let z = side * s * cos;
                let count = (along / bw).ceil() as usize + row % 2;
                for k in 0..count {
                    let x = (start + k as f64 * bw)
                        .clamp(-along / 2.0 + bw / 4.0, along / 2.0 - bw / 4.0);
                    let size = [bw * 0.94, self.thickness, bl];
                    parts.push(block(size, [x, y, z], (cos, side * sin)));
                }
            }
        }
        let top = eaves + self.rise + 0.04;
        parts.push(slab(
            [-along / 2.0, top - 0.06, -0.17],
            [along / 2.0, top + 0.06, 0.17],
        ));
        Surface::merged(&parts)
    }

    /// The case's three primitives: the ground floor, the wood, the roof.
    pub fn surfaces(&self) -> [Surface; 3] {
        [self.ground_floor(), self.wood(), self.roof()]
    }

    /// The case as a document of one mesh, one primitive per surface, each its own material;
    /// its buffer is `<tag>.bin`.
    pub fn document(&self, tag: &str) -> (serde_json::Value, Vec<u8>) {
        let mut document = SceneDocument::default();
        let surfaces = self.surfaces();
        let colours = [[0.9, 0.88, 0.82], [0.42, 0.27, 0.15], [0.3, 0.22, 0.17]];
        let materials = colours.map(|colour| document.material(colour, None));
        let primitives: Vec<_> = surfaces.iter().zip(materials).collect();
        let mesh = document.mesh(&primitives);
        document.node(mesh, [0.0; 3]);
        document.finish(tag)
    }
}
