/**
 * Turns Natural Earth's 1:110m country shapes (public domain, GeoJSON) into the stats page's world map: each country
 * projected with the Natural Earth projection, simplified, as one SVG path with its names for matching a bag's
 * free-text country. Antarctica is left out; no coffee grows there. Run once by `pnpm map:build`; the output is
 * committed as world-map.data.ts.
 */

export interface MapCountry {
  /** Natural Earth's ADM0_A3 code, such as ETH. */
  id: string;
  /** The short name shown, such as "Ethiopia". */
  name: string;
  /** Every name Natural Earth gives the country, as match keys (see `nameKey`). */
  keys: string[];
  /** The SVG path, in the map's coordinates. */
  d: string;
}

export interface WorldMap {
  width: number;
  height: number;
  countries: MapCountry[];
}

type Position = [number, number];
type Ring = Position[];

interface Feature {
  properties: Record<string, unknown>;
  geometry: { type: 'Polygon'; coordinates: Ring[] } | { type: 'MultiPolygon'; coordinates: Ring[][] };
}

/** The map's width in SVG units; the height follows from the projection. */
const width = 960;
/** How far, in SVG units, a simplified outline may stray from Natural Earth's. */
const tolerance = 0.6;
/** Rings smaller than this, in square SVG units, are dropped: specks no one can hover. */
const minArea = 1.5;
// Not SOVEREIGNT: it would give Puerto Rico the name "United States of America", and Greenland "Denmark".
const nameFields = ['NAME', 'NAME_LONG', 'ADMIN', 'GEOUNIT', 'SUBUNIT', 'BRK_NAME', 'FORMAL_EN', 'NAME_EN'];

/** A country name reduced for matching: no accents, case, punctuation or leading "the". */
export function nameKey(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/^the /, '');
}

/** The Natural Earth projection (Šavrič and others, 2011), from radians to unit coordinates with y pointing up. */
function project([longitude, latitude]: Position): Position {
  const lambda = (longitude * Math.PI) / 180;
  const phi = (latitude * Math.PI) / 180;
  const phi2 = phi * phi;
  const phi4 = phi2 * phi2;
  return [
    lambda * (0.8707 - 0.131979 * phi2 + phi4 * (-0.013791 + phi4 * (0.003971 * phi2 - 0.001529 * phi4))),
    phi * (1.007226 + phi2 * (0.015085 + phi4 * (-0.044475 + 0.028874 * phi2 - 0.005916 * phi4))),
  ];
}

export function buildWorldMap(geojson: { features: Feature[] }): WorldMap {
  const features = geojson.features.filter((f) => f.properties.ADM0_A3 !== 'ATA');
  const projected = features.map((feature) => {
    const polygons =
      feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
    return { feature, rings: polygons.flatMap((polygon) => polygon.map((ring) => ring.map(project))) };
  });

  const xs = projected.flatMap((p) => p.rings.flat().map(([x]) => x));
  const ys = projected.flatMap((p) => p.rings.flat().map(([, y]) => y));
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const scale = width / (maxX - minX);
  const height = Math.ceil((maxY - minY) * scale);
  const toSvg = ([x, y]: Position): Position => [(x - minX) * scale, (maxY - y) * scale];

  const countries = projected
    .map(({ feature, rings }) => {
      const kept = rings.map((ring) => simplify(ring.map(toSvg))).filter((ring) => Math.abs(area(ring)) >= minArea);
      const names = nameFields
        .map((field) => feature.properties[field])
        .filter((v): v is string => typeof v === 'string');
      return {
        id: String(feature.properties.ADM0_A3),
        name: String(feature.properties.NAME),
        keys: [...new Set(names.map(nameKey))].filter((key) => key !== ''),
        d: kept.map(pathOf).join(''),
      };
    })
    .filter((country) => country.d !== '')
    .sort((a, b) => a.id.localeCompare(b.id));
  return { width, height, countries };
}

/** Douglas–Peucker on a closed ring, keeping its first point. */
function simplify(ring: Ring): Ring {
  if (ring.length <= 4) return ring;
  const keep = new Array<boolean>(ring.length).fill(false);
  keep[0] = true;
  keep[ring.length - 1] = true;
  const stack: [number, number][] = [[0, ring.length - 1]];
  while (stack.length > 0) {
    const [from, to] = stack.pop() as [number, number];
    let farthest = -1;
    let distance = tolerance;
    for (let i = from + 1; i < to; i++) {
      const d = distanceToSegment(ring[i] as Position, ring[from] as Position, ring[to] as Position);
      if (d > distance) [farthest, distance] = [i, d];
    }
    if (farthest !== -1) {
      keep[farthest] = true;
      stack.push([from, farthest], [farthest, to]);
    }
  }
  const kept = ring.filter((_, i) => keep[i]);
  return kept.length >= 4 ? kept : ring;
}

function distanceToSegment([px, py]: Position, [ax, ay]: Position, [bx, by]: Position): number {
  const [dx, dy] = [bx - ax, by - ay];
  const length2 = dx * dx + dy * dy;
  const t = length2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function area(ring: Ring): number {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i] as Position;
    const [x2, y2] = ring[i + 1] as Position;
    sum += x1 * y2 - x2 * y1;
  }
  return sum / 2;
}

/** A closed ring as SVG path commands, with one decimal and relative moves to keep it short. */
function pathOf(ring: Ring): string {
  const points = ring.slice(0, -1).map(([x, y]) => [Math.round(x * 10), Math.round(y * 10)] as Position);
  let path = `M${points[0]?.map((v) => v / 10).join(' ')}`;
  for (let i = 1; i < points.length; i++) {
    const [x, y] = points[i] as Position;
    const [px, py] = points[i - 1] as Position;
    path += `l${(x - px) / 10} ${(y - py) / 10}`;
  }
  return `${path}z`;
}

/** The data module the build writes: a typed constant, so the map ships with the compiled code. */
export function worldMapModule(map: WorldMap, source: string): string {
  const countries = map.countries
    .map(
      (c) =>
        `    { id: ${JSON.stringify(c.id)}, name: ${JSON.stringify(c.name)}, keys: ${JSON.stringify(c.keys)}, d: ${JSON.stringify(c.d)} },`,
    )
    .join('\n');
  return `// Generated by \`pnpm map:build\` from ${source}. Do not edit by hand.
// Country shapes: Natural Earth, 1:110m Admin 0 countries, public domain (naturalearthdata.com).
import type { WorldMap } from './world-map-build.js';

export const worldMap: WorldMap = {
  width: ${map.width},
  height: ${map.height},
  countries: [
${countries}
  ],
};
`;
}
