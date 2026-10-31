#!/usr/bin/env bash
# Installe la VERSION EN LIGNE COMPLÈTE du LGO sur un serveur Linux (Ubuntu/Debian), avec HTTPS automatique.
# Usage (en root) :  bash vps-installer.sh pharmacie.mon-domaine.ci  titulaire@mon-email.ci
# Prérequis : le nom de domaine pointe déjà vers l'adresse IP du serveur.
# NB : script fourni sans test sur un serveur réel — à essayer d'abord sur un serveur de test.
set -euo pipefail
DOMAINE="${1:?Donne le nom de domaine}"; EMAIL="${2:?Donne l'email du titulaire}"
apt-get update -y && apt-get install -y curl git openssl ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https
curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs
id lgo >/dev/null 2>&1 || useradd -r -m -d /opt/lgo -s /usr/sbin/nologin lgo
if [ -d /opt/lgo/app/.git ]; then git -C /opt/lgo/app pull --ff-only; else git clone https://github.com/aubinfranck-hub/OFFICINE /opt/lgo/app; fi
mkdir -p /opt/lgo/donnees && chown -R lgo:lgo /opt/lgo
if [ ! -f /etc/lgo.env ]; then
  MDP="$(openssl rand -base64 15 | tr -d '/+=' | cut -c1-16)-Lgo7"
  TOTP="$(cd /opt/lgo/app && node --no-warnings -e "import('./server/lib.js').then(l=>console.log(l.nouveauSecretTotp()))")"
  cat > /etc/lgo.env <<ENV
MODE=online
PORT=3000
DB=/opt/lgo/donnees/lgo.db
INIT_OFFICINE=Ma pharmacie
INIT_EMAIL=$EMAIL
INIT_MDP=$MDP
INIT_TOTP=$TOTP
ENV
  chmod 600 /etc/lgo.env
  echo "=== NOTE CES ACCÈS (ils ne seront plus affichés) ==="
  echo "Adresse : https://$DOMAINE"; echo "Identifiant : $EMAIL"; echo "Mot de passe : $MDP"; echo "Clé Google Authenticator : $TOTP"
fi
cat > /etc/systemd/system/lgo.service <<UNIT
[Unit]
Description=LGO Officine (en ligne)
After=network.target
[Service]
User=lgo
WorkingDirectory=/opt/lgo/app
EnvironmentFile=/etc/lgo.env
ExecStart=/usr/bin/node --no-warnings server/server.js
Restart=always
RestartSec=3
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload && systemctl enable --now lgo
# HTTPS automatique avec Caddy
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
apt-get update -y && apt-get install -y caddy
printf '%s {\n  reverse_proxy localhost:3000\n}\n' "$DOMAINE" > /etc/caddy/Caddyfile
systemctl reload caddy || systemctl restart caddy
echo "Terminé. Ouvre https://$DOMAINE"
