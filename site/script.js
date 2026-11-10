const menuButton=document.querySelector(".menu-toggle");
const nav=document.querySelector(".nav-links");
if(menuButton&&nav){
  menuButton.addEventListener("click",()=>{
    const open=nav.classList.toggle("open");
    menuButton.setAttribute("aria-expanded",String(open));
    menuButton.setAttribute("aria-label",open?"Close navigation":"Open navigation");
  });
  nav.querySelectorAll("a").forEach(link=>link.addEventListener("click",()=>{
    nav.classList.remove("open");
    menuButton.setAttribute("aria-expanded","false");
  }));
}
const year=document.querySelector("#year");
if(year) year.textContent=new Date().getFullYear();

// The Android link stays disabled unless release-config.js contains a direct,
// HTTPS GitHub release asset URL for a reviewed APK. Never point this at a
// debug/preview build.
const release=window.PINGLET_RELEASE||{};
const downloadButton=document.querySelector("#android-download");
const releaseStatus=document.querySelector("#release-status-text");
function isApprovedApkUrl(value){
  try{
    const url=new URL(value);
    return url.protocol==="https:" &&
      url.hostname==="github.com" &&
      url.pathname.startsWith("/Ms-MOHIT24/pinglet-chat/releases/download/") &&
      url.pathname.toLowerCase().endsWith(".apk");
  }catch{return false;}
}
if(downloadButton&&isApprovedApkUrl(release.downloadUrl)){
  downloadButton.href=release.downloadUrl;
  downloadButton.target="_blank";
  downloadButton.rel="noopener noreferrer";
  downloadButton.classList.remove("button-disabled");
  downloadButton.removeAttribute("aria-disabled");
  downloadButton.removeAttribute("tabindex");
  if(releaseStatus){
    releaseStatus.textContent=release.version
      ? "Android release "+release.version+" · Signed APK"
      : "Android release available · Signed APK";
  }
}
