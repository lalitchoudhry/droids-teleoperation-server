const WebSocket = require("ws");

class StreamManager {
  constructor() {
    this.streams = new Map();
    this.operators = new Map();
    this.frameBuffer = new Map();

    // Configure buffer sizes and priorities
    this.config = {
      mainCamera: {
        bufferSize: 5,
        priority: 1,
        maxLatency: 100, // ms
      },
      depthCamera: {
        bufferSize: 3,
        priority: 2,
        maxLatency: 200,
      },
      defaultCamera: {
        bufferSize: 2,
        priority: 3,
        maxLatency: 300,
      },
    };

    // Add connection tracking
    this.connectionStates = new Map();

    // Start monitoring
    this.startMonitoring();
  }

  registerOperator(ws, streamId) {
    const operatorId = `operator-${Date.now()}`;
    this.operators.set(operatorId, {
      ws,
      streamId,
      connected: true,
      lastActivity: Date.now(),
    });

    // Handle ping/pong for connection monitoring
    ws.on("pong", () => {
      const operator = this.operators.get(operatorId);
      if (operator) {
        operator.lastActivity = Date.now();
      }
    });

    ws.on("close", () => {
      console.log(`Operator disconnected: ${operatorId}`);
      this.operators.delete(operatorId);
      this.notifyStreamStatus(streamId);
    });

    this.notifyStreamStatus(streamId);
    return operatorId;
  }

  processHighPriority(data, connection) {
    try {
      // Check if data is binary or metadata
      if (data instanceof Buffer) {
        // Add content type header to binary data
        const frameData = Buffer.concat([
          Buffer.from("data:image/jpeg;base64,", "utf8"),
          data,
        ]);
        this.broadcastFrame(connection.streamId, frameData);
      } else {
        // Handle metadata if needed
        const metadata = JSON.parse(data.toString());
        if (metadata.type === "frame") {
          // Store metadata for later use
          this.frameMetadata = metadata;
        }
      }
    } catch (error) {
      console.error("Error processing frame:", error);
    }
  }

  processNormal(data, connection) {
    // Ensure data is binary
    if (data instanceof Buffer) {
      this.bufferFrame(connection.streamId, data);
    } else {
      console.error("Invalid frame data format");
    }
  }

  bufferFrame(streamId, data) {
    if (!this.frameBuffer.has(streamId)) {
      this.frameBuffer.set(streamId, []);
    }

    const buffer = this.frameBuffer.get(streamId);
    const timestamp = Date.now();

    buffer.push({ data, timestamp });

    // Process buffer when it reaches threshold
    if (buffer.length >= this.getBufferSize(streamId)) {
      this.processBuffer(streamId);
    }
  }

  processBuffer(streamId) {
    const buffer = this.frameBuffer.get(streamId);
    if (!buffer || buffer.length === 0) return;

    const now = Date.now();
    const config = this.getStreamConfig(streamId);

    // Filter out old frames
    const validFrames = buffer.filter(
      (frame) => now - frame.timestamp <= config.maxLatency
    );

    if (validFrames.length > 0) {
      // Send the most recent valid frame
      const latestFrame = validFrames[validFrames.length - 1];
      this.broadcastFrame(streamId, latestFrame.data);
    }

    // Clear buffer
    this.frameBuffer.set(streamId, []);
  }

  broadcastFrame(streamId, data) {
    this.operators.forEach((operator, operatorId) => {
      if (
        operator.streamId === streamId &&
        operator.ws.readyState === WebSocket.OPEN
      ) {
        try {
          operator.ws.send(data, {
            binary: true,
            compress: true, // Enable compression
          });
        } catch (error) {
          console.error(
            `Error sending frame to operator ${operatorId}:`,
            error
          );
        }
      }
    });
  }

  getStreamConfig(streamId) {
    if (streamId === "main") return this.config.mainCamera;
    if (streamId === "depth") return this.config.depthCamera;
    return this.config.defaultCamera;
  }

  getBufferSize(streamId) {
    return this.getStreamConfig(streamId).bufferSize;
  }

  startMonitoring() {
    setInterval(() => {
      this.monitorStreams();
    }, 1000);
  }

  monitorStreams() {
    const now = Date.now();

    // Monitor frame buffers
    this.frameBuffer.forEach((buffer, streamId) => {
      if (buffer.length > 0) {
        const oldestFrame = buffer[0].timestamp;
        const latency = now - oldestFrame;

        // Log if latency is too high
        if (latency > this.getStreamConfig(streamId).maxLatency) {
          console.warn(
            `High latency detected for stream ${streamId}: ${latency}ms`
          );
          this.processBuffer(streamId); // Force process buffer
        }
      }
    });

    // Clean up disconnected operators
    this.operators.forEach((operator, operatorId) => {
      if (operator.ws.readyState !== WebSocket.OPEN) {
        this.operators.delete(operatorId);
      }
    });
  }

  notifyStreamStatus(streamId) {
    const activeOperators = Array.from(this.operators.values()).filter(
      (op) => op.streamId === streamId
    ).length;

    this.broadcastMetrics({
      type: "streamStatus",
      streamId,
      activeViewers: activeOperators,
      timestamp: Date.now(),
    });
  }

  broadcastMetrics(metrics) {
    this.operators.forEach((operator) => {
      if (operator.ws.readyState === WebSocket.OPEN) {
        try {
          operator.ws.send(JSON.stringify(metrics));
        } catch (error) {
          console.error("Error sending metrics:", error);
        }
      }
    });
  }
}

module.exports = { StreamManager };
