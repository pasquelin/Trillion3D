//! The layout.
use super::raster::Footprint;
use super::{Rect, Run, Segment};

/// The square being filled: the free runs of each row and column.
pub(crate) struct Layout {
    pub(super) size: u32,
    pub(super) rows: Vec<Run>,
    pub(super) columns: Vec<Run>,
}

impl Layout {
    pub(crate) fn new(size: u32) -> Self {
        let free = Run {
            longest: size,
            segments: vec![Segment {
                start: 0,
                length: size,
            }],
            lookup: Vec::new(),
        };
        Layout {
            size,
            rows: vec![free.clone(); size as usize],
            columns: vec![free; size as usize],
        }
    }

    /// Whether `other`'s used segments, shifted by `offset`, all fall in `this`'s free ones; if
    /// not, `failed` is how far the search can skip before the run could fit.
    fn test_one_run(
        this: &Run,
        other: &Run,
        (offset, length, resolution): (u32, u32, u32),
        failed: &mut u32,
    ) -> bool {
        if this.longest < other.longest {
            *failed = resolution;
            return false;
        }
        let lookup = this.segments.len() > 16;
        for used in &other.segments {
            if used.start >= length {
                break;
            }
            let start = offset + used.start;
            let end = offset + (used.start + used.length).min(length);
            let mut free = if lookup {
                this.lookup[start as usize] as usize
            } else {
                0
            };
            let mut found = false;
            while free < this.segments.len() && start >= this.segments[free].start {
                if end <= this.segments[free].start + this.segments[free].length {
                    found = true;
                    break;
                }
                free += 1;
            }
            if !found {
                while free < this.segments.len() {
                    if used.length <= this.segments[free].length {
                        *failed = this.segments[free].start.wrapping_sub(start);
                        return false;
                    }
                    free += 1;
                }
                *failed = resolution;
                return false;
            }
        }
        true
    }

    fn test_all_rows(&self, rect: &Rect, other: &Footprint, failed: &mut u32) -> bool {
        (other.sorted_rows.iter()).all(|&y| {
            let (this, run) = (&self.rows[(rect.y + y) as usize], &other.rows[y as usize]);
            Self::test_one_run(this, run, (rect.x, rect.w, self.size), failed)
        })
    }

    fn test_all_columns(&self, rect: &Rect, other: &Footprint, failed: &mut u32) -> bool {
        (other.sorted_columns.iter()).all(|&x| {
            let (this, run) = (
                &self.columns[(rect.x + x) as usize],
                &other.columns[x as usize],
            );
            Self::test_one_run(this, run, (rect.y, rect.h, self.size), failed)
        })
    }

    /// The first place from `rect`'s, row after row — column after column for
    /// a chart taller than wide —, where `other` fits; `false` once `rect` cannot beat the best.
    pub(crate) fn find(
        &self,
        rect: &mut Rect,
        other: &Footprint,
        best: &dyn Fn(&Rect) -> bool,
    ) -> bool {
        let mut test = *rect;
        let (max_width, max_height) = (self.size - test.w, self.size - test.h);
        if test.h > test.w {
            while test.x <= max_width {
                let mut failed = 1u32;
                test.y = 0;
                while test.y <= max_height {
                    if !best(rect) {
                        return false;
                    }
                    if self.test_all_columns(&test, other, &mut failed) {
                        *rect = test;
                        return true;
                    }
                    test.y = test.y.saturating_add(failed);
                }
                test.x += 1;
            }
        } else {
            while test.y <= max_height {
                let mut failed = 1u32;
                test.x = 0;
                while test.x <= max_width {
                    if !best(rect) {
                        return false;
                    }
                    if self.test_all_rows(&test, other, &mut failed) {
                        *rect = test;
                        return true;
                    }
                    test.x = test.x.saturating_add(failed);
                }
                test.y += 1;
            }
        }
        false
    }

    /// `other`'s used segments cut out of `this`'s free ones, then the lookup rebuilt.
    fn merge_run(this: &mut Run, other: &Run, (offset, length, perpendicular): (u32, u32, u32)) {
        for used in &other.segments {
            let start = offset + used.start;
            if let Some(index) =
                (this.segments.iter()).position(|f| start >= f.start && start < f.start + f.length)
            {
                let free = this.segments[index];
                if free.length == 1 {
                    this.segments.swap_remove(index);
                    continue;
                }
                let first = Segment {
                    start: free.start,
                    length: start - free.start,
                };
                let end = offset + (used.start + used.length).min(length) - 1;
                let second = Segment {
                    start: end + 1,
                    length: (free.start + free.length).wrapping_sub(end + 1),
                };
                this.segments.swap_remove(index);
                if first.length > 0 {
                    this.segments.push(first);
                }
                if second.length > 0 && second.length <= free.length {
                    this.segments.push(second);
                }
            }
        }
        this.segments.sort();
        this.lookup = vec![0; perpendicular as usize];
        this.longest = 0;
        let mut last = 0u32;
        for (index, segment) in this.segments.iter().enumerate() {
            this.longest = this.longest.max(segment.length);
            let stop = segment.start + segment.length;
            for at in last..stop {
                this.lookup[at as usize] = index as u16;
            }
            last = stop;
        }
        for at in last..perpendicular {
            this.lookup[at as usize] = this.segments.len() as u16;
        }
    }

    /// `other` placed at `rect`: its used segments cut out of every row and column it covers.
    pub(crate) fn alloc(&mut self, rect: &Rect, other: &Footprint) {
        for y in 0..other.height {
            let run = &other.rows[y as usize];
            Self::merge_run(
                &mut self.rows[(rect.y + y) as usize],
                run,
                (rect.x, rect.w, self.size),
            );
        }
        for x in 0..other.width {
            let run = &other.columns[x as usize];
            Self::merge_run(
                &mut self.columns[(rect.x + x) as usize],
                run,
                (rect.y, rect.h, self.size),
            );
        }
    }

    /// The texels in use.
    pub(crate) fn used(&self) -> u32 {
        let free: u32 = (self.rows.iter())
            .flat_map(|r| r.segments.iter().map(|s| s.length))
            .sum();
        self.size * self.size - free
    }
}
