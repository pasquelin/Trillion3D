# Algorithmes de base

> Conception Web Geometry : ce chapitre décrit des contrats et algorithmes proposés. Voir [l’état de l’implémentation](../../../packages/README.md).

<a id="code"></a>

Ces exemples utilisent les conventions et domaines des chapitres. Les indices d'adjacence sont des identités géométriques ; les copies d'attributs restent distinctes. La partition canonique part de l'ID minimal et minimise les nouveaux sommets. Une variante Morton change explicitement l'ordre des graines.

```text
dot(left, right):
    require size(left) == size(right)
    return sum(left[index] * right[index] for index in range(size(left)))

length(vector):
    return sqrt(dot(vector, vector))

cross(left, right):
    return [left.y * right.z - left.z * right.y,
            left.z * right.x - left.x * right.z,
            left.x * right.y - left.y * right.x]

unit(vector):
    size = length(vector)
    if size == 0:
        return invalid
    return vector / size

area(first, second, third):
    return length(cross(second - first, third - first)) / 2
```

```text
neighbors(triangles):
    edges = empty_map()
    for face, triangle in enumerate(triangles):
        for start, end in triangle.edges:
            key = [min(start, end), max(start, end)]
            edges[key].append([face, start, end])
    graph = empty_graph(size(triangles))
    for key, occurrences in edges.items():
        if size(occurrences) == 1:
            mark_and_lock_open_boundary(key)
        elif size(occurrences) == 2:
            leftFace, leftStart, leftEnd = occurrences[0]
            rightFace, rightStart, rightEnd = occurrences[1]
            if leftStart == rightEnd and leftEnd == rightStart:
                graph.connect(leftFace, rightFace)
            else:
                mark_and_lock_non_manifold(key, occurrences)
        else:
            mark_and_lock_non_manifold(key, occurrences)
    classify_vertex_links_and_lock(triangles)
    return graph, edges
```

```text
split(triangles, graph, maxFaces, maxVertices):
    require maxFaces >= 1 and maxVertices >= 3
    unused = sorted_ids(triangles)
    clusters = []
    while not empty(unused):
        faces = [unused.remove_first()]
        vertices = vertex_ids(faces)
        while size(faces) < maxFaces:
            candidates = union(graph[face] for face in faces) intersect unused
            candidates = [face for face in candidates
                          if size(vertices union vertex_ids(face)) <= maxVertices]
            if empty(candidates):
                break
            nextFace = min(candidates, key=lambda face: [size(vertex_ids(face) minus vertices), face.id])
            faces.append(nextFace)
            vertices = vertices union vertex_ids(nextFace)
            unused.remove(nextFace)
        clusters.append([faces, vertices])
    return clusters
```

```text
quadric(planes, weights, tolerance):
    require size(planes) == size(weights)
    require tolerance > 0
    matrix = zeros(4, 4)
    for plane, weight in zip(planes, weights):
        require finite(plane) and weight >= 0
        require abs(length(plane.xyz) - 1) <= tolerance
        for row in range(4):
            for column in range(4):
                matrix[row, column] += weight * plane[row] * plane[column]
    return matrix

cost(matrix, point):
    value = [point.x, point.y, point.z, 1]
    return dot(value, matrix * value)
```

```text
solve(matrix, target, tolerance):
    require finite(matrix) and finite(target) and tolerance > 0
    count = size(target)
    require shape(matrix) == [count, count] and count > 0
    rows = append_column(copy(matrix), target)
    scale = max(abs(value) for value in matrix)
    if scale == 0:
        return invalid
    for column in range(count):
        pivot = max(range(column, count), key=lambda row: abs(rows[row, column]))
        if abs(rows[pivot, column]) <= tolerance * scale:
            return invalid
        swap(rows[column], rows[pivot])
        rows[column] /= rows[column, column]
        for row in range(count):
            if row != column:
                rows[row] -= rows[row, column] * rows[column]
    result = rows[:, count]
    return result if finite(result) else invalid

candidate(left, right, leftMatrix, rightMatrix, tolerance):
    matrix = leftMatrix + rightMatrix
    points = [left, right, (left + right) / 2]
    best = solve(matrix[0:3, 0:3], -matrix[0:3, 3], tolerance)
    if best != invalid:
        points.append(best)
    return sort(points, key=lambda point: cost(matrix, point))
```

