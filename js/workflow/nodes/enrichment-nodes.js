/**
 * Enrichment nodes — enrich features with external data (elevation, etc.)
 */
import { NodeBase } from './node-base.js';

// ── Helpers ──

/**
 * Batch-query the Open-Elevation API.
 * Sends coordinates in chunks to stay under URL/payload limits.
 */
const ELEVATION_API = 'https://api.open-elevation.com/api/v1/lookup';
const BATCH_SIZE = 200;

async function queryElevations(coords) {
    // coords: [{ latitude, longitude }]
    const results = new Array(coords.length).fill(null);

    for (let i = 0; i < coords.length; i += BATCH_SIZE) {
        const batch = coords.slice(i, i + BATCH_SIZE);
        const body = JSON.stringify({ locations: batch });

        const resp = await fetch(ELEVATION_API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body
        });

        if (!resp.ok) throw new Error(`Elevation API error: ${resp.status} ${resp.statusText}`);
        const data = await resp.json();

        if (!data.results || data.results.length !== batch.length) {
            throw new Error('Elevation API returned unexpected number of results');
        }

        for (let j = 0; j < data.results.length; j++) {
            results[i + j] = data.results[j].elevation;
        }
    }

    return results;
}

/**
 * Extract a representative coordinate from a feature's geometry.
 * - Point: the point itself
 * - LineString / Polygon: centroid via average of coordinates
 * - Multi*: centroid of first sub-geometry
 */
function getRepresentativeCoord(geometry) {
    if (!geometry) return null;
    const type = geometry.type;
    const coords = geometry.coordinates;

    if (type === 'Point') {
        return { longitude: coords[0], latitude: coords[1] };
    }

    // Flatten to get all positions, then average
    const positions = flattenPositions(coords);
    if (positions.length === 0) return null;

    let sumLng = 0, sumLat = 0;
    for (const p of positions) { sumLng += p[0]; sumLat += p[1]; }
    return {
        longitude: sumLng / positions.length,
        latitude: sumLat / positions.length
    };
}

function flattenPositions(arr) {
    if (!Array.isArray(arr)) return [];
    if (typeof arr[0] === 'number') return [arr]; // single position
    const out = [];
    for (const item of arr) out.push(...flattenPositions(item));
    return out;
}

// ==============================
// Add Elevation — enrich each feature with an elevation attribute
// ==============================
export class AddElevationNode extends NodeBase {
    constructor() {
        super('add-elevation', {
            name: 'Add Elevation',
            icon: '⛰️',
            category: 'enrichment',
            color: '#0891b2'
        });
        this.inputPorts = [{ id: 'in', label: 'Features', dataType: 'dataset' }];
        this.outputPorts = [{ id: 'out', label: 'Enriched', dataType: 'dataset' }];
        this.config = { fieldName: 'elevation', units: 'meters' };
    }

    renderInspector(container) {
        container.innerHTML = `
            <label class="wf-inspector-label">Elevation Field Name</label>
            <input class="wf-inspector-input" data-cfg="fieldName" value="${this.config.fieldName}" placeholder="elevation">
            <label class="wf-inspector-label" style="margin-top:8px">Units</label>
            <select class="wf-inspector-select" data-cfg="units">
                <option value="meters" ${this.config.units === 'meters' ? 'selected' : ''}>Meters</option>
                <option value="feet" ${this.config.units === 'feet' ? 'selected' : ''}>Feet</option>
            </select>
            <p style="color:var(--text-muted);font-size:11px;margin-top:8px">
                Queries the Open-Elevation API to add elevation values to each feature.
                Uses the centroid for lines and polygons.
            </p>`;
    }

    readInspector(container) {
        this.config.fieldName = container.querySelector('[data-cfg="fieldName"]')?.value?.trim() || 'elevation';
        this.config.units = container.querySelector('[data-cfg="units"]')?.value || 'meters';
    }

    validate() {
        if (!this.config.fieldName) return { valid: false, message: 'Field name is required' };
        return { valid: true, message: '' };
    }

    async execute(inputs) {
        const data = inputs[0];
        if (!data || data.type !== 'spatial') throw new Error('Spatial input required');

        const features = data.geojson.features;
        if (features.length === 0) return data;

        // Build coordinate list
        const coords = features.map(f => getRepresentativeCoord(f.geometry));
        const validCoords = coords.map(c => c || { latitude: 0, longitude: 0 });

        // Query API
        const elevations = await queryElevations(validCoords);

        // Convert if needed
        const METERS_TO_FEET = 3.28084;
        const toFeet = this.config.units === 'feet';
        const fieldName = this.config.fieldName;

        // Clone features and add elevation
        const enriched = features.map((f, i) => {
            const elev = coords[i] && elevations[i] != null
                ? (toFeet ? Math.round(elevations[i] * METERS_TO_FEET * 100) / 100 : elevations[i])
                : null;
            return {
                ...f,
                properties: { ...f.properties, [fieldName]: elev }
            };
        });

        // Update schema
        const schema = JSON.parse(JSON.stringify(data.schema));
        if (!schema.fields.find(f => f.name === fieldName)) {
            schema.fields.push({
                name: fieldName,
                type: 'number',
                nullCount: enriched.filter(f => f.properties[fieldName] == null).length,
                uniqueCount: new Set(enriched.map(f => f.properties[fieldName])).size,
                sampleValues: enriched.slice(0, 5).map(f => f.properties[fieldName]),
                min: Math.min(...enriched.map(f => f.properties[fieldName]).filter(v => v != null)),
                max: Math.max(...enriched.map(f => f.properties[fieldName]).filter(v => v != null)),
                selected: true,
                outputName: fieldName,
                order: schema.fields.length
            });
        }

        return {
            type: 'spatial',
            geojson: { type: 'FeatureCollection', features: enriched },
            schema,
            name: data.name
        };
    }
}

// ==============================
// Registry
// ==============================
export const ENRICHMENT_NODES = [
    { type: 'add-elevation', label: 'Add Elevation', icon: '⛰️', create: () => new AddElevationNode() }
];
