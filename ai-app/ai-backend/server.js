const express = require('express');
const multer = require('multer');
const { BlobServiceClient } = require('@azure/storage-blob');
const { TextAnalyticsClient, AzureKeyCredential } = require('@azure/ai-text-analytics');
const sql = require('mssql');
const cors = require('cors');
require('dotenv').config();

const app = express();


// CORS configuration - Updated to be more flexible for Kubernetes
app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    // List of allowed origins
    const allowedOrigins = [
      "http://localhost:92",
      "http://localhost:3000",
      "http://localhost:30092", // AI Frontend NodePort
      /^http:\/\/\d+\.\d+\.\d+\.\d+:30092$/, // Any IP with port 30092
      /^http:\/\/.*:30092$/, // Any host with port 30092
      /^http:\/\/.*:30080$/, // WordPress NodePort
    ];
    
    const allowed = allowedOrigins.some(allowed => {
      if (allowed instanceof RegExp) {
        return allowed.test(origin);
      }
      return allowed === origin;
    });
    
    if (allowed) {
      callback(null, true);
    } else {
      console.log('CORS blocked origin:', origin);
      callback(null, true); // For debugging, allow all origins
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
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
let blobServiceClient;
let textAnalyticsClient;

try {
  blobServiceClient = BlobServiceClient.fromConnectionString(AZURE_STORAGE_CONNECTION_STRING);
  textAnalyticsClient = new TextAnalyticsClient(TEXT_ANALYTICS_ENDPOINT, new AzureKeyCredential(TEXT_ANALYTICS_KEY));
  console.log('Azure services initialized successfully');
} catch (error) {
  console.error('Error initializing Azure services:', error);
}

// Initialize SQL table
async function initializeDatabase() {
  let pool;
  try {
    pool = await sql.connect(sqlConfig);
    console.log('Connected to SQL Database');
    
    // Create table if it doesn't exist
    const createTableQuery = `
      IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='fileinfo' AND xtype='U')
      CREATE TABLE fileinfo (
        id INT IDENTITY(1,1) PRIMARY KEY,
        filename VARCHAR(1000),
        blob_store_addr VARCHAR(1000),
        upload_time DATETIME DEFAULT CURRENT_TIMESTAMP,
        sentiment_result VARCHAR(50),
        confidence_score FLOAT
      )
    `;
    
    await pool.request().query(createTableQuery);
    console.log('Database table initialized');
  } catch (error) {
    console.error('Database initialization error:', error);
  } finally {
    if (pool) {
      await pool.close();
    }
  }
}

// Initialize database on startup
initializeDatabase();

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
  let pool;
  try {
    pool = await sql.connect(sqlConfig);
    const result = await pool.request().query('SELECT * FROM fileinfo ORDER BY upload_time DESC');
    res.json(result.recordset);
  } catch (error) {
    console.error('Error fetching files:', error);
    res.status(500).json({ error: 'Failed to fetch files', details: error.message });
  } finally {
    if (pool) {
      await pool.close();
    }
  }
});

// Upload and process file
app.post('/api/upload', upload.single('file'), async (req, res) => {
  let pool;
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
    console.log('File uploaded to blob storage:', blobUrl);
    
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
    
    console.log('Sentiment analysis result:', sentimentResult, confidenceScore);
    
    // Save to SQL Database
    pool = await sql.connect(sqlConfig);
    const request = pool.request();
    request.input('filename', sql.VarChar(1000), file.originalname);
    request.input('blob_store_addr', sql.VarChar(1000), blobUrl);
    request.input('sentiment_result', sql.VarChar(50), sentimentResult);
    request.input('confidence_score', sql.Float, confidenceScore);
    
    const insertResult = await request.query(`
      INSERT INTO fileinfo (filename, blob_store_addr, sentiment_result, confidence_score)
      VALUES (@filename, @blob_store_addr, @sentiment_result, @confidence_score)
    `);
    
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
    if (pool) {
      await pool.close();
    }
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File size too large' });
    }
  }
  console.error('Unhandled error:', error);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3001;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`AI service running on port ${PORT}`);
  console.log('Environment variables loaded:');
  console.log('- SQL_SERVER:', process.env.SQL_SERVER);
  console.log('- SQL_DATABASE:', process.env.SQL_DATABASE);
  console.log('- TEXT_ANALYTICS_ENDPOINT:', process.env.TEXT_ANALYTICS_ENDPOINT);
  console.log('- AZURE_STORAGE_CONNECTION_STRING:', process.env.AZURE_STORAGE_CONNECTION_STRING ? 'Set' : 'Not set');
});