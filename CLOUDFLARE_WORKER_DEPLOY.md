# Cloudflare Worker deployment

1. Open **Workers & Pages → flightdeck-api → Edit code**.
2. Replace all existing `worker.js` code with the contents of `cloudflare-worker.js`.
3. Confirm these Secrets already exist:
   - `TDX_CLIENT_ID`
   - `TDX_CLIENT_SECRET`
4. Click **Deploy**.
5. Test these addresses in a browser:
   - `https://flightdeck-api.201505-login.workers.dev/api/health`
   - `https://flightdeck-api.201505-login.workers.dev/api/mrt?station=A13`

Expected MRT result: JSON containing `"ok":true` and `"mode":"live"`. If TDX has no usable current board data, the website automatically displays its scheduled backup.

Do not upload TDX credentials to GitHub or place them in JavaScript.
