const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const { createAdapter } = require('@socket.io/redis-adapter');
const { createClient } = require('redis');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

// CORS configuration
app.use(cors({
  origin: ["http://localhost:90", "http://chat_frontend", "http://localhost:3000"],
  credentials: true
}));

const io = socketIo(server, {
  cors: {
    origin: ["http://localhost:90", "http://chat_frontend", "http://localhost:3000"],
    methods: ["GET", "POST"],
    credentials: true
  }
});

app.use(express.json());

// Redis adapter setup for multi-pod WebSocket support
async function setupRedisAdapter() {
  try {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    console.log('Connecting to Redis:', redisUrl);
    
    const pubClient = createClient({ url: redisUrl });
    const subClient = pubClient.duplicate();
    
    await Promise.all([
      pubClient.connect(),
      subClient.connect()
    ]);
    
    io.adapter(createAdapter(pubClient, subClient));
    console.log('Redis adapter configured successfully');
  } catch (error) {
    console.error('Redis adapter setup failed:', error);
    console.log('Continuing without Redis adapter (single pod mode)');
  }
}

// Initialize Redis adapter
setupRedisAdapter();

// MongoDB connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://admin:password123@localhost:27017/chatdb?authSource=admin';

mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => {
  console.log('Connected to MongoDB');
})
.catch((error) => {
  console.error('MongoDB connection error:', error);
});

// Message Schema
const messageSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    trim: true
  },
  message: {
    type: String,
    required: true,
    trim: true
  },
  timestamp: {
    type: Date,
    default: Date.now
  }
});

const Message = mongoose.model('Message', messageSchema);

// REST API endpoints
app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'Chat server is running' });
});

// Get chat history
app.get('/api/messages', async (req, res) => {
  try {
    const messages = await Message.find()
      .sort({ timestamp: 1 })
      .limit(100);
    res.json(messages);
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// WebSocket connection handling
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Send recent messages to newly connected user
  Message.find()
    .sort({ timestamp: 1 })
    .limit(50)
    .then(messages => {
      socket.emit('chat_history', messages);
    })
    .catch(error => {
      console.error('Error fetching chat history:', error);
    });

  // Handle new message
  socket.on('send_message', async (data) => {
    try {
      const { username, message } = data;
      
      // Validate data
      if (!username || !message) {
        socket.emit('error', { message: 'Username and message are required' });
        return;
      }

      // Create and save message to database
      const newMessage = new Message({
        username: username.trim(),
        message: message.trim(),
        timestamp: new Date()
      });

      const savedMessage = await newMessage.save();
      
      // Broadcast message to all connected clients across all pods
      io.emit('receive_message', {
        _id: savedMessage._id,
        username: savedMessage.username,
        message: savedMessage.message,
        timestamp: savedMessage.timestamp
      });

      console.log(`Message from ${username}: ${message}`);
    } catch (error) {
      console.error('Error saving message:', error);
      socket.emit('error', { message: 'Failed to send message' });
    }
  });

  // Handle user typing - broadcast to all other users across pods
  socket.on('typing', (data) => {
    socket.broadcast.emit('user_typing', data);
  });

  // Handle stop typing - broadcast to all other users across pods
  socket.on('stop_typing', (data) => {
    socket.broadcast.emit('user_stop_typing', data);
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Chat server running on port ${PORT}`);
  console.log(`MongoDB URI: ${MONGODB_URI}`);
  console.log(`Redis URL: ${process.env.REDIS_URL || 'Not configured'}`);
});