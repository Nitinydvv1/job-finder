<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/daf307a4-fce0-42e6-9bd9-30202d20c725

## Run Locally

**Prerequisites:** Node.js

1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Secret Safety (Pre-commit)

To block accidental API key/token commits, enable the repository hook once:

`git config core.hooksPath .githooks`

The pre-commit hook runs `scripts/check-secrets.sh` and blocks commits if likely secrets are found in staged changes.
`.env.example` is intentionally allowed as a safe template.

## DevOps Deployment Setup

This repo now includes:

- A production start script: `npm run start`
- Docker support (`Dockerfile`, `.dockerignore`)
- CI workflow (`.github/workflows/ci.yml`) for lint + build on PR/push
- CD workflow (`.github/workflows/deploy.yml`) for deployment on `main`

### 1. Required Runtime Environment Variables

Set these in your hosting platform (Render/Railway/Fly.io/etc):

- `GEMINI_API_KEY`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_APP_ID`
- `FIREBASE_API_KEY`
- `FIREBASE_AUTH_DOMAIN`
- `FIREBASE_STORAGE_BUCKET`
- `FIREBASE_MESSAGING_SENDER_ID`
- `FIREBASE_MEASUREMENT_ID`
- `FIREBASE_FIRESTORE_DATABASE_ID`

### 2. CI Pipeline

CI runs automatically on push and pull requests to `main` and checks:

- TypeScript lint (`npm run lint`)
- Frontend build (`npm run build`)

### 3. CD Pipeline (Deploy on Main)

The deploy workflow runs on push to `main`.

Set one GitHub secret in your repository:

- `RENDER_DEPLOY_HOOK_URL`

Then the workflow calls your Render deploy hook and triggers a production deploy.
