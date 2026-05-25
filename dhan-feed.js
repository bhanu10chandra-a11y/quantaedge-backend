// dhan-feed.js — Dhan WebSocket v2 — CORRECT per official docs
// URL: wss://api-feed.dhan.co?version=2&token=xxx&clientId=xxx&authType=2
// Auth: query params ONLY (not headers)
// Request: JSON  |  Response: Binary Little Endian
// Header: 8 bytes — byte[0]=type, bytes[1-2]=msgLen(int16), byte[3]=segment, bytes[4-7]=securityId(int32 LE)
// Ticker(type 2): bytes[8-11]=LTP(float32 LE), bytes[12-15]=LTT(int32 LE)
// Quote (type 4): bytes[8-11]=LTP, [12-13]=LTQ, [14-17]=LTT, [18-21]=ATP, [22-25]=Vol, [26-29]=SellQty, [30-33]=BuyQty, [34-37]=Open, [38-41]=Close, [42-45]=High, [46-49]=Low
// OI   (type 5): bytes[8-11]=OI(int32 LE)
// Full (type 8): bytes[8-11]=LTP, ..., [34-37]=OI
// Prev (type 6): bytes[8-11]=PrevClose, [12-15]=PrevOI
// Disc (type 50): bytes[8-9]=reason code

import { WebSocket } from 'ws';

let activeWS = null;
let stopRequested = false;
let reconnectTimer = null;
let reconnectAttempts = 0;

export function startDhanFeed({ clientId, accessToken, onTick, onStatus }) {
  stopRequested = false;
  reconnectAttempts = 0;

  if (!clientId || !accessToken) {
    onStatus?.({ mode: 'simulated', message: 'No credentials — simulated feed running.' });
    return startSimFeed({ onTick });
  }

  connect(clientId, accessToken, onTick, onStatus);

  return function stop() {
    stopRequested = true;
    clearTimeout(reconnectTimer);
    if (activeWS) { try { activeWS.terminate(); } catch (e) {} activeWS = null; }
  };
}

function connect(clientId, accessToken, onTick, onStatus) {
  if (stopRequested) return;
  onStatus?.({ mode: 'connecting', message: 'Connecting to Dhan live feed...' });

  // ✅ CORRECT: credentials in query params per official Dhan v2 docs
  const url = `wss://api-feed.dhan.co?version=2&token=${encodeURIComponent(accessToken)}&clientId=${encodeURIComponent(clientId)}&authType=2`;

  console.log(`[Dhan] Connecting... clientId=${clientId.slice(0,4)}**** attempt=${reconnectAttempts+1}`);

  try {
    const ws = new WebSocket(url, { handshakeTimeout: 20000 });
    activeWS = ws;

    ws.on('open', () => {
      reconnectAttempts = 0;
      onStatus?.({ mode: 'live', message: `Dhan live feed connected ✓ clientId=${clientId.slice(0,4)}****` });
      console.log('[Dhan] ✓ Connected. Sending subscription...');

      // ✅ CORRECT: RequestCode 15 = Quote subscription per docs
      // Sending indices on IDX_I and equities on NSE_EQ
      const sub = {
        RequestCode: 15,
        InstrumentCount: 8,
        InstrumentList: [
          { ExchangeSegment: 'IDX_I',  SecurityId: '13'    }, // NIFTY 50
          { ExchangeSegment: 'IDX_I',  SecurityId: '25'    }, // BANKNIFTY
          { ExchangeSegment: 'IDX_I',  SecurityId: '51'    }, // SENSEX
          { ExchangeSegment: 'NSE_EQ', SecurityId: '2885'  }, // RELIANCE
          { ExchangeSegment: 'NSE_EQ', SecurityId: '1333'  }, // HDFCBANK
          { ExchangeSegment: 'NSE_EQ', SecurityId: '11536' }, // TCS
          { ExchangeSegment: 'NSE_EQ', SecurityId: '1594'  }, // INFY
          { ExchangeSegment: 'NSE_EQ', SecurityId: '3045'  }  // SBIN
        ]
      };
      ws.send(JSON.stringify(sub));
      console.log('[Dhan] Subscription sent for 8 instruments');
    });

    ws.on('message', (data) => {
      try {
        const tick = parseDhanPacket(data);
        if (tick) onTick?.(tick);
      } catch (e) {
        // silent — ignore malformed packets
      }
    });

    ws.on('close', (code, reason) => {
      activeWS = null;
      if (stopRequested) return;
      const delay = getDelay();
      const msg = `Dhan feed closed (${code}). Reconnecting in ${(delay/1000).toFixed(0)}s...`;
      console.log('[Dhan]', msg, reason?.toString?.() || '');
      onStatus?.({ mode: 'disconnected', message: msg });
      // Code 805 = too many connections (>5)
      if (code === 805) { onStatus?.({ mode:'error', message:'Too many WebSocket connections (max 5). Close others and retry.' }); return; }
      reconnectAttempts++;
      reconnectTimer = setTimeout(() => connect(clientId, accessToken, onTick, onStatus), delay);
    });

    ws.on('error', (err) => {
      const msg = err?.message || 'Unknown WS error';
      console.error('[Dhan] WS error:', msg);
      onStatus?.({ mode: 'error', message: 'Feed error: ' + msg });
      // close event will handle reconnect
    });

  } catch (e) {
    console.error('[Dhan] Connect exception:', e.message);
    onStatus?.({ mode: 'error', message: 'Connect failed: ' + e.message });
    reconnectAttempts++;
    reconnectTimer = setTimeout(() => connect(clientId, accessToken, onTick, onStatus), getDelay());
  }
}

