import {progressEndpoint} from './cloud-config.js';
import {readStorage,writeStorage} from './storage.js';
import {levels,ships,legacyFleet} from './campaign.js';
import {duelStages,duelCredit} from './duels.js';

const get = id => document.getElementById(id);
const offlineKey = 'stormcore-campaign';
const profileKey = 'stormcore-pilot';
const codePattern = /^[a-z0-9]{3,16}(?:-[a-hj-km-np-z2-9]{5}){4}$/;
const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
const transitionPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const tuneCosts = {
  engine:[550,1100,2100],
  armor:[650,1250,2350],
  weapon:[700,1400,2600]
};

export function tunePrice(kind,tier) {
  return Number.isInteger(tier) && Object.hasOwn(tuneCosts,kind) ? tuneCosts[kind][tier] ?? null : null;
}

function read(key,fallback) {
  try {return JSON.parse(readStorage(key)) ?? fallback;} catch {return fallback;}
}
function write(key,value) {
  try {writeStorage(key,JSON.stringify(value));} catch {}
}
const int = (value,max) => Math.min(max,Math.max(0,Math.floor(Number(value) || 0)));
function clean(value) {
  const cleared = int(value?.cleared,levels.length);
  const owned = Array.isArray(value?.owned)
    ? [0,...value.owned.filter(id=>Number.isInteger(id) && id > 0 && id < ships.length)]
    : legacyFleet(cleared);
  const tuning = {};
  for (const id of owned) {
    const parts = value?.tuning?.[id];
    if (!parts) continue;
    const ranks = Object.fromEntries(Object.keys(tuneCosts).flatMap(kind=>{
      const rank = int(parts[kind],3);
      return rank ? [[kind,rank]] : [];
    }));
    if (Object.keys(ranks).length) tuning[id] = ranks;
  }
  return {
    cleared,duels:int(value?.duels,duelStages.length),duelPaid:int(value?.duelPaid ?? value?.duel_paid,duelStages.length),best:int(value?.best,1000000000),credits:int(value?.credits,1000000000),owned:[...new Set(owned)],
    epoch:int(value?.epoch,2147483647),favorite:owned.includes(value?.favorite) ? value.favorite : null,
    tuning,hasArchive:Boolean(value?.hasArchive ?? value?.has_archive)
  };
}

function mergeMetrics(source,local) {
  const progress = clean(source);
  return {...progress,cleared:Math.max(progress.cleared,local.cleared),best:Math.max(progress.best,local.best),
    duels:Math.max(progress.duels,local.duels)};
}

const hasBetterMetrics = (local,remote)=>local.cleared>remote.cleared || local.best>remote.best || local.duels>remote.duels;

function pendingFlights(value) {
  if (!Array.isArray(value)) return [];
  return [...new Map(value.filter(flight=>flight && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(flight.id) &&
    Number.isInteger(flight.amount) && flight.amount > 0 && flight.amount <= 100000).map(flight=>[flight.id,flight])).values()];
}

const storedOffline = read(offlineKey,{});
let offline = clean(storedOffline);
function awardOfflineDuels() {
  for (let i=offline.duelPaid;i<offline.duels;i++) offline.credits = int(offline.credits+duelCredit(i),1000000000);
  offline.duelPaid = offline.duels;
  for (const [id,ship] of ships.entries()) {
    if (ship.duelReward && offline.duels>=ship.duelReward && !offline.owned.includes(id)) offline.owned.push(id);
  }
}
awardOfflineDuels();
let offlineArchive = storedOffline.archive ? clean(storedOffline.archive) : null;
if (!offline.epoch) offline.best = Math.max(offline.best,int(read('stormcore-best',0),1000000000));
let profile = read(profileKey,null);
if (!profile || !codePattern.test(profile.code)) profile = null;
else {
  profile.flights = pendingFlights(profile.flights);
  const transition = profile.transition;
  if (!transition || !['reset','restore'].includes(transition.action) ||
      !Number.isInteger(transition.epoch) || !transitionPattern.test(transition.id)) delete profile.transition;
}
let changed = () => {};
let setupMode = 'create';
let busy = false;
let request;
let requestProfile;
let updating = false;
let pendingCode = '';
let pendingAlias = '';
const element = () => get('profileDialog');

export function currentProgress() {
  const progress = clean(profile ? profile.progress : offline);
  return {...progress,hasArchive:profile ? progress.hasArchive : Boolean(offlineArchive),
    pending:profile?.flights.reduce((sum,flight)=>sum+flight.amount,0) ?? 0};
}

function persist(activate = false) {
  if (profile) write(profileKey,profile);
  else write(offlineKey,{...offline,archive:offlineArchive});
  changed(activate);
}

