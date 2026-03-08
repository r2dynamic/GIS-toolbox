/**
 * GIS tools using Turf.js (client-side geospatial ops)
 */
import logger from '../core/logger.js';
import { createSpatialDataset } from '../core/data-model.js';
import { TaskRunner } from '../core/task-runner.js';

const LARGE_DATASET_WARNING = 50000;

/**
 * Buffer features by distance
 */
export async function bufferFeatures(dataset, distance, units = 'kilometers') {
    if (typeof turf === 'undefined') throw new Error('Turf.js not loaded');
    if (dataset.geojson.features.length > LARGE_DATASET_WARNING) {
        logger.warn('GISTools', 'Large dataset — buffer may be slow', { count: dataset.geojson.features.length });
    }

    const task = new TaskRunner(`Buffer ${distance} ${units}`, 'GISTools');
    return task.run(async (t) => {
        const features = dataset.geojson.features;
        const buffered = [];
        for (let i = 0; i < features.length; i++) {
            t.throwIfCancelled();
            if (i % 100 === 0) {
                t.updateProgress(Math.round((i / features.length) * 90), `Buffering ${i}/${features.length}`);
                await new Promise(r => setTimeout(r, 0));
            }
            if (features[i].geometry) {
                try {
                    const b = turf.buffer(features[i], distance, { units });
                    if (b) {
                        b.properties = { ...features[i].properties };
                        buffered.push(b);
                    }
                } catch (e) {
                    logger.warn('GISTools', 'Buffer failed for feature', { index: i, error: e.message });
                }
            }
        }
        const fc = { type: 'FeatureCollection', features: buffered };
        return createSpatialDataset(`${dataset.name}_buffer_${distance}${units}`, fc, { format: 'derived' });
    });
}

/**
 * Simplify geometries
 */
export async function simplifyFeatures(dataset, tolerance = 0.001) {
    if (typeof turf === 'undefined') throw new Error('Turf.js not loaded');

    const task = new TaskRunner('Simplify', 'GISTools');
    return task.run(async (t) => {
        t.updateProgress(30, 'Simplifying geometries...');

        const verticesBefore = countVertices(dataset.geojson);
        const simplified = turf.simplify(dataset.geojson, { tolerance, highQuality: true });
        const verticesAfter = countVertices(simplified);

        logger.info('GISTools', 'Simplify complete', { verticesBefore, verticesAfter, reduction: `${Math.round((1 - verticesAfter / verticesBefore) * 100)}%` });

        return {
            dataset: createSpatialDataset(`${dataset.name}_simplified`, simplified, { format: 'derived' }),
            stats: { verticesBefore, verticesAfter }
        };
    });
}

/**
 * Clip features to a bounding box or polygon
 */
export async function clipFeatures(dataset, clipGeometry) {
    if (typeof turf === 'undefined') throw new Error('Turf.js not loaded');

    const task = new TaskRunner('Clip', 'GISTools');
    return task.run(async (t) => {
        const features = dataset.geojson.features;
        const clipped = [];

        for (let i = 0; i < features.length; i++) {
            t.throwIfCancelled();
            if (i % 100 === 0) {
                t.updateProgress(Math.round((i / features.length) * 90), `Clipping ${i}/${features.length}`);
                await new Promise(r => setTimeout(r, 0));
            }

            const f = features[i];
            if (!f.geometry) continue;

            try {
                if (f.geometry.type === 'Point') {
                    if (turf.booleanPointInPolygon(f, clipGeometry)) {
                        clipped.push(f);
                    }
                } else {
                    const intersection = turf.intersect(
                        turf.featureCollection([turf.feature(clipGeometry), f])
                    );
                    if (intersection) {
                        intersection.properties = { ...f.properties };
                        clipped.push(intersection);
                    }
                }
            } catch (e) {
                // For complex geometries or errors, include if centroid is inside
                try {
                    const centroid = turf.centroid(f);
                    if (turf.booleanPointInPolygon(centroid, clipGeometry)) {
                        clipped.push(f);
                    }
                } catch (_) { }
            }
        }

        const fc = { type: 'FeatureCollection', features: clipped };
        return createSpatialDataset(`${dataset.name}_clipped`, fc, { format: 'derived' });
    });
}

