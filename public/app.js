const $ = s => document.querySelector(s);
const app = $("#app");
let me = null, room = null, eventSource = null, player = null, vkPlayer = null, localVideo = null, rutubeFrame = null;
let suppress = false, syncTimer = null, lastAppliedSeq = 0, remoteApplyUntil = 0, lastYTPosition = null, lastVKPosition = null;
let rutubePosition = 0, rutubeReady = false, rutubePlaying = false, lastRutubePosition = null;

const externalLoaders = {
  youtube: null,
  vk: null,
  vkid: null
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
function loadVKIDAPI(){
  if(externalLoaders.vkid) return externalLoaders.vkid;
  externalLoaders.vkid=loadExternalScript("https://unpkg.com/@vkid/sdk@2.6.1/dist-sdk/umd/index.js",()=>!!window.VKIDSDK,12000);
  return externalLoaders.vkid;
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
  heroDesktop:"/media/main-intro-desktop.mp4",
  heroDesktopFinal:"/site-assets/hero/main-intro-final.jpg",
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
  return `<section class="archive-carousel" aria-label="Фотоархив CheburekWatch">
    <div class="archive-carousel-head container">
      <div class="new-photo-gradient-copy"><span>CHAPTER / ARCHIVE</span><b>ШЕСТЬ КАДРОВ. ДУМАЛ, ЭТО ПРОСТО АРХИВ? ЛИСТАЙ ДАЛЬШЕ.</b></div>
      <div class="archive-carousel-ui"><span class="archive-carousel-count"><b id="archiveCarouselCurrent">01</b> / 06</span><div class="archive-carousel-controls"><button class="btn btn-icon" id="archivePrev" type="button" aria-label="Предыдущий кадр">${cwIcon("back",17)}</button><button class="btn btn-icon" id="archiveNext" type="button" aria-label="Следующий кадр">${cwIcon("arrow",17)}</button></div></div>
    </div>
    <div class="archive-carousel-viewport" id="archiveCarousel" tabindex="0">
      <div class="archive-carousel-track">
        ${SITE_ASSETS.photos.map((src,i)=>`<figure class="archive-slide" data-slide="${i}"><img src="${src}" alt="Кадр ${i+1}" loading="lazy" decoding="async"><i>${String(i+1).padStart(2,"0")}</i></figure>`).join("")}
      </div>
    </div>
  </section>`;
}
function setupArchiveCarousel(){
  const viewport=$("#archiveCarousel");
  if(!viewport)return;
  const slides=[...viewport.querySelectorAll(".archive-slide")];
  const current=$("#archiveCarouselCurrent");
  const update=()=>{
    if(!slides.length)return;
    const center=viewport.scrollLeft+viewport.clientWidth/2;
    let best=0,dist=Infinity;
    slides.forEach((slide,i)=>{
      const d=Math.abs((slide.offsetLeft+slide.offsetWidth/2)-center);
      if(d<dist){dist=d;best=i}
    });
    if(current)current.textContent=String(best+1).padStart(2,"0");
  };
  const step=dir=>{
    const card=slides[0];
    const amount=(card?.getBoundingClientRect().width||280)+14;
    viewport.scrollBy({left:dir*amount,behavior:"smooth"});
  };
  $("#archivePrev")?.addEventListener("click",()=>step(-1));
  $("#archiveNext")?.addEventListener("click",()=>step(1));
  let dragging=false,startX=0,startScroll=0;
  viewport.addEventListener("pointerdown",e=>{if(e.pointerType==="touch")return;dragging=true;startX=e.clientX;startScroll=viewport.scrollLeft;viewport.setPointerCapture?.(e.pointerId);viewport.classList.add("is-dragging")});
  viewport.addEventListener("pointermove",e=>{if(!dragging)return;viewport.scrollLeft=startScroll-(e.clientX-startX)});
  const stopDrag=e=>{if(!dragging)return;dragging=false;viewport.releasePointerCapture?.(e.pointerId);viewport.classList.remove("is-dragging");update()};
  viewport.addEventListener("pointerup",stopDrag);
  viewport.addEventListener("pointercancel",stopDrag);
  viewport.addEventListener("scroll",()=>requestAnimationFrame(update),{passive:true});
  viewport.addEventListener("keydown",e=>{
    if(e.key==="ArrowRight"){e.preventDefault();step(1)}
    if(e.key==="ArrowLeft"){e.preventDefault();step(-1)}
  });
  update();
}
function ambientVideoStripHtml(){
  const posters=[SITE_ASSETS.photos[1],SITE_ASSETS.photos[3],SITE_ASSETS.photos[5]];
  return `<section class="motion-archive container">
    <div class="section-head motion-head"><div><span class="eyebrow">АКТ II</span><h2>СЛЕДУЮЩИЙ ХОД — ОБЩИЙ.</h2></div></div>
    <div class="motion-grid">
      ${SITE_ASSETS.videos.map((src,i)=>`<article class="motion-card motion-card-${i+1}"><video class="ambient-video" src="${src}" poster="${posters[i]}" muted playsinline loop preload="metadata"></video><div><span>0${i+1}</span><b>${["ПЕРВЫЙ ХОД","КАДР ОТВЕЧАЕТ","ПОСЛЕДНИЙ АРГУМЕНТ"][i]}</b></div></article>`).join("")}
    </div>
  </section>`;
}
function setupAmbientVideos(){
  const videos=[...document.querySelectorAll(".ambient-video")];
  if(!videos.length)return;
  const reduced=window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;

  videos.forEach(v=>{
    const loopStart=Number(v.dataset.loopStart);
    const loopEnd=Number(v.dataset.loopEnd);
    const hasSegment=Number.isFinite(loopStart)&&Number.isFinite(loopEnd)&&loopEnd>loopStart;

    if(hasSegment){
      const armSegment=()=>{
        try{
          if(v.currentTime<loopStart || v.currentTime>=loopEnd)v.currentTime=loopStart;
        }catch{}
      };
      if(v.readyState>=1)armSegment();
      else v.addEventListener("loadedmetadata",armSegment,{once:true});

      v.addEventListener("timeupdate",()=>{
        if(v.currentTime>=loopEnd-.035){
          try{v.currentTime=loopStart}catch{}
          if(!v.paused)v.play().catch(()=>{});
        }
      });
      v.addEventListener("ended",()=>{
        try{v.currentTime=loopStart}catch{}
        v.play().catch(()=>{});
      });
    }
  });

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
  const desktop=window.matchMedia?.("(min-width: 901px)")?.matches;
  if(desktop)return;

  const reduced=window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  if(reduced){v.pause();return}

  v.muted=true;
  v.defaultMuted=true;
  v.playsInline=true;
  const start=()=>{
    try{v.currentTime=0}catch{}
    v.play().catch(()=>{});
  };
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
    book:'<path d="M4 5.5A3.5 3.5 0 0 1 7.5 2H12v17H7.5A3.5 3.5 0 0 0 4 22z"/><path d="M20 5.5A3.5 3.5 0 0 0 16.5 2H12v17h4.5A3.5 3.5 0 0 1 20 22z"/>',
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

function mangaModeEnabled(){
  return localStorage.getItem("cw-manga-mode")==="1";
}
function refreshMangaToggleLabels(){
  const on=document.body.classList.contains("manga-mode");
  document.querySelectorAll("[data-manga-toggle]").forEach(btn=>{
    btn.setAttribute("aria-pressed",on?"true":"false");
    btn.classList.toggle("active",on);
    const label=btn.querySelector("[data-manga-label]");
    if(label)label.textContent=on?(btn.classList.contains("bottom-manga-toggle")?"Кино":"CINEMA MODE"):(btn.classList.contains("bottom-manga-toggle")?"Манга":"MANGA MODE");
  });
}
function applyMangaMode(on=mangaModeEnabled(),animate=false){
  document.body.classList.toggle("manga-mode",!!on);
  document.documentElement.dataset.manga=on?"1":"0";
  if(animate){
    document.body.classList.remove("manga-switching");
    void document.body.offsetWidth;
    document.body.classList.add("manga-switching");
    setTimeout(()=>document.body.classList.remove("manga-switching"),520);
  }
  refreshMangaToggleLabels();
}
function toggleMangaMode(){
  const next=!document.body.classList.contains("manga-mode");
  localStorage.setItem("cw-manga-mode",next?"1":"0");
  applyMangaMode(next,true);
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
      <button class="btn btn-ghost manga-mode-toggle" type="button" data-manga-toggle aria-pressed="${mangaModeEnabled()?"true":"false"}">${cwIcon("book",17)}<span data-manga-label>${mangaModeEnabled()?"CINEMA MODE":"MANGA MODE"}</span></button>
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
    <button class="btn btn-ghost bottom-manga-toggle" type="button" data-manga-toggle aria-pressed="${mangaModeEnabled()?"true":"false"}>${cwIcon("book")}<span data-manga-label>${mangaModeEnabled()?"Кино":"Манга"}</span></button>
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


let vkBrowserAccessToken="";
let vkBrowserTokenExpiresAt=0;
const VK_ID_APP = 54806525;
const VK_ID_REDIRECT = "https://cheburekwatch.onrender.com/auth/vk/callback";
let vkIdConfigured=false;

async function vkStatus(){
  try{return await api("/api/vk/status",{method:"GET"})}
  catch{return {connected:false}}
}
async function mountVkOneTap(container,onConnected){
  if(!container)return;
  container.innerHTML='<div class="vk-id-loading"><span class="button-loader"></span> Загружаю VK ID…</div>';
  const ok=await loadVKIDAPI();
  if(!ok || !window.VKIDSDK){
    container.innerHTML='<div class="error">Не удалось загрузить официальный VK ID.</div>';
    return;
  }
  const VKID=window.VKIDSDK;
  try{
    if(!vkIdConfigured){
      VKID.Config.init({
        app: VK_ID_APP,
        redirectUrl: VK_ID_REDIRECT,
        responseMode: VKID.ConfigResponseMode.Callback,
        source: VKID.ConfigSource.LOWCODE,
        scope: ""
      });
      vkIdConfigured=true;
    }
    container.innerHTML="";
    const oneTap=new VKID.OneTap();
    oneTap.render({container,showAlternativeLogin:true})
      .on(VKID.WidgetEvents.ERROR,err=>{
        console.warn("VK ID",err);
        container.insertAdjacentHTML("beforeend",'<div class="vk-id-note">VK ID вернул ошибку. Можно попробовать ещё раз.</div>');
      })
      .on(VKID.OneTapInternalEvents.LOGIN_SUCCESS,async payload=>{
        try{
          container.classList.add("is-loading");
          const data=await VKID.Auth.exchangeCode(payload.code,payload.device_id);
          const accessToken=String(data?.access_token||data?.accessToken||"");
          if(!accessToken)throw new Error("VK ID не вернул access token");
          vkBrowserAccessToken=accessToken;
          vkBrowserTokenExpiresAt=Date.now()+Math.max(60,Number(data?.expires_in||data?.expiresIn||3600))*1000;
          container.classList.remove("is-loading");
          container.innerHTML='<div class="vk-connected-badge">'+cwIcon("check",15)+'<span><b>VK подключён</b><small>Поиск идёт прямо из браузера — без привязки к IP Render</small></span></div>';
          onConnected?.();
        }catch(err){
          container.classList.remove("is-loading");
          container.innerHTML='<div class="error">'+esc(err.message)+'</div><button class="btn btn-secondary" type="button" data-vk-retry>Попробовать ещё раз</button>';
          container.querySelector("[data-vk-retry]")?.addEventListener("click",()=>mountVkOneTap(container,onConnected));
        }
      });
  }catch(err){
    container.innerHTML='<div class="error">'+esc(err.message||"Не удалось открыть VK ID")+'</div>';
  }
}

function vkBrowserConnected(){
  if(vkBrowserTokenExpiresAt && vkBrowserTokenExpiresAt<=Date.now()){
    vkBrowserAccessToken="";vkBrowserTokenExpiresAt=0;
  }
  return !!vkBrowserAccessToken;
}
function vkJsonp(method,params={},timeoutMs=10000){
  return new Promise((resolve,reject)=>{
    if(!vkBrowserConnected()){reject(new Error("Подключите VK ID"));return}
    const callback="__cwVkCb"+Date.now().toString(36)+Math.random().toString(36).slice(2);
    const script=document.createElement("script");
    const timer=setTimeout(()=>finish(new Error("VK Video не ответил вовремя")),timeoutMs);
    const finish=(err,data)=>{
      clearTimeout(timer);
      try{delete window[callback]}catch{window[callback]=undefined}
      script.remove();
      if(err)reject(err);else resolve(data);
    };
    window[callback]=data=>{
      if(data?.error)finish(new Error(String(data.error.error_msg||"VK API вернул ошибку")));
      else finish(null,data);
    };
    const q=new URLSearchParams({...params,access_token:vkBrowserAccessToken,v:"5.199",callback});
    script.src="https://api.vk.com/method/"+method+"?"+q.toString();
    script.async=true;
    script.onerror=()=>finish(new Error("Не удалось обратиться к VK Video из браузера"));
    document.head.appendChild(script);
  });
}
async function vkBrowserSearch(q){
  const data=await vkJsonp("video.search",{q,sort:"2",adult:"0",filters:"vk",count:"12",extended:"0"});
  const raw=Array.isArray(data?.response?.items)?data.response.items:[];
  return raw.filter(v=>v&&v.player&&!v.processing&&!v.converting&&!v.content_restricted).map(v=>{
    const images=Array.isArray(v.image)?[...v.image]:[];
    images.sort((a,b)=>Number(b.width||0)-Number(a.width||0));
    return {
      id:Number(v.id),ownerId:Number(v.owner_id),title:String(v.title||"Без названия"),
      duration:Number(v.duration||0),views:Number(v.views||0),
      thumbnail:String(images.find(x=>/^https?:\/\//i.test(String(x?.url||"")))?.url||""),
      player:String(v.player||""),type:String(v.type||"video")
    };
  }).slice(0,12);
}

function formatVideoDuration(total){
  total=Math.max(0,Math.floor(Number(total)||0));
  const h=Math.floor(total/3600),m=Math.floor((total%3600)/60),s=total%60;
  return h?`${h}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`:`${m}:${String(s).padStart(2,"0")}`;
}
function formatViews(v){
  v=Math.max(0,Number(v)||0);
  if(v>=1e6)return (v/1e6).toFixed(v>=1e7?0:1).replace(".0","")+" млн";
  if(v>=1e3)return (v/1e3).toFixed(v>=1e4?0:1).replace(".0","")+" тыс.";
  return String(Math.floor(v));
}
function vkSearchPanelHtml(id){
  return `<section class="media-discovery" id="${id}" data-media-discovery>
    <div class="media-source-tabs">
      <button class="active" type="button" data-media-tab="vk">VK VIDEO</button>
      <button type="button" data-media-tab="anime">АНИМЕ</button>
      <button type="button" data-media-tab="library">БИБЛИОТЕКА</button>
    </div>
    <div data-media-pane="vk">
      <div class="vk-search-head"><div><span class="eyebrow">VK VIDEO</span><h3>ПОИСК БЕЗ API</h3></div><span class="vk-search-mark">VK</span></div>
      <div class="vk-public-note">VK запретил <code>video.search</code> для текущего типа профиля приложения. Поэтому поиск открывается на самом VK Video, а найденную ссылку можно сразу вставить сюда.</div>
      <form class="vk-public-search" data-vk-public-search>
        <label class="vk-search-box">${cwIcon("search",18)}<input data-vk-public-query maxlength="120" autocomplete="off" placeholder="Название фильма или видео"></label>
        <button class="btn btn-primary" type="submit"><span class="btn-label">ОТКРЫТЬ VK VIDEO</span></button>
      </form>
      <form class="vk-link-pick" data-vk-link-form>
        <label class="vk-search-box">${cwIcon("film",18)}<input data-vk-link maxlength="800" autocomplete="off" placeholder="Вставьте ссылку vkvideo.ru или vk.com/video…"></label>
        <button class="btn btn-secondary" type="submit"><span class="btn-label">ВЫБРАТЬ</span></button>
      </form>
      <div class="vk-search-status" data-vk-status>Сначала найдите ролик на VK Video, затем вставьте его ссылку.</div>
      <div class="vk-search-selected" data-vk-selected hidden></div>
    </div>
    <div data-media-pane="anime" hidden>
      <div class="anime-search-head"><div><span class="eyebrow">ANILIST</span><h3>НАЙТИ АНИМЕ</h3></div><span class="anime-search-mark">ANIME</span></div>
      <form class="anime-search-form" data-anime-search-form>
        <label class="vk-search-box">${cwIcon("search",18)}<input data-anime-query maxlength="120" autocomplete="off" placeholder="JoJo, Frieren, Attack on Titan…"></label>
        <button class="btn btn-primary" type="submit"><span class="btn-label">ИСКАТЬ</span></button>
      </form>
      <div class="anime-search-status" data-anime-status>Поиск по каталогу AniList. Здесь можно выбрать тайтл и посмотреть доступные официальные источники.</div>
      <div class="anime-search-results" data-anime-results></div>
      <div class="anime-selected" data-anime-selected hidden></div>
    </div>
    <div data-media-pane="library" hidden>
      <div class="library-head"><div><span class="eyebrow">TELEGRAM</span><h3>БИБЛИОТЕКА</h3></div><button class="btn btn-secondary" type="button" data-library-refresh>ОБНОВИТЬ</button></div>
      <div class="library-status" data-library-status>Здесь появятся серии, добавленные через бота.</div>
      <div class="library-list" data-library-list></div>
    </div>
  </section>`;
}
function bindVkSearch(root,{onPick,onAnime}={}){
  if(!root || root.dataset.bound==="1")return;
  root.dataset.bound="1";

  const vkPublicForm=root.querySelector("[data-vk-public-search]");
  const vkPublicQuery=root.querySelector("[data-vk-public-query]");
  const vkLinkForm=root.querySelector("[data-vk-link-form]");
  const vkLinkInput=root.querySelector("[data-vk-link]");
  const vkStatus=root.querySelector("[data-vk-status]");
  const vkSelected=root.querySelector("[data-vk-selected]");

  vkPublicForm.onsubmit=e=>{
    e.preventDefault();
    const q=vkPublicQuery.value.trim();
    if(q.length<2){vkStatus.textContent="Введите хотя бы 2 символа.";return}
    const url="https://vkvideo.ru/?q="+encodeURIComponent(q);
    window.open(url,"_blank","noopener,noreferrer");
    vkStatus.textContent="VK Video открыт в новой вкладке. Скопируйте ссылку нужного ролика и вставьте ниже.";
  };

  vkLinkForm.onsubmit=e=>{
    e.preventDefault();
    const url=vkLinkInput.value.trim();
    if(!/^https?:\/\/(?:www\.)?(?:vkvideo\.ru|vk\.com)\//i.test(url)){
      vkStatus.innerHTML='<span class="error-inline">Нужна ссылка с vkvideo.ru или vk.com.</span>';
      return;
    }
    vkSelected.hidden=false;
    vkSelected.innerHTML=`${cwIcon("check",15)}<span><b>VK Video выбрано</b><small>${esc(url.replace(/^https?:\/\//,"").slice(0,90))}</small></span>`;
    vkStatus.textContent="Ссылка готова. Она будет установлена в комнату.";
    onPick?.({title:"VK Video",player:url,thumbnail:"",duration:0,views:0});
  };

  const animeForm=root.querySelector("[data-anime-search-form]");
  const animeInput=root.querySelector("[data-anime-query]");
  const animeStatus=root.querySelector("[data-anime-status]");
  const animeResults=root.querySelector("[data-anime-results]");
  const animeSelected=root.querySelector("[data-anime-selected]");
  let animeSeq=0,animeItems=[];

  const renderAnime=()=>{
    animeResults.innerHTML=animeItems.map((item,i)=>`<button class="anime-result" type="button" data-anime-pick="${i}">
      <span class="anime-result-poster">${item.poster?`<img src="${esc(item.poster)}" alt="" loading="lazy">`:""}${item.score?`<b>${item.score}%</b>`:""}</span>
      <span class="anime-result-copy"><strong>${esc(item.title)}</strong><small>${[item.year||"",item.format||"",item.episodes?item.episodes+" эп.":""].filter(Boolean).join(" · ")}</small><em>${(item.genres||[]).map(esc).join(" / ")}</em></span>
    </button>`).join("");
    animeResults.querySelectorAll("[data-anime-pick]").forEach(btn=>btn.onclick=()=>{
      const item=animeItems[Number(btn.dataset.animePick)];if(!item)return;
      animeResults.querySelectorAll(".anime-result").forEach(x=>x.classList.remove("selected"));btn.classList.add("selected");
      const sources=Array.isArray(item.sources)?item.sources:[];
      animeSelected.hidden=false;
      const totalEpisodes=Math.max(1,Number(item.episodes||12));
      let episodePage=0;
      const pageSize=12;
      animeSelected.innerHTML=`<div class="anime-selected-card">${item.poster?`<img src="${esc(item.poster)}" alt="">`:""}<div><span class="eyebrow">ВЫБРАНО</span><b>${esc(item.title)}</b><small>${item.episodes?item.episodes+" серий":"Количество серий уточняется"} · выберите эпизод</small></div></div>
        <div class="episode-picker">
          <div class="episode-picker-head"><div><span class="eyebrow">ЭПИЗОД</span><b>КАКУЮ СЕРИЮ СМОТРИМ?</b></div><div class="episode-page-controls"><button class="btn btn-icon" type="button" data-episode-prev>${cwIcon("back",15)}</button><span data-episode-range></span><button class="btn btn-icon" type="button" data-episode-next>${cwIcon("arrow",15)}</button></div></div>
          <div class="episode-grid" data-episode-grid></div>
          <div class="episode-status" data-episode-status>Нажмите номер серии — CheburekWatch возьмёт её из вашей библиотеки.</div><div class="episode-region-note">Серии добавляются владельцем через Telegram-бота. Случайные внешние источники больше не используются.</div>
        </div>`;

      const epGrid=animeSelected.querySelector("[data-episode-grid]");
      const epStatus=animeSelected.querySelector("[data-episode-status]");
      const epRange=animeSelected.querySelector("[data-episode-range]");
      const prev=animeSelected.querySelector("[data-episode-prev]");
      const next=animeSelected.querySelector("[data-episode-next]");

      const chooseEpisode=async episode=>{
        epGrid.querySelectorAll("button").forEach(b=>b.disabled=true);
        epStatus.innerHTML='<span class="button-loader"></span> Ищу серию '+episode+'…';
        try{
          const data=await api("/api/anime/episode-source",{method:"POST",body:{
            title:item.title,romaji:item.romaji,native:item.native,synonyms:item.synonyms||[],episode
          }});
          const src=data.source;
          if(!src?.url)throw new Error("Источник не найден");
          epStatus.innerHTML=`${cwIcon("check",14)} Серия ${episode} готова к просмотру.`;
          onPick?.({title:`${item.title} · серия ${episode}`,player:src.url,thumbnail:src.thumbnail||item.poster,duration:src.duration||0,views:0,provider:"episode"});
        }catch(err){
          epStatus.innerHTML=`<span class="error-inline">${esc(err.message)}</span>`;
        }finally{
          epGrid.querySelectorAll("button").forEach(b=>b.disabled=false);
        }
      };

      const renderEpisodes=()=>{
        const start=episodePage*pageSize+1;
        const end=Math.min(totalEpisodes,start+pageSize-1);
        epRange.textContent=`${start}–${end} / ${totalEpisodes}`;
        epGrid.innerHTML=Array.from({length:end-start+1},(_,i)=>start+i).map(n=>`<button type="button" data-episode="${n}">${String(n).padStart(2,"0")}</button>`).join("");
        epGrid.querySelectorAll("[data-episode]").forEach(b=>b.onclick=()=>chooseEpisode(Number(b.dataset.episode)));
        prev.disabled=episodePage===0;
        next.disabled=end>=totalEpisodes;
      };
      prev.onclick=()=>{if(episodePage>0){episodePage--;renderEpisodes()}};
      next.onclick=()=>{if((episodePage+1)*pageSize<totalEpisodes){episodePage++;renderEpisodes()}};
      renderEpisodes();
      onAnime?.(item);
    });
  };
  animeForm.onsubmit=async e=>{
    e.preventDefault();
    const q=animeInput.value.trim();if(q.length<2){animeStatus.textContent="Введите хотя бы 2 символа.";return}
    const request=++animeSeq;animeStatus.innerHTML='<span class="button-loader"></span> Ищу в AniList…';animeResults.innerHTML="";
    try{
      const data=await api("/api/anime/search?q="+encodeURIComponent(q),{method:"GET"});
      if(request!==animeSeq)return;animeItems=Array.isArray(data.items)?data.items:[];
      animeStatus.textContent=animeItems.length?`Найдено: ${animeItems.length}. Выберите тайтл.`:"Ничего не нашлось.";
      renderAnime();
    }catch(err){
      if(request!==animeSeq)return;animeItems=[];animeResults.innerHTML="";animeStatus.innerHTML=`<span class="error-inline">${esc(err.message)}</span>`;
    }
  };

  const libraryStatus=root.querySelector("[data-library-status]");
  const libraryList=root.querySelector("[data-library-list]");
  let libraryItems=[];
  async function loadLibrary(){
    libraryStatus.innerHTML='<span class="button-loader"></span> Загружаю библиотеку…';
    try{
      const data=await api("/api/anime/library",{method:"GET"});
      libraryItems=Array.isArray(data.items)?data.items:[];
      libraryStatus.textContent=libraryItems.length?"Нажмите на нужную серию.":"Библиотека пока пустая.";
      libraryList.innerHTML=libraryItems.length?libraryItems.map((item,i)=>`<button class="library-item" type="button" data-library-pick="${i}"><span class="library-episode">${String(item.episode).padStart(2,"0")}</span><span class="library-copy"><strong>${esc(item.title)}</strong><small>${item.kind==="video"?"Видео из Telegram":"Добавленная ссылка"}</small></span><span class="library-play">${cwIcon("play",16)}</span></button>`).join(""):'<div class="library-empty">Отправьте видео боту, затем нажмите «Обновить».</div>';
      libraryList.querySelectorAll("[data-library-pick]").forEach(btn=>btn.onclick=()=>{
        const item=libraryItems[Number(btn.dataset.libraryPick)];
        if(!item?.url)return;
        libraryList.querySelectorAll(".library-item").forEach(x=>x.classList.remove("selected"));
        btn.classList.add("selected");
        libraryStatus.textContent=`${item.title} · серия ${item.episode} выбрана.`;
        onPick?.({title:`${item.title} · серия ${item.episode}`,player:item.url,thumbnail:"",duration:0,views:0,provider:"episode"});
      });
    }catch(err){
      libraryStatus.innerHTML=`<span class="error-inline">${esc(err.message)}</span>`;
    }
  }
  root.querySelector("[data-library-refresh]")?.addEventListener("click",loadLibrary);

  root.querySelectorAll("[data-media-tab]").forEach(tab=>tab.onclick=()=>{
    const name=tab.dataset.mediaTab;
    root.querySelectorAll("[data-media-tab]").forEach(x=>x.classList.toggle("active",x===tab));
    root.querySelectorAll("[data-media-pane]").forEach(p=>p.hidden=p.dataset.mediaPane!==name);
    if(name==="anime")setTimeout(()=>animeInput?.focus(),20);
    if(name==="vk")setTimeout(()=>vkPublicQuery?.focus(),20);
    if(name==="library")loadLibrary();
    if(name==="library")loadLibrary();
  });
}
function openCreateRoomModal(){
  if(!me){navigate("/login");return}
  document.querySelector(".modal-backdrop")?.remove();
  const i=figmaImages();
  const wrap=document.createElement("div");
  wrap.className="modal-backdrop";
  wrap.innerHTML=`<div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
    <div class="modal-head"><div><span class="eyebrow">НОВАЯ ГЛАВА</span><h2 class="modal-title" id="modal-title">ОТКРЫТЬ КОМНАТУ</h2></div><button class="btn btn-icon" data-close-modal aria-label="Закрыть">${cwIcon("close")}</button></div>
    <div class="modal-poster"><img src="${archivePhoto(2)}" alt="" id="createRoomPoster"><div><span>Источник можно выбрать сейчас или уже внутри комнаты</span><h3 id="createRoomMovieTitle">КАКОЙ КАДР ОТКРОЕТ ГЛАВУ?</h3><button class="btn btn-paper" type="button" id="pickMovie">${cwIcon("search")}НАЙТИ КИНО / АНИМЕ</button></div></div>
    <div id="createVkSearchWrap" hidden>${vkSearchPanelHtml("createVkSearch")}</div>
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
  let selectedMediaUrl="";
  const searchWrap=wrap.querySelector("#createVkSearchWrap");
  bindVkSearch(wrap.querySelector("#createVkSearch"),{
    onPick:item=>{
      selectedMediaUrl=item.player;
      const poster=wrap.querySelector("#createRoomPoster");
      if(item.thumbnail)poster.src=item.thumbnail;
      wrap.querySelector("#createRoomMovieTitle").textContent=item.title;
    },
    onAnime:item=>{
      selectedMediaUrl="";
      const poster=wrap.querySelector("#createRoomPoster");
      if(item.poster)poster.src=item.poster;
      wrap.querySelector("#createRoomMovieTitle").textContent=item.title;
    }
  });
  wrap.querySelector("#pickMovie")?.addEventListener("click",()=>{
    searchWrap.hidden=!searchWrap.hidden;
    if(!searchWrap.hidden)setTimeout(()=>searchWrap.querySelector("[data-vk-query]")?.focus(),30);
  });
  wrap.querySelector("#createRoomSubmit").addEventListener("click",async()=>{
    const btn=wrap.querySelector("#createRoomSubmit");
    btn.disabled=true;btn.classList.add("is-loading");btn.innerHTML='<span class="button-loader"></span><span class="btn-label">Создаём…</span>';
    try{
      const d=await api("/api/rooms",{method:"POST",body:{mediaUrl:selectedMediaUrl||null}});
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

  const desktopHero=window.matchMedia?.("(min-width: 901px)")?.matches;
  const heroMedia=desktopHero
    ? `<video id="mainHeroVideo" class="hero-image hero-main-video hero-main-video-desktop ambient-video" data-loop-start="3" data-loop-end="5" src="${SITE_ASSETS.heroDesktop}" muted playsinline preload="metadata"></video>`
    : `<video id="mainHeroVideo" class="hero-image hero-main-video" src="${SITE_ASSETS.heroVideo}" poster="${SITE_ASSETS.heroFinal}" muted autoplay playsinline preload="auto"></video>`;

  shell(`<main>
    <section class="hero archive-hero">${heroMedia}<div class="hero-overlay"></div>
      <div class="hero-archive-stack" aria-hidden="true"><span style="background-image:url('${archivePhoto(3)}')"></span><span style="background-image:url('${archivePhoto(1)}')"></span></div>
      <div class="container hero-content reveal"><span class="hero-kicker"><i></i> АКТ I · СУДЬБА УЖЕ НАЖАЛА PLAY</span><h1>ТЫ ДУМАЛ, ЭТО ПРОСТО КИНО?<br><em>ЭТО ВАША АРКА.</em></h1>
      <p>Подойдите ближе к экрану. Один нажимает Play — и вся компания вступает в ту же секунду. Следующий ход уже общий.</p>
      <div class="hero-actions"><button class="btn btn-primary" data-create>${cwIcon("play")}<span class="btn-label">ОТКРЫТЬ КОМНАТУ</span></button><a class="btn btn-secondary" href="${me?"/rooms":"/login"}" data-nav>ВОЙТИ ПО КОДУ ${cwIcon("arrow")}</a></div></div>
      ${easterPhotoHtml(0,"archive-hero-easter")}
    </section>
    ${photoGradientBandHtml()}
    ${roomSection}
    ${ambientVideoStripHtml()}
    <section class="manifesto archive-manifesto"><div class="container manifesto-grid"><div class="manifesto-image"><img src="${archivePhoto(5)}" alt=""><span>ОДИН ЭКРАН<br>НА ВСЕХ</span>${easterPhotoHtml(2,"archive-manifesto-easter")}</div>
      <div class="manifesto-copy"><span class="eyebrow">АКТ III</span><h2>ОДИН РИТМ.<br>ОДИН ЭКРАН.</h2>
      <div class="feature-list"><div><b>01</b><span><strong>СИНХРОН БЕЗ КОМПРОМИССОВ</strong>Пауза, перемотка и продолжение происходят вместе — никаких параллельных реальностей.</span></div><div><b>02</b><span><strong>РЕПЛИКИ НЕ ПРОПАДАЮТ</strong>РЕПЛИКИ и реакции живут рядом с экраном, как комментарии на полях манги.</span></div><div><b>03</b><span><strong>КОД ДЛЯ СВОИХ</strong>Один код — и ваша компания уже внутри этой главы.</span></div></div></div></div></section>
    <section class="club-notes container archive-notes"><div class="club-note-copy"><span class="eyebrow">ЛИЧНАЯ АРКА</span><h2>УРОВЕНЬ РАСТЁТ.<br>ИСТОРИЯ — ТОЖЕ.</h2><p>Только реальные просмотры.</p></div>
      <div class="club-collage archive-collage"><img src="${archivePhoto(0)}" alt=""><img src="${archivePhoto(4)}" alt=""><img src="${archivePhoto(2)}" alt=""><span class="ticket">CHEBUREK<br><small>WATCH PARTY</small></span>${easterPhotoHtml(5,"archive-note-easter")}</div></section>
  </main>`);
  setupMainHeroVideo();
  setupArchiveCarousel();
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
  document.querySelectorAll("[data-manga-toggle]").forEach(b=>b.addEventListener("click",toggleMangaMode));
  document.querySelectorAll("[data-demo-open]").forEach(b=>b.addEventListener("click",()=>navigate(me?"/rooms":"/login")));
  applyMangaMode(document.body.classList.contains("manga-mode"));
}

function mountCinemaIntro(){}
function authPage(mode){
  shell(`<main class="auth-page"><div class="auth-visual archive-auth-visual"><img src="${archivePhoto(3)}" alt=""><div class="auth-visual-film"><video class="ambient-video" src="${SITE_ASSETS.videos[1]}" poster="${archivePhoto(3)}" muted playsinline loop preload="metadata"></video></div><div class="auth-quote"><span>СЕАНС / CHEBUREK</span><h2>ВЫ УЖЕ ВОШЛИ<br>В ИСТОРИЮ.<br>ОСТАЛОСЬ ВОЙТИ В АККАУНТ.</h2></div>${easterPhotoHtml(1,"archive-auth-easter")}</div>
    <div class="auth-form-wrap"><div class="auth-mobile-logo">${logoHtml()}</div><a class="btn btn-ghost auth-back" href="/" data-nav>${cwIcon("back")}На главную</a>
      <form class="auth-form" id="authform"><span class="eyebrow">${mode==="login"?"ВОЗВРАЩЕНИЕ ГЕРОЯ":"НОВАЯ ГЛАВА"}</span><h1>${mode==="login"?"СЛЕДУЮЩИЙ ХОД ЗА ВАМИ.":"ВЫБЕРИТЕ СВОЮ РОЛЬ В ЭТОЙ ГЛАВЕ"}</h1><p>${mode==="login"?"Вернитесь в свою хронику или ворвитесь прямо в комнату по коду.":"Создайте профиль — это будет ваша личная линия в общей экранной истории."}</p>
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
  shell(`<main class="page container rooms-archive-page"><div class="browse-top reveal"><div><span class="eyebrow">ВАШИ ГЛАВЫ</span><h1>ВЫБЕРИТЕ СЛЕДУЮЩИЙ ХОД</h1><p>Никаких декораций: здесь только реальные комнаты, к которым у вас есть доступ.</p></div><button class="btn btn-primary" data-create>${cwIcon("plus")}<span class="btn-label">НОВАЯ ГЛАВА</span></button></div>
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
  if(!media)return `<div class="emptyvideo"><img src="${archivePhoto(1)}" alt=""><div class="emptyvideo-shade"></div><div class="emptyvideo-copy"><span>КАДР ЕЩЁ НЕ ВЫБРАН</span><b>ДАЖЕ ПУСТОЙ ЭКРАН ЖДЁТ СВОЕГО ХОДА</b><small>Откройте «СМЕНИТЬ КИНО» и дайте комнате источник: YouTube, VK Video или прямой файл.</small></div></div>`;
  if(media.type==="youtube")return `<div class="player-frame yt-stage" id="yt"><div class="player-loading">Подключаем видео…</div></div>`;
  if(media.type==="vk")return `<iframe class="player-frame" id="vkframe" allow="autoplay; encrypted-media; fullscreen; picture-in-picture" allowfullscreen src="${esc(media.url)}"></iframe>`;
  if(media.type==="rutube")return `<iframe class="player-frame" id="rutubeframe" allow="clipboard-write; autoplay; fullscreen; picture-in-picture" allowfullscreen src="${esc(media.url)}"></iframe>`;
  if(media.type==="bilibili")return `<iframe class="player-frame bilibili-frame" id="bilibiliframe" allow="autoplay; encrypted-media; fullscreen; picture-in-picture" allowfullscreen referrerpolicy="strict-origin-when-cross-origin" src="${esc(media.url)}"></iframe>`;
  return `<video class="player-frame" id="htmlvideo" playsinline preload="metadata" controls src="${esc(media.url)}"></video>`;
}
async function roomPage(code){
  try{
    const d=await api(`/api/rooms/${encodeURIComponent(code)}`);room=d.room;
    const people=room.users||[],label=room.media?(room.media.type==="youtube"?"YouTube":room.media.type==="vk"?"VK Video":room.media.type==="bilibili"?"Аниме":room.media.type==="rutube"?"RUTUBE":"Видео"):"Кадр не выбран";
    shell(`<main class="watch-page"><div class="watch-header container"><a class="btn btn-ghost" href="/rooms" data-nav>${cwIcon("back")}<span>Комнаты</span></a><div class="room-title"><div><h3>Комната ${esc(room.code)}</h3><span>${people.length} ${people.length===1?"участник":"участников"} сейчас</span></div></div><div class="participant-stack">${people.slice(0,3).map(u=>avatarHtml(u.nickname)).join("")}${people.length>3?`<span>+${people.length-3}</span>`:""}</div></div>
      <div class="watch-layout container roomlayout ${room.media?"has-media":"needs-media"}"><section class="player-column"><div class="player video-shell" id="videobox">${playerHtml(room.media)}<div class="movie-label"><span>${room.media?"ИСТОЧНИК АКТИВИРОВАН":"КАДР ЕЩЁ НЕ ВЫБРАН"}</span><strong>${esc(label)}</strong></div><div class="player-overlay" id="playerOverlay"><button type="button" class="player-chat-toggle" id="playerChatToggle">${cwIcon("chat")}</button><button type="button" class="player-fullscreen" id="playerFullscreen">${cwIcon("expand")}</button><div class="overlay-chat" id="overlayChat"><div class="overlay-head"><b>РЕПЛИКИ</b><button id="overlayClose">×</button></div><div class="overlay-messages" id="overlayMessages"></div><form id="overlayForm"><input id="overlayInput" maxlength="500" placeholder="Написать сообщение…"><button type="submit">${cwIcon("send",17)}</button></form></div></div></div>
      <div class="player-controls"><button class="btn btn-icon" id="seekBack" aria-label="Назад на 10 секунд">${cwIcon("back")}</button><button class="btn btn-icon" id="playerToggle" aria-label="Воспроизвести">${cwIcon(room.playing?"pause":"play")}</button><span class="player-sync-note">СИНХРОН</span><button class="btn btn-icon" aria-label="Громкость">${cwIcon("sound")}</button><button class="btn btn-icon" id="playerFullscreenBottom" aria-label="На весь экран">${cwIcon("expand")}</button></div>
      <div class="under-player"><div><h3>${esc(label)}</h3><span>Комната ${esc(room.code)}</span></div><div class="reaction-row"><button class="btn btn-secondary" data-room-reaction="♥">${cwIcon("heart")}</button><button class="btn btn-secondary" data-room-reaction="ХА">${cwIcon("smile")}</button><button class="btn btn-primary" id="movieSelectorToggle">${cwIcon("film")}<span class="btn-label">СМЕНИТЬ КИНО</span></button></div></div>
      <div class="movie-selector" id="movieSelector" hidden><div class="selector-head"><div><span class="eyebrow">НОВЫЙ КАДР</span><h3>НАЙТИ ИЛИ ВСТАВИТЬ</h3></div><button class="btn btn-icon" id="movieSelectorClose">${cwIcon("close")}</button></div>
      ${vkSearchPanelHtml("roomVkSearch")}
      <div class="selector-divider"><span>или ссылка вручную</span></div>
      <p class="selector-note">Аниме-ссылка Bilibili, YouTube, VK Video или прямой файл. Изменение синхронизируется для комнаты.</p><form id="mediaform" class="mediaform"><input id="mediaurl" placeholder="Bilibili / YouTube / VK / прямая ссылка" required><button class="btn btn-primary">${cwIcon("play")}<span class="btn-label">ЗАПУСТИТЬ КАДР</span></button></form><div id="mediaerr"></div></div>
      </section>
      <aside class="chat-panel"><div class="chat-head"><div><h3>РЕПЛИКИ</h3><span>${people.length} в комнате</span></div><div class="chat-head-actions"><button class="btn btn-ghost" id="invite">ПОЗВАТЬ</button><button class="btn btn-icon" id="peopleToggle" aria-label="Участники">${cwIcon("users")}</button></div></div>
      <div class="participants-popover" id="peoplePopover" hidden><div id="people">${peopleHtml(people)}</div>${room.ownerId===me.id?`<button id="deleteRoom" class="btn btn-ghost danger-text">Удалить комнату</button>`:""}<button id="creatorBtn" class="btn btn-ghost">Создатель</button></div>
      <div class="messages" id="messages"></div><div class="reaction-picker"><button type="button" data-chat-reaction="♥">♥</button><button type="button" data-chat-reaction="😂">😂</button><button type="button" data-chat-reaction="🔥">🔥</button><button type="button" data-chat-reaction="😮">😮</button></div><form id="chatform" class="chat-input"><input id="chatinput" maxlength="500" placeholder="Написать сообщение..."><button class="btn btn-icon" type="submit" aria-label="Отправить">${cwIcon("send")}</button></form></aside></div>
    </main>`,{bottom:false});
    bindRoom(code);
    bindVkSearch($("#roomVkSearch"),{onPick:async item=>{
      try{
        const d=await api(`/api/rooms/${code}/media`,{method:"POST",body:{url:item.player}});
        room=d.room;mountMedia();
        toast(item.provider==="episode"?"Серия выбрана":"VK Video выбрано");
        $("#movieSelector").hidden=true;
        $("#movieSelectorToggle").classList.remove("active");
      }catch(err){$("#mediaerr").innerHTML=`<div class="error">${esc(err.message)}</div>`}
    }});
    $("#peopleToggle").onclick=()=>{$("#peoplePopover").hidden=!$("#peoplePopover").hidden};
    const selector=$("#movieSelector"),toggle=$("#movieSelectorToggle");
    toggle.onclick=()=>{selector.hidden=!selector.hidden;toggle.classList.toggle("active",!selector.hidden)};
    $("#movieSelectorClose").onclick=()=>{selector.hidden=true;toggle.classList.remove("active")};
    document.querySelectorAll("[data-room-reaction]").forEach(b=>b.onclick=()=>{const f=document.createElement("span");f.className="floating-reaction";f.textContent=b.dataset.roomReaction;$("#videobox").appendChild(f);setTimeout(()=>f.remove(),1150)});
    $("#playerFullscreenBottom").onclick=()=>$("#playerFullscreen")?.click();
    $("#playerToggle").onclick=()=>{const playing=!room.playing;room.playing=playing;try{if(player?.playVideo)playing?player.playVideo():player.pauseVideo();else if(vkPlayer?.play)playing?vkPlayer.play():vkPlayer.pause();else if(rutubeFrame)rutubeCommand(playing?"player:play":"player:pause",{});else if(localVideo)playing?localVideo.play().catch(()=>{}):localVideo.pause()}catch{}sendState(playing,getPosition(),playing?"play":"pause");$("#playerToggle").innerHTML=cwIcon(playing?"pause":"play")};
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
  player=null;vkPlayer=null;localVideo=null;rutubeFrame=null;rutubePosition=0;rutubeReady=false;rutubePlaying=false;lastRutubePosition=null;lastYTPosition=null;lastVKPosition=null;lastAppliedSeq=0;remoteApplyUntil=0;
  const box=$("#videobox");if(!box)return;const current=room.media;
  const label=current?(current.type==="youtube"?"YouTube":current.type==="vk"?"VK Video":current.type==="bilibili"?"Аниме":current.type==="rutube"?"RUTUBE":"Видео"):"Кадр не выбран";
  box.innerHTML=playerHtml(current)+`<div class="movie-label"><span>СЕЙЧАС СМОТРИМ</span><strong>${esc(label)}</strong></div><div class="player-overlay" id="playerOverlay"><button type="button" class="player-chat-toggle" id="playerChatToggle">${cwIcon("chat")}</button><button type="button" class="player-fullscreen" id="playerFullscreen">${cwIcon("expand")}</button><div class="overlay-chat" id="overlayChat"><div class="overlay-head"><b>РЕПЛИКИ</b><button id="overlayClose">×</button></div><div class="overlay-messages" id="overlayMessages"></div><form id="overlayForm"><input id="overlayInput" maxlength="500" placeholder="Написать сообщение…"><button type="submit">${cwIcon("send",17)}</button></form></div></div>`;
  setupPlayerOverlay();
  updateExternalPlayerControls();
  
  if(!current){return;}
  if(current.type==="youtube"){
    window.onYouTubeIframeAPIReady=()=>{if(room?.media?.type==="youtube")initYT()};
    loadYouTubeAPI().then(ok=>{if(ok)initYT();else{const host=$("#yt");if(host)host.innerHTML='<div class="player-error"><b>YouTube сейчас недоступен</b><small>Попробуйте VK Video или прямую ссылку.</small></div>'}});
  }
  if(current.type==="vk"){
    loadVKAPI().then(ok=>{if(ok)initVK();else{const host=$("#vkframe")?.parentElement;if(host)host.innerHTML='<div class="player-error"><b>VK Video не загрузился</b><small>Проверьте соединение и попробуйте ещё раз.</small></div>'}});
  }
  if(current.type==="rutube")initRutube();
  if(current.type==="direct"){
    localVideo=$("#htmlvideo");
    localVideo.addEventListener("play",()=>{if(!suppress&&Date.now()>remoteApplyUntil)sendState(true,localVideo.currentTime,"play")});
    localVideo.addEventListener("pause",()=>{if(!suppress&&Date.now()>remoteApplyUntil)sendState(false,localVideo.currentTime,"pause")});
    localVideo.addEventListener("seeked",()=>{if(!suppress&&Date.now()>remoteApplyUntil)sendState(!localVideo.paused,localVideo.currentTime,"seek")});
    localVideo.addEventListener("loadedmetadata",()=>{applyRemoteState(room)});
    
  }
}
function updateExternalPlayerControls(){
  const external=room?.media?.type==="bilibili";
  const toggle=$("#playerToggle"),back=$("#seekBack"),note=document.querySelector(".player-sync-note");
  if(toggle){toggle.disabled=external;toggle.title=external?"Управление воспроизведением находится внутри аниме-плеера":""}
  if(back){back.disabled=external;back.title=external?"Перемотка находится внутри аниме-плеера":""}
  if(note)note.textContent=external?"СЕРИЯ СИНХРОНИЗИРОВАНА":"СИНХРОН";
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

function rutubeCommand(type,data={}){
  try{
    if(!rutubeFrame?.contentWindow)return;
    rutubeFrame.contentWindow.postMessage(JSON.stringify({type,data}),"*");
  }catch{}
}
function initRutube(){
  rutubeFrame=$("#rutubeframe");
  if(!rutubeFrame)return;
  rutubePosition=Number(room?.position||0);
  rutubeReady=false;
  rutubePlaying=false;
  lastRutubePosition=null;

  const onMessage=e=>{
    if(!rutubeFrame?.contentWindow || e.source!==rutubeFrame.contentWindow)return;
    let msg=e.data;
    try{if(typeof msg==="string")msg=JSON.parse(msg)}catch{return}
    if(!msg || typeof msg!=="object")return;
    const type=String(msg.type||"");
    const data=msg.data||{};

    if(type==="player:ready"){
      rutubeReady=true;
      applyRemoteState(room);
      return;
    }
    if(type==="player:currentTime"){
      const p=Number(data.time);
      if(Number.isFinite(p)){
        if(!suppress && Date.now()>remoteApplyUntil && lastRutubePosition!=null && Math.abs(p-lastRutubePosition)>2.5){
          sendState(rutubePlaying,p,"seek");
        }
        rutubePosition=p;
        lastRutubePosition=p;
      }
      return;
    }
    if(type==="player:changeState"){
      const state=String(data.state||"");
      const nextPlaying=state==="playing";
      const nextPaused=state==="paused"||state==="stopped";
      if(nextPlaying||nextPaused){
        rutubePlaying=nextPlaying;
        if(!suppress && Date.now()>remoteApplyUntil)sendState(nextPlaying,rutubePosition,nextPlaying?"play":"pause");
      }
      return;
    }
  };

  window.__cwRutubeMessageHandler && window.removeEventListener("message",window.__cwRutubeMessageHandler);
  window.__cwRutubeMessageHandler=onMessage;
  window.addEventListener("message",onMessage);
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
    if(rutubeFrame)return Number(rutubePosition||0);
    if(localVideo)return Number(localVideo.currentTime);
  }catch{}
  return Number(room.position||0);
}
function applyPosition(pos){
  try{
    if(player?.seekTo)player.seekTo(Number(pos),true);
    else if(vkPlayer?.seek)vkPlayer.seek(Number(pos));
    else if(rutubeFrame){rutubePosition=Number(pos)||0;rutubeCommand("player:setCurrentTime",{time:rutubePosition});}
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
    else if(rutubeFrame) rutubeCommand(room.playing?"player:play":"player:pause",{});
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

applyMangaMode(mangaModeEnabled());
(async()=>{initCinematicIntro();try{me=(await api("/api/me")).user}catch{};await render()})();