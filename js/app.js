/**
 * app.js
 * UI orchestration: navigation, rendering all three pages from
 * DataService snapshots, and wiring translations + voice control.
 * This file does NOT invent any data — everything rendered here comes
 * from DataService.getSnapshot() or user-editable settings.
 */

(function () {
  let currentPage = "dashboard";
  let currentChartMode = "temp"; // temp | rh
  let analyticsRange = "current";
  let latestSnapshot = null;

  const settings = {
    tempSafetyLimit: 65,
    loggingInterval: 30,
    samplingInterval: 5,
    mode: "auto",
    tempUnit: "C",
    timeFormat: "24h",
    notify: { temp: true, humidity: true, battery: true, completion: true, sensorError: true, connectivity: true },
  };

  // ---------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------
  function goToPage(page) {
    currentPage = page;
    document.querySelectorAll(".nav-item").forEach((el) => el.classList.toggle("active", el.dataset.page === page));
    document.querySelectorAll(".page").forEach((el) => el.classList.toggle("active", el.id === `page-${page}`));
    renderAll();
  }

  // ---------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------
  function timeLabel(date) {
    if (!date) return "--:--";
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: settings.timeFormat === "12h" });
  }

  function statusForTemp(v, target) {
    if (v > target + 3) return "high";
    if (v < target - 6) return "low";
    return "normal";
  }

  function trendArrow(history, key) {
    if (history.length < 6) return { dir: "flat", diff: 0 };
    const recent = history.slice(-6);
    const diff = recent[recent.length - 1][key] - recent[0][key];
    if (diff > 0.3) return { dir: "up", diff };
    if (diff < -0.3) return { dir: "down", diff };
    return { dir: "flat", diff };
  }

  function zoneCardHtml(zoneKey, labelKey, tempVal, rhVal, target, history, tempHistKey, rhHistKey) {
    const trend = trendArrow(history, tempHistKey);
    const status = statusForTemp(tempVal, target);
    const arrowSym = trend.dir === "up" ? "▲" : trend.dir === "down" ? "▼" : "▬";
    return `
      <div class="card zone-card zone-${zoneKey}">
        <div class="zone-label">${t(labelKey)}</div>
        <div class="zone-value">${tempVal.toFixed(1)}<span class="unit">°C</span></div>
        <div class="zone-sub">
          <span class="status-pill ${status}">${t(status)}</span>
          <span class="trend ${trend.dir}">${arrowSym} ${Math.abs(trend.diff).toFixed(1)}°</span>
        </div>
        <div class="zone-sub">${t("airRH")}: <strong class="num">${rhVal.toFixed(0)}%</strong></div>
      </div>`;
  }

  // ---------------------------------------------------------------------
  // Dashboard render
  // ---------------------------------------------------------------------
  function renderBatchCard(s) {
    const el = document.getElementById("batch-card");
    const stateKey = "state" + s.batchState.charAt(0) + s.batchState.slice(1).toLowerCase();
    el.className = `batch-card state-${s.batchState.toLowerCase()}`;
    const canStart = s.batchState === "IDLE" || s.batchState === "COMPLETED";
    el.innerHTML = `
      <div>
        <div class="batch-id">${t("currentBatch")} · #${String(s.batchId).padStart(3, "0")}</div>
        <div class="batch-state">${t(stateKey)}</div>
      </div>
      <div class="batch-metrics">
        <div class="batch-metric">
          <div class="label">${t("elapsedTime")}</div>
          <div class="value num">${s.elapsedLabel}</div>
        </div>
        <div class="batch-metric">
          <div class="label">${t("stage")}</div>
          <div class="value">${t(stateKey)}</div>
        </div>
        <div class="batch-metric">
          <div class="label">${t("startTime")}</div>
          <div class="value num">${timeLabel(s.startTime)}</div>
        </div>
      </div>
      <div class="batch-actions">
        <button class="btn btn-primary" id="btn-start-batch" ${canStart ? "" : "disabled"}>${t("startBatch")}</button>
        <button class="btn btn-ghost" id="btn-stop-batch" ${canStart ? "disabled" : ""}>${t("stopBatch")}</button>
      </div>
    `;
    document.getElementById("btn-start-batch").onclick = () => DataService.startBatch();
    document.getElementById("btn-stop-batch").onclick = () => DataService.stopBatch();
  }

  function renderZoneCards(s) {
    const tempWrap = document.getElementById("temp-zone-grid");
    tempWrap.innerHTML = ["lower", "middle", "upper", "exhaust"]
      .map((z) => {
        const labelKey = "zone" + z.charAt(0).toUpperCase() + z.slice(1);
        return zoneCardHtml(z, labelKey, s.zones[z].temp, s.zones[z].rh, s.targetTemp, s.history, z, "rh" + z.charAt(0).toUpperCase() + z.slice(1));
      })
      .join("");
  }

  function renderHeaterSolar(s) {
    const heaterEl = document.getElementById("heater-card-body");
    heaterEl.innerHTML = `
      <div class="stat-row">
        <span class="k">${t("heater")}</span>
        <span class="toggle-state ${s.heater.on ? "on" : "off"}">${s.heater.on ? t("heaterOn") : t("heaterOff")}</span>
      </div>
      <div class="stat-row"><span class="k">${t("current")}</span><span class="v num">${s.zones.lower.temp.toFixed(1)}°C</span></div>
      <div class="stat-row"><span class="k">${t("target")}</span><span class="v num">${s.targetTemp}°C</span></div>
      <div class="stat-row"><span class="k">${t("safety")}</span><span class="status-pill ${s.heater.safety === "NORMAL" ? "normal" : "high"}">${s.heater.safety === "NORMAL" ? t("normal") : t("high")}</span></div>
    `;

    const solarEl = document.getElementById("solar-card-body");
    solarEl.innerHTML = `
      <div class="stat-row"><span class="k">${t("solarStatus")}</span><span class="v">${s.solar.powerSource === "solar" ? t("powerSolar") : t("powerGrid")}</span></div>
      <div class="stat-row"><span class="k">${t("batteryLevel")}</span><span class="v num">${s.battery.level.toFixed(0)}%</span></div>
      <div class="stat-row"><span class="k">${t("batteryVoltage")}</span><span class="v num">${s.battery.voltage.toFixed(2)} V</span></div>
      <div class="stat-row"><span class="k">${t("systemPower")}</span><span class="v">${s.battery.charging ? t("charging") : t("discharging")}</span></div>
      <div class="demo-note">${t("demoValue")}</div>
    `;
  }

  function renderUniformity(s) {
    const el = document.getElementById("uniformity-body");
    const zones = ["lower", "middle", "upper"];
    const tempDiff = Math.abs(s.zones.lower.temp - s.zones.upper.temp);
    const rhDiff = Math.abs(s.zones.lower.rh - s.zones.upper.rh);
    el.innerHTML = `
      <div class="uniformity-row">
        ${zones
          .map(
            (z) => `
          <div class="uniformity-col">
            <div class="lvl">${t("zone" + z.charAt(0).toUpperCase() + z.slice(1))}</div>
            <div class="t num">${s.zones[z].temp.toFixed(1)}°C</div>
            <div class="h num">${s.zones[z].rh.toFixed(0)}% RH</div>
          </div>`
          )
          .join("")}
      </div>
      <div class="uniformity-diffs">
        <div class="diff-pill">${t("tempDifference")}: <b class="num">${tempDiff.toFixed(1)}°C</b></div>
        <div class="diff-pill">${t("humidityDifference")}: <b class="num">${rhDiff.toFixed(0)}%</b></div>
      </div>
      <div class="demo-note">${t("uniformityNote")}</div>
    `;
  }

  function chamberSvg() {
    return `
    <svg class="chamber-svg" width="150" height="260" viewBox="0 0 150 260" xmlns="http://www.w3.org/2000/svg">
      <rect x="10" y="6" width="130" height="248" rx="6" fill="#F5F5F1" stroke="#C7C4B8" stroke-width="2"/>
      <!-- upper/BMS compartment -->
      <rect x="14" y="10" width="122" height="26" fill="#E1EAF3" stroke="#C7C4B8"/>
      <text x="75" y="27" font-size="8" text-anchor="middle" fill="#3A6EA5">BMS / Upper</text>
      <!-- rack zone -->
      <rect x="14" y="38" width="122" height="150" fill="#FFFFFF" stroke="#C7C4B8"/>
      ${Array.from({ length: 8 })
        .map((_, i) => `<line x1="18" y1="${48 + i * 18}" x2="132" y2="${48 + i * 18}" stroke="#DCDAD1" stroke-width="1.5"/>`)
        .join("")}
      <text x="75" y="118" font-size="8" text-anchor="middle" fill="#8B5E3C" transform="rotate(-90 75 118)">Rack Zone (15 levels)</text>
      <!-- heater/blower -->
      <rect x="14" y="190" width="122" height="34" fill="#F5E9D3" stroke="#C7C4B8"/>
      <text x="75" y="211" font-size="8" text-anchor="middle" fill="#B8790E">Blower + Heater</text>
      <!-- inlet -->
      <rect x="14" y="226" width="122" height="24" fill="#E4EBE0" stroke="#C7C4B8"/>
      <text x="75" y="242" font-size="8" text-anchor="middle" fill="#2F5233">Fresh Air Inlet</text>
      <!-- arrows -->
      <line x1="75" y1="224" x2="75" y2="192" stroke="#8B5E3C" stroke-width="2" marker-end="url(#arrow)"/>
      <line x1="75" y1="186" x2="75" y2="40" stroke="#8B5E3C" stroke-width="2" stroke-dasharray="3,3" marker-end="url(#arrow)"/>
      <defs>
        <marker id="arrow" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
          <path d="M0,0 L6,3 L0,6 Z" fill="#8B5E3C"/>
        </marker>
      </defs>
    </svg>`;
  }

  function renderProcessFlow() {
    const el = document.getElementById("process-flow-body");
    const steps = ["stepIntake", "stepFilter", "stepBlower", "stepHeater", "stepPlenum", "stepRack", "stepExhaustPlenum", "stepExhaust"];
    el.innerHTML = `
      <div class="chamber-wrap">
        ${chamberSvg()}
        <div class="process-flow">
          ${steps
            .map(
              (key, i) => `
            <div class="flow-step">
              <span class="flow-num">${i + 1}</span>
              <span>${t(key)}</span>
            </div>`
            )
            .join("")}
          <div class="flow-step" style="opacity:0.7">
            <span class="flow-num">↺</span>
            <span>${t("stepRecirc")}</span>
          </div>
          <div class="demo-note">${t("rackLevels")}</div>
        </div>
      </div>
    `;
  }

  function renderAlerts(s) {
    const el = document.getElementById("alerts-body");
    if (!s.alerts.length) {
      el.innerHTML = `<div class="empty-state">${t("noAlerts")}</div>`;
      return;
    }
    el.innerHTML = s.alerts
      .slice(0, 8)
      .map(
        (a) => `
        <div class="alert-item">
          <span class="alert-icon ${a.severity}"></span>
          <div class="alert-body">
            <div class="alert-msg">${a.message}</div>
            <div class="alert-time">${timeLabel(a.time)}</div>
          </div>
          <button class="alert-dismiss" data-alert-id="${a.id}">${t("dismiss")}</button>
        </div>`
      )
      .join("");
    el.querySelectorAll(".alert-dismiss").forEach((btn) => {
      btn.onclick = () => DataService.dismissAlert(btn.dataset.alertId);
    });
  }

  function renderChart(s) {
    const labels = { lower: t("zoneLower"), middle: t("zoneMiddle"), upper: t("zoneUpper"), exhaust: t("zoneExhaust") };
    ChartManager.createOrUpdate("dashboard-chart", s.history, currentChartMode, labels);
  }

  // ---------------------------------------------------------------------
  // Drying completion indicator (SIMULATED / ESTIMATED — see disclaimer)
  // ---------------------------------------------------------------------
  function renderCompletionCard(s) {
    const el = document.getElementById("completion-card");
    if (!el) return;
    const c = s.completion;
    const stateKey = "state" + s.batchState.charAt(0) + s.batchState.slice(1).toLowerCase();
    const r = 48;
    const circumference = 2 * Math.PI * r;
    const pct = Math.max(0, Math.min(100, c.percent));
    const offset = circumference * (1 - pct / 100);
    const isCompleted = s.batchState === "COMPLETED";
    const isIdle = s.batchState === "IDLE";
    const ringClass = isCompleted ? "state-completed" : isIdle ? "state-idle" : "";

    el.innerHTML = `
      <div class="completion-ring-wrap">
        <svg viewBox="0 0 108 108">
          <circle class="completion-ring-track" cx="54" cy="54" r="${r}"></circle>
          <circle class="completion-ring-fill ${ringClass}" cx="54" cy="54" r="${r}"
            stroke-dasharray="${circumference.toFixed(1)}" stroke-dashoffset="${offset.toFixed(1)}"></circle>
        </svg>
        <div class="completion-ring-label">
          <div class="pct num">${pct.toFixed(0)}%</div>
          <div class="pct-unit">${t("percentComplete")}</div>
        </div>
      </div>
      <div class="completion-body">
        <div class="completion-title-row">
          <h3>${t("dryingCompletion")}</h3>
          <span class="completion-badge">${t("simulatedEstimateBadge")}</span>
        </div>
        <div class="completion-meta">
          <div class="completion-meta-item">
            <div class="label">${t("currentStage")}</div>
            <div class="value">${t(stateKey)}</div>
          </div>
          <div class="completion-meta-item">
            <div class="label">${t("elapsedTime")}</div>
            <div class="value num">${s.elapsedLabel}</div>
          </div>
          <div class="completion-meta-item">
            <div class="label">${t("remainingTime")}</div>
            <div class="value num">${c.remainingLabel}</div>
          </div>
        </div>
        <div class="completion-bar-track">
          <div class="completion-bar-fill ${isCompleted ? "state-completed" : ""}" style="width:${pct}%"></div>
        </div>
        <div class="completion-disclaimer">${t("completionDisclaimer")}</div>
      </div>
    `;
  }

  function renderDashboard(s) {
    renderBatchCard(s);
    renderCompletionCard(s);
    renderZoneCards(s);
    renderHeaterSolar(s);
    renderUniformity(s);
    renderProcessFlow();
    renderAlerts(s);
    renderChart(s);
  }

  // ---------------------------------------------------------------------
  // Analytics render
  // ---------------------------------------------------------------------
  function renderAnalyticsCharts(s) {
    const labels = { lower: t("zoneLower"), middle: t("zoneMiddle"), upper: t("zoneUpper"), exhaust: t("zoneExhaust") };
    ChartManager.createOrUpdate("analytics-temp-chart", s.history, "temp", labels);
    ChartManager.createOrUpdate("analytics-rh-chart", s.history, "rh", labels);
  }

  function renderUniformityAnalysis(s) {
    const el = document.getElementById("uniformity-analysis-body");
    const tempDiff = Math.abs(s.zones.lower.temp - s.zones.upper.temp);
    const rhDiff = Math.abs(s.zones.lower.rh - s.zones.upper.rh);
    el.innerHTML = `
      <div class="grid grid-2">
        <div class="stat-card">
          <div class="stat-row"><span class="k">${t("tempDifference")} (${t("zoneLower")}–${t("zoneUpper")})</span><span class="v num">${tempDiff.toFixed(1)}°C</span></div>
          <div class="stat-row"><span class="k">${t("humidityDifference")}</span><span class="v num">${rhDiff.toFixed(0)}%</span></div>
        </div>
        <div class="stat-card">
          <div class="demo-note">${t("uniformityNote")}</div>
        </div>
      </div>
    `;
  }

  function renderPowerAnalysis(s) {
    const el = document.getElementById("power-analysis-body");
    el.innerHTML = `
      <div class="grid grid-3">
        <div class="stat-card"><div class="stat-row"><span class="k">${t("batteryLevel")}</span><span class="v num">${s.battery.level.toFixed(0)}%</span></div></div>
        <div class="stat-card"><div class="stat-row"><span class="k">${t("heaterRuntime")}</span><span class="v num">${Math.round(s.elapsedSeconds / 60)} min</span></div></div>
        <div class="stat-card"><div class="stat-row"><span class="k">${t("blowerRuntime")}</span><span class="v num">${Math.round(s.elapsedSeconds / 60)} min</span></div></div>
      </div>
      <div class="demo-note">${t("simulatedData")}</div>
    `;
  }

  function renderBatchComparison(s) {
    const el = document.getElementById("batch-comparison-body");
    const rows = s.batches
      .map(
        (b) => `
      <tr>
        <td>#${String(b.id).padStart(3, "0")}</td>
        <td class="num">${b.duration} min</td>
        <td class="num">${b.avgTemp}°C</td>
        <td class="num">${b.avgRH}%</td>
        <td class="num">${b.tUniformity}°C</td>
        <td class="num">${b.rhUniformity}%</td>
        <td class="num">${b.heaterRuntime} min</td>
      </tr>`
      )
      .join("");
    el.innerHTML = `
      <table class="data-table">
        <thead>
          <tr>
            <th>${t("batch")}</th>
            <th>${t("duration")}</th>
            <th>${t("avgTemp")}</th>
            <th>${t("avgRH")}</th>
            <th>${t("tempUniformity")}</th>
            <th>${t("rhUniformity")}</th>
            <th>${t("heaterRuntime")}</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }

  function renderAnalytics(s) {
    renderAnalyticsCharts(s);
    renderUniformityAnalysis(s);
    renderPowerAnalysis(s);
    renderBatchComparison(s);
  }

  // ---------------------------------------------------------------------
  // System render
  // ---------------------------------------------------------------------
  function renderConnectivity(s) {
    const el = document.getElementById("connectivity-body");
    const rows = [
      { k: "esp32", v: s.connectivity.esp32, okVal: "connected" },
      { k: "sensors", v: s.connectivity.sensors, okVal: "normal" },
      { k: "sdCard", v: s.connectivity.sdCard, okVal: "available" },
      { k: "localWifi", v: s.connectivity.wifi, okVal: "connected" },
      { k: "localApi", v: s.connectivity.api, okVal: "connected" },
      { k: "localDatabase", v: s.connectivity.database, okVal: "connected" },
    ];
    el.innerHTML = rows
      .map((r) => {
        const ok = r.v === r.okVal;
        const label = r.v === "connected" ? t("connected") : r.v === "disconnected" ? t("disconnected") : r.v === "available" ? t("available") : r.v === "unavailable" ? t("unavailable") : t("normal");
        return `<div class="stat-row"><span class="k">${t(r.k)}</span><span class="status-pill ${ok ? "normal" : "high"}">${label}</span></div>`;
      })
      .join("") + `<div class="demo-note">${t("lastUpdated")}: ${t("simulatedData")}</div>`;
  }

  function renderSidebarConnectivity(s) {
    const el = document.getElementById("sidebar-connectivity");
    const ok = s.connectivity.esp32 === "connected";
    el.innerHTML = `
      <div class="conn-row"><span>${t("esp32")}</span><span class="dot ${ok ? "ok" : "bad"}"></span></div>
      <div class="conn-row"><span>${t("sdCard")}</span><span class="dot ${s.connectivity.sdCard === "available" ? "ok" : "warn"}"></span></div>
      <div class="conn-row"><span>${t("localWifi")}</span><span class="dot ${s.connectivity.wifi === "connected" ? "ok" : "bad"}"></span></div>
    `;
  }

  function renderVoicePanel() {
    const supported = VoiceModule.isSupported();
    document.getElementById("voice-unsupported-note").style.display = supported ? "none" : "flex";
    document.getElementById("voice-controls").style.display = supported ? "flex" : "none";
  }

  function renderSystem(s) {
    renderConnectivity(s);
    renderVoicePanel();
    renderSimulationControl(s);
  }

  // ---------------------------------------------------------------------
  // Simulation control (System -> Simulation mode)
  // Every control here calls straight into DataService, which mutates the
  // live SimulationEngine state — so the Dashboard cards, charts, alerts
  // and connectivity indicators all update in real time from these.
  // ---------------------------------------------------------------------
  function setDisabled(id, disabled) {
    const el = document.getElementById(id);
    if (el) el.disabled = disabled;
  }

  function buildSimEnvZoneGrid() {
    const el = document.getElementById("sim-env-zone-grid");
    if (!el) return;
    const zones = ["lower", "middle", "upper", "exhaust"];
    el.innerHTML = zones
      .map((z) => {
        const labelKey = "zone" + z.charAt(0).toUpperCase() + z.slice(1);
        return `
        <div class="card sim-zone-card zone-${z}">
          <div class="zone-label" data-i18n="${labelKey}"></div>
          <div class="sim-zone-field">
            <label data-i18n="simZoneTemp"></label>
            <input type="number" class="sim-zone-temp-input" data-zone="${z}" step="0.5">
          </div>
          <div class="sim-zone-field">
            <label data-i18n="simZoneRH"></label>
            <input type="number" class="sim-zone-rh-input" data-zone="${z}" step="1">
          </div>
        </div>`;
      })
      .join("");
    el.querySelectorAll(".sim-zone-temp-input").forEach((inp) => {
      inp.onchange = () => DataService.setZoneValue(inp.dataset.zone, "temp", inp.value);
    });
    el.querySelectorAll(".sim-zone-rh-input").forEach((inp) => {
      inp.onchange = () => DataService.setZoneValue(inp.dataset.zone, "rh", inp.value);
    });
    renderNavLabels();
  }

  function renderSimulationControl(s) {
    const sc = s.simControl;
    if (!sc) return;

    const batchIdEl = document.getElementById("sim-batch-id-val");
    if (batchIdEl) batchIdEl.textContent = "#" + String(s.batchId).padStart(3, "0");
    const stageKey = "state" + s.batchState.charAt(0) + s.batchState.slice(1).toLowerCase();
    const stageEl = document.getElementById("sim-batch-stage-val");
    if (stageEl) stageEl.textContent = t(stageKey);

    const canStart = s.batchState === "IDLE" || s.batchState === "COMPLETED";
    const canPause = s.batchState === "HEATING" || s.batchState === "DRYING";
    const canResume = s.batchState === "PAUSED";
    const canStop = !canStart;
    setDisabled("sim-btn-start", !canStart);
    setDisabled("sim-btn-pause", !canPause);
    setDisabled("sim-btn-resume", !canResume);
    setDisabled("sim-btn-complete", !canStop);
    setDisabled("sim-btn-stop", !canStop);

    document.querySelectorAll("#sim-speed-tabs .chart-tab").forEach((btn) => {
      btn.classList.toggle("active", Number(btn.dataset.speed) === sc.simSpeed);
    });

    const active = document.activeElement;

    const envAutoToggle = document.getElementById("sim-env-auto-toggle");
    if (envAutoToggle && active !== envAutoToggle) envAutoToggle.checked = !sc.envManual;
    document.querySelectorAll(".sim-zone-temp-input").forEach((inp) => {
      inp.disabled = !sc.envManual;
      if (active !== inp) inp.value = s.zones[inp.dataset.zone].temp.toFixed(1);
    });
    document.querySelectorAll(".sim-zone-rh-input").forEach((inp) => {
      inp.disabled = !sc.envManual;
      if (active !== inp) inp.value = Math.round(s.zones[inp.dataset.zone].rh);
    });

    const powerAutoToggle = document.getElementById("sim-power-auto-toggle");
    if (powerAutoToggle && active !== powerAutoToggle) powerAutoToggle.checked = !sc.powerManual;

    const solarToggle = document.getElementById("sim-solar-toggle");
    if (solarToggle) {
      solarToggle.disabled = !sc.powerManual;
      if (active !== solarToggle) solarToggle.checked = s.solar.producing;
    }
    const batteryInput = document.getElementById("sim-battery-input");
    if (batteryInput) {
      batteryInput.disabled = !sc.powerManual;
      if (active !== batteryInput) batteryInput.value = Math.round(s.battery.level);
    }
    const chargingToggle = document.getElementById("sim-charging-toggle");
    if (chargingToggle) {
      chargingToggle.disabled = !sc.powerManual;
      if (active !== chargingToggle) chargingToggle.checked = s.battery.charging;
    }
  }

  function setupSimulationControl() {
    buildSimEnvZoneGrid();

    document.getElementById("sim-btn-start").onclick = () => DataService.startBatch();
    document.getElementById("sim-btn-pause").onclick = () => DataService.pauseBatch();
    document.getElementById("sim-btn-resume").onclick = () => DataService.resumeBatch();
    document.getElementById("sim-btn-complete").onclick = () => DataService.completeBatch();
    document.getElementById("sim-btn-stop").onclick = () => DataService.stopBatch();

    document.querySelectorAll("#sim-speed-tabs .chart-tab").forEach((btn) => {
      btn.onclick = () => DataService.setSimSpeed(Number(btn.dataset.speed));
    });

    document.getElementById("sim-env-auto-toggle").onchange = (e) => DataService.setEnvAuto(e.target.checked);

    document.getElementById("sim-power-auto-toggle").onchange = (e) => DataService.setPowerAuto(e.target.checked);
    document.getElementById("sim-solar-toggle").onchange = (e) => DataService.setSolarProducing(e.target.checked);
    document.getElementById("sim-battery-input").onchange = (e) => DataService.setBatteryLevel(e.target.value);
    document.getElementById("sim-charging-toggle").onchange = (e) => DataService.setCharging(e.target.checked);
    document.getElementById("sim-btn-power-interruption").onclick = () => DataService.simulatePowerInterruption();
    document.getElementById("sim-btn-low-battery").onclick = () => DataService.simulateLowBattery();

    document.getElementById("sim-fault-hightemp").onclick = () => DataService.triggerFault("highTemp");
    document.getElementById("sim-fault-highrh").onclick = () => DataService.triggerFault("highRH");
    document.getElementById("sim-fault-sensor").onclick = () => DataService.triggerFault("sensorFailure");
    document.getElementById("sim-fault-esp32").onclick = () => DataService.triggerFault("esp32Disconnect");
    document.getElementById("sim-fault-wifi").onclick = () => DataService.triggerFault("wifiDisconnect");
    document.getElementById("sim-fault-sd").onclick = () => DataService.triggerFault("sdUnavailable");

    document.getElementById("sim-scenario-normal").onclick = () => DataService.applyScenario("normal");
    document.getElementById("sim-scenario-hot").onclick = () => DataService.applyScenario("hotDry");
    document.getElementById("sim-scenario-humid").onclick = () => DataService.applyScenario("humid");
    document.getElementById("sim-scenario-power").onclick = () => DataService.applyScenario("powerOutage");
    document.getElementById("sim-scenario-sensor").onclick = () => DataService.applyScenario("sensorFault");

    document.getElementById("sim-btn-reset").onclick = () => {
      openConfirm("simResetConfirm", () => DataService.resetSimulation());
    };
  }

  // ---------------------------------------------------------------------
  // Top bar
  // ---------------------------------------------------------------------
  function renderTopbar(s) {
    const titles = { dashboard: "navDashboard", analytics: "navAnalytics", system: "navSystem" };
    document.getElementById("topbar-title-main").textContent = t(titles[currentPage]);
    document.getElementById("topbar-title-sub").textContent = t("appSubtitle");
    document.getElementById("last-updated-val").textContent = timeLabel(new Date());
  }

  function renderNavLabels() {
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      el.textContent = t(el.dataset.i18n);
    });
  }

  // ---------------------------------------------------------------------
  // Master render
  // ---------------------------------------------------------------------
  function renderAll() {
    if (!latestSnapshot) return;
    const s = latestSnapshot;
    renderNavLabels();
    renderTopbar(s);
    renderSidebarConnectivity(s);
    if (currentPage === "dashboard") renderDashboard(s);
    if (currentPage === "analytics") renderAnalytics(s);
    if (currentPage === "system") renderSystem(s);
  }

  // ---------------------------------------------------------------------
  // Voice UI wiring
  // ---------------------------------------------------------------------
  let pendingConfirm = null;

  function openConfirm(messageKey, onConfirm) {
    pendingConfirm = onConfirm;
    document.getElementById("confirm-modal-text").textContent = t(messageKey);
    document.getElementById("confirm-modal-backdrop").classList.add("open");
  }

  function closeConfirm() {
    pendingConfirm = null;
    document.getElementById("confirm-modal-backdrop").classList.remove("open");
  }

  function setupVoice() {
    const enableToggle = document.getElementById("voice-enable-toggle");
    enableToggle.checked = VoiceModule.isEnabled();
    enableToggle.onchange = () => VoiceModule.setEnabled(enableToggle.checked);

    const langSelect = document.getElementById("voice-lang-select");
    langSelect.value = VoiceModule.getVoiceLang();
    langSelect.onchange = () => VoiceModule.setVoiceLang(langSelect.value);

    const micBig = document.getElementById("mic-large-btn");
    const micHeader = document.getElementById("mic-header-btn");

    function toggleListen() {
      if (!VoiceModule.isSupported()) return;
      if (!VoiceModule.isEnabled()) {
        VoiceModule.setEnabled(true);
        enableToggle.checked = true;
      }
      if (VoiceModule.isListening()) VoiceModule.stop();
      else VoiceModule.start();
    }
    micBig.onclick = toggleListen;
    micHeader.onclick = toggleListen;

    VoiceModule.on("state", (state) => {
      const isListening = state === "listening";
      micBig.classList.toggle("listening", isListening);
      micHeader.classList.toggle("listening", isListening);
    });

    VoiceModule.on("transcript", (text) => {
      document.getElementById("voice-transcript-text").textContent = text;
    });

    VoiceModule.on("result", ({ text, cmd }) => {
      const resultEl = document.getElementById("voice-result-text");
      if (!cmd) {
        resultEl.textContent = "—";
        return;
      }
      switch (cmd.action) {
        case "GOTO_DASHBOARD":
          goToPage("dashboard");
          resultEl.textContent = t("navDashboard");
          break;
        case "GOTO_ANALYTICS":
          goToPage("analytics");
          resultEl.textContent = t("navAnalytics");
          break;
        case "GOTO_SYSTEM":
          goToPage("system");
          resultEl.textContent = t("navSystem");
          break;
        case "SHOW_STATUS":
        case "SHOW_TEMP":
        case "SHOW_BATTERY":
          goToPage("dashboard");
          resultEl.textContent = t("navDashboard");
          break;
        case "START_DRYING":
          resultEl.textContent = t("confirmAction");
          openConfirm("confirmStartDrying", () => DataService.startBatch());
          break;
        case "STOP_DRYING":
          resultEl.textContent = t("confirmAction");
          openConfirm("confirmStartDrying", () => DataService.stopBatch());
          break;
      }
    });

    document.getElementById("confirm-cancel-btn").onclick = closeConfirm;
    document.getElementById("confirm-ok-btn").onclick = () => {
      if (pendingConfirm) pendingConfirm();
      closeConfirm();
    };
  }

  // ---------------------------------------------------------------------
  // Static wiring (nav, chart tabs, language, target temp)
  // ---------------------------------------------------------------------
  function setupNav() {
    document.querySelectorAll(".nav-item").forEach((el) => {
      el.onclick = () => goToPage(el.dataset.page);
    });
  }

  function setupChartTabs() {
    document.querySelectorAll(".chart-tab").forEach((btn) => {
      btn.onclick = () => {
        currentChartMode = btn.dataset.mode;
        document.querySelectorAll(".chart-tab").forEach((b) => b.classList.toggle("active", b === btn));
        renderChart(latestSnapshot);
      };
    });
  }

  function setupLanguage() {
    const sel = document.getElementById("lang-select");
    sel.value = getLanguage();
    sel.onchange = () => setLanguage(sel.value);
    document.addEventListener("languagechange", () => {
      sel.value = getLanguage();
      renderAll();
    });
  }

  function setupTargetTemp() {
    const input = document.getElementById("target-temp-input");
    input.value = 50;
    input.onchange = () => DataService.setTargetTemperature(Number(input.value));
  }

  // ---------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------
  function init() {
    setupNav();
    setupChartTabs();
    setupLanguage();
    setupTargetTemp();
    setupVoice();
    setupSimulationControl();

    DataService.onUpdate((snapshot) => {
      latestSnapshot = snapshot;
      renderAll();
    });
    latestSnapshot = DataService.getSnapshot();
    renderAll();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