/**
 * Dissolve by field
 */
export async function dissolveFeatures(dataset, field) {
    if (typeof turf === 'undefined') throw new Error('Turf.js not loaded');

    const task = new TaskRunner('Dissolve', 'GISTools');
    return task.run(async (t) => {
        t.updateProgress(30, 'Dissolving...');
        const dissolved = turf.dissolve(dataset.geojson, { propertyName: field });
        return createSpatialDataset(`${dataset.name}_dissolved`, dissolved, { format: 'derived' });
    });
}

function countVertices(geojson) {
    let count = 0;
    const countCoords = (coords) => {
        if (typeof coords[0] === 'number') return 1;
        return coords.reduce((sum, c) => sum + countCoords(c), 0);
    };
    for (const f of (geojson.features || [])) {
        if (f.geometry?.coordinates) {
            count += countCoords(f.geometry.coordinates);
        }
    }
    return count;
}

// ============================
// Measurement Tools
// ============================

/**
 * Get a point at a specified distance along a line
 */
export function pointAlong(lineFeature, distance, units = 'kilometers') {
    if (typeof turf === 'undefined') throw new Error('Turf.js not loaded');
    return turf.along(lineFeature, distance, { units });
}

/**
 * Calculate bearing between two points (in degrees, -180 to 180)
 */
export function bearing(point1, point2) {
    if (typeof turf === 'undefined') throw new Error('Turf.js not loaded');
    return turf.bearing(point1, point2);
}

/**
 * Calculate destination point given start, distance, and bearing
 */
export function destination(origin, distance, bearingAngle, units = 'kilometers') {
    if (typeof turf === 'undefined') throw new Error('Turf.js not loaded');
    return turf.destination(origin, distance, bearingAngle, { units });
}

/**
 * Calculate distance between two points
 */
export function distance(point1, point2, units = 'kilometers') {
    if (typeof turf === 'undefined') throw new Error('Turf.js not loaded');
    return turf.distance(point1, point2, { units });
}

/**
 * Calculate shortest distance from a point to a line
 */
export function pointToLineDistance(point, line, units = 'kilometers') {
    if (typeof turf === 'undefined') throw new Error('Turf.js not loaded');
    return turf.pointToLineDistance(point, line, { units });
}

// ============================
// Transformation Tools
// ============================

/**
 * Clip features to a bounding box
 */
export async function bboxClipFeatures(dataset, bbox) {
    if (typeof turf === 'undefined') throw new Error('Turf.js not loaded');
    const task = new TaskRunner('BBox Clip', 'GISTools');
    return task.run(async (t) => {
        const features = dataset.geojson.features;
        const clipped = [];
        for (let i = 0; i < features.length; i++) {
            t.throwIfCancelled();
            if (i % 100 === 0) {
                t.updateProgress(Math.round((i / features.length) * 90), `Clipping ${i}/${features.length}`);
                await new Promise(r => setTimeout(r, 0));
            }
            if (!features[i].geometry) continue;
            try {
                const c = turf.bboxClip(features[i], bbox);
                if (c && c.geometry && c.geometry.coordinates && c.geometry.coordinates.length > 0) {
                    c.properties = { ...features[i].properties };
                    clipped.push(c);
                }
            } catch (e) {
                logger.warn('GISTools', 'bboxClip failed for feature', { index: i, error: e.message });
            }
        }
        const fc = { type: 'FeatureCollection', features: clipped };
        return createSpatialDataset(`${dataset.name}_bboxclip`, fc, { format: 'derived' });
    });
}

/**
 * Smooth lines into bezier splines
 */
