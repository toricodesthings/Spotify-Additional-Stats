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

# Clear any old Playwright installations (force fresh install)
RUN rm -rf /root/.cache/ms-playwright

# Install Playwright browsers and dependencies
RUN npx playwright install --with-deps


# Expose the port your app runs on (Render typically uses 10000+ ports)
EXPOSE 10000

# Start the application, ensuring Playwright is installed first
CMD ["sh", "-c", "npx playwright install --with-deps && node server.js"]
