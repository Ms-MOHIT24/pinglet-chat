const $ = (s) => document.querySelector(s);
let token = localStorage.getItem("pinglet_token"), me = null, peer = null, socket = null;
let mode = "create", friends = [], privateKey = null, pendingSnakeInvite = null;
let callCode = null, callMode = null, callStream = null, callPeers = new Map(), callTiles = new Map(), callBusy = false;
let snakePeerId = null, snakeState = null, activeFriendFilter = "all", sparkIndex = 0;
let qrStream = null, qrFrameId = 0, qrLastFrameAt = 0, qrFrameBusy = false;
let qrDetector = null, qrTrack = null, qrTorchOn = false, pendingScannedCode = null;
let rpsWins = Number(localStorage.getItem("pinglet_rps_wins") || 0);
let rpsRounds = Number(localStorage.getItem("pinglet_rps_rounds") || 0);
const encoder = new TextEncoder(), decoder = new TextDecoder();
const chatKeyCache = new Map();
const voiceObjectUrls = new Set();
let voiceRecorder = null, voiceChunks = [], voiceStartedAt = 0, voiceAbort = false, voicePointerId = null, voicePointerHeld = false;
const inviteMatch = location.pathname.match(/^\/invite\/([a-f0-9]{14})\/?$/i);
if (inviteMatch) {
  sessionStorage.setItem("pinglet_pending_invite", inviteMatch[1].toUpperCase());
  history.replaceState({}, "", "/");
}

async function api(path, options = {}) {
  const response = await fetch("/api" + path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}), ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || "Something went wrong.");
    error.status = response.status;
    throw error;
  }
  return data;
}
function bytesToBase64(value) { return btoa(String.fromCharCode(...new Uint8Array(value))); }
function base64ToBytes(value) { return Uint8Array.from(atob(value), c => c.charCodeAt(0)); }

async function generateKeys() {
  return crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveKey"]);
}
async function exportPublicKey(key) { return crypto.subtle.exportKey("jwk", key); }
function openKeyDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("pinglet-keys", 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("keys")) request.result.createObjectStore("keys");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function savePrivateKey(key, userId) {
  if (!userId) throw new Error("Could not link the encryption key to this account.");
  const db = await openKeyDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("keys", "readwrite");
    tx.objectStore("keys").put(key, userId);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
    tx.onabort = () => { db.close(); reject(tx.error || new Error("Could not save the encryption key.")); };
  });
}
async function readPrivateKey(userId) {
  if (!userId) return null;
  const db = await openKeyDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("keys", "readwrite");
    const store = tx.objectStore("keys");
    let key = null;
    const current = store.get(userId);
    current.onsuccess = () => {
      if (current.result) {
        key = current.result;
        return;
      }
      // Migrate the older single-account key once, keeping existing demo accounts usable.
      const legacy = store.get("private");
      legacy.onsuccess = () => {
        if (legacy.result) {
          key = legacy.result;
          store.put(key, userId);
          store.delete("private");
        }
      };
    };
    tx.oncomplete = () => { db.close(); resolve(key); };
    tx.onerror = () => { db.close(); reject(tx.error); };
    tx.onabort = () => { db.close(); reject(tx.error || new Error("Could not read the encryption key.")); };
  });
}
async function deriveChatKey(friend) {
  if (chatKeyCache.has(friend.id)) return chatKeyCache.get(friend.id);
  const publicKey = await crypto.subtle.importKey("jwk", friend.pubkey, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const key = await crypto.subtle.deriveKey({ name: "ECDH", public: publicKey }, privateKey, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  chatKeyCache.set(friend.id, key);
  return key;
}
async function encryptMessage(text, friend) {
  const key = await deriveChatKey(friend), iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(text));
  return { ciphertext: bytesToBase64(encrypted), iv: bytesToBase64(iv) };
}
async function decryptMessage(message, friend) {
  try {
    const key = await deriveChatKey(friend);
    const clear = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(message.iv) }, key, base64ToBytes(message.ciphertext));
    return decoder.decode(clear);
  } catch { return "Unable to decrypt this message on this device."; }
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}
function toast(message) {
  let node = $("#toast");
  if (!node) {
    node = document.createElement("div"); node.id = "toast"; node.className = "toast";
    document.body.appendChild(node);
  }
  node.textContent = message; node.classList.add("show");
  clearTimeout(toast.timer); toast.timer = setTimeout(() => node.classList.remove("show"), 3200);
}
function setConnectionStatus(label, connected) {
  const node = $("#connectionStatus");
  if (!node) return;
  node.classList.toggle("is-connected", !!connected);
  node.classList.toggle("is-offline", !connected);
  node.innerHTML = '<i></i><span>' + escapeHtml(label) + '</span>';
}
function show(view) {
  if (view !== "chat" && voicePointerHeld) { voicePointerHeld = false; cancelVoiceMessage(); }
  ["welcome", "chat", "games", "callRooms"].forEach(id => $("#" + id).classList.toggle("hidden", id !== (view === "rooms" ? "callRooms" : view)));
  document.body.dataset.view = view;
  const activeNav = view === "games" ? "gamesNav" : view === "rooms" ? "roomsNav" : "homeNav";
  ["homeNav", "gamesNav", "roomsNav"].forEach(id => $("#" + id).classList.toggle("active", id === activeNav));
  $("#requests").classList.remove("mobile-open");
  $("#requestsNav").setAttribute("aria-expanded", "false");
  const panel = $("#" + (view === "rooms" ? "callRooms" : view));
  panel.classList.remove("view-enter");
  void panel.offsetWidth;
  panel.classList.add("view-enter");
  panel.addEventListener("animationend", () => panel.classList.remove("view-enter"), { once: true });
  if (view === "games") drawSnake();
}
function setAuthTab(next) {
  mode = next;
  document.querySelectorAll(".tab").forEach(button => button.classList.toggle("active", button.dataset.tab === next));
  $("#nameWrap").classList.toggle("hidden", next === "login");
  $("#codeWrap").classList.toggle("hidden", next !== "login");
  $("#name").required = next !== "login";
  $("#code").required = next === "login";
  $("#authSubmit").textContent = next === "login" ? "Sign in →" : "Create my space →";
  $("#authHint").textContent = next === "login" ? "Use your friend code and password." : "Your unique friend code is created automatically.";
}
document.querySelectorAll(".tab").forEach(button => button.addEventListener("click", () => setAuthTab(button.dataset.tab)));

