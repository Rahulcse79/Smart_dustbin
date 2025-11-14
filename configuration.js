const config = {
  port: process.env.PORT || 3023,
  mongoUri: process.env.MONGO_URI,
  mqttBroker: process.env.MQTT_BROKER,
  mqttClientId: process.env.MQTT_CLIENT_ID,
  certPath: process.env.CERT_PATH,
};

module.exports = config;
