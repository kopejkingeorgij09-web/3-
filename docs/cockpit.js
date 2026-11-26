import {rangeX,rangeY} from './campaign.js';

// Canopy dimensions are in normalized viewport coordinates.
export const cabins = [
  {id:'strizh', fov:68, frame:0x232136, deck:0x100e1d, edge:.79, crown:.42, dash:-.73, cut:.61, beams:1},
  {id:'sapsan', fov:72, frame:0x163a50, deck:0x0c1c29, edge:.83, crown:.57, dash:-.79, cut:.72, beams:2},
  {id:'mantikora', fov:66, frame:0x4d302e, deck:0x26151b, edge:.69, crown:.37, dash:-.66, cut:.51, beams:1},
  {id:'phantom', fov:67, frame:0x303f2d, deck:0x171f18, edge:.75, crown:.76, dash:-.70, cut:.64, beams:2},
  {id:'zenit', fov:75, frame:0x4e2654, deck:0x221329, edge:.94, crown:.66, dash:-.82, cut:.86, beams:1},
  {id:'atlas', fov:65, frame:0x544331, deck:0x2b2217, edge:.70, crown:.54, dash:-.64, cut:.57, beams:3},
  {id:'sever', fov:74, frame:0x3c5970, deck:0x142739, edge:.86, crown:.77, dash:-.77, cut:.74, beams:2},
  {id:'iskra', fov:71, frame:0x4e2830, deck:0x26121b, edge:.88, crown:.31, dash:-.75, cut:.48, beams:1},
  {id:'leviathan', fov:66, frame:0x3b335b, deck:0x1b1731, edge:.76, crown:.73, dash:-.67, cut:.71, beams:3},
  {id:'aurora', fov:73, frame:0x235950, deck:0x122921, edge:.91, crown:.49, dash:-.80, cut:.81, beams:2},
  {id:'titan', fov:64, frame:0x51402d, deck:0x211713, edge:.66, crown:.63, dash:-.60, cut:.52, beams:3},
  {id:'sirin', fov:77, frame:0x254a55, deck:0x112631, edge:.94, crown:.36, dash:-.86, cut:.85, beams:1},
  {id:'iney', fov:69, frame:0x526d7a, deck:0x1c303e, edge:.82, crown:.72, dash:-.74, cut:.65, beams:3},
  {id:'zolnik', fov:65, frame:0x654336, deck:0x301e16, edge:.74, crown:.45, dash:-.63, cut:.55, beams:3},
  {id:'burevestnik', fov:74, frame:0x393650, deck:0x1b1c37, edge:.89, crown:.59, dash:-.81, cut:.74, beams:2},
  {id:'obsidian', fov:67, frame:0x322c43, deck:0x121220, edge:.71, crown:.79, dash:-.72, cut:.67, beams:2},
  {id:'nimb', fov:78, frame:0x65523a, deck:0x302819, edge:.87, crown:.51, dash:-.79, cut:.83, beams:2},
  {id:'kometa', fov:80, frame:0x5a3245, deck:0x2b1625, edge:.95, crown:.31, dash:-.87, cut:.89, beams:1}
];

export function cockpitHUD(root) {
  const canvas = root.querySelector('canvas');
  const scope = canvas.getContext('2d');
  const meter = root.querySelector('[data-thrust]');
  const roll = root.querySelector('[data-roll]');
  const vector = root.querySelector('[data-vector]');
  const mark = root.querySelector('[data-marker]');
  const callSign = root.querySelector('[data-callsign]');
  const speedReadout = root.querySelector('[data-speed-readout]');
  const hull = root.querySelector('[data-hull-meter]');
  const pitch = root.querySelector('[data-pitch]');
  let lastSweep = -1;
  let color = '#bd9bff';

  function configure(craft,index) {
    const cabin = cabins[index];
    color = '#'+craft.color.toString(16).padStart(6,'0');
    root.dataset.cabin = cabin.id;
    root.style.setProperty('--canopy-light',color);
    callSign.textContent = craft.name;
    lastSweep = -1;
  }

  function draw(state,traffic,boss) {
    const bank = state.reducedMotion ? 0 : Math.max(-8,Math.min(8,state.dx*-.27));
    roll.style.transform = 'rotate('+bank+'deg) translateY('+Math.max(-6,Math.min(6,state.dy*.20))+'px)';
    meter.style.transform = 'scaleX('+state.charge/100+')';
    const direction = state.x < 0 ? 'Л' : 'П';
    vector.textContent = direction+Math.round(Math.abs(state.x)/rangeX*99).toString().padStart(2,'0');
    speedReadout.textContent = String(Math.round(state.speed*41)).padStart(4,'0');
    hull.style.transform = 'scaleX('+state.hp/100+')';
    pitch.textContent = (state.dy >= 0 ? '+' : '−')+String(Math.round(Math.abs(state.dy)*.38)).padStart(2,'0')+'°';
    root.classList.toggle('on-boost',state.boosting);
    root.classList.toggle('hull-low',state.hp<34);
    mark.textContent = boss?.visible ? 'СТРАЖ' : traffic.some(item=>item.type === 'raider') ? 'ПЕРЕХВАТ' :
      Math.abs(state.x) > rangeX*.88 || Math.abs(state.y) > rangeY*.89 ? 'КРАЙ КОРИДОРА' : 'КУРС';
    if (!scope || Math.floor(state.time*22) === lastSweep) return;
    lastSweep = Math.floor(state.time*22);
    const center = 70;
    scope.clearRect(0,0,140,92);
    scope.strokeStyle = color+'36';
    scope.lineWidth = 1;
    for (const radius of [13,26,39]) {
      scope.beginPath();
      scope.arc(center,80,radius*1.45,Math.PI,Math.PI*2);
      scope.stroke();
    }
    for (const angle of [-.62,0,.62]) {
      scope.beginPath();
      scope.moveTo(center,80);
      scope.lineTo(center+Math.sin(angle)*57,80-Math.cos(angle)*57);
      scope.stroke();
    }
    const sweep = state.reducedMotion ? 0 : Math.sin(state.time*2)*1.23;
    scope.strokeStyle = color+'80';
    scope.beginPath();
    scope.moveTo(center,80);
    scope.lineTo(center+Math.sin(sweep)*54,80-Math.cos(sweep)*54);
    scope.stroke();
    for (const item of traffic) {
      if (item.z > -2 || item.z < -113) continue;
      const px = center + (item.x-state.x)*1.7;
      const py = 76 + item.z*.54;
      if (px < 7 || px > 133) continue;
      scope.fillStyle = item.type === 'relay' ? '#b0eaff' : item.type === 'crystal' ? '#7bffe3' : item.type === 'raider' ? '#ff924f' : '#d98291';
      const size = item.type === 'raider' || item.type === 'relay' ? 4 : 2;
      scope.fillRect(px-size/2,py-size/2,size,size);
    }
    if (boss?.visible) {
      scope.fillStyle = '#ff84d4';
      scope.fillRect(center+(boss.position.x-state.x)*1.7-3,74+boss.position.z*.54,6,4);
    }
    scope.fillStyle = color;
    scope.beginPath();
    scope.moveTo(70,76);
    scope.lineTo(66,84);
    scope.lineTo(74,84);
    scope.fill();
  }

  return {configure,draw};
}
