# SpotALA setup

SpotALA already contains this public Spotify Client ID:

`6ce927aa2e8249948e8e9caa5f95ec7e`

The app no longer asks for a Client ID during first-time setup.

## 1. Upload

Upload every file in this folder to the root of the GitHub repository used by
your GitHub Pages site. Do not upload only `index.html`; the CSS, JavaScript,
manifest, service worker, and icons are all required.

## 2. Spotify Redirect URI

In Spotify Developer Dashboard, open your app, open Settings, and add the exact
folder address displayed in SpotALA's Settings tab.

For a GitHub Pages project named `spotify`, it normally looks like:

`https://YOUR-GITHUB-USERNAME.github.io/spotify/`

Keep the final `/`. Save the Spotify app settings.

## 3. First login

Open SpotALA, select Settings, and tap **Connect Spotify**. Spotify handles the
login and returns to SpotALA.

## 4. Replace the Client ID later

A Spotify Client ID does not normally expire every three months. If you create
a different Spotify developer app anyway:

1. Open SpotALA.
2. Open **Settings**.
3. Replace the value under **Spotify Client ID**.
4. Tap **Save**.
5. Tap **Connect Spotify** and sign in again.

For code-level replacement, edit the clearly marked `DEFAULT_CLIENT_ID` line
near the top of `app.js`.

Never put a Spotify Client Secret in this browser app.

## 5. Full-screen Chrome app

This version requests full-screen landscape mode through the web-app manifest
and again after the first tap as a fallback.

After uploading this version:

1. Remove the old SpotALA shortcut/app from the OPPO.
2. In Chrome, open the updated HTTPS site.
3. Open Chrome's menu and choose **Add to Home screen** or **Install app**.
4. Launch SpotALA from the newly created icon, not from an ordinary Chrome tab.
5. Tap once inside SpotALA if the status bar is initially visible.

The app also requests a screen wake lock when the installed Chrome version
supports it.