export async function bezierSplineFeatures(dataset, resolution = 10000, sharpness = 0.85) {
    if (typeof turf === 'undefined') throw new Error('Turf.js not loaded');
    const task = new TaskRunner('Bezier Spline', 'GISTools');
    return task.run(async (t) => {
        const features = dataset.geojson.features;
        const smoothed = [];
        for (let i = 0; i < features.length; i++) {
            t.throwIfCancelled();
            if (i % 50 === 0) {
                t.updateProgress(Math.round((i / features.length) * 90), `Smoothing ${i}/${features.length}`);
                await new Promise(r => setTimeout(r, 0));
            }
            const f = features[i];
            if (!f.geometry) continue;
            if (f.geometry.type === 'LineString' || f.geometry.type === 'MultiLineString') {
                try {
                    const lines = f.geometry.type === 'MultiLineString'
                        ? f.geometry.coordinates.map(c => turf.lineString(c))
                        : [f];
                    for (const line of lines) {
                        const spline = turf.bezierSpline(line, { resolution, sharpness });
                        if (spline) {
                            spline.properties = { ...f.properties };
                            smoothed.push(spline);
                        }
                    }
                } catch (e) {
                    logger.warn('GISTools', 'bezierSpline failed', { index: i, error: e.message });
                    smoothed.push(f); // keep original
                }
            } else {
                smoothed.push(f); // non-line features pass through
            }
        }
        const fc = { type: 'FeatureCollection', features: smoothed };
        return createSpatialDataset(`${dataset.name}_spline`, fc, { format: 'derived' });
    });
}

/**
 * Smooth polygon edges
 */
export async function polygonSmoothFeatures(dataset, iterations = 1) {
    if (typeof turf === 'undefined') throw new Error('Turf.js not loaded');
    const task = new TaskRunner('Polygon Smooth', 'GISTools');
    return task.run(async (t) => {
        t.updateProgress(30, 'Smoothing polygons...');
        const smoothed = turf.polygonSmooth(dataset.geojson, { iterations });
        return createSpatialDataset(`${dataset.name}_smooth`, smoothed, { format: 'derived' });
    });
}

/**
 * Offset a line by a specified distance (creates a parallel line)
 */
export async function lineOffsetFeatures(dataset, offsetDistance, units = 'kilometers') {
    if (typeof turf === 'undefined') throw new Error('Turf.js not loaded');
    const task = new TaskRunner('Line Offset', 'GISTools');
    return task.run(async (t) => {
        const features = dataset.geojson.features;
        const results = [];
        for (let i = 0; i < features.length; i++) {
            t.throwIfCancelled();
            if (i % 100 === 0) {
                t.updateProgress(Math.round((i / features.length) * 90), `Offsetting ${i}/${features.length}`);
                await new Promise(r => setTimeout(r, 0));
            }
            const f = features[i];
            if (!f.geometry) continue;
            if (f.geometry.type === 'LineString' || f.geometry.type === 'MultiLineString') {
                try {
                    const offset = turf.lineOffset(f, offsetDistance, { units });
                    if (offset) {
                        offset.properties = { ...f.properties };
                        results.push(offset);
                    }
                } catch (e) {
                    logger.warn('GISTools', 'lineOffset failed', { index: i, error: e.message });
                    results.push(f);
                }
            } else {
                results.push(f);
            }
        }
        const fc = { type: 'FeatureCollection', features: results };
        return createSpatialDataset(`${dataset.name}_offset`, fc, { format: 'derived' });
    });
}

/**
 * Slice a line at start/stop distances along it
 */
export function lineSliceAlong(lineFeature, startDist, stopDist, units = 'kilometers') {
    if (typeof turf === 'undefined') throw new Error('Turf.js not loaded');
    return turf.lineSliceAlong(lineFeature, startDist, stopDist, { units });
}

/**
 * Slice a line between two points (nearest vertices)
 */
export function lineSlice(startPoint, stopPoint, lineFeature) {
    if (typeof turf === 'undefined') throw new Error('Turf.js not loaded');
    return turf.lineSlice(startPoint, stopPoint, lineFeature);
}

