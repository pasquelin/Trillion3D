//! The one unstable sort the HLOD steps order by — the unwrap's patches and islands among them —,
//! whose order among equals is part of what they build, so it is fixed by its steps alone:
//!
//! - a range of more than eight items is split about its middle item, moved to its front: from the
//!   left the items not after it are passed, from the right those not before it, the two found
//!   swapped, until they cross; the middle item then takes the last place the right side reached;
//!   the larger side is put aside and the smaller one split next;
//! - a range of eight or fewer has its greatest item — the first of equals — moved to its end,
//!   again and again;
//! - past a depth of twice the natural logarithm of the count, single precision, a range is heap
//!   sorted (`heap_sort`).

/// `items` sorted by `less`, equals in the order these steps leave them (module doc).
pub(crate) fn unstable_sort<T>(items: &mut [T], less: impl Fn(&T, &T) -> bool) {
    let count = items.len();
    if count < 2 {
        return;
    }
    let depth = ((count as f32).ln() * 2.0) as u32;
    let mut aside = vec![(0, count - 1, depth)];
    while let Some((mut min, mut max, mut depth)) = aside.pop() {
        loop {
            let count = max - min + 1;
            if depth == 0 {
                heap_sort(&mut items[min..=max], &less);
                break;
            }
            if count <= 8 {
                while max > min {
                    let mut most = min;
                    for item in min + 1..=max {
                        if less(&items[most], &items[item]) {
                            most = item;
                        }
                    }
                    items.swap(most, max);
                    max -= 1;
                }
                break;
            }
            items.swap(min + count / 2, min);
            let (mut left, mut right) = (min, max + 1);
            loop {
                left += 1;
                while left <= max && !less(&items[min], &items[left]) {
                    left += 1;
                }
                right -= 1;
                while right > min && !less(&items[right], &items[min]) {
                    right -= 1;
                }
                if left > right {
                    break;
                }
                items.swap(left, right);
            }
            items.swap(min, right);
            depth -= 1;
            if right as isize - 1 - min as isize >= max as isize - left as isize {
                if min + 1 < right {
                    aside.push((min, right - 1, depth));
                }
                if max > left {
                    min = left;
                    continue;
                }
            } else {
                if max > left {
                    aside.push((left, max, depth));
                }
                if min + 1 < right {
                    max = right - 1;
                    continue;
                }
            }
            break;
        }
    }
}

/// `items` heap sorted by `less`: a heap of the greatest on top built from the last parent down,
/// then its top swapped with the last item of the heap, again and again, each time sifted down.
fn heap_sort<T>(items: &mut [T], less: &impl Fn(&T, &T) -> bool) {
    let count = items.len();
    if count < 2 {
        return;
    }
    let after = |a: &T, b: &T| less(b, a);
    let mut parent = (count - 2) / 2;
    loop {
        sift(items, parent, count, &after);
        if parent == 0 {
            break;
        }
        parent -= 1;
    }
    for end in (1..count).rev() {
        items.swap(0, end);
        sift(items, 0, end, &after);
    }
}

/// The item at `at` of the heap of `count` items moved down, each time to its child `first`
/// prefers — the right one unless the left comes first — while that child comes first.
fn sift<T>(heap: &mut [T], mut at: usize, count: usize, first: &impl Fn(&T, &T) -> bool) {
    while 2 * at + 1 < count {
        let left = 2 * at + 1;
        let mut child = left;
        if left + 1 < count && !first(&heap[left], &heap[left + 1]) {
            child = left + 1;
        }
        if !first(&heap[child], &heap[at]) {
            break;
        }
        heap.swap(at, child);
        at = child;
    }
}
