# Crew Portal v7.0.0 Deployment

1. Upload all website files to the GitHub repository.
2. In Cloudflare Workers, open `flightdeck-api` → **Edit code**.
3. Replace `worker.js` with the included `cloudflare-worker.js`.
4. Click **Deploy**. Existing `TDX_CLIENT_ID` and `TDX_CLIENT_SECRET` secrets remain unchanged.
5. Test: `https://flightdeck-api.201505-login.workers.dev/api/mrt?station=A13`
6. Confirm each available train returns `time` in `HH:mm` format.
7. Hard-refresh the Crew Portal after GitHub Pages finishes deployment.

Expected footer: `Version v7.0.0` and `Build 20260721-005`.
