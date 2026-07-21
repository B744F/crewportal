# Crew Portal v7.2.0 — Structured MRT timetable

## Required deployment

1. Upload all website files to GitHub Pages.
2. Replace the Cloudflare Worker code with `cloudflare-worker.js`.
3. Click **Deploy**. Existing `TDX_CLIENT_ID` and `TDX_CLIENT_SECRET` secrets remain unchanged.
4. Test these endpoints after deployment:

```text
/api/health
/api/mrt?station=A1&debug=1
/api/mrt?station=A3&debug=1
/api/mrt?station=A13&debug=1
/api/mrt?station=A22&debug=1
```

Successful MRT responses must contain:

```json
{
  "ok": true,
  "mode": "timetable",
  "source": "Taoyuan City Government Open Data",
  "sourceType": "structured-xml"
}
```

The timetable source is the official Taoyuan City Government Open Data XML dataset. TDX LiveBoard is optional secondary information only.
