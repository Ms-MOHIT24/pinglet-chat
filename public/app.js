const $ = (s) => document.querySelector(s);
let token = localStorage.getItem("pinglet_token"), me = null, peer = null, socket = null;
let mode = "create", friends = [], privateKey = null, pendingSnakeInvite = null;
let snakePeerId = null, snakeState = null;
const encoder = new TextEncoder(), decoder = new TextDecoder();
const chatKeyCache = new Map();
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
  ["welcome", "chat", "games"].forEach(id => $("#" + id).classList.toggle("hidden", id !== view));
  document.body.dataset.view = view;
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
    socket.on("disconnect", () => setConnectionStatus("Offline", false));
    socket.on("snake:invite", payload => {
      if (payload.fromId === me.id) return;
      pendingSnakeInvite = payload.fromId;
      $("#snakeInviteText").textContent = (payload.fromName || "Your friend") + " invited you to Snake Duel.";
      $("#snakeInviteBanner").classList.remove("hidden");
    });
    socket.on("snake:state", state => { snakeState = state; updateSnakeUI(); });
    socket.on("snake:error", err => toast(err.message || "Snake Duel error."));
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
    return;
  }
  const visibleFriends = friends.filter(friend =>
    friend.name.toLowerCase().includes(query) || friend.code.toLowerCase().includes(query) ||
    (friend.label || "").toLowerCase().includes(query)
  );
  if (!visibleFriends.length) {
    const empty = document.createElement("p");
    empty.className = "empty search-empty";
    empty.textContent = "No friends match “" + query + "”.";
    list.appendChild(empty);
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
}
function renderRequests(incoming, outgoing) {
  const list = $("#requests");
  list.innerHTML = "";
  $("#requestCount").textContent = String(incoming.length);
  $("#requestsNav").textContent = "📨 Requests" + (incoming.length ? " · " + incoming.length : "");
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
      bubble.textContent = await decryptMessage(message, activePeer);
      const time = document.createElement("time");
      time.textContent = new Date(message.created).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      bubble.appendChild(time);
      return bubble;
    }));
    // A slower response for the previous chat must not overwrite the newly opened chat.
    if (!peer || peer.id !== activePeer.id) return;
    const list = $("#messages");
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
$("#addFriend").addEventListener("click", showAddFriendModal);
$("#welcomeAdd").addEventListener("click", showAddFriendModal);
$("#shareQr").addEventListener("click", showQrModal);
$("#modalClose").addEventListener("click", () => $("#modal").classList.add("hidden"));
$("#modal").addEventListener("click", event => { if (event.target.id === "modal") $("#modal").classList.add("hidden"); });
document.addEventListener("keydown", event => {
  if (event.key === "Escape") {
    $("#modal").classList.add("hidden");
    $("#themeModal").classList.add("hidden");
    $("#requests").classList.remove("mobile-open");
  }
});
$("#modalForm").addEventListener("submit", async event => {
  event.preventDefault();
  if (event.currentTarget.dataset.kind === "label") return;
  try {
    const data = await api("/friend-requests", { method: "POST", body: JSON.stringify({ code: $("#modalInput").value.trim().toUpperCase() }) });
    $("#modal").classList.add("hidden");
    if (data.status === "friends") {
      await loadFriends();
      toast("You're already friends with " + data.friend.name + ".");
    } else {
      await loadRequests();
      toast("Friend request sent to " + data.friend.name + ".");
    }
  } catch (error) { $("#modalError").textContent = error.message; }
});
$("#friendSearch").addEventListener("input", renderFriends);
$("#topAddFriend").addEventListener("click", showAddFriendModal);
$("#welcomeShare").addEventListener("click", showQrModal);
$("#requestsNav").addEventListener("click", () => {
  const requests = $("#requests");
  const opened = requests.classList.toggle("mobile-open");
  $("#requestsNav").setAttribute("aria-expanded", String(opened));
});
$("#gamesNav").addEventListener("click", () => {
  $("#requests").classList.remove("mobile-open");
  show("games"); $("#contextEyebrow").textContent = "A LITTLE BREAK"; $("#contextTitle").textContent = "Play something.";
});
$("#themesNav").addEventListener("click", () => $("#requests").classList.remove("mobile-open"));

$("#logout").addEventListener("click", () => { localStorage.removeItem("pinglet_token"); location.reload(); });

/* Rock, Paper, Scissors */
document.querySelectorAll("[data-choice]").forEach(button => button.addEventListener("click", () => {
  const mine = button.dataset.choice;
  const other = ["rock", "paper", "scissors"][Math.floor(Math.random() * 3)];
  const result = mine === other ? "It's a tie!" : ({ rock: "scissors", paper: "rock", scissors: "paper" }[mine] === other ? "You win! 🎉" : "The computer wins!");
  $("#gameResult").textContent = "You: " + mine + " · Opponent: " + other + " — " + result;
}));
$("#resetGame").addEventListener("click", () => $("#gameResult").textContent = "Choose your move.");

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
