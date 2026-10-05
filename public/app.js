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

const CW_PHOTOS = [
  {src:"/media/hero-kitty.jpg", title:"Ночной проход", tag:"АРХИВ · 01", note:"Когда кино уже началось, а вы ещё выбираете, кто будет виноват."},
  {src:"/media/hero-selfie.jpg", title:"Главный свидетель", tag:"АРХИВ · 02", note:"Лицо человека, который сказал: «я точно не усну»."},
  {src:"/media/meme-kitty.jpg", title:"Шалом, кино", tag:"АРХИВ · 03", note:"Культурная программа начинается с уверенного шага."},
  {src:"/media/meme-legs.jpg", title:"За растения", tag:"АРХИВ · 04", note:"Сюжетная линия, которую сценаристы явно недооценили."},
  {src:"/media/meme-bees.jpg", title:"Пчелиный спин-офф", tag:"АРХИВ · 05", note:"Когда совместный просмотр неожиданно получил бюджет Netflix."},
  {src:"/media/meme-couple.jpg", title:"Кадр после титров", tag:"АРХИВ · 06", note:"Редкий момент, когда все действительно дошли до финала."},
  {src:"/media/meme-machine.jpg", title:"Большая премьера", tag:"АРХИВ · 07", note:"Слишком много энергии для одного вечера."},
  {src:"/media/meme-mafanya.jpg", title:"Сейчас будет сюжет", tag:"АРХИВ · 08", note:"Когда трейлер обещал одно, а жизнь принесла совсем другое."},
  {src:"/media/meme-ghost.jpg", title:"Бешеный режим", tag:"АРХИВ · 09", note:"После фразы «ещё одну серию и спать»."},
  {src:"/media/meme-leg.jpg", title:"Мини-камео", tag:"АРХИВ · 10", note:"Появился на две секунды. Украл весь экран."},
  {src:"/media/meme-bad-company.jpg", title:"Только с малыми", tag:"АРХИВ · 11", note:"Взрослые ушли. Чат официально потерял контроль."},
  {src:"/media/meme-hug.jpg", title:"Командный просмотр", tag:"АРХИВ · 12", note:"Спойлеры запрещены. Объятия — разрешены."}
];
function photoCard(photo, i){
  return `<article class="cw-photo-card photo-${(i%5)+1}">
    <div class="cw-photo-media"><img src="${photo.src}" alt="${esc(photo.title)}" loading="lazy" decoding="async"><span class="cw-photo-shine"></span><span class="cw-photo-index">${String(i+1).padStart(2,"0")}</span></div>
    <div class="cw-photo-meta"><span>${esc(photo.tag)}</span><b>${esc(photo.title)}</b><small>${esc(photo.note)}</small></div>
  </article>`;
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
  if (!path) return;
  if (location.pathname === path) { render(); return; }
  history.pushState({}, "", path);
  render();
}
window.addEventListener("popstate", render);

