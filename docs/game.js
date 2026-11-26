import {makeScene,random} from './scene.js';
import {levels,ships,briefings,rarities,rangeX,rangeY,captureTest,captureZ} from './campaign.js';
import {cockpitHUD} from './cockpit.js';
import {currentProgress,recordFlight,initProfile,purchaseShip} from './progress.js';
import {readStorage,writeStorage} from './storage.js';

const get = id => document.getElementById(id);
const game = get('game');
const lobby = get('lobby');
const host = get('world');
const helpDialog = get('helpDialog');
const pauseDialog = get('pauseDialog');
const resultDialog = get('resultDialog');
const coarse = matchMedia('(any-pointer:coarse)');
const reducedMotion = matchMedia('(prefers-reduced-motion:reduce)');
const count = n => Math.floor(n).toLocaleString('ru-RU');
const cap = (n,min,max) => Math.min(max,Math.max(min,n));
const waveLength = [21,24,24];
const sectors = [
  {message:'Забирай бирюзовые осколки',objective:'Собирай осколки · избегай красных мин'},
  {message:'Сбивай красные мины, пока они далеко',objective:'Разбивай мины и маневрируй между скалами'},
  {message:'Страж уже засёк твой корабль',objective:'Пробейся к Стражу ядра'}
];
const color = {raider:0xffaa68,mine:0xff578c,rock:0xd89cff,crystal:0x6cffff,heal:0xa9ff99,bolt:0xff6b9b};
const sizes = {raider:2.18,mine:1.21, rock:1.28, crystal:1.43, heal:1.35, bolt:.68};
const points = {crystal:155,mine:125,rock:75,heal:100,raider:430};
const awards = {crystal:85,mine:38,rock:20,heal:24,bolt:14,raider:175};
const soundButtons = [...document.querySelectorAll('[data-sound]')];
const keys = new Set();
const movement = new Set(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowLeft','ArrowDown','ArrowRight','Space','ShiftLeft','ShiftRight']);
let selectedLevel = Math.min(levels.length-1,currentProgress().cleared);
let selectedShip = 0;
let inspectedShip = 0;
let firstPerson = false;
let purchasing = false;
const cockpit = get('cockpit');
const instruments = cockpitHUD(cockpit);
try {firstPerson = readStorage('stormcore-camera') === 'cockpit';} catch {}
let muted = false;
try {
  muted = readStorage('stormcore-muted') === 'true';
} catch {}
let scene;
let run;
let mode = 'lobby';
let audio;
let raf = 0;
let last = 0;
let pointer = null;
let touchBoost = false;
let entities = [];
let shots = [];
let eventTimer = 0;
const joystick = get('joystick');
let pickupText = null;

function updateSound() {
  for (const button of soundButtons) {
    button.textContent = muted ? '◖×' : '◖))';
    button.setAttribute('aria-pressed',String(muted));
    button.setAttribute('aria-label',muted ? 'Включить звук' : 'Выключить звук');
  }
  if (audio) audio.gain.gain.setTargetAtTime(muted ? 0 : .38,audio.context.currentTime,.08);
}

function openAudio() {
  if (!audio) {
    try {
      const Audio = window.AudioContext || window.webkitAudioContext;
      const context = new Audio();
      const gain = context.createGain();
      const compressor = context.createDynamicsCompressor();
      gain.connect(compressor).connect(context.destination);
      gain.gain.value = muted ? 0 : .38;
      audio = {context,gain};
    } catch {return;}
  }
  if (audio.context.state === 'suspended') audio.context.resume().catch(()=>{});
}

function tone(freq,end,duration,volume = .12,type = 'sine',delay = 0) {
  if (!audio || muted || audio.context.state !== 'running') return;
  const {context,gain} = audio;
  const now = context.currentTime+delay;
  const osc = context.createOscillator();
  const envelope = context.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq,now);
  osc.frequency.exponentialRampToValueAtTime(end,now+duration);
  envelope.gain.setValueAtTime(.001,now);
  envelope.gain.exponentialRampToValueAtTime(volume,now+.009);
  envelope.gain.exponentialRampToValueAtTime(.001,now+duration);
  osc.connect(envelope).connect(gain);
  osc.start(now);
  osc.stop(now+duration+.01);
}

const cue = {
  shot:()=>tone(515,205,.09,.026,'triangle'),
  crystal:()=>{tone(710,1010,.16,.17,'sine');tone(1065,1530,.19,.10,'sine',.042);},
  heal:()=>{tone(440,600,.28,.12,'sine');tone(660,825,.26,.12,'sine',.12);},
  hit:()=>{tone(108,39,.35,.35,'sawtooth');tone(134,46,.15,.20,'triangle');},
  break:()=>{tone(124,64,.23,.17,'triangle');tone(290,112,.10,.051,'sawtooth');},
  dodge:()=>tone(330,620,.12,.06,'triangle'),
  boost:()=>{tone(60,190,.52,.26,'triangle');tone(122,245,.37,.095,'sawtooth');},
  sector:()=>{tone(166,181,.54,.20,'triangle');tone(222,248,.54,.14,'sine',.10);tone(331,362,.7,.15,'sine',.24);},
  boss:()=>{tone(83,61,.85,.3,'sawtooth');tone(110,69,.58,.16,'triangle',.27);},
  win:()=>[262,330,392,523].forEach((n,i)=>tone(n,n,1.05,.15,'triangle',.105*i))
};

function music(dt) {
  run.beatClock -= dt;
  if (run.beatClock > 0) return;
  const step = run.beat++ % 16;
  run.beatClock += run.bossActive ? .195 : [.28,.25,.22][run.sector];
  if (step % 4 === 0) tone(80,38,.20,run.bossActive ? .48 : .35,'sine');
  if (step % 2 === 0) {
    const bass = [55,55,65.4,55,48.98,55,73.42,65.4][step/2];
    tone(bass,bass*.98,.22,.13,'triangle',.04);
  }
  if (step % 4 === 2 || run.boosting) {
    const melody = [220,261.63,329.63,391.99,440,391.99,329.63,293.66][(step+run.sector*2)%8];
    tone(melody,melody*1.006,.21,.055,'triangle');
  }
}

