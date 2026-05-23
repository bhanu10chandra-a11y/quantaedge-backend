// dhan-feed.js — Dhan WebSocket v2 live feed adapter
// Connects to real Dhan feed when credentials are present,
// falls back to simulation mode automatically.
import WebSocket from 'ws';

let activeFeed = null;

export function startDhanFeed({ clientId, accessToken, onTick, onStatus }) {
  // Stop any existing feed
  if (activeFeed) {
    try { activeFeed.terminate(); } catch(e){}
    activeFeed = null;
  }

  // If no real creds → simulation mode
  if (!clientId || !accessToken) {
    onStatus?.({ mode:'simulated', message:'No Dhan credentials — running simulated feed.' });
    return startSimFeed({ onTick });
  }

  onStatus?.({ mode:'connecting', message:'Connecting to Dhan live feed...' });

  // Dhan v2 WebSocket URL
  const url = `wss://api-feed.dhan.co?version=2&token=${accessToken}&clientId=${clientId}&authType=2`;

  let ws;
  try {
    ws = new WebSocket(url);
    activeFeed = ws;
  } catch(e) {
    onStatus?.({ mode:'error', message:'Dhan WS connect error: ' + e.message });
    return startSimFeed({ onTick });
  }

  ws.on('open', () => {
    onStatus?.({ mode:'live', message:'Dhan live feed connected.' });
    // Subscribe to index instruments
    const subscribeMsg = {
      RequestCode: 15,
      InstrumentCount: 3,
      InstrumentList: [
        { ExchangeSegment: 'IDX_I', SecurityId: '13'  }, // NIFTY
        { ExchangeSegment: 'IDX_I', SecurityId: '25'  }, // BANKNIFTY
        { ExchangeSegment: 'IDX_I', SecurityId: '51'  }  // SENSEX
      ]
    };
    ws.send(JSON.stringify(subscribeMsg));
  });

  ws.on('message', (data) => {
    try {
      // Dhan sends binary packets — parse LTP from buffer
      if (Buffer.isBuffer(data)) {
        const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
        if (data.length >= 24) {
          const secId = view.getUint32(4, false);
          const ltp   = view.getFloat32(16, false);
          const symbolMap = { 13:'NIFTY', 25:'BANKNIFTY', 51:'SENSEX' };
          const symbol = symbolMap[secId];
          if (symbol && ltp > 0) {
            onTick?.({ symbol, ltp, ts: new Date().toISOString() });
          }
        }
      }
    } catch(e) {}
  });

  ws.on('close', (code) => {
    onStatus?.({ mode:'disconnected', message:`Dhan feed closed (code ${code}). Reconnecting in 5s...` });
    setTimeout(() => startDhanFeed({ clientId, accessToken, onTick, onStatus }), 5000);
  });

  ws.on('error', (err) => {
    onStatus?.({ mode:'error', message:'Dhan feed error: ' + err.message });
  });

  return () => { try { ws.terminate(); } catch(e){} };
}

// Simulation fallback — identical tick shape to live feed
function startSimFeed({ onTick }) {
  const seeds = [
    { symbol:'NIFTY',     ltp:24826 },
    { symbol:'BANKNIFTY', ltp:53310 },
    { symbol:'SENSEX',    ltp:81320 },
    { symbol:'RELIANCE',  ltp:3019  },
    { symbol:'HDFCBANK',  ltp:1688  },
    { symbol:'TCS',       ltp:3910  },
    { symbol:'INFY',      ltp:1555  },
    { symbol:'SBIN',      ltp:840   }
  ];
  const timer = setInterval(() => {
    for (const s of seeds) {
      s.ltp += Math.round(Math.random()*20-10);
      onTick?.({ symbol:s.symbol, ltp:s.ltp, oichange:Math.round(Math.random()*1200-300), volume:Math.round(100000+Math.random()*50000), ts:new Date().toISOString() });
    }
  }, 1000);
  return () => clearInterval(timer);
}
