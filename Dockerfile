FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package files first for better caching
COPY package*.json ./

# Install dependencies
RUN npm install --only=production

# Copy all application files
COPY . .

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })"

# Do NOT copy uploads directory during build; it should be a persistent volume
# The following line documents the uploads directory as a volume for Docker users
VOLUME ["/app/public/uploads"]

# Start the application (only when the container runs, not during build)
CMD ["node", "server.js"] 