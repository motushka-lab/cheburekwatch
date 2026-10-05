const $ = s => document.querySelector(s);
const app = $("#app");
let me = null, room = null, eventSource = null, player = null, vkPlayer = null, localVideo = null;
let suppress = false, syncTimer = null, lastAppliedSeq = 0, remoteApplyUntil = 0, lastYTPosition = null, lastVKPosition = null;

const externalLoaders = {
  youtube: null,
  vk: null
};
function loadExternalScript(src, test, timeoutMs=8000){
  if (test()) return Promise.resolve(true);
  return new Promise(resolve=>{
    const existing = document.querySelector(`script[data-cw-src="${src}"]`);
    const script = existing || document.createElement("script");
    let done=false;
    const finish = ok => { if(done)return; done=true; clearTimeout(timer); script.removeEventListener("load",onload); script.removeEventListener("error",onerror); resolve(ok); };
    const onload=()=>finish(!!test());
    const onerror=()=>finish(false);
    const timer=setTimeout(()=>finish(!!test()),timeoutMs);
    script.addEventListener("load",onload,{once:true});
    script.addEventListener("error",onerror,{once:true});
    script.dataset.cwSrc=src;
    if(!existing){ script.src=src; script.async=true; document.head.appendChild(script); }
  });
}
function loadYouTubeAPI(){
  if(externalLoaders.youtube) return externalLoaders.youtube;
  externalLoaders.youtube=loadExternalScript("https://www.youtube.com/iframe_api",()=>!!window.YT?.Player,9000);
  externalLoaders.youtube.then(ok=>{
    if(ok && typeof window.onYouTubeIframeAPIReady === "function") window.onYouTubeIframeAPIReady();
  });
  return externalLoaders.youtube;
}
function loadVKAPI(){
  if(externalLoaders.vk) return externalLoaders.vk;
  externalLoaders.vk=loadExternalScript("https://vk.com/js/api/videoplayer.js",()=>!!window.VK?.VideoPlayer,9000);
  return externalLoaders.vk;
}

const CW_JOKES=[
  "Пауза коллективная. Виноватых не ищем — все видели.",
  "Если серия закончилась в 03:17 — это не бессонница, это сюжет.",
  "Друг сказал «ещё пять минут». Комната уже знает правду.",
  "Синхрон есть. Самоконтроль — опционально.",
  "Чебурек не осуждает за восьмую серию подряд.",
  "Перемотал назад? Отлично. Теперь все официально делают вид, что не видели спойлер.",
  "Если никто не написал «А ЧТО ПРОИСХОДИТ?» — вы смотрите недостаточно внимательно.",
  "Общая пауза — редкий случай, когда хаос работает по расписанию.",
  "Кино законится. Мемы в чате — нет.",
  "Главное правило: не говорить «я только одну серию» после полуночи."
];
function cwJoke(){return CW_JOKES[Math.floor(Math.random()*CW_JOKES.length)]}


const SITE_ASSETS={
  heroVideo:"/site-assets/hero/main-intro.mp4",
  heroFinal:"/site-assets/hero/main-intro-final.jpg",
  photos:[
    "/site-assets/photo/unnamed-3.webp",
    "/site-assets/photo/unnamed-4.webp",
    "/site-assets/photo/yes.webp",
    "/site-assets/photo/purple-anime.webp",
    "/site-assets/photo/jojo-part3.webp",
    "/site-assets/photo/jojo-memes.webp"
  ],
  videos:[
    "/site-assets/video/video-1.mp4",
    "/site-assets/video/video-2.mp4",
    "/site-assets/video/video-3.mp4"
  ],
  warning:{
    banner:"/site-assets/warning/banner.webp",
    warning2:"/site-assets/warning/warning-2.webp",
    arthur:"/site-assets/warning/arthur-leywin.webp"
  }
};
function archivePhoto(index=0){
  return SITE_ASSETS.photos[index%SITE_ASSETS.photos.length];
}
function easterPhotoHtml(index,className=""){
  return `<figure class="archive-easter ${className}" aria-hidden="true"><img src="${archivePhoto(index)}" alt="" loading="lazy"><span>${String(index+1).padStart(2,"0")}</span></figure>`;
}
function photoGradientBandHtml(){
  return `<section class="new-photo-gradient" aria-label="Фотоархив CheburekWatch">
    <div class="new-photo-gradient-copy"><span>CHAPTER / ARCHIVE</span><b>ШЕСТЬ КАДРОВ. ОДНА СТРАННАЯ ИСТОРИЯ.</b></div>
    <div class="new-photo-gradient-track">
      ${SITE_ASSETS.photos.map((src,i)=>`<figure style="--i:${i}"><img src="${src}" alt="" loading="lazy"><i>${String(i+1).padStart(2,"0")}</i></figure>`).join("")}
    </div>
  </section>`;
}
function ambientVideoStripHtml(){
  const posters=[SITE_ASSETS.photos[1],SITE_ASSETS.photos[3],SITE_ASSETS.photos[5]];
  return `<section class="motion-archive container">
    <div class="section-head motion-head"><div><span class="eyebrow">АКТ II · ДВИЖЕНИЕ</span><h2>ЖИВЫЕ ПАНЕЛИ</h2></div><p>Три фрагмента появляются как манга-панели и оживают только тогда, когда вы до них доходите.</p></div>
    <div class="motion-grid">
      ${SITE_ASSETS.videos.map((src,i)=>`<article class="motion-card motion-card-${i+1}"><video class="ambient-video" src="${src}" poster="${posters[i]}" muted playsinline loop preload="metadata"></video><div><span>0${i+1}</span><b>${["ПЕРВЫЙ УДАР","ВТОРОЙ КАДР","ФИНАЛЬНЫЙ ПОВОРОТ"][i]}</b></div></article>`).join("")}
    </div>
  </section>`;
}
function setupAmbientVideos(){
  const videos=[...document.querySelectorAll(".ambient-video")];
  if(!videos.length)return;
  const reduced=window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  if(reduced){videos.forEach(v=>v.pause());return}
  if(!("IntersectionObserver" in window)){videos.forEach(v=>v.play().catch(()=>{}));return}
  const observer=new IntersectionObserver(entries=>{
    entries.forEach(entry=>{
      const v=entry.target;
      if(entry.isIntersecting && entry.intersectionRatio>.25)v.play().catch(()=>{});
      else v.pause();
    });
  },{threshold:[0,.25,.6]});
  videos.forEach(v=>observer.observe(v));
}
function setupMainHeroVideo(){
  const v=document.querySelector("#mainHeroVideo");
  if(!v)return;
  const reduced=window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  const key="cw-main-intro-played";
  if(reduced || sessionStorage.getItem(key)==="1"){v.replaceWith(Object.assign(document.createElement("img"),{className:"hero-image hero-final-frame",src:SITE_ASSETS.heroFinal,alt:""}));return}
  const start=()=>{
    if(sessionStorage.getItem(key)==="1")return;
    sessionStorage.setItem(key,"1");
    v.muted=true;
    v.currentTime=0;
    v.play().catch(()=>sessionStorage.removeItem(key));
  };
  v.addEventListener("ended",()=>{
    v.pause();
    if(Number.isFinite(v.duration) && v.duration>.05){try{v.currentTime=v.duration-.04}catch{}}
    v.closest(".hero")?.classList.add("hero-video-ended");
  },{once:true});
  if(document.querySelector(".intro"))window.addEventListener("cw:intro-finished",start,{once:true});
  else start();
}


async function api(url, options={}) {
  const headers={"Content-Type":"application/json", ...(options.headers||{})};
  const init={...options, credentials:"same-origin", headers};
  if(init.body!==undefined && init.body!==null && typeof init.body!=="string") init.body=JSON.stringify(init.body);
  const r=await fetch(url,init);
  let data={};
  try { data=await r.json(); } catch {}
  if(!r.ok) throw new Error(data.error || `Ошибка запроса (${r.status})`);
  return data;
}
function esc(s){const d=document.createElement("div");d.textContent=s;return d.innerHTML}
let navigationBusy = false;
function navigate(path){
  if(!path || navigationBusy) return;
  if(location.pathname===path){ render(); return; }
  navigationBusy=true;
  const stage=document.querySelector(".page-stage");
  const curtain=document.querySelector(".page-curtain");
  stage?.classList.add("is-transitioning");
  curtain?.classList.add("active");
  setTimeout(()=>{
    history.pushState({},"",path);
    Promise.resolve(render()).finally(()=>setTimeout(()=>{navigationBusy=false},180));
  },170);
}
window.addEventListener("popstate", render);

