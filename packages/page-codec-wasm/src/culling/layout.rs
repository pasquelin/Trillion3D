//! The flat layouts of the hierarchy: a part as the record the run-time cut sends
//! (`CULLING_RECORD_FLOATS`), a node as the numbers the manifest and the GPU read (`CULLING_STRIDE`).
use super::*;

/// A whole number under `2^32` as an index; `None` for any other number.
fn whole(value: f64) -> Option<usize> {
    (value >= 0.0 && value.fract() == 0.0 && value < 4_294_967_296.0).then_some(value as usize)
}

impl CullingPart {
    /// The part as its record.
    pub fn record(&self) -> [f64; CULLING_RECORD_FLOATS] {
        let errors = [self.min_error, self.parent_error];
        let place = [self.level, self.first, self.count].map(|value| value as f64);
        let values = self.min.iter().chain(&self.max).chain(&self.sphere);
        filled(values.chain(&errors).chain(&place))
    }

    /// The part of record `r`, `None` when its level, first rank or count is not a whole number
    /// under `2^32`.
    pub fn from_record(r: &[f64]) -> Option<Self> {
        Some(Self {
            min: [r[0], r[1], r[2]],
            max: [r[3], r[4], r[5]],
            sphere: [r[6], r[7], r[8], r[9]],
            min_error: r[10],
            parent_error: r[11],
            level: whole(r[12])?,
            first: whole(r[13])?,
            count: whole(r[14])?,
        })
    }
}

impl CullingNode {
    /// The node in the flat layout (`CULLING_STRIDE` numbers): an infinite ceiling is written -1.
    pub fn flat(&self) -> [f64; CULLING_STRIDE] {
        let error = self.max_parent_error;
        let errors = [if error.is_finite() { error } else { -1.0 }, self.min_error];
        let links = [
            self.first_child,
            self.child_count,
            self.first_cluster,
            self.cluster_count,
        ];
        let links = links.map(|value| value as f64);
        let values = self.min.iter().chain(&self.max).chain(&self.sphere);
        filled(values.chain(&errors).chain(&links))
    }
}

/// The first `N` of `values` as an array.
fn filled<'a, const N: usize>(values: impl Iterator<Item = &'a f64>) -> [f64; N] {
    let mut out = [0.0; N];
    out.iter_mut()
        .zip(values)
        .for_each(|(at, value)| *at = *value);
    out
}
