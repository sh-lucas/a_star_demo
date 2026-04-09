// api.js — REST + WebSocket client para o total-map-backend
const API_BASE = 'http://localhost:3000';
// const API_BASE = 'https://api.totem.total.roxcode.io';

export let AUTH_TOKEN = '';

export function setAuthToken(token) {
    AUTH_TOKEN = token.trim();
}

// Sem auto-login, sem localStorage, sem loop.
// O token é colado pelo usuário no overlay de entrada.

// ─── Estado da conexão ───
let ws = null;
let currentFloorId = null;
let heartbeatTimer = null;
const messageHandlers = {}; // event -> [callback, ...]

// Cursor remoto: conn_id -> { x, y, email, userId }
export const remoteCursors = new Map();
// Clientes conectados: conn_id -> info
export const connectedClients = new Map();

// ─── REST helpers ───
async function apiFetch(path, opts = {}) {
    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${AUTH_TOKEN}`,
        ...opts.headers,
    };
    const res = await fetch(`${API_BASE}${path}`, { ...opts, headers });
    if (res.status === 204) return null;
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);
    return data;
}

// ─── REST API ───
export async function listFloors() {
    return apiFetch('/floors');
}

export async function getFloor(id) {
    return apiFetch(`/floors/${id}`);
}

export async function createFloor(name, backgroundSvg) {
    return apiFetch('/floors', {
        method: 'POST',
        body: JSON.stringify({ name, background_svg: backgroundSvg }),
    });
}

export async function updateFloor(id, name, backgroundSvg) {
    return apiFetch(`/floors/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ name, background_svg: backgroundSvg }),
    });
}

// ─── Event emitter ───
export function on(event, callback) {
    if (!messageHandlers[event]) messageHandlers[event] = [];
    messageHandlers[event].push(callback);
}

export function off(event, callback) {
    if (!messageHandlers[event]) return;
    messageHandlers[event] = messageHandlers[event].filter(cb => cb !== callback);
}

function emit(event, payload) {
    const handlers = messageHandlers[event] || [];
    handlers.forEach(cb => {
        try {
            console.log('[WS emit]', event, payload);
            cb(payload);
        } catch (e) {
            console.error(`[WS] Error in handler for ${event}:`, e);
        }
    });
}

// ─── WebSocket raw send ───
function send(event, payload) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        console.warn('[WS] Not connected, cannot send:', event);
        return;
    }
    ws.send(JSON.stringify({ event, payload }));
}

// ─── Heartbeat ───
// script.js takes care of keeping the connection alive via mouse:position
// events on mousemove. startHeartbeat/stopHeartbeat are kept as no-ops so
// the connect/disconnect flow doesn't need to change.
function startHeartbeat() { }
function stopHeartbeat() {
    if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
    }
}

// ─── WebSocket connect ───
// Token is passed as a query param because browser WebSocket API
// does not allow setting custom headers on the initial handshake.
// The backend AdminAuth middleware has been patched to accept ?token= for WS upgrades.
export function connect(floorId) {
    return new Promise((resolve, reject) => {
        if (ws) {
            ws.close();
            stopHeartbeat();
        }

        currentFloorId = floorId;
        remoteCursors.clear();
        connectedClients.clear();

        const wsBase = API_BASE.replace(/^http/, 'ws');
        const wsUrl = `${wsBase}/ws/${floorId}?token=${encodeURIComponent(AUTH_TOKEN)}`;

        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
            console.log(`[WS] Connected to floor ${floorId}`);
            startHeartbeat();
            resolve();
        };

        ws.onerror = (err) => {
            console.error('[WS] Connection error:', err);
            reject(new Error('WebSocket connection failed'));
        };

        ws.onclose = (evt) => {
            console.log(`[WS] Disconnected (code=${evt.code}, reason=${evt.reason})`);
            stopHeartbeat();
            emit('ws:close', { code: evt.code, reason: evt.reason });
        };

        ws.onmessage = (evt) => {
            let msg;
            try {
                msg = JSON.parse(evt.data);
            } catch (e) {
                console.error('[WS] Invalid JSON:', evt.data);
                return;
            }

            const { event, payload } = msg;

            // Built-in handling for presence + cursor events
            switch (event) {
                case 'client:joined':
                    connectedClients.set(payload.conn_id, payload);
                    console.log(`[WS] ${payload.email} joined floor`);
                    break;

                case 'client:left':
                    connectedClients.delete(payload.conn_id);
                    remoteCursors.delete(payload.conn_id);
                    console.log(`[WS] ${payload.email} left floor`);
                    break;

                case 'mouse:position':
                    // Only update remote cursors (we never receive our own).
                    // If x or y is null the sender is hiding its cursor.
                    if (payload.conn_id !== undefined) {
                        if (payload.x == null || payload.y == null) {
                            remoteCursors.delete(payload.conn_id);
                        } else {
                            remoteCursors.set(payload.conn_id, {
                                x: payload.x,
                                y: payload.y,
                                email: payload.email,
                                userId: payload.user_id,
                            });
                        }
                    }
                    break;

                case 'error':
                    console.error('[WS] Server error:', payload?.message);
                    break;
            }

            // Forward to registered handlers (script.js listeners)
            emit(event, payload);
        };
    });
}

