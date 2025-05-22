<template>
  <div id="app">
    <div class="chat-container">
      <div class="chat-header">
        <h2>💬 Chat Application</h2>
        <div class="connection-status" :class="connectionStatus">
          {{ connectionStatus === 'connected' ? '🟢 Connected' : '🔴 Disconnected' }}
        </div>
      </div>

      <!-- Username input (if not set) -->
      <div v-if="!username" class="username-container">
        <div class="username-form">
          <h3>Enter your username to start chatting:</h3>
          <input 
            v-model="tempUsername" 
            @keyup.enter="setUsername"
            type="text" 
            placeholder="Your username..."
            maxlength="20"
            class="username-input"
          >
          <button @click="setUsername" :disabled="!tempUsername.trim()" class="username-btn">
            Start Chatting
          </button>
        </div>
      </div>

      <!-- Chat interface (if username is set) -->
      <div v-else class="chat-interface">
        <!-- Messages area -->
        <div class="messages-container" ref="messagesContainer">
          <div v-if="messages.length === 0" class="no-messages">
            No messages yet. Start the conversation! 👋
          </div>
          <div 
            v-for="message in messages" 
            :key="message._id || message.timestamp"
            class="message"
            :class="{ 'own-message': message.username === username }"
          >
            <div class="message-header">
              <span class="username">{{ message.username }}</span>
              <span class="timestamp">{{ formatTimestamp(message.timestamp) }}</span>
            </div>
            <div class="message-content">{{ message.message }}</div>
          </div>
          
          <!-- Typing indicator -->
          <div v-if="typingUsers.length > 0" class="typing-indicator">
            <span>{{ getTypingText() }}</span>
            <div class="typing-dots">
              <span></span>
              <span></span>
              <span></span>
            </div>
          </div>
        </div>

        <!-- Message input form -->
        <div class="message-input-container">
          <form @submit.prevent="sendMessage" class="message-form">
            <input 
              v-model="newMessage" 
              @input="handleTyping"
              @blur="stopTyping"
              type="text" 
              placeholder="Type your message..."
              maxlength="500"
              class="message-input"
              ref="messageInput"
            >
            <button type="submit" :disabled="!newMessage.trim() || connectionStatus !== 'connected'" class="send-btn">
              Send
            </button>
          </form>
          <div class="user-info">
            Chatting as: <strong>{{ username }}</strong>
            <button @click="changeUsername" class="change-username-btn">Change</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { io } from 'socket.io-client';

export default {
  name: 'ChatApp',
  data() {
    return {
      socket: null,
      username: '',
      tempUsername: '',
      newMessage: '',
      messages: [],
      connectionStatus: 'disconnected',
      typingUsers: [],
      typingTimer: null,
      isTyping: false
    }
  },
  mounted() {
    this.initSocket();
  },
  beforeUnmount() {
    if (this.socket) {
      this.socket.disconnect();
    }
  },
  methods: {
    initSocket() {
      // Connect to the backend server - fixed for Kubernetes deployment
      let backendUrl;
      
      if (process.env.NODE_ENV === 'production') {
        // In production (Kubernetes), use the same hostname with the NodePort
        const hostname = window.location.hostname;
        backendUrl = `http://${hostname}:30088`;
      } else {
        // In development
        backendUrl = 'http://localhost:88';
      }
      
      console.log('Connecting to backend:', backendUrl);
      
      this.socket = io(backendUrl, {
        transports: ['websocket', 'polling'],
        path: '/socket.io/',
        withCredentials: true,
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
      });

      // Connection events
      this.socket.on('connect', () => {
        console.log('Connected to server');
        this.connectionStatus = 'connected';
      });

      this.socket.on('disconnect', () => {
        console.log('Disconnected from server');
        this.connectionStatus = 'disconnected';
      });

      this.socket.on('connect_error', (error) => {
        console.error('Connection error:', error);
        this.connectionStatus = 'disconnected';
      });

      // Chat events
      this.socket.on('chat_history', (messages) => {
        this.messages = messages;
        this.$nextTick(() => {
          this.scrollToBottom();
        });
      });

      this.socket.on('receive_message', (message) => {
        this.messages.push(message);
        this.$nextTick(() => {
          this.scrollToBottom();
        });
      });

      // Typing events
      this.socket.on('user_typing', (data) => {
        if (data.username !== this.username && !this.typingUsers.includes(data.username)) {
          this.typingUsers.push(data.username);
        }
      });

      this.socket.on('user_stop_typing', (data) => {
        this.typingUsers = this.typingUsers.filter(user => user !== data.username);
      });

      // Error handling
      this.socket.on('error', (error) => {
        console.error('Socket error:', error);
        alert('Error: ' + error.message);
      });
    },

    setUsername() {
      if (this.tempUsername.trim()) {
        this.username = this.tempUsername.trim();
        this.tempUsername = '';
        this.$nextTick(() => {
          if (this.$refs.messageInput) {
            this.$refs.messageInput.focus();
          }
        });
      }
    },

    changeUsername() {
      this.username = '';
      this.tempUsername = '';
    },

    sendMessage() {
      if (this.newMessage.trim() && this.username && this.connectionStatus === 'connected') {
        this.socket.emit('send_message', {
          username: this.username,
          message: this.newMessage.trim()
        });
        this.newMessage = '';
        this.stopTyping();
      }
    },

    handleTyping() {
      if (!this.isTyping && this.username) {
        this.isTyping = true;
        this.socket.emit('typing', { username: this.username });
      }

      // Clear existing timer
      if (this.typingTimer) {
        clearTimeout(this.typingTimer);
      }

      // Set new timer to stop typing after 2 seconds
      this.typingTimer = setTimeout(() => {
        this.stopTyping();
      }, 2000);
    },

    stopTyping() {
      if (this.isTyping && this.username) {
        this.isTyping = false;
        this.socket.emit('stop_typing', { username: this.username });
      }
      if (this.typingTimer) {
        clearTimeout(this.typingTimer);
        this.typingTimer = null;
      }
    },

    scrollToBottom() {
      const container = this.$refs.messagesContainer;
      if (container) {
        container.scrollTop = container.scrollHeight;
      }
    },

    formatTimestamp(timestamp) {
      const date = new Date(timestamp);
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    },

    getTypingText() {
      if (this.typingUsers.length === 1) {
        return `${this.typingUsers[0]} is typing`;
      } else if (this.typingUsers.length === 2) {
        return `${this.typingUsers[0]} and ${this.typingUsers[1]} are typing`;
      } else if (this.typingUsers.length > 2) {
        return `${this.typingUsers.length} people are typing`;
      }
      return '';
    }
  }
}
</script>

