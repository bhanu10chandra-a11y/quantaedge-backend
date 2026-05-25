import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import { universe } from './universe.js';
import { buildSignal } from './signal-engine.js';
import { memoryStore } from './storage.js';
import { broadcast } from './ws-broadcast.js';
import { startDhanFeed } from './dhan-feed.js';

dotenv.config();

const app = express();
app.use(cors({ origin: process.env.FRONTEND_ORIGIN === '*' ? '*' : process.env.FRONTEND_ORIGIN?.split(',') }));
app.use(express.json());

const PORT = process.env.PORT || 8080;
const store = memoryStore();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.join(__dirname, 'frontend');

app.get('/health', (_req, res) => res.json({ ok: true, service: 'quantaedge-backend' }));
app.get('/api/universe', (_req, res) => res.json({ universe }));
app.get('/api/signals', (_req, res) => res.json(store.getLatest() || { rows: [] }));
app.get('/api/alerts', (_req, res) => res.json({ alerts: store.getAlerts() }));
app.get('/api/ticks', (_req, res) => res.json({ ticks: store.getTicks() }));
app.post('/api/alert/simulate', (req, res) => {
  const msg = req.body?.message || 'Exit alert triggered manually.';
  const alert = { time: new Date().toISOString(), message: msg };
  store.pushAlert(alert);
  res.json({ ok: true, alert });
  broadcast(wss, { type: 'alert', alert });
});
app.use(express.static(frontendDir));
app.get('/', (_req, res) => res.sendFile(path.join(frontendDir, 'index.html')));

const server = app.listen(PORT, () => console.log(`Server running on ${PORT}`));
const wss = new WebSocketServer({ server, path: '/ws' });
const liveSpots = {};

wss.on('connection', ws => {
  ws.send(JSON.stringify({ type: 'hello', message: 'connected to QuantaEdge backend' }));
  const latest = store.getLatest();
  if (latest) ws.send(JSON.stringify({ type: 'signals', ...latest }));
});

function buildUniverseSignals() {
  const rows = [];
  for (const u of universe) {
    const enriched = { ...u, liveSpot: liveSpots[u.symbol] ?? u.spot };
    for (const strike of u.strikes) {
      rows.push(buildSignal(enriched, strike, 'CE'));
      rows.push(buildSignal(enriched, strike, 'PE'));
      if (u.type === 'STOCK') {
        const stockScore = buildSignal(enriched, strike, 'CE');
        if (stockScore.decision === 'CASH BUY') {
          rows.push({ ...stockScore, decision: 'CASH BUY', mode: 'CASH' });
        }
      }
    }
  }
  const payload = { ts: new Date().toISOString(), rows };
  store.setLatest(payload);
  broadcast(wss, { type: 'signals', ...payload });
  const hottest = [...rows].sort((a, b) => b.reversalScore - a.reversalScore)[0];
  if (hottest && hottest.reversalScore > 85) {
    const alert = { time: new Date().toISOString(), message: `${hottest.symbol} ${hottest.strike} reversal alert. Exit immediately.` };
    store.pushAlert(alert);
    broadcast(wss, { type: 'alert', alert });
  }
}

buildUniverseSignals();
setInterval(buildUniverseSignals, 3000);
startDhanFeed({
  onTick(tick) {
    store.setTick(tick);
    if (tick.symbol && tick.ltp > 0) liveSpots[tick.symbol] = tick.ltp;
    broadcast(wss, { type: 'tick', tick });
    buildUniverseSignals();
  }
});