```text
simplicialLink(mesh, simplex):
    result = empty_set()
    for face in mesh.triangles:
        vertices = set(face.vertexIds)
        if simplex subset_of vertices:
            for subset in nonempty_subsets(vertices minus simplex):
                result.add(sorted_tuple(subset))
    return result

safeFace(before, after, minArea, minCos):
    oldNormal = cross(before[1] - before[0], before[2] - before[0])
    newNormal = cross(after[1] - after[0], after[2] - after[0])
    if length(oldNormal) == 0 or length(newNormal) / 2 <= minArea:
        return false
    return dot(unit(oldNormal), unit(newNormal)) >= minCos

canCollapse(edge, point, mesh, minArea, minCos):
    if edge.nonManifold or edge.materialSeam or edge.lockedBoundary:
        return false
    if edge.start.locked and point != edge.start.position:
        return false
    if edge.end.locked and point != edge.end.position:
        return false
    if common_neighbors(edge) != opposite_vertices(edge.faces):
        return false
    leftLink = simplicialLink(mesh, {edge.start.id})
    rightLink = simplicialLink(mesh, {edge.end.id})
    edgeLink = simplicialLink(mesh, {edge.start.id, edge.end.id})
    if leftLink intersect rightLink != edgeLink:
        return false
    seenFaces = empty_set()
    for face in mesh.triangles:
        ids = [edge.start.id if id == edge.end.id else id for id in face.vertexIds]
        if size(set(ids)) < 3:
            continue
        key = sorted_tuple(ids)
        if key in seenFaces:
            return false
        seenFaces.add(key)
    for face in surviving_faces_after_collapse(edge):
        after = replace_endpoints(face, edge, point)
        if not safeFace(face.positions, after, minArea, minCos):
            return false
    return true
```

```text
nearSegment(point, start, end):
    direction = end - start
    size = dot(direction, direction)
    if size == 0:
        return start
    ratio = clamp(dot(point - start, direction) / size, 0, 1)
    return start + ratio * direction

nearTriangle(point, first, second, third):
    edgeA = second - first
    edgeB = third - first
    normal = cross(edgeA, edgeB)
    candidates = [nearSegment(point, first, second),
                  nearSegment(point, second, third),
                  nearSegment(point, third, first)]
    normalSize = dot(normal, normal)
    if normalSize > 0:
        projected = point - normal * dot(point - first, normal) / normalSize
        offset = projected - first
        aa = dot(edgeA, edgeA)
        ab = dot(edgeA, edgeB)
        bb = dot(edgeB, edgeB)
        pa = dot(offset, edgeA)
        pb = dot(offset, edgeB)
        determinant = aa * bb - ab * ab
        if determinant > 0:
            weightA = (bb * pa - ab * pb) / determinant
            weightB = (aa * pb - ab * pa) / determinant
            if weightA >= 0 and weightB >= 0 and weightA + weightB <= 1:
                candidates.append(projected)
    return min(candidates, key=lambda candidate: length(point - candidate))
```

```text
surfaceBound(cells, triangles):
    require size(cells) > 0 and size(triangles) > 0
    samples = union(cell.vertices for cell in cells)
    maxCellSize = max(length(left - right) for cell in cells
                      for left, right in distinct_pairs(cell.vertices))
    farthest = 0
    for point in samples:
        nearest = min(length(point - nearTriangle(point, triangle[0], triangle[1], triangle[2]))
                      for triangle in triangles)
        farthest = max(farthest, nearest)
    return farthest + maxCellSize
```

```text
joinBoxes(boxes):
    require size(boxes) > 0
    return [component_min(box.min for box in boxes),
            component_max(box.max for box in boxes)]

moveBox(center, extent, matrix, translation):
    require all(extent >= 0)
    return [matrix * center + translation, abs(matrix) * extent]

outside(center, extent, normal, offset):
    require all(extent >= 0)
    radius = dot(abs(normal), extent)
    return dot(normal, center) + offset + radius < 0
```

```text
screenError(error, box, focal, near):
    require error >= 0 and near > 0 and all(focal > 0)
    require finite(error, box, focal)
    require all(box.min <= box.max)
    depth = box.min.z
    if depth <= near:
        return infinity
    reachX = max(abs(box.min.x), abs(box.max.x))
    reachY = max(abs(box.min.y), abs(box.max.y))
    reach = reachX * reachX + reachY * reachY
    scale = max(abs(focal.x), abs(focal.y)) / depth
    return error * scale * sqrt(1 + reach / (depth * depth))

choose(error, parentError, threshold):
    require threshold >= 0
    require parentError >= error >= 0
    return error <= threshold and parentError > threshold
```

