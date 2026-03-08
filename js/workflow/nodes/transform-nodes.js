/**
 * Transform nodes — data manipulation operations
 */
import { NodeBase } from './node-base.js';

// ==============================
// Filter Rows
// ==============================
export class FilterRowsNode extends NodeBase {
    constructor() {
        super('filter-rows', {
            name: 'Filter Rows',
            icon: '🔍',
            category: 'transform',
            color: '#2563eb'
        });
        this.inputPorts = [{ id: 'in', label: 'Data', dataType: 'dataset' }];
        this.outputPorts = [{ id: 'out', label: 'Filtered', dataType: 'dataset' }];
        this.config = { rules: [{ field: '', operator: 'equals', value: '' }], logic: 'AND' };
    }

    renderInspector(container, context) {
        const fields = this._getAvailableFields(context);
        for (const r of this.config.rules) { if (r.field && !fields.includes(r.field)) fields.push(r.field); }
        const ops = [
            { v: 'equals', l: '=' }, { v: 'not_equals', l: '≠' },
            { v: 'contains', l: 'contains' }, { v: 'not_contains', l: '!contains' },
            { v: 'starts_with', l: 'starts with' }, { v: 'ends_with', l: 'ends with' },
            { v: 'greater_than', l: '>' }, { v: 'less_than', l: '<' },
            { v: 'gte', l: '≥' }, { v: 'lte', l: '≤' },
            { v: 'is_null', l: 'is empty' }, { v: 'is_not_null', l: 'is not empty' },
            { v: 'in', l: 'in list' }
        ];

        const rulesHtml = this.config.rules.map((r, i) => `
            <div class="wf-filter-rule" data-idx="${i}">
                <select class="wf-inspector-select wf-filter-field" data-idx="${i}" style="flex:1">
                    <option value="">Field…</option>
                    ${fields.map(f => `<option value="${f}" ${f === r.field ? 'selected' : ''}>${f}</option>`).join('')}
                </select>
                <select class="wf-inspector-select wf-filter-op" data-idx="${i}" style="width:90px">
                    ${ops.map(o => `<option value="${o.v}" ${o.v === r.operator ? 'selected' : ''}>${o.l}</option>`).join('')}
                </select>
                <input class="wf-inspector-input wf-filter-val" data-idx="${i}" value="${r.value ?? ''}" placeholder="Value" style="flex:1">
                <button class="wf-btn-icon wf-filter-rm" data-idx="${i}" title="Remove rule">&times;</button>
            </div>
        `).join('');

        container.innerHTML = `
            <label class="wf-inspector-label">Logic</label>
            <div class="wf-toggle-row">
                <button class="wf-toggle-btn ${this.config.logic === 'AND' ? 'active' : ''}" data-logic="AND">AND</button>
                <button class="wf-toggle-btn ${this.config.logic === 'OR' ? 'active' : ''}" data-logic="OR">OR</button>
            </div>
            <label class="wf-inspector-label" style="margin-top:8px">Rules</label>
            <div id="wf-filter-rules">${rulesHtml}</div>
            <button class="wf-btn-sm" id="wf-add-rule" style="margin-top:6px">+ Add Rule</button>`;

        container.querySelectorAll('.wf-toggle-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.config.logic = btn.dataset.logic;
                container.querySelectorAll('.wf-toggle-btn').forEach(b => b.classList.toggle('active', b.dataset.logic === this.config.logic));
            });
        });
        container.querySelector('#wf-add-rule').addEventListener('click', () => {
            this.config.rules.push({ field: '', operator: 'equals', value: '' });
            this.renderInspector(container, context);
        });
        container.querySelectorAll('.wf-filter-rm').forEach(btn => {
            btn.addEventListener('click', () => {
                const idx = parseInt(btn.dataset.idx);
                if (this.config.rules.length > 1) {
                    this.config.rules.splice(idx, 1);
                    this.renderInspector(container, context);
                }
            });
        });
    }

    readInspector(container) {
        container.querySelectorAll('.wf-filter-rule').forEach((el, i) => {
            if (!this.config.rules[i]) return;
            this.config.rules[i].field = el.querySelector('.wf-filter-field')?.value || '';
            this.config.rules[i].operator = el.querySelector('.wf-filter-op')?.value || 'equals';
            this.config.rules[i].value = el.querySelector('.wf-filter-val')?.value ?? '';
        });
    }

    _getAvailableFields(context) {
        // Try to get fields from upstream node output
        const upstream = context.getUpstreamOutput?.(this.id);
        if (upstream?.schema?.fields) return upstream.schema.fields.map(f => f.name);
        return [];
    }

    validate() {
        const activeRules = this.config.rules.filter(r => r.field);
        if (activeRules.length === 0) return { valid: false, message: 'No filter rules defined' };
        return { valid: true, message: '' };
    }

    async execute(inputs, context) {
        const data = inputs[0];
        if (!data) throw new Error('No input data');

        const activeRules = this.config.rules.filter(r => r.field);
        if (activeRules.length === 0) return data; // pass-through

        const features = data.type === 'spatial' ? data.geojson.features : null;
        const rows = data.type === 'table' ? data.rows : null;
        const items = features || rows;

        const filtered = items.filter(item => {
            const props = features ? item.properties : item;
            const results = activeRules.map(rule => this._evalRule(props, rule));
            return this.config.logic === 'AND' ? results.every(Boolean) : results.some(Boolean);
        });

        if (data.type === 'spatial') {
            const geojson = { type: 'FeatureCollection', features: filtered };
            return { ...data, geojson, schema: { ...data.schema, featureCount: filtered.length } };
        }
        return { ...data, rows: filtered, schema: { ...data.schema, featureCount: filtered.length } };
    }

    _evalRule(props, rule) {
        const raw = props[rule.field];
        const val = raw == null ? '' : String(raw);
        const cmp = String(rule.value ?? '');

        switch (rule.operator) {
            case 'equals': return val === cmp;
            case 'not_equals': return val !== cmp;
            case 'contains': return val.toLowerCase().includes(cmp.toLowerCase());
            case 'not_contains': return !val.toLowerCase().includes(cmp.toLowerCase());
            case 'starts_with': return val.toLowerCase().startsWith(cmp.toLowerCase());
            case 'ends_with': return val.toLowerCase().endsWith(cmp.toLowerCase());
            case 'greater_than': return parseFloat(raw) > parseFloat(cmp);
            case 'less_than': return parseFloat(raw) < parseFloat(cmp);
            case 'gte': return parseFloat(raw) >= parseFloat(cmp);
            case 'lte': return parseFloat(raw) <= parseFloat(cmp);
            case 'is_null': return raw == null || val === '';
            case 'is_not_null': return raw != null && val !== '';
            case 'in': {
                const list = cmp.split(',').map(s => s.trim().toLowerCase());
                return list.includes(val.toLowerCase());
            }
            default: return true;
        }
    }
}

// ==============================
// Rename Fields
// ==============================
export class RenameFieldsNode extends NodeBase {
    constructor() {
        super('rename-fields', {
            name: 'Rename Fields',
            icon: '✏️',
            category: 'transform',
            color: '#2563eb'
        });
        this.inputPorts = [{ id: 'in', label: 'Data', dataType: 'dataset' }];
        this.outputPorts = [{ id: 'out', label: 'Renamed', dataType: 'dataset' }];
        this.config = { mappings: [] }; // [{ from, to }]
    }

    renderInspector(container, context) {
        const fields = this._getFields(context);
        for (const m of this.config.mappings) { if (m.from && !fields.includes(m.from)) fields.push(m.from); }
        if (this.config.mappings.length === 0 && fields.length > 0) {
            this.config.mappings = [{ from: fields[0], to: '' }];
        }
        const rows = this.config.mappings.map((m, i) => `
            <div class="wf-rename-row" data-idx="${i}">
                <select class="wf-inspector-select" data-role="from" data-idx="${i}" style="flex:1">
                    ${fields.map(f => `<option value="${f}" ${f === m.from ? 'selected' : ''}>${f}</option>`).join('')}
                </select>
                <span style="color:var(--text-muted)">→</span>
                <input class="wf-inspector-input" data-role="to" data-idx="${i}" value="${m.to}" placeholder="New name" style="flex:1">
                <button class="wf-btn-icon wf-rename-rm" data-idx="${i}">&times;</button>
            </div>`).join('');

        container.innerHTML = `
            <label class="wf-inspector-label">Field Renames</label>
            <div id="wf-rename-rows">${rows}</div>
            <button class="wf-btn-sm" id="wf-add-rename" style="margin-top:6px">+ Add Rename</button>`;

        container.querySelector('#wf-add-rename').addEventListener('click', () => {
            this.config.mappings.push({ from: fields[0] || '', to: '' });
            this.renderInspector(container, context);
        });
        container.querySelectorAll('.wf-rename-rm').forEach(btn => {
            btn.addEventListener('click', () => {
                this.config.mappings.splice(parseInt(btn.dataset.idx), 1);
                this.renderInspector(container, context);
            });
        });
    }

    readInspector(container) {
        container.querySelectorAll('.wf-rename-row').forEach((el, i) => {
            if (!this.config.mappings[i]) return;
            this.config.mappings[i].from = el.querySelector('[data-role="from"]')?.value || '';
            this.config.mappings[i].to = el.querySelector('[data-role="to"]')?.value || '';
        });
    }

    _getFields(context) {
        const upstream = context.getUpstreamOutput?.(this.id);
        if (upstream?.schema?.fields) return upstream.schema.fields.map(f => f.name);
        return [];
    }

    validate() {
        const active = this.config.mappings.filter(m => m.from && m.to);
        if (active.length === 0) return { valid: false, message: 'No renames defined' };
        return { valid: true, message: '' };
    }

    async execute(inputs) {
        const data = inputs[0];
        if (!data) throw new Error('No input data');
        const map = {};
        for (const m of this.config.mappings) { if (m.from && m.to) map[m.from] = m.to; }
        if (Object.keys(map).length === 0) return data;

        const renameProps = (props) => {
            const out = {};
            for (const [k, v] of Object.entries(props)) {
                out[map[k] || k] = v;
            }
            return out;
        };

        if (data.type === 'spatial') {
            const features = data.geojson.features.map(f => ({ ...f, properties: renameProps(f.properties || {}) }));
            const schema = { ...data.schema, fields: data.schema.fields.map(f => ({ ...f, name: map[f.name] || f.name })) };
            return { ...data, geojson: { type: 'FeatureCollection', features }, schema };
        }
        const rows = data.rows.map(r => renameProps(r));
        const schema = { ...data.schema, fields: data.schema.fields.map(f => ({ ...f, name: map[f.name] || f.name })) };
        return { ...data, rows, schema };
    }
}

