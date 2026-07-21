# TDX Airport MRT setup

Crew Portal v6.7.0 reads Taoyuan Airport MRT LiveBoard data through the existing Cloudflare Pages Worker. The browser never receives the TDX secret.

## 1. Create TDX credentials

Register or sign in at TDX and create an application. Copy its Client ID and Client Secret.

## 2. Add Cloudflare Pages secrets

In Cloudflare Dashboard, open the Crew Portal Pages project:

1. Settings → Variables and Secrets
2. Add `TDX_CLIENT_ID` as a secret
3. Add `TDX_CLIENT_SECRET` as a secret
4. Add both values to Production (and Preview when needed)
5. Redeploy the project

Do not place either value in JavaScript, GitHub files, or `wrangler.toml`.

## Behaviour

- `/api/mrt?station=A13` requests TDX LiveBoard data.
- Results are cached at the edge for 30 seconds.
- If credentials, TDX, or the network are unavailable, the card automatically falls back to the local scheduled estimate.
- The card identifies the source as `TDX Live` or `Scheduled backup`.
