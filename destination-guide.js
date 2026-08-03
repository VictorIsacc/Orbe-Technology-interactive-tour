(() => {
  "use strict";

  const VERSION = "3.1";
  const $ = (id) => document.getElementById(id);
  const destinationEl = $("labDestination");
  const directionEl = $("labDestinationDirection");
  const actionsEl = document.querySelector("#gpsLab .lab-actions");
  const assistantState = $("assistantState");
  const assistantText = $("assistantText");
  const mapEl = $("map");

  if (!destinationEl || !directionEl || !actionsEl) return;

  const state = {
    autoEnabled: true,
    compassHeading: null,
    lastDestination: "",
    lastDirectionKey: "",
    lastSpokenAt: 0,
    directionTimer: null,
    speaking: false,
    initialAnnouncementDoneFor: ""
  };

  document.title = document.title.replace(/v\d+(?:\.\d+)?/i, `v${VERSION}`);
  const versionLabel = document.querySelector("#gpsLab .gps-lab-head small");
  if (versionLabel) versionLabel.textContent = `ORBE V${VERSION}`;

  const speakBtn = document.createElement("button");
  speakBtn.id = "labSpeakDirectionBtn";
  speakBtn.className = "action";
  speakBtn.type = "button";
  speakBtn.textContent = "Escuchar dirección";

  const autoBtn = document.createElement("button");
  autoBtn.id = "labAutoDirectionBtn";
  autoBtn.className = "action";
  autoBtn.type = "button";
  autoBtn.textContent = "Avisos al girar: activados";

  $("labSpeakDirectionBtn")?.remove();
  $("labAutoDirectionBtn")?.remove();
  const clearButton = $("labClearBtn");
  actionsEl.insertBefore(speakBtn, clearButton || null);
  actionsEl.insertBefore(autoBtn, clearButton || null);

  const toRad = (value) => value * Math.PI / 180;
  const toDeg = (value) => value * 180 / Math.PI;
  const normalizeAngle = (value) => ((value + 540) % 360) - 180;

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

  function parseNumber(text) {
    const match = String(text || "").replace(",", ".").match(/-?\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : null;
  }

  function currentPosition() {
    const lat = parseNumber($("labLat")?.textContent);
    const lon = parseNumber($("labLon")?.textContent);
    return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
  }

  function currentDestination() {
    const text = destinationEl.textContent.trim();
    if (!text || /sin destino/i.test(text)) return null;
    const values = text.replace(/,/g, ".").match(/-?\d+(?:\.\d+)?/g)?.map(Number) || [];
    return values.length >= 2 ? { lat: values[0], lon: values[1] } : null;
  }

  function currentSpeedKmh() {
    return parseNumber($("labSpeed")?.textContent);
  }

  function panelHeading() {
    return parseNumber($("labGpsHeading")?.textContent);
  }

  function effectiveHeading() {
    const speedKmh = currentSpeedKmh();
    const stationary = !Number.isFinite(speedKmh) || speedKmh < 3;
    if (stationary && Number.isFinite(state.compassHeading)) return state.compassHeading;
    const moving = panelHeading();
    if (Number.isFinite(moving)) return moving;
    return Number.isFinite(state.compassHeading) ? state.compassHeading : null;
  }

  function formatDistance(meters) {
    return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(2).replace(".", ",")} km`;
  }

  function directionKey(relative) {
    if (!Number.isFinite(relative)) return "unknown";
    const a = Math.abs(relative);
    if (a <= 25) return "front";
    if (a >= 155) return "back";
    if (relative > 0) return a <= 75 ? "front-right" : "right";
    return a <= 75 ? "front-left" : "left";
  }

  function spokenDirection(key) {
    return {
      front: "delante de ti",
      "front-right": "a tu derecha, algo por delante",
      "front-left": "a tu izquierda, algo por delante",
      right: "a tu derecha",
      left: "a tu izquierda",
      back: "detrás de ti"
    }[key] || "sin una orientación estable todavía";
  }

  function visibleDirection(key) {
    return {
      front: "delante",
      "front-right": "derecha, algo por delante",
      "front-left": "izquierda, algo por delante",
      right: "derecha",
      left: "izquierda",
      back: "detrás"
    }[key] || "orientación no disponible";
  }

  function calculateGuidance() {
    const from = currentPosition();
    const to = currentDestination();
    if (!from || !to) return null;
    const distance = distanceMeters(from, to);
    const bearing = bearingDegrees(from, to);
    const heading = effectiveHeading();
    const relative = Number.isFinite(heading) ? normalizeAngle(bearing - heading) : null;
    const key = directionKey(relative);
    return { distance, bearing, heading, relative, key };
  }

  function rotateUserMarker(heading) {
    const userDot = document.querySelector(".user-marker");
    if (userDot && Number.isFinite(heading)) userDot.style.setProperty("--heading", `${heading}deg`);
  }

  function renderGuidance() {
    const guidance = calculateGuidance();
    if (!guidance) return null;
    directionEl.textContent = `${formatDistance(guidance.distance)} · ${visibleDirection(guidance.key)} · rumbo ${Math.round(guidance.bearing)}°`;
    directionEl.dataset.directionKey = guidance.key;
    directionEl.dataset.effectiveHeading = Number.isFinite(guidance.heading) ? guidance.heading.toFixed(1) : "";
    return guidance;
  }

  function voiceMuted() {
    return /silenciada/i.test($("muteBtn")?.textContent || "");
  }

  function chooseVoice() {
    const voices = window.speechSynthesis?.getVoices?.() || [];
    return voices.find((voice) => /^es(-|_)/i.test(voice.lang) && /google|microsoft|natural|premium/i.test(voice.name))
      || voices.find((voice) => /^es(-|_)/i.test(voice.lang))
      || null;
  }

  function setAssistantMessage(label, text) {
    if (assistantState) assistantState.textContent = label;
    if (assistantText) assistantText.textContent = text;
  }

  function speak(text, force = false) {
    if (!text) return;
    setAssistantMessage("Orientación al destino", text);
    if (voiceMuted() && !force) return;
    if (!("speechSynthesis" in window)) return;
    if (state.speaking && !force) return;
    if (force) window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "es-ES";
    utterance.rate = 0.96;
    utterance.pitch = 1;
    const voice = chooseVoice();
    if (voice) utterance.voice = voice;
    utterance.onstart = () => { state.speaking = true; };
    utterance.onend = utterance.onerror = () => { state.speaking = false; };
    window.speechSynthesis.speak(utterance);
    state.lastSpokenAt = Date.now();
  }

  function announceCurrent(initial = false, force = false) {
    const guidance = renderGuidance();
    if (!guidance) {
      speak("Todavía no hay una posición y un destino válidos para calcular la dirección.", force);
      return;
    }
    state.lastDirectionKey = guidance.key;
    const text = initial
      ? `Destino seleccionado. Está a ${formatDistance(guidance.distance)}, ${spokenDirection(guidance.key)}.`
      : `Ahora el destino queda ${spokenDirection(guidance.key)}.`;
    speak(text, force);
  }

  function scheduleDirectionAnnouncement() {
    window.clearTimeout(state.directionTimer);
    state.directionTimer = window.setTimeout(() => {
      if (!state.autoEnabled || Date.now() - state.lastSpokenAt < 2200) return;
      const guidance = renderGuidance();
      if (!guidance || guidance.key === state.lastDirectionKey) return;
      announceCurrent(false, false);
    }, 700);
  }

  function onCompass(event) {
    let heading = null;
    if (Number.isFinite(event.webkitCompassHeading)) heading = event.webkitCompassHeading;
    else if (Number.isFinite(event.alpha) && (event.absolute || event.type === "deviceorientationabsolute")) {
      const screenAngle = Number(screen.orientation?.angle ?? window.orientation ?? 0) || 0;
      heading = (360 - event.alpha + screenAngle + 360) % 360;
    }
    if (!Number.isFinite(heading)) return;
    state.compassHeading = heading;
    rotateUserMarker(heading);
    const before = state.lastDirectionKey;
    const guidance = renderGuidance();
    if (guidance && guidance.key !== before) scheduleDirectionAnnouncement();
  }

  window.addEventListener("deviceorientationabsolute", onCompass, true);
  window.addEventListener("deviceorientation", onCompass, true);

  const destinationObserver = new MutationObserver(() => {
    const destination = destinationEl.textContent.trim();
    if (!destination || destination === state.lastDestination) return;
    state.lastDestination = destination;
    state.lastDirectionKey = "";
    state.initialAnnouncementDoneFor = "";
    renderGuidance();
  });
  destinationObserver.observe(destinationEl, { childList: true, subtree: true, characterData: true });

  mapEl?.addEventListener("pointerup", () => {
    queueMicrotask(() => {
      const destination = destinationEl.textContent.trim();
      if (!destination || /sin destino/i.test(destination)) return;
      if (destination === state.initialAnnouncementDoneFor) return;
      state.initialAnnouncementDoneFor = destination;
      announceCurrent(true, true);
    });
  }, true);

  speakBtn.addEventListener("click", () => announceCurrent(true, true));
  autoBtn.addEventListener("click", () => {
    state.autoEnabled = !state.autoEnabled;
    autoBtn.textContent = `Avisos al girar: ${state.autoEnabled ? "activados" : "desactivados"}`;
    setAssistantMessage("Orientación al destino",
      state.autoEnabled
        ? "Orbe avisará cuando el destino cambie de dirección al girarte."
        : "Los avisos automáticos al girar han quedado desactivados.");
  });

  window.ORBE_DESTINATION_GUIDE = {
    version: VERSION,
    speak: () => announceCurrent(true, true),
    refresh: renderGuidance,
    effectiveHeading
  };
})();
