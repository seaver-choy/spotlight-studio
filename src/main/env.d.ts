/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Google OAuth "Desktop app" client, set in .env.local or CI secrets (see docs/google-drive.md). */
  readonly MAIN_VITE_GOOGLE_CLIENT_ID?: string
  readonly MAIN_VITE_GOOGLE_CLIENT_SECRET?: string
}
