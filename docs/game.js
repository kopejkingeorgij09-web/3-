import {makeScene,random} from './scene.js';
import {levels,ships,briefings,rarities,rangeX,rangeY,captureTest,captureZ} from './campaign.js';
import {cockpitHUD} from './cockpit.js';
import {raiders,raidPlan,enemyHud} from './encounters.js';
import {missionRoutes} from './mission-routes.js';
import {currentProgress,recordFlight,recordDuel,initProfile,purchaseShip,flightSaveToken} from './progress.js';
import {garageUI,tunedCraft} from './garage.js';
import {readStorage,writeStorage} from './storage.js';
import {precisionKey,defaultSensitivity,normalizeSensitivity,steeringRates,steer,sweptDistance} from './flight-control.js';
import {ultimates,ultimateKey,traceHit,scatterRays} from './weapon-ultimates.js';
import {showroom} from './showroom.js';
import {duelStages,duelWaves,duelCredit,aceWeapons,aceUltimates,campaignAce} from './duels.js';

const get = id => document.getElementById(id);
const game = get('game');
const primaryAim = get('aim');
const partnerAim = get('wingAim');
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
const ultimateAimDuration = 3;
const sectors = [
  {message:'Забирай бирюзовые осколки',objective:'Собирай осколки · избегай красных мин'},
  {message:'Сбивай красные мины, пока они далеко',objective:'Разбивай мины и маневрируй между скалами'},
  {message:'Страж уже засёк твой корабль',objective:'Пробейся к Стражу ядра'}
];
const color = {pulse:0xff79d4,cache:0xffc77d,relay:0x74d9ff,raider:0xffaa68,mine:0xff578c,rock:0xd89cff,crystal:0x6cffff,heal:0xa9ff99,bolt:0xff6b9b,blast:0xffa467};
const sizes = {pulse:2.08,cache:1.42,relay:2.08,raider:2.18,mine:1.21, rock:1.28, crystal:1.43, heal:1.35, bolt:.68};
const points = {cache:305,crystal:155,mine:125,rock:75,heal:100,raider:430};
const awards = {cache:24,crystal:85,mine:38,rock:20,heal:24,bolt:14,raider:175};
const routeOptions = {
  standard:{name:'Основной маршрут',detail:'Сектора по плану операции.'},
  anomaly:{name:'Через аномалию',detail:'Чаще встречаются волны разряда. Дополнительные осколки и 240 очков за победу.',color:0x32ecda,reward:240},
  blockade:{name:'Через блокаду',detail:'В каждом секторе выходит дополнительный патруль. За победу +380 очков.',color:0xff6d49,reward:380}
};
const flightModes = {
  training:{name:'Полигон',tint:0x52eac6,orbit:4,objective:'Мишени и перехватчики · Q для супервыстрела'},
  tandem:{name:'Тандем',tint:0x9390ed,orbit:14,objective:'Держи строй · два корабля против звена асов'},
  duel:{name:'Дуэль в затмении',objective:'Держи силуэт на курсе · радар засечёт противника после залпа'}
};
let routeChoice = 'standard';
const soundButtons = [...document.querySelectorAll('[data-sound]')];
const keys = new Set();
const movement = new Set(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowLeft','ArrowDown','ArrowRight','Space','ShiftLeft','ShiftRight',precisionKey]);
const controlSliders = [...document.querySelectorAll('[data-steering-sensitivity]')];
let sensitivity = defaultSensitivity;
try {sensitivity = normalizeSensitivity(readStorage('stormcore-steering'));} catch {}
let selectedLevel = Math.min(levels.length-1,currentProgress().cleared);
let selectedDuel = Math.min(duelStages.length-1,currentProgress().duels);
let selectedShip = currentProgress().favorite ?? 0;
let inspectedShip = selectedShip;
let preview, failedPreview=false;
let activeTab='modes';
let firstPerson = false;
let purchasing = false;
const cockpit = get('cockpit');
const instruments = cockpitHUD(cockpit);
const enemyTracks = enemyHud(get('enemyTracks'));
function adoptCampaign() {
  const progress = currentProgress();
  selectedLevel = Math.min(progress.cleared,levels.length-1);
  selectedDuel = Math.min(progress.duels,duelStages.length-1);
  selectedShip = progress.favorite ?? 0;
  inspectedShip = selectedShip;
}
const garage = garageUI({shipIndex:()=>inspectedShip,refresh:()=>drawHangar(),onNewCampaign:adoptCampaign});
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
  run.detour = null;
  run.raid = 0;
  run.raidSlots = raidPlan(run.level,index);
  run.sectorAce = campaignAce(run.level,index);
  run.aceDeployed = false;
  if (run.route === 'blockade') {
    run.raidSlots = [...run.raidSlots,{time:13.45,types:['gunner','scout']}].sort((a,b)=>a.time-b.time);
  }
  if (index === 0) run.contract = {plan:missionRoutes[run.level],phase:'waiting',hits:0};
  run.relayDeployed = run.contract.plan.sector === index;
  get('stageTitle').textContent = '0' + (index+1) + ' / 03';
  get('stageName').textContent = levels[run.level].route[index].toUpperCase();
  get('objective').textContent = sectors[index].objective;
  scene.setSector(index,routeOptions[run.route]?.color ?? levels[run.level].tint[index]);
  showEvent('СЕКТОР 0' + (index+1),levels[run.level].route[index],index === 0 ? briefings[run.level] : sectors[index].message,index === 0 ? 4.0 : 2.9);
  cue.sector();
}

function drawDuelLadder(progress) {
  selectedDuel = Math.min(selectedDuel,progress.duels,duelStages.length-1);
  const {name,region,tint,index,weapon,ultimate} = duelStages[selectedDuel];
  const special = aceUltimates[ultimate];
  get('arcade').style.setProperty('--duel-accent','#'+tint.toString(16).padStart(6,'0'));
  get('duelProgress').textContent = 'Побед '+progress.duels+' / '+duelStages.length;
  get('duelRegion').textContent = region+' · '+(index+1)+' / '+duelStages.length;
  get('duelName').textContent = name;
  get('duelWeapon').textContent = aceWeapons[weapon].name;
  get('duelUltimate').textContent = special.name;
  get('duelHint').textContent = index<5 ? special.hint : 'Волн '+duelWaves(duelStages[index]).length+(index>=10 ? ' · флагман в финале' : '');
  const reward=ships.find(ship=>ship.duelReward===index+1);
  get('duelReward').textContent = index<progress.duels ? 'Награда получена' : 'Первая победа · '+duelCredit(index)+' ◇'+(reward ? ' и «'+reward.name+'»' : '');
  get('duelShip').textContent = 'Твой корабль · «'+ships[selectedShip].name+'»';
  get('duel').textContent = 'Дуэль '+String(index+1).padStart(2,'0');
  const list = get('duelLevels');
  list.replaceChildren();
  for (const stage of duelStages) {
    const button = document.createElement('button');
    const label = String(stage.index+1).padStart(2,'0');
    const cleared = stage.index < progress.duels;
    button.type = 'button';
    button.textContent = label;
    button.disabled = stage.index > progress.duels;
    button.dataset.cleared = String(cleared);
    button.setAttribute('aria-pressed',String(stage.index===selectedDuel));
    button.setAttribute('aria-label',label+' · '+stage.name+(cleared ? ' · пройдено' : button.disabled ? ' · закрыто' : ''));
    button.addEventListener('click',()=>{
      selectedDuel = stage.index;
      drawDuelLadder(currentProgress());
      list.children[selectedDuel].focus();
    });
    list.append(button);
  }
}

function drawHangar() {
  const progress = currentProgress();
  const {best,cleared,credits,owned,pending,favorite,tuning} = progress;
  selectedLevel = Math.min(selectedLevel,cleared,levels.length-1);
  if (!owned.includes(selectedShip)) selectedShip = 0;
  drawDuelLadder(progress);
  const mission = levels[selectedLevel];
  const routeSelect = get('routeChoice');
  routeSelect.disabled = selectedLevel < 4;
  routeSelect.value = selectedLevel < 4 ? 'standard' : routeChoice;
  get('routeDetail').textContent = selectedLevel < 4 ? 'Доступны с пятого уровня.' : routeOptions[routeChoice].detail;
  const chapter = ['СЛЕД МАЯКА','ИЗНАНКА РАЗЛОМА','КУРС НА «АВРОРУ»','ОПЕРАЦИЯ ВОЗВРАТ'][Math.floor(selectedLevel/6)];
  get('missionChapter').textContent = chapter+' · '+(selectedLevel+1)+' / '+levels.length;
  get('missionTitle').textContent = mission.name;
  get('missionCopy').textContent = briefings[selectedLevel];
  const extra = missionRoutes[selectedLevel];
  get('missionExtra').hidden = false;
  get('missionExtra').textContent = extra.title+' · '+extra.objective+' · +'+count(extra.reward)+' ◇';
  get('missionBearing').textContent = Math.round((selectedLevel+1)/levels.length*100)+'%';
  get('missionProgress').value = selectedLevel+1;
  get('creditBalance').textContent = count(credits);
  drawShowroom(progress);
  drawTandem(progress);
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

}

function weaponKind(craft) {
  if (craft.rocket) return 'rocket';
  if (craft.ion) return 'ion';
  if (craft.cryo) return 'cryo';
  if (craft.sniper || craft.pierce && craft.pattern.length<=2) return 'rail';
  return craft.pattern.length>1 ? 'spread' : 'pulse';
}

function metrics(craft) {
  return {agility:steeringRates(craft).lateral/steeringRates(ships[0]).lateral,
    hull:craft.maxHp ?? 100,power:craft.damage*craft.pattern.length/craft.cooldown};
}

function fleetChoices(progress) {
  const weapon = get('weaponFilter').value;
  const ultimate = get('ultimateFilter').value;
  return ships.map((ship,index)=>{
    const {agility,hull,power} = metrics(tunedCraft(ship,progress.tuning?.[index]));
    return {index,value:agility*40+hull/(ship.armor ?? 1)*.30+power*1.65};
  }).filter(({index})=>(weapon==='all' || weaponKind(ships[index])===weapon) &&
    (ultimate==='all' || ultimates[index].kind===ultimate)).sort((a,b)=>a.value-b.value).map(({index})=>index);
}

