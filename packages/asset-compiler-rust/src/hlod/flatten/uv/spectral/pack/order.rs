//! The unstable sort the packing orders its charts by, step for step as the reference build's
//! standard sort runs it, since the order among equal keys is part of the layout.
//!
//! - A range of 32 items or fewer is insertion sorted (an item less than the first moves to the
//!   front, any other sinks past the items it is less than).
//! - Past `1.5·log₂(n)` divisions (the budget, from `n`, kept at `b/2 + b/4` each division) a range
//!   is heap sorted.
//! - Otherwise the pivot is the median of three (of nine, spread by eighths, past 40 items); the
//!   items equal to it gather in the middle while the range is split three ways, and the smaller
//!   side is sorted first, the larger one next.

/// Ranges this short are insertion sorted.
const SMALL: usize = 32;

/// `items` sorted by `less`.
pub(super) fn sort<T: Copy>(items: &mut [T], less: &impl Fn(&T, &T) -> bool) {
    let n = items.len();
    sort_range(items, 0, n, n as isize, less);
}

fn sort_range<T: Copy>(
    items: &mut [T],
    mut first: usize,
    mut last: usize,
    mut budget: isize,
    less: &impl Fn(&T, &T) -> bool,
) {
    loop {
        if last - first <= SMALL {
            insertion(items, first, last, less);
            return;
        }
        if budget <= 0 {
            make_heap(&mut items[first..last], less);
            sort_heap(&mut items[first..last], less);
            return;
        }
        let (low, high) = partition(items, first, last, less);
        budget = (budget >> 1) + (budget >> 2);
        if low - first < last - high {
            sort_range(items, first, low, budget, less);
            first = high;
        } else {
            sort_range(items, high, last, budget, less);
            last = low;
        }
    }
}

fn insertion<T: Copy>(items: &mut [T], first: usize, last: usize, less: &impl Fn(&T, &T) -> bool) {
    for mid in first + 1..last {
        let value = items[mid];
        if less(&value, &items[first]) {
            items.copy_within(first..mid, first + 1);
            items[first] = value;
            continue;
        }
        let mut hole = mid;
        while less(&value, &items[hole - 1]) {
            items[hole] = items[hole - 1];
            hole -= 1;
        }
        items[hole] = value;
    }
}

/// The median of `a`, `b`, `c` moved to `b`.
fn median3<T: Copy>(items: &mut [T], a: usize, b: usize, c: usize, less: &impl Fn(&T, &T) -> bool) {
    if less(&items[b], &items[a]) {
        items.swap(b, a);
    }
    if less(&items[c], &items[b]) {
        items.swap(c, b);
        if less(&items[b], &items[a]) {
            items.swap(b, a);
        }
    }
}

/// The guessed median of `first..=last` moved to `mid`.
fn guess_median<T: Copy>(
    items: &mut [T],
    first: usize,
    mid: usize,
    last: usize,
    less: &impl Fn(&T, &T) -> bool,
) {
    let count = last - first;
    if count > 40 {
        let step = (count + 1) >> 3;
        let two = step << 1;
        median3(items, first, first + step, first + two, less);
        median3(items, mid - step, mid, mid + step, less);
        median3(items, last - two, last - step, last, less);
        median3(items, first + step, mid, last - step, less);
    } else {
        median3(items, first, mid, last, less);
    }
}

/// `first..last` split about a pivot: the items before it, those equal to it (the range
/// returned), those after it.
fn partition<T: Copy>(
    items: &mut [T],
    first: usize,
    last: usize,
    less: &impl Fn(&T, &T) -> bool,
) -> (usize, usize) {
    let mid = first + ((last - first) >> 1);
    guess_median(items, first, mid, last - 1, less);
    let (mut p_first, mut p_last) = (mid, mid + 1);
    let equal = |items: &[T], a: usize, b: usize| {
        !less(&items[a], &items[b]) && !less(&items[b], &items[a])
    };
    while first < p_first && equal(items, p_first - 1, p_first) {
        p_first -= 1;
    }
    while p_last < last && equal(items, p_last, p_first) {
        p_last += 1;
    }
    let (mut g_first, mut g_last) = (p_last, p_first);
    loop {
        while g_first < last {
            if !less(&items[p_first], &items[g_first]) {
                if less(&items[g_first], &items[p_first]) {
                    break;
                }
                if p_last != g_first {
                    items.swap(p_last, g_first);
                }
                p_last += 1;
            }
            g_first += 1;
        }
        while first < g_last {
            if !less(&items[g_last - 1], &items[p_first]) {
                if less(&items[p_first], &items[g_last - 1]) {
                    break;
                }
                p_first -= 1;
                if p_first != g_last - 1 {
                    items.swap(p_first, g_last - 1);
                }
            }
            g_last -= 1;
        }
        if g_last == first && g_first == last {
            return (p_first, p_last);
        }
        if g_last == first {
            if p_last != g_first {
                items.swap(p_first, p_last);
            }
            p_last += 1;
            items.swap(p_first, g_first);
            p_first += 1;
            g_first += 1;
        } else if g_first == last {
            g_last -= 1;
            p_first -= 1;
            if g_last != p_first {
                items.swap(g_last, p_first);
            }
            p_last -= 1;
            items.swap(p_first, p_last);
        } else {
            g_last -= 1;
            items.swap(g_first, g_last);
            g_first += 1;
        }
    }
}

/// `value` dropped into the hole at `hole`, raised toward `top` past every parent less than it.
fn push_hole<T: Copy>(
    items: &mut [T],
    mut hole: usize,
    top: usize,
    value: T,
    less: &impl Fn(&T, &T) -> bool,
) {
    while top < hole {
        let parent = (hole - 1) >> 1;
        if !less(&items[parent], &value) {
            break;
        }
        items[hole] = items[parent];
        hole = parent;
    }
    items[hole] = value;
}

/// The hole at `hole` sunk to the bottom of the first `bottom` items along the greater children,
/// then `value` pushed back up into it.
fn pop_hole<T: Copy>(
    items: &mut [T],
    mut hole: usize,
    bottom: usize,
    value: T,
    less: &impl Fn(&T, &T) -> bool,
) {
    let top = hole;
    let mut at = hole;
    let last_parent = (bottom - 1) >> 1;
    while at < last_parent {
        at = 2 * at + 2;
        if less(&items[at], &items[at - 1]) {
            at -= 1;
        }
        items[hole] = items[at];
        hole = at;
    }
    if at == last_parent && bottom % 2 == 0 {
        items[hole] = items[bottom - 1];
        hole = bottom - 1;
    }
    push_hole(items, hole, top, value, less);
}

fn make_heap<T: Copy>(items: &mut [T], less: &impl Fn(&T, &T) -> bool) {
    let bottom = items.len();
    let mut hole = bottom >> 1;
    while hole > 0 {
        hole -= 1;
        let value = items[hole];
        pop_hole(items, hole, bottom, value, less);
    }
}

fn sort_heap<T: Copy>(items: &mut [T], less: &impl Fn(&T, &T) -> bool) {
    let mut last = items.len();
    while last >= 2 {
        last -= 1;
        let value = items[last];
        items[last] = items[0];
        pop_hole(items, 0, last, value, less);
    }
}
