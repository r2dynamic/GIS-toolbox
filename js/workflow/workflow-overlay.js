/**
 * Workflow Overlay — full-screen overlay that contains the visual node editor
 */
import { bus } from '../core/event-bus.js';
import { showToast } from '../ui/toast.js';
import { WorkflowEngine } from './workflow-engine.js';
import { WorkflowCanvas } from './workflow-canvas.js';
import { WorkflowPalette } from './workflow-palette.js';
import { WorkflowInspector } from './workflow-inspector.js';
import { WorkflowDataPreview } from './workflow-data-preview.js';
import { WorkflowStore } from './workflow-store.js';
import { resetNodeIdCounter } from './nodes/node-base.js';

export class WorkflowOverlay {
    constructor({ getLayers, importFile, addToMap, updateMapLayer, removeFromMap }) {
        this._getLayers = getLayers;
        this._importFile = importFile;
        this._addToMap = addToMap;
        this._updateMapLayer = updateMapLayer;
        this._removeFromMap = removeFromMap;

        // Engine persists across open/close so node data (cached imports, etc.) survives
        this.engine = new WorkflowEngine();
        this._engineLoaded = false;   // track whether we've loaded from storage

        this.canvas = null;
        this.palette = null;
        this.inspector = null;
        this.preview = null;

        this._el = null;
        this._open = false;
    }

    toggle() {
        if (this._open) this.close();
        else this.open();
    }

    async open() {
        if (this._open) return;
        this._open = true;
        this._build();
        document.body.appendChild(this._el);
        requestAnimationFrame(() => this._el.classList.add('visible'));

        // Only load from storage on first open (cold start / page refresh)
        if (!this._engineLoaded) {
            WorkflowStore.load(this.engine);
            await WorkflowStore.restoreNodeData(this.engine);
            this._engineLoaded = true;
        }
        this.canvas.renderAll();
        this.canvas.centerView();

        bus.emit('workflow:opened');
    }

    close() {
        if (!this._open) return;
        // Save pipeline to storage (for page refresh / cold restart)
        WorkflowStore.save(this.engine);
        this._teardownUI();
        this._open = false;
        bus.emit('workflow:closed');
    }

    get isOpen() { return this._open; }

    // ── Build DOM ──