function showEvent(over,title,sub = '',seconds = 2.4) {
  get('eventOver').textContent = over;
  get('eventText').textContent = title;
  get('eventSub').textContent = sub;
  get('event').classList.add('show');
  eventTimer = run.time+seconds;
}

function enterSector(index) {
  run.sector = index;
  run.sectorTime = 0;
  run.spawnTime = index === 0 ? .5 : 1;
  run.wave = 0;
  run.raid = 0;
  get('stageTitle').textContent = '0' + (index+1) + ' / 03';
  get('stageName').textContent = levels[run.level].route[index].toUpperCase();
  get('objective').textContent = sectors[index].objective;
  scene.setSector(index,levels[run.level].tint[index]);
  showEvent('СЕКТОР 0' + (index+1),levels[run.level].route[index],index === 0 ? briefings[run.level] : sectors[index].message,index === 0 ? 4.0 : 2.9);
  cue.sector();
}

function drawHangar() {
  const {best,cleared,credits,owned,pending} = currentProgress();
  selectedLevel = Math.min(selectedLevel,cleared,levels.length-1);
  if (!owned.includes(selectedShip)) selectedShip = 0;
  const mission = levels[selectedLevel];
  const chapter = ['СЛЕД МАЯКА','ИЗНАНКА РАЗЛОМА','КУРС НА «АВРОРУ»','ОПЕРАЦИЯ ВОЗВРАТ'][Math.floor(selectedLevel/6)];
  get('missionChapter').textContent = chapter+' · '+(selectedLevel+1)+' / '+levels.length;
  get('missionTitle').textContent = mission.name;
  get('missionCopy').textContent = briefings[selectedLevel];
  get('missionBearing').textContent = Math.round((selectedLevel+1)/levels.length*100)+'%';
  get('missionProgress').value = selectedLevel+1;
  get('creditBalance').textContent = count(credits);
  const craft = ships[inspectedShip];
  const shop = get('buyShip');
  const installed = owned.includes(inspectedShip);
  get('shopTitle').textContent = '«'+craft.name+'» · '+rarities[craft.rarity];
  get('shopCopy').textContent = craft.weapon+'. '+craft.detail;
  shop.hidden = installed;
  shop.disabled = purchasing || credits + pending < craft.price;
  shop.textContent = 'Купить за '+count(craft.price)+' ◇';
  get('shopStatus').textContent = installed
    ? (selectedShip === inspectedShip ? 'Готов к вылету' : 'В ангаре')
    : pending ? '+'+count(pending)+' очков ожидают синхронизации'
    : credits < craft.price ? 'До покупки '+count(craft.price-credits)+' очков' : '';
  refreshCameraButtons();
  get('record').textContent = best > 0 ? count(best) : '—';
  get('campaignProgress').textContent = 'Пройдено '+cleared+' / '+levels.length;
  get('hangarStatus').textContent = 'Вылет '+(selectedLevel+1)+' · «'+ships[selectedShip].name+'». '+ships[selectedShip].detail;
  const launch = 'Вылет '+String(selectedLevel+1).padStart(2,'0');
  get('start').lastChild.textContent = ' '+launch;
  get('launchSelected').textContent = launch;
  const createChoice = (list,index,title,status,enabled,active,select) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'choice';
    item.disabled = !enabled;
    item.setAttribute('aria-pressed',String(active));
    const label = document.createElement('small');
    label.textContent = status;
    const name = document.createElement('strong');
    name.textContent = title;
    item.append(label,name);
    item.addEventListener('click',()=>{select(index);drawHangar();get(list).children[index].focus();});
    get(list).append(item);
    return item;
  };
  get('levels').replaceChildren();
  levels.forEach((level,index)=>{
    const state = index < cleared ? 'ПРОЙДЕН' : index > cleared ? 'ЗАКРЫТ' : 'ОТКРЫТ';
    createChoice('levels',index,level.name,String(index+1).padStart(2,'0')+' / '+state,index<=cleared,index===selectedLevel,value=>{selectedLevel=value;});
  });
  get('ships').replaceChildren();
  ships.forEach((ship,index)=>{
    const unlocked = owned.includes(index);
    const status = unlocked ? (index===selectedShip ? 'ВЫБРАН' : 'В АНГАРЕ') : count(ship.price)+' ◇';
    const choice = createChoice('ships',index,ship.name,status,true,index===inspectedShip,value=>{
      inspectedShip = value;
      if (owned.includes(value)) selectedShip = value;
    });
    choice.dataset.rarity = String(ship.rarity);
    const rarity = document.createElement('span');
    rarity.className = 'ship-rarity';
    rarity.textContent = rarities[ship.rarity];
    choice.style.setProperty('--ship-accent','#'+ship.color.toString(16).padStart(6,'0'));
    const weapon = document.createElement('span');
    weapon.className = 'weapon';
    weapon.textContent = ship.weapon;
    const rating = document.createElement('span');
    rating.className = 'flight-rating';
    rating.textContent = 'Манёвр';
    const points = document.createElement('span');
    points.title = Math.round(ship.speed*100)+'% от скорости манёвра Стрижа';
    points.textContent = '+'+Math.round((ship.speed-1)*100)+'%';
    rating.append(points);
    choice.append(rarity,weapon,rating);
  });
}

function refreshCameraButtons() {
  for (const id of ['cameraHangar','cameraPause']) {
    const button = get(id);
    button.setAttribute('aria-pressed',String(firstPerson));
    button.textContent = firstPerson ? 'Камера · кабина' : 'Камера · снаружи';
  }
}

