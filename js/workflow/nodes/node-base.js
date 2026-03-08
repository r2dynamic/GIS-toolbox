/**
 * Node Base — abstract base for all workflow nodes
 */

let _nodeIdCounter = 0;

export class NodeBase {
    /**
     * @param {string} type   e.g. 'layer-input', 'filter-rows'
     * @param {object} meta   { name, icon, category, color }
     */
    constructor(type, meta = {}) {
        this.id = `node-${++_nodeIdCounter}`;
        this.type = type;
        this.name = meta.name || type;
        this.icon = meta.icon || '⚙️';
        this.category = meta.category || 'transform';
        this.color = meta.color || '#2563eb';

        this.position = { x: 100, y: 100 };
        this.config = {};
        this.comment = '';

        // Ports
        this.inputPorts = [];   // [{ id, label, dataType }]
        this.outputPorts = [];  // [{ id, label, dataType }]

        // Runtime
        this._outputData = null;   // result after execution (single-output nodes)
        this._outputPorts = null;  // { portId: data } for multi-output nodes
        this._error = null;
        this._running = false;
    }

    /** Override: Build the config form HTML for the inspector */
    renderInspector(container, context) {
        container.innerHTML = '<p style="color:var(--text-muted)">No configuration needed.</p>';
    }

    /** Override: Read config values from the inspector DOM */
    readInspector(container) {}

    /** Override: Execute this node's operation */
    async execute(inputs, context) {
        return inputs[0] || null;
    }

    /** Override: Validate config before run */
    validate() {
        return { valid: true, message: '' };
    }

    /** Override: Return a lightweight preview of this node's output (schema + type)
     *  before the pipeline has been executed. Used so downstream inspectors
     *  can show field lists without requiring a full run first. */
    getOutputPreview(context) {
        return this._outputData || null;
    }

    /** Get abbreviated output stats for badge display */
    getOutputStats() {
        // Multi-output nodes: summarize each port
        if (this._outputPorts) {
            const parts = [];
            for (const port of this.outputPorts) {
                const d = this._outputPorts[port.id];
                if (!d) { parts.push(`${port.label}: —`); continue; }
                if (d.type === 'spatial') {
                    parts.push(`${port.label}: ${d.geojson?.features?.length ?? 0}`);
                } else if (d.type === 'table') {
                    parts.push(`${port.label}: ${d.rows?.length ?? 0}`);
                }
            }
            return parts.join(' · ');
        }
        if (!this._outputData) return null;
        const d = this._outputData;
        if (d.type === 'spatial') {
            const fc = d.geojson?.features?.length ?? 0;
            const flds = d.schema?.fields?.length ?? 0;
            return `${fc} feat · ${flds} fields`;
        }
        if (d.type === 'table') {
            const rc = d.rows?.length ?? 0;
            const flds = d.schema?.fields?.length ?? 0;
            return `${rc} rows · ${flds} fields`;
        }
        return null;
    }

    /** Serialize for save */
    toJSON() {
        const json = {
            id: this.id,
            type: this.type,
            position: { ...this.position },
            config: JSON.parse(JSON.stringify(this.config))
        };
        if (this.comment) json.comment = this.comment;
        return json;
    }
}

/** Reset the ID counter (used when loading a saved pipeline) */
export function resetNodeIdCounter(val = 0) {
    _nodeIdCounter = val;
}
