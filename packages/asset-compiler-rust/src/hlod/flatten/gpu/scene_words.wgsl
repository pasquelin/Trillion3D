// The scene buffer's four words at `at`, read as four floats; each program declares `scene`
// (binding 1) and includes this.
fn f4(at: u32) -> vec4f {
    return bitcast<vec4f>(scene[at]);
}