// ==============================
// Delete Fields
// ==============================
export class DeleteFieldsNode extends NodeBase {
    constructor() {
        super('delete-fields', {
            name: 'Delete Fields',
            icon: '🗑️',
            category: 'transform',
            color: '#2563eb'
        });
        this.inputPorts = [{ id: 'in', label: 'Data', dataType: 'dataset' }];
        this.outputPorts = [{ id: 'out', label: 'Trimmed', dataType: 'dataset' }];
        this.config = { fieldsToDelete: [] };
    }

    renderInspector(container, context) {
        const fields = this._getFields(context);
        for (const f of this.config.fieldsToDelete) { if (f && !fields.includes(f)) fields.push(f); }
        const checks = fields.map(f => `
            <label class="wf-check-row">
                <input type="checkbox" value="${f}" ${this.config.fieldsToDelete.includes(f) ? 'checked' : ''}>
                <span>${f}</span>
            </label>`).join('');
        container.innerHTML = `
            <label class="wf-inspector-label">Fields to Remove</label>
            <div class="wf-check-list">${checks || '<p style="color:var(--text-muted);font-size:12px">No fields available</p>'}</div>`;
    }

    readInspector(container) {
        this.config.fieldsToDelete = [...container.querySelectorAll('.wf-check-list input:checked')].map(cb => cb.value);
    }

    _getFields(context) {
        const upstream = context.getUpstreamOutput?.(this.id);
        if (upstream?.schema?.fields) return upstream.schema.fields.map(f => f.name);
        return [];
    }

    validate() {
        if (this.config.fieldsToDelete.length === 0) return { valid: false, message: 'No fields selected to delete' };
        return { valid: true, message: '' };
    }

    async execute(inputs) {
        const data = inputs[0];
        if (!data) throw new Error('No input data');
        const del = new Set(this.config.fieldsToDelete);

        const stripProps = (props) => {
            const out = {};
            for (const [k, v] of Object.entries(props)) {
                if (!del.has(k)) out[k] = v;
            }
            return out;
        };

        if (data.type === 'spatial') {
            const features = data.geojson.features.map(f => ({ ...f, properties: stripProps(f.properties || {}) }));
            const schema = { ...data.schema, fields: data.schema.fields.filter(f => !del.has(f.name)) };
            return { ...data, geojson: { type: 'FeatureCollection', features }, schema };
        }
        const rows = data.rows.map(r => stripProps(r));
        const schema = { ...data.schema, fields: data.schema.fields.filter(f => !del.has(f.name)) };
        return { ...data, rows, schema };
    }
}

// ==============================
// Sort
// ==============================
export class SortNode extends NodeBase {
    constructor() {
        super('sort', {
            name: 'Sort',
            icon: '↕️',
            category: 'transform',
            color: '#2563eb'
        });
        this.inputPorts = [{ id: 'in', label: 'Data', dataType: 'dataset' }];
        this.outputPorts = [{ id: 'out', label: 'Sorted', dataType: 'dataset' }];
        this.config = { field: '', direction: 'asc' };
    }

    renderInspector(container, context) {
        const fields = this._getFields(context);
        if (this.config.field && !fields.includes(this.config.field)) fields.push(this.config.field);
        container.innerHTML = `
            <label class="wf-inspector-label">Sort Field</label>
            <select class="wf-inspector-select" data-cfg="field">
                <option value="">— Select —</option>
                ${fields.map(f => `<option value="${f}" ${f === this.config.field ? 'selected' : ''}>${f}</option>`).join('')}
            </select>
            <label class="wf-inspector-label" style="margin-top:8px">Direction</label>
            <div class="wf-toggle-row">
                <button class="wf-toggle-btn ${this.config.direction === 'asc' ? 'active' : ''}" data-dir="asc">↑ Ascending</button>
                <button class="wf-toggle-btn ${this.config.direction === 'desc' ? 'active' : ''}" data-dir="desc">↓ Descending</button>
            </div>`;

        container.querySelectorAll('[data-dir]').forEach(btn => {
            btn.addEventListener('click', () => {
                this.config.direction = btn.dataset.dir;
                container.querySelectorAll('[data-dir]').forEach(b => b.classList.toggle('active', b.dataset.dir === this.config.direction));
            });
        });
    }

    readInspector(container) {
        this.config.field = container.querySelector('[data-cfg="field"]')?.value || '';
    }

    _getFields(context) {
        const upstream = context.getUpstreamOutput?.(this.id);
        if (upstream?.schema?.fields) return upstream.schema.fields.map(f => f.name);
        return [];
    }

    validate() {
        if (!this.config.field) return { valid: false, message: 'No sort field selected' };
        return { valid: true, message: '' };
    }

    async execute(inputs) {
        const data = inputs[0];
        if (!data) throw new Error('No input data');

        const cmp = (a, b) => {
            const va = a[this.config.field];
            const vb = b[this.config.field];
            const na = parseFloat(va), nb = parseFloat(vb);
            if (!isNaN(na) && !isNaN(nb)) return this.config.direction === 'asc' ? na - nb : nb - na;
            const sa = String(va ?? ''), sb = String(vb ?? '');
            return this.config.direction === 'asc' ? sa.localeCompare(sb) : sb.localeCompare(sa);
        };

        if (data.type === 'spatial') {
            const features = [...data.geojson.features].sort((a, b) => cmp(a.properties || {}, b.properties || {}));
            return { ...data, geojson: { type: 'FeatureCollection', features } };
        }
        const rows = [...data.rows].sort(cmp);
        return { ...data, rows };
    }
}

// ==============================
// Find & Replace
// ==============================
export class FindReplaceNode extends NodeBase {
    constructor() {
        super('find-replace', {
            name: 'Find & Replace',
            icon: '🔎',
            category: 'transform',
            color: '#2563eb'
        });
        this.inputPorts = [{ id: 'in', label: 'Data', dataType: 'dataset' }];
        this.outputPorts = [{ id: 'out', label: 'Replaced', dataType: 'dataset' }];
        this.config = { field: '', find: '', replace: '', caseTransform: '' };
    }

    renderInspector(container, context) {
        const fields = this._getFields(context);
        if (this.config.field && !fields.includes(this.config.field)) fields.push(this.config.field);
        container.innerHTML = `
            <label class="wf-inspector-label">Field</label>
            <select class="wf-inspector-select" data-cfg="field">
                <option value="">— Select —</option>
                ${fields.map(f => `<option value="${f}" ${f === this.config.field ? 'selected' : ''}>${f}</option>`).join('')}
            </select>
            <label class="wf-inspector-label" style="margin-top:8px">Find</label>
            <input class="wf-inspector-input" data-cfg="find" value="${this.config.find}" placeholder="Text to find">
            <label class="wf-inspector-label" style="margin-top:6px">Replace with</label>
            <input class="wf-inspector-input" data-cfg="replace" value="${this.config.replace}" placeholder="Replacement text">
            <label class="wf-inspector-label" style="margin-top:8px">Case Transform</label>
            <select class="wf-inspector-select" data-cfg="caseTransform">
                <option value="" ${!this.config.caseTransform ? 'selected' : ''}>None</option>
                <option value="upper" ${this.config.caseTransform === 'upper' ? 'selected' : ''}>UPPERCASE</option>
                <option value="lower" ${this.config.caseTransform === 'lower' ? 'selected' : ''}>lowercase</option>
                <option value="title" ${this.config.caseTransform === 'title' ? 'selected' : ''}>Title Case</option>
            </select>`;
    }

    readInspector(container) {
        this.config.field = container.querySelector('[data-cfg="field"]')?.value || '';
        this.config.find = container.querySelector('[data-cfg="find"]')?.value || '';
        this.config.replace = container.querySelector('[data-cfg="replace"]')?.value || '';
        this.config.caseTransform = container.querySelector('[data-cfg="caseTransform"]')?.value || '';
    }

    _getFields(context) {
        const upstream = context.getUpstreamOutput?.(this.id);
        if (upstream?.schema?.fields) return upstream.schema.fields.map(f => f.name);
        return [];
    }

    validate() {
        if (!this.config.field) return { valid: false, message: 'No field selected' };
        if (!this.config.find && !this.config.caseTransform) return { valid: false, message: 'Nothing to find or transform' };
        return { valid: true, message: '' };
    }

    async execute(inputs) {
        const data = inputs[0];
        if (!data) throw new Error('No input data');

        const apply = (props) => {
            const out = { ...props };
            let val = String(out[this.config.field] ?? '');
            if (this.config.find) val = val.split(this.config.find).join(this.config.replace);
            if (this.config.caseTransform === 'upper') val = val.toUpperCase();
            if (this.config.caseTransform === 'lower') val = val.toLowerCase();
            if (this.config.caseTransform === 'title') val = val.replace(/\b\w/g, c => c.toUpperCase());
            out[this.config.field] = val;
            return out;
        };

        if (data.type === 'spatial') {
            const features = data.geojson.features.map(f => ({ ...f, properties: apply(f.properties || {}) }));
            return { ...data, geojson: { type: 'FeatureCollection', features } };
        }
        return { ...data, rows: data.rows.map(apply) };
    }
}

// ==============================
// Deduplicate
// ==============================
export class DeduplicateNode extends NodeBase {
    constructor() {
        super('deduplicate', {
            name: 'Deduplicate',
            icon: '🧹',
            category: 'transform',
            color: '#2563eb'
        });
        this.inputPorts = [{ id: 'in', label: 'Data', dataType: 'dataset' }];
        this.outputPorts = [{ id: 'out', label: 'Unique', dataType: 'dataset' }];
        this.config = { keyFields: [], keep: 'first' };
    }

    renderInspector(container, context) {
        const fields = this._getFields(context);
        for (const f of this.config.keyFields) { if (f && !fields.includes(f)) fields.push(f); }
        const checks = fields.map(f => `
            <label class="wf-check-row">
                <input type="checkbox" value="${f}" ${this.config.keyFields.includes(f) ? 'checked' : ''}>
                <span>${f}</span>
            </label>`).join('');
        container.innerHTML = `
            <label class="wf-inspector-label">Key Fields (duplicates matched on these)</label>
            <div class="wf-check-list">${checks || '<p style="color:var(--text-muted);font-size:12px">No fields available</p>'}</div>
            <label class="wf-inspector-label" style="margin-top:8px">Keep</label>
            <div class="wf-toggle-row">
                <button class="wf-toggle-btn ${this.config.keep === 'first' ? 'active' : ''}" data-keep="first">First</button>
                <button class="wf-toggle-btn ${this.config.keep === 'last' ? 'active' : ''}" data-keep="last">Last</button>
            </div>`;
        container.querySelectorAll('[data-keep]').forEach(btn => {
            btn.addEventListener('click', () => {
                this.config.keep = btn.dataset.keep;
                container.querySelectorAll('[data-keep]').forEach(b => b.classList.toggle('active', b.dataset.keep === this.config.keep));
            });
        });
    }

