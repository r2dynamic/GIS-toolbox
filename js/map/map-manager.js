/**
 * Map manager — MapLibre GL JS integration
 * Keyless basemaps, layer rendering, popups, 3D terrain & buildings
 */
import logger from '../core/logger.js';
import bus from '../core/event-bus.js';

const BASEMAPS = {
    voyager: {
        name: 'Voyager',
        tiles: [
            'https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png',
            'https://b.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png',
            'https://c.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png'
        ],
        attribution: '&copy; <a href="https://openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
        maxZoom: 20
    },
    satellite: {
        name: 'Satellite',
        tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
        attribution: '&copy; Esri, Maxar, Earthstar Geographics',
        maxZoom: 19
    }
};

const LAYER_COLORS = ['#2563eb', '#dc2626', '#16a34a', '#d97706', '#7c3aed', '#0891b2', '#be185d', '#65a30d'];

const POINT_SYMBOL_NAMES = ['circle', 'square', 'triangle', 'diamond', 'star', 'pin'];

/** Create an SVG string for a given point symbol shape */
function _makeSymbolSVG(shape, color, fillColor, size, opacity) {
    const s = size * 2;
    switch (shape) {
        case 'square':
            return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}"><rect x="1" y="1" width="${s-2}" height="${s-2}" fill="${fillColor}" fill-opacity="${opacity}" stroke="${color}" stroke-width="2" rx="2"/></svg>`;
        case 'triangle':
            return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}"><polygon points="${size},1 ${s-1},${s-1} 1,${s-1}" fill="${fillColor}" fill-opacity="${opacity}" stroke="${color}" stroke-width="2"/></svg>`;
        case 'diamond':
            return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}"><polygon points="${size},1 ${s-1},${size} ${size},${s-1} 1,${size}" fill="${fillColor}" fill-opacity="${opacity}" stroke="${color}" stroke-width="2"/></svg>`;
        case 'star': {
            const cx = size, cy = size, r = size - 1, ri = r * 0.4;
            let pts = '';
            for (let i = 0; i < 5; i++) {
                const aOuter = (Math.PI / 2) + (2 * Math.PI * i / 5);
                const aInner = aOuter + Math.PI / 5;
                pts += `${cx + r * Math.cos(aOuter)},${cy - r * Math.sin(aOuter)} `;
                pts += `${cx + ri * Math.cos(aInner)},${cy - ri * Math.sin(aInner)} `;
            }
            return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}"><polygon points="${pts.trim()}" fill="${fillColor}" fill-opacity="${opacity}" stroke="${color}" stroke-width="1.5"/></svg>`;
        }
        case 'pin': {
            const h = s + 8;
            return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${h}" viewBox="0 0 ${s} ${h}"><path d="M${size} ${s+6} C${size} ${s+6} ${s-1} ${size+2} ${s-1} ${size} A${size-1} ${size-1} 0 1 0 1 ${size} C1 ${size+2} ${size} ${s+6} ${size} ${s+6}Z" fill="${fillColor}" fill-opacity="${opacity}" stroke="${color}" stroke-width="1.5"/><circle cx="${size}" cy="${size}" r="${size*0.35}" fill="${color}" opacity="0.6"/></svg>`;
        }
        default:
            return null;
    }
}

class MapManager {
    constructor() {
        this.map = null;
        this.dataLayers = new Map();   // layerId -> { sourceId, layerIds[], geojson }
        this._layerNames = new Map();
        this._layerStyles = new Map();
        this.clusterGroups = new Map();
        this.currentBasemap = 'voyager';
        this.drawLayer = null;
        this.highlightLayer = null;
        this._highlightedInfo = null;

        // Import fence
        this._importFence = null;

        // Selection
        this._selections = new Map();
        this._selectionMode = false;

        // 3D
        this._3dEnabled = false;
        this._terrainEnabled = false;
        this._buildingsEnabled = false;

        // Popup
        this._popup = null;

        // Camera orbit
        this._orbitAnimId = null;
        this._orbitCenter = null;

        // Temp layers
        this._tempLayers = [];

        // ID counter
        this._idCounter = 0;
    }

    _nextId(prefix) {
        return `${prefix}-${++this._idCounter}`;
    }

    init(containerId) {
        if (typeof maplibregl === 'undefined') {
            logger.error('Map', 'MapLibre GL JS not loaded');
            return;
        }

        this.map = new maplibregl.Map({
            container: containerId,
            style: this._buildStyle('voyager'),
            center: [-111.09, 39.32],
            zoom: 7,
            attributionControl: true,
            maxPitch: 85,
            dragRotate: false,
            touchZoomRotate: true
        });

        // Disable right-click rotate and touch rotation (keeps zoom gestures)
        this.map.dragRotate.disable();
        this.map.touchZoomRotate.disableRotation();

        this.map.addControl(new maplibregl.FullscreenControl(), 'top-right');

        this.map.on('error', (e) => {
            if (e.error?.status === 404 || e.error?.message?.includes('tile')) {
                logger.warn('Map', 'Tile load error', { message: e.error?.message });
            }
        });

        // Click on empty map — clear highlight & popup
        this.map.on('click', (e) => {
            if (e._drawHandled) return;
            const hitLayers = this._getInteractiveLayerIds();
            const features = hitLayers.length > 0 ? this.map.queryRenderedFeatures(e.point, { layers: hitLayers }) : [];
            if (features.length === 0 && !this._selectionMode) {
                this.clearHighlight();
                this._closePopup();
            }
        });

        // Right-click
        this.map.on('contextmenu', (e) => {
            e.preventDefault();
            const hitLayers = this._getInteractiveLayerIds();
            const features = hitLayers.length > 0 ? this.map.queryRenderedFeatures(e.point, { layers: hitLayers }) : [];
            if (features.length === 0) {
                bus.emit('map:contextmenu', {
                    latlng: { lat: e.lngLat.lat, lng: e.lngLat.lng },
                    originalEvent: e.originalEvent,
                    layerId: null,
                    featureIndex: null,
                    feature: null
                });
            }
        });

        this.map.on('load', () => {
            logger.info('Map', 'Map initialized');
            bus.emit('map:ready', this.map);
            this._initCoordSearch();
            this._initMeasureTool();
        });

        return this.map;
    }

    // ==========================================
    // Style builder
    // ==========================================

    _buildStyle(basemapKey) {
        const bm = BASEMAPS[basemapKey] || BASEMAPS.voyager;
        const sources = {};
        const layers = [];

        if (bm.tiles) {
            sources['basemap'] = {
                type: 'raster',
                tiles: bm.tiles,
                tileSize: 256,
                maxzoom: bm.maxZoom || 19,
                attribution: bm.attribution
            };
            layers.push({
                id: 'basemap-layer',
                type: 'raster',
                source: 'basemap',
                minzoom: 0,
                maxzoom: 22
            });

            if (bm.overlayTiles) {
                sources['basemap-overlay'] = {
                    type: 'raster',
                    tiles: bm.overlayTiles,
                    tileSize: 256,
                    maxzoom: 20
                };
                layers.push({
                    id: 'basemap-overlay-layer',
                    type: 'raster',
                    source: 'basemap-overlay',
                    minzoom: 0,
                    maxzoom: 22
                });
            }
        }

        return {
            version: 8,
            sources,
            layers,
            glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf'
        };
    }

    setBasemap(key) {
        const bm = BASEMAPS[key];
        if (!bm) {
            logger.warn('Map', 'Unknown basemap key', { key });
            return;
        }

        // Collect all non-basemap sources/layers to preserve data layers
        // Skip 3D-specific assets — _apply3D will recreate them cleanly
        const _3dIds = new Set(['terrain-source', 'openfreemap']);
        const _3dLayerIds = new Set(['hillshade', 'sky', '3d-buildings']);

        const style = this.map.getStyle();
        const userSources = {};
        const userLayers = [];
        for (const [id, src] of Object.entries(style.sources)) {
            if (id !== 'basemap' && id !== 'basemap-overlay' && !_3dIds.has(id)) {
                userSources[id] = src;
            }
        }
        for (const layer of style.layers) {
            if (!layer.id.startsWith('basemap') && !_3dLayerIds.has(layer.id)) {
                userLayers.push(layer);
            }
        }

        // Build new basemap style
        const newStyle = this._buildStyle(key);

        // Merge user data back
        Object.assign(newStyle.sources, userSources);
        newStyle.layers.push(...userLayers);

        // If 3D is active, carry terrain into the new style so there is
        // no gap between setStyle and _apply3D (prevents black flash)
        if (this._3dEnabled) {
            newStyle.sources['terrain-source'] = {
                type: 'raster-dem',
                tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
                encoding: 'terrarium',
                tileSize: 256,
                maxzoom: 15
            };
            newStyle.terrain = { source: 'terrain-source', exaggeration: 1.5 };
        }

        this.map.setStyle(newStyle, { diff: true });
        this.currentBasemap = key;

        // Re-apply 3D if it was active before the basemap switch.
        // style.load does NOT always fire with { diff: true }, so we
        // listen for styledata (always emitted) with a one-shot guard.
        if (this._3dEnabled) {
            let applied = false;
            const reapply = () => {
                if (applied) return;
                applied = true;
                this.map.off('styledata', reapply);
                this._terrainEnabled = false;
                this._buildingsEnabled = false;
                this._apply3D();
            };
            this.map.on('styledata', reapply);
            // Safety fallback in case styledata already fired synchronously
            setTimeout(reapply, 200);
        }

        bus.emit('map:basemap', key);
    }