$("#authForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("#authError").textContent = "";
  $("#authSubmit").disabled = true;
  try {
    if (mode === "create") {
      const pair = await generateKeys();
      const pubkey = await exportPublicKey(pair.publicKey);
      const data = await api("/register", { method: "POST", body: JSON.stringify({ name: $("#name").value, password: $("#password").value, pubkey }) });
      await savePrivateKey(pair.privateKey, data.user.id);
      privateKey = pair.privateKey;
      await finishLogin(data);
    } else {
      const data = await api("/login", { method: "POST", body: JSON.stringify({ code: $("#code").value, password: $("#password").value }) });
      privateKey = await readPrivateKey(data.user.id);
      if (!privateKey) {
        $("#authError").textContent = "This browser has no saved encryption key for this account. Device recovery is not available in this demo.";
        return;
      }
      await finishLogin(data);
    }
  } catch (error) { $("#authError").textContent = error.message; }
  finally { $("#authSubmit").disabled = false; }
});
async function finishLogin(data) {
  token = data.token; me = data.user;
  localStorage.setItem("pinglet_token", token);
  await boot();
}
async function boot() {
  try {
    const data = await api("/me");
    me = data.user;
    privateKey = privateKey || await readPrivateKey(me.id);
    if (!privateKey) throw new Error("Encryption key missing on this browser. Sign in on the browser where you created the account.");
    $("#auth").classList.add("hidden");
    $("#workspace").classList.remove("hidden");
    $("#myName").textContent = me.name;
    $("#myCode").textContent = me.code;
    $("#myAvatar").textContent = me.name.charAt(0).toUpperCase();
    if (socket) socket.disconnect();
    socket = io({ auth: { token } });
    socket.on("message", async message => {
      if (peer && (message.sender === peer.id || message.recipient === peer.id)) await loadMessages();
    });
    socket.on("friend-request", async () => { await loadRequests(); toast("You have a new friend request."); });
    socket.on("friendship", async () => { await loadFriends(); await loadRequests(); toast("A new friend was added to your circle."); });
    socket.on("connect_error", () => {
      $("#contextEyebrow").textContent = "RECONNECTING";
      setConnectionStatus("Reconnecting", false);
    });
    socket.on("connect", () => {
      if (peer) $("#contextEyebrow").textContent = "YOUR CONVERSATION";
      setConnectionStatus("Connected", true);
    });
    socket.on("disconnect", () => {
      setConnectionStatus("Offline", false);
      if (callCode) { resetCallUi(); toast("Your call disconnected. Rejoin with the room code."); }
    });
    socket.on("snake:invite", payload => {
      if (payload.fromId === me.id) return;
      pendingSnakeInvite = payload.fromId;
      $("#snakeInviteText").textContent = (payload.fromName || "Your friend") + " invited you to Snake Duel.";
      $("#snakeInviteBanner").classList.remove("hidden");
    });
    socket.on("snake:state", state => { snakeState = state; updateSnakeUI(); });
    socket.on("snake:error", err => toast(err.message || "Snake Duel error."));

    socket.on("call:participant-joined", person => {
      if (!callCode || !person || !person.peerId) return;
      createCallPeer(person.peerId, person.name || "A Pinglet friend", false).catch(error => {
        console.warn("Could not prepare call connection:", error);
        setCallStatus("Couldn't connect to " + (person.name || "a participant") + ".");
      });
      setCallStatus((person.name || "Someone") + " joined · " + (1 + callPeers.size) + "/4 here");
    });
    socket.on("call:participant-left", person => removeCallPeer(person && person.peerId));
    socket.on("call:signal", payload => handleCallSignal(payload).catch(error => {
      console.warn("Call signaling error:", error);
      setCallStatus("A connection hiccup happened. Try rejoining the room.");
    }));
    socket.on("call:reaction", payload => showCallReaction(payload));
    await loadFriends();
    await loadRequests();
    await processPendingInvite();
    updateSnakeUI();
  } catch (error) {
    // Keep a valid session during a temporary network/database outage.
    if (error.status === 401 || error.status === 404) {
      localStorage.removeItem("pinglet_token");
      token = null;
    }
    $("#auth").classList.remove("hidden");
    $("#workspace").classList.add("hidden");
    $("#authError").textContent = error.message;
  }
}
async function processPendingInvite() {
  const code = sessionStorage.getItem("pinglet_pending_invite");
  if (!code) return;
  try {
    const result = await api("/friend-requests", { method: "POST", body: JSON.stringify({ code }) });
    sessionStorage.removeItem("pinglet_pending_invite");
    if (result.status === "friends") {
      await loadFriends();
      toast("You're already friends with " + result.friend.name + ".");
      const saved = friends.find(f => f.id === result.friend.id);
      if (saved) await openPeer(saved);
    } else {
      toast("Friend request sent to " + result.friend.name + "!");
      await loadRequests();
    }
  } catch (error) { toast("Invite could not be used: " + error.message); }
}
async function loadFriends() {
  const data = await api("/friends");
  friends = data.friends || [];
  renderFriends();
  if (peer) {
    const updated = friends.find(f => f.id === peer.id);
    if (updated) {
      peer = updated;
      $("#peerTag").textContent = updated.label || "Friend";
    } else {
      peer = null; show("welcome");
    }
  }
  updateSnakeUI();
}
async function loadRequests() {
  const data = await api("/friend-requests");
  renderRequests(data.incoming || [], data.outgoing || []);
}
function renderFriends() {
  const list = $("#friends");
  const query = ($("#friendSearch")?.value || "").trim().toLowerCase();
  list.replaceChildren();
  if (!friends.length) {
    list.innerHTML = '<p class="empty">Your circle starts here.<br>Add someone using their code or QR.</p>';
    updateWelcomeStats();
    return;
  }
  const visibleFriends = friends.filter(friend => {
    const matchesQuery = friend.name.toLowerCase().includes(query) ||
      friend.code.toLowerCase().includes(query) || (friend.label || "").toLowerCase().includes(query);
    const isSpecial = !!friend.label && friend.label !== "Friend";
    return matchesQuery && (activeFriendFilter === "all" || isSpecial);
  });
  if (!visibleFriends.length) {
    const empty = document.createElement("p");
    empty.className = "empty search-empty";
    empty.textContent = activeFriendFilter === "special"
      ? "No close-circle labels yet. Give someone a special label ✨"
      : "No friends match “" + query + "”.";
    list.appendChild(empty);
    updateWelcomeStats();
    return;
  }
  visibleFriends.forEach(friend => {
    const button = document.createElement("button");
    button.className = "friend" + (peer && peer.id === friend.id ? " active" : "");
    button.title = friend.name;
    button.setAttribute("aria-label", "Open chat with " + friend.name);
    button.setAttribute("aria-current", peer && peer.id === friend.id ? "page" : "false");
    button.innerHTML = '<span class="avatar">' + escapeHtml(friend.name.charAt(0).toUpperCase()) +
      '</span><span><b>' + escapeHtml(friend.name) + '</b><small>' + escapeHtml(friend.code) +
      '</small></span><span class="tag">' + escapeHtml(friend.label || "Friend") + '</span>';
    button.addEventListener("click", () => openPeer(friend));
    list.appendChild(button);
  });
  updateWelcomeStats();
}
function updateWelcomeStats() {
  $("#circleStat").textContent = String(friends.length);
  $("#requestsStat").textContent = $("#requestCount").textContent || "0";
}
function renderRequests(incoming, outgoing) {
  const list = $("#requests");
  list.innerHTML = "";
  $("#requestCount").textContent = String(incoming.length);
  $("#requestsNavCount").textContent = String(incoming.length);
  $("#requestsNavCount").classList.toggle("hidden", incoming.length === 0);
  updateWelcomeStats();
  if (!incoming.length && !outgoing.length) {
    list.innerHTML = '<p class="empty">No new requests.</p>';
    return;
  }
  incoming.forEach(request => {
    const item = document.createElement("div");
    item.className = "request-item";
    const name = document.createElement("b"); name.textContent = request.name;
    const code = document.createElement("small"); code.textContent = request.code + " wants to connect";
    const actions = document.createElement("div"); actions.className = "request-actions";
    const accept = document.createElement("button"); accept.className = "mini-accept"; accept.textContent = "Accept";
    accept.addEventListener("click", async () => {
      accept.disabled = true;
      try {
        await api("/friend-requests/" + request.id + "/accept", { method: "POST", body: "{}" });
        await loadFriends(); await loadRequests(); toast(request.name + " is now saved in your friends.");
      } catch (error) { toast(error.message); accept.disabled = false; }
    });
    const decline = document.createElement("button"); decline.className = "mini-decline"; decline.textContent = "×";
    decline.title = "Decline request";
    decline.addEventListener("click", async () => {
      try { await api("/friend-requests/" + request.id + "/decline", { method: "POST", body: "{}" }); await loadRequests(); }
      catch (error) { toast(error.message); }
    });
    actions.append(accept, decline); item.append(name, code, actions); list.appendChild(item);
  });
  outgoing.forEach(request => {
    const item = document.createElement("div"); item.className = "request-item outgoing";
    const name = document.createElement("b"); name.textContent = request.name;
    const code = document.createElement("small"); code.textContent = "Request sent · waiting";
    item.append(name, code); list.appendChild(item);
  });
}
async function openPeer(friend) {
  if (peer && peer.id !== friend.id && voicePointerHeld) { voicePointerHeld = false; cancelVoiceMessage(); }
  peer = friend;
  $("#contextEyebrow").textContent = "YOUR CONVERSATION";
  $("#contextTitle").textContent = "A little hello to " + friend.name + ".";
  $("#peerName").textContent = friend.name;
  $("#peerCode").textContent = friend.code;
  $("#peerAvatar").textContent = friend.name.charAt(0).toUpperCase();
  $("#peerTag").textContent = friend.label || "Friend";
  show("chat");
  renderFriends();
  await loadMessages();
  updateSnakeUI();
}
async function loadMessages() {
  if (!peer) return;
  const activePeer = peer;
  try {
    const data = await api("/messages/" + activePeer.id);
    const rendered = await Promise.all((data.messages || []).map(async message => {
      const bubble = document.createElement("div");
      bubble.className = "bubble " + (message.sender === me.id ? "mine" : "theirs");
      const clear = await decryptMessage(message, activePeer);
      if (clear.startsWith("PINGLET_VOICE_V1|")) {
        const parts = clear.split("|");
        const mime = parts[1] || "audio/webm";
        const bytes = base64ToBytes(parts.slice(2).join("|"));
        const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
        voiceObjectUrls.add(url);
        const audio = document.createElement("audio");
        audio.controls = true;
        audio.preload = "metadata";
        audio.src = url;
        audio.className = "voice-message-player";
        const label = document.createElement("span");
        label.className = "voice-message-label";
        label.textContent = "🎙 Voice message";
        bubble.append(label, audio);
      } else {
        bubble.textContent = clear;
      }
      const time = document.createElement("time");
      time.textContent = new Date(message.created).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      bubble.appendChild(time);
      return bubble;
    }));
    // A slower response for the previous chat must not overwrite the newly opened chat.
    if (!peer || peer.id !== activePeer.id) return;
    const list = $("#messages");
    voiceObjectUrls.forEach(url => URL.revokeObjectURL(url));
    voiceObjectUrls.clear();
    list.replaceChildren();
    if (!rendered.length) {
      const empty = document.createElement("p");
      empty.className = "empty chat-empty";
      empty.textContent = "No messages yet. Send the first hello.";
      list.appendChild(empty);
    } else {
      list.append(...rendered);
    }
    list.scrollTop = list.scrollHeight;
  } catch (error) { toast(error.message); }
}
$("#sendForm").addEventListener("submit", async event => {
  event.preventDefault();
  const messageText = $("#messageInput").value.trim();
  const activePeer = peer;
  if (!messageText || !activePeer) return;
  const sendButton = $("#sendForm").querySelector("button[type='submit']");
  sendButton.disabled = true;
  try {
    const encrypted = await encryptMessage(messageText, activePeer);
    await api("/messages", { method: "POST", body: JSON.stringify({ recipient: activePeer.id, ...encrypted }) });
    if (peer && peer.id === activePeer.id) {
      if ($("#messageInput").value.trim() === messageText) $("#messageInput").value = "";
      await loadMessages();
    }
  } catch (error) { toast(error.message); }
  finally { sendButton.disabled = false; }
});
/* Walkie-talkie voice messages are encrypted before storage and limited to short clips. */
const voiceMaxDurationMs = 8000;
const voiceMaxBytes = 30 * 1024;
function voiceMimeType() {
  if (!window.MediaRecorder) throw new Error("Voice recording isn't supported in this browser.");
  const choices = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  if (typeof MediaRecorder.isTypeSupported !== "function") return "";
  return choices.find(type => MediaRecorder.isTypeSupported(type)) || "";
}
async function beginVoiceMessage(event) {
  if (voiceRecorder || !peer) return;
  const recordingPeer = peer;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    toast("Microphone access isn't available. Open Pinglet over HTTPS in a supported browser.");
    return;
  }
  let recordingStream = null;
  try {
    voiceAbort = false;
    voicePointerId = event && event.pointerId !== undefined ? event.pointerId : null;
    recordingStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
    const stream = recordingStream;
    if (!voicePointerHeld || !peer || peer.id !== recordingPeer.id || $("#chat").classList.contains("hidden")) {
      stream.getTracks().forEach(track => track.stop());
      return;
    }
    const mimeType = voiceMimeType();
    voiceChunks = [];
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType, audioBitsPerSecond: 24000 } : { audioBitsPerSecond: 24000 });
    voiceRecorder = recorder;
    voiceStartedAt = Date.now();
    const button = $("#walkieTalkie");
    button.classList.add("recording");
    button.querySelector("small").textContent = "RECORDING · RELEASE TO SEND";
    recorder.ondataavailable = item => { if (item.data && item.data.size) voiceChunks.push(item.data); };
    recorder.onerror = () => { voiceAbort = true; if (voiceRecorder === recorder) finishVoiceMessage(); };
    recorder.onstop = async () => {
      const blob = new Blob(voiceChunks, { type: recorder.mimeType || mimeType || "audio/webm" });
      stream.getTracks().forEach(track => track.stop());
      if (voiceRecorder === recorder) voiceRecorder = null;
      voiceChunks = [];
      button.classList.remove("recording");
      button.querySelector("small").textContent = "HOLD TO TALK";
      if (voiceAbort) { toast("Voice recording cancelled."); return; }
      if (blob.size < 500) { toast("That voice message was too short. Try again."); return; }
      if (blob.size > voiceMaxBytes) { toast("That clip is too large. Try recording a shorter voice message."); return; }
      const activePeer = recordingPeer;
      if (!peer || peer.id !== activePeer.id) { toast("Voice clip discarded because you switched chats."); return; }
      button.disabled = true;
      try {
        const bytes = await blob.arrayBuffer();
        const payload = "PINGLET_VOICE_V1|" + (blob.type || "audio/webm") + "|" + bytesToBase64(bytes);
        const encrypted = await encryptMessage(payload, activePeer);
        await api("/messages", { method: "POST", body: JSON.stringify({ recipient: activePeer.id, ...encrypted }) });
        if (peer && peer.id === activePeer.id) await loadMessages();
      } catch (error) { toast(error.message || "Could not send that voice message."); }
      finally { button.disabled = false; }
    };
    recorder.start(250);
    setTimeout(() => { if (voiceRecorder === recorder && recorder.state === "recording") finishVoiceMessage(); }, voiceMaxDurationMs);
  } catch (error) {
    if (recordingStream) recordingStream.getTracks().forEach(track => track.stop());
    voiceRecorder = null;
    const button = $("#walkieTalkie");
    button.classList.remove("recording");
    button.querySelector("small").textContent = "HOLD TO TALK";
    toast(error.name === "NotAllowedError" ? "Allow microphone access to send a voice message." : (error.message || "Could not start voice recording."));
  }
}
function finishVoiceMessage() {
  if (!voiceRecorder || voiceRecorder.state === "inactive") return;
  try { voiceRecorder.stop(); } catch { voiceRecorder = null; }
}
function cancelVoiceMessage() {
  voiceAbort = true;
  if (!voiceRecorder) return;
  finishVoiceMessage();
}
const walkieButton = $("#walkieTalkie");
walkieButton.addEventListener("pointerdown", event => {
  if (event.button !== undefined && event.button !== 0) return;
  event.preventDefault();
  voicePointerHeld = true;
  try { walkieButton.setPointerCapture(event.pointerId); } catch {}
  beginVoiceMessage(event);
});
walkieButton.addEventListener("pointerup", event => {
  if (voicePointerId !== null && event.pointerId !== voicePointerId) return;
  voicePointerHeld = false;
  voicePointerId = null;
  finishVoiceMessage();
});
walkieButton.addEventListener("pointercancel", () => { voicePointerHeld = false; voicePointerId = null; cancelVoiceMessage(); });
walkieButton.addEventListener("lostpointercapture", () => {
  if (voiceRecorder && voiceRecorder.state === "recording") finishVoiceMessage();
});
walkieButton.addEventListener("keydown", event => {
  if ((event.code === "Space" || event.code === "Enter") && !event.repeat) {
    event.preventDefault();
    voicePointerHeld = true;
    beginVoiceMessage(null);
  }
});
walkieButton.addEventListener("keyup", event => {
  if (event.code === "Space" || event.code === "Enter") {
    event.preventDefault();
    voicePointerHeld = false;
    finishVoiceMessage();
  }
});
walkieButton.addEventListener("contextmenu", event => event.preventDefault());