function prefixLabel(user=me){
  return `<span class="prefix">${esc(user.secretPrefix || user.prefix || "Лошара")}</span>`;
}
function figmaImages(){
  return {
    hero:SITE_ASSETS.heroFinal,
    cinema:archivePhoto(5),
    redEye:archivePhoto(3),
    forest:archivePhoto(0),
    portrait:archivePhoto(4),
    mountain:archivePhoto(1),
    road:archivePhoto(2),
    lake:archivePhoto(5),
    chairs:SITE_ASSETS.warning.banner
  };
}

function figmaMovies(){ return []; }

function figmaDemoRooms(){ return []; }

function cwIcon(name,size=20){
  const p={
    arrow:'<path d="M5 12h14"/><path d="m14 7 5 5-5 5"/>',
    back:'<path d="m15 18-6-6 6-6"/>',
    chat:'<path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/>',
    check:'<path d="m5 12 4 4L19 6"/>',
    close:'<path d="M6 6l12 12"/><path d="m18 6-12 12"/>',
    expand:'<path d="M8 3H3v5"/><path d="m3 3 6 6"/><path d="M16 21h5v-5"/><path d="m21 21-6-6"/>',
    film:'<rect x="3" y="5" width="18" height="14" rx="1"/><path d="M7 5v14M17 5v14M3 9h4M3 15h4M17 9h4M17 15h4"/>',
    heart:'<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5a5.5 5.5 0 0 0 1-8.9z"/>',
    home:'<path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10"/>',
    lock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    pause:'<path d="M9 5v14"/><path d="M15 5v14"/>',
    play:'<path d="m8 5 11 7-11 7z"/>',
    plus:'<path d="M12 5v14"/><path d="M5 12h14"/>',
    search:'<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
    send:'<path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>',
    smile:'<circle cx="12" cy="12" r="9"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><path d="M9 9h.01M15 9h.01"/>',
    sound:'<path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15 9a4 4 0 0 1 0 6"/><path d="M18 6a8 8 0 0 1 0 12"/>',
    user:'<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    users:'<circle cx="9" cy="8" r="3"/><path d="M3 19a6 6 0 0 1 12 0"/><path d="M16 5a3 3 0 0 1 0 6M17 14a5 5 0 0 1 4 5"/>'
  };
  return `<svg class="icon icon-${name}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p[name]||""}</svg>`;
}

function logoHtml(compact=false){
  return `<div class="logo" aria-label="CheburekWatch"><span class="logo-mark">Ч</span>${compact?"":'<span>CHEBUREK<span>WATCH</span></span>'}</div>`;
}

function avatarHtml(name,size="md"){
  const safe=esc(name||"?");
  return `<div class="avatar avatar-${size}" title="${safe}">${esc(String(name||"?").slice(0,1).toUpperCase())}</div>`;
}

function headerHtml(){
  const path=location.pathname;
  const activeHome=path==="/";
  const activeRooms=path==="/rooms";
  return `<header class="header"><div class="container header-inner">
    <a href="/" data-nav class="logo-button">${logoHtml()}</a>
    <nav class="desktop-nav">
      <a class="btn btn-ghost ${activeHome?"active":""}" href="/" data-nav>Главная</a>
      <a class="btn btn-ghost ${activeRooms?"active":""}" href="${me?"/rooms":"/login"}" data-nav>Комнаты</a>
    </nav>
    <div class="header-actions">
      ${me?`<button class="btn btn-secondary" data-create>${cwIcon("plus")}<span class="btn-label">ОТКРЫТЬ КОМНАТУ</span></button>
      <a class="btn btn-icon" href="/profile" data-nav aria-label="Профиль">${avatarHtml(me.nickname,"sm")}</a>`:`<a class="btn btn-secondary" href="/login" data-nav>Войти</a>`}
    </div>
  </div></header>`;
}

function bottomNavHtml(){
  if(!me) return "";
  const p=location.pathname;
  return `<nav class="bottom-nav">
    <a class="btn btn-ghost ${p==="/"?"active":""}" href="/" data-nav>${cwIcon("home")}<span>Главная</span></a>
    <a class="btn btn-ghost ${p==="/rooms"?"active":""}" href="/rooms" data-nav>${cwIcon("search")}<span>Комнаты</span></a>
    <a class="btn btn-ghost ${p==="/profile"?"active":""}" href="/profile" data-nav>${cwIcon("user")}<span>Профиль</span></a>
  </nav>`;
}

function roomVisual(index=0){
  const i=figmaImages();
  const images=[i.mountain,i.redEye,i.forest,i.portrait,i.road,i.lake];
  return {image:images[index%images.length]};
}

function roomCardHtml(r,index=0){
  const v=roomVisual(index);
  const title=`Комната ${esc(r.code)}`;
  const film=r.media?(r.media.type==="youtube"?"YouTube":r.media.type==="vk"?"VK Video":"Видео файл"):"Фильм ещё не выбран";
  const viewers=Number(r.participantCount||0);
  const status=r.media?"Готова к просмотру":"Ждёт фильм";
  const search=esc(`${title} ${film} ${r.code||""}`.toLowerCase());
  return `<article class="room-card reveal" data-search="${search}" style="animation-delay:${index*60}ms"><div class="poster">
    <img src="${v.image}" alt=""><div class="poster-shade"></div><span class="badge">Комната</span>
    <span class="room-status"><i></i>${esc(status)}</span>
    <div class="poster-meta"><span class="viewers">${cwIcon("users",16)} ${viewers} ${viewers===1?"участник":"участников"} сейчас</span><h3>${title}</h3><p>${esc(film)}</p>
      ${r.ownerId===me?.id?'<span class="room-host">Вы создатель</span>':""}
      <button class="btn btn-paper" type="button" data-open="${esc(r.code)}">Войти ${cwIcon("arrow",17)}</button></div>
  </div></article>`;
}

function emptyStateHtml(){
  return `<div class="empty-state"><div class="empty-projector"><i></i><span></span></div><span class="eyebrow">Антракт</span><h3>Здесь пока тихо</h3><p>Друзья ещё выбирают кино. Можно начать сеанс первым — лучшие места свободны.</p></div>`;
}

function joinByCode(code,errorTarget){
  code=String(code||"").trim().toUpperCase();
  if(!/^[A-Z0-9]{6}$/.test(code)){
    if(errorTarget) errorTarget.innerHTML='<div class="error">Код комнаты — 6 символов.</div>';
    return Promise.resolve(false);
  }
  if(!me){ navigate("/login?code="+encodeURIComponent(code)); return Promise.resolve(false); }
  return api(`/api/rooms/${code}/join`,{method:"POST"}).then(()=>{navigate("/room/"+code);return true}).catch(err=>{if(errorTarget)errorTarget.innerHTML=`<div class="error">${esc(err.message)}</div>`;else toast(err.message);return false});
}

