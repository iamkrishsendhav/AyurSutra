const mongoose = require("mongoose");

const connectDB = async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not configured");

  try {
    await mongoose.connect(uri);
    console.log("MongoDB connected");
  } catch (err) {
    console.error(`MongoDB connection failed (${err.code || err.name || "unknown error"})`);
    throw err;
  }
};

module.exports = connectDB;
