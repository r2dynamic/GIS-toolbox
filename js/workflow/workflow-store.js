/**
 * Workflow Store — save/load pipeline JSON to sessionStorage
 * Node cached data (e.g. imported file results) stored in IndexedDB
 */
import { resetNodeIdCounter } from './nodes/node-base.js';
import { WorkflowPalette } from './workflow-palette.js';

const STORAGE_KEY = 'gis-toolbox-workflow';
const IDB_NAME = 'gis-toolbox-workflow-cache';
const IDB_STORE = 'node-data';
const IDB_VERSION = 1;

// ── IndexedDB helpers ──

function _openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(IDB_NAME, IDB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(IDB_STORE)) {
                db.createObjectStore(IDB_STORE);
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function _saveNodeData(engine) {
    try {
        const db = await _openDB();
        const tx = db.transaction(IDB_STORE, 'readwrite');
        const store = tx.objectStore(IDB_STORE);
        store.clear();
        for (const node of engine.nodes.values()) {
            if (node._cachedResult) {
                store.put(node._cachedResult, node.id);
            }
        }
        await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
        db.close();
    } catch (e) {
        console.warn('[WorkflowStore] IndexedDB save failed', e);
    }
}

async function _loadNodeData(engine) {
    try {
        const db = await _openDB();
        const tx = db.transaction(IDB_STORE, 'readonly');
        const store = tx.objectStore(IDB_STORE);
        const promises = [];
        for (const node of engine.nodes.values()) {
            if (node.config?.fileName && !node._cachedResult) {
                promises.push(new Promise((res, rej) => {
                    const req = store.get(node.id);
                    req.onsuccess = () => { if (req.result) node._cachedResult = req.result; res(); };
                    req.onerror = () => rej(req.error);
                }));
            }
        }
        await Promise.all(promises);
        db.close();
    } catch (e) {
        console.warn('[WorkflowStore] IndexedDB load failed', e);
    }
}

async function _clearNodeData() {
    try {
        const db = await _openDB();
        const tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).clear();
        await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
        db.close();
    } catch (e) {
        console.warn('[WorkflowStore] IndexedDB clear failed', e);
    }
}

// ── Public API ──

export class WorkflowStore {
    /**
     * Save pipeline structure to sessionStorage + cached data to IndexedDB
     */
    static save(engine) {
        try {
            const data = engine.toJSON();
            sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        } catch (e) {
            console.warn('[WorkflowStore] save failed', e);
        }
        // Fire-and-forget: persist cached node data (imported files, etc.)
        _saveNodeData(engine);
    }

    /**
     * Load pipeline structure from sessionStorage into engine.
     * Returns true if a pipeline was loaded.
     * Call restoreNodeData() afterwards to restore cached data from IndexedDB.
     */
    static load(engine) {
        try {
            const raw = sessionStorage.getItem(STORAGE_KEY);
            if (!raw) return false;
            const data = JSON.parse(raw);
            if (!data?.nodes?.length) return false;

            engine.clear();

            // Find max id to reset counter
            let maxId = 0;
            for (const nd of data.nodes) {
                const num = parseInt(String(nd.id).replace('node-', ''));
                if (!isNaN(num) && num > maxId) maxId = num;
            }
            resetNodeIdCounter(maxId);

            // Recreate nodes from definitions
            for (const nd of data.nodes) {
                const def = WorkflowPalette.findDef(nd.type);
                if (!def) continue;
                const node = def.create();
                // Restore saved state
                node.id = nd.id;
                node.position = nd.position || { x: 0, y: 0 };
                node.config = { ...node.config, ...nd.config };
                if (nd.comment) node.comment = nd.comment;
                engine.addNode(node);
            }

            // Recreate wires
            for (const w of (data.wires || [])) {
                engine.addWire(w);
            }

            return true;
        } catch (e) {
            console.warn('[WorkflowStore] load failed', e);
            return false;
        }
    }

    /**
     * Restore _cachedResult from IndexedDB for nodes that need it
     */
    static async restoreNodeData(engine) {
        await _loadNodeData(engine);
    }

    static clear() {
        sessionStorage.removeItem(STORAGE_KEY);
        _clearNodeData();
    }
}