async function copyText(value) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const field = document.createElement("textarea");
  field.value = value;
  field.setAttribute("readonly", "");
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.appendChild(field);
  field.select();
  const copied = document.execCommand("copy");
  field.remove();
  if (!copied) throw new Error("Clipboard access is unavailable.");
}
$("#copyCode").addEventListener("click", async () => {
  try { await copyText(me.code); toast("Friend code copied."); }
  catch { toast("Your friend code is " + me.code); }
});
function showAddFriendModal() {
  $("#modal").classList.remove("hidden");
  $("#modalEyebrow").textContent = "GROW YOUR CIRCLE";
  $("#modalTitle").textContent = "Add a friend";
  $("#modalText").textContent = "Send a friend request using their unique 14-character code.";
  $("#modalForm").classList.remove("hidden");
  $("#qrShareContent").classList.add("hidden");
  $("#modalLabel").innerHTML = 'Friend code<input id="modalInput" placeholder="14-character code" maxlength="14" required>';
  $("#modalSubmit").textContent = "Send friend request →";
  $("#modalError").textContent = "";
  $("#modalForm").dataset.kind = "friend";
}
async function showQrModal() {
  $("#modal").classList.remove("hidden");
  $("#modalEyebrow").textContent = "SHARE YOUR PINGLET";
  $("#modalTitle").textContent = "Your personal QR";
  $("#modalText").textContent = "Friends can scan this to send you a friend request.";
  $("#modalForm").classList.add("hidden");
  $("#modalError").textContent = "";
  const content = $("#qrShareContent");
  content.classList.remove("hidden");
  content.innerHTML = '<p class="muted">Making your QR invite…</p>';
  try {
    const data = await api("/me/invite-qr");
    content.innerHTML = '<img class="invite-qr" alt="Your Pinglet friend invite QR code" src="' + data.qr + '">' +
      '<p class="qr-code-text">YOUR FRIEND CODE<br><strong>' + escapeHtml(me.code) + '</strong></p>' +
      '<p class="qr-link">' + escapeHtml(data.url) + '</p>';
    const copy = document.createElement("button"); copy.className = "ghost wide"; copy.textContent = "Copy invite link";
    copy.addEventListener("click", async () => {
      try { await copyText(data.url); toast("Invite link copied."); }
      catch { toast("Could not access the clipboard on this browser."); }
    });
    const share = document.createElement("button"); share.className = "primary wide"; share.textContent = "Share invite";
    share.addEventListener("click", async () => {
      try {
        if (navigator.share) await navigator.share({ title: "Join me on Pinglet", text: "Scan or open my Pinglet invite.", url: data.url });
        else { await copyText(data.url); toast("Invite link copied."); }
      } catch (error) {
        if (error.name !== "AbortError") toast("Could not share this invite right now.");
      }
    });
    content.append(copy, share);
  } catch (error) { content.innerHTML = ""; $("#modalError").textContent = error.message; }
}
function extractPingletCode(value) {
  const raw = String(value || "").trim();
  if (/^[a-f0-9]{14}$/i.test(raw)) return raw.toUpperCase();
  try {
    const url = new URL(raw);
    const isPingletOrigin = url.origin === location.origin || url.origin === "https://pinglet-chat-live.onrender.com";
    const match = url.pathname.match(/^\/invite\/([a-f0-9]{14})\/?$/i);
    if (isPingletOrigin && match) return match[1].toUpperCase();
  } catch {}
  return null;
}
async function submitFriendCode(code) {
  const data = await api("/friend-requests", { method: "POST", body: JSON.stringify({ code }) });
  if (data.status === "friends") {
    await loadFriends();
    toast("You're already friends with " + data.friend.name + ".");
  } else {
    await loadRequests();
    toast("Friend request sent to " + data.friend.name + ".");
  }
  return data;
}
async function getQrDetector() {
  if (qrDetector) return qrDetector;
  if (!("BarcodeDetector" in window)) return null;
  try {
    const formats = await BarcodeDetector.getSupportedFormats();
    if (formats.includes("qr_code")) qrDetector = new BarcodeDetector({ formats: ["qr_code"] });
  } catch {}
  return qrDetector;
}
function setScannerStatus(message) {
  $("#scannerStatus").textContent = message;
}
function stopQrScanner(showResume = false) {
  if (qrFrameId) cancelAnimationFrame(qrFrameId);
  qrFrameId = 0;
  qrFrameBusy = false;
  if (qrStream) qrStream.getTracks().forEach(track => track.stop());
  qrStream = null;
  qrTrack = null;
  qrTorchOn = false;
  const video = $("#scannerVideo");
  if (video) { video.pause(); video.srcObject = null; }
  const torch = $("#scannerTorch");
  if (torch) { torch.classList.add("hidden"); torch.textContent = "☼ Torch off"; }
  const resume = $("#scannerResume");
  if (resume) resume.classList.toggle("hidden", !showResume);
}
function closeQrScanner() {
  stopQrScanner(false);
  $("#scannerModal").classList.add("hidden");
  $("#scannerResult").classList.add("hidden");
  $("#scannerVideo").classList.remove("hidden");
  $("#scannerPlaceholder").classList.remove("hidden");
  $("#qrImageInput").value = "";
  pendingScannedCode = null;
}
function showScannedInvite(value) {
  const code = extractPingletCode(value);
  if (!code) {
    setScannerStatus("That isn't a Pinglet invite QR. Try another code or enter a friend code manually.");
    return;
  }
  pendingScannedCode = code;
  stopQrScanner(false);
  $("#scannerVideo").classList.add("hidden");
  $("#scannerFrame").classList.add("hidden");
  $("#scannerPlaceholder").classList.add("hidden");
  $("#scannerFoundCode").textContent = code;
  $("#scannerResult").classList.remove("hidden");
  setScannerStatus("We found a Pinglet invite. Check the code, then send the friend request.");
}
function scanVideoFrame(timestamp) {
  if (!qrStream) return;
  qrFrameId = requestAnimationFrame(scanVideoFrame);
  if (qrFrameBusy || timestamp - qrLastFrameAt < 140) return;
  const video = $("#scannerVideo");
  if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) return;
  qrLastFrameAt = timestamp;
  qrFrameBusy = true;
  try {
    if (window.jsQR) {
      const canvas = $("#scannerCanvas"), context = canvas.getContext("2d", { willReadFrequently: true });
      const scale = Math.min(1, 640 / video.videoWidth);
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      const found = window.jsQR(pixels.data, pixels.width, pixels.height, { inversionAttempts: "dontInvert" });
      if (found && found.data) { showScannedInvite(found.data); return; }
    } else if (qrDetector) {
      qrDetector.detect(video).then(codes => {
        if (qrStream && codes.length) showScannedInvite(codes[0].rawValue);
      }).catch(() => {});
    }
  } catch {}
  finally { qrFrameBusy = false; }
}
async function openQrScanner() {
  closeQrScanner();
  $("#scannerModal").classList.remove("hidden");
  $("#scannerResult").classList.add("hidden");
  $("#scannerVideo").classList.remove("hidden");
  $("#scannerFrame").classList.remove("hidden");
  $("#scannerPlaceholder").classList.remove("hidden");
  $("#scannerResume").classList.add("hidden");
  $("#qrImageInput").value = "";
  setScannerStatus("Starting your camera…");
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    setScannerStatus("Camera scanning requires a secure HTTPS browser with camera support. Upload a QR image or enter the code instead.");
    return;
  }
  if (!window.jsQR) {
    await getQrDetector();
    if (!qrDetector) {
      setScannerStatus("The QR reader could not load in this browser. Upload a QR image or enter the code instead.");
      return;
    }
  }
  try {
    qrStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }
    });
    const video = $("#scannerVideo");
    video.srcObject = qrStream;
    await video.play();
    qrTrack = qrStream.getVideoTracks()[0];
    $("#scannerPlaceholder").classList.add("hidden");
    const capabilities = qrTrack.getCapabilities ? qrTrack.getCapabilities() : {};
    $("#scannerTorch").classList.toggle("hidden", !capabilities.torch);
    setScannerStatus("Camera is ready. Hold the QR inside the frame; scanning happens only on this device.");
    qrLastFrameAt = 0;
    qrFrameId = requestAnimationFrame(scanVideoFrame);
  } catch (error) {
    stopQrScanner(false);
    const reason = error.name === "NotAllowedError" ? "Camera permission was blocked. Allow camera access in your browser settings, or upload a QR image."
      : error.name === "NotFoundError" ? "No camera was found on this device. Upload a QR image or enter the code."
      : "Couldn't start the camera. Check browser permission and try again, or upload a QR image.";
    setScannerStatus(reason);
    $("#scannerPlaceholder").classList.remove("hidden");
  }
}
async function decodeQrImage(file) {
  if (!file) return;
  setScannerStatus("Reading the image on this device…");
  try {
    let source;
    if ("createImageBitmap" in window) source = await createImageBitmap(file);
    else {
      source = await new Promise((resolve, reject) => {
        const image = new Image();
        const url = URL.createObjectURL(file);
        image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
        image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Image could not be opened.")); };
        image.src = url;
      });
    }
    let raw = null;
    if (window.jsQR) {
      const canvas = $("#scannerCanvas"), context = canvas.getContext("2d", { willReadFrequently: true });
      const scale = Math.min(1, 1600 / source.width);
      canvas.width = Math.max(1, Math.round(source.width * scale));
      canvas.height = Math.max(1, Math.round(source.height * scale));
      context.drawImage(source, 0, 0, canvas.width, canvas.height);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      const found = window.jsQR(pixels.data, pixels.width, pixels.height, { inversionAttempts: "attemptBoth" });
      raw = found && found.data;
    } else {
      await getQrDetector();
      if (qrDetector) {
        const found = await qrDetector.detect(source);
        raw = found[0]?.rawValue || null;
      }
    }
    if (source.close) source.close();
    if (raw) showScannedInvite(raw);
    else setScannerStatus("No QR code was found in that image. Try a clearer image or use the camera.");
  } catch {
    setScannerStatus("Couldn't read that image. Try a PNG or JPG QR image, or scan with your camera.");
  } finally { $("#qrImageInput").value = ""; }
}
$("#scanQr").addEventListener("click", openQrScanner);
$("#welcomeScan").addEventListener("click", openQrScanner);
$("#scannerClose").addEventListener("click", closeQrScanner);
$("#scannerModal").addEventListener("click", event => { if (event.target.id === "scannerModal") closeQrScanner(); });
$("#scannerManual").addEventListener("click", () => {
  closeQrScanner();
  showAddFriendModal();
  $("#modalInput").focus();
});
$("#scannerResume").addEventListener("click", openQrScanner);
$("#scannerAgain").addEventListener("click", openQrScanner);
$("#qrImageInput").addEventListener("change", event => decodeQrImage(event.target.files && event.target.files[0]));
$("#scannerTorch").addEventListener("click", async () => {
  if (!qrTrack) return;
  try {
    qrTorchOn = !qrTorchOn;
    await qrTrack.applyConstraints({ advanced: [{ torch: qrTorchOn }] });
    $("#scannerTorch").textContent = qrTorchOn ? "☼ Torch on" : "☼ Torch off";
  } catch {
    qrTorchOn = false;
    toast("Torch control isn't available on this camera.");
  }
});
$("#confirmScannedInvite").addEventListener("click", async () => {
  if (!pendingScannedCode) return;
  const button = $("#confirmScannedInvite");
  button.disabled = true;
  try {
    await submitFriendCode(pendingScannedCode);
    closeQrScanner();
  } catch (error) { setScannerStatus(error.message); }
  finally { button.disabled = false; }
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden && qrStream) {
    stopQrScanner(true);
    setScannerStatus("Camera paused while Pinglet was in the background. Tap Start camera to continue.");
  }
});
$("#addFriend").addEventListener("click", showAddFriendModal);
$("#welcomeAdd").addEventListener("click", showAddFriendModal);
$("#shareQr").addEventListener("click", showQrModal);
$("#modalClose").addEventListener("click", () => $("#modal").classList.add("hidden"));
$("#modal").addEventListener("click", event => { if (event.target.id === "modal") $("#modal").classList.add("hidden"); });
document.addEventListener("keydown", event => {
  if (event.key === "Escape") {
    $("#modal").classList.add("hidden");
    $("#themeModal").classList.add("hidden");
    closeQrScanner();
    $("#requests").classList.remove("mobile-open");
  }
});
$("#modalForm").addEventListener("submit", async event => {
  event.preventDefault();
  if (event.currentTarget.dataset.kind === "label") return;
  try {
    await submitFriendCode($("#modalInput").value.trim().toUpperCase());
    $("#modal").classList.add("hidden");
  } catch (error) { $("#modalError").textContent = error.message; }
});
$("#friendSearch").addEventListener("input", renderFriends);
document.querySelectorAll("[data-friend-filter]").forEach(button => button.addEventListener("click", () => {
  activeFriendFilter = button.dataset.friendFilter;
  document.querySelectorAll("[data-friend-filter]").forEach(item => {
    const selected = item === button;
    item.classList.toggle("active", selected);
    item.setAttribute("aria-pressed", String(selected));
  });
  renderFriends();
}));
$("#topAddFriend").addEventListener("click", showAddFriendModal);
$("#welcomeShare").addEventListener("click", showQrModal);
$("#homeNav").addEventListener("click", () => {
  show(peer ? "chat" : "welcome");
  $("#contextEyebrow").textContent = peer ? "YOUR CONVERSATION" : "YOUR PRIVATE SPACE";
  $("#contextTitle").textContent = peer ? "A little hello to " + peer.name + "." : "A little more connected.";
});
$("#requestsNav").addEventListener("click", () => {
  const requests = $("#requests");
  const opened = requests.classList.toggle("mobile-open");
  $("#requestsNav").setAttribute("aria-expanded", String(opened));
  $("#requestsNav").classList.toggle("active", opened);
});