/**
 * Create a sector (pie slice) polygon from center, radius, and two bearings
 */
export function createSector(center, radius, bearing1, bearing2, units = 'kilometers', steps = 64) {
    if (typeof turf === 'undefined') throw new Error('Turf.js not loaded');
    return turf.sector(center, radius, bearing1, bearing2, { units, steps });
}

// ============================
// Analysis / Classification
// ============================

/**
 * Find intersection points where two line layers cross
 */
export function lineIntersect(line1, line2) {
    if (typeof turf === 'undefined') throw new Error('Turf.js not loaded');
    return turf.lineIntersect(line1, line2);
}

/**
 * Find self-intersections (kinks) in a polygon or line dataset
 */
export async function findKinks(dataset) {
    if (typeof turf === 'undefined') throw new Error('Turf.js not loaded');
    const task = new TaskRunner('Find Kinks', 'GISTools');
    return task.run(async (t) => {
        const features = dataset.geojson.features;
        const allKinks = [];
        for (let i = 0; i < features.length; i++) {
            t.throwIfCancelled();
            if (i % 100 === 0) {
                t.updateProgress(Math.round((i / features.length) * 90), `Checking ${i}/${features.length}`);
                await new Promise(r => setTimeout(r, 0));
            }
            const f = features[i];
            if (!f.geometry) continue;
            try {
                const kinks = turf.kinks(f);
                if (kinks && kinks.features && kinks.features.length > 0) {
                    kinks.features.forEach(k => {
                        k.properties = {
                            sourceIndex: i,
                            sourceName: f.properties?.name || f.properties?.NAME || `Feature ${i}`,
                            ...k.properties
                        };
                        allKinks.push(k);
                    });
                }
            } catch (e) {
                logger.warn('GISTools', 'kinks check failed', { index: i, error: e.message });
            }
        }
        const fc = { type: 'FeatureCollection', features: allKinks };
        logger.info('GISTools', `Found ${allKinks.length} self-intersections`);
        return createSpatialDataset(`${dataset.name}_kinks`, fc, { format: 'derived' });
    });
}

/**
 * Combine: merge features into multi-geometry types
 */
export function combineFeatures(dataset) {
    if (typeof turf === 'undefined') throw new Error('Turf.js not loaded');
    const combined = turf.combine(dataset.geojson);
    return createSpatialDataset(`${dataset.name}_combined`, combined, { format: 'derived' });
}

/**
 * Union: merge multiple polygons into one polygon
 */
export async function unionFeatures(dataset) {
    if (typeof turf === 'undefined') throw new Error('Turf.js not loaded');
    const task = new TaskRunner('Union', 'GISTools');
    return task.run(async (t) => {
        const polygons = dataset.geojson.features.filter(f =>
            f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon')
        );
        if (polygons.length === 0) throw new Error('No polygon features to union');
        if (polygons.length === 1) {
            return createSpatialDataset(`${dataset.name}_union`, {
                type: 'FeatureCollection', features: [polygons[0]]
            }, { format: 'derived' });
        }

        t.updateProgress(10, `Merging ${polygons.length} polygons...`);
        let result = polygons[0];
        for (let i = 1; i < polygons.length; i++) {
            t.throwIfCancelled();
            if (i % 20 === 0) {
                t.updateProgress(Math.round((i / polygons.length) * 90), `Merging ${i}/${polygons.length}`);
                await new Promise(r => setTimeout(r, 0));
            }
            try {
                const merged = turf.union(turf.featureCollection([result, polygons[i]]));
                if (merged) result = merged;
            } catch (e) {
                logger.warn('GISTools', `Union skipped feature ${i}`, { error: e.message });
            }
        }

        const fc = { type: 'FeatureCollection', features: [result] };
        return createSpatialDataset(`${dataset.name}_union`, fc, { format: 'derived' });
    });
}

