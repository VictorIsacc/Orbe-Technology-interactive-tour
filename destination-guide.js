(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const destinationEl = $("labDestination");
  const directionEl = $("labDestinationDirection");
  const actionsEl = document.querySelector("#gpsLab .lab-actions");
  const assistantState = $("assistantState");
  const assistantText = $("assistantText");

  if (!destinationEl || !directionEl || !actionsEl) return;

  const state = {
    autoEnabled: true,
    lastDestination: "",
    lastDirectionKey: "",
    lastSpokenAt: 0,
    pendingTimer: null,
    speaking: false
  };

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

  const clearButton = $("labClearBtn");
  actionsEl.insertBefore(speakBtn, clearButton || null);
  actionsEl.insertBefore(autoBtn, clearButton || null);

  function voiceMuted() {
    return /silenciada/i.test($("muteBtn")?.textContent || "");
  }

  function chooseVoice() {
    const voices = window.speechSynthesis?.getVoices?.() || [];
    return voices.find((voice) => /^es(-|_)/i.test(voice.lang) && /google|microsoft|natural|premium/i.test(voice.name))
      || voices.find((voice) => /^es(-|_)/i.test(voice.lang))
      || null;
  }

  function directionKey(text) {
    const value = String(text || "").toLowerCase();
    if (value.includes("orientación no disponible") || value.includes("esperando posición")) return "unknown";
    if (value.includes("algo por delante") && value.includes("derecha")) return "front-right";
    if (value.includes("algo por delante") && value.includes("izquierda")) return "front-left";
    if (value.includes("delante")) return "front";
    if (value.includes("detrás")) return "back";
    if (value.includes("derecha")) return "right";
    if (value.includes("izquierda")) return "left";
    return "unknown";
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

  function distanceText() {
    const text = directionEl.textContent || "";
    const part = text.split("·")[0]?.trim();
    return part && /\d/.test(part) ? part : "una distancia todavía por calcular";
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
    utterance.pitch = 1.0;
    const voice = chooseVoice();
    if (voice) utterance.voice = voice;
    utterance.onstart = () => { state.speaking = true; };
    utterance.onend = utterance.onerror = () => { state.speaking = false; };
    window.speechSynthesis.speak(utterance);
    state.lastSpokenAt = Date.now();
  }

  function currentMessage(initial = false) {
    const destination = destinationEl.textContent.trim();
    if (!destination || /sin destino/i.test(destination)) {
      return "Todavía no has marcado ningún destino en el mapa.";
    }

    const key = directionKey(directionEl.textContent);
    const distance = distanceText();
    if (key === "unknown") {
      return initial
        ? `Destino seleccionado a ${distance}. Mantén el teléfono en vertical y gira lentamente para calcular la dirección.`
        : `El destino está a ${distance}, pero la orientación todavía no es estable.`;
    }

    return initial
      ? `Destino seleccionado. Está a ${distance}, ${spokenDirection(key)}.`
      : `Ahora el destino queda ${spokenDirection(key)}.`;
  }

  function announceCurrent(initial = false, force = false) {
    const destination = destinationEl.textContent.trim();
    if (/sin destino/i.test(destination)) return;
    const key = directionKey(directionEl.textContent);
    if (!initial && key === state.lastDirectionKey) return;
    state.lastDirectionKey = key;
    speak(currentMessage(initial), force);
  }

  function scheduleDirectionAnnouncement(initial = false) {
    window.clearTimeout(state.pendingTimer);
    const delay = initial ? 500 : 900;
    state.pendingTimer = window.setTimeout(() => {
      if (!initial && !state.autoEnabled) return;
      if (!initial && Date.now() - state.lastSpokenAt < 2400) return;
      announceCurrent(initial, initial);
    }, delay);
  }

  const destinationObserver = new MutationObserver(() => {
    const destination = destinationEl.textContent.trim();
    if (!destination || destination === state.lastDestination) return;
    state.lastDestination = destination;
    state.lastDirectionKey = "";
    if (!/sin destino/i.test(destination)) scheduleDirectionAnnouncement(true);
  });
  destinationObserver.observe(destinationEl, { childList: true, subtree: true, characterData: true });

  const directionObserver = new MutationObserver(() => {
    if (/sin destino/i.test(destinationEl.textContent || "")) return;
    const key = directionKey(directionEl.textContent);
    if (key !== state.lastDirectionKey) scheduleDirectionAnnouncement(false);
  });
  directionObserver.observe(directionEl, { childList: true, subtree: true, characterData: true });

  speakBtn.addEventListener("click", () => announceCurrent(true, true));
  autoBtn.addEventListener("click", () => {
    state.autoEnabled = !state.autoEnabled;
    autoBtn.textContent = `Avisos al girar: ${state.autoEnabled ? "activados" : "desactivados"}`;
    setAssistantMessage(
      "Orientación al destino",
      state.autoEnabled ? "Orbe avisará cuando el destino cambie de dirección al girarte." : "Los avisos automáticos al girar han quedado desactivados."
    );
  });

  window.ORBE_DESTINATION_GUIDE = {
    speak: () => announceCurrent(true, true),
    setAuto: (enabled) => {
      state.autoEnabled = Boolean(enabled);
      autoBtn.textContent = `Avisos al girar: ${state.autoEnabled ? "activados" : "desactivados"}`;
    }
  };
})();
