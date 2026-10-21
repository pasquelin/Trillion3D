//! The plane quadric the shell's simplifier prices a collapse with (Garland & Heckbert 1997;
//! `approximate/simplify.rs`): the squared distance to a sum of planes, `pᵀAp + 2 b·p + c`, `A`
//! symmetric; the volume terms a collapse keeps the enclosed volume by (Lindstrom & Turk 1998);
//! and the cofactor inverse of a symmetric 3×3 system. Every sum here runs in the order written,
//! so it keeps its bits.

type V3 = [f64; 3];

/// A symmetric 3×3 matrix by its upper triangle: `xx xy xz yy yz zz`.
pub(super) type Sym3 = [f64; 6];

/// `u vᵀ`'s upper triangle, each entry `uᵢ · vⱼ`.
pub(super) fn outer(u: V3, v: V3) -> Sym3 {
    [
        u[0] * v[0],
        u[0] * v[1],
        u[0] * v[2],
        u[1] * v[1],
        u[1] * v[2],
        u[2] * v[2],
    ]
}

/// `A p`, each row summed from its first term.
pub(super) fn times(a: &Sym3, p: V3) -> V3 {
    [
        a[0] * p[0] + a[1] * p[1] + a[2] * p[2],
        a[1] * p[0] + a[3] * p[1] + a[4] * p[2],
        a[2] * p[0] + a[4] * p[1] + a[5] * p[2],
    ]
}

/// `A`'s adjugate, symmetric too, and its determinant: `A⁻¹ = adj / det` where the determinant
/// clears the caller's threshold.
pub(super) fn adjugate(a: &Sym3) -> (Sym3, f64) {
    let [axx, axy, axz, ayy, ayz, azz] = *a;
    let a11 = azz * ayy - ayz * ayz;
    let a12 = axz * ayz - azz * axy;
    let a13 = axy * ayz - axz * ayy;
    let a22 = azz * axx - axz * axz;
    let a23 = axy * axz - axx * ayz;
    let a33 = axx * ayy - axy * axy;
    let det = axx * a11 + axy * a12 + axz * a13;
    ([a11, a12, a13, a22, a23, a33], det)
}

fn add_into<const N: usize>(into: &mut [f64; N], w: f64, from: &[f64; N]) {
    for k in 0..N {
        into[k] += w * from[k];
    }
}

/// A sum of planes: `A`, `b`, `c`.
#[derive(Clone, Copy, Default)]
pub(super) struct Plane {
    pub a: Sym3,
    pub b: V3,
    pub c: f64,
}

impl Plane {
    /// `o` added at weight `w`, each term `w · term`.
    pub(super) fn add_scaled(&mut self, w: f64, o: &Plane) {
        add_into(&mut self.a, w, &o.a);
        add_into(&mut self.b, w, &o.b);
        self.c += w * o.c;
    }

    /// `pᵀAp + 2 b·p + c`.
    pub(super) fn evaluate(&self, p: V3) -> f64 {
        use trillion3d_math::vector::vecn::dot;
        dot(p, times(&self.a, p)) + 2.0 * dot(p, self.b) + self.c
    }
}

/// The volume constraint's terms: the summed normal `n` and offset `d` of the planes, each at the
/// weight its simplifier gives it.
#[derive(Clone, Copy, Default)]
pub(super) struct Volume {
    pub n: V3,
    pub d: f64,
}

impl Volume {
    pub(super) fn add_scaled(&mut self, w: f64, o: &Volume) {
        add_into(&mut self.n, w, &o.n);
        self.d += w * o.d;
    }
}
