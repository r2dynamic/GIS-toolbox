/**
 * Input nodes — data sources that start a pipeline
 */
import { NodeBase } from './node-base.js';
import { bus } from '../../core/event-bus.js';

// ==============================
// Layer Input — pick an existing layer
// ==============================
export class LayerInputNode extends NodeBase {
    constructor() {
        super('layer-input', {
            name: 'Layer Input',
            icon: '📂',
            category: 'input',
            color: '#16a34a'
        });
        this.outputPorts = [{ id: 'out', label: 'Data', dataType: 'dataset' }];
        this.config = { layerId: null };
    }

    renderInspector(container, context) {
        const layers = context.getLayers().filter(l => l.type === 'spatial' || l.type === 'table');
        const options = layers.map(l => {
            const count = l.type === 'spatial'
                ? (l.geojson?.features?.length || 0) + ' features'
                : (l.rows?.length || 0) + ' rows';
            return `<option value="${l.id}" ${l.id === this.config.layerId ? 'selected' : ''}>${l.name} (${count})</option>`;
        }).join('');

        // Check if selected layer has mixed geometry
        const selectedLayer = this.config.layerId
            ? layers.find(l => l.id === this.config.layerId)
            : null;
        const isMixed = selectedLayer?.schema?.geometryType === 'Mixed';

        container.innerHTML = `
            <label class="wf-inspector-label">Source Layer</label>
            <select class="wf-inspector-select" data-cfg="layerId">
                <option value="">— Select a layer —</option>
                ${options}
            </select>
            <div id="wf-mixed-warn" style="display:${isMixed ? 'block' : 'none'};
                margin-top:8px;padding:8px 10px;border-radius:6px;
                background:rgba(234,179,8,0.12);border:1px solid rgba(234,179,8,0.3);
                font-size:12px;line-height:1.5;color:var(--text)">
                <strong style="color:#eab308">⚠️ Mixed Geometry</strong><br>
                This layer contains multiple geometry types (points, lines, and/or polygons).
                Some spatial nodes expect a single geometry type and may skip or error on
                mismatched features.<br>
                <span style="color:var(--text-muted);font-size:11px">
                    Tip: Use a <strong>Split By Geometry</strong> node after this input
                    to separate features by type before further analysis.
                </span>
            </div>`;

        // Re-check on layer change
        container.querySelector('[data-cfg="layerId"]').addEventListener('change', (e) => {
            const lid = e.target.value;
            const lyr = layers.find(l => l.id === lid);
            const warn = container.querySelector('#wf-mixed-warn');
            if (warn) warn.style.display = lyr?.schema?.geometryType === 'Mixed' ? 'block' : 'none';
        });
    }

    readInspector(container) {
        const sel = container.querySelector('[data-cfg="layerId"]');
        if (sel) this.config.layerId = sel.value || null;
    }

    validate() {
        if (!this.config.layerId) return { valid: false, message: 'No layer selected' };
        return { valid: true, message: '' };
    }

    getOutputPreview(context) {
        if (this._outputData) return this._outputData;
        if (!this.config.layerId || !context?.getLayers) return null;
        const layer = context.getLayers().find(l => l.id === this.config.layerId);
        if (!layer) return null;
        return { type: layer.type, schema: layer.schema, name: layer.name };
    }

    async execute(inputs, context) {
        const layer = context.getLayers().find(l => l.id === this.config.layerId);
        if (!layer) throw new Error('Source layer not found');
        // Deep-clone so pipeline doesn't mutate originals
        if (layer.type === 'spatial') {
            const geojson = JSON.parse(JSON.stringify(layer.geojson));
            const schema = JSON.parse(JSON.stringify(layer.schema));
            return { type: 'spatial', geojson, schema, name: layer.name };
        }
        const rows = JSON.parse(JSON.stringify(layer.rows));
        const schema = JSON.parse(JSON.stringify(layer.schema));
        return { type: 'table', rows, schema, name: layer.name };
    }
}

// ==============================
// File Import — upload a file inline
// ==============================
export class FileImportNode extends NodeBase {
    constructor() {
        super('file-import', {
            name: 'File Import',
            icon: '📎',
            category: 'input',
            color: '#16a34a'
        });
        this.outputPorts = [{ id: 'out', label: 'Data', dataType: 'dataset' }];
        this.config = { fileName: null };
        // Keep file references outside config so toJSON() serialization doesn't destroy them
        this._pendingFile = null;
        this._cachedResult = null;
    }

