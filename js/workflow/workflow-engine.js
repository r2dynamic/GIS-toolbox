/**
 * Workflow Engine — topological sort + sequential execution of the node graph
 */
import { bus } from '../core/event-bus.js';

export class WorkflowEngine {
    constructor() {
        this.nodes = new Map();   // id → node
        this.wires = [];          // [{ from, fromPort, to, toPort }]
        this._running = false;
    }

    // ── Graph manipulation ──

    addNode(node) {
        this.nodes.set(node.id, node);
    }

    removeNode(id) {
        this.nodes.delete(id);
        this.wires = this.wires.filter(w => w.from !== id && w.to !== id);
    }

    addWire(wire) {
        // Prevent duplicate wires
        const dup = this.wires.find(w =>
            w.from === wire.from && w.fromPort === wire.fromPort &&
            w.to === wire.to && w.toPort === wire.toPort
        );
        if (dup) return false;

        // Prevent cycles
        if (this._wouldCycle(wire.from, wire.to)) return false;

        this.wires.push(wire);
        return true;
    }

    removeWire(wire) {
        this.wires = this.wires.filter(w =>
            !(w.from === wire.from && w.fromPort === wire.fromPort &&
              w.to === wire.to && w.toPort === wire.toPort)
        );
    }

    removeWiresForPort(nodeId, portId, direction) {
        this.wires = this.wires.filter(w => {
            if (direction === 'input') return !(w.to === nodeId && w.toPort === portId);
            return !(w.from === nodeId && w.fromPort === portId);
        });
    }

    getIncomingWires(nodeId) {
        return this.wires.filter(w => w.to === nodeId);
    }

    getOutgoingWires(nodeId) {
        return this.wires.filter(w => w.from === nodeId);
    }

    /** Check if candidateId is anywhere upstream of nodeId */
    isUpstreamOf(nodeId, candidateId, visited = new Set()) {
        if (visited.has(nodeId)) return false;
        visited.add(nodeId);
        const incoming = this.getIncomingWires(nodeId);
        for (const w of incoming) {
            if (w.from === candidateId) return true;
            if (this.isUpstreamOf(w.from, candidateId, visited)) return true;
        }
        return false;
    }

    getUpstreamOutput(nodeId, context) {
        const incoming = this.getIncomingWires(nodeId);
        if (incoming.length === 0) return null;
        const srcNode = this.nodes.get(incoming[0].from);
        if (!srcNode) return null;
        // Return executed data if available
        if (srcNode._outputData) return srcNode._outputData;
        // Fallback: ask the node for a lightweight preview (schema + type)
        if (context) {
            const preview = srcNode.getOutputPreview?.(context);
            if (preview) return preview;
            // Walk further upstream through the graph
            return this.getUpstreamOutput(srcNode.id, context);
        }
        return null;
    }

    getUpstreamOutputForPort(nodeId, portId, context) {
        const wire = this.wires.find(w => w.to === nodeId && w.toPort === portId);
        if (!wire) return null;
        const srcNode = this.nodes.get(wire.from);
        if (!srcNode) return null;
        // Multi-output: check port-specific data first
        if (srcNode._outputPorts && wire.fromPort in srcNode._outputPorts) {
            return srcNode._outputPorts[wire.fromPort];
        }
        if (srcNode._outputData) return srcNode._outputData;
        if (context) {
            const preview = srcNode.getOutputPreview?.(context);
            if (preview) return preview;
            return this.getUpstreamOutput(srcNode.id, context);
        }
        return null;
    }

    // ── Topological sort ──

    _topoSort() {
        const inDeg = new Map();
        const adj = new Map();

        for (const id of this.nodes.keys()) {
            inDeg.set(id, 0);
            adj.set(id, []);
        }

        for (const w of this.wires) {
            if (!this.nodes.has(w.from) || !this.nodes.has(w.to)) continue;
            adj.get(w.from).push(w.to);
            inDeg.set(w.to, (inDeg.get(w.to) || 0) + 1);
        }

        const queue = [];
        for (const [id, deg] of inDeg) {
            if (deg === 0) queue.push(id);
        }

        const sorted = [];
        while (queue.length > 0) {
            const id = queue.shift();
            sorted.push(id);
            for (const next of adj.get(id)) {
                inDeg.set(next, inDeg.get(next) - 1);
                if (inDeg.get(next) === 0) queue.push(next);
            }
        }

        if (sorted.length !== this.nodes.size) {
            throw new Error('Cycle detected in workflow graph');
        }
        return sorted;
    }

    _wouldCycle(fromId, toId) {
        // DFS from toId – if we can reach fromId, adding fromId→toId creates a cycle
        const visited = new Set();
        const stack = [toId];
        while (stack.length > 0) {
            const cur = stack.pop();
            if (cur === fromId) return true;
            if (visited.has(cur)) continue;
            visited.add(cur);
            for (const w of this.wires) {
                if (w.from === cur) stack.push(w.to);
            }
        }
        return false;
    }

    // ── Execution ──

    async run(context) {
        if (this._running) throw new Error('Pipeline already running');
        this._running = true;

        // Clear previous results
        for (const node of this.nodes.values()) {
            node._outputData = null;
            node._outputPorts = null;
            node._error = null;
            node._running = false;
        }

        bus.emit('workflow:run-start');

        try {
            const order = this._topoSort();

            for (const nodeId of order) {
                const node = this.nodes.get(nodeId);
                node._running = true;
                bus.emit('workflow:node-start', { nodeId });

                try {
                    // Gather inputs in port order
                    const inputs = node.inputPorts.map(port => {
                        const wire = this.wires.find(w => w.to === nodeId && w.toPort === port.id);
                        if (!wire) return null;
                        const srcNode = this.nodes.get(wire.from);
                        if (!srcNode) return null;
                        // Multi-output: check port-specific data first
                        if (srcNode._outputPorts && wire.fromPort in srcNode._outputPorts) {
                            return srcNode._outputPorts[wire.fromPort];
                        }
                        return srcNode._outputData || null;
                    });

                    const engineContext = {
                        ...context,
                        getUpstreamOutput: (id) => this.getUpstreamOutput(id, context)
                    };

                    const result = await node.execute(inputs, engineContext);
                    // Support multi-output nodes: { _multiOutput: true, ports: { portId: data } }
                    if (result && result._multiOutput && result.ports) {
                        node._outputPorts = result.ports;
                        // Set _outputData to first port's data for badge/preview fallback
                        const firstPort = node.outputPorts[0];
                        node._outputData = firstPort ? result.ports[firstPort.id] || null : null;
                    } else {
                        node._outputData = result;
                    }
                    node._error = null;
                    bus.emit('workflow:node-done', { nodeId, success: true });
                } catch (err) {
                    node._error = err.message;
                    bus.emit('workflow:node-done', { nodeId, success: false, error: err.message });
                    throw new Error(`Node "${node.name}" failed: ${err.message}`);
                } finally {
                    node._running = false;
                }
            }

            bus.emit('workflow:run-done', { success: true });
        } catch (err) {
            bus.emit('workflow:run-done', { success: false, error: err.message });
            throw err;
        } finally {
            this._running = false;
        }
    }

    // ── Serialization ──

    toJSON() {
        return {
            nodes: [...this.nodes.values()].map(n => n.toJSON()),
            wires: this.wires.map(w => ({ ...w }))
        };
    }

    clear() {
        this.nodes.clear();
        this.wires = [];
    }

    get isRunning() { return this._running; }
}
