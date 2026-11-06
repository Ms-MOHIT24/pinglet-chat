const $ = (s) => document.querySelector(s);
let token = localStorage.getItem("pinglet_token"), me = null, peer = null, socket = null;
let mode = "create", friends = [], privateKey = null;
const encoder = new TextEncoder(), decoder = new TextDecoder();

async function api(path, options = {}) {
  const response = await fetch("/api" + path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}), ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Something went wrong.");
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
    const request = indexedDB.open("pinglet-keys", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("keys");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function savePrivateKey(key) {
  const db = await openKeyDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("keys", "readwrite");
    tx.objectStore("keys").put(key, "private");
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}
async function readPrivateKey() {
  const db = await openKeyDb();
  return new Promise((resolve) => {
    const request = db.transaction("keys").objectStore("keys").get("private");
    request.onsuccess = () => { const key = request.result || null; db.close(); resolve(key); };
    request.onerror = () => { db.close(); resolve(null); };
  });
}
async function deriveChatKey(friend) {
  const publicKey = await crypto.subtle.importKey("jwk", friend.pubkey, { name: "ECDH", namedCurve: "P-256" }, false, []);
  return crypto.subtle.deriveKey({ name: "ECDH", public: publicKey }, privateKey, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
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
function show(view) {
  ["welcome", "chat", "games"].forEach(id => $("#" + id).classList.toggle("hidden", id !== view));
}
function setAuthTab(next) {
  mode = next;
  document.querySelectorAll(".tab").forEach(button => button.classList.toggle("active", button.dataset.tab === next));
  $("#nameWrap").classList.toggle("hidden", next === "login");
  $("#codeWrap").classList.toggle("hidden", next !== "login");
  $("#name").required = next !== "login";
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
      await savePrivateKey(pair.privateKey);
      privateKey = pair.privateKey;
      await finishLogin(data);
    } else {
      const data = await api("/login", { method: "POST", body: JSON.stringify({ code: $("#code").value, password: $("#password").value }) });
      privateKey = await readPrivateKey();
      if (!privateKey) {
        $("#authError").textContent = "This browser has no saved encryption key for this account. Account/device recovery is not available in this demo.";
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
    privateKey = privateKey || await readPrivateKey();
    if (!privateKey) throw new Error("Encryption key missing on this browser. Sign in on the browser where you created your account.");
    $("#auth").classList.add("hidden");
    $("#workspace").classList.remove("hidden");
    $("#myName").textContent = me.name;
    $("#myCode").textContent = me.code;
    $("#myAvatar").textContent = me.name.charAt(0).toUpperCase();
    socket = io({ auth: { token } });
    socket.on("message", async (message) => {
      if (peer && (message.sender === peer.id || message.recipient === peer.id)) await loadMessages();
    });
    socket.on("connect_error", () => { $("#contextEyebrow").textContent = "RECONNECTING"; });
    socket.on("connect", () => { if (peer) $("#contextEyebrow").textContent = "YOUR CONVERSATION"; });
    renderFriends();
  } catch (error) {
    localStorage.removeItem("pinglet_token");
    token = null;
    $("#auth").classList.remove("hidden");
    $("#workspace").classList.add("hidden");
    $("#authError").textContent = error.message;
  }
}
$("#copyCode").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(me.code); $("#copyCode").textContent = "✓"; setTimeout(() => $("#copyCode").textContent = "▢", 1200); }
  catch { $("#authError").textContent = "Clipboard access is unavailable. Your code is " + me.code; }
});

function openModal(kind) {
  $("#modal").classList.remove("hidden");
  $("#modalError").textContent = "";
  $("#modalEyebrow").textContent = kind === "tag" ? "MAKE IT YOURS" : "GROW YOUR CIRCLE";
  $("#modalTitle").textContent = kind === "tag" ? "Choose a friendship label" : "Add a friend";
  $("#modalText").textContent = kind === "tag" ? "This label is private to you." : "Enter their unique 14-character Pinglet code.";
  $("#modalLabel").innerHTML = kind === "tag"
    ? 'Friendship label<select id="tagSelect"><option>Friend</option><option>True Friend</option><option>Bestie</option><option>Love</option><option>Partner in Crime</option><option>My Person</option></select>'
    : 'Friend code<input id="modalInput" placeholder="14-character code" maxlength="14" required>';
  $("#modalSubmit").textContent = kind === "tag" ? "Save label" : "Find friend →";
  $("#modalForm").dataset.kind = kind;
}
$("#addFriend").addEventListener("click", () => openModal("friend"));
$("#welcomeAdd").addEventListener("click", () => openModal("friend"));
$("#editTag").addEventListener("click", () => openModal("tag"));
$("#modalClose").addEventListener("click", () => $("#modal").classList.add("hidden"));
$("#modal").addEventListener("click", event => { if (event.target.id === "modal") $("#modal").classList.add("hidden"); });