function openCreateRoomModal(){
  if(!me){navigate("/login");return}
  document.querySelector(".modal-backdrop")?.remove();
  const i=figmaImages();
  const wrap=document.createElement("div");
  wrap.className="modal-backdrop";
  wrap.innerHTML=`<div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
    <div class="modal-head"><div><span class="eyebrow">НОВАЯ ГЛАВА</span><h2 class="modal-title" id="modal-title">ОТКРЫТЬ КОМНАТУ</h2></div><button class="btn btn-icon" data-close-modal aria-label="Закрыть">${cwIcon("close")}</button></div>
    <div class="modal-poster"><img src="${archivePhoto(2)}" alt=""><div><span>Источник можно выбрать сейчас или уже внутри комнаты</span><h3>КАКОЙ КАДР ОТКРОЕТ ГЛАВУ?</h3><button class="btn btn-paper" type="button" id="pickMovie">${cwIcon("search")}Выбрать кино</button></div></div>
    <label class="field"><span>ИМЯ ГЛАВЫ</span><input id="newRoomName" placeholder="Название вашей главы" maxlength="60"></label>
    <div class="privacy-options">
      <button class="selected" type="button" data-privacy="private">${cwIcon("lock")}<span><strong>ЗАКРЫТАЯ ГЛАВА</strong>Вход только по коду или приглашению</span><i>${cwIcon("check",15)}</i></button>
      <button type="button" data-privacy="open">${cwIcon("users")}<span><strong>ОТКРЫТАЯ ГЛАВА</strong>Её увидят участники с доступом</span><i></i></button>
    </div>
    <div id="createRoomErr"></div><div class="modal-actions"><button class="btn btn-ghost" data-close-modal>Отмена</button><button class="btn btn-primary" id="createRoomSubmit">${cwIcon("play")}<span class="btn-label">ОТКРЫТЬ ГЛАВУ</span></button></div>
  </div>`;
  document.body.appendChild(wrap);
  const close=()=>wrap.remove();
  wrap.addEventListener("mousedown",e=>{if(e.target===wrap)close()});
  wrap.querySelectorAll("[data-close-modal]").forEach(b=>b.addEventListener("click",close));
  wrap.querySelectorAll("[data-privacy]").forEach(b=>b.addEventListener("click",()=>{
    wrap.querySelectorAll("[data-privacy]").forEach(x=>{x.classList.remove("selected");x.querySelector("i").innerHTML=""});
    b.classList.add("selected");b.querySelector("i").innerHTML=cwIcon("check",15);
  }));
  wrap.querySelector("#pickMovie")?.addEventListener("click",()=>toast("Кино можно добавить сразу после входа в комнату"));
  wrap.querySelector("#createRoomSubmit").addEventListener("click",async()=>{
    const btn=wrap.querySelector("#createRoomSubmit");
    btn.disabled=true;btn.classList.add("is-loading");btn.innerHTML='<span class="button-loader"></span><span class="btn-label">Создаём…</span>';
    try{
      const d=await api("/api/rooms",{method:"POST"});
      btn.classList.remove("is-loading");btn.classList.add("is-success");btn.innerHTML=`${cwIcon("check")}<span class="btn-label">Готово</span>`;
      setTimeout(()=>{close();navigate("/room/"+d.room.code)},420);
    }catch(e){btn.disabled=false;btn.classList.remove("is-loading");btn.innerHTML=`${cwIcon("play")}<span class="btn-label">ОТКРЫТЬ ГЛАВУ</span>`;wrap.querySelector("#createRoomErr").innerHTML=`<div class="error">${esc(e.message)}</div>`}
  });
}

function openAccountModal(){
  document.querySelector(".account-modal")?.remove();
  const wrap=document.createElement("div");
  wrap.className="modal-backdrop account-modal";
  wrap.innerHTML=`<div class="modal account-card"><div class="modal-head"><div><span class="eyebrow">Профиль</span><h2 class="modal-title">${esc(me.nickname)}</h2></div><button class="btn btn-icon" data-close-account>${cwIcon("close")}</button></div><p class="account-copy">Уровень ${me.level} · ${esc(me.secretPrefix||me.prefix||"Зритель")}</p><div class="modal-actions"><button class="btn btn-ghost" data-close-account>Закрыть</button><button class="btn btn-secondary" id="logoutAccount">Выйти</button></div></div>`;
  document.body.appendChild(wrap);
  const close=()=>wrap.remove();
  wrap.querySelectorAll("[data-close-account]").forEach(b=>b.onclick=close);
  wrap.addEventListener("mousedown",e=>{if(e.target===wrap)close()});
  wrap.querySelector("#logoutAccount").onclick=async()=>{await api("/api/logout",{method:"POST"});me=null;close();navigate("/")};
}

async function landingPage(){
  let realRooms=[];
  if(me){try{realRooms=(await api("/api/my-rooms")).rooms||[]}catch{}}
  const roomSection=me
    ? `<section class="section container room-preview-section"><div class="section-head"><div><span class="eyebrow">ВАШИ ГЛАВЫ</span><h2>ПРОДОЛЖИТЬ АРКУ</h2></div><a class="btn btn-ghost" href="/rooms" data-nav>ВСЕ ГЛАВЫ ${cwIcon("arrow")}</a></div>
       <div class="rooms-grid featured">${realRooms.length?realRooms.slice(0,4).map((r,n)=>roomCardHtml(r,n)).join(""):emptyStateHtml()}</div>${easterPhotoHtml(4,"archive-room-peek")}</section>`
    : `<section class="section container room-preview-section"><div class="section-head"><div><span class="eyebrow">СИНХРОННАЯ АРКА</span><h2>ЗДЕСЬ НАЧНЁТСЯ ВАША ИСТОРИЯ</h2></div></div>
       <div class="empty-state"><div class="empty-projector"><i></i><span></span></div><span class="eyebrow">ПУСТОЙ КАДР</span><h3>ПЕРВАЯ ГЛАВА ЕЩЁ НЕ ОТКРЫТА</h3><p>Войдите, откройте комнату и дайте друзьям код. Дальше сюжет разберётся сам.</p><a class="btn btn-primary" href="/login" data-nav>Войти</a></div>${easterPhotoHtml(4,"archive-room-peek")}</section>`;

  const heroMedia=sessionStorage.getItem("cw-main-intro-played")==="1"
    ? `<img class="hero-image hero-final-frame" src="${SITE_ASSETS.heroFinal}" alt="">`
    : `<video id="mainHeroVideo" class="hero-image hero-main-video" src="${SITE_ASSETS.heroVideo}" poster="${SITE_ASSETS.heroFinal}" muted playsinline preload="auto"></video>`;

  shell(`<main>
    <section class="hero archive-hero">${heroMedia}<div class="hero-overlay"></div>
      <div class="hero-archive-stack" aria-hidden="true"><span style="background-image:url('${archivePhoto(3)}')"></span><span style="background-image:url('${archivePhoto(1)}')"></span></div>
      <div class="container hero-content reveal"><span class="hero-kicker"><i></i> АКТ I · СИНХРОН АКТИВИРУЕТСЯ</span><h1>ОДИН КАДР.<br><em>ОДНА ВОЛЯ.</em></h1>
      <p>Запускайте фильм одновременно, держите общий ритм и превращайте обычный просмотр в свою безумную экранную арку.</p>
      <div class="hero-actions"><button class="btn btn-primary" data-create>${cwIcon("play")}<span class="btn-label">ОТКРЫТЬ КОМНАТУ</span></button><a class="btn btn-secondary" href="${me?"/rooms":"/login"}" data-nav>ВОЙТИ ПО КОДУ ${cwIcon("arrow")}</a></div></div>
      ${easterPhotoHtml(0,"archive-hero-easter")}
    </section>
    ${photoGradientBandHtml()}
    ${roomSection}
    ${ambientVideoStripHtml()}
    <section class="manifesto archive-manifesto"><div class="container manifesto-grid"><div class="manifesto-image"><img src="${archivePhoto(5)}" alt=""><span>ОДИН ЭКРАН<br>НА ВСЕХ</span>${easterPhotoHtml(2,"archive-manifesto-easter")}</div>
      <div class="manifesto-copy"><span class="eyebrow">АКТ III · БЕЗ РАССТОЯНИЙ</span><h2>КАЖДЫЙ КАДР —<br>ОБЩИЙ УДАР ПО ТАЙМЛАЙНУ.</h2>
      <div class="feature-list"><div><b>01</b><span><strong>СИНХРОН БЕЗ КОМПРОМИССОВ</strong>Пауза, перемотка и продолжение происходят вместе — никаких параллельных реальностей.</span></div><div><b>02</b><span><strong>РЕПЛИКИ НЕ ПРОПАДАЮТ</strong>РЕПЛИКИ и реакции живут рядом с экраном, как комментарии на полях манги.</span></div><div><b>03</b><span><strong>КОД ДЛЯ СВОИХ</strong>Один код — и ваша компания уже внутри этой главы.</span></div></div></div></div></section>
    <section class="club-notes container archive-notes"><div class="club-note-copy"><span class="eyebrow">ЛИЧНАЯ АРКА</span><h2>СМОТРИТЕ ДАЛЬШЕ.<br>УСИЛИВАЙТЕ ХРОНИКУ.</h2><p>Уровень, минуты и знаки отличия растут только из реальных совместных просмотров.</p></div>
      <div class="club-collage archive-collage"><img src="${archivePhoto(0)}" alt=""><img src="${archivePhoto(4)}" alt=""><img src="${archivePhoto(2)}" alt=""><span class="ticket">CHEBUREK<br><small>WATCH PARTY</small></span>${easterPhotoHtml(5,"archive-note-easter")}</div></section>
  </main>`);
  setupMainHeroVideo();
  setupAmbientVideos();
  document.querySelectorAll("[data-open]").forEach(b=>b.addEventListener("click",async()=>{b.disabled=true;try{await api(`/api/rooms/${b.dataset.open}/join`,{method:"POST"});navigate("/room/"+b.dataset.open)}catch(e){toast(e.message);b.disabled=false}}));
}

