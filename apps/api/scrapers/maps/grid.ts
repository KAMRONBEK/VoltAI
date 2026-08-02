export interface GeoCell {
  id: string;
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
  depth: number;
}

export interface GeoPointCenter {
  lat: number;
  lng: number;
}

export const UZBEKISTAN_BBOX = {
  minLat: 37.172257,
  minLng: 55.997112,
  maxLat: 45.590118,
  maxLng: 73.142735
};

export function generateUzbekistanGrid(stepLat = 0.25, stepLng = 0.25): GeoCell[] {
  const cells: GeoCell[] = [];
  let row = 0;

  for (let lat = UZBEKISTAN_BBOX.minLat; lat < UZBEKISTAN_BBOX.maxLat; lat += stepLat) {
    let col = 0;
    const maxLat = Math.min(lat + stepLat, UZBEKISTAN_BBOX.maxLat);
    for (let lng = UZBEKISTAN_BBOX.minLng; lng < UZBEKISTAN_BBOX.maxLng; lng += stepLng) {
      const maxLng = Math.min(lng + stepLng, UZBEKISTAN_BBOX.maxLng);
      cells.push({
        id: `uz-r${row}-c${col}`,
        minLat: lat,
        minLng: lng,
        maxLat,
        maxLng,
        depth: 0
      });
      col += 1;
    }
    row += 1;
  }

  return cells;
}

export function splitCell(cell: GeoCell): GeoCell[] {
  const midLat = (cell.minLat + cell.maxLat) / 2;
  const midLng = (cell.minLng + cell.maxLng) / 2;
  const nextDepth = cell.depth + 1;

  return [
    {
      id: `${cell.id}-nw`,
      minLat: midLat,
      minLng: cell.minLng,
      maxLat: cell.maxLat,
      maxLng: midLng,
      depth: nextDepth
    },
    {
      id: `${cell.id}-ne`,
      minLat: midLat,
      minLng: midLng,
      maxLat: cell.maxLat,
      maxLng: cell.maxLng,
      depth: nextDepth
    },
    {
      id: `${cell.id}-sw`,
      minLat: cell.minLat,
      minLng: cell.minLng,
      maxLat: midLat,
      maxLng: midLng,
      depth: nextDepth
    },
    {
      id: `${cell.id}-se`,
      minLat: cell.minLat,
      minLng: midLng,
      maxLat: midLat,
      maxLng: cell.maxLng,
      depth: nextDepth
    }
  ];
}

export function cellCenter(cell: GeoCell): GeoPointCenter {
  return {
    lat: (cell.minLat + cell.maxLat) / 2,
    lng: (cell.minLng + cell.maxLng) / 2
  };
}

export async function adaptiveRefineCells(
  baseCells: GeoCell[],
  estimateDensity: (cell: GeoCell) => Promise<number>,
  options?: {
    maxDepth?: number;
    splitThreshold?: number;
  }
): Promise<GeoCell[]> {
  const maxDepth = options?.maxDepth ?? 2;
  const splitThreshold = options?.splitThreshold ?? 50;
  const queue = [...baseCells];
  const refined: GeoCell[] = [];

  while (queue.length > 0) {
    const current = queue.shift() as GeoCell;
    const density = await estimateDensity(current);

    if (density >= splitThreshold && current.depth < maxDepth) {
      queue.push(...splitCell(current));
    } else {
      refined.push(current);
    }
  }

  return refined;
}

export function shardCells(cells: GeoCell[], shardIndex: number, shardTotal: number): GeoCell[] {
  if (shardTotal <= 1) {
    return cells;
  }

  return cells.filter((_, index) => index % shardTotal === shardIndex);
}
