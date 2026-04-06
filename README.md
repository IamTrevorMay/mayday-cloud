# Mayday Cloud

Personal cloud storage powered by a 60TB Yotamaster NAS rack.

## Architecture

- **Web**: React + Craco → Vercel (`cloud.maydaystudio.net`)
- **API**: Express → runs on work machine via pm2 (`cloud-api.maydaystudio.net`)
- **Auth**: Supabase (separate project from Studio Hub)
- **Storage**: Yotamaster rack via USB-C → mounted volume

## Setup

### API Server (work machine)

```bash
cd api
cp .env.example .env  # fill in values
npm install
npm run dev           # http://localhost:4000
```

### Web App

```bash
cd web
cp .env.example .env  # fill in values
npm install
npm start             # http://localhost:3000
```

## Deploy

- **Web**: Push to main → Vercel auto-deploys
- **API**: `pm2 start api/src/server.js --name mayday-cloud-api`
