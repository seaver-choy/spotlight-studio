# Google Drive upload

Spotlight Studio can upload an export straight to Google Drive and copy a share link, like Loom.

- Sign-in happens in your browser. The app uses Google's standard desktop flow (loopback redirect + PKCE) and never sees your password.
- The app asks only for the [`drive.file`](https://developers.google.com/drive/api/guides/api-specific-auth#scopes) scope. That lets it see and manage **only the files it uploads**, never the rest of your Drive.
- Videos go into a **Spotlight Studio** folder in My Drive. Uploads are resumable, so they survive brief network drops, and you can cancel them.
- By default the file is shared as "anyone with the link can view". You can turn this off per export.
- The sign-in is stored encrypted in the macOS Keychain. **Disconnect Google Drive** revokes it.

## Using it

1. Click **Export** in the editor.
2. Turn on **Upload to Google Drive**. The first time, click **Connect Google Drive** and approve access in your browser.
3. Click **Export & upload**. When it finishes, the link is already on your clipboard.

You can also connect or disconnect from the Google Drive button in the top bar of the home screen. To upload a video you've already exported, use **Upload to Google Drive** on the export-finished screen.

## Setting up an OAuth client (maintainers, or anyone building from source)

Google requires every app that uses the Drive API to have its own OAuth client. If a build doesn't have one, the Google Drive options are hidden.

1. Open the [Google Cloud Console](https://console.cloud.google.com/) and create a project (for example, "Spotlight Studio").
2. **APIs & Services → Library**: enable the **Google Drive API**.
3. **APIs & Services → OAuth consent screen** (also called "Google Auth Platform"):
   - User type: **External**.
   - App name **Spotlight Studio**, your support email, and a developer contact email.
   - **Data access / Scopes**: add `https://www.googleapis.com/auth/drive.file`. It's a non-sensitive scope, so Google doesn't require a security review.
   - **Audience / Test users**: add the Google accounts you'll test with.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Desktop app**.
   - Copy the **Client ID** and **Client secret**.
5. Put them in `.env.local` at the repo root (copy `.env.example`). This file is git-ignored:
   ```sh
   MAIN_VITE_GOOGLE_CLIENT_ID=1234567890-abc.apps.googleusercontent.com
   MAIN_VITE_GOOGLE_CLIENT_SECRET=GOCSPX-...
   ```
6. Restart `pnpm dev`. **Connect Google Drive** now appears.

> For "Desktop app" clients, Google states that the client secret [isn't treated as a secret](https://developers.google.com/identity/protocols/oauth2/native-app), because it ships inside the app. Even so, keep it out of git and store it as a CI secret. PKCE protects the sign-in itself.

### Release builds

Add two repository secrets: **Settings → Secrets and variables → Actions**, named `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. The release workflow builds them into the app.

### Publishing (more than 100 users)

While the consent screen is in **Testing** mode, only the test users you added can connect. To let anyone connect, click **Publish app** on the consent screen. Because the app only uses `drive.file`, Google asks for basic brand verification (a homepage and a privacy policy), not a security assessment. Until verification is done, people see an "unverified app" warning, and the app is limited to 100 users.

## Testing without Google

The automated tests run against a fake Google server (`tests/support/fakeGoogle.ts`) that implements the OAuth and resumable-upload endpoints. Run `pnpm test` and `pnpm test:e2e`. No account is needed.
