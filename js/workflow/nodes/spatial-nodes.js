/**
 * Spatial analysis nodes — GIS operations
 */
import { NodeBase } from './node-base.js';

// ==============================
// Buffer
// ==============================
export class BufferNode extends NodeBase {
    constructor() {
        super('buffer', {
            name: 'Buffer',
            icon: '⭕',
            category: 'spatial',
            color: '#059669'
        });
        this.inputPorts = [{ id: 'in', label: 'Features', dataType: 'dataset' }];
        this.outputPorts = [{ id: 'out', label: 'Buffered', dataType: 'dataset' }];
        this.config = { distance: 1, units: 'kilometers' };
    }

    renderInspector(container) {
        container.innerHTML = `
            <label class="wf-inspector-label">Distance</label>
            <input class="wf-inspector-input" type="number" data-cfg="distance" value="${this.config.distance}" min="0" step="0.1">
            <label class="wf-inspector-label" style="margin-top:8px">Units</label>
            <select class="wf-inspector-select" data-cfg="units">
                ${['meters', 'kilometers', 'miles', 'feet'].map(u =>
                    `<option value="${u}" ${u === this.config.units ? 'selected' : ''}>${u}</option>`
                ).join('')}
            </select>`;
    }

    readInspector(container) {
        this.config.distance = parseFloat(container.querySelector('[data-cfg="distance"]')?.value) || 1;
        this.config.units = container.querySelector('[data-cfg="units"]')?.value || 'kilometers';
    }

    validate() {
        if (this.config.distance <= 0) return { valid: false, message: 'Distance must be > 0' };
        return { valid: true, message: '' };
    }

    async execute(inputs, context) {
        const data = inputs[0];
        if (!data || data.type !== 'spatial') throw new Error('Spatial input required');
        const { bufferFeatures } = await import('../../tools/gis-tools.js');
        return bufferFeatures(data, this.config.distance, this.config.units);
    }
}

// ==============================
// Simplify
// ==============================
export class SimplifyNode extends NodeBase {
    constructor() {
        super('simplify', {
            name: 'Simplify',
            icon: '〰️',
            category: 'spatial',
            color: '#059669'
        });
        this.inputPorts = [{ id: 'in', label: 'Features', dataType: 'dataset' }];
        this.outputPorts = [{ id: 'out', label: 'Simplified', dataType: 'dataset' }];
        this.config = { tolerance: 0.001 };
    }

    renderInspector(container) {
        container.innerHTML = `
            <label class="wf-inspector-label">Tolerance</label>
            <input class="wf-inspector-input" type="number" data-cfg="tolerance" value="${this.config.tolerance}" min="0.0001" step="0.0001">
            <p style="color:var(--text-muted);font-size:11px;margin-top:4px">Smaller = more detail. Default 0.001</p>`;
    }

    readInspector(container) {
        this.config.tolerance = parseFloat(container.querySelector('[data-cfg="tolerance"]')?.value) || 0.001;
    }

    validate() {
        if (this.config.tolerance <= 0) return { valid: false, message: 'Tolerance must be > 0' };
        return { valid: true, message: '' };
    }

    async execute(inputs) {
        const data = inputs[0];
        if (!data || data.type !== 'spatial') throw new Error('Spatial input required');
        const { simplifyFeatures } = await import('../../tools/gis-tools.js');
        const result = await simplifyFeatures(data, this.config.tolerance);
        return result.dataset;
    }
}

// ==============================
// Dissolve
// ==============================
export class DissolveNode extends NodeBase {
    constructor() {
        super('dissolve', {
            name: 'Dissolve',
            icon: '🫧',
            category: 'spatial',
            color: '#059669'
        });
        this.inputPorts = [{ id: 'in', label: 'Features', dataType: 'dataset' }];
        this.outputPorts = [{ id: 'out', label: 'Dissolved', dataType: 'dataset' }];
        this.config = { field: '' };
    }

