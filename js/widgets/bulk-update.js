/**
 * Bulk Update Widget
 * Select multiple features via rectangle, polygon, circle, or click-to-select,
 * then update attribute fields in bulk for all selected features.
 */
import { WidgetBase } from './widget-base.js';
import logger from '../core/logger.js';

export class BulkUpdateWidget extends WidgetBase {
    constructor() {
        super('bulk-update', 'Bulk Update', '✏️', { width: '420px' });

        // state
        this._targetLayerId = null;
        this._selectedIndices = new Set();     // indices of selected features
        this._highlightSrcId = null;           // MapLibre source ID for cyan highlights
        this._highlightLayerIds = null;        // MapLibre layer IDs for cyan highlights
        this._clickHandler = null;             // click handler ref for click-to-select
        this._clickMode = false;               // currently in click-to-select mode?
        this._fieldUpdates = {};               // { fieldName: newValue }
        this._step = 1;                        // 1 = pick layer, 2 = select features, 3 = edit fields

        // injected deps (set from app.js)
        this.getLayers = null;
        this.getLayerById = null;
        this.mapManager = null;
        this.refreshUI = null;
        this.showToast = null;
    }

    /* ======== Lifecycle ======== */

    onOpen() {
        this._reset();
        this._refreshBody();
        this._bindEvents();
    }

    onClose() {
        this._exitClickMode();
        this._clearHighlights();
        this._reset();
    }

    /* ======== Reset ======== */

    _reset() {
        this._targetLayerId = null;
        this._selectedIndices = new Set();
        this._fieldUpdates = {};
        this._step = 1;
        this._clickMode = false;
        this._clearHighlights();
        this._exitClickMode();
    }

    /* ================================================================
       RENDER
       ================================================================ */

    renderBody() {
        const layers = (this.getLayers?.() || []).filter(l => l.type === 'spatial');
        const layerOpts = layers.map(l =>
            `<option value="${l.id}" ${l.id === this._targetLayerId ? 'selected' : ''}>${l.name} (${l.geojson?.features?.length || 0})</option>`
        ).join('');

        if (this._step === 1) return this._renderStep1(layerOpts);
        if (this._step === 2) return this._renderStep2();
        if (this._step === 3) return this._renderStep3();
        return '';
    }

    /* ---------- Step 1: Choose layer ---------- */
    _renderStep1(layerOpts) {
        return `
        <div style="padding:2px 0;">
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:10px;">
                <span style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:var(--primary);color:#000;font-size:11px;font-weight:700;">1</span>
                <span style="font-size:13px;font-weight:600;color:var(--text);">Choose Layer</span>
            </div>
            <div style="margin-bottom:10px;">
                <label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:3px;">Target layer to update</label>
                <select id="bu-layer" style="width:100%;padding:7px 8px;border-radius:var(--radius-sm);border:1px solid var(--border);background:var(--bg-surface);color:var(--text);font-size:13px;">
                    <option value="">— select layer —</option>
                    ${layerOpts}
                </select>
            </div>
            <button id="bu-next-1" class="btn btn-sm btn-primary" style="width:100%;" ${!this._targetLayerId ? 'disabled' : ''}>Next →</button>
        </div>`;
    }

