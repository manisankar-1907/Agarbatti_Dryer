/**
 * dataService.js
 * The ONLY module the UI talks to for sensor/machine data. Internally it
 * currently delegates to SimulationEngine. When real hardware is ready,
 * replace the body of these functions with calls to a local API
 * (e.g. GET /api/sensor-data, or a WebSocket) and the UI layer above does
 * not need to change.
 *
 *   Today:    SimulationEngine  -> DataService -> UI
 *   Tomorrow: ESP32 (local API) -> DataService -> UI
 *
 * NOTE ON SIMULATION-CONTROL METHODS: everything from setSimSpeed() down
 * to resetSimulation() only makes sense while SOURCE === "simulation".
 * They are grouped separately so it's obvious, when wiring up real
 * hardware, that this whole block should simply be removed (there is no
 * "speed" or "scenario preset" for a real drying chamber).
 */

const DataService = (() => {
  const SOURCE = "simulation"; // "simulation" | "esp32-local-api" (future)

  function getSnapshot() {
    return SimulationEngine.getSnapshot();
  }

  function onUpdate(callback) {
    return SimulationEngine.subscribe(callback);
  }

  // ---- Batch control ----
  function startBatch() {
    SimulationEngine.startBatch();
  }

  function pauseBatch() {
    SimulationEngine.pauseBatch();
  }

  function resumeBatch() {
    SimulationEngine.resumeBatch();
  }

  function completeBatch() {
    SimulationEngine.completeBatch();
  }

  function stopBatch() {
    SimulationEngine.stopBatch();
  }

  function dismissAlert(id) {
    SimulationEngine.dismissAlert(id);
  }

  function setTargetTemperature(value) {
    SimulationEngine.setTargetTemp(value);
  }

  function getSource() {
    return SOURCE;
  }

  // ---- Simulation control (demo-only; see note above) ----
  function setSimSpeed(v) {
    SimulationEngine.setSimSpeed(v);
  }

  function setEnvAuto(auto) {
    SimulationEngine.setEnvAuto(auto);
  }

  function setZoneValue(zone, field, value) {
    SimulationEngine.setZoneValue(zone, field, value);
  }

  function setPowerAuto(auto) {
    SimulationEngine.setPowerAuto(auto);
  }

  function setSolarProducing(on) {
    SimulationEngine.setSolarProducing(on);
  }

  function setBatteryLevel(value) {
    SimulationEngine.setBatteryLevel(value);
  }

  function setCharging(on) {
    SimulationEngine.setCharging(on);
  }

  function simulatePowerInterruption() {
    SimulationEngine.simulatePowerInterruption();
  }

  function simulateLowBattery() {
    SimulationEngine.simulateLowBattery();
  }

  function triggerFault(type) {
    SimulationEngine.triggerFault(type);
  }

  function applyScenario(name) {
    SimulationEngine.applyScenario(name);
  }

  function resetSimulation() {
    SimulationEngine.resetSimulation();
  }

  return {
    getSnapshot,
    onUpdate,
    startBatch,
    pauseBatch,
    resumeBatch,
    completeBatch,
    stopBatch,
    dismissAlert,
    setTargetTemperature,
    getSource,
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
