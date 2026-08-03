(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const EARTH = 6371000;
  const TILE = 256;
  const state = {
    recording: false,
    startedAt: 0,
    stoppedAt: 0,
    points: [],
    events: [],
    totalDistance: 0,
    currentPoint: null,
    rawWindow: [],
    trackAnchor: null,
    movementHeading: null,
    gpsHeading: null,
    compassHeading: null,
    destination: null,
    destinationMarker: null,
    map: null,
    markMode: false,
    timer: null,
    announcementText: "",
    independentWatchId: null,
    intercepted: false,
    previousAutoDiscover: null
  };

  const ui = {
    state: $("labState"), start: $("labStartBtn"), mark: $("labMarkBtn"),
    clearDestination: $("labClearDestinationBtn"), export: $("labExportBtn"), clear: $("labClearBtn"),
    lat: $("labLat"), lon: $("labLon"), accuracy: $("labAccuracy"), speed: $("labSpeed"),
    gpsHeading: $("labGpsHeading"), compass: $("labCompass"), distance: $("labDistance"),
    duration: $("labDuration"), samples: $("labSamples"), destination: $("labDestination"),
    destinationDirection: $("labDestinationDirection"), lastEvent: $("labLastEvent"), quality: $("labQuality")
  };

  const toRad = (v) => v * Math.PI / 180;
  const toDeg = (v) => v * 180 / Math.PI;
  const normalizeAngle = (v) => ((v + 540) % 360) - 180;
  const median = (values) => {
    const a = values.filter(Number.isFinite).sort((x, y) => x - y);
    if (!a.length) return null;
    const m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  };

  function distanceMeters(a, b) {
    const p1 = toRad(a.lat), p2 = toRad(b.lat);
    const dp = toRad(b.lat - a.lat), dl = toRad(b.lon - a.lon);
    const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    return 2 * EARTH * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  }

  function bearingDegrees(a, b) {
    const p1 = toRad(a.lat), p2 = toRad(b.lat), dl = toRad(b.lon - a.lon);
    const y = Math.sin(dl) * Math.cos(p2);
    const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
    return (toDeg(Math.atan2(y, x)) + 360) % 360;
  }

  function formatDistance(m) {
    if (!Number.isFinite(m)) return "—";
    return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(2).replace(".", ",")} km`;
  }

  function formatSpeed(ms) {
    return Number.isFinite(ms) ? `${(ms * 3.6).toFixed(1).replace(".", ",")} km/h` : "—";
  }

  function formatHeading(v) {
    return Number.isFinite(v) ? `${Math.round(v)}°` : "—";
  }

  function elapsedMs() {
    if (!state.startedAt) return 0;
    return (state.recording ? Date.now() : state.stoppedAt || Date.now()) - state.startedAt;
  }

  function formatDuration(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
    return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
  }

  function directionLabel(relative) {
    if (!Number.isFinite(relative)) return "orientación no disponible";
    const a = Math.abs(relative);
    if (a <= 25) return "delante";
    if (a >= 155) return "detrás";
    if (relative > 0) return a <= 75 ? "derecha, algo por delante" : "derecha";
    return a <= 75 ? "izquierda, algo por delante" : "izquierda";
  }

  function qualityLabel(accuracy) {
    if (!Number.isFinite(accuracy)) return { text: "Esperando GPS", cls: "" };
    if (accuracy <= 5) return { text: "Excelente", cls: "good" };
    if (accuracy <= 10) return { text: "Buena", cls: "good" };
    if (accuracy <= 25) return { text: "Aceptable", cls: "warn" };
    return { text: "Baja", cls: "bad" };
  }

  function recordEvent(type, detail = "") {
    const p = state.currentPoint;
    state.events.push({
      time: new Date().toISOString(), type, detail,
      lat: p?.lat ?? null, lon: p?.lon ?? null, accuracy: p?.accuracy ?? null
    });
    if (ui.lastEvent) ui.lastEvent.textContent = detail ? `${type}: ${detail}` : type;
  }

  function smoothedPoint() {
    const recent = state.rawWindow.slice(-5);
    if (!recent.length) return null;
    return {
      timestamp: recent.at(-1).timestamp,
      lat: median(recent.map((p) => p.lat)),
      lon: median(recent.map((p) => p.lon)),
      accuracy: median(recent.map((p) => p.accuracy)) || recent.at(-1).accuracy,
      speed: recent.at(-1).speed
    };
  }

  function updateTrack(point) {
    state.rawWindow.push(point);
    if (state.rawWindow.length > 7) state.rawWindow.shift();
    const smooth = smoothedPoint();
    if (!smooth) return { accepted: 0, movementHeading: state.movementHeading };
    if (!state.trackAnchor) {
      state.trackAnchor = smooth;
      return { accepted: 0, movementHeading: state.movementHeading };
    }

    const segment = distanceMeters(state.trackAnchor, smooth);
    const elapsed = Math.max(0.001, (smooth.timestamp - state.trackAnchor.timestamp) / 1000);
    const accuracy = Math.max(smooth.accuracy || 0, state.trackAnchor.accuracy || 0);
    const gate = Math.max(2.5, Math.min(10, accuracy * 0.65));
    const impliedSpeed = segment / elapsed;
    const reportedSpeed = Number.isFinite(point.speed) ? point.speed : 0;
    const movementEvidence = reportedSpeed >= 0.30 || segment >= gate * 1.45 || elapsed >= 4;

    if (segment >= gate && segment <= 250 && elapsed <= 120 && impliedSpeed <= 25 && movementEvidence) {
      state.movementHeading = bearingDegrees(state.trackAnchor, smooth);
      state.trackAnchor = smooth;
      if (state.recording) state.totalDistance += segment;
      return { accepted: state.recording ? segment : 0, movementHeading: state.movementHeading };
    }
    return { accepted: 0, movementHeading: state.movementHeading };
  }

  function handlePosition(position, source = "gps") {
    const c = position.coords || position;
    const point = {
      timestamp: position.timestamp || Date.now(),
      lat: Number(c.latitude ?? c.lat), lon: Number(c.longitude ?? c.lon ?? c.lng),
      accuracy: Number.isFinite(Number(c.accuracy)) ? Number(c.accuracy) : null,
      altitude: Number.isFinite(c.altitude) ? c.altitude : null,
      altitudeAccuracy: Number.isFinite(c.altitudeAccuracy) ? c.altitudeAccuracy : null,
      speed: Number.isFinite(c.speed) ? c.speed : null,
      heading: Number.isFinite(c.heading) && c.heading >= 0 ? c.heading : null,
      source
    };
    if (!Number.isFinite(point.lat) || !Number.isFinite(point.lon)) return;

    state.currentPoint = point;
    if (Number.isFinite(point.heading)) state.gpsHeading = point.heading;
    const track = updateTrack(point);
    point.movementHeading = Number.isFinite(track.movementHeading) ? track.movementHeading : null;
    point.compassHeading = Number.isFinite(state.compassHeading) ? state.compassHeading : null;
    point.acceptedSegment = track.accepted;
    point.accumulated = state.totalDistance;
    if (state.recording) state.points.push(point);
    render();
  }

  function patchGeolocation() {
    if (!navigator.geolocation) return;
    const geo = navigator.geolocation;
    try {
      const nativeWatch = geo.watchPosition.bind(geo);
      const nativeGet = geo.getCurrentPosition?.bind(geo);
      Object.defineProperty(geo, "watchPosition", {
        configurable: true,
        value(success, error, options) {
          return nativeWatch((position) => { handlePosition(position, "gps"); success?.(position); }, error, options);
        }
      });
      if (nativeGet) Object.defineProperty(geo, "getCurrentPosition", {
        configurable: true,
        value(success, error, options) {
          return nativeGet((position) => { handlePosition(position, "gps"); success?.(position); }, error, options);
        }
      });
      state.intercepted = true;
    } catch (_) {
      state.intercepted = false;
    }
  }

  function patchMapFactory() {
    if (!window.L?.map) return;
    const nativeMap = window.L.map;
    window.L.map = function (...args) {
      const map = nativeMap.apply(this, args);
      state.map = map;
      wireMapSelection(map);
      return map;
    };
  }

  function project(point, zoom) {
    const n = 2 ** zoom;
    const s = Math.sin(Math.max(-85.05112878, Math.min(85.05112878, point.lat)) * Math.PI / 180);
    return { x: (point.lon + 180) / 360 * n * TILE, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n * TILE };
  }

  function unproject(pixel, zoom) {
    const world = 2 ** zoom * TILE;
    const lon = pixel.x / world * 360 - 180;
    const y = Math.PI - 2 * Math.PI * pixel.y / world;
    return { lat: 180 / Math.PI * Math.atan(0.5 * (Math.exp(y) - Math.exp(-y))), lon };
  }

  function mapPointToLatLon(map, x, y) {
    const rect = map.el.getBoundingClientRect();
    const cp = project({ lat: map.center.lat, lon: map.center.lng }, map.zoom);
    return unproject({ x: cp.x + x - rect.left - rect.width / 2, y: cp.y + y - rect.top - rect.height / 2 }, map.zoom);
  }

  function wireMapSelection(map) {
    let start = null;
    map.el.addEventListener("pointerdown", (e) => { if (state.markMode) start = { x: e.clientX, y: e.clientY }; }, true);
    map.el.addEventListener("pointerup", (e) => {
      if (!state.markMode || !start) return;
      const moved = Math.hypot(e.clientX - start.x, e.clientY - start.y);
      start = null;
      if (moved > 10) return;
      const target = mapPointToLatLon(map, e.clientX, e.clientY);
      setDestination(target.lat, target.lon);
      state.markMode = false;
      ui.mark?.classList.remove("active");
      if (ui.mark) ui.mark.textContent = "Marcar destino en el mapa";
    }, true);
  }

  function setDestination(lat, lon) {
    state.destination = { lat, lon };
    if (state.destinationMarker?.el) state.destinationMarker.el.remove();
    if (state.map && window.L) {
      const icon = L.divIcon({ className: "", html: '<div class="lab-destination-marker" title="Destino de prueba">◆</div>', iconSize: [40, 40], iconAnchor: [20, 20] });
      state.destinationMarker = L.marker([lat, lon], { icon, zIndexOffset: 1200 }).addTo(state.map);
    }
    recordEvent("DESTINO", `${lat.toFixed(6)}, ${lon.toFixed(6)}`);
    render();
  }

  function clearDestination() {
    if (state.destinationMarker?.el) state.destinationMarker.el.remove();
    state.destinationMarker = null;
    state.destination = null;
    state.markMode = false;
    ui.mark?.classList.remove("active");
    if (ui.mark) ui.mark.textContent = "Marcar destino en el mapa";
    recordEvent("DESTINO BORRADO");
    render();
  }

  function startIndependentWatchIfNeeded() {
    if (state.intercepted || state.independentWatchId !== null || !navigator.geolocation) return;
    state.independentWatchId = navigator.geolocation.watchPosition(
      (p) => handlePosition(p, "gps-laboratorio"),
      (e) => recordEvent("ERROR GPS", e.message || `Código ${e.code}`),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 1000 }
    );
  }

  function ensureAppGpsActive() {
    const button = $("gpsBtn");
    if (button && /activar gps/i.test(button.textContent || "")) button.click();
    startIndependentWatchIfNeeded();
  }

  function toggleRecording() {
    if (!state.recording) {
      state.recording = true;
      state.startedAt = Date.now();
      state.stoppedAt = 0;
      state.points = [];
      state.events = [];
      state.totalDistance = 0;
      state.rawWindow = [];
      state.trackAnchor = null;
      state.movementHeading = null;
      state.previousAutoDiscover = $("autoDiscover")?.checked ?? null;
      if ($("autoDiscover")) $("autoDiscover").checked = false;
      ensureAppGpsActive();
      recordEvent("INICIO", "Prueba GPS iniciada");
      ui.start.textContent = "Detener registro";
      ui.start.classList.add("recording");
      ui.state.textContent = "Registrando";
      ui.state.className = "lab-chip good";
      state.timer = window.setInterval(render, 1000);
    } else {
      state.recording = false;
      state.stoppedAt = Date.now();
      recordEvent("FIN", "Prueba GPS detenida");
      if ($("autoDiscover") && state.previousAutoDiscover !== null) $("autoDiscover").checked = state.previousAutoDiscover;
      ui.start.textContent = "Iniciar prueba GPS";
      ui.start.classList.remove("recording");
      ui.state.textContent = "Registro detenido";
      ui.state.className = "lab-chip warn";
      if (state.timer) window.clearInterval(state.timer);
      state.timer = null;
    }
    render();
  }

  function clearLog() {
    state.points = [];
    state.events = [];
    state.totalDistance = 0;
    state.rawWindow = [];
    state.trackAnchor = null;
    state.movementHeading = null;
    state.startedAt = state.recording ? Date.now() : 0;
    state.stoppedAt = 0;
    recordEvent("LIMPIEZA", "Registro reiniciado");
    render();
  }

  function bestHeading() {
    const speed = state.currentPoint?.speed;
    if (Number.isFinite(state.movementHeading)) return state.movementHeading;
    if (Number.isFinite(speed) && speed >= 1.0 && Number.isFinite(state.gpsHeading)) return state.gpsHeading;
    if (Number.isFinite(state.compassHeading)) return state.compassHeading;
    return Number.isFinite(state.gpsHeading) ? state.gpsHeading : null;
  }

  function exportTxt() {
    if (!state.points.length && !state.events.length) return recordEvent("AVISO", "No hay datos para exportar");
    const now = new Date();
    const accuracies = state.points.map((p) => p.accuracy).filter(Number.isFinite);
    const speeds = state.points.map((p) => p.speed).filter(Number.isFinite);
    const first = state.points[0], last = state.points.at(-1);
    const displacement = first && last ? distanceMeters(first, last) : 0;
    const lines = [
      "ORBE TECHNOLOGY · LABORATORIO GPS UNIVERSAL · V2.7",
      `Exportado: ${now.toLocaleString("es-ES")}`,
      `Muestras: ${state.points.length}`,
      `Distancia acumulada filtrada: ${formatDistance(state.totalDistance)}`,
      `Desplazamiento inicio-fin: ${formatDistance(displacement)}`,
      `Duración registrada: ${formatDuration(elapsedMs())}`,
      `Precisión media: ${accuracies.length ? (accuracies.reduce((a,b)=>a+b,0)/accuracies.length).toFixed(1) : "—"} m`,
      `Precisión mediana: ${accuracies.length ? median(accuracies).toFixed(1) : "—"} m`,
      `Velocidad máxima: ${speeds.length ? (Math.max(...speeds)*3.6).toFixed(2) : "—"} km/h`,
      state.destination ? `Destino: ${state.destination.lat.toFixed(6)}, ${state.destination.lon.toFixed(6)}` : "Destino: no definido",
      "",
      "MUESTRAS GPS",
      "hora_iso\tlatitud\tlongitud\tprecision_m\tvelocidad_kmh\trumbo_gps\trumbo_movimiento\tbrujula\taltitud_m\tsegmento_aceptado_m\tacumulado_m\tfuente"
    ];
    for (const p of state.points) {
      lines.push([
        new Date(p.timestamp).toISOString(), p.lat.toFixed(7), p.lon.toFixed(7),
        Number.isFinite(p.accuracy) ? p.accuracy.toFixed(1) : "",
        Number.isFinite(p.speed) ? (p.speed*3.6).toFixed(2) : "",
        Number.isFinite(p.heading) ? p.heading.toFixed(1) : "",
        Number.isFinite(p.movementHeading) ? p.movementHeading.toFixed(1) : "",
        Number.isFinite(p.compassHeading) ? p.compassHeading.toFixed(1) : "",
        Number.isFinite(p.altitude) ? p.altitude.toFixed(1) : "",
        Number.isFinite(p.acceptedSegment) ? p.acceptedSegment.toFixed(1) : "0.0",
        Number.isFinite(p.accumulated) ? p.accumulated.toFixed(1) : "0.0",
        p.source
      ].join("\t"));
    }
    lines.push("", "EVENTOS", "hora_iso\ttipo\tdetalle\tlatitud\tlongitud\tprecision_m");
    for (const e of state.events) lines.push([
      e.time, e.type, String(e.detail || "").replace(/[\t\r\n]+/g, " "),
      Number.isFinite(e.lat) ? e.lat.toFixed(7) : "",
      Number.isFinite(e.lon) ? e.lon.toFixed(7) : "",
      Number.isFinite(e.accuracy) ? e.accuracy.toFixed(1) : ""
    ].join("\t"));
    const blob = new Blob([lines.join("\r\n")], { type: "text/plain;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `Orbe_Laboratorio_GPS_V2_7_${now.toISOString().replace(/[:.]/g,"-")}.txt`;
    document.body.appendChild(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    recordEvent("EXPORTACIÓN", "Registro TXT descargado");
  }

  function renderDestination() {
    if (!state.destination) {
      ui.destination.textContent = "Sin destino";
      ui.destinationDirection.textContent = "Pulsa «Marcar destino» y toca el mapa.";
      return;
    }
    ui.destination.textContent = `${state.destination.lat.toFixed(5)}, ${state.destination.lon.toFixed(5)}`;
    if (!state.currentPoint) return void (ui.destinationDirection.textContent = "Esperando posición GPS.");
    const d = distanceMeters(state.currentPoint, state.destination);
    const b = bearingDegrees(state.currentPoint, state.destination);
    const h = bestHeading();
    const relative = Number.isFinite(h) ? normalizeAngle(b - h) : null;
    ui.destinationDirection.textContent = `${formatDistance(d)} · ${directionLabel(relative)} · rumbo ${Math.round(b)}°`;
  }

  function render() {
    const p = state.currentPoint;
    ui.lat.textContent = p ? p.lat.toFixed(7) : "—";
    ui.lon.textContent = p ? p.lon.toFixed(7) : "—";
    ui.accuracy.textContent = p && Number.isFinite(p.accuracy) ? `±${Math.round(p.accuracy)} m` : "—";
    ui.speed.textContent = p ? formatSpeed(p.speed) : "—";
    ui.gpsHeading.textContent = formatHeading(Number.isFinite(state.movementHeading) ? state.movementHeading : state.gpsHeading);
    ui.compass.textContent = formatHeading(state.compassHeading);
    ui.distance.textContent = formatDistance(state.totalDistance);
    ui.duration.textContent = formatDuration(elapsedMs());
    ui.samples.textContent = String(state.points.length);
    const q = qualityLabel(p?.accuracy);
    ui.quality.textContent = q.text;
    ui.quality.className = `lab-quality ${q.cls}`.trim();
    renderDestination();
  }

  function wireCompass() {
    const handler = (event) => {
      let heading = null;
      if (Number.isFinite(event.webkitCompassHeading)) heading = event.webkitCompassHeading;
      else if (Number.isFinite(event.alpha) && (event.absolute || event.type === "deviceorientationabsolute")) {
        const screenAngle = Number(screen.orientation?.angle ?? window.orientation ?? 0) || 0;
        heading = (360 - event.alpha + screenAngle + 360) % 360;
      }
      if (!Number.isFinite(heading)) return;
      state.compassHeading = heading;
      render();
    };
    window.addEventListener("deviceorientationabsolute", handler, true);
    window.addEventListener("deviceorientation", handler, true);
  }

  function wireAnnouncements() {
    const textEl = $("assistantText");
    if (!textEl || !window.MutationObserver) return;
    new MutationObserver(() => {
      const text = textEl.textContent.trim();
      if (!text || text === state.announcementText) return;
      state.announcementText = text;
      if (state.recording) recordEvent("ORBE", text);
    }).observe(textEl, { childList: true, subtree: true, characterData: true });
  }

  function wireUi() {
    ui.start?.addEventListener("click", toggleRecording);
    ui.mark?.addEventListener("click", () => {
      if (!state.map) return recordEvent("AVISO", "El mapa todavía no está preparado");
      state.markMode = !state.markMode;
      ui.mark.classList.toggle("active", state.markMode);
      ui.mark.textContent = state.markMode ? "Toca el punto del mapa" : "Marcar destino en el mapa";
      if (state.markMode) recordEvent("MODO DESTINO", "Esperando pulsación en el mapa");
    });
    ui.clearDestination?.addEventListener("click", clearDestination);
    ui.export?.addEventListener("click", exportTxt);
    ui.clear?.addEventListener("click", clearLog);
  }

  patchGeolocation();
  patchMapFactory();
  wireCompass();
  wireUi();
  wireAnnouncements();
  render();
})();
