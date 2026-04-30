# Déploiement sur VM Debian (Ultra-Light)

Ce dossier contient tout le nécessaire pour transformer une VM Debian 12 vierge en un serveur de simulation GPS robuste et performant.

## 1. Création de la VM (TrueNAS SCALE)
1. Crée une nouvelle VM **Debian 12** (Netinst).
2. Ressources recommandées : **2 vCPUs, 2 Go RAM, 20 Go HDD**.
3. **IMPORTANT** : Dans les réglages de la VM, ajoute un périphérique **USB Passthrough** pour ton iPhone.
4. Assure-toi que la carte réseau est en mode **VirtIO** (Bridge) pour être sur le même réseau que l'iPhone.

## 2. Préparation (Provisionnement)
Une fois la VM installée et connectée en SSH :
1. Copie le fichier `provision.sh` sur la VM.
2. Rends-le exécutable et lance-le :
   ```bash
   chmod +x provision.sh
   ./provision.sh
   ```

## 3. Déploiement de l'Application
1. Copie ton dossier `server` local vers `/opt/gps-mock/server` sur la VM.
2. Copie également le fichier `pm2-ecosystem.config.js` vers `/opt/gps-mock/`.
3. Installe les dépendances Node.js :
   ```bash
   cd /opt/gps-mock/server
   npm install --production
   ```

## 4. Configuration Nginx
Active la configuration du serveur web :
```bash
sudo cp /path/to/VM/nginx.conf /etc/nginx/sites-available/gps-mock
sudo ln -s /etc/nginx/sites-available/gps-mock /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

## 5. Lancement
Démarre le serveur avec PM2 :
```bash
cd /opt/gps-mock
pm2 start pm2-ecosystem.config.js
pm2 save
pm2 startup # Suis l'instruction affichée pour activer le démarrage automatique
```

## 6. Certificats (Lockdown)
N'oublie pas de copier tes fichiers `.plist` dans `/var/lib/lockdown/` sur la VM pour que l'appairage fonctionne.
