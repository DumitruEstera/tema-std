<template>
  <div id="app">
    <div class="ai-container">
      <div class="ai-header">
        <h2>🤖 AI Sentiment Analysis</h2>
        <div class="status-indicator" :class="connectionStatus">
          {{ connectionStatus === 'connected' ? '🟢 Service Available' : '🔴 Service Unavailable' }}
        </div>
      </div>

      <!-- File Upload Section -->
      <div class="upload-section">
        <div class="upload-card">
          <h3>Upload File for Sentiment Analysis</h3>
          <div class="upload-area" @dragover.prevent @drop="handleDrop" :class="{ 'drag-over': isDragOver }" @dragenter="isDragOver = true" @dragleave="isDragOver = false">
            <div v-if="!selectedFile" class="upload-placeholder">
              <div class="upload-icon">📁</div>
              <p>Drag & drop a file here or click to browse</p>
              <p class="file-types">Supported: .txt, .pdf, .csv (Max 10MB)</p>
              <input type="file" ref="fileInput" @change="handleFileSelect" accept=".txt,.pdf,.csv" style="display: none;">
              <button @click="$refs.fileInput.click()" class="browse-btn">Browse Files</button>
            </div>
            
            <div v-else class="file-selected">
              <div class="file-info">
                <div class="file-icon">📄</div>
                <div class="file-details">
                  <strong>{{ selectedFile.name }}</strong>
                  <p>{{ formatFileSize(selectedFile.size) }}</p>
                </div>
                <button @click="removeFile" class="remove-btn">✕</button>
              </div>
              <button @click="uploadFile" :disabled="isUploading" class="upload-btn">
                <span v-if="!isUploading">🚀 Analyze Sentiment</span>
                <span v-else>⏳ Processing...</span>
              </button>
            </div>
          </div>
          
          <div v-if="uploadResult" class="result-section" :class="uploadResult.success ? 'success' : 'error'">
            <h4>{{ uploadResult.success ? '✅ Analysis Complete' : '❌ Analysis Failed' }}</h4>
            <div v-if="uploadResult.success">
              <p><strong>Sentiment:</strong> {{ uploadResult.sentiment }}</p>
              <p><strong>Confidence:</strong> {{ (uploadResult.confidence * 100).toFixed(1) }}%</p>
              <p><strong>File URL:</strong> <a :href="uploadResult.blobUrl" target="_blank">View File</a></p>
            </div>
            <div v-else>
              <p>{{ uploadResult.error }}</p>
            </div>
          </div>
        </div>
      </div>

      <!-- File History Section -->
      <div class="history-section">
        <h3>📊 Analysis History</h3>
        <div v-if="isLoadingHistory" class="loading">
          <div class="spinner"></div>
          <p>Loading history...</p>
        </div>
        
        <div v-else-if="fileHistory.length === 0" class="no-history">
          <p>No files processed yet. Upload a file to get started! 📈</p>
        </div>
        
        <div v-else class="history-list">
          <div v-for="file in fileHistory" :key="file.id" class="history-item">
            <div class="history-header">
              <div class="file-name">
                <strong>{{ file.filename }}</strong>
                <span class="upload-time">{{ formatTimestamp(file.upload_time) }}</span>
              </div>
              <div class="sentiment-badge" :class="getSentimentClass(file.sentiment_result)">
                {{ file.sentiment_result }}
              </div>
            </div>
            <div class="history-details">
              <div class="confidence">
                <span>Confidence: {{ (file.confidence_score * 100).toFixed(1) }}%</span>
              </div>
              <div class="file-link">
                <a :href="file.blob_store_addr" target="_blank" class="view-file-btn">View File</a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import axios from 'axios';

