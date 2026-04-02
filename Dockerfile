# Build stage
FROM node:20-alpine AS build

WORKDIR /app

# Umami Analytics build args
ARG PUBLIC_UMAMI_URL
ARG PUBLIC_UMAMI_WEBSITE_ID
ENV PUBLIC_UMAMI_URL=${PUBLIC_UMAMI_URL}
ENV PUBLIC_UMAMI_WEBSITE_ID=${PUBLIC_UMAMI_WEBSITE_ID}

# GA4 Analytics build arg (embedded at build time by Astro/Vite)
ARG PUBLIC_GA4_MEASUREMENT_ID
ENV PUBLIC_GA4_MEASUREMENT_ID=${PUBLIC_GA4_MEASUREMENT_ID}

# SVAR Scanner API key (build-time only, not exposed to client)
ARG SVAR_API_KEY
ENV SVAR_API_KEY=${SVAR_API_KEY}

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source files
COPY . .

# Build the application
RUN npm run build

# Production stage - serve static files with OpenResty (nginx + extras)
FROM openresty/openresty:alpine AS production

# Create non-root user for security
RUN adduser -D -u 1001 appuser && \
    chown -R appuser:appuser /usr/local/openresty/nginx && \
    mkdir -p /var/run/openresty /tmp/nginx && \
    chown -R appuser:appuser /var/run/openresty /tmp/nginx

# Copy custom nginx config
COPY nginx.conf /usr/local/openresty/nginx/conf/nginx.conf

# Copy built static files
COPY --from=build /app/dist /usr/local/openresty/nginx/html

# Switch to non-root user
USER appuser

# Expose port 80
EXPOSE 80

# Health check (using wget since curl not in alpine)
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q --spider http://localhost/health || exit 1

CMD ["/usr/local/openresty/bin/openresty", "-g", "daemon off;"]
