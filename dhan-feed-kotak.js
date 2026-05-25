// kotak-feed.js (replaces dhan-feed.js)
// Kotak Neo API v2 — WebSocket live feed
// Official SDK: https://github.com/Kotak-Neo/Kotak-neo-api-v2
// Auth flow: consumer_key → totp_login → totp_validate → subscribe
// This Node.js adapter mirrors the Python SDK's subscribe() method using raw WebSocket.

import https from 'https';
import WebSocket from 'ws';

let activeWS    = null;
let stopReq     = false;
let retryTimer  = null;
let retryCount  = 0;

// ─── Instrument tokens for our universe ───────────────────────────────────────
// Get exact tokens from: client.scrip_master(exchange_segment='nse_cm')
// These are the standard NSE tokens for our screener symbols
const INSTRUMENTS = [
  { instrument_token: '26000', exchange_segment: 'nse_cm', symbol: 'NIFTY',     isIndex: true  },
  { instrument_token: '26009', exchange_segment: 'nse_cm', symbol: 'BANKNIFTY', isIndex: true  },
  { instrument_token: '1',     exchange_segment: 'bse_cm', symbol: 'SENSEX',    isIndex: true  },
  { instrument_token: '2885',  exchange_segment: 'nse_cm', symbol: 'RELIANCE',  isIndex: false },
  { instrument_token: '1333',  exchange_segment: 'nse_cm', symbol: 'HDFCBANK',  isIndex: false },
  { instrument_token: '11536', exchange_segment: 'nse_cm', symbol: 'TCS',       isIndex: false },
  { instrument_token: '1594',  exchange_segment: 'nse_cm', symbol: 'INFY',      isIndex: false },
  { instrument_token: '3045',  exchange_segment: 'nse_cm', symbol: 'SBIN',      isIndex: false },
];

const TOKEN_SYMBOL_MAP = {};
INSTRUMENTS.forEach(i => { TOKEN_SYMBOL_MAP[i.instrument_token] = i.symbol; });

// ─── Main export ──────────────────────────────────────────────────────────────
export async function startDhanFeed({ clientId, accessToken, onTick, onStatus }) {
  stopReq    = false;
  retryCount = 0;

  // clientId   = Kotak Neo consumer_key (from Kotak Neo app → Invest → Trade API)
  // accessToken = sid:auth token (obtained after TOTP login — format: "SID|AUTH_TOKEN")
  //               OR just the auth token if sid is separate

  if (!clientId || !accessToken) {
    onStatus?.({ mode: 'simulated', message: 'No Kotak credentials — simulated feed running.' });
    return startSimFeed({ onTick });
  }

  // accessToken format accepted: "sid::auth_token" OR "auth_token" alone
  // We support both formats
  let sid = '', authToken = accessToken;
  if (accessToken.includes('::')) {
    [sid, authToken] = accessToken.split('::');
  }

  try {
    await connectKotakFeed({ consumerKey: clientId, sid, authToken, onTick, onStatus });
  } catch (e) {
    console.error('[Kotak] Startup error:', e.message);
    onStatus?.({ mode: 'simulated', message: 'Kotak connect failed — simulated feed active.' });
    return startSimFeed({ onTick });
  }

  return function stop() {
    stopReq = true;
    clearTimeout(retryTimer);
    if (activeWS) { try { activeWS.terminate(); } catch (e) {} activeWS = null; }
  };
}

// ─── Kotak Neo WebSocket connection ───────────────────────────────────────────
// Kotak Neo SDK internally connects to:
// wss://livefeeds.kotaksecurities.com/LiveFeeds?KoSession=<sid>&Authorization=<auth_token>&client=<consumer_key>
async function connectKotakFeed({ consumerKey, sid, authToken, onTick, onStatus }) {
  if (stopReq) return;
  onStatus?.({ mode: 'connecting', message: 'Connecting to Kotak Neo live feed...' });

  // Kotak Neo WebSocket endpoint (official)
  const wsUrl = `wss://livefeeds.kotaksecurities.com/LiveFeeds?KoSession=${encodeURIComponent(sid)}&Authorization=${encodeURIComponent(authToken)}&client=${encodeURIComponent(consumerKey)}`;

  console.log(`[Kotak] Connecting attempt ${retryCount + 1}...`);

  try {
    const ws = new WebSocket(wsUrl, { handshakeTimeout: 20000 });
    activeWS = ws;

    ws.on('open', () => {
      retryCount = 0;
      onStatus?.({ mode: 'live', message: 'Kotak Neo live feed connected ✓' });
      console.log('[Kotak] ✓ Connected. Subscribing to instruments...');
      subscribeInstruments(ws);
    });

    ws.on('message', (data) => {
      try {
        const tick = parseKotakMessage(data);
        if (tick) onTick?.(tick);
      } catch (e) {}
    });

    ws.on('close', (code, reason) => {
      activeWS = null;
      if (stopReq) return;
      const delay = Math.min(5000 * Math.pow(1.5, retryCount), 30000);
      const msg = `Kotak feed closed (${code}). Reconnecting in ${(delay/1000).toFixed(0)}s...`;
      console.log('[Kotak]', msg);
      onStatus?.({ mode: 'disconnected', message: msg });
      retryCount++;
      retryTimer = setTimeout(() => connectKotakFeed({ consumerKey, sid, authToken, onTick, onStatus }), delay);
    });

    ws.on('error', (err) => {
      console.error('[Kotak] WS error:', err.message);
      onStatus?.({ mode: 'error', message: 'Kotak feed error: ' + err.message });
    });

  } catch (e) {
    console.error('[Kotak] Connect exception:', e.message);
    onStatus?.({ mode: 'error', message: 'Connect failed: ' + e.message });
    retryCount++;
    retryTimer = setTimeout(() => connectKotakFeed({ consumerKey, sid, authToken, onTick, onStatus }), 5000);
  }
}

