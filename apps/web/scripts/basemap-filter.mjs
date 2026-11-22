/**
 * Does a country's outline overlap the map's box? (findings register CR37)
 *
 * The old test kept a country only if one of its boundary points fell inside the box, so a country
 * that CONTAINS the whole map area (no boundary point inside) was dropped, as was one whose edge
 * merely crosses the box. Comparing each part's bounding box with the map's keeps both; it may keep
 * a near neighbour too, which only costs a few bytes.
 *
 * @param {{ type: string, coordinates: any }} geometry  GeoJSON Polygon or MultiPolygon
 * @param {[number, number, number, number]} box  [west, south, east, north]
 */
export function overlapsBox(geometry, [w, s, e, n]) {
  // Each part on its own: one bounding box for all of France (Europe plus islands) would span half
  // the globe. A part more than 180 degrees wide crosses the date line; its box means nothing here.
  const parts = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  return parts.some((polygon) => {
    let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const [x, y] of polygon[0]) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    return maxX - minX <= 180 && minX <= e && maxX >= w && minY <= n && maxY >= s;
  });
}
