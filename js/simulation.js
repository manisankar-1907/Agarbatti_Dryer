/**
 * simulation.js
 * Simulated sensor & machine-state engine. This is the ONLY place that
 * invents numbers. It models a plausible physical evolution of the dryer
 * (IDLE -> HEATING -> DRYING -> COMPLETED, with PAUSED / WARNING / ERROR
 * side-states, and occasional faults) so the dashboard can be demonstrated
 * before ESP32 hardware is wired in.
 *
 * IMPORTANT: this models AIR temperature and AIR relative humidity only.
 * It never produces a "product moisture" number. The "completion %" this
 * engine computes is an estimated, time/temperature/RH-based progress
 * indicator for the SIMULATION only — see getSnapshot().completion for the
 * disclaimer that ships with it. It is not a substitute for the
 * experimentally calibrated temperature/RH/time model + direct product-
 * moisture measurements that will validate real drying completion on the
 * physical prototype.
 *
 * This file also exposes a full "Simulation Control" surface (System ->
 * Simulation Mode in the UI) so the dashboard, charts, statuses and alerts
 * can be exercised end-to-end without hardware:
 *   - Batch control: start / pause / resume / stop / force-complete
 *   - Environmental simulation: manual per-zone temp & RH override, or
 *     automatic realistic drift (default)
 *   - Power simulation: manual solar/battery/charging override, or
 *     automatic day/night model (default); power-interruption and
 *     low-battery one-shot triggers
 *   - Fault/alert simulation: one-shot triggers for high temp, high RH,
 *     sensor failure, ESP32 disconnect, Wi-Fi disconnect, SD unavailable
 *   - Simulation speed: 1x / 5x / 10x / 30x / 60x, scales how fast
 *     simulated elapsed time and environmental drift advance per tick
 *   - Scenario presets + full reset
 *
 * Everything above actually mutates `state`, so every control here is
 * immediately reflected in the next tick's snapshot -> DataService -> UI
 * (dashboard cards, charts, alerts, connectivity indicators, etc).
 */

