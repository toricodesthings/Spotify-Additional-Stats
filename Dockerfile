# Use a Node.js base image that includes a minimal Debian distribution
FROM node:16-buster-slim

# Install dependencies required for Chromium (Puppeteer)
RUN apt-get update && apt-get install -y \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxrandr2 \
    xdg-utils \
    --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /usr/src/app

# Copy package.json and package-lock.json (if available) and install dependencies
COPY package*.json ./
RUN npm install --production

# Copy the rest of your application code
COPY . .

# Expose the port your server listens on
EXPOSE 10000

# Run your application (adjust the entry point if needed)
CMD ["node", "server_puppeteer.js"]