function shell(content,opts={}){
  const p=location.pathname;
  document.body.dataset.cwPage=p.startsWith("/room/")?"watch":p==="/profile"?"profile":p==="/rooms"?"rooms":p==="/login"||p==="/register"?"auth":"home";
  const showHeader=opts.header!==false;
  const showBottom=opts.bottom!==false && location.pathname!=="/login" && location.pathname!=="/register" && !location.pathname.startsWith("/room/");
  app.innerHTML=`<div class="app"><div class="page-stage">${showHeader?headerHtml():""}${content}${showBottom?bottomNavHtml():""}</div><div class="page-curtain"></div></div>`;
  document.querySelectorAll("[data-nav]").forEach(a=>a.addEventListener("click",e=>{e.preventDefault();navigate(a.getAttribute("href"))}));
  document.querySelectorAll("[data-create]").forEach(b=>b.addEventListener("click",()=>me?openCreateRoomModal():navigate("/login")));
  document.querySelectorAll("[data-demo-open]").forEach(b=>b.addEventListener("click",()=>navigate(me?"/rooms":"/login")));
}

function mountCinemaIntro(){}
function authPage(mode){
  shell(`<main class="auth-page"><div class="auth-visual archive-auth-visual"><img src="${archivePhoto(3)}" alt=""><div class="auth-visual-film"><video class="ambient-video" src="${SITE_ASSETS.videos[1]}" poster="${archivePhoto(3)}" muted playsinline loop preload="metadata"></video></div><div class="auth-quote"><span>СЕАНС / CHEBUREK</span><h2>Истории становятся<br>настоящими, когда<br>ими делятся.</h2></div>${easterPhotoHtml(1,"archive-auth-easter")}</div>
    <div class="auth-form-wrap"><div class="auth-mobile-logo">${logoHtml()}</div><a class="btn btn-ghost auth-back" href="/" data-nav>${cwIcon("back")}На главную</a>
      <form class="auth-form" id="authform"><span class="eyebrow">${mode==="login"?"ВОЗВРАЩЕНИЕ ГЕРОЯ":"НОВАЯ ГЛАВА"}</span><h1>${mode==="login"?"ПРОДОЛЖИМ ЭТУ ИСТОРИЮ?":"ВЫБЕРИТЕ СВОЮ ПОЗИЦИЮ"}</h1><p>${mode==="login"?"Вернитесь в свою хронику или ворвитесь прямо в комнату по коду.":"Создайте профиль — это будет ваша личная линия в общей экранной истории."}</p>
      <div class="auth-tabs"><a class="btn btn-ghost ${mode==="login"?"active":""}" href="/login" data-nav>Вход</a><a class="btn btn-ghost ${mode==="register"?"active":""}" href="/register" data-nav>Регистрация</a></div>
      <label class="field"><span>Никнейм</span><input id="nick" autocomplete="username" maxlength="24" placeholder="Как вас называть?" required></label>
      <label class="field"><span>Пароль</span><input id="pass" type="password" autocomplete="${mode==="login"?"current-password":"new-password"}" minlength="8" placeholder="Не менее 8 символов" required></label>
      <div id="formerr"></div><button class="btn btn-primary full" type="submit"><span class="btn-label">${mode==="login"?"Войти":"Создать аккаунт"}</span>${cwIcon("arrow")}</button>
      <div class="or"><span>или</span></div><label class="field"><span>Код комнаты</span><input id="authRoomCode" placeholder="Например: KINO24" maxlength="6"></label><button class="btn btn-secondary full" id="authJoin" type="button">ВОЙТИ ПО КОДУ</button><div id="joinerr"></div>
      </form></div></main>`,{header:false,bottom:false});
  setupAmbientVideos();
  const q=new URLSearchParams(location.search).get("code");if(q)$("#authRoomCode").value=q.toUpperCase();
  $("#authform").onsubmit=async e=>{e.preventDefault();try{const d=await api(mode==="login"?"/api/login":"/api/register",{method:"POST",body:{nickname:$("#nick").value,password:$("#pass").value}});me=d.user;const code=$("#authRoomCode").value.trim();if(code)await joinByCode(code,$("#joinerr"));else navigate("/rooms")}catch(err){$("#formerr").innerHTML=`<div class="error">${esc(err.message)}</div>`}};
  $("#authJoin").onclick=()=>{if(me)joinByCode($("#authRoomCode").value,$("#joinerr"));else $("#joinerr").innerHTML='<div class="error">Сначала войдите или создайте аккаунт, затем используйте код комнаты.</div>'};
}

async function roomsPage(){
  const d=await api("/api/my-rooms");
  shell(`<main class="page container rooms-archive-page"><div class="browse-top reveal"><div><span class="eyebrow">ВАШИ ГЛАВЫ</span><h1>ВЫБЕРИТЕ ГЛАВУ</h1><p>Никаких декораций: здесь только реальные комнаты, к которым у вас есть доступ.</p></div><button class="btn btn-primary" data-create>${cwIcon("plus")}<span class="btn-label">НОВАЯ ГЛАВА</span></button></div>
    <div class="filter-row real-room-search"><label class="search-box">${cwIcon("search")}<input id="roomSearch" placeholder="Найти главу или ввести код"></label></div>
    <div id="roomsGrid" class="rooms-grid browse-grid">${d.rooms.length?d.rooms.map((r,n)=>roomCardHtml(r,n)).join(""):emptyStateHtml()}</div>
    <aside class="rooms-archive-easters">${easterPhotoHtml(1,"rooms-peek-a")}${easterPhotoHtml(3,"rooms-peek-b")}${easterPhotoHtml(5,"rooms-peek-c")}</aside>
  </main>`);
  document.querySelectorAll("[data-open]").forEach(b=>b.addEventListener("click",async()=>{b.disabled=true;try{await api(`/api/rooms/${b.dataset.open}/join`,{method:"POST"});navigate("/room/"+b.dataset.open)}catch(e){toast(e.message);b.disabled=false}}));
  const search=$("#roomSearch");
  search.addEventListener("input",()=>{const q=search.value.trim().toLowerCase();document.querySelectorAll(".room-card[data-search]").forEach(c=>c.hidden=q&&!c.dataset.search.includes(q))});
  search.addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();const v=search.value.trim().toUpperCase();if(/^[A-Z0-9]{6}$/.test(v))joinByCode(v)}});
}

