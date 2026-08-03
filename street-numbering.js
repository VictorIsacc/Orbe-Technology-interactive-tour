(() => {
  "use strict";

  const CONFIG = Array.isArray(window.ORBE_STREET_NUMBERING_CONFIG)
    ? window.ORBE_STREET_NUMBERING_CONFIG.filter((item) => item?.enabled)
    : [];

  const $ = (id) => document.getElementById(id);
  const panel = $("streetNumberingPanel");
  const streetName = $("streetNumberingStreet");
  const messageEl = $("streetNumberingMessage");
  const noteEl = $("streetNumberingNote");
  const speakBtn = $("streetNumberingSpeakBtn");
  const latEl = $("labLat");
  const lonEl = $("labLon");
  const accuracyEl = $("labAccuracy");

  if (!panel || !streetName || !messageEl || !speakBtn || !latEl || !lonEl || !accuracyEl) return;

  const state = {
    position: null,
    accuracy: null,
    compassHeading: null,
    lastResult: null,
    scheduled: false
  };

  const EARTH = 6371000;
  const toRad = (value) => value * Math.PI / 180;
  const toDeg = (value) => value * 180 / Math.PI;
  const normalizeAngle = (value) => ((value + 540) % 360) - 180;

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

  function localPoint(origin, point) {
    const lat0 = toRad(origin.lat);
    return {
      x: toRad(point.lon - origin.lon) * Math.cos(lat0) * EARTH,
      y: toRad(point.lat - origin.lat) * EARTH
    };
  }

  function pointToSegmentDistance(point, start, end) {
    const p = localPoint(start, point);
    const b = localPoint(start, end);
    const length2 = b.x * b.x + b.y * b.y;
    if (!length2) return distanceMeters(point, start);
    const t = Math.max(0, Math.min(1, (p.x * b.x + p.y * b.y) / length2));
    return Math.hypot(p.x - b.x * t, p.y - b.y * t);
  }

  function parseNumber(text) {
    const value = Number(String(text || "").replace(/[^0-9,.-]/g, "").replace(",", "."));
    return Number.isFinite(value) ? value : null;
  }

  function updatePositionFromPanel() {
    const lat = parseNumber(latEl.textContent);
    const lon = parseNumber(lonEl.textContent);
    const accuracy = parseNumber(accuracyEl.textContent);
    state.position = Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
    state.accuracy = accuracy;
    scheduleEvaluate();
  }

  function orientationHeading(event) {
    if (Number.isFinite(event.webkitCompassHeading)) return event.webkitCompassHeading;
    if (Number.isFinite(event.alpha) && (event.absolute || event.type === "deviceorientationabsolute")) {
      const screenAngle = Number(screen.orientation?.angle ?? window.orientation ?? 0) || 0;
      return (360 - event.alpha + screenAngle + 360) % 360;
    }
    return null;
  }

  function onOrientation(event) {
    const heading = orientationHeading(event);
    if (!Number.isFinite(heading)) return;
    state.compassHeading = heading;
    scheduleEvaluate();
  }

  function invertSide(side) {
    return side === "left" ? "right" : "left";
  }

  function sideWord(side) {
    return side === "left" ? "izquierda" : "derecha";
  }

  function evaluateSegment(segment) {
    if (!state.position || !Number.isFinite(state.accuracy) || !Number.isFinite(state.compassHeading)) return null;
    if (state.accuracy > (segment.maxAccuracyMeters ?? 18)) return null;

    const distance = pointToSegmentDistance(state.position, segment.lowEnd, segment.highEnd);
    if (distance > (segment.maxDistanceMeters ?? 35)) return null;

    const increasingBearing = bearingDegrees(segment.lowEnd, segment.highEnd);
    const decreasingBearing = (increasingBearing + 180) % 360;
    const increasingError = Math.abs(normalizeAngle(state.compassHeading - increasingBearing));
    const decreasingError = Math.abs(normalizeAngle(state.compassHeading - decreasingBearing));
    const maxError = segment.maxHeadingErrorDegrees ?? 50;

    let increasing;
    let headingError;
    if (increasingError <= decreasingError) {
      increasing = true;
      headingError = increasingError;
    } else {
      increasing = false;
      headingError = decreasingError;
    }
    if (headingError > maxError) return null;

    const oddSide = increasing
      ? segment.oddSideWhenIncreasing
      : invertSide(segment.oddSideWhenIncreasing);
    if (oddSide !== "left" && oddSide !== "right") return null;
    const evenSide = invertSide(oddSide);

    const numberDirection = increasing ? "subiendo" : "bajando";
    let centerText = "";
    if (typeof segment.lowNumbersLeadToCenter === "boolean") {
      const towardLow = !increasing;
      const towardCenter = segment.lowNumbersLeadToCenter ? towardLow : !towardLow;
      centerText = towardCenter ? " vas hacia el centro." : " te alejas del centro.";
    }

    const message = `Los números están ${numberDirection}:${centerText} A la ${sideWord(oddSide)}, impares; a la ${sideWord(evenSide)}, pares.`
      .replace(":  A", ". A");

    return { segment, distance, headingError, increasing, message };
  }

  function evaluate() {
    state.scheduled = false;
    const candidates = CONFIG.map(evaluateSegment).filter(Boolean).sort((a, b) => a.distance - b.distance);
    const result = candidates[0] || null;
    state.lastResult = result;

    if (!result) {
      panel.classList.add("hidden");
      streetName.textContent = "—";
      messageEl.textContent = "";
      noteEl.textContent = "";
      speakBtn.disabled = true;
      return;
    }

    panel.classList.remove("hidden");
    streetName.textContent = result.segment.name;
    messageEl.textContent = result.message;
    noteEl.textContent = result.segment.note || "Orientación visual experimental basada en una configuración local verificada.";
    speakBtn.disabled = false;
  }

  function scheduleEvaluate() {
    if (state.scheduled) return;
    state.scheduled = true;
    window.requestAnimationFrame(evaluate);
  }

  function speakCurrent() {
    if (!state.lastResult?.message || !("speechSynthesis" in window)) return;
    const muted = /silenciada/i.test($("muteBtn")?.textContent || "");
    if (muted) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(state.lastResult.message);
    utterance.lang = "es-ES";
    utterance.rate = 0.97;
    const voices = window.speechSynthesis.getVoices();
    utterance.voice = voices.find((voice) => /^es(-|_)/i.test(voice.lang)) || null;
    window.speechSynthesis.speak(utterance);
  }

  new MutationObserver(updatePositionFromPanel).observe(latEl, { childList: true, subtree: true, characterData: true });
  new MutationObserver(updatePositionFromPanel).observe(lonEl, { childList: true, subtree: true, characterData: true });
  new MutationObserver(updatePositionFromPanel).observe(accuracyEl, { childList: true, subtree: true, characterData: true });
  window.addEventListener("deviceorientationabsolute", onOrientation, true);
  window.addEventListener("deviceorientation", onOrientation, true);
  speakBtn.addEventListener("click", speakCurrent);
  updatePositionFromPanel();
})();