/**
 * Find the nearest point in a point dataset to a reference point
 */
export function nearestPoint(targetPoint, pointsDataset) {
    if (typeof turf === 'undefined') throw new Error('Turf.js not loaded');
    return turf.nearestPoint(targetPoint, pointsDataset.geojson);
}

/**
 * Find the nearest point on a line to a given point
 */
export function nearestPointOnLine(lineFeature, point, units = 'kilometers') {
    if (typeof turf === 'undefined') throw new Error('Turf.js not loaded');
    return turf.nearestPointOnLine(lineFeature, point, { units });
}

/**
 * Find the nearest point feature to a line
 */
export function nearestPointToLine(pointsFC, lineFeature, units = 'kilometers') {
    if (typeof turf === 'undefined') throw new Error('Turf.js not loaded');
    return turf.nearestPointToLine(pointsFC, lineFeature, { units });
}

/**
 * Nearest neighbor analysis on a point dataset
 * Returns statistical measures of point distribution
 */
export function nearestNeighborAnalysis(dataset) {
    if (typeof turf === 'undefined') throw new Error('Turf.js not loaded');
    const pointFeatures = dataset.geojson.features.filter(f =>
        f.geometry && f.geometry.type === 'Point'
    );
    if (pointFeatures.length < 3) throw new Error('Need at least 3 point features for nearest neighbor analysis');
    const fc = { type: 'FeatureCollection', features: pointFeatures };
    return turf.nearestNeighborAnalysis(fc);
}

/**
 * Find all points within polygon(s)
 */
export function pointsWithinPolygon(pointsDataset, polygonsDataset) {
    if (typeof turf === 'undefined') throw new Error('Turf.js not loaded');
    const points = pointsDataset.geojson;
    const polygons = polygonsDataset.geojson;
    const result = turf.pointsWithinPolygon(points, polygons);
    return createSpatialDataset(
        `${pointsDataset.name}_within_${polygonsDataset.name}`,
        result,
        { format: 'derived' }
    );
}

// ============================
// Multi-Layer Spatial Analysis
// ============================

/**
 * Spatial Join — assign polygon attributes to points that fall within them.
 * For each point, finds the containing polygon and copies specified fields.
 * @param {object} pointsDataset  - spatial dataset of points
 * @param {object} polygonsDataset - spatial dataset of polygons
 * @param {string[]} joinFields   - polygon field names to copy (empty = all)
 * @param {string} prefix         - prefix for joined field names (default '')
 * @returns {object} enriched points dataset
 */
export async function spatialJoinPointsInPolygons(pointsDataset, polygonsDataset, joinFields = [], prefix = '') {
    if (typeof turf === 'undefined') throw new Error('Turf.js not loaded');

    const task = new TaskRunner('Spatial Join', 'GISTools');
    return task.run(async (t) => {
        const points = pointsDataset.geojson.features;
        const polygons = polygonsDataset.geojson.features.filter(f =>
            f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon')
        );
        if (polygons.length === 0) throw new Error('Polygon layer has no polygon features');

        const polyFields = joinFields.length > 0
            ? joinFields
            : Object.keys(polygons[0]?.properties || {});

        const enriched = [];
        for (let i = 0; i < points.length; i++) {
            t.throwIfCancelled();
            if (i % 200 === 0) {
                t.updateProgress(Math.round((i / points.length) * 90), `Joining ${i}/${points.length}`);
                await new Promise(r => setTimeout(r, 0));
            }

            const pt = points[i];
            const props = { ...pt.properties };
            let matched = false;

            if (pt.geometry && pt.geometry.type === 'Point') {
                for (const poly of polygons) {
                    try {
                        if (turf.booleanPointInPolygon(pt, poly)) {
                            for (const field of polyFields) {
                                props[prefix + field] = poly.properties?.[field] ?? null;
                            }
                            matched = true;
                            break;
                        }
                    } catch (_) { /* skip invalid polygons */ }
                }
            }

            if (!matched) {
                for (const field of polyFields) {
                    if (!(prefix + field in props)) props[prefix + field] = null;
                }
            }

            enriched.push({ ...pt, properties: props });
        }

        // Build updated schema
        const schema = JSON.parse(JSON.stringify(pointsDataset.schema));
        for (const field of polyFields) {
            const name = prefix + field;
            if (!schema.fields.find(f => f.name === name)) {
                const vals = enriched.map(f => f.properties[name]).filter(v => v != null);
                schema.fields.push({
                    name,
                    type: typeof vals[0] === 'number' ? 'number' : 'string',
                    nullCount: enriched.length - vals.length,
                    uniqueCount: new Set(vals).size,
                    sampleValues: vals.slice(0, 5),
                    selected: true,
                    outputName: name,
                    order: schema.fields.length
                });
            }
        }

        const fc = { type: 'FeatureCollection', features: enriched };
        return createSpatialDataset(`${pointsDataset.name}_spatialJoin`, fc, { format: 'derived', schema });
    });
}

