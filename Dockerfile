# Use Playwright's official image with necessary dependencies
FROM mcr.microsoft.com/playwright:v1.51.1-jammy

# Set the working directory inside the container
WORKDIR /app

# Copy package.json and package-lock.json first (to leverage Docker caching)
COPY package.json package-lock.json ./

# Install dependencies
RUN npm install

# Copy all project files into the container
COPY . .

# Set Playwright to use a persistent browser storage path
ENV PLAYWRIGHT_BROWSERS_PATH=/app/playwright-browsers

# Install Playwright browsers and dependencies at build time
RUN npx playwright install --with-deps

# Ensure Playwright has correct permissions
RUN chmod -R 777 /app/playwright-browsers

# Expose the port your app runs on
EXPOSE 10000

# Start the application (No need to reinstall Playwright on every restart)
CMD ["node", "server.js"]
