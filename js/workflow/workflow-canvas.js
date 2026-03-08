/**
 * Workflow Canvas — SVG-based node graph: pan, zoom, node boxes, port circles, Bézier wires
 */
import { bus } from '../core/event-bus.js';

const PORT_RADIUS = 6;
const PORT_HIT_RADIUS = 18;
const NODE_W = 180;
const NODE_H = 56;
const PORT_GAP = 20;
const GRID_SIZE = 20;

export class WorkflowCanvas {
    constructor(container, engine) {
        this.container = container;
        this.engine = engine;
        this.svg = null;
        this.gWorld = null;       // group transformed by pan/zoom
        this.gWires = null;
        this.gNodes = null;
        this.gDragWire = null;

        this._pan = { x: 0, y: 0 };
        this._zoom = 1;
        this._dragging = null;        // { nodeId, offsetX, offsetY }
        this._connecting = null;      // { nodeId, portId, direction, startX, startY }
        this._panning = false;
        this._panStart = null;
        this._selected = null;        // nodeId

        this._init();
    }

    // ── Build SVG skeleton ──

    _init() {
        this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        this.svg.classList.add('wf-canvas-svg');
        this.svg.setAttribute('width', '100%');
        this.svg.setAttribute('height', '100%');

        // Defs for arrow head
        const defs = this._svgEl('defs');
        defs.innerHTML = `<marker id="wf-arrow" markerWidth="8" markerHeight="8" refX="8" refY="4" orient="auto">
            <path d="M0,0 L8,4 L0,8" fill="none" stroke="var(--wf-wire)" stroke-width="1.2"/>
        </marker>`;
        this.svg.appendChild(defs);

        this.gWorld = this._svgEl('g', { class: 'wf-world' });
        this.gWires = this._svgEl('g', { class: 'wf-wires' });
        this.gNodes = this._svgEl('g', { class: 'wf-nodes' });
        this.gDragWire = this._svgEl('g', { class: 'wf-drag-wire' });

        this.gWorld.appendChild(this.gWires);
        this.gWorld.appendChild(this.gNodes);
        this.gWorld.appendChild(this.gDragWire);
        this.svg.appendChild(this.gWorld);
        this.container.appendChild(this.svg);

        this._bindEvents();
        this._applyTransform();
    }

    // ── Events ──

    _bindEvents() {
        // Panning
        this.svg.addEventListener('pointerdown', e => {
            if (e.button !== 0) return;
            // If clicking on blank space, start pan
            if (e.target === this.svg || e.target.closest('.wf-world') === this.gWorld && !e.target.closest('.wf-node-group')) {
                this._panning = true;
                this._panStart = { x: e.clientX, y: e.clientY, px: this._pan.x, py: this._pan.y };
                this.svg.setPointerCapture(e.pointerId);
                this.svg.style.cursor = 'grabbing';
                this._deselect();
            }
        });

        this.svg.addEventListener('pointermove', e => {
            if (this._panning && this._panStart) {
                this._pan.x = this._panStart.px + (e.clientX - this._panStart.x);
                this._pan.y = this._panStart.py + (e.clientY - this._panStart.y);
                this._applyTransform();
                return;
            }
            if (this._dragging) {
                const pt = this._clientToWorld(e.clientX, e.clientY);
                const node = this.engine.nodes.get(this._dragging.nodeId);
                if (node) {
                    node.position.x = Math.round((pt.x - this._dragging.offsetX) / GRID_SIZE) * GRID_SIZE;
                    node.position.y = Math.round((pt.y - this._dragging.offsetY) / GRID_SIZE) * GRID_SIZE;
                    this._updateNodePosition(node);
                    this._redrawWires();
                }
                return;
            }
            if (this._connecting) {
                const pt = this._clientToWorld(e.clientX, e.clientY);
                this._drawTempWire(this._connecting.startX, this._connecting.startY, pt.x, pt.y);
            }
        });

        this.svg.addEventListener('pointerup', e => {
            if (this._panning) {
                this._panning = false;
                this._panStart = null;
                this.svg.style.cursor = '';
                return;
            }
            if (this._dragging) {
                this._dragging = null;
                return;
            }
            if (this._connecting) {
                // Find nearest compatible port within snap distance, or fall back to any port on hovered node
                const match = this._findDropTarget(e.clientX, e.clientY);
                if (match) {
                    this._finishConnect(match);
                }
                this._connecting = null;
                this.gDragWire.innerHTML = '';
            }
        });

        // Zoom
        this.svg.addEventListener('wheel', e => {
            e.preventDefault();
            const delta = e.deltaY > 0 ? 0.9 : 1.1;
            const newZoom = Math.min(3, Math.max(0.2, this._zoom * delta));

            // Zoom toward cursor
            const rect = this.svg.getBoundingClientRect();
            const cx = e.clientX - rect.left;
            const cy = e.clientY - rect.top;
            this._pan.x = cx - (cx - this._pan.x) * (newZoom / this._zoom);
            this._pan.y = cy - (cy - this._pan.y) * (newZoom / this._zoom);
            this._zoom = newZoom;
            this._applyTransform();
        }, { passive: false });
    }