function openGames(viewTitle = "Play something.") {
  show("games");
  $("#contextEyebrow").textContent = "A LITTLE BREAK";
  $("#contextTitle").textContent = viewTitle;
}
$("#gamesNav").addEventListener("click", () => openGames());
$("#welcomeRps").addEventListener("click", () => openGames("Rock, paper, scissors"));
$("#roomsNav").addEventListener("click", () => {
  show("rooms");
  $("#contextEyebrow").textContent = "YOUR PRIVATE HANGOUT";
  $("#contextTitle").textContent = "Voice and video rooms.";
});
$("#themesNav").addEventListener("click", () => $("#requests").classList.remove("mobile-open"));
$("#peerCopyCode").addEventListener("click", async () => {
  if (!peer) return;
  try { await copyText(peer.code); toast("Friend code copied."); }
  catch { toast("Friend code: " + peer.code); }
});
document.querySelectorAll("[data-quick-message]").forEach(button => button.addEventListener("click", () => {
  const input = $("#messageInput");
  const phrase = button.dataset.quickMessage;
  input.value = input.value.trim() ? input.value.trimEnd() + " " + phrase : phrase;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.focus();
}));
$("#messageInput").addEventListener("input", () => {
  $("#messageCounter").textContent = $("#messageInput").value.length + " / 2000";
});
const conversationSparks = [
  "What's one tiny thing that made you smile today?",
  "Which song has been stuck in your head lately?",
  "What's a random memory that still makes you laugh?",
  "What would your perfect no-plans day look like?",
  "What's something new you'd love to try together?",
  "What is one small win from this week?"
];
$("#sparkNext").addEventListener("click", () => {
  sparkIndex = (sparkIndex + 1 + Math.floor(Math.random() * (conversationSparks.length - 1))) % conversationSparks.length;
  $("#sparkPrompt").textContent = conversationSparks[sparkIndex];
  $("#sparkNext").classList.remove("spark-spin");
  void $("#sparkNext").offsetWidth;
  $("#sparkNext").classList.add("spark-spin");
});