function getDelay() {
  return Math.min(5000 * Math.pow(1.5, reconnectAttempts), 30000);
}

// ✅ CORRECT binary packet parser per official Dhan v2 docs (Little Endian)
// Header layout (8 bytes):
//   byte 0      : feed response code (type)
//   bytes 1-2   : message length (int16 LE)
//   byte 3      : exchange segment
//   bytes 4-7   : security ID (int32 LE)
const SEC_MAP = {
  13: 'NIFTY', 25: 'BANKNIFTY', 51: 'SENSEX',
  2885: 'RELIANCE', 1333: 'HDFCBANK', 11536: 'TCS',
  1594: 'INFY', 3045: 'SBIN'
};

function parseDhanPacket(data) {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  if (buf.length < 8) return null;

  const type  = buf.readUInt8(0);       // byte 0: response code
  const secId = buf.readInt32LE(4);     // bytes 4-7: security ID (LE)
  const sym   = SEC_MAP[secId];
  if (!sym) return null;

  // type 2 = Ticker packet: LTP at bytes 8-11
  if (type === 2 && buf.length >= 12) {
    const ltp = buf.readFloatLE(8);
    if (ltp > 0) return { symbol: sym, ltp: parseFloat(ltp.toFixed(2)), oi: 0, volume: 0, ts: new Date().toISOString() };
  }

  // type 4 = Quote packet: LTP bytes 8-11, Vol bytes 22-25
  if (type === 4 && buf.length >= 50) {
    const ltp = buf.readFloatLE(8);
    const vol = buf.readInt32LE(22);
    if (ltp > 0) return { symbol: sym, ltp: parseFloat(ltp.toFixed(2)), oi: 0, volume: vol, ts: new Date().toISOString() };
  }

  // type 5 = OI packet: OI at bytes 8-11
  // (supplement only, no LTP — skip as standalone)

  // type 8 = Full packet: LTP bytes 8-11, Vol bytes 22-25, OI bytes 34-37
  if (type === 8 && buf.length >= 63) {
    const ltp = buf.readFloatLE(8);
    const vol = buf.readInt32LE(22);
    const oi  = buf.readInt32LE(34);
    if (ltp > 0) return { symbol: sym, ltp: parseFloat(ltp.toFixed(2)), oi, volume: vol, ts: new Date().toISOString() };
  }

  // type 6 = Prev close (ignore — no live price)
  // type 50 = Disconnect packet
  if (type === 50 && buf.length >= 10) {
    const code = buf.readInt16LE(8);
    console.log('[Dhan] Disconnect packet received. Code:', code);
  }

  return null;
}

// ── Simulation fallback (identical tick shape) ──
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
      onTick?.({ symbol: s.symbol, ltp: s.ltp, oi: Math.round(Math.random() * 100000), volume: Math.round(100000 + Math.random() * 50000), ts: new Date().toISOString() });
    }
  }, 1000);
  return () => clearInterval(t);
}