    // ── Co-ordinate helpers ──

    _clientToWorld(cx, cy) {
        const rect = this.svg.getBoundingClientRect();
        return {
            x: (cx - rect.left - this._pan.x) / this._zoom,
            y: (cy - rect.top - this._pan.y) / this._zoom
        };
    }

    _applyTransform() {
        this.gWorld.setAttribute('transform', `translate(${this._pan.x},${this._pan.y}) scale(${this._zoom})`);
    }

    // ── Node rendering ──

    renderAll() {
        this.gNodes.innerHTML = '';
        this.gWires.innerHTML = '';
        for (const node of this.engine.nodes.values()) {
            this._renderNode(node);
        }
        this._redrawWires();
    }

    _renderNode(node) {
        const g = this._svgEl('g', {
            class: 'wf-node-group',
            'data-node-id': node.id,
            transform: `translate(${node.position.x}, ${node.position.y})`
        });

        const totalInputH = node.inputPorts.length * PORT_GAP;
        const totalOutputH = node.outputPorts.length * PORT_GAP;
        const h = Math.max(NODE_H, totalInputH + 20, totalOutputH + 20);

        // Background rect
        const rect = this._svgEl('rect', {
            class: 'wf-node-rect',
            width: NODE_W,
            height: h,
            rx: 8,
            ry: 8,
            fill: 'var(--wf-node-bg)',
            stroke: node.color || '#555',
            'stroke-width': 2
        });
        g.appendChild(rect);

        // Color header strip
        const strip = this._svgEl('rect', {
            x: 0, y: 0, width: NODE_W, height: 22, rx: 8, ry: 8,
            fill: node.color || '#555', opacity: 0.85
        });
        g.appendChild(strip);
        // Fix bottom corners of strip
        const stripFix = this._svgEl('rect', {
            x: 0, y: 12, width: NODE_W, height: 10,
            fill: node.color || '#555', opacity: 0.85
        });
        g.appendChild(stripFix);

        // Icon + name
        const label = this._svgEl('text', {
            x: 10, y: 16, class: 'wf-node-label', fill: '#fff', 'font-size': '12'
        });
        label.textContent = `${node.icon} ${node.name}`;
        g.appendChild(label);

        // Status badge (feature count or error)
        const badge = this._svgEl('text', {
            x: NODE_W - 8, y: h - 6, class: 'wf-node-badge',
            'text-anchor': 'end', fill: 'var(--text-muted)', 'font-size': '10'
        });
        if (node._error) {
            badge.textContent = '⚠ Error';
            badge.setAttribute('fill', '#ef4444');
        } else if (node._outputData || node._outputPorts) {
            badge.textContent = node.getOutputStats();
        }
        g.appendChild(badge);

        // Running spinner indicator
        if (node._running) {
            const spin = this._svgEl('circle', {
                cx: NODE_W - 12, cy: 11, r: 5, fill: 'none',
                stroke: '#fff', 'stroke-width': 2, 'stroke-dasharray': '8 6',
                class: 'wf-spinner'
            });
            g.appendChild(spin);
        }

        // Input ports
        node.inputPorts.forEach((port, i) => {
            const py = 30 + i * PORT_GAP;
            // Invisible hit area (larger)
            const hitCircle = this._svgEl('circle', {
                cx: 0, cy: py, r: PORT_HIT_RADIUS,
                fill: 'transparent', stroke: 'none', cursor: 'crosshair',
                'data-node-id': node.id, 'data-port-id': port.id, 'data-dir': 'input'
            });
            g.appendChild(hitCircle);
            const circle = this._svgEl('circle', {
                cx: 0, cy: py, r: PORT_RADIUS,
                class: 'wf-port wf-port-input',
                'data-node-id': node.id, 'data-port-id': port.id, 'data-dir': 'input'
            });
            g.appendChild(circle);
            const plabel = this._svgEl('text', {
                x: 10, y: py + 4, fill: 'var(--text-muted)', 'font-size': '10',
                'pointer-events': 'none'
            });
            plabel.textContent = port.label;
            g.appendChild(plabel);
        });

        // Output ports
        node.outputPorts.forEach((port, i) => {
            const py = 30 + i * PORT_GAP;
            // Invisible hit area (larger)
            const hitCircle = this._svgEl('circle', {
                cx: NODE_W, cy: py, r: PORT_HIT_RADIUS,
                fill: 'transparent', stroke: 'none', cursor: 'crosshair',
                'data-node-id': node.id, 'data-port-id': port.id, 'data-dir': 'output'
            });
            g.appendChild(hitCircle);
            const circle = this._svgEl('circle', {
                cx: NODE_W, cy: py, r: PORT_RADIUS,
                class: 'wf-port wf-port-output',
                'data-node-id': node.id, 'data-port-id': port.id, 'data-dir': 'output'
            });
            g.appendChild(circle);
            const plabel = this._svgEl('text', {
                x: NODE_W - 10, y: py + 4, fill: 'var(--text-muted)',
                'font-size': '10', 'text-anchor': 'end', 'pointer-events': 'none'
            });
            plabel.textContent = port.label;
            g.appendChild(plabel);
        });

        // ── Node interactions ──

        // Drag node (header area)
        g.addEventListener('pointerdown', e => {
            const portEl = e.target.closest('[data-port-id]');
            if (portEl) {
                // Start wire drawing
                e.stopPropagation();
                const nodeId = portEl.getAttribute('data-node-id');
                const portId = portEl.getAttribute('data-port-id');
                const dir = portEl.getAttribute('data-dir');
                const portPos = this._getPortWorldPos(nodeId, portId, dir);
                this._connecting = { nodeId, portId, direction: dir, startX: portPos.x, startY: portPos.y };
                return;
            }

            // Drag
            e.stopPropagation();
            const pt = this._clientToWorld(e.clientX, e.clientY);
            this._dragging = {
                nodeId: node.id,
                offsetX: pt.x - node.position.x,
                offsetY: pt.y - node.position.y
            };
            this._selectNode(node.id);
        });

        // Double-click = select for inspector
        g.addEventListener('dblclick', e => {
            e.stopPropagation();
            this._selectNode(node.id);
            bus.emit('workflow:node-inspect', { nodeId: node.id });
        });

        this.gNodes.appendChild(g);
    }

