//! The irradiance cache: the radiance that leaves a surface after a first bounce, remembered per
//! cell of a surface grid, so that a later path which meets the cell ends there with what its
//! cell holds. A cell is thin along its normal's main axis, so a wall's two faces and a thin
//! wall's two sides keep apart. The first passes of a bake place the cells and fill them; the
//! passes after read them. Lengths here are centimetres, the unit the cell's size is chosen in.
//!
//! The passes run side by side, so what a pass wants of the cache is told to `apply` once the
//! pass is over, and a cell is read by the pass after the one that wrote it: the same result at
//! every run, whatever the number of threads.
use super::sampling::Vec3;
use std::collections::HashMap;
use std::f64::consts::PI;
use trillion3d_math::vector::vecn::{length, sub};

/// The records the cache holds before it reuses the oldest.
const CAPACITY: u64 = 4_194_304;
/// The texels of a lightmap tile (a 64-texel tile and its two-texel border): the cache sizes its
/// expectations for a cell by them.
const TILE_TEXELS: f64 = 68.0 * 68.0;
/// The passes that place cells; after them cells are only read.
const PLACING_PASSES: u32 = 16;
/// The samples a cell needs once the cache is only read.
const READ_SAMPLES: u32 = 4;
const CENTIMETRES: f64 = 100.0;

/// What the cache is asked to be.
#[derive(Clone, Copy)]
pub struct CacheSettings {
    /// Passes that build the cache, before the passes that read it.
    pub quality: u32,
    /// A cell's size, in centimetres.
    pub spacing: f64,
    /// How near a hit may be, in spacings, for the cache to be read there after the building.
    pub corner_rejection: f64,
}

type Key = (u32, u32);

#[derive(Clone, Copy, Default)]
struct Record {
    sum: [f32; 3],
    count: u32,
}

/// What the cache tells a path that has met a surface.
pub enum Decision {
    /// Nothing: the path goes on.
    Continue,
    /// The path ends here, with this radiance (before its throughput).
    Cached(Vec3),
    /// The surface has no cell yet and is to get this one when the pass ends; the path ends.
    Place(Key),
    /// The path goes on, and what it gathers goes to this record when the pass ends.
    Fill(u32),
}

/// What a pass leaves for the cache.
pub enum Effect {
    Place(Key),
    Add { record: u32, radiance: [f32; 3] },
}

pub struct IrradianceCache {
    settings: CacheSettings,
    table: HashMap<Key, u32>,
    records: Vec<Record>,
    owners: Vec<Option<Key>>,
    allocated: u64,
}

/// The key of the cell a surface point (centimetres) and normal fall in.
fn cell_key(point: Vec3, normal: Vec3, spacing: f64) -> Key {
    let magnitude = normal.map(f64::abs);
    let main = if magnitude[0] >= magnitude[1] && magnitude[0] >= magnitude[2] {
        0
    } else if magnitude[1] >= magnitude[2] {
        1
    } else {
        2
    };
    let mut scaled = point;
    scaled[main] *= 4.0;
    let voxel = scaled.map(|c| (((c / spacing).floor() as i64 + 0x3ffff) & 0x7ffff) as u32);
    let dominant = |axis: usize| {
        let others = [(axis + 1) % 3, (axis + 2) % 3];
        others.iter().all(|&o| magnitude[axis] > magnitude[o])
    };
    let sign = |axis: usize| u32::from(normal[axis] >= 0.01);
    let bits = (sign(0) << 5)
        | (sign(1) << 4)
        | (sign(2) << 3)
        | (u32::from(dominant(0)) << 2)
        | (u32::from(dominant(1)) << 1)
        | u32::from(dominant(2));
    (
        (bits << 26) | ((voxel[0] & 0x7fff) << 7) | (voxel[1] & 0x7f),
        ((voxel[1] & 0xfff) << 20) | ((voxel[2] & 0x7fff) << 1),
    )
}

impl IrradianceCache {
    pub fn new(settings: CacheSettings) -> Self {
        Self {
            settings,
            table: HashMap::new(),
            records: Vec::new(),
            owners: Vec::new(),
            allocated: 0,
        }
    }

    /// Whether `pass` is one that builds the cache.
    pub fn builds(&self, pass: u32) -> bool {
        pass < self.settings.quality
    }

    /// What the cache says of a surface met at `hit` (metres, normal `normal`) by a path from
    /// `probe`, at the `bounce`th bounce of `pass`.
    pub fn query(&self, pass: u32, bounce: u32, probe: Vec3, hit: Vec3, normal: Vec3) -> Decision {
        let (probe, hit) = (probe.map(|c| c * CENTIMETRES), hit.map(|c| c * CENTIMETRES));
        let distance = length(sub(hit, probe));
        let spacing = self.settings.spacing;
        let building = self.builds(pass);
        let corner = !building && distance < spacing * self.settings.corner_rejection;
        let samples = TILE_TEXELS * f64::from(self.settings.quality);
        let expected = samples * spacing * spacing / (2.0 * PI * distance * distance);
        if bounce < 1 || corner || expected < 1.0 {
            return Decision::Continue;
        }
        let key = cell_key(hit, normal, spacing);
        let Some(&index) = self.table.get(&key) else {
            let place = bounce == 1 && building && pass < PLACING_PASSES;
            return if place {
                Decision::Place(key)
            } else {
                Decision::Continue
            };
        };
        let record = self.records[index as usize];
        let needed = if building {
            expected.trunc()
        } else {
            f64::from(READ_SAMPLES)
        };
        if f64::from(record.count) >= needed {
            return Decision::Cached(record.sum.map(|c| f64::from(c) / f64::from(record.count)));
        }
        if bounce == 1 && building {
            Decision::Fill(index)
        } else {
            Decision::Continue
        }
    }

    /// What the passes left, in the order given.
    pub fn apply(&mut self, effects: impl IntoIterator<Item = Effect>) {
        for effect in effects {
            match effect {
                Effect::Place(key) => self.place(key),
                Effect::Add { record, radiance } => {
                    let r = &mut self.records[record as usize];
                    for (sum, add) in r.sum.iter_mut().zip(radiance) {
                        *sum += add;
                    }
                    r.count += 1;
                }
            }
        }
    }

    fn place(&mut self, key: Key) {
        if self.table.contains_key(&key) {
            return;
        }
        let slot = (self.allocated % CAPACITY) as usize;
        self.allocated += 1;
        if slot == self.records.len() {
            self.records.push(Record::default());
            self.owners.push(None);
        }
        if let Some(old) = self.owners[slot].take() {
            self.table.remove(&old);
        }
        self.records[slot] = Record::default();
        self.owners[slot] = Some(key);
        self.table.insert(key, slot as u32);
    }
}
