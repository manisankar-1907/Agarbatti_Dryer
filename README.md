# Agarbatti Dryer — Monitoring Dashboard

A web-based monitoring and control dashboard for a **solar forced-hot-air agarbatti (incense stick) drying chamber**. The dashboard visualizes drying conditions, power status, and batch progress, and includes a full simulation mode for developing and demoing the UI before real sensor hardware (ESP32) is connected.

## Overview

This project is the front-end dashboard for a solar-powered forced-hot-air dryer used to dry agarbatti (incense sticks). It is designed to eventually connect to ESP32-based sensor hardware, but currently ships with a built-in simulation engine so the full UI/UX can be explored without any physical setup.

## Features

- **Dashboard**
  - Live batch status and completion tracking
  - Multi-zone temperature monitoring
  - Heater status
  - Solar panel & battery status
  - Drying uniformity indicators
  - Drying process flow visualization
  - Temperature vs. time and relative humidity (RH) vs. time charts
  - System alerts panel
- **Analytics**
  - Temperature and humidity analysis charts
  - Drying uniformity analysis
  - Power & energy analysis
  - Batch comparison
  - Drying cycle analysis (reserved for a future experimentally-derived drying model)
- **System**
  - Multi-language interface: **English, Tamil (தமிழ்), Hindi (हिन्दी), Telugu (తెలుగు)**
  - Voice command support (speech recognition, multi-language)
  - Device & connectivity status
  - Notification preferences (temperature, humidity, battery, completion, sensor, connectivity alerts)
  - Data storage settings (local database, SD card, logging interval)
  - Configurable dryer settings (target temperature, safety limits, mode, units, time format)
- **Simulation Mode**
  - Start / pause / resume / force-complete / stop a simulated drying batch
  - Adjustable simulation speed (1×–60×) to preview a full drying cycle quickly
  - Automatic or manual environmental and power models
  - Manually trigger faults and alerts (high temperature, high RH, sensor error, ESP32 disconnect, network disconnect, SD card unavailable)
  - Scenario presets: normal day, hot & dry day, humid/monsoon day, power outage, sensor & connectivity fault
  - Reset simulation to defaults

> **Note:** Simulation controls only affect the simulated data model. They have no effect once the dashboard is connected to real ESP32 sensor hardware.

## Tech Stack

- **HTML5 / CSS3** — structure and styling (`css/style.css`)
- **Vanilla JavaScript** — application logic, split into modules:
  - `js/translations.js` — i18n strings and language switching
  - `js/simulation.js` — simulated sensor/environment/power data model
  - `js/dataService.js` — data access layer used by the UI
  - `js/charts.js` — chart rendering and updates
  - `js/voice.js` — voice command recognition and handling
  - `js/app.js` — main application/UI wiring
- **[Chart.js](https://www.chartjs.org/)** (v4) — charts, loaded via CDN
- **Google Fonts** — Space Grotesk & Inter

## Project Structure

```
Agarbatti_Dryer/
├── css/
│   └── style.css
├── js/
│   ├── app.js
│   ├── charts.js
│   ├── dataService.js
│   ├── simulation.js
│   ├── translations.js
│   └── voice.js
└── index.html
```

## Getting Started

No build step or dependencies to install — this is a static site.

1. Clone the repository:
   ```bash
   git clone https://github.com/manisankar-1907/Agarbatti_Dryer.git
   cd Agarbatti_Dryer
   ```
2. Open `index.html` directly in a browser, **or** serve it locally (recommended, especially for voice/microphone features):
   ```bash
   python3 -m http.server 8000
   ```
   Then visit `http://localhost:8000` in your browser.
3. The dashboard loads in **Simulation mode** by default. Head to **System → Simulation control** to start a batch, change simulation speed, or trigger scenarios/faults.

## Language Support

Switch languages from the header dropdown or the System page. Supported languages:

| Code | Language |
|------|----------|
| `en` | English |
| `ta` | Tamil (தமிழ்) |
| `hi` | Hindi (हिन्दी) |
| `te` | Telugu (తెలుగు) |

## Roadmap

- Connect to real ESP32 sensor hardware over the local network
- Replace the simulated environmental/power models with live sensor data
- Implement the experimentally-derived drying cycle model (currently a placeholder in Analytics)
- Validate and finalize default dryer settings (target temperature, safety limits, etc.)

## Status

🚧 This project is under active development. Sensor hardware integration and the drying cycle model are not yet implemented — the dashboard currently runs entirely on simulated data.

## Authentication

No user authentication has been specified for this repository yet.
