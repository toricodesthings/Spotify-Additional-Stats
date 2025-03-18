# Use Playwright's official image with necessary dependencies
FROM mcr.microsoft.com/playwright:latest

# Set the working directory inside the container
WORKDIR /app

# Copy package.json and package-lock.json first (to leverage Docker caching)
COPY package.json package-lock.json ./

# Install dependencies
RUN npm install

# Copy all project files into the container
COPY . .

# Install Playwright browsers and dependencies
RUN npx playwright install --with-deps

# Expose the port your app runs on (Render typically uses 10000+ ports)
EXPOSE 10000

# Command to start the application
CMD ["node", "server.js"]
