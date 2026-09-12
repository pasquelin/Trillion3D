# Oracles mathématiques et tests intégrés

> Conception Web Geometry : ce chapitre décrit des contrats et algorithmes proposés. Voir [l’état de l’implémentation](../../../packages/README.md).

Ce document contient les fonctions de référence et leurs tests. Python 3.10+ et sa bibliothèque standard suffisent. Aucun original, paquet tiers ou fichier Python à conserver n’est nécessaire. Les deux blocs sont extraits dans un dossier temporaire uniquement pendant l’exécution.

Ces tests vérifient des calculs et contre-exemples, pas un moteur complet, un shader GPU ou des performances matérielles. Les tirages déterministes complètent les exemples sans constituer une preuve exhaustive sur toutes les entrées.

## Exécuter depuis le dossier docs

Ouvrir un terminal dans le dossier contenant ce document (`docs/mathematiques` dans le dépôt), puis lancer la commande suivante. Elle fonctionne aussi sur une copie isolée de ce dossier. Seule la bibliothèque standard de Python est utilisée.

```sh
python3 - <<'PY'
from pathlib import Path
import re
import subprocess
import sys
import tempfile

document = Path('ORACLES_ET_TESTS.md').read_text()
with tempfile.TemporaryDirectory(prefix='geometry-oracles-') as temporary:
    for name in ['reference_math.py', 'test_reference_math.py']:
        pattern = r'<!-- executable: ' + re.escape(name) + r' -->\n```python\n([\s\S]*?)\n```'
        match = re.search(pattern, document)
        if match is None:
            raise RuntimeError('Bloc executable manquant: ' + name)
        (Path(temporary) / name).write_text(match.group(1) + '\n')
    result = subprocess.run([sys.executable, '-B', '-m', 'unittest', '-v', 'test_reference_math.py'], cwd=temporary)
    raise SystemExit(result.returncode)
PY
```

Les fonctions ajoutées pour les extensions couvrent la sphère entièrement devant le proche, la profondeur perspective, les plages entières, les extrema affines, les corrections de bits, les coordonnées barycentriques, Bézier, la SGGX diagonale dans son repère principal et la transmittance. Elles sont des références f64 sur leur domaine déclaré ; elles ne prétendent pas fournir des intervalles à arrondi dirigé. Des entrées finies peuvent dépasser la plage arithmétique : les oracles de sphère et SGGX rejettent ces cas au lieu de livrer NaN, sans promettre de les résoudre par remise à l'échelle. L'oracle barycentrique normalise les poids dont la somme est acceptée proche de 1 ; leur interprétation est celle de coordonnées affines normalisées. La quadrature SGGX est une vérification numérique sous tolérance.

## Fonctions de référence

