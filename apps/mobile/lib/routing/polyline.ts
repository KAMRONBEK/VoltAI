/**
 * Google encoded-polyline decoder, precision 5 — the format the routing API returns.
 *
 * Hand-written rather than pulled from npm: it is ~25 lines, and the shape it produces
 * ({ latitude, longitude }) is already what `expo-yandex-mapkit`'s Point wants, so a package
 * would add a dependency and an adapter to save nothing.
 *
 * Note the divisor is 1e5, not 1e6 — precision 6 would place every point off the coast of Africa.
 */

export interface Point {
  latitude: number;
  longitude: number;
}

export function decodePolyline(encoded: string, precision = 5): Point[] {
  const factor = Math.pow(10, precision);
  const points: Point[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    result = 0;
    shift = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    points.push({ latitude: lat / factor, longitude: lng / factor });
  }
  return points;
}

/**
 * Thin a decoded line for rendering. A 450 km route decodes to ~2800 vertices; the map does not
 * need them all to draw a smooth line, and fewer points means less bridge traffic on a device
 * that is also drawing a clustered station layer.
 */
export function simplify(points: Point[], maxPoints = 600): Point[] {
  if (points.length <= maxPoints) return points;
  const step = Math.ceil(points.length / maxPoints);
  const out: Point[] = [];
  for (let i = 0; i < points.length; i += step) out.push(points[i]);
  // Always keep the true endpoint, or the line stops short of the destination.
  const last = points[points.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}