function toggleCamera() {
  firstPerson = !firstPerson;
  try {writeStorage('stormcore-camera',firstPerson ? 'cockpit' : 'chase');} catch {}
  refreshCameraButtons();
  if (run && mode === 'paused') {
    run.firstPerson = firstPerson;
    drawFlight(0);
  }
}

async function buyInspectedShip() {
  if (purchasing) return;
  const id = inspectedShip;
  purchasing = true;
  drawHangar();
  get('shopStatus').textContent = 'Покупка…';
  let bought = false;
  let message;
  try {
    bought = await purchaseShip(id);
    if (bought) {
      selectedShip = id;
      inspectedShip = id;
      cue.sector();
    } else message = 'Не хватило очков. Проверь баланс.';
  } catch (error) {
    message = error.message || 'Связь с ангаром потеряна. Повтори покупку.';
  } finally {
    purchasing = false;
    drawHangar();
    if (message) get('shopStatus').textContent = message;
  }
}

function removeEntities() {
  for (const item of [...entities,...shots]) item.mesh.visible = false;
  entities = [];
  shots = [];
  if (scene) {
    scene.boss.visible = false;
    scene.clearParticles();
    scene.capture(null,[]);
  }
}

function start() {
  if (purchasing) return;
  helpDialog.close();
  pauseDialog.close();
  resultDialog.close();
  openAudio();
  try {
    scene ??= makeScene(host);
  } catch (error) {
    console.error(error);
    get('resultKicker').textContent = 'ТРЕБУЕТСЯ WEBGL 2';
    get('resultTitle').textContent = '3D-сцена недоступна';
    get('resultCopy').textContent = 'Проверь, включено ли аппаратное ускорение в браузере, или открой игру в другом браузере.';
    resultDialog.querySelector('.summary').hidden = true;
    get('restart').textContent = 'Повторить';
    get('nextLevel').hidden = true;
    resultDialog.showModal();
    return;
  }
  resultDialog.querySelector('.summary').hidden = false;
  get('restart').textContent = 'Ещё вылет';
  removeEntities();
  clearInput();
  pickupText = null;
  get('pickupFeedback').textContent = '';
  if (!currentProgress().owned.includes(selectedShip)) selectedShip = 0;
  const difficulty = selectedLevel;
  const craft = ships[selectedShip];
  run = {
    level:selectedLevel,difficulty,craft,firstPerson,credits:0,salvos:0,heat:0,overheated:false,previousX:0,previousY:0,
    x:0,y:0,dx:0,dy:0,hp:100,charge:62,score:0,crystals:0,chain:0,comboTime:0,
    time:0,speed:30,invuln:0,shake:0,flash:0,boosting:false,boostLock:false,
    sector:0,sectorTime:0,wave:0,raid:0,spawnTime:0,fireTime:0,beat:0,beatClock:0,
    bossActive:false,bossHp:64+difficulty*12,bossMax:64+difficulty*12,bossTime:0,bossShotTime:0,victory:0,
    mobile:coarse.matches,reducedMotion:reducedMotion.matches
  };
  scene.setShip(craft,selectedShip);
  instruments.configure(craft,selectedShip);
  get('flightLevel').textContent = 'УРОВЕНЬ '+String(selectedLevel+1).padStart(2,'0');
  get('nextLevel').hidden = true;
  get('bossbar').hidden = true;
  get('aim').hidden = false;
  game.hidden = false;
  lobby.hidden = true;
  scene.resize();
  mode = 'playing';
  enterSector(0);
  updateHUD();
  play();
}

function clearInput() {
  keys.clear();
  releaseJoystick();
  touchBoost = false;
}

function play() {
  cancelAnimationFrame(raf);
  last = performance.now();
  raf = requestAnimationFrame(frame);
}

function togglePause() {
  if (mode === 'playing') {
    mode = 'paused';
    clearInput();
    cancelAnimationFrame(raf);
    pauseDialog.showModal();
  } else if (mode === 'paused') {
    pauseDialog.close();
    mode = 'playing';
    openAudio();
    play();
  }
}

function hangar() {
  if (mode === 'paused' && run.credits > 0) {
    recordFlight(run.level,Boolean(run.victory),run.score,run.credits);
  }
  cancelAnimationFrame(raf);
  clearInput();
  removeEntities();
  mode = 'lobby';
  pauseDialog.close();
  resultDialog.close();
  game.hidden = true;
  lobby.hidden = false;
  drawHangar();
  get('start').focus();
}

function end(won) {
  mode = 'result';
  clearInput();
  const score = Math.floor(run.score);
  const previous = currentProgress();
  recordFlight(run.level,won,score,run.credits);
  const record = score > previous.best;
  const final = won && run.level === levels.length-1;
  get('resultKicker').textContent = final ? 'КАМПАНИЯ ЗАВЕРШЕНА' : record ? 'НОВЫЙ РЕКОРД' : 'ПОЛЁТ ЗАВЕРШЁН';
  get('resultTitle').textContent = won ? (final ? 'Аврора спасена' : 'Шторм повержен') : 'Корабль потерян';
  get('resultCopy').textContent = won
    ? (final ? 'Тросы выдержали. Ты вывел «Аврору» из разлома, и экипаж наконец увидел рассвет.' : briefings[run.level+1])
    : '«'+run.craft.name+'» потерял связь в секторе «'+levels[run.level].route[run.sector]+'». Очки за вылет зачислены.';
  get('resultScore').textContent = count(score);
  get('resultCredits').textContent = '+'+count(run.credits);
  get('resultBest').textContent = count(currentProgress().best);
  get('nextLevel').hidden = !won || final;
  get('nextLevel').textContent = 'На уровень '+(run.level+2);
  resultDialog.showModal();
}

function entity(type,x,y,z = -116,scale = 1) {
  const object = scene.object(type);
  object.position.set(x,y,z);
  object.rotation.set(0,0,0);
  object.scale.setScalar(scale);
  const item = {type,x,y,z,previousX:x,previousY:y,previousZ:z,scale,mesh:object,radius:sizes[type]*scale,spin:random(-1.8,1.8),passed:false,hp:type === 'rock' ? 2 : 1,vx:0,vy:0};
  entities.push(item);
  return item;
}