    renderInspector(container, context) {
        const fields = this._getFields(context);
        if (this.config.field && !fields.includes(this.config.field)) fields.push(this.config.field);
        container.innerHTML = `
            <label class="wf-inspector-label">Dissolve Field</label>
            <select class="wf-inspector-select" data-cfg="field">
                <option value="">— All features —</option>
                ${fields.map(f => `<option value="${f}" ${f === this.config.field ? 'selected' : ''}>${f}</option>`).join('')}
            </select>
            <p style="color:var(--text-muted);font-size:11px;margin-top:4px">Merge geometries by shared field values</p>`;
    }

    readInspector(container) {
        this.config.field = container.querySelector('[data-cfg="field"]')?.value || '';
    }

    _getFields(context) {
        const upstream = context.getUpstreamOutput?.(this.id);
        if (upstream?.schema?.fields) return upstream.schema.fields.map(f => f.name);
        return [];
    }

    validate() { return { valid: true, message: '' }; }

    async execute(inputs) {
        const data = inputs[0];
        if (!data || data.type !== 'spatial') throw new Error('Spatial input required');
        const { dissolveFeatures } = await import('../../tools/gis-tools.js');
        return dissolveFeatures(data, this.config.field || undefined);
    }
}

// ==============================
// Clip
// ==============================
export class ClipNode extends NodeBase {
    constructor() {
        super('clip', {
            name: 'Clip',
            icon: '✂️',
            category: 'spatial',
            color: '#059669'
        });
        this.inputPorts = [
            { id: 'in', label: 'Features', dataType: 'dataset' },
            { id: 'clip', label: 'Clip Area', dataType: 'dataset' }
        ];
        this.outputPorts = [{ id: 'out', label: 'Clipped', dataType: 'dataset' }];
        this.config = {};
    }

    renderInspector(container) {
        container.innerHTML = `
            <p style="color:var(--text-muted);font-size:12px">
                Connect <strong>Features</strong> (to clip) and <strong>Clip Area</strong> (polygon boundary).
                All features will be clipped to the clip area boundary.
            </p>`;
    }

    readInspector() { }

    validate() { return { valid: true, message: '' }; }

    async execute(inputs) {
        const data = inputs[0];
        const clipData = inputs[1];
        if (!data || data.type !== 'spatial') throw new Error('Spatial features input required');
        if (!clipData || clipData.type !== 'spatial') throw new Error('Clip area input required');

        const { clipFeatures } = await import('../../tools/gis-tools.js');
        // Clip uses a single polygon geometry; take first feature from clip layer
        const clipGeom = clipData.geojson.features[0]?.geometry;
        if (!clipGeom) throw new Error('Clip layer has no geometry');
        return clipFeatures(data, clipGeom);
    }
}

// ==============================
// Union
// ==============================
export class UnionNode extends NodeBase {
    constructor() {
        super('union', {
            name: 'Union',
            icon: '🔗',
            category: 'spatial',
            color: '#059669'
        });
        this.inputPorts = [{ id: 'in', label: 'Polygons', dataType: 'dataset' }];
        this.outputPorts = [{ id: 'out', label: 'Merged', dataType: 'dataset' }];
        this.config = {};
    }

    renderInspector(container) {
        container.innerHTML = `
            <p style="color:var(--text-muted);font-size:12px">Merges all polygon features into a single geometry.</p>`;
    }

    readInspector() { }
    validate() { return { valid: true, message: '' }; }

    async execute(inputs) {
        const data = inputs[0];
        if (!data || data.type !== 'spatial') throw new Error('Spatial input required');
        const { unionFeatures } = await import('../../tools/gis-tools.js');
        return unionFeatures(data);
    }
}

// ==============================
// Combine
// ==============================
export class CombineNode extends NodeBase {
    constructor() {
        super('combine', {
            name: 'Combine',
            icon: '📦',
            category: 'spatial',
            color: '#059669'
        });
        this.inputPorts = [{ id: 'in', label: 'Features', dataType: 'dataset' }];
        this.outputPorts = [{ id: 'out', label: 'Combined', dataType: 'dataset' }];
        this.config = {};
    }

    renderInspector(container) {
        container.innerHTML = `
            <p style="color:var(--text-muted);font-size:12px">Groups features by geometry type into Multi* features (e.g. Points → MultiPoint).</p>`;
    }

    readInspector() { }
    validate() { return { valid: true, message: '' }; }

