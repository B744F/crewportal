# Emergency deployment — v7.0.1

1. Upload all website files to GitHub.
2. Replace Cloudflare `flightdeck-api` worker.js with `cloudflare-worker.js` and Deploy.
3. Test: https://flightdeck-api.201505-login.workers.dev/api/mrt?station=A13
4. Confirm response contains `"mode":"timetable"` and HH:mm train times.
5. Hard refresh the website.
