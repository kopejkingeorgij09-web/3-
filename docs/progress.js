import {progressEndpoint} from './cloud-config.js';
import {readStorage,writeStorage} from './storage.js';
import {levels,ships,legacyFleet} from './campaign.js';

const get = id => document.getElementById(id);
const offlineKey = 'stormcore-campaign';
const profileKey = 'stormcore-pilot';
const codePattern = /^[a-z0-9]{3,16}(?:-[a-hj-km-np-z2-9]{5}){4}$/;
const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';

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
  return {cleared,best:int(value?.best,1000000000),credits:int(value?.credits,1000000000),owned:[...new Set(owned)]};
}

function mergeMetrics(source,local) {
  const progress = clean(source);
  return {...progress,cleared:Math.max(progress.cleared,local.cleared),best:Math.max(progress.best,local.best)};
}

function pendingFlights(value) {
  if (!Array.isArray(value)) return [];
  return [...new Map(value.filter(flight=>flight && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(flight.id) &&
    Number.isInteger(flight.amount) && flight.amount > 0 && flight.amount <= 100000).map(flight=>[flight.id,flight])).values()];
}

let offline = clean(read(offlineKey,{}));
offline.best = Math.max(offline.best,int(read('stormcore-best',0),1000000000));
let profile = read(profileKey,null);
if (!profile || !codePattern.test(profile.code)) profile = null;
else profile.flights = pendingFlights(profile.flights);
let changed = () => {};
let setupMode = 'create';
let busy = false;
let request;
let requestProfile;
let purchasing = false;
let pendingCode = '';
let pendingAlias = '';
const element = () => get('profileDialog');

export function currentProgress() {
  const progress = clean(profile ? profile.progress : offline);
  return {...progress,pending:profile?.flights.reduce((sum,flight)=>sum+flight.amount,0) ?? 0};
}

function persist(activate = false) {
  if (profile) write(profileKey,profile);
  else write(offlineKey,offline);
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

async function api(action,code,progress,flights = [],purchase = null) {
  const unavailable = 'Облако временно недоступно. Прогресс на этом устройстве сохранён.';
  if (!progressEndpoint) throw new Error(unavailable);
  const payload = {
    campaign:2,action,code,cleared:progress.cleared,best:progress.best,flights,purchase,
    credits:action === 'create' ? progress.credits : 0,
    owned:action === 'create' ? progress.owned : [0]
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
  note(profile && (profile.dirty || profile.flights.length) ? 'Ожидается синхронизация с облаком.' : '');
}

function showCode() {
  get('profileActions').hidden = true;
  get('profileCopy').hidden = true;
  get('codeCard').hidden = false;
  get('profileCode').textContent = profile.code;
}

async function exchangeProfile(active,action,purchase) {
  const snapshot = clean(active.progress);
  const batch = active.flights.slice(0,40);
  const remote = await api(action,active.code,snapshot,batch,purchase);
  if (profile !== active) return remote;
  const accepted = new Set(batch.map(flight=>flight.id));
  active.flights = active.flights.filter(flight=>!accepted.has(flight.id));
  active.progress = mergeMetrics(remote,clean(active.progress));
  active.dirty = active.progress.cleared > remote.cleared || active.progress.best > remote.best;
  persist();
  return remote;
}

function synchronize() {
  if (!profile) return Promise.resolve(true);
  if (request) return requestProfile === profile ? request : request.then(()=>synchronize());
  const active = profile;
  requestProfile = active;
  request = (async ()=>{
    do {
      await exchangeProfile(active,active.dirty || active.flights.length ? 'save' : 'load');
    } while (profile === active && (active.dirty || active.flights.length));
    if (profile === active) note('Прогресс в облаке обновлён.');
    return profile === active;
  })().catch(error=>{
    if (profile === active) note(error.message || 'Не удалось подключиться к облаку.');
    return false;
  }).finally(()=>{request = null;requestProfile = null;});
  return request;
}

function flightId() {
  const hex = [...crypto.getRandomValues(new Uint8Array(16))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
  return [hex.slice(0,8),hex.slice(8,12),'4'+hex.slice(13,16),'a'+hex.slice(17,20),hex.slice(20)].join('-');
}

export function recordFlight(level,won,score,amount) {
  const result = clean({cleared:won ? level+1 : 0,best:score,owned:[0]});
  const award = int(amount,100000);
  if (profile) {
    const before = clean(profile.progress);
    profile.progress = mergeMetrics(before,result);
    profile.dirty ||= result.cleared > before.cleared || result.best > before.best;
    if (award) profile.flights.push({id:flightId(),amount:award});
  } else {
    offline = mergeMetrics(offline,result);
    offline.credits = int(offline.credits+award,1000000000);
  }
  persist();
  if (profile?.dirty || profile?.flights.length) synchronize();
}

export async function purchaseShip(index) {
  const craft = ships[index];
  if (!craft || purchasing) return false;
  if (currentProgress().owned.includes(index)) return true;
  if (!profile) {
    if (offline.credits < craft.price) return false;
    offline.credits -= craft.price;
    offline.owned.push(index);
    persist();
    return true;
  }
  const active = profile;
  purchasing = true;
  try {
    if (request) await request;
    if (profile !== active) return false;
    // The server applies this device's pending awards before debiting the purchase.
    if (active.flights.length > 40 && !await synchronize()) return false;
    if (profile !== active) return false;
    const exchange = exchangeProfile(active,'buy',index);
    requestProfile = active;
    request = exchange.then(()=>true,()=>false).finally(()=>{
      request=null;
      requestProfile=null;
      if (profile===active && (active.dirty || active.flights.length)) synchronize();
    });
    const remote = await exchange;
    return profile === active && remote.bought;
  } finally {
    purchasing = false;
  }
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
      const local = mergeMetrics(remote,clean(cache?.progress ?? cache));
      profile = {code,progress:local,flights:pendingFlights(cache?.flights),dirty:local.cleared>remote.cleared || local.best>remote.best};
      pendingCode = '';
      persist(true);
      write(cacheKey,null);
      if (profile.dirty || profile.flights.length) synchronize();
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
    if (active.dirty || active.flights.length) {
      const cacheKey = await pendingKey(active.code);
      const saved = read(cacheKey,null);
      write(cacheKey,{
        progress:mergeMetrics(active.progress,clean(saved?.progress ?? saved)),
        flights:pendingFlights([...pendingFlights(saved?.flights),...active.flights])
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