    async execute(inputs) {
        const data = inputs[0];
        if (!data || data.type !== 'spatial') throw new Error('Spatial input required');
        const { combineFeatures } = await import('../../tools/gis-tools.js');
        return combineFeatures(data);
    }
}

// ==============================
// Spatial Join (Point in Polygon) — assign polygon attrs to points
// ==============================
export class SpatialJoinNode extends NodeBase {
    constructor() {
        super('spatial-join', {
            name: 'Spatial Join',
            icon: '📌',
            category: 'spatial',
            color: '#059669'
        });
        this.inputPorts = [
            { id: 'points', label: 'Points', dataType: 'dataset' },
            { id: 'polygons', label: 'Polygons', dataType: 'dataset' }
        ];
        this.outputPorts = [{ id: 'out', label: 'Joined', dataType: 'dataset' }];
        this.config = { joinFields: '', prefix: '' };
    }

    renderInspector(container, context) {
        // Try to list polygon fields from upstream
        const polyData = context.getUpstreamOutputForPort?.(this.id, 'polygons');
        const fields = polyData?.schema?.fields?.map(f => f.name) || [];

        container.innerHTML = `
            <p style="color:var(--text-muted);font-size:12px;margin-bottom:8px">
                For each <strong>Point</strong>, finds the containing <strong>Polygon</strong>
                and copies its attributes to the point.
            </p>
            <label class="wf-inspector-label">Fields to Join</label>
            <input class="wf-inspector-input" data-cfg="joinFields" value="${this.config.joinFields}"
                   placeholder="Leave blank for all fields">
            ${fields.length ? `<p style="color:var(--text-muted);font-size:11px;margin-top:2px">
                Available: ${fields.join(', ')}</p>` : ''}
            <label class="wf-inspector-label" style="margin-top:8px">Field Prefix</label>
            <input class="wf-inspector-input" data-cfg="prefix" value="${this.config.prefix}"
                   placeholder="e.g. poly_ (optional)">`;
    }

    readInspector(container) {
        this.config.joinFields = container.querySelector('[data-cfg="joinFields"]')?.value?.trim() || '';
        this.config.prefix = container.querySelector('[data-cfg="prefix"]')?.value?.trim() || '';
    }

    validate() { return { valid: true, message: '' }; }

    async execute(inputs) {
        const pointsData = inputs[0];
        const polygonsData = inputs[1];
        if (!pointsData || pointsData.type !== 'spatial') throw new Error('Points input required');
        if (!polygonsData || polygonsData.type !== 'spatial') throw new Error('Polygons input required');

        const { spatialJoinPointsInPolygons } = await import('../../tools/gis-tools.js');
        const joinFields = this.config.joinFields
            ? this.config.joinFields.split(',').map(f => f.trim()).filter(Boolean)
            : [];
        return spatialJoinPointsInPolygons(pointsData, polygonsData, joinFields, this.config.prefix);
    }
}

// ==============================
// Nearest Join — join attrs from nearest feature
// ==============================
export class NearestJoinNode extends NodeBase {
    constructor() {
        super('nearest-join', {
            name: 'Nearest Join',
            icon: '🎯',
            category: 'spatial',
            color: '#059669'
        });
        this.inputPorts = [
            { id: 'target', label: 'Target', dataType: 'dataset' },
            { id: 'join', label: 'Join From', dataType: 'dataset' }
        ];
        this.outputPorts = [{ id: 'out', label: 'Joined', dataType: 'dataset' }];
        this.config = { joinFields: '', units: 'kilometers' };
    }

    renderInspector(container, context) {
        const joinData = context.getUpstreamOutputForPort?.(this.id, 'join');
        const fields = joinData?.schema?.fields?.map(f => f.name) || [];

        container.innerHTML = `
            <p style="color:var(--text-muted);font-size:12px;margin-bottom:8px">
                For each <strong>Target</strong> feature, finds the nearest feature in
                <strong>Join From</strong> and copies its attributes + distance.
            </p>
            <label class="wf-inspector-label">Fields to Join</label>
            <input class="wf-inspector-input" data-cfg="joinFields" value="${this.config.joinFields}"
                   placeholder="Leave blank for all fields">
            ${fields.length ? `<p style="color:var(--text-muted);font-size:11px;margin-top:2px">
                Available: ${fields.join(', ')}</p>` : ''}
            <label class="wf-inspector-label" style="margin-top:8px">Distance Units</label>
            <select class="wf-inspector-select" data-cfg="units">
                ${['meters', 'kilometers', 'miles', 'feet'].map(u =>
                    `<option value="${u}" ${u === this.config.units ? 'selected' : ''}>${u}</option>`
                ).join('')}
            </select>`;
    }

