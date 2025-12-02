# Production image based on Node.js 18 LTS (Debian slim)
FROM node:18-slim

# Install runtime deps for Puppeteer (Chromium) and FFmpeg
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libatspi2.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libwayland-client0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    xdg-utils \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --omit=dev

# Copy application files
COPY . .

# Create directories for WhatsApp session data
RUN mkdir -p /app/.wwebjs_auth /app/.wwebjs_cache /app/.cache/puppeteer \
    && chown -R node:node /app

# Expose the application port
EXPOSE 3000

# Set environment variables
ENV NODE_ENV=production
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=false
# Helpful in containerized environments; whatsapp-web.js sets args, but keep safe defaults
ENV PUPPETEER_ARGS="--no-sandbox --disable-setuid-sandbox"

# Run as non-root for security
USER node

# Basic healthcheck to ensure server is responding
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "require('http').request({host:'127.0.0.1',port:3000,path:'/'},r=>{if(r.statusCode<500)process.exit(0);process.exit(1)}).on('error',()=>process.exit(1)).end()" || exit 1

# Start the application
CMD ["npm", "start"]
