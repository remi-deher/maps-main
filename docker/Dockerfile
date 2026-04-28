# Utilisation d'une base Debian Slim pour la compatibilité glibc (pymobiledevice3)
FROM node:20-bookworm-slim

# Installation des dépendances système
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    curl \
    git \
    libusb-1.0-0 \
    usbmuxd \
    socat \
    procps \
    iputils-ping \
    usbutils \
    avahi-daemon \
    avahi-utils \
    libavahi-client3 \
    libnss-mdns \
    dbus \
    net-tools \
    iproute2 \
    netcat-openbsd \
    && rm -rf /var/lib/apt/lists/*

# Création de l'environnement Python et installation de pymobiledevice3
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
RUN pip3 install --no-cache-dir pymobiledevice3

# Téléchargement de go-ios (binaire Linux)
# Utilisation de la v1.0.211 (dernière version) pour le support iOS 17/18+ et --address
RUN curl -L https://github.com/danielpaulus/go-ios/releases/download/v1.0.211/go-ios-linux.zip -o /tmp/go-ios.zip && \
    apt-get update && apt-get install -y unzip && \
    unzip /tmp/go-ios.zip -d /usr/local/bin/ && \
    mv /usr/local/bin/ios-amd64 /usr/local/bin/ios && \
    chmod +x /usr/local/bin/ios && \
    rm /tmp/go-ios.zip

# Création du dossier de travail
WORKDIR /app

# Copie des fichiers package.json et installation des dépendances Node
COPY server/package*.json ./server/
RUN cd server && npm install --production

# Copie du reste du code source (incluant dist-web/)
COPY server/ ./server/

# Dossier pour les certificats Lockdown (volume)
RUN mkdir -p /var/lib/lockdown

# Variables d'environnement par défaut
ENV NODE_ENV=production
ENV PORT=8080

# Copie du script d'entrée
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN sed -i 's/\r$//' /usr/local/bin/entrypoint.sh && \
    chmod +x /usr/local/bin/entrypoint.sh

# Exposition du port (Dashboard + WS)
EXPOSE 8080

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