async function createRoom(){openCreateRoomModal()}
async function profilePage(){
  const d=await api("/api/profile");me=d.user;
  const next=me.minutesToNext||20,hours=Math.floor((me.watchMinutes||0)/60),mins=(me.watchMinutes||0)%60,unlocked=d.user.achievements.length;
  const firstAchievements=d.user.availableAchievements.slice(0,3);
  shell(`<main class="profile-page warning-profile"><section class="profile-hero"><img src="${SITE_ASSETS.warning.banner}" alt=""><div class="profile-shade"></div><div class="warning-stamp">PROFILE / WATCHER</div><div class="container profile-info">${avatarHtml(me.nickname,"lg")}<div class="profile-name"><span class="eyebrow">ХРОНИКА ЗРИТЕЛЯ</span><h1>${esc(me.nickname)}</h1><p>@${esc(me.nickname.toLowerCase().replace(/\s+/g,""))} · ${esc(me.secretPrefix||me.prefix||"зритель")}</p></div><button class="btn btn-secondary" id="profileSettings">НАСТРОИТЬ ХРОНИКУ</button></div></section>
    <div class="container profile-content"><section class="level-card warning-level-card"><div class="level-number">${String(me.level).padStart(2,"0")}</div><div class="level-copy"><span>УРОВЕНЬ</span><h3>${esc(me.secretPrefix||me.prefix||"Зритель")}</h3><div class="progress"><i style="width:${Math.max(0,Math.min(100,Number(me.progress||0)))}%"></i></div><p>${next} мин. до следующего уровня</p></div><div class="stats"><div><strong>${me.watchMinutes||0}</strong><span>Минут</span></div><div><strong>${hours}ч ${mins}м</strong><span>Просмотра</span></div><div><strong>${unlocked}</strong><span>Наград</span></div></div></section>

    <section class="profile-warning-gallery"><article class="warning-art warning-art-main"><img src="${SITE_ASSETS.warning.warning2}" alt=""><div><span>WARNING / 01</span><b>ЛИЧНАЯ ПАНЕЛЬ</b><small>Профиль собран из вашего архива: цвет, настроение и характер принадлежат только этой истории.</small></div></article><article class="warning-art"><img src="${SITE_ASSETS.warning.arthur}" alt=""><div><span>WARNING / 02</span><b>СКРЫТАЯ ПАНЕЛЬ</b><small>Редкий кадр спрятан внутри композиции и появляется как небольшая пасхалка.</small></div></article></section>

    <section class="profile-section"><div class="section-head"><div><span class="eyebrow">АРСЕНАЛ ДОСТИЖЕНИЙ</span><h2>ЗНАКИ СИЛЫ</h2></div></div><div class="achievements">${firstAchievements.length?firstAchievements.map((a,n)=>`<div><b>${["01","02","03"][n]||"•"}</b><span><strong>${esc(a.title)}</strong>${esc(a.desc)}</span></div>`).join(""):`<div><b>○</b><span><strong>ПУСТОЙ КАДР</strong>Достижения появятся после реальных просмотров</span></div>`}</div></section>
    <aside class="profile-archive-easters">${easterPhotoHtml(0,"profile-peek-a")}${easterPhotoHtml(4,"profile-peek-b")}</aside>
    <section class="profile-section profile-real-note"><div class="empty-state"><div class="empty-projector"><i></i><span></span></div><span class="eyebrow">ХРОНИКА ПРОСМОТРОВ</span><h3>ТОЛЬКО КАНОНИЧНЫЕ ДАННЫЕ</h3><p>Пока сервер не хранит отдельную историю фильмов и избранное — значит, никаких выдуманных сцен здесь не будет.</p></div></section>
    </div></main>`);
  $("#profileSettings").onclick=openAccountModal;
}

