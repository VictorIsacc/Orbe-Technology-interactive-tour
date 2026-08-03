(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const EARTH = 6371000;
  const TILE = 256;
  const state = {
    recording: false,
    startedAt: 0,
    points: [],
    events: [],
    totalDistance: 0,
    lastPoint: null,
    currentPoint: null,
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
    intercepted: false
  };

  const ui = {
    panel: $("gpsLab"),
    state: $("labState"),
    start: $("labStartBtn"),
    mark: $("labMarkBtn"),
    clearDestination: $("labClearDestinationBtn"),
    export: $("labExportBtn"),
    clear: $("labClearBtn"),
    lat: $("labLat"),
    lon: $("labLon"),
    accuracy: $("labAccuracy"),
    speed: $("labSpeed"),
    gpsHeading: $("labGpsHeading"),
    compass: $("labCompass"),
    distance: $("labDistance"),
    duration: $("labDuration"),
    samples: $("labSamples"),
    destination: $("labDestination"),
    destinationDirection: $("labDestinationDirection"),
    lastEvent: $("labLastEvent"),
    quality: $("labQuality")
  };

  function toRad(value) { return value * Math.PI / 180; }
  function toDeg(value) { return value * 180 / Math.PI; }
  function normalizeAngle(value) { return ((value + 540) % 360) - 180; }

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

  function formatDistance(meters) {
    if (!Number.isFinite(meters)) return "—";
    return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(2).replace(".", ",")} km`;
  }

  function formatSpeed(ms) {
    if (!Number.isFinite(ms)) return "—";
    return `${(ms * 3.6).toFixed(1).replace(".", ",")} km/h`;
  }

  function formatHeading(value) {
    return Number.isFinite(value) ? `${Math.round(value)}°` : "—";
  }

  function bestHeading() {
    if (Number.isFinite(state.gpsHeading)) return state.gpsHeading;
    if (Number.isFinite(state.movementHeading)) return state.movementHeading;
    if (Number.isFinite(state.compassHeading)) return state.compassHeading;
    return null;
  }

  function directionLabel(relative) {
    if (!Number.isFinite(relative)) return "orientación no disponible";
    const abs = Math.abs(relative);
    if (abs <= 25) return "delante";
    if (abs >= 155) return "detrás";
    if (relative > 0) return abs <= 75 ? "derecha, algo por delante" : "derecha";
    return abs <= 75 ? "izquierda, algo por delante" : "izquierda";
  }

  function qualityLabel(accuracy) {
    if (!Number.isFinite(accuracy)) return { text: "Esperando GPS", className: "" };
    if (accuracy <= 8) return { text: "Excelente", className: "good" };
    if (accuracy <= 15) return { text: "Buena", className: "good" };
    if (accuracy <= 30) return { text: "Aceptable", className: "warn" };
    return { text: "Baja", className: "bad" };
  }

  function recordEvent(type, detail = "") {
    const point = state.currentPoint;
    const event = {
      time: new Date().toISOString(),
      type,
      detail,
      lat: point?.lat ?? null,
      lon: point?.lon ?? null,
      accuracy: point?.accuracy ?? null
    };
    state.events.push(event);
    if (ui.lastEvent) ui.lastEvent.textContent = detail ? `${type}: ${detail}` : type;
  }

  function handlePosition(position, source = "gps") {
    const coords = position.coords || position;
    const point = {
      timestamp: position.timestamp || Date.now(),
      lat: Number(coords.latitude ?? coords.lat),
      lon: Number(coords.longitude ?? coords.lon ?? coords.lng),
      accuracy: Number(coords.accuracy),
      altitude: Number.isFinite(coords.altitude) ? coords.altitude : null,
      altitudeAccuracy: Number.isFinite(coords.altitudeAccuracy) ? coords.altitudeAccuracy : null,
      speed: Number.isFinite(coords.speed) ? coords.speed : null,
      heading: Number.isFinite(coords.heading) && coords.heading >= 0 ? coords.heading : null,
      source
    };
    if (!Number.isFinite(point.lat) || !Number.isFinite(point.lon)) return;

    state.currentPoint = point;
    if (Number.isFinite(point.heading)) state.gpsHeading = point.heading;

    if (state.lastPoint) {
      const segment = distanceMeters(state.lastPoint, point);
      const elapsed = Math.max(0, point.timestamp - state.lastPoint.timestamp);
      const accuracyGate = Math.max(4, Math.min(25, ((point.accuracy || 0) + (state.lastPoint.accuracy || 0)) / 4));
      if (segment >= accuracyGate && segment <= 250 && elapsed <= 120000) {
        state.movementHeading = bearingDegrees(state.lastPoint, point);
        if (state.recording) state.totalDistance += segment;
      }
    }

    point.movementHeading = Number.isFinite(state.movementHeading) ? state.movementHeading : null;
    point.compassHeading = Number.isFinite(state.compassHeading) ? state.compassHeading : null;
    if (state.recording) {
      state.points.push(point);
    }
    state.lastPoint = point;
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
          return nativeWatch((position) => {
            handlePosition(position, "gps");
            success?.(position);
          }, error, options);
        }
      });
      if (nativeGet) {
        Object.defineProperty(geo, "getCurrentPosition", {
          configurable: true,
          value(success, error, options) {
            return nativeGet((position) => {
              handlePosition(position, "gps");
              success?.(position);
            }, error, options);
          }
        });
      }
      state.intercepted = true;
    } catch (_) {
      state.intercepted = false;
    }
  }

  function patchMapFactory() {
    if (!window.L?.map) return;
    const nativeMap = window.L.map;
    window.L.map = function patchedMap(...args) {
      const map = nativeMap.apply(this, args);
      state.map = map;
      window.ORBE_MAP = map;
      wireMapSelection(map);
      return map;
    };
  }

  function project(point, zoom) {
    const n = 2 ** zoom;
    const sin = Math.sin(Math.max(-85.05112878, Math.min(85.05112878, point.lat)) * Math.PI / 180);
    return {
      x: (point.lon + 180) / 360 * n * TILE,
      y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * n * TILE
    };
  }

  function unproject(pixel, zoom) {
    const world = 2 ** zoom * TILE;
    const lon = pixel.x / world * 360 - 180;
    const y = Math.PI - 2 * Math.PI * pixel.y / world;
    const lat = 180 / Math.PI * Math.atan(0.5 * (Math.exp(y) - Math.exp(-y)));
    return { lat, lon };
  }

  function mapPointToLatLon(map, clientX, clientY) {
    const rect = map.el.getBoundingClientRect();
    const center = { lat: map.center.lat, lon: map.center.lng };
    const centerPixel = project(center, map.zoom);
    return unproject({
      x: centerPixel.x + clientX - rect.left - rect.width / 2,
      y: centerPixel.y + clientY - rect.top - rect.height / 2
    }, map.zoom);
  }

  function wireMapSelection(map) {
    let start = null;
    map.el.addEventListener("pointerdown", (event) => {
      if (!state.markMode) return;
      start = { x: event.clientX, y: event.clientY };
    }, true);
    map.el.addEventListener("pointerup", (event) => {
      if (!state.markMode || !start) return;
      const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y);
      start = null;
      if (moved > 10) return;
      const target = mapPointToLatLon(map, event.clientX, event.clientY);
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
      const icon = L.divIcon({
        className: "",
        html: '<div class="lab-destination-marker" title="Destino de prueba">◆</div>',
        iconSize: [40, 40],
        iconAnchor: [20, 20]
      });
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
      (position) => handlePosition(position, "gps-laboratorio"),
      (error) => recordEvent("ERROR GPS", error.message || `Código ${error.code}`),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 1000 }
    );
  }

  function ensureAppGpsActive() {
    const gpsButton = $("gpsBtn");
    if (gpsButton && /activar gps/i.test(gpsButton.textContent || "")) gpsButton.click();
    startIndependentWatchIfNeeded();
  }

  function toggleRecording() {
    if (!state.recording) {
      state.recording = true;
      state.startedAt = Date.now();
      state.points = [];
      state.events = [];
      state.totalDistance = 0;
      state.lastPoint = null;
      ensureAppGpsActive();
      recordEvent("INICIO", "Prueba GPS iniciada");
      ui.start.textContent = "Detener registro";
      ui.start.classList.add("recording");
      ui.state.textContent = "Registrando";
      ui.state.className = "lab-chip good";
      state.timer = window.setInterval(render, 1000);
    } else {
      state.recording = false;
      recordEvent("FIN", "Prueba GPS detenida");
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
    state.startedAt = state.recording ? Date.now() : 0;
    state.lastPoint = state.currentPoint;
    recordEvent("LIMPIEZA", "Registro reiniciado");
    render();
  }

  function exportTxt() {
    if (!state.points.length && !state.events.length) {
      recordEvent("AVISO", "No hay datos para exportar");
      return;
    }
    const now = new Date();
    const lines = [
      "ORBE TECHNOLOGY · LABORATORIO GPS UNIVERSAL · V2.6",
      `Exportado: ${now.toLocaleString("es-ES")}`,
      `Muestras: ${state.points.length}`,
      `Distancia acumulada: ${formatDistance(state.totalDistance)}`,
      `Duración: ${formatDuration(state.startedAt ? Date.now() - state.startedAt : 0)}`,
      state.destination ? `Destino: ${state.destination.lat.toFixed(6)}, ${state.destination.lon.toFixed(6)}` : "Destino: no definido",
      "",
      "MUESTRAS GPS",
      "hora_iso\tlatitud\tlongitud\tprecision_m\tvelocidad_kmh\trumbo_gps\trumbo_movimiento\tbrujula\taltitud_m\tacumulado_m\tfuente"
    ];
    let accumulated = 0;
    let previous = null;
    for (const point of state.points) {
      if (previous) {
        const segment = distanceMeters(previous, point);
        const gate = Math.max(4, Math.min(25, ((point.accuracy || 0) + (previous.accuracy || 0)) / 4));
        if (segment >= gate && segment <= 250) accumulated += segment;
      }
      lines.push([
        new Date(point.timestamp).toISOString(),
        point.lat.toFixed(7),
        point.lon.toFixed(7),
        Number.isFinite(point.accuracy) ? point.accuracy.toFixed(1) : "",
        Number.isFinite(point.speed) ? (point.speed * 3.6).toFixed(2) : "",
        Number.isFinite(point.heading) ? point.heading.toFixed(1) : "",
        Number.isFinite(point.movementHeading) ? point.movementHeading.toFixed(1) : "",
        Number.isFinite(point.compassHeading) ? point.compassHeading.toFixed(1) : "",
        Number.isFinite(point.altitude) ? point.altitude.toFixed(1) : "",
        accumulated.toFixed(1),
        point.source
      ].join("\t"));
      previous = point;
    }
    lines.push("", "EVENTOS", "hora_iso\ttipo\tdetalle\tlatitud\tlongitud\tprecision_m");
    for (const event of state.events) {
      lines.push([
        event.time,
        event.type,
        String(event.detail || "").replace(/[\t\r\n]+/g, " "),
        Number.isFinite(event.lat) ? event.lat.toFixed(7) : "",
        Number.isFinite(event.lon) ? event.lon.toFixed(7) : "",
        Number.isFinite(event.accuracy) ? event.accuracy.toFixed(1) : ""
      ].join("\t"));
    }
    const blob = new Blob([lines.join("\r\n")], { type: "text/plain;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `Orbe_Laboratorio_GPS_${now.toISOString().replace(/[:.]/g, "-")}.txt`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    recordEvent("EXPORTACIÓN", "Registro TXT descargado");
  }

  function formatDuration(milliseconds) {
    const total = Math.max(0, Math.floor(milliseconds / 1000));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    return [hours, minutes, seconds].map((n) => String(n).padStart(2, "0")).join(":");
  }

  function renderDestination() {
    if (!state.destination) {
      ui.destination.textContent = "Sin destino";
      ui.destinationDirection.textContent = "Pulsa «Marcar destino» y toca el mapa.";
      return;
    }
    ui.destination.textContent = `${state.destination.lat.toFixed(5)}, ${state.destination.lon.toFixed(5)}`;
    if (!state.currentPoint) {
      ui.destinationDirection.textContent = "Esperando posición GPS.";
      return;
    }
    const distance = distanceMeters(state.currentPoint, state.destination);
    const bearing = bearingDegrees(state.currentPoint, state.destination);
    const heading = bestHeading();
    const relative = Number.isFinite(heading) ? normalizeAngle(bearing - heading) : null;
    ui.destinationDirection.textContent = `${formatDistance(distance)} · ${directionLabel(relative)} · rumbo ${Math.round(bearing)}°`;
  }

  function render() {
    const point = state.currentPoint;
    ui.lat.textContent = point ? point.lat.toFixed(7) : "—";
    ui.lon.textContent = point ? point.lon.toFixed(7) : "—";
    ui.accuracy.textContent = point && Number.isFinite(point.accuracy) ? `±${Math.round(point.accuracy)} m` : "—";
    ui.speed.textContent = point ? formatSpeed(point.speed) : "—";
    ui.gpsHeading.textContent = formatHeading(Number.isFinite(state.gpsHeading) ? state.gpsHeading : state.movementHeading);
    ui.compass.textContent = formatHeading(state.compassHeading);
    ui.distance.textContent = formatDistance(state.totalDistance);
    ui.duration.textContent = formatDuration(state.startedAt ? Date.now() - state.startedAt : 0);
    ui.samples.textContent = String(state.points.length);
    const quality = qualityLabel(point?.accuracy);
    ui.quality.textContent = quality.text;
    ui.quality.className = `lab-quality ${quality.className}`.trim();
    renderDestination();
  }

  function wireCompass() {
    const handler = (event) => {
      let heading = null;
      if (Number.isFinite(event.webkitCompassHeading)) heading = event.webkitCompassHeading;
      else if (Number.isFinite(event.alpha) && (event.absolute || event.type === "deviceorientationabsolute")) heading = (360 - event.alpha) % 360;
      if (!Number.isFinite(heading)) return;
      state.compassHeading = heading;
      render();
    };
    window.addEventListener("deviceorientationabsolute", handler, true);
    window.addEventListener("deviceorientation", handler, true);
  }

  function wireAnnouncements() {
    const assistantText = $("assistantText");
    if (!assistantText || !window.MutationObserver) return;
    const observer = new MutationObserver(() => {
      const text = assistantText.textContent.trim();
      if (!text || text === state.announcementText) return;
      state.announcementText = text;
      if (state.recording) recordEvent("ORBE", text);
    });
    observer.observe(assistantText, { childList: true, subtree: true, characterData: true });
  }

  function wireUi() {
    ui.start?.addEventListener("click", toggleRecording);
    ui.mark?.addEventListener("click", () => {
      if (!state.map) {
        recordEvent("AVISO", "El mapa todavía no está preparado");
        return;
      }
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