export function disconnect() {
    stopHeartbeat();
    if (ws) {
        ws.close();
        ws = null;
    }
    currentFloorId = null;
}

export function isConnected() {
    return ws !== null && ws.readyState === WebSocket.OPEN;
}

// ─── WebSocket CRUD operations ───
export function wsAddPoint(x, y, type = 'path', establishmentId = null, mapIconSvg = null) {
    send('point:add', { x, y, type, establishment_id: establishmentId, map_icon_svg: mapIconSvg });
}

export function wsMovePoint(id, x, y) {
    send('point:move', { id, x, y });
}

export function wsUpdatePoint(id, type, establishmentId = null, mapIconSvg = null) {
    send('point:update', { id, type, establishment_id: establishmentId, map_icon_svg: mapIconSvg });
}

export function wsRemovePoint(id) {
    send('point:remove', { id });
}

export function wsAddEdge(fromPointId, toPointId, groupId = null) {
    send('edge:add', { from_point_id: fromPointId, to_point_id: toPointId, group_id: groupId });
}

export function wsRemoveEdge(id) {
    send('edge:remove', { id });
}

// x and y can be numbers (world coords) or null to hide this client's cursor.
export function sendMousePosition(x, y) {
    send('mouse:position', { x: x ?? null, y: y ?? null });
}

// ─── Establishment REST API ───
/**
 * Fetch the establishment linked to a point.
 * Returns null (instead of throwing) when there is no establishment yet (404).
 */
export async function getEstablishment(pointId) {
    try {
        return await apiFetch(`/points/${pointId}/establishment`);
    } catch (err) {
        if (err.message && err.message.includes('404')) return null;
        throw err;
    }
}

/**
 * Create or update the establishment for a point.
 * @param {number} pointId
 * @param {{ name: string, description?: string, opening_hours?: string }} fields
 * @param {File|null} bannerFile  - optional WebP image file for banner
 */
export async function upsertEstablishment(pointId, fields, bannerFile = null) {
    const form = new FormData();
    form.append('name', fields.name || '');
    if (fields.description) form.append('description', fields.description);
    if (fields.opening_hours) form.append('opening_hours', fields.opening_hours);
    if (bannerFile) form.append('banner', bannerFile);

    const res = await fetch(`${API_BASE}/points/${pointId}/establishment`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${AUTH_TOKEN}` },
        body: form,
    });
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || `HTTP ${res.status}`);
    }
    return res.json();
}

/**
 * Remove the establishment linked to a point.
 */
export async function deleteEstablishment(pointId) {
    const res = await fetch(`${API_BASE}/points/${pointId}/establishment`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${AUTH_TOKEN}` },
    });
    if (res.status === 204) return null;
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || `HTTP ${res.status}`);
    }
    return null;
}

export { API_BASE };
