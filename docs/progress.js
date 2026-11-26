import {progressEndpoint} from './cloud-config.js';
import {readStorage,writeStorage} from './storage.js';

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
const clean = value => ({
  cleared:Math.min(12,Math.max(0,Math.floor(Number(value?.cleared) || 0))),
  best:Math.min(1000000000,Math.max(0,Math.floor(Number(value?.best) || 0)))
});
const combine = (a,b) => clean({cleared:Math.max(a.cleared,b.cleared),best:Math.max(a.best,b.best)});
let offline = combine(clean(read(offlineKey,{})),clean({best:read('stormcore-best',0)}));
let profile = read(profileKey,null);
if (!profile || !codePattern.test(profile.code)) profile = null;
let changed = () => {};
let setupMode = 'create';
let busy = false;
let request;
let uploadQueued = false;
let pendingCode = '';
let pendingAlias = '';
const element = () => get('profileDialog');

export function currentProgress() {
  return clean(profile ? profile.progress : offline);
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

async function api(action,code,progress) {
  const unavailable = 'Облако временно недоступно. Прогресс на этом устройстве сохранён.';
  if (!progressEndpoint) throw new Error(unavailable);
  const payload = {action,code,cleared:progress?.cleared,best:progress?.best};
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
  return clean(data);
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
  note(profile?.dirty ? 'Ожидается синхронизация с облаком.' : '');
}

function showCode() {
  get('profileActions').hidden = true;
  get('profileCopy').hidden = true;
  get('codeCard').hidden = false;
  get('profileCode').textContent = profile.code;
}

async function synchronize() {
  if (!profile) return;
  if (request) {
    uploadQueued = true;
    return request;
  }
  const active = profile;
  const snapshot = currentProgress();
  request = api(active.dirty ? 'save' : 'load',active.code,snapshot).then(remote=>{
    if (profile !== active) return;
    active.progress = combine(currentProgress(),remote);
    active.dirty = active.progress.cleared > remote.cleared || active.progress.best > remote.best;
    persist();
    note(active.dirty ? 'Ожидается синхронизация с облаком.' : 'Прогресс в облаке обновлён.');
    uploadQueued ||= active.dirty;
  }).catch(error=>{
    if (profile === active) note(error.message || 'Не удалось подключиться к облаку.');
  }).finally(()=>{
    request = null;
    if (uploadQueued && profile) {
      uploadQueued = false;
      if (profile !== active || profile.dirty) synchronize();
    }
  });
  return request;
}

export function recordFlight(level,won,score) {
  const result = clean({cleared:won ? level+1 : 0,best:score});
  if (profile) {
    const merged = combine(currentProgress(),result);
    profile.dirty ||= merged.cleared > currentProgress().cleared || merged.best > currentProgress().best;
    profile.progress = merged;
  } else offline = combine(offline,result);
  persist();
  if (profile?.dirty) synchronize();
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
      const local = combine(remote,clean(read(cacheKey,null)));
      profile = {code,progress:local,dirty:local.cleared>remote.cleared || local.best>remote.best};
      pendingCode = '';
      persist(true);
      write(cacheKey,null);
      if (profile.dirty) synchronize();
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
    if (active.dirty) {
      const cacheKey = await pendingKey(active.code);
      write(cacheKey,combine(clean(active.progress),clean(read(cacheKey,null))));
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