<style scoped>
/* ... styles remain the same ... */
* {
  box-sizing: border-box;
}

#app {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  margin: 0;
  padding: 0;
  height: 100vh;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}

.chat-container {
  max-width: 800px;
  margin: 0 auto;
  height: 100vh;
  background: white;
  box-shadow: 0 0 20px rgba(0,0,0,0.1);
  display: flex;
  flex-direction: column;
}

.chat-header {
  background: #4f46e5;
  color: white;
  padding: 1rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.chat-header h2 {
  margin: 0;
  font-size: 1.5rem;
}

.connection-status {
  font-size: 0.9rem;
  padding: 0.25rem 0.5rem;
  border-radius: 1rem;
  background: rgba(255,255,255,0.2);
}

.connection-status.connected {
  background: rgba(34, 197, 94, 0.2);
}

.username-container {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem;
}

.username-form {
  text-align: center;
  background: #f8fafc;
  padding: 2rem;
  border-radius: 1rem;
  box-shadow: 0 4px 6px rgba(0,0,0,0.1);
}

.username-form h3 {
  margin-bottom: 1rem;
  color: #374151;
}

.username-input {
  width: 100%;
  max-width: 300px;
  padding: 0.75rem;
  margin: 0.5rem 0;
  border: 2px solid #e5e7eb;
  border-radius: 0.5rem;
  font-size: 1rem;
}

.username-input:focus {
  outline: none;
  border-color: #4f46e5;
}

.username-btn {
  background: #4f46e5;
  color: white;
  border: none;
  padding: 0.75rem 1.5rem;
  border-radius: 0.5rem;
  font-size: 1rem;
  cursor: pointer;
  margin-left: 0.5rem;
}

.username-btn:hover:not(:disabled) {
  background: #4338ca;
}

.username-btn:disabled {
  background: #9ca3af;
  cursor: not-allowed;
}

.chat-interface {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.messages-container {
  flex: 1;
  overflow-y: auto;
  padding: 1rem;
  background: #f9fafb;
}

.no-messages {
  text-align: center;
  color: #6b7280;
  font-style: italic;
  margin: 2rem 0;
}

.message {
  margin-bottom: 1rem;
  padding: 0.75rem;
  background: white;
  border-radius: 0.5rem;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

.message.own-message {
  background: #eff6ff;
  border-left: 4px solid #4f46e5;
}

.message-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.5rem;
}

.username {
  font-weight: bold;
  color: #4f46e5;
}

.timestamp {
  font-size: 0.8rem;
  color: #6b7280;
}

.message-content {
  color: #374151;
  line-height: 1.4;
  word-wrap: break-word;
}

.typing-indicator {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: #6b7280;
  font-style: italic;
  margin: 0.5rem 0;
}

.typing-dots {
  display: flex;
  gap: 0.2rem;
}

.typing-dots span {
  width: 0.3rem;
  height: 0.3rem;
  background: #6b7280;
  border-radius: 50%;
  animation: typing 1.5s infinite;
}

.typing-dots span:nth-child(2) {
  animation-delay: 0.2s;
}

.typing-dots span:nth-child(3) {
  animation-delay: 0.4s;
}

@keyframes typing {
  0%, 60%, 100% {
    transform: scale(1);
    opacity: 0.5;
  }
  30% {
    transform: scale(1.2);
    opacity: 1;
  }
}

.message-input-container {
  padding: 1rem;
  background: white;
  border-top: 1px solid #e5e7eb;
}

.message-form {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.message-input {
  flex: 1;
  padding: 0.75rem;
  border: 2px solid #e5e7eb;
  border-radius: 0.5rem;
  font-size: 1rem;
}

.message-input:focus {
  outline: none;
  border-color: #4f46e5;
}

.send-btn {
  background: #10b981;
  color: white;
  border: none;
  padding: 0.75rem 1.5rem;
  border-radius: 0.5rem;
  font-size: 1rem;
  cursor: pointer;
}

.send-btn:hover:not(:disabled) {
  background: #059669;
}

.send-btn:disabled {
  background: #9ca3af;
  cursor: not-allowed;
}

.user-info {
  text-align: center;
  font-size: 0.9rem;
  color: #6b7280;
}

.change-username-btn {
  background: none;
  border: 1px solid #d1d5db;
  color: #4f46e5;
  padding: 0.25rem 0.5rem;
  border-radius: 0.25rem;
  font-size: 0.8rem;
  cursor: pointer;
  margin-left: 0.5rem;
}

.change-username-btn:hover {
  background: #f3f4f6;
}

@media (max-width: 768px) {
  .chat-container {
    height: 100vh;
    max-width: 100%;
  }
  
  .message-form {
    flex-direction: column;
  }
  
  .send-btn {
    margin-top: 0.5rem;
  }
}
</style>