function playerHtml(media){
  if(!media)return `<div class="emptyvideo"><img src="${archivePhoto(1)}" alt=""><div class="emptyvideo-shade"></div><div class="emptyvideo-copy"><span>КАДР ЕЩЁ НЕ ВЫБРАН</span><b>ЭКРАН ЖДЁТ СВОЮ ГЛАВУ</b><small>Откройте «СМЕНИТЬ КИНО» и дайте комнате источник: YouTube, VK Video или прямой файл.</small></div></div>`;
  if(media.type==="youtube")return `<div class="player-frame yt-stage" id="yt"><div class="player-loading">Подключаем видео…</div></div>`;
  if(media.type==="vk")return `<iframe class="player-frame" id="vkframe" allow="autoplay; encrypted-media; fullscreen; picture-in-picture" allowfullscreen src="${esc(media.url)}"></iframe>`;
  return `<video class="player-frame" id="htmlvideo" playsinline preload="metadata" controls src="${esc(media.url)}"></video>`;
}
async function roomPage(code){
  try{
    const d=await api(`/api/rooms/${encodeURIComponent(code)}`);room=d.room;
    const people=room.users||[],label=room.media?(room.media.type==="youtube"?"YouTube":room.media.type==="vk"?"VK Video":"Видео"):"Кадр не выбран";
    shell(`<main class="watch-page"><div class="watch-header container"><a class="btn btn-ghost" href="/rooms" data-nav>${cwIcon("back")}<span>Комнаты</span></a><div class="room-title"><div><h3>Комната ${esc(room.code)}</h3><span>${people.length} ${people.length===1?"участник":"участников"} сейчас</span></div></div><div class="participant-stack">${people.slice(0,3).map(u=>avatarHtml(u.nickname)).join("")}${people.length>3?`<span>+${people.length-3}</span>`:""}</div></div>
      <div class="watch-layout container roomlayout ${room.media?"has-media":"needs-media"}"><section class="player-column"><div class="player video-shell" id="videobox">${playerHtml(room.media)}<div class="movie-label"><span>${room.media?"ИСТОЧНИК АКТИВИРОВАН":"КАДР ЕЩЁ НЕ ВЫБРАН"}</span><strong>${esc(label)}</strong></div><div class="player-overlay" id="playerOverlay"><button type="button" class="player-chat-toggle" id="playerChatToggle">${cwIcon("chat")}</button><button type="button" class="player-fullscreen" id="playerFullscreen">${cwIcon("expand")}</button><div class="overlay-chat" id="overlayChat"><div class="overlay-head"><b>РЕПЛИКИ</b><button id="overlayClose">×</button></div><div class="overlay-messages" id="overlayMessages"></div><form id="overlayForm"><input id="overlayInput" maxlength="500" placeholder="Написать сообщение…"><button type="submit">${cwIcon("send",17)}</button></form></div></div></div>
      <div class="player-controls"><button class="btn btn-icon" id="seekBack" aria-label="Назад на 10 секунд">${cwIcon("back")}</button><button class="btn btn-icon" id="playerToggle" aria-label="Воспроизвести">${cwIcon(room.playing?"pause":"play")}</button><span class="player-sync-note">СИНХРОН</span><button class="btn btn-icon" aria-label="Громкость">${cwIcon("sound")}</button><button class="btn btn-icon" id="playerFullscreenBottom" aria-label="На весь экран">${cwIcon("expand")}</button></div>
      <div class="under-player"><div><h3>${esc(label)}</h3><span>Комната ${esc(room.code)}</span></div><div class="reaction-row"><button class="btn btn-secondary" data-room-reaction="♥">${cwIcon("heart")}</button><button class="btn btn-secondary" data-room-reaction="ХА">${cwIcon("smile")}</button><button class="btn btn-primary" id="movieSelectorToggle">${cwIcon("film")}<span class="btn-label">СМЕНИТЬ КИНО</span></button></div></div>
      <div class="movie-selector" id="movieSelector" hidden><div class="selector-head"><div><span class="eyebrow">НОВЫЙ КАДР</span><h3>СМЕНИТЬ ИСТОЧНИК</h3></div><button class="btn btn-icon" id="movieSelectorClose">${cwIcon("close")}</button></div><p class="selector-note">Вставьте ссылку YouTube, VK Video или прямую ссылку на видео. Изменение СИНХРОНизируется для комнаты.</p><form id="mediaform" class="mediaform"><input id="mediaurl" placeholder="YouTube / VK / прямая ссылка" required><button class="btn btn-primary">${cwIcon("play")}<span class="btn-label">ЗАПУСТИТЬ КАДР</span></button></form><div id="mediaerr"></div></div>
      </section>
      <aside class="chat-panel"><div class="chat-head"><div><h3>РЕПЛИКИ</h3><span>${people.length} в комнате</span></div><div class="chat-head-actions"><button class="btn btn-ghost" id="invite">ПОЗВАТЬ</button><button class="btn btn-icon" id="peopleToggle" aria-label="Участники">${cwIcon("users")}</button></div></div>
      <div class="participants-popover" id="peoplePopover" hidden><div id="people">${peopleHtml(people)}</div>${room.ownerId===me.id?`<button id="deleteRoom" class="btn btn-ghost danger-text">Удалить комнату</button>`:""}<button id="creatorBtn" class="btn btn-ghost">Создатель</button></div>
      <div class="messages" id="messages"></div><div class="reaction-picker"><button type="button" data-chat-reaction="♥">♥</button><button type="button" data-chat-reaction="😂">😂</button><button type="button" data-chat-reaction="🔥">🔥</button><button type="button" data-chat-reaction="😮">😮</button></div><form id="chatform" class="chat-input"><input id="chatinput" maxlength="500" placeholder="Написать сообщение..."><button class="btn btn-icon" type="submit" aria-label="Отправить">${cwIcon("send")}</button></form></aside></div>
    </main>`,{bottom:false});
    bindRoom(code);
    $("#peopleToggle").onclick=()=>{$("#peoplePopover").hidden=!$("#peoplePopover").hidden};
    const selector=$("#movieSelector"),toggle=$("#movieSelectorToggle");
    toggle.onclick=()=>{selector.hidden=!selector.hidden;toggle.classList.toggle("active",!selector.hidden)};
    $("#movieSelectorClose").onclick=()=>{selector.hidden=true;toggle.classList.remove("active")};
    document.querySelectorAll("[data-room-reaction]").forEach(b=>b.onclick=()=>{const f=document.createElement("span");f.className="floating-reaction";f.textContent=b.dataset.roomReaction;$("#videobox").appendChild(f);setTimeout(()=>f.remove(),1150)});
    $("#playerFullscreenBottom").onclick=()=>$("#playerFullscreen")?.click();
    $("#playerToggle").onclick=()=>{const playing=!room.playing;room.playing=playing;try{if(player?.playVideo)playing?player.playVideo():player.pauseVideo();else if(vkPlayer?.play)playing?vkPlayer.play():vkPlayer.pause();else if(localVideo)playing?localVideo.play().catch(()=>{}):localVideo.pause()}catch{}sendState(playing,getPosition(),playing?"play":"pause");$("#playerToggle").innerHTML=cwIcon(playing?"pause":"play")};
    $("#seekBack").onclick=()=>{const p=Math.max(0,getPosition()-10);applyPosition(p);sendState(!!room.playing,p,"seek")};
  }catch(e){shell(`<main class="page container"><div class="error">${esc(e.message)}</div><a class="btn btn-secondary" href="/rooms" data-nav>Вернуться к комнатам</a></main>`)}
}
function peopleHtml(users){
  return users.length?users.map(u=>`<div class="person">${avatarHtml(u.nickname,"sm")}<div><div>${esc(u.nickname)}</div><div class="level">${esc(u.secretPrefix||u.prefix||"Зритель")} · ур. ${u.level}</div></div>${u.id===me.id?'<span class="level">(вы)</span>':""}</div>`).join(""):`<span class="muted small">Никого онлайн</span>`;
}
async function bindRoom(code){
  const inviteUrl=location.origin+"/room/"+code;
  $("#invite").onclick=async()=>{try{await navigator.clipboard.writeText(inviteUrl);const b=$("#invite");b.innerHTML="✓ <span>Скопировано</span>";setTimeout(()=>b.innerHTML="↗ <span>ПОЗВАТЬ</span>",1500)}catch{prompt("Ссылка на комнату",inviteUrl)}};
  $("#creatorBtn")?.addEventListener("click",()=>openCreatorPanel(code));
  $("#deleteRoom")?.addEventListener("click",async()=>{if(!confirm(`Удалить комнату ${code}? Это действие нельзя отменить.`))return;try{await api(`/api/rooms/${code}`,{method:"DELETE"});navigate("/rooms")}catch(e){alert(e.message)}});
  $("#mediaform").onsubmit=async e=>{e.preventDefault();try{const d=await api(`/api/rooms/${code}/media`,{method:"POST",body:JSON.stringify({url:$("#mediaurl").value})});room=d.room;mountMedia();$("#mediaurl").value=""}catch(err){$("#mediaerr").innerHTML=`<div class="error">${esc(err.message)}</div>`}};
  const sendChat=async(text)=>{text=String(text||"").trim();if(!text)return;try{await api(`/api/rooms/${code}/messages`,{method:"POST",body:{text}});$("#chatinput").value="";$("#overlayInput").value=""}catch(err){toast(err.message)}};
  $("#chatform").onsubmit=async e=>{e.preventDefault();await sendChat($("#chatinput").value)};
  $("#overlayForm")?.addEventListener("submit",async e=>{e.preventDefault();await sendChat($("#overlayInput").value)});
  $("#playerChatToggle")?.addEventListener("click",()=>$("#overlayChat")?.classList.toggle("open"));
  $("#overlayClose")?.addEventListener("click",()=>$("#overlayChat")?.classList.remove("open"));
  $("#playerFullscreen")?.addEventListener("click",async()=>{const target=$("#videobox");try{if(document.fullscreenElement)await document.exitFullscreen();else await target.requestFullscreen()}catch{}});
  initMobileRoomSplit();
  document.querySelectorAll("[data-chat-reaction]").forEach(b=>b.onclick=()=>{const input=$("#chatinput");input.value += b.dataset.chatReaction;input.focus()});
  try{const m=await api(`/api/rooms/${code}/messages`);renderMessages(m.messages)}catch{}
  if(eventSource) eventSource.close();
  eventSource=new EventSource(`/api/rooms/${code}/events`);
  eventSource.addEventListener("room",e=>{const next=JSON.parse(e.data),oldMedia=room?.media?.url;room={...room,...next};$("#people").innerHTML=peopleHtml(next.users||[]);if((next.media?.url||null)!==(oldMedia||null))mountMedia();});
  eventSource.addEventListener("media",e=>{const m=JSON.parse(e.data).media||null;const old=room?.media?.url||null;room.media=m;if((m?.url||null)!==old)mountMedia();});
  eventSource.addEventListener("deleted",()=>{eventSource?.close();eventSource=null;room=null;navigate("/rooms")});
  eventSource.addEventListener("state",e=>applyRemoteState(JSON.parse(e.data)));
  eventSource.addEventListener("presence",e=>$("#people").innerHTML=peopleHtml(JSON.parse(e.data)));
  eventSource.addEventListener("message",e=>appendMessage(JSON.parse(e.data)));
  eventSource.addEventListener("reaction",e=>updateMessageReactions(JSON.parse(e.data)));
  eventSource.onerror=()=>{ /* EventSource автоматически переподключится; heartbeat остаётся fallback-СИНХРОНизацией */ };
  clearInterval(window.__cwHeartbeat); window.__cwHeartbeat=setInterval(async()=>{try{const h=await api(`/api/rooms/${code}/heartbeat`,{method:"POST"});if(h.user){me=h.user;document.querySelectorAll(".level-badge").forEach(x=>x.textContent=`ур. ${me.level}`)} if(h.state && h.state.stateBy!==me?.id) applyRemoteState(h.state)}catch{}},5000);
  clearInterval(window.__cwMessageRefresh); window.__cwMessageRefresh=setInterval(async()=>{
    if(document.hidden || !room?.code)return;
    try{const md=await api(`/api/rooms/${code}/messages`); const box=$("#messages"); if(!box)return; const existing=[...box.querySelectorAll("[data-mid]")].map(x=>x.dataset.mid).join(","); const incoming=(md.messages||[]).map(x=>String(x.id)).join(","); if(existing!==incoming) renderMessages(md.messages||[]);}catch{}
  },8000);
  try { const md=await api(`/api/rooms/${code}/media`); if(md.room) room={...room,...md.room}; if(md.media) room.media=md.media; } catch {}
  mountMedia();
}
function initMobileRoomSplit(){
  const layout=document.querySelector(".roomlayout.mobile-resizable");
  const splitter=document.querySelector("#mobileSplitter");
  if(!layout||!splitter)return;
  const key="cw-mobile-split";
  const saved=Number(localStorage.getItem(key));
  if(saved>=28&&saved<=72) layout.style.setProperty("--mobile-split",saved+"%");
  let dragging=false;
  const setFromY=(clientY)=>{
    const rect=layout.getBoundingClientRect();
    if(!rect.height)return;
    const pct=Math.max(28,Math.min(72,((clientY-rect.top)/rect.height)*100));
    layout.style.setProperty("--mobile-split",pct.toFixed(1)+"%");
    localStorage.setItem(key,pct.toFixed(1));
  };
  const stop=()=>{
    dragging=false;
    splitter.classList.remove("is-dragging");
    document.body.classList.remove("cw-split-dragging");
  };
  splitter.addEventListener("pointerdown",e=>{
    if(window.matchMedia("(min-width: 801px)").matches)return;
    dragging=true;
    splitter.classList.add("is-dragging");
    document.body.classList.add("cw-split-dragging");
    splitter.setPointerCapture?.(e.pointerId);
    setFromY(e.clientY);
    e.preventDefault();
  });
  splitter.addEventListener("pointermove",e=>{if(dragging){setFromY(e.clientY);e.preventDefault();}});
  splitter.addEventListener("pointerup",stop);
  splitter.addEventListener("pointercancel",stop);
  splitter.addEventListener("lostpointercapture",stop);
}
function toast(message){
  let t=document.querySelector(".cw-toast");
  if(!t){t=document.createElement("div");t.className="toast cw-toast";t.setAttribute("role","status");document.body.appendChild(t)}
  t.innerHTML=`<span>${cwIcon("check",15)}</span><div><strong>${esc(message)}</strong><small>СЮЖЕТ ПРОДОЛЖАЕТСЯ</small></div>`;
  t.classList.remove("show");void t.offsetWidth;t.classList.add("show");clearTimeout(t._t);t._t=setTimeout(()=>{t.classList.remove("show");setTimeout(()=>t.remove(),320)},2700);
}
function openCreatorPanel(code){
  document.querySelector(".creator-modal")?.remove();
  const modal=document.createElement("div"); modal.className="creator-modal";
  modal.innerHTML=`<div class="creator-card"><button class="creator-close">×</button><div class="eyebrow">CHEBUREKWATCH · CREATOR</div><h2>Создатель</h2><p class="creator-sub">За этой чебуречной стоят:</p><div class="creator-names">
    <div class="creator-name">РЕПЛИКИ жпт</div><div class="creator-name">ручки мэтью</div><div class="creator-name">дмитрий нагиев</div><div class="creator-name">мафаня</div><div class="creator-name">влад dior <button class="secret-trigger" type="button">armain <span>✦</span></button></div><div class="creator-name">андрей ноилз</div>
  </div><div class="creator-tools" hidden><div class="creator-tool-grid"><label>Уровень<input id="creatorLevel" type="number" min="1" max="10000" placeholder="например 25"></label><label>Минуты<input id="creatorMinutes" type="number" min="0" max="100000" placeholder="например 500"></label></div><div class="creator-tool-actions"><button class="secondary" id="grantLevel">Выдать уровень</button><button class="secondary" id="grantXp">Выдать XP</button><button class="secondary" id="grantAch">Все достижения</button><button class="primary" id="grantBaby">🍼 Бэйби</button></div><small>Creator Tools доступны только создателю этой комнаты.</small></div><div class="creator-quote">«Смотрим красиво. Ломаем скуку. Чебурек — это состояние души.»</div></div>`;
  document.body.appendChild(modal);
  modal.addEventListener("click",e=>{if(e.target===modal||e.target.closest(".creator-close"))modal.remove()});
  const tools=modal.querySelector(".creator-tools");
  if(!code) tools.hidden=true;
  modal.querySelector(".secret-trigger")?.addEventListener("click",()=>{ if(!code){toast("Секретный раздел открывается внутри твоей комнаты ✦");return;} tools.hidden=!tools.hidden; if(!tools.hidden) toast("Creator Tools разблокированы");});
  async function grant(body){try{const d=await api(`/api/rooms/${code}/creator/grant`,{method:"POST",body});me=d.user;toast("Готово ✦");}catch(e){toast(e.message)}}
  modal.querySelector("#grantLevel")?.addEventListener("click",()=>grant({level:Number(modal.querySelector("#creatorLevel").value)}));
  modal.querySelector("#grantXp")?.addEventListener("click",()=>grant({minutes:Number(modal.querySelector("#creatorMinutes").value)}));
  modal.querySelector("#grantAch")?.addEventListener("click",()=>grant({allAchievements:true}));
  modal.querySelector("#grantBaby")?.addEventListener("click",()=>grant({secretBaby:true}));
}