    readInspector(container) {
        this.config.keyFields = [...container.querySelectorAll('.wf-check-list input:checked')].map(cb => cb.value);
    }

    _getFields(context) {
        const upstream = context.getUpstreamOutput?.(this.id);
        if (upstream?.schema?.fields) return upstream.schema.fields.map(f => f.name);
        return [];
    }

    validate() {
        if (this.config.keyFields.length === 0) return { valid: false, message: 'No key fields selected' };
        return { valid: true, message: '' };
    }

    async execute(inputs) {
        const data = inputs[0];
        if (!data) throw new Error('No input data');

        const items = data.type === 'spatial' ? data.geojson.features : data.rows;
        const seen = new Map();
        const result = [];

        for (const item of items) {
            const props = data.type === 'spatial' ? item.properties : item;
            const key = this.config.keyFields.map(f => String(props[f] ?? '')).join('|');
            if (this.config.keep === 'first') {
                if (!seen.has(key)) { seen.set(key, true); result.push(item); }
            } else {
                seen.set(key, item);
            }
        }
        const final = this.config.keep === 'last' ? [...seen.values()] : result;

        if (data.type === 'spatial') {
            return { ...data, geojson: { type: 'FeatureCollection', features: final }, schema: { ...data.schema, featureCount: final.length } };
        }
        return { ...data, rows: final, schema: { ...data.schema, featureCount: final.length } };
    }
}

// ==============================
// Add Unique ID
// ==============================
export class AddUniqueIdNode extends NodeBase {
    constructor() {
        super('add-unique-id', {
            name: 'Add Unique ID',
            icon: '🆔',
            category: 'transform',
            color: '#2563eb'
        });
        this.inputPorts = [{ id: 'in', label: 'Data', dataType: 'dataset' }];
        this.outputPorts = [{ id: 'out', label: 'With ID', dataType: 'dataset' }];
        this.config = { fieldName: 'uid', method: 'sequential' };
    }

    renderInspector(container) {
        container.innerHTML = `
            <label class="wf-inspector-label">ID Field Name</label>
            <input class="wf-inspector-input" data-cfg="fieldName" value="${this.config.fieldName}" placeholder="uid">
            <label class="wf-inspector-label" style="margin-top:8px">Method</label>
            <div class="wf-toggle-row">
                <button class="wf-toggle-btn ${this.config.method === 'sequential' ? 'active' : ''}" data-method="sequential">1, 2, 3…</button>
                <button class="wf-toggle-btn ${this.config.method === 'uuid' ? 'active' : ''}" data-method="uuid">UUID</button>
            </div>`;
        container.querySelectorAll('[data-method]').forEach(btn => {
            btn.addEventListener('click', () => {
                this.config.method = btn.dataset.method;
                container.querySelectorAll('[data-method]').forEach(b => b.classList.toggle('active', b.dataset.method === this.config.method));
            });
        });
    }

    readInspector(container) {
        this.config.fieldName = container.querySelector('[data-cfg="fieldName"]')?.value || 'uid';
    }

    validate() {
        if (!this.config.fieldName) return { valid: false, message: 'Field name required' };
        return { valid: true, message: '' };
    }

    async execute(inputs) {
        const data = inputs[0];
        if (!data) throw new Error('No input data');
        let counter = 1;
        const genId = () => this.config.method === 'uuid'
            ? crypto.randomUUID()
            : counter++;

        const addId = props => ({ ...props, [this.config.fieldName]: genId() });

        if (data.type === 'spatial') {
            const features = data.geojson.features.map(f => ({ ...f, properties: addId(f.properties || {}) }));
            const fields = [...data.schema.fields, { name: this.config.fieldName, type: 'string', nullCount: 0, uniqueCount: features.length, sampleValues: [], selected: true, outputName: this.config.fieldName, order: data.schema.fields.length }];
            return { ...data, geojson: { type: 'FeatureCollection', features }, schema: { ...data.schema, fields } };
        }
        const rows = data.rows.map(r => addId(r));
        const fields = [...data.schema.fields, { name: this.config.fieldName, type: 'string', nullCount: 0, uniqueCount: rows.length, sampleValues: [], selected: true, outputName: this.config.fieldName, order: data.schema.fields.length }];
        return { ...data, rows, schema: { ...data.schema, fields } };
    }
}

// ==============================
// Registry
// ==============================
export const TRANSFORM_NODES = [
    { type: 'filter-rows', label: 'Filter Rows', icon: '🔍', create: () => new FilterRowsNode() },
    { type: 'rename-fields', label: 'Rename Fields', icon: '✏️', create: () => new RenameFieldsNode() },
    { type: 'delete-fields', label: 'Delete Fields', icon: '🗑️', create: () => new DeleteFieldsNode() },
    { type: 'find-replace', label: 'Find & Replace', icon: '🔎', create: () => new FindReplaceNode() },
    { type: 'sort', label: 'Sort', icon: '↕️', create: () => new SortNode() },
    { type: 'deduplicate', label: 'Deduplicate', icon: '🧹', create: () => new DeduplicateNode() },
    { type: 'add-unique-id', label: 'Add Unique ID', icon: '🆔', create: () => new AddUniqueIdNode() },
    { type: 'combine-fields', label: 'Combine Fields', icon: '🔗', create: () => new CombineFieldsNode() },
    { type: 'split-column', label: 'Split Column', icon: '✂️', create: () => new SplitColumnNode() },
    { type: 'template-builder', label: 'Template Builder', icon: '📝', create: () => new TemplateBuilderNode() },
    { type: 'type-convert', label: 'Type Convert', icon: '🔄', create: () => new TypeConvertNode() },
    { type: 'join-lookup', label: 'Join / Lookup', icon: '🔗', create: () => new JoinLookupNode() },
    { type: 'calculate-field', label: 'Calculate Field', icon: '🧮', create: () => new CalculateFieldNode() },
    { type: 'conditional-value', label: 'Conditional Value', icon: '❓', create: () => new ConditionalValueNode() },
    { type: 'coord-convert', label: 'Coordinate Converter', icon: '🌐', create: () => new CoordConvertNode() },
    { type: 'unit-convert', label: 'Unit Converter', icon: '📏', create: () => new UnitConvertNode() },
    { type: 'add-field', label: 'Add Field', icon: '➕', create: () => new AddFieldNode() }
];

// ==============================
// Combine Fields (Concatenate)
// ==============================
export class CombineFieldsNode extends NodeBase {
    constructor() {
        super('combine-fields', {
            name: 'Combine Fields',
            icon: '🔗',
            category: 'transform',
            color: '#2563eb'
        });
        this.inputPorts = [{ id: 'in', label: 'Data', dataType: 'dataset' }];
        this.outputPorts = [{ id: 'out', label: 'Combined', dataType: 'dataset' }];
        this.config = { fields: [], delimiter: ' ', outputField: 'combined', skipBlanks: true };
    }

    renderInspector(container, context) {
        const fields = this._getFields(context);
        for (const f of this.config.fields) { if (f && !fields.includes(f)) fields.push(f); }
        const checks = fields.map(f => `
            <label class="wf-check-row">
                <input type="checkbox" value="${f}" ${this.config.fields.includes(f) ? 'checked' : ''}>
                <span>${f}</span>
            </label>`).join('');
        container.innerHTML = `
            <label class="wf-inspector-label">Fields to Combine (in order)</label>
            <div class="wf-check-list">${checks || '<p style="color:var(--text-muted);font-size:12px">No fields available</p>'}</div>
            <label class="wf-inspector-label" style="margin-top:8px">Delimiter</label>
            <input class="wf-inspector-input" data-cfg="delimiter" value="${this.config.delimiter}" placeholder="Space, comma, etc.">
            <label class="wf-inspector-label" style="margin-top:6px">Output Field Name</label>
            <input class="wf-inspector-input" data-cfg="outputField" value="${this.config.outputField}" placeholder="combined">
            <label class="wf-check-row" style="margin-top:6px">
                <input type="checkbox" data-cfg="skipBlanks" ${this.config.skipBlanks ? 'checked' : ''}>
                <span>Skip blank values</span>
            </label>`;
    }

    readInspector(container) {
        this.config.fields = [...container.querySelectorAll('.wf-check-list input:checked')].map(cb => cb.value);
        this.config.delimiter = container.querySelector('[data-cfg="delimiter"]')?.value ?? ' ';
        this.config.outputField = container.querySelector('[data-cfg="outputField"]')?.value?.trim() || 'combined';
        this.config.skipBlanks = container.querySelector('[data-cfg="skipBlanks"]')?.checked ?? true;
    }

    _getFields(context) {
        const upstream = context.getUpstreamOutput?.(this.id);
        if (upstream?.schema?.fields) return upstream.schema.fields.map(f => f.name);
        return [];
    }

    validate() {
        if (this.config.fields.length < 2) return { valid: false, message: 'Select at least 2 fields' };
        if (!this.config.outputField) return { valid: false, message: 'Output field name required' };
        return { valid: true, message: '' };
    }

    async execute(inputs) {
        const data = inputs[0];
        if (!data) throw new Error('No input data');
        const { fields, delimiter, outputField, skipBlanks } = this.config;

        const combine = (props) => {
            let vals = fields.map(f => props[f]);
            if (skipBlanks) vals = vals.filter(v => v != null && v !== '');
            return { ...props, [outputField]: vals.join(delimiter) };
        };

        if (data.type === 'spatial') {
            const features = data.geojson.features.map(f => ({ ...f, properties: combine(f.properties || {}) }));
            const schema = this._addFieldToSchema(data.schema, outputField);
            return { ...data, geojson: { type: 'FeatureCollection', features }, schema };
        }
        const rows = data.rows.map(combine);
        return { ...data, rows, schema: this._addFieldToSchema(data.schema, outputField) };
    }

    _addFieldToSchema(schema, fieldName) {
        const s = JSON.parse(JSON.stringify(schema));
        if (!s.fields.find(f => f.name === fieldName)) {
            s.fields.push({ name: fieldName, type: 'string', nullCount: 0, uniqueCount: 0, sampleValues: [], selected: true, outputName: fieldName, order: s.fields.length });
        }
        return s;
    }
}

// ==============================
// Split Column
// ==============================
export class SplitColumnNode extends NodeBase {
    constructor() {
        super('split-column', {
            name: 'Split Column',
            icon: '✂️',
            category: 'transform',
            color: '#2563eb'
        });
        this.inputPorts = [{ id: 'in', label: 'Data', dataType: 'dataset' }];
        this.outputPorts = [{ id: 'out', label: 'Split', dataType: 'dataset' }];
        this.config = { field: '', delimiter: ',', maxParts: 0, outputNames: '' };
    }