    getBasemaps() { return BASEMAPS; }

    getLayerStyle(layerId) {
        return this._layerStyles.get(layerId) || null;
    }

    setLayerStyle(layerId, style) {
        this._layerStyles.set(layerId, style);
    }

    // ==========================================
    // Layer management
    // ==========================================

    addLayer(dataset, colorIndex = 0, { fit = false } = {}) {
        if (!this.map || !dataset.geojson) return;

        this.removeLayer(dataset.id);

        const defaultColor = LAYER_COLORS[colorIndex % LAYER_COLORS.length];
        const stored = this._layerStyles.get(dataset.id);
        const sty = {
            strokeColor: stored?.strokeColor || defaultColor,
            fillColor:   stored?.fillColor   || defaultColor,
            strokeWidth: stored?.strokeWidth  ?? 2,
            strokeOpacity: stored?.strokeOpacity ?? 0.8,
            fillOpacity: stored?.fillOpacity ?? 0.3,
            pointSize:   stored?.pointSize   ?? 6,
            pointSymbol: stored?.pointSymbol  || 'circle'
        };

        if (!stored) this._layerStyles.set(dataset.id, { ...sty });

        const features = dataset.geojson.features.filter(f => f.geometry);
        if (features.length === 0) {
            logger.info('Map', 'No geometries to display', { layer: dataset.name });
            return;
        }

        // Tag features with index and dataset id
        const taggedFeatures = features.map(f => {
            const origIndex = dataset.geojson.features.indexOf(f);
            return {
                ...f,
                properties: { ...(f.properties || {}), _featureIndex: origIndex, _datasetId: dataset.id }
            };
        });

        const geojson = { type: 'FeatureCollection', features: taggedFeatures };
        const sourceId = `src-${dataset.id}`;

        const hasPoints = taggedFeatures.some(f => f.geometry.type === 'Point' || f.geometry.type === 'MultiPoint');
        const hasLines = taggedFeatures.some(f => f.geometry.type === 'LineString' || f.geometry.type === 'MultiLineString');
        const hasPolygons = taggedFeatures.some(f => f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon');

        this.map.addSource(sourceId, { type: 'geojson', data: geojson });

        const layerIds = [];

        // Polygon fill
        if (hasPolygons) {
            const fillId = `${dataset.id}-fill`;
            this.map.addLayer({
                id: fillId, type: 'fill', source: sourceId,
                filter: ['==', '$type', 'Polygon'],
                paint: { 'fill-color': sty.fillColor, 'fill-opacity': sty.fillOpacity }
            });
            layerIds.push(fillId);

            const outlineId = `${dataset.id}-outline`;
            this.map.addLayer({
                id: outlineId, type: 'line', source: sourceId,
                filter: ['==', '$type', 'Polygon'],
                paint: { 'line-color': sty.strokeColor, 'line-width': sty.strokeWidth, 'line-opacity': sty.strokeOpacity }
            });
            layerIds.push(outlineId);
        }

        // Lines
        if (hasLines) {
            const lineId = `${dataset.id}-line`;
            this.map.addLayer({
                id: lineId, type: 'line', source: sourceId,
                filter: ['==', '$type', 'LineString'],
                paint: { 'line-color': sty.strokeColor, 'line-width': sty.strokeWidth, 'line-opacity': sty.strokeOpacity }
            });
            layerIds.push(lineId);
        }

        // Points
        if (hasPoints) {
            const fo = Math.min(1, sty.fillOpacity + 0.3);
            if (sty.pointSymbol === 'circle') {
                const ptId = `${dataset.id}-point`;
                this.map.addLayer({
                    id: ptId, type: 'circle', source: sourceId,
                    filter: ['==', '$type', 'Point'],
                    paint: {
                        'circle-radius': sty.pointSize,
                        'circle-color': sty.fillColor,
                        'circle-stroke-color': sty.strokeColor,
                        'circle-stroke-width': sty.strokeWidth,
                        'circle-opacity': fo
                    }
                });
                layerIds.push(ptId);
            } else {
                const imgName = this._ensureSymbolImage(sty.pointSymbol, sty.strokeColor, sty.fillColor, sty.pointSize, fo);
                const ptId = `${dataset.id}-point`;
                this.map.addLayer({
                    id: ptId, type: 'symbol', source: sourceId,
                    filter: ['==', '$type', 'Point'],
                    layout: {
                        'icon-image': imgName,
                        'icon-size': 1,
                        'icon-allow-overlap': true,
                        'icon-anchor': sty.pointSymbol === 'pin' ? 'bottom' : 'center'
                    }
                });
                layerIds.push(ptId);
            }
        }

        // Click handlers
        for (const lid of layerIds) {
            this.map.on('click', lid, (e) => {
                if (e._drawHandled) return;
                e.preventDefault();
                const props = e.features?.[0]?.properties;
                if (!props) return;
                const featureIndex = props._featureIndex;
                const feature = dataset.geojson.features[featureIndex];
                if (!feature) return;

                if (this._selectionMode) {
                    this._handleSelectionClick(dataset.id, featureIndex, e.originalEvent?.shiftKey, sty.strokeColor);
                } else {
                    const latlng = { lat: e.lngLat.lat, lng: e.lngLat.lng };
                    const nearby = this._findFeaturesNearClick(latlng, dataset.id, featureIndex);
                    this.highlightFeature(dataset.id, featureIndex, sty.strokeColor);
                    this._popupHits = nearby.length > 0 ? nearby : [{
                        feature, featureIndex,
                        layerId: dataset.id, layerName: dataset.name,
                        layerColor: sty.strokeColor
                    }];
                    this._popupIndex = 0;
                    this._popupLatLng = latlng;
                    this._renderCyclePopup();
                }
            });

            this.map.on('contextmenu', lid, (e) => {
                e.preventDefault();
                const props = e.features?.[0]?.properties;
                if (!props) return;
                const featureIndex = props._featureIndex;
                const feature = dataset.geojson.features[featureIndex];
                bus.emit('map:contextmenu', {
                    latlng: { lat: e.lngLat.lat, lng: e.lngLat.lng },
                    originalEvent: e.originalEvent,
                    layerId: dataset.id, featureIndex, feature
                });
            });

            this.map.on('mouseenter', lid, () => {
                if (this.map.getCanvas().style.cursor !== 'crosshair') {
                    this.map.getCanvas().style.cursor = 'pointer';
                }
            });
            this.map.on('mouseleave', lid, () => {
                if (!this._selectionMode && this.map.getCanvas().style.cursor !== 'crosshair') {
                    this.map.getCanvas().style.cursor = '';
                }
            });
        }

        this.dataLayers.set(dataset.id, { sourceId, layerIds, geojson });
        this._layerNames.set(dataset.id, dataset.name);

        if (features.length > 10000) {
            logger.warn('Map', 'Large dataset — rendering may be slow', { count: features.length });
        }

        if (fit) {
            try {
                const bbox = turf.bbox(geojson);
                if (bbox && isFinite(bbox[0])) {
                    this.map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: 30, maxZoom: 16 });
                }
            } catch (e) {
                logger.warn('Map', 'Could not fit bounds', { error: e.message });
            }
        }

