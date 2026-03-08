/**
 * Workflow Inspector — right sidebar showing selected node config form
 */
import { bus } from '../core/event-bus.js';

export class WorkflowInspector {
    constructor(container, engine) {
        this.container = container;
        this.engine = engine;
        this._currentNodeId = null;
        this._formEl = null;
        this._render();

        bus.on('workflow:node-selected', ({ nodeId }) => this.show(nodeId));
        bus.on('workflow:node-inspect', ({ nodeId }) => this.show(nodeId));
        bus.on('workflow:node-deselected', () => this.clear());

        // Refresh inspector when upstream data changes or a wire is connected
        bus.on('workflow:node-data-ready', ({ nodeId }) => this._onUpstreamChanged(nodeId));
        bus.on('workflow:wire-added', (wire) => this._onWireChanged(wire));
        bus.on('workflow:wire-removed', (wire) => this._onWireChanged(wire));
    }

    _render() {
        this.container.innerHTML = '';
        const title = document.createElement('div');
        title.className = 'wf-inspector-title';
        title.textContent = 'Node Configuration';
        this.container.appendChild(title);

        this._formEl = document.createElement('div');
        this._formEl.className = 'wf-inspector-form';
        this._formEl.innerHTML = '<p class="wf-inspector-empty">Select a node to configure</p>';
        this.container.appendChild(this._formEl);
    }

    show(nodeId) {
        // Avoid rebuilding the form if the same node is already shown
        if (nodeId === this._currentNodeId) return;

        this._saveCurrentConfig();
        this._currentNodeId = nodeId;
        const node = this.engine.nodes.get(nodeId);
        if (!node) { this.clear(); return; }

        this._formEl.innerHTML = '';

        // Node header
        const hdr = document.createElement('div');
        hdr.className = 'wf-inspector-header';
        hdr.innerHTML = `<span class="wf-inspector-icon">${node.icon}</span>
            <span class="wf-inspector-name">${node.name}</span>`;
        this._formEl.appendChild(hdr);

        // Delete button
        const delBtn = document.createElement('button');
        delBtn.className = 'wf-btn-sm wf-btn-danger';
        delBtn.textContent = '🗑 Delete Node';
        delBtn.style.marginBottom = '12px';
        delBtn.addEventListener('click', () => {
            bus.emit('workflow:delete-node', { nodeId });
        });
        this._formEl.appendChild(delBtn);

        // Config form area
        const configArea = document.createElement('div');
        configArea.className = 'wf-inspector-config';

        const layersFn = () => this._getLayers();
        const context = {
            getLayers: layersFn,
            importFile: (file) => this._importFile(file),
            getUpstreamOutput: (id) => this.engine.getUpstreamOutput(id, { getLayers: layersFn }),
            getUpstreamOutputForPort: (nodeId, portId) => this.engine.getUpstreamOutputForPort(nodeId, portId, { getLayers: layersFn })
        };

        // Incoming data summary (for nodes with upstream connections)
        if (node.inputPorts.length > 0) {
            const summaryEl = this._buildDataSummary(node, context);
            if (summaryEl) this._formEl.appendChild(summaryEl);
        }

        node.renderInspector(configArea, context);
        this._formEl.appendChild(configArea);

        // Validation message
        const vMsg = document.createElement('div');
        vMsg.className = 'wf-inspector-validation';
        const updateValidation = () => {
            node.readInspector(configArea);
            const val = node.validate();
            vMsg.innerHTML = val.valid ? '' : `<span class="wf-val-warn">⚠ ${val.message}</span>`;
        };
        updateValidation();
        this._formEl.appendChild(vMsg);

        // Comment field at the bottom
        const commentWrap = document.createElement('div');
        commentWrap.className = 'wf-inspector-comment';
        commentWrap.innerHTML = `
            <label class="wf-inspector-label">Comment</label>
            <textarea class="wf-inspector-comment-input" placeholder="Add a note about this node…" rows="3">${node.comment || ''}</textarea>`;
        commentWrap.querySelector('textarea').addEventListener('input', (e) => {
            node.comment = e.target.value;
        });
        this._formEl.appendChild(commentWrap);

        // Live-sync: re-read config and re-validate on any form interaction
        configArea.addEventListener('change', updateValidation);
        configArea.addEventListener('input', updateValidation);
    }

    clear() {
        this._saveCurrentConfig();
        this._currentNodeId = null;
        this._formEl.innerHTML = '<p class="wf-inspector-empty">Select a node to configure</p>';
    }

    _saveCurrentConfig() {
        if (!this._currentNodeId) return;
        const node = this.engine.nodes.get(this._currentNodeId);
        if (!node) return;
        const configArea = this._formEl.querySelector('.wf-inspector-config');
        if (configArea) node.readInspector(configArea);
        const commentEl = this._formEl.querySelector('.wf-inspector-comment-input');
        if (commentEl) node.comment = commentEl.value;
    }