function prefixLabel(user=me){
  return `<span class="prefix">${esc(user.secretPrefix || user.prefix || "Лошара")}</span>`;
}
function shell(content){
  app.innerHTML = `<div class="app"><nav class="nav">
    <a class="brand" href="/rooms" data-nav><span class="brand-mark">CW</span><span class="brand-word">CheburekWatch</span></a>
    <div class="navlinks">${me ? `<a class="navlink" href="/rooms" data-nav>Комнаты</a><a class="navlink" href="/profile" data-nav><span class="nav-dot"></span>Профиль · Ур. ${me.level}</a><button class="nav-logout" id="logout">Выйти</button>` : ""}</div>
    <div class="spacer"></div><div class="userpill">${me ? `${prefixLabel(me)} ${esc(me.nickname)} <span class="level-badge">ур. ${me.level}</span>` : ""}</div>
  </nav>${content}</div>`;
  document.querySelectorAll("[data-nav]").forEach(a=>a.onclick=e=>{e.preventDefault();navigate(a.getAttribute("href"))});
  $("#logout")?.addEventListener("click", async()=>{await api("/api/logout",{method:"POST"});me=null;navigate("/login")});
  mountCinemaIntro();
}
function mountCinemaIntro(){
  if(location.pathname!=="/rooms" || sessionStorage.getItem("cw-intro-seen")) return;
  sessionStorage.setItem("cw-intro-seen","1");
  const intro=document.createElement("div");
  intro.className="cinema-intro";
  intro.innerHTML=`
    <div class="cinema-intro-noise"></div>
    <div class="cinema-intro-backdrop"><span class="intro-orb intro-orb-a"></span><span class="intro-orb intro-orb-b"></span><span class="intro-beam intro-beam-a"></span><span class="intro-beam intro-beam-b"></span></div>
    <div class="intro-film intro-film-a">${CW_PHOTOS.slice(0,6).map((p,i)=>`<img src="${p.src}" alt="" data-film-index="${i}">`).join("")}</div>
    <div class="intro-film intro-film-b">${CW_PHOTOS.slice(6,12).map((p,i)=>`<img src="${p.src}" alt="" data-film-index="${i}">`).join("")}</div>
    <div class="cinema-intro-grid"></div>
    <div class="cinema-intro-curtain curtain-left"></div><div class="cinema-intro-curtain curtain-right"></div>
    <div class="cinema-intro-center">
      <div class="cinema-intro-topline"><span></span><b>CHEBUREKWATCH</b><span></span></div>
      <div class="cinema-intro-mark"><span>CW</span><i></i></div>
      <div class="cinema-intro-kicker">ONE FRIEND MODE · 2026</div>
      <div class="cinema-intro-title"><span>ABSOLUTE</span><em>CINEMA</em></div>
      <div class="cinema-intro-sub">смотри вместе · смейся громко · паузу жми коллективно</div>
      <div class="cinema-intro-line"><span></span><b>watch party is loading</b><span></span></div>
      <button class="cinema-intro-enter" type="button"><span>Включить кино</span><i>→</i></button>
      <div class="cinema-intro-skip">автозапуск · 04.2 сек</div>
    </div>
    <div class="cinema-intro-progress"><span></span></div>`;
  document.body.appendChild(intro);
  let closed=false;
  const close=()=>{
    if(closed) return; closed=true;
    intro.classList.add("is-leaving");
    setTimeout(()=>intro.remove(),900);
  };
  intro.querySelector(".cinema-intro-enter").addEventListener("click",close);
  setTimeout(close,4200);
}
function authPage(mode){
  shell(`<main class="auth"><h1 class="title">${mode==="login"?"Вход":"Регистрация"}</h1>
    <p class="muted">${mode==="login"?"Войдите в аккаунт":"Создайте аккаунт для комнат и совместного просмотра"}</p>
    <form id="authform"><div class="field"><label>Никнейм</label><input id="nick" autocomplete="username" maxlength="24" required></div>
    <div class="field"><label>Пароль</label><input id="pass" type="password" autocomplete="${mode==="login"?"current-password":"new-password"}" minlength="8" required></div>
    <div id="formerr"></div><button class="primary" style="width:100%">${mode==="login"?"Войти":"Создать аккаунт"}</button></form>
    <p class="footerhint">${mode==="login"?'Нет аккаунта? <a href="/register" data-nav>Регистрация</a>':'Уже есть аккаунт? <a href="/login" data-nav>Войти</a>'}</p></main>`);
  document.querySelectorAll("[data-nav]").forEach(a=>a.onclick=e=>{e.preventDefault();navigate(a.getAttribute("href"))});
  $("#authform").onsubmit=async e=>{e.preventDefault();try{const d=await api(mode==="login"?"/api/login":"/api/register",{method:"POST",body:JSON.stringify({nickname:$("#nick").value,password:$("#pass").value})});me=d.user;navigate("/rooms")}catch(err){$("#formerr").innerHTML=`<div class="error">${esc(err.message)}</div>`}};
}
async function roomsPage(){
  const d=await api("/api/my-rooms");
  shell(`<main class="page">
    <section class="hero hero-v11">
      <div class="hero-scene" aria-hidden="true"><span class="scene-orb scene-orb-a"></span><span class="scene-orb scene-orb-b"></span><span class="scene-window"></span><span class="scene-sofa"></span><span class="scene-lamp"></span><span class="scene-floor-glow"></span></div>
      <div class="hero-art" aria-hidden="true">
        <div class="poster poster-a photo-poster"><img src="/media/hero-kitty.jpg" alt=""><span class="poster-kicker">01</span><div class="poster-shade"></div><div class="poster-copy"><b>Ночной<br>киносеанс</b><small>соберите своих</small></div></div>
        <div class="poster poster-b photo-poster"><img src="/media/hero-selfie.jpg" alt=""><span class="poster-kicker">02</span><div class="poster-shade"></div><div class="poster-copy"><b>Серия<br>за серией</b><small>пауза только общая</small></div></div>
        <div class="poster poster-c photo-poster"><img src="/media/meme-ghost.jpg" alt=""><span class="poster-kicker">03</span><div class="poster-shade"></div><div class="poster-copy"><b>Чебурек<br>премьер</b><small>критика после титров</small></div></div>
      </div>
      <div class="hero-copy">
        <div class="eyebrow"><span class="eyebrow-line"></span> КИНО · СЕРИАЛЫ · ДРУЗЬЯ <span class="eyebrow-line"></span></div>
        <h1 class="hero-title"><span class="hero-line">Смотри.</span><span class="hero-line">Общайся.</span><span class="hero-line hero-line-accent">Одному —<br><strong>преступление.</strong></span></h1>
        <p class="hero-sub">Создай комнату. Позови своих. И сделайте вид, что сегодня точно досмотрите серию — без «а на какой минуте?» и внезапного исчезновения друга.</p>
      </div>
      <div class="hero-rail">
        <div class="hero-side-note"><span class="status-dot"></span><div><b>Синхрон жив</b><small>пауза, перемотка и паника — общие</small></div></div>
        <div class="hero-actions"><button id="create" class="primary hero-main-cta"><span>Создать комнату</span><i>→</i></button><button class="secondary hero-secondary-cta" id="scrollRooms"><span>У меня уже есть код</span><i>↓</i></button></div>
        <div class="hero-rail-note"><span>ОДИН ЭКРАН · ОДНА КОМНАТА</span><small>Один экран. Одна комната. Слишком много мнений.</small></div>
      </div>
    </section>
    <section id="roomsSection">
      <div class="section-head"><div><h2>Мои комнаты</h2><p class="muted">Там, где вы остановились. Или где кто-то опять нажал паузу.</p></div></div>
      <div class="card join-card"><form id="joinform" class="row"><input id="joincode" class="join-code-input" placeholder="Введи код комнаты · ABC123" maxlength="6" inputmode="text" autocomplete="off"><button class="secondary">Войти по коду</button></form><div id="joinerr"></div></div>
      <div class="cw-joke-bar"><span class="joke-spark">✦</span><span>${esc(cwJoke())}</span><button type="button" id="newJoke" title="Ещё шутку">↻</button></div>
      <div class="cards">${d.rooms.length?d.rooms.map(r=>`<div class="card room-card"><div class="room-glow"></div><div class="room-top"><div><span class="code">${r.code}</span><span class="live-pill">${r.participantCount} онлайн</span></div>${r.ownerId===me.id?`<button class="icon-danger" data-delete="${r.code}" title="Удалить комнату">×</button>`:""}</div><div class="room-name">${r.media?esc(r.media.type==="youtube"?"YouTube":r.media.type==="vk"?"VK Video":"Видео файл"):"Пустая комната"}</div><div class="stat"><span>Статус</span><span>${r.media?"Готова к просмотру":"Ожидает видео"}</span></div><button type="button" class="room-open" data-open="${r.code}"><span>Открыть комнату</span><span>↗</span></button></div>`).join(""):`<div class="empty-state"><div class="empty-icon">CW</div><h3>Здесь пока тихо</h3><p>Создай комнату. Позови друзей. Сделайте вид, что сегодня точно досмотрите серию.</p><button class="primary" id="create2">Создать первую комнату</button></div>`}</div>
    </section>
    <section class="creator-home glass-section" id="creatorHome"><div class="creator-home-orb">CW</div><div><div class="eyebrow">CHEBUREKWATCH · BEHIND THE SCENES</div><h2>Создатели</h2><p class="muted">Те, кто однажды решил: «А давайте ещё и синхронизацию починим».</p></div><button id="creatorHomeBtn" class="primary">Открыть список →</button></section>
    <section class="fun-strip">
      <div class="fun-card"><span class="strip-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3"></rect><path d="M8 4v4M16 4v4M3 9h18M8 14h3M13 14h3M8 17h3"></path></svg></span><span><b>Киноночь</b><small>Соберите свою компанию</small></span><em>01</em></div>
      <div class="fun-card"><span class="strip-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19V9M12 19V5M19 19v-8"></path><path d="M3 19h18"></path></svg></span><span><b>Серия за серией</b><small>Прогресс превращается в уровни</small></span><em>02</em></div>
      <div class="fun-card"><span class="strip-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.5 5 5.5.8-4 3.9.9 5.5-4.9-2.6-4.9 2.6.9-5.5-4-3.9 5.5-.8L12 3Z"></path></svg></span><span><b>Достижения</b><small>Открывай новые титулы</small></span><em>03</em></div>
    </section>
    <section class="cw-archive glass-section" id="cwArchive">
      <div class="archive-head">
        <div><div class="eyebrow">CHEBUREK PICTURE HOUSE · ARCHIVE</div><h2>Кадры, которые заслужили отдельный экран</h2><p class="muted">Все фотографии из свежего архива. Мы не знаем, что это за киновселенная, но она явно уже канон.</p></div>
        <div class="archive-stamp"><b>12</b><span>кадров<br>без цензуры</span></div>
      </div>
      <div class="cw-photo-grid">${CW_PHOTOS.map(photoCard).join("")}</div>
      <div class="archive-foot"><span>PROOF OF CINEMA</span><span>▲ листать не обязательно · достаточно восхищаться</span></div>
    </section>
  </main>`);
  $("#create")?.addEventListener("click", createRoom); $("#create2")?.addEventListener("click", createRoom);
  $("#scrollRooms")?.addEventListener("click",()=>document.getElementById("roomsSection").scrollIntoView({behavior:"smooth"}));
  $("#newJoke")?.addEventListener("click",()=>{const b=$("#newJoke");const text=b.parentElement?.querySelector("span:nth-child(2)");if(text){text.textContent=cwJoke();b.animate([{transform:"rotate(0deg)"},{transform:"rotate(180deg)"}],{duration:350,easing:"cubic-bezier(.2,.8,.2,1)"})}});
  $("#creatorHomeBtn")?.addEventListener("click",()=>openCreatorPanel(null));
  // Event delegation is more reliable here than binding handlers to every card.
  // It also keeps the button working after any partial DOM refresh.
  const roomsSection = $("#roomsSection");
  roomsSection?.addEventListener("click", async e=>{
    const openBtn = e.target.closest("[data-open]");
    if (openBtn) {
      e.preventDefault();
      e.stopPropagation();
      const code = String(openBtn.dataset.open || "").trim().toUpperCase();
      if (!/^[A-Z0-9]{6}$/.test(code)) return;
      openBtn.disabled = true;
      openBtn.classList.add("is-loading");
      try {
        await api(`/api/rooms/${code}/join`, {method:"POST"});
        navigate("/room/"+code);
      } catch (err) {
        toast(err.message || "Не удалось открыть комнату");
        openBtn.disabled = false;
        openBtn.classList.remove("is-loading");
      }
      return;
    }
    const deleteBtn = e.target.closest("[data-delete]");
    if (!deleteBtn) return;
    e.preventDefault();
    e.stopPropagation();
    const code=deleteBtn.dataset.delete;
    if(!confirm(`Удалить комнату ${code}? Это удалит её сообщения и доступ к комнате.`)) return;
    try { await api(`/api/rooms/${code}`,{method:"DELETE"}); await roomsPage(); }
    catch(err) { toast(err.message || "Не удалось удалить комнату"); }
  });
  $("#joinform").onsubmit=async e=>{e.preventDefault();try{const code=$("#joincode").value.trim().toUpperCase();await api(`/api/rooms/${code}/join`,{method:"POST"});navigate("/room/"+code)}catch(err){$("#joinerr").innerHTML=`<div class="error">${esc(err.message)}</div>`}};
}
async function createRoom(){try{const d=await api("/api/rooms",{method:"POST"});navigate("/room/"+d.room.code)}catch(e){alert(e.message)}}
async function profilePage(){
  const d=await api("/api/profile"); me=d.user;
  const next=me.minutesToNext||20, hours=Math.floor(me.watchMinutes/60), mins=me.watchMinutes%60;
  const unlocked=d.user.achievements.length,totalAch=d.user.availableAchievements.length;
  const nextTitle=me.nextPrefix?`ур. ${me.nextPrefix.level} · ${me.nextPrefix.name}`:"Максимальный титул";
  shell(`<main class="page profile-page">
    <section class="profile-cover"><div class="profile-gridline"></div><div class="profile-orbit orbit-a"></div><div class="profile-orbit orbit-b"></div>
      <div class="profile-avatar-wrap"><div class="profile-avatar">${esc(me.nickname.slice(0,1).toUpperCase())}</div><span class="online-ring"></span></div>
      <div class="profile-copy"><div class="eyebrow">ЛИЧНОЕ ДОСЬЕ · CHEBUREKWATCH</div>
        <div class="profile-title-row"><div><div class="profile-prefix">${esc(me.secretPrefix || me.prefix)}</div><h1>${esc(me.nickname)}</h1></div><div class="level-orb"><strong>${me.level}</strong><span>УР.</span></div></div>
        <div class="profile-sub">Следующий титул: <b>${esc(nextTitle)}</b></div>
        <div class="mega-xp"><div class="mega-xp-fill" style="width:${me.progress}%"></div></div>
        <div class="xp-caption"><span>${Math.round(me.progress)}% прогресса</span><span>${next} мин. до следующего уровня</span></div>
      </div>
    </section>
    <section class="profile-memory">
      <div class="profile-memory-copy"><div class="eyebrow">PRIVATE SCREENING · MEMORY REEL</div><h2>Твоя история просмотра</h2><p class="muted">Не спрашивай, почему в личном досье лежит пчела. Просто листай дальше.</p></div>
      <div class="profile-memory-strip">
        ${CW_PHOTOS.slice(4,8).map((p,i)=>`<figure class="memory-photo memory-${i+1}"><img src="${p.src}" alt="${esc(p.title)}" loading="lazy" decoding="async"><figcaption>${esc(p.title)}</figcaption></figure>`).join("")}
      </div>
    </section>
    <section class="profile-stats">
      <div class="stat-card"><span class="stat-icon">◷</span><div><small>Время просмотра</small><strong>${hours}ч ${mins}м</strong></div></div>
      <div class="stat-card"><span class="stat-icon">◆</span><div><small>Текущий уровень</small><strong>${me.level}</strong></div></div>
      <div class="stat-card"><span class="stat-icon">✦</span><div><small>Достижения</small><strong>${unlocked}<i> / ${totalAch}</i></strong></div></div>
      <div class="stat-card"><span class="stat-icon">→</span><div><small>Следующий титул</small><strong class="small-stat">${esc(me.nextPrefix?.name||"Максимум")}</strong></div></div>
    </section>
    <section class="profile-grid-two">
      <section class="glass-section"><div class="section-title-row"><div><div class="eyebrow">COLLECTION</div><h2>Достижения</h2></div><span class="counter">${unlocked}/${totalAch}</span></div>
        <div class="achievement-grid">${d.user.availableAchievements.map(a=>{const on=d.user.achievements.some(x=>x.id===a.id);return `<article class="achievement ${on?"unlocked":"locked"}"><div class="achievement-shine"></div><div class="achievement-icon">${a.icon}</div><div class="achievement-body"><b>${esc(a.title)}</b><p>${esc(a.desc)}</p></div><span class="achievement-state">${on?"✓":"○"}</span></article>`}).join("")}</div>
      </section>
      <section class="glass-section"><div class="section-title-row"><div><div class="eyebrow">RANK LADDER</div><h2>Титулы</h2></div></div>
        <div class="title-ladder">${[[1,"Лошара"],[5,"Нормис"],[10,"Киноман"],[20,"Запойный зритель"],[30,"Культовый зритель"],[50,"Легенда дивана"],[75,"Повелитель запоя"],[100,"Мифический чебурек"]].map(([lvl,name])=>`<div class="title-step ${me.level>=lvl?"active":""} ${me.level===lvl?"current":""}"><span class="title-line"></span><span class="title-level">${lvl}</span><div><b>${name}</b><small>${me.level>=lvl?"Открыт":"Закрыт"}</small></div>${me.level===lvl?'<span class="current-pill">СЕЙЧАС</span>':""}</div>`).join("")}</div>
      </section>
    </section>
    <div class="profile-tip"><span>✦</span><div><b>Как качаться?</b><p>Каждые 20 минут реального воспроизведения в комнате дают +1 уровень. Чем дольше смотрите вместе — тем выше ваш титул.</p></div></div>
  </main>`);
}
function playerHtml(media){
  if(!media) return `<div class="emptyvideo"><img src="/media/meme-bees.jpg" alt="" loading="lazy"><div class="emptyvideo-shade"></div><div class="emptyvideo-copy"><span>PRIVATE SCREENING</span><b>Экран ждёт главного героя.</b><small>Добавьте YouTube, VK Video или прямую ссылку на видео. Пчёлы уже заняли первый ряд.</small></div></div>`;
  if(media.type==="youtube") return `<div class="player-frame yt-stage" id="yt"><div class="player-loading">Подключаем видео…</div></div>`;
  if(media.type==="vk") return `<iframe class="player-frame" id="vkframe" allow="autoplay; encrypted-media; fullscreen; picture-in-picture" allowfullscreen src="${esc(media.url)}"></iframe>`;
  return `<video class="player-frame" id="htmlvideo" playsinline preload="metadata" src="${esc(media.url)}"></video>`;
}
async function roomPage(code){
  try {
    const d=await api(`/api/rooms/${encodeURIComponent(code)}`); room=d.room;
    shell(`<main class="page room-page"><div class="room-header"><div><div class="eyebrow">PRIVATE WATCH ROOM · <span class="live-word">LIVE</span></div><h1 class="title">Комната <span class="code">${room.code}</span></h1><p class="muted small">Смотрим вместе. Стыдно будет выключить первым.</p></div><div class="room-header-joke">${esc(cwJoke())}</div><div class="room-actions"><button id="invite" class="outline-btn">↗ <span>Пригласить</span></button><button id="creatorBtn" class="outline-btn creator-btn">♛ <span>Создатель</span></button>${room.ownerId===me.id?`<button id="deleteRoom" class="danger-outline">⌫ <span>Удалить</span></button>`:""}</div></div>
    <div class="roomlayout mobile-resizable ${room.media?"has-media":"needs-media"}" style="--mobile-split:50%"><section class="panel"><div class="video video-shell" id="videobox">${playerHtml(room.media)}<div class="player-overlay" id="playerOverlay"><button type="button" class="player-chat-toggle" id="playerChatToggle"><span class="player-glyph">CHAT</span></button><button type="button" class="player-fullscreen" id="playerFullscreen"><span class="player-glyph">FULL</span></button><div class="overlay-chat" id="overlayChat"><div class="overlay-head"><b>Чат</b><button id="overlayClose">×</button></div><div class="overlay-messages" id="overlayMessages"></div><form id="overlayForm" autocomplete="off"><input id="overlayInput" maxlength="500" placeholder="Написать сообщение…" autocomplete="off"><button type="submit">➤</button></form></div></div></div><div class="toolbar">
      <form id="mediaform" class="mediaform"><input id="mediaurl" placeholder="YouTube / VK / прямая ссылка" required><button class="primary"><span class="desktop-add">Добавить видео</span><span class="mobile-add">Подкинуть кино</span></button></form>
      <div id="mediaerr"></div>
      <button type="button" class="mobile-media-toggle" id="mobileMediaToggle"><span class="mobile-media-plus">＋</span><span>Сменить кино</span></button>
      ${room.media?`<div class="footerhint">Источник: <a href="${esc(room.media.sourceUrl)}" target="_blank" rel="noopener noreferrer">${esc(room.media.sourceUrl)}</a></div>`:""}
    </div></section><div class="mobile-splitter" id="mobileSplitter" role="separator" aria-label="Изменить размер видео и чата" aria-orientation="horizontal"><span></span></div>
    <aside class="panel side"><div class="participants"><h3>Участники</h3><div id="people">${peopleHtml(room.users)}</div></div>
      <div class="chat"><div class="chat-headline"><div><span class="chat-live-dot"></span><h3>Чат</h3></div><small>молчать воспрещается</small></div><div class="messages" id="messages"></div><div class="reaction-picker"><button type="button" data-chat-reaction="heart"><span class="reaction-glyph">♥</span></button><button type="button" data-chat-reaction="lol"><span class="reaction-glyph">LOL</span></button><button type="button" data-chat-reaction="fire"><span class="reaction-glyph">✦</span></button><button type="button" data-chat-reaction="wow"><span class="reaction-glyph">!</span></button><button type="button" data-chat-reaction="rip"><span class="reaction-glyph">☟</span></button><button type="button" data-chat-reaction="clap"><span class="reaction-glyph">//</span></button><button type="button" data-chat-reaction="skull"><span class="reaction-glyph">†</span></button><button type="button" data-chat-reaction="pop"><span class="reaction-glyph">•••</span></button></div><form id="chatform" class="chatform" autocomplete="off"><input id="chatinput" class="chatinput" maxlength="500" placeholder="Написать сообщение…" autocomplete="off"><button type="submit" class="secondary">→</button></form></div>
    </aside></div></main>`);
    bindRoom(code);
  } catch(e){ shell(`<main class="page"><div class="error">${esc(e.message)}</div><a href="/rooms" data-nav>Вернуться к комнатам</a></main>`); document.querySelectorAll("[data-nav]").forEach(a=>a.onclick=x=>{x.preventDefault();navigate("/rooms")}); }
}
function peopleHtml(users){return users.length?users.map(u=>`<div class="person"><span class="dot"></span><div><div>${esc(u.nickname)}</div><div class="level"><span class="prefix-mini">${esc(u.prefix||"Лошара")}</span> · ур. ${u.level}</div></div>${u.id===me.id?'<span class="level">(вы)</span>':""}</div>`).join(""):`<span class="muted small">Никого онлайн</span>`}
async function bindRoom(code){
  const inviteUrl=location.origin+"/room/"+code;
  $("#invite").onclick=async()=>{try{await navigator.clipboard.writeText(inviteUrl);const b=$("#invite");b.innerHTML="✓ <span>Скопировано</span>";setTimeout(()=>b.innerHTML="↗ <span>Пригласить</span>",1500)}catch{prompt("Ссылка на комнату",inviteUrl)}};
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
  eventSource.onerror=()=>{ /* EventSource автоматически переподключится; heartbeat остаётся fallback-синхронизацией */ };
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
  let t=document.querySelector(".cw-toast"); if(!t){t=document.createElement("div");t.className="cw-toast";document.body.appendChild(t)}
  t.textContent=message; t.classList.add("show"); clearTimeout(t._t); t._t=setTimeout(()=>t.classList.remove("show"),2600);
}
function openCreatorPanel(code){
  document.querySelector(".creator-modal")?.remove();
  const modal=document.createElement("div"); modal.className="creator-modal";
  modal.innerHTML=`<div class="creator-card"><button class="creator-close">×</button><div class="eyebrow">CHEBUREKWATCH · CREATOR</div><h2>Создатель</h2><p class="creator-sub">За этой чебуречной стоят:</p><div class="creator-names">
    <div class="creator-name">Чат жпт</div><div class="creator-name">ручки мэтью</div><div class="creator-name">дмитрий нагиев</div><div class="creator-name">мафаня</div><div class="creator-name">влад dior <button class="secret-trigger" type="button">armain <span>✦</span></button></div><div class="creator-name">андрей ноилз</div>
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
function appendMessage(m){const box=$("#messages");if(!box)return;const div=document.createElement("div");div.className="msg";div.dataset.mid=m.id;div.innerHTML=`<div class="msghead">${esc(m.nickname)} · ${new Date(m.createdAt).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}</div><div class="msgtext">${esc(m.text)}</div>${reactionHtml(m)}`;box.appendChild(div);bindReactionButtons(div);box.scrollTop=box.scrollHeight;syncOverlayMessages()}
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
  player=null; vkPlayer=null; localVideo=null; lastYTPosition=null; lastVKPosition=null; lastAppliedSeq=0; remoteApplyUntil=0;
  const box=$("#videobox"); if(!box)return; const current=room.media;
  const layout=document.querySelector(".roomlayout.mobile-resizable");
  layout?.classList.toggle("has-media",!!current);
  layout?.classList.toggle("needs-media",!current);
  layout?.classList.remove("media-editor-open");
  const mediaToggle=$("#mobileMediaToggle");
  mediaToggle?.addEventListener("click",()=>layout?.classList.toggle("media-editor-open"));
  box.innerHTML=playerHtml(current)+`<div class="player-overlay" id="playerOverlay"><button type="button" class="player-chat-toggle" id="playerChatToggle"><span class="player-glyph">CHAT</span></button><button type="button" class="player-fullscreen" id="playerFullscreen"><span class="player-glyph">FULL</span></button><div class="overlay-chat" id="overlayChat"><div class="overlay-head"><b>Чат</b><button id="overlayClose">×</button></div><div class="overlay-messages" id="overlayMessages"></div><form id="overlayForm" autocomplete="off"><input id="overlayInput" maxlength="500" placeholder="Написать сообщение…" autocomplete="off"><button type="submit">➤</button></form></div></div>`;
  setupPlayerOverlay();
  if(!current)return;
  if(current.type==="youtube"){
    window.onYouTubeIframeAPIReady=()=>{ if(room?.media?.type==="youtube") initYT(); };
    loadYouTubeAPI().then(ok=>{
      if(ok) initYT();
      else {
        const host=$("#yt");
        if(host) host.innerHTML='<div class="player-error"><b>YouTube сейчас недоступен</b><small>Плеер не загрузился. Сам CheburekWatch работает — попробуйте VK Video или прямую ссылку на файл.</small></div>';
      }
    });
  }
  if(current.type==="vk"){
    loadVKAPI().then(ok=>{
      if(ok) initVK();
      else {
        const host=$("#vkframe")?.parentElement;
        if(host) host.innerHTML='<div class="player-error"><b>VK Video не загрузил API</b><small>Проверьте соединение и попробуйте открыть комнату ещё раз.</small></div>';
      }
    });
  }
  if(current.type==="direct"){
    localVideo=$("#htmlvideo");
    localVideo.addEventListener("play",()=>{if(!suppress && Date.now()>remoteApplyUntil)sendState(true,localVideo.currentTime,"play")});
    localVideo.addEventListener("pause",()=>{if(!suppress && Date.now()>remoteApplyUntil)sendState(false,localVideo.currentTime,"pause")});
    localVideo.addEventListener("seeked",()=>{if(!suppress && Date.now()>remoteApplyUntil)sendState(!localVideo.paused,localVideo.currentTime,"seek")});
    localVideo.addEventListener("loadedmetadata",()=>applyRemoteState(room));
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
  if(eventSource){eventSource.close();eventSource=null} clearInterval(window.__cwHeartbeat); clearInterval(window.__cwMessageRefresh); clearInterval(window.__ytSeekWatch);
  const path=location.pathname;
  if(!me && path!="/login" && path!="/register"){navigate("/login");return}
  if(path==="/login"){authPage("login");return}
  if(path==="/register"){authPage("register");return}
  if(path==="/rooms"||path==="/"){roomsPage();return}
  if(path==="/profile"){profilePage();return}
  const m=path.match(/^\/room\/([A-Za-z0-9]+)$/);
  if(m){await roomPage(m[1].toUpperCase());return}
  const fallback = me ? "/rooms" : "/login";
  if (location.pathname !== fallback) {
    history.replaceState({}, "", fallback);
    render();
  }
}

function initCinematicIntro(){
  if(document.querySelector(".cw-intro"))return;
  const reduced=window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  const returning=sessionStorage.getItem("cw-seen-intro");
  const intro=document.createElement("div");
  intro.className="cw-intro";
  intro.setAttribute("aria-label","CheburekWatch загружается");
  intro.innerHTML='<div class="cw-intro-ambient"></div><div class="cw-intro-grain"></div><div class="cw-intro-logo"><div class="cw-intro-mark">Ч</div><div class="cw-intro-name">CHEBUREK<b>WATCH</b></div><div class="cw-intro-sub">совместный кинопросмотр</div></div><div class="cw-intro-line"></div>';
  document.body.appendChild(intro);
  const hold=reduced?120:(returning?650:1850);
  setTimeout(()=>intro.classList.add("is-leaving"),hold);
  setTimeout(()=>{intro.remove();sessionStorage.setItem("cw-seen-intro","1")},hold+(reduced?40:700));
}

(async()=>{initCinematicIntro();try{me=(await api("/api/me")).user}catch{};render()})();