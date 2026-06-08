# NeonLift — Workout & Bodyweight Tracker (PWA)

A dark, neon-themed progressive web app for tracking your lifts and bodyweight, with glowing line graphs of your progress over time. Works fully offline once installed and stores everything privately on your device.

## Features
- Log **Bench Press, Military Press, Squat, Deadlift** out of the box.
- **Add your own exercises** (with a neon accent colour) any time.
- Each session logs **weight + reps + sets**; the graph plots your **top set** over time.
- **Bodyweight tracking** with a sparkline and change-since-last-entry.
- **Neon line charts** with glow, on a dark theme.
- **kg / lbs** toggle (converts existing data automatically).
- **Export / import** a JSON backup, plus a full reset.
- 100% offline. No account, no server — data lives in your browser's local storage.

## Getting it onto your phone

A PWA needs to be served over **https** for the "Add to Home Screen" install (and offline mode) to work. Pick whichever is easiest:

### Easiest — free static host (recommended)
1. Go to **https://app.netlify.com/drop** (or Vercel / Cloudflare Pages / GitHub Pages).
2. Drag the whole `fittrack` folder onto the page.
3. Open the URL it gives you **on your phone**.
4. **iPhone (Safari):** Share button → *Add to Home Screen*.
   **Android (Chrome):** menu ⋮ → *Install app* / *Add to Home Screen*.
5. Launch it from your home screen — it runs full-screen and works offline.

### Quick local test (same Wi‑Fi)
From inside the `fittrack` folder on your computer:
```bash
python3 -m http.server 8080
```
Then open `http://<your-computer-ip>:8080` on your phone (same network). Note: install/offline features need https, so this is just for a quick look.

## Files
- `index.html` — app shell
- `styles.css` — dark neon theme
- `app.js` — all logic + the chart engine (no external libraries)
- `manifest.webmanifest` — PWA manifest
- `sw.js` — service worker (offline caching)
- `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` — app icons

## Your data
Everything is stored locally in your browser via `localStorage`. Clearing the browser/app data will erase it, so use **Settings → Export data** now and then to keep a backup JSON.