    /* ---------- Step 2: Select features ---------- */
    _renderStep2() {
        const layer = this._getTargetLayer();
        const total = layer?.geojson?.features?.length || 0;
        const count = this._selectedIndices.size;

        return `
        <div style="padding:2px 0;">
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:10px;">
                <span style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:var(--primary);color:#000;font-size:11px;font-weight:700;">2</span>
                <span style="font-size:13px;font-weight:600;color:var(--text);">Select Features</span>
                <span style="margin-left:auto;font-size:11px;color:var(--text-muted);">${layer?.name || ''}</span>
            </div>

            <div style="background:var(--bg-surface);border-radius:var(--radius-sm);padding:10px;margin-bottom:10px;">
                <div style="font-size:11px;color:var(--text-muted);margin-bottom:8px;">Draw a shape or click features on the map. Selections are additive.</div>
                <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;">
                    <button id="bu-draw-rect" class="btn btn-sm btn-secondary" title="Draw rectangle to select">▭ Rectangle</button>
                    <button id="bu-draw-poly" class="btn btn-sm btn-secondary" title="Draw polygon to select">⬠ Polygon</button>
                    <button id="bu-draw-circle" class="btn btn-sm btn-secondary" title="Draw circle to select">◯ Circle</button>
                    <button id="bu-click-select" class="btn btn-sm ${this._clickMode ? 'btn-primary' : 'btn-secondary'}" title="Click features to select/deselect">👆 Click Select</button>
                </div>
                <div style="display:flex;flex-wrap:wrap;gap:6px;">
                    <button id="bu-select-all" class="btn btn-sm btn-secondary" title="Select all features">Select All</button>
                    <button id="bu-invert" class="btn btn-sm btn-secondary" title="Invert selection" ${count === 0 ? 'disabled' : ''}>Invert</button>
                    <button id="bu-clear" class="btn btn-sm btn-secondary" title="Clear selection" ${count === 0 ? 'disabled' : ''}>Clear</button>
                </div>
            </div>

            <div style="padding:8px 10px;border-radius:var(--radius-sm);background:${count > 0 ? 'rgba(48,209,88,0.12)' : 'rgba(255,255,255,0.04)'};color:${count > 0 ? 'var(--success)' : 'var(--text-muted)'};font-size:12px;margin-bottom:10px;">
                ${count > 0 ? `✓ ${count} of ${total} feature${count !== 1 ? 's' : ''} selected` : `No features selected (${total} total)`}
            </div>

            <div style="display:flex;gap:6px;">
                <button id="bu-back-2" class="btn btn-sm btn-secondary" style="flex:1;">← Back</button>
                <button id="bu-next-2" class="btn btn-sm btn-primary" style="flex:2;" ${count === 0 ? 'disabled' : ''}>Edit Fields →</button>
            </div>
        </div>`;
    }

    /* ---------- Step 3: Edit fields ---------- */
    _renderStep3() {
        const layer = this._getTargetLayer();
        const count = this._selectedIndices.size;
        if (!layer || count === 0) return '';

        // Gather unique field names from selected features
        const fields = this._getFieldNames(layer);

        const fieldRows = fields.map(f => {
            const val = this._fieldUpdates[f] ?? '';
            const placeholder = this._getFieldPlaceholder(layer, f);
            return `
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;" data-bu-field="${f}">
                <input type="checkbox" class="bu-field-chk" data-field="${f}" ${val !== '' || this._fieldUpdates.hasOwnProperty(f) ? 'checked' : ''} title="Include this field in update" style="flex-shrink:0;">
                <label style="font-size:11px;color:var(--text-muted);min-width:90px;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${f}">${f}</label>
                <input type="text" class="bu-field-val" data-field="${f}" value="${this._escHtml(val)}" placeholder="${placeholder}"
                    style="flex:1;padding:5px 7px;border-radius:var(--radius-sm);border:1px solid var(--border);background:var(--bg-surface);color:var(--text);font-size:12px;">
            </div>`;
        }).join('');

        return `
        <div style="padding:2px 0;">
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:10px;">
                <span style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:var(--primary);color:#000;font-size:11px;font-weight:700;">3</span>
                <span style="font-size:13px;font-weight:600;color:var(--text);">Update Fields</span>
                <span style="margin-left:auto;font-size:11px;color:var(--text-muted);">${count} feature${count !== 1 ? 's' : ''}</span>
            </div>

            <div style="font-size:11px;color:var(--text-muted);margin-bottom:8px;">Check the fields you want to update, then enter the new value. Unchecked fields are left as-is.</div>

            <div style="max-height:320px;overflow-y:auto;padding-right:4px;margin-bottom:10px;">
                ${fields.length > 0 ? fieldRows : '<div style="color:var(--text-muted);font-size:12px;">No attribute fields found on selected features.</div>'}
            </div>

            <div style="display:flex;gap:6px;align-items:center;margin-bottom:8px;">
                <button id="bu-check-all" class="btn btn-sm btn-secondary" style="font-size:10px;">Check All</button>
                <button id="bu-uncheck-all" class="btn btn-sm btn-secondary" style="font-size:10px;">Uncheck All</button>
                <button id="bu-clear-vals" class="btn btn-sm btn-secondary" style="font-size:10px;">Clear Values</button>
            </div>

            <div style="display:flex;gap:6px;">
                <button id="bu-back-3" class="btn btn-sm btn-secondary" style="flex:1;">← Back</button>
                <button id="bu-apply" class="btn btn-sm btn-primary" style="flex:2;">✓ Apply Update</button>
            </div>
        </div>`;
    }

