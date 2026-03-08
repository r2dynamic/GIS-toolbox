/**
 * Workflow Data Preview — bottom panel virtual-scrolled spreadsheet
 */
export class WorkflowDataPreview {
    constructor(container) {
        this.container = container;
        this._data = null;
        this._maxRows = 500;
        this._sortField = null;
        this._sortDir = 'asc';
        this._visible = false;
        this._render();
    }

    _render() {
        this.container.innerHTML = `
            <div class="wf-preview-bar">
                <span class="wf-preview-title">Data Preview</span>
                <span class="wf-preview-stats" id="wf-preview-stats"></span>
                <button class="wf-btn-icon" id="wf-preview-close" title="Close preview">✕</button>
            </div>
            <div class="wf-preview-table-wrap" id="wf-preview-wrap">
                <table class="wf-preview-table" id="wf-preview-table">
                    <thead id="wf-preview-thead"></thead>
                    <tbody id="wf-preview-tbody"></tbody>
                </table>
            </div>`;

        this.container.querySelector('#wf-preview-close').addEventListener('click', () => this.hide());
    }

    show(data, maxRows = 500) {
        this._data = data;
        this._maxRows = maxRows;
        this._visible = true;
        this.container.classList.add('visible');
        this._rebuild();
    }

    hide() {
        this._visible = false;
        this.container.classList.remove('visible');
    }

    toggle() {
        if (this._visible) this.hide();
        else if (this._data) this.show(this._data, this._maxRows);
    }

    _rebuild() {
        if (!this._data) return;
        const rows = this._getRows();
        const fields = this._data.schema?.fields?.map(f => f.name) || (rows.length > 0 ? Object.keys(rows[0]) : []);

        // Stats
        const stats = this.container.querySelector('#wf-preview-stats');
        const total = this._data.type === 'spatial'
            ? this._data.geojson?.features?.length || 0
            : this._data.rows?.length || 0;
        stats.textContent = `${Math.min(total, this._maxRows)} of ${total} rows • ${fields.length} fields`;

        // Header
        const thead = this.container.querySelector('#wf-preview-thead');
        thead.innerHTML = '<tr>' + fields.map(f => {
            const arrow = this._sortField === f ? (this._sortDir === 'asc' ? ' ↑' : ' ↓') : '';
            return `<th data-field="${f}">${f}${arrow}</th>`;
        }).join('') + '</tr>';

        thead.querySelectorAll('th').forEach(th => {
            th.addEventListener('click', () => {
                const fld = th.getAttribute('data-field');
                if (this._sortField === fld) this._sortDir = this._sortDir === 'asc' ? 'desc' : 'asc';
                else { this._sortField = fld; this._sortDir = 'asc'; }
                this._rebuild();
            });
        });

        // Body (limit to maxRows)
        const display = rows.slice(0, this._maxRows);
        const tbody = this.container.querySelector('#wf-preview-tbody');
        tbody.innerHTML = display.map(row =>
            '<tr>' + fields.map(f => {
                const val = row[f];
                const display = val == null ? '' : String(val);
                const truncated = display.length > 80 ? display.slice(0, 80) + '…' : display;
                return `<td title="${display.replace(/"/g, '&quot;')}">${truncated}</td>`;
            }).join('') + '</tr>'
        ).join('');
    }

    _getRows() {
        if (!this._data) return [];
        let items;
        if (this._data.type === 'spatial') {
            items = (this._data.geojson?.features || []).map(f => ({ ...f.properties }));
        } else {
            items = this._data.rows || [];
        }

        if (this._sortField) {
            items = [...items].sort((a, b) => {
                const va = a[this._sortField], vb = b[this._sortField];
                const na = parseFloat(va), nb = parseFloat(vb);
                if (!isNaN(na) && !isNaN(nb)) return this._sortDir === 'asc' ? na - nb : nb - na;
                return this._sortDir === 'asc'
                    ? String(va ?? '').localeCompare(String(vb ?? ''))
                    : String(vb ?? '').localeCompare(String(va ?? ''));
            });
        }
        return items;
    }

    destroy() {
        this.container.innerHTML = '';
    }
}