    _build() {
        this._el = document.createElement('div');
        this._el.id = 'wf-overlay';
        this._el.className = 'wf-overlay';

        // Top bar
        const topBar = document.createElement('div');
        topBar.className = 'wf-topbar';
        topBar.innerHTML = `
            <button class="wf-topbar-btn" id="wf-back" title="Back to map">← Back to Map</button>
            <span class="wf-topbar-title">Data Pipeline Editor</span>
            <div class="wf-topbar-actions">
                <div class="wf-examples-wrapper" id="wf-examples-wrapper">
                    <button class="wf-topbar-btn wf-topbar-io" id="wf-examples-btn" title="Load a preconfigured example">📋 Examples ▾</button>
                    <div class="wf-examples-dropdown" id="wf-examples-dropdown">
                        <div class="wf-examples-title">Preconfigured Examples</div>
                        <div class="wf-examples-list" id="wf-examples-list">Loading…</div>
                    </div>
                </div>
                <button class="wf-topbar-btn wf-topbar-io" id="wf-import-config" title="Import workflow config">📂 Import</button>
                <button class="wf-topbar-btn wf-topbar-io" id="wf-export-config" title="Export workflow config">💾 Export</button>
                <button class="wf-topbar-btn" id="wf-clear" title="Clear pipeline">🗑️ Clear</button>
                <button class="wf-topbar-btn wf-topbar-run" id="wf-run" title="Run pipeline">▶ Run Pipeline</button>
            </div>`;
        this._el.appendChild(topBar);

        // Body (palette | canvas | inspector)
        const body = document.createElement('div');
        body.className = 'wf-body';

        const paletteEl = document.createElement('div');
        paletteEl.className = 'wf-palette';

        const canvasEl = document.createElement('div');
        canvasEl.className = 'wf-canvas-area';

        const inspectorEl = document.createElement('div');
        inspectorEl.className = 'wf-inspector';

        body.appendChild(paletteEl);
        body.appendChild(canvasEl);
        body.appendChild(inspectorEl);
        this._el.appendChild(body);

        // Preview panel
        const previewEl = document.createElement('div');
        previewEl.className = 'wf-preview';
        this._el.appendChild(previewEl);

        // ── Instantiate UI modules (engine already exists) ──
        this.canvas = new WorkflowCanvas(canvasEl, this.engine);
        this.palette = new WorkflowPalette(paletteEl);
        this.inspector = new WorkflowInspector(inspectorEl, this.engine);
        this.preview = new WorkflowDataPreview(previewEl);

        // Wire inspector providers
        this.inspector.setLayersProvider(() => this._getLayers());
        this.inspector.setImportProvider((file) => this._importFile(file));

        // ── Event wiring ──

        topBar.querySelector('#wf-back').addEventListener('click', () => this.close());

        topBar.querySelector('#wf-clear').addEventListener('click', () => {
            this.engine.clear();
            this.canvas.renderAll();
            this.inspector.clear();
            this.preview.hide();
            WorkflowStore.clear();
            this._engineLoaded = false;
        });

        topBar.querySelector('#wf-run').addEventListener('click', () => this._runPipeline());

        topBar.querySelector('#wf-export-config').addEventListener('click', () => this._exportConfig());
        topBar.querySelector('#wf-import-config').addEventListener('click', () => this._importConfig());

        // Preconfigured examples dropdown
        this._initExamplesDropdown(topBar);

        // Block global file-drop overlay from intercepting drag events on the workflow
        this._el.addEventListener('dragover', e => { e.preventDefault(); e.stopPropagation(); });
        this._el.addEventListener('dragenter', e => { e.preventDefault(); e.stopPropagation(); });
        this._el.addEventListener('dragleave', e => { e.preventDefault(); e.stopPropagation(); });
        this._el.addEventListener('drop', e => { e.preventDefault(); e.stopPropagation(); });

        // Palette drop onto canvas
        canvasEl.addEventListener('dragover', e => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy'; });
        canvasEl.addEventListener('drop', e => {
            e.preventDefault();
            e.stopPropagation();
            const json = e.dataTransfer.getData('application/x-wf-node');
            if (!json) return;
            const { type } = JSON.parse(json);
            const def = WorkflowPalette.findDef(type);
            if (!def) return;
            const node = def.create();
            this.canvas.addNodeAt(node, e.clientX, e.clientY);
        });

        // Palette click-to-add (adds at center of canvas viewport)
        this._unsubs = [];
        this._unsubs.push(bus.on('workflow:palette-add', ({ type }) => {
            if (!this._open) return;
            const def = WorkflowPalette.findDef(type);
            if (!def) return;
            const node = def.create();
            const rect = canvasEl.getBoundingClientRect();
            const cx = rect.left + rect.width / 2;
            const cy = rect.top + rect.height / 2;
            this.canvas.addNodeAt(node, cx, cy);
        }));

        // Delete node from inspector
        this._unsubs.push(bus.on('workflow:delete-node', ({ nodeId }) => {
            if (!this._open) return;
            this.engine.removeNode(nodeId);
            this.canvas.renderAll();
            this.inspector.clear();
        }));

        // Persist to IndexedDB whenever node data changes (e.g. file imported)
        // Also auto-add imported spatial data to map
        this._unsubs.push(bus.on('workflow:node-data-ready', ({ nodeId }) => {
            WorkflowStore.save(this.engine);
            const node = this.engine.nodes.get(nodeId);
            if (node?.type === 'file-import' && node._cachedResult?.type === 'spatial') {
                this._addToMap(node._cachedResult, node._cachedResult.name || node.config.fileName, { workflow: true });
            }
        }));

        // Keyboard
        this._keyHandler = (e) => {
            if (!this._open) return;
            if (e.key === 'Escape') this.close();
            if ((e.key === 'Delete' || e.key === 'Backspace') && this.canvas.selectedNodeId) {
                // Only delete if not focused on an input
                if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'SELECT') return;
                this.canvas.removeSelected();
            }
        };
        document.addEventListener('keydown', this._keyHandler);
    }

    _teardownUI() {
        document.removeEventListener('keydown', this._keyHandler);
        if (this._cleanupExamplesDropdown) {
            this._cleanupExamplesDropdown();
            this._cleanupExamplesDropdown = null;
        }
        // Unsubscribe bus listeners to prevent accumulation
        if (this._unsubs) {
            this._unsubs.forEach(unsub => unsub());
            this._unsubs = null;
        }
        this.canvas?.destroy();
        this.palette?.destroy();
        this.inspector?.destroy();
        this.preview?.destroy();
        this._el?.remove();
        // Engine is NOT destroyed — it persists with all node data
        this.canvas = null;
        this.palette = null;
        this.inspector = null;
        this.preview = null;
        this._el = null;
    }

    // ── Preconfigured examples ──