<!-- executable: reference_math.py -->
```python
import math


def dot(left, right):
    if len(left) != len(right):
        raise ValueError('Dimensions incompatibles')
    return sum(first * second for first, second in zip(left, right))


def norm(vector):
    return math.sqrt(dot(vector, vector))


def quadric_from_planes(planes):
    result = [[0.0] * 4 for _ in range(4)]
    for plane, weight in planes:
        if (len(plane) != 4 or not math.isfinite(weight) or weight < 0
                or any(not math.isfinite(value) for value in plane)
                or not math.isclose(norm(plane[:3]), 1.0)):
            raise ValueError('Plan ou poids invalide')
        for row in range(4):
            for column in range(4):
                result[row][column] += weight * plane[row] * plane[column]
    return result


def quadric_energy(quadric, position):
    homogeneous = [*position, 1.0]
    return sum(homogeneous[row] * quadric[row][column] * homogeneous[column]
               for row in range(4) for column in range(4))


def solve_pivoted(matrix, target, relative_tolerance=1e-12):
    size = len(target)
    augmented = [list(row) + [value] for row, value in zip(matrix, target)]
    scale = max(abs(value) for row in matrix for value in row)
    if scale == 0:
        return None
    for column in range(size):
        pivot = max(range(column, size), key=lambda row: abs(augmented[row][column]))
        if abs(augmented[pivot][column]) <= scale * relative_tolerance:
            return None
        augmented[column], augmented[pivot] = augmented[pivot], augmented[column]
        divisor = augmented[column][column]
        augmented[column] = [value / divisor for value in augmented[column]]
        for row in range(size):
            if row != column:
                factor = augmented[row][column]
                augmented[row] = [value - factor * selected for value, selected in zip(augmented[row], augmented[column])]
    return [row[-1] for row in augmented]


def quadric_candidate(quadric, left, right):
    matrix = [row[:3] for row in quadric[:3]]
    target = [-row[3] for row in quadric[:3]]
    optimum = solve_pivoted(matrix, target)
    candidates = [list(left), list(right), [(first + second) / 2 for first, second in zip(left, right)]]
    if optimum is not None:
        candidates.append(optimum)
    return min(candidates, key=lambda point: quadric_energy(quadric, point))


def projected_point(point, focal):
    if point[2] <= 0:
        raise ValueError('Point hors domaine perspective')
    return [focal[0] * point[0] / point[2], focal[1] * point[1] / point[2]]


def projected_error_bound(error, minimum, maximum, focal, near=0.01):
    if len(minimum) != 3 or len(maximum) != 3 or len(focal) != 2:
        raise ValueError('Dimensions de projection invalides')
    if error < 0 or any(not math.isfinite(value) for value in [error, *minimum, *maximum, *focal, near]):
        raise ValueError('Valeur invalide')
    if any(lower > upper for lower, upper in zip(minimum, maximum)) or near <= 0:
        raise ValueError('Boite ou plan proche invalide')
    if minimum[2] <= near:
        return math.inf
    transverse_squared = sum(max(abs(minimum[axis]), abs(maximum[axis])) ** 2 for axis in range(2))
    return error * max(abs(value) for value in focal) / minimum[2] * math.sqrt(1 + transverse_squared / minimum[2] ** 2)


def lod_score(error_object, error_scale, minimum, maximum, pixel_scale, projection, near):
    if (not all(math.isfinite(value) and value >= 0 for value in [error_object, error_scale, near])
            or len(pixel_scale) != 2
            or not all(math.isfinite(value) and value > 0 for value in pixel_scale)):
        raise ValueError('Parametres LOD invalides')
    error_view = error_object * error_scale
    if not math.isfinite(error_view):
        raise ValueError('Erreur transformee hors domaine')
    if projection == 'orthographic':
        return error_view * max(pixel_scale)
    if projection == 'perspective':
        return projected_error_bound(error_view, minimum, maximum, pixel_scale, near)
    raise ValueError('Projection inconnue')


def required_bits(low, high):
    if type(low) is not int or type(high) is not int or high < low:
        raise ValueError('Plage entiere invalide')
    return (high - low).bit_length()


def simplicial_link(triangles, simplex):
    import itertools
    result = set()
    for triangle in triangles:
        vertices = set(triangle)
        if simplex <= vertices:
            remaining = sorted(vertices - simplex)
            for count in range(1, len(remaining) + 1):
                result.update(itertools.combinations(remaining, count))
    return result


def link_condition(triangles, left, right):
    return (simplicial_link(triangles, {left}) & simplicial_link(triangles, {right})
            == simplicial_link(triangles, {left, right}))


def cone_rejects(axis_dot_view, angle, direction_spread=0):
    if (not -1 <= axis_dot_view <= 1 or not 0 <= angle <= math.pi
            or not 0 <= direction_spread <= math.pi):
        raise ValueError('Cone invalide')
    total_angle = angle + direction_spread
    return total_angle < math.pi / 2 and axis_dot_view < -math.sin(total_angle)


def point_triangle_distance(point, triangle):
    first, second, third = triangle
    candidates = []
    for start, end in [(first, second), (second, third), (third, first)]:
        direction = [end[axis] - start[axis] for axis in range(3)]
        offset = [point[axis] - start[axis] for axis in range(3)]
        squared = dot(direction, direction)
        ratio = max(0, min(1, dot(offset, direction) / squared)) if squared else 0
        candidates.append([start[axis] + ratio * direction[axis] for axis in range(3)])
    edge_a = [second[axis] - first[axis] for axis in range(3)]
    edge_b = [third[axis] - first[axis] for axis in range(3)]
    offset = [point[axis] - first[axis] for axis in range(3)]
    aa, ab, bb = dot(edge_a, edge_a), dot(edge_a, edge_b), dot(edge_b, edge_b)
    determinant = aa * bb - ab * ab
    if determinant > 0:
        u = (bb * dot(offset, edge_a) - ab * dot(offset, edge_b)) / determinant
        v = (aa * dot(offset, edge_b) - ab * dot(offset, edge_a)) / determinant
        if u >= 0 and v >= 0 and u + v <= 1:
            candidates.append([first[axis] + u * edge_a[axis] + v * edge_b[axis] for axis in range(3)])
    return min(norm([point[axis] - candidate[axis] for axis in range(3)]) for candidate in candidates)


def sphere_union(first_center, first_radius, second_center, second_radius):
    if first_radius < 0 or second_radius < 0:
        raise ValueError('Rayon negatif')
    direction = [second - first for first, second in zip(first_center, second_center)]
    distance = norm(direction)
    if first_radius >= distance + second_radius:
        return list(first_center), first_radius
    if second_radius >= distance + first_radius:
        return list(second_center), second_radius
    radius = (distance + first_radius + second_radius) / 2
    center = [value + (radius - first_radius) * delta / distance for value, delta in zip(first_center, direction)]
    return center, radius


def aabb_outside_plane(center, extent, normal, offset):
    if any(value < 0 for value in extent):
        raise ValueError('Etendue negative')
    return dot(normal, center) + offset + dot([abs(value) for value in normal], extent) < 0


def exclusive_scan(values):
    result = []
    total = 0
    for value in values:
        result.append(total)
        total += value
    return result, total


def compact(values, flags):
    if len(values) != len(flags) or any(flag not in (0, 1) for flag in flags):
        raise ValueError('Predicats invalides')
    offsets, total = exclusive_scan(flags)
    result = [None] * total
    for index, flag in enumerate(flags):
        if flag:
            result[offsets[index]] = values[index]
    return result


def hiz_reduce_ceil(depth, reversed_z=False):
    height = len(depth)
    width = len(depth[0]) if height else 0
    if width == 0 or any(len(row) != width for row in depth):
        raise ValueError('Image vide ou non rectangulaire')
    reducer = min if reversed_z else max
    result = []
    for start_row in range(0, height, 2):
        row = []
        for start_column in range(0, width, 2):
            footprint = [depth[source_row][source_column]
                         for source_row in range(start_row, min(start_row + 2, height))
                         for source_column in range(start_column, min(start_column + 2, width))]
            row.append(reducer(footprint))
        result.append(row)
    return result


def edge(first, second, point):
    return (second[0] - first[0]) * (point[1] - first[1]) - (second[1] - first[1]) * (point[0] - first[0])


def barycentric(vertices, point):
    first, second, third = vertices
    area = edge(first, second, third)
    if area == 0:
        raise ValueError('Triangle degenere')
    return [edge(second, third, point) / area, edge(third, first, point) / area, edge(first, second, point) / area]


def perspective_attribute(weights, clip_w, attributes):
    denominator = sum(weight / divisor for weight, divisor in zip(weights, clip_w))
    if denominator == 0:
        raise ValueError('Denominateur nul')
    return sum(weight * value / divisor for weight, divisor, value in zip(weights, clip_w, attributes)) / denominator


def perspective_derivative(weights, derivative_weights, clip_w, attributes):
    denominator = sum(weight / divisor for weight, divisor in zip(weights, clip_w))
    numerator = sum(weight * value / divisor for weight, divisor, value in zip(weights, clip_w, attributes))
    derivative_denominator = sum(weight / divisor for weight, divisor in zip(derivative_weights, clip_w))
    derivative_numerator = sum(weight * value / divisor for weight, divisor, value in zip(derivative_weights, clip_w, attributes))
    return (derivative_numerator * denominator - numerator * derivative_denominator) / denominator ** 2


def quantize(value, step, origin=0.0):
    if step <= 0:
        raise ValueError('Pas invalide')
    scaled = (value - origin) / step
    integer = math.floor(scaled + 0.5)
    return integer, origin + step * integer


def sign_not_zero(value):
    return -1 if value < 0 else 1


def oct_encode(normal):
    total = sum(abs(value) for value in normal)
    if total == 0:
        raise ValueError('Normale nulle')
    horizontal, vertical, depth = [value / total for value in normal]
    if depth < 0:
        horizontal, vertical = (1 - abs(vertical)) * sign_not_zero(horizontal), (1 - abs(horizontal)) * sign_not_zero(vertical)
    return [horizontal, vertical]


def oct_decode(encoded):
    horizontal, vertical = encoded
    depth = 1 - abs(horizontal) - abs(vertical)
    if depth < 0:
        horizontal, vertical = (1 - abs(vertical)) * sign_not_zero(horizontal), (1 - abs(horizontal)) * sign_not_zero(vertical)
    length = norm([horizontal, vertical, depth])
    return [horizontal / length, vertical / length, depth / length]


def crc(data):
    value = 0xFFFFFFFF
    for byte in data:
        value ^= byte
        for bit in range(8):
            value = (value >> 1) ^ (0xEDB88320 if value & 1 else 0)
    return value ^ 0xFFFFFFFF


def packed_weights(weights, maximum):
    if not isinstance(maximum, int) or maximum <= 0:
        raise ValueError('Budget entier invalide')
    if not weights or any(not math.isfinite(value) or value < 0 for value in weights):
        raise ValueError('Poids invalides')
    total = sum(weights)
    if not math.isfinite(total) or total <= 0:
        raise ValueError('Somme invalide')
    raw = [value / total * maximum for value in weights]
    result = [math.floor(value) for value in raw]
    remainder = maximum - sum(result)
    if not 0 <= remainder <= len(result):
        raise ValueError('Arrondi hors domaine')
    order = sorted(range(len(result)), key=lambda index: (-(raw[index] - result[index]), index))
    for index in order[:remainder]:
        result[index] += 1
    return result


def valid_range(offset, size, total):
    return all(isinstance(value, int) and value >= 0 for value in [offset, size, total]) and offset <= total and size <= total - offset


def signed_fold(value):
    return 2 * value if value >= 0 else -2 * value - 1


def signed_unfold(value):
    if not isinstance(value, int) or value < 0:
        raise ValueError('Entier non signe requis')
    return value // 2 if value % 2 == 0 else -(value // 2) - 1

def sphere_ratio_bounds(center, radius, near):
    if (len(center) != 3 or any(not math.isfinite(v) for v in [*center, radius, near])
            or radius < 0 or near <= 0 or center[2] - radius <= near):
        raise ValueError('Sphere hors domaine non clippe')
    z = center[2]
    denominator = z * z - radius * radius
    if not math.isfinite(denominator) or denominator <= 0:
        raise ValueError('Sphere hors plage arithmetique de cet oracle')
    result = []
    for coordinate in center[:2]:
        spread = radius * math.sqrt(coordinate * coordinate + denominator)
        result.append(((coordinate * z - spread) / denominator,
                       (coordinate * z + spread) / denominator))
    if any(not math.isfinite(v) for pair in result for v in pair):
        raise ValueError('Sphere hors plage arithmetique de cet oracle')
    return result


def depth_encode(distance, near, far=None, reversed_z=False):
    if (not math.isfinite(near) or near <= 0 or not math.isfinite(distance)
            or distance < near or (far is not None and
                (not math.isfinite(far) or far <= near or distance > far))):
        raise ValueError('Domaine de profondeur invalide')
    if reversed_z:
        return near / distance if far is None else (near / distance) * ((far - distance) / (far - near))
    return 1 - near / distance if far is None else ((distance - near) / distance) * (far / (far - near))


def depth_decode(value, near, far=None, reversed_z=False):
    if (not math.isfinite(near) or near <= 0 or not math.isfinite(value)
            or not 0 <= value <= 1 or (far is not None and
                (not math.isfinite(far) or far <= near))):
        raise ValueError('Domaine de profondeur invalide')
    if far is None:
        denominator = value if reversed_z else 1 - value
    else:
        ratio = near / far
        denominator = ratio + (1 - ratio) * value if reversed_z else (1 - value) + ratio * value
    return math.inf if denominator == 0 else near / denominator


def dispatch_range(count, workers, index):
    if (any(type(v) is not int for v in [count, workers, index])
            or count < 0 or workers <= 0 or not 0 <= index < workers):
        raise ValueError('Plage de travail invalide')
    return index * count // workers, (index + 1) * count // workers


def affine_rectangle_range(coefficients, center, half_size):
    if (len(coefficients) != 3 or len(center) != 2 or len(half_size) != 2
            or any(not math.isfinite(v) for v in [*coefficients, *center, *half_size])
            or min(half_size) < 0):
        raise ValueError('Rectangle invalide')
    a, b, c = coefficients
    middle = a * center[0] + b * center[1] + c
    radius = abs(a) * half_size[0] + abs(b) * half_size[1]
    return middle - radius, middle + radius


def compose_bit_patches(first, second):
    a1, o1 = first
    a2, o2 = second
    if any(type(v) is not int or v < 0 for v in [a1, o1, a2, o2]):
        raise ValueError('Masque entier non negatif requis')
    return a1 & a2, (o1 & a2) | o2


def barycentric_distance_squared(vertices, first, second):
    if (len(vertices) != 3 or any(len(v) != 3 for v in vertices)
            or len(first) != 3 or len(second) != 3
            or any(not math.isfinite(v) for row in [*vertices, first, second] for v in row)
            or not math.isclose(sum(first), 1) or not math.isclose(sum(second), 1)):
        raise ValueError('Coordonnees barycentriques invalides')
    first = [v / sum(first) for v in first]
    second = [v / sum(second) for v in second]
    delta = [a - b for a, b in zip(first, second)]
    return -sum(delta[i] * delta[j] * sum((vertices[i][k] - vertices[j][k]) ** 2 for k in range(3))
                for i in range(3) for j in range(i + 1, 3))


def bezier_cubic(points, t):
    if (len(points) != 4 or any(len(p) != 3 for p in points)
            or not math.isfinite(t) or not 0 <= t <= 1
            or any(not math.isfinite(v) for p in points for v in p)):
        raise ValueError('Courbe invalide')
    weights = [(1 - t) ** 3, 3 * (1 - t) ** 2 * t, 3 * (1 - t) * t * t, t ** 3]
    return [sum(w * p[axis] for w, p in zip(weights, points)) for axis in range(3)]


def sggx_diagonal(diagonal, normal, view):
    if (any(len(v) != 3 for v in [diagonal, normal, view])
            or any(not math.isfinite(v) for row in [diagonal, normal, view] for v in row)
            or min(diagonal) <= 0 or not math.isclose(norm(normal), 1)
            or not math.isclose(norm(view), 1)):
        raise ValueError('SGGX exige une matrice positive et des directions unitaires')
    sigma = math.sqrt(sum(s * w * w for s, w in zip(diagonal, view)))
    denominator = sum(n * n / s for s, n in zip(diagonal, normal))
    try:
        distribution = 1 / (math.pi * math.sqrt(math.prod(diagonal)) * denominator ** 2)
        pdf = max(0, dot(view, normal)) * distribution / sigma
    except (ZeroDivisionError, OverflowError) as error:
        raise ValueError('SGGX hors plage arithmetique de cet oracle') from error
    if any(not math.isfinite(v) for v in [sigma, distribution, pdf]):
        raise ValueError('SGGX hors plage arithmetique de cet oracle')
    return sigma, distribution, pdf


def transmittance(extinction, length):
    if any(not math.isfinite(v) or v < 0 for v in [extinction, length]):
        raise ValueError('Extinction et longueur finies non negatives requises')
    return math.exp(-extinction * length)
```