$("#logout").addEventListener("click", () => { localStorage.removeItem("pinglet_token"); location.reload(); });

/* Rock, Paper, Scissors — animated reveal with a local saved scoreboard. */
let rpsBusy = false;
const rpsIcons = { rock: "✊", paper: "✋", scissors: "✌️" };
const rpsNames = { rock: "ROCK", paper: "PAPER", scissors: "SCISSORS" };
const rpsBeats = { rock: "scissors", paper: "rock", scissors: "paper" };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
function renderRpsScore() {
  $("#rpsWins").textContent = String(rpsWins);
  $("#rpsRounds").textContent = String(rpsRounds);
  $("#rpsWinRate").textContent = (rpsRounds ? Math.round((rpsWins / rpsRounds) * 100) : 0) + "%";
}
function setRpsHands(player, opponent, playerLabel, opponentLabel) {
  $("#rpsPlayerHand").textContent = player;
  $("#rpsOpponentHand").textContent = opponent;
  $("#rpsPlayerPick").textContent = playerLabel;
  $("#rpsOpponentPick").textContent = opponentLabel;
}
function burstRpsConfetti() {
  const layer = $("#rpsCelebration");
  layer.replaceChildren();
  for (let i = 0; i < 25; i++) {
    const piece = document.createElement("i");
    const angle = (Math.PI * 2 * i) / 25 + Math.random() * .25;
    const distance = 46 + Math.random() * 115;
    piece.className = "rps-confetti";
    piece.style.setProperty("--dx", Math.cos(angle) * distance + "px");
    piece.style.setProperty("--dy", Math.sin(angle) * distance + "px");
    piece.style.setProperty("--spin", (Math.random() * 720 - 360) + "deg");
    piece.style.setProperty("--delay", (Math.random() * 110) + "ms");
    layer.appendChild(piece);
  }
  setTimeout(() => layer.replaceChildren(), 1250);
}
async function playRpsRound(mine, button) {
  if (rpsBusy) return;
  rpsBusy = true;
  const arena = $("#rpsArena");
  const buttons = [...document.querySelectorAll("[data-choice]")];
  buttons.forEach(item => { item.disabled = true; item.classList.toggle("picked", item === button); });
  $("#resetGame").disabled = true;
  $("#gameResult").className = "rps-result is-playing";
  $("#gameResult").textContent = "Get ready…";
  $("#rpsCountdown").textContent = "READY?";
  arena.dataset.state = "counting";
  delete arena.dataset.result;
  setRpsHands("✊", "✊", "YOU", "PINGLET");
  const countWords = ["ROCK", "PAPER", "SCISSORS", "SHOOT!"];
  for (const word of countWords) {
    $("#rpsCountdown").textContent = word;
    arena.classList.remove("rps-pulse");
    void arena.offsetWidth;
    arena.classList.add("rps-pulse");
    await wait(390);
  }
  const other = ["rock", "paper", "scissors"][Math.floor(Math.random() * 3)];
  const won = rpsBeats[mine] === other;
  const tied = mine === other;
  const outcome = tied ? "draw" : won ? "win" : "loss";
  arena.dataset.state = "reveal";
  arena.dataset.result = outcome;
  setRpsHands(rpsIcons[mine], rpsIcons[other], rpsNames[mine], rpsNames[other]);
  $("#rpsCountdown").textContent = tied ? "TIE!" : won ? "YOU WIN!" : "OOPS!";
  void arena.offsetWidth;
  arena.classList.add("rps-reveal");
  rpsRounds += 1;
  if (won) rpsWins += 1;
  localStorage.setItem("pinglet_rps_wins", String(rpsWins));
  localStorage.setItem("pinglet_rps_rounds", String(rpsRounds));
  renderRpsScore();
  const result = tied ? "A perfect tie. Run it back?" : won ? "YOU WIN! The arena is yours ✨" : "Pinglet got this one. Your comeback starts now.";
  $("#gameResult").className = "rps-result " + (won ? "is-win" : tied ? "is-draw" : "is-loss");
  $("#gameResult").textContent = result;
  if (won) burstRpsConfetti();
  await wait(720);
  arena.classList.remove("rps-reveal", "rps-pulse");
  buttons.forEach(item => { item.disabled = false; });
  $("#resetGame").disabled = false;
  rpsBusy = false;
}
renderRpsScore();
document.querySelectorAll("[data-choice]").forEach(button => button.addEventListener("click", () => {
  playRpsRound(button.dataset.choice, button).catch(error => {
    console.warn("Rock Paper Scissors animation failed:", error);
    rpsBusy = false;
    document.querySelectorAll("[data-choice]").forEach(item => { item.disabled = false; });
    $("#resetGame").disabled = false;
    $("#rpsArena").dataset.state = "idle";
    $("#gameResult").textContent = "That round couldn't finish. Try again.";
  });
}));
$("#resetGame").addEventListener("click", () => {
  if (rpsBusy) return;
  rpsWins = 0; rpsRounds = 0;
  localStorage.setItem("pinglet_rps_wins", "0");
  localStorage.setItem("pinglet_rps_rounds", "0");
  renderRpsScore();
  document.querySelectorAll("[data-choice]").forEach(item => { item.classList.remove("picked"); });
  const arena = $("#rpsArena");
  arena.dataset.state = "idle";
  delete arena.dataset.result;
  setRpsHands("✊", "✊", "YOU", "PINGLET");
  $("#rpsCountdown").textContent = "READY?";
  $("#gameResult").className = "rps-result";
  $("#gameResult").textContent = "Score cleared. Ready for another round?";
  $("#rpsCelebration").replaceChildren();
});