    /* ================================================================
       EVENTS
       ================================================================ */

    _bindEvents() {
        const body = this.body;
        if (!body) return;

        body.onclick = (e) => {
            const btn = e.target.closest('button');
            if (!btn) return;
            const id = btn.id;

            if (id === 'bu-next-1') this._goToStep2();
            else if (id === 'bu-back-2') { this._exitClickMode(); this._step = 1; this._refreshBody(); this._bindEvents(); }
            else if (id === 'bu-next-2') { this._exitClickMode(); this._step = 3; this._refreshBody(); this._bindEvents(); }
            else if (id === 'bu-back-3') { this._step = 2; this._refreshBody(); this._bindEvents(); }

            else if (id === 'bu-draw-rect')   this._drawRectangle();
            else if (id === 'bu-draw-poly')   this._drawPolygon();
            else if (id === 'bu-draw-circle') this._drawCircle();
            else if (id === 'bu-click-select') this._toggleClickMode();

            else if (id === 'bu-select-all')  this._selectAll();
            else if (id === 'bu-invert')      this._invertSelection();
            else if (id === 'bu-clear')       this._clearSelection();

            else if (id === 'bu-check-all')   this._checkAll(true);
            else if (id === 'bu-uncheck-all') this._checkAll(false);
            else if (id === 'bu-clear-vals')  this._clearFieldValues();

            else if (id === 'bu-apply') this._applyUpdate();
        };

        body.onchange = (e) => {
            if (e.target.id === 'bu-layer') {
                this._targetLayerId = e.target.value || null;
                const nextBtn = body.querySelector('#bu-next-1');
                if (nextBtn) nextBtn.disabled = !this._targetLayerId;
            }

            // Field checkboxes
            if (e.target.classList.contains('bu-field-chk')) {
                const field = e.target.dataset.field;
                if (!e.target.checked) {
                    delete this._fieldUpdates[field];
                } else {
                    const inp = body.querySelector(`.bu-field-val[data-field="${field}"]`);
                    this._fieldUpdates[field] = inp?.value ?? '';
                }
            }
        };

        body.oninput = (e) => {
            if (e.target.classList.contains('bu-field-val')) {
                const field = e.target.dataset.field;
                const chk = body.querySelector(`.bu-field-chk[data-field="${field}"]`);
                if (chk) chk.checked = true;
                this._fieldUpdates[field] = e.target.value;
            }
        };
    }

    _goToStep2() {
        if (!this._targetLayerId) return;
        this._selectedIndices = new Set();
        this._clearHighlights();
        this._step = 2;
        this._refreshBody();
        this._bindEvents();
    }

    /* ================================================================
       SELECTION TOOLS
       ================================================================ */

    /* --- Rectangle --- */
    async _drawRectangle() {
        if (!this.mapManager) return;
        this.showToast?.('Draw a rectangle to select features', 'info');
        const bbox = await this.mapManager.startRectangleDraw('Click and drag to draw selection rectangle');
        if (!bbox) return;

        this._selectFeaturesInBboxArray(bbox);
        this._refreshBody();
        this._bindEvents();
    }