// ─── Subscribe instruments ────────────────────────────────────────────────────
// Kotak subscription message format (from official SDK source):
// Separate subscribe calls for index (isIndex=true) and equity (isIndex=false)
function subscribeInstruments(ws) {
  const indexTokens  = INSTRUMENTS.filter(i => i.isIndex).map(i => ({ instrument_token: i.instrument_token, exchange_segment: i.exchange_segment }));
  const equityTokens = INSTRUMENTS.filter(i => !i.isIndex).map(i => ({ instrument_token: i.instrument_token, exchange_segment: i.exchange_segment }));

  // Subscribe indices
  if (indexTokens.length > 0) {
    const subMsg = JSON.stringify({
      type: 'subscribe',
      scrips: indexTokens.map(t => `${t.exchange_segment}|${t.instrument_token}`).join('#'),
      channelnum: '1'
    });
    ws.send(subMsg);
    console.log('[Kotak] Index subscription sent:', indexTokens.map(t => t.instrument_token).join(', '));
  }

  // Subscribe equities
  if (equityTokens.length > 0) {
    const subMsg = JSON.stringify({
      type: 'subscribe',
      scrips: equityTokens.map(t => `${t.exchange_segment}|${t.instrument_token}`).join('#'),
      channelnum: '1'
    });
    ws.send(subMsg);
    console.log('[Kotak] Equity subscription sent:', equityTokens.map(t => t.instrument_token).join(', '));
  }
}

// ─── Parse Kotak Neo WebSocket message ────────────────────────────────────────
// Kotak Neo returns JSON messages like:
// { "tk":"26000", "ltp":"24826.50", "v":"12345", "oi":"0", "toi":"0", "e":"NSE" }
// Fields: tk=token, ltp=last traded price, v=volume, oi=open interest
function parseKotakMessage(data) {
  const raw = data.toString();

  // Ignore heartbeat / non-data messages
  if (raw === '' || raw === 'pong' || raw.startsWith('Connected')) return null;

  try {
    const msg = JSON.parse(raw);

    // Handle array of ticks
    if (Array.isArray(msg)) {
      // Return first valid tick (caller can handle multiple)
      for (const m of msg) {
        const tick = extractTick(m);
        if (tick) return tick;
      }
      return null;
    }

    return extractTick(msg);
  } catch (e) {
    return null;
  }
}

function extractTick(msg) {
  if (!msg) return null;

  // Kotak Neo tick fields
  const token  = msg.tk || msg.token || msg.instrument_token || '';
  const ltpRaw = msg.ltp || msg.LTP || msg.LastTradedPrice || '0';
  const volRaw = msg.v   || msg.volume || msg.Volume || '0';
  const oiRaw  = msg.oi  || msg.OI || msg.OpenInterest || '0';

  const symbol = TOKEN_SYMBOL_MAP[token];
  if (!symbol) return null;

  const ltp = parseFloat(ltpRaw);
  if (!ltp || ltp <= 0) return null;

  return {
    symbol,
    ltp:    parseFloat(ltp.toFixed(2)),
    volume: parseInt(volRaw)  || 0,
    oi:     parseInt(oiRaw)   || 0,
    ts:     new Date().toISOString()
  };
}

// ─── Simulation fallback ──────────────────────────────────────────────────────
export function startSimFeed({ onTick }) {
  const seeds = [
    { symbol: 'NIFTY',     ltp: 24826 },
    { symbol: 'BANKNIFTY', ltp: 53310 },
    { symbol: 'SENSEX',    ltp: 81320 },
    { symbol: 'RELIANCE',  ltp: 3019  },
    { symbol: 'HDFCBANK',  ltp: 1688  },
    { symbol: 'TCS',       ltp: 3910  },
    { symbol: 'INFY',      ltp: 1555  },
    { symbol: 'SBIN',      ltp: 840   }
  ];
  const t = setInterval(() => {
    for (const s of seeds) {
      s.ltp = parseFloat((s.ltp + (Math.random() * 20 - 10)).toFixed(2));
      onTick?.({
        symbol: s.symbol, ltp: s.ltp,
        oi: Math.round(Math.random() * 100000),
        volume: Math.round(100000 + Math.random() * 50000),
        ts: new Date().toISOString()
      });
    }
  }, 1000);
  return () => clearInterval(t);
}
