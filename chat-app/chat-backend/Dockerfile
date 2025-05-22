# Multi-stage build for Node.js + Apache
FROM node:18-alpine as node_stage

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install Node.js dependencies
RUN npm ci --only=production

# Copy application code
COPY . .

# Apache stage
FROM httpd:2.4-alpine

# Install Node.js in Apache container
RUN apk add --no-cache nodejs npm

# Copy Apache configuration
COPY apache.conf /usr/local/apache2/conf/httpd.conf

# Copy Node.js application
COPY --from=node_stage /app /app

# Create startup script
RUN echo '#!/bin/sh' > /startup.sh && \
    echo 'cd /app && npm start &' >> /startup.sh && \
    echo 'httpd-foreground' >> /startup.sh && \
    chmod +x /startup.sh

WORKDIR /app

EXPOSE 88

CMD ["/startup.sh"]