    /** Save the current inspector state before running */
    saveBeforeRun() {
        this._saveCurrentConfig();
    }

    _getLayers() {
        // Bridge function — overlay will provide this
        return this._getLayersFn?.() || [];
    }

    _importFile(file) {
        return this._importFileFn?.(file);
    }

    /** Force re-render the currently shown node */
    refresh() {
        if (!this._currentNodeId) return;
        const nodeId = this._currentNodeId;
        this._currentNodeId = null;  // clear so show() won't early-return
        this.show(nodeId);
    }

    /** If the changed node IS the currently shown node, or is anywhere upstream, refresh */
    _onUpstreamChanged(changedNodeId) {
        if (!this._currentNodeId) return;
        if (changedNodeId === this._currentNodeId) {
            this.refresh();
            return;
        }
        if (this.engine.isUpstreamOf(this._currentNodeId, changedNodeId)) {
            this.refresh();
        }
    }

    /** If a wire was added/removed involving the currently shown node, refresh */
    _onWireChanged(wire) {
        if (!this._currentNodeId) return;
        if (wire.to === this._currentNodeId || wire.from === this._currentNodeId) {
            this.refresh();
        }
    }

    setLayersProvider(fn) { this._getLayersFn = fn; }
    setImportProvider(fn) { this._importFileFn = fn; }

    /** Build a collapsible "Incoming Data" summary panel */
    _buildDataSummary(node, context) {
        // Gather upstream data for each input port
        const portData = node.inputPorts.map(port => {
            const data = context.getUpstreamOutputForPort
                ? context.getUpstreamOutputForPort(node.id, port.id)
                : null;
            return { port, data: data || context.getUpstreamOutput?.(node.id) };
        });

        // If no upstream data at all, show a hint
        const hasAny = portData.some(pd => pd.data?.schema);
        if (!hasAny) {
            const el = document.createElement('div');
            el.className = 'wf-data-summary wf-data-empty';
            el.innerHTML = `<div class="wf-data-summary-hint">⚡ Connect an input to see available fields</div>`;
            return el;
        }

        const wrapper = document.createElement('div');
        wrapper.className = 'wf-data-summary';

        for (const { port, data } of portData) {
            if (!data?.schema) continue;

            const schema = data.schema;
            const fields = schema.fields || [];
            const label = node.inputPorts.length > 1 ? port.label : 'Incoming Data';
            const isSpatial = data.type === 'spatial';
            const count = isSpatial
                ? (data.geojson?.features?.length ?? schema.featureCount ?? '?')
                : (data.rows?.length ?? schema.featureCount ?? '?');
            const countLabel = isSpatial ? 'features' : 'rows';
            const geomBadge = isSpatial && schema.geometryType
                ? `<span class="wf-schema-badge wf-schema-geom">${schema.geometryType}</span>` : '';

            // Build field rows
            const fieldRows = fields.map(f => {
                const typeCls = this._fieldTypeClass(f.type);
                const samples = (f.sampleValues || []).slice(0, 3)
                    .map(v => v == null ? 'null' : String(v))
                    .map(v => v.length > 20 ? v.slice(0, 18) + '…' : v)
                    .join(', ');
                return `<tr>
                    <td class="wf-schema-fname">${f.name}</td>
                    <td><span class="wf-schema-type ${typeCls}">${f.type || '?'}</span></td>
                    <td class="wf-schema-sample" title="${samples}">${samples || '—'}</td>
                </tr>`;
            }).join('');

            const section = document.createElement('details');
            section.className = 'wf-data-section';
            section.open = true;
            section.innerHTML = `
                <summary class="wf-data-section-header">
                    <span>${label}</span>
                    <span class="wf-schema-meta">${count} ${countLabel} · ${fields.length} fields ${geomBadge}</span>
                </summary>
                <div class="wf-schema-table-wrap">
                    <table class="wf-schema-table">
                        <thead><tr><th>Field</th><th>Type</th><th>Sample</th></tr></thead>
                        <tbody>${fieldRows}</tbody>
                    </table>
                </div>`;
            wrapper.appendChild(section);
        }

        return wrapper;
    }

    _fieldTypeClass(type) {
        if (!type) return '';
        const t = type.toLowerCase();
        if (t === 'number' || t === 'integer' || t === 'float' || t === 'double') return 'wf-type-num';
        if (t === 'date' || t === 'datetime') return 'wf-type-date';
        if (t === 'boolean') return 'wf-type-bool';
        return 'wf-type-str';
    }

    destroy() {
        this.container.innerHTML = '';
    }
}
