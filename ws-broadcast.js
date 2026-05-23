// ws-broadcast.js — broadcast to all connected WebSocket clients
export function broadcast(wss, payload) {
  const msg = JSON.stringify(payload);
  wss.clients.forEach(client => {
    if (client.readyState === 1) client.send(msg);
  });
}
