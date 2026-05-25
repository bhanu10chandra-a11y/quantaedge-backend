import dotenv from 'dotenv';
import { WebSocket } from 'ws';

dotenv.config();

function startMockFeed({ onTick }) {
  const seeds = [
    { symbol: 'NIFTY', ltp: 24826 },
    { symbol: 'BANKNIFTY', ltp: 53310 },
    { symbol: 'SENSEX', ltp: 81320 }
  ];

  setInterval(() => {
    for (const s of seeds) {
      const tick = {
        symbol: s.symbol,
        ltp: s.ltp + Math.round(Math.random() * 20 - 10),
        oichange: Math.round(Math.random() * 1200 - 300),
        volume: Math.round(100000 + Math.random() * 50000),
        ts: new Date().toISOString(),
        provider: 'mock'
      };
      onTick?.(tick);
    }
  }, 1000);
}

function parseJsonTick(data, provider) {
  const raw = JSON.parse(data.toString());
  return {
    symbol: raw.symbol || raw.tradingSymbol || raw.security || raw.instrument || 'UNKNOWN',
    ltp: Number(raw.ltp || raw.last_price || raw.lastTradedPrice || raw.price || 0),
    oichange: Number(raw.oichange || raw.oiChange || raw.openInterestChange || 0),
    volume: Number(raw.volume || raw.vol || 0),
    ts: raw.ts || raw.timestamp || new Date().toISOString(),
    provider
  };
}

function startGenericWebSocketFeed({ onTick, provider }) {
  const url = process.env.FEED_WS_URL;
  if (!url) {
    throw new Error(`FEED_WS_URL is required when FEED_PROVIDER=${provider}`);
  }

  const ws = new WebSocket(url, {
    headers: {
      Authorization: process.env.FEED_AUTH_TOKEN ? `Bearer ${process.env.FEED_AUTH_TOKEN}` : undefined
    }
  });

  ws.on('open', () => {
    if (process.env.FEED_SUBSCRIBE_MESSAGE) {
      ws.send(process.env.FEED_SUBSCRIBE_MESSAGE);
    }
  });

  ws.on('message', data => {
    try {
      onTick?.(parseJsonTick(data, provider));
    } catch (err) {
      console.error(`Unable to parse ${provider} feed message`, err.message);
    }
  });

  ws.on('error', err => console.error(`${provider} feed error`, err.message));
  ws.on('close', () => console.error(`${provider} feed closed`));
}

function startDhanWebSocketFeed({ onTick }) {
  const clientId = process.env.DHAN_CLIENT_ID;
  const token = process.env.DHAN_ACCESS_TOKEN;
  if (!clientId || !token || clientId === 'your_client_id' || token === 'your_access_token') {
    console.warn('Dhan credentials missing; falling back to mock feed.');
    startMockFeed({ onTick });
    return;
  }

  const url = `wss://api-feed.dhan.co?version=2&token=${encodeURIComponent(token)}&clientId=${encodeURIComponent(clientId)}&authType=2`;
  const ws = new WebSocket(url);

  ws.on('open', () => {
    const subscribeMessage = process.env.DHAN_SUBSCRIBE_MESSAGE || JSON.stringify({
      RequestCode: 15,
      InstrumentCount: 0,
      InstrumentList: []
    });
    ws.send(subscribeMessage);
  });

  ws.on('message', data => {
    if (typeof data === 'string' || data.toString().startsWith('{')) {
      try {
        onTick?.(parseJsonTick(data, 'dhan'));
      } catch (err) {
        console.error('Unable to parse Dhan JSON feed message', err.message);
      }
      return;
    }

    onTick?.({
      symbol: 'DHAN_BINARY_PACKET',
      ltp: 0,
      oichange: 0,
      volume: 0,
      ts: new Date().toISOString(),
      provider: 'dhan'
    });
  });

  ws.on('error', err => console.error('Dhan feed error', err.message));
  ws.on('close', () => console.error('Dhan feed closed'));
}

export async function startDhanFeed({ onTick }) {
  const provider = (process.env.FEED_PROVIDER || 'mock').toLowerCase();
  if (provider === 'mock') {
    startMockFeed({ onTick });
    return;
  }
  if (provider === 'dhan') {
    startDhanWebSocketFeed({ onTick });
    return;
  }
  startGenericWebSocketFeed({ onTick, provider });
}