export default {
  name: 'AIApp',
  data() {
    return {
      selectedFile: null,
      isUploading: false,
      uploadResult: null,
      fileHistory: [],
      isLoadingHistory: true,
      connectionStatus: 'disconnected',
      isDragOver: false,
      backendUrl: ''
    }
  },
  mounted() {
    this.setupBackendUrl();
    this.checkConnection();
    this.loadHistory();
  },
  methods: {
    setupBackendUrl() {
      if (process.env.NODE_ENV === 'production') {
        // In production (Kubernetes), use the same hostname with the NodePort
        const hostname = window.location.hostname;
        this.backendUrl = `http://${hostname}:30091`;
      } else {
        // In development
        this.backendUrl = 'http://localhost:3001';
      }
      console.log('Backend URL:', this.backendUrl);
    },

    async checkConnection() {
      try {
        await axios.get(`${this.backendUrl}/health`);
        this.connectionStatus = 'connected';
      } catch (error) {
        console.error('Connection check failed:', error);
        this.connectionStatus = 'disconnected';
        // Retry connection after 5 seconds
        setTimeout(() => this.checkConnection(), 5000);
      }
    },

    async loadHistory() {
      try {
        const response = await axios.get(`${this.backendUrl}/api/files`);
        this.fileHistory = response.data;
      } catch (error) {
        console.error('Error loading history:', error);
        // Retry after 3 seconds if failed
        setTimeout(() => this.loadHistory(), 3000);
      } finally {
        this.isLoadingHistory = false;
      }
    },

    handleFileSelect(event) {
      const file = event.target.files[0];
      if (file) {
        this.selectedFile = file;
        this.uploadResult = null;
      }
    },

    handleDrop(event) {
      event.preventDefault();
      this.isDragOver = false;
      const files = event.dataTransfer.files;
      if (files.length > 0) {
        this.selectedFile = files[0];
        this.uploadResult = null;
      }
    },

    removeFile() {
      this.selectedFile = null;
      this.uploadResult = null;
      this.$refs.fileInput.value = '';
    },

    async uploadFile() {
      if (!this.selectedFile || this.connectionStatus !== 'connected') {
        alert('Please ensure the service is connected before uploading.');
        return;
      }

      this.isUploading = true;
      this.uploadResult = null;

      try {
        const formData = new FormData();
        formData.append('file', this.selectedFile);

        const response = await axios.post(`${this.backendUrl}/api/upload`, formData);

        this.uploadResult = response.data;

        if (this.$refs.fileInput) {
          this.$refs.fileInput.value = '';
        }

        this.selectedFile = null;
        
        this.$nextTick(() => {
          if (this.$refs.fileInput) {
            this.$refs.fileInput.value = '';
          }
        });
        
        // Reload history
        await this.loadHistory();
        
      } catch (error) {
        console.error('Upload error:', error);
        this.uploadResult = {
          success: false,
          error: error.response?.data?.error || 'Upload failed. Please try again.'
        };
      } finally {
        this.isUploading = false;
      }
    },

    formatFileSize(bytes) {
      if (bytes === 0) return '0 Bytes';
      const k = 1024;
      const sizes = ['Bytes', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    },

    formatTimestamp(timestamp) {
      const date = new Date(timestamp);
      return date.toLocaleString();
    },

    getSentimentClass(sentiment) {
      const s = sentiment?.toLowerCase();
      if (s === 'positive') return 'positive';
      if (s === 'negative') return 'negative';
      return 'neutral';
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
  padding: 20px;
  min-height: 100vh;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}

.ai-container {
  max-width: 1000px;
  margin: 0 auto;
  background: white;
  border-radius: 15px;
  box-shadow: 0 10px 30px rgba(0,0,0,0.2);
  overflow: hidden;
}

.ai-header {
  background: #4f46e5;
  color: white;
  padding: 2rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.ai-header h2 {
  margin: 0;
  font-size: 1.8rem;
}

.status-indicator {
  font-size: 0.9rem;
  padding: 0.5rem 1rem;
  border-radius: 20px;
  background: rgba(255,255,255,0.2);
}

.status-indicator.connected {
  background: rgba(34, 197, 94, 0.3);
}

.upload-section {
  padding: 2rem;
}

.upload-card {
  background: #f8fafc;
  border-radius: 10px;
  padding: 2rem;
  border: 2px dashed #cbd5e1;
}

.upload-card h3 {
  margin-top: 0;
  color: #374151;
  text-align: center;
}

.upload-area {
  min-height: 200px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  transition: all 0.3s ease;
  cursor: pointer;
}

.upload-area.drag-over {
  background: #e0f2fe;
  border-color: #0284c7;
}

.upload-placeholder {
  text-align: center;
  color: #64748b;
}

.upload-icon {
  font-size: 3rem;
  margin-bottom: 1rem;
}

.file-types {
  font-size: 0.9rem;
  color: #94a3b8;
  margin: 0.5rem 0;
}

.browse-btn {
  background: #4f46e5;
  color: white;
  border: none;
  padding: 0.75rem 1.5rem;
  border-radius: 8px;
  cursor: pointer;
  font-size: 1rem;
  margin-top: 1rem;
}

.browse-btn:hover {
  background: #4338ca;
}

.file-selected {
  text-align: center;
  width: 100%;
}

.file-info {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  margin-bottom: 1rem;
  padding: 1rem;
  background: white;
  border-radius: 8px;
}

.file-icon {
  font-size: 2rem;
}

.file-details strong {
  display: block;
  color: #374151;
}

.file-details p {
  margin: 0.25rem 0 0 0;
  color: #64748b;
  font-size: 0.9rem;
}

.remove-btn {
  background: #ef4444;
  color: white;
  border: none;
  border-radius: 50%;
  width: 30px;
  height: 30px;
  cursor: pointer;
  font-size: 1rem;
}

.upload-btn {
  background: #10b981;
  color: white;
  border: none;
  padding: 1rem 2rem;
  border-radius: 8px;
  cursor: pointer;
  font-size: 1.1rem;
  font-weight: bold;
}

.upload-btn:hover:not(:disabled) {
  background: #059669;
}

.upload-btn:disabled {
  background: #9ca3af;
  cursor: not-allowed;
}

.result-section {
  margin-top: 1.5rem;
  padding: 1rem;
  border-radius: 8px;
}

.result-section.success {
  background: #d1fae5;
  border: 1px solid #a7f3d0;
}

.result-section.error {
  background: #fee2e2;
  border: 1px solid #fca5a5;
}

.result-section h4 {
  margin-top: 0;
  color: #374151;
}

.history-section {
  padding: 2rem;
  border-top: 1px solid #e5e7eb;
}

.history-section h3 {
  margin-top: 0;
  color: #374151;
}

.loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  padding: 2rem;
  color: #64748b;
}

.spinner {
  width: 20px;
  height: 20px;
  border: 2px solid #e5e7eb;
  border-radius: 50%;
  border-top-color: #4f46e5;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.no-history {
  text-align: center;
  color: #64748b;
  padding: 2rem;
  font-style: italic;
}

.history-list {
  display: grid;
  gap: 1rem;
}

.history-item {
  background: #f8fafc;
  border-radius: 8px;
  padding: 1rem;
  border: 1px solid #e2e8f0;
}

.history-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 0.5rem;
}

.file-name strong {
  color: #374151;
  display: block;
}

.upload-time {
  color: #64748b;
  font-size: 0.8rem;
}

.sentiment-badge {
  padding: 0.25rem 0.75rem;
  border-radius: 15px;
  font-size: 0.8rem;
  font-weight: bold;
  text-transform: uppercase;
}

.sentiment-badge.positive {
  background: #d1fae5;
  color: #065f46;
}

.sentiment-badge.negative {
  background: #fee2e2;
  color: #991b1b;
}

.sentiment-badge.neutral {
  background: #f3f4f6;
  color: #374151;
}

.history-details {
  display: flex;
  justify-content: space-between;
  align-items: center;
  color: #64748b;
  font-size: 0.9rem;
}

.view-file-btn {
  color: #4f46e5;
  text-decoration: none;
  font-weight: bold;
}

.view-file-btn:hover {
  text-decoration: underline;
}

@media (max-width: 768px) {
  #app {
    padding: 10px;
  }
  
  .ai-header {
    flex-direction: column;
    gap: 1rem;
    text-align: center;
  }
  
  .file-info {
    flex-direction: column;
    text-align: center;
  }
  
  .history-header {
    flex-direction: column;
    gap: 0.5rem;
  }
  
  .history-details {
    flex-direction: column;
    gap: 0.5rem;
    align-items: flex-start;
  }
}
</style>