    readInspector(container) {
        this.config.joinFields = container.querySelector('[data-cfg="joinFields"]')?.value?.trim() || '';
        this.config.units = container.querySelector('[data-cfg="units"]')?.value || 'kilometers';
    }

    validate() { return { valid: true, message: '' }; }

    async execute(inputs) {
        const target = inputs[0];
        const joinFrom = inputs[1];
        if (!target || target.type !== 'spatial') throw new Error('Target input required');
        if (!joinFrom || joinFrom.type !== 'spatial') throw new Error('Join From input required');

        const { nearestJoin } = await import('../../tools/gis-tools.js');
        const joinFields = this.config.joinFields
            ? this.config.joinFields.split(',').map(f => f.trim()).filter(Boolean)
            : [];
        return nearestJoin(target, joinFrom, joinFields, this.config.units);
    }
}

// ==============================
// Intersect — geometric intersection of two polygon layers
// ==============================
export class IntersectNode extends NodeBase {
    constructor() {
        super('intersect', {
            name: 'Intersect',
            icon: '✖️',
            category: 'spatial',
            color: '#059669'
        });
        this.inputPorts = [
            { id: 'layerA', label: 'Layer A', dataType: 'dataset' },
            { id: 'layerB', label: 'Layer B', dataType: 'dataset' }
        ];
        this.outputPorts = [{ id: 'out', label: 'Intersection', dataType: 'dataset' }];
        this.config = {};
    }

    renderInspector(container) {
        container.innerHTML = `
            <p style="color:var(--text-muted);font-size:12px">
                Produces features where <strong>Layer A</strong> and <strong>Layer B</strong>
                polygons overlap. Attributes from both layers are merged
                (Layer B fields are prefixed with <code>B_</code>).
            </p>`;
    }

    readInspector() {}
    validate() { return { valid: true, message: '' }; }

    async execute(inputs) {
        const a = inputs[0];
        const b = inputs[1];
        if (!a || a.type !== 'spatial') throw new Error('Layer A input required');
        if (!b || b.type !== 'spatial') throw new Error('Layer B input required');

        const { intersectLayers } = await import('../../tools/gis-tools.js');
        return intersectLayers(a, b);
    }
}

// ==============================
// Merge Layers — combine two feature collections
// ==============================
export class MergeLayersNode extends NodeBase {
    constructor() {
        super('merge-layers', {
            name: 'Merge Layers',
            icon: '🔀',
            category: 'spatial',
            color: '#059669'
        });
        this.inputPorts = [
            { id: 'layerA', label: 'Layer A', dataType: 'dataset' },
            { id: 'layerB', label: 'Layer B', dataType: 'dataset' }
        ];
        this.outputPorts = [{ id: 'out', label: 'Merged', dataType: 'dataset' }];
        this.config = {};
    }

    renderInspector(container) {
        container.innerHTML = `
            <p style="color:var(--text-muted);font-size:12px">
                Concatenates all features from <strong>Layer A</strong> and <strong>Layer B</strong>
                into a single feature collection.
            </p>`;
    }

    readInspector() {}
    validate() { return { valid: true, message: '' }; }

    async execute(inputs) {
        const a = inputs[0];
        const b = inputs[1];
        if (!a || a.type !== 'spatial') throw new Error('Layer A input required');
        if (!b || b.type !== 'spatial') throw new Error('Layer B input required');

        const { mergeLayers } = await import('../../tools/gis-tools.js');
        return mergeLayers(a, b);
    }
}