    renderInspector(container, context) {
        const fields = this._getFields(context);
        if (this.config.field && !fields.includes(this.config.field)) fields.push(this.config.field);
        container.innerHTML = `
            <label class="wf-inspector-label">Field to Split</label>
            <select class="wf-inspector-select" data-cfg="field">
                <option value="">— Select —</option>
                ${fields.map(f => `<option value="${f}" ${f === this.config.field ? 'selected' : ''}>${f}</option>`).join('')}
            </select>
            <label class="wf-inspector-label" style="margin-top:8px">Delimiter</label>
            <input class="wf-inspector-input" data-cfg="delimiter" value="${this.config.delimiter}" placeholder=",">
            <label class="wf-inspector-label" style="margin-top:6px">Max Parts (0 = unlimited)</label>
            <input class="wf-inspector-input" type="number" data-cfg="maxParts" value="${this.config.maxParts}" min="0" step="1">
            <label class="wf-inspector-label" style="margin-top:6px">Output Names (comma-separated, optional)</label>
            <input class="wf-inspector-input" data-cfg="outputNames" value="${this.config.outputNames}" placeholder="part_1, part_2, ...">
            <p style="color:var(--text-muted);font-size:11px;margin-top:4px">Leave blank to auto-name: field_1, field_2, …</p>`;
    }

    readInspector(container) {
        this.config.field = container.querySelector('[data-cfg="field"]')?.value || '';
        this.config.delimiter = container.querySelector('[data-cfg="delimiter"]')?.value || ',';
        this.config.maxParts = parseInt(container.querySelector('[data-cfg="maxParts"]')?.value) || 0;
        this.config.outputNames = container.querySelector('[data-cfg="outputNames"]')?.value || '';
    }

    _getFields(context) {
        const upstream = context.getUpstreamOutput?.(this.id);
        if (upstream?.schema?.fields) return upstream.schema.fields.map(f => f.name);
        return [];
    }

    validate() {
        if (!this.config.field) return { valid: false, message: 'No field selected' };
        if (!this.config.delimiter) return { valid: false, message: 'Delimiter required' };
        return { valid: true, message: '' };
    }

    async execute(inputs) {
        const data = inputs[0];
        if (!data) throw new Error('No input data');
        const { field, delimiter, maxParts } = this.config;
        const names = this.config.outputNames
            ? this.config.outputNames.split(',').map(s => s.trim()).filter(Boolean)
            : [];

        const split = (props) => {
            const val = String(props[field] ?? '');
            let parts = maxParts > 0 ? val.split(delimiter).slice(0, maxParts) : val.split(delimiter);
            parts = parts.map(p => p.trim());
            const out = { ...props };
            parts.forEach((p, i) => {
                out[names[i] || `${field}_${i + 1}`] = p;
            });
            return out;
        };

        if (data.type === 'spatial') {
            const features = data.geojson.features.map(f => ({ ...f, properties: split(f.properties || {}) }));
            return { ...data, geojson: { type: 'FeatureCollection', features }, schema: this._rebuildSchema(features, data.schema) };
        }
        const rows = data.rows.map(split);
        return { ...data, rows, schema: this._rebuildSchema(rows, data.schema, true) };
    }

    _rebuildSchema(items, origSchema, isTable = false) {
        const s = JSON.parse(JSON.stringify(origSchema));
        const sample = isTable ? items[0] : items[0]?.properties;
        if (sample) {
            for (const key of Object.keys(sample)) {
                if (!s.fields.find(f => f.name === key)) {
                    s.fields.push({ name: key, type: 'string', nullCount: 0, uniqueCount: 0, sampleValues: [], selected: true, outputName: key, order: s.fields.length });
                }
            }
        }
        return s;
    }
}

// ==============================
// Template Builder
// ==============================
export class TemplateBuilderNode extends NodeBase {
    constructor() {
        super('template-builder', {
            name: 'Template Builder',
            icon: '📝',
            category: 'transform',
            color: '#2563eb'
        });
        this.inputPorts = [{ id: 'in', label: 'Data', dataType: 'dataset' }];
        this.outputPorts = [{ id: 'out', label: 'Templated', dataType: 'dataset' }];
        this.config = { template: '', outputField: 'formatted', skipBlanks: true };
    }

    renderInspector(container, context) {
        const fields = this._getFields(context);
        // Extract field names referenced in template like {FieldName}
        for (const m of this.config.template.matchAll(/\{([^}]+)\}/g)) {
            if (m[1] && !fields.includes(m[1])) fields.push(m[1]);
        }
        const chips = fields.map(f =>
            `<span class="wf-field-chip" data-field="${f}" title="Click to insert">{${f}}</span>`
        ).join('');

        container.innerHTML = `
            <label class="wf-inspector-label">Available Fields <span style="font-weight:normal;color:var(--text-muted)">(click to insert)</span></label>
            <div class="wf-field-chips">${chips || '<span style="color:var(--text-muted);font-size:12px">No fields available</span>'}</div>
            <label class="wf-inspector-label" style="margin-top:8px">Template</label>
            <textarea class="wf-inspector-input" data-cfg="template" rows="3" placeholder="{FirstName} {LastName} ({City}, {State})" style="resize:vertical;font-family:monospace;font-size:12px">${this.config.template}</textarea>
            <label class="wf-inspector-label" style="margin-top:6px">Output Field Name</label>
            <input class="wf-inspector-input" data-cfg="outputField" value="${this.config.outputField}" placeholder="formatted">
            <label class="wf-check-row" style="margin-top:6px">
                <input type="checkbox" data-cfg="skipBlanks" ${this.config.skipBlanks ? 'checked' : ''}>
                <span>Clean up blank placeholders</span>
            </label>
            <p style="color:var(--text-muted);font-size:11px;margin-top:4px">
                Use {FieldName} placeholders. Empty wrappers like () and dangling separators are auto-removed.
            </p>`;

        // Click-to-insert field chips
        container.querySelectorAll('.wf-field-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                const ta = container.querySelector('[data-cfg="template"]');
                if (!ta) return;
                const pos = ta.selectionStart ?? ta.value.length;
                const insertion = `{${chip.dataset.field}}`;
                ta.value = ta.value.slice(0, pos) + insertion + ta.value.slice(pos);
                ta.focus();
                ta.selectionStart = ta.selectionEnd = pos + insertion.length;
                // Trigger change for live validation
                ta.dispatchEvent(new Event('input', { bubbles: true }));
            });
        });
    }

    readInspector(container) {
        this.config.template = container.querySelector('[data-cfg="template"]')?.value || '';
        this.config.outputField = container.querySelector('[data-cfg="outputField"]')?.value?.trim() || 'formatted';
        this.config.skipBlanks = container.querySelector('[data-cfg="skipBlanks"]')?.checked ?? true;
    }

    _getFields(context) {
        const upstream = context.getUpstreamOutput?.(this.id);
        if (upstream?.schema?.fields) return upstream.schema.fields.map(f => f.name);
        return [];
    }

    validate() {
        if (!this.config.template) return { valid: false, message: 'Template is empty' };
        if (!this.config.outputField) return { valid: false, message: 'Output field name required' };
        return { valid: true, message: '' };
    }

    async execute(inputs) {
        const data = inputs[0];
        if (!data) throw new Error('No input data');
        const { applyTemplate } = await import('../../dataprep/template-builder.js');
        const opts = {
            trimWhitespace: true,
            collapseSpaces: true,
            skipEmptyFields: this.config.skipBlanks,
            removeEmptyWrappers: true,
            removeDanglingSeparators: true,
            collapseSeparators: true
        };

        if (data.type === 'spatial') {
            const features = applyTemplate(data.geojson.features, this.config.template, this.config.outputField, opts);
            const schema = this._addField(data.schema, this.config.outputField);
            return { ...data, geojson: { type: 'FeatureCollection', features }, schema };
        }
        // Table: wrap rows as fake features, apply, unwrap
        const fakeFeatures = data.rows.map(r => ({ properties: r }));
        const applied = applyTemplate(fakeFeatures, this.config.template, this.config.outputField, opts);
        const rows = applied.map(f => f.properties);
        return { ...data, rows, schema: this._addField(data.schema, this.config.outputField) };
    }

    _addField(schema, fieldName) {
        const s = JSON.parse(JSON.stringify(schema));
        if (!s.fields.find(f => f.name === fieldName)) {
            s.fields.push({ name: fieldName, type: 'string', nullCount: 0, uniqueCount: 0, sampleValues: [], selected: true, outputName: fieldName, order: s.fields.length });
        }
        return s;
    }
}

// ==============================
// Type Convert
// ==============================
export class TypeConvertNode extends NodeBase {
    constructor() {
        super('type-convert', {
            name: 'Type Convert',
            icon: '🔄',
            category: 'transform',
            color: '#2563eb'
        });
        this.inputPorts = [{ id: 'in', label: 'Data', dataType: 'dataset' }];
        this.outputPorts = [{ id: 'out', label: 'Converted', dataType: 'dataset' }];
        this.config = { field: '', targetType: 'number' };
    }

    renderInspector(container, context) {
        const fields = this._getFields(context);
        if (this.config.field && !fields.includes(this.config.field)) fields.push(this.config.field);
        container.innerHTML = `
            <label class="wf-inspector-label">Field</label>
            <select class="wf-inspector-select" data-cfg="field">
                <option value="">— Select —</option>
                ${fields.map(f => `<option value="${f}" ${f === this.config.field ? 'selected' : ''}>${f}</option>`).join('')}
            </select>
            <label class="wf-inspector-label" style="margin-top:8px">Convert To</label>
            <select class="wf-inspector-select" data-cfg="targetType">
                <option value="number" ${this.config.targetType === 'number' ? 'selected' : ''}>Number</option>
                <option value="string" ${this.config.targetType === 'string' ? 'selected' : ''}>Text</option>
                <option value="boolean" ${this.config.targetType === 'boolean' ? 'selected' : ''}>Boolean (true/false)</option>
                <option value="date" ${this.config.targetType === 'date' ? 'selected' : ''}>Date (ISO)</option>
            </select>
            <p style="color:var(--text-muted);font-size:11px;margin-top:4px">Converts all values in the field to the selected type. Invalid values remain unchanged.</p>`;
    }

    readInspector(container) {
        this.config.field = container.querySelector('[data-cfg="field"]')?.value || '';
        this.config.targetType = container.querySelector('[data-cfg="targetType"]')?.value || 'number';
    }

    _getFields(context) {
        const upstream = context.getUpstreamOutput?.(this.id);
        if (upstream?.schema?.fields) return upstream.schema.fields.map(f => f.name);
        return [];
    }

    validate() {
        if (!this.config.field) return { valid: false, message: 'No field selected' };
        return { valid: true, message: '' };
    }