function drawShowroom(progress) {
  const choices = fleetChoices(progress);
  const found = choices.includes(inspectedShip);
  if (!found && choices.length) inspectedShip = choices[0];
  const position = choices.indexOf(inspectedShip);
  get('fleetEmpty').hidden = Boolean(choices.length);
  get('shipDetails').hidden = get('shipPreview').hidden = !choices.length;
  get('shipPrev').disabled = position<=0;
  get('shipNext').disabled = position<0 || position>=choices.length-1;
  get('shipPosition').textContent = choices.length ? (position+1)+' / '+choices.length+' · мощнее вправо' : '0 / 0';
  garage.update(inspectedShip,progress);
  if (!choices.length) return;
  const craft = ships[inspectedShip];
  const installed = progress.owned.includes(inspectedShip);
  const stats = metrics(tunedCraft(craft,progress.tuning?.[inspectedShip]));
  const shop = get('buyShip');
  const ultimate = ultimates[inspectedShip];
  get('shopTitle').textContent = craft.name;
  get('shopCopy').textContent = craft.weapon+'. '+craft.detail;
  get('shopUltimate').textContent = ultimate.name+' · '+ultimate.label+'. '+ultimate.hint;
  get('shipAgility').textContent = Math.round(stats.agility*100)+'%';
  get('shipHealth').textContent = stats.hull+' HP · защита '+Math.round(100/(tunedCraft(craft,progress.tuning?.[inspectedShip]).armor))+'%';
  get('shipPower').textContent = stats.power.toFixed(1);
  shop.hidden = installed || Boolean(craft.duelReward);
  shop.disabled = purchasing || garage.busy || progress.credits+progress.pending<craft.price;
  shop.textContent = craft.price ? 'Купить за '+count(craft.price)+' ◇' : '';
  get('selectShip').hidden = !installed;
  get('selectShip').disabled = selectedShip===inspectedShip;
  get('selectShip').textContent = selectedShip===inspectedShip ? 'Выбран' : 'Выбрать';
  get('shopStatus').textContent = installed ? '' : craft.duelReward
    ? 'Награда за ступень '+craft.duelReward+' в «Затмении»' : 'Чертёж доступен за кредиты';
  if (activeTab==='fleet') {
    if (!preview && !failedPreview) {
      try {preview=showroom(get('shipPreview'));} catch {failedPreview=true;get('shipPreview').textContent='3D-просмотр недоступен';}
    }
    preview?.show(craft,inspectedShip);
  }
}

function shiftShip(direction) {
  const progress=currentProgress();
  const choices=fleetChoices(progress);
  const candidate=choices[choices.indexOf(inspectedShip)+direction];
  if (candidate==null) return;
  inspectedShip=candidate;
  drawShowroom(progress);
}

function drawTandem(progress) {
  const available=[...new Set([0,1,2,...progress.owned])];
  for (const [id,fallback] of [['tandemFirst',0],['tandemSecond',1]]) {
    const select=get(id);
    const prior=select.value==='' ? fallback : Number(select.value);
    select.replaceChildren();
    for (const index of available) {
      const option=document.createElement('option');
      option.value=index;
      option.textContent=ships[index].name+(progress.owned.includes(index) ? '' : ' · аренда');
      select.append(option);
    }
    select.value=available.includes(prior) ? prior : fallback;
  }
  validateTandem();
}

function validateTandem() {
  const same=get('tandemFirst').value===get('tandemSecond').value;
  get('launchTandem').disabled=same;
  get('tandemHint').textContent=same ? 'Выбери два разных корабля.' : 'Требуется клавиатура.';
}

function showTab() {
  const target=location.hash.slice(1);
  const tabs=['modes','operations','arcade','tandem','fleet'];
  activeTab=tabs.includes(target) ? target : 'modes';
  for (const tab of tabs) get(tab).hidden = tab!==activeTab;
  get('campaignLaunch').hidden = activeTab!=='operations';
  for (const link of document.querySelectorAll('.menu-nav a')) {
    if (link.hash==='#'+activeTab) link.setAttribute('aria-current','page');
    else link.removeAttribute('aria-current');
  }
  drawShowroom(currentProgress());
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
  if (purchasing || garage.busy) return;
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
  enemyTracks.clear();
  if (scene) {
    scene.boss.visible = false;
    scene.aceWarning(null);
    scene.clearParticles();
    scene.capture(null,[]);
  }
}

function start(activity = '') {
  const special = typeof activity === 'string' ? flightModes[activity] : null;
  const training = activity === 'training';
  const tandem = activity === 'tandem';
  const partnerId = tandem ? Number(get('tandemSecond').value) : null;
  const duel = activity === 'duel' ? duelStages[Math.min(selectedDuel,currentProgress().duels)] : null;
  if (purchasing || garage.busy) return;
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
  const shipIndex = tandem ? Number(get('tandemFirst').value) : training ? inspectedShip : selectedShip;
  if (tandem && (!ships[shipIndex] || !ships[partnerId] || shipIndex===partnerId)) return;
  const difficulty = duel?.difficulty ?? (special ? 4 : selectedLevel);
  const upgrades = currentProgress().tuning?.[shipIndex];
  const craft = tunedCraft(ships[shipIndex],upgrades);
  run = {
    level:selectedLevel,difficulty,craft,steering:steeringRates(craft),saveToken:flightSaveToken(),firstPerson:firstPerson&&!tandem,credits:0,relays:0,salvos:0,heat:0,overheated:false,previousX:0,previousY:0,
    ultimate:ultimates[shipIndex],weaponTuning:upgrades?.weapon ?? 0,ultimateCharge:training ? 100 : duel || tandem ? 38 : 0,
    ultimateAim:0,laserTicks:0,laserClock:0,blasts:[],
    activity:special ? activity : '',training,duel,route:!special && selectedLevel >= 4 ? routeChoice : 'standard',
    x:tandem ? -5 : 0,y:0,dx:0,dy:0,hp:craft.maxHp ?? 100,maxHp:craft.maxHp ?? 100,charge:62,score:0,crystals:0,chain:0,comboTime:0,
    holdX:0,holdY:0,controlX:0,controlY:0,precision:false,
    time:0,speed:30,invuln:0,shake:0,flash:0,boosting:false,boostLock:false,
    sector:0,sectorTime:0,wave:0,raid:0,spawnTime:0,fireTime:0,beat:0,beatClock:0,
    bossActive:false,bossHp:64+difficulty*12,bossMax:64+difficulty*12,bossTime:0,bossShotTime:0,victory:0,
    mobile:coarse.matches,reducedMotion:reducedMotion.matches
  };
  if (tandem) {
    const upgrade=currentProgress().tuning?.[partnerId];
    const second=tunedCraft(ships[partnerId],upgrade);
    run.partner={craft:second,steering:steeringRates(second),x:5,y:0,dx:0,dy:0,holdX:0,holdY:0,controlX:0,controlY:0,
      previousX:5,previousY:0,hp:second.maxHp ?? 100,maxHp:second.maxHp ?? 100,invuln:0,boosting:false,
      fireTime:0,heat:0,salvos:0,overheated:false,ultimate:ultimates[partnerId],weaponTuning:upgrade?.weapon ?? 0,
      ultimateCharge:38,ultimateAim:0,laserTicks:0,laserClock:0};
  }
  get('wingStatus').hidden = !run.partner;
  get('cameraPause').hidden = tandem;
  scene.setShip(craft,shipIndex,partnerId);
  instruments.configure(craft,shipIndex);
  get('flightLevel').textContent = duel ? 'ДУЭЛЬ '+String(duel.index+1).padStart(2,'0') :
    special ? special.name.toUpperCase() : 'УРОВЕНЬ '+String(selectedLevel+1).padStart(2,'0');
  get('nextLevel').hidden = true;
  get('bossbar').hidden = true;
  get('aceStatus').hidden = true;
  game.hidden = false;
  lobby.hidden = true;
  scene.resize();
  mode = 'playing';
  if (special) {
    run.spawnTime = 0;
    run.contract = {plan:missionRoutes[0],phase:'expired',hits:0};
    run.specialOrbit = duel?.orbit ?? special.orbit;
    get('stageTitle').textContent = duel ? String(duel.index+1).padStart(2,'0')+' / '+duelStages.length : 'АРКАДА';
    get('stageName').textContent = duel?.region ?? special.name;
    get('objective').textContent = special.objective;
    scene.setSector(0,duel?.tint ?? special.tint,run.specialOrbit);
    if (duel || tandem) {
      run.duelWaves = duelWaves(duel ?? duelStages[16]);
      run.duelWave = 0;
      launchDuelWave();
    }
  } else enterSector(0);
  updateHUD();
  play();
}