// ==============================
// Difference — subtract polygon B from polygon A
// ==============================
export class DifferenceNode extends NodeBase {
    constructor() {
        super('difference', {
            name: 'Difference',
            icon: '➖',
            category: 'spatial',
            color: '#059669'
        });
        this.inputPorts = [
            { id: 'layerA', label: 'Layer A', dataType: 'dataset' },
            { id: 'subtract', label: 'Subtract', dataType: 'dataset' }
        ];
        this.outputPorts = [{ id: 'out', label: 'Result', dataType: 'dataset' }];
        this.config = {};
    }

    renderInspector(container) {
        container.innerHTML = `
            <p style="color:var(--text-muted);font-size:12px">
                Removes areas from <strong>Layer A</strong> polygons that overlap
                with <strong>Subtract</strong> polygons.
            </p>`;
    }

    readInspector() {}
    validate() { return { valid: true, message: '' }; }

    async execute(inputs) {
        const a = inputs[0];
        const b = inputs[1];
        if (!a || a.type !== 'spatial') throw new Error('Layer A input required');
        if (!b || b.type !== 'spatial') throw new Error('Subtract input required');

        const { differenceLayers } = await import('../../tools/gis-tools.js');
        return differenceLayers(a, b);
    }
}

// ==============================
// Summarize Within — count/aggregate points inside polygons
// ==============================
export class SummarizeWithinNode extends NodeBase {
    constructor() {
        super('summarize-within', {
            name: 'Summarize Within',
            icon: '📊',
            category: 'spatial',
            color: '#059669'
        });
        this.inputPorts = [
            { id: 'polygons', label: 'Polygons', dataType: 'dataset' },
            { id: 'points', label: 'Points', dataType: 'dataset' }
        ];
        this.outputPorts = [{ id: 'out', label: 'Summary', dataType: 'dataset' }];
        this.config = { sumField: '', avgField: '' };
    }

    renderInspector(container, context) {
        const ptData = context.getUpstreamOutputForPort?.(this.id, 'points');
        const numFields = (ptData?.schema?.fields || []).filter(f => f.type === 'number').map(f => f.name);
        if (this.config.sumField && !numFields.includes(this.config.sumField)) numFields.push(this.config.sumField);
        if (this.config.avgField && !numFields.includes(this.config.avgField)) numFields.push(this.config.avgField);

        container.innerHTML = `
            <p style="color:var(--text-muted);font-size:12px;margin-bottom:8px">
                Counts <strong>Point</strong> features within each <strong>Polygon</strong>.
                Optionally sums or averages a numeric point field.
            </p>
            <label class="wf-inspector-label">Sum Field (optional)</label>
            <select class="wf-inspector-select" data-cfg="sumField">
                <option value="">— None —</option>
                ${numFields.map(f => `<option value="${f}" ${f === this.config.sumField ? 'selected' : ''}>${f}</option>`).join('')}
            </select>
            <label class="wf-inspector-label" style="margin-top:8px">Average Field (optional)</label>
            <select class="wf-inspector-select" data-cfg="avgField">
                <option value="">— None —</option>
                ${numFields.map(f => `<option value="${f}" ${f === this.config.avgField ? 'selected' : ''}>${f}</option>`).join('')}
            </select>
            <p style="color:var(--text-muted);font-size:11px;margin-top:8px">
                Adds <code>point_count</code> to each polygon. Sum/avg fields add
                <code>sum_&lt;field&gt;</code> and <code>avg_&lt;field&gt;</code>.
            </p>`;
    }

    readInspector(container) {
        this.config.sumField = container.querySelector('[data-cfg="sumField"]')?.value || '';
        this.config.avgField = container.querySelector('[data-cfg="avgField"]')?.value || '';
    }

    validate() { return { valid: true, message: '' }; }

    async execute(inputs) {
        const polygons = inputs[0];
        const points = inputs[1];
        if (!polygons || polygons.type !== 'spatial') throw new Error('Polygons input required');
        if (!points || points.type !== 'spatial') throw new Error('Points input required');

        const { summarizeWithin } = await import('../../tools/gis-tools.js');
        return summarizeWithin(polygons, points, this.config.sumField || undefined, this.config.avgField || undefined);
    }
}

