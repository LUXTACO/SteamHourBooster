# Use Node.js 18 Alpine for smaller image size
FROM node:latest

# Set working directory
WORKDIR /app

# Install dependencies for node-gyp and native modules
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --omit=dev

# Copy application files
COPY . .

# Create a non-root user for security (Debian syntax)
RUN groupadd --gid 1001 nodejs && \
    useradd --uid 1001 --gid nodejs --shell /bin/bash --create-home steam

# Change ownership of the app directory
RUN mkdir -p /app/logs && chown -R steam:nodejs /app

# Switch to non-root user
USER steam

# Expose the port
EXPOSE 3000

# Start the application with better error handling
CMD ["npm", "start"]
