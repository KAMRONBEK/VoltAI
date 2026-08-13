/**
 * Corridor linearization: turn a road polyline into a 1-D axis, and project stations onto it.
 *
 * This is what makes the planner cheap. A general EV routing problem needs pairwise road
 * distances between every candidate stop — O(C^2) routing calls, which is unaffordable against
 * a third-party API we do not control. Instead we take ONE route for the whole trip and treat
 * every candidate as (progress along that route, lateral offset from it). Leg distance becomes
 * arc-length difference plus detours, at zero extra network cost.
 *
 * The approximation is sound because intercity EV trips follow one road: the candidates worth
 * considering are all within a few km of it. It breaks down for large lateral offsets, which is
 * why D_MAX is small and why detour distance is inflated beyond 2 km (see driveMin).
 *
 * Pure module — no I/O, no Node built-ins.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

export interface Projected {
  /** Distance along the polyline from its start, in km. */
  progressKm: number;
  /** Perpendicular distance from the polyline, in km. */
  lateralKm: number;
}

const EARTH_R_KM = 6371;
const DEG = Math.PI / 180;

/**
 * Google encoded-polyline decoder, precision 5 (what MyTaxi returns).
 * ~25 lines, so no dependency: adding one to the RN bundle for this would be silly.
 */
export function decodePolyline(encoded: string, precision = 5): LatLng[] {
  const factor = Math.pow(10, precision);
  const points: LatLng[] = [];
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

    points.push({ lat: lat / factor, lng: lng / factor });
  }
  return points;
}

export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = (b.lat - a.lat) * DEG;
  const dLng = (b.lng - a.lng) * DEG;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * DEG) * Math.cos(b.lat * DEG) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R_KM * Math.asin(Math.sqrt(s));
}

/** Grid cell size for the segment index, in degrees. */
const CELL_DEG = 0.05;

function cellKey(lat: number, lng: number): string {
  return `${Math.floor(lat / CELL_DEG)}:${Math.floor(lng / CELL_DEG)}`;
}

export class Corridor {
  readonly points: LatLng[];
  /** Cumulative km at each vertex; last entry is the total route length. */
  readonly cumKm: number[];
  readonly totalKm: number;
  /** Metres-per-degree scale factors for the local equirectangular frame. */
  private readonly kx: number;
  private readonly ky: number;
  private readonly grid: Map<string, number[]>;

  constructor(points: LatLng[]) {
    if (points.length < 2) throw new Error("Corridor needs at least 2 points");
    this.points = points;

    this.cumKm = [0];
    for (let i = 1; i < points.length; i++) {
      this.cumKm.push(this.cumKm[i - 1] + haversineKm(points[i - 1], points[i]));
    }
    this.totalKm = this.cumKm[this.cumKm.length - 1];

    // One cos(lat) for the whole corridor: over a few degrees of latitude the error is far
    // below the lateral tolerances we care about, and it keeps projection branch-free.
    const midLat = points[Math.floor(points.length / 2)].lat;
    this.ky = EARTH_R_KM * DEG;
    this.kx = EARTH_R_KM * DEG * Math.cos(midLat * DEG);

    // Index each segment into every cell its bounding box touches, so projection only tests
    // nearby segments instead of all ~5000 vertices per station.
    this.grid = new Map();
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const b = points[i];
      const latLo = Math.min(a.lat, b.lat);
      const latHi = Math.max(a.lat, b.lat);
      const lngLo = Math.min(a.lng, b.lng);
      const lngHi = Math.max(a.lng, b.lng);
      for (let la = Math.floor(latLo / CELL_DEG); la <= Math.floor(latHi / CELL_DEG); la++) {
        for (let ln = Math.floor(lngLo / CELL_DEG); ln <= Math.floor(lngHi / CELL_DEG); ln++) {
          const key = `${la}:${ln}`;
          const bucket = this.grid.get(key);
          if (bucket) bucket.push(i);
          else this.grid.set(key, [i]);
        }
      }
    }
  }

  /**
   * Project a point onto the corridor. Searches the point's own grid cell and its 8 neighbours
   * first; only if that finds nothing (a station far off-corridor) does it fall back to a full
   * scan, which is correct but rare.
   */
  project(p: LatLng): Projected {
    let best = { progressKm: 0, lateralKm: Infinity };

    const consider = (segIdx: number): void => {
      const a = this.points[segIdx - 1];
      const b = this.points[segIdx];
      // Local planar frame, origin at `a`.
      const ax = 0;
      const ay = 0;
      const bx = (b.lng - a.lng) * this.kx;
      const by = (b.lat - a.lat) * this.ky;
      const px = (p.lng - a.lng) * this.kx;
      const py = (p.lat - a.lat) * this.ky;
      const dx = bx - ax;
      const dy = by - ay;
      const lenSq = dx * dx + dy * dy;
      const t = lenSq > 0 ? Math.max(0, Math.min(1, (px * dx + py * dy) / lenSq)) : 0;
      const cx = t * dx;
      const cy = t * dy;
      const lateral = Math.hypot(px - cx, py - cy);
      if (lateral < best.lateralKm) {
        const segLen = this.cumKm[segIdx] - this.cumKm[segIdx - 1];
        best = { progressKm: this.cumKm[segIdx - 1] + t * segLen, lateralKm: lateral };
      }
    };

    const la = Math.floor(p.lat / CELL_DEG);
    const ln = Math.floor(p.lng / CELL_DEG);
    let found = false;
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const bucket = this.grid.get(`${la + i}:${ln + j}`);
        if (!bucket) continue;
        found = true;
        for (const segIdx of bucket) consider(segIdx);
      }
    }
    if (!found) {
      for (let i = 1; i < this.points.length; i++) consider(i);
    }
    return best;
  }

  /** Point at a given distance along the corridor — used to render stop markers. */
  pointAt(progressKm: number): LatLng {
    const target = Math.max(0, Math.min(progressKm, this.totalKm));
    let i = 1;
    while (i < this.cumKm.length - 1 && this.cumKm[i] < target) i++;
    const segLen = this.cumKm[i] - this.cumKm[i - 1];
    const t = segLen > 0 ? (target - this.cumKm[i - 1]) / segLen : 0;
    const a = this.points[i - 1];
    const b = this.points[i];
    return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
  }
}

/**
 * Longest stretch of `[fromKm, toKm]` containing no candidate, given candidate progresses.
 *
 * The planner charges a surcharge on any arc CONTAINING a long charger-free stretch, not merely
 * on arcs that are one — otherwise a single-stop plan that jumps the whole gap silently skips
 * the insurance that a two-stop plan pays.
 */
export function longestGapKm(sortedProgress: number[], fromKm: number, toKm: number): number {
  let worst = 0;
  let cursor = fromKm;
  for (const p of sortedProgress) {
    if (p <= fromKm) continue;
    if (p >= toKm) break;
    worst = Math.max(worst, p - cursor);
    cursor = p;
  }
  return Math.max(worst, toKm - cursor);
}