    async execute(inputs) {
        const data = inputs[0];
        if (!data) throw new Error('No input data');
        const { typeConvert } = await import('../../dataprep/transforms.js');

        if (data.type === 'spatial') {
            const { features } = typeConvert(data.geojson.features, this.config.field, this.config.targetType);
            const schema = JSON.parse(JSON.stringify(data.schema));
            const f = schema.fields.find(f => f.name === this.config.field);
            if (f) f.type = this.config.targetType;
            return { ...data, geojson: { type: 'FeatureCollection', features }, schema };
        }
        const fakeFeatures = data.rows.map(r => ({ properties: r }));
        const { features } = typeConvert(fakeFeatures, this.config.field, this.config.targetType);
        const rows = features.map(f => f.properties);
        const schema = JSON.parse(JSON.stringify(data.schema));
        const fld = schema.fields.find(f => f.name === this.config.field);
        if (fld) fld.type = this.config.targetType;
        return { ...data, rows, schema };
    }
}

// ==============================
// Join / Lookup (VLOOKUP)
// ==============================
export class JoinLookupNode extends NodeBase {
    constructor() {
        super('join-lookup', {
            name: 'Join / Lookup',
            icon: '🔗',
            category: 'transform',
            color: '#2563eb'
        });
        this.inputPorts = [
            { id: 'in', label: 'Main Data', dataType: 'dataset' },
            { id: 'lookup', label: 'Lookup Table', dataType: 'dataset' }
        ];
        this.outputPorts = [{ id: 'out', label: 'Joined', dataType: 'dataset' }];
        this.config = { leftKey: '', rightKey: '', fieldsToJoin: [] };
    }

    renderInspector(container, context) {
        const leftFields = this._getFieldsForPort(context, 'in');
        const rightFields = this._getFieldsForPort(context, 'lookup');
        if (this.config.leftKey && !leftFields.includes(this.config.leftKey)) leftFields.push(this.config.leftKey);
        if (this.config.rightKey && !rightFields.includes(this.config.rightKey)) rightFields.push(this.config.rightKey);
        for (const f of this.config.fieldsToJoin) { if (f && !rightFields.includes(f)) rightFields.push(f); }

        const leftOpts = leftFields.map(f =>
            `<option value="${f}" ${f === this.config.leftKey ? 'selected' : ''}>${f}</option>`
        ).join('');
        const rightOpts = rightFields.map(f =>
            `<option value="${f}" ${f === this.config.rightKey ? 'selected' : ''}>${f}</option>`
        ).join('');
        const joinChecks = rightFields.map(f => `
            <label class="wf-check-row">
                <input type="checkbox" value="${f}" ${this.config.fieldsToJoin.includes(f) ? 'checked' : ''}>
                <span>${f}</span>
            </label>`).join('');

        container.innerHTML = `
            <label class="wf-inspector-label">Main Key Field</label>
            <select class="wf-inspector-select" data-cfg="leftKey">
                <option value="">— Select —</option>
                ${leftOpts}
            </select>
            <label class="wf-inspector-label" style="margin-top:8px">Lookup Key Field</label>
            <select class="wf-inspector-select" data-cfg="rightKey">
                <option value="">— Select —</option>
                ${rightOpts}
            </select>
            <label class="wf-inspector-label" style="margin-top:8px">Fields to Add from Lookup</label>
            <div class="wf-check-list">${joinChecks || '<p style="color:var(--text-muted);font-size:12px">Connect a lookup table to the second input</p>'}</div>
            <p style="color:var(--text-muted);font-size:11px;margin-top:4px">
                Like VLOOKUP: matches rows by key and copies selected fields from the lookup table.
            </p>`;
    }

    readInspector(container) {
        this.config.leftKey = container.querySelector('[data-cfg="leftKey"]')?.value || '';
        this.config.rightKey = container.querySelector('[data-cfg="rightKey"]')?.value || '';
        this.config.fieldsToJoin = [...container.querySelectorAll('.wf-check-list input:checked')].map(cb => cb.value);
    }

    _getFieldsForPort(context, portId) {
        // Use port-specific upstream lookup if available
        if (context.getUpstreamOutputForPort) {
            const out = context.getUpstreamOutputForPort(this.id, portId);
            if (out?.schema?.fields) return out.schema.fields.map(f => f.name);
        }
        // Fallback for the primary input port
        if (portId === 'in') {
            const upstream = context.getUpstreamOutput?.(this.id);
            if (upstream?.schema?.fields) return upstream.schema.fields.map(f => f.name);
        }
        return [];
    }

    validate() {
        if (!this.config.leftKey) return { valid: false, message: 'Main key field required' };
        if (!this.config.rightKey) return { valid: false, message: 'Lookup key field required' };
        if (this.config.fieldsToJoin.length === 0) return { valid: false, message: 'Select fields to add' };
        return { valid: true, message: '' };
    }

    async execute(inputs) {
        const main = inputs[0];
        const lookup = inputs[1];
        if (!main) throw new Error('No main data');
        if (!lookup) throw new Error('No lookup data connected');

        const { leftKey, rightKey, fieldsToJoin } = this.config;

        // Build lookup map from second input
        const lookupRows = lookup.type === 'spatial'
            ? lookup.geojson.features.map(f => f.properties || {})
            : lookup.rows || [];

        const lookupMap = new Map();
        for (const row of lookupRows) {
            const key = String(row[rightKey] ?? '');
            if (!lookupMap.has(key)) lookupMap.set(key, row);
        }

        const joinProps = (props) => {
            const key = String(props[leftKey] ?? '');
            const match = lookupMap.get(key);
            const out = { ...props };
            for (const field of fieldsToJoin) {
                out[field] = match ? (match[field] ?? null) : null;
            }
            return out;
        };

        if (main.type === 'spatial') {
            const features = main.geojson.features.map(f => ({ ...f, properties: joinProps(f.properties || {}) }));
            const schema = this._addFields(main.schema, fieldsToJoin);
            return { ...main, geojson: { type: 'FeatureCollection', features }, schema };
        }
        const rows = main.rows.map(joinProps);
        return { ...main, rows, schema: this._addFields(main.schema, fieldsToJoin) };
    }

    _addFields(schema, fieldNames) {
        const s = JSON.parse(JSON.stringify(schema));
        for (const fn of fieldNames) {
            if (!s.fields.find(f => f.name === fn)) {
                s.fields.push({ name: fn, type: 'string', nullCount: 0, uniqueCount: 0, sampleValues: [], selected: true, outputName: fn, order: s.fields.length });
            }
        }
        return s;
    }
}

// ==============================
// Calculate Field (math expressions)
// ==============================
export class CalculateFieldNode extends NodeBase {
    constructor() {
        super('calculate-field', {
            name: 'Calculate Field',
            icon: '🧮',
            category: 'transform',
            color: '#2563eb'
        });
        this.inputPorts = [{ id: 'in', label: 'Data', dataType: 'dataset' }];
        this.outputPorts = [{ id: 'out', label: 'Calculated', dataType: 'dataset' }];
        this.config = { expression: '', outputField: 'result' };
    }

    renderInspector(container, context) {
        const fields = this._getFields(context);
        // Extract field names referenced in expression like [FieldName]
        for (const m of this.config.expression.matchAll(/\[([^\]]+)\]/g)) {
            if (m[1] && !fields.includes(m[1])) fields.push(m[1]);
        }
        const chips = fields.map(f =>
            `<span class="wf-field-chip" data-field="${f}" title="Click to insert">[${f}]</span>`
        ).join('');

        container.innerHTML = `
            <label class="wf-inspector-label">Available Fields <span style="font-weight:normal;color:var(--text-muted)">(click to insert)</span></label>
            <div class="wf-field-chips">${chips || '<span style="color:var(--text-muted);font-size:12px">No fields available</span>'}</div>
            <label class="wf-inspector-label" style="margin-top:8px">Expression</label>
            <input class="wf-inspector-input" data-cfg="expression" value="${this.config.expression}" placeholder="[price] * [quantity]" style="font-family:monospace;font-size:12px">
            <label class="wf-inspector-label" style="margin-top:6px">Output Field Name</label>
            <input class="wf-inspector-input" data-cfg="outputField" value="${this.config.outputField}" placeholder="result">
            <p style="color:var(--text-muted);font-size:11px;margin-top:4px">
                Use [FieldName] for field values. Supports: + - * / % ( ) and numbers.<br>
                Example: [price] * [qty] * (1 + [tax_rate] / 100)
            </p>`;

        container.querySelectorAll('.wf-field-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                const inp = container.querySelector('[data-cfg="expression"]');
                if (!inp) return;
                const pos = inp.selectionStart ?? inp.value.length;
                const insertion = `[${chip.dataset.field}]`;
                inp.value = inp.value.slice(0, pos) + insertion + inp.value.slice(pos);
                inp.focus();
                inp.selectionStart = inp.selectionEnd = pos + insertion.length;
                inp.dispatchEvent(new Event('input', { bubbles: true }));
            });
        });
    }

    readInspector(container) {
        this.config.expression = container.querySelector('[data-cfg="expression"]')?.value || '';
        this.config.outputField = container.querySelector('[data-cfg="outputField"]')?.value?.trim() || 'result';
    }

    _getFields(context) {
        const upstream = context.getUpstreamOutput?.(this.id);
        if (upstream?.schema?.fields) return upstream.schema.fields.map(f => f.name);
        return [];
    }

    validate() {
        if (!this.config.expression) return { valid: false, message: 'Expression is empty' };
        if (!this.config.outputField) return { valid: false, message: 'Output field name required' };
        // Quick syntax check: only allow safe characters
        const stripped = this.config.expression.replace(/\[[^\]]+\]/g, '0');
        if (/[^0-9+\-*/%.() \t]/.test(stripped)) {
            return { valid: false, message: 'Expression contains invalid characters' };
        }
        return { valid: true, message: '' };
    }

    async execute(inputs) {
        const data = inputs[0];
        if (!data) throw new Error('No input data');

        const expr = this.config.expression;
        const outputField = this.config.outputField;

        // Extract field references
        const fieldRefs = [];
        const re = /\[([^\]]+)\]/g;
        let m;
        while ((m = re.exec(expr)) !== null) fieldRefs.push(m[1]);

        const calc = (props) => {
            let evalStr = expr;
            for (const f of fieldRefs) {
                const val = parseFloat(props[f]);
                const num = isNaN(val) ? 0 : val;
                // Use split/join to replace all occurrences
                evalStr = evalStr.split(`[${f}]`).join(String(num));
            }
            // Validate: only digits, operators, parens, dots, spaces
            if (/[^0-9+\-*/%.() \t]/.test(evalStr)) return null;
            try {
                // Safe evaluation using Function constructor with no scope access
                const fn = new Function(`"use strict"; return (${evalStr});`);
                const result = fn();
                return typeof result === 'number' && isFinite(result) ? Math.round(result * 1e10) / 1e10 : null;
            } catch {
                return null;
            }
        };

        if (data.type === 'spatial') {
            const features = data.geojson.features.map(f => ({
                ...f,
                properties: { ...f.properties, [outputField]: calc(f.properties || {}) }
            }));
            const schema = this._addField(data.schema, outputField);
            return { ...data, geojson: { type: 'FeatureCollection', features }, schema };
        }
        const rows = data.rows.map(r => ({ ...r, [outputField]: calc(r) }));
        return { ...data, rows, schema: this._addField(data.schema, outputField) };
    }

    _addField(schema, fieldName) {
        const s = JSON.parse(JSON.stringify(schema));
        if (!s.fields.find(f => f.name === fieldName)) {
            s.fields.push({ name: fieldName, type: 'number', nullCount: 0, uniqueCount: 0, sampleValues: [], selected: true, outputName: fieldName, order: s.fields.length });
        }
        return s;
    }
}