    _updateNodePosition(node) {
        const g = this.gNodes.querySelector(`[data-node-id="${node.id}"]`);
        if (g) g.setAttribute('transform', `translate(${node.position.x}, ${node.position.y})`);
    }

    // ── Selection ──

    _selectNode(id) {
        if (this._selected === id) return;  // Already selected — keep inspector intact
        this._deselect();
        this._selected = id;
        const g = this.gNodes.querySelector(`[data-node-id="${id}"]`);
        if (g) g.classList.add('wf-selected');
        bus.emit('workflow:node-selected', { nodeId: id });
    }

    _deselect() {
        if (this._selected) {
            const prev = this.gNodes.querySelector('.wf-selected');
            if (prev) prev.classList.remove('wf-selected');
            this._selected = null;
            bus.emit('workflow:node-deselected');
        }
    }

    get selectedNodeId() { return this._selected; }

    // ── Wires ──

    _redrawWires() {
        this.gWires.innerHTML = '';
        for (const w of this.engine.wires) {
            const from = this._getPortWorldPos(w.from, w.fromPort, 'output');
            const to = this._getPortWorldPos(w.to, w.toPort, 'input');
            if (!from || !to) continue;
            this._drawWire(from.x, from.y, to.x, to.y, w);
        }
    }

    _drawWire(x1, y1, x2, y2, wire) {
        const dx = Math.abs(x2 - x1) * 0.5;
        const d = `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
        const path = this._svgEl('path', {
            d, class: 'wf-wire-path', fill: 'none',
            stroke: 'var(--wf-wire)', 'stroke-width': 2,
            'marker-end': 'url(#wf-arrow)'
        });
        if (wire) {
            path.setAttribute('data-wire-from', wire.from);
            path.setAttribute('data-wire-to', wire.to);
            path.addEventListener('dblclick', e => {
                e.stopPropagation();
                this.engine.removeWire(wire);
                this._redrawWires();
                bus.emit('workflow:wire-removed', wire);
            });
        }
        this.gWires.appendChild(path);
    }

    _drawTempWire(x1, y1, x2, y2) {
        this.gDragWire.innerHTML = '';
        const dx = Math.abs(x2 - x1) * 0.5;
        const d = `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
        const path = this._svgEl('path', {
            d, fill: 'none', stroke: 'var(--wf-wire-drag)', 'stroke-width': 2,
            'stroke-dasharray': '6 4', opacity: 0.7
        });
        this.gDragWire.appendChild(path);
    }

