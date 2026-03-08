/**
 * Coordinates utility
 * DMS ↔ DD ↔ DDM ↔ UTM conversion, coordinate splitting/combining, batch processing
 */
import logger from '../core/logger.js';

// ── Format constants ──
export const COORD_FORMATS = [
    { id: 'dd',  label: 'Decimal Degrees',          example: '40.446195, -79.948862' },
    { id: 'dms', label: 'Degrees Minutes Seconds',  example: '40° 26\' 46.30" N, 79° 56\' 55.90" W' },
    { id: 'ddm', label: 'Degrees Decimal Minutes',   example: '40° 26.7717\' N, 79° 56.9317\' W' },
    { id: 'utm', label: 'UTM',                       example: '17T 585360 4477462' }
];

/**
 * Decimal Degrees to DMS string
 */
export function ddToDms(dd, isLon = false) {
    const abs = Math.abs(dd);
    const d = Math.floor(abs);
    const minfloat = (abs - d) * 60;
    const m = Math.floor(minfloat);
    const s = ((minfloat - m) * 60).toFixed(2);
    const dir = isLon ? (dd >= 0 ? 'E' : 'W') : (dd >= 0 ? 'N' : 'S');
    return `${d}° ${m}' ${s}" ${dir}`;
}

/**
 * Decimal Degrees to DDM (Degrees Decimal Minutes) string
 */
export function ddToDdm(dd, isLon = false) {
    const abs = Math.abs(dd);
    const d = Math.floor(abs);
    const m = ((abs - d) * 60).toFixed(4);
    const dir = isLon ? (dd >= 0 ? 'E' : 'W') : (dd >= 0 ? 'N' : 'S');
    return `${d}° ${m}' ${dir}`;
}

/**
 * DMS string to Decimal Degrees
 */