function clearInput() {
  keys.clear();
  releaseJoystick();
  touchBoost = false;
  if (run) {
    run.holdX = run.holdY = 0;
    if (run.partner) run.partner.holdX = run.partner.holdY = 0;
    run.precision = false;
  }
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
  if (mode === 'paused' && !run.activity && run.credits > 0) {
    recordFlight(run.level,Boolean(run.victory),run.score,run.credits,run.saveToken);
  }
  if (run?.duelWonAt) selectedDuel = Math.min(currentProgress().duels,duelStages.length-1);
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
  if (run.activity) {
    get('resultKicker').textContent = flightModes[run.activity].name.toUpperCase();
    const final = run.duel?.index === duelStages.length-1;
    if (run.duel) {
      get('resultTitle').textContent = won ? (final ? 'Победитель затмения' : 'Дуэль выиграна') : 'Дуэль проиграна';
      get('resultCopy').textContent = won
        ? 'Соперник «'+run.duel.name+'» повержен.'
        : '«'+run.duel.name+'» выиграл бой. '+aceUltimates[run.duel.ultimate].hint;
    }
    if (run.partner) {
      get('resultTitle').textContent=won ? 'Тандем победил' : 'Тандем разбит';
      get('resultCopy').textContent=won ? 'Флагман уничтожен.' : 'Оба корабля потеряны.';
    }
    resultDialog.querySelector('.summary').hidden = true;
    get('nextLevel').hidden = !won || !run.duel || final || currentProgress().duels <= run.duel.index;
    get('nextLevel').textContent = 'Следующая дуэль';
    resultDialog.showModal();
    return;
  }
  recordFlight(run.level,won,score,run.credits,run.saveToken);
  const record = score > previous.best;
  const final = won && run.level === levels.length-1;
  get('resultKicker').textContent = final ? 'КАМПАНИЯ ЗАВЕРШЕНА' : record ? 'НОВЫЙ РЕКОРД' : 'ПОЛЁТ ЗАВЕРШЁН';
  get('resultTitle').textContent = won ? (final ? 'Аврора спасена' : 'Шторм повержен') : 'Корабль потерян';
  get('resultCopy').textContent = won
    ? (final ? 'Тросы выдержали. Ты вывел «Аврору» из разлома, и экипаж наконец увидел рассвет.' : briefings[run.level+1])
    : '«'+run.craft.name+'» потерял связь в секторе «'+levels[run.level].route[run.sector]+'». Очки за вылет зачислены.';
  get('resultScore').textContent = count(score);
  get('resultCredits').textContent = '+'+count(run.credits);
  get('resultRelays').textContent = String(run.relays);
  get('resultBest').textContent = count(currentProgress().best);
  get('nextLevel').hidden = !won || final;
  get('nextLevel').textContent = 'На уровень '+(run.level+2);
  resultDialog.showModal();
}

function entity(type,x,y,z = -116,scale = 1,variant) {
  const object = scene.object(type,variant);
  object.position.set(x,y,z);
  object.rotation.set(0,0,0);
  object.scale.setScalar(scale);
  const item = {type,x,y,z,previousX:x,previousY:y,previousZ:z,scale,mesh:object,radius:sizes[type]*scale,spin:random(-1.8,1.8),passed:false,hp:type === 'rock' ? 2 : 1,vx:0,vy:0};
  entities.push(item);
  return item;
}

function deleteEntity(i) {
  if (run.ace === entities[i]) run.ace = null;
  entities[i].mesh.visible = false;
  entities.splice(i,1);
}

const approachDepth = 49;

function crystals(x,y,count = 3,step = .45,depth = -110) {
  for (let j = 0; j < count; j++) {
    entity('crystal',cap(x+j*step,-rangeX,rangeX),y+Math.sin(j*.64)*.32,depth-j*6,.88);
  }
}

const fieldScale = 1.65;
const fieldEntity = (type,x,y,z,scale)=>entity(type,x*fieldScale,y,z-approachDepth,scale);
const fieldCrystals = (x,y,number,step)=>crystals(x*fieldScale,y,number,step,-110-approachDepth);

