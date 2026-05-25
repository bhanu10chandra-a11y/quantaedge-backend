---
name: testing-quantaedge-screener
description: Test the QuantaEdge screener dashboard end-to-end. Use when verifying frontend/backend screener, filters, WebSocket updates, alerts, or feed configuration changes.
---

# QuantaEdge Screener Testing

## Devin Secrets Needed

- No secret is required for mock-feed local testing.
- `DHAN_CLIENT_ID` and `DHAN_ACCESS_TOKEN` are needed to test real Dhan live feed mode.
- For a generic live WebSocket provider, use provider-specific secrets such as `FEED_AUTH_TOKEN` plus non-secret config like `FEED_WS_URL` and `FEED_SUBSCRIBE_MESSAGE`.

## Setup

1. Install dependencies from the repo root:
   ```bash
   npm install
   ```
2. Validate backend syntax:
   ```bash
   npm run check
   ```
3. Start the mock-feed backend and static frontend from the repo root:
   ```bash
   PORT=8080 FEED_PROVIDER=mock npm start
   ```
4. Open `http://localhost:8080/` in Chrome. If exposing publicly, expose the same backend port because the backend serves the frontend and WebSocket route from one origin.

## Primary UI Test Flow

1. Confirm the dashboard title is `QuantaEdge NSE Production Screener`.
2. Confirm the status pills show `API live` and `WS live` and the header updates over time.
3. Confirm the unfiltered mock dataset renders `59` total rows.
4. Click the `NIFTY` tab and confirm total rows become `10` with only NIFTY rows visible.
5. Type `24800 CE` in `Search symbol / strike` and confirm total rows become `1` with only `NIFTY 24800 CE` visible.
6. Clear search, select `WAIT` in the Decision dropdown, and confirm all visible decision badges read `WAIT`.
7. Click `Simulate exit alert` and confirm `Manual reversal exit alert from dashboard.` appears in `Live Alerts` without refreshing the page.

## Notes

- Real live-market testing is not covered by mock mode; use `FEED_PROVIDER=dhan` or a custom provider config only after server-side credentials and provider payload mapping are available.
- Browser recording is useful for this app because the value is primarily visual: table rows, filters, status pills, and alert updates.