/* Online two-player Snake Duel */
function updateSnakeUI() {
  const canInvite = !!peer && friends.some(f => f.id === peer.id);
  $("#snakeJoin").disabled = !canInvite;
  $("#snakeJoin").textContent = canInvite ? "Invite " + peer.name + " to play" : "Open a saved friend's chat first";
  $("#snakeHelp").textContent = canInvite
    ? "You're playing " + peer.name + ". Invite them; both snakes appear when they join."
    : "Open a saved friend's chat first, then invite them here. The friend must accept your request before playing.";
  if (snakeState) {
    const mePlayer = snakeState.players.find(p => p.id === me.id);
    const friendPlayer = snakeState.players.find(p => p.id !== me.id);
    $("#snakeYouScore").textContent = "YOU · " + (mePlayer ? mePlayer.score : 0);
    $("#snakeFriendScore").textContent = "FRIEND · " + (friendPlayer ? friendPlayer.score : 0);
    const overlay = $("#snakeOverlay");
    if (snakeState.status === "waiting") {
      overlay.classList.remove("hidden");
      overlay.innerHTML = "<b>Waiting for friend…</b><span>Ask your friend to open Pinglet and join your Snake invite.</span>";
      $("#snakeStatus").textContent = "Room open · waiting for the other player";
      $("#snakeRestart").classList.add("hidden");
    } else if (snakeState.status === "finished") {
      overlay.classList.remove("hidden");
      const outcome = snakeState.winner === "draw" ? "It's a draw!" : snakeState.winner === me.id ? "You win! 🎉" : "Your friend wins!";
      overlay.innerHTML = "<b>" + outcome + "</b><span>Both players can restart the duel.</span>";
      $("#snakeStatus").textContent = outcome;
      $("#snakeRestart").classList.remove("hidden");
    } else {
      overlay.classList.add("hidden");
      $("#snakeStatus").textContent = "Game on! Avoid the walls and both snakes.";
      $("#snakeRestart").classList.add("hidden");
    }
  } else {
    $("#snakeYouScore").textContent = "YOU · 0";
    $("#snakeFriendScore").textContent = "FRIEND · 0";
    $("#snakeOverlay").classList.remove("hidden");
    $("#snakeOverlay").innerHTML = "<b>Ready to play?</b><span>Invite your selected friend to join this room.</span>";
  }
  drawSnake();
}
function joinSnake(friendId) {
  const friend = friends.find(f => f.id === friendId);
  if (!friend || !socket) { toast("Choose a saved friend and connect first."); return; }
  peer = friend;
  snakePeerId = friend.id;
  snakeState = null;
  show("games");
  $("#contextEyebrow").textContent = "ONLINE 1 VS 1";
  $("#contextTitle").textContent = "Snake Duel with " + friend.name;
  updateSnakeUI();
  $("#snakeStatus").textContent = "Opening your game room…";
  socket.emit("snake:join", { peerId: friend.id });
}
$("#snakeJoin").addEventListener("click", () => { if (peer) joinSnake(peer.id); });
$("#acceptSnakeInvite").addEventListener("click", () => {
  const id = pendingSnakeInvite;
  pendingSnakeInvite = null;
  $("#snakeInviteBanner").classList.add("hidden");
  if (id) joinSnake(id);
});
$("#declineSnakeInvite").addEventListener("click", () => {
  pendingSnakeInvite = null; $("#snakeInviteBanner").classList.add("hidden");
});
$("#snakeRestart").addEventListener("click", () => {
  if (socket && snakePeerId) socket.emit("snake:restart", { peerId: snakePeerId });
});
function sendSnakeDirection(direction) {
  if (socket && snakePeerId && snakeState && snakeState.status === "playing") {
    socket.emit("snake:direction", { peerId: snakePeerId, direction });
  }
}
document.querySelectorAll("[data-dir]").forEach(button => button.addEventListener("click", () => sendSnakeDirection(button.dataset.dir)));
document.addEventListener("keydown", event => {
  if ($("#games").classList.contains("hidden")) return;
  const directions = { ArrowUp:"up", w:"up", ArrowDown:"down", s:"down", ArrowLeft:"left", a:"left", ArrowRight:"right", d:"right" };
  const direction = directions[event.key] || directions[event.key.toLowerCase()];
  if (direction) { event.preventDefault(); sendSnakeDirection(direction); }
});
/* Voice and video rooms: WebRTC media is peer-to-peer; Socket.IO only signals room members. */
function setCallStatus(message) {
  const node = $("#callStatus");
  if (node) node.textContent = message;
}
function callRoomAck(eventName, payload) {
  return new Promise((resolve, reject) => {
    if (!socket || !socket.connected) return reject(new Error("Reconnect to Pinglet before joining a call."));
    const timer = setTimeout(() => reject(new Error("The room server didn't respond. Try again.")), 10000);
    socket.emit(eventName, payload, response => {
      clearTimeout(timer);
      resolve(response || { ok: false, error: "The room request could not be completed." });
    });
  });
}
async function requestCallMedia(mode) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error("This browser cannot access a microphone or camera. Open Pinglet over HTTPS in a supported browser.");
  }
  return navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    video: mode === "video" ? { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } } : false
  });
}
async function openCallRoom(action, value) {
  if (callBusy || callCode) return;
  if (!socket || !socket.connected) { toast("Connect to Pinglet before starting a call."); return; }
  callBusy = true;
  const buttons = [$("#createVideoRoom"), $("#createVoiceRoom"), $("#joinCallRoom")];
  buttons.forEach(button => { button.disabled = true; });
  let response;
  try {
    if (action === "create") {
      callStream = await requestCallMedia(value);
      response = await callRoomAck("call:create", { mode: value });
    } else {
      response = await callRoomAck("call:join", { code: value });
      if (response.ok) callStream = await requestCallMedia(response.mode);
    }
    if (!response || !response.ok) {
      if (callStream) { callStream.getTracks().forEach(track => track.stop()); callStream = null; }
      toast(response && response.error ? response.error : "Couldn't open that room.");
      return;
    }
    enterCallRoom(response);
  } catch (error) {
    if (callStream) { callStream.getTracks().forEach(track => track.stop()); callStream = null; }
    if (response && response.ok && socket && socket.connected) socket.emit("call:leave");
    toast(error.message || "Couldn't start the call.");
  } finally {
    callBusy = false;
    buttons.forEach(button => { button.disabled = false; });
  }
}
function enterCallRoom(data) {
  callCode = data.code;
  callMode = data.mode;
  callPeers.clear();
  callTiles.clear();
  $("#callLanding").classList.add("hidden");
  $("#callLive").classList.remove("hidden");
  $("#activeCallCode").textContent = callCode;
  $("#callModeLabel").textContent = callMode === "video" ? "LIVE VIDEO ROOM" : "LIVE VOICE ROOM";
  $("#callRoomTitle").textContent = callMode === "video" ? "Video hangout" : "Voice hangout";
  $("#toggleCamera").classList.toggle("hidden", callMode !== "video");
  $("#toggleMic").textContent = "🎙 Mic on";
  $("#toggleMic").classList.add("active");
  $("#toggleCamera").textContent = "▣ Camera on";
  $("#toggleCamera").classList.add("active");
  addCallTile(socket.id, me.name + " (you)", true);
  setCallStatus("Room is ready · Share the four-digit code · 1/4 here");
  (data.participants || []).forEach(person => {
    createCallPeer(person.peerId, person.name || "A Pinglet friend", true).catch(error => {
      console.warn("Call peer setup failed:", error);
      setCallStatus("Could not connect to " + (person.name || "a participant") + ".");
    });
  });
}
function addCallTile(peerId, name, local = false) {
  if (callTiles.has(peerId)) return callTiles.get(peerId);
  const tile = document.createElement("article");
  tile.className = "call-tile" + (local ? " is-local" : "");
  const mediaWrap = document.createElement("div");
  mediaWrap.className = "call-media-wrap";
  const media = document.createElement(callMode === "voice" ? "audio" : "video");
  media.className = "call-media";
  media.autoplay = true;
  if (media.tagName === "VIDEO") media.playsInline = true;
  if (local) media.muted = true;
  const avatar = document.createElement("div");
  avatar.className = "call-avatar";
  avatar.textContent = String(name || "P").trim().charAt(0).toUpperCase() || "P";
  const nameTag = document.createElement("span");
  nameTag.className = "call-name";
  nameTag.textContent = name || "A Pinglet friend";
  mediaWrap.append(media, avatar);
  tile.append(mediaWrap, nameTag);
  $("#callGrid").appendChild(tile);
  const entry = { tile, media, avatar, nameTag };
  callTiles.set(peerId, entry);
  if (local && callStream) {
    media.srcObject = callStream;
    if (callMode === "video" && callStream.getVideoTracks().some(track => track.enabled)) tile.classList.add("has-video");
    media.play().catch(() => {});
  }
  return entry;
}
async function createCallPeer(peerId, peerName, initiator) {
  if (!callCode || !peerId || !callStream) return;
  if (callPeers.has(peerId)) return callPeers.get(peerId);
  const entry = addCallTile(peerId, peerName, false);
  const pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
  });
  const peer = { pc, entry, pendingCandidates: [] };
  callPeers.set(peerId, peer);
  callStream.getTracks().forEach(track => pc.addTrack(track, callStream));
  pc.onicecandidate = event => {
    if (event.candidate && socket && socket.connected) {
      socket.emit("call:signal", { toPeerId: peerId, candidate: event.candidate });
    }
  };
  pc.ontrack = event => {
    const stream = event.streams && event.streams[0] ? event.streams[0] : new MediaStream([event.track]);
    entry.media.srcObject = stream;
    if (callMode === "video" && stream.getVideoTracks().length) {
      entry.tile.classList.add("has-video");
      stream.getVideoTracks().forEach(track => {
        track.onmute = () => entry.tile.classList.remove("has-video");
        track.onunmute = () => entry.tile.classList.add("has-video");
      });
    }
    entry.media.play().catch(() => setCallStatus("Tap the page once to enable call audio."));
  };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "failed") setCallStatus("Connection failed for " + peerName + ". Check the network and rejoin.");
    else if (pc.connectionState === "connected") setCallStatus(peerName + " is connected · " + (1 + callPeers.size) + "/4 here");
  };
  if (initiator) {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit("call:signal", { toPeerId: peerId, description: pc.localDescription });
  }
  return peer;
}
async function handleCallSignal(payload) {
  if (!callCode || !payload || !payload.fromPeerId) return;
  let peer = callPeers.get(payload.fromPeerId);
  if (!peer) peer = await createCallPeer(payload.fromPeerId, payload.fromName || "A Pinglet friend", false);
  if (!peer) return;
  const pc = peer.pc;
  if (payload.description) {
    await pc.setRemoteDescription(new RTCSessionDescription(payload.description));
    if (payload.description.type === "offer") {
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit("call:signal", { toPeerId: payload.fromPeerId, description: pc.localDescription });
    }
    while (peer.pendingCandidates.length) {
      const candidate = peer.pendingCandidates.shift();
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    }
  } else if (payload.candidate) {
    if (pc.remoteDescription) await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
    else peer.pendingCandidates.push(payload.candidate);
  }
}
function removeCallPeer(peerId) {
  if (!peerId) return;
  const peer = callPeers.get(peerId);
  if (peer) { peer.pc.close(); callPeers.delete(peerId); }
  const tile = callTiles.get(peerId);
  if (tile) { tile.tile.remove(); callTiles.delete(peerId); }
  if (callCode) setCallStatus("Someone left · " + (1 + callPeers.size) + "/4 here");
}
function showCallReaction(payload) {
  if (!callCode || !payload || !payload.emoji) return;
  const burst = document.createElement("div");
  burst.className = "call-reaction-burst";
  burst.textContent = payload.emoji;
  burst.setAttribute("aria-label", (payload.name || "Someone") + " reacted");
  $("#callGrid").appendChild(burst);
  setTimeout(() => burst.remove(), 1500);
}
function resetCallUi() {
  callPeers.forEach(peer => peer.pc.close());
  callPeers.clear();
  callTiles.clear();
  if (callStream) callStream.getTracks().forEach(track => track.stop());
  callStream = null;
  callCode = null;
  callMode = null;
  const grid = $("#callGrid");
  if (grid) grid.replaceChildren();
  $("#callLive").classList.add("hidden");
  $("#callLanding").classList.remove("hidden");
}
function leaveCallRoom() {
  if (socket && socket.connected && callCode) socket.emit("call:leave");
  resetCallUi();
  toast("You left the call room.");
}
$("#createVideoRoom").addEventListener("click", () => openCallRoom("create", "video"));
$("#createVoiceRoom").addEventListener("click", () => openCallRoom("create", "voice"));
$("#joinCallForm").addEventListener("submit", event => {
  event.preventDefault();
  const input = $("#callRoomCode");
  const code = input.value.trim();
  if (!/^\d{4}$/.test(code)) { toast("Enter the four-digit room code."); input.focus(); return; }
  openCallRoom("join", code);
});
$("#callRoomCode").addEventListener("input", event => {
  event.target.value = event.target.value.replace(/\D/g, "").slice(0, 4);
});
$("#copyCallCode").addEventListener("click", async () => {
  if (!callCode) return;
  try { await copyText(callCode); toast("Room code copied. Share it with your people."); }
  catch { toast("Room code: " + callCode); }
});
$("#toggleMic").addEventListener("click", () => {
  if (!callStream) return;
  const tracks = callStream.getAudioTracks();
  const enabled = !tracks.every(track => track.enabled);
  tracks.forEach(track => { track.enabled = enabled; });
  $("#toggleMic").textContent = enabled ? "🎙 Mic on" : "🔇 Mic muted";
  $("#toggleMic").classList.toggle("active", enabled);
});
$("#toggleCamera").addEventListener("click", () => {
  if (!callStream || callMode !== "video") return;
  const tracks = callStream.getVideoTracks();
  const enabled = !tracks.every(track => track.enabled);
  tracks.forEach(track => { track.enabled = enabled; });
  const localTile = callTiles.get(socket.id);
  if (localTile) localTile.tile.classList.toggle("has-video", enabled);
  $("#toggleCamera").textContent = enabled ? "▣ Camera on" : "◌ Camera off";
  $("#toggleCamera").classList.toggle("active", enabled);
});
$("#leaveCall").addEventListener("click", leaveCallRoom);
document.querySelectorAll("[data-call-reaction]").forEach(button => button.addEventListener("click", () => {
  if (socket && callCode) socket.emit("call:reaction", { emoji: button.dataset.callReaction });
}));