function codeFrom(alias) {
  const bits = crypto.getRandomValues(new Uint8Array(40));
  const symbols = [...bits].filter(value=>value < 256-(256%alphabet.length))
    .map(value=>alphabet[value%alphabet.length]).slice(0,20);
  if (symbols.length < 20) return codeFrom(alias);
  return alias+'-'+symbols.join('').match(/.{5}/g).join('-');
}

async function pendingKey(code) {
  const digest = window.stormcoreNative?.digest
    ? await window.stormcoreNative.digest(code)
    : [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(code)))]
      .map(byte=>byte.toString(16).padStart(2,'0')).join('');
  return 'stormcore-pending-'+digest;
}

async function api(action,code,progress,flights = [],options = {}) {
  const unavailable = 'Облако временно недоступно. Прогресс на этом устройстве сохранён.';
  if (!progressEndpoint) throw new Error(unavailable);
  const payload = {
    campaign:5,action,code,epoch:action === 'create' ? 0 : progress.epoch,
    cleared:progress.cleared,best:progress.best,duels:progress.duels,duelPaid:action === 'create' ? progress.duelPaid : 0,flights,
    credits:action === 'create' ? progress.credits : 0,
    owned:action === 'create' ? progress.owned : [0],
    favorite:action === 'create' ? progress.favorite : null,
    tuning:action === 'create' ? progress.tuning : {},
    ...options
  };
  let status;
  let data;
  try {
    if (window.stormcoreNative?.exchange) {
      ({status,data} = await window.stormcoreNative.exchange(payload));
    } else {
      const response = await fetch(progressEndpoint,{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify(payload),signal:AbortSignal.timeout(9500),cache:'no-store'
      });
      status = response.status;
      if (response.ok) data = await response.json();
    }
  } catch {
    throw new Error(unavailable);
  }
  if (status === 404) throw new Error('Код не найден. Проверь позывной и все четыре группы символов.');
  if (status !== 200) throw new Error(unavailable);
  return {...clean(data),bought:data?.bought === true};
}

function note(text) {
  get('profileNote').textContent = text;
}

function formMode(mode) {
  setupMode = mode;
  const creating = mode === 'create';
  get('newPilot').setAttribute('aria-pressed',String(creating));
  get('returnPilot').setAttribute('aria-pressed',String(!creating));
  get('pilotLabel').textContent = creating ? 'Твой позывной' : 'Полный код';
  get('pilotCode').placeholder = creating ? '3–16 латинских букв или цифр' : 'Позывной и четыре группы символов';
  get('pilotCode').value = '';
  get('profileSubmit').textContent = creating ? 'Создать код' : 'Загрузить прогресс';
  note('');
}

function refreshDialog() {
  get('profileForm').hidden = Boolean(profile);
  get('profileActions').hidden = !profile;
  get('codeCard').hidden = true;
  get('localPlay').hidden = Boolean(profile);
  get('profileCopy').hidden = false;
  get('profileCopy').textContent = profile
    ? 'Позывной ' + profile.code.split('-')[0].toUpperCase() + '. Код сохранён в этом браузере.'
    : 'Придумай позывной. Игра добавит к нему секретный ключ. Сохрани весь код, чтобы продолжить на другом устройстве.';
  note(profile && hasPending(profile) ? 'Ожидается синхронизация с облаком.' : '');
}

function showCode() {
  get('profileActions').hidden = true;
  get('profileCopy').hidden = true;
  get('codeCard').hidden = false;
  get('profileCode').textContent = profile.code;
}

async function exchangeProfile(active,action,options = {}) {
  const snapshot = clean(active.progress);
  const batch = ['load','reset','restore'].includes(action) ? [] : active.flights.slice(0,40);
  const remote = await api(action,active.code,snapshot,batch,options);
  if (profile !== active) return remote;

  const changedEpoch = remote.epoch !== snapshot.epoch;
  if (changedEpoch) {
    // An earlier campaign's offline results belong to its archived generation.
    active.flights = [];
    active.progress = {...clean(remote),duels:Math.max(remote.duels,clean(active.progress).duels)};
  } else {
    const accepted = new Set(batch.map(flight=>flight.id));
    active.flights = active.flights.filter(flight=>!accepted.has(flight.id));
    active.progress = mergeMetrics(remote,clean(active.progress));
  }
  active.dirty = hasBetterMetrics(active.progress,remote);
  if (options.transition && options.transition === active.transition?.id) delete active.transition;
  persist(changedEpoch);
  return remote;
}

const hasPending = active => active.dirty || active.flights.length || active.transition;

function track(active,operation) {
  requestProfile = active;
  request = operation.finally(()=>{request=null;requestProfile=null;});
  return request;
}