```text
depthMap(depth, reverse):
    require height(depth) > 0 and width(depth) > 0
    result = grid(ceil(width(depth) / 2), ceil(height(depth) / 2))
    for row in range(height(result)):
        for column in range(width(result)):
            values = []
            for nextRow in range(2 * row, min(2 * row + 2, height(depth))):
                for nextColumn in range(2 * column, min(2 * column + 2, width(depth))):
                    values.append(depth[nextRow, nextColumn])
            result[row, column] = min(values) if reverse else max(values)
    return result

hidden(nearest, coveredDepths, reverse, bias):
    require bias >= 0 and size(coveredDepths) > 0
    if reverse:
        return nearest < min(coveredDepths) - bias
    return nearest > max(coveredDepths) + bias
```

```text
scan(flags):
    offsets = []
    total = 0
    for keep in flags:
        require keep == 0 or keep == 1
        offsets.append(total)
        total += keep
    return offsets, total

compact(values, flags, capacity):
    require size(values) == size(flags)
    offsets, total = scan(flags)
    if total > capacity:
        return overflow
    output = array(total)
    for index in range(size(values)):
        if flags[index] == 1:
            output[offsets[index]] = values[index]
    return output
```

```text
edge(start, end, point):
    return (end.x - start.x) * (point.y - start.y)
         - (end.y - start.y) * (point.x - start.x)

weights(first, second, third, point):
    area = edge(first, second, third)
    if area == 0:
        return invalid
    return [edge(second, third, point),
            edge(third, first, point),
            edge(first, second, point)] / area

interpolate(weights, clipW, values):
    require all(clipW > 0)
    factors = weights / clipW
    divisor = sum(factors)
    if divisor == 0:
        return invalid
    return sum(factors * values) / divisor

gradient(weights, deltaWeights, clipW, values):
    require all(clipW > 0)
    numerator = sum(weights * values / clipW)
    divisor = sum(weights / clipW)
    if divisor == 0:
        return invalid
    deltaNumerator = sum(deltaWeights * values / clipW)
    deltaDivisor = sum(deltaWeights / clipW)
    return (deltaNumerator * divisor - numerator * deltaDivisor) / (divisor * divisor)
```

```text
encode(position, origin, step):
    require step > 0 and finite(position, origin, step)
    scaled = (position - origin) / step
    return floor(scaled + 0.5)

decode(encoded, origin, step):
    require step > 0
    return origin + step * encoded

bits(low, high):
    require integers(low, high) and high >= low
    remaining = high - low
    count = 0
    while remaining > 0:
        remaining = remaining // 2
        count += 1
    return count
```

```text
prepareTable(page, asset, generation):
    if generation != asset.generation:
        return stale
    if not page.validated or not page.uploadComplete:
        return pending
    if any(not dependency.resident for dependency in page.dependencies):
        return pending
    nextTable = copy(asset.pageTable)
    nextTable[page.id] = [page.slot, generation]
    return nextTable

canEvict(page):
    return not page.root
       and page.pins == 0
       and page.cpuReaders == 0
       and page.gpuReaders == 0
       and page.pendingFixups == 0
```

```text
clipPolygon(vertices, plane):
    if empty(vertices):
        return []
    output = []
    previous = vertices.last
    previousDistance = dot(plane, previous.clip)
    for current in vertices:
        currentDistance = dot(plane, current.clip)
        if (previousDistance >= 0) != (currentDistance >= 0):
            ratio = previousDistance / (previousDistance - currentDistance)
            output.append((1 - ratio) * previous + ratio * current)
        if currentDistance >= 0:
            output.append(current)
        previous = current
        previousDistance = currentDistance
    return output

clipTriangle(triangle, planes):
    polygon = triangle
    for plane in planes:
        polygon = clipPolygon(polygon, plane)
    result = []
    for index in range(1, size(polygon) - 1):
        result.append([polygon[0], polygon[index], polygon[index + 1]])
    return result
```

```text
rayBox(origin, direction, low, high, near, far):
    require 0 <= near <= far
    for axis in range(3):
        if direction[axis] == 0:
            if origin[axis] < low[axis] or origin[axis] > high[axis]:
                return miss
        else:
            first = (low[axis] - origin[axis]) / direction[axis]
            second = (high[axis] - origin[axis]) / direction[axis]
            near = max(near, min(first, second))
            far = min(far, max(first, second))
            if near > far:
                return miss
    return [near, far]

buildTree(triangles, capacity):
    require capacity >= 1
    if empty(triangles):
        return emptyTree
    box = joinBoxes(triangle.box for triangle in triangles)
    if size(triangles) <= capacity:
        return Leaf(box, triangles)
    centers = joinBoxes(point_box(triangle.center) for triangle in triangles)
    axis = argmax(centers.max - centers.min)
    order = sort(triangles, key=lambda triangle: [triangle.center[axis], triangle.id])
    middle = floor(size(order) / 2)
    return Node(box, buildTree(order[:middle], capacity), buildTree(order[middle:], capacity))
```
