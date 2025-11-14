// === UserSchema.js ===
const mongoose = require("mongoose");

// Each reading (temperature, humidity, gas, depth) stores both value + timestamp
const readingSchema = new mongoose.Schema({
  value: { type: Number, required: true },
  timestamp: { type: Date, default: Date.now },
});

// Dustbin schema
const DustbinSchema = new mongoose.Schema(
  {
    dustbinId: { type: String, required: true, unique: true },
    dustbinName: { type: String, default: "Unknown" },
    latitude: { type: Number, default: 0 },
    longitude: { type: Number, default: 0 },

    // Arrays of readings — history of values over time
    temperature: [readingSchema],
    humidity: [readingSchema],
    gas: [readingSchema],
    depth: [readingSchema],

    createdAt: { type: Date, default: Date.now },
  },
  { versionKey: false }
);

// Create an index for faster queries
DustbinSchema.index({ dustbinId: 1 });

const DustbinModel = mongoose.model("Dustbin", DustbinSchema);
module.exports = { DustbinModel };