    _finishConnect(portInfo) {
        const { nodeId, portId, direction: dir } = portInfo;
        const src = this._connecting;
        if (!src || nodeId === src.nodeId) return;

        let wire;
        if (src.direction === 'output' && dir === 'input') {
            wire = { from: src.nodeId, fromPort: src.portId, to: nodeId, toPort: portId };
        } else if (src.direction === 'input' && dir === 'output') {
            wire = { from: nodeId, fromPort: portId, to: src.nodeId, toPort: src.portId };
        }
        if (!wire) return;

        // Remove any existing wire into the target input port (single connection per input)
        this.engine.removeWiresForPort(wire.to, wire.toPort, 'input');

        if (this.engine.addWire(wire)) {
            this._redrawWires();
            bus.emit('workflow:wire-added', wire);
        }
    }

    /** Find the best port to connect to near the given client coords */
    _findDropTarget(clientX, clientY) {
        const pt = this._clientToWorld(clientX, clientY);
        const src = this._connecting;
        const wantDir = src.direction === 'output' ? 'input' : 'output';

        let bestDist = Infinity;
        let bestMatch = null;

        for (const node of this.engine.nodes.values()) {
            if (node.id === src.nodeId) continue;
            const ports = wantDir === 'input' ? node.inputPorts : node.outputPorts;
            for (const port of ports) {
                const portPos = this._getPortWorldPos(node.id, port.id, wantDir);
                if (!portPos) continue;
                const dx = pt.x - portPos.x;
                const dy = pt.y - portPos.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < bestDist) {
                    bestDist = dist;
                    bestMatch = { nodeId: node.id, portId: port.id, direction: wantDir };
                }
            }
        }

        // Snap threshold: either close to a port, or at least dropped over the node body
        if (bestDist <= 40) return bestMatch;

        // Fallback: check if cursor is over a node rect — auto-pick first compatible port
        for (const node of this.engine.nodes.values()) {
            if (node.id === src.nodeId) continue;
            const h = Math.max(NODE_H, Math.max(node.inputPorts.length, node.outputPorts.length) * PORT_GAP + 20);
            if (pt.x >= node.position.x && pt.x <= node.position.x + NODE_W &&
                pt.y >= node.position.y && pt.y <= node.position.y + h) {
                const ports = wantDir === 'input' ? node.inputPorts : node.outputPorts;
                if (ports.length > 0) {
                    return { nodeId: node.id, portId: ports[0].id, direction: wantDir };
                }
            }
        }

