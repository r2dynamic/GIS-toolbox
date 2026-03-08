/**
 * Workflow Palette — left sidebar with draggable node categories
 */
import { bus } from '../core/event-bus.js';
import { INPUT_NODES } from './nodes/input-nodes.js';
import { TRANSFORM_NODES } from './nodes/transform-nodes.js';
import { SPATIAL_NODES } from './nodes/spatial-nodes.js';
import { ENRICHMENT_NODES } from './nodes/enrichment-nodes.js';
import { OUTPUT_NODES } from './nodes/output-nodes.js';

const CATEGORIES = [
    { key: 'input', label: 'Inputs', color: '#d97706', nodes: INPUT_NODES },
    { key: 'transform', label: 'Transforms', color: '#2563eb', nodes: TRANSFORM_NODES },
    { key: 'spatial', label: 'Spatial', color: '#059669', nodes: SPATIAL_NODES },
    { key: 'enrichment', label: 'Enrichment', color: '#0891b2', nodes: ENRICHMENT_NODES },
    { key: 'output', label: 'Outputs', color: '#7c3aed', nodes: OUTPUT_NODES }
];

export class WorkflowPalette {
    constructor(container) {
        this.container = container;
        this._collapsed = {};
        this._render();
    }

    _render() {
        this.container.innerHTML = '';
        const title = document.createElement('div');
        title.className = 'wf-palette-title';
        title.textContent = 'Nodes';
        this.container.appendChild(title);

        for (const cat of CATEGORIES) {
            const section = document.createElement('div');
            section.className = 'wf-palette-section';

            const header = document.createElement('div');
            header.className = 'wf-palette-cat-header';
            header.innerHTML = `<span class="wf-palette-arrow ${this._collapsed[cat.key] ? 'collapsed' : ''}">▾</span>
                <span style="color:${cat.color};font-weight:600">${cat.label}</span>`;
            header.addEventListener('click', () => {
                this._collapsed[cat.key] = !this._collapsed[cat.key];
                this._render();
            });
            section.appendChild(header);

            if (!this._collapsed[cat.key]) {
                const list = document.createElement('div');
                list.className = 'wf-palette-list';
                for (const def of cat.nodes) {
                    const item = document.createElement('div');
                    item.className = 'wf-palette-item';
                    item.setAttribute('draggable', 'true');
                    item.innerHTML = `<span class="wf-palette-icon">${def.icon}</span><span>${def.label}</span>`;

                    let didDrag = false;
                    item.addEventListener('dragstart', e => {
                        didDrag = true;
                        e.dataTransfer.setData('application/x-wf-node', JSON.stringify({ type: def.type, category: cat.key }));
                        e.dataTransfer.effectAllowed = 'copy';
                    });
                    item.addEventListener('dragend', () => {
                        // Reset after a short delay so the click handler can check it
                        setTimeout(() => { didDrag = false; }, 100);
                    });

                    // Click-to-add — only if not a drag
                    item.addEventListener('click', () => {
                        if (didDrag) return;
                        bus.emit('workflow:palette-add', { type: def.type, category: cat.key });
                    });

                    list.appendChild(item);
                }
                section.appendChild(list);
            }

            this.container.appendChild(section);
        }
    }

    /** Look up a node definition by type across all categories */
    static findDef(type) {
        for (const cat of CATEGORIES) {
            const def = cat.nodes.find(n => n.type === type);
            if (def) return def;
        }
        return null;
    }

    destroy() {
        this.container.innerHTML = '';
    }
}
