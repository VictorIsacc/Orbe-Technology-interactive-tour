(() => {
  "use strict";

  const DEMO_INTERVAL = 2400;
  const EVENTS = [
    "parking-san-agustin",
    "catedral-capilla",
    "madraza",
    "calle-elvira",
    "plaza-nueva",
    "carrera-darro",
    "paseo-tristes"
  ];

  const nativeSetInterval = window.setInterval.bind(window);
  const nativeClearInterval = window.clearInterval.bind(window);
  const customIntervals = new Set();
  let demoRequested = false;
  let previousAutoDiscover = true;
  let eventIndex = 0;
  let selectedVoice = null;

  const $ = (id) => document.getElementById(id);
  const wait = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

  function isDemoButtonRunning() {
    return ($("demoBtn")?.textContent || "").toLowerCase().includes("detener");
  }

  function parseDistance(metaText) {
    const match = String(metaText || "").match(/([\d.,]+)\s*(m|km)/i);
    if (!match) return Infinity;
    const value = Number(match[1].replace(",", "."));
    return match[2].toLowerCase() === "km" ? value * 1000 : value;
  }

  function currentMode() {
    return $("travelMode")?.value === "car" ? "car" : "walk";
  }

  function findPoi(id) {
    return (window.ORBE_POIS || []).find((poi) => poi.id === id) || null;
  }

  function nearestMatches(poi) {
    const name = $("nearestName")?.textContent || "";
    if (!name.includes(poi.name)) return false;
    const distance = parseDistance($("nearestMeta")?.textContent);
    const threshold = currentMode() === "car" ? poi.radiusCar : poi.radiusWalk;
    return distance <= Math.max(35, threshold || 100);
  }

  function spatialIntro() {
    const meta = ($("nearestMeta")?.textContent || "").split("·").map((part) => part.trim());
    if (!meta[0]) return "Muy cerca,";
    const direction = meta[1] && !/no disponible/i.test(meta[1]) ? `, ${meta[1]}` : "";
    return `A ${meta[0]}${direction},`;
  }

  function loadVoice() {
    if (!("speechSynthesis" in window)) return;
    const voices = window.speechSynthesis.getVoices() || [];
    selectedVoice = voices.find((voice) => /^es(-|_)/i.test(voice.lang) && /google|microsoft|natural|premium/i.test(voice.name))
      || voices.find((voice) => /^es-ES/i.test(voice.lang))
      || voices.find((voice) => /^es(-|_)/i.test(voice.lang))
      || null;
  }

  function splitText(text, maxLength = 165) {
    const clean = String(text).replace(/\s+/g, " ").trim();
    if (clean.length <= maxLength) return [clean];
    const sentences = clean.match(/[^.!?]+[.!?]?/g) || [clean];
    const chunks = [];
    let current = "";

    for (const sentence of sentences) {
      const trimmed = sentence.trim();
      const candidate = current ? `${current} ${trimmed}` : trimmed;
      if (candidate.length <= maxLength) {
        current = candidate;
        continue;
      }
      if (current) chunks.push(current);
      if (trimmed.length <= maxLength) {
        current = trimmed;
        continue;
      }
      const words = trimmed.split(/\s+/);
      let part = "";
      for (const word of words) {
        const next = part ? `${part} ${word}` : word;
        if (next.length > maxLength && part) {
          chunks.push(part);
          part = word;
        } else {
          part = next;
        }
      }
      current = part;
    }
    if (current) chunks.push(current);
    return chunks.filter(Boolean);
  }

  function speakChunk(text) {
    return new Promise((resolve) => {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "es-ES";
      utterance.rate = currentMode() === "car" ? 1.0 : 0.94;
      utterance.pitch = 1;
      if (selectedVoice) utterance.voice = selectedVoice;

      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        nativeClearInterval(heartbeat);
        window.clearTimeout(timeout);
        resolve();
      };
      utterance.onend = finish;
      utterance.onerror = finish;
      const heartbeat = nativeSetInterval(() => {
        if (window.speechSynthesis.paused) window.speechSynthesis.resume();
      }, 4000);
      const timeout = window.setTimeout(finish, Math.max(10000, text.length * 110));
      window.speechSynthesis.speak(utterance);
    });
  }

  async function speak(text) {
    if (!("speechSynthesis" in window) || !text) return;
    loadVoice();
    const pulse = $("pulseOrb");
    const state = $("assistantState");
    const message = $("assistantText");
    if (state) state.textContent = "Orbe está hablando";
    if (message) message.textContent = text;
    pulse?.classList.add("speaking");

    try { window.speechSynthesis.cancel(); } catch (_) { /* sin acción */ }
    await wait(100);
    for (const chunk of splitText(text)) {
      if (!isDemoButtonRunning()) break;
      await speakChunk(chunk);
      await wait(80);
    }

    pulse?.classList.remove("speaking");
    if (state) state.textContent = "Orbe está preparado";
  }

  async function narrateCurrentEvent() {
    while (eventIndex < EVENTS.length) {
      const poi = findPoi(EVENTS[eventIndex]);
      if (!poi) {
        eventIndex += 1;
        continue;
      }
      if (!nearestMatches(poi)) return;
      eventIndex += 1;
      await speak(`${spatialIntro()} ${poi.short}`);
      return;
    }
  }

  function restoreDiscoverMode() {
    const auto = $("autoDiscover");
    if (auto) auto.checked = previousAutoDiscover;
  }

  function createSynchronizedDemoLoop(callback, args) {
    const controller = { active: true };
    customIntervals.add(controller);
    eventIndex = 0;

    (async () => {
      await speak("Comenzamos el recorrido por Gran Vía en dirección al centro. El marcador se detendrá mientras Orbe explica cada lugar.");

      while (controller.active && isDemoButtonRunning()) {
        while (window.speechSynthesis?.speaking && controller.active) await wait(150);
        if (!controller.active || !isDemoButtonRunning()) break;

        callback(...args);
        await wait(320);
        if (!controller.active || !isDemoButtonRunning()) break;

        await narrateCurrentEvent();
        if (!controller.active || !isDemoButtonRunning()) break;
        await wait(currentMode() === "car" ? 700 : 1000);
      }

      controller.active = false;
      customIntervals.delete(controller);
      demoRequested = false;
      restoreDiscoverMode();
    })();

    return controller;
  }

  window.setInterval = function patchedSetInterval(callback, delay, ...args) {
    if (demoRequested && Number(delay) === DEMO_INTERVAL && typeof callback === "function") {
      return createSynchronizedDemoLoop(callback, args);
    }
    return nativeSetInterval(callback, delay, ...args);
  };

  window.clearInterval = function patchedClearInterval(id) {
    if (customIntervals.has(id)) {
      id.active = false;
      customIntervals.delete(id);
      restoreDiscoverMode();
      return;
    }
    nativeClearInterval(id);
  };

  function prepareDemoClick() {
    const running = isDemoButtonRunning();
    if (running) {
      demoRequested = false;
      restoreDiscoverMode();
      try { window.speechSynthesis?.cancel(); } catch (_) { /* sin acción */ }
      return;
    }
    const auto = $("autoDiscover");
    previousAutoDiscover = auto ? auto.checked : true;
    if (auto) auto.checked = false;
    demoRequested = true;
    eventIndex = 0;
  }

  function init() {
    loadVoice();
    window.speechSynthesis?.addEventListener?.("voiceschanged", loadVoice);
    $("demoBtn")?.addEventListener("click", prepareDemoClick, true);
  }

  init();
})();
