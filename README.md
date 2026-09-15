# Hidden Memories

An augmented reality web app where you tap the floor to mark a writing area and leave short messages that appear on the ground. Messages are shared, so everyone who opens the app sees them. Text is drawn straight onto the floor inside a 1 m wide × 2 m long writing area (`AREA_WIDTH` × `AREA_LENGTH` in `src/scene.js`; make the length 2 or 3 for a strip people walk along). When the area is full, the text already there fades to 30% and new messages are written over it from the far edge again (`DIM_OPACITY`, `DIM_PAGES`).

## How it works on each device

**Android Chrome**: Uses WebXR (`immersive-ar`) with real floor detection (hit-test) and anchors for precise placement.

**iPhone/iPad**: Safari on iOS does not implement WebXR AR, so the app falls back to "camera mode". It shows the rear camera via getUserMedia and uses the device's motion sensors (DeviceOrientation) to aim; the square is placed on an estimated floor plane, so it will not stick as precisely as on Android.

**Desktop**: Camera mode with drag-to-look, mainly for development.

## Project structure

| File | Purpose |
|------|---------|
| `index.html` | Markup and overlay UI |
| `style.css` | Styling |
| `src/config.js` | API base URL and settings |
| `src/app.js` | Startup, mode detection, UI wiring |
| `src/scene.js` | Three.js scene: reticle, writing area, text layout |
| `src/xr-session.js` | WebXR path |
| `src/camera-fallback.js` | getUserMedia + orientation path |
| `src/messages.js` | Loads and saves messages; talks to the API, falls back to localStorage when offline |
| `manifest.webmanifest` | PWA manifest |
| `icons/` | App icons |

## Shared messages (API)

`src/config.js` has `API_BASE`. Empty means the same origin the app is served from (the portfolio server). When the server does not answer, messages are stored only in the browser's localStorage. The app calls:

- `GET /api/memories` — retrieve all messages
- `POST /api/memories` — submit a new message with JSON body `{ "text": "..." }`

Message limits: 200 characters max, rate-limited to 5 messages per minute per IP. Messages can be moderated at `/admin/memories` on that server.

## Running locally

Any static server works:

```bash
python3 -m http.server 8080
```

Then open http://localhost:8080. Note: camera and motion sensors need HTTPS or localhost.

## Deploying

The app is served from the portfolio server at https://avafarjami.com/hidden-memories/ . Its files live in `static/hidden-memories/` of the art-portfolio repository and deploy with that site (`git pull && docker compose up -d --build` on the server). This repository is the development copy; after changing something here, copy `index.html`, `style.css`, `manifest.webmanifest`, `src/` and `icons/` over and deploy the portfolio. The old GitHub Pages copy at avafarjami.github.io/hidden-memories is no longer maintained.

## Known limitations

- iOS has no true plane detection; text placement is estimated.
- Text is English-only UI.
- Messages are public and unmoderated until deleted by the admin.