// ==============================
// Conditional Value (IF / CASE)
// ==============================
export class ConditionalValueNode extends NodeBase {
    constructor() {
        super('conditional-value', {
            name: 'Conditional Value',
            icon: '❓',
            category: 'transform',
            color: '#2563eb'
        });
        this.inputPorts = [{ id: 'in', label: 'Data', dataType: 'dataset' }];
        this.outputPorts = [{ id: 'out', label: 'Result', dataType: 'dataset' }];
        this.config = {
            outputField: 'category',
            rules: [{ field: '', operator: 'equals', value: '', result: '' }],
            defaultValue: ''
        };
    }

    renderInspector(container, context) {
        const fields = this._getFields(context);
        for (const r of this.config.rules) { if (r.field && !fields.includes(r.field)) fields.push(r.field); }
        const ops = [
            { v: 'equals', l: '=' }, { v: 'not_equals', l: '≠' },
            { v: 'contains', l: 'contains' }, { v: 'greater_than', l: '>' },
            { v: 'less_than', l: '<' }, { v: 'gte', l: '≥' }, { v: 'lte', l: '≤' },
            { v: 'is_null', l: 'is empty' }, { v: 'is_not_null', l: 'is not empty' }
        ];

        const rulesHtml = this.config.rules.map((r, i) => `
            <div class="wf-cond-rule" data-idx="${i}" style="border:1px solid var(--border);border-radius:6px;padding:6px;margin-bottom:4px">
                <div style="display:flex;gap:4px;align-items:center">
                    <span style="color:var(--text-muted);font-size:11px;width:18px">IF</span>
                    <select class="wf-inspector-select wf-cond-field" data-idx="${i}" style="flex:1;font-size:11px">
                        <option value="">Field…</option>
                        ${fields.map(f => `<option value="${f}" ${f === r.field ? 'selected' : ''}>${f}</option>`).join('')}
                    </select>
                    <select class="wf-inspector-select wf-cond-op" data-idx="${i}" style="width:70px;font-size:11px">
                        ${ops.map(o => `<option value="${o.v}" ${o.v === r.operator ? 'selected' : ''}>${o.l}</option>`).join('')}
                    </select>
                    <input class="wf-inspector-input wf-cond-val" data-idx="${i}" value="${r.value ?? ''}" placeholder="Value" style="flex:1;font-size:11px">
                    <button class="wf-btn-icon wf-cond-rm" data-idx="${i}" title="Remove">&times;</button>
                </div>
                <div style="display:flex;gap:4px;align-items:center;margin-top:4px">
                    <span style="color:var(--text-muted);font-size:11px;width:18px">→</span>
                    <input class="wf-inspector-input wf-cond-result" data-idx="${i}" value="${r.result ?? ''}" placeholder="Set value to…" style="flex:1;font-size:11px">
                </div>
            </div>`).join('');

        container.innerHTML = `
            <label class="wf-inspector-label">Output Field Name</label>
            <input class="wf-inspector-input" data-cfg="outputField" value="${this.config.outputField}" placeholder="category">
            <label class="wf-inspector-label" style="margin-top:8px">Rules (first match wins)</label>
            <div id="wf-cond-rules">${rulesHtml}</div>
            <button class="wf-btn-sm" id="wf-add-cond" style="margin-top:4px">+ Add Rule</button>
            <label class="wf-inspector-label" style="margin-top:8px">Default Value (if no rules match)</label>
            <input class="wf-inspector-input" data-cfg="defaultValue" value="${this.config.defaultValue}" placeholder="Other">`;

        container.querySelector('#wf-add-cond').addEventListener('click', () => {
            this.config.rules.push({ field: '', operator: 'equals', value: '', result: '' });
            this.renderInspector(container, context);
        });
        container.querySelectorAll('.wf-cond-rm').forEach(btn => {
            btn.addEventListener('click', () => {
                if (this.config.rules.length > 1) {
                    this.config.rules.splice(parseInt(btn.dataset.idx), 1);
                    this.renderInspector(container, context);
                }
            });
        });
    }

    readInspector(container) {
        this.config.outputField = container.querySelector('[data-cfg="outputField"]')?.value?.trim() || 'category';
        this.config.defaultValue = container.querySelector('[data-cfg="defaultValue"]')?.value ?? '';
        container.querySelectorAll('.wf-cond-rule').forEach((el, i) => {
            if (!this.config.rules[i]) return;
            this.config.rules[i].field = el.querySelector('.wf-cond-field')?.value || '';
            this.config.rules[i].operator = el.querySelector('.wf-cond-op')?.value || 'equals';
            this.config.rules[i].value = el.querySelector('.wf-cond-val')?.value ?? '';
            this.config.rules[i].result = el.querySelector('.wf-cond-result')?.value ?? '';
        });
    }

    _getFields(context) {
        const upstream = context.getUpstreamOutput?.(this.id);
        if (upstream?.schema?.fields) return upstream.schema.fields.map(f => f.name);
        return [];
    }

    validate() {
        if (!this.config.outputField) return { valid: false, message: 'Output field name required' };
        const active = this.config.rules.filter(r => r.field);
        if (active.length === 0) return { valid: false, message: 'At least one rule required' };
        return { valid: true, message: '' };
    }

    async execute(inputs) {
        const data = inputs[0];
        if (!data) throw new Error('No input data');
        const { outputField, rules, defaultValue } = this.config;
        const activeRules = rules.filter(r => r.field);

        const evaluate = (props) => {
            for (const rule of activeRules) {
                if (this._evalRule(props, rule)) return rule.result;
            }
            return defaultValue;
        };

        if (data.type === 'spatial') {
            const features = data.geojson.features.map(f => ({
                ...f,
                properties: { ...f.properties, [outputField]: evaluate(f.properties || {}) }
            }));
            const schema = this._addField(data.schema, outputField);
            return { ...data, geojson: { type: 'FeatureCollection', features }, schema };
        }
        const rows = data.rows.map(r => ({ ...r, [outputField]: evaluate(r) }));
        return { ...data, rows, schema: this._addField(data.schema, outputField) };
    }

    _evalRule(props, rule) {
        const raw = props[rule.field];
        const val = raw == null ? '' : String(raw);
        const cmp = String(rule.value ?? '');
        switch (rule.operator) {
            case 'equals': return val === cmp;
            case 'not_equals': return val !== cmp;
            case 'contains': return val.toLowerCase().includes(cmp.toLowerCase());
            case 'greater_than': return parseFloat(raw) > parseFloat(cmp);
            case 'less_than': return parseFloat(raw) < parseFloat(cmp);
            case 'gte': return parseFloat(raw) >= parseFloat(cmp);
            case 'lte': return parseFloat(raw) <= parseFloat(cmp);
            case 'is_null': return raw == null || val === '';
            case 'is_not_null': return raw != null && val !== '';
            default: return false;
        }
    }

    _addField(schema, fieldName) {
        const s = JSON.parse(JSON.stringify(schema));
        if (!s.fields.find(f => f.name === fieldName)) {
            s.fields.push({ name: fieldName, type: 'string', nullCount: 0, uniqueCount: 0, sampleValues: [], selected: true, outputName: fieldName, order: s.fields.length });
        }
        return s;
    }
}

// ==============================
// Coordinate Converter
// ==============================
export class CoordConvertNode extends NodeBase {
    constructor() {
        super('coord-convert', {
            name: 'Coordinate Converter',
            icon: '🌐',
            category: 'transform',
            color: '#2563eb'
        });
        this.inputPorts = [{ id: 'in', label: 'Data', dataType: 'dataset' }];
        this.outputPorts = [{ id: 'out', label: 'Converted', dataType: 'dataset' }];
        this.config = {
            source: 'geometry',  // 'geometry' or 'fields'
            fromFormat: 'dd',
            toFormat: 'dms',
            latField: '',
            lonField: '',
            outputPrefix: ''
        };
    }

    renderInspector(container, context) {
        const fields = this._getFields(context);
        if (this.config.latField && !fields.includes(this.config.latField)) fields.push(this.config.latField);
        if (this.config.lonField && !fields.includes(this.config.lonField)) fields.push(this.config.lonField);
        const upstream = context.getUpstreamOutput?.(this.id);
        const isSpatial = upstream?.type === 'spatial';

        const fmtOpts = [
            { id: 'dd', label: 'Decimal Degrees (DD)' },
            { id: 'dms', label: 'Degrees Minutes Seconds (DMS)' },
            { id: 'ddm', label: 'Degrees Decimal Minutes (DDM)' },
            { id: 'utm', label: 'UTM' }
        ].map(f => `<option value="${f.id}" ${f.id === this.config.toFormat ? 'selected' : ''}>${f.label}</option>`).join('');

        const fromFmtOpts = [
            { id: 'dd', label: 'Decimal Degrees (DD)' },
            { id: 'dms', label: 'Degrees Minutes Seconds (DMS)' },
            { id: 'ddm', label: 'Degrees Decimal Minutes (DDM)' }
        ].map(f => `<option value="${f.id}" ${f.id === this.config.fromFormat ? 'selected' : ''}>${f.label}</option>`).join('');

        const fieldOpts = fields.map(f =>
            `<option value="${f}">${f}</option>`
        ).join('');

        container.innerHTML = `
            <label class="wf-inspector-label">Coordinate Source</label>
            <select class="wf-inspector-select" data-cfg="source">
                ${isSpatial ? '<option value="geometry" ' + (this.config.source === 'geometry' ? 'selected' : '') + '>Feature Geometry</option>' : ''}
                <option value="fields" ${this.config.source === 'fields' ? 'selected' : ''}>Attribute Fields</option>
            </select>

            <div id="wf-coord-fields" style="${this.config.source === 'geometry' ? 'display:none' : ''}">
                <label class="wf-inspector-label" style="margin-top:8px">Source Format</label>
                <select class="wf-inspector-select" data-cfg="fromFormat">${fromFmtOpts}</select>
                <label class="wf-inspector-label" style="margin-top:6px">Latitude / Y Field</label>
                <select class="wf-inspector-select" data-cfg="latField">
                    <option value="">— Select —</option>
                    ${fieldOpts}
                </select>
                <label class="wf-inspector-label" style="margin-top:6px">Longitude / X Field</label>
                <select class="wf-inspector-select" data-cfg="lonField">
                    <option value="">— Select —</option>
                    ${fieldOpts}
                </select>
            </div>

            <label class="wf-inspector-label" style="margin-top:8px">Convert To</label>
            <select class="wf-inspector-select" data-cfg="toFormat">${fmtOpts}</select>

            <label class="wf-inspector-label" style="margin-top:6px">Output Field Prefix</label>
            <input class="wf-inspector-input" data-cfg="outputPrefix" value="${this.config.outputPrefix}" placeholder="Auto (e.g. DMS, UTM)">

            <p style="color:var(--text-muted);font-size:11px;margin-top:6px">
                Adds new attribute fields with the converted coordinates.<br>
                Examples: DMS_lat, DMS_lon, UTM_zone, UTM_easting, UTM_northing
            </p>`;

        // Auto-select lat/lon fields
        if (fields.length > 0 && !this.config.latField) {
            const latSel = container.querySelector('[data-cfg="latField"]');
            const lonSel = container.querySelector('[data-cfg="lonField"]');
            const latGuess = fields.find(f => /^(lat|latitude|y)$/i.test(f));
            const lonGuess = fields.find(f => /^(lon|lng|longitude|long|x)$/i.test(f));
            if (latGuess && latSel) latSel.value = latGuess;
            if (lonGuess && lonSel) lonSel.value = lonGuess;
        }

        // Show/hide fields section based on source
        container.querySelector('[data-cfg="source"]').addEventListener('change', (e) => {
            const fieldsDiv = container.querySelector('#wf-coord-fields');
            fieldsDiv.style.display = e.target.value === 'geometry' ? 'none' : '';
        });
    }

