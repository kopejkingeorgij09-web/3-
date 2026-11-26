export const raiders = {
  scout: {name:'Стрела',color:'#78e7ff',health:9,scale:.88,sway:5.2,turn:1.84,interval:1.82,spread:0,reward:110},
  trapper: {name:'Минёр',color:'#ffae65',health:15,scale:1.04,sway:2.9,turn:1.27,interval:2.20,spread:0, mines:1,reward:165},
  gunner: {name:'Копьё',color:'#ff759d',health:19,scale:1.12,sway:2.32,turn:1.01,interval:2.22,spread:1,reward:190},
  bulwark: {name:'Бастион',color:'#cfb5ff',health:31,scale:1.33,sway:1.32,turn:.77,interval:2.48,spread:1,mines:2,reward:270}
};

const early = ['scout','trapper','gunner'];
const late = ['scout','trapper','gunner','bulwark'];
const sectorOrders = ['scout','trapper','gunner'];

export function raidPlan(level,sector) {
  if (level < 2 || level < 4 && sector === 0) return [];
  if (level < 4) return [{time:9.4,types:[sectorOrders[sector-1]]}];
  const types = level < 8 ? early : late;
  const offset = (sector+level-4)%types.length;
  const pick = index => types[(offset+index)%types.length];
  const result = [
    {time:6.0,types:[pick(0)]},
    {time:14.5,types:level >= 9 && sector !== 0 ? [pick(1),'scout'] : [pick(1)]}
  ];
  if (level >= 15 && sector !== 0) result.push({time:19.2,types:[pick(2)]});
  return result;
}

export function enemyHud(layer) {
  const markers = [];
  function create() {
    const view = document.createElement('div');
    view.className = 'enemy-track';
    const head = document.createElement('div');
    const name = document.createElement('strong');
    const value = document.createElement('span');
    head.append(name,value);
    const meter = document.createElement('div');
    meter.className = 'enemy-meter';
    const loss = document.createElement('i');
    const fill = document.createElement('i');
    meter.append(loss,fill);
    view.append(head,meter);
    layer.append(view);
    return {view,name,value,fill,loss,target:null};
  }
  function draw(scene,entities,time,dt) {
    let count = 0;
    for (const target of entities) {
      if (target.type !== 'raider' || target.hp <= 0) continue;
      const screen = scene.screenProjection(target.x,target.y+target.scale*1.15,target.z);
      if (!screen.visible || screen.depth < 10 || screen.depth > 112) continue;
      const marker = markers[count] ?? (markers[count] = create());
      count++;
      const ratio = Math.max(0,target.hp/target.maxHp);
      if (marker.target !== target) {
        marker.target = target;
        marker.delayed = target.hitUntil > time ? 1 : ratio;
        marker.view.style.setProperty('--enemy-color',target.profile.color);
      }
      if (target.hitUntil <= time) marker.delayed += (ratio-marker.delayed)*(1-Math.exp(-dt*7));
      const charge = target.warningUntil > target.age;
      marker.view.hidden = false;
      marker.view.classList.toggle('is-hit',target.hitUntil > time);
      marker.view.classList.toggle('is-charging',charge);
      marker.view.style.transform = 'translate3d('+screen.x+'px,'+screen.y+'px,0) translate(-50%,-100%)';
      marker.name.textContent = target.profile.name+(charge ? ' · ЗАЛП' : '');
      marker.value.textContent = Math.ceil(target.hp)+'/'+Math.ceil(target.maxHp);
      marker.fill.style.transform = 'scaleX('+ratio+')';
      marker.loss.style.transform = 'scaleX('+marker.delayed+')';
    }
    for (let n=count;n<markers.length;n++) {
      markers[n].view.hidden = true;
      markers[n].target = null;
    }
  }
  return {draw,clear(){for(const marker of markers){marker.view.hidden=true;marker.target=null;}}};
}
