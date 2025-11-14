// === server.js ===
const express = require("express");
const mqtt = require("mqtt");
const cors = require("cors");
const mongoose = require("mongoose");
const https = require("https");
const WebSocket = require("ws");
const fs = require("fs");
require("dotenv").config();
require("./configuration");

const { DustbinModel } = require("./UserSchema");

const app = express();

// === Load HTTPS certificate (combined PEM for cert+key) ===
const httpsCredentials = {
  cert: fs.readFileSync(process.env.CERTPATH || "./etc/coraltele/certs/wss.pem"),
  key: fs.readFileSync(process.env.CERTPATH || "./etc/coraltele/certs/wss.pem"),
};

const server = https.createServer(httpsCredentials, app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3023;
const IPAddress = process.env.IPAddress || "localhost";

const brokerUrl = process.env.NeoTechBrokerUrl || "mqtts://ccsp.m2m.minfoway.com:8883";

const mqttOptions = {
  protocol: "mqtts",
  clientId: process.env.NeoTechClientId || "SOTcorws-02",
  rejectUnauthorized: true,
  cert: fs.readFileSync(process.env.MQTTS_CERT_PATH || "./certs/SOTcorws-02.crt"),
  key: fs.readFileSync(process.env.MQTTS_KEY_PATH || "./certs/SOTcorws-02.key"),
  ca: fs.readFileSync(process.env.MQTTS_CA_PATH || "./certs/ca.crt"),
};

const client = mqtt.connect(brokerUrl, mqttOptions);

let mqttConnected = false;
let mqttErrorShown = false;

client.on("connect", () => {
  if (!mqttConnected) {
    console.log("✅ Connected to MQTT broker");
    mqttConnected = true;
  }

  client.subscribe("/oneM2M/req/CSE001/SOTcorws-02/json", { qos: 1 }, (err) => {
    if (err) console.error("❌ MQTT subscribe error:", err.message);
    else console.log("📡 Subscribed to topic: /oneM2M/req/CSE001/SOTcorws-02/json");
  });
});

client.on("error", (error) => {
  if (!mqttErrorShown) {
    console.error("❌ MQTT connection error:", error.message);
    mqttErrorShown = true;
  }
});

client.on("close", () => {
  if (mqttConnected) {
    console.warn("⚠️ MQTT disconnected");
    mqttConnected = false;
  }
});

client.on("message", async (topic, message) => {
  console.log("\n📨 MQTT Message Received");
  console.log("📍 Topic:", topic);
  console.log("📦 Raw Payload:", message.toString());

  try {
    const parsed = JSON.parse(message.toString());
    const cin = parsed?.pc?.["m2m:sgn"]?.nev?.rep?.["m2m:cin"];
    const data = cin?.con;

    const timestamp = cin?.ct
      ? new Date(
          cin.ct.replace(
            /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/, "$1-$2-$3T$4:$5:$6Z"
          )
        )
      : new Date();

    if (!data || typeof data !== "object") {
      console.warn("⚠️ Unexpected payload format");
      return;
    }

    const dustbinId = data.dusbinId || data.dustbinId;
    const dustbinName = data.dustbinName || "Unknown";
    const latitude = parseFloat(data.latitude ?? "0");
    const longitude = parseFloat(data.longitude ?? "0");

    if (!dustbinId) {
      console.warn("⚠️ No dustbinId found in payload");
      return;
    }

    const readings = {
      temperature: { value: parseFloat(data.temp), timestamp },
      humidity: { value: parseFloat(data.humidity), timestamp },
      gas: { value: parseFloat(data.gas), timestamp },
      depth: { value: parseFloat(data.depth), timestamp },
    };

    const update = {
      $setOnInsert: {
        dustbinName,
        latitude,
        longitude,
      },
      $push: {
        temperature: readings.temperature,
        humidity: readings.humidity,
        gas: readings.gas,
        depth: readings.depth,
      },
    };

    await DustbinModel.findOneAndUpdate(
      { dustbinId },
      update,
      { new: true, upsert: true }
    );

    console.log(`✅ Updated dustbin ${dustbinId} with new data`);
  } catch (e) {
    console.error("❌ MQTT parse error:", e.message);
    console.log("❌ Raw message was:", message.toString());
  }
});

wss.on("connection", (ws) => {
  console.log("🔌 WebSocket connected");
  ws.send("WebSocket connected to server");
});

app.get("/dustbins", async (req, res) => {
  try {
    const all = await DustbinModel.find();
    res.json(all);
  } catch (err) {
    res.status(500).json({ error: "Fetch failed" });
  }
});

app.get("/dustbins/:dustbinId", async (req, res) => {
  try {
    const dustbin = await DustbinModel.findOne({ dustbinId: req.params.dustbinId });
    if (!dustbin) return res.status(404).json({ message: "Not found" });
    res.json(dustbin);
  } catch (err) {
    res.status(500).json({ message: "Error", error: err.message });
  }
});

setInterval(async () => {
  try {
    const dustbins = await DustbinModel.find();
    dustbins.forEach((dustbin) => {
      ["temperature", "humidity", "gas", "depth"].forEach((param) => {
        const history = dustbin[param];
        if (Array.isArray(history) && history.length > 0) {
          const latest = history[history.length - 1];
          if (latest?.value >= 75) {
            const alertPayload = {
              alert: true,
              dustbinId: dustbin.dustbinId,
              parameter: param,
              value: latest.value,
            };
            wss.clients.forEach((client) => {
              if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify(alertPayload));
              }
            });
          }
        }
      });
    });
  } catch (err) {
    console.error("❌ Error in alert interval:", err.message);
  }
}, 5000);

mongoose.connection.on("error", (err) => console.error("MongoDB Error:", err));
mongoose.connection.once("open", () => {
  console.log("✅ MongoDB Connected");
  server.listen(PORT, IPAddress, () => {
    console.log(`🚀 Server running at https://${IPAddress}:${PORT}`);
    console.log("🌐 WebSocket server is ready (WSS)");
  });

  process.on("SIGINT", () => {
    console.log("👋 Graceful shutdown");
    client.end();
    server.close(() => process.exit(0));
  });
});

