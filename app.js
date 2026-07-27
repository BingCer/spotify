"use strict";

const API_BASE = "https://api.spotify.com/v1";
const TOKEN_URL = "https://accounts.spotify.com/api/token";
const AUTHORIZE_URL = "https://accounts.spotify.com/authorize";
const LYRICS_API = "https://lrclib.net/api";
// If you ever create a new Spotify app, replace this public Client ID.
const DEFAULT_CLIENT_ID = "6ce927aa2e8249948e8e9caa5f95ec7e";
const SCOPES = [
  "user-read-playback-state",
  "user-read-currently-playing",
  "user-modify-playback-state",
  "user-library-read",
  "user-library-modify",
  "playlist-read-private",
  "playlist-read-collaborative",
].join(" ");

const KEYS = {
  clientId: "j2remote.clientId",
  accessToken: "j2remote.accessToken",
  refreshToken: "j2remote.refreshToken",
  expiresAt: "j2remote.expiresAt",
  verifier: "j2remote.pkceVerifier",
  oauthState: "j2remote.oauthState",
  deviceId: "j2remote.deviceId",
  deviceName: "j2remote.deviceName",
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const elements = {
  appView: $("#appView"),
  settingsRedirect: $("#settingsRedirect"),
  clientIdSettingsInput: $("#clientIdSettingsInput"),
  saveClientIdButton: $("#saveClientIdButton"),
  connectSpotifyButton: $("#connectSpotifyButton"),
  copySettingsRedirect: $("#copySettingsRedirect"),
  connectionDot: $("#connectionDot"),
  connectionText: $("#connectionText"),
  refreshButton: $("#refreshButton"),
  deviceButton: $("#deviceButton"),
  deviceName: $("#deviceName"),
  nowPanel: $("#nowPanel"),
  albumArt: $("#albumArt"),
  artPlaceholder: $("#artPlaceholder"),
  contextLine: $("#contextLine"),
  trackTitle: $("#trackTitle"),
  trackArtist: $("#trackArtist"),
  saveButton: $("#saveButton"),
  seekSlider: $("#seekSlider"),
  elapsedTime: $("#elapsedTime"),
  remainingTime: $("#remainingTime"),
  shuffleButton: $("#shuffleButton"),
  previousButton: $("#previousButton"),
  playButton: $("#playButton"),
  nextButton: $("#nextButton"),
  repeatButton: $("#repeatButton"),
  volumeSlider: $("#volumeSlider"),
  volumeValue: $("#volumeValue"),
  playerHint: $("#playerHint"),
  searchForm: $("#searchForm"),
  searchInput: $("#searchInput"),
  searchResults: $("#searchResults"),
  albumResults: $("#albumResults"),
  playlistResults: $("#playlistResults"),
  queueResults: $("#queueResults"),
  reloadLibraryButton: $("#reloadLibraryButton"),
  reloadQueueButton: $("#reloadQueueButton"),
  librarySwitches: $$("[data-library-target]"),
  librarySections: $$("[data-library-section]"),
  lyricsTitle: $("#lyricsTitle"),
  lyricsArtist: $("#lyricsArtist"),
  lyricsMode: $("#lyricsMode"),
  lyricsScroller: $("#lyricsScroller"),
  lyricsPanel: $("#lyricsPanel"),
  reloadLyricsButton: $("#reloadLyricsButton"),
  lyricsBackdrop: $("#lyricsBackdrop"),
  lyricsSheetClose: $("#lyricsSheetClose"),
  deviceModal: $("#deviceModal"),
  deviceList: $("#deviceList"),
  reloadDevicesButton: $("#reloadDevicesButton"),
  wakeStatus: $("#wakeStatus"),
  disconnectButton: $("#disconnectButton"),
  resetButton: $("#resetButton"),
  toast: $("#toast"),
};

const state = {
  player: null,
  devices: [],
  savedCurrent: false,
  currentUri: "",
  currentPanel: "now",
  progressAtFetch: 0,
  fetchedAt: Date.now(),
  pollingTimer: null,
  clockTimer: null,
  refreshPromise: null,
  wakeLock: null,
  toastTimer: null,
  loadingPlayer: false,
  libraryView: "albums",
  lyricsOpen: false,
  lyricsCloseTimer: null,
  lyricsForUri: "",
  lyricsLines: [],
  activeLyricIndex: -1,
  lyricsRequestSerial: 0,
  lyricsCache: new Map(),
  queueJumping: false,
};

// Always use the folder URL so Chrome and the installed app share one OAuth address.
const redirectUri = new URL("./", window.location.href).href;

function getClientId() {
  return localStorage.getItem(KEYS.clientId) || DEFAULT_CLIENT_ID;
}

function showToast(message, duration = 3300) {
  window.clearTimeout(state.toastTimer);
  elements.toast.textContent = message;
  elements.toast.hidden = false;
  state.toastTimer = window.setTimeout(() => {
    elements.toast.hidden = true;
  }, duration);
}

function setConnection(kind, label) {
  elements.connectionDot.classList.remove("online", "error");
  if (kind) elements.connectionDot.classList.add(kind);
  elements.connectionText.textContent = label;
}

function formatTime(milliseconds) {
  const safe = Math.max(0, Number(milliseconds) || 0);
  const totalSeconds = Math.floor(safe / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function rangeFill(element, percent) {
  const safe = Math.max(0, Math.min(100, Number(percent) || 0));
  element.style.setProperty("--range-fill", `${safe}%`);
}

function randomString(length) {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const values = window.crypto.getRandomValues(new Uint8Array(length));
  return Array.from(values, (value) => alphabet[value % alphabet.length]).join("");
}

async function codeChallenge(verifier) {
  const bytes = new TextEncoder().encode(verifier);
  const digest = await window.crypto.subtle.digest("SHA-256", bytes);
  return window
    .btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function storeTokens(payload) {
  if (!payload.access_token) throw new Error("Spotify returned no access token.");
  localStorage.setItem(KEYS.accessToken, payload.access_token);
  if (payload.refresh_token) {
    localStorage.setItem(KEYS.refreshToken, payload.refresh_token);
  }
  const lifetime = Math.max(60, Number(payload.expires_in) || 3600);
  localStorage.setItem(KEYS.expiresAt, String(Date.now() + lifetime * 1000));
}

function clearTokens() {
  localStorage.removeItem(KEYS.accessToken);
  localStorage.removeItem(KEYS.refreshToken);
  localStorage.removeItem(KEYS.expiresAt);
  localStorage.removeItem(KEYS.verifier);
  localStorage.removeItem(KEYS.oauthState);
}

function hasSession() {
  return Boolean(
    localStorage.getItem(KEYS.accessToken) ||
      localStorage.getItem(KEYS.refreshToken),
  );
}

async function beginAuthorization() {
  if (!window.isSecureContext || !window.crypto?.subtle) {
    showToast(
      "Spotify login needs HTTPS. Open the uploaded GitHub Pages version.",
    );
    return;
  }

  const clientId = getClientId();
  if (!/^[A-Za-z0-9]{20,80}$/.test(clientId)) {
    switchPanel("settings");
    showToast("The saved Spotify Client ID is invalid. Replace it in Settings.");
    return;
  }

  elements.connectSpotifyButton.disabled = true;
  elements.connectSpotifyButton.textContent = "Opening Spotify…";

  try {
    const verifier = randomString(96);
    const oauthState = randomString(48);
    const challenge = await codeChallenge(verifier);

    localStorage.setItem(KEYS.clientId, clientId);
    localStorage.setItem(KEYS.verifier, verifier);
    localStorage.setItem(KEYS.oauthState, oauthState);

    const params = new URLSearchParams({
      client_id: clientId,
      response_type: "code",
      redirect_uri: redirectUri,
      scope: SCOPES,
      state: oauthState,
      code_challenge_method: "S256",
      code_challenge: challenge,
      show_dialog: "false",
    });

    window.location.assign(`${AUTHORIZE_URL}?${params.toString()}`);
  } catch (error) {
    elements.connectSpotifyButton.disabled = false;
    elements.connectSpotifyButton.textContent = "Connect Spotify";
    showToast(error.message || "Could not start Spotify login.");
  }
}

async function exchangeAuthorizationCode(code, returnedState) {
  const expectedState = localStorage.getItem(KEYS.oauthState);
  const verifier = localStorage.getItem(KEYS.verifier);
  const clientId = getClientId();

  if (!expectedState || returnedState !== expectedState) {
    throw new Error("Login state did not match. Start the connection again.");
  }
  if (!verifier || !clientId) {
    throw new Error("The login setup expired. Start the connection again.");
  }

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    }),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error_description || payload.error || "Token exchange failed.");
  }

  storeTokens(payload);
  localStorage.removeItem(KEYS.verifier);
  localStorage.removeItem(KEYS.oauthState);
  window.history.replaceState({}, document.title, redirectUri);
}

