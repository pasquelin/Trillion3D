//! Exact arithmetic on floats, as Shewchuk's expansions: a value held as a sum of floats of
//! increasing magnitude whose significands do not overlap, ordered from the smallest component to
//! the largest (zeros possibly in between), each operation returning its components and how many
//! it wrote.
//!
//! The building blocks are error-free: a sum, a difference or a product rounded once, together with
//! the float its rounding lost (`add_exact`, `sub_exact`, `mul_exact`, `square_exact`), a product's
//! error found by splitting both factors into halves whose products round to nothing (`halves`).
//! From them: two exact products summed or subtracted into four components (`product_sum`,
//! `product_difference`, `square_sum`), two expansions summed (`sum_expansions`), an expansion
//! scaled by a float (`scaled`) — both dropping the zero components they would write, keeping one
//! zero when the result is zero — and an expansion's components summed in order into one float
//! (`approximate`).
use super::precision::Precision;

/// `a + b` rounded, and the float its rounding lost: the two sum to `a + b` exactly.
fn add_exact<T: Precision>(a: T, b: T) -> (T, T) {
    let sum = a + b;
    let b_part = sum - a;
    let a_part = sum - b_part;
    let b_lost = b - b_part;
    let a_lost = a - a_part;
    (sum, a_lost + b_lost)
}

/// `add_exact` in fewer steps, exact when `a` is zero or not smaller in magnitude than `b`.
fn add_exact_larger_first<T: Precision>(a: T, b: T) -> (T, T) {
    let sum = a + b;
    let b_part = sum - a;
    (sum, b - b_part)
}

/// The float lost by `difference`, the rounded `a − b`: the two sum to `a − b` exactly.
pub(super) fn sub_error<T: Precision>(a: T, b: T, difference: T) -> T {
    let b_part = a - difference;
    let a_part = difference + b_part;
    let b_lost = b_part - b;
    let a_lost = a - a_part;
    a_lost + b_lost
}

/// `a − b` rounded, and the float its rounding lost (`sub_error`).
fn sub_exact<T: Precision>(a: T, b: T) -> (T, T) {
    let difference = a - b;
    (difference, sub_error(a, b, difference))
}

/// `a` split into a high and a low half, each of half the significand: the two sum to `a`, and the
/// product of any two halves is exact.
fn halves<T: Precision>(a: T) -> (T, T) {
    let spread = T::SPLITTER * a;
    let excess = spread - a;
    let high = spread - excess;
    (high, a - high)
}

/// The float lost by `product`, the rounded product of the factors split into `a` and `b`
/// (`halves`): the products of the halves taken off it, largest first.
fn product_error<T: Precision>(product: T, (a_high, a_low): (T, T), (b_high, b_low): (T, T)) -> T {
    let first = product - a_high * b_high;
    let second = first - a_low * b_high;
    let third = second - a_high * b_low;
    a_low * b_low - third
}

/// `a · b` rounded, and the float its rounding lost.
fn mul_exact<T: Precision>(a: T, b: T) -> (T, T) {
    let product = a * b;
    (product, product_error(product, halves(a), halves(b)))
}

/// `mul_exact` with `b` already split into `b_halves`.
fn mul_exact_split<T: Precision>(a: T, b: T, b_halves: (T, T)) -> (T, T) {
    let product = a * b;
    (product, product_error(product, halves(a), b_halves))
}

/// `a²` rounded, and the float its rounding lost, the cross product of the halves doubled.
fn square_exact<T: Precision>(a: T) -> (T, T) {
    let square = a * a;
    let (high, low) = halves(a);
    let first = square - high * high;
    let third = first - (high + high) * low;
    (square, low * low - third)
}

/// The three components of `(a1 + a0) + b` for a two-component `a`, largest first.
fn add_two_one<T: Precision>(a1: T, a0: T, b: T) -> (T, T, T) {
    let (carry, x0) = add_exact(a0, b);
    let (x2, x1) = add_exact(a1, carry);
    (x2, x1, x0)
}

/// The three components of `(a1 + a0) − b` for a two-component `a`, largest first.
fn sub_two_one<T: Precision>(a1: T, a0: T, b: T) -> (T, T, T) {
    let (carry, x0) = sub_exact(a0, b);
    let (x2, x1) = add_exact(a1, carry);
    (x2, x1, x0)
}

/// The four components of `(a1 + a0) + (b1 + b0)`, smallest first: `b0` added, then `b1`.
fn add_two_two<T: Precision>((a1, a0): (T, T), (b1, b0): (T, T)) -> [T; 4] {
    let (high, middle, x0) = add_two_one(a1, a0, b0);
    let (x3, x2, x1) = add_two_one(high, middle, b1);
    [x0, x1, x2, x3]
}

