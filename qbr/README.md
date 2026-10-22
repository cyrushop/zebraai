# Zebra HK QBR — Web App

Browser-based FY26 Q4 QBR deck (18 slides, 1920 × 1080 canvas).

## Run

```bash
npm install
mkdir -p data && cp /path/to/QBR_Data_2026-10-14.md data/
npm run dev            # http://localhost:5173
npm run build          # dist/ (static site)
npm run build:single   # dist-single/index.html — one self-contained file to open or email
```

Keys: ← → / Space / PageUp / PageDown, Home / End, **F** full screen, **N** speaker notes, **P** print / save as PDF (one slide per page).
Deep link to a slide with `#6`.

## Data (not in git)

This repository is public, so the QBR data file is never committed (`data/` is in the root `.gitignore`).
Before `npm run build`, `docker build` or `deploy/cloudrun.sh`, put the current
`QBR_Data_<pos-date>.md` in `qbr/data/` on your machine. The build stops with
"No data/QBR_Data_<date>.md file found" when it is missing.

## Update for a new POS report

1. Drop the new `QBR_Data_<pos-date>.md` into `data/` (the newest date is used).
2. `npm run build` (or `build:single`). The build re-extracts `src/data/qbr.json` and `src/data/narrative.ts`
   and fails if any `-F` / `-P` / `-R` opportunity suffix appears.

No figures are hard-coded in components; edition text (presenter, footer) lives in `src/config.ts`.

## Logo

Put `Zebra-Logo-K.png` (676 × 266, black) in `public/`. It is inverted to white and shown only on the cover.
Until the file is there, the cover shows a plain "ZEBRA" text fallback.

## Docker (production)

```bash
docker build -t zebra-qbr .
docker run -p 8080:8080 zebra-qbr                # listens on $PORT, default 8080
docker run -p 3000:3000 -e PORT=3000 zebra-qbr   # any other port
```

- Multi-stage: `node:22-alpine` builds, `nginxinc/nginx-unprivileged:1.30-alpine` serves (non-root user `nginx`).
- `deploy/nginx.conf.template` is rendered with `envsubst` at start-up, so `PORT` can change without a rebuild.
- `GET /healthz` returns `ok` (used by the image HEALTHCHECK; never password-protected).
- Optional password: `-e BASIC_AUTH_USER=zebra -e BASIC_AUTH_PASS=...` (no `:` allowed). Without both, the site is open.
- `index.html` is `no-cache`; hashed `/assets/*` are cached for a year. All responses carry `X-Robots-Tag: noindex`.
- New POS data = replace the file in `data/` and rebuild the image.

## Google Cloud Run

```bash
gcloud auth login
PROJECT_ID=zebraqbr ./deploy/cloudrun.sh          # first run prints the password
ROTATE_PASSWORD=1 PROJECT_ID=zebraqbr ./deploy/cloudrun.sh   # new password
```
Region `asia-east2` (Hong Kong). The password lives in Secret Manager (`zebra-hk-qbr-password`).