async function refreshAccessToken() {
  if (state.refreshPromise) return state.refreshPromise;

  state.refreshPromise = (async () => {
    const clientId = getClientId();
    const refreshToken = localStorage.getItem(KEYS.refreshToken);

    if (!clientId || !refreshToken) {
      throw new Error("Spotify login expired. Connect again.");
    }

    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error_description || payload.error || "Token refresh failed.");
    }

    storeTokens(payload);
    return payload.access_token;
  })();

  try {
    return await state.refreshPromise;
  } finally {
    state.refreshPromise = null;
  }
}

async function validAccessToken() {
  const token = localStorage.getItem(KEYS.accessToken);
  const expiresAt = Number(localStorage.getItem(KEYS.expiresAt) || 0);
  if (token && Date.now() < expiresAt - 60_000) return token;
  return refreshAccessToken();
}

async function spotifyApi(path, options = {}, retried = false) {
  const token = await validAccessToken();
  const headers = {
    Authorization: `Bearer ${token}`,
    ...(options.headers || {}),
  };

  let body = options.body;
  if (options.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.json);
  }

  const response = await fetch(`${API_BASE}${path}`, {
    method: options.method || "GET",
    headers,
    body,
  });

  if (response.status === 401 && !retried) {
    localStorage.removeItem(KEYS.accessToken);
    localStorage.removeItem(KEYS.expiresAt);
    await refreshAccessToken();
    return spotifyApi(path, options, true);
  }

  if (response.status === 204) return null;

  if (!response.ok) {
    let detail = "";
    try {
      const payload = await response.json();
      detail =
        payload?.error?.message ||
        payload?.error_description ||
        payload?.error ||
        "";
    } catch {
      detail = await response.text().catch(() => "");
    }

    const error = new Error(detail || `Spotify request failed (${response.status}).`);
    error.status = response.status;
    error.retryAfter = response.headers.get("Retry-After");
    throw error;
  }

  const contentType = response.headers.get("Content-Type") || "";
  return contentType.includes("application/json") ? response.json() : null;
}

function selectedDeviceQuery() {
  const id = localStorage.getItem(KEYS.deviceId);
  return id ? `?device_id=${encodeURIComponent(id)}` : "";
}

function playbackErrorMessage(error) {
  if (error.status === 403) {
    return "Spotify rejected the command. Premium is required, and the account must be allowed to use this developer app.";
  }
  if (error.status === 404) {
    return "No active player. Open Spotify Desktop on the PC, play anything once, then choose the PC here.";
  }
  if (error.status === 429) {
    const wait = error.retryAfter ? ` Wait ${error.retryAfter} seconds.` : "";
    return `Spotify rate limit reached.${wait}`;
  }
  return error.message || "Spotify command failed.";
}

async function command(path, options = {}, successMessage = "") {
  try {
    await spotifyApi(path, options);
    if (successMessage) showToast(successMessage);
    window.setTimeout(loadPlayer, 450);
    return true;
  } catch (error) {
    showToast(playbackErrorMessage(error), 5200);
    return false;
  }
}

function setPlayerControls(enabled) {
  [
    elements.seekSlider,
    elements.shuffleButton,
    elements.previousButton,
    elements.playButton,
    elements.nextButton,
    elements.repeatButton,
    elements.volumeSlider,
  ].forEach((element) => {
    element.disabled = !enabled;
  });
}

function mediaImage(item) {
  if (!item) return "";
  if (item.album?.images?.length) return item.album.images[0].url;
  if (item.images?.length) return item.images[0].url;
  if (item.show?.images?.length) return item.show.images[0].url;
  return "";
}

function mediaSubtitle(item) {
  if (!item) return "";
  if (item.artists?.length) return item.artists.map((artist) => artist.name).join(", ");
  if (item.owner?.display_name) return `Playlist · ${item.owner.display_name}`;
  if (item.type === "album") return `Album · ${(item.artists || []).map((artist) => artist.name).join(", ")}`;
  if (item.show?.name) return item.show.name;
  return item.type ? item.type[0].toUpperCase() + item.type.slice(1) : "Spotify";
}

function currentPlaybackProgressMs() {
  const player = state.player;
  if (!player?.item) return 0;

  const duration = Number(player.item.duration_ms) || 0;
  let progress = state.progressAtFetch;
  if (player.is_playing) progress += Date.now() - state.fetchedAt;
  return Math.min(duration, Math.max(0, progress));
}