$("#modalForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    if (event.currentTarget.dataset.kind === "tag") {
      const tag = $("#tagSelect").value;
      localStorage.setItem("tag_" + peer.id, tag);
      $("#peerTag").textContent = tag;
      $("#modal").classList.add("hidden");
      renderFriends();
      return;
    }
    const data = await api("/lookup/" + encodeURIComponent($("#modalInput").value.trim().toUpperCase()));
    if (data.user.id === me.id) throw new Error("That's your own friend code.");
    if (!friends.some(friend => friend.id === data.user.id)) friends.push(data.user);
    renderFriends();
    $("#modal").classList.add("hidden");
    await openPeer(data.user);
  } catch (error) { $("#modalError").textContent = error.message; }
});
function renderFriends() {
  const list = $("#friends");
  list.innerHTML = "";
  if (!friends.length) {
    list.innerHTML = '<p class="empty">Your circle starts here.<br>Add someone using their code.</p>';
    return;
  }
  friends.forEach(friend => {
    const button = document.createElement("button");
    button.className = "friend" + (peer && peer.id === friend.id ? " active" : "");
    button.innerHTML = '<span class="avatar">' + escapeHtml(friend.name.charAt(0).toUpperCase()) +
      '</span><span><b>' + escapeHtml(friend.name) + '</b><small>' + escapeHtml(friend.code) +
      '</small></span><span class="tag">' + escapeHtml(localStorage.getItem("tag_" + friend.id) || "Friend") + '</span>';
    button.addEventListener("click", () => openPeer(friend));
    list.appendChild(button);
  });
}
async function openPeer(friend) {
  peer = friend;
  $("#contextEyebrow").textContent = "YOUR CONVERSATION";
  $("#contextTitle").textContent = "A little hello to " + friend.name + ".";
  $("#peerName").textContent = friend.name;
  $("#peerCode").textContent = friend.code;
  $("#peerAvatar").textContent = friend.name.charAt(0).toUpperCase();
  $("#peerTag").textContent = localStorage.getItem("tag_" + friend.id) || "Friend";
  show("chat");
  renderFriends();
  await loadMessages();
}
async function loadMessages() {
  if (!peer) return;
  try {
    const data = await api("/messages/" + peer.id);
    const list = $("#messages");
    list.innerHTML = "";
    for (const message of data.messages) {
      const bubble = document.createElement("div");
      bubble.className = "bubble " + (message.sender === me.id ? "mine" : "theirs");
      bubble.textContent = await decryptMessage(message, peer);
      const time = document.createElement("time");
      time.textContent = new Date(message.created + "Z").toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      bubble.appendChild(time);
      list.appendChild(bubble);
    }
    list.scrollTop = list.scrollHeight;
  } catch (error) { console.error(error); }
}
$("#sendForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = $("#messageInput").value.trim();
  if (!text || !peer) return;
  $("#messageInput").value = "";
  try {
    const encrypted = await encryptMessage(text, peer);
    await api("/messages", { method: "POST", body: JSON.stringify({ recipient: peer.id, ...encrypted }) });
    await loadMessages();
  } catch (error) { alert(error.message); }
});
$("#gamesNav").addEventListener("click", () => {
  show("games"); $("#contextEyebrow").textContent = "A LITTLE BREAK"; $("#contextTitle").textContent = "Play something.";
});
document.querySelectorAll("[data-choice]").forEach(button => button.addEventListener("click", () => {
  const mine = button.dataset.choice;
  const other = ["rock", "paper", "scissors"][Math.floor(Math.random() * 3)];
  const win = mine === other ? "It's a tie!" : ({ rock: "scissors", paper: "rock", scissors: "paper" }[mine] === other ? "You win! 🎉" : "The computer wins!");
  $("#gameResult").textContent = "You: " + mine + " · Opponent: " + other + " — " + win;
}));
$("#resetGame").addEventListener("click", () => $("#gameResult").textContent = "Choose your move.");
$("#logout").addEventListener("click", () => { localStorage.removeItem("pinglet_token"); location.reload(); });

if (token) boot();
