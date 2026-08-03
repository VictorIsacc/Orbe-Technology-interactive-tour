(() => {
  "use strict";

  const POIS = window.ORBE_POIS || [];
  const GRANADA_CENTER = [37.1769, -3.5977];
  const DEMO_ROUTE = [
    [37.18235, -3.60115], [37.18180, -3.60094], [37.18120, -3.60071],
    [37.18055, -3.60045], [37.17985, -3.60016], [37.17920, -3.59990],
    [37.17855, -3.59964], [37.17795, -3.59945], [37.17740, -3.59925],
    [37.17685, -3.59905], [37.17635, -3.59868], [37.17610, -3.59805],
    [37.17625, -3.59733], [37.17665, -3.59655], [37.17692, -3.59588],
    [37.17738, -3.59520], [37.17778, -3.59446], [37.17810, -3.59355],
    [37.17835, -3.59265], [37.17855, -3.59175], [37.17875, -3.59070],
    [37.17894, -3.58945]
  ];

  const $ = (id) => document.getElementById(id);
  const els = {
    map: $("map"), mapFallback: $("mapFallback"), locationBadge: $("locationBadge"),
    modeBadge: $("modeBadge"), headingBadge: $("headingBadge"), compassBadge: $("compassBadge"), assistantState: $("assistantState"),
    assistantText: $("assistantText"), pulseOrb: $("pulseOrb"), gpsBtn: $("gpsBtn"),
    locateBtn: $("locateBtn"), centerBtn: $("centerBtn"), micBtn: $("micBtn"),
    nearbyBtn: $("nearbyBtn"), moreBtn: $("moreBtn"), demoBtn: $("demoBtn"),
    muteBtn: $("muteBtn"), travelMode: $("travelMode"), autoDiscover: $("autoDiscover"),
    nearestName: $("nearestName"), nearestMeta: $("nearestMeta"), openNearestBtn: $("openNearestBtn"),
    placesList: $("placesList"), poiCount: $("poiCount"), installBtn: $("installBtn"),
    poiDialog: $("poiDialog"), closeDialogBtn: $("closeDialogBtn"), dialogEmoji: $("dialogEmoji"),
    dialogCategory: $("dialogCategory"), dialogTitle: $("dialogTitle"), dialogDistance: $("dialogDistance"),
    dialogLong: $("dialogLong"), dialogSource: $("dialogSource"), speakPoiBtn: $("speakPoiBtn"),
    guidePoiBtn: $("guidePoiBtn"), toast: $("toast"),
    mobileSetup: $("mobileSetup"), mobileSetupText: $("mobileSetupText"), secureStatus: $("secureStatus"),
    prepareMobileBtn: $("prepareMobileBtn"), diagnosticsBtn: $("diagnosticsBtn"), diagnosticsPanel: $("diagnosticsPanel"),
    diagSecure: $("diagSecure"), diagGeo: $("diagGeo"), diagCompass: $("diagCompass"), diagWake: $("diagWake"),
    diagProtocol: $("diagProtocol"), diagPermission: $("diagPermission")
  };

  const state = {
    map: null,
    userMarker: null,
    accuracyCircle: null,
    markerById: new Map(),
    current: null,
    previous: null,
    heading: null,
    watchId: null,
    gpsActive: false,
    mode: "walk",
    muted: false,
    speaking: false,
    selectedPoi: null,
    nearestPoi: null,
    destination: null,
    lastAnnouncementAt: 0,
    announcedAt: new Map(),
    lastUtterance: "",
    demoTimer: null,
    demoIndex: 0,
    installPrompt: null,
    recognition: null,
    compassActive: false,
    wakeLock: null,
    geoPermission: "desconocido"
  };

  function init() {
    initMap();
    renderPlaces();
    wireEvents();
    initRecognition();
    initInstall();
    registerServiceWorker();
    els.poiCount.textContent = `(${POIS.length})`;
    updateModeUI();
    initMobileEnvironment();
  }

  function initMap() {
    if (!window.L) {
      els.mapFallback.classList.remove("hidden");
      return;
    }
    state.map = L.map("map", { zoomControl: false, preferCanvas: true }).setView(GRANADA_CENTER, 15);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "© OpenStreetMap contributors"
    }).addTo(state.map);
    L.control.zoom({ position: "bottomleft" }).addTo(state.map);

    POIS.forEach((poi) => {
      const icon = L.divIcon({
        className: "",
        html: `<div class="poi-marker" title="${escapeHtml(poi.name)}">${poi.emoji}</div>`,
        iconSize: [34, 34], iconAnchor: [17, 17]
      });
      const marker = L.marker([poi.lat, poi.lon], { icon }).addTo(state.map);
      marker.bindTooltip(poi.name, { direction: "top", offset: [0, -12] });
      marker.on("click", () => openPoi(poi));
      state.markerById.set(poi.id, marker);
    });
  }

  function renderPlaces() {
    els.placesList.innerHTML = "";
    POIS.forEach((poi) => {
      const row = document.createElement("div");
      row.className = "place-row";
      row.innerHTML = `<div class="place-emoji">${poi.emoji}</div><div><strong>${escapeHtml(poi.name)}</strong><small>${escapeHtml(poi.category)}</small></div><button type="button">Ver</button>`;
      row.querySelector("button").addEventListener("click", () => openPoi(poi));
      els.placesList.appendChild(row);
    });
  }

  function wireEvents() {
    els.gpsBtn.addEventListener("click", toggleGps);
    els.locateBtn.addEventListener("click", toggleGps);
    els.centerBtn.addEventListener("click", centerOnUser);
    els.nearbyBtn.addEventListener("click", tellNearby);
    els.moreBtn.addEventListener("click", tellMore);
    els.demoBtn.addEventListener("click", toggleDemo);
    els.muteBtn.addEventListener("click", toggleMute);
    els.travelMode.addEventListener("change", () => {
      state.mode = els.travelMode.value;
      updateModeUI();
      say(`Modo ${state.mode === "car" ? "vehículo" : "caminando"} activado.`, { force: true, short: true });
    });
    els.openNearestBtn.addEventListener("click", () => state.nearestPoi && openPoi(state.nearestPoi));
    els.closeDialogBtn.addEventListener("click", () => els.poiDialog.close());
    els.speakPoiBtn.addEventListener("click", () => state.selectedPoi && say(state.selectedPoi.long, { force: true }));
    els.guidePoiBtn.addEventListener("click", () => state.selectedPoi && setDestination(state.selectedPoi));
    els.micBtn.addEventListener("click", listen);
    els.installBtn.addEventListener("click", installApp);
    els.prepareMobileBtn.addEventListener("click", prepareMobile);
    els.diagnosticsBtn.addEventListener("click", () => els.diagnosticsPanel.classList.toggle("hidden"));
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && state.gpsActive) acquireWakeLock();
    });
  }

  function initMobileEnvironment() {
    updateDiagnostics();
    queryGeoPermission();
    if (window.isSecureContext || location.protocol === "file:") {
      els.secureStatus.textContent = "GPS posible";
      els.secureStatus.className = "setup-chip good";
    } else {
      els.secureStatus.textContent = "Falta HTTPS";
      els.secureStatus.className = "setup-chip warn";
      els.mobileSetupText.textContent = "Esta copia se ha abierto sin HTTPS. El mapa funcionará, pero Chrome bloqueará el GPS. Sube la carpeta a un alojamiento HTTPS o instala la futura versión Android.";
      els.diagnosticsPanel.classList.remove("hidden");
    }
  }

  async function prepareMobile() {
    els.prepareMobileBtn.disabled = true;
    els.prepareMobileBtn.textContent = "Preparando…";
    try {
      await acquireWakeLock();
      await enableCompass();
      if (!state.gpsActive) await startGps();
      updateDiagnostics();
    } finally {
      els.prepareMobileBtn.disabled = false;
      els.prepareMobileBtn.textContent = "Preparar móvil";
    }
  }

  async function queryGeoPermission() {
    try {
      if (navigator.permissions && navigator.permissions.query) {
        const result = await navigator.permissions.query({ name: "geolocation" });
        state.geoPermission = result.state;
        result.onchange = () => { state.geoPermission = result.state; updateDiagnostics(); };
      }
    } catch (_) {
      state.geoPermission = "no consultable";
    }
    updateDiagnostics();
  }

  async function acquireWakeLock() {
    if (!("wakeLock" in navigator) || document.visibilityState !== "visible") {
      updateDiagnostics();
      return;
    }
    try {
      if (!state.wakeLock) {
        state.wakeLock = await navigator.wakeLock.request("screen");
        state.wakeLock.addEventListener("release", () => { state.wakeLock = null; updateDiagnostics(); });
      }
    } catch (_) { /* Puede estar bloqueado por ahorro de batería. */ }
    updateDiagnostics();
  }

  function releaseWakeLock() {
    if (state.wakeLock) state.wakeLock.release().catch(() => {});
    state.wakeLock = null;
  }

  async function enableCompass() {
    if (!("DeviceOrientationEvent" in window)) {
      updateDiagnostics();
      return;
    }
    try {
      if (typeof DeviceOrientationEvent.requestPermission === "function") {
        const permission = await DeviceOrientationEvent.requestPermission();
        if (permission !== "granted") return;
      }
      if (!state.compassActive) {
        window.addEventListener("deviceorientationabsolute", onDeviceOrientation, true);
        window.addEventListener("deviceorientation", onDeviceOrientation, true);
        state.compassActive = true;
      }
    } catch (_) { /* Algunos navegadores no permiten la brújula. */ }
    updateDiagnostics();
  }

  function onDeviceOrientation(event) {
    let heading = null;
    if (Number.isFinite(event.webkitCompassHeading)) heading = event.webkitCompassHeading;
    else if (Number.isFinite(event.alpha) && (event.absolute || event.type === "deviceorientationabsolute")) heading = (360 - event.alpha) % 360;
    if (!Number.isFinite(heading)) return;
    if (state.mode === "walk" || !Number.isFinite(state.heading)) state.heading = heading;
    els.compassBadge.textContent = `Brújula ${Math.round(heading)}°`;
    els.compassBadge.className = "badge badge-good";
    updateHeadingUI();
    updateDiagnostics();
  }

  function updateDiagnostics() {
    if (!els.diagSecure) return;
    const secure = window.isSecureContext || location.protocol === "file:";
    els.diagSecure.textContent = secure ? "Sí" : "No";
    els.diagGeo.textContent = navigator.geolocation ? "Compatible" : "No disponible";
    els.diagCompass.textContent = state.compassActive ? "Activada" : ("DeviceOrientationEvent" in window ? "Disponible" : "No disponible");
    els.diagWake.textContent = state.wakeLock ? "Sí" : ("wakeLock" in navigator ? "Disponible" : "No disponible");
    els.diagProtocol.textContent = location.protocol || "—";
    els.diagPermission.textContent = state.geoPermission;
  }

  function toggleGps() {
    if (state.gpsActive) stopGps(); else startGps();
  }

  async function startGps() {
    if (!navigator.geolocation) {
      showToast("Este dispositivo no ofrece geolocalización web.");
      return;
    }
    if (!window.isSecureContext && location.protocol !== "file:") {
      const msg = "El GPS del navegador requiere abrir Orbe desde una dirección HTTPS. Consulta el diagnóstico de la versión móvil.";
      showToast(msg);
      setAssistant("HTTPS necesario", msg);
      els.diagnosticsPanel.classList.remove("hidden");
      return;
    }
    stopDemo(false);
    await acquireWakeLock();
    await enableCompass();
    setAssistant("Solicitando permiso", "Orbe necesita la ubicación mientras utilizas la aplicación.");
    state.watchId = navigator.geolocation.watchPosition(onPosition, onGeoError, {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 2000
    });
    state.gpsActive = true;
    els.gpsBtn.innerHTML = "<span>■</span> Detener GPS";
    els.locateBtn.classList.add("active");
  }

  function stopGps() {
    if (state.watchId !== null) navigator.geolocation.clearWatch(state.watchId);
    state.watchId = null;
    state.gpsActive = false;
    els.gpsBtn.innerHTML = "<span>◎</span> Activar GPS";
    els.locateBtn.classList.remove("active");
    els.locationBadge.className = "badge badge-warn";
    els.locationBadge.textContent = "GPS detenido";
    releaseWakeLock();
    setAssistant("Ubicación detenida", "Puedes volver a activar el GPS o utilizar el recorrido de demostración.");
    updateDiagnostics();
  }

  function onGeoError(error) {
    const messages = {
      1: "Permiso de ubicación denegado. Actívalo en los permisos del navegador.",
      2: "No se ha podido determinar la ubicación.",
      3: "La localización está tardando demasiado. Inténtalo de nuevo al aire libre."
    };
    if (error.code === 1) state.geoPermission = "denied";
    updateDiagnostics();
    showToast(messages[error.code] || "Error de ubicación.");
    setAssistant("GPS no disponible", messages[error.code] || "No ha sido posible obtener la ubicación.");
    stopGps();
  }

  function onPosition(position) {
    const c = position.coords;
    const next = {
      lat: c.latitude,
      lon: c.longitude,
      accuracy: c.accuracy || 0,
      speed: Number.isFinite(c.speed) ? c.speed : null,
      timestamp: position.timestamp || Date.now(),
      source: "gps"
    };
    if (Number.isFinite(c.heading) && c.heading >= 0) state.heading = c.heading;
    state.geoPermission = "granted";
    updatePosition(next);
    updateDiagnostics();
    els.locationBadge.className = "badge badge-good";
    els.locationBadge.textContent = `GPS ±${Math.round(c.accuracy || 0)} m`;
  }

  function updatePosition(next) {
    state.previous = state.current;
    state.current = next;
    if (state.previous) {
      const moved = distanceMeters(state.previous, state.current);
      if ((!Number.isFinite(state.heading) || state.current.source === "demo") && moved > 2) {
        state.heading = bearingDegrees(state.previous, state.current);
      }
    }
    updateUserMarker();
    updateHeadingUI();
    updateNearest();
    maybeAnnounce();
    updateDestination();
  }

  function updateUserMarker() {
    if (!state.map || !state.current) return;
    const latlng = [state.current.lat, state.current.lon];
    if (!state.userMarker) {
      const icon = L.divIcon({ className: "", html: '<div class="user-marker"></div>', iconSize: [34, 34], iconAnchor: [17, 17] });
      state.userMarker = L.marker(latlng, { icon, zIndexOffset: 1000 }).addTo(state.map);
      state.accuracyCircle = L.circle(latlng, { radius: Math.max(state.current.accuracy || 8, 8), weight: 1, color: "#61e7ff", fillColor: "#61e7ff", fillOpacity: .08 }).addTo(state.map);
      state.map.setView(latlng, 16);
    } else {
      state.userMarker.setLatLng(latlng);
      state.accuracyCircle.setLatLng(latlng).setRadius(Math.max(state.current.accuracy || 8, 8));
    }
    const markerElement = state.userMarker.getElement();
    const userDot = markerElement && markerElement.querySelector(".user-marker");
    if (userDot) userDot.style.setProperty("--heading", `${Number.isFinite(state.heading) ? state.heading : 0}deg`);
  }

  function centerOnUser() {
    if (!state.current) {
      showToast("Activa el GPS o el modo demostración.");
      return;
    }
    if (state.map) state.map.setView([state.current.lat, state.current.lon], 17, { animate: true });
  }

  function updateHeadingUI() {
    if (!Number.isFinite(state.heading)) {
      els.headingBadge.textContent = "Rumbo —";
      return;
    }
    els.headingBadge.textContent = `Rumbo ${Math.round(state.heading)}° ${cardinal(state.heading)}`;
  }

  function updateModeUI() {
    const car = state.mode === "car";
    els.modeBadge.textContent = car ? "Vehículo" : "Caminando";
    els.travelMode.value = state.mode;
  }

  function updateNearest() {
    if (!state.current) return;
    const ranked = rankedPois();
    const first = ranked[0];
    if (!first) return;
    state.nearestPoi = first.poi;
    els.nearestName.textContent = `${first.poi.emoji} ${first.poi.name}`;
    els.nearestMeta.textContent = `${formatDistance(first.distance)} · ${directionLabel(first.relative)}`;
    els.openNearestBtn.disabled = false;
  }

  function rankedPois() {
    if (!state.current) return [];
    return POIS.map((poi) => {
      const distance = distanceMeters(state.current, poi);
      const absoluteBearing = bearingDegrees(state.current, poi);
      const relative = Number.isFinite(state.heading) ? normalizeAngle(absoluteBearing - state.heading) : null;
      return { poi, distance, absoluteBearing, relative };
    }).sort((a, b) => a.distance - b.distance);
  }

  function maybeAnnounce() {
    if (!state.current || !els.autoDiscover.checked || state.muted || state.speaking) return;
    const now = Date.now();
    const minGap = state.mode === "car" ? 45000 : 28000;
    if (now - state.lastAnnouncementAt < minGap) return;

    const candidates = rankedPois().filter((item) => {
      const threshold = state.mode === "car" ? item.poi.radiusCar : item.poi.radiusWalk;
      const last = state.announcedAt.get(item.poi.id) || 0;
      const fresh = now - last > 15 * 60 * 1000;
      const directionOk = item.relative === null || state.mode === "walk" || Math.abs(item.relative) <= 105;
      return item.distance <= threshold && fresh && directionOk;
    });
    if (!candidates.length) return;

    candidates.sort((a, b) => announcementScore(a) - announcementScore(b));
    const best = candidates[0];
    const intro = buildSpatialIntro(best);
    say(`${intro} ${best.poi.short}`, { poi: best.poi });
    state.lastAnnouncementAt = now;
    state.announcedAt.set(best.poi.id, now);
  }

  function announcementScore(item) {
    const angularPenalty = item.relative === null ? 0 : Math.abs(item.relative) * 1.2;
    return item.distance + angularPenalty;
  }

  function buildSpatialIntro(item) {
    const dist = formatSpokenDistance(item.distance);
    if (item.relative === null) return `A ${dist},`;
    const dir = directionLabel(item.relative, true);
    if (dir === "delante") return `A ${dist}, delante de ti,`;
    if (dir === "detrás") return `A ${dist}, a tu espalda,`;
    return `A ${dist}, ${dir},`;
  }

  function tellNearby() {
    if (!state.current) {
      say("Todavía no conozco tu posición. Activa el GPS o inicia el recorrido de demostración.", { force: true });
      return;
    }
    const nearby = rankedPois().filter((x) => x.distance < (state.mode === "car" ? 900 : 650)).slice(0, 3);
    if (!nearby.length) {
      say("No tengo puntos de interés cargados en esta zona de la primera versión.", { force: true });
      return;
    }
    const parts = nearby.map((x) => `${x.poi.name}, a ${formatSpokenDistance(x.distance)} ${directionLabel(x.relative, true)}`);
    say(`Lo más próximo es: ${joinNatural(parts)}.`, { force: true });
  }

  function tellMore() {
    const poi = state.selectedPoi || state.nearestPoi;
    if (!poi) {
      say("Necesito conocer tu ubicación para saber qué lugar tienes más cerca.", { force: true });
      return;
    }
    state.selectedPoi = poi;
    say(poi.long, { force: true, poi });
  }

  function say(text, options = {}) {
    if (!text) return;
    state.lastUtterance = text;
    setAssistant(options.poi ? options.poi.name : "Orbe", text);
    if (state.muted && !options.force) return;
    if (!("speechSynthesis" in window)) {
      showToast("La voz sintetizada no está disponible en este navegador.");
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "es-ES";
    utterance.rate = state.mode === "car" ? 1.04 : 0.98;
    utterance.pitch = 1.02;
    const voices = window.speechSynthesis.getVoices();
    const spanish = voices.find((v) => /^es(-|_)/i.test(v.lang) && /google|microsoft|natural|premium/i.test(v.name)) || voices.find((v) => /^es(-|_)/i.test(v.lang));
    if (spanish) utterance.voice = spanish;
    utterance.onstart = () => {
      state.speaking = true;
      els.pulseOrb.classList.add("speaking");
      els.assistantState.textContent = "Orbe está hablando";
    };
    utterance.onend = utterance.onerror = () => {
      state.speaking = false;
      els.pulseOrb.classList.remove("speaking");
      els.assistantState.textContent = "Orbe está preparado";
    };
    window.speechSynthesis.speak(utterance);
  }

  function toggleMute() {
    state.muted = !state.muted;
    if (state.muted && "speechSynthesis" in window) window.speechSynthesis.cancel();
    els.muteBtn.innerHTML = state.muted ? "<span>🔇</span> Voz silenciada" : "<span>🔊</span> Voz activada";
    showToast(state.muted ? "Orbe queda en silencio." : "Voz de Orbe activada.");
  }

  function initRecognition() {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) return;
    const recognition = new Recognition();
    recognition.lang = "es-ES";
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.onstart = () => {
      els.micBtn.classList.add("listening");
      els.micBtn.innerHTML = "<span>●</span> Escuchando…";
      setAssistant("Escuchando", "Puedes preguntarme qué hay cerca, dónde estás o pedirme información sobre un lugar.");
    };
    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      setAssistant("He entendido", `«${transcript}»`);
      handleCommand(transcript);
    };
    recognition.onerror = (event) => showToast(event.error === "not-allowed" ? "Permiso de micrófono denegado." : "No he podido entenderte.");
    recognition.onend = () => {
      els.micBtn.classList.remove("listening");
      els.micBtn.innerHTML = "<span>●</span> Hablar con Orbe";
    };
    state.recognition = recognition;
  }

  function listen() {
    if (!state.recognition) {
      say("El reconocimiento de voz del navegador no está disponible. Puedes utilizar los botones de consulta.", { force: true });
      return;
    }
    if (state.speaking && "speechSynthesis" in window) window.speechSynthesis.cancel();
    try { state.recognition.start(); } catch (_) { /* ya estaba iniciado */ }
  }

  function handleCommand(raw) {
    const text = normalizeText(raw);
    if (/donde estoy|ubicacion|en que sitio/.test(text)) return answerWhere();
    if (/que hay cerca|sitios cerca|alrededor|que tengo cerca/.test(text)) return tellNearby();
    if (/cuentame mas|mas informacion|amplia/.test(text)) return tellMore();
    if (/callate|silencio|desactiva la voz/.test(text)) return toggleMute();
    if (/activa la voz|habla/.test(text) && state.muted) return toggleMute();
    if (/modo coche|modo vehiculo|voy conduciendo/.test(text)) return setMode("car");
    if (/modo paseo|modo andando|modo caminando|voy andando/.test(text)) return setMode("walk");
    if (/repite|repitelo/.test(text)) return say(state.lastUtterance || "Todavía no he dicho nada.", { force: true });
    if (/parking|aparcamiento|aparcar/.test(text)) return guideByWords("parking san agustin");
    if (/guiame|llevame|orientame|como llego/.test(text)) {
      const target = findPoiByText(text);
      if (target) return setDestination(target);
      return say("Dime el nombre de uno de los lugares incluidos, por ejemplo: guíame a la Alcaicería.", { force: true });
    }
    const mentioned = findPoiByText(text);
    if (mentioned) {
      state.selectedPoi = mentioned;
      return say(mentioned.long, { force: true, poi: mentioned });
    }
    say("En este primer prototipo puedo responder sobre la ubicación y los lugares cargados. La conversación abierta con inteligencia artificial se conectará en una fase posterior.", { force: true });
  }

  function answerWhere() {
    if (!state.current) return say("Aún no conozco tu ubicación. Activa el GPS o inicia la demostración.", { force: true });
    const first = rankedPois()[0];
    const accuracy = state.current.source === "demo" ? "posición simulada" : `una precisión aproximada de ${Math.round(state.current.accuracy || 0)} metros`;
    say(`Estás a ${formatSpokenDistance(first.distance)} de ${first.poi.name}, con ${accuracy}.`, { force: true });
  }

  function setMode(mode) {
    state.mode = mode;
    updateModeUI();
    say(`He activado el modo ${mode === "car" ? "vehículo" : "caminando"}.`, { force: true });
  }

  function guideByWords(words) {
    const poi = findPoiByText(words);
    if (poi) setDestination(poi);
  }

  function findPoiByText(text) {
    const normalized = normalizeText(text);
    let best = null;
    let score = 0;
    for (const poi of POIS) {
      const name = normalizeText(poi.name);
      const tokens = name.split(/\s+/).filter((t) => t.length > 3);
      const hits = tokens.filter((t) => normalized.includes(t)).length;
      const exact = normalized.includes(name) ? 10 : 0;
      const current = exact + hits;
      if (current > score) { score = current; best = poi; }
    }
    return score > 0 ? best : null;
  }

  function setDestination(poi) {
    state.destination = poi;
    state.selectedPoi = poi;
    if (!state.current) {
      say(`He seleccionado ${poi.name}. Activa la ubicación para orientarte.`, { force: true });
      return;
    }
    const d = distanceMeters(state.current, poi);
    const b = bearingDegrees(state.current, poi);
    const rel = Number.isFinite(state.heading) ? normalizeAngle(b - state.heading) : null;
    say(`${poi.name} está a ${formatSpokenDistance(d)}, ${directionLabel(rel, true)}. Esta primera versión ofrece orientación aproximada en línea recta, no navegación giro a giro.`, { force: true });
    if (state.map) {
      const bounds = L.latLngBounds([[state.current.lat, state.current.lon], [poi.lat, poi.lon]]);
      state.map.fitBounds(bounds.pad(.35));
    }
    els.poiDialog.close();
  }

  function updateDestination() {
    if (!state.destination || !state.current) return;
    const d = distanceMeters(state.current, state.destination);
    if (d < 35) {
      say(`Has llegado al entorno de ${state.destination.name}.`, { force: true });
      state.destination = null;
    }
  }

  function openPoi(poi) {
    state.selectedPoi = poi;
    els.dialogEmoji.textContent = poi.emoji;
    els.dialogCategory.textContent = poi.category;
    els.dialogTitle.textContent = poi.name;
    els.dialogLong.textContent = poi.long;
    els.dialogSource.textContent = poi.sourceLabel;
    els.dialogSource.href = poi.sourceUrl;
    if (state.current) {
      const d = distanceMeters(state.current, poi);
      const rel = Number.isFinite(state.heading) ? normalizeAngle(bearingDegrees(state.current, poi) - state.heading) : null;
      els.dialogDistance.textContent = `${formatDistance(d)} · ${directionLabel(rel)}`;
    } else {
      els.dialogDistance.textContent = "Activa la ubicación para calcular la distancia.";
    }
    if (typeof els.poiDialog.showModal === "function") els.poiDialog.showModal();
    else els.poiDialog.setAttribute("open", "");
    if (state.map) state.map.panTo([poi.lat, poi.lon]);
  }

  function toggleDemo() {
    if (state.demoTimer) stopDemo(); else startDemo();
  }

  function startDemo() {
    if (state.gpsActive) stopGps();
    state.demoIndex = 0;
    state.current = null;
    state.previous = null;
    state.heading = null;
    state.announcedAt.clear();
    state.lastAnnouncementAt = 0;
    els.locationBadge.className = "badge badge-good";
    els.locationBadge.textContent = "Ruta simulada";
    els.demoBtn.innerHTML = "<span>■</span> Detener demo";
    setAssistant("Demostración iniciada", "Simulando un recorrido por Gran Vía hacia el centro y el Paseo de los Tristes.");
    stepDemo();
    state.demoTimer = window.setInterval(stepDemo, 2400);
  }

  function stepDemo() {
    if (state.demoIndex >= DEMO_ROUTE.length) {
      stopDemo(false);
      say("La demostración ha finalizado en el Paseo de los Tristes.", { force: true });
      return;
    }
    const [lat, lon] = DEMO_ROUTE[state.demoIndex++];
    updatePosition({ lat, lon, accuracy: 6, speed: state.mode === "car" ? 7 : 1.25, timestamp: Date.now(), source: "demo" });
    if (state.map) state.map.setView([lat, lon], state.mode === "car" ? 16 : 17, { animate: true });
  }

  function stopDemo(resetMessage = true) {
    if (state.demoTimer) window.clearInterval(state.demoTimer);
    state.demoTimer = null;
    els.demoBtn.innerHTML = "<span>▶</span> Recorrido demo";
    if (resetMessage) setAssistant("Demostración detenida", "Puedes reanudarla o activar el GPS real.");
  }

  function setAssistant(stateLabel, text) {
    els.assistantState.textContent = stateLabel;
    els.assistantText.textContent = text;
  }

  function initInstall() {
    window.addEventListener("beforeinstallprompt", (event) => {
      event.preventDefault();
      state.installPrompt = event;
      els.installBtn.classList.remove("hidden");
    });
    window.addEventListener("appinstalled", () => {
      state.installPrompt = null;
      els.installBtn.classList.add("hidden");
      showToast("Orbe se ha instalado correctamente.");
    });
  }

  async function installApp() {
    if (!state.installPrompt) return;
    state.installPrompt.prompt();
    await state.installPrompt.userChoice;
    state.installPrompt = null;
    els.installBtn.classList.add("hidden");
  }

  function registerServiceWorker() {
    if ("serviceWorker" in navigator && location.protocol !== "file:") {
      window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
    }
  }

  function distanceMeters(a, b) {
    const R = 6371000;
    const p1 = toRad(a.lat), p2 = toRad(b.lat);
    const dp = toRad(b.lat - a.lat), dl = toRad(b.lon - a.lon);
    const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  }

  function bearingDegrees(a, b) {
    const p1 = toRad(a.lat), p2 = toRad(b.lat), dl = toRad(b.lon - a.lon);
    const y = Math.sin(dl) * Math.cos(p2);
    const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
    return (toDeg(Math.atan2(y, x)) + 360) % 360;
  }

  function normalizeAngle(angle) { return ((angle + 540) % 360) - 180; }
  function toRad(v) { return v * Math.PI / 180; }
  function toDeg(v) { return v * 180 / Math.PI; }

  function directionLabel(relative, spoken = false) {
    if (!Number.isFinite(relative)) return spoken ? "sin orientación disponible" : "orientación no disponible";
    const a = Math.abs(relative);
    if (a <= 25) return "delante";
    if (a >= 155) return "detrás";
    if (relative > 0) return a <= 75 ? "a tu derecha, algo por delante" : "a tu derecha";
    return a <= 75 ? "a tu izquierda, algo por delante" : "a tu izquierda";
  }

  function cardinal(deg) {
    const names = ["N", "NE", "E", "SE", "S", "SO", "O", "NO"];
    return names[Math.round(deg / 45) % 8];
  }

  function formatDistance(m) {
    return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
  }

  function formatSpokenDistance(m) {
    if (m < 80) return `${Math.max(10, Math.round(m / 10) * 10)} metros`;
    if (m < 1000) return `${Math.round(m / 25) * 25} metros`;
    return `${(m / 1000).toFixed(1).replace(".", ",")} kilómetros`;
  }

  function joinNatural(items) {
    if (items.length < 2) return items[0] || "";
    return `${items.slice(0, -1).join(", ")} y ${items.at(-1)}`;
  }

  function normalizeText(text) {
    return String(text).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9ñ\s]/g, " ").replace(/\s+/g, " ").trim();
  }

  function escapeHtml(text) {
    return String(text).replace(/[&<>'"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c]));
  }

  let toastTimer;
  function showToast(text) {
    els.toast.textContent = text;
    els.toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove("show"), 3300);
  }

  init();
})();
