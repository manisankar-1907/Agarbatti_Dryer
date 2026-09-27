/**
 * voice.js
 * Web Speech API integration. Falls back gracefully when unsupported.
 * Any command that could affect the physical machine (e.g. "start drying")
 * MUST go through an explicit confirmation dialog before DataService is
 * called — recognition results are never allowed to directly trigger a
 * machine action.
 */

const VoiceModule = (() => {
  const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognition = null;
  let listening = false;
  let enabled = localStorage.getItem("agarbatti_voice_enabled") === "true";
  let voiceLang = localStorage.getItem("agarbatti_voice_lang") || "en-IN";

  const listeners = { transcript: [], result: [], state: [] };

  function isSupported() {
    return !!SpeechRecognitionAPI;
  }

  function isEnabled() {
    return enabled;
  }

  function setEnabled(v) {
    enabled = v;
    localStorage.setItem("agarbatti_voice_enabled", String(v));
  }

  function setVoiceLang(lang) {
    voiceLang = lang;
    localStorage.setItem("agarbatti_voice_lang", lang);
    if (recognition) recognition.lang = lang;
  }

  function getVoiceLang() {
    return voiceLang;
  }

  function emit(channel, payload) {
    listeners[channel].forEach((cb) => cb(payload));
  }

  function on(channel, cb) {
    listeners[channel].push(cb);
  }

  const COMMANDS = [
    { match: /drying status|status of dry/i, action: "SHOW_STATUS" },
    { match: /temperature/i, action: "SHOW_TEMP" },
    { match: /battery/i, action: "SHOW_BATTERY" },
    { match: /analytics/i, action: "GOTO_ANALYTICS" },
    { match: /system settings|open system/i, action: "GOTO_SYSTEM" },
    { match: /dashboard/i, action: "GOTO_DASHBOARD" },
    { match: /start dry/i, action: "START_DRYING", requiresConfirm: true },
    { match: /stop dry/i, action: "STOP_DRYING", requiresConfirm: true },
  ];

  function interpret(text) {
    for (const cmd of COMMANDS) {
      if (cmd.match.test(text)) return cmd;
    }
    return null;
  }

  function start() {
    if (!isSupported() || !enabled) return;
    if (listening) return;
    recognition = new SpeechRecognitionAPI();
    recognition.lang = voiceLang;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      listening = true;
      emit("state", "listening");
    };
    recognition.onresult = (event) => {
      const text = event.results[0][0].transcript;
      emit("transcript", text);
      const cmd = interpret(text);
      emit("result", { text, cmd });
    };
    recognition.onerror = () => {
      listening = false;
      emit("state", "idle");
    };
    recognition.onend = () => {
      listening = false;
      emit("state", "idle");
    };
    recognition.start();
  }

  function stop() {
    if (recognition && listening) recognition.stop();
  }

  function isListening() {
    return listening;
  }

  return { isSupported, isEnabled, setEnabled, setVoiceLang, getVoiceLang, on, start, stop, isListening, interpret };
})();