function drawSnake() {
  const canvas = $("#snakeCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d"), width = canvas.width, height = canvas.height;
  ctx.fillStyle = "#101522"; ctx.fillRect(0, 0, width, height);
  const cols = snakeState?.width || 24, rows = snakeState?.height || 16;
  const cellW = width / cols, cellH = height / rows;
  ctx.strokeStyle = "rgba(170,180,210,.08)"; ctx.lineWidth = 1;
  for (let x=0;x<=cols;x++) { ctx.beginPath(); ctx.moveTo(x*cellW,0); ctx.lineTo(x*cellW,height); ctx.stroke(); }
  for (let y=0;y<=rows;y++) { ctx.beginPath(); ctx.moveTo(0,y*cellH); ctx.lineTo(width,y*cellH); ctx.stroke(); }
  if (!snakeState) return;
  if (snakeState.food) {
    ctx.fillStyle = "#ff7c87"; ctx.beginPath();
    ctx.arc((snakeState.food.x+.5)*cellW,(snakeState.food.y+.5)*cellH,Math.min(cellW,cellH)*.32,0,Math.PI*2); ctx.fill();
  }
  snakeState.players.forEach((player,index) => {
    const fill = index===0 ? "#c7f36b" : "#a99aff";
    player.body.forEach((part,partIndex) => {
      ctx.fillStyle = fill;
      const inset = partIndex===0 ? 2 : 3;
      ctx.beginPath();
      ctx.roundRect(part.x*cellW+inset,part.y*cellH+inset,cellW-inset*2,cellH-inset*2,5);
      ctx.fill();
    });
  });
}
if (token) boot();
else if (sessionStorage.getItem("pinglet_pending_invite")) {
  $("#authHint").textContent = "You have a friend invite waiting. Create an account or sign in to send your request.";
}

