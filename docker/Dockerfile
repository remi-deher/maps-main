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
    && rm -rf /var/lib/apt/lists/*

# Création de l'environnement Python et installation de pymobiledevice3
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
RUN pip3 install --no-cache-dir pymobiledevice3

# Téléchargement de go-ios (binaire Linux)
# On utilise la version stable 1.0.122 (ou dernière version)
RUN curl -L https://github.com/danielpaulus/go-ios/releases/download/v1.0.122/go-ios-linux.zip -o /tmp/go-ios.zip && \
    apt-get update && apt-get install -y unzip && \
    unzip /tmp/go-ios.zip -d /usr/local/bin/ && \
    chmod +x /usr/local/bin/ios && \
    rm /tmp/go-ios.zip

# Création du dossier de travail
WORKDIR /app

# Copie des fichiers package.json et installation des dépendances Node
COPY server/package*.json ./server/
RUN cd server && npm install --production

# Copie du reste du code source
COPY server/ ./server/
# Les fichiers statiques du Dashboard sont dans server/dist-web
COPY server/dist-web/ ./dist-web/

# Dossier pour les certificats Lockdown (volume)
RUN mkdir -p /var/lib/lockdown

# Variables d'environnement par défaut
ENV NODE_ENV=production
ENV PORT=8080

# Exposition du port (Dashboard + WS)
EXPOSE 8080

# Commande de démarrage (Mode Headless)
CMD ["node", "server/src/main/index-headless.js"]