/**
 * Nearest Join — for each feature in A, find the nearest feature in B
 * and copy specified fields + add a distance field.
 * @param {object} datasetA     - target dataset
 * @param {object} datasetB     - join dataset
 * @param {string[]} joinFields - B field names to copy (empty = all)
 * @param {string} units        - distance units
 * @returns {object} enriched dataset A
 */
export async function nearestJoin(datasetA, datasetB, joinFields = [], units = 'kilometers') {
    if (typeof turf === 'undefined') throw new Error('Turf.js not loaded');

    const task = new TaskRunner('Nearest Join', 'GISTools');
    return task.run(async (t) => {
        const featuresA = datasetA.geojson.features;
        const featuresB = datasetB.geojson.features;
        if (featuresB.length === 0) throw new Error('Join layer has no features');

        const bFields = joinFields.length > 0
            ? joinFields
            : Object.keys(featuresB[0]?.properties || {});

        // Pre-compute centroids for B
        const centroidsB = featuresB.map(f => {
            if (!f.geometry) return null;
            return f.geometry.type === 'Point' ? f : turf.centroid(f);
        });

        const enriched = [];
        for (let i = 0; i < featuresA.length; i++) {
            t.throwIfCancelled();
            if (i % 200 === 0) {
                t.updateProgress(Math.round((i / featuresA.length) * 90), `Joining ${i}/${featuresA.length}`);
                await new Promise(r => setTimeout(r, 0));
            }

            const fA = featuresA[i];
            const props = { ...fA.properties };

            if (fA.geometry) {
                const ptA = fA.geometry.type === 'Point' ? fA : turf.centroid(fA);
                let minDist = Infinity;
                let nearestIdx = -1;

                for (let j = 0; j < centroidsB.length; j++) {
                    if (!centroidsB[j]) continue;
                    const d = turf.distance(ptA, centroidsB[j], { units });
                    if (d < minDist) { minDist = d; nearestIdx = j; }
                }

                if (nearestIdx >= 0) {
                    for (const field of bFields) {
                        props['nearest_' + field] = featuresB[nearestIdx].properties?.[field] ?? null;
                    }
                    props['nearest_distance'] = Math.round(minDist * 1000) / 1000;
                    props['nearest_distance_units'] = units;
                }
            }

            enriched.push({ ...fA, properties: props });
        }

        // Build updated schema
        const schema = JSON.parse(JSON.stringify(datasetA.schema));
        const addedFields = [...bFields.map(f => 'nearest_' + f), 'nearest_distance', 'nearest_distance_units'];
        for (const name of addedFields) {
            if (!schema.fields.find(f => f.name === name)) {
                const vals = enriched.map(f => f.properties[name]).filter(v => v != null);
                schema.fields.push({
                    name,
                    type: name === 'nearest_distance' ? 'number' : 'string',
                    nullCount: enriched.length - vals.length,
                    uniqueCount: new Set(vals).size,
                    sampleValues: vals.slice(0, 5),
                    selected: true,
                    outputName: name,
                    order: schema.fields.length
                });
            }
        }

        const fc = { type: 'FeatureCollection', features: enriched };
        return createSpatialDataset(`${datasetA.name}_nearestJoin`, fc, { format: 'derived', schema });
    });
}