    renderInspector(container, context) {
        this._context = context;   // keep so _setFile can import immediately

        const hasFile = this._pendingFile || this._cachedResult;
        const needsReselect = this.config.fileName && !hasFile;
        let statusText;
        if (needsReselect) {
            statusText = '⚠️ Re-select file: ' + this.config.fileName;
        } else if (this._cachedResult) {
            const info = this._cachedResult;
            const count = info.type === 'spatial'
                ? (info.geojson?.features?.length || 0) + ' features'
                : (info.rows?.length || 0) + ' rows';
            statusText = '✅ ' + this.config.fileName + ' (' + count + ')';
        } else if (this.config.fileName) {
            statusText = '⏳ ' + this.config.fileName;
        } else {
            statusText = 'Click or drag a file here';
        }

        const inputId = 'wf-file-input-' + this.id;

        // Check if cached result has mixed geometry
        const isMixed = this._cachedResult?.schema?.geometryType === 'Mixed';

        container.innerHTML = `
            <span class="wf-inspector-label">Upload File</span>
            <label class="wf-file-drop" for="${inputId}">
                <p id="wf-file-status" style="margin:0;font-size:12px;color:var(--text-muted)">
                    ${statusText}
                </p>
                <input type="file" id="${inputId}" accept=".csv,.tsv,.txt,.json,.geojson,.kml,.kmz,.xlsx,.xls,.zip"
                       style="position:absolute;width:1px;height:1px;overflow:hidden;opacity:0;clip:rect(0,0,0,0)">
            </label>
            <div id="wf-file-mixed-warn" style="display:${isMixed ? 'block' : 'none'};
                margin-top:8px;padding:8px 10px;border-radius:6px;
                background:rgba(234,179,8,0.12);border:1px solid rgba(234,179,8,0.3);
                font-size:12px;line-height:1.5;color:var(--text)">
                <strong style="color:#eab308">⚠️ Mixed Geometry</strong><br>
                This file contains multiple geometry types (points, lines, and/or polygons).
                Some spatial nodes expect a single geometry type and may skip or error on
                mismatched features.<br>
                <span style="color:var(--text-muted);font-size:11px">
                    Tip: Use a <strong>Split By Geometry</strong> node after this input
                    to separate features by type before further analysis.
                </span>
            </div>`;
        const dropZone = container.querySelector('.wf-file-drop');
        const fileInput = container.querySelector(`#${inputId}`);

        // Drag-and-drop support (click-to-browse is handled natively by label+input)
        dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
        dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
        dropZone.addEventListener('drop', e => {
            e.preventDefault();
            dropZone.classList.remove('drag-over');
            if (e.dataTransfer.files.length) this._setFile(e.dataTransfer.files[0], container);
        });
        fileInput.addEventListener('change', () => {
            if (fileInput.files.length) this._setFile(fileInput.files[0], container);
        });
    }

    async _setFile(file, container) {
        this.config.fileName = file.name;
        this._pendingFile = file;
        this._cachedResult = null;

        const statusEl = container.querySelector('#wf-file-status');
        if (statusEl) statusEl.textContent = '⏳ Importing ' + file.name + '…';

        // Import immediately so downstream nodes can see schema/data
        try {
            const result = await this._context.importFile(file);
            if (!result) throw new Error('Import returned nothing');
            const dataset = Array.isArray(result) ? result[0] : result;
            this._cachedResult = dataset.type === 'spatial'
                ? { type: 'spatial', geojson: dataset.geojson, schema: dataset.schema, name: dataset.name }
                : { type: 'table', rows: dataset.rows, schema: dataset.schema, name: dataset.name };
            this._pendingFile = null;  // consumed

            const count = this._cachedResult.type === 'spatial'
                ? (this._cachedResult.geojson?.features?.length || 0) + ' features'
                : (this._cachedResult.rows?.length || 0) + ' rows';
            if (statusEl) statusEl.textContent = '✅ ' + file.name + ' (' + count + ')';

            // Show mixed-geometry warning if applicable
            const mixedWarn = container.querySelector('#wf-file-mixed-warn');
            if (mixedWarn && this._cachedResult.schema?.geometryType === 'Mixed') {
                mixedWarn.style.display = 'block';
            }

            // Notify inspector so it can refresh validation and downstream nodes
            bus.emit('workflow:node-data-ready', { nodeId: this.id });
        } catch (err) {
            if (statusEl) statusEl.textContent = '❌ ' + file.name + ': ' + err.message;
            this._cachedResult = null;
        }
    }

    readInspector() {}

    validate() {
        if (!this._cachedResult && !this._pendingFile) return { valid: false, message: 'No file imported' };
        return { valid: true, message: '' };
    }

    getOutputPreview() {
        if (this._outputData) return this._outputData;
        if (this._cachedResult) return { type: this._cachedResult.type, schema: this._cachedResult.schema, name: this._cachedResult.name };
        return null;
    }

    async execute(inputs, context) {
        if (this._cachedResult) {
            return JSON.parse(JSON.stringify(this._cachedResult));
        }
        if (!this._pendingFile) throw new Error('No file imported — select a file first');
        const result = await context.importFile(this._pendingFile);
        if (!result) throw new Error('Import failed');
        const dataset = Array.isArray(result) ? result[0] : result;
        const out = dataset.type === 'spatial'
            ? { type: 'spatial', geojson: dataset.geojson, schema: dataset.schema, name: dataset.name }
            : { type: 'table', rows: dataset.rows, schema: dataset.schema, name: dataset.name };
        this._cachedResult = out;
        this._pendingFile = null;
        return JSON.parse(JSON.stringify(out));
    }
}

// ==============================
// Registry
// ==============================
export const INPUT_NODES = [
    { type: 'layer-input', label: 'Layer Input', icon: '📂', create: () => new LayerInputNode() },
    { type: 'file-import', label: 'File Import', icon: '📎', create: () => new FileImportNode() }
];