function updateProgressUi() {
  const player = state.player;
  if (!player?.item) {
    elements.seekSlider.value = "0";
    rangeFill(elements.seekSlider, 0);
    elements.elapsedTime.textContent = "0:00";
    elements.remainingTime.textContent = "−0:00";
    updateLyricsHighlight(0);
    return;
  }

  const duration = Number(player.item.duration_ms) || 0;
  const progress = currentPlaybackProgressMs();

  const sliderValue = duration ? Math.round((progress / duration) * 1000) : 0;
  elements.seekSlider.value = String(sliderValue);
  rangeFill(elements.seekSlider, sliderValue / 10);
  elements.elapsedTime.textContent = formatTime(progress);
  elements.remainingTime.textContent = `−${formatTime(duration - progress)}`;
  updateLyricsHighlight(progress);
}

async function updateSavedState(item) {
  const uri = item?.uri || "";
  state.currentUri = uri;
  elements.saveButton.disabled = !uri;
  elements.saveButton.classList.remove("saved");
  elements.saveButton.textContent = "♡";
  elements.saveButton.setAttribute("aria-label", "Save current item");
  state.savedCurrent = false;

  if (!uri) return;

  try {
    const result = await spotifyApi(
      `/me/library/contains?uris=${encodeURIComponent(uri)}`,
    );
    if (state.currentUri !== uri) return;
    state.savedCurrent = Boolean(result?.[0]);
    elements.saveButton.classList.toggle("saved", state.savedCurrent);
    elements.saveButton.textContent = state.savedCurrent ? "♥" : "♡";
    elements.saveButton.setAttribute(
      "aria-label",
      state.savedCurrent ? "Remove current item from library" : "Save current item",
    );
  } catch {
    elements.saveButton.disabled = true;
  }
}

function renderPlayer(player) {
  const previousItemUri = state.player?.item?.uri || "";
  state.player = player;
  state.progressAtFetch = Number(player?.progress_ms) || 0;
  state.fetchedAt = Date.now();

  const item = player?.item;
  const hasItem = Boolean(item);
  setPlayerControls(Boolean(player?.device && hasItem));

  if (!hasItem) {
    elements.albumArt.hidden = true;
    elements.artPlaceholder.hidden = false;
    elements.contextLine.textContent = "SPOTIFY CONNECT REMOTE";
    elements.trackTitle.textContent = "Nothing playing";
    elements.trackArtist.textContent =
      "Open Spotify Desktop, play anything once, then choose your PC.";
    elements.playButton.textContent = "▶";
    elements.playButton.setAttribute("aria-label", "Play");
    elements.playerHint.textContent =
      "The PC app must be open. This remote cannot wake a sleeping PC.";
    updateProgressUi();
    updateSavedState(null);
    if (state.lyricsOpen) {
      showLyricsMessage(
        "NOT PLAYING",
        "Lyrics",
        "Start a music track on the PC, then reload this tab.",
      );
    }
    return;
  }

  const image = mediaImage(item);
  if (image) {
    elements.albumArt.src = image;
    elements.albumArt.alt = `${item.name || "Current item"} artwork`;
    elements.albumArt.hidden = false;
    elements.artPlaceholder.hidden = true;
  } else {
    elements.albumArt.hidden = true;
    elements.artPlaceholder.hidden = false;
  }

  elements.contextLine.textContent = player.currently_playing_type
    ? player.currently_playing_type.toUpperCase()
    : (item.type || "NOW PLAYING").toUpperCase();
  elements.trackTitle.textContent = item.name || "Unknown title";
  elements.trackArtist.textContent = mediaSubtitle(item) || "Spotify";
  elements.playButton.textContent = player.is_playing ? "❚❚" : "▶";
  elements.playButton.setAttribute(
    "aria-label",
    player.is_playing ? "Pause" : "Play",
  );

  elements.shuffleButton.classList.toggle("active", Boolean(player.shuffle_state));
  elements.shuffleButton.setAttribute(
    "aria-pressed",
    String(Boolean(player.shuffle_state)),
  );

  const repeat = player.repeat_state || "off";
  elements.repeatButton.classList.toggle("active", repeat !== "off");
  elements.repeatButton.textContent = repeat === "track" ? "↻¹" : "↻";
  elements.repeatButton.setAttribute("aria-label", `Repeat: ${repeat}`);

  const volume = Number(player.device?.volume_percent);
  if (Number.isFinite(volume)) {
    elements.volumeSlider.value = String(volume);
    elements.volumeValue.textContent = `${volume}%`;
    rangeFill(elements.volumeSlider, volume);
  }

  if (player.device?.name) {
    localStorage.setItem(KEYS.deviceId, player.device.id);
    localStorage.setItem(KEYS.deviceName, player.device.name);
    elements.deviceName.textContent = player.device.name;
  }

  elements.playerHint.textContent = player.device?.is_restricted
    ? "Spotify marks this device as restricted, so some controls may be unavailable."
    : `Playing on ${player.device?.name || "Spotify device"}`;

  updateProgressUi();
  if (state.currentUri !== item.uri) updateSavedState(item);
  if (state.lyricsOpen && previousItemUri !== item.uri) {
    loadLyricsForCurrentTrack();
  }
}

async function loadPlayer() {
  if (state.loadingPlayer || !hasSession()) return;
  state.loadingPlayer = true;

  try {
    const player = await spotifyApi("/me/player");
    renderPlayer(player);
    setConnection("online", "Online");
  } catch (error) {
    if (
      error.message?.includes("login expired") ||
      error.message?.includes("refresh failed")
    ) {
      clearTokens();
      showDisconnected("Spotify login expired. Connect again.");
      return;
    }
    setConnection("error", "Retry");
    elements.playerHint.textContent = playbackErrorMessage(error);
  } finally {
    state.loadingPlayer = false;
  }
}

function schedulePolling() {
  window.clearInterval(state.pollingTimer);
  window.clearInterval(state.clockTimer);
  state.clockTimer = window.setInterval(updateProgressUi, 1000);
  state.pollingTimer = window.setInterval(() => {
    if (!document.hidden) loadPlayer();
  }, 15_000);
}

async function loadDevices(showLoading = true) {
  if (showLoading) {
    elements.deviceList.innerHTML = '<p class="empty-state">Scanning Spotify…</p>';
  }

  try {
    const payload = await spotifyApi("/me/player/devices");
    state.devices = payload?.devices || [];
    renderDevices();
  } catch (error) {
    elements.deviceList.innerHTML = `<p class="empty-state">${escapeHtml(
      playbackErrorMessage(error),
    )}</p>`;
  }
}

function deviceGlyph(type) {
  const normalized = String(type || "").toLowerCase();
  if (normalized.includes("computer")) return "▰";
  if (normalized.includes("smartphone")) return "▯";
  if (normalized.includes("speaker")) return "◉";
  if (normalized.includes("tv")) return "▣";
  return "◇";
}