    /* --- Polygon --- */
    async _drawPolygon() {
        if (!this.mapManager) return;
        this.showToast?.('Click to place points, double-click to finish', 'info');

        const map = this.mapManager.map;
        if (!map) return;

        const hadDblClickZoom = map.doubleClickZoom.enabled();
        map.doubleClickZoom.disable();

        return new Promise((resolve) => {
            const points = [];
            let clickTimer = null;
            const container = map.getContainer();
            container.style.cursor = 'crosshair';

            const banner = this.mapManager._showInteractionBanner?.(
                'Click to add points. Double-click to finish selection.',
                () => { cleanup(); resolve(); }
            );

            let previewSrcId = null;
            let previewLayerIds = [];

            const drawPreview = () => {
                // Remove old preview
                for (const lid of previewLayerIds) { if (map.getLayer(lid)) map.removeLayer(lid); }
                if (previewSrcId && map.getSource(previewSrcId)) map.removeSource(previewSrcId);
                previewLayerIds = [];
                previewSrcId = null;

                if (points.length < 2) return;

                previewSrcId = `bu-poly-preview-${Date.now()}`;
                const coords = points.map(p => [p[1], p[0]]); // [lng, lat]
                if (points.length >= 3) {
                    const closed = [...coords, coords[0]];
                    map.addSource(previewSrcId, { type: 'geojson', data: { type: 'Feature', geometry: { type: 'Polygon', coordinates: [closed] } } });
                    const fillId = previewSrcId + '-fill';
                    map.addLayer({ id: fillId, type: 'fill', source: previewSrcId, paint: { 'fill-color': '#d4a24e', 'fill-opacity': 0.08 } });
                    const lineId = previewSrcId + '-line';
                    map.addLayer({ id: lineId, type: 'line', source: previewSrcId, paint: { 'line-color': '#d4a24e', 'line-width': 2, 'line-dasharray': [6, 4] } });
                    previewLayerIds = [fillId, lineId];
                } else {
                    map.addSource(previewSrcId, { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: coords } } });
                    const lineId = previewSrcId + '-line';
                    map.addLayer({ id: lineId, type: 'line', source: previewSrcId, paint: { 'line-color': '#d4a24e', 'line-width': 2, 'line-dasharray': [6, 4] } });
                    previewLayerIds = [lineId];
                }
            };

            const onClick = (e) => {
                if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; return; }
                clickTimer = setTimeout(() => {
                    clickTimer = null;
                    points.push([e.lngLat.lat, e.lngLat.lng]);
                    drawPreview();
                }, 200);
            };

            const onDblClick = (e) => {
                if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
                if (e.originalEvent) { e.originalEvent.stopPropagation(); e.originalEvent.preventDefault(); }
                points.push([e.lngLat.lat, e.lngLat.lng]);
                finish();
            };

            const onKeydown = (e) => { if (e.key === 'Escape') { cleanup(); resolve(); } };

            const finish = () => {
                if (points.length < 3) {
                    this.showToast?.('Need at least 3 points', 'warning');
                    cleanup(); resolve(); return;
                }
                const coords = points.map(p => [p[1], p[0]]);
                coords.push(coords[0]);
                const poly = turf.polygon([coords]);
                this._selectFeaturesInPolygon(poly);
                cleanup();
                this._refreshBody();
                this._bindEvents();
                resolve();
            };

            const cleanup = () => {
                if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
                container.style.cursor = '';
                map.off('click', onClick);
                map.off('dblclick', onDblClick);
                document.removeEventListener('keydown', onKeydown);
                for (const lid of previewLayerIds) { if (map.getLayer(lid)) map.removeLayer(lid); }
                if (previewSrcId && map.getSource(previewSrcId)) map.removeSource(previewSrcId);
                previewLayerIds = []; previewSrcId = null;
                if (banner) banner.remove?.();
                if (hadDblClickZoom) map.doubleClickZoom.enable();
            };