function spawnWave() {
  const wave = run.wave++;
  const tier = run.sector;
  if (run.difficulty > 0) spawnInterference(wave);
  if (run.route === 'anomaly' && wave%5 === 2) {
    const side = (wave+tier)%2 ? 1 : -1;
    entity('pulse',side*5.8,1.4,-153,1.48);
    entity('pulse',0,-2.9,-160,1.22);
    crystals(-side*9,2.4,3,side*.45,-168);
  }

  if (wave === 0 && tier === 0) {
    crystals(0,0,5,.20);
    fieldEntity('rock',-6.2,-1.6,-119,1.5);
    fieldEntity('mine',6.1,1.7,-132,.93);
    return;
  }
  const route = run.contract.plan.positions;
  const waypoint = route.length ? route[(wave+tier)%route.length] : undefined;
  const lane = waypoint && wave%3 !== 1 ? waypoint[0]*.47 : ([-5.6,0,5.6])[Math.floor(random(0,3))];
  const side = lane === 0 ? (Math.random() < .5 ? -1 : 1) : Math.sign(lane);
  const y = waypoint ? cap(waypoint[1]*.64+random(-1.3,1.3),-3.3,3.1) : random(-3.3,3.1);
  switch ((wave+run.level+tier)%6) {
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
    mine.vx = -side*(1.2+stage*.19)*.74;
    if (stage >= 5) {
      const second = fieldEntity('mine',-side*7.5,random(-3,3),-146,.95+stage*.018);
      second.vx = side*(1.6+stage*.16)*.74;
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

function damage(amount,item,pilot=run) {
  if (run.training || pilot.hp<=0 || pilot.invuln>0 || pilot.boosting || run.victory || run.duelWonAt) return false;
  pilot.hp = Math.max(0,pilot.hp-(amount+Math.floor(run.difficulty*.52))*(pilot.craft.armor || 1));
  pilot.invuln = 1.04;
  run.shake = .64;
  run.flash = .81;
  run.chain = 0;
  scene.burst(pilot.x,pilot.y,0,color[item.type],36,1.3);
  cue.hit();
  return true;
}

function refreshContractObjective() {
  if (run.bossActive) return;
  const {plan,phase,hits} = run.contract;
  const detour = run.detour;
  if (detour && (detour.repair || detour.loot)) {
    const instructions = [];
    if (detour.repair) instructions.push('Ремонт '+detour.safeSide);
    if (detour.loot) instructions.push('разбей тайник '+detour.riskSide);
    get('objective').textContent = instructions.join(' · ');
    return;
  }
  if (phase === 'active') get('objective').textContent = plan.objective+' · '+hits+'/'+plan.goal;
  else get('objective').textContent = sectors[run.sector].objective;
}

function countContract(...kinds) {
  const job = run.contract;
  if (job.phase !== 'active' || !kinds.includes(job.plan.kind)) return;
  job.hits++;
  if (job.hits >= job.plan.goal) {
    job.phase = 'complete';
    merit(job.plan.reward*2,job.plan.reward);
    showEvent('ДОПОЛНИТЕЛЬНАЯ ЦЕЛЬ',job.plan.title,'Выполнено · +'+job.plan.reward+' очков',2.1);
    cue.heal();
  }
  refreshContractObjective();
}

function spawnContractObject(type,x,y,z,scale) {
  const item = entity(type,x,y,z,scale);
  item.routeTarget = true;
  return item;
}

function startContract() {
  const {plan,phase} = run.contract;
  if (phase !== 'waiting' || plan.sector !== run.sector || run.sectorTime < 4.8 || run.bossActive) return;
  run.contract.phase = 'active';
  const distance = Math.min(102,run.speed*1.37+22);
  const gate = plan.kind === 'gates' || plan.kind === 'boost' || plan.kind === 'decode';
  for (let i=0;i<plan.positions.length;i++) {
    const [x,y] = plan.positions[i];
    const z = -91-distance*i;
    if (gate) {
      spawnContractObject('relay',x,y,z,1.16);
      if (plan.kind === 'decode') {
        const side = x < 0 ? 1 : -1;
        spawnContractObject('pulse',x+side*5.4,y*.65,z,1.4);
      }
    } else if (plan.kind === 'salvage') {
      for (let n=0;n<3;n++) {
        spawnContractObject('crystal',cap(x+(n-1)*.48,-rangeX,rangeX),y+Math.sin(n*.8)*.24,z-n*6,.94);
      }
    } else if (plan.kind === 'cache') {
      spawnContractObject('cache',x,y,z,1.14);
    } else if (plan.kind === 'evasion') {
      const wave = {remaining:3,struck:false};
      const side = i%2 ? -1 : 1;
      for (let n=-1;n<=1;n++) {
        const pulse = spawnContractObject('pulse',cap(x+n*5.1,-13,13),
          cap(y+n*.86*side,-4.8,4.8),z,1.44);
        pulse.routeWave = wave;
      }
    }
  }
  refreshContractObjective();
  showEvent('ДОПОЛНИТЕЛЬНАЯ ЦЕЛЬ',plan.title,plan.objective+' · награда '+plan.reward,2.0);
  tone(518,740,.25,.095,'sine');
}

function closeContractSector() {
  const job = run.contract;
  if (job.plan.sector !== run.sector) return;
  if (job.phase !== 'complete') job.phase = 'expired';
  for (let i=entities.length-1;i>=0;i--) if (entities[i].routeTarget) deleteEntity(i);
}

function crossingDistance(item,oldZ) {
  if (oldZ > captureZ || item.z <= captureZ) return Infinity;
  const f = (captureZ-oldZ)/(item.z-oldZ);
  const dx = item.previousX+(item.x-item.previousX)*f-(run.previousX+(run.x-run.previousX)*f);
  const dy = item.previousY+(item.y-item.previousY)*f-(run.previousY+(run.y-run.previousY)*f);
  return Math.hypot(dx,dy*1.08);
}

function flyThroughRelay(item,oldZ) {
  if (crossingDistance(item,oldZ) > item.radius) return;
  run.relays++;
  merit(item.routeTarget ? 195 : 480,item.routeTarget ? 35 : 115);
  run.charge = Math.min(100,run.charge+(item.routeTarget ? 20 : 31));
  run.hp = Math.min(run.maxHp,run.hp+(item.routeTarget ? 5 : 14));
  scene.burst(item.x,item.y,captureZ,0x9feaff,38,1.21);
  if (!item.routeTarget) showEvent('СИГНАЛ ПРИНЯТ','Маяк пройден','+115 очков · корпус и форсаж пополнены',1.5);
  else if (run.contract.plan.kind === 'boost' && !run.boosting) {
    showEvent('РАЗГОННЫЙ СТВОР','Включи форсаж','Удерживай Shift или кнопку форсажа у следующего кольца',1.4);
  } else countContract('gates','boost','decode');
  cue.heal();
}

function tickPulse(item,index,oldZ) {
  const charged = item.z >= -25;
  if (charged !== item.charged) {
    item.charged = charged;
    item.mesh.userData?.setCharged?.(charged);
  }
  if (oldZ > captureZ || item.z <= captureZ) return;
  const struck = crossingDistance(item,oldZ) <= item.radius && !run.boosting;
  if (struck) {
    const damaged = damage(item.impact ?? 16,item);
    if (damaged || item.impact == null) run.charge = Math.max(0,run.charge-(item.drain ?? 12));
    scene.burst(item.x,item.y,captureZ,0xff84d4,26,1.5);
  }
  if (run.partner?.hp>0 && oldZ<=captureZ && item.z>captureZ &&
      Math.hypot(run.partner.x-item.x,(run.partner.y-item.y)*1.08)<item.radius) {
    damage(item.impact ?? 16,item,run.partner);
  }
  if (item.routeWave) {
    item.routeWave.struck ||= struck;
    if (--item.routeWave.remaining === 0 && !item.routeWave.struck) countContract('evasion');
  }
  deleteEntity(index);
}

function deployRelay() {
  const isDetour = run.level >= 4 && run.sector === (run.contract.plan.sector+1+run.level%2)%3;
  if (run.relayDeployed || run.bossActive || run.sectorTime < (isDetour ? 7.4 : 10.8) || run.sector === 2 && run.level < 4) return;
  if (isDetour) {
    deployDetour();
    run.relayDeployed = true;
    return;
  }
  const side = (run.sector+run.level)%2 ? 1 : -1;
  entity('relay',cap(run.x+side*5.8,-11.7,11.7),Math.sin(run.level+run.sector)*2.4,-122,1.16);
  run.relayDeployed = true;
  get('objective').textContent = 'Пройди через голубой маяк · подкрепление и очки';
  tone(580,760,.21,.08,'sine');
}

function deployDetour() {
  const side = (run.level+run.sector)%2 ? 1 : -1;
  const pattern = Math.floor(run.level/2)%3;
  const x = side*8.5;
  const y = [2.1,-1.9,.5][pattern];
  entity('relay',-x,-y*.72,-176,1.30).detourRelay = true;
  entity('cache',x,y,-186,1.34).detourCache = true;
  if (pattern === 0) {
    for (const offset of [-3.1,3.1]) entity('mine',x+offset,y,-176,1.11);
  } else if (pattern === 1) {
    entity('pulse',x*.74,y-1.45,-163,1.3);
    entity('pulse',x,y+2.1,-188,1.16);
  } else {
    for (const offset of [-1,1]) {
      const sentry = entity('mine',x+offset*4.0,y+offset*1.3,-181,1.03);
      sentry.vx = -offset*.85;
    }
  }
  const safeSide = side > 0 ? 'слева' : 'справа';
  const riskSide = side > 0 ? 'справа' : 'слева';
  run.detour = {repair:true,loot:true,safeSide,riskSide};
  refreshContractObjective();
  showEvent('РАЗВИЛКА МАРШРУТА',['Минный коридор','Ионный карман','Дрейфующий заслон'][pattern],
    'Голубой маяк '+safeSide+' · тайник на 85 очков '+riskSide,2.7);
  tone(570,820,.24,.09,'triangle');
}

function scheduleRaid() {
  const slot = run.raidSlots?.[run.raid];
  if (run.bossActive || !slot || run.sectorTime < slot.time) return;
  const side = (run.raid+run.sector)%2 ? 1 : -1;
  slot.types.forEach((variant,index)=>{
    const profile = raiders[variant];
    const anchor = index ? -side : side;
    const x = cap(run.x+anchor*(3.8+index*2.2),-rangeX*.78,rangeX*.78);
    const unit = entity('raider',x,cap(run.y-index*2,-3.0,3.0),-94-index*14,profile.scale,variant);
    const hp = profile.health+run.difficulty*(variant === 'bulwark' ? .91 : .52);
    Object.assign(unit,{age:0,hp,maxHp:hp,profile,variant,home:x,side:anchor,nextShot:1.35+index*.72,
      nextMine:2.0+index*.9,hitUntil:0,warningUntil:0,warningLocked:false});
  });
  run.raid++;
  const name = slot.types.length > 1 ? 'Вражеская пара' : raiders[slot.types[0]].name;
  showEvent('КОНТАКТ',name,slot.types.includes('trapper') ? 'Обходи сброшенные мины' : 'Держи цель на курсе и следи за залпом',1.4);
  tone(340,180,.38,.09,'triangle');
}

function spawnAce(stage,duelist,slot=0,total=1) {
  const {variant,weapon,ultimate,name,health,index} = stage;
  const side = total>1 ? (slot===0 ? -1 : 1) : index%2 ? -1 : 1;
  const base = raiders[variant];
  const profile = {...base,name,reward:base.reward+105};
  const hp = duelist ? health : Math.round(health*.47+run.level*.45);
  const item = entity('raider',side*3.8,1,-86,base.scale*(stage.boss ? 1.75 : duelist ? 1.12 : 1.06),variant);
  Object.assign(item,{ace:stage,duelist,age:0,hp,maxHp:hp,profile,side,slot,total,volleys:0,
    weapon:aceWeapons[weapon],special:aceUltimates[ultimate],
    nextShot:run.time+(duelist ? 2.4+slot*1.15 : 1.65),ultimateCharge:duelist ? 18+stage.chapter*6 : 34,
    revealedUntil:0,hitUntil:0});
  run.ace = item;
  return item;
}

function launchDuelWave() {
  const stages=run.duelWaves[run.duelWave];
  run.waveEnemies=stages.map((stage,index)=>spawnAce(stage,true,index,stages.length));
  run.ace=run.waveEnemies[0];
  run.waveTime=0;
  const boss=stages[0].boss;
  get('stageName').textContent=boss ? 'ФЛАГМАН' : 'Волна '+(run.duelWave+1)+' / '+run.duelWaves.length;
  if (run.duelWaves.length>1) showEvent(boss ? 'ФЛАГМАН' : 'ВОЛНА '+(run.duelWave+1),stages.map(stage=>stage.name).join(' · '),
    boss ? 'На половине корпуса флагман ускорит атаки.' : 'Следи за направлением залпов.',2.0);
}

function tickDuel() {
  if (!run.duelWaves || run.duelWonAt || run.hp<=0 && !(run.partner?.hp>0)) return;
  const live=run.waveEnemies.filter(item=>item.hp>0);
  run.ace=live.find(item=>item.ultimateLock) ?? live[0] ?? null;
  if (live.length) return;
  if (run.duelWave+1===run.duelWaves.length) {
    if (run.duel) recordDuel(run.duel.index,run.saveToken);
    run.duelWonAt=run.time+1.48;
    run.ultimateAim=run.laserTicks=0;
    if (run.partner) run.partner.ultimateAim=run.partner.laserTicks=0;
    get('objective').textContent='Бой выигран';
    return;
  }
  if (!run.waveTime) run.waveTime=run.time+1.7;
  if (run.time>=run.waveTime) {
    run.duelWave++;
    for (const pilot of run.partner ? [run,run.partner] : [run]) {
      if (pilot.hp>0) {
        pilot.hp=Math.min(pilot.maxHp,pilot.hp+16);
        chargeUltimate(18,pilot);
      }
    }
    launchDuelWave();
  }
}

function aceTarget(item) {
  if (run.partner?.hp>0 && (run.hp<=0 || (item.volleys+item.slot)%2===1)) return run.partner;
  return run;
}

function scheduleAce() {
  if (!run.sectorAce || run.aceDeployed || run.bossActive || run.sectorTime < 8.25) return;
  const item = spawnAce(run.sectorAce,false);
  run.aceDeployed = true;
  showEvent('ВРАЖЕСКИЙ АС',item.profile.name,item.weapon.name+' · ульта '+item.special.name,2.4);
  tone(327,171,.38,.105,'triangle');
}

function aceVolley(item,target,weapon,depth = 0) {
  const type = weapon.kind === 'mines' ? 'mine' : 'bolt';
  const z = item.z+2-depth;
  const travel = -z/weapon.speed;
  for (const [index,[dx,dy]] of weapon.spread.entries()) {
    const launchX = item.x+(index-(weapon.spread.length-1)/2)*.43;
    const object = entity(type,launchX,item.y,z,weapon.scale,weapon.kind);
    object.vx = (target.x+dx-launchX)/travel;
    object.vy = (target.y+dy-item.y)/travel;
    object.travelSpeed = weapon.speed;
    object.impact = weapon.damage;
    object.drain = weapon.drain ?? 0;
  }
}

function fireAceUltimate(item,lock) {
  const {x,y} = lock;
  const {color,radius} = item.special;
  switch (item.ace.ultimate) {
    case 'spear': {
      const pivot = {x,y,z:-14};
      scene.ultimateTrace({x:item.x,y:item.y,z:item.z},pivot,color,'sniper');
      scene.ultimateTrace(pivot,{x,y,z:3},color,'cannon');
      for (const pilot of run.partner ? [run,run.partner] : [run]) {
        if (Math.hypot((pilot.x-x)/radius[0],(pilot.y-y)/radius[1]) < 1) damage(35,{type:'bolt'},pilot);
      }
      break;
    }
    case 'storm':
      aceVolley(item,lock,{...aceWeapons.fan,speed:70,damage:25,spread:[[-6,0],[-4,1.25],[-2,-.7],[0,.25],[2,-.7],[4,1.25],[6,0]]});
      break;
    case 'field':
      aceVolley(item,lock,{...aceWeapons.mines,damage:28,spread:[[-5,-.8],[-1.7,1.02],[2,-1.2],[5,.75]]});
      aceVolley(item,lock,{...aceWeapons.mines,speed:42,damage:27,spread:[[-4,1.2],[0,-1.45],[4,1.2]]},33);
      break;
    case 'pulse':
      for (const [index,offset] of [0,-3.4,3.4].entries()) {
        const pulse = entity('pulse',x+offset,y+(index ? (index === 1 ? .85 : -.8) : 0),item.z-7-index*16,1.35);
        pulse.travelSpeed = 49;
        pulse.impact = 25;
        pulse.drain = 16;
      }
      break;
    case 'collapse':
      aceVolley(item,lock,{...aceWeapons.ion,speed:72,damage:26,drain:15,spread:[[-5,0],[-2.5,0],[0,0],[2.5,0],[5,0]]});
      aceVolley(item,lock,{...aceWeapons.ion,speed:72,damage:26,drain:15,spread:[[0,-3],[0,0],[0,3]]},33);
      break;
  }
  revealAce(item);
  scene.burst(item.x,item.y,item.z,color,24,1.2);
  tone(251,56,.40,.16,'sawtooth');
}

function revealAce(item) {
  item.revealedUntil = run.time+1.35;
}

function tickAce(item,index,dt) {
  if (!item.duelist && item.age > 12.8) {
    deleteEntity(index);
    return;
  }
  const {ace,side} = item;
  item.age += dt*(item.chilledUntil > run.time ? .68 : 1);
  const t = item.age;
  const rushing = ace.flight === 'rush' || ace.flight === 'eclipse';
  const vertical = ace.flight === 'vertical';
  const heavy = ace.flight === 'heavy';
  const phase = t*(heavy ? .75 : rushing ? 1.46 : 1.10);
  const wave = Math.sin(phase+.46);
  item.x = side*(ace.flight === 'eclipse' ? Math.tanh(wave*1.65)*8.9 : wave*(vertical ? 4.5 : heavy ? 4.7 : 7.9));
  if (item.total>1) item.x = item.side*(5.5+item.x*item.side*.53);
  item.y = Math.sin(t*(vertical ? 1.79 : 1.03)+side*.65)*(vertical ? 3.45 : heavy ? 1.21 : 2.36);
  item.z = -52-30*Math.exp(-t*1.72)+Math.sin(t*.68)*(rushing ? 11.6 : 5.5);
  item.mesh.position.set(item.x,item.y,item.z);
  item.mesh.rotation.set(.17*Math.sin(t),.21*Math.cos(phase),side*.25*Math.sin(phase));

  if (item.ultimateLock) {
    if (run.time >= item.ultimateLock.until) {
      fireAceUltimate(item,item.ultimateLock);
      item.ultimateLock = null;
      item.ultimateCharge = 0;
      item.nextShot = Math.max(item.nextShot,run.time+.75);
    }
    return;
  }
  const phaseTwo = ace.boss && item.hp<item.maxHp*.5;
  const rate = (item.duelist ? ace.charge : ace.charge*.91)*(phaseTwo ? 1.38 : 1);
  item.ultimateCharge = Math.min(100,item.ultimateCharge+dt*rate);
  if (item.ultimateCharge>=100 && !entities.some(unit=>unit!==item && unit.hp>0 && unit.ultimateLock)) {
    const target=aceTarget(item);
    item.ultimateLock = {x:target.x,y:target.y,until:run.time+item.special.windup};
    item.aimLock = null;
    tone(468,286,.32,.12,'triangle');
    return;
  }
  if (item.jammedUntil > run.time) {
    item.nextShot = Math.max(item.nextShot,run.time+.51);
    item.aimLock = null;
    return;
  }
  if (!item.aimLock && run.time >= item.nextShot-.48) {
    const target=aceTarget(item);
    item.aimLock = {x:cap(target.x+target.dx*item.weapon.lead,-rangeX,rangeX),
      y:cap(target.y+target.dy*item.weapon.lead,-rangeY,rangeY)};
  }
  if (run.time >= item.nextShot && item.aimLock) {
    aceVolley(item,item.aimLock,item.weapon);
    item.aimLock = null;
    item.volleys++;
    item.nextShot = run.time+ace.interval*(phaseTwo ? .78 : 1)+(item.duelist ? 0 : .28);
    revealAce(item);
    scene.burst(item.x,item.y,item.z,item.special.color,8);
    tone(225,105,.15,.084,'sawtooth');
  }
}

function enemyVolley(item) {
  const hand = item.profile.spread;
  const travel = -item.z/(run.speed*1.53);
  const spacing = item.variant === 'bulwark' ? 3.6 : 2.72;
  for (let n=-hand;n<=hand;n++) {
    const bolt = entity('bolt',item.x+n*.63,item.y,item.z+2,item.variant === 'gunner' && n === 0 ? 1.08 : .80);
    bolt.vx = (item.aimX+n*spacing-bolt.x)/travel;
    bolt.vy = (item.aimY+Math.abs(n)*(item.side*.46)-bolt.y)/travel;
  }
  tone(210,88,.19,.11,'sawtooth');
}

function tickRaider(item,i,dt) {
  const {profile} = item;
  item.age += dt*(item.chilledUntil > run.time ? .52 : 1);
  const t = item.age;
  if (t > 8.2) {
    deleteEntity(i);
    return;
  }
  item.x = cap(item.home+Math.sin(t*profile.turn)*profile.sway*item.side,-rangeX*.88,rangeX*.88);
  item.y += (Math.sin(t*.95+item.side)*(item.variant === 'scout' ? 2.85 : 1.78)-item.y)*dt*2;
  item.z = -49-45*Math.exp(-t*1.35)-Math.max(0,t-6.25)**2*12;
  item.mesh.position.set(item.x,item.y,item.z);
  item.mesh.rotation.set(.12*Math.sin(t),.22*Math.cos(t*profile.turn),.19*Math.sin(t*profile.turn)*item.side);
  if (item.jammedUntil > run.time) {
    item.nextShot = Math.max(item.nextShot,t+.56);
    item.warningLocked = false;
    item.warningUntil = 0;
  } else if (t >= item.nextShot && t < 6.85) {
    if (item.warningLocked) enemyVolley(item);
    item.nextShot = t+Math.max(1.03,profile.interval-run.difficulty*.019);
    item.warningLocked = false;
    item.warningUntil = 0;
  } else if (!item.warningLocked && t >= item.nextShot-.53 && t < 6.32) {
    item.aimX = run.x;
    item.aimY = run.y;
    item.warningUntil = item.nextShot;
    item.warningLocked = true;
    tone(610,340,.12,.043,'triangle');
  }
  if (profile.mines && t >= item.nextMine && t < 6.3) {
    for (let n=0;n<profile.mines;n++) {
      const mine = entity('mine',item.x+(n ? item.side*2.7 : 0),item.y,item.z-3,1.04);
      mine.vx = cap((run.x-mine.x)*.40,-5,5);
      mine.vy = cap((run.y-mine.y)*.25,-2,2);
    }
    item.nextMine += 2.20;
  }
}

function updateEntities(dt) {
  for (let i = entities.length-1; i >= 0; i--) {
    const item = entities[i];
    const oldZ = item.previousZ = item.z;
    item.previousX = item.x;
    item.previousY = item.y;
    const {type,mesh} = item;
    if (item.bossNode) continue;
    if (type === 'raider') {
      if (item.ace) tickAce(item,i,dt);
      else tickRaider(item,i,dt);
      continue;
    }
    const driftTime = item.chilledUntil > run.time ? dt*.52 : dt;
    item.x += item.vx * driftTime;
    item.y += item.vy * driftTime;
    item.z += (item.travelSpeed ?? run.speed*(type === 'bolt' ? 1.53 : 1))*driftTime;
    mesh.position.set(item.x,item.y,item.z);
    if (type !== 'bolt') {
      if (type !== 'relay') mesh.rotation.y += item.spin*dt;
      mesh.rotation.z += item.spin*.55*dt;
    }
    if (type === 'relay') {
      if (oldZ <= captureZ && item.z > captureZ) {
        flyThroughRelay(item,oldZ);
        if (item.detourRelay && run.detour) run.detour.repair = false;
        refreshContractObjective();
        deleteEntity(i);
      }
      continue;
    }
    if (type === 'pulse') {
      tickPulse(item,i,oldZ);
      continue;
    }
    if (type === 'cache') {
      if (item.z > 12) {
        if (item.detourCache && run.detour) {
          run.detour.loot = false;
          refreshContractObjective();
        }
        deleteEntity(i);
      }
      continue;
    }
    const radius = item.radius;
    const second=run.partner;
    if (second?.hp>0 && ['bolt','mine','rock'].includes(type) &&
        sweptDistance(second,item,-1.45,1.45,1.14)<radius+.49) {
      if (second.boosting) scene.burst(item.x,item.y,item.z,color[type],28,1.3);
      else damage(item.impact ?? (type==='mine' ? 25 : 17),item,second);
      deleteEntity(i);
      continue;
    }
    const collision = type === 'crystal' ? captureTest(run,item) : sweptDistance(run,item,-1.45,1.45,1.14) < radius+.49;
    if (collision && run.hp>0) {
      if (type === 'crystal' || type === 'heal') {
        if (type === 'crystal') {
          run.crystals++;
          chargeUltimate(4);
          pickupText = {x:run.x,y:run.y,z:captureZ,until:run.time+.85};
          run.charge = Math.min(100,run.charge+13);
          cue.crystal();
          countContract('salvage');
        } else {
          run.hp = Math.min(run.maxHp,run.hp+28);
          cue.heal();
        }
        merit(points[type],awards[type]);
        scene.burst(item.x,item.y,type === 'crystal' ? captureZ : item.z,color[type],20);
      } else if (run.boosting) {
        merit(points[type] || 65,awards[type]);
        scene.burst(item.x,item.y,item.z,color[type],32,1.4);
        cue.break();
      } else {
        if (damage(item.impact ?? (type === 'rock' ? 31 : type === 'mine' ? 25 : 17),item) && item.drain) {
          run.charge = Math.max(0,run.charge-item.drain);
        }
      }
      deleteEntity(i);
      continue;
    }
    if (!item.passed && item.z > 1.55) {
      item.passed = true;
      if (type !== 'crystal' && type !== 'heal' && sweptDistance(run,item,1.55,1.55,1.14) < radius+1.45) {
        merit(65,9);
        run.charge = Math.min(100,run.charge+6);
        scene.burst(item.x,item.y,item.z,0xffee9f,10);
        cue.dodge();
      }
    }
    if (item.z > 22) deleteEntity(i);
  }
}

function takeShot(pilot) {
  const craft = pilot.craft;
  const overload = craft.prism && ++pilot.salvos%4 === 0;
  if (craft.heat) {
    pilot.heat = Math.min(1,pilot.heat+craft.heat);
    if (pilot.heat >= 1) {
      pilot.overheated = true;
      tone(420,110,.37,.08,'triangle');
    }
  }
  for (const offset of craft.pattern) {
    const shot = scene.object('shot');
    const x = pilot.x + offset;
    const y = pilot.y + .1;
    const velocity = craft.velocity || 110;
    const vx = offset*(craft.spread || 0);
    const vy = 0;
    shot.position.set(x,y,-2.1);
    shot.rotation.set(vy*.009,-vx*.009,0);
    const width = overload ? 3.1 : craft.rocket ? 2.1 : craft.sniper || craft.heat ? .71 : 1;
    shot.scale.set(width,width,overload ? 4.0 : craft.sniper ? 3.4 : craft.pierce ? 2.6 : pilot.boosting ? 1.43 : 1);
    shots.push({x,y,z:-2.1,vx,vy,velocity,mesh:shot,shooter:pilot,pierced:new Set(),damage:craft.damage*(pilot.boosting ? 2 : 1)*(overload ? 1.8 : 1)});
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

const damageable = item => item.type === 'rock' || item.type === 'mine' || item.type === 'raider' || item.type === 'cache';

function chargeUltimate(amount,pilot=run) {
  if (pilot.hp>0 && !pilot.ultimateAim && !pilot.laserTicks && !run.victory && !run.duelWonAt) pilot.ultimateCharge = Math.min(100,pilot.ultimateCharge+amount);
}

const straight = {x:0,y:0};
function fireUltimateRay(ray,damage,kind,pilot) {
  const {range,color,trait} = pilot.ultimate;
  const origin = {x:pilot.x,y:pilot.y+.1,z:-2.1};
  const width = kind === 'laser' ? .58 : kind === 'cannon' ? .36 : 0;
  const targets = [];
  for (const item of entities) {
    if (!damageable(item) || item.hp <= 0) continue;
    const hit = traceHit(origin,ray,item,item.radius+width,range);
    if (hit) targets.push({hit,item});
  }
  if (run.bossActive && !run.victory && run.bossHp > 0) {
    const hit = traceHit(origin,ray,scene.boss.position,(kind === 'sniper' ? 1.45 : 2.45)+width,range);
    if (hit) targets.push({hit,boss:true});
  }
  targets.sort((a,b)=>a.hit.distance-b.hit.distance);
  const pierces = kind === 'laser' || kind === 'sniper';
  let end = {x:origin.x+ray.x*range,y:origin.y+ray.y*range,z:origin.z-range};
  for (const {hit,item,boss} of targets) {
    if (boss) {
      strikeBoss(damage,color);
      if (run.bossShielded || !pierces) end = hit;
      if (run.bossShielded) break;
    } else {
      hitTarget(item,damage);
      if (kind !== 'laser') scene.burst(hit.x,hit.y,hit.z,color,9);
      if (!pierces) end = hit;
    }
    if (!pierces) {
      if (kind === 'cannon' && (!boss || !run.bossShielded)) {
        for (const nearby of entities) {
          if (nearby === item || nearby.hp <= 0 || !damageable(nearby)) continue;
          const distance = Math.hypot(nearby.x-hit.x,nearby.y-hit.y,nearby.z-hit.z);
          if (distance < trait) hitTarget(nearby,damage*.57*(1-distance/trait));
        }
        scene.burst(hit.x,hit.y,hit.z,color,63,1.75);
      }
      break;
    }
  }
  scene.ultimateTrace(origin,end,color,kind);
}

function activateUltimate(pilot=run) {
  if (mode !== 'playing' || pilot.hp<=0 || run.victory || run.duelWonAt || pilot.ultimateAim || pilot.ultimateCharge < 100) return false;
  pilot.ultimateCharge = 0;
  pilot.ultimateAim = ultimateAimDuration;
  tone(356,526,.24,.08,'triangle');
  return true;
}

function fireUltimate(pilot) {
  pilot.ultimateAim=0;
  const {kind,damage,trait,name} = pilot.ultimate;
  const tunedDamage = damage*(1+pilot.weaponTuning*.065);
  run.shake = Math.max(run.shake,kind === 'cannon' ? .29 : .10);
  if (kind === 'laser') {
    pilot.laserTicks = Math.round(trait/.12);
    pilot.laserClock = 0;
  } else if (kind === 'scatter') {
    for (const ray of scatterRays(trait)) fireUltimateRay(ray,tunedDamage,kind,pilot);
  } else fireUltimateRay(straight,tunedDamage,kind,pilot);
  showEvent('УЛЬТА',name,'',1.15);
  tone(kind === 'sniper' ? 785 : 138,kind === 'laser' ? 640 : 46,.44,.17,'triangle');
}

function updateUltimate(dt,pilot) {
  if (pilot.hp<=0 || run.victory || run.duelWonAt) return;
  if (pilot.ultimateAim > 0) {
    pilot.ultimateAim = Math.max(0,pilot.ultimateAim-dt);
    if (pilot.ultimateAim <= 0) fireUltimate(pilot);
    return;
  }
  chargeUltimate(dt*(run.training ? 27 : run.duelWaves ? 2.1 : .78),pilot);
  if (!pilot.laserTicks) return;
  pilot.laserClock -= dt;
  if (pilot.laserClock > 0) return;
  pilot.laserClock += .12;
  pilot.laserTicks--;
  fireUltimateRay(straight,pilot.ultimate.damage*(1+pilot.weaponTuning*.065),'laser',pilot);
}

function rocketBurst(shot,z,except) {
  const radius = shot.shooter.craft.splash;
  if (!radius) return;
  scene.burst(shot.x,shot.y,z,shot.shooter.craft.color,21,radius*.31+.52);
  for (const item of entities) {
    if (item === except || item.hp <= 0 || !damageable(item)) continue;
    const distance = Math.hypot(item.x-shot.x,item.y-shot.y,(item.z-z)*.83);
    if (distance < radius) hitTarget(item,shot.damage*(1-distance/radius)*.85);
  }
}

function hitTarget(item,impact) {
  item.hp = Math.max(0,item.hp-impact);
  if (item.type === 'raider') item.hitUntil = run.time+.19;
}

function strikeBoss(damage,color = 0xffbcfa) {
  const {x,y,z} = scene.boss.position;
  if (run.bossShielded) {
    scene.burst(x,y,z+2.2,0x8fcbff,5);
    return false;
  }
  run.bossHp = Math.max(0,run.bossHp-damage);
  run.bossFlash = .17;
  scene.burst(x,y,z+2.2,color,13);
  if (Math.floor(run.bossHp)%8 === 0) cue.break();
  return true;
}

function detonateEnemy(item,tint) {
  const radius = Math.min(16,4.4+Math.sqrt(item.maxHp)*.83);
  const duration = .43+radius*.034;
  const blast = {x:item.x,y:item.y,z:item.z,radius,duration,elapsed:0,touched:new Set(),
    force:10+item.maxHp*.86,pilotsHit:new Set()};
  run.blasts.push(blast);
  scene.raiderBlast(blast,tint);
  tone(114,25,.21+radius*.027,.075+radius*.009,'sawtooth');
}

function updateBlasts(dt) {
  for (let n=run.blasts.length-1;n>=0;n--) {
    const blast = run.blasts[n];
    blast.elapsed = Math.min(blast.duration,blast.elapsed+dt);
    const reach = blast.radius*(1-(1-blast.elapsed/blast.duration)**2);
    for (let i=entities.length-1;i>=0;i--) {
      const item = entities[i];
      const x = item.x-blast.x, y = item.y-blast.y, z = item.z-blast.z;
      const distance = Math.hypot(x,y,z);
      if (distance>reach || item.hp<=0 || blast.touched.has(item)) continue;
      blast.touched.add(item);
      const falloff = 1-distance/blast.radius;
      if (item.type === 'raider' || item.bossNode) hitTarget(item,blast.force*(.27+falloff*.73));
      else if (!item.routeTarget && ['rock','mine','bolt','pulse','cache'].includes(item.type)) {
        scene.burst(item.x,item.y,item.z,color[item.type],5);
        deleteEntity(i);
      } else if (!item.routeTarget && (item.type === 'crystal' || item.type === 'heal')) {
        const spread = 4+falloff*8;
        item.vx += x/Math.max(distance,.6)*spread;
        item.vy += y/Math.max(distance,.6)*spread;
      }
    }
    for (const pilot of run.partner ? [run,run.partner] : [run]) {
      const distance=Math.hypot(pilot.x-blast.x,pilot.y-blast.y,blast.z);
      if (!blast.pilotsHit.has(pilot) && distance<=reach) {
        blast.pilotsHit.add(pilot);
        damage(Math.round(7+Math.min(36,blast.force*.41)*(1-distance/blast.radius)),{type:'blast'},pilot);
      }
    }
    if (blast.elapsed>=blast.duration) run.blasts.splice(n,1);
  }
}

function clearDestroyed() {
  for (let j=entities.length-1;j>=0;j--) {
    const item = entities[j];
    if (item.hp > 0) continue;
    if (item.bossNode) {
      scene.burst(item.x,item.y,item.z,0xffc472,28);
      showEvent('УЗЕЛ УНИЧТОЖЕН',item.bossNode.label,item.bossNode.side < 0 ? 'Страж не сможет поднять щит' : 'Страж потерял боковые орудия',1.7);
      deleteEntity(j);
      continue;
    }
    merit(points[item.type] ?? 100,item.detourCache ? 85 : item.profile?.reward ?? awards[item.type]);
    run.charge = Math.min(100,run.charge+3);
    if (item.type === 'raider') {
      detonateEnemy(item,item.special?.color ?? item.profile.color);
      if (item.duelist) {
        deleteEntity(j);
        continue;
      }
      chargeUltimate(7);
      countContract('intercept');
      entity('crystal',item.x,item.y,item.z-3,1.03);
    } else {
      scene.burst(item.x,item.y,item.z,color[item.type],22,1.28);
      cue.break();
      if (item.type === 'cache' && item.routeTarget) countContract('cache');
    }
    if (item.detourCache && run.detour) {
      run.detour.loot = false;
      refreshContractObjective();
      showEvent('ГРУЗ СПАСЁН','Тайник вскрыт','+85 очков',1.5);
    }
    deleteEntity(j);
  }
}

function updateShots(dt) {
  for (let i = shots.length-1; i >= 0; i--) {
    const shot = shots[i];
    const {shooter}=shot;
    const craft=shooter.craft;
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
      chargeUltimate(Math.min(item.hp,shot.damage)*.88,shooter);
      hitTarget(item,item.type === 'raider' ? shot.damage : Math.max(1,shot.damage/2));
      if (craft.pierce) shot.pierced.add(item);
      if (craft.ion && item.type === 'raider') item.jammedUntil = run.time+.78;
      if (craft.cryo) item.chilledUntil = run.time+1.45;
      rocketBurst(shot,item.z,item);
      scene.burst(shot.x,shot.y,item.z,craft.color,8);
      if (!craft.pierce) {
        hit = true;
        break;
      }
    }
    if (!hit && run.bossActive && !run.victory) {
      const boss = scene.boss.position;
      if (oldZ >= boss.z && shot.z <= boss.z && Math.hypot(shot.x-boss.x,shot.y-boss.y) < 2.45) {
        rocketBurst(shot,boss.z,null);
        if (strikeBoss(shot.damage)) chargeUltimate(shot.damage*.50,shooter);
        hit = true;
      }
    }
    if (hit || shot.z < -205) removeShot(i);
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
  run.bossNodes = run.difficulty < 4 ? [] : [
    {label:'Щит',side:-1,y:.25,health:18+run.difficulty*1.55},
    {label:'Турель',side:1,y:-.25,health:16+run.difficulty*1.35}
  ].map(node=>{
    const item = entity('cache',node.side*4.25,node.y,-114,1.22);
    const bossNode = {...node,item};
    item.hp = node.health;
    item.bossNode = bossNode;
    return bossNode;
  });
  get('bossNodes').hidden = !run.bossNodes.length;
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
  const [shieldNode,turretNode] = run.bossNodes;
  const boss = scene.boss.position;
  for (const node of run.bossNodes) {
    if (node.item.hp <= 0) continue;
    const {item,side,y} = node;
    item.x = boss.x+side*4.25;
    item.y = boss.y+y;
    item.z = boss.z+2;
    item.mesh.position.set(item.x,item.y,item.z);
    item.mesh.rotation.y = t*.6;
  }
  const shieldWindow = Math.min(2.35,0.8+run.difficulty*.09);
  const shielded = run.difficulty >= 2 && (!shieldNode || shieldNode.item.hp > 0) && (t+.35)%4.4 < shieldWindow;
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
    detonateEnemy({x,y,z,maxHp:run.bossMax},0xffaffc);
    scene.burst(x,y,z,0xa1ffff,90,2.3);
    scene.boss.visible = false;
    for (let i=entities.length-1;i>=0;i--) if (entities[i].bossNode) deleteEntity(i);
    run.victory = .001;
    run.score += 3000 + run.hp*20;
    run.credits += 170+(run.level+1)*22+(routeOptions[run.route]?.reward ?? 0);
    run.shake = 1.22;
    run.invuln = 4;
    get('bossbar').hidden = true;
    get('objective').textContent = 'Разлом закрывается · выход открыт';
    showEvent('КАНАЛ РАСЧИЩЕН',run.level === levels.length-1 ? 'Аврора спасена' : 'Прорыв!',
      run.level === levels.length-1 ? 'Ковчег вышел из разлома' : 'Получена следующая координата',3.1);
    cue.win();
    return;
  }
  if (t < run.bossShotTime) return;
  const armed = !turretNode || turretNode.item.hp > 0;
  const phase = armed ? (run.bossHp < run.bossMax*.48 ? 2 : 1) : 0;
  run.bossShotTime = t + Math.max(.85,(phase === 2 ? 1.48 : 2.10)-run.difficulty*.045);
  const {x,y,z} = scene.boss.position;
  const flightTime = -z/(run.speed*1.53);
  for (let i = -phase; i <= phase; i++) {
    const bolt = entity('bolt',x+i*.62,y,z+2,i === 0 ? 1.19 : .83);
    bolt.vx = (run.x + i*2.75 - bolt.x)/flightTime;
    bolt.vy = (run.y + Math.abs(i)*.86 - bolt.y)/flightTime;
  }
  if (run.difficulty >= 4 && armed) {
    const lane = run.x > 0 ? -10.5 : 10.5;
    const bolt = entity('bolt',x,y,z-1,.84+run.difficulty*.03);
    bolt.vx = (lane-x)/flightTime;
    bolt.vy = (-run.y*.62-y)/flightTime;
  }
  if (Math.floor(t/2)%2 === 0) crystals(cap(-run.x,-9.5,9.5),random(-3,3),3,.20);
  if (t > 5 && Math.floor(t/2)%5 === 0 && run.hp < 75) entity('heal',-Math.sign(run.x || 1)*5,0,-64,.9);
  tone(235,80,.32,.25,'sawtooth');
}

function drive(pilot,axis,pad,precision,dt) {
  if (pilot.hp<=0) return;
  const [left,right,up,down]=axis;
  steer(pilot,{
    x:pad?.x ?? Number(keys.has(right))-Number(keys.has(left)),
    y:pad?.y ?? Number(keys.has(up))-Number(keys.has(down)),
    analog:Boolean(pad),precision,sensitivity
  },dt,rangeX,rangeY);
}

const wasd=['KeyA','KeyD','KeyW','KeyS'];
const arrows=['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'];
function updateMovement(dt) {
  run.precision=keys.has(precisionKey);
  if (run.partner) {
    drive(run,wasd,null,run.precision,dt);
    drive(run.partner,arrows,null,false,dt);
  } else {
    drive(run,keys.has('ArrowLeft') || keys.has('ArrowRight') || keys.has('ArrowUp') || keys.has('ArrowDown') ? arrows : wasd,
      pointer,run.precision,dt);
  }
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
  get('hp').style.transform = 'scaleX(' + hp/run.maxHp + ')';
  get('boost').style.transform = 'scaleX(' + charge/100 + ')';
  const progress = run.waveEnemies ? (run.duelWave + 1-run.waveEnemies.reduce((sum,item)=>sum+item.hp/item.maxHp,0)/run.waveEnemies.length)/run.duelWaves.length :
    bossActive ? .78+.22*(1-bossHp/bossMax) : cap(sectorTime/waveLength[sector],0,1)*(sector === 2 ? .78 : 1);
  get('progress').style.transform = 'scaleX(' + progress + ')';
  get('hpValue').textContent = Math.round(hp/run.maxHp*100) + '%';
  get('boostValue').textContent = Math.floor(charge) + '%';
  get('score').textContent = String(Math.floor(score)).padStart(6,'0');
  get('chain').textContent = 'КОМБО ×' + (1+Math.min(4,Math.floor(chain/3)));
  get('speed').textContent = Math.round(speed*41);
  get('crystals').textContent = String(loot).padStart(2,'0');
  get('runCredits').textContent = count(run.credits);
  if (run.partner) {
    const second=run.partner;
    get('wingName').textContent=second.craft.name;
    get('wingHull').textContent=Math.ceil(second.hp)+' / '+second.maxHp+' HP';
    get('wingUltimate').textContent=second.ultimateAim ? Math.ceil(second.ultimateAim)+' с · Enter — выстрел' : 'Ульта '+Math.floor(second.ultimateCharge)+'%';
  }
  const status = get('aceStatus');
  status.hidden = !run.ace;
  if (run.ace) {
    const {profile,ultimateLock,ultimateCharge,special,revealedUntil} = run.ace;
    status.style.setProperty('--ace-accent','#'+special.color.toString(16).padStart(6,'0'));
    status.classList.toggle('warning',Boolean(ultimateLock));
    get('aceName').textContent = profile.name;
    get('aceState').textContent = ultimateLock ? 'УЛЬТА ГОТОВИТСЯ' : run.duel && revealedUntil <= run.time ? 'В ТЕНИ' : Math.floor(ultimateCharge)+'%';
    get('acePower').value = ultimateCharge;
    const warning = get('aceWarning');
    warning.hidden = !ultimateLock;
    warning.textContent = 'Ульта «'+special.name+'» · '+special.hint;
  }
  const loaded = run.ultimateCharge >= 100;
  const power = get('ultimatePower');
  power.style.setProperty('--ultimate-color','#'+run.ultimate.color.toString(16).padStart(6,'0'));
  power.classList.toggle('ready',loaded);
  get('ultimateName').textContent = run.ultimate.name;
  get('ultimateFill').value = run.ultimateAim ? run.ultimateAim/ultimateAimDuration*100 : run.ultimateCharge;
  get('ultimateValue').textContent = run.ultimateAim ? 'НАВЕДЕНИЕ' : run.laserTicks ? 'АКТИВНА' : loaded ? 'Q · ГОТОВО' : Math.floor(run.ultimateCharge)+'%';
  get('ultimateCountdown').hidden = run.ultimateAim <= 0;
  get('ultimateSeconds').textContent = Math.ceil(run.ultimateAim)+' с';
  get('touchUltimate').setAttribute('aria-disabled',String(!loaded && !run.ultimateAim));
  get('touchUltimate').textContent = run.ultimateAim ? 'Выстрел' : 'Ульта';
  const gun = get('weaponStatus');
  gun.hidden = !run.craft.heat && !run.craft.prism;
  if (run.craft.heat) gun.textContent = run.overheated ? 'ОХЛАЖДЕНИЕ' : 'НАГРЕВ '+Math.round(run.heat*100)+'%';
  else if (run.craft.prism) gun.textContent = 'ПРИЗМА '+(run.salvos%4)+'/4';
  get('damage').style.opacity = String(flash);
  if (bossActive && !victory) {
    get('bossHp').style.transform = 'scaleX(' + bossHp/bossMax + ')';
    get('bossValue').textContent = Math.ceil(bossHp/bossMax*100) + '%';
    for (const [index,node] of run.bossNodes.entries()) {
      get('bossNode'+index).textContent = node.label+' '+Math.ceil(node.item.hp/node.health*100)+'%';
    }
  }
  if (run.time > eventTimer) get('event').classList.remove('show');
}

function drawReticle(marker,pilot) {
  if (!pilot || pilot.hp<=0 || run.duelWonAt || run.victory || mode==='result') {
    marker.hidden = true;
    return;
  }
  const {x,y,visible} = scene.screenProjection(pilot.x,pilot.y+.1,-35);
  marker.hidden = !visible;
  if (visible) {
    marker.style.left = x+'px';
    marker.style.top = y+'px';
  }
}

function drawFlight(dt) {
  cockpit.hidden = !run.firstPerson;
  scene.capture(run,entities.filter(item=>item.type === 'crystal' && item.z <= captureZ && item.z > captureZ-32).sort((a,b)=>b.z-a.z).slice(0,6));
  scene.aceWarning(run.ace?.ultimateLock,run.ace?.special,run.time,run.reducedMotion);
  scene.draw(dt,run);
  drawReticle(primaryAim,run);
  drawReticle(partnerAim,run.partner);
  for (const [id,pilot] of [['pilotTag1',run],['pilotTag2',run.partner]]) {
    const label=get(id);
    label.hidden=!run.partner || !(pilot?.hp>0);
    if (!label.hidden) {
      const [x,y]=scene.screenPoint(pilot.x,pilot.y-1.15,0);
      label.style.left=x+'px';
      label.style.top=y+'px';
    }
  }
  if (run.firstPerson) instruments.draw(run,entities,scene.boss);
  enemyTracks.draw(scene,run.duel ? entities.filter(item=>item.revealedUntil>run.time || item.ultimateLock) : entities,run.time,dt);
}

function updateGuns(pilot,firing,dt) {
  pilot.fireTime-=dt;
  pilot.heat=Math.max(0,pilot.heat-dt*(pilot.overheated ? .62 : .66));
  if (pilot.overheated && pilot.heat<=.18) pilot.overheated=false;
  if (pilot.hp>0 && pilot.fireTime<=0 && !pilot.overheated && !run.victory && !run.duelWonAt &&
      !pilot.laserTicks && !pilot.ultimateAim && firing) {
    pilot.fireTime=pilot.craft.cooldown*(pilot.boosting ? .595 : 1);
    takeShot(pilot);
  }
}

function simulate(dt) {
  run.time += dt;
  run.sectorTime += dt;
  run.invuln = Math.max(0,run.invuln-dt);
  run.shake = Math.max(0,run.shake-dt*1.7);
  run.flash = Math.max(0,run.flash-dt*2.9);
  if (run.time > run.comboTime) run.chain = 0;
  updateMovement(dt);
  updateBoost(dt);
  music(dt);
  if (run.training) {
    if (run.sectorTime >= run.spawnTime) {
      const wave = run.wave++;
      const slot = wave%4;
      const lane = [0,6,-6,0][slot];
      if (slot === 3) {
        const profile = raiders.scout;
        Object.assign(entity('raider',0,0,-94,profile.scale,'scout'),{
          age:0,hp:profile.health,maxHp:profile.health,profile,variant:'scout',home:0,side:1,nextShot:2,nextMine:Infinity
        });
      } else {
        for (const offset of [-2.8,0,2.8]) {
          const target = entity('cache',lane+offset,slot-1,-51-Math.abs(offset)*4,1.2);
          target.hp = 10;
        }
      }
      run.spawnTime += 5;
    }
  } else if (!run.activity && !run.bossActive) {
    if (run.sectorTime >= waveLength[run.sector]) {
      closeContractSector();
      if (run.sector < 2) {
        run.hp = Math.min(run.maxHp,run.hp+Math.max(8,14-run.difficulty*.52));
        run.charge = Math.min(100,run.charge+18);
        run.score += 500;
        enterSector(run.sector+1);
      } else summonBoss();
    } else if (run.sectorTime >= run.spawnTime) {
      spawnWave();
      run.spawnTime += Math.max(.70,[1.65,1.40,1.20][run.sector]-run.difficulty*.048) + random(-.10,.12);
    }
  }
  if (!run.activity) {
    startContract();
    deployRelay();
    scheduleRaid();
    scheduleAce();
  }
  updateGuns(run,keys.has('Space') || run.mobile && !run.partner,dt);
  if (run.partner) {
    run.partner.invuln=Math.max(0,run.partner.invuln-dt);
    run.partner.boosting=run.boosting;
    updateGuns(run.partner,keys.has('Enter'),dt);
  }
  updateEntities(dt);
  updateBlasts(dt);
  updateUltimate(dt,run);
  if (run.partner) updateUltimate(dt,run.partner);
  updateShots(dt);
  if (run.bossActive) bossLogic(dt);
  tickDuel();
  run.score += dt*(run.boosting ? 39 : 18);
  if (run.duelWonAt && run.time>=run.duelWonAt) end(true);
  else if (run.hp<=0 && !(run.partner?.hp>0) && !run.duelWonAt && mode==='playing') end(false);
}

function frame(now) {
  if (mode !== 'playing') return;
  const dt = cap((now-last)/1000,0,.10);
  last = now;
  // Keep collision intervals short on slower displays without rendering extra frames.
  const steps = Math.ceil(dt*120);
  for (let step=0;step<steps && mode==='playing';step++) simulate(dt/steps);
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
  updateHUD();
  if (mode === 'playing') raf = requestAnimationFrame(frame);
}

function moveJoystick(event) {
  const box = joystick.getBoundingClientRect();
  const x = event.clientX-box.left-box.width/2;
  const y = event.clientY-box.top-box.height/2;
  const radius = box.width*.31;
  const length = Math.hypot(x,y);
  const strength = Math.pow(cap((length/radius-.095)/.905,0,1),1.38);
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
  if (mode !== 'playing' || pointer || run.partner) return;
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
  if (mode === 'playing' && (movement.has(event.code) || event.code === 'Enter' && run.partner)) {
    if (event.code === 'Space' && document.activeElement?.tagName === 'BUTTON') document.activeElement.blur();
    event.preventDefault();
    keys.add(event.code);
  }
  if (mode==='lobby' && activeTab==='fleet' && ['ArrowLeft','ArrowRight'].includes(event.code) &&
      !document.querySelector('dialog[open]') && document.activeElement?.tagName!=='SELECT') {
    event.preventDefault();
    shiftShip(event.code==='ArrowRight' ? 1 : -1);
    return;
  }
  if (event.repeat) return;
  if (mode === 'playing') {
    if (event.code === ultimateKey || event.code === 'KeyR' && run.partner) {
      event.preventDefault();
      activateUltimate(event.code === 'KeyR' ? run.partner : run);
    }
    if (event.code === 'Space' && run.hp>0 && run.ultimateAim) fireUltimate(run);
    if (event.code === 'Enter' && run.partner?.hp>0 && run.partner.ultimateAim) fireUltimate(run.partner);
  }
  if (event.code === 'Escape'  && (mode === 'playing' || mode === 'paused')) {
    event.preventDefault();
    togglePause();
  }
  if (event.code === 'Enter' && mode === 'lobby' && ['modes','operations'].includes(activeTab) && !helpDialog.open && !resultDialog.open && !get('profileDialog').open && !get('tuneDialog').open && !get('campaignChange').open && !['BUTTON','A','INPUT','SELECT','TEXTAREA'].includes(document.activeElement?.tagName)) {
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
get('selectShip').addEventListener('click',()=>{selectedShip=inspectedShip;drawHangar();});
get('shipPrev').addEventListener('click',()=>shiftShip(-1));
get('shipNext').addEventListener('click',()=>shiftShip(1));
for (const id of ['weaponFilter','ultimateFilter']) get(id).addEventListener('change',()=>drawShowroom(currentProgress()));
for (const id of ['tandemFirst','tandemSecond']) get(id).addEventListener('change',validateTandem);
window.addEventListener('hashchange',showTab);
get('restart').addEventListener('click',()=>start(run?.activity));
get('nextLevel').addEventListener('click',()=>{
  if (run.duel) {
    selectedDuel = Math.min(run.duel.index+1,currentProgress().duels,duelStages.length-1);
    start('duel');
    return;
  }
  selectedLevel = Math.min(run.level+1,levels.length-1,currentProgress().cleared);
  start();
});
get('pause').addEventListener('click',togglePause);
get('resume').addEventListener('click',togglePause);
for (const name of ['training','duel']) get(name).addEventListener('click',()=>start(name));
get('launchTandem').addEventListener('click',()=>start('tandem'));
get('routeChoice').addEventListener('change',event=>{
  if (!Object.hasOwn(routeOptions,event.target.value)) return;
  routeChoice = event.target.value;
  drawHangar();
});
get('touchUltimate').addEventListener('click',()=>run.ultimateAim ? fireUltimate(run) : activateUltimate(run));
function showSensitivity() {
  for (const slider of controlSliders) {
    slider.value = sensitivity;
    slider.parentElement.querySelector('output').textContent = sensitivity+'%';
  }
}
for (const slider of controlSliders) {
  slider.addEventListener('input',()=>{
    sensitivity = normalizeSensitivity(slider.value);
    try {writeStorage('stormcore-steering',String(sensitivity));} catch {}
    showSensitivity();
  });
}
showSensitivity();
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
showTab();
initProfile(activate=>{
  if (activate && mode === 'lobby') adoptCampaign();
  drawHangar();
});