export function dmsToDd(dmsStr) {
    const cleaned = dmsStr.trim().toUpperCase();
    // Try pattern: 40° 26' 46.56" N or 40 26 46.56 N
    const regex = /(-?\d+)[°\s]+(\d+)['\s]+(\d+\.?\d*)["\s]*([NSEW])?/;
    const match = cleaned.match(regex);
    if (match) {
        let dd = parseFloat(match[1]) + parseFloat(match[2]) / 60 + parseFloat(match[3]) / 3600;
        if (match[4] === 'S' || match[4] === 'W') dd = -dd;
        if (parseFloat(match[1]) < 0) dd = -Math.abs(dd);
        return dd;
    }
    // Try plain number
    const num = parseFloat(cleaned);
    if (!isNaN(num)) return num;
    return null;
}

/**
 * DDM (Degrees Decimal Minutes) string to Decimal Degrees
 */
export function ddmToDd(ddmStr) {
    const cleaned = ddmStr.trim().toUpperCase();
    // Pattern: 40° 26.7717' N or 40 26.7717 N
    const regex = /(-?\d+)[°\s]+(\d+\.?\d*)['\s]*([NSEW])?/;
    const match = cleaned.match(regex);
    if (match) {
        let dd = parseFloat(match[1]) + parseFloat(match[2]) / 60;
        if (match[3] === 'S' || match[3] === 'W') dd = -dd;
        if (parseFloat(match[1]) < 0) dd = -Math.abs(dd);
        return dd;
    }
    return null;
}

// ── UTM conversion ──

/**
 * Decimal Degrees to UTM
 */
export function ddToUtm(lat, lon) {
    if (lat < -80 || lat > 84) return null; // UTM only valid 80°S to 84°N

    let zone = Math.floor((lon + 180) / 6) + 1;

    // Special zones for Norway/Svalbard
    if (lat >= 56 && lat < 64 && lon >= 3 && lon < 12) zone = 32;
    if (lat >= 72 && lat < 84) {
        if (lon >= 0 && lon < 9) zone = 31;
        else if (lon >= 9 && lon < 21) zone = 33;
        else if (lon >= 21 && lon < 33) zone = 35;
        else if (lon >= 33 && lon < 42) zone = 37;
    }

    const letter = _utmLetterDesignator(lat);
    const lonOrigin = (zone - 1) * 6 - 180 + 3;

    const eccSq = 0.00669438;
    const k0 = 0.9996;
    const a = 6378137; // WGS84 semi-major axis

    const latRad = lat * Math.PI / 180;
    const lonRad = lon * Math.PI / 180;
    const lonOrigRad = lonOrigin * Math.PI / 180;

    const eccPrimeSq = eccSq / (1 - eccSq);
    const N = a / Math.sqrt(1 - eccSq * Math.sin(latRad) ** 2);
    const T = Math.tan(latRad) ** 2;
    const C = eccPrimeSq * Math.cos(latRad) ** 2;
    const A = Math.cos(latRad) * (lonRad - lonOrigRad);

    const M = a * (
        (1 - eccSq / 4 - 3 * eccSq ** 2 / 64 - 5 * eccSq ** 3 / 256) * latRad
        - (3 * eccSq / 8 + 3 * eccSq ** 2 / 32 + 45 * eccSq ** 3 / 1024) * Math.sin(2 * latRad)
        + (15 * eccSq ** 2 / 256 + 45 * eccSq ** 3 / 1024) * Math.sin(4 * latRad)
        - (35 * eccSq ** 3 / 3072) * Math.sin(6 * latRad)
    );

    let easting = k0 * N * (A + (1 - T + C) * A ** 3 / 6
        + (5 - 18 * T + T ** 2 + 72 * C - 58 * eccPrimeSq) * A ** 5 / 120) + 500000;

    let northing = k0 * (M + N * Math.tan(latRad) * (
        A ** 2 / 2 + (5 - T + 9 * C + 4 * C ** 2) * A ** 4 / 24
        + (61 - 58 * T + T ** 2 + 600 * C - 330 * eccPrimeSq) * A ** 6 / 720
    ));

    if (lat < 0) northing += 10000000;

    return {
        zone,
        letter,
        easting: Math.round(easting),
        northing: Math.round(northing),
        toString() { return `${zone}${letter} ${Math.round(easting)} ${Math.round(northing)}`; }
    };
}

/**
 * UTM to Decimal Degrees
 */
export function utmToDd(zone, letter, easting, northing) {
    const k0 = 0.9996;
    const a = 6378137;
    const eccSq = 0.00669438;
    const e1 = (1 - Math.sqrt(1 - eccSq)) / (1 + Math.sqrt(1 - eccSq));

    const x = easting - 500000; // Remove false easting
    let y = northing;
    const isNorthern = letter >= 'N';
    if (!isNorthern) y -= 10000000; // Remove false northing for southern hemisphere

    const lonOrigin = (zone - 1) * 6 - 180 + 3;

    const M = y / k0;
    const mu = M / (a * (1 - eccSq / 4 - 3 * eccSq ** 2 / 64 - 5 * eccSq ** 3 / 256));

    const phi = mu
        + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu)
        + (21 * e1 ** 2 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu)
        + (151 * e1 ** 3 / 96) * Math.sin(6 * mu)
        + (1097 * e1 ** 4 / 512) * Math.sin(8 * mu);

    const eccPrimeSq = eccSq / (1 - eccSq);
    const N = a / Math.sqrt(1 - eccSq * Math.sin(phi) ** 2);
    const T = Math.tan(phi) ** 2;
    const C = eccPrimeSq * Math.cos(phi) ** 2;
    const R = a * (1 - eccSq) / (1 - eccSq * Math.sin(phi) ** 2) ** 1.5;
    const D = x / (N * k0);

    let lat = phi - (N * Math.tan(phi) / R) * (
        D ** 2 / 2
        - (5 + 3 * T + 10 * C - 4 * C ** 2 - 9 * eccPrimeSq) * D ** 4 / 24
        + (61 + 90 * T + 298 * C + 45 * T ** 2 - 252 * eccPrimeSq - 3 * C ** 2) * D ** 6 / 720
    );

    let lon = (D - (1 + 2 * T + C) * D ** 3 / 6
        + (5 - 2 * C + 28 * T - 3 * C ** 2 + 8 * eccPrimeSq + 24 * T ** 2) * D ** 5 / 120
    ) / Math.cos(phi);

    lat = lat * 180 / Math.PI;
    lon = lonOrigin + lon * 180 / Math.PI;

    return { lat, lon };
}

/**
 * Parse a UTM string like "17T 585360 4477462" into components
 */
export function parseUtmString(str) {
    const cleaned = str.trim();
    const match = cleaned.match(/^(\d{1,2})\s*([A-HJ-NP-Z])\s+(\d+\.?\d*)\s+(\d+\.?\d*)\s*$/i);
    if (!match) return null;
    return {
        zone: parseInt(match[1]),
        letter: match[2].toUpperCase(),
        easting: parseFloat(match[3]),
        northing: parseFloat(match[4])
    };
}

function _utmLetterDesignator(lat) {
    const letters = 'CDEFGHJKLMNPQRSTUVWX';
    if (lat < -80 || lat > 84) return 'Z';
    return letters[Math.floor((lat + 80) / 8)];
}

// ── Unified conversion ──

/**
 * Convert a coordinate pair from one format to another.
 * Returns { lat: string, lon: string } or { combined: string } for UTM.
 */
export function convertCoord(lat, lon, fromFormat, toFormat) {
    // First normalize to DD
    let ddLat, ddLon;
    switch (fromFormat) {
        case 'dd':
            ddLat = parseFloat(lat);
            ddLon = parseFloat(lon);
            break;
        case 'dms':
            ddLat = dmsToDd(String(lat));
            ddLon = dmsToDd(String(lon));
            break;
        case 'ddm':
            ddLat = ddmToDd(String(lat));
            ddLon = ddmToDd(String(lon));
            break;
        case 'utm': {
            const parsed = parseUtmString(`${lat} ${lon}`);
            if (!parsed) return null;
            const result = utmToDd(parsed.zone, parsed.letter, parsed.easting, parsed.northing);
            ddLat = result.lat;
            ddLon = result.lon;
            break;
        }
        default: return null;
    }

    if (ddLat == null || ddLon == null || isNaN(ddLat) || isNaN(ddLon)) return null;

    // Then convert from DD to target format
    switch (toFormat) {
        case 'dd':
            return { lat: ddLat.toFixed(6), lon: ddLon.toFixed(6) };
        case 'dms':
            return { lat: ddToDms(ddLat, false), lon: ddToDms(ddLon, true) };
        case 'ddm':
            return { lat: ddToDdm(ddLat, false), lon: ddToDdm(ddLon, true) };
        case 'utm': {
            const utm = ddToUtm(ddLat, ddLon);
            if (!utm) return null;
            return { combined: utm.toString() };
        }
        default: return null;
    }
}

/**
 * Convert coordinate fields in a feature collection.
 * For spatial data: reads geometry coordinates and writes formatted attribute fields.
 * For table data: reads from lat/lon fields (or combined field) and writes converted values.
 *
 * @param {Object} options
 * @param {'spatial'|'table'} options.mode - Whether the input is spatial (use geometry) or table (use attribute fields)
 * @param {string} options.toFormat - Target format: 'dd', 'dms', 'ddm', 'utm'
 * @param {string} [options.latField] - Source latitude field (table mode, or attribute mode for spatial)
 * @param {string} [options.lonField] - Source longitude field (table mode, or attribute mode for spatial)
 * @param {string} [options.fromFormat] - Source format (table/attribute mode): 'dd', 'dms', 'ddm'
 * @param {boolean} [options.useGeometry=true] - For spatial data, read coords from geometry
 * @param {string} [options.outputPrefix] - Prefix for output field names (default: format name)
 */
export function convertFeatureCoords(features, options) {
    const {
        toFormat,
        latField,
        lonField,
        fromFormat = 'dd',
        useGeometry = true,
        outputPrefix
    } = options;

    const prefix = outputPrefix || toFormat.toUpperCase();
    let converted = 0;
    let failed = 0;

    const results = features.map(f => {
        const props = f.properties ? { ...f.properties } : { ...f };
        let ddLat, ddLon;

        if (useGeometry && f.geometry) {
            // Extract representative coordinate from geometry
            const coords = _getRepCoord(f.geometry);
            if (coords) {
                ddLat = coords[1]; // GeoJSON is [lon, lat]
                ddLon = coords[0];
            }
        } else if (latField && lonField) {
            // Read from attribute fields
            const rawLat = props[latField];
            const rawLon = props[lonField];
            switch (fromFormat) {
                case 'dd':
                    ddLat = parseFloat(rawLat);
                    ddLon = parseFloat(rawLon);
                    break;
                case 'dms':
                    ddLat = dmsToDd(String(rawLat || ''));
                    ddLon = dmsToDd(String(rawLon || ''));
                    break;
                case 'ddm':
                    ddLat = ddmToDd(String(rawLat || ''));
                    ddLon = ddmToDd(String(rawLon || ''));
                    break;
            }
        }

        if (ddLat == null || ddLon == null || isNaN(ddLat) || isNaN(ddLon)) {
            failed++;
            return f.properties ? { ...f, properties: props } : props;
        }

        // Convert to target
        switch (toFormat) {
            case 'dd':
                props[`${prefix}_lat`] = parseFloat(ddLat.toFixed(6));
                props[`${prefix}_lon`] = parseFloat(ddLon.toFixed(6));
                break;
            case 'dms':
                props[`${prefix}_lat`] = ddToDms(ddLat, false);
                props[`${prefix}_lon`] = ddToDms(ddLon, true);
                break;
            case 'ddm':
                props[`${prefix}_lat`] = ddToDdm(ddLat, false);
                props[`${prefix}_lon`] = ddToDdm(ddLon, true);
                break;
            case 'utm': {
                const utm = ddToUtm(ddLat, ddLon);
                if (utm) {
                    props[`${prefix}_zone`] = `${utm.zone}${utm.letter}`;
                    props[`${prefix}_easting`] = utm.easting;
                    props[`${prefix}_northing`] = utm.northing;
                    props[`${prefix}_full`] = utm.toString();
                } else {
                    failed++;
                    return f.properties ? { ...f, properties: props } : props;
                }
                break;
            }
        }
        converted++;
        return f.properties ? { ...f, properties: props } : props;
    });

    logger.info('Coordinates', 'Convert coords', { toFormat, converted, failed, total: features.length });
    return { features: results, converted, failed };
}

function _getRepCoord(geometry) {
    if (!geometry || !geometry.coordinates) return null;
    switch (geometry.type) {
        case 'Point': return geometry.coordinates;
        case 'MultiPoint': return geometry.coordinates[0];
        case 'LineString': return geometry.coordinates[Math.floor(geometry.coordinates.length / 2)];
        case 'MultiLineString': return geometry.coordinates[0]?.[0];
        case 'Polygon': {
            // Use centroid approximation: average of outer ring
            const ring = geometry.coordinates[0];
            if (!ring || ring.length === 0) return null;
            const sum = ring.reduce((acc, c) => [acc[0] + c[0], acc[1] + c[1]], [0, 0]);
            return [sum[0] / ring.length, sum[1] / ring.length];
        }
        case 'MultiPolygon': {
            const ring = geometry.coordinates[0]?.[0];
            if (!ring || ring.length === 0) return null;
            const sum = ring.reduce((acc, c) => [acc[0] + c[0], acc[1] + c[1]], [0, 0]);
            return [sum[0] / ring.length, sum[1] / ring.length];
        }
        default: return null;
    }
}

/**
 * Split a combined coordinate string into lat and lon
 */
export function splitCoordString(str, delimiter = ',', lonLatOrder = false) {
    const parts = str.split(delimiter).map(s => s.trim());
    if (parts.length < 2) return null;
    const a = parseFloat(parts[0]);
    const b = parseFloat(parts[1]);
    if (isNaN(a) || isNaN(b)) return null;
    return lonLatOrder ? { lat: b, lon: a } : { lat: a, lon: b };
}

/**
 * Combine lat and lon into a string
 */
export function combineCoords(lat, lon, delimiter = ', ', lonLatOrder = false) {
    return lonLatOrder ? `${lon}${delimiter}${lat}` : `${lat}${delimiter}${lon}`;
}

/**
 * Batch convert lines of coordinates
 */
export function batchConvert(text, fromFormat, toFormat, options = {}) {
    const lines = text.split('\n').filter(l => l.trim());
    const results = [];

    for (const line of lines) {
        try {
            let result;
            if (fromFormat === 'dd' && toFormat === 'dms') {
                const coord = splitCoordString(line, options.delimiter || ',', options.lonLatOrder);
                if (coord) {
                    result = `${ddToDms(coord.lat, false)}, ${ddToDms(coord.lon, true)}`;
                }
            } else if (fromFormat === 'dms' && toFormat === 'dd') {
                const parts = line.split(/,\s*/);
                if (parts.length >= 2) {
                    const lat = dmsToDd(parts[0]);
                    const lon = dmsToDd(parts[1]);
                    if (lat != null && lon != null) {
                        result = `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
                    }
                }
            } else if (fromFormat === 'combined' && toFormat === 'split') {
                const coord = splitCoordString(line, options.delimiter || ',', options.lonLatOrder);
                if (coord) {
                    result = { lat: coord.lat, lon: coord.lon };
                }
            }
            results.push({ input: line, output: result, error: result ? null : 'Parse failed' });
        } catch (e) {
            results.push({ input: line, output: null, error: e.message });
        }
    }

    logger.info('Coordinates', 'Batch convert', { from: fromFormat, to: toFormat, lines: lines.length, success: results.filter(r => r.output).length });
    return results;
}

/**
 * Detect if a column looks like coordinates
 */
export function detectCoordColumn(values) {
    const sample = values.slice(0, 50).filter(v => v != null && v !== '');
    if (sample.length === 0) return null;

    // Check for combined "lat,lon" format
    const combinedCount = sample.filter(v => {
        const parts = String(v).split(',');
        return parts.length === 2 && parts.every(p => !isNaN(parseFloat(p.trim())));
    }).length;
    if (combinedCount > sample.length * 0.7) return 'combined';

    // Check for DMS
    const dmsCount = sample.filter(v => /[°'"NSEW]/.test(String(v))).length;
    if (dmsCount > sample.length * 0.5) return 'dms';

    // Check for decimal degrees
    const ddCount = sample.filter(v => {
        const n = parseFloat(v);
        return !isNaN(n) && Math.abs(n) <= 180;
    }).length;
    if (ddCount > sample.length * 0.8) return 'dd';

    return null;
}

export default {
    COORD_FORMATS, ddToDms, ddToDdm, dmsToDd, ddmToDd,
    ddToUtm, utmToDd, parseUtmString, convertCoord, convertFeatureCoords,
    splitCoordString, combineCoords, batchConvert, detectCoordColumn
};