function deleteEntity(i) {
  entities[i].mesh.visible = false;
  entities.splice(i,1);
}

function crystals(x,y,count = 3,step = .45) {
  for (let j = 0; j < count; j++) {
    entity('crystal',cap(x+j*step,-rangeX,rangeX),y+Math.sin(j*.64)*.32,-110-j*6,.88);
  }
}

const fieldScale = 1.65;
const fieldEntity = (type,x,y,z,scale)=>entity(type,x*fieldScale,y,z,scale);
const fieldCrystals = (x,y,number,step)=>crystals(x*fieldScale,y,number,step);

function spawnWave() {
  const wave = run.wave++;
  const tier = run.sector;
  if (run.difficulty > 0) spawnInterference(wave);

  if (wave === 0 && tier === 0) {
    fieldCrystals(0,0,5,.20);
    fieldEntity('rock',-6.2,-1.6,-119,1.5);
    fieldEntity('mine',6.1,1.7,-132,.93);
    return;
  }
  const lane = ([-5.6,0,5.6])[Math.floor(random(0,3))];
  const side = lane === 0 ? (Math.random() < .5 ? -1 : 1) : Math.sign(lane);
  const y = random(-3.3,3.1);
  switch (wave % 6) {
    case 0:
      fieldCrystals(lane,random(-1.7,1.7),4,side*-.42);
      fieldEntity('mine',-side*4.1,y,-123);
      fieldEntity('rock',side*7.4,-y*.6,-132,1.45);
      break;
    case 1:
      fieldEntity('mine',lane,y,-109);
      fieldEntity('rock',lane*.62+side*1.8,-y*.45,-120,1.22+tier*.12);
      fieldCrystals(-side*4.8,y*.65,3,side*.61);
      break;
    case 2: {
      const opening = Math.random() < .5 ? -1 : 1;
      for (const x of [-7.5,-4,0,4,7.5]) {
        const gap = (x*opening > 3);
        fieldEntity(gap ? 'crystal' : 'mine',x,gap ? 0 : Math.sin(x)*1.1,-117-Math.abs(x),gap ? .87 : .95+tier*.10);
      }
      break;
    }
    case 3:
      fieldEntity('rock',random(-2,2),y*.39,-115,1.78);
      fieldCrystals(side*5.5,-2.7,3,side*-.38);
      fieldEntity('mine',-side*5.2,2.7,-126,1.06);
      break;
    case 4:
      fieldEntity('heal',lane*.76,cap(y,-2.2,2.2),-117,.91);
      fieldEntity('mine',-side*4.5,-y,-109);
      fieldEntity('mine',side*6.9,-y*.55,-134);
      break;
    default:
      for (let i = 0; i < 3+tier; i++) {
        const x = side*(1 + i*2.21 - tier*1.2);
        fieldEntity(i%2 === 0 ? 'rock' : 'mine',x,Math.sin(i*.85)*3.65-1.4,-115-i*5,.9+tier*.10);
      }
      fieldCrystals(-side*5.4,y*.73,3,side*.59);
  }
}

function spawnInterference(wave) {
  const stage = run.difficulty;
  if (wave%Math.max(2,6-Math.floor(stage/2)) === 1) {
    const side = Math.random()<.5 ? -1 : 1;
    const mine = fieldEntity('mine',side*random(4.6,7.8),random(-2.8,2.8),-136,1+stage*.024);
    mine.vx = -side*(1.2+stage*.19);
    if (stage >= 5) {
      const second = fieldEntity('mine',-side*7.5,random(-3,3),-146,.95+stage*.018);
      second.vx = side*(1.6+stage*.16);
    }
  }
  if (stage >= 3 && wave%Math.max(3,8-Math.floor(stage/2)) === 2) {
    const x = random(-5.8,5.8);
    fieldEntity('rock',x,random(-3.5,3.5),-143,1.45+stage*.04);
  }
}

function merit(amount,credit = 0) {
  run.credits += credit;
  const multiplier = 1 + Math.min(4,Math.floor(run.chain/3));
  run.score += amount * multiplier * (run.boosting ? 2 : 1);
  run.chain++;
  run.comboTime = run.time+4.7;
}

function damage(amount,item) {
  if (run.invuln > 0 || run.boosting || run.victory > 0) return;
  run.hp = Math.max(0,run.hp-(amount+Math.floor(run.difficulty*.52))*(run.craft.armor || 1));
  run.invuln = 1.08;
  run.shake = .68;
  run.flash = .85;
  run.chain = 0;
  scene.burst(run.x,run.y,0,color[item.type],36,1.3);
  cue.hit();
}

function scheduleRaid() {
  if (run.level < 4 || run.bossActive || (run.sector === 2 && run.level < 7)) return;
  const slots = run.level >= 12 ? [5.4,14.1] : [8.1];
  if (run.raid >= slots.length || run.sectorTime < slots[run.raid]) return;
  const side = (run.raid+run.sector)%2 === 0 ? -1 : 1;
  const x = cap(run.x + side*4.0,-rangeX*.8,rangeX*.8);
  const unit = entity('raider',x,cap(run.y,-3.0,3.0),-93,1.14);
  Object.assign(unit,{age:0,hp:12+run.difficulty*.71,home:x,side,nextShot:.95,nextMine:2.0});
  run.raid++;
  showEvent('ВРАЖЕСКИЙ КОНТАКТ','Перехватчик','Огонь по кораблю. Мины останутся на маршруте.',1.9);
  tone(340,180,.42,.12,'triangle');
}

