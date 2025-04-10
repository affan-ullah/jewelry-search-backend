// server.js
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const axios = require('axios');
const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');
require('dotenv').config(); // Add this for environment variables

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 5000;

// MongoDB connection URI from environment variables
const MONGO_URI = process.env.MONGODB_URI;

// FastAPI service URL from environment variables
const FASTAPI_URL = process.env.FASTAPI_URL || 'http://localhost:8000';

let jewelryCollection;

// Configure multer for memory storage instead of disk storage
const storage = multer.memoryStorage(); // Changed to memory storage for cloud deployment
const upload = multer({ storage });

// Enhanced CORS configuration
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*', // Allow your frontend URL or all origins during development
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// Connect to MongoDB
async function connectToMongo() {
  try {
    const client = new MongoClient(MONGO_URI);
    await client.connect();
    console.log('Connected to MongoDB');
    const db = client.db(); // This will use the database from your connection string
    jewelryCollection = db.collection('jewelry_embeddings'); // Use your existing collection
    return true;
  } catch (error) {
    console.error('MongoDB connection error:', error);
    return false;
  }
}

// API route for image search
app.post('/api/search', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image uploaded' });
    }

    // Create FormData with buffer instead of file stream
    const formData = new FormData();
    const blob = new Blob([req.file.buffer]);
    formData.append('file', blob, req.file.originalname);
    
    // Send image to FastAPI service for embedding generation
    console.log(`Sending image to FastAPI at ${FASTAPI_URL}/generate-embedding`);
    const embeddingResponse = await axios.post(
      `${FASTAPI_URL}/generate-embedding`,
      formData, 
      { headers: { 'Content-Type': 'multipart/form-data' } }
    );
    
    const queryEmbedding = embeddingResponse.data.embedding;
    
    // Search the existing MongoDB collection with precomputed embeddings
    // Calculate cosine similarity with vector math
    const similarItems = await jewelryCollection.aggregate([
      {
        $addFields: {
          similarity: {
            $reduce: {
              input: { $zip: { inputs: ["$embedding", queryEmbedding] } },
              initialValue: 0,
              in: { $add: ["$$value", { $multiply: [{ $arrayElemAt: ["$$this", 0] }, { $arrayElemAt: ["$$this", 1] }] }] }
            }
          }
        }
      },
      { $sort: { similarity: -1 } },
      { $limit: 5 },
      {
        $project: {
          _id: 1,
          imageUrl: 1, // Uses your existing Cloudinary URLs
          similarity: 1
        }
      }
    ]).toArray();
    
    res.json({ results: similarItems });
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Search failed', details: error.message });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', mongoStatus: !!jewelryCollection ? 'Connected' : 'Disconnected' });
});

// Serve public directory for static assets (useful if you integrate React build)
app.use(express.static('public'));

// Start the server
app.listen(PORT, async () => {
  await connectToMongo();
  console.log(`Server running on port ${PORT}`);
});