function synchronize() {
  if (!profile) return Promise.resolve(true);
  if (request) return requestProfile === profile ? request : request.then(()=>synchronize());
  const active = profile;
  return track(active,(async ()=>{
    do {
      const transition = active.transition;
      if (transition) {
        await exchangeProfile(active,transition.action,{epoch:transition.epoch,transition:transition.id});
      } else {
        await exchangeProfile(active,active.dirty || active.flights.length ? 'save' : 'load');
      }
    } while (profile === active && hasPending(active));
    if (profile === active) note('Прогресс в облаке обновлён.');
    return profile === active;
  })().catch(error=>{
    if (profile === active) note(error.message || 'Не удалось подключиться к облаку.');
    return false;
  }));
}

function actionId() {
  const hex = [...crypto.getRandomValues(new Uint8Array(16))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
  return [hex.slice(0,8),hex.slice(8,12),'4'+hex.slice(13,16),'a'+hex.slice(17,20),hex.slice(20)].join('-');
}

export function flightSaveToken() {
  return {profile,epoch:currentProgress().epoch};
}

export function recordFlight(level,won,score,amount,token) {
  if (token && (token.profile !== profile || token.epoch !== currentProgress().epoch)) return false;
  const result = clean({cleared:won ? level+1 : 0,best:score,owned:[0]});
  const award = int(amount,100000);
  if (profile) {
    const before = clean(profile.progress);
    profile.progress = mergeMetrics(before,result);
    profile.dirty ||= result.cleared > before.cleared || result.best > before.best;
    if (award) profile.flights.push({id:actionId(),amount:award});
  } else {
    offline = mergeMetrics(offline,result);
    offline.credits = int(offline.credits+award,1000000000);
  }
  persist();
  if (profile && hasPending(profile)) synchronize();
  return true;
}

export function recordDuel(level,token) {
  if (token?.profile !== profile || !Number.isInteger(level) || level < 0 || level >= duelStages.length ||
      level !== currentProgress().duels) return false;
  if (profile) {
    profile.progress = {...clean(profile.progress),duels:level+1};
    profile.dirty = true;
  } else {
    offline.duels = level+1;
    awardOfflineDuels();
  }
  persist();
  if (profile) synchronize();
  return true;
}

async function mutateCloud(action,options = {}) {
  if (!profile || updating) return false;
  const active = profile;
  const epoch = clean(active.progress).epoch;
  const changingCampaign = action === 'reset' || action === 'restore';
  const existing = active.transition;
  updating = true;
  try {
    if (request) await request;
    if (profile !== active) return false;
    if (changingCampaign && existing && existing.action === action && !active.transition) return true;
    if (active.transition && (!changingCampaign || action !== active.transition.action)) return false;
    if (changingCampaign && !active.transition || active.flights.length > 40) {
      if (!await synchronize()) throw new Error('Синхронизация не завершилась. Повтори действие после подключения.');
    }
    if (profile !== active || clean(active.progress).epoch !== epoch && !active.transition) return false;
    if (changingCampaign) {
      const transition = active.transition ?? {action,epoch,id:actionId()};
      active.transition = transition;
      persist();
      options = {epoch:transition.epoch,transition:transition.id};
    }
    const remote = exchangeProfile(active,action,options);
    track(active,remote.then(()=>true,()=>false));
    const result = await remote;
    return profile === active && result.bought;
  } finally {
    updating = false;
    if (profile === active && !active.transition && hasPending(active)) {
      if (request) request.then(()=>synchronize());
      else synchronize();
    }
  }
}

export async function purchaseShip(index) {
  const craft = ships[index];
  if (!Number.isInteger(index) || !craft || !Number.isFinite(craft.price) || updating) return false;
  if (currentProgress().owned.includes(index)) return true;
  if (profile) return mutateCloud('buy',{ship:index});
  if (offline.credits < craft.price) return false;
  offline.credits -= craft.price;
  offline.owned.push(index);
  persist();
  return true;
}

export async function favorShip(index) {
  if (updating || index !== null && !currentProgress().owned.includes(index)) return false;
  if (profile) return mutateCloud('favorite',{ship:index});
  offline.favorite = index;
  persist();
  return true;
}

export async function tuneShip(index,kind) {
  const active = currentProgress();
  if (updating || !active.owned.includes(index)) return false;
  const expectedTier = active.tuning[index]?.[kind] ?? 0;
  const price = tunePrice(kind,expectedTier);
  if (price === null || active.credits + active.pending < price) return false;
  if (profile) return mutateCloud('tune',{ship:index,tuningKind:kind,expectedTier});
  offline.credits -= price;
  offline.tuning[index] = {...offline.tuning[index],[kind]:expectedTier+1};
  persist();
  return true;
}

export async function resetCampaign() {
  if (profile) return mutateCloud('reset');
  if (offlineArchive && !offline.cleared && !offline.best && !offline.credits &&
      offline.owned.length === 1 && offline.favorite === null && Object.keys(offline.tuning).length === 0) return true;
  offlineArchive = clean(offline);
  offline = clean({epoch:offline.epoch+1,duels:offline.duels,duelPaid:offline.duelPaid});
  awardOfflineDuels();
  persist(true);
  return true;
}

export async function restoreCampaign() {
  if (profile) return mutateCloud('restore');
  if (!offlineArchive) return false;
  const previous = clean(offline);
  offline = clean({...offlineArchive,epoch:offline.epoch+1,duels:offline.duels,duelPaid:offline.duelPaid});
  offlineArchive = previous;
  awardOfflineDuels();
  persist(true);
  return true;
}

export function initProfile(onChange) {
  changed = onChange;
  const dialog = element();
  get('profile').addEventListener('click',()=>{
    refreshDialog();
    dialog.showModal();
  });
  get('newPilot').addEventListener('click',()=>formMode('create'));
  get('returnPilot').addEventListener('click',()=>formMode('load'));
  get('profileForm').addEventListener('submit',async event=>{
    event.preventDefault();
    if (busy) return;
    const value = get('pilotCode').value.trim().toLowerCase();
    const creating = setupMode === 'create';
    if (creating ? !/^[a-z0-9]{3,16}$/.test(value) : !codePattern.test(value)) {
      note(creating ? 'Введи 3–16 латинских букв или цифр.' : 'Введи полный код с дефисами.');
      return;
    }
    if (creating && (pendingAlias !== value || !pendingCode)) {
      pendingAlias = value;
      pendingCode = codeFrom(value);
    }
    const code = creating ? pendingCode : value;
    busy = true;
    for (const id of ['profileSubmit','newPilot','returnPilot','localPlay']) get(id).disabled = true;
    note('Подключаемся к облаку…');
    try {
      const remote = await api(setupMode,code,offline);
      const cacheKey = await pendingKey(code);
      const cache = read(cacheKey,null);
      const cached = clean(cache?.progress ?? cache);
      const sameEpoch = cached.epoch === remote.epoch;
      const local = sameEpoch ? mergeMetrics(remote,cached) : {...clean(remote),duels:Math.max(remote.duels,cached.duels)};
      profile = {code,progress:local,flights:sameEpoch ? pendingFlights(cache?.flights) : [],
        dirty:hasBetterMetrics(local,remote)};
      if (cache?.transition && transitionPattern.test(cache.transition.id) &&
          ['reset','restore'].includes(cache.transition.action) && Number.isInteger(cache.transition.epoch)) {
        profile.transition = cache.transition;
      }
      pendingCode = '';
      persist(true);
      write(cacheKey,null);
      if (hasPending(profile)) synchronize();
      refreshDialog();
      if (creating) showCode();
      else {
        note('Прогресс загружен.');
        dialog.close();
      }
    } catch (error) {
      note(error.message || 'Не удалось подключиться к облаку.');
    } finally {
      busy = false;
      for (const id of ['profileSubmit','newPilot','returnPilot','localPlay']) get(id).disabled = false;
    }
  });
  get('copyCode').addEventListener('click',async()=>{
    try {
      if (window.stormcoreNative?.copy) await window.stormcoreNative.copy(profile.code);
      else if (window.StormcoreAndroid?.copyCode) window.StormcoreAndroid.copyCode(profile.code);
      else await navigator.clipboard.writeText(profile.code);
      note('Код скопирован.');
    } catch {note('Выдели код и скопируй его вручную.');}
  });
  get('keepCode').addEventListener('click',()=>dialog.close());
  get('showProfileCode').addEventListener('click',showCode);
  get('syncProfile').addEventListener('click',()=>synchronize());
  get('forgetProfile').addEventListener('click',async()=>{
    if (!profile) return;
    const active = profile;
    if (hasPending(active)) {
      const cacheKey = await pendingKey(active.code);
      const saved = read(cacheKey,null);
      const cached = clean(saved?.progress ?? saved);
      const sameEpoch = cached.epoch === clean(active.progress).epoch;
      write(cacheKey,{
        progress:sameEpoch ? mergeMetrics(active.progress,cached) : clean(active.progress),
        flights:pendingFlights([...(sameEpoch ? pendingFlights(saved?.flights) : []),...active.flights]),
        transition:active.transition
      });
    }
    if (profile !== active) return;
    profile = null;
    write(profileKey,null);
    persist();
    refreshDialog();
    formMode('load');
  });
  get('localPlay').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('close',()=>write('stormcore-seen-pilot',true));
  window.addEventListener('online',()=>synchronize());
  document.addEventListener('visibilitychange',()=>{if (!document.hidden && profile) synchronize();});
  if (profile) synchronize();
  else if (!read('stormcore-seen-pilot',false)) {
    refreshDialog();
    dialog.showModal();
  }
}