function tickRaider(item,i,dt) {
  item.age += dt*(item.chilledUntil > run.time ? .52 : 1);
  const t = item.age;
  if (t > 7.8) {
    deleteEntity(i);
    return;
  }
  item.x = cap(item.home+Math.sin(t*1.55)*3.7*item.side,-rangeX*.88,rangeX*.88);
  item.y = cap(item.y+(Math.sin(t*.89+item.side)*2.4-item.y)*dt*2,-rangeY,rangeY);
  item.z = -48-45*Math.exp(-t*1.35)-Math.max(0,t-6.0)**2*12;
  item.mesh.position.set(item.x,item.y,item.z);
  item.mesh.rotation.set(.08*Math.sin(t),.24*Math.cos(t*1.7),.16*Math.sin(t*1.55)*item.side);
  if (t >= item.nextShot && t < 6.35 && !(item.jammedUntil > run.time)) {
    const hand = run.difficulty >= 9 ? 1 : 0;
    const travel = -item.z/(run.speed*1.53);
    for (let n=-hand;n<=hand;n++) {
      const bolt = entity('bolt',item.x+n*.63,item.y,item.z+2,.84);
      bolt.vx = (run.x+n*2.5-bolt.x)/travel;
      bolt.vy = (run.y-bolt.y)/travel;
    }
    item.nextShot = t+Math.max(.69,1.44-run.difficulty*.025);
    tone(210,88,.19,.13,'sawtooth');
  }
  if (t >= item.nextMine && t < 6.2) {
    const mine = entity('mine',item.x,item.y,item.z-2,1.04);
    mine.vx = cap((run.x-item.x)*.51,-6,6);
    mine.vy = cap((run.y-item.y)*.29,-2,2);
    item.nextMine += run.level >= 12 ? 1.72 : 2.56;
  }
}

function updateEntities(dt) {
  for (let i = entities.length-1; i >= 0; i--) {
    const item = entities[i];
    const oldZ = item.previousZ = item.z;
    item.previousX = item.x;
    item.previousY = item.y;
    const {type,mesh} = item;
    if (type === 'raider') {
      tickRaider(item,i,dt);
      continue;
    }
    const driftTime = item.chilledUntil > run.time ? dt*.52 : dt;
    item.x += item.vx * driftTime;
    item.y += item.vy * driftTime;
    item.z += run.speed * driftTime * (type === 'bolt' ? 1.53 : 1);
    mesh.position.set(item.x,item.y,item.z);
    if (type !== 'bolt') {
      mesh.rotation.y += item.spin*dt;
      mesh.rotation.z += item.spin*.55*dt;
    }
    const radius = item.radius;
    const distance = Math.hypot(run.x - item.x,(run.y-item.y)*1.14);
    const collision = type === 'crystal' ? captureTest(run,item) : oldZ < 1.45 && item.z > -1.45 && distance < radius + .49;
    if (collision) {
      if (type === 'crystal' || type === 'heal') {
        if (type === 'crystal') {
          run.crystals++;
          pickupText = {x:run.x,y:run.y,z:captureZ,until:run.time+.85};
          run.charge = Math.min(100,run.charge+13);
          cue.crystal();
        } else {
          run.hp = Math.min(100,run.hp+28);
          cue.heal();
        }
        merit(points[type],awards[type]);
        scene.burst(item.x,item.y,type === 'crystal' ? captureZ : item.z,color[type],20);
      } else if (run.boosting) {
        merit(points[type] || 65,awards[type]);
        scene.burst(item.x,item.y,item.z,color[type],32,1.4);
        cue.break();
      } else {
        damage(type === 'rock' ? 31 : type === 'mine' ? 25 : 17,item);
      }
      deleteEntity(i);
      continue;
    }
    if (!item.passed && item.z > 1.55) {
      item.passed = true;
      if (type !== 'crystal' && type !== 'heal' && distance < radius + 1.45) {
        merit(65,9);
        run.charge = Math.min(100,run.charge+6);
        scene.burst(item.x,item.y,item.z,0xffee9f,10);
        cue.dodge();
      }
    }
    if (item.z > 22) deleteEntity(i);
  }
}

function takeShot() {
  const craft = run.craft;
  const overload = craft.prism && ++run.salvos%4 === 0;
  if (craft.heat) {
    run.heat = Math.min(1,run.heat+craft.heat);
    if (run.heat >= 1) {
      run.overheated = true;
      tone(420,110,.37,.08,'triangle');
    }
  }
  for (const offset of craft.pattern) {
    const shot = scene.object('shot');
    const x = run.x + offset;
    const y = run.y + .1;
    const velocity = craft.velocity || 110;
    const vx = offset*(craft.spread || 0);
    const vy = 0;
    shot.position.set(x,y,-2.1);
    shot.rotation.set(vy*.009,-vx*.009,0);
    const width = overload ? 3.1 : craft.rocket ? 2.1 : craft.heat ? .71 : 1;
    shot.scale.set(width,width,overload ? 4.0 : craft.pierce ? 2.6 : run.boosting ? 1.43 : 1);
    shots.push({x,y,z:-2.1,vx,vy,velocity,mesh:shot,pierced:new Set(),damage:craft.damage*(run.boosting ? 2 : 1)*(overload ? 1.8 : 1)});
  }
  if (overload) tone(1010,430,.24,.16,'triangle');
  else if (craft.pierce) tone(1035,210,.17,.10,'triangle');
  else if (craft.rocket) tone(205,95,.15,.073,'triangle');
  else cue.shot();
}

function removeShot(i) {
  shots[i].mesh.visible = false;
  shots.splice(i,1);
}

const damageable = item => item.type === 'rock' || item.type === 'mine' || item.type === 'raider';

function rocketBurst(shot,z,except) {
  const radius = run.craft.splash;
  if (!radius) return;
  scene.burst(shot.x,shot.y,z,run.craft.color,21,radius*.31+.52);
  for (const item of entities) {
    if (item === except || item.hp <= 0 || !damageable(item)) continue;
    const distance = Math.hypot(item.x-shot.x,item.y-shot.y,(item.z-z)*.83);
    if (distance < radius) item.hp -= shot.damage*(1-distance/radius)*.85;
  }
}

