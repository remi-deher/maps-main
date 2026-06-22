# --- frontend ---
# Build the web UI so the engine can serve it at / (browser = headless+web
# product). Pure Vite/React build, no Rust/Tauri toolchain needed.
FROM node:22-bookworm-slim AS frontend
WORKDIR /app
COPY tauri-app/package.json tauri-app/package-lock.json ./
RUN npm ci
COPY tauri-app/ ./
RUN npm run build

# --- build ---
FROM golang:1.26-bookworm AS build
WORKDIR /src

# Leverage Docker cache for Go modules download
COPY engine/go.mod engine/go.sum ./engine/
RUN cd engine && go mod download

# Copy the rest of the Go engine source code
COPY engine/ ./engine/

# Embed the compiled web UI, then build with -tags webui so the engine serves
# it at / (see internal/webui). The dist/ payload comes from the frontend stage.
COPY --from=frontend /app/dist ./engine/internal/webui/embedded
RUN cd engine && CGO_ENABLED=0 go build -tags webui -trimpath -ldflags="-s -w" \
    -o /out/gpsmock-engine ./cmd/headless

# Build arguments to customize driver installation
ARG WITH_GOIOS=1
ARG GOIOS_VERSION=v1.2.0

# Compile go-ios from source (enables multi-architecture/platform support, e.g. ARM64)
RUN if [ "$WITH_GOIOS" = "1" ]; then \
      GOBIN=/out CGO_ENABLED=0 go install github.com/danielpaulus/go-ios@${GOIOS_VERSION} \
      && mv /out/go-ios /out/ios ; \
    fi

# --- runtime ---
FROM debian:bookworm-slim

ARG WITH_PYMOBILEDEVICE=1

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates \
      curl \
      usbmuxd \
      libusb-1.0-0 \
      iproute2 \
 && rm -rf /var/lib/apt/lists/*

# Create a non-root system user and group for security
RUN groupadd -g 10001 gpsmock && useradd -u 10001 -g gpsmock -m -s /sbin/nologin gpsmock

# Conditional installation of Python 3 + pymobiledevice3 using a clean venv.
# gcc/python3-dev/libssl-dev are build-only: on linux/arm64 pip has no prebuilt
# wheel for sslpsk-pmd3 (a pymobiledevice3 dep) and compiles it from source, so
# a C toolchain + Python/OpenSSL headers must be present. They're purged again
# afterwards (the compiled .so links only against the runtime libssl3) so the
# final image stays slim.
RUN if [ "$WITH_PYMOBILEDEVICE" = "1" ]; then \
      apt-get update && apt-get install -y --no-install-recommends \
        python3 \
        python3-pip \
        python3-venv \
        gcc \
        python3-dev \
        libssl-dev \
      && python3 -m venv /opt/venv \
      && /opt/venv/bin/pip install --upgrade pip setuptools wheel \
      && /opt/venv/bin/pip install --no-cache-dir pymobiledevice3 \
      && apt-get purge -y --auto-remove gcc python3-dev libssl-dev \
      && rm -rf /var/lib/apt/lists/* ; \
    fi

# Prepend virtual environment binaries to PATH
ENV PATH="/opt/venv/bin:$PATH"

# Copy all compiled binaries from the build stage
COPY --from=build /out/ /usr/local/bin/

# Copy the entrypoint script and make it executable
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# Run as non-root user by default (USB mode must override this with user: root or --user root)
USER gpsmock

# Configuration defaults
ENV GPSMOCK_ADDR=:8080
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD curl -fsS http://localhost:8080/api/status || exit 1

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