const SimulationEngine = (() => {
  const HISTORY_LIMIT = 240; // ~ enough points for a live chart window
  const TICK_MS = 2000;

  // Estimated total simulated duration of a full drying cycle, used both
  // for auto-completion and for the completion-percentage estimate below.
  // This is a DEMONSTRATION constant, not an experimentally validated
  // drying time.
  const DEFAULT_TARGET_DURATION_SEC = 150 * 60;

  const DEFAULTS = {
    batchId: 24,
    ambientTemp: 29,
    targetTemp: 50,
    targetDurationSeconds: DEFAULT_TARGET_DURATION_SEC,
  };

  let state = null;

  function freshState() {
    return {
      batchId: DEFAULTS.batchId,
      batchState: "IDLE", // IDLE | HEATING | DRYING | PAUSED | COMPLETED | WARNING | ERROR
      prePauseState: null,
      startTime: null,
      elapsedSeconds: 0,

      targetTemp: DEFAULTS.targetTemp,
      ambientTemp: DEFAULTS.ambientTemp,
      targetDurationSeconds: DEFAULTS.targetDurationSeconds,

      zones: {
        lower: { temp: 29, rh: 62 },
        middle: { temp: 29, rh: 63 },
        upper: { temp: 29, rh: 64 },
        exhaust: { temp: 28, rh: 66 },
      },

      heater: { on: false, safety: "NORMAL" },
      blower: { on: false },

      battery: { level: 78, voltage: 12.6, charging: true },
      solar: { producing: true, powerSource: "solar" },

      connectivity: {
        esp32: "connected",
        sensors: "normal",
        sdCard: "available",
        wifi: "connected",
        api: "connected",
        database: "connected",
        lastDataSeconds: 0,
      },

      history: [],
      alerts: [],
      batches: [],

      // ---- Simulation-control state (not physical, purely for the
      // demonstration harness) ----
      simSpeed: 1, // 1 | 5 | 10 | 30 | 60
      envManual: false, // when true, zones only change via manual overrides
      powerManual: false, // when true, solar/battery only change via manual overrides

      listeners: [],
    };
  }

  function seedPastBatches() {
    state.batches = [
      { id: 21, duration: 138, avgTemp: 48.2, avgRH: 34, tUniformity: 1.8, rhUniformity: 5.1, heaterRuntime: 96, blowerRuntime: 138 },
      { id: 22, duration: 145, avgTemp: 49.0, avgRH: 33, tUniformity: 1.5, rhUniformity: 4.6, heaterRuntime: 101, blowerRuntime: 145 },
      { id: 23, duration: 132, avgTemp: 47.9, avgRH: 36, tUniformity: 2.1, rhUniformity: 5.8, heaterRuntime: 92, blowerRuntime: 132 },
    ];
  }

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function jitter(base, amount) {
    return base + (Math.random() * 2 - 1) * amount;
  }

  function pushAlert(type, message, severity = "warning") {
    const alert = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type,
      message,
      severity, // info | warning | critical
      time: new Date(),
    };
    state.alerts.unshift(alert);
    state.alerts = state.alerts.slice(0, 20);
  }

  function fmtElapsed(sec) {
    const h = Math.floor(sec / 3600).toString().padStart(2, "0");
    const m = Math.floor((sec % 3600) / 60).toString().padStart(2, "0");
    const s = Math.floor(sec % 60).toString().padStart(2, "0");
    return `${h}:${m}:${s}`;
  }

  // -------------------------------------------------------------------
  // Batch control
  // -------------------------------------------------------------------
  function startBatch() {
    if (state.batchState !== "IDLE" && state.batchState !== "COMPLETED") return;
    state.batchId += 1;
    state.batchState = "HEATING";
    state.prePauseState = null;
    state.startTime = new Date();
    state.elapsedSeconds = 0;
    state.heater.on = true;
    state.blower.on = true;
    state.zones.lower.temp = state.ambientTemp;
    state.zones.middle.temp = state.ambientTemp;
    state.zones.upper.temp = state.ambientTemp;
    state.zones.exhaust.temp = state.ambientTemp - 1;
    pushAlert("cycle", `Batch #${state.batchId} started`, "info");
    notify();
  }

  function pauseBatch() {
    if (state.batchState !== "HEATING" && state.batchState !== "DRYING") return;
    state.prePauseState = state.batchState;
    state.batchState = "PAUSED";
    state.heater.on = false;
    state.blower.on = false;
    pushAlert("cycle", `Batch #${state.batchId} paused`, "info");
    notify();
  }

  function resumeBatch() {
    if (state.batchState !== "PAUSED") return;
    state.batchState = state.prePauseState || "DRYING";
    state.prePauseState = null;
    state.heater.on = true;
    state.blower.on = true;
    pushAlert("cycle", `Batch #${state.batchId} resumed`, "info");
    notify();
  }

  function completeBatch() {
    if (state.batchState === "IDLE" || state.batchState === "COMPLETED") return;
    state.batchState = "COMPLETED";
    state.heater.on = false;
    state.blower.on = false;
    pushAlert("cycle", `Batch #${state.batchId} drying cycle completed`, "info");
    state.batches.unshift({
      id: state.batchId,
      duration: Math.round(state.elapsedSeconds / 60),
      avgTemp: Number(state.zones.lower.temp.toFixed(1)),
      avgRH: Number(state.zones.lower.rh.toFixed(1)),
      tUniformity: Number(Math.abs(state.zones.lower.temp - state.zones.upper.temp).toFixed(1)),
      rhUniformity: Number(Math.abs(state.zones.lower.rh - state.zones.upper.rh).toFixed(1)),
      heaterRuntime: Math.max(0, Math.round(state.elapsedSeconds / 60) - 8),
      blowerRuntime: Math.round(state.elapsedSeconds / 60),
    });
    notify();
  }

  function stopBatch() {
    state.batchState = "IDLE";
    state.prePauseState = null;
    state.heater.on = false;
    state.blower.on = false;
    notify();
  }

  // -------------------------------------------------------------------
  // Simulation-control setters (Environmental / Power / Speed)
  // -------------------------------------------------------------------
  function setSimSpeed(v) {
    const allowed = [1, 5, 10, 30, 60];
    state.simSpeed = allowed.includes(Number(v)) ? Number(v) : 1;
    notify();
  }

  function setEnvAuto(auto) {
    state.envManual = !auto;
    notify();
  }

  function setZoneValue(zone, field, value) {
    if (!state.zones[zone] || (field !== "temp" && field !== "rh")) return;
    const v = Number(value);
    if (Number.isNaN(v)) return;
    state.zones[zone][field] = field === "temp" ? clamp(v, 0, 90) : clamp(v, 0, 100);
    notify();
  }

  function setPowerAuto(auto) {
    state.powerManual = !auto;
    notify();
  }

  function setSolarProducing(on) {
    state.powerManual = true;
    state.solar.producing = !!on;
    notify();
  }

  function setBatteryLevel(value) {
    const v = Number(value);
    if (Number.isNaN(v)) return;
    state.powerManual = true;
    state.battery.level = clamp(v, 0, 100);
    notify();
  }

  function setCharging(on) {
    state.powerManual = true;
    state.battery.charging = !!on;
    notify();
  }

  function simulatePowerInterruption() {
    state.powerManual = true;
    state.solar.producing = false;
    state.battery.charging = false;
    state.battery.level = clamp(state.battery.level - 6, 0, 100);
    state.solar.powerSource = "grid";
    state.connectivity.api = "disconnected";
    pushAlert("power", "Simulated power interruption", "critical");
    notify();
  }

  function simulateLowBattery() {
    state.powerManual = true;
    state.battery.level = 8;
    state.battery.charging = false;
    pushAlert("battery", "Simulated low battery condition", "warning");
    notify();
  }

  // -------------------------------------------------------------------
  // Fault / alert simulation (one-shot triggers)
  // -------------------------------------------------------------------
  function triggerFault(type) {
    switch (type) {
      case "highTemp":
        state.zones.lower.temp = 71;
        state.zones.middle.temp = clamp(state.zones.middle.temp + 12, 0, 90);
        pushAlert("temp", "Simulated fault: high temperature in lower zone", "critical");
        break;
      case "highRH":
        state.zones.lower.rh = 88;
        state.zones.middle.rh = clamp(state.zones.middle.rh + 20, 0, 100);
        state.zones.upper.rh = clamp(state.zones.upper.rh + 15, 0, 100);
        pushAlert("humidity", "Simulated fault: high relative humidity", "warning");
        break;
      case "sensorFailure":
        state.connectivity.sensors = "error";
        pushAlert("sensor", "Simulated fault: sensor communication error", "critical");
        break;
      case "esp32Disconnect":
        state.connectivity.esp32 = "disconnected";
        pushAlert("connectivity", "Simulated fault: ESP32 disconnected", "critical");
        break;
      case "wifiDisconnect":
        state.connectivity.wifi = "disconnected";
        state.connectivity.api = "disconnected";
        pushAlert("connectivity", "Simulated fault: local Wi-Fi disconnected", "warning");
        break;
      case "sdUnavailable":
        state.connectivity.sdCard = "unavailable";
        pushAlert("sd", "Simulated fault: SD card unavailable", "warning");
        break;
      default:
        return;
    }
    notify();
  }

  function clearFaults() {
    state.connectivity.sensors = "normal";
    state.connectivity.esp32 = "connected";
    state.connectivity.wifi = "connected";
    state.connectivity.api = "connected";
    state.connectivity.sdCard = "available";
  }

  // -------------------------------------------------------------------
  // Scenario presets
  // -------------------------------------------------------------------
  function applyScenario(name) {
    switch (name) {
      case "normal":
        state.envManual = false;
        state.powerManual = false;
        clearFaults();
        state.ambientTemp = 29;
        pushAlert("scenario", "Scenario applied: normal drying day", "info");
        break;
      case "hotDry":
        state.envManual = true;
        state.ambientTemp = 36;
        state.zones.lower = { temp: 58, rh: 18 };
        state.zones.middle = { temp: 55, rh: 20 };
        state.zones.upper = { temp: 52, rh: 23 };
        state.zones.exhaust = { temp: 49, rh: 26 };
        pushAlert("scenario", "Scenario applied: hot & dry day", "info");
        break;
      case "humid":
        state.envManual = true;
        state.ambientTemp = 27;
        state.zones.lower = { temp: 42, rh: 78 };
        state.zones.middle = { temp: 40, rh: 80 };
        state.zones.upper = { temp: 38, rh: 83 };
        state.zones.exhaust = { temp: 36, rh: 85 };
        pushAlert("scenario", "Scenario applied: humid / monsoon day", "warning");
        break;
      case "powerOutage":
        simulatePowerInterruption();
        break;
      case "sensorFault":
        triggerFault("sensorFailure");
        triggerFault("esp32Disconnect");
        break;
      default:
        return;
    }
    notify();
  }

  function resetSimulation() {
    const listeners = state ? state.listeners : [];
    state = freshState();
    state.listeners = listeners;
    seedPastBatches();
    seedInitialHistory();
    pushAlert("scenario", "Simulation reset to default starting conditions", "info");
    notify();
  }

  // -------------------------------------------------------------------
  // Completion estimate (SIMULATION ONLY — see file header disclaimer)
  // -------------------------------------------------------------------
  function computeCompletion() {
    const total = state.targetDurationSeconds;
    let percent = 0;
    let remainingSeconds = total;

    if (state.batchState === "IDLE") {
      percent = 0;
      remainingSeconds = total;
    } else if (state.batchState === "HEATING") {
      const span = Math.max(1, state.targetTemp - state.ambientTemp);
      const progressed = clamp((state.zones.lower.temp - state.ambientTemp) / span, 0, 1);
      percent = progressed * 10; // heating counts for up to 10% of the estimate
      remainingSeconds = total;
    } else if (state.batchState === "DRYING") {
      const fraction = clamp(state.elapsedSeconds / total, 0, 1);
      percent = 10 + fraction * 90;
      percent = Math.min(percent, 99); // reserve 100% for actual completion
      remainingSeconds = Math.max(0, total - state.elapsedSeconds);
    } else if (state.batchState === "PAUSED") {
      const fraction = clamp(state.elapsedSeconds / total, 0, 1);
      percent = state.prePauseState === "HEATING" ? 0 : 10 + fraction * 90;
      percent = Math.min(percent, 99);
      remainingSeconds = Math.max(0, total - state.elapsedSeconds);
    } else if (state.batchState === "COMPLETED") {
      percent = 100;
      remainingSeconds = 0;
    } else {
      // WARNING / ERROR — freeze wherever elapsed time indicates
      const fraction = clamp(state.elapsedSeconds / total, 0, 1);
      percent = 10 + fraction * 90;
      remainingSeconds = Math.max(0, total - state.elapsedSeconds);
    }

    return {
      percent: Number(percent.toFixed(1)),
      remainingSeconds: Math.round(remainingSeconds),
      remainingLabel: fmtElapsed(remainingSeconds),
      isEstimate: true,
    };
  }

  // -------------------------------------------------------------------
  // Main tick
  // -------------------------------------------------------------------
  function tick() {
    const speed = state.simSpeed;

    // --- Batch state machine -------------------------------------------
    if (state.batchState === "HEATING" || state.batchState === "DRYING") {
      state.elapsedSeconds += 1 * speed;
    }

    const envAuto = !state.envManual;

    if (envAuto && state.batchState === "HEATING") {
      const f = Math.min(0.9, 0.02 * speed);
      const fm = Math.min(0.9, 0.017 * speed);
      const fu = Math.min(0.9, 0.014 * speed);
      const fe = Math.min(0.9, 0.012 * speed);
      state.zones.lower.temp += (state.targetTemp - state.zones.lower.temp) * f + jitter(0, 0.05 * speed);
      state.zones.middle.temp += (state.targetTemp - 1 - state.zones.middle.temp) * fm + jitter(0, 0.05 * speed);
      state.zones.upper.temp += (state.targetTemp - 2 - state.zones.upper.temp) * fu + jitter(0, 0.05 * speed);
      state.zones.exhaust.temp += (state.targetTemp - 4 - state.zones.exhaust.temp) * fe + jitter(0, 0.05 * speed);

      state.zones.lower.rh = clamp(state.zones.lower.rh - 0.08 * speed + jitter(0, 0.1 * speed), 15, 70);
      state.zones.middle.rh = clamp(state.zones.middle.rh - 0.06 * speed + jitter(0, 0.1 * speed), 15, 70);
      state.zones.upper.rh = clamp(state.zones.upper.rh - 0.05 * speed + jitter(0, 0.1 * speed), 15, 70);
      state.zones.exhaust.rh = clamp(state.zones.exhaust.rh - 0.03 * speed + jitter(0, 0.1 * speed), 15, 75);

      if (Math.abs(state.zones.lower.temp - state.targetTemp) < 0.6) {
        state.batchState = "DRYING";
        pushAlert("cycle", "Chamber reached target range — drying stage started", "info");
      }
    } else if (envAuto && state.batchState === "DRYING") {
      state.zones.lower.temp = clamp(state.targetTemp + jitter(0, 0.6), state.targetTemp - 2, state.targetTemp + 2);
      state.zones.middle.temp = clamp(state.targetTemp - 0.7 + jitter(0, 0.6), state.targetTemp - 3, state.targetTemp + 1.5);
      state.zones.upper.temp = clamp(state.targetTemp - 1.4 + jitter(0, 0.6), state.targetTemp - 3.5, state.targetTemp + 1);
      state.zones.exhaust.temp = clamp(state.targetTemp - 3 + jitter(0, 0.6), state.targetTemp - 5, state.targetTemp - 1);

      const decay = 0.02 * speed;
      state.zones.lower.rh = clamp(state.zones.lower.rh - decay * 1.1 + jitter(0, 0.15 * speed), 12, 60);
      state.zones.middle.rh = clamp(state.zones.middle.rh - decay + jitter(0, 0.15 * speed), 12, 60);
      state.zones.upper.rh = clamp(state.zones.upper.rh - decay * 0.9 + jitter(0, 0.15 * speed), 12, 60);
      state.zones.exhaust.rh = clamp(state.zones.exhaust.rh - decay * 0.7 + jitter(0, 0.15 * speed), 14, 65);

      if (state.elapsedSeconds > state.targetDurationSeconds) {
        completeBatch();
      }
    } else if (envAuto && (state.batchState === "IDLE" || state.batchState === "COMPLETED" || state.batchState === "PAUSED")) {
      // drift back toward ambient (heater/blower are off in all these states)
      for (const z of Object.values(state.zones)) {
        z.temp += (state.ambientTemp - z.temp) * 0.01 + jitter(0, 0.03);
        z.rh += (62 - z.rh) * 0.01 + jitter(0, 0.1);
      }
    }
    // when envManual is true, zones are left exactly as the manual
    // controls set them — no automatic drift is applied.

    // --- Heater / safety --------------------------------------------------
    state.heater.on = state.batchState === "HEATING" || state.batchState === "DRYING";
    state.heater.safety = state.zones.lower.temp > 68 ? "LIMIT" : "NORMAL";
    if (state.heater.safety === "LIMIT" && state.batchState !== "WARNING") {
      pushAlert("temp", "Lower zone temperature above safe range", "critical");
    }

    // --- Battery / solar ---------------------------------------------------
    if (!state.powerManual) {
      const hour = new Date().getHours();
      const daylight = hour >= 7 && hour <= 18;
      state.solar.producing = daylight;
      if (daylight) {
        state.battery.level = clamp(state.battery.level + 0.03 * speed, 0, 100);
        state.battery.charging = state.battery.level < 97;
      } else {
        state.battery.level = clamp(state.battery.level - 0.02 * speed, 0, 100);
        state.battery.charging = false;
      }
      state.solar.powerSource = state.solar.producing && state.battery.charging ? "solar" : "grid";
    } else {
      // manual mode: battery still drains/charges gently based on the
      // manually-chosen charging/producing state so the numbers keep moving
      if (state.battery.charging) {
        state.battery.level = clamp(state.battery.level + 0.02 * speed, 0, 100);
      } else {
        state.battery.level = clamp(state.battery.level - 0.015 * speed, 0, 100);
      }
      state.solar.powerSource = state.solar.producing && state.battery.charging ? "solar" : "grid";
    }
    state.battery.voltage = Number((11.8 + (state.battery.level / 100) * 1.2 + jitter(0, 0.03)).toFixed(2));

    if (state.battery.level < 20 && Math.random() < 0.02) {
      pushAlert("battery", "Battery level is low", "warning");
    }

    // --- Connectivity: rare simulated blips (only while not manually forced) --
    state.connectivity.lastDataSeconds = 0;
    const blipChance = Math.min(0.03, 0.0015 * speed);
    if (state.connectivity.esp32 === "connected" && Math.random() < blipChance) {
      state.connectivity.esp32 = "disconnected";
      pushAlert("connectivity", "ESP32 disconnected", "critical");
    } else if (state.connectivity.esp32 === "disconnected" && Math.random() < 0.3) {
      state.connectivity.esp32 = "connected";
    }
    if (state.connectivity.sdCard === "available" && Math.random() < Math.min(0.02, 0.001 * speed)) {
      state.connectivity.sdCard = "unavailable";
      pushAlert("sd", "SD card unavailable", "warning");
    } else if (state.connectivity.sdCard === "unavailable" && Math.random() < 0.3) {
      state.connectivity.sdCard = "available";
    }
    if (state.connectivity.sensors === "error" && Math.random() < 0.3) {
      state.connectivity.sensors = "normal";
    }
    if (state.connectivity.wifi === "disconnected" && Math.random() < 0.3) {
      state.connectivity.wifi = "connected";
      state.connectivity.api = "connected";
    }

    // --- History ------------------------------------------------------------
    state.history.push({
      t: new Date(),
      lower: Number(state.zones.lower.temp.toFixed(1)),
      middle: Number(state.zones.middle.temp.toFixed(1)),
      upper: Number(state.zones.upper.temp.toFixed(1)),
      exhaust: Number(state.zones.exhaust.temp.toFixed(1)),
      rhLower: Number(state.zones.lower.rh.toFixed(1)),
      rhMiddle: Number(state.zones.middle.rh.toFixed(1)),
      rhUpper: Number(state.zones.upper.rh.toFixed(1)),
      rhExhaust: Number(state.zones.exhaust.rh.toFixed(1)),
    });
    if (state.history.length > HISTORY_LIMIT) state.history.shift();

    notify();
  }

  function notify() {
    const snap = getSnapshot();
    state.listeners.forEach((cb) => cb(snap));
  }

  function getSnapshot() {
    return {
      batchId: state.batchId,
      batchState: state.batchState,
      startTime: state.startTime,
      elapsedSeconds: state.elapsedSeconds,
      elapsedLabel: fmtElapsed(state.elapsedSeconds),
      targetTemp: state.targetTemp,
      targetDurationSeconds: state.targetDurationSeconds,
      zones: JSON.parse(JSON.stringify(state.zones)),
      heater: { ...state.heater },
      blower: { ...state.blower },
      battery: { ...state.battery },
      solar: { ...state.solar },
      connectivity: { ...state.connectivity },
      history: state.history.slice(),
      alerts: state.alerts.slice(),
      batches: state.batches.slice(),
      completion: computeCompletion(),
      simControl: {
        simSpeed: state.simSpeed,
        envManual: state.envManual,
        powerManual: state.powerManual,
      },
    };
  }

  function subscribe(cb) {
    state.listeners.push(cb);
    return () => {
      state.listeners = state.listeners.filter((l) => l !== cb);
    };
  }

  function dismissAlert(id) {
    state.alerts = state.alerts.filter((a) => a.id !== id);
    notify();
  }

  function setTargetTemp(v) {
    state.targetTemp = clamp(v, 35, 65);
    notify();
  }

  function seedInitialHistory() {
    // seed a little history immediately so charts aren't empty on load
    for (let i = 0; i < 30; i++) tick();
    state.batchState = "DRYING";
    state.startTime = new Date(Date.now() - 84 * 60 * 1000 - 36 * 1000);
    state.elapsedSeconds = 84 * 60 + 36;
    state.zones.lower.temp = 49.4;
    state.zones.middle.temp = 48.5;
    state.zones.upper.temp = 47.6;
    state.zones.exhaust.temp = 46.1;
    state.zones.lower.rh = 34;
    state.zones.middle.rh = 37;
    state.zones.upper.rh = 40;
    state.zones.exhaust.rh = 44;
    state.heater.on = true;
    state.blower.on = true;
  }

  // ---- bootstrap ----
  state = freshState();
  seedPastBatches();
  seedInitialHistory();
  setInterval(tick, TICK_MS);

  return {
    getSnapshot,
    subscribe,
    // batch control
    startBatch,
    pauseBatch,
    resumeBatch,
    completeBatch,
    stopBatch,
    dismissAlert,
    setTargetTemp,
    // simulation control
    setSimSpeed,
    setEnvAuto,
    setZoneValue,
    setPowerAuto,
    setSolarProducing,
    setBatteryLevel,
    setCharging,
    simulatePowerInterruption,
    simulateLowBattery,
    triggerFault,
    applyScenario,
    resetSimulation,
  };
})();
