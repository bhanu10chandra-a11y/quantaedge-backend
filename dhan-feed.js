// dhan-feed.js — Dhan WebSocket v2 with correct auth format
import { WebSocket } from 'ws';

let activeWS = null;
let stopRequested = false;
let reconnectTimer = null;
let reconnectAttempts = 0;

export function startDhanFeed({ clientId, accessToken, onTick, onStatus }) {
  stopRequested = false;
  reconnectAttempts = 0;
  if (!clientId || !accessToken) {
    onStatus?.({ mode:'simulated', message:'No credentials — simulated feed running.' });
    return startSimFeed({ onTick });
  }
  connect(clientId, accessToken, onTick, onStatus);
  return function stop() {
    stopRequested = true;
    clearTimeout(reconnectTimer);
    if (activeWS) { try { activeWS.terminate(); } catch(e){} activeWS = null; }
  };
}

function connect(clientId, accessToken, onTick, onStatus) {
  if (stopRequested) return;
  onStatus?.({ mode:'connecting', message:'Connecting to Dhan live feed...' });

  // Dhan HQ WebSocket v2 — token in Authorization header
  const url = `wss://api-feed.dhan.co`;
  try {
    const ws = new WebSocket(url, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'client-id': clientId,
        'version': '2'
      },
      handshakeTimeout: 15000
    });
    activeWS = ws;

    ws.on('open', () => {
      reconnectAttempts = 0;
      onStatus?.({ mode:'live', message:'Dhan live feed connected ✓' });
      console.log('[Dhan] Connected. Subscribing...');
      // Subscribe: RequestCode 21 = LTP subscription
      const sub = {
        RequestCode: 21,
        InstrumentCount: 8,
        InstrumentList: [
          { ExchangeSegment:'IDX_I',   SecurityId:'13'    },
          { ExchangeSegment:'IDX_I',   SecurityId:'25'    },
          { ExchangeSegment:'IDX_I',   SecurityId:'51'    },
          { ExchangeSegment:'NSE_EQ',  SecurityId:'2885'  },
          { ExchangeSegment:'NSE_EQ',  SecurityId:'1333'  },
          { ExchangeSegment:'NSE_EQ',  SecurityId:'11536' },
          { ExchangeSegment:'NSE_EQ',  SecurityId:'1594'  },
          { ExchangeSegment:'NSE_EQ',  SecurityId:'3045'  }
        ]
      };
      ws.send(JSON.stringify(sub));
      console.log('[Dhan] Subscription sent');
    });

    ws.on('message', (data) => {
      try { parseTick(data, onTick); } catch(e) {}
    });

    ws.on('close', (code, reason) => {
      activeWS = null;
      if (stopRequested) return;
      const msg = `Dhan feed closed (${code}). Reconnecting in ${getDelay()/1000}s...`;
      console.log('[Dhan]', msg, reason?.toString());
      onStatus?.({ mode:'disconnected', message: msg });
      reconnectTimer = setTimeout(() => connect(clientId, accessToken, onTick, onStatus), getDelay());
      reconnectAttempts++;
    });

    ws.on('error', (err) => {
      console.error('[Dhan] WS error:', err.message);
      onStatus?.({ mode:'error', message: 'Feed error: ' + err.message });
    });

  } catch(e) {
    console.error('[Dhan] Connect failed:', e.message);
    onStatus?.({ mode:'error', message: 'Connect failed: ' + e.message });
    reconnectTimer = setTimeout(() => connect(clientId, accessToken, onTick, onStatus), 5000);
  }
}

function getDelay() {
  return Math.min(5000 * Math.pow(1.5, reconnectAttempts), 30000);
}

const ID_MAP = { 13:'NIFTY', 25:'BANKNIFTY', 51:'SENSEX', 2885:'RELIANCE', 1333:'HDFCBANK', 11536:'TCS', 1594:'INFY', 3045:'SBIN' };

function parseTick(data, onTick) {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  if (buf.length < 8) return;
  const type  = buf.readUInt8(0);
  const secId = buf.readUInt32LE(2);
  const sym   = ID_MAP[secId];
  if (!sym) return;
  let ltp = 0, oi = 0, vol = 0;
  if (type === 1 && buf.length >= 10)  ltp = buf.readFloatLE(6);
  if (type === 2 && buf.length >= 46)  { ltp = buf.readFloatLE(6); vol = buf.readUInt32LE(22); oi = buf.readUInt32LE(34); }
  if (type === 4 && buf.length >= 100) { ltp = buf.readFloatLE(6); vol = buf.readUInt32LE(22); oi = buf.readUInt32LE(34); }
  if (ltp > 0) onTick?.({ symbol:sym, ltp:parseFloat(ltp.toFixed(2)), oi, volume:vol, ts:new Date().toISOString() });
}

export function startSimFeed({ onTick }) {
  const seeds = [
    {symbol:'NIFTY',ltp:24826},{symbol:'BANKNIFTY',ltp:53310},{symbol:'SENSEX',ltp:81320},
    {symbol:'RELIANCE',ltp:3019},{symbol:'HDFCBANK',ltp:1688},{symbol:'TCS',ltp:3910},
    {symbol:'INFY',ltp:1555},{symbol:'SBIN',ltp:840}
  ];
  const t = setInterval(() => {
    for (const s of seeds) {
      s.ltp = parseFloat((s.ltp + (Math.random()*20-10)).toFixed(2));
      onTick?.({ symbol:s.symbol, ltp:s.ltp, oi:Math.round(Math.random()*100000), volume:Math.round(100000+Math.random()*50000), ts:new Date().toISOString() });
    }
  }, 1000);
  return () => clearInterval(t);
}
