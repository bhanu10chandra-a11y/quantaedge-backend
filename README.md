# QuantaEdge NSE Screener

Production-grade web screener for NIFTY, BANKNIFTY, SENSEX, and F&O stocks.

## Features

- Call Buy / Put Buy / Cash Buy / Wait
- Quantum Score
- GEX-based targets
- OI sentiment
- Institutional support/target probability
- Sideways alerts
- Instant exit alerts
- Dhan integration scaffold
- Configurable feed provider layer
- Live WebSocket updates

## Run backend

```bash
cd backend
npm install
cp .env.example .env
npm start
```

## Run frontend

Open `frontend/index.html` in a browser, or serve it with any static host.

The frontend auto-detects the backend URL. For public hosting, set `window.QUANTAEDGE_API_URL` before loading the app if the backend is hosted on a separate domain.

## Feed configuration

Default mode is a mock feed:

```env
FEED_PROVIDER=mock
```

Dhan mode:

```env
FEED_PROVIDER=dhan
DHAN_CLIENT_ID=your_client_id
DHAN_ACCESS_TOKEN=your_access_token
DHAN_SUBSCRIBE_MESSAGE={"RequestCode":15,"InstrumentCount":0,"InstrumentList":[]}
```

Generic WebSocket feed mode:

```env
FEED_PROVIDER=custom
FEED_WS_URL=wss://example.com/feed
FEED_AUTH_TOKEN=optional_bearer_token
FEED_SUBSCRIBE_MESSAGE={"type":"subscribe","symbols":["NIFTY"]}
```

The signal logic remains in `backend/signal-engine.js`.
