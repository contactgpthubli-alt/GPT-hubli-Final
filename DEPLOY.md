# Deploying GPT Hubli Management System on Ubuntu (self-hosted)

Complete guide for hosting this app on your own Ubuntu machine with a static IP,
local PostgreSQL, and pgAdmin.

Target: **Ubuntu Server 24.04 LTS** (recommended over Desktop for a server).

---

## 1. Install base packages

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git ufw nginx
```

### Node.js 20 (via nvm)

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc
nvm install 20
npm install -g pnpm pm2
```

---

## 2. PostgreSQL 16

```bash
sudo apt install -y postgresql-16 postgresql-contrib
sudo systemctl enable --now postgresql
```

Create a dedicated database and user (never run the app as the `postgres` superuser):

```bash
sudo -u postgres psql <<'SQL'
CREATE USER gpthubli WITH PASSWORD 'CHANGE_ME_STRONG_PASSWORD';
CREATE DATABASE gpthubli_db OWNER gpthubli;
\c gpthubli_db
CREATE EXTENSION IF NOT EXISTS pgcrypto;
SQL
```

> `pgcrypto` is required — the seed script uses `crypt()`/`gen_salt()` for password hashing.

Load the schema and seed data:

```bash
cd /path/to/app
sudo -u postgres psql -d gpthubli_db -f scripts/001_schema.sql
sudo -u postgres psql -d gpthubli_db -f scripts/002_seed.sql
sudo -u postgres psql -d gpthubli_db -c "GRANT ALL ON ALL TABLES IN SCHEMA public TO gpthubli; GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO gpthubli;"
```

**Security: keep Postgres bound to localhost** (the default). Never open port 5432
in the firewall — the app connects locally.

---

## 3. pgAdmin 4 (web mode)

```bash
curl -fsS https://www.pgadmin.org/static/packages_pgadmin_org.pub | sudo gpg --dearmor -o /usr/share/keyrings/packages-pgadmin-org.gpg
sudo sh -c 'echo "deb [signed-by=/usr/share/keyrings/packages-pgadmin-org.gpg] https://ftp.postgresql.org/pub/pgadmin/pgadmin4/apt/$(lsb_release -cs) pgadmin4 main" > /etc/apt/sources.list.d/pgadmin4.list'
sudo apt update && sudo apt install -y pgadmin4-web
sudo /usr/pgadmin4/bin/setup-web.sh
```

pgAdmin will be served at `http://YOUR_IP/pgadmin4`. **Recommended:** don't expose it
publicly. Access it through an SSH tunnel instead:

```bash
# from your laptop
ssh -L 8080:localhost:80 user@YOUR_STATIC_IP
# then open http://localhost:8080/pgadmin4
```

In pgAdmin, register a server: Host `localhost`, Port `5432`, DB `gpthubli_db`, user `gpthubli`.

---

## 4. The app

```bash
git clone <your-repo-url> /opt/gpthubli
cd /opt/gpthubli
pnpm install
```

Create `/opt/gpthubli/.env.production`:

```env
DATABASE_URL=postgresql://gpthubli:CHANGE_ME_STRONG_PASSWORD@localhost:5432/gpthubli_db
# Hide the demo quick-login bar in production:
NEXT_PUBLIC_ENABLE_DEMO_LOGIN=false
NODE_ENV=production
```

> SSL is auto-detected from the URL (`lib/db.ts`): Neon URLs use TLS, plain
> `localhost` URLs do not. No extra flag needed.

Build and run under pm2:

```bash
pnpm build
pm2 start "pnpm start" --name gpthubli
pm2 save
pm2 startup   # follow the printed instruction so it survives reboots
```

---

## 5. Nginx reverse proxy

`/etc/nginx/sites-available/gpthubli`:

```nginx
server {
    listen 80;
    server_name yourdomain.com;   # or your static IP

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/gpthubli /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

---

## 6. HTTPS (strongly recommended)

Point a domain's A record at your static IP, then:

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com
```

Session cookies are marked `Secure` in production, so **HTTPS is required for login
to work** when `NODE_ENV=production`. If you must run HTTP-only temporarily,
see `lib/auth.ts` (the `secure` cookie flag).

---

## 7. Firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

Nothing else should be open. Postgres (5432) and Next.js (3000) stay internal.

---

## 8. First login & housekeeping

- Root admin: `admin@gpthubli.ac.in` / `Admin@123` — **you are forced to change
  this password on first login. Do it immediately.**
- Demo accounts (`demo.*@gpthubli.ac.in`, password `demo1234`) exist for the demo
  bar. With `NEXT_PUBLIC_ENABLE_DEMO_LOGIN=false` the bar is hidden and the demo
  login API is disabled. To remove the accounts entirely:
  `DELETE FROM users WHERE is_demo = TRUE;`
- Backups: `pg_dump -U gpthubli gpthubli_db > backup_$(date +%F).sql` (cron it daily).
- Updates: `git pull && pnpm install && pnpm build && pm2 restart gpthubli`.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `ECONNREFUSED` on DB | `sudo systemctl status postgresql`; check `DATABASE_URL` |
| Login returns 401 with right password | Check `pgcrypto` extension is installed |
| Cookies not persisting | You're on HTTP with `NODE_ENV=production` — set up HTTPS |
| App dies after reboot | Re-run `pm2 startup` + `pm2 save` |
| 502 from nginx | App not running: `pm2 logs gpthubli` |