function renderDevices() {
  if (!state.devices.length) {
    elements.deviceList.innerHTML =
      '<p class="empty-state">No devices found. Open Spotify Desktop on the PC and play a track once.</p>';
    return;
  }

  elements.deviceList.innerHTML = state.devices
    .map(
      (device) => `
        <button class="device-option ${device.is_active ? "active" : ""}" type="button"
          data-device-id="${escapeHtml(device.id)}" data-device-name="${escapeHtml(device.name)}">
          <span class="device-icon" aria-hidden="true">${deviceGlyph(device.type)}</span>
          <span class="device-copy">
            <strong>${escapeHtml(device.name || "Spotify device")}</strong>
            <span>${escapeHtml(device.type || "Device")}${
              Number.isFinite(device.volume_percent)
                ? ` · ${device.volume_percent}%`
                : ""
            }</span>
          </span>
          <span class="device-state">${device.is_active ? "ACTIVE" : "USE"}</span>
        </button>
      `,
    )
    .join("");

  $$(".device-option").forEach((button) => {
    button.addEventListener("click", () => {
      transferPlayback(button.dataset.deviceId, button.dataset.deviceName);
    });
  });
}

async function transferPlayback(deviceId, deviceName) {
  if (!deviceId) return;
  const ok = await command(
    "/me/player",
    {
      method: "PUT",
      json: { device_ids: [deviceId], play: true },
    },
    `Playback moved to ${deviceName}.`,
  );
  if (!ok) return;

  localStorage.setItem(KEYS.deviceId, deviceId);
  localStorage.setItem(KEYS.deviceName, deviceName || "Spotify device");
  elements.deviceName.textContent = deviceName || "Spotify device";
  closeModal(elements.deviceModal);
}

async function togglePlay() {
  const playing = Boolean(state.player?.is_playing);
  const path = playing
    ? `/me/player/pause${selectedDeviceQuery()}`
    : `/me/player/play${selectedDeviceQuery()}`;
  const ok = await command(path, { method: "PUT" });
  if (ok && state.player) {
    state.player.is_playing = !playing;
    state.progressAtFetch = Number(elements.seekSlider.value) *
      ((state.player.item?.duration_ms || 0) / 1000);
    state.fetchedAt = Date.now();
    elements.playButton.textContent = playing ? "▶" : "❚❚";
  }
}

async function seekPlayback() {
  const duration = Number(state.player?.item?.duration_ms) || 0;
  const position = Math.round((Number(elements.seekSlider.value) / 1000) * duration);
  state.progressAtFetch = position;
  state.fetchedAt = Date.now();
  updateProgressUi();
  await command(
    `/me/player/seek?position_ms=${position}${selectedDeviceQuery().replace("?", "&")}`,
    { method: "PUT" },
  );
}

let volumeTimer;
function changeVolumePreview() {
  const volume = Number(elements.volumeSlider.value);
  elements.volumeValue.textContent = `${volume}%`;
  rangeFill(elements.volumeSlider, volume);
  window.clearTimeout(volumeTimer);
  volumeTimer = window.setTimeout(() => setVolume(volume), 180);
}

async function setVolume(volume) {
  await command(
    `/me/player/volume?volume_percent=${volume}${selectedDeviceQuery().replace("?", "&")}`,
    { method: "PUT" },
  );
}

async function toggleShuffle() {
  const next = !Boolean(state.player?.shuffle_state);
  const ok = await command(
    `/me/player/shuffle?state=${next}${selectedDeviceQuery().replace("?", "&")}`,
    { method: "PUT" },
  );
  if (ok && state.player) {
    state.player.shuffle_state = next;
    elements.shuffleButton.classList.toggle("active", next);
  }
}

async function cycleRepeat() {
  const current = state.player?.repeat_state || "off";
  const next = current === "off" ? "context" : current === "context" ? "track" : "off";
  const ok = await command(
    `/me/player/repeat?state=${next}${selectedDeviceQuery().replace("?", "&")}`,
    { method: "PUT" },
  );
  if (ok && state.player) {
    state.player.repeat_state = next;
    elements.repeatButton.classList.toggle("active", next !== "off");
    elements.repeatButton.textContent = next === "track" ? "↻¹" : "↻";
    elements.repeatButton.setAttribute("aria-label", `Repeat: ${next}`);
  }
}

