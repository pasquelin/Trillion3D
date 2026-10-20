//! The orders a bisection draws (`bisect.rs`): its random numbers, its shuffles, and the sort that
//! groups vertices by a key — each the same on every platform.

/// The random numbers of one bisection: the multiplicative congruential generator of Park and
/// Miller (1988), `x ← 16 807 x mod (2³¹ − 1)`, from a fixed seed. Integer arithmetic only.
pub(super) struct Draws {
    state: u64,
}

const MODULUS: u64 = (1 << 31) - 1;
const MULTIPLIER: u64 = 16_807;
/// The state a seed of zero, which the generator cannot hold, is replaced by.
const ZERO_SEED: u64 = 123_459_876;

impl Draws {
    pub fn seeded(seed: u32) -> Self {
        Self {
            state: u64::from(seed),
        }
    }

    fn next(&mut self) -> u64 {
        if self.state == 0 {
            self.state = ZERO_SEED;
        }
        self.state = self.state * MULTIPLIER % MODULUS;
        self.state
    }

    /// A number in `0..max`: the next draw modulo `max`.
    pub fn below(&mut self, max: usize) -> usize {
        (self.next() % max as u64) as usize
    }

    /// `0..n` shuffled. Under ten, `n` exchanges of two drawn slots; otherwise `shuffles` times,
    /// two drawn runs of four, `a` and `b`, exchanged crosswise — slot `a + k` with slot
    /// `b + (k + 2) % 4`, `k` rising.
    pub fn permutation(&mut self, n: usize, shuffles: usize) -> Vec<u32> {
        let mut p: Vec<u32> = (0..n as u32).collect();
        if n < 10 {
            for _ in 0..n {
                let a = self.below(n);
                let b = self.below(n);
                p.swap(a, b);
            }
            return p;
        }
        for _ in 0..shuffles {
            let a = self.below(n - 3);
            let b = self.below(n - 3);
            for k in 0..4 {
                p.swap(a + k, b + (k + 2) % 4);
            }
        }
        p
    }
}

/// Spans of at most this many more elements are left to the final insertion pass.
const SMALL_SPAN: isize = 8;

/// Sorts `items` by their key alone, equal keys in the order this exact procedure leaves them —
/// the order a group of equal keys is then read in is part of the cut. Partition exchange: the
/// median of a span's first, middle and last elements as the pivot (it follows the swaps), the
/// two walls closing in, the larger side of a cut set aside and the smaller one cut next, a side
/// of at most `SMALL_SPAN` more elements left as is; then one insertion pass over everything,
/// after the smallest of the first nine is brought to the front.
pub(super) fn sort_by_key_exactly(items: &mut [(u64, u32)]) {
    let n = items.len();
    if n == 0 {
        return;
    }
    let below =
        |items: &[(u64, u32)], a: isize, b: isize| items[a as usize].0 < items[b as usize].0;
    let swap = |items: &mut [(u64, u32)], a: isize, b: isize| items.swap(a as usize, b as usize);
    if n as isize > SMALL_SPAN {
        let mut set_aside: Vec<(isize, isize)> = Vec::new();
        let (mut low, mut high) = (0isize, n as isize - 1);
        loop {
            let mut pivot = low + (high - low) / 2;
            if below(items, pivot, low) {
                swap(items, pivot, low);
            }
            if below(items, high, pivot) {
                swap(items, pivot, high);
                if below(items, pivot, low) {
                    swap(items, pivot, low);
                }
            }
            let (mut left, mut right) = (low + 1, high - 1);
            loop {
                while below(items, left, pivot) {
                    left += 1;
                }
                while below(items, pivot, right) {
                    right -= 1;
                }
                if left < right {
                    swap(items, left, right);
                    if pivot == left {
                        pivot = right;
                    } else if pivot == right {
                        pivot = left;
                    }
                    left += 1;
                    right -= 1;
                } else if left == right {
                    left += 1;
                    right -= 1;
                    break;
                }
                if left > right {
                    break;
                }
            }
            let left_small = right - low <= SMALL_SPAN;
            let right_small = high - left <= SMALL_SPAN;
            if left_small && right_small {
                match set_aside.pop() {
                    Some((l, h)) => (low, high) = (l, h),
                    None => break,
                }
            } else if left_small {
                low = left;
            } else if right_small {
                high = right;
            } else if right - low > high - left {
                set_aside.push((low, right));
                low = left;
            } else {
                set_aside.push((left, high));
                high = right;
            }
        }
    }
    let last = n as isize - 1;
    let mut smallest = 0isize;
    for at in 1..=last.min(SMALL_SPAN) {
        if below(items, at, smallest) {
            smallest = at;
        }
    }
    swap(items, smallest, 0);
    for at in 2..=last {
        let mut to = at - 1;
        while below(items, at, to) {
            to -= 1;
        }
        to += 1;
        items[to as usize..=at as usize].rotate_right(1);
    }
}