## Tests indépendants et contre-exemples

<!-- executable: test_reference_math.py -->
```python
import itertools
import math
import random
import struct
import unittest

import reference_math as reference


class MathematicalContractTests(unittest.TestCase):
    def test_qem_rejects_nonfinite_planes_and_weights(self):
        for invalid in [math.nan, math.inf, -math.inf]:
            with self.subTest(invalid=invalid):
                with self.assertRaises(ValueError):
                    reference.quadric_from_planes([([1, 0, 0, 0], invalid)])
                with self.assertRaises(ValueError):
                    reference.quadric_from_planes([([1, 0, 0, invalid], 1)])

    def test_qem_rejects_wrong_dimensions(self):
        for plane in [[1, 0, 0], [1, 0, 0, 0, 0]]:
            with self.assertRaises(ValueError):
                reference.quadric_from_planes([(plane, 1)])
        with self.assertRaises(ValueError):
            reference.dot([1, 2], [1])

    def test_tetrahedron_common_vertices_are_not_the_full_link(self):
        triangles = [(0, 1, 2), (0, 3, 1), (0, 2, 3), (1, 3, 2)]
        left = reference.simplicial_link(triangles, {0})
        right = reference.simplicial_link(triangles, {1})
        common_vertices = {simplex for simplex in left & right if len(simplex) == 1}
        self.assertEqual(common_vertices, reference.simplicial_link(triangles, {0, 1}))
        self.assertIn((2, 3), left & right)
        self.assertFalse(reference.link_condition(triangles, 0, 1))
        after = [tuple(0 if vertex == 1 else vertex for vertex in face) for face in triangles]
        surviving = [tuple(sorted(face)) for face in after if len(set(face)) == 3]
        self.assertEqual(len(surviving), 2)
        self.assertEqual(len(set(surviving)), 1)

    def test_link_condition_accepts_an_octahedron_edge(self):
        triangles = [(pole, ring[index], ring[(index + 1) % 4])
                     for pole in [0, 1] for ring in [[2, 3, 4, 5]] for index in range(4)]
        self.assertTrue(reference.link_condition(triangles, 0, 2))

    def test_orthographic_error_does_not_shrink_with_distance(self):
        for depth in [1, 100, 10000]:
            score = reference.lod_score(1, 1, [0, 0, depth], [1, 1, depth + 1], [100, 80], 'orthographic', 0)
            self.assertEqual(score, 100)

    def test_lod_error_includes_instance_scale(self):
        for projection in ['orthographic', 'perspective']:
            parameters = ([0, 0, 100], [1, 1, 101], [100, 80], projection, 0.1)
            self.assertAlmostEqual(reference.lod_score(0.01, 10, *parameters),
                                   10 * reference.lod_score(0.01, 1, *parameters))

    def test_lod_projection_and_near_contract(self):
        for projection, near in [('perspective', 0), ('unknown', 0.1), ('orthographic', -1)]:
            with self.assertRaises(ValueError):
                reference.lod_score(1, 1, [0, 0, 1], [1, 1, 2], [100, 100], projection, near)

    def test_wide_cone_must_not_reject_a_visible_normal(self):
        angle = 2 * math.pi / 3
        normal = [math.sqrt(3) / 2, 0, -0.5]
        self.assertGreater(reference.dot(normal, [0, 0, -1]), 0)
        self.assertTrue(-1 < -math.sin(angle))
        self.assertFalse(reference.cone_rejects(-1, angle))

    def test_cone_tangency_and_perspective_spread_are_kept(self):
        self.assertTrue(reference.cone_rejects(-1, math.pi / 6))
        self.assertFalse(reference.cone_rejects(-math.sin(math.pi / 6), math.pi / 6))
        self.assertFalse(reference.cone_rejects(-1, math.pi / 3, math.pi / 6))

    def test_integer_width_boundaries(self):
        for low, high, count in [(0, 0, 0), (-4, -1, 2), (0, 2**32 - 1, 32),
                                 (0, 2**32, 33), (0, 2**63, 64)]:
            self.assertEqual(reference.required_bits(low, high), count)
            self.assertLessEqual(high - low, 2**count - 1)

    def test_point_triangle_interior_edge_and_degeneracy(self):
        triangle = [[0, 0, 0], [2, 0, 0], [0, 2, 0]]
        self.assertEqual(reference.point_triangle_distance([0.5, 0.5, 3], triangle), 3)
        self.assertAlmostEqual(reference.point_triangle_distance([2, 2, 0], triangle), math.sqrt(2))
        self.assertEqual(reference.point_triangle_distance([1, 1, 0], [[0, 0, 0], [2, 0, 0], [2, 0, 0]]), 1)
        self.assertEqual(reference.point_triangle_distance([0, 0, 3], [[0, 0, 0]] * 3), 3)

    def test_surface_samples_need_a_covering_radius(self):
        triangle = [[0, 0, 0], [2, 0, 0], [0, 2, 0]]
        moved = [[point[0], point[1], 1] for point in triangle]
        sample_max = max(reference.point_triangle_distance(point, moved) for point in triangle)
        diameter = math.sqrt(8)
        self.assertEqual(sample_max, 1)
        for u, v in [(0.1, 0.2), (0.25, 0.5), (0.7, 0.1)]:
            self.assertLessEqual(reference.point_triangle_distance([2 * u, 2 * v, 0], moved), sample_max + diameter)

    def test_qem_known_intersection(self):
        quadric = reference.quadric_from_planes([([1, 0, 0, -1], 1), ([0, 1, 0, -2], 1), ([0, 0, 1, -3], 1)])
        optimum = reference.quadric_candidate(quadric, [0, 0, 0], [4, 4, 4])
        self.assertEqual(optimum, [1, 2, 3])
        self.assertAlmostEqual(reference.quadric_energy(quadric, optimum), 0)

    def test_qem_singular_fallback(self):
        quadric = reference.quadric_from_planes([([0, 0, 1, 0], 1)])
        self.assertEqual(reference.quadric_candidate(quadric, [0, 0, 1], [1, 1, -1]), [0.5, 0.5, 0.0])

    def test_qem_energy_matches_plane_distance(self):
        quadric = reference.quadric_from_planes([([0.6, 0.8, 0, -2], 3)])
        point = [4, 5, 6]
        self.assertAlmostEqual(reference.quadric_energy(quadric, point), 3 * (0.6 * 4 + 0.8 * 5 - 2) ** 2)

    def test_qem_rejects_non_normalized_input(self):
        with self.assertRaises(ValueError):
            reference.quadric_from_planes([([2, 0, 0, 0], 1)])

    def test_max_error_is_not_cumulative_bound(self):
        first_displacement = 0.001
        second_displacement = 0.001
        self.assertGreater(first_displacement + second_displacement, max(first_displacement, second_displacement))

    def test_focal_example(self):
        focal = 1080 / (2 * math.tan(math.pi / 6))
        self.assertAlmostEqual(focal * 0.01 / 10, 0.935307436, places=8)

    def test_projected_bound_random_pairs(self):
        generator = random.Random(20260911)
        minimum, maximum, focal = [-8, -5, 2], [7, 9, 30], [900, 1100]
        for _ in range(2000):
            first = [generator.uniform(lower, upper) for lower, upper in zip(minimum, maximum)]
            second = [generator.uniform(lower, upper) for lower, upper in zip(minimum, maximum)]
            error = reference.norm([right - left for left, right in zip(first, second)])
            bound = reference.projected_error_bound(error, minimum, maximum, focal)
            projected_first = reference.projected_point(first, focal)
            projected_second = reference.projected_point(second, focal)
            observed = reference.norm([right - left for left, right in zip(projected_first, projected_second)])
            self.assertLessEqual(observed, bound + 1e-9)

    def test_radial_distance_underestimates_off_axis(self):
        first, second, focal = [10, 0, 10], [10, 0, 10.01], [1000, 1000]
        observed = abs(reference.projected_point(first, focal)[0] - reference.projected_point(second, focal)[0])
        radial_approximation = 1000 * 0.01 / reference.norm(first)
        self.assertGreater(observed, radial_approximation)

    def test_near_plane_requests_refinement(self):
        self.assertTrue(math.isinf(reference.projected_error_bound(0.01, [-1, -1, 0], [1, 1, 3], [900, 900])))

    def test_nested_bounds_project_monotonically(self):
        child = reference.projected_error_bound(0.01, [-1, -1, 10], [1, 1, 12], [900, 900])
        parent = reference.projected_error_bound(0.02, [-3, -3, 8], [3, 3, 15], [900, 900])
        self.assertGreaterEqual(parent, child)

    def test_shear_max_column_not_spectral_bound(self):
        direction = [1 / math.sqrt(2), 1 / math.sqrt(2), 0]
        transformed = [direction[0] + direction[1], direction[1], 0]
        maximum_column = math.sqrt(2)
        self.assertGreater(reference.norm(transformed), maximum_column)

    def test_sphere_union_contains_both(self):
        center, radius = reference.sphere_union([0, 0, 0], 1, [4, 0, 0], 1)
        self.assertEqual((center, radius), ([2, 0, 0], 3))
        self.assertLessEqual(reference.norm(center) + 1, radius)

    def test_sphere_union_coincident(self):
        self.assertEqual(reference.sphere_union([0, 0, 0], 1, [0, 0, 0], 2), ([0, 0, 0], 2))

    def test_aabb_plane_equals_corner_maximum(self):
        center, extent, normal, offset = [1, 2, 3], [0.5, 0.25, 2], [-3, 1, 2], -11
        corners = [[middle + sign * half for middle, sign, half in zip(center, signs, extent)] for signs in itertools.product([-1, 1], repeat=3)]
        expected = max(reference.dot(normal, corner) + offset for corner in corners) < 0
        self.assertEqual(reference.aabb_outside_plane(center, extent, normal, offset), expected)

    def test_tangent_aabb_is_kept(self):
        self.assertFalse(reference.aabb_outside_plane([-1, 0, 0], [1, 1, 1], [1, 0, 0], 0))

    def test_unique_cut_and_threshold_equality(self):
        scores = [8, 2, 0]
        parents = [math.inf, 8, 2]
        for threshold in [0, 1, 2, 3, 8, 10]:
            selected = [score <= threshold < parent for score, parent in zip(scores, parents)]
            self.assertEqual(sum(selected), 1)

    def test_scan_example(self):
        self.assertEqual(reference.exclusive_scan([1, 0, 1, 1, 0]), ([0, 1, 1, 2, 3], 3))

    def test_compaction_empty_and_partial(self):
        self.assertEqual(reference.compact([], []), [])
        self.assertEqual(reference.compact(['a', 'b', 'c'], [1, 0, 1]), ['a', 'c'])

    def test_compaction_matches_filter(self):
        generator = random.Random(121)
        for size in [1, 31, 32, 33, 63, 64, 65, 129]:
            flags = [generator.randrange(2) for _ in range(size)]
            self.assertEqual(reference.compact(list(range(size)), flags), [index for index, flag in enumerate(flags) if flag])

    def test_hiz_background_prevents_false_rejection(self):
        self.assertEqual(reference.hiz_reduce_ceil([[0.2, 0.3], [0.4, 1.0]]), [[1.0]])
        self.assertEqual(reference.hiz_reduce_ceil([[0.8, 0.7], [0.6, 0]], reversed_z=True), [[0]])

    def test_hiz_odd_dimension_keeps_last_column(self):
        level = reference.hiz_reduce_ceil([[0.2, 0.3, 1], [0.4, 0.5, 0.6], [0.7, 0.8, 0.9]])
        self.assertEqual(level, [[0.5, 1], [0.8, 0.9]])
        self.assertEqual(reference.hiz_reduce_ceil(level), [[1]])

    def test_indirect_base_vertex_signed(self):
        command = struct.pack('<IIIiI', 3, 1, 0, -7, 0)
        self.assertEqual(len(command), 20)
        self.assertEqual(struct.unpack_from('<i', command, 12)[0], -7)

    def test_barycentric_vertex_and_center(self):
        vertices = [[0, 0], [3, 0], [0, 3]]
        self.assertEqual(reference.barycentric(vertices, [0, 0]), [1, 0, 0])
        for weight in reference.barycentric(vertices, [1, 1]):
            self.assertAlmostEqual(weight, 1 / 3)

    def test_edge_increment(self):
        first, second, point = [2, 3], [4, 7], [5, 8]
        self.assertEqual(reference.edge(first, second, [6, 8]) - reference.edge(first, second, point), -4)
        self.assertEqual(reference.edge(first, second, [5, 9]) - reference.edge(first, second, point), 2)

    def test_perspective_attribute_example(self):
        self.assertAlmostEqual(reference.perspective_attribute([1 / 3] * 3, [1, 2, 4], [0, 1, 0]), 2 / 7)

    def test_analytic_derivative_matches_same_triangle_finite_difference(self):
        weights, derivative, clip_w, attributes = [0.3, 0.3, 0.4], [-0.2, 0.2, 0], [1, 2, 4], [0.1, 0.8, 0.2]
        epsilon = 1e-5
        after = reference.perspective_attribute([value + epsilon * delta for value, delta in zip(weights, derivative)], clip_w, attributes)
        before = reference.perspective_attribute([value - epsilon * delta for value, delta in zip(weights, derivative)], clip_w, attributes)
        self.assertAlmostEqual(reference.perspective_derivative(weights, derivative, clip_w, attributes), (after - before) / (2 * epsilon), places=9)

    def test_quantization_negative_tie_is_explicit(self):
        self.assertEqual(reference.quantize(-0.5, 1), (0, 0))
        self.assertEqual(reference.quantize(0.5, 1), (1, 1))

    def test_quantization_distance_bound(self):
        generator = random.Random(422)
        step = 0.001
        for _ in range(1000):
            point = [generator.uniform(-10, 10) for _ in range(3)]
            decoded = [reference.quantize(value, step)[1] for value in point]
            self.assertLessEqual(reference.norm([value - decoded_value for value, decoded_value in zip(point, decoded)]), math.sqrt(3) * step / 2 + 1e-12)

    def test_octahedral_roundtrip(self):
        generator = random.Random(234)
        normals = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 0, -1]]
        normals.extend([[generator.uniform(-1, 1) for _ in range(3)] for _ in range(1000)])
        for normal in normals:
            expected = [value / reference.norm(normal) for value in normal]
            reconstructed = reference.oct_decode(reference.oct_encode(normal))
            self.assertLess(reference.norm([value - other for value, other in zip(expected, reconstructed)]), 1e-12)

    def test_amdahl_example(self):
        self.assertAlmostEqual(1 / (0.9 + 0.1 / 4), 1.081081081081081)

    def test_crc_check_value(self):
        self.assertEqual(reference.crc(b'123456789'), 0xCBF43926)

    def test_crc_empty(self):
        self.assertEqual(reference.crc(b''), 0)

    def test_weight_integer_sum(self):
        self.assertEqual(reference.packed_weights([0.2, 0.3, 0.5], 255), [51, 77, 127])
        self.assertEqual(reference.packed_weights([1, 1, 1], 4), [2, 1, 1])

    def test_weight_random_sum(self):
        generator = random.Random(715)
        for count in range(1, 20):
            weights = [generator.random() for index in range(count)]
            result = reference.packed_weights(weights, 255)
            self.assertEqual(sum(result), 255)
            self.assertTrue(all(0 <= value <= 255 for value in result))

    def test_weight_rejects_invalid_input(self):
        for weights in [[], [0, 0], [-1, 2], [math.nan], [math.inf]]:
            with self.assertRaises(ValueError):
                reference.packed_weights(weights, 255)

    def test_section_ranges(self):
        self.assertTrue(reference.valid_range(10, 90, 100))
        self.assertTrue(reference.valid_range(100, 0, 100))
        self.assertFalse(reference.valid_range(10, 91, 100))
        self.assertFalse(reference.valid_range(-1, 1, 100))
        self.assertFalse(reference.valid_range(2**64 - 1, 2, 2**64))

    def test_signed_integer_roundtrip(self):
        for value in range(-1000, 1001):
            self.assertEqual(reference.signed_unfold(reference.signed_fold(value)), value)

    def test_weight_budget_rejected(self):
        for maximum in [0, -1, 1.5]:
            with self.assertRaises(ValueError):
                reference.packed_weights([1], maximum)


    def test_sphere_bounds_contain_sampled_surface(self):
        generator = random.Random(650)
        for center, radius in [([0, 0, 3], 1), ([13, -7, 4], 2), ([-8, 2, 10], 0.1)]:
            bounds = reference.sphere_ratio_bounds(center, radius, 0.1)
            for _ in range(1500):
                z = generator.uniform(-1, 1)
                phi = generator.random() * math.tau
                point = [center[0] + radius * math.sqrt(1 - z * z) * math.cos(phi),
                         center[1] + radius * math.sqrt(1 - z * z) * math.sin(phi), center[2] + radius * z]
                for axis in range(2):
                    self.assertLessEqual(bounds[axis][0] - 1e-12, point[axis] / point[2])
                    self.assertLessEqual(point[axis] / point[2], bounds[axis][1] + 1e-12)

    def test_sphere_bound_ray_is_tangent(self):
        for x, z, radius in [(2, 5, 1), (-13, 3, 2), (0, 8, 4)]:
            for slope in reference.sphere_ratio_bounds([x, 0, z], radius, 0.1)[0]:
                distance_to_line = abs(x - slope * z) / math.sqrt(1 + slope * slope)
                self.assertAlmostEqual(distance_to_line, radius, places=12)

    def test_sphere_zero_and_clipped_domain(self):
        self.assertEqual(reference.sphere_ratio_bounds([2, 4, 8], 0, 1), [(0.25, 0.25), (0.5, 0.5)])
        for center, radius, near in [([0, 0, 2], 1, 1), ([0, 0, 0], 1, 0.1), ([0, 0, 3], -1, 1), ([math.nan, 0, 3], 1, 1), ([1e200, 0, 1e200], 0, 1)]:
            with self.assertRaises(ValueError):
                reference.sphere_ratio_bounds(center, radius, near)

    def test_finite_depth_endpoints_and_roundtrip(self):
        for near, far in [(0.1, 100), (1, 10000), (2, 3)]:
            for reverse in [False, True]:
                self.assertAlmostEqual(reference.depth_encode(near, near, far, reverse), int(reverse))
                self.assertAlmostEqual(reference.depth_encode(far, near, far, reverse), int(not reverse))
                for distance in [near, math.sqrt(near * far), far]:
                    q = reference.depth_encode(distance, near, far, reverse)
                    self.assertTrue(math.isclose(reference.depth_decode(q, near, far, reverse), distance, rel_tol=1e-10))

    def test_infinite_depth_and_background(self):
        for reverse in [False, True]:
            for distance in [0.1, 1, 1000]:
                q = reference.depth_encode(distance, 0.1, reversed_z=reverse)
                self.assertTrue(math.isclose(reference.depth_decode(q, 0.1, reversed_z=reverse), distance, rel_tol=1e-10))
            self.assertEqual(reference.depth_decode(int(not reverse), 0.1, reversed_z=reverse), math.inf)

    def test_depth_derivative_matches_difference(self):
        near, far, distance = 1, 100, 7
        q = reference.depth_encode(distance, near, far)
        step = 1e-7
        numerical = (reference.depth_decode(q + step, near, far) - reference.depth_decode(q - step, near, far)) / (2 * step)
        self.assertAlmostEqual(numerical, distance * distance * (far - near) / (near * far), places=6)

    def test_reversed_depth_preserves_small_values(self):
        self.assertAlmostEqual(reference.depth_decode(1, 1, 1e20) / 1e20, 1)
        self.assertAlmostEqual(reference.depth_encode(1e16, 0.1, reversed_z=True) / 1e-17, 1)
        self.assertAlmostEqual(reference.depth_decode(1e-17, 0.1, reversed_z=True) / 1e16, 1)
        for far in [1e18, 1e30]:
            distance = 1e16
            q = reference.depth_encode(distance, 0.1, far, True)
            self.assertAlmostEqual(reference.depth_decode(q, 0.1, far, True) / distance, 1)

    def test_depth_invalid_domain(self):
        for q, near, far in [(math.nan, 1, 2), (-0.1, 1, 2), (0.5, 0, 2), (0.5, 2, 1)]:
            with self.assertRaises(ValueError):
                reference.depth_decode(q, near, far)

    def test_dispatch_ranges_cover_once(self):
        for count in [0, 1, 7, 64, 65, 1001]:
            for workers in [1, 3, 16, 128]:
                visited = [i for w in range(workers) for i in range(*reference.dispatch_range(count, workers, w))]
                self.assertEqual(visited, list(range(count)))

    def test_dispatch_exact_large_integer_boundaries(self):
        count, workers = 2**64 - 1, 7
        intervals = [reference.dispatch_range(count, workers, i) for i in range(workers)]
        self.assertEqual(intervals[0][0], 0)
        self.assertEqual(intervals[-1][1], count)
        self.assertTrue(all(a[1] == b[0] for a, b in zip(intervals, intervals[1:])))
        self.assertLessEqual(max(b - a for a, b in intervals) - min(b - a for a, b in intervals), 1)

    def test_dispatch_rejects_invalid_ranges(self):
        for values in [(-1, 1, 0), (3, 0, 0), (3, 2, 2), (3, 2, -1), (3.5, 2, 0)]:
            with self.assertRaises(ValueError):
                reference.dispatch_range(*values)

    def test_affine_rectangle_extrema_match_corners(self):
        generator = random.Random(777)
        for _ in range(1000):
            a, b, c, x, y = [generator.uniform(-9, 9) for _ in range(5)]
            hx, hy = generator.random(), generator.random()
            corners = [a * (x + sx * hx) + b * (y + sy * hy) + c for sx in [-1, 1] for sy in [-1, 1]]
            low, high = reference.affine_rectangle_range([a, b, c], [x, y], [hx, hy])
            self.assertAlmostEqual(low, min(corners), places=11)
            self.assertAlmostEqual(high, max(corners), places=11)

    def test_outer_coverage_does_not_prove_inner_coverage(self):
        for coefficients in [[1, 0, 0], [0, 1, 0], [-1, -1, 0.1]]:
            low, high = reference.affine_rectangle_range(coefficients, [0, 0], [0.5, 0.5])
            self.assertGreaterEqual(high, 0)
            self.assertLess(low, 0)

    def test_bit_patch_composition_exhaustive_two_bits(self):
        for a1 in range(4):
            for o1 in range(4):
                for a2 in range(4):
                    for o2 in range(4):
                        a, o = reference.compose_bit_patches((a1, o1), (a2, o2))
                        for value in range(4):
                            self.assertEqual((value & a) | o, (((value & a1) | o1) & a2) | o2)

    def test_bit_patch_order_matters(self):
        set_bit, clear_bit = (3, 1), (2, 0)
        self.assertNotEqual(reference.compose_bit_patches(set_bit, clear_bit), reference.compose_bit_patches(clear_bit, set_bit))

    def test_barycentric_distance_matches_cartesian(self):
        vertices = [[1e9, 0, 0], [1e9 + 1, 0, 0], [1e9, 1, 0]]
        self.assertEqual(reference.barycentric_distance_squared(vertices, [1 + 5e-10, 0, 0], [1, 0, 0]), 0)
        generator = random.Random(322)
        for _ in range(500):
            vertices = [[generator.uniform(-10, 10) for _ in range(3)] for _ in range(3)]
            first, second = [[generator.random() for _ in range(3)] for _ in range(2)]
            first, second = [v / sum(first) for v in first], [v / sum(second) for v in second]
            p, q = [[sum(w * point[k] for w, point in zip(weights, vertices)) for k in range(3)] for weights in [first, second]]
            self.assertAlmostEqual(reference.barycentric_distance_squared(vertices, first, second), sum((a - b) ** 2 for a, b in zip(p, q)), places=10)

    def test_weight_truncation_bound_under_divergent_poses(self):
        generator = random.Random(181)
        for _ in range(500):
            weights = [generator.random() for _ in range(5)]
            weights = [w / sum(weights) for w in weights]
            positions = [[generator.uniform(-10, 10) for _ in range(3)] for _ in weights]
            removed = sum(weights[3:])
            original = [sum(w * p[k] for w, p in zip(weights, positions)) for k in range(3)]
            reduced = [sum(w * p[k] / (1 - removed) for w, p in zip(weights[:3], positions[:3])) for k in range(3)]
            diameter = max(reference.norm([a - b for a, b in zip(p, q)]) for p in positions for q in positions)
            self.assertLessEqual(reference.norm([a - b for a, b in zip(original, reduced)]), removed * diameter + 1e-12)

    def test_bezier_endpoints_and_de_casteljau(self):
        points = [[0, 0, 0], [3, -1, 2], [-2, 4, 5], [1, 0, 0]]
        self.assertEqual(reference.bezier_cubic(points, 0), points[0])
        self.assertEqual(reference.bezier_cubic(points, 1), points[-1])
        for step in range(101):
            t, layer = step / 100, points
            for _ in range(3):
                layer = [[(1 - t) * a + t * b for a, b in zip(p, q)] for p, q in zip(layer, layer[1:])]
            for a, b in zip(reference.bezier_cubic(points, t), layer[0]):
                self.assertAlmostEqual(a, b, places=13)

    def test_bezier_uniform_parameter_is_not_uniform_length(self):
        points = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [8, 0, 0]]
        self.assertEqual(reference.bezier_cubic(points, 0.5), [1, 0, 0])

    def test_sggx_isotropic_reference(self):
        sigma, distribution, pdf = reference.sggx_diagonal([1, 1, 1], [0, 0, 1], [0, 0, 1])
        self.assertEqual(sigma, 1)
        self.assertAlmostEqual(distribution, 1 / math.pi)
        self.assertEqual(pdf, distribution)

    def test_sggx_visible_pdf_quadrature(self):
        nz, nphi = 160, 160
        integral = 0.0
        for iz in range(nz):
            z = -1 + (iz + 0.5) * 2 / nz
            for iphi in range(nphi):
                phi = (iphi + 0.5) * math.tau / nphi
                normal = [math.sqrt(1 - z * z) * math.cos(phi), math.sqrt(1 - z * z) * math.sin(phi), z]
                integral += reference.sggx_diagonal([0.5, 1, 2], normal, [0, 0, 1])[2]
        self.assertAlmostEqual(integral * 4 * math.pi / (nz * nphi), 1, delta=0.002)

    def test_sggx_rejects_singular_matrix_and_nonunit_directions(self):
        for diagonal, direction in [([1, 1, 0], [0, 0, 1]), ([1, 1, -1], [0, 0, 1]), ([1, 1, 1], [0, 0, 2]), ([1e200] * 3, [0, 0, 1])]:
            with self.assertRaises(ValueError):
                reference.sggx_diagonal(diagonal, direction, [0, 0, 1])

    def test_transmittance_segmentation_invariance(self):
        expected = reference.transmittance(2, 0.5)
        self.assertAlmostEqual(expected, math.exp(-1))
        for count in [1, 2, 32, 100]:
            self.assertAlmostEqual(reference.transmittance(2, 0.5 / count) ** count, expected, places=13)
        self.assertEqual(reference.transmittance(0, 5), 1)

    def test_transmittance_rejects_invalid_domain(self):
        for extinction, length in [(-1, 2), (2, -1), (math.nan, 1), (1, math.inf)]:
            with self.assertRaises(ValueError):
                reference.transmittance(extinction, length)

    def test_perspective_uniform_object_split_is_not_screen_uniform(self):
        start, middle, end = 0 / 1, 1 / 1.5, 2 / 2
        self.assertEqual(math.ceil((end - start) / 0.5), 2)
        self.assertGreater(middle - start, 0.5)


if __name__ == '__main__':
    unittest.main(verbosity=2)
```
