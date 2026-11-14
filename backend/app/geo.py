"""Medidas geométricas simples (sin dependencias) para la síntesis y la exportación."""
import math

R = 6371008.8


def haversine(a, b) -> float:
    lon1, lat1, lon2, lat2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


def line_length(coords) -> float:
    return sum(haversine(coords[i], coords[i + 1]) for i in range(len(coords) - 1))


def _project(coords):
    lat0 = math.radians(sum(c[1] for c in coords) / len(coords))
    return [(math.radians(c[0]) * R * math.cos(lat0), math.radians(c[1]) * R) for c in coords]


def ring_area(ring) -> float:
    if len(ring) < 4:
        return 0.0
    p = _project(ring)
    return abs(sum(p[i][0] * p[i + 1][1] - p[i + 1][0] * p[i][1] for i in range(len(p) - 1))) / 2


def polygon_area(geom) -> float:
    if not geom:
        return 0.0
    polys = [geom["coordinates"]] if geom["type"] == "Polygon" else geom["coordinates"]
    return sum(ring_area(p[0]) - sum(ring_area(h) for h in p[1:]) for p in polys)


def polygon_perimeter(geom) -> float:
    if not geom:
        return 0.0
    polys = [geom["coordinates"]] if geom["type"] == "Polygon" else geom["coordinates"]
    return sum(line_length(p[0]) for p in polys)


def point_in_ring(pt, ring) -> bool:
    x, y, inside = pt[0], pt[1], False
    for i in range(len(ring) - 1):
        x1, y1, x2, y2 = *ring[i][:2], *ring[i + 1][:2]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            inside = not inside
    return inside


def point_in_polygon(pt, geom) -> bool:
    if not geom:
        return False
    polys = [geom["coordinates"]] if geom["type"] == "Polygon" else geom["coordinates"]
    return any(point_in_ring(pt, p[0]) and not any(point_in_ring(pt, h) for h in p[1:]) for p in polys)