function renderMessages(ms){const box=$("#messages");if(!box)return;box.innerHTML="";ms.forEach(appendMessage);syncOverlayMessages()}
function reactionHtml(m){const r=m.reactions||{};return `<div class="msg-reactions">${Object.entries(r).map(([e,ids])=>ids.length?`<button class="reaction-pill ${ids.includes(me.id)?"mine":""}" data-mid="${m.id}" data-reaction="${e}">${e} <span>${ids.length}</span></button>`:"").join("")}<button class="add-reaction" data-mid="${m.id}">＋</button></div>`}
function appendMessage(m){
  const box=$("#messages");if(!box)return;
  const div=document.createElement("div");div.className="message msg";div.dataset.mid=m.id;
  const name=esc(m.nickname),time=new Date(m.createdAt).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});
  div.innerHTML=`${avatarHtml(m.nickname,"sm")}<div><div class="message-meta"><strong>${name}</strong><span>${time}</span></div><p class="msgtext">${esc(m.text)}</p>${reactionHtml(m)}</div>`;
  box.appendChild(div);bindReactionButtons(div);box.scrollTop=box.scrollHeight;syncOverlayMessages();
}
function bindReactionButtons(scope){scope.querySelectorAll(".reaction-pill").forEach(b=>b.onclick=()=>toggleReaction(b.dataset.mid,b.dataset.reaction));scope.querySelectorAll(".add-reaction").forEach(b=>b.onclick=()=>openReactionMenu(b.dataset.mid,b))}
function openReactionMenu(mid,anchor){document.querySelector(".reaction-menu")?.remove();const menu=document.createElement("div");menu.className="reaction-menu";["❤️","😂","🔥","😮","😭","👏","💀","🍿","👍","🥰","😡"].forEach(e=>{const b=document.createElement("button");b.textContent=e;b.onclick=()=>{toggleReaction(mid,e);menu.remove()};menu.appendChild(b)});anchor.parentElement.appendChild(menu)}
async function toggleReaction(mid,emoji){
  try{
    const d=await api(`/api/rooms/${room.code}/messages/${mid}/reactions`,{method:"POST",body:{emoji}});
    updateMessageReactions({messageId:mid,reactions:d.reactions||{}});
  }catch(e){toast(e.message)}
}
function updateMessageReactions(data){
  const matches=document.querySelectorAll(`[data-mid="${CSS.escape(String(data.messageId))}"]`);
  if(!matches.length)return;
  const m={id:data.messageId,reactions:data.reactions||{}};
  matches.forEach(msg=>{
    const old=msg.querySelector(".msg-reactions");
    old?.remove();
    msg.insertAdjacentHTML("beforeend",reactionHtml(m));
    bindReactionButtons(msg);
  });
  syncOverlayMessages();
}
function syncOverlayMessages(){const src=$("#messages"),dst=$("#overlayMessages");if(!src||!dst)return;dst.innerHTML=src.innerHTML;dst.querySelectorAll(".reaction-pill,.add-reaction").forEach(b=>{if(b.classList.contains("add-reaction"))b.onclick=()=>openReactionMenu(b.dataset.mid,b);else b.onclick=()=>toggleReaction(b.dataset.mid,b.dataset.reaction)});dst.scrollTop=dst.scrollHeight}
function mountMedia(){
  player=null;vkPlayer=null;localVideo=null;lastYTPosition=null;lastVKPosition=null;lastAppliedSeq=0;remoteApplyUntil=0;
  const box=$("#videobox");if(!box)return;const current=room.media;
  const label=current?(current.type==="youtube"?"YouTube":current.type==="vk"?"VK Video":"Видео"):"Кадр не выбран";
  box.innerHTML=playerHtml(current)+`<div class="movie-label"><span>СЕЙЧАС СМОТРИМ</span><strong>${esc(label)}</strong></div><div class="player-overlay" id="playerOverlay"><button type="button" class="player-chat-toggle" id="playerChatToggle">${cwIcon("chat")}</button><button type="button" class="player-fullscreen" id="playerFullscreen">${cwIcon("expand")}</button><div class="overlay-chat" id="overlayChat"><div class="overlay-head"><b>РЕПЛИКИ</b><button id="overlayClose">×</button></div><div class="overlay-messages" id="overlayMessages"></div><form id="overlayForm"><input id="overlayInput" maxlength="500" placeholder="Написать сообщение…"><button type="submit">${cwIcon("send",17)}</button></form></div></div>`;
  setupPlayerOverlay();
  
  if(!current){return;}
  if(current.type==="youtube"){
    window.onYouTubeIframeAPIReady=()=>{if(room?.media?.type==="youtube")initYT()};
    loadYouTubeAPI().then(ok=>{if(ok)initYT();else{const host=$("#yt");if(host)host.innerHTML='<div class="player-error"><b>YouTube сейчас недоступен</b><small>Попробуйте VK Video или прямую ссылку.</small></div>'}});
  }
  if(current.type==="vk"){
    loadVKAPI().then(ok=>{if(ok)initVK();else{const host=$("#vkframe")?.parentElement;if(host)host.innerHTML='<div class="player-error"><b>VK Video не загрузился</b><small>Проверьте соединение и попробуйте ещё раз.</small></div>'}});
  }
  if(current.type==="direct"){
    localVideo=$("#htmlvideo");
    localVideo.addEventListener("play",()=>{if(!suppress&&Date.now()>remoteApplyUntil)sendState(true,localVideo.currentTime,"play")});
    localVideo.addEventListener("pause",()=>{if(!suppress&&Date.now()>remoteApplyUntil)sendState(false,localVideo.currentTime,"pause")});
    localVideo.addEventListener("seeked",()=>{if(!suppress&&Date.now()>remoteApplyUntil)sendState(!localVideo.paused,localVideo.currentTime,"seek")});
    localVideo.addEventListener("loadedmetadata",()=>{applyRemoteState(room)});
    
  }
}
function setupPlayerOverlay(){
  $("#playerChatToggle")?.addEventListener("click",()=>$("#overlayChat")?.classList.toggle("open"));
  $("#overlayClose")?.addEventListener("click",()=>$("#overlayChat")?.classList.remove("open"));
  $("#playerFullscreen")?.addEventListener("click",async()=>{const t=$("#videobox");try{if(document.fullscreenElement)await document.exitFullscreen();else await t.requestFullscreen()}catch{}});
  if (!window.__cwFullscreenBound) {
    window.__cwFullscreenBound = true;
    document.addEventListener("fullscreenchange",()=>document.querySelector("#videobox")?.classList.toggle("fullscreen",!!document.fullscreenElement));
  }
  syncOverlayMessages();
}
function initYT(){
  if(!$("#yt")||!room.media)return;
  player=new YT.Player("yt",{
    videoId:room.media.videoId,width:"100%",height:"100%",
    playerVars:{playsinline:1,rel:0,enablejsapi:1,origin:location.origin},
    events:{
      onReady:()=>{applyRemoteState(room);startYTSeekWatch();},
      onStateChange:e=>{
        if(suppress || Date.now()<remoteApplyUntil)return;
        if(e.data===YT.PlayerState.PLAYING)sendState(true,player.getCurrentTime(),"play");
        if(e.data===YT.PlayerState.PAUSED)sendState(false,player.getCurrentTime(),"pause");
      }
    }
  });
}
function startYTSeekWatch(){
  clearInterval(window.__ytSeekWatch);
  lastYTPosition=null;
  window.__ytSeekWatch=setInterval(()=>{
    if(!player?.getCurrentTime || suppress || Date.now()<remoteApplyUntil)return;
    const p=Number(player.getCurrentTime());
    if(lastYTPosition!=null && Math.abs(p-lastYTPosition)>1.25){
      const playing = player.getPlayerState?.()===YT.PlayerState.PLAYING;
      sendState(playing,p,"seek");
    }
    lastYTPosition=p;
  },250);
}
function initVK(){
  const iframe=$("#vkframe");
  if(!iframe)return;
  const attach=()=>{
    try{
      if(!window.VK?.VideoPlayer)return;
      vkPlayer=window.VK.VideoPlayer(iframe);
      const events=window.VK.VideoPlayer.Events||{};
      const bind=(name,fn)=>{if(name)vkPlayer.on(name,fn)};
      bind(events.started||"started", state=>{if(!suppress&&Date.now()>remoteApplyUntil)sendState(true,Number(state?.time ?? vkPlayer.getCurrentTime?.() ?? 0),"play")});
      bind(events.resumed||"resumed", state=>{if(!suppress&&Date.now()>remoteApplyUntil)sendState(true,Number(state?.time ?? vkPlayer.getCurrentTime?.() ?? 0),"play")});
      bind(events.paused||"paused", state=>{if(!suppress&&Date.now()>remoteApplyUntil)sendState(false,Number(state?.time ?? vkPlayer.getCurrentTime?.() ?? 0),"pause")});
      bind(events.timeupdate||"timeupdate", state=>{
        if(suppress||Date.now()<remoteApplyUntil)return;
        const p=Number(state?.time ?? vkPlayer.getCurrentTime?.() ?? 0);
        if(lastVKPosition!=null && Math.abs(p-lastVKPosition)>1.5){
          const playing=String(state?.state||"")!=="paused";
          sendState(playing,p,"seek");
        }
        lastVKPosition=p;
      });
      applyRemoteState(room);
    }catch(e){ console.warn("VK player API init failed",e); }
  };
  if(window.VK?.VideoPlayer) attach();
  else iframe.addEventListener("load",attach,{once:true});
}

