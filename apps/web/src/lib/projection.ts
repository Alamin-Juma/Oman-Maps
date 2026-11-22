import { geoMercator, geoPath } from "d3-geo";

type LonLat = [number, number];

/**
 * Projection that fits a pack's printed bounds into the drawing area.
 *
 * Note: fit to the two corner POINTS, not a rectangle polygon. d3-geo treats polygons
 * as spherical, so a counter-clockwise ring means "the whole globe except this box"
 * and the fit zooms out to the entire world (bug caught 2026-11-07).
 */
export function createMapProjection(bounds: [LonLat, LonLat], extent: [[number, number], [number, number]], scaleKm = 200) {
  const [[w, s], [e, n]] = bounds;
  const projection = geoMercator().fitExtent(extent, { type: "MultiPoint", coordinates: [[w, s], [e, n]] });

  const lat = (s + n) / 2;
  const dLon = scaleKm / (111.32 * Math.cos((lat * Math.PI) / 180));
  // Mercator x is scale x longitude (radians), so the width needs no second projected point. Projecting
  // a point past 180 degrees wrapped it to -180 and gave a negative width (findings register CR38).
  const scaleBarPx = projection.scale() * ((dLon * Math.PI) / 180);

  return {
    path: geoPath(projection),
    project: (p: LonLat): [number, number] => projection(p) as [number, number],
    scaleBar: { km: scaleKm, px: scaleBarPx },
  };
}