    readInspector(container) {
        this.config.source = container.querySelector('[data-cfg="source"]')?.value || 'geometry';
        this.config.fromFormat = container.querySelector('[data-cfg="fromFormat"]')?.value || 'dd';
        this.config.toFormat = container.querySelector('[data-cfg="toFormat"]')?.value || 'dms';
        this.config.latField = container.querySelector('[data-cfg="latField"]')?.value || '';
        this.config.lonField = container.querySelector('[data-cfg="lonField"]')?.value || '';
        this.config.outputPrefix = container.querySelector('[data-cfg="outputPrefix"]')?.value?.trim() || '';
    }

    _getFields(context) {
        const upstream = context.getUpstreamOutput?.(this.id);
        if (upstream?.schema?.fields) return upstream.schema.fields.map(f => f.name);
        return [];
    }

    validate() {
        if (!this.config.toFormat) return { valid: false, message: 'Select a target format' };
        if (this.config.source === 'fields') {
            if (!this.config.latField || !this.config.lonField)
                return { valid: false, message: 'Select latitude and longitude fields' };
        }
        return { valid: true, message: '' };
    }

    async execute(inputs) {
        const data = inputs[0];
        if (!data) throw new Error('No input data');
        const { convertFeatureCoords } = await import('../../tools/coordinates.js');
        const { source, fromFormat, toFormat, latField, lonField, outputPrefix } = this.config;

        const opts = {
            toFormat,
            useGeometry: source === 'geometry',
            fromFormat: source === 'geometry' ? 'dd' : fromFormat,
            latField: source === 'fields' ? latField : null,
            lonField: source === 'fields' ? lonField : null,
            outputPrefix: outputPrefix || undefined
        };

        if (data.type === 'spatial') {
            const { features } = convertFeatureCoords(data.geojson.features, opts);
            const schema = this._buildOutputSchema(data.schema, toFormat, outputPrefix);
            return { ...data, geojson: { type: 'FeatureCollection', features }, schema };
        }

        // Table data: wrap as fake features
        const fakeFeatures = data.rows.map(r => ({ properties: r }));
        opts.useGeometry = false;
        const { features: converted } = convertFeatureCoords(fakeFeatures, opts);
        const rows = converted.map(f => f.properties);
        const schema = this._buildOutputSchema(data.schema, toFormat, outputPrefix);
        return { ...data, rows, schema };
    }

    _buildOutputSchema(schema, toFormat, prefix) {
        const s = JSON.parse(JSON.stringify(schema));
        const p = prefix || toFormat.toUpperCase();
        const newFields = toFormat === 'utm'
            ? [`${p}_zone`, `${p}_easting`, `${p}_northing`, `${p}_full`]
            : [`${p}_lat`, `${p}_lon`];
        for (const name of newFields) {
            if (!s.fields.find(f => f.name === name)) {
                const type = (name.includes('easting') || name.includes('northing')) ? 'number' : 'string';
                s.fields.push({ name, type, nullCount: 0, uniqueCount: 0, sampleValues: [], selected: true, outputName: name, order: s.fields.length });
            }
        }
        return s;
    }
}

// ==============================
// Unit Converter — all-in-one unit conversion
// ==============================

/** Conversion tables: every value is the factor to convert TO the base unit of that category.
 *  To convert A → B: value_in_B = value_in_A * (FACTOR_A / FACTOR_B)  */
const UNIT_CATEGORIES = {
    'Length / Distance': {
        _base: 'meters',
        millimeters: 0.001, centimeters: 0.01, meters: 1, kilometers: 1000,
        inches: 0.0254, feet: 0.3048, yards: 0.9144, miles: 1609.344,
        'nautical miles': 1852, micrometers: 1e-6, 'us survey feet': 0.3048006096
    },
    'Area': {
        _base: 'sq meters',
        'sq millimeters': 1e-6, 'sq centimeters': 1e-4, 'sq meters': 1, 'sq kilometers': 1e6,
        'sq inches': 6.4516e-4, 'sq feet': 0.09290304, 'sq yards': 0.83612736,
        'sq miles': 2589988.11, acres: 4046.8564224, hectares: 10000
    },
    'Volume': {
        _base: 'liters',
        milliliters: 0.001, liters: 1, 'cubic meters': 1000, 'cubic centimeters': 0.001,
        gallons: 3.785411784, quarts: 0.946352946, pints: 0.473176473,
        cups: 0.2365882365, 'fluid ounces': 0.0295735296, 'cubic feet': 28.316846592,
        'cubic inches': 0.016387064, 'imperial gallons': 4.54609, barrels: 158.987294928
    },
    'Weight / Mass': {
        _base: 'kilograms',
        milligrams: 1e-6, grams: 0.001, kilograms: 1, 'metric tons': 1000,
        ounces: 0.028349523, pounds: 0.45359237, 'short tons': 907.18474, 'long tons': 1016.0469088,
        stones: 6.35029318, grains: 6.479891e-5
    },
    'Temperature': {
        _base: null, // special handling
        celsius: 'C', fahrenheit: 'F', kelvin: 'K'
    },
    'Speed': {
        _base: 'm/s',
        'm/s': 1, 'km/h': 0.277778, 'mph': 0.44704, knots: 0.514444,
        'ft/s': 0.3048, 'mach': 343
    },
    'Pressure': {
        _base: 'pascals',
        pascals: 1, kilopascals: 1000, bar: 100000, atm: 101325,
        psi: 6894.757, mmHg: 133.322, 'inHg': 3386.389
    },
    'Time': {
        _base: 'seconds',
        milliseconds: 0.001, seconds: 1, minutes: 60, hours: 3600,
        days: 86400, weeks: 604800, years: 31557600
    },
    'Angle': {
        _base: 'degrees',
        degrees: 1, radians: 57.29577951, gradians: 0.9, arcminutes: 1 / 60,
        arcseconds: 1 / 3600
    },
    'Data / Storage': {
        _base: 'bytes',
        bytes: 1, kilobytes: 1024, megabytes: 1048576, gigabytes: 1073741824,
        terabytes: 1099511627776, bits: 0.125, kibibytes: 1024, mebibytes: 1048576
    },
    'Energy': {
        _base: 'joules',
        joules: 1, kilojoules: 1000, calories: 4.184, kilocalories: 4184,
        'watt-hours': 3600, 'kilowatt-hours': 3600000, btu: 1055.06, 'electron volts': 1.602e-19
    },
    'Flow Rate': {
        _base: 'liters/s',
        'liters/s': 1, 'liters/min': 1 / 60, 'cubic meters/s': 1000,
        'cubic meters/hr': 1000 / 3600, 'gallons/min': 3.785411784 / 60,
        'cubic feet/s': 28.316846592
    }
};

function convertUnit(value, fromUnit, toUnit, category) {
    if (value == null || isNaN(value)) return null;
    const cat = UNIT_CATEGORIES[category];
    if (!cat) return null;

    // Temperature is special
    if (category === 'Temperature') {
        return _convertTemperature(value, fromUnit, toUnit);
    }

    const fromFactor = cat[fromUnit];
    const toFactor = cat[toUnit];
    if (fromFactor == null || toFactor == null) return null;
    // value_in_base = value * fromFactor   →   result = value_in_base / toFactor
    return (value * fromFactor) / toFactor;
}

function _convertTemperature(value, from, to) {
    if (from === to) return value;
    // Convert to Celsius first
    let c;
    if (from === 'celsius') c = value;
    else if (from === 'fahrenheit') c = (value - 32) * 5 / 9;
    else if (from === 'kelvin') c = value - 273.15;
    else return null;
    // Convert from Celsius to target
    if (to === 'celsius') return c;
    if (to === 'fahrenheit') return c * 9 / 5 + 32;
    if (to === 'kelvin') return c + 273.15;
    return null;
}

export class UnitConvertNode extends NodeBase {
    constructor() {
        super('unit-convert', {
            name: 'Unit Converter',
            icon: '📏',
            category: 'transform',
            color: '#2563eb'
        });
        this.inputPorts = [{ id: 'in', label: 'Data', dataType: 'dataset' }];
        this.outputPorts = [{ id: 'out', label: 'Converted', dataType: 'dataset' }];
        this.config = {
            sourceField: '',
            category: 'Length / Distance',
            fromUnit: 'feet',
            toUnit: 'meters',
            outputField: '',
            precision: 4
        };
    }

    _getAvailableFields(context) {
        const upstream = context.getUpstreamOutput?.(this.id);
        if (upstream?.schema?.fields) return upstream.schema.fields.map(f => f.name);
        return [];
    }