            map.on('click', onClick);
            map.on('dblclick', onDblClick);
            document.addEventListener('keydown', onKeydown);
        });
    }

    /* --- Circle --- */
    async _drawCircle() {
        if (!this.mapManager) return;
        this.showToast?.('Click center, then click to set radius', 'info');

        const map = this.mapManager.map;
        if (!map) return;

        return new Promise((resolve) => {
            let centerLngLat = null;
            let circleSrcId = null;
            let circleLayerIds = [];
            const container = map.getContainer();
            container.style.cursor = 'crosshair';

            const banner = this.mapManager._showInteractionBanner?.(
                'Click to place the center, then click again to set the radius. Esc to cancel.',
                () => { cleanup(); resolve(); }
            );

            const onClick = (e) => {
                if (!centerLngLat) {
                    centerLngLat = e.lngLat;
                    if (banner) {
                        const txt = banner.querySelector?.('span') || banner;
                        if (txt.textContent !== undefined) txt.textContent = 'Move mouse to set radius, click to confirm.';
                    }
                } else {
                    const from = turf.point([centerLngLat.lng, centerLngLat.lat]);
                    const to = turf.point([e.lngLat.lng, e.lngLat.lat]);
                    const radiusM = turf.distance(from, to, { units: 'meters' });
                    finish(centerLngLat, radiusM);
                }
            };

            const onMouseMove = (e) => {
                if (!centerLngLat) return;
                const from = turf.point([centerLngLat.lng, centerLngLat.lat]);
                const to = turf.point([e.lngLat.lng, e.lngLat.lat]);
                const radiusM = turf.distance(from, to, { units: 'meters' });
                updateCirclePreview(radiusM);
            };

            const updateCirclePreview = (radiusM) => {
                let circlePoly;
                try { circlePoly = turf.circle([centerLngLat.lng, centerLngLat.lat], radiusM / 1000, { units: 'kilometers', steps: 64 }); } catch { return; }
                if (circleSrcId && map.getSource(circleSrcId)) {
                    map.getSource(circleSrcId).setData(circlePoly);
                } else {
                    circleSrcId = `bu-circle-preview-${Date.now()}`;
                    map.addSource(circleSrcId, { type: 'geojson', data: circlePoly });
                    const fillId = circleSrcId + '-fill';
                    map.addLayer({ id: fillId, type: 'fill', source: circleSrcId, paint: { 'fill-color': '#d4a24e', 'fill-opacity': 0.12 } });
                    const lineId = circleSrcId + '-line';
                    map.addLayer({ id: lineId, type: 'line', source: circleSrcId, paint: { 'line-color': '#d4a24e', 'line-width': 2, 'line-dasharray': [6, 4] } });
                    circleLayerIds = [fillId, lineId];
                }
            };

            const onKeydown = (e) => { if (e.key === 'Escape') { cleanup(); resolve(); } };

            const finish = (c, radiusM) => {
                if (radiusM < 1) {
                    this.showToast?.('Radius too small', 'warning');
                    cleanup(); resolve(); return;
                }
                let circlePoly;
                try {
                    circlePoly = turf.circle([c.lng, c.lat], radiusM / 1000, { units: 'kilometers', steps: 64 });
                } catch {
                    circlePoly = turf.buffer(turf.point([c.lng, c.lat]), radiusM / 1000, { units: 'kilometers', steps: 64 });
                }
                this._selectFeaturesInPolygon(circlePoly);
                cleanup();
                this._refreshBody();
                this._bindEvents();
                resolve();
            };

            const cleanup = () => {
                container.style.cursor = '';
                map.off('click', onClick);
                map.off('mousemove', onMouseMove);
                document.removeEventListener('keydown', onKeydown);
                for (const lid of circleLayerIds) { if (map.getLayer(lid)) map.removeLayer(lid); }
                if (circleSrcId && map.getSource(circleSrcId)) map.removeSource(circleSrcId);
                circleLayerIds = []; circleSrcId = null;
                if (banner) banner.remove?.();
            };

            map.on('click', onClick);
            map.on('mousemove', onMouseMove);
            document.addEventListener('keydown', onKeydown);
        });
    }

    /* --- Click-to-select mode --- */

    _toggleClickMode() {
        if (this._clickMode) {
            this._exitClickMode();
        } else {
            this._enterClickMode();
        }
        this._refreshBody();
        this._bindEvents();
    }

    _enterClickMode() {
        if (this._clickMode) return;
        const map = this.mapManager?.map;
        if (!map) return;

        this._clickMode = true;
        const container = map.getContainer();
        container.style.cursor = 'pointer';

        this._clickBanner = this.mapManager._showInteractionBanner?.(
            'Click features to select/deselect. Press Esc or click "Click Select" again to stop.',
            () => { this._exitClickMode(); this._refreshBody(); this._bindEvents(); }
        );

        // Attach click handler to the data layer's MapLibre layers
        const layerInfo = this.mapManager.dataLayers.get(this._targetLayerId);
        if (!layerInfo) { this._exitClickMode(); return; }

        this._clickLayerHandlers = [];
        for (const lid of layerInfo.layerIds) {
            const handler = (e) => {
                if (e.originalEvent) e.originalEvent.stopPropagation();
                const props = e.features?.[0]?.properties;
                if (!props || props._featureIndex === undefined) return;
                const idx = props._featureIndex;
                if (this._selectedIndices.has(idx)) {
                    this._selectedIndices.delete(idx);
                } else {
                    this._selectedIndices.add(idx);
                }
                this._renderHighlights();
                this._refreshBody();
                this._bindEvents();
                if (this._clickMode && map.getContainer()) {
                    map.getContainer().style.cursor = 'pointer';
                }
            };
            map.on('click', lid, handler);
            this._clickLayerHandlers.push({ layerId: lid, handler });
        }

        this._clickKeyHandler = (e) => {
            if (e.key === 'Escape') {
                this._exitClickMode();
                this._refreshBody();
                this._bindEvents();
            }
        };
        document.addEventListener('keydown', this._clickKeyHandler);

        this.showToast?.('Click features to select or deselect them', 'info');
    }

    _exitClickMode() {
        if (!this._clickMode) return;
        this._clickMode = false;

        const map = this.mapManager?.map;
        if (map) map.getContainer().style.cursor = '';

        // Remove click handlers from MapLibre layers
        if (this._clickLayerHandlers) {
            const map = this.mapManager?.map;
            for (const { layerId, handler } of this._clickLayerHandlers) {
                if (map) map.off('click', layerId, handler);
            }
            this._clickLayerHandlers = null;
        }

        if (this._clickKeyHandler) {
            document.removeEventListener('keydown', this._clickKeyHandler);
            this._clickKeyHandler = null;
        }

        if (this._clickBanner) {
            this._clickBanner.remove?.();
            this._clickBanner = null;
        }
    }

    /* ================================================================
       SPATIAL SELECTION HELPERS
       ================================================================ */

    /**
     * Select features from the target layer that intersect the given bbox.
     * Additive — merges with existing selection.
     * @param {number[]} bbox - [west, south, east, north]
     */
    _selectFeaturesInBboxArray(bbox) {
        const layer = this._getTargetLayer();
        if (!layer?.geojson?.features) return;

        const [west, south, east, north] = bbox;
        const bboxPoly = turf.bboxPolygon([west, south, east, north]);
        const features = layer.geojson.features;
        for (let i = 0; i < features.length; i++) {
            const f = features[i];
            if (!f?.geometry) continue;
            try {
                if (turf.booleanIntersects(f, bboxPoly)) {
                    this._selectedIndices.add(i);
                }
            } catch {
                try {
                    const c = turf.centroid(f);
                    if (turf.booleanPointInPolygon(c, bboxPoly)) this._selectedIndices.add(i);
                } catch {}
            }
        }
        this._renderHighlights();
        logger.info('BulkUpdate', `Selected ${this._selectedIndices.size} feature(s)`);
    }

    /**
     * Select features from the target layer that intersect a turf polygon/multipolygon.
     * Additive — merges with existing selection.
     */
    _selectFeaturesInPolygon(poly) {
        const layer = this._getTargetLayer();
        if (!layer?.geojson?.features) return;

        const features = layer.geojson.features;
        for (let i = 0; i < features.length; i++) {
            const f = features[i];
            if (!f?.geometry) continue;
            try {
                if (turf.booleanIntersects(f, poly)) {
                    this._selectedIndices.add(i);
                }
            } catch {
                // Skip degenerate geometries
            }
        }
        this._renderHighlights();
        logger.info('BulkUpdate', `Selected ${this._selectedIndices.size} feature(s)`);
    }

    _selectAll() {
        const layer = this._getTargetLayer();
        if (!layer?.geojson?.features) return;
        for (let i = 0; i < layer.geojson.features.length; i++) {
            this._selectedIndices.add(i);
        }
        this._renderHighlights();
        this._refreshBody();
        this._bindEvents();
    }

    _invertSelection() {
        const layer = this._getTargetLayer();
        if (!layer?.geojson?.features) return;
        const inverted = new Set();
        for (let i = 0; i < layer.geojson.features.length; i++) {
            if (!this._selectedIndices.has(i)) inverted.add(i);
        }
        this._selectedIndices = inverted;
        this._renderHighlights();
        this._refreshBody();
        this._bindEvents();
    }

    _clearSelection() {
        this._selectedIndices = new Set();
        this._clearHighlights();
        this._refreshBody();
        this._bindEvents();
    }

    /* ================================================================
       HIGHLIGHT RENDERING
       ================================================================ */

    _renderHighlights() {
        this._clearHighlights();

        const map = this.mapManager?.map;
        if (!map || this._selectedIndices.size === 0) return;

        const layerInfo = this.mapManager.dataLayers.get(this._targetLayerId);
        if (!layerInfo) return;

        const selectedFeatures = layerInfo.geojson.features.filter(f =>
            this._selectedIndices.has(f.properties?._featureIndex)
        );
        if (selectedFeatures.length === 0) return;

        const srcId = `bu-highlight-${this._targetLayerId}`;
        map.addSource(srcId, { type: 'geojson', data: { type: 'FeatureCollection', features: selectedFeatures } });

        const ids = [];
        const fillId = srcId + '-fill';
        map.addLayer({ id: fillId, type: 'fill', source: srcId, filter: ['==', '$type', 'Polygon'], paint: { 'fill-color': '#00e5ff', 'fill-opacity': 0.18 } });
        ids.push(fillId);
        const lineId = srcId + '-line';
        map.addLayer({ id: lineId, type: 'line', source: srcId, paint: { 'line-color': '#00e5ff', 'line-width': 3 } });
        ids.push(lineId);
        const circleId = srcId + '-circle';
        map.addLayer({ id: circleId, type: 'circle', source: srcId, filter: ['==', '$type', 'Point'], paint: { 'circle-radius': 8, 'circle-color': '#00e5ff', 'circle-stroke-color': '#fff', 'circle-stroke-width': 3, 'circle-opacity': 0.8 } });
        ids.push(circleId);

        this._highlightSrcId = srcId;
        this._highlightLayerIds = ids;
    }

    _clearHighlights() {
        const map = this.mapManager?.map;
        if (this._highlightLayerIds) {
            for (const lid of this._highlightLayerIds) { if (map?.getLayer(lid)) map.removeLayer(lid); }
            this._highlightLayerIds = null;
        }
        if (this._highlightSrcId) {
            if (map?.getSource(this._highlightSrcId)) map.removeSource(this._highlightSrcId);
            this._highlightSrcId = null;
        }
    }

    /* ================================================================
       FIELD HELPERS
       ================================================================ */

    /** Get the current target layer object */
    _getTargetLayer() {
        if (!this._targetLayerId) return null;
        return this.getLayerById?.(this._targetLayerId) || null;
    }

    /** Get all unique field names from selected features */
    _getFieldNames(layer) {
        if (!layer?.geojson?.features) return [];
        const fieldSet = new Set();
        for (const idx of this._selectedIndices) {
            const f = layer.geojson.features[idx];
            if (f?.properties) {
                Object.keys(f.properties).forEach(k => fieldSet.add(k));
            }
        }
        return [...fieldSet].sort();
    }

    /** Get a placeholder showing current mix of values for a field */
    _getFieldPlaceholder(layer, fieldName) {
        if (!layer?.geojson?.features) return '';
        const values = new Set();
        for (const idx of this._selectedIndices) {
            const f = layer.geojson.features[idx];
            const v = f?.properties?.[fieldName];
            if (v !== undefined && v !== null && v !== '') values.add(String(v));
            if (values.size > 3) break;
        }
        if (values.size === 0) return '(all empty)';
        if (values.size === 1) return [...values][0];
        return `(${values.size}+ mixed values)`;
    }

    _checkAll(checked) {
        const body = this.body;
        if (!body) return;
        body.querySelectorAll('.bu-field-chk').forEach(chk => {
            chk.checked = checked;
            const field = chk.dataset.field;
            if (checked) {
                const inp = body.querySelector(`.bu-field-val[data-field="${field}"]`);
                this._fieldUpdates[field] = inp?.value ?? '';
            } else {
                delete this._fieldUpdates[field];
            }
        });
    }

    _clearFieldValues() {
        const body = this.body;
        if (!body) return;
        body.querySelectorAll('.bu-field-val').forEach(inp => {
            inp.value = '';
        });
        this._fieldUpdates = {};
        body.querySelectorAll('.bu-field-chk').forEach(chk => chk.checked = false);
    }

    /* ================================================================
       APPLY UPDATE
       ================================================================ */

    _applyUpdate() {
        const layer = this._getTargetLayer();
        if (!layer?.geojson?.features) return;

        // Collect checked fields and their values
        const body = this.body;
        const updates = {};
        if (body) {
            body.querySelectorAll('.bu-field-chk:checked').forEach(chk => {
                const field = chk.dataset.field;
                const inp = body.querySelector(`.bu-field-val[data-field="${field}"]`);
                updates[field] = inp?.value ?? '';
            });
        }

        const fieldCount = Object.keys(updates).length;
        if (fieldCount === 0) {
            this.showToast?.('No fields checked for update', 'warning');
            return;
        }

        // Apply updates to each selected feature
        let updated = 0;
        for (const idx of this._selectedIndices) {
            const f = layer.geojson.features[idx];
            if (!f) continue;
            if (!f.properties) f.properties = {};
            for (const [key, val] of Object.entries(updates)) {
                // Type-smart: try to preserve number types
                if (val === '') {
                    f.properties[key] = '';
                } else if (!isNaN(val) && val.trim() !== '') {
                    f.properties[key] = Number(val);
                } else {
                    f.properties[key] = val;
                }
            }
            updated++;
        }

        this.showToast?.(`Updated ${fieldCount} field${fieldCount !== 1 ? 's' : ''} on ${updated} feature${updated !== 1 ? 's' : ''}`, 'success');
        logger.info('BulkUpdate', `Applied ${fieldCount} field update(s) to ${updated} feature(s)`);

        // Refresh the MapLibre source so popups & interactions reflect updated attributes
        this.mapManager?.refreshLayerData?.(layer);

        // Refresh the main app UI to reflect updated attributes
        this.refreshUI?.();

        // Clear and go back to step 2
        this._fieldUpdates = {};
        this._selectedIndices = new Set();
        this._clearHighlights();
        this._step = 2;
        this._refreshBody();
        this._bindEvents();
    }

    /* ================================================================
       UTILS
       ================================================================ */

    _escHtml(str) {
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
}

export default BulkUpdateWidget;