async function sendState(playing,position,action){
  if(suppress||!room?.code)return;
  const body={playing:Boolean(playing),position:Number(position)||0,action:action|| (playing?"play":"pause")};
  clearTimeout(syncTimer);
  const delay=body.action==="play"?40:0;
  syncTimer=setTimeout(async()=>{
    try{
      const d=await api(`/api/rooms/${room.code}/state`,{method:"POST",body});
      if(d.state){room={...room,...d.state}; lastAppliedSeq=Number(d.state.seq||lastAppliedSeq);}
    }catch(e){toast(e.message)}
  },delay);
}
function getPosition(){
  try{
    if(player?.getCurrentTime)return Number(player.getCurrentTime());
    if(vkPlayer?.getCurrentTime)return Number(vkPlayer.getCurrentTime());
    if(localVideo)return Number(localVideo.currentTime);
  }catch{}
  return Number(room.position||0);
}
function applyPosition(pos){
  try{
    if(player?.seekTo)player.seekTo(Number(pos),true);
    else if(vkPlayer?.seek)vkPlayer.seek(Number(pos));
    else if(localVideo)localVideo.currentTime=Number(pos);
  }catch{}
}
function applyRemoteState(st){
  if(!st)return;
  const seq=Number(st.seq||0);
  if(seq && seq<=lastAppliedSeq)return;
  if(seq)lastAppliedSeq=seq;
  room.playing=!!st.playing;
  room.position=Number(st.position||0);
  room.updatedAt=Number(st.updatedAt||Date.now());
  remoteApplyUntil=Date.now()+1200;
  suppress=true;
  let target=Math.max(0,room.position+(room.playing?Math.max(0,(Date.now()-room.updatedAt)/1000):0));
  try{
    const local=getPosition();
    if(!Number.isFinite(local)||Math.abs(local-target)>0.65)applyPosition(target);
    if(player?.playVideo) room.playing?player.playVideo():player.pauseVideo();
    else if(vkPlayer?.play) room.playing?vkPlayer.play():vkPlayer.pause();
    else if(localVideo) room.playing?localVideo.play().catch(()=>{}):localVideo.pause();
  }catch{}
  lastYTPosition=target;
  lastVKPosition=target;
  
  setTimeout(()=>{suppress=false;},1250);
}

async function render(){
  if(eventSource){eventSource.close();eventSource=null}
  clearInterval(window.__cwHeartbeat);clearInterval(window.__cwMessageRefresh);clearInterval(window.__ytSeekWatch);
  const path=location.pathname;
  if(path==="/"){await landingPage();return}
  if(path==="/login"){authPage("login");return}
  if(path==="/register"){authPage("register");return}
  if(!me){history.replaceState({},"","/login"+location.search);authPage("login");return}
  if(path==="/rooms"){await roomsPage();return}
  if(path==="/profile"){await profilePage();return}
  const m=path.match(/^\/room\/([A-Za-z0-9]+)$/);if(m){await roomPage(m[1].toUpperCase());return}
  history.replaceState({},"",me?"/rooms":"/");await render();
}
function initCinematicIntro(){
  if(document.querySelector(".intro"))return;
  const reduced=window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  const returning=sessionStorage.getItem("cw-seen-intro");
  const intro=document.createElement("div");intro.className="intro";intro.setAttribute("aria-label","CheburekWatch загружается");
  intro.innerHTML=`<div class="intro-ambient"></div><div class="intro-grain"></div><div class="intro-logo">${logoHtml()}<span>СИНХРОННАЯ ЭКРАННАЯ АРКА</span><i></i></div><div class="intro-progress"><i></i></div>`;
  document.body.appendChild(intro);
  const hold=reduced?100:(returning?850:2100);
  setTimeout(()=>intro.classList.add("is-leaving"),hold);
  setTimeout(()=>{intro.remove();sessionStorage.setItem("cw-seen-intro","1");window.dispatchEvent(new CustomEvent("cw:intro-finished"))},hold+(reduced?30:650));
}

(async()=>{initCinematicIntro();try{me=(await api("/api/me")).user}catch{};await render()})();