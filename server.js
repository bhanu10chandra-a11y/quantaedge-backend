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

const app   = express();
const PORT  = process.env.PORT || 8080;
const store = memoryStore();
const PASS  = process.env.SCREENER_PASSWORD || 'quantaedge2024';

app.use(cors({ origin:'*' }));
app.use(express.json());

function auth(req,res,next){ const p=req.headers['x-screener-pass']||req.query.pass; if(p!==PASS)return res.status(401).json({error:'Unauthorized'}); next(); }

app.get('/health', (_,res) => res.json({ ok:true, service:'quantaedge-backend', feedMode:store.getFeedMode(), hasCreds:store.hasCreds(), ts:new Date().toISOString() }));
app.post('/api/auth', (req,res) => { const {password}=req.body; if(password===PASS)return res.json({ok:true}); res.status(401).json({ok:false,error:'Wrong password'}); });
app.get('/api/signals', auth, (_,res) => res.json(store.getLatest()||{rows:[]}));
app.get('/api/alerts',  auth, (_,res) => res.json({alerts:store.getAlerts()}));
app.get('/api/dhan/status', auth, (_,res) => { const c=store.getDhanCreds(); res.json({hasCreds:store.hasCreds(),feedMode:store.getFeedMode(),clientIdHint:c.clientId?c.clientId.slice(0,3)+'****':''}); });

app.post('/api/dhan/credentials', auth, (req,res) => {
  const {clientId,accessToken}=req.body;
  if(!clientId||!accessToken) return res.status(400).json({error:'Both fields required'});
  store.setDhanCreds({clientId,accessToken});
  restartFeed();
  res.json({ok:true,message:'Credentials saved. Feed restarting...'});
});

app.post('/api/alert/simulate', auth, (req,res) => {
  const msg=req.body?.message||'Manual exit alert.';
  const alert={time:new Date().toISOString(),message:msg,type:'manual'};
  store.pushAlert(alert); broadcast(wss,{type:'alert',alert}); res.json({ok:true,alert});
});

const server = app.listen(PORT, () => console.log(`✅ QuantaEdge backend on port ${PORT}`));
const wss = new WebSocketServer({ server, path:'/ws' });

wss.on('connection',(ws,req)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.searchParams.get('pass')!==PASS){ ws.send(JSON.stringify({type:'error',message:'Unauthorized'})); ws.close(); return; }
  ws.send(JSON.stringify({type:'hello',feedMode:store.getFeedMode(),ts:new Date().toISOString()}));
  const l=store.getLatest(); if(l) ws.send(JSON.stringify({type:'signals',...l}));
});

let liveSpots={};
universe.forEach(u=>liveSpots[u.symbol]=u.spot);
const cfg={callThreshold:76,cashThreshold:65,revThreshold:85};

function buildAndBroadcast(){
  const enriched=universe.map(u=>({...u,liveSpot:liveSpots[u.symbol]??u.spot}));
  const rows=buildUniverseRows(enriched,cfg);
  const payload={ts:new Date().toISOString(),rows,feedMode:store.getFeedMode()};
  store.setLatest(payload); broadcast(wss,{type:'signals',...payload});
  const top=[...rows].sort((a,b)=>b.reversalScore-a.reversalScore)[0];
  if(top&&top.reversalScore>cfg.revThreshold){
    const alert={time:new Date().toISOString(),message:`${top.symbol} ${top.strike} reversal score ${top.reversalScore} — consider exiting.`,type:'reversal'};
    store.pushAlert(alert); broadcast(wss,{type:'alert',alert});
  }
}
buildAndBroadcast();
setInterval(buildAndBroadcast,3000);

let stopFeed=null;
function restartFeed(){
  if(stopFeed){try{stopFeed();}catch(e){} stopFeed=null;}
  const creds=store.getDhanCreds();
  const clientId   =process.env.DHAN_CLIENT_ID    ||creds.clientId   ||'';
  const accessToken=process.env.DHAN_ACCESS_TOKEN ||creds.accessToken||'';
  stopFeed=startDhanFeed({
    clientId, accessToken,
    onTick(tick){ if(tick.ltp>0) liveSpots[tick.symbol]=tick.ltp; },
    onStatus(s){ console.log(`[Dhan Feed] ${s.mode}: ${s.message}`); store.setFeedMode(s.mode); broadcast(wss,{type:'feedStatus',...s}); }
  });
}
restartFeed();
process.on('SIGTERM',()=>{ if(stopFeed)stopFeed(); process.exit(0); });
