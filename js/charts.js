/**
 * charts.js
 * Thin wrapper around Chart.js for the temperature/RH time-series charts
 * used on the Dashboard and Analytics pages.
 */

const ChartManager = (() => {
  const registry = {};

  const ZONE_COLORS = {
    lower: "#B8790E",
    middle: "#8B5E3C",
    upper: "#2F5233",
    exhaust: "#3A6EA5",
  };

  function baseOptions(yLabel) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 250 },
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { position: "bottom", labels: { boxWidth: 10, font: { size: 11 }, usePointStyle: true } },
        tooltip: { padding: 10, titleFont: { size: 11 }, bodyFont: { size: 11 } },
      },
      scales: {
        x: { grid: { display: false }, ticks: { maxTicksLimit: 6, font: { size: 10 } } },
        y: {
          title: { display: true, text: yLabel, font: { size: 11 } },
          grid: { color: "#E4E2D8" },
          ticks: { font: { size: 10 } },
        },
      },
    };
  }

  function makeDataset(label, key, arr) {
    return {
      label,
      data: arr.map((p) => p[key]),
      borderColor: ZONE_COLORS[key.replace("rh", "").toLowerCase()] || ZONE_COLORS[key] || "#999",
      backgroundColor: "transparent",
      borderWidth: 2,
      pointRadius: 0,
      tension: 0.25,
    };
  }

  function createOrUpdate(canvasId, history, mode, labels) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    const timeLabels = history.map((p) => p.t.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));

    let datasets;
    if (mode === "temp") {
      datasets = [
        { key: "lower", color: ZONE_COLORS.lower, label: labels.lower },
        { key: "middle", color: ZONE_COLORS.middle, label: labels.middle },
        { key: "upper", color: ZONE_COLORS.upper, label: labels.upper },
        { key: "exhaust", color: ZONE_COLORS.exhaust, label: labels.exhaust },
      ].map((z) => ({
        label: z.label,
        data: history.map((p) => p[z.key]),
        borderColor: z.color,
        backgroundColor: "transparent",
        borderWidth: 2,
        pointRadius: 0,
        tension: 0.25,
      }));
    } else {
      datasets = [
        { key: "rhLower", color: ZONE_COLORS.lower, label: labels.lower },
        { key: "rhMiddle", color: ZONE_COLORS.middle, label: labels.middle },
        { key: "rhUpper", color: ZONE_COLORS.upper, label: labels.upper },
        { key: "rhExhaust", color: ZONE_COLORS.exhaust, label: labels.exhaust },
      ].map((z) => ({
        label: z.label,
        data: history.map((p) => p[z.key]),
        borderColor: z.color,
        backgroundColor: "transparent",
        borderWidth: 2,
        pointRadius: 0,
        tension: 0.25,
      }));
    }

    if (registry[canvasId]) {
      registry[canvasId].data.labels = timeLabels;
      registry[canvasId].data.datasets = datasets;
      registry[canvasId].update("none");
      return registry[canvasId];
    }

    registry[canvasId] = new Chart(ctx, {
      type: "line",
      data: { labels: timeLabels, datasets },
      options: baseOptions(mode === "temp" ? "°C" : "% RH"),
    });
    return registry[canvasId];
  }

  function destroy(canvasId) {
    if (registry[canvasId]) {
      registry[canvasId].destroy();
      delete registry[canvasId];
    }
  }

  return { createOrUpdate, destroy };
})();
