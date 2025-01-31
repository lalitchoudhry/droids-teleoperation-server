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

// Add active streams tracking
const activeStreams = new Set();

// Add temporary frame metadata storage
const frameMetadata = new Map();

// WebSocket connection handler
wss.on("connection", (ws, req) => {
  ws.on("message", (data) => {
    try {
      const jsonData = JSON.parse(data);

      if (jsonData.type === "register") {
        clients.set(ws, {
          role: jsonData.role,
          streamId: jsonData.streamId,
        });

        if (jsonData.role === "streamer") {
          activeStreams.add(jsonData.streamId);
          // Broadcast active streams list to all multi-viewers
          const activeStreamsMessage = JSON.stringify({
            type: "active-streams",
            streams: Array.from(activeStreams),
          });

          clients.forEach((info, client) => {
            if (
              client.readyState === WebSocket.OPEN &&
              info.role === "multi-viewer"
            ) {
              client.send(activeStreamsMessage);
            }
          });
        }
      } else if (jsonData.type === "frame") {
        // Store metadata temporarily for the next binary frame
        frameMetadata.set(ws, jsonData.streamId);
      }
    } catch (error) {
      // If JSON parsing fails, it's binary video data
      const clientInfo = clients.get(ws);
      const streamId = frameMetadata.get(ws); // Get the stored streamId

      if (clientInfo?.role === "streamer" && streamId) {
        // Forward video data only to relevant viewers
        clients.forEach((info, client) => {
          if (
            client !== ws &&
            client.readyState === WebSocket.OPEN &&
            (info.streamId === streamId || info.streamId === "all")
          ) {
            try {
              client.send(data);
            } catch (sendError) {
              console.error("Error sending video data:", sendError);
            }
          }
        });
        // Clear the metadata after use
        frameMetadata.delete(ws);
      }
    }
  });

  ws.on("close", () => {
    const clientInfo = clients.get(ws);
    if (clientInfo?.role === "streamer") {
      activeStreams.delete(clientInfo.streamId);
      // Notify multi-viewers about stream removal
      const activeStreamsMessage = JSON.stringify({
        type: "active-streams",
        streams: Array.from(activeStreams),
      });

      clients.forEach((info, client) => {
        if (
          client.readyState === WebSocket.OPEN &&
          info.role === "multi-viewer"
        ) {
          client.send(activeStreamsMessage);
        }
      });
    }
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