    _initExamplesDropdown(topBar) {
        const wrapper = topBar.querySelector('#wf-examples-wrapper');
        const btn = topBar.querySelector('#wf-examples-btn');
        const dropdown = topBar.querySelector('#wf-examples-dropdown');
        const list = topBar.querySelector('#wf-examples-list');

        // Toggle dropdown
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            dropdown.classList.toggle('open');
        });

        // Close on outside click
        const closeDropdown = (e) => {
            if (!wrapper.contains(e.target)) dropdown.classList.remove('open');
        };
        document.addEventListener('click', closeDropdown);
        this._cleanupExamplesDropdown = () => document.removeEventListener('click', closeDropdown);

        // Fetch the list of available pipelines
        fetch('./pipelines/index.json')
            .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
            .then(files => {
                if (!files.length) { list.textContent = 'No examples available.'; return; }
                list.innerHTML = '';
                for (const file of files) {
                    const item = document.createElement('button');
                    item.className = 'wf-examples-item';
                    item.textContent = file.replace(/\.json$/i, '');
                    item.addEventListener('click', () => {
                        dropdown.classList.remove('open');
                        this._loadExample(file);
                    });
                    list.appendChild(item);
                }
            })
            .catch(() => { list.textContent = 'Failed to load examples.'; });
    }

    async _loadExample(fileName) {
        try {
            const resp = await fetch(`./pipelines/${encodeURIComponent(fileName)}`);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const config = await resp.json();
            this._applyConfig(config);

            // Hydrate sample data into FileImport nodes
            if (config.sampleData) {
                for (const [nodeId, dataset] of Object.entries(config.sampleData)) {
                    const node = this.engine.nodes.get(nodeId);
                    if (node && node.type === 'file-import') {
                        node._cachedResult = dataset;
                        node._pendingFile = null;
                    }
                }
                // Save hydrated data to IndexedDB so it persists
                WorkflowStore.save(this.engine);
                this.canvas.renderAll();
            }

            showToast(`Loaded example: ${fileName.replace(/\.json$/i, '')}`, 'success');
        } catch (e) {
            showToast('Failed to load example pipeline.', 'error');
        }
    }

    // ── Config export / import ──

    _exportConfig() {
        this.inspector.saveBeforeRun();
        const pipeline = this.engine.toJSON();
        if (!pipeline.nodes.length) {
            showToast('Nothing to export — add some nodes first.', 'warn');
            return;
        }
        const config = {
            _format: 'gis-toolbox-workflow',
            version: 1,
            exportedAt: new Date().toISOString(),
            pipeline
        };
        const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `workflow-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
        showToast('Workflow config exported.', 'success');
    }

    _importConfig() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.addEventListener('change', () => {
            const file = input.files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => {
                try {
                    const config = JSON.parse(reader.result);
                    this._applyConfig(config);
                } catch (e) {
                    showToast('Invalid workflow config file.', 'error');
                }
            };
            reader.readAsText(file);
        });
        input.click();
    }

    _applyConfig(config) {
        // Validate structure
        const pipeline = config?.pipeline ?? config;
        if (!Array.isArray(pipeline?.nodes) || !pipeline.nodes.length) {
            showToast('Config file contains no workflow nodes.', 'error');
            return;
        }
        if (config._format && config._format !== 'gis-toolbox-workflow') {
            showToast('Unrecognised config format.', 'error');
            return;
        }

        // Clear current pipeline
        this.engine.clear();
        this.inspector.clear();
        this.preview.hide();
        WorkflowStore.clear();

        // Find max node id to reset counter
        let maxId = 0;
        for (const nd of pipeline.nodes) {
            const num = parseInt(String(nd.id).replace('node-', ''));
            if (!isNaN(num) && num > maxId) maxId = num;
        }
        resetNodeIdCounter(maxId);

        // Recreate nodes
        for (const nd of pipeline.nodes) {
            const def = WorkflowPalette.findDef(nd.type);
            if (!def) {
                showToast(`Unknown node type "${nd.type}" — skipped.`, 'warn');
                continue;
            }
            const node = def.create();
            node.id = nd.id;
            node.position = nd.position || { x: 0, y: 0 };
            node.config = { ...node.config, ...nd.config };
            if (nd.comment) node.comment = nd.comment;
            this.engine.addNode(node);
        }

        // Recreate wires
        for (const w of (pipeline.wires || [])) {
            this.engine.addWire(w);
        }

        // Refresh UI
        this.canvas.renderAll();
        this.canvas.centerView();
        this._engineLoaded = true;
        WorkflowStore.save(this.engine);
        showToast(`Imported ${this.engine.nodes.size} nodes.`, 'success');
    }

    // ── Pipeline execution ──

    async _runPipeline() {
        if (this.engine.isRunning) return;
        this.inspector.saveBeforeRun();

        const runBtn = this._el.querySelector('#wf-run');
        runBtn.disabled = true;
        runBtn.textContent = '⏳ Running…';

        try {
            const context = {
                getLayers: () => this._getLayers(),
                importFile: (file) => this._importFile(file),
                showPreview: (data, maxRows) => this.preview.show(data, maxRows),
                addToMap: (data, name, opts) => {
                    this._addToMap(data, name, opts);
                },
                updateMapLayer: (layerId, data) => {
                    this._updateMapLayer(layerId, data);
                },
                removeFromMap: (layerId) => {
                    this._removeFromMap(layerId);
                },
                getUpstreamOutput: (id) => this.engine.getUpstreamOutput(id)
            };

            await this.engine.run(context);
            this.canvas.refreshNodeBadges();
        } catch (err) {
            this.canvas.refreshNodeBadges();
            showToast(`Pipeline error: ${err.message}`, 'error');
        } finally {
            runBtn.disabled = false;
            runBtn.textContent = '▶ Run Pipeline';
        }
    }
}
