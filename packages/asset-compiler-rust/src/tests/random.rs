//! Deterministic inputs shared by tests outside the generated corpus.

use trillion3d_math::sequence::random::{xorshift64, xorshift64_unit_f32};

pub(crate) struct Xorshift(u64);

impl Xorshift {
    pub(crate) fn new(seed: u64) -> Self {
        Self(seed | 1)
    }

    pub(crate) fn next(&mut self) -> u64 {
        xorshift64(&mut self.0)
    }

    pub(crate) fn below(&mut self, bound: usize) -> usize {
        (self.next() % bound.max(1) as u64) as usize
    }

    pub(crate) fn unit(&mut self) -> f32 {
        xorshift64_unit_f32(&mut self.0)
    }

    pub(crate) fn between(&mut self, low: usize, high: usize) -> usize {
        low + self.below(high - low + 1)
    }
}