function clearDestroyed() {
  for (let j=entities.length-1;j>=0;j--) {
    const item = entities[j];
    if (item.hp > 0) continue;
    merit(points[item.type],awards[item.type]);
    run.charge = Math.min(100,run.charge+3);
    scene.burst(item.x,item.y,item.z,color[item.type],item.type === 'raider' ? 46 : 22,1.28);
    cue.break();
    if (item.type === 'raider') entity('crystal',item.x,item.y,item.z-3,1.03);
    deleteEntity(j);
  }
}

function updateShots(dt) {
  for (let i = shots.length-1; i >= 0; i--) {
    const shot = shots[i];
    const oldZ = shot.z;
    shot.x += shot.vx*dt;
    shot.y += shot.vy*dt;
    shot.z -= dt*shot.velocity;
    shot.mesh.position.set(shot.x,shot.y,shot.z);
    let hit = false;
    for (let j = entities.length-1; j >= 0; j--) {
      const item = entities[j];
      if (!damageable(item) || item.hp <= 0 || shot.pierced.has(item)) continue;
      if (item.z+1.0 < shot.z || item.z-1.2-run.speed*dt > oldZ) continue;
      if (Math.hypot(shot.x-item.x,shot.y-item.y) > item.radius) continue;
      item.hp -= item.type === 'raider' ? shot.damage : Math.max(1,shot.damage/2);
      if (run.craft.pierce) shot.pierced.add(item);
      if (run.craft.ion && item.type === 'raider') item.jammedUntil = run.time+.78;
      if (run.craft.cryo) item.chilledUntil = run.time+1.45;
      rocketBurst(shot,item.z,item);
      scene.burst(shot.x,shot.y,item.z,run.craft.color,8);
      if (!run.craft.pierce) {
        hit = true;
        break;
      }
    }
    if (!hit && run.bossActive && !run.victory) {
      const boss = scene.boss.position;
      if (oldZ >= boss.z && shot.z <= boss.z && Math.hypot(shot.x-boss.x,shot.y-boss.y) < 2.45) {
        rocketBurst(shot,boss.z,null);
        if (run.bossShielded) {
          scene.burst(shot.x,shot.y,boss.z+2.2,0x8fcbff,5);
        } else {
          run.bossHp = Math.max(0,run.bossHp-shot.damage);
          run.bossFlash = .17;
          scene.burst(shot.x,shot.y,boss.z+2.2,0xffbcfa,13);
          if (Math.floor(run.bossHp)%8 === 0) cue.break();
        }
        hit = true;
      }
    }
    if (hit || shot.z < -150) removeShot(i);
  }
  clearDestroyed();
}

function summonBoss() {
  for (let i=entities.length-1;i>=0;i--) if (entities[i].type === 'raider') deleteEntity(i);
  run.bossActive = true;
  run.bossFlash = 0;
  run.bossShielded = false;
  run.bossTime = 0;
  run.bossShotTime = 2.8;
  scene.boss.visible = true;
  scene.boss.position.set(0,0,-116);
  get('bossbar').hidden = false;
  get('bossbar').classList.remove('shielded');
  get('bossName').textContent = 'СТРАЖ ЯДРА';
  get('objective').textContent = 'Страж ядра · целься в светящийся центр';
  showEvent('БОЙ СО СТРАЖЕМ','Страж ядра','Целься в светящийся центр с упреждением',2.9);
  cue.boss();
}

function bossLogic(dt) {
  if (run.victory) {
    run.victory += dt;
    if (run.victory > 2.65) end(true);
    return;
  }
  run.bossTime += dt;
  run.bossFlash = Math.max(0,run.bossFlash-dt);
  const t = run.bossTime;
  scene.boss.position.set(Math.sin(t*(.79+run.difficulty*.035))*(4.4+run.difficulty*.165),Math.cos(t*(1.05+run.difficulty*.03))*2.9,-53-63*Math.exp(-t*1.1));
  const shieldWindow = Math.min(2.35,0.8+run.difficulty*.09);
  const shielded = run.difficulty >= 2 && (t+.35)%4.4 < shieldWindow;
  if (shielded !== run.bossShielded) {
    run.bossShielded = shielded;
    get('bossbar').classList.toggle('shielded',shielded);
    get('bossName').textContent = shielded ? 'ЩИТ СТРАЖА' : 'СТРАЖ ЯДРА';
    get('objective').textContent = shielded ? 'Щит активен · готовься к следующему залпу' : 'Щит снят · целься в центр';
    if (shielded) tone(278,520,.27,.09,'sine');
  }
  scene.setBossShield(shielded);
  scene.reactor.material.color.setHex(shielded ? 0x71aeff : run.bossFlash > 0 ? 0xffffff : 0xf0b7ff);
  if (run.bossHp <= 0) {
    const {x,y,z} = scene.boss.position;
    scene.burst(x,y,z,0xffaffc,155,2.8);
    scene.burst(x,y,z,0xa1ffff,110,2.3);
    scene.boss.visible = false;
    run.victory = .001;
    run.score += 3000 + run.hp*20;
    run.credits += 170+(run.level+1)*22;
    run.shake = 1.22;
    run.invuln = 4;
    get('bossbar').hidden = true;
    get('aim').hidden = true;
    get('objective').textContent = 'Разлом закрывается · выход открыт';
    showEvent('КАНАЛ РАСЧИЩЕН',run.level === levels.length-1 ? 'Аврора спасена' : 'Прорыв!',
      run.level === levels.length-1 ? 'Ковчег вышел из разлома' : 'Получена следующая координата',3.1);
    cue.win();
    return;
  }
  if (t < run.bossShotTime) return;
  const phase = run.bossHp < run.bossMax*.48 ? 2 : 1;
  run.bossShotTime = t + Math.max(.85,(phase === 2 ? 1.48 : 2.10)-run.difficulty*.045);
  const {x,y,z} = scene.boss.position;
  const flightTime = -z/(run.speed*1.53);
  for (let i = -phase; i <= phase; i++) {
    const bolt = entity('bolt',x+i*.62,y,z+2,i === 0 ? 1.19 : .83);
    bolt.vx = (run.x + i*2.75 - bolt.x)/flightTime;
    bolt.vy = (run.y + Math.abs(i)*.86 - bolt.y)/flightTime;
  }
  if (run.difficulty >= 4) {
    const lane = run.x > 0 ? -10.5 : 10.5;
    const bolt = entity('bolt',x,y,z-1,.84+run.difficulty*.03);
    bolt.vx = (lane-x)/flightTime;
    bolt.vy = (-run.y*.62-y)/flightTime;
  }
  if (Math.floor(t/2)%2 === 0) crystals(cap(-run.x,-9.5,9.5),random(-3,3),3,.20);
  if (t > 5 && Math.floor(t/2)%5 === 0 && run.hp < 75) entity('heal',-Math.sign(run.x || 1)*5,0,-64,.9);
  tone(235,80,.32,.25,'sawtooth');
}