/**
 * Intersect two polygon layers — produces features where they overlap,
 * with merged attributes from both layers.
 */
export async function intersectLayers(datasetA, datasetB) {
    if (typeof turf === 'undefined') throw new Error('Turf.js not loaded');

    const task = new TaskRunner('Intersect Layers', 'GISTools');
    return task.run(async (t) => {
        const polysA = datasetA.geojson.features.filter(f =>
            f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon')
        );
        const polysB = datasetB.geojson.features.filter(f =>
            f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon')
        );
        if (polysA.length === 0 || polysB.length === 0) {
            throw new Error('Both layers must have polygon features');
        }

        const results = [];
        let count = 0;
        const total = polysA.length * polysB.length;

        for (let i = 0; i < polysA.length; i++) {
            for (let j = 0; j < polysB.length; j++) {
                t.throwIfCancelled();
                count++;
                if (count % 500 === 0) {
                    t.updateProgress(Math.round((count / total) * 90), `Intersecting ${count}/${total}`);
                    await new Promise(r => setTimeout(r, 0));
                }
                try {
                    const ix = turf.intersect(turf.featureCollection([polysA[i], polysB[j]]));
                    if (ix) {
                        ix.properties = {
                            ...polysA[i].properties,
                            ...Object.fromEntries(
                                Object.entries(polysB[j].properties || {}).map(([k, v]) => ['B_' + k, v])
                            )
                        };
                        results.push(ix);
                    }
                } catch (_) { /* skip invalid geometry pairs */ }
            }
        }

        const fc = { type: 'FeatureCollection', features: results };
        return createSpatialDataset(
            `${datasetA.name}_intersect_${datasetB.name}`, fc, { format: 'derived' }
        );
    });
}

/**
 * Merge two feature collections into one combined dataset.
 */
export function mergeLayers(datasetA, datasetB) {
    const featuresA = datasetA.geojson?.features || [];
    const featuresB = datasetB.geojson?.features || [];
    const merged = [...featuresA.map(f => ({ ...f, properties: { ...f.properties } })),
                    ...featuresB.map(f => ({ ...f, properties: { ...f.properties } }))];
    const fc = { type: 'FeatureCollection', features: merged };
    return createSpatialDataset(`${datasetA.name}_merged_${datasetB.name}`, fc, { format: 'derived' });
}

/**
 * Difference — subtract polygon layer B from polygon layer A.
 * For each polygon in A, removes overlapping areas from all polygons in B.
 */
export async function differenceLayers(datasetA, datasetB) {
    if (typeof turf === 'undefined') throw new Error('Turf.js not loaded');

    const task = new TaskRunner('Difference', 'GISTools');
    return task.run(async (t) => {
        const polysA = datasetA.geojson.features.filter(f =>
            f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon')
        );
        const polysB = datasetB.geojson.features.filter(f =>
            f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon')
        );
        if (polysA.length === 0) throw new Error('Layer A has no polygon features');

        const results = [];
        for (let i = 0; i < polysA.length; i++) {
            t.throwIfCancelled();
            if (i % 50 === 0) {
                t.updateProgress(Math.round((i / polysA.length) * 90), `Differencing ${i}/${polysA.length}`);
                await new Promise(r => setTimeout(r, 0));
            }

            let current = polysA[i];
            for (const pb of polysB) {
                if (!current) break;
                try {
                    current = turf.difference(turf.featureCollection([current, pb]));
                } catch (_) { /* skip on error */ }
            }

            if (current && current.geometry) {
                current.properties = { ...polysA[i].properties };
                results.push(current);
            }
        }

        const fc = { type: 'FeatureCollection', features: results };
        return createSpatialDataset(
            `${datasetA.name}_diff_${datasetB.name}`, fc, { format: 'derived' }
        );
    });
}