        return null;
    }

    _getPortWorldPos(nodeId, portId, direction) {
        const node = this.engine.nodes.get(nodeId);
        if (!node) return null;
        const ports = direction === 'input' ? node.inputPorts : node.outputPorts;
        const idx = ports.findIndex(p => p.id === portId);
        if (idx < 0) return null;
        const py = 30 + idx * PORT_GAP;
        return {
            x: node.position.x + (direction === 'output' ? NODE_W : 0),
            y: node.position.y + py
        };
    }

    // ── Public helpers ──

    addNodeAt(node, clientX, clientY) {
        const pt = this._clientToWorld(clientX, clientY);
        let x = Math.round(pt.x / GRID_SIZE) * GRID_SIZE;
        let y = Math.round(pt.y / GRID_SIZE) * GRID_SIZE;

        // Nudge position so nodes don't stack on top of each other
        const NUDGE = GRID_SIZE * 2; // 40px offset
        let attempts = 0;
        while (attempts < 20) {
            let collision = false;
            for (const existing of this.engine.nodes.values()) {
                if (Math.abs(existing.position.x - x) < NODE_W * 0.5 &&
                    Math.abs(existing.position.y - y) < NODE_H * 0.5) {
                    collision = true;
                    break;
                }
            }
            if (!collision) break;
            x += NUDGE;
            y += NUDGE;
            attempts++;
        }

        node.position.x = x;
        node.position.y = y;
        this.engine.addNode(node);
        this._renderNode(node);
        this._selectNode(node.id);
    }

    removeSelected() {
        if (!this._selected) return;
        this.engine.removeNode(this._selected);
        this._selected = null;
        this.renderAll();
        bus.emit('workflow:node-deselected');
    }

    centerView() {
        const nodes = [...this.engine.nodes.values()];
        if (nodes.length === 0) {
            this._pan = { x: 100, y: 100 };
            this._zoom = 1;
            this._applyTransform();
            return;
        }
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const n of nodes) {
            minX = Math.min(minX, n.position.x);
            minY = Math.min(minY, n.position.y);
            maxX = Math.max(maxX, n.position.x + NODE_W);
            maxY = Math.max(maxY, n.position.y + NODE_H);
        }
        const rect = this.svg.getBoundingClientRect();
        const cw = rect.width, ch = rect.height;
        const gw = maxX - minX + 100, gh = maxY - minY + 100;
        this._zoom = Math.min(1.5, Math.min(cw / gw, ch / gh));
        this._pan.x = (cw - gw * this._zoom) / 2 - minX * this._zoom + 50 * this._zoom;
        this._pan.y = (ch - gh * this._zoom) / 2 - minY * this._zoom + 50 * this._zoom;
        this._applyTransform();
    }

    refreshNodeBadges() {
        for (const node of this.engine.nodes.values()) {
            const g = this.gNodes.querySelector(`[data-node-id="${node.id}"]`);
            if (!g) continue;
            const badge = g.querySelector('.wf-node-badge');
            if (!badge) continue;
            if (node._error) {
                badge.textContent = '⚠ Error';
                badge.setAttribute('fill', '#ef4444');
            } else if (node._outputData || node._outputPorts) {
                badge.textContent = node.getOutputStats();
                badge.setAttribute('fill', 'var(--text-muted)');
            } else {
                badge.textContent = '';
            }

            // Update rect stroke for error/success
            const rect = g.querySelector('.wf-node-rect');
            if (rect) {
                if (node._error) rect.setAttribute('stroke', '#ef4444');
                else if (node._outputData || node._outputPorts) rect.setAttribute('stroke', '#22c55e');
                else rect.setAttribute('stroke', node.color || '#555');
            }
        }
    }

    destroy() {
        this.svg?.remove();
    }

    // ── SVG helpers ──

    _svgEl(tag, attrs = {}) {
        const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
        for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
        return el;
    }
}