        logger.info('Map', 'Layer added', { name: dataset.name, features: features.length });
        bus.emit('map:layerAdded', { id: dataset.id, name: dataset.name });
    }

    _ensureSymbolImage(shape, color, fillColor, size, opacity) {
        const imgName = `sym-${shape}-${color}-${fillColor}-${size}-${opacity}`.replace(/#/g, '');
        if (this.map.hasImage(imgName)) return imgName;

        const svg = _makeSymbolSVG(shape, color, fillColor, size, opacity);
        if (!svg) return imgName;

        const img = new Image();
        const blob = new Blob([svg], { type: 'image/svg+xml' });
        const url = URL.createObjectURL(blob);
        img.onload = () => {
            if (!this.map.hasImage(imgName)) {
                this.map.addImage(imgName, img);
            }
            URL.revokeObjectURL(url);
        };
        img.src = url;
        return imgName;
    }

    _getInteractiveLayerIds() {
        const ids = [];
        for (const info of this.dataLayers.values()) {
            ids.push(...info.layerIds);
        }
        return ids;
    }

    removeLayer(id) {
        const info = this.dataLayers.get(id);
        if (info) {
            for (const lid of info.layerIds) {
                if (this.map.getLayer(lid)) this.map.removeLayer(lid);
            }
            if (this.map.getSource(info.sourceId)) this.map.removeSource(info.sourceId);
            this.dataLayers.delete(id);
        }
        this._layerNames.delete(id);
        this.clearSelection(id);
    }

    toggleLayer(id, visible) {
        const info = this.dataLayers.get(id);
        if (!info) return;
        const visibility = visible ? 'visible' : 'none';
        for (const lid of info.layerIds) {
            if (this.map.getLayer(lid)) this.map.setLayoutProperty(lid, 'visibility', visibility);
        }
    }

    restyleLayer(layerId, dataset, style) {
        this._layerStyles.set(layerId, { ...style });
        this.addLayer(dataset, this._getLayerZIndex(layerId), { fit: false });
    }

    _getLayerZIndex(layerId) {
        let i = 0;
        for (const id of this.dataLayers.keys()) {
            if (id === layerId) return i;
            i++;
        }
        return 0;
    }

    static get pointSymbols() {
        return POINT_SYMBOL_NAMES;
    }

    syncLayerOrder(orderedIds) {
        for (const id of orderedIds) {
            const info = this.dataLayers.get(id);
            if (!info) continue;
            for (const lid of info.layerIds) {
                if (this.map.getLayer(lid)) this.map.moveLayer(lid);
            }
        }
    }

    // ==========================================
    // Popups
    // ==========================================

    _buildPopupHtml(feature) {
        const props = feature.properties || {};
        let imgHtml = '';
        const imgSrc = props._thumbnailUrl || props._thumbnailDataUrl;
        if (imgSrc) {
            imgHtml = `<div style="margin-bottom:6px;text-align:center;">
                <img src="${imgSrc}" style="max-width:280px;max-height:200px;border-radius:4px;" />
            </div>`;
        }

        const rows = Object.entries(props)
            .filter(([k, v]) => v != null && !k.startsWith('_'))
            .map(([k, v]) => {
                if (v && typeof v === 'object' && v._att && v.dataUrl) {
                    return `<tr><th>${k}</th><td style="padding:4px 0;">
                        <img src="${v.dataUrl}" style="max-width:240px;max-height:180px;border-radius:4px;display:block;margin-bottom:2px;" />
                        <span style="font-size:10px;color:#888;">${v.name || 'photo'}</span>
                    </td></tr>`;
                }
                let val = v;
                if (typeof v === 'object') val = JSON.stringify(v);
                if (typeof val === 'string' && val.length > 100) val = val.slice(0, 100) + '…';
                return `<tr><th>${k}</th><td>${val}</td></tr>`;
            }).join('');
        const tableHtml = rows ? `<table>${rows}</table>` : '<em>No attributes</em>';
        return imgHtml + tableHtml;
    }

    showPopup(feature, layer, latlng) {
        const html = this._buildPopupHtml(feature);
        const pos = latlng || this._getFeatureCenter(feature);
        this._closePopup();
        this._popup = new maplibregl.Popup({ maxWidth: '350px' })
            .setLngLat([pos.lng, pos.lat])
            .setHTML(`<div class="map-popup-content">${html}</div>`)
            .addTo(this.map);
        this._popup.on('close', () => this.clearHighlight());
    }

    _closePopup() {
        if (this._popup) {
            this._popup.remove();
            this._popup = null;
        }
    }

    _getFeatureCenter(feature) {
        try {
            const c = turf.centroid(feature);
            return { lng: c.geometry.coordinates[0], lat: c.geometry.coordinates[1] };
        } catch {
            return { lng: 0, lat: 0 };
        }
    }

    // ==========================================
    // Feature hit detection
    // ==========================================

    _findFeaturesNearClick(latlng, clickedLayerId, clickedFeatureIndex) {
        const pixel = this.map.project([latlng.lng, latlng.lat]);
        const results = [];
        const allLayerIds = this._getInteractiveLayerIds();
        const rendered = allLayerIds.length > 0 ? this.map.queryRenderedFeatures([pixel.x, pixel.y], { layers: allLayerIds }) : [];

        const seen = new Set();
        for (const rf of rendered) {
            const props = rf.properties;
            if (!props || props._featureIndex === undefined) continue;
            const key = `${props._datasetId}-${props._featureIndex}`;
            if (seen.has(key)) continue;
            seen.add(key);

            const layerId = props._datasetId;
            const featureIndex = props._featureIndex;
            const layerName = this._layerNames.get(layerId) || layerId;
            const sty = this._layerStyles.get(layerId);
            const layerColor = sty?.strokeColor || '#2563eb';

            const info = this.dataLayers.get(layerId);
            let feature = null;
            if (info?.geojson?.features) {
                feature = info.geojson.features.find(f => f.properties?._featureIndex === featureIndex);
            }
            if (!feature) continue;

            results.push({
                feature: this._stripInternalProps(feature),
                featureIndex, layerId, layerName, layerColor
            });
        }

        if (clickedLayerId !== undefined && clickedFeatureIndex !== undefined) {
            const idx = results.findIndex(r => r.layerId === clickedLayerId && r.featureIndex === clickedFeatureIndex);
            if (idx > 0) {
                const [clicked] = results.splice(idx, 1);
                results.unshift(clicked);
            }
        }

        return results;
    }

    _stripInternalProps(feature) {
        if (!feature?.properties) return feature;
        const { _featureIndex, _datasetId, ...rest } = feature.properties;
        return { ...feature, properties: rest };
    }

    _showMultiPopup(hits, latlng) {
        if (hits.length === 0) return;
        this._popupHits = hits;
        this._popupIndex = 0;
        this._popupLatLng = latlng;
        this._renderCyclePopup();
    }

    _renderCyclePopup() {
        const hits = this._popupHits;
        const idx = this._popupIndex;
        if (!hits || !hits[idx]) return;

        const hit = hits[idx];
        const bodyHtml = this._buildPopupHtml(hit.feature);
        const layerName = hit.layerName || hit.layerId;
        const layerLabel = `<div style="font-size:10px;color:var(--text-muted);margin-bottom:4px;border-bottom:1px solid var(--border);padding-bottom:3px;">
            <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${hit.layerColor};margin-right:4px;"></span>
            <strong>${layerName}</strong>
        </div>`;

        let navHtml = '';
        if (hits.length > 1) {
            navHtml = `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;font-size:11px;">
                <button onclick="window._mapPopupNav(-1)" style="background:none;border:1px solid var(--border);color:var(--text);border-radius:3px;padding:1px 8px;cursor:pointer;font-size:13px;">&larr;</button>
                <span>${idx + 1} of ${hits.length}</span>
                <button onclick="window._mapPopupNav(1)" style="background:none;border:1px solid var(--border);color:var(--text);border-radius:3px;padding:1px 8px;cursor:pointer;font-size:13px;">&rarr;</button>
            </div>`;
        }

        const editBtn = `<div style="margin-top:6px;border-top:1px solid var(--border);padding-top:4px;text-align:right;">
            <button onclick="window._mapPopupEdit()" style="background:var(--primary);color:#fff;border:none;border-radius:4px;padding:3px 12px;cursor:pointer;font-size:12px;">✏️ Edit</button>
        </div>`;

        const html = `<div class="map-popup-content">${layerLabel}${navHtml}${bodyHtml}${editBtn}</div>`;

        this.highlightFeature(hit.layerId, hit.featureIndex, hit.layerColor);

        // Suppress close handler while cycling between features
        this._cyclingPopup = true;
        this._closePopup();
        this._cyclingPopup = false;

        this._popup = new maplibregl.Popup({ maxWidth: '350px', closeOnClick: false })
            .setLngLat([this._popupLatLng.lng, this._popupLatLng.lat])
            .setHTML(html)
            .addTo(this.map);

        this._popup.on('close', () => {
            if (this._cyclingPopup) return;
            this.clearHighlight();
            this._popupHits = null;
        });
    }

    // ==========================================
    // Feature highlighting
    // ==========================================

    highlightFeature(layerId, featureIndex, originalColor) {
        this.clearHighlight();
        const info = this.dataLayers.get(layerId);
        if (!info) return;
        const feature = info.geojson.features.find(f => f.properties?._featureIndex === featureIndex);
        if (!feature) return;

        this._highlightedInfo = { layerId, featureIndex };
        const hlSrcId = 'highlight-source';

        if (this.map.getSource(hlSrcId)) {
            this.map.getSource(hlSrcId).setData({ type: 'FeatureCollection', features: [feature] });
        } else {
            this.map.addSource(hlSrcId, { type: 'geojson', data: { type: 'FeatureCollection', features: [feature] } });
        }

        const gType = feature.geometry?.type;
        if (gType === 'Point' || gType === 'MultiPoint') {
            if (!this.map.getLayer('highlight-circle')) {
                this.map.addLayer({
                    id: 'highlight-circle', type: 'circle', source: hlSrcId,
                    paint: { 'circle-radius': 10, 'circle-color': '#fbbf24', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 3, 'circle-opacity': 1 }
                });
            }
        } else if (gType === 'LineString' || gType === 'MultiLineString') {
            if (!this.map.getLayer('highlight-line')) {
                this.map.addLayer({
                    id: 'highlight-line', type: 'line', source: hlSrcId,
                    paint: { 'line-color': '#fbbf24', 'line-width': 4, 'line-opacity': 1 }
                });
            }
        } else if (gType === 'Polygon' || gType === 'MultiPolygon') {
            if (!this.map.getLayer('highlight-fill')) {
                this.map.addLayer({
                    id: 'highlight-fill', type: 'fill', source: hlSrcId,
                    paint: { 'fill-color': '#fbbf24', 'fill-opacity': 0.35 }
                });
            }
            if (!this.map.getLayer('highlight-line')) {
                this.map.addLayer({
                    id: 'highlight-line', type: 'line', source: hlSrcId,
                    paint: { 'line-color': '#fbbf24', 'line-width': 4, 'line-opacity': 1 }
                });
            }
        }
    }

    clearHighlight() {
        for (const lid of ['highlight-fill', 'highlight-line', 'highlight-circle']) {
            if (this.map?.getLayer(lid)) this.map.removeLayer(lid);
        }
        if (this.map?.getSource('highlight-source')) {
            this.map.getSource('highlight-source').setData({ type: 'FeatureCollection', features: [] });
        }
        this._highlightedInfo = null;
    }

    fitToAll() {
        const allFeatures = [];
        for (const info of this.dataLayers.values()) {
            if (info.geojson?.features) allFeatures.push(...info.geojson.features);
        }
        if (allFeatures.length > 0) {
            try {
                const bbox = turf.bbox({ type: 'FeatureCollection', features: allFeatures });
                if (bbox && isFinite(bbox[0])) {
                    this.map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: 30, maxZoom: 16 });
                }
            } catch (_) {}
        }
    }

    getBounds() {
        if (!this.map) return null;
        const b = this.map.getBounds();
        return {
            getWest: () => b.getWest(),
            getEast: () => b.getEast(),
            getNorth: () => b.getNorth(),
            getSouth: () => b.getSouth()
        };
    }

    getMap() { return this.map; }

    /** Resize map — replaces Leaflet's invalidateSize */
    resize() {
        this.map?.resize();
    }

    // ==========================================
    // 3D Terrain & Buildings
    // ==========================================

    toggle3D() {
        this._3dEnabled ? this.disable3D() : this.enable3D();
    }

    /** Internal helper — adds terrain, sky, buildings without changing _3dEnabled flag */
    _apply3D() {
        if (!this.map.getSource('terrain-source')) {
            this.map.addSource('terrain-source', {
                type: 'raster-dem',
                tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
                encoding: 'terrarium',
                tileSize: 256,
                maxzoom: 15
            });
        }
        this.map.setTerrain({ source: 'terrain-source', exaggeration: 1.5 });
        this._terrainEnabled = true;

        // Only add hillshade on non-satellite basemaps
        if (this.currentBasemap !== 'satellite' && !this.map.getLayer('hillshade')) {
            // Find the first non-basemap layer to insert hillshade above basemap but below data
            const layers = this.map.getStyle().layers;
            let beforeId;
            for (const l of layers) {
                if (!l.id.startsWith('basemap') && l.id !== 'hillshade' && l.id !== 'sky') {
                    beforeId = l.id;
                    break;
                }
            }
            this.map.addLayer({
                id: 'hillshade',
                type: 'hillshade',
                source: 'terrain-source',
                paint: {
                    'hillshade-illumination-direction': 315,
                    'hillshade-exaggeration': 0.8,
                    'hillshade-shadow-color': '#473B24',
                    'hillshade-highlight-color': '#FFFFFF',
                    'hillshade-accent-color': '#6e6e6e'
                }
            }, beforeId);
        } else if (this.currentBasemap === 'satellite' && this.map.getLayer('hillshade')) {
            this.map.removeLayer('hillshade');
        }

        if (!this.map.getLayer('sky')) {
            this.map.addLayer({
                id: 'sky', type: 'sky',
                paint: { 'sky-type': 'atmosphere', 'sky-atmosphere-sun': [0.0, 0.0], 'sky-atmosphere-sun-intensity': 15 }
            });
        }
        this._addBuildingsLayer();
    }

    enable3D() {
        if (this._3dEnabled) return;
        this._3dEnabled = true;

        // Snapshot current view so the tilt doesn't shift position
        const center = this.map.getCenter();
        const zoom = this.map.getZoom();

        // Unlock pitch / rotation for 3D
        this.map.dragRotate.enable();
        this.map.touchZoomRotate.enableRotation();

        this._apply3D();

        // Wait for terrain tiles to start loading before tilting
        // (prevents black flash when DEM tiles haven't arrived yet)
        let tilted = false;
        const doTilt = () => {
            if (tilted) return;
            tilted = true;
            this.map.easeTo({ pitch: 30, center, zoom, duration: 800 });
        };
        const onSourceData = (e) => {
            if (e.sourceId === 'terrain-source' && e.isSourceLoaded) {
                this.map.off('sourcedata', onSourceData);
                doTilt();
            }
        };
        this.map.on('sourcedata', onSourceData);
        // Fallback: tilt after short delay even if tiles are slow
        setTimeout(() => { this.map.off('sourcedata', onSourceData); doTilt(); }, 600);

        logger.info('Map', '3D terrain and buildings enabled');
        bus.emit('map:3dChanged', true);
    }

    disable3D() {
        if (!this._3dEnabled) return;
        this._3dEnabled = false;

        // Snapshot center so the un-tilt doesn't shift position
        const center = this.map.getCenter();
        const zoom = this.map.getZoom();

        // Flatten camera FIRST while terrain is still loaded
        // (removing terrain at a tilted pitch causes the black-screen flash)
        this.map.easeTo({ pitch: 0, bearing: 0, center, zoom, duration: 500 });

        // After the camera is flat, tear down 3D assets safely
        const cleanup = () => {
            // Guard: if 3D was re-enabled while animating, skip teardown
            if (this._3dEnabled) return;

            this.map.setTerrain(null);
            this._terrainEnabled = false;

            if (this.map.getLayer('hillshade')) this.map.removeLayer('hillshade');
            if (this.map.getLayer('sky')) this.map.removeLayer('sky');
            this._removeBuildingsLayer();
            if (this.map.getSource('terrain-source')) this.map.removeSource('terrain-source');

            this.map.dragRotate.disable();
            this.map.touchZoomRotate.disableRotation();
        };
        this.map.once('moveend', cleanup);

        logger.info('Map', '3D terrain and buildings disabled');
        bus.emit('map:3dChanged', false);
    }

    _addBuildingsLayer() {
        if (this._buildingsEnabled) return;

        if (!this.map.getSource('openfreemap')) {
            this.map.addSource('openfreemap', {
                type: 'vector',
                url: 'https://tiles.openfreemap.org/planet'
            });
        }

        if (!this.map.getLayer('3d-buildings')) {
            this.map.addLayer({
                id: '3d-buildings',
                source: 'openfreemap',
                'source-layer': 'building',
                type: 'fill-extrusion',
                minzoom: 15,
                filter: ['!=', ['get', 'hide_3d'], true],
                paint: {
                    'fill-extrusion-color': [
                        'interpolate', ['linear'], ['get', 'render_height'],
                        0, 'lightgray', 200, 'royalblue', 400, 'lightblue'
                    ],
                    'fill-extrusion-height': [
                        'interpolate', ['linear'], ['zoom'],
                        15, 0, 16, ['get', 'render_height']
                    ],
                    'fill-extrusion-base': [
                        'case',
                        ['>=', ['get', 'zoom'], 16],
                        ['get', 'render_min_height'], 0
                    ]
                }
            });
        }

        this._buildingsEnabled = true;
    }

    _removeBuildingsLayer() {
        if (this.map.getLayer('3d-buildings')) this.map.removeLayer('3d-buildings');
        if (this.map.getSource('openfreemap')) this.map.removeSource('openfreemap');
        this._buildingsEnabled = false;
    }

    get is3DEnabled() { return this._3dEnabled; }

    // ==========================================
    // Camera Orbit Animation
    // ==========================================

    /** Min zoom for orbit (close-in — roughly street/building level) */
    static ORBIT_MIN_ZOOM = 13;
    /** Max zoom for orbit (prevents orbiting from too far out) */
    static ORBIT_MAX_ZOOM = 18;
    /** Default pitch during orbit */
    static ORBIT_PITCH = 55;

    /**
     * Start an animated camera orbit around a point.
     * Auto-enables 3D if needed. Clamps zoom to the allowed range.
     * @param {object} center  { lng, lat }
     */
    startCameraOrbit(center) {
        // Stop any existing orbit first
        this.stopCameraOrbit();

        const map = this.map;
        this._orbitCenter = center;

        // Enable 3D if not already
        if (!this._3dEnabled) {
            this.enable3D();
        }

        // Clamp zoom to the sweet-spot range
        let zoom = map.getZoom();
        if (zoom < MapManager.ORBIT_MIN_ZOOM) zoom = MapManager.ORBIT_MIN_ZOOM;
        if (zoom > MapManager.ORBIT_MAX_ZOOM) zoom = MapManager.ORBIT_MAX_ZOOM;

        // Fly to the orbit starting position, then begin rotation
        map.flyTo({
            center: [center.lng, center.lat],
            zoom,
            pitch: MapManager.ORBIT_PITCH,
            duration: 1500
        });

        // Auto-stop orbit on any user interaction
        const stopOnInteract = () => this.stopCameraOrbit();
        const mapEvents = ['dragstart', 'wheel', 'click', 'dblclick', 'contextmenu', 'touchstart'];
        mapEvents.forEach(evt => map.once(evt, stopOnInteract));
        const canvas = map.getCanvas();
        canvas.addEventListener('keydown', stopOnInteract, { once: true });
        this._orbitCleanup = () => {
            mapEvents.forEach(evt => map.off(evt, stopOnInteract));
            canvas.removeEventListener('keydown', stopOnInteract);
        };

        map.once('moveend', () => {
            if (!this._orbitCenter) return; // cancelled while flying
            const startBearing = map.getBearing();
            const startTime = performance.now();
            const degreesPerSec = 10; // rotation speed

            const frame = (now) => {
                if (!this._orbitCenter) return; // stopped
                const elapsed = (now - startTime) / 1000;
                const bearing = startBearing + elapsed * degreesPerSec;
                map.rotateTo(bearing % 360, { duration: 0 });
                this._orbitAnimId = requestAnimationFrame(frame);
            };
            this._orbitAnimId = requestAnimationFrame(frame);
        });

        logger.info('Map', `Camera orbit started at ${center.lat.toFixed(4)}, ${center.lng.toFixed(4)}`);
        bus.emit('map:orbitStarted', center);
    }

    /** Stop any active camera orbit animation */
    stopCameraOrbit() {
        if (this._orbitAnimId) {
            cancelAnimationFrame(this._orbitAnimId);
            this._orbitAnimId = null;
        }
        if (this._orbitCleanup) {
            this._orbitCleanup();
            this._orbitCleanup = null;
        }
        if (this._orbitCenter) {
            this._orbitCenter = null;
            logger.info('Map', 'Camera orbit stopped');
            bus.emit('map:orbitStopped');
        }
    }

    /** Whether an orbit animation is currently running */
    get isOrbiting() { return !!this._orbitCenter; }

    // ==========================================
    // Interactive Drawing / Selection System
    // ==========================================

    startPointPick(prompt = 'Click the map to place a point') {
        return new Promise((resolve) => {
            this._cancelInteraction();
            const canvas = this.map.getCanvas();
            canvas.style.cursor = 'crosshair';

            const banner = this._showInteractionBanner(prompt, () => { cleanup(); resolve(null); });

            const onClick = (e) => { cleanup(); resolve([e.lngLat.lng, e.lngLat.lat]); };
            const onKeyDown = (e) => { if (e.key === 'Escape') { cleanup(); resolve(null); } };

            const cleanup = () => {
                canvas.style.cursor = '';
                this.map.off('click', onClick);
                document.removeEventListener('keydown', onKeyDown);
                if (banner) banner.remove();
                this._interactionCleanup = null;
            };

            this._interactionCleanup = cleanup;
            this.map.on('click', onClick);
            document.addEventListener('keydown', onKeyDown);
        });
    }

    startTwoPointPick(prompt1 = 'Click the first point', prompt2 = 'Click the second point') {
        return new Promise((resolve) => {
            this._cancelInteraction();
            const canvas = this.map.getCanvas();
            canvas.style.cursor = 'crosshair';
            const markers = [];
            let firstPoint = null;

            const banner = this._showInteractionBanner(prompt1, () => { cleanup(); resolve(null); });
            const onKeyDown = (e) => { if (e.key === 'Escape') { cleanup(); resolve(null); } };

            const onClick = (e) => {
                const coord = [e.lngLat.lng, e.lngLat.lat];
                const el = document.createElement('div');
                el.style.cssText = 'width:14px;height:14px;background:#d4a24e;border:2px solid #fff;border-radius:50%;';
                const m = new maplibregl.Marker({ element: el }).setLngLat(coord).addTo(this.map);
                markers.push(m);

                if (!firstPoint) {
                    firstPoint = coord;
                    banner.querySelector('.interaction-text').textContent = prompt2;
                } else {
                    cleanup();
                    resolve([firstPoint, coord]);
                }
            };

            const cleanup = () => {
                canvas.style.cursor = '';
                this.map.off('click', onClick);
                document.removeEventListener('keydown', onKeyDown);
                markers.forEach(m => m.remove());
                if (banner) banner.remove();
                this._interactionCleanup = null;
            };

            this._interactionCleanup = cleanup;
            this.map.on('click', onClick);
            document.addEventListener('keydown', onKeyDown);
        });
    }

    startRectangleDraw(prompt = 'Click and drag to draw a rectangle') {
        return new Promise((resolve) => {
            this._cancelInteraction();
            const canvas = this.map.getCanvas();
            canvas.style.cursor = 'crosshair';
            const banner = this._showInteractionBanner(prompt, () => { cleanup(); resolve(null); });

            let startLngLat = null;
            const rectId = this._nextId('rect-draw');

            this.map.addSource(rectId, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
            this.map.addLayer({ id: rectId + '-fill', type: 'fill', source: rectId, paint: { 'fill-color': '#d4a24e', 'fill-opacity': 0.15 } });
            this.map.addLayer({ id: rectId + '-line', type: 'line', source: rectId, paint: { 'line-color': '#d4a24e', 'line-width': 2, 'line-dasharray': [6, 4] } });

            const onMouseDown = (e) => { startLngLat = e.lngLat; this.map.dragPan.disable(); };
            const onMouseMove = (e) => { if (startLngLat) this._updateRectGeoJSON(rectId, startLngLat, e.lngLat); };
            const onMouseUp = (e) => {
                if (!startLngLat) return;
                this.map.dragPan.enable();
                const w = Math.min(startLngLat.lng, e.lngLat.lng), s = Math.min(startLngLat.lat, e.lngLat.lat);
                const east = Math.max(startLngLat.lng, e.lngLat.lng), n = Math.max(startLngLat.lat, e.lngLat.lat);
                cleanup();
                resolve([w, s, east, n]);
            };
            const onKeyDown = (e) => {
                if (e.key === 'Escape') { this.map.dragPan.enable(); cleanup(); resolve(null); }
            };

            const cleanup = () => {
                canvas.style.cursor = '';
                this.map.off('mousedown', onMouseDown);
                this.map.off('mousemove', onMouseMove);
                this.map.off('mouseup', onMouseUp);
                document.removeEventListener('keydown', onKeyDown);
                if (this.map.getLayer(rectId + '-fill')) this.map.removeLayer(rectId + '-fill');
                if (this.map.getLayer(rectId + '-line')) this.map.removeLayer(rectId + '-line');
                if (this.map.getSource(rectId)) this.map.removeSource(rectId);
                if (banner) banner.remove();
                this._interactionCleanup = null;
            };

            this._interactionCleanup = cleanup;
            this.map.on('mousedown', onMouseDown);
            this.map.on('mousemove', onMouseMove);
            this.map.on('mouseup', onMouseUp);
            document.addEventListener('keydown', onKeyDown);
        });
    }

    _updateRectGeoJSON(sourceId, start, end) {
        const w = Math.min(start.lng, end.lng), s = Math.min(start.lat, end.lat);
        const e = Math.max(start.lng, end.lng), n = Math.max(start.lat, end.lat);
        const src = this.map.getSource(sourceId);
        if (src) {
            src.setData({
                type: 'Feature',
                geometry: { type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] }
            });
        }
    }

    // ============================
    // Import Fence
    // ============================

    startImportFenceDraw() {
        this.clearImportFence();
        const isMobile = window.innerWidth < 768 || 'ontouchstart' in window;

        return new Promise((resolve) => {
            this._cancelInteraction();
            const canvas = this.map.getCanvas();
            canvas.style.cursor = 'crosshair';

            const banner = this._showInteractionBanner(
                isMobile ? 'Tap and drag to draw your import fence.' : 'Click and drag to draw your import fence. Only features inside will be imported.',
                () => { cleanup(); resolve(null); }
            );

            let startLngLat = null;
            const fenceId = 'import-fence';

            if (!this.map.getSource(fenceId)) {
                this.map.addSource(fenceId, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
            }
            if (!this.map.getLayer(fenceId + '-fill')) {
                this.map.addLayer({ id: fenceId + '-fill', type: 'fill', source: fenceId, paint: { 'fill-color': '#f59e0b', 'fill-opacity': 0.08 } });
            }
            if (!this.map.getLayer(fenceId + '-line')) {
                this.map.addLayer({ id: fenceId + '-line', type: 'line', source: fenceId, paint: { 'line-color': '#f59e0b', 'line-width': 2.5, 'line-dasharray': [10, 6] } });
            }

            const onMouseDown = (e) => { startLngLat = e.lngLat; this.map.dragPan.disable(); };
            const onMouseMove = (e) => { if (startLngLat) this._updateRectGeoJSON(fenceId, startLngLat, e.lngLat); };
            const onMouseUp = (e) => {
                if (!startLngLat) return;
                this.map.dragPan.enable();
                const west = Math.min(startLngLat.lng, e.lngLat.lng), south = Math.min(startLngLat.lat, e.lngLat.lat);
                const east = Math.max(startLngLat.lng, e.lngLat.lng), north = Math.max(startLngLat.lat, e.lngLat.lat);
                this._importFence = { west, south, east, north };
                cleanup(false);
                resolve([west, south, east, north]);
            };

            const container = this.map.getContainer();
            const touchToLngLat = (touch) => {
                const rect = container.getBoundingClientRect();
                return this.map.unproject(new maplibregl.Point(touch.clientX - rect.left, touch.clientY - rect.top));
            };
            const onTouchStart = (e) => { if (e.touches.length === 1) { e.preventDefault(); startLngLat = touchToLngLat(e.touches[0]); this.map.dragPan.disable(); } };
            const onTouchMove = (e) => { if (startLngLat && e.touches.length === 1) { e.preventDefault(); this._updateRectGeoJSON(fenceId, startLngLat, touchToLngLat(e.touches[0])); } };
            const onTouchEnd = (e) => {
                if (!startLngLat) return;
                e.preventDefault();
                const ll = touchToLngLat(e.changedTouches[0]);
                this.map.dragPan.enable();
                const west = Math.min(startLngLat.lng, ll.lng), south = Math.min(startLngLat.lat, ll.lat);
                const east = Math.max(startLngLat.lng, ll.lng), north = Math.max(startLngLat.lat, ll.lat);
                this._importFence = { west, south, east, north };
                cleanup(false);
                resolve([west, south, east, north]);
            };
            const onKeyDown = (e) => {
                if (e.key === 'Escape') { this.map.dragPan.enable(); cleanup(); resolve(null); }
            };

            const cleanup = (removeFence = true) => {
                canvas.style.cursor = '';
                this.map.off('mousedown', onMouseDown);
                this.map.off('mousemove', onMouseMove);
                this.map.off('mouseup', onMouseUp);
                container.removeEventListener('touchstart', onTouchStart);
                container.removeEventListener('touchmove', onTouchMove);
                container.removeEventListener('touchend', onTouchEnd);
                document.removeEventListener('keydown', onKeyDown);
                if (removeFence) {
                    if (this.map.getLayer(fenceId + '-fill')) this.map.removeLayer(fenceId + '-fill');
                    if (this.map.getLayer(fenceId + '-line')) this.map.removeLayer(fenceId + '-line');
                    if (this.map.getSource(fenceId)) this.map.removeSource(fenceId);
                }
                if (banner) banner.remove();
                this._interactionCleanup = null;
            };

            this._interactionCleanup = cleanup;
            this.map.on('mousedown', onMouseDown);
            this.map.on('mousemove', onMouseMove);
            this.map.on('mouseup', onMouseUp);
            container.addEventListener('touchstart', onTouchStart, { passive: false });
            container.addEventListener('touchmove', onTouchMove, { passive: false });
            container.addEventListener('touchend', onTouchEnd, { passive: false });
            document.addEventListener('keydown', onKeyDown);
        });
    }

    clearImportFence() {
        this._importFence = null;
        const fenceId = 'import-fence';
        if (this.map?.getLayer(fenceId + '-fill')) this.map.removeLayer(fenceId + '-fill');
        if (this.map?.getLayer(fenceId + '-line')) this.map.removeLayer(fenceId + '-line');
        if (this.map?.getSource(fenceId)) this.map.removeSource(fenceId);
        bus.emit('importFence:cleared');
    }

    getImportFenceBbox() {
        if (!this._importFence) return null;
        const b = this._importFence;
        return [b.west, b.south, b.east, b.north];
    }

    getImportFenceEsriEnvelope() {
        if (!this._importFence) return null;
        const b = this._importFence;
        return { xmin: b.west, ymin: b.south, xmax: b.east, ymax: b.north, spatialReference: { wkid: 4326 } };
    }

    get hasImportFence() { return !!this._importFence; }

    showTempFeature(geojson, duration = 10000) {
        const srcId = this._nextId('temp');
        this.map.addSource(srcId, { type: 'geojson', data: geojson });
        const layerIds = [];

        const fillId = srcId + '-fill';
        this.map.addLayer({ id: fillId, type: 'fill', source: srcId, filter: ['==', '$type', 'Polygon'], paint: { 'fill-color': '#d4a24e', 'fill-opacity': 0.25 } });
        layerIds.push(fillId);

        const lineId = srcId + '-line';
        this.map.addLayer({ id: lineId, type: 'line', source: srcId, paint: { 'line-color': '#d4a24e', 'line-width': 3 } });
        layerIds.push(lineId);

        const circleId = srcId + '-circle';
        this.map.addLayer({ id: circleId, type: 'circle', source: srcId, filter: ['==', '$type', 'Point'], paint: { 'circle-radius': 8, 'circle-color': '#d4a24e', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
        layerIds.push(circleId);

        const entry = { srcId, layerIds };
        this._tempLayers.push(entry);

        if (duration > 0) setTimeout(() => this._removeTempFeature(entry), duration);
        return entry;
    }

    _removeTempFeature(entry) {
        for (const lid of entry.layerIds) { if (this.map?.getLayer(lid)) this.map.removeLayer(lid); }
        if (this.map?.getSource(entry.srcId)) this.map.removeSource(entry.srcId);
        this._tempLayers = this._tempLayers.filter(e => e !== entry);
    }

    _cancelInteraction() {
        if (this._interactionCleanup) { this._interactionCleanup(); this._interactionCleanup = null; }
    }

    _showInteractionBanner(text, onCancel) {
        const banner = document.createElement('div');
        banner.className = 'map-interaction-banner';
        banner.innerHTML = `
            <span class="interaction-text">${text}</span>
            <button class="interaction-cancel">✕ Cancel</button>
            <span style="font-size:11px;opacity:0.6;margin-left:8px;">(Esc to cancel)</span>
        `;
        banner.querySelector('.interaction-cancel').onclick = onCancel;
        this.map.getContainer().appendChild(banner);
        return banner;
    }

    // ==========================================
    // Feature Selection System
    // ==========================================

    static get SELECTION_STYLE() {
        return { color: '#00e5ff', weight: 3, opacity: 1, fillColor: '#00e5ff', fillOpacity: 0.35 };
    }
    static get SELECTION_POINT_STYLE() {
        return { radius: 8, fillColor: '#00e5ff', color: '#ffffff', weight: 3, fillOpacity: 1 };
    }

    enterSelectionMode() {
        this._selectionMode = true;
        this.map.getCanvas().style.cursor = 'pointer';
        const banner = this._showInteractionBanner(
            'Selection mode — click features or Shift+drag to box select.',
            () => this.exitSelectionMode()
        );
        this._selectionBanner = banner;
        this._rectSelectHandler = this._setupRectangleSelect();
        bus.emit('selection:modeChanged', true);
        logger.info('Map', 'Selection mode enabled');
    }

    exitSelectionMode() {
        this._selectionMode = false;
        this.map.getCanvas().style.cursor = '';
        if (this._selectionBanner) { this._selectionBanner.remove(); this._selectionBanner = null; }
        if (this._rectSelectCleanup) { this._rectSelectCleanup(); this._rectSelectCleanup = null; }
        bus.emit('selection:modeChanged', false);
        logger.info('Map', 'Selection mode disabled');
    }

    isSelectionMode() { return this._selectionMode; }

    _handleSelectionClick(layerId, featureIndex, shiftKey) {
        if (!this._selections.has(layerId)) this._selections.set(layerId, new Set());
        const sel = this._selections.get(layerId);

        if (shiftKey) {
            sel.has(featureIndex) ? sel.delete(featureIndex) : sel.add(featureIndex);
        } else {
            for (const lid of this._selections.keys()) { this._selections.set(lid, new Set()); this._renderSelectionHighlights(lid); }
            this._selections.set(layerId, new Set([featureIndex]));
        }

        this._renderSelectionHighlights(layerId);
        bus.emit('selection:changed', { layerId, count: this.getSelectionCount(layerId), totalCount: this.getTotalSelectionCount() });
    }

    _setupRectangleSelect() {
        let startLngLat = null;
        let dragging = false;
        const rectId = 'selection-rect';

        if (!this.map.getSource(rectId)) {
            this.map.addSource(rectId, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
            this.map.addLayer({ id: rectId + '-fill', type: 'fill', source: rectId, paint: { 'fill-color': '#00e5ff', 'fill-opacity': 0.1 } });
            this.map.addLayer({ id: rectId + '-line', type: 'line', source: rectId, paint: { 'line-color': '#00e5ff', 'line-width': 2, 'line-dasharray': [6, 4] } });
        }

        const onMouseDown = (e) => {
            if (!e.originalEvent.shiftKey && !e.originalEvent.ctrlKey) return;
            startLngLat = e.lngLat; dragging = true; this.map.dragPan.disable();
        };
        const onMouseMove = (e) => {
            if (!dragging || !startLngLat) return;
            this._updateRectGeoJSON(rectId, startLngLat, e.lngLat);
        };
        const onMouseUp = (e) => {
            if (!dragging || !startLngLat) return;
            this.map.dragPan.enable(); dragging = false;
            const w = Math.min(startLngLat.lng, e.lngLat.lng), s = Math.min(startLngLat.lat, e.lngLat.lat);
            const east = Math.max(startLngLat.lng, e.lngLat.lng), n = Math.max(startLngLat.lat, e.lngLat.lat);
            startLngLat = null;

            const p1 = this.map.project([w, s]), p2 = this.map.project([east, n]);
            const size = Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2);
            if (size < 10) { this.map.getSource(rectId)?.setData({ type: 'FeatureCollection', features: [] }); return; }

            this._selectFeaturesInBounds([w, s, east, n], e.originalEvent?.shiftKey);
            setTimeout(() => { this.map.getSource(rectId)?.setData({ type: 'FeatureCollection', features: [] }); }, 400);
        };

        this.map.on('mousedown', onMouseDown);
        this.map.on('mousemove', onMouseMove);
        this.map.on('mouseup', onMouseUp);

        this._rectSelectCleanup = () => {
            this.map.off('mousedown', onMouseDown);
            this.map.off('mousemove', onMouseMove);
            this.map.off('mouseup', onMouseUp);
            if (this.map.getLayer(rectId + '-fill')) this.map.removeLayer(rectId + '-fill');
            if (this.map.getLayer(rectId + '-line')) this.map.removeLayer(rectId + '-line');
            if (this.map.getSource(rectId)) this.map.removeSource(rectId);
            this.map.dragPan.enable();
        };
    }

    _selectFeaturesInBounds(bbox, addToExisting) {
        if (!addToExisting) {
            for (const lid of this._selections.keys()) this._selections.set(lid, new Set());
        }
        const [west, south, east, north] = bbox;
        const bboxPoly = turf.bboxPolygon([west, south, east, north]);

        for (const [layerId, info] of this.dataLayers) {
            const firstLayer = info.layerIds[0];
            if (firstLayer && this.map.getLayoutProperty(firstLayer, 'visibility') === 'none') continue;
            if (!this._selections.has(layerId)) this._selections.set(layerId, new Set());
            const sel = this._selections.get(layerId);

            for (const f of info.geojson.features) {
                if (!f.geometry) continue;
                const idx = f.properties?._featureIndex;
                if (idx === undefined) continue;
                try {
                    if (turf.booleanIntersects(f, bboxPoly)) sel.add(idx);
                } catch {
                    try { const c = turf.centroid(f); if (turf.booleanPointInPolygon(c, bboxPoly)) sel.add(idx); } catch {}
                }
            }
            this._renderSelectionHighlights(layerId);
        }

        const total = this.getTotalSelectionCount();
        bus.emit('selection:changed', { totalCount: total });
        if (total > 0) logger.info('Map', `Box selected ${total} feature(s)`);
    }

    _renderSelectionHighlights(layerId) {
        const selSrcId = `selection-${layerId}`;
        for (const lid of [`${selSrcId}-fill`, `${selSrcId}-line`, `${selSrcId}-circle`]) {
            if (this.map.getLayer(lid)) this.map.removeLayer(lid);
        }
        if (this.map.getSource(selSrcId)) this.map.removeSource(selSrcId);

        const sel = this._selections.get(layerId);
        if (!sel || sel.size === 0) return;
        const info = this.dataLayers.get(layerId);
        if (!info) return;

        const selectedFeatures = info.geojson.features.filter(f => sel.has(f.properties?._featureIndex));
        if (selectedFeatures.length === 0) return;

        this.map.addSource(selSrcId, { type: 'geojson', data: { type: 'FeatureCollection', features: selectedFeatures } });
        this.map.addLayer({ id: `${selSrcId}-fill`, type: 'fill', source: selSrcId, filter: ['==', '$type', 'Polygon'], paint: { 'fill-color': '#00e5ff', 'fill-opacity': 0.35 } });
        this.map.addLayer({ id: `${selSrcId}-line`, type: 'line', source: selSrcId, paint: { 'line-color': '#00e5ff', 'line-width': 3 } });
        this.map.addLayer({ id: `${selSrcId}-circle`, type: 'circle', source: selSrcId, filter: ['==', '$type', 'Point'], paint: { 'circle-radius': 8, 'circle-color': '#00e5ff', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 3, 'circle-opacity': 1 } });
    }

    getSelectedIndices(layerId) { return this._selections.get(layerId) ? [...this._selections.get(layerId)] : []; }
    getSelectedFeatures(layerId, geojson) {
        const indices = this.getSelectedIndices(layerId);
        if (indices.length === 0) return null;
        return { type: 'FeatureCollection', features: geojson.features.filter((_, i) => indices.includes(i)) };
    }
    getSelectionCount(layerId) { return this._selections.get(layerId)?.size || 0; }
    getTotalSelectionCount() { let t = 0; for (const s of this._selections.values()) t += s.size; return t; }

    clearSelection(layerId = null) {
        if (layerId) {
            this._selections.delete(layerId);
            const selSrcId = `selection-${layerId}`;
            for (const l of [`${selSrcId}-fill`, `${selSrcId}-line`, `${selSrcId}-circle`]) { if (this.map?.getLayer(l)) this.map.removeLayer(l); }
            if (this.map?.getSource(selSrcId)) this.map.removeSource(selSrcId);
        } else {
            for (const lid of this._selections.keys()) {
                const ss = `selection-${lid}`;
                for (const l of [`${ss}-fill`, `${ss}-line`, `${ss}-circle`]) { if (this.map?.getLayer(l)) this.map.removeLayer(l); }
                if (this.map?.getSource(ss)) this.map.removeSource(ss);
            }
            this._selections.clear();
        }
        bus.emit('selection:changed', { layerId, totalCount: this.getTotalSelectionCount() });
    }

    selectFeatures(layerId, indices) {
        this._selections.set(layerId, new Set(indices));
        this._renderSelectionHighlights(layerId);
        bus.emit('selection:changed', { layerId, count: indices.length, totalCount: this.getTotalSelectionCount() });
    }
    selectAll(layerId, geojson) { this.selectFeatures(layerId, geojson.features.map((_, i) => i)); }
    invertSelection(layerId, geojson) {
        const current = this._selections.get(layerId) || new Set();
        this.selectFeatures(layerId, geojson.features.map((_, i) => i).filter(i => !current.has(i)));
    }

    destroy() {
        this._cancelInteraction();
        this.clearSelection();
        if (this._selectionMode) this.exitSelectionMode();
        if (this.map) { this.map.remove(); this.map = null; }
        this.dataLayers.clear();
    }

    // ============================
    // Coordinate Search Control
    // ============================
    _initCoordSearch() {
        this._searchMarker = null;
        this._searchLatLng = null;

        const container = document.createElement('div');
        container.className = 'maplibregl-ctrl maplibregl-ctrl-group coord-search-control';

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.title = 'Search Coordinates';
        btn.className = 'coord-search-toggle';
        btn.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`;

        const panel = document.createElement('div');
        panel.className = 'coord-search-panel';
        panel.style.display = 'none';

        const input = document.createElement('input');
        input.type = 'text'; input.className = 'coord-search-input';
        input.placeholder = 'Enter coordinates…'; input.autocomplete = 'off';

        const goBtn = document.createElement('button');
        goBtn.className = 'coord-search-go'; goBtn.innerHTML = '→'; goBtn.title = 'Search';

        const clearBtn = document.createElement('button');
        clearBtn.className = 'coord-search-clear'; clearBtn.innerHTML = '✕'; clearBtn.title = 'Clear & close'; clearBtn.style.display = 'none';

        panel.append(input, goBtn, clearBtn);
        container.append(btn, panel);

        container.addEventListener('click', (e) => e.stopPropagation());
        container.addEventListener('dblclick', (e) => e.stopPropagation());

        btn.onclick = (e) => {
            e.preventDefault(); e.stopPropagation();
            const open = panel.style.display !== 'none';
            panel.style.display = open ? 'none' : 'flex';
            if (!open) setTimeout(() => input.focus(), 50);
        };

        const doSearch = () => {
            const val = input.value.trim();
            if (!val) return;
            const result = this._parseCoordinates(val);
            if (result) {
                this._placeSearchMarker(result.lat, result.lng, val, result.format);
                clearBtn.style.display = ''; input.blur();
            } else {
                input.style.outline = '2px solid #e74c3c';
                setTimeout(() => input.style.outline = '', 1200);
            }
        };

        goBtn.onclick = doSearch;
        input.onkeydown = (e) => {
            if (e.key === 'Enter') doSearch();
            if (e.key === 'Escape') panel.style.display = 'none';
        };
        clearBtn.onclick = () => {
            this._clearSearchMarker();
            input.value = ''; clearBtn.style.display = 'none'; panel.style.display = 'none';
        };

        const ctrl = { onAdd: () => container, onRemove: () => container.remove() };
        this.map.addControl(ctrl, 'top-left');
    }

    _parseCoordinates(input) {
        const s = input.trim();
        const ddMatch = s.match(/^([+-]?\d+\.?\d*)[,\s]+([+-]?\d+\.?\d*)$/);
        if (ddMatch) {
            const a = parseFloat(ddMatch[1]), b = parseFloat(ddMatch[2]);
            if (Math.abs(a) <= 90 && Math.abs(b) <= 180) return { lat: a, lng: b, format: 'DD' };
            if (Math.abs(b) <= 90 && Math.abs(a) <= 180) return { lat: b, lng: a, format: 'DD' };
        }
        const dmsRegex = /(\d+)[°]\s*(\d+)[′']\s*(\d+\.?\d*)[″"]\s*([NSEW])/gi;
        const dmsMatches = [...s.matchAll(dmsRegex)];
        if (dmsMatches.length >= 2) {
            const parse = (m) => { let dd = parseInt(m[1]) + parseInt(m[2]) / 60 + parseFloat(m[3]) / 3600; if (m[4].toUpperCase() === 'S' || m[4].toUpperCase() === 'W') dd = -dd; return dd; };
            const v1 = parse(dmsMatches[0]), v2 = parse(dmsMatches[1]);
            const d1 = dmsMatches[0][4].toUpperCase();
            const lat = (d1 === 'N' || d1 === 'S') ? v1 : v2;
            const lng = (d1 === 'E' || d1 === 'W') ? v1 : v2;
            if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng, format: 'DMS' };
        }
        const dmsPlain = /(-?\d+)\s+(\d+)\s+(\d+\.?\d*)\s*([NSEW])[,\s]+(-?\d+)\s+(\d+)\s+(\d+\.?\d*)\s*([NSEW])/i;
        const dpMatch = s.match(dmsPlain);
        if (dpMatch) {
            let lat = parseInt(dpMatch[1]) + parseInt(dpMatch[2]) / 60 + parseFloat(dpMatch[3]) / 3600;
            if (dpMatch[4].toUpperCase() === 'S') lat = -lat;
            let lng = parseInt(dpMatch[5]) + parseInt(dpMatch[6]) / 60 + parseFloat(dpMatch[7]) / 3600;
            if (dpMatch[8].toUpperCase() === 'W') lng = -lng;
            if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng, format: 'DMS' };
        }
        const ddmRegex = /(\d+)[°]\s*(\d+\.?\d*)[′']\s*([NSEW])/gi;
        const ddmMatches = [...s.matchAll(ddmRegex)];
        if (ddmMatches.length >= 2) {
            const parse = (m) => { let dd = parseInt(m[1]) + parseFloat(m[2]) / 60; if (m[3].toUpperCase() === 'S' || m[3].toUpperCase() === 'W') dd = -dd; return dd; };
            const v1 = parse(ddmMatches[0]), v2 = parse(ddmMatches[1]);
            const d1 = ddmMatches[0][3].toUpperCase();
            const lat = (d1 === 'N' || d1 === 'S') ? v1 : v2;
            const lng = (d1 === 'E' || d1 === 'W') ? v1 : v2;
            if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng, format: 'DDM' };
        }
        const gUrlMatch = s.match(/@([+-]?\d+\.?\d*),([+-]?\d+\.?\d*)/);
        if (gUrlMatch) {
            const lat = parseFloat(gUrlMatch[1]), lng = parseFloat(gUrlMatch[2]);
            if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng, format: 'URL' };
        }
        return null;
    }

    _placeSearchMarker(lat, lng, inputText, format) {
        this._clearSearchMarker();
        this._searchLatLng = { lat, lng, inputText, format };

        const el = document.createElement('div');
        el.className = 'coord-search-marker';
        el.innerHTML = `<svg viewBox="0 0 24 36" width="28" height="42"><path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 24 12 24s12-15 12-24C24 5.4 18.6 0 12 0z" fill="#e74c3c" stroke="#fff" stroke-width="1.5"/><circle cx="12" cy="11" r="4.5" fill="#fff"/></svg>`;

        this._searchMarker = new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([lng, lat]).addTo(this.map);

        const popup = new maplibregl.Popup({ maxWidth: '280px' }).setHTML(this._buildSearchPopup(lat, lng, format));
        this._searchMarker.setPopup(popup);
        popup.addTo(this.map);
        this.map.flyTo({ center: [lng, lat], zoom: Math.max(this.map.getZoom(), 14) });
    }

    _buildSearchPopup(lat, lng, format) {
        return `
            <div class="coord-popup-content">
                <div style="font-weight:600;margin-bottom:4px;">📍 ${format} Coordinate</div>
                <div style="font-size:12px;color:#666;margin-bottom:8px;font-family:monospace;">${lat.toFixed(6)}, ${lng.toFixed(6)}</div>
                <div style="display:flex;flex-direction:column;gap:4px;">
                    <button class="coord-popup-btn coord-add-new" onclick="window.app._coordSearchAddNew()">＋ Add as New Layer</button>
                    <button class="coord-popup-btn coord-add-existing" onclick="window.app._coordSearchAddToExisting()">↳ Add to Existing Layer</button>
                    <button class="coord-popup-btn coord-dismiss" onclick="window.app._coordSearchClear()">✕ Dismiss</button>
                </div>
            </div>`;
    }

    _clearSearchMarker() {
        if (this._searchMarker) { this._searchMarker.remove(); this._searchMarker = null; }
        this._searchLatLng = null;
    }

    getSearchLatLng() { return this._searchLatLng; }

    // ============================
    // Measure Tool
    // ============================
    _initMeasureTool() {
        this._measureActive = false;
        this._measurePoints = [];
        this._measureMarkers = [];
        this._measureUnit = 'feet';
        this._measureSourceId = '__measure-line';
        this._measureLayerId = '__measure-line-layer';
        this._measureNodeLayerId = '__measure-node-layer';
        this._measureLabelEl = null;

        const UNITS = [
            { key: 'feet', label: 'Feet', turfUnit: 'feet' },
            { key: 'miles', label: 'Miles', turfUnit: 'miles' },
            { key: 'meters', label: 'Meters', turfUnit: 'meters' },
            { key: 'kilometers', label: 'Kilometers', turfUnit: 'kilometers' }
        ];

        // Build control container
        const container = document.createElement('div');
        container.className = 'maplibregl-ctrl maplibregl-ctrl-group measure-control';

        // Toggle button
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.title = 'Measure Distance';
        btn.className = 'measure-toggle';
        btn.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="7" width="22" height="10" rx="2"/><line x1="5" y1="7" x2="5" y2="12"/><line x1="9" y1="7" x2="9" y2="14"/><line x1="13" y1="7" x2="13" y2="12"/><line x1="17" y1="7" x2="17" y2="14"/><line x1="21" y1="7" x2="21" y2="12"/></svg>`;

        // Panel (shows when active)
        const panel = document.createElement('div');
        panel.className = 'measure-panel';
        panel.style.display = 'none';

        // Unit selector
        const unitSel = document.createElement('select');
        unitSel.className = 'measure-unit-select';
        UNITS.forEach(u => {
            const opt = document.createElement('option');
            opt.value = u.key; opt.textContent = u.label;
            if (u.key === 'feet') opt.selected = true;
            unitSel.appendChild(opt);
        });

        // Distance readout
        const readout = document.createElement('div');
        readout.className = 'measure-readout';
        readout.textContent = '0.00 ft';

        // Clear button
        const clearBtn = document.createElement('button');
        clearBtn.className = 'measure-clear';
        clearBtn.innerHTML = '✕';
        clearBtn.title = 'Clear & close';

        panel.append(readout, unitSel, clearBtn);
        container.append(btn, panel);

        // Stop propagation so map clicks don't pass through
        panel.addEventListener('click', e => e.stopPropagation());
        panel.addEventListener('dblclick', e => e.stopPropagation());

        // Formatting helper
        const formatDist = (val, unit) => {
            const abbr = { feet: 'ft', miles: 'mi', meters: 'm', kilometers: 'km' };
            if (val >= 10) return `${Math.round(val).toLocaleString()} ${abbr[unit]}`;
            return `${val.toFixed(2)} ${abbr[unit]}`;
        };

        // Recalculate total distance
        const recalc = () => {
            if (this._measurePoints.length < 2) {
                readout.textContent = formatDist(0, this._measureUnit);
                return;
            }
            const line = turf.lineString(this._measurePoints);
            const turfUnit = UNITS.find(u => u.key === this._measureUnit)?.turfUnit || 'feet';
            const dist = turf.length(line, { units: turfUnit });
            readout.textContent = formatDist(dist, this._measureUnit);
        };

        // Update the map line source
        const updateLine = () => {
            const src = this.map.getSource(this._measureSourceId);
            if (!src) return;
            const geojson = {
                type: 'FeatureCollection',
                features: []
            };
            if (this._measurePoints.length >= 2) {
                geojson.features.push({
                    type: 'Feature',
                    geometry: { type: 'LineString', coordinates: this._measurePoints }
                });
            }
            // Add point nodes
            this._measurePoints.forEach(coord => {
                geojson.features.push({
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: coord }
                });
            });
            src.setData(geojson);
        };

        // Activate measure mode
        const activate = () => {
            this._measureActive = true;
            btn.classList.add('active');
            panel.style.display = 'flex';
            this.map.getCanvas().style.cursor = 'crosshair';

            // Add source + layers if not present
            if (!this.map.getSource(this._measureSourceId)) {
                this.map.addSource(this._measureSourceId, {
                    type: 'geojson',
                    data: { type: 'FeatureCollection', features: [] }
                });
                this.map.addLayer({
                    id: this._measureLayerId,
                    type: 'line',
                    source: this._measureSourceId,
                    filter: ['==', '$type', 'LineString'],
                    paint: {
                        'line-color': '#ff6600',
                        'line-width': 2.5,
                        'line-dasharray': [3, 2]
                    }
                });
                this.map.addLayer({
                    id: this._measureNodeLayerId,
                    type: 'circle',
                    source: this._measureSourceId,
                    filter: ['==', '$type', 'Point'],
                    paint: {
                        'circle-radius': 4.5,
                        'circle-color': '#ff6600',
                        'circle-stroke-width': 2,
                        'circle-stroke-color': '#1c1c1e'
                    }
                });
            }
        };

        // Deactivate & clean up
        const deactivate = () => {
            this._measureActive = false;
            btn.classList.remove('active');
            panel.style.display = 'none';
            this.map.getCanvas().style.cursor = '';
            this._measurePoints = [];
            this._measureMarkers.forEach(m => m.remove());
            this._measureMarkers = [];
            if (this.map.getLayer(this._measureLayerId)) this.map.removeLayer(this._measureLayerId);
            if (this.map.getLayer(this._measureNodeLayerId)) this.map.removeLayer(this._measureNodeLayerId);
            if (this.map.getSource(this._measureSourceId)) this.map.removeSource(this._measureSourceId);
            readout.textContent = formatDist(0, this._measureUnit);
        };

        // Map click handler for adding points
        this._measureClickHandler = (e) => {
            if (!this._measureActive) return;
            e._drawHandled = true;
            const coord = [e.lngLat.lng, e.lngLat.lat];
            this._measurePoints.push(coord);
            updateLine();
            recalc();
        };
        this.map.on('click', this._measureClickHandler);

        // Button toggles
        btn.onclick = (e) => {
            e.preventDefault(); e.stopPropagation();
            if (this._measureActive) deactivate();
            else activate();
        };

        unitSel.onchange = () => {
            this._measureUnit = unitSel.value;
            recalc();
        };

        clearBtn.onclick = (e) => {
            e.preventDefault(); e.stopPropagation();
            deactivate();
        };

        // Undo last point on right-click while measuring
        this.map.on('contextmenu', (e) => {
            if (!this._measureActive) return;
            e.preventDefault();
            if (this._measurePoints.length > 0) {
                this._measurePoints.pop();
                updateLine();
                recalc();
            }
        });

        const ctrl = { onAdd: () => container, onRemove: () => { deactivate(); container.remove(); } };
        this.map.addControl(ctrl, 'top-left');
    }
}

export const mapManager = new MapManager();
export default mapManager;