    renderInspector(container, context) {
        const fields = this._getAvailableFields(context);
        if (this.config.sourceField && !fields.includes(this.config.sourceField)) fields.push(this.config.sourceField);
        const categories = Object.keys(UNIT_CATEGORIES);
        const currentCat = UNIT_CATEGORIES[this.config.category] || {};
        const units = Object.keys(currentCat).filter(k => k !== '_base');

        container.innerHTML = `
            <label class="wf-inspector-label">Source Field</label>
            <select class="wf-inspector-select" data-cfg="sourceField">
                <option value="">— Select field —</option>
                ${fields.map(f => `<option value="${f}" ${f === this.config.sourceField ? 'selected' : ''}>${f}</option>`).join('')}
            </select>

            <label class="wf-inspector-label" style="margin-top:8px">Unit Category</label>
            <select class="wf-inspector-select" data-cfg="category">
                ${categories.map(c => `<option value="${c}" ${c === this.config.category ? 'selected' : ''}>${c}</option>`).join('')}
            </select>

            <div style="display:flex;gap:8px;margin-top:8px">
                <div style="flex:1">
                    <label class="wf-inspector-label">From</label>
                    <select class="wf-inspector-select" data-cfg="fromUnit">
                        ${units.map(u => `<option value="${u}" ${u === this.config.fromUnit ? 'selected' : ''}>${u}</option>`).join('')}
                    </select>
                </div>
                <div style="display:flex;align-items:flex-end;padding-bottom:4px;font-size:18px;color:var(--text-muted)">→</div>
                <div style="flex:1">
                    <label class="wf-inspector-label">To</label>
                    <select class="wf-inspector-select" data-cfg="toUnit">
                        ${units.map(u => `<option value="${u}" ${u === this.config.toUnit ? 'selected' : ''}>${u}</option>`).join('')}
                    </select>
                </div>
            </div>

            <label class="wf-inspector-label" style="margin-top:8px">Output Field Name</label>
            <input class="wf-inspector-input" data-cfg="outputField" value="${this.config.outputField}"
                   placeholder="Leave blank to overwrite source">

            <label class="wf-inspector-label" style="margin-top:8px">Decimal Precision</label>
            <input class="wf-inspector-input" type="number" data-cfg="precision"
                   value="${this.config.precision}" min="0" max="15" step="1">`;

        // When category changes, reset from/to options and re-render
        const catSelect = container.querySelector('[data-cfg="category"]');
        catSelect.addEventListener('change', () => {
            this.readInspector(container);
            const newCat = UNIT_CATEGORIES[this.config.category] || {};
            const newUnits = Object.keys(newCat).filter(k => k !== '_base');
            this.config.fromUnit = newUnits[0] || '';
            this.config.toUnit = newUnits[1] || newUnits[0] || '';
            this.renderInspector(container, context);
        });
    }

    readInspector(container) {
        this.config.sourceField = container.querySelector('[data-cfg="sourceField"]')?.value || '';
        this.config.category = container.querySelector('[data-cfg="category"]')?.value || 'Length / Distance';
        this.config.fromUnit = container.querySelector('[data-cfg="fromUnit"]')?.value || '';
        this.config.toUnit = container.querySelector('[data-cfg="toUnit"]')?.value || '';
        this.config.outputField = container.querySelector('[data-cfg="outputField"]')?.value?.trim() || '';
        this.config.precision = parseInt(container.querySelector('[data-cfg="precision"]')?.value) || 4;
    }

    validate() {
        if (!this.config.sourceField) return { valid: false, message: 'Select a source field' };
        if (!this.config.fromUnit || !this.config.toUnit) return { valid: false, message: 'Select from and to units' };
        if (this.config.fromUnit === this.config.toUnit) return { valid: false, message: 'From and To units are the same' };
        return { valid: true, message: '' };
    }

    async execute(inputs) {
        const data = inputs[0];
        if (!data) throw new Error('No input data');

        const { sourceField, category, fromUnit, toUnit, outputField, precision } = this.config;
        const outName = outputField || sourceField;
        const p = Math.pow(10, precision);
        const convert = v => {
            const num = parseFloat(v);
            if (isNaN(num)) return null;
            const result = convertUnit(num, fromUnit, toUnit, category);
            return result != null ? Math.round(result * p) / p : null;
        };

        if (data.type === 'spatial') {
            const features = data.geojson.features.map(f => ({
                ...f,
                properties: { ...f.properties, [outName]: convert(f.properties?.[sourceField]) }
            }));
            const schema = this._updateSchema(data.schema, outName, features.map(f => f.properties[outName]));
            return { ...data, geojson: { type: 'FeatureCollection', features }, schema };
        }

        // Table
        const rows = data.rows.map(r => ({ ...r, [outName]: convert(r[sourceField]) }));
        const schema = this._updateSchema(data.schema, outName, rows.map(r => r[outName]));
        return { ...data, rows, schema };
    }

    _updateSchema(origSchema, fieldName, values) {
        const s = JSON.parse(JSON.stringify(origSchema));
        const vals = values.filter(v => v != null);
        const existing = s.fields.find(f => f.name === fieldName);
        if (existing) {
            existing.type = 'number';
        } else {
            s.fields.push({
                name: fieldName,
                type: 'number',
                nullCount: values.length - vals.length,
                uniqueCount: new Set(vals).size,
                sampleValues: vals.slice(0, 5),
                min: vals.length ? Math.min(...vals) : null,
                max: vals.length ? Math.max(...vals) : null,
                selected: true,
                outputName: fieldName,
                order: s.fields.length
            });
        }
        return s;
    }
}

// ==============================
// Add Field — add a new attribute field with a default value
// ==============================
export class AddFieldNode extends NodeBase {
    constructor() {
        super('add-field', {
            name: 'Add Field',
            icon: '➕',
            category: 'transform',
            color: '#2563eb'
        });
        this.inputPorts = [{ id: 'in', label: 'Data', dataType: 'dataset' }];
        this.outputPorts = [{ id: 'out', label: 'With Field', dataType: 'dataset' }];
        this.config = { fieldName: '', fieldType: 'string', defaultValue: '' };
    }

    _getExistingFields(context) {
        const upstream = context.getUpstreamOutput?.(this.id);
        if (upstream?.schema?.fields) return upstream.schema.fields.map(f => f.name);
        return [];
    }

    renderInspector(container, context) {
        const existing = this._getExistingFields(context);
        const existingNote = existing.length
            ? `<p style="color:var(--text-muted);font-size:11px;margin-top:2px">Existing: ${existing.join(', ')}</p>`
            : '';

        const isAttachment = this.config.fieldType === 'attachment';

        container.innerHTML = `
            <label class="wf-inspector-label">Field Name</label>
            <input class="wf-inspector-input" data-cfg="fieldName" value="${this.config.fieldName}" placeholder="new_field">
            ${existingNote}

            <label class="wf-inspector-label" style="margin-top:8px">Field Type</label>
            <select class="wf-inspector-select" data-cfg="fieldType">
                <option value="string" ${this.config.fieldType === 'string' ? 'selected' : ''}>Text (string)</option>
                <option value="number" ${this.config.fieldType === 'number' ? 'selected' : ''}>Number</option>
                <option value="boolean" ${this.config.fieldType === 'boolean' ? 'selected' : ''}>Boolean</option>
                <option value="date" ${this.config.fieldType === 'date' ? 'selected' : ''}>Date</option>
                <option value="attachment" ${this.config.fieldType === 'attachment' ? 'selected' : ''}>Attach Photo (KML/KMZ export only)</option>
            </select>

            <div id="wf-af-default-group" style="margin-top:8px;${isAttachment ? 'display:none' : ''}">
                <label class="wf-inspector-label">Default Value <span style="color:var(--text-muted);font-size:11px">(optional)</span></label>
                <input class="wf-inspector-input" data-cfg="defaultValue" value="${this.config.defaultValue}" placeholder="Leave blank for empty">
            </div>

            <div id="wf-af-error" style="color:var(--error);font-size:11px;min-height:16px;margin-top:4px"></div>`;

        // Toggle default value visibility when type changes
        const typeSelect = container.querySelector('[data-cfg="fieldType"]');
        const defaultGroup = container.querySelector('#wf-af-default-group');
        typeSelect.addEventListener('change', () => {
            const isAtt = typeSelect.value === 'attachment';
            defaultGroup.style.display = isAtt ? 'none' : '';
            if (isAtt) container.querySelector('[data-cfg="defaultValue"]').value = '';
        });
    }

    readInspector(container) {
        this.config.fieldName = container.querySelector('[data-cfg="fieldName"]')?.value?.trim() || '';
        this.config.fieldType = container.querySelector('[data-cfg="fieldType"]')?.value || 'string';
        this.config.defaultValue = container.querySelector('[data-cfg="defaultValue"]')?.value || '';
    }

    validate() {
        if (!this.config.fieldName) return { valid: false, message: 'Field name is required' };
        if (/[.\[\]]/.test(this.config.fieldName)) return { valid: false, message: 'Field name cannot contain . [ or ]' };
        if (this.config.fieldType === 'number' && this.config.defaultValue !== '') {
            if (isNaN(Number(this.config.defaultValue))) return { valid: false, message: 'Default value is not a valid number' };
        }
        return { valid: true, message: '' };
    }

    async execute(inputs, context) {
        const data = inputs[0];
        if (!data) throw new Error('No input data');

        const { fieldName, fieldType, defaultValue: rawDefault } = this.config;

        // Check for duplicate field name
        if (data.schema?.fields?.find(f => f.name === fieldName)) {
            throw new Error(`Field "${fieldName}" already exists`);
        }

        // Coerce default value
        let defaultValue = rawDefault === '' ? null : rawDefault;
        if (fieldType === 'attachment') {
            defaultValue = null;
        } else if (defaultValue !== null) {
            if (fieldType === 'number') {
                defaultValue = Number(rawDefault);
                if (isNaN(defaultValue)) throw new Error('Default value is not a valid number');
            } else if (fieldType === 'boolean') {
                defaultValue = ['true', '1', 'yes'].includes(rawDefault.toLowerCase());
            }
        }

        // Build new schema field
        const maxOrder = (data.schema?.fields || []).reduce((m, f) => Math.max(m, f.order || 0), -1);
        const newSchemaField = {
            name: fieldName,
            type: fieldType,
            nullCount: defaultValue === null ? (data.schema?.featureCount || 0) : 0,
            uniqueCount: defaultValue === null ? 0 : 1,
            sampleValues: defaultValue !== null ? [defaultValue] : [],
            min: fieldType === 'number' && defaultValue !== null ? defaultValue : null,
            max: fieldType === 'number' && defaultValue !== null ? defaultValue : null,
            selected: true,
            outputName: fieldName,
            order: maxOrder + 1
        };

        const schema = JSON.parse(JSON.stringify(data.schema || { fields: [] }));
        schema.fields.push(newSchemaField);

        if (data.type === 'spatial') {
            const features = data.geojson.features.map(f => ({
                ...f,
                properties: { ...(f.properties || {}), [fieldName]: defaultValue }
            }));
            return { ...data, geojson: { type: 'FeatureCollection', features }, schema };
        }

        // Table
        const rows = data.rows.map(r => ({ ...r, [fieldName]: defaultValue }));
        return { ...data, rows, schema };
    }
}
