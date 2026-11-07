"use strict";
const isNativeShell = /^(capacitor|ionic):$/.test(location.protocol) ||
  (location.protocol === "https:" && location.hostname === "localhost" && !location.port);
const API_ORIGIN = isNativeShell ? "https://pinglet-chat-live.onrender.com" : "";
const form = document.querySelector("#deleteWebForm");
const statusNode = document.querySelector("#deleteWebStatus");
const button = document.querySelector("#deleteWebButton");

form.addEventListener("submit", async event => {
  event.preventDefault();
  statusNode.textContent = "";
  if (!document.querySelector("#deleteWebConfirm").checked) return;
  button.disabled = true;
  button.textContent = "Verifying account…";
  try {
    const code = document.querySelector("#deleteWebCode").value.trim().toUpperCase();
    const password = document.querySelector("#deleteWebPassword").value;
    const loginResponse = await fetch(API_ORIGIN + "/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, password })
    });
    const login = await loginResponse.json().catch(() => ({}));
    if (!loginResponse.ok || !login.token || !login.user?.id) throw new Error(login.error || "Could not sign in. Check your friend code and password.");
    const deleteResponse = await fetch(API_ORIGIN + "/api/me", {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + login.token
      },
      body: JSON.stringify({ password })
    });
    const deletion = await deleteResponse.json().catch(() => ({}));
    if (!deleteResponse.ok || deletion.deleted !== true) throw new Error(deletion.error || "Your account could not be deleted. Please try again.");
    localStorage.removeItem("pinglet_token");
    if (window.indexedDB) {
      try {
        const request = indexedDB.open("pinglet-keys", 2);
        request.onsuccess = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains("keys")) { db.close(); return; }
          const tx = db.transaction("keys", "readwrite");
          tx.objectStore("keys").delete(login.user.id);
          tx.oncomplete = () => db.close();
          tx.onerror = () => db.close();
        };
      } catch {}
    }
    form.reset();
    statusNode.className = "success-message";
    statusNode.textContent = "Your Pinglet account has been deleted. You can close this page.";
    button.textContent = "Account deleted";
  } catch (error) {
    statusNode.className = "error";
    statusNode.textContent = error.message || "Something went wrong. Please try again.";
    button.disabled = false;
    button.textContent = "Permanently delete account";
  }
});