function updateMovement(dt) {
  const left = keys.has('KeyA') || keys.has('ArrowLeft');
  const right = keys.has('KeyD') || keys.has('ArrowRight');
  const up = keys.has('KeyW') || keys.has('ArrowUp');
  const down = keys.has('KeyS') || keys.has('ArrowDown');
  run.previousX = run.x;
  run.previousY = run.y;
  const horizontal = pointer?.x ?? Number(right)-Number(left);
  const vertical = pointer?.y ?? Number(up)-Number(down);
  const extent = Math.max(1,Math.hypot(horizontal,vertical));
  const targetX = horizontal/extent*15*run.craft.speed;
  const targetY = vertical/extent*12.6*run.craft.speed;
  const follow = 1-Math.exp(-dt*13*run.craft.response);
  run.dx += (targetX-run.dx)*follow;
  run.dy += (targetY-run.dy)*follow;
  run.x = cap(run.x+run.dx*dt,-rangeX,rangeX);
  run.y = cap(run.y+run.dy*dt,-rangeY,rangeY);
}

function updateBoost(dt) {
  const held = keys.has('ShiftLeft') || keys.has('ShiftRight') || touchBoost;
  if (!held) run.boostLock = false;
  if (run.charge <= 0) run.boostLock = true;
  const active = held && !run.boostLock && (run.charge >= 8 || run.boosting);
  if (active && !run.boosting) {
    run.shake = .29;
    cue.boost();
  }
  run.boosting = active;
  run.charge = active ? Math.max(0,run.charge-dt*24) : Math.min(100,run.charge+dt*3.1);
  const speed = [30,38,45][run.sector] + Math.min(11,run.difficulty)*2.25 + Math.max(0,run.difficulty-11)*1.11 + (active || run.victory > 0 ? 30 : 0);
  run.speed += (speed-run.speed)*(1-Math.exp(-dt*4.6));
}

function updateHUD() {
  const {hp,charge,score,chain,sector,sectorTime,bossHp,bossMax,bossActive,victory,speed,crystals:loot,flash} = run;
  get('hp').style.transform = 'scaleX(' + hp/100 + ')';
  get('boost').style.transform = 'scaleX(' + charge/100 + ')';
  const progress = bossActive ? .78+.22*(1-bossHp/bossMax) : cap(sectorTime/waveLength[sector],0,1)*(sector === 2 ? .78 : 1);
  get('progress').style.transform = 'scaleX(' + progress + ')';
  get('hpValue').textContent = Math.round(hp) + '%';
  get('boostValue').textContent = Math.floor(charge) + '%';
  get('score').textContent = String(Math.floor(score)).padStart(6,'0');
  get('chain').textContent = 'КОМБО ×' + (1+Math.min(4,Math.floor(chain/3)));
  get('speed').textContent = Math.round(speed*41);
  get('crystals').textContent = String(loot).padStart(2,'0');
  get('runCredits').textContent = count(run.credits);
  const gun = get('weaponStatus');
  gun.hidden = !run.craft.heat && !run.craft.prism;
  if (run.craft.heat) gun.textContent = run.overheated ? 'ОХЛАЖДЕНИЕ' : 'НАГРЕВ '+Math.round(run.heat*100)+'%';
  else if (run.craft.prism) gun.textContent = 'ПРИЗМА '+(run.salvos%4)+'/4';
  get('damage').style.opacity = String(flash);
  if (bossActive && !victory) {
    get('bossHp').style.transform = 'scaleX(' + bossHp/bossMax + ')';
    get('bossValue').textContent = Math.ceil(bossHp/bossMax*100) + '%';
  }
  if (run.time > eventTimer) get('event').classList.remove('show');
}

function drawFlight(dt) {
  cockpit.hidden = !run.firstPerson;
  scene.capture(run,entities.filter(item=>item.type === 'crystal' && item.z <= captureZ && item.z > captureZ-32).sort((a,b)=>b.z-a.z).slice(0,6));
  scene.draw(dt,run);
  if (run.firstPerson) instruments.draw(run,entities,scene.boss);
}

function frame(now) {
  if (mode !== 'playing') return;
  const dt = cap((now-last)/1000,0,.055);
  last = now;
  run.time += dt;
  run.sectorTime += dt;
  run.invuln = Math.max(0,run.invuln-dt);
  run.shake = Math.max(0,run.shake-dt*1.7);
  run.flash = Math.max(0,run.flash-dt*2.9);
  if (run.time > run.comboTime) run.chain = 0;
  updateMovement(dt);
  updateBoost(dt);
  music(dt);
  if (!run.bossActive) {
    if (run.sectorTime >= waveLength[run.sector]) {
      if (run.sector < 2) {
        run.hp = Math.min(100,run.hp+Math.max(8,14-run.difficulty*.52));
        run.charge = Math.min(100,run.charge+18);
        run.score += 500;
        enterSector(run.sector+1);
      } else summonBoss();
    } else if (run.sectorTime >= run.spawnTime) {
      spawnWave();
      run.spawnTime += Math.max(.70,[1.65,1.40,1.20][run.sector]-run.difficulty*.048) + random(-.10,.12);
    }
  }
  scheduleRaid();
  run.fireTime -= dt;
  run.heat = Math.max(0,run.heat-dt*(run.overheated ? .62 : .66));
  if (run.overheated && run.heat <= .18) run.overheated = false;
  if (run.fireTime <= 0 && !run.overheated && !run.victory && (keys.has('Space') || run.mobile)) {
    run.fireTime = run.craft.cooldown*(run.boosting ? .595 : 1);
    takeShot();
  }
  updateEntities(dt);
  updateShots(dt);
  if (run.bossActive) bossLogic(dt);
  run.score += dt*(run.boosting ? 39 : 18);
  drawFlight(dt);
  if (pickupText) {
    const feedback = get('pickupFeedback');
    const left = pickupText.until-run.time;
    if (left > 0) {
      const [px,py] = scene.screenPoint(pickupText.x,pickupText.y,pickupText.z);
      feedback.textContent = '+ '+awards.crystal+' ◇';
      feedback.style.left = px+'px';
      feedback.style.top = (py-24-(.85-left)*21)+'px';
      feedback.style.opacity = String(Math.min(1,left*3.3));
    } else {
      feedback.textContent = '';
      pickupText = null;
    }
  }
  const [x,y] = scene.screenPoint(run.x,run.y+.1,-35);
  get('aim').style.left = x+'px';
  get('aim').style.top = y+'px';
  updateHUD();
  if (run.hp <= 0 && mode === 'playing') end(false);
  if (mode === 'playing') raf = requestAnimationFrame(frame);
}

function moveJoystick(event) {
  const box = joystick.getBoundingClientRect();
  const x = event.clientX-box.left-box.width/2;
  const y = event.clientY-box.top-box.height/2;
  const radius = box.width*.31;
  const length = Math.hypot(x,y);
  const strength = cap((length/radius-.095)/.905,0,1);
  pointer.x = length ? x/length*strength : 0;
  pointer.y = length ? -y/length*strength : 0;
  joystick.style.setProperty('--joy-x',pointer.x*radius+'px');
  joystick.style.setProperty('--joy-y',-pointer.y*radius+'px');
}

function releaseJoystick() {
  pointer = null;
  joystick.classList.remove('active');
  joystick.style.setProperty('--joy-x','0px');
  joystick.style.setProperty('--joy-y','0px');
}

joystick.addEventListener('pointerdown',event=>{
  if (mode !== 'playing' || pointer) return;
  event.preventDefault();
  pointer = {id:event.pointerId,x:0,y:0};
  run.mobile = true;
  joystick.classList.add('active');
  joystick.setPointerCapture(event.pointerId);
  moveJoystick(event);
});
joystick.addEventListener('pointermove',event=>{
  if (pointer?.id === event.pointerId) moveJoystick(event);
});
for (const type of ['pointerup','pointercancel','lostpointercapture']) {
  joystick.addEventListener(type,event=>{if (pointer?.id === event.pointerId) releaseJoystick();});
}
get('touchBoost').addEventListener('pointerdown',event=>{
  touchBoost = true;
  event.currentTarget.setPointerCapture(event.pointerId);
});
for (const type of ['pointerup','pointercancel','lostpointercapture']) {
  get('touchBoost').addEventListener(type,()=>{touchBoost = false;});
}
document.addEventListener('keydown',event=>{
  if (mode === 'playing' && movement.has(event.code)) {
    if (event.code === 'Space' && document.activeElement?.tagName === 'BUTTON') document.activeElement.blur();
    event.preventDefault();
    keys.add(event.code);
  }
  if (event.repeat) return;
  if (event.code === 'Escape' && (mode === 'playing' || mode === 'paused')) {
    event.preventDefault();
    togglePause();
  }
  if (event.code === 'Enter' && mode === 'lobby' && !helpDialog.open && !resultDialog.open && !get('profileDialog').open && document.activeElement?.tagName !== 'BUTTON') {
    event.preventDefault();
    start();
  }
});
document.addEventListener('keyup',event=>keys.delete(event.code));
window.addEventListener('blur',()=>{
  if (mode === 'playing') togglePause();
});
document.addEventListener('visibilitychange',()=>{
  if (document.hidden && mode === 'playing') togglePause();
});
window.addEventListener('resize',()=>{if (scene && !game.hidden) scene.resize();});
get('help').addEventListener('click',()=>helpDialog.showModal());
get('start').addEventListener('click',start);
get('launchSelected').addEventListener('click',start);
get('cameraHangar').addEventListener('click',toggleCamera);
get('cameraPause').addEventListener('click',toggleCamera);
get('buyShip').addEventListener('click',buyInspectedShip);
get('restart').addEventListener('click',start);
get('nextLevel').addEventListener('click',()=>{
  selectedLevel = Math.min(run.level+1,levels.length-1,currentProgress().cleared);
  start();
});
get('pause').addEventListener('click',togglePause);
get('resume').addEventListener('click',togglePause);
pauseDialog.addEventListener('cancel',event=>{event.preventDefault();togglePause();});
resultDialog.addEventListener('cancel',event=>{event.preventDefault();hangar();});
for (const button of document.querySelectorAll('[data-hangar]')) button.addEventListener('click',hangar);
for (const button of soundButtons) {
  button.addEventListener('click',()=>{
    muted = !muted;
    try {writeStorage('stormcore-muted',String(muted));} catch {}
    if (!muted) openAudio();
    updateSound();
  });
}
updateSound();
drawHangar();
initProfile(activate=>{
  if (activate && mode === 'lobby') selectedLevel = Math.min(currentProgress().cleared,levels.length-1);
  drawHangar();
});