/* Personal theme preferences are saved in this browser. */
const themeNames = ["galaxy","aurora","nature","ocean","sakura","cute","pawprint","midnight"];
function applyTheme(theme) {
  const selected = themeNames.includes(theme) ? theme : "galaxy";
  document.body.dataset.theme = localStorage.getItem("pinglet_custom_wallpaper") ? "custom" : selected;
  const wallpaper = localStorage.getItem("pinglet_custom_wallpaper");
  if (wallpaper) document.body.style.setProperty("--custom-wallpaper", 'url("' + wallpaper + '")');
  else document.body.style.removeProperty("--custom-wallpaper");
  document.querySelectorAll("[data-theme-choice]").forEach(button => {
    button.classList.toggle("selected", button.dataset.themeChoice === selected && !wallpaper);
  });
}
function openThemePicker() {
  $("#themeModal").classList.remove("hidden");
  applyTheme(localStorage.getItem("pinglet_theme") || "galaxy");
}
$("#themesNav").addEventListener("click", openThemePicker);
$("#themeClose").addEventListener("click", () => $("#themeModal").classList.add("hidden"));
$("#themeModal").addEventListener("click", event => {
  if (event.target.id === "themeModal") $("#themeModal").classList.add("hidden");
});
document.querySelectorAll("[data-theme-choice]").forEach(button => button.addEventListener("click", () => {
  localStorage.setItem("pinglet_theme", button.dataset.themeChoice);
  localStorage.removeItem("pinglet_custom_wallpaper");
  applyTheme(button.dataset.themeChoice);
  toast(button.querySelector("b").textContent + " theme applied.");
}));
$("#wallpaperUpload").addEventListener("change", event => {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  if (!["image/png","image/jpeg","image/webp"].includes(file.type) || file.size > 2 * 1024 * 1024) {
    toast("Choose a PNG, JPG or WEBP image under 2 MB.");
    event.target.value = "";
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    try {
      localStorage.setItem("pinglet_custom_wallpaper", reader.result);
      applyTheme("custom");
      toast("Your custom wallpaper is applied on this device.");
    } catch {
      toast("This image is too large for browser storage. Try a smaller image.");
    }
  };
  reader.onerror = () => toast("Could not read that image.");
  reader.readAsDataURL(file);
});
$("#clearWallpaper").addEventListener("click", () => {
  localStorage.removeItem("pinglet_custom_wallpaper");
  applyTheme(localStorage.getItem("pinglet_theme") || "galaxy");
  toast("Custom wallpaper removed.");
});
applyTheme(localStorage.getItem("pinglet_theme") || "galaxy");

/* Persist friendship labels on the account rather than only in local browser storage. */
$("#editTag").addEventListener("click", () => {
  if (!peer) return;
  $("#modal").classList.remove("hidden");
  $("#modalEyebrow").textContent = "MAKE IT YOURS";
  $("#modalTitle").textContent = "Choose a friendship label";
  $("#modalText").textContent = "This label is private to your account.";
  $("#modalForm").classList.remove("hidden");
  $("#qrShareContent").classList.add("hidden");
  $("#modalLabel").innerHTML = 'Friendship label<select id="friendLabel"><option>Friend</option><option>True Friend</option><option>Bestie</option><option>Love</option><option>Partner in Crime</option><option>My Person</option></select>';
  $("#friendLabel").value = peer.label || "Friend";
  $("#modalSubmit").textContent = "Save label";
  $("#modalError").textContent = "";
  $("#modalForm").dataset.kind = "label";
});
const previousModalHandler = $("#modalForm").onsubmit;
$("#modalForm").addEventListener("submit", async event => {
  if (event.currentTarget.dataset.kind !== "label") return;
  event.preventDefault();
  try {
    const label = $("#friendLabel").value;
    await api("/friends/" + peer.id + "/label", { method: "PATCH", body: JSON.stringify({ label }) });
    peer.label = label;
    friends = friends.map(friend => friend.id === peer.id ? { ...friend, label } : friend);
    $("#peerTag").textContent = label;
    renderFriends();
    $("#modal").classList.add("hidden");
    toast("Friendship label saved.");
  } catch (error) { $("#modalError").textContent = error.message; }
});

if ("serviceWorker" in navigator && location.protocol === "https:") {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(error => console.warn("Pinglet offline shell unavailable:", error)));
}
