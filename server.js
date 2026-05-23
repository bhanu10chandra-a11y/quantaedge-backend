// server.js — QuantaEdge backend
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { WebSocketServer } from 'ws';
import { universe } from './universe.js';
import { buildUniverseRows } from './signal-engine.js';
import { memoryStore } from './storage.js';
import { broadcast } from './ws-broadcast.js';
import { startDhanFeed } from './dhan-feed.js';
dotenv.config();

const app  = express();
const PORT = process.env.PORT || 8080;
const store = memoryStore();

// Access password — set in .env as SCREENER_PASSWORD, default 'quantaedge'
const SCREENER_PASS = process.env.SCREENER_PASSWORD || 'quantaedge2024';

app.use(cors({ origin: '*' }));
app.use(express.json());

// ── Auth middleware for API routes ──
function requireAuth(req, res, next) {
  const pass = req.headers['x-screener-pass'] || req.query.pass;
  if (pass !== SCREENER_PASS) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// ── Public endpoints ──
app.get('/health', (_req, res) => res.json({ ok:true, service:'quantaedge-backend', ts:new Date().toISOString() }));

// Auth check
app.post('/api/auth', (req, res) => {
  const { password } = req.body;
  if (password === SCREENER_PASS) return res.json({ ok:true, token: SCREENER_PASS });
  res.status(401).json({ ok:false, error:'Wrong password' });
});

// ── Protected endpoints ──
app.get('/api/universe', requireAuth, (_req, res) => res.json({ universe }));
app.get('/api/signals',  requireAuth, (_req, res) => res.json(store.getLatest() || { rows:[] }));
app.get('/api/alerts',   requireAuth, (_req, res) => res.json({ alerts: store.getAlerts() }));

// Dhan credentials update — stored in memory, never logged
app.post('/api/dhan/credentials', requireAuth, (req, res) => {
  const { clientId, accessToken } = req.body;
  if (!clientId || !accessToken) return res.status(400).json({ error:'Both clientId and accessToken required' });
  store.setDhanCreds({ clientId, accessToken });
  // Restart feed with new creds
  restartFeed();
  res.json({ ok:true, message:'Dhan credentials updated. Feed reconnecting...' });
});

app.get('/api/dhan/status', requireAuth, (_req, res) => {
  const creds = store.getDhanCreds();
  res.json({
    hasCreds: store.hasCreds(),
    clientId: creds.clientId ? creds.clientId.slice(0,3) + '****' : '',
    feedMode: store.getFeedMode?.() || 'simulated'
  });
});

// Simulate alert (protected)
app.post('/api/alert/simulate', requireAuth, (req, res) => {
  const msg = req.body?.message || 'Exit alert triggered manually.';
  const alert = { time:new Date().toISOString(), message:msg, type:'manual' };
  store.pushAlert(alert);
  broadcast(wss, { type:'alert', alert });
  res.json({ ok:true, alert });
});

// ── HTTP server ──
const server = app.listen(PORT, () => console.log(`✅ QuantaEdge backend running on port ${PORT}`));

// ── WebSocket server ──
const wss = new WebSocketServer({ server, path:'/ws' });

wss.on('connection', (ws, req) => {
  // Require pass as query param: ws://host/ws?pass=xxx
  const url    = new URL(req.url, `http://localhost`);
  const pass   = url.searchParams.get('pass');
  if (pass !== SCREENER_PASS) {
    ws.send(JSON.stringify({ type:'error', message:'Unauthorized' }));
    ws.close();
    return;
  }
  ws.send(JSON.stringify({ type:'hello', message:'Connected to QuantaEdge backend', ts:new Date().toISOString() }));
  // Send latest signals immediately on connect
  const latest = store.getLatest();
  if (latest) ws.send(JSON.stringify({ type:'signals', ...latest }));
});

// ── Signal engine loop ──
let cfg = { callThreshold:76, cashThreshold:65, revThreshold:85 };
let liveSpots = {};
universe.forEach(u => liveSpots[u.symbol] = u.spot);

function buildAndBroadcast() {
  const enriched = universe.map(u => ({ ...u, liveSpot: liveSpots[u.symbol] ?? u.spot }));
  const rows = buildUniverseRows(enriched, cfg);
  const payload = { ts:new Date().toISOString(), rows };
  store.setLatest(payload);
  broadcast(wss, { type:'signals', ...payload });

  // Auto reversal alert
  const top = [...rows].sort((a,b)=>b.reversalScore-a.reversalScore)[0];
  if (top && top.reversalScore > cfg.revThreshold) {
    const alert = { time:new Date().toISOString(), message:`${top.symbol} ${top.strike} reversal score ${top.reversalScore} — consider exiting.`, type:'reversal' };
    store.pushAlert(alert);
    broadcast(wss, { type:'alert', alert });
  }
}

buildAndBroadcast();
const scanLoop = setInterval(buildAndBroadcast, 3000);

// ── Dhan feed ──
let stopFeed = null;
function restartFeed() {
  if (stopFeed) stopFeed();
  const creds = store.getDhanCreds();
  stopFeed = startDhanFeed({
    clientId:     process.env.DHAN_CLIENT_ID    || creds.clientId,
    accessToken:  process.env.DHAN_ACCESS_TOKEN || creds.accessToken,
    onTick(tick) {
      if (tick.ltp > 0) liveSpots[tick.symbol] = tick.ltp;
    },
    onStatus(s) {
      console.log(`[Dhan Feed] ${s.mode}: ${s.message}`);
      broadcast(wss, { type:'feedStatus', ...s });
    }
  });
}
restartFeed();

process.on('SIGTERM', () => { clearInterval(scanLoop); if(stopFeed) stopFeed(); process.exit(0); });
