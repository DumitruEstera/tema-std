const express = require('express');
const multer = require('multer');
const { BlobServiceClient } = require('@azure/storage-blob');
const { TextAnalyticsClient, AzureKeyCredential } = require('@azure/ai-text-analytics');
const sql = require('mssql');
const cors = require('cors');
require('dotenv').config();

const app = express();

// CORS configuration
app.use(cors({
  origin: ["http://localhost:92", "http://ai_frontend", "http://localhost:3000"],
  credentials: true
}));

app.use(express.json());

// Azure Configuration
const AZURE_STORAGE_CONNECTION_STRING = process.env.AZURE_STORAGE_CONNECTION_STRING;
const TEXT_ANALYTICS_ENDPOINT = process.env.TEXT_ANALYTICS_ENDPOINT;
const TEXT_ANALYTICS_KEY = process.env.TEXT_ANALYTICS_KEY;

// SQL Configuration
const sqlConfig = {
  user: process.env.SQL_USER,
  password: process.env.SQL_PASSWORD,
  database: process.env.SQL_DATABASE,
  server: process.env.SQL_SERVER,
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000
  },
  options: {
    encrypt: true,
    trustServerCertificate: false
  }
};

// Initialize Azure clients
const blobServiceClient = BlobServiceClient.fromConnectionString(AZURE_STORAGE_CONNECTION_STRING);
const textAnalyticsClient = new TextAnalyticsClient(TEXT_ANALYTICS_ENDPOINT, new AzureKeyCredential(TEXT_ANALYTICS_KEY));

// Multer configuration for file upload
const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    // Accept text files and common document formats
    const allowedTypes = ['text/plain', 'application/pdf', 'text/csv'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only text files (.txt, .pdf, .csv) are allowed'));
    }
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'AI service is running' });
});

// Get all processed files
app.get('/api/files', async (req, res) => {
  try {
    await sql.connect(sqlConfig);
    const result = await sql.query`SELECT * FROM fileinfo ORDER BY upload_time DESC`;
    res.json(result.recordset);
  } catch (error) {
    console.error('Error fetching files:', error);
    res.status(500).json({ error: 'Failed to fetch files' });
  } finally {
    sql.close();
  }
});

// Upload and process file
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const file = req.file;
    const fileName = `${Date.now()}-${file.originalname}`;
    
    // Upload to Azure Blob Storage
    const containerName = 'uploads';
    const containerClient = blobServiceClient.getContainerClient(containerName);
    
    // Create container if it doesn't exist
    await containerClient.createIfNotExists({ access: 'blob' });
    
    const blockBlobClient = containerClient.getBlockBlobClient(fileName);
    await blockBlobClient.upload(file.buffer, file.buffer.length);
    
    const blobUrl = blockBlobClient.url;
    
    // Extract text content for sentiment analysis
    let textContent = '';
    if (file.mimetype === 'text/plain') {
      textContent = file.buffer.toString('utf8');
    } else {
      // For other file types, use filename as fallback text
      textContent = file.originalname;
    }
    
    // Perform sentiment analysis
    const sentimentResults = await textAnalyticsClient.analyzeSentiment([textContent]);
    const sentiment = sentimentResults[0];
    
    let sentimentResult = 'Unknown';
    let confidenceScore = 0;
    
    if (!sentiment.error) {
      sentimentResult = sentiment.sentiment;
      confidenceScore = Math.max(
        sentiment.confidenceScores.positive,
        sentiment.confidenceScores.negative,
        sentiment.confidenceScores.neutral
      );
    }
    
    // Save to SQL Database
    await sql.connect(sqlConfig);
    const insertResult = await sql.query`
      INSERT INTO fileinfo (filename, blob_store_addr, sentiment_result, confidence_score)
      VALUES (${file.originalname}, ${blobUrl}, ${sentimentResult}, ${confidenceScore})
    `;
    
    res.json({
      success: true,
      filename: file.originalname,
      blobUrl: blobUrl,
      sentiment: sentimentResult,
      confidence: confidenceScore,
      message: 'File uploaded and processed successfully'
    });
    
  } catch (error) {
    console.error('Error processing file:', error);
    res.status(500).json({ error: 'Failed to process file: ' + error.message });
  } finally {
    sql.close();
  }
});

const PORT = process.env.PORT || 3001;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`AI service running on port ${PORT}`);
});