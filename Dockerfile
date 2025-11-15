# Dockerfile

# Use Debian bookworm so python3 is 3.11+
FROM node:20-bookworm

# Install Python 3, pip and ffmpeg for spotdl
RUN apt-get update && \
    apt-get install -y python3 python3-pip ffmpeg && \
    rm -rf /var/lib/apt/lists/*

# Sanity check: should print Python 3.11.x (or at least >= 3.10)
RUN python3 --version

# Install spotdl globally (override PEP 668 guard)
RUN pip3 install --no-cache-dir --break-system-packages spotdl

# App directory
WORKDIR /app

# Install Node deps
COPY package.json package-lock.json* ./
RUN npm install --production

# Copy source
COPY . .

# Ensure downloads dir exists
RUN mkdir -p downloads

ENV NODE_ENV=production
EXPOSE 5000

CMD ["node", "server.js"]
