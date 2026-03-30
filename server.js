// Ham Radio Group Chat - WebSocket Server
// Run with: node server.js
// Free hosting: Render.com, Railway.app, or Glitch.com

const http = require("http");
const WebSocket = require("ws");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;

// In-memory store (resets on restart — use a DB for persistence)
const rooms = {}; // { joinKey: { name, createdAt, messages[], clients: Set } }

const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  // Serve a minimal health check
  if (req.url === "/health") {
    res.writeHead(200);
    res.end("QSY OK");
  } else {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Ham Radio Chat Server Running");
  }
});

const wss = new WebSocket.Server({ server });

function generateKey() {
  return crypto.randomBytes(3).toString("hex").toUpperCase(); // e.g. A3F9C2
}

function broadcast(room, message, excludeClient = null) {
  if (!rooms[room]) return;
  const data = JSON.stringify(message);
  rooms[room].clients.forEach((client) => {
    if (client !== excludeClient && client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
}

function getUserList(roomKey) {
  if (!rooms[roomKey]) return [];
  return Array.from(rooms[roomKey].clients)
    .filter((c) => c.readyState === WebSocket.OPEN && c.callsign)
    .map((c) => c.callsign);
}

wss.on("connection", (ws) => {
  ws.roomKey = null;
  ws.callsign = null;

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    switch (msg.type) {
      // Create a new room
      case "create_room": {
        const key = generateKey();
        const name = (msg.roomName || "Net Room").trim().slice(0, 40);
        rooms[key] = {
          name,
          createdAt: Date.now(),
          messages: [],
          clients: new Set(),
        };
        ws.send(JSON.stringify({ type: "room_created", key, name }));
        break;
      }

      // Join an existing room
      case "join_room": {
        const key = (msg.key || "").toUpperCase().trim();
        const callsign = (msg.callsign || "").toUpperCase().trim().slice(0, 12);

        if (!rooms[key]) {
          ws.send(JSON.stringify({ type: "error", message: "Room not found. Check your join key." }));
          return;
        }
        if (!callsign) {
          ws.send(JSON.stringify({ type: "error", message: "Callsign required." }));
          return;
        }

        // Leave old room if any
        if (ws.roomKey && rooms[ws.roomKey]) {
          rooms[ws.roomKey].clients.delete(ws);
          broadcast(ws.roomKey, { type: "user_left", callsign: ws.callsign, users: getUserList(ws.roomKey) });
        }

        ws.roomKey = key;
        ws.callsign = callsign;
        rooms[key].clients.add(ws);

        // Send room history (last 50 messages)
        ws.send(JSON.stringify({
          type: "joined",
          key,
          roomName: rooms[key].name,
          callsign,
          history: rooms[key].messages.slice(-50),
          users: getUserList(key),
        }));

        // Notify others
        broadcast(key, { type: "user_joined", callsign, users: getUserList(key) }, ws);
        break;
      }

      // Send a chat message
      case "message": {
        if (!ws.roomKey || !rooms[ws.roomKey]) return;
        const text = (msg.text || "").trim().slice(0, 500);
        if (!text) return;

        const entry = {
          type: "message",
          callsign: ws.callsign,
          text,
          ts: Date.now(),
        };
        rooms[ws.roomKey].messages.push(entry);
        if (rooms[ws.roomKey].messages.length > 200) rooms[ws.roomKey].messages.shift();

        // Send to everyone including sender
        const roomMsg = JSON.stringify(entry);
        rooms[ws.roomKey].clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) client.send(roomMsg);
        });
        break;
      }

      // Leave room
      case "leave_room": {
        if (ws.roomKey && rooms[ws.roomKey]) {
          rooms[ws.roomKey].clients.delete(ws);
          broadcast(ws.roomKey, { type: "user_left", callsign: ws.callsign, users: getUserList(ws.roomKey) });
          ws.roomKey = null;
          ws.callsign = null;
        }
        break;
      }
    }
  });

  ws.on("close", () => {
    if (ws.roomKey && rooms[ws.roomKey]) {
      rooms[ws.roomKey].clients.delete(ws);
      broadcast(ws.roomKey, { type: "user_left", callsign: ws.callsign, users: getUserList(ws.roomKey) });
    }
  });
});

server.listen(PORT, () => {
  console.log(`Ham Radio Chat Server listening on port ${PORT}`);
  console.log(`WebSocket endpoint: ws://localhost:${PORT}`);
});