/// The four components of `(a1 + a0) − (b1 + b0)`, smallest first: `b0` subtracted, then `b1`.
fn sub_two_two<T: Precision>((a1, a0): (T, T), (b1, b0): (T, T)) -> [T; 4] {
    let (high, middle, x0) = sub_two_one(a1, a0, b0);
    let (x3, x2, x1) = sub_two_one(high, middle, b1);
    [x0, x1, x2, x3]
}

/// `a · b + c · d` exactly, in four components, smallest first.
pub(super) fn product_sum<T: Precision>(a: T, b: T, c: T, d: T) -> [T; 4] {
    add_two_two(mul_exact(a, b), mul_exact(c, d))
}

/// `a · b − c · d` exactly, in four components, smallest first.
pub(super) fn product_difference<T: Precision>(a: T, b: T, c: T, d: T) -> [T; 4] {
    sub_two_two(mul_exact(a, b), mul_exact(c, d))
}

/// `x² + y²` exactly, in four components, smallest first.
pub(super) fn square_sum<T: Precision>(x: T, y: T) -> [T; 4] {
    add_two_two(square_exact(x), square_exact(y))
}

/// Whether merging the expansions takes `e`'s next component before `f`'s: when `f` lies outside
/// `(−|e|, |e|]` (`f > e` and `f > −e` agree), so `e` is the smaller in magnitude but for ties.
fn takes_first<T: Precision>(e: T, f: T) -> bool {
    (f > e) == (f > -e)
}

/// `value` written at `out[*written]`, the count advanced, when it is not zero.
fn push_nonzero<T: Precision>(out: &mut [T], written: &mut usize, value: T) {
    if value != T::ZERO {
        out[*written] = value;
        *written += 1;
    }
}

/// The running sum written last when it is not zero or when nothing was written, the final
/// length returned.
fn finish<T: Precision>(out: &mut [T], written: usize, running: T) -> usize {
    if running != T::ZERO || written == 0 {
        out[written] = running;
        return written + 1;
    }
    written
}

/// `e + f` written into `sum` (room for `e.len() + f.len()` components), its length returned: the
/// components of both merged by magnitude, each added to the running sum, the float lost by each
/// addition written when not zero, the running sum last (`finish`). Both expansions hold at least
/// one component.
pub(super) fn sum_expansions<T: Precision>(e: &[T], f: &[T], sum: &mut [T]) -> usize {
    let (mut next_e, mut next_f) = (0, 0);
    let mut running = if takes_first(e[0], f[0]) {
        next_e += 1;
        e[0]
    } else {
        next_f += 1;
        f[0]
    };
    let mut written = 0;
    if next_e < e.len() && next_f < f.len() {
        let (total, lost) = if takes_first(e[next_e], f[next_f]) {
            next_e += 1;
            add_exact_larger_first(e[next_e - 1], running)
        } else {
            next_f += 1;
            add_exact_larger_first(f[next_f - 1], running)
        };
        running = total;
        push_nonzero(sum, &mut written, lost);
        while next_e < e.len() && next_f < f.len() {
            let (total, lost) = if takes_first(e[next_e], f[next_f]) {
                next_e += 1;
                add_exact(running, e[next_e - 1])
            } else {
                next_f += 1;
                add_exact(running, f[next_f - 1])
            };
            running = total;
            push_nonzero(sum, &mut written, lost);
        }
    }
    for &component in e[next_e..].iter().chain(&f[next_f..]) {
        let (total, lost) = add_exact(running, component);
        running = total;
        push_nonzero(sum, &mut written, lost);
    }
    finish(sum, written, running)
}

/// `e · b` written into `product` (room for twice `e.len()` components), its length returned: each
/// component's exact product with `b` added to the running sum, the floats lost written when not
/// zero, the running sum last (`finish`).
pub(super) fn scaled<T: Precision>(e: &[T], b: T, product: &mut [T]) -> usize {
    let b_halves = halves(b);
    let (mut running, lost) = mul_exact_split(e[0], b, b_halves);
    let mut written = 0;
    push_nonzero(product, &mut written, lost);
    for &component in &e[1..] {
        let (high, low) = mul_exact_split(component, b, b_halves);
        let (partial, lost) = add_exact(running, low);
        push_nonzero(product, &mut written, lost);
        let (total, lost) = add_exact_larger_first(high, partial);
        running = total;
        push_nonzero(product, &mut written, lost);
    }
    finish(product, written, running)
}

/// One float near the expansion's value: its components summed in order, smallest first.
pub(super) fn approximate<T: Precision>(e: &[T]) -> T {
    e[1..].iter().fold(e[0], |sum, &component| sum + component)
}