/**
 * Summarize Within — count and summarize point features within each polygon.
 * Adds count + optional numeric field aggregation to polygon properties.
 * @param {object} polygonsDataset
 * @param {object} pointsDataset
 * @param {string} [sumField]   - optional numeric field to sum
 * @param {string} [avgField]   - optional numeric field to average
 * @returns {object} enriched polygons dataset
 */
export async function summarizeWithin(polygonsDataset, pointsDataset, sumField, avgField) {
    if (typeof turf === 'undefined') throw new Error('Turf.js not loaded');

    const task = new TaskRunner('Summarize Within', 'GISTools');
    return task.run(async (t) => {
        const polygons = polygonsDataset.geojson.features.filter(f =>
            f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon')
        );
        const points = pointsDataset.geojson.features.filter(f =>
            f.geometry && f.geometry.type === 'Point'
        );

        if (polygons.length === 0) throw new Error('Polygon layer has no polygon features');

        const enriched = [];
        for (let i = 0; i < polygons.length; i++) {
            t.throwIfCancelled();
            if (i % 50 === 0) {
                t.updateProgress(Math.round((i / polygons.length) * 90), `Summarizing ${i}/${polygons.length}`);
                await new Promise(r => setTimeout(r, 0));
            }

            const poly = polygons[i];
            const contained = [];

            for (const pt of points) {
                try {
                    if (turf.booleanPointInPolygon(pt, poly)) contained.push(pt);
                } catch (_) { /* skip */ }
            }

            const props = { ...poly.properties, point_count: contained.length };

            if (sumField && contained.length > 0) {
                const vals = contained.map(p => parseFloat(p.properties?.[sumField])).filter(v => !isNaN(v));
                props['sum_' + sumField] = vals.reduce((a, b) => a + b, 0);
            }
            if (avgField && contained.length > 0) {
                const vals = contained.map(p => parseFloat(p.properties?.[avgField])).filter(v => !isNaN(v));
                props['avg_' + avgField] = vals.length > 0
                    ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 1000) / 1000
                    : null;
            }

            enriched.push({ ...poly, properties: props });
        }

        // Build updated schema
        const schema = JSON.parse(JSON.stringify(polygonsDataset.schema));
        const newFields = ['point_count'];
        if (sumField) newFields.push('sum_' + sumField);
        if (avgField) newFields.push('avg_' + avgField);
        for (const name of newFields) {
            if (!schema.fields.find(f => f.name === name)) {
                const vals = enriched.map(f => f.properties[name]).filter(v => v != null);
                schema.fields.push({
                    name,
                    type: 'number',
                    nullCount: enriched.length - vals.length,
                    uniqueCount: new Set(vals).size,
                    sampleValues: vals.slice(0, 5),
                    min: vals.length ? Math.min(...vals) : null,
                    max: vals.length ? Math.max(...vals) : null,
                    selected: true,
                    outputName: name,
                    order: schema.fields.length
                });
            }
        }

        const fc = { type: 'FeatureCollection', features: enriched };
        return createSpatialDataset(`${polygonsDataset.name}_summary`, fc, { format: 'derived', schema });
    });
}

export default {
    bufferFeatures, simplifyFeatures, clipFeatures, dissolveFeatures,
    pointAlong, bearing, destination, distance, pointToLineDistance,
    bboxClipFeatures, bezierSplineFeatures, polygonSmoothFeatures,
    lineOffsetFeatures, lineSliceAlong, lineSlice, createSector,
    lineIntersect, findKinks, combineFeatures, unionFeatures,
    nearestPoint, nearestPointOnLine, nearestPointToLine,
    nearestNeighborAnalysis, pointsWithinPolygon,
    spatialJoinPointsInPolygons, nearestJoin, intersectLayers,
    mergeLayers, differenceLayers, summarizeWithin
};