async function toggleSavedCurrent() {
  const uri = state.currentUri;
  if (!uri) return;

  const removing = state.savedCurrent;
  elements.saveButton.disabled = true;
  try {
    await spotifyApi(`/me/library?uris=${encodeURIComponent(uri)}`, {
      method: removing ? "DELETE" : "PUT",
    });
    state.savedCurrent = !removing;
    elements.saveButton.classList.toggle("saved", state.savedCurrent);
    elements.saveButton.textContent = state.savedCurrent ? "♥" : "♡";
    showToast(state.savedCurrent ? "Saved to your library." : "Removed from your library.");
  } catch (error) {
    showToast(playbackErrorMessage(error));
  } finally {
    elements.saveButton.disabled = false;
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function renderMediaList(container, items, options = {}) {
  if (!items.length) {
    container.innerHTML = `<p class="empty-state">${escapeHtml(
      options.empty || "Nothing found.",
    )}</p>`;
    return;
  }

  container.innerHTML = items
    .map((item, index) => {
      const image = mediaImage(item);
      const type = item.type || "track";
      const canQueue = type === "track" || type === "episode";
      const queuePlayable =
        options.queueOnly &&
        options.currentIndex !== index &&
        Boolean(item.uri);
      return `
        <article
          class="media-item ${options.currentIndex === index ? "current" : ""} ${
            queuePlayable ? "queue-playable" : ""
          }"
          ${
            queuePlayable
              ? `data-action="play" data-index="${index}" role="button" tabindex="0" aria-label="Play ${escapeHtml(
                  item.name || "this item",
                )}"`
              : ""
          }
        >
          ${
            image
              ? `<img class="media-thumb" src="${escapeHtml(image)}" alt="" loading="lazy" />`
              : '<div class="media-thumb-placeholder" aria-hidden="true">S</div>'
          }
          <div class="media-copy">
            <div class="media-title">${escapeHtml(item.name || "Untitled")}</div>
            <div class="media-subtitle">${escapeHtml(mediaSubtitle(item))}</div>
          </div>
          <div class="media-actions">
            ${
              options.queueOnly
                ? ""
                : `<button class="mini-button play" type="button" data-action="play" data-index="${index}">Play</button>`
            }
            ${
              canQueue && !options.queueOnly
                ? `<button class="mini-button" type="button" data-action="queue" data-index="${index}">＋ Queue</button>`
                : ""
            }
          </div>
        </article>
      `;
    })
    .join("");

  container.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const index = Number(button.dataset.index);
      const item = items[index];
      if (button.dataset.action === "play" && options.queueOnly) {
        playQueuePosition(index + Number(options.queueAdvanceBase || 0), item);
      } else if (button.dataset.action === "play") {
        playMedia(item);
      }
      if (button.dataset.action === "queue") queueMedia(item);
    });
    if (button.classList.contains("queue-playable")) {
      button.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        button.click();
      });
    }
  });
}

function renderSearchResults(payload) {
  const groups = [
    {
      title: "Songs",
      items: (payload?.tracks?.items || []).filter(Boolean),
    },
    {
      title: "Albums",
      items: (payload?.albums?.items || []).filter(Boolean),
    },
    {
      title: "Playlists",
      items: (payload?.playlists?.items || []).filter(Boolean),
    },
  ].filter((group) => group.items.length);

  elements.searchResults.replaceChildren();
  if (!groups.length) {
    elements.searchResults.innerHTML =
      '<p class="empty-state">No matching songs, albums, or playlists.</p>';
    return;
  }

  groups.forEach((group) => {
    const section = document.createElement("section");
    section.className = "search-group";

    const heading = document.createElement("div");
    heading.className = "search-group-heading";

    const title = document.createElement("h3");
    title.textContent = group.title;
    heading.appendChild(title);

    const count = document.createElement("span");
    count.textContent = String(group.items.length);
    heading.appendChild(count);

    const list = document.createElement("div");
    list.className = "media-list";
    renderMediaList(list, group.items);

    section.append(heading, list);
    elements.searchResults.appendChild(section);
  });
}

async function searchSpotify(event) {
  event.preventDefault();
  const query = elements.searchInput.value.trim();
  if (!query) return;

  elements.searchResults.innerHTML = '<p class="empty-state">Searching…</p>';
  try {
    const payload = await spotifyApi(
      `/search?q=${encodeURIComponent(query)}&type=track,album,playlist&limit=10`,
    );
    renderSearchResults(payload);
  } catch (error) {
    elements.searchResults.innerHTML = `<p class="empty-state">${escapeHtml(
      playbackErrorMessage(error),
    )}</p>`;
  }
}

async function playMedia(item) {
  if (!item?.uri) return;
  const isContext = item.type === "album" || item.type === "playlist";
  const payload = isContext ? { context_uri: item.uri } : { uris: [item.uri] };
  const ok = await command(
    `/me/player/play${selectedDeviceQuery()}`,
    { method: "PUT", json: payload },
    `Playing ${item.name}.`,
  );
  if (ok) switchPanel("now");
}

async function queueMedia(item) {
  if (!item?.uri) return;
  await command(
    `/me/player/queue?uri=${encodeURIComponent(item.uri)}${selectedDeviceQuery().replace(
      "?",
      "&",
    )}`,
    { method: "POST" },
    `Added ${item.name} to the queue.`,
  );
}

async function playQueuePosition(steps, item) {
  if (!item?.uri || steps <= 0) {
    showToast("That item is already playing.");
    return;
  }
  if (state.queueJumping) {
    showToast("Already moving through the queue.");
    return;
  }

  state.queueJumping = true;
  elements.queueResults.classList.add("queue-busy");
  setConnection("", "Advancing");
  showToast(`Moving to ${item.name} in Spotify’s queue…`, 8000);

  try {
    for (let index = 0; index < steps; index += 1) {
      await spotifyApi(`/me/player/next${selectedDeviceQuery()}`, {
        method: "POST",
      });
      if (index < steps - 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 180));
      }
    }

    await new Promise((resolve) => window.setTimeout(resolve, 420));
    await loadPlayer();
    setConnection("online", "Online");
    showToast(`Playing ${item.name} .`);
    switchPanel("now");
  } catch (error) {
    setConnection("error", "Retry");
    showToast(playbackErrorMessage(error), 5200);
    await loadQueue();
  } finally {
    state.queueJumping = false;
    elements.queueResults.classList.remove("queue-busy");
  }
}

async function loadPlaylists() {
  elements.playlistResults.innerHTML = '<p class="empty-state">Loading playlists…</p>';
  try {
    const payload = await spotifyApi("/me/playlists?limit=50");
    renderMediaList(elements.playlistResults, (payload?.items || []).filter(Boolean), {
      empty: "No playlists found on this account.",
    });
  } catch (error) {
    elements.playlistResults.innerHTML = `<p class="empty-state">${escapeHtml(
      playbackErrorMessage(error),
    )}</p>`;
  }
}

async function loadSavedAlbums() {
  elements.albumResults.innerHTML = '<p class="empty-state">Loading saved albums…</p>';
  try {
    const payload = await spotifyApi("/me/albums?limit=50");
    const albums = (payload?.items || [])
      .map((entry) => entry?.album)
      .filter(Boolean);
    renderMediaList(elements.albumResults, albums, {
      empty: "No saved albums found on this account.",
    });
  } catch (error) {
    elements.albumResults.innerHTML = `<p class="empty-state">${escapeHtml(
      playbackErrorMessage(error),
    )}</p>`;
  }
}

function loadLibrary() {
  return Promise.all([loadSavedAlbums(), loadPlaylists()]);
}

function switchLibraryView(name) {
  const next = name === "playlists" ? "playlists" : "albums";
  state.libraryView = next;
  elements.librarySwitches.forEach((button) => {
    const selected = button.dataset.libraryTarget === next;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-selected", String(selected));
    button.tabIndex = selected ? 0 : -1;
  });
  elements.librarySections.forEach((section) => {
    section.hidden = section.dataset.librarySection !== next;
  });
}

async function loadQueue() {
  elements.queueResults.innerHTML = '<p class="empty-state">Loading queue…</p>';
  try {
    const payload = await spotifyApi("/me/player/queue");
    const items = [];
    if (payload?.currently_playing) items.push(payload.currently_playing);
    (payload?.queue || []).filter(Boolean).forEach((item) => items.push(item));
    renderMediaList(elements.queueResults, items, {
      empty: "The queue is empty.",
      queueOnly: true,
      currentIndex: payload?.currently_playing ? 0 : -1,
      queueAdvanceBase: payload?.currently_playing ? 0 : 1,
    });
  } catch (error) {
    elements.queueResults.innerHTML = `<p class="empty-state">${escapeHtml(
      playbackErrorMessage(error),
    )}</p>`;
  }
}

function showLyricsMessage(mode, title, subtitle, message = subtitle) {
  state.lyricsLines = [];
  state.activeLyricIndex = -1;
  elements.lyricsMode.textContent = mode;
  elements.lyricsTitle.textContent = title;
  elements.lyricsArtist.textContent = subtitle;
  elements.lyricsScroller.innerHTML = "";

  const paragraph = document.createElement("p");
  paragraph.className = "lyrics-empty";
  paragraph.textContent = message;
  elements.lyricsScroller.appendChild(paragraph);
  elements.lyricsScroller.scrollTop = 0;
}

function renderLyricsResult(item, result) {
  state.lyricsForUri = item.uri || "";
  state.lyricsLines = [];
  state.activeLyricIndex = -1;
  elements.lyricsTitle.textContent = item.name || "Lyrics";
  elements.lyricsArtist.textContent = mediaSubtitle(item) || "Spotify";
  elements.lyricsScroller.innerHTML = "";
  elements.lyricsScroller.scrollTop = 0;

  if (!result) {
    showLyricsMessage(
      "NOT FOUND",
      item.name || "Lyrics",
      mediaSubtitle(item) || "Spotify",
      "No lyrics were found for this track. Playback controls still work normally.",
    );
    return;
  }

  if (result.instrumental) {
    showLyricsMessage(
      "INSTRUMENTAL",
      item.name || "Instrumental track",
      mediaSubtitle(item) || "Spotify",
      "LRCLIB marks this track as instrumental.",
    );
    return;
  }

  const syncedLines = window.J2Lyrics.parseSyncedLyrics(result.syncedLyrics);
  if (syncedLines.length) {
    state.lyricsLines = syncedLines;
    elements.lyricsMode.textContent = "SYNCED";
    const fragment = document.createDocumentFragment();

    syncedLines.forEach((line, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "lyric-line synced";
      button.dataset.lyricIndex = String(index);
      button.textContent = line.text || "♪";
      button.setAttribute(
        "aria-label",
        `${line.text || "Instrumental break"} at ${formatTime(line.timeMs)}`,
      );
      button.addEventListener("click", () => seekToLyric(line.timeMs));
      fragment.appendChild(button);
    });

    elements.lyricsScroller.appendChild(fragment);
    updateLyricsHighlight(currentPlaybackProgressMs(), true);
    return;
  }

  const plainLyrics = String(result.plainLyrics || "").trim();
  if (plainLyrics) {
    elements.lyricsMode.textContent = "PLAIN";
    const fragment = document.createDocumentFragment();

    plainLyrics.split(/\r?\n/).forEach((text) => {
      const line = document.createElement("p");
      line.className = text.trim() ? "lyric-line plain" : "lyric-line plain gap";
      line.textContent = text.trim() || " ";
      fragment.appendChild(line);
    });

    elements.lyricsScroller.appendChild(fragment);
    return;
  }

  showLyricsMessage(
    "NOT FOUND",
    item.name || "Lyrics",
    mediaSubtitle(item) || "Spotify",
    "LRCLIB returned a record, but it did not contain displayable lyrics.",
  );
}

function updateLyricsHighlight(progressMs, forceScroll = false) {
  if (!state.lyricsOpen || !state.lyricsLines.length) return;

  let low = 0;
  let high = state.lyricsLines.length - 1;
  let activeIndex = -1;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (state.lyricsLines[middle].timeMs <= progressMs + 120) {
      activeIndex = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  if (activeIndex === state.activeLyricIndex && !forceScroll) return;
  state.activeLyricIndex = activeIndex;

  const lyricButtons = Array.from(
    elements.lyricsScroller.querySelectorAll("[data-lyric-index]"),
  );
  lyricButtons.forEach((button, index) => {
    const isActive = index === activeIndex;
    button.classList.toggle("active", isActive);
    button.classList.toggle("past", index < activeIndex);
    if (isActive) button.setAttribute("aria-current", "true");
    else button.removeAttribute("aria-current");
  });

  const activeButton = activeIndex >= 0 ? lyricButtons[activeIndex] : null;
  if (activeButton) {
    activeButton.scrollIntoView({
      behavior: forceScroll ? "auto" : "smooth",
      block: "center",
    });
  }
}

async function seekToLyric(positionMs) {
  if (!state.player?.item) return;
  const safePosition = Math.max(0, Math.round(positionMs));
  state.progressAtFetch = safePosition;
  state.fetchedAt = Date.now();
  updateProgressUi();

  await command(
    `/me/player/seek?position_ms=${safePosition}${selectedDeviceQuery().replace(
      "?",
      "&",
    )}`,
    { method: "PUT" },
  );
}

async function fetchLyricsRecord(item) {
  const artistName = item.artists?.[0]?.name || "";
  const albumName = item.album?.name || "";
  const duration = Math.max(1, Math.round((Number(item.duration_ms) || 0) / 1000));
  const target = {
    trackName: item.name || "",
    artistName,
    albumName,
    duration,
  };

  const exactParams = new URLSearchParams({
    track_name: target.trackName,
    artist_name: target.artistName,
    album_name: target.albumName,
    duration: String(target.duration),
  });
  const requestOptions = {
    headers: { Accept: "application/json" },
    credentials: "omit",
    referrerPolicy: "no-referrer",
  };

  const exactResponse = await fetch(
    `${LYRICS_API}/get?${exactParams.toString()}`,
    requestOptions,
  );
  if (exactResponse.ok) return exactResponse.json();
  if (exactResponse.status === 429) {
    throw new Error("The lyrics service is busy. Wait a moment and press Reload.");
  }

  const searchParams = new URLSearchParams({
    track_name: target.trackName,
    artist_name: target.artistName,
  });
  const searchResponse = await fetch(
    `${LYRICS_API}/search?${searchParams.toString()}`,
    requestOptions,
  );
  if (searchResponse.status === 404) return null;
  if (searchResponse.status === 429) {
    throw new Error("The lyrics service is busy. Wait a moment and press Reload.");
  }
  if (!searchResponse.ok) {
    throw new Error(`Lyrics request failed (${searchResponse.status}).`);
  }

  const candidates = await searchResponse.json();
  return window.J2Lyrics.chooseBestResult(candidates, target);
}

async function loadLyricsForCurrentTrack(force = false) {
  const item = state.player?.item;
  if (!item) {
    showLyricsMessage(
      "NOT PLAYING",
      "Lyrics",
      "Start a music track on the PC, then reload this tab.",
    );
    return;
  }

  if (item.type !== "track") {
    showLyricsMessage(
      "UNAVAILABLE",
      item.name || "Lyrics",
      mediaSubtitle(item) || "Spotify",
      "Automatic lyrics are available for music tracks, not podcast episodes.",
    );
    return;
  }

  const uri = item.uri || `${item.name}:${mediaSubtitle(item)}`;
  state.lyricsForUri = uri;

  if (!force && state.lyricsCache.has(uri)) {
    renderLyricsResult(item, state.lyricsCache.get(uri));
    return;
  }

  const requestSerial = ++state.lyricsRequestSerial;
  showLyricsMessage(
    "LOADING",
    item.name || "Lyrics",
    mediaSubtitle(item) || "Spotify",
    "Looking for synchronized lyrics…",
  );
  state.lyricsForUri = uri;

  try {
    const result = await fetchLyricsRecord(item);
    if (
      requestSerial !== state.lyricsRequestSerial ||
      state.player?.item?.uri !== item.uri
    ) {
      return;
    }
    state.lyricsCache.set(uri, result);
    renderLyricsResult(item, result);
  } catch (error) {
    if (requestSerial !== state.lyricsRequestSerial) return;
    showLyricsMessage(
      "RETRY",
      item.name || "Lyrics",
      mediaSubtitle(item) || "Spotify",
      error.message || "Could not reach the lyrics service. Check internet and reload.",
    );
  }
}

function openLyricsSheet() {
  if (state.currentPanel !== "now" || !elements.appView || elements.appView.hidden) {
    return;
  }

  window.clearTimeout(state.lyricsCloseTimer);
  state.lyricsOpen = true;
  elements.lyricsPanel.hidden = false;
  elements.lyricsBackdrop.hidden = false;
  elements.lyricsPanel.setAttribute("aria-hidden", "false");

  window.requestAnimationFrame(() => {
    elements.lyricsPanel.classList.add("open");
    elements.lyricsBackdrop.classList.add("open");
  });

  loadLyricsForCurrentTrack();
}

function closeLyricsSheet(immediate = false) {
  if (!elements.lyricsPanel) return;

  state.lyricsOpen = false;
  elements.lyricsPanel.classList.remove("open");
  elements.lyricsBackdrop.classList.remove("open");
  elements.lyricsPanel.setAttribute("aria-hidden", "true");
  window.clearTimeout(state.lyricsCloseTimer);

  const finish = () => {
    if (state.lyricsOpen) return;
    elements.lyricsPanel.hidden = true;
    elements.lyricsBackdrop.hidden = true;
  };

  if (immediate) finish();
  else state.lyricsCloseTimer = window.setTimeout(finish, 240);
}

function isVerticalSwipe(
  startX,
  startY,
  endX,
  endY,
  direction,
  minimumDistance = 58,
) {
  const deltaX = endX - startX;
  const deltaY = endY - startY;
  const verticalDistance = Math.abs(deltaY);
  if (
    verticalDistance < minimumDistance ||
    verticalDistance < Math.abs(deltaX) * 0.9
  ) {
    return false;
  }
  return direction === "up" ? deltaY < 0 : deltaY > 0;
}

function bindLyricsGestures() {
  let nowStart = null;
  let sheetStart = null;

  elements.nowPanel.addEventListener(
    "touchstart",
    (event) => {
      const touch = event.changedTouches[0];
      const slider = event.target.closest('input[type="range"]');
      nowStart = slider
        ? null
        : { x: touch.clientX, y: touch.clientY, triggered: false };
    },
    { passive: true },
  );

  elements.nowPanel.addEventListener(
    "touchmove",
    (event) => {
      if (!nowStart) return;
      const touch = event.changedTouches[0];
      if (
        isVerticalSwipe(
          nowStart.x,
          nowStart.y,
          touch.clientX,
          touch.clientY,
          "up",
          24,
        )
      ) {
        nowStart.triggered = true;
        event.preventDefault();
      }
    },
    { passive: false },
  );

  elements.nowPanel.addEventListener(
    "touchend",
    (event) => {
      if (!nowStart) return;
      const touch = event.changedTouches[0];
      if (
        nowStart.triggered ||
        isVerticalSwipe(
          nowStart.x,
          nowStart.y,
          touch.clientX,
          touch.clientY,
          "up",
          28,
        )
      ) {
        openLyricsSheet();
      }
      nowStart = null;
    },
    { passive: true },
  );

  elements.nowPanel.addEventListener(
    "touchcancel",
    () => {
      nowStart = null;
    },
    { passive: true },
  );

  elements.lyricsPanel.addEventListener(
    "touchstart",
    (event) => {
      const touch = event.changedTouches[0];
      sheetStart = { x: touch.clientX, y: touch.clientY };
    },
    { passive: true },
  );

  elements.lyricsPanel.addEventListener(
    "touchend",
    (event) => {
      if (!sheetStart) return;
      const touch = event.changedTouches[0];
      const canClose =
        elements.lyricsScroller.scrollTop <= 4 ||
        event.target.closest(".sheet-grabber, .lyrics-heading");
      if (
        canClose &&
        isVerticalSwipe(sheetStart.x, sheetStart.y, touch.clientX, touch.clientY, "down")
      ) {
        closeLyricsSheet();
      }
      sheetStart = null;
    },
    { passive: true },
  );
}

function switchPanel(name) {
  if (name !== "now") closeLyricsSheet();
  state.currentPanel = name;
  $$("[data-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.panel !== name;
  });
  $$(".nav-button").forEach((button) => {
    const selected = button.dataset.target === name;
    button.classList.toggle("active", selected);
    if (selected) {
      try {
        button.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
      } catch {
        button.scrollIntoView(false);
      }
    }
  });

  if (name === "library") loadLibrary();
  if (name === "queue") loadQueue();
  if (name === "search") window.setTimeout(() => elements.searchInput.focus(), 80);
}

function openModal(modal) {
  modal.hidden = false;
  const close = modal.querySelector(".modal-close");
  close?.focus();
}

function closeModal(modal) {
  modal.hidden = true;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    showToast("Copied.");
  } catch {
    const temporary = document.createElement("textarea");
    temporary.value = text;
    temporary.style.position = "fixed";
    temporary.style.opacity = "0";
    document.body.appendChild(temporary);
    temporary.select();
    document.execCommand("copy");
    temporary.remove();
    showToast("Copied.");
  }
}

async function requestWakeLock() {
  if (!("wakeLock" in navigator)) {
    elements.wakeStatus.textContent =
      "Unavailable in this Chrome version — use the phone's display timeout setting.";
    return;
  }

  try {
    if (state.wakeLock) return;
    state.wakeLock = await navigator.wakeLock.request("screen");
    elements.wakeStatus.textContent = "Active while this controller is visible";
    state.wakeLock.addEventListener("release", () => {
      state.wakeLock = null;
      elements.wakeStatus.textContent = "Released — tap the app to activate it again";
    });
  } catch {
    elements.wakeStatus.textContent =
      "Blocked by Chrome — use the phone's display timeout setting";
  }
}

function showDisconnected(message = "") {
  window.clearInterval(state.pollingTimer);
  window.clearInterval(state.clockTimer);
  elements.appView.hidden = false;
  elements.clientIdSettingsInput.value = getClientId();
  elements.connectSpotifyButton.disabled = false;
  elements.connectSpotifyButton.textContent = "Connect Spotify";
  setConnection("error", "Not connected");
  closeLyricsSheet(true);
  switchPanel("settings");
  if (message) showToast(message, 5000);
}

function showApp() {
  elements.appView.hidden = false;
  elements.clientIdSettingsInput.value = getClientId();
  elements.connectSpotifyButton.disabled = false;
  elements.connectSpotifyButton.textContent = "Reconnect Spotify";
  elements.deviceName.textContent =
    localStorage.getItem(KEYS.deviceName) || "Choose PC";
  setConnection("", "Connecting");
  schedulePolling();
  requestWakeLock();
  loadPlayer();
}

function disconnect(resetAll = false) {
  clearTokens();
  if (resetAll) {
    localStorage.removeItem(KEYS.clientId);
    localStorage.removeItem(KEYS.deviceId);
    localStorage.removeItem(KEYS.deviceName);
  }
  state.player = null;
  state.currentUri = "";
  elements.clientIdSettingsInput.value = getClientId();
  showDisconnected(
    resetAll ? "Controller setup erased." : "Disconnected from Spotify.",
  );
}

function saveClientId() {
  const nextClientId = elements.clientIdSettingsInput.value.trim();
  if (!/^[A-Za-z0-9]{20,80}$/.test(nextClientId)) {
    showToast("That does not look like a valid Spotify Client ID.");
    return;
  }

  const changed = nextClientId !== getClientId();
  if (nextClientId === DEFAULT_CLIENT_ID) {
    localStorage.removeItem(KEYS.clientId);
  } else {
    localStorage.setItem(KEYS.clientId, nextClientId);
  }

  elements.clientIdSettingsInput.value = getClientId();
  if (changed) {
    clearTokens();
    elements.connectSpotifyButton.textContent = "Connect Spotify";
    setConnection("error", "Reconnect required");
    showToast("Client ID saved. Tap Connect Spotify.");
  } else {
    showToast("Client ID is already saved.");
  }
}

function installedDisplayMode() {
  return Boolean(
    window.matchMedia?.("(display-mode: standalone)").matches ||
      window.matchMedia?.("(display-mode: fullscreen)").matches ||
      window.navigator.standalone,
  );
}

function requestInstalledFullscreen() {
  if (!installedDisplayMode() || document.fullscreenElement) return;
  const root = document.documentElement;
  const request = root.requestFullscreen || root.webkitRequestFullscreen;
  if (!request) return;
  try {
    const result = request.call(root);
    result?.catch?.(() => {});
  } catch {
    // The fullscreen manifest still handles supported installed-app launches.
  }
}

function bindEvents() {
  elements.connectSpotifyButton.addEventListener("click", beginAuthorization);
  elements.saveClientIdButton.addEventListener("click", saveClientId);
  elements.copySettingsRedirect.addEventListener("click", () => copyText(redirectUri));
  elements.refreshButton.addEventListener("click", loadPlayer);

  elements.deviceButton.addEventListener("click", () => {
    openModal(elements.deviceModal);
    loadDevices();
  });
  elements.reloadDevicesButton.addEventListener("click", () => loadDevices());
  elements.reloadLibraryButton.addEventListener("click", loadLibrary);
  elements.reloadQueueButton.addEventListener("click", loadQueue);
  elements.reloadLyricsButton.addEventListener("click", () =>
    loadLyricsForCurrentTrack(true),
  );
  elements.lyricsSheetClose.addEventListener("click", () => closeLyricsSheet());
  elements.lyricsBackdrop.addEventListener("click", () => closeLyricsSheet());
  elements.librarySwitches.forEach((button) => {
    button.addEventListener("click", () =>
      switchLibraryView(button.dataset.libraryTarget),
    );
  });
  bindLyricsGestures();

  $$(".modal-close").forEach((button) => {
    button.addEventListener("click", () => closeModal(button.closest(".modal-backdrop")));
  });
  $$(".modal-backdrop").forEach((backdrop) => {
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) closeModal(backdrop);
    });
  });

  elements.playButton.addEventListener("click", togglePlay);
  elements.previousButton.addEventListener("click", () =>
    command(`/me/player/previous${selectedDeviceQuery()}`, { method: "POST" }),
  );
  elements.nextButton.addEventListener("click", () =>
    command(`/me/player/next${selectedDeviceQuery()}`, { method: "POST" }),
  );
  elements.seekSlider.addEventListener("input", () => {
    rangeFill(elements.seekSlider, Number(elements.seekSlider.value) / 10);
    const duration = Number(state.player?.item?.duration_ms) || 0;
    const position = (Number(elements.seekSlider.value) / 1000) * duration;
    elements.elapsedTime.textContent = formatTime(position);
    elements.remainingTime.textContent = `−${formatTime(duration - position)}`;
  });
  elements.seekSlider.addEventListener("change", seekPlayback);
  elements.volumeSlider.addEventListener("input", changeVolumePreview);
  elements.shuffleButton.addEventListener("click", toggleShuffle);
  elements.repeatButton.addEventListener("click", cycleRepeat);
  elements.saveButton.addEventListener("click", toggleSavedCurrent);
  elements.searchForm.addEventListener("submit", searchSpotify);

  $$(".nav-button").forEach((button) => {
    button.addEventListener("click", () => switchPanel(button.dataset.target));
  });

  elements.disconnectButton.addEventListener("click", () => disconnect(false));
  elements.resetButton.addEventListener("click", () => {
    if (
      window.confirm(
        "Erase Spotify tokens, selected device, and any Client ID override?",
      )
    ) {
      disconnect(true);
    }
  });

  document.addEventListener("pointerup", requestInstalledFullscreen, {
    once: true,
    passive: true,
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.lyricsOpen) closeLyricsSheet();
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      requestInstalledFullscreen();
      requestWakeLock();
      loadPlayer();
    }
  });

  window.addEventListener("online", () => {
    setConnection("", "Connecting");
    loadPlayer();
  });
  window.addEventListener("offline", () => setConnection("error", "Offline"));
}

async function initialize() {
  elements.settingsRedirect.textContent = redirectUri;
  elements.clientIdSettingsInput.value = getClientId();
  switchLibraryView(state.libraryView);
  bindEvents();

  if ("serviceWorker" in navigator && window.isSecureContext) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }

  const params = new URLSearchParams(window.location.search);
  const authError = params.get("error");
  const code = params.get("code");
  const returnedState = params.get("state");

  if (authError) {
    window.history.replaceState({}, document.title, redirectUri);
    showDisconnected(`Spotify login was not completed: ${authError}`);
    return;
  }

  if (code) {
    elements.connectSpotifyButton.disabled = true;
    elements.connectSpotifyButton.textContent = "Finishing login…";
    try {
      await exchangeAuthorizationCode(code, returnedState);
      showApp();
    } catch (error) {
      clearTokens();
      window.history.replaceState({}, document.title, redirectUri);
      showDisconnected(error.message || "Spotify login failed.");
    }
    return;
  }

  if (hasSession()) {
    showApp();
  } else {
    showDisconnected();
  }
}

initialize();