// ==============================
// Split By Geometry — separate mixed layers by geometry type
// ==============================
export class SplitByGeometryNode extends NodeBase {
    constructor() {
        super('split-by-geometry', {
            name: 'Split By Geometry',
            icon: '🔱',
            category: 'spatial',
            color: '#059669'
        });
        this.inputPorts = [{ id: 'in', label: 'Features', dataType: 'dataset' }];
        this.outputPorts = [
            { id: 'points', label: 'Points', dataType: 'dataset' },
            { id: 'lines', label: 'Lines', dataType: 'dataset' },
            { id: 'polygons', label: 'Polygons', dataType: 'dataset' }
        ];
        this.config = {};
    }

    renderInspector(container) {
        container.innerHTML = `
            <p style="color:var(--text-muted);font-size:12px">
                Splits a mixed-geometry layer into three separate outputs by geometry type.
            </p>
            <div style="margin-top:8px;font-size:12px;line-height:1.8">
                <div><strong style="color:#ef4444">● Points</strong> — Point, MultiPoint</div>
                <div><strong style="color:#3b82f6">● Lines</strong> — LineString, MultiLineString</div>
                <div><strong style="color:#22c55e">● Polygons</strong> — Polygon, MultiPolygon</div>
            </div>
            <p style="color:var(--text-muted);font-size:11px;margin-top:8px">
                Wire each output port to the appropriate downstream node.
                Empty outputs (no features of that type) will pass through as empty datasets.
            </p>`;
    }

    readInspector() {}
    validate() { return { valid: true, message: '' }; }

    async execute(inputs) {
        const data = inputs[0];
        if (!data || data.type !== 'spatial') throw new Error('Spatial input required');

        const features = data.geojson.features || [];
        const pointTypes = new Set(['Point', 'MultiPoint']);
        const lineTypes = new Set(['LineString', 'MultiLineString']);
        const polyTypes = new Set(['Polygon', 'MultiPolygon']);

        const pointFeats = features.filter(f => f.geometry && pointTypes.has(f.geometry.type));
        const lineFeats = features.filter(f => f.geometry && lineTypes.has(f.geometry.type));
        const polyFeats = features.filter(f => f.geometry && polyTypes.has(f.geometry.type));

        const buildOutput = (feats, geomType, suffix) => {
            const fc = { type: 'FeatureCollection', features: feats };
            const schema = JSON.parse(JSON.stringify(data.schema));
            schema.geometryType = feats.length > 0 ? geomType : null;
            schema.featureCount = feats.length;
            return {
                type: 'spatial',
                geojson: fc,
                schema,
                name: `${data.name}_${suffix}`
            };
        };

        return {
            _multiOutput: true,
            ports: {
                points: buildOutput(pointFeats, 'Point', 'points'),
                lines: buildOutput(lineFeats, 'LineString', 'lines'),
                polygons: buildOutput(polyFeats, 'Polygon', 'polygons')
            }
        };
    }
}

// ==============================
// Registry
// ==============================
export const SPATIAL_NODES = [
    { type: 'buffer', label: 'Buffer', icon: '⭕', create: () => new BufferNode() },
    { type: 'simplify', label: 'Simplify', icon: '〰️', create: () => new SimplifyNode() },
    { type: 'dissolve', label: 'Dissolve', icon: '🫧', create: () => new DissolveNode() },
    { type: 'clip', label: 'Clip', icon: '✂️', create: () => new ClipNode() },
    { type: 'union', label: 'Union', icon: '🔗', create: () => new UnionNode() },
    { type: 'combine', label: 'Combine', icon: '📦', create: () => new CombineNode() },
    { type: 'spatial-join', label: 'Spatial Join', icon: '📌', create: () => new SpatialJoinNode() },
    { type: 'nearest-join', label: 'Nearest Join', icon: '🎯', create: () => new NearestJoinNode() },
    { type: 'intersect', label: 'Intersect', icon: '✖️', create: () => new IntersectNode() },
    { type: 'merge-layers', label: 'Merge Layers', icon: '🔀', create: () => new MergeLayersNode() },
    { type: 'difference', label: 'Difference', icon: '➖', create: () => new DifferenceNode() },
    { type: 'summarize-within', label: 'Summarize Within', icon: '📊', create: () => new SummarizeWithinNode() },
    { type: 'split-by-geometry', label: 'Split By Geometry', icon: '🔱', create: () => new SplitByGeometryNode() }
];
