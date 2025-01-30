const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const cors = require("cors");

const app = express();
app.use(cors());

// Create HTTP server
const server = http.createServer(app);

// Create WebSocket server
const wss = new WebSocket.Server({ server });

// Store clients with their roles and stream types
const clients = new Map(); // Using Map to store client info

// WebSocket connection handler
wss.on("connection", (ws, req) => {
  console.log("New client connected");

  ws.on("message", (data) => {
    try {
      // First try to parse as JSON for control messages
      const jsonData = JSON.parse(data);

      if (jsonData.type === "register") {
        // Register client role and stream type
        clients.set(ws, {
          role: jsonData.role, // 'streamer' or 'viewer'
          streamId: jsonData.streamId, // 'camera1', 'camera2', etc.
        });
        console.log(
          `Client registered as ${jsonData.role} for stream ${jsonData.streamId}`
        );
      }
    } catch {
      // If not JSON, treat as video data
      const clientInfo = clients.get(ws);
      if (clientInfo && clientInfo.role === "streamer") {
        // Broadcast to viewers of this specific stream
        const streamId = clientInfo.streamId;
        clients.forEach((info, client) => {
          if (
            client !== ws &&
            client.readyState === WebSocket.OPEN &&
            info.role === "viewer" &&
            (info.streamId === streamId || info.streamId === "all") // Add support for "all" streams
          ) {
            // Add streamId to the message
            const metadata = { streamId };
            client.send(data, { metadata }); // Send with metadata
          }
        });
      }
    }
  });

  ws.on("close", () => {
    console.log("Client disconnected");
    clients.delete(ws);
  });

  ws.on("error", (error) => {
    console.error("WebSocket error:", error);
    clients.delete(ws);
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
