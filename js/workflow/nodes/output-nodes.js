/**
 * Output nodes — Preview and Add to Map
 */
import { NodeBase } from './node-base.js';

// ==============================
// Preview Node — shows data in the data-preview panel
// ==============================
export class PreviewNode extends NodeBase {
    constructor() {
        super('preview', {
            name: 'Preview',
            icon: '👁️',
            category: 'output',
            color: '#7c3aed'
        });
        this.inputPorts = [{ id: 'in', label: 'Data', dataType: 'dataset' }];
        this.outputPorts = [];
        this.config = { maxRows: 500 };
    }

    renderInspector(container) {
        container.innerHTML = `
            <label class="wf-inspector-label">Max Preview Rows</label>
            <input class="wf-inspector-input" type="number" data-cfg="maxRows" value="${this.config.maxRows}" min="10" max="10000" step="10">
            <p style="color:var(--text-muted);font-size:11px;margin-top:4px">Data appears in the bottom preview panel after running.</p>`;
    }

    readInspector(container) {
        this.config.maxRows = parseInt(container.querySelector('[data-cfg="maxRows"]')?.value) || 500;
    }

    validate() { return { valid: true, message: '' }; }

    async execute(inputs, context) {
        const data = inputs[0];
        if (!data) throw new Error('No input data');
        // Signal the overlay to display this data
        context.showPreview?.(data, this.config.maxRows);
        return data;
    }
}

// ==============================
// Add to Map Node — pushes result as a new layer (updates in place on re-run)
// ==============================
export class AddToMapNode extends NodeBase {
    constructor() {
        super('add-to-map', {
            name: 'Add to Map',
            icon: '🗺️',
            category: 'output',
            color: '#7c3aed'
        });
        this.inputPorts = [{ id: 'in', label: 'Data', dataType: 'dataset' }];
        this.outputPorts = [];
        this.config = { layerName: '' };
        this._lastLayerId = null;   // track for update-in-place
    }

    renderInspector(container) {
        container.innerHTML = `
            <label class="wf-inspector-label">Layer Name</label>
            <input class="wf-inspector-input" data-cfg="layerName" value="${this.config.layerName}" placeholder="Auto-generated if blank">
            <p style="color:var(--text-muted);font-size:11px;margin-top:4px">Updates the existing layer on re-run, or creates a new one.</p>`;
    }

    readInspector(container) {
        this.config.layerName = container.querySelector('[data-cfg="layerName"]')?.value?.trim() || '';
    }

    validate() { return { valid: true, message: '' }; }

    async execute(inputs, context) {
        const data = inputs[0];
        if (!data) throw new Error('No input data');
        const name = this.config.layerName || 'Workflow Result';
        // addToMap handles update-in-place (matches by name + workflow source)
        const layerId = context.addToMap?.(data, name);
        if (layerId) this._lastLayerId = layerId;
        return data;
    }
}

// ==============================
// Registry
// ==============================
export const OUTPUT_NODES = [
    { type: 'preview', label: 'Preview', icon: '👁️', create: () => new PreviewNode() },
    { type: 'add-to-map', label: 'Add to Map', icon: '🗺️', create: () => new AddToMapNode() }
];
