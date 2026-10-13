//! The flat layouts of the hierarchy: a cluster as the record the run-time cut sends
//! (`CULLING_RECORD_FLOATS`), a node as the numbers the manifest and the GPU read (`CULLING_STRIDE`).
use super::*;

impl CullingCluster {
    /// The cluster as its record.
    pub fn record(&self) -> [f64; CULLING_RECORD_FLOATS] {
        let last = [self.parent_error, self.level as f64];
        let values = self.min.iter().chain(&self.max).chain(&self.parent_sphere);
        filled(values.chain(&last))
    }

    /// The cluster of record `r`, `None` when its level is not a whole number under `2^32`.
    pub fn from_record(r: &[f64]) -> Option<Self> {
        let level = r[11];
        (level >= 0.0 && level.fract() == 0.0 && level < 4_294_967_296.0).then(|| Self {
            min: [r[0], r[1], r[2]],
            max: [r[3], r[4], r[5]],
            parent_sphere: [r[6], r[7], r[8], r[9]],
            parent_error: r[10],
            level: level as usize,
        })
    }
}

impl CullingNode {
    /// The node in the flat layout (`CULLING_STRIDE` numbers): an infinite ceiling is written -1.
    pub fn flat(&self) -> [f64; CULLING_STRIDE] {
        let error = self.max_parent_error;
        let ceiling = [if error.is_finite() { error } else { -1.0 }];
        let links = [
            self.first_child,
            self.child_count,
            self.first_cluster,
            self.cluster_count,
        ];
        let links = links.map(|value| value as f64);
        let values = self.min.iter().chain(&self.max).chain(&self.sphere);
        filled(values.chain(&ceiling).chain(&links))
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
