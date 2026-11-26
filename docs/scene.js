import * as T from './three.module.min.js';
import {captureRadius,captureHeightRatio,captureZ} from './campaign.js';
import {cabins} from './cockpit.js';
import {makeSpaceVisuals,makeRaider,raiderVariants} from './space-visuals.js';

export const random = (min, max) => min + Math.random() * (max - min);
const mesh = (geometry, material, x = 0, y = 0, z = 0) => {
  const result = new T.Mesh(geometry, material);
  result.position.set(x, y, z);
  return result;
};
const bright = color => new T.MeshBasicMaterial({color});
const alloy = color => new T.MeshStandardMaterial({color, metalness:.48, roughness:.35, flatShading:true});
const octa = new T.OctahedronGeometry(1);
const sphere = new T.IcosahedronGeometry(1, 1);
const box = new T.BoxGeometry(1, 1, 1);

function facet(points, sides, material) {
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(points.flat(), 3));
  geometry.setIndex(sides.flat());
  geometry.computeVertexNormals();
  material.side = T.DoubleSide;
  return mesh(geometry, material);
}

function glowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, '#fff');
  gradient.addColorStop(.11, '#ffffffea');
  gradient.addColorStop(.29, '#ffffff75');
  gradient.addColorStop(.58, '#ffffff2e');
  gradient.addColorStop(1, '#ffffff00');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  return new T.CanvasTexture(canvas);
}

function buildCabin(profile) {
  const group = new T.Group();
  const surfaces = [];
  const surfaceColors = [];
  const trim = [];
  const lights = [];
  const frame = new T.Color(profile.frame);
  const deck = new T.Color(profile.deck);
  const graphite = new T.Color(0x111725);
  const metal = new T.Color(0x7a879c);
  const tint = new T.Color();

  function piece(outline,color,shades,buffer = surfaces) {
    for (let i=1;i<outline.length-1;i++) {
      for (const corner of [0,i,i+1]) {
        buffer.push(...outline[corner]);
        if (buffer === surfaces) {
          tint.copy(color).multiplyScalar(shades[corner] ?? 1);
          surfaceColors.push(...tint.toArray());
        }
      }
    }
  }

  function beam(a,b,width,depth,color,buffer = surfaces) {
    const perpendicular = Math.atan2(b[1]-a[1],b[0]-a[0])+Math.PI*.5;
    const offsetX = Math.cos(perpendicular)*width*.5;
    const offsetY = Math.sin(perpendicular)*width*.5;
    const ends = [
      [a[0]+offsetX,a[1]+offsetY,a[2]],
      [b[0]+offsetX,b[1]+offsetY,b[2]],
      [b[0]-offsetX,b[1]-offsetY,b[2]],
      [a[0]-offsetX,a[1]-offsetY,a[2]]
    ];
    if (buffer !== surfaces) {
      piece(ends,color,[],buffer);
      return;
    }
    const inset = ends.map(([x,y,z],i)=>[x+(i<2?-1:1)*offsetX*.28,y+(i<2?-1:1)*offsetY*.28,z+depth]);
    piece(inset,color,[1.35,1.10,.79,.88]);
    for (let i=0;i<4;i++) {
      const next=(i+1)%4;
      const shade=[1.86,.91,.59,.66][i];
      piece([ends[i],ends[next],inset[next],inset[i]],color,[shade*.7,shade*.82,shade,shade]);
    }
  }

  function rivet(x,y,z,r) {
    const points = Array.from({length:8}, (_,i)=>{
      const angle = Math.PI*i/4;
      return [x+Math.cos(angle)*r,y+Math.sin(angle)*r*1.47,z];
    });
    piece(points,metal,[.39,.55,1.38,1.41,.93,.43,.34,.37]);
    beam([x-r*.51,y-.002,z+.001],[x+r*.51,y+.002,z+.001],r*.27,0,graphite,trim);
  }

  const {edge,crown,dash,cut,beams} = profile;
  // The curved cowling has a raised leading rim, sloped upper face and a recessed instrument deck.
  const dashHeight = dash+.13;
  const dashZ = -1.20;
  const outline = [[-1.40,dash-.12,-1.12],[-cut,dashHeight,dashZ],[-.27,dashHeight+.035,dashZ-.02],
    [.27,dashHeight+.035,dashZ-.02],[cut,dashHeight,dashZ],[1.40,dash-.12,-1.12]];
  for (let i=0;i<outline.length-1;i++) {
    const a=outline[i];
    const b=outline[i+1];
    const foot=[a[0],dash-.26,-1.04];
    const nextFoot=[b[0],dash-.26,-1.04];
    piece([foot,nextFoot,b,a],deck,[.68,.72,1.93,2.04]);
    beam(a,b,.034,.027,frame);
    if (i!==2) beam([a[0],a[1]-.013,a[2]+.033],[b[0],b[1]-.013,b[2]+.033],.004,0,frame,trim);
  }
  piece([[-1.53,-1.55,-1.03],[1.53,-1.55,-1.03],[1.47,dash-.26,-1.05],[-1.47,dash-.26,-1.05]],
    graphite,[.42,.44,.81,.87]);

  // Glass seals, braces, fasteners and stamped ribs vary with each hull.
  for (const side of [-1,1]) {
    const signed = x=>x*side;
    const inner = (x,y,z)=>[signed(x),y,z];
    const lo=inner(edge-.24,dash+.05,-1.12);
    const knee=inner(edge+.055,crown-.56,-1.12);
    const upper=inner(edge-.13,.76,-1.14);
    const hi=inner(edge-.32,1.28,-1.15);
    piece([inner(1.55,-1.43,-1.08),lo,knee,upper,hi,inner(1.49,1.30,-1.09)],deck,[.42,.92,1.66,1.81,.83,.35]);
    piece([inner(1.30,-1.08,-1.06),inner(.79,dash-.03,-1.08),knee,inner(1.32,crown-.31,-1.06)],
      frame,[.64,1.08,1.47,.69]);
    const railWidth=beams===3?.119:beams===2?.096:.078;
    beam(lo,knee,railWidth,.055,frame);
    beam(knee,upper,railWidth*.89,.064,frame);
    beam(upper,hi,railWidth*.72,.061,frame);
    beam(inner(edge-.25,dash+.095,-1.062),inner(edge+.017,crown-.526,-1.058),.007,0,frame,lights);
    beam(inner(edge+.017,crown-.526,-1.058),inner(edge-.174,.765,-1.071),.003,0,frame,trim);
    if (beams>1) beam(inner(edge+.23,dash+.04,-1.11),inner(edge+.11,crown-.44,-1.10),.029,.024,metal);
    if (beams>2) beam(inner(edge-.06,.68,-1.113),inner(.30,1.20,-1.09),.036,.027,frame);
    if (profile.id==='leviathan') beam(inner(.37,1.11,-1.12),inner(.72,dash+.21,-1.21),.026,.034,frame);
    if (profile.id==='iskra' || profile.id==='aurora') {
      beam(inner(.35,1.17,-1.15),inner(.71,.98,-1.15),.031,.022,metal);
      beam(inner(.34,1.15,-1.126),inner(.71,.96,-1.126),.004,0,frame,lights);
    }

    for (let i=0;i<3+beams;i++) {
      const fraction=i/(2+beams);
      rivet(signed(lo[0]+(knee[0]-lo[0])*fraction+signed(.035))*side,
        lo[1]+(knee[1]-lo[1])*fraction,-1.048,.009);
    }
    const deskX=cut*.77+.26;
    const boxLow=dash-.20;
    const boxTop=dash-.049;
    piece([inner(deskX-.17,boxLow,-1.01),inner(deskX+.23,boxLow,-1.01),
      inner(deskX+.16,boxTop,-1.08),inner(deskX-.21,boxTop,-1.08)],graphite,[.5,.57,1.45,1.61]);
    beam(inner(deskX-.20,boxTop,-1.071),inner(deskX+.16,boxTop,-1.071),.009,.006,metal);
    for (let i=0;i<5;i++) {
      const x=deskX-.12+i*.042;
      const y=boxLow+.065;
      beam(inner(x,y,-1.03),inner(x+.025,y+.004,-1.031),.018,.003,frame);
      if ((i+beams)%3!==0) beam(inner(x+.002,y+.007,-1.025),inner(x+.018,y+.010,-1.026),.004,0,frame,lights);
    }
  }

  const eyebrow=beams===3?.92:1.04;
  piece([[-1.24,1.27,-1.12],[1.24,1.27,-1.12],[.86,eyebrow,-1.15],[.53,eyebrow+.067,-1.16],
    [-.53,eyebrow+.067,-1.16],[-.86,eyebrow,-1.15]],deck,[.46,.46,.93,1.16,1.18,.98]);
  beam([-.76,eyebrow+.028,-1.132],[-.53,eyebrow+.070,-1.135],.026,.023,frame);
  beam([-.53,eyebrow+.070,-1.135],[.53,eyebrow+.070,-1.135],.023,.022,frame);
  beam([.53,eyebrow+.070,-1.135],[.76,eyebrow+.028,-1.132],.026,.023,frame);
  for (const side of [-1,1]) {
    rivet(side*.52,eyebrow+.074,-1.106,.009);
    beam([side*.095,eyebrow+.089,-1.105],[side*.22,eyebrow+.089,-1.105],.004,0,frame,trim);
  }

  function batch(points,material,colors) {
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position',new T.Float32BufferAttribute(points,3));
    if (colors) geometry.setAttribute('color',new T.Float32BufferAttribute(colors,3));
    const part = mesh(geometry,material);
    part.renderOrder = 18;
    group.add(part);
  }

  const shell = new T.MeshBasicMaterial({color:0xffffff,fog:false,vertexColors:true,side:T.DoubleSide});
  const seams = new T.MeshBasicMaterial({color:0xc09bff,fog:false,side:T.DoubleSide});
  const lit = seams.clone();
  batch(surfaces,shell,surfaceColors);
  batch(trim,seams);
  batch(lights,lit);
  group.visible = false;
  return {group,shell,seams,lit};
}

export function makeScene(host) {
  const renderer = new T.WebGLRenderer({antialias:true, powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.6));
  renderer.outputColorSpace = T.SRGBColorSpace;
  host.replaceChildren(renderer.domElement);
  const scene = new T.Scene();
  scene.fog = new T.FogExp2(0x231346, .0064);
  const camera = new T.PerspectiveCamera(57, 1, .12, 380);
  scene.add(camera);
  const cockpit = cabins.map(profile=>buildCabin(profile));
  for (const cabin of cockpit) camera.add(cabin.group);
  let selectedCabin = 0;
  let cockpitTint = new T.Color(0xa875ff);
  const cabinGlow = new T.Color();
  const cabinLight = new T.Color();
  const eye = {active:false,fov:68,bank:0,yaw:0,pitch:0};
  const texture = glowTexture();
  const glow = (color, size, opacity = 1) => {
    const sprite = new T.Sprite(new T.SpriteMaterial({map:texture, color, transparent:true, opacity, depthWrite:false, blending:T.AdditiveBlending, fog:false}));
    sprite.scale.set(size, size, 1);
    return sprite;
  };
  const space = makeSpaceVisuals(scene);

  const ship = new T.Group();
  const darkHull = alloy(0x343052);
  const hull = alloy(0xa4a7c8);
  const accent = bright(0xc09bff);
  const glass = new T.MeshPhysicalMaterial({color:0x7777df,metalness:.2,roughness:.17,emissive:0x36229b,emissiveIntensity:.45,clearcoat:1,flatShading:true});
  ship.add(facet([[0,.03,-2.35],[-.71,.09,1.05],[.71,.09,1.05],[0,.57,.02],[0,-.36,.7],[0,-.09,1.55]],
    [[0,1,3],[0,3,2],[0,4,1],[0,2,4],[1,5,3],[3,5,2],[1,4,5],[2,5,4]],hull));
  for (const sign of [-1,1]) {
    ship.add(facet([[sign*.43,.05,-.85],[sign*2.04,.08,1.48],[sign*1.36,.10,1.23],[sign*.46,.25,.02],[sign*.75,-.11,1.05],[sign*1.13,.02,1.55]],
      [[0,1,3],[1,2,3],[0,4,1],[1,4,5],[1,5,2],[3,2,5],[3,5,4]],darkHull));
    ship.add(facet([[sign*.48,.11,-.77],[sign*1.97,.13,1.38],[sign*1.82,.13,1.35]],
      [[0,1,2]],accent));
    const engine = mesh(new T.CylinderGeometry(.22,.27,.85,8),darkHull,sign*.56,.0,1.05);
    engine.rotation.x = Math.PI / 2;
    ship.add(engine);
    const core = mesh(new T.CircleGeometry(.205,9),bright(0xe9caff),sign*.56,0,1.5);
    ship.add(core);
  }
  ship.add(facet([[0,.49,-.05],[-.31,.25,.32],[.31,.25,.32],[0,.31,-.95],[0,.36,.65]],
    [[0,3,1],[0,2,3],[0,1,4],[0,4,2]],glass));
  const variants = [null];
  for (let index = 1; index < cabins.length; index++) {
    const equipment = new T.Group();
    for (const sign of [-1,1]) {
      if (index === 1) {
        const mount = mesh(new T.CylinderGeometry(.17,.23,1.75,7),hull,sign*1.03,.06,.52);
        mount.rotation.x = Math.PI/2;
        equipment.add(mount,mesh(octa,accent,sign*1.03,.06,1.44));
        equipment.children.at(-1).scale.set(.18,.18,.22);
      } else if (index === 2) {
        equipment.add(facet([[sign*.75,.14,-.82],[sign*2.63,.19,1.29],[sign*1.38,.48,.88],[sign*1.65,-.12,1.08]],
          [[0,1,2],[0,3,1],[0,2,3],[1,3,2]],hull));
      } else if (index === 3) {
        const rail = mesh(box,accent,sign*.28,.3,-.95);
        rail.scale.set(.12,.12,1.78);
        equipment.add(rail);
      } else if (index === 4) {
        const pod = mesh(sphere,hull,sign*1.43,.12,.53);
        pod.scale.set(.40,.29,1.10);
        const lamp = mesh(octa,accent,sign*1.43,.12,1.58);
        lamp.scale.set(.14,.14,.40);
        equipment.add(pod,lamp);
      } else {
        const width = [1.25,1.52,.68,1.87,1.92][index-5];
        const reach = [1.05,.42,1.84,1.17,-.20][index-5];
        const height = [.47,.28,.68,.38,.20][index-5];
        equipment.add(facet([[sign*.40,.08,-1.45],[sign*width,height,reach],
          [sign*(width+.48),.02,2.08],[sign*.62,-.20,1.08]],
          [[0,1,2],[0,2,3],[0,3,1],[1,3,2]],hull));
        const runner = mesh(box,accent,sign*width,height+.02,reach+.08);
        runner.scale.set(.11,.09,[1.08,.66,1.41,.52,1.63][index-5]);
        equipment.add(runner);
      }
    }
    equipment.visible = false;
    ship.add(equipment);
    variants.push(equipment);
  }
  const exhausts = [-.56,.56].map(x => {
    const sprite = glow(0x964bff,3.1,.83);
    sprite.position.set(x,0,1.6);
    ship.add(sprite);
    const trailMaterial = new T.MeshBasicMaterial({color:0xbb8aff,transparent:true,opacity:.7,blending:T.AdditiveBlending,depthWrite:false});
    const trail = mesh(new T.ConeGeometry(.16,3.0,8),trailMaterial,x,0,2.96);
    trail.rotation.x = Math.PI / 2;
    ship.add(trail);
    return {sprite,trail};
  });
  const shield = mesh(new T.IcosahedronGeometry(2.17,1),new T.MeshBasicMaterial({
    color:0xa7e1ff,wireframe:true,transparent:true,opacity:.32,blending:T.AdditiveBlending,depthWrite:false
  }));
  shield.scale.set(1,.7,1.31);
  shield.visible = false;
  ship.add(shield);
  scene.add(ship);

  const objGeo = {
    mine:new T.IcosahedronGeometry(1.38,0), crystal:octa,
    rock:new T.DodecahedronGeometry(1.34,0), heal:new T.BoxGeometry(1,1,1),
    relay:new T.TorusGeometry(2.10,.105,8,48), bolt:new T.CapsuleGeometry(.19,.72,2,6), shot:new T.BoxGeometry(.105,.105,2.05)
  };
  const colors = {relay:0x6ee1ff,mine:0xff527a,crystal:0x61f9ff,heal:0xa1ff8b,bolt:0xff528b,shot:0xe1fcff};
  const crystalMat = new T.MeshStandardMaterial({color:0x85fff9,emissive:0x249b99,emissiveIntensity:1.6,roughness:.21,metalness:.15,flatShading:true});
  const healMat = new T.MeshStandardMaterial({color:0xa2ff8e,emissive:0x4dad4a,emissiveIntensity:1.55,flatShading:true});
  const rockMat = alloy(0x594975);
  const mineMat = alloy(0x723754);
  const outline = new Map();
  const objectMaterials = {relay:bright(0x8cefff),crystal:crystalMat,heal:healMat,rock:rockMat,mine:mineMat,bolt:bright(colors.bolt),shot:bright(colors.shot)};
  const boltGeo = new T.RingGeometry(.8,1,22);
  const dangerMat = new T.MeshBasicMaterial({color:colors.bolt,side:T.DoubleSide,transparent:true,opacity:.72,depthWrite:false});
  const instances = Object.fromEntries([...Object.keys(objGeo),...raiderVariants].map(type => [type,[]]));

  function edge(geo,color) {
    const key = geo.uuid + '/' + color;
    if (!outline.has(key)) outline.set(key,[new T.EdgesGeometry(geo,17),new T.LineBasicMaterial({color,transparent:true,opacity:.79})]);
    return new T.LineSegments(...outline.get(key));
  }
  function object(type,variant = 'trapper') {
    const key = type === 'raider' ? (raiderVariants.includes(variant) ? variant : 'trapper') : type;
    const pool = instances[key];
    let group = pool.find(candidate => !candidate.visible);
    if (group) {
      group.visible = true;
      return group;
    }
    if (type === 'raider') {
      group = makeRaider(key,glow);
      scene.add(group);
      pool.push(group);
      return group;
    }
    group = new T.Group();
    const shape = mesh(objGeo[type],objectMaterials[type]);
    if (type === 'crystal') {
      shape.scale.set(.69,1.08,.69);
      const mantle = edge(octa,0xc1fffb);
      mantle.scale.set(.71,1.11,.71);
      group.add(mantle);
    }
    if (type === 'mine') {
      group.add(edge(objGeo.mine,0xff8197));
      const emitter = mesh(sphere,bright(0xff537e));
      emitter.scale.setScalar(.69);
      group.add(emitter);
    }
    if (type === 'bolt') {
      const alarm = mesh(boltGeo,dangerMat);
      alarm.scale.setScalar(1.35);
      group.add(alarm);
    }
    if (type === 'heal') {
      group.add(edge(objGeo.heal,0xafffad));
      const arm = mesh(box,bright(0xd4ffcb),0,0,.53);
      arm.scale.set(.66,.19,.065);
      const stem = mesh(box,arm.material,0,0,.53);
      stem.scale.set(.19,.66,.065);
      group.add(arm,stem);
    }
    if (type === 'relay') {
      const outer = mesh(new T.TorusGeometry(2.39,.026,5,36),bright(0x5aa4ef));
      outer.position.z = .22;
      group.add(outer);
      for (let n=0;n<4;n++) {
        const angle = Math.PI*n/2;
        const notch = mesh(box,bright(0xc7f9ff),Math.cos(angle)*2.35,Math.sin(angle)*2.35,.15);
        notch.scale.set(.39,.13,.21);
        notch.rotation.z = angle;
        group.add(notch);
      }
    }
    if (type === 'rock') group.add(edge(objGeo.rock,0x9c76be));
    group.add(shape);
    if (colors[type] && type !== 'shot') group.add(glow(colors[type],4.6,.56));
    scene.add(group);
    pool.push(group);
    return group;
  }

  const receiverMaterial = new T.MeshBasicMaterial({
    color:0x7df6ff,transparent:true,opacity:.64,side:T.DoubleSide,depthWrite:false,depthTest:false
  });
  const receiver = mesh(new T.RingGeometry(.965,1,42),receiverMaterial);
  receiver.visible = false;
  receiver.renderOrder = 10;
  scene.add(receiver);
  const guides = Array.from({length:6},()=>{
    const markerMaterial = receiverMaterial.clone();
    const marker = mesh(new T.RingGeometry(.31,.42,20),markerMaterial);
    marker.renderOrder = 11;
    const position = new T.BufferAttribute(new Float32Array(6),3).setUsage(T.DynamicDrawUsage);
    const geometry = new T.BufferGeometry().setAttribute('position',position);
    const line = new T.Line(geometry,new T.LineBasicMaterial({color:0x86d9ff,transparent:true,opacity:.35,depthWrite:false}));
    line.frustumCulled = false;
    scene.add(marker,line);
    return {marker,line,position};
  });

  function capture(run,items) {
    receiver.visible = items.length > 0;
    if (run && items.length) {
      const radius = captureRadius(items[0].scale);
      receiver.position.set(run.x,run.y,captureZ);
      receiver.scale.set(radius,radius/captureHeightRatio,1);
    }
    let aligned = false;
    guides.forEach(({marker,line,position},i)=>{
      const item = items[i];
      marker.visible = line.visible = Boolean(item);
      if (!item) return;
      const radius = captureRadius(item.scale);
      const matched = Math.hypot(item.x-run.x,(item.y-run.y)*captureHeightRatio) <= radius;
      aligned ||= matched;
      marker.position.set(item.x,item.y,captureZ);
      marker.material.color.setHex(matched ? 0x9dffe2 : 0x73a6cf);
      const closeness = 1-Math.min(1,(captureZ-item.z)/32);
      marker.material.opacity = matched ? .95 : .34+closeness*.39;
      marker.scale.setScalar(.72+closeness*.32);
      position.setXYZ(0,item.x,item.y,item.z);
      position.setXYZ(1,item.x,item.y,captureZ);
      position.needsUpdate = true;
    });
    receiverMaterial.color.setHex(aligned ? 0x9bffe2 : 0xabc7ff);
  }

  function setShip(craft,index) {
    selectedCabin = index;
    eye.active = false;
    cockpit.forEach(({group})=>{group.visible = false;});
    cockpit[index].seams.color.setHex(craft.color).multiplyScalar(.49);
    cockpit[index].lit.color.setHex(craft.color);
    hull.color.setHex(craft.hull);
    accent.color.setHex(craft.color);
    objectMaterials.shot.color.setHex(index === 0 ? 0xe1fcff : craft.color);
    variants.forEach((group,i)=>{if (group) group.visible = index === i;});
    for (const {sprite,trail} of exhausts) {
      sprite.material.color.setHex(craft.color);
      trail.material.color.setHex(craft.color);
    }
  }

  const boss = new T.Group();
  const armor = new T.Group();
  const armorMat = alloy(0x5a4374);
  const cageMat = bright(0xfd83d5);
  const reactorMat = new T.MeshBasicMaterial({color:0xf0b7ff});
  const reactor = mesh(new T.IcosahedronGeometry(2.35,1),reactorMat);
  const reactorWire = edge(new T.IcosahedronGeometry(2.53,1),0xffebff);
  const bossShield = mesh(new T.IcosahedronGeometry(3.15,1),new T.MeshBasicMaterial({
    color:0x81b9ff,wireframe:true,transparent:true,opacity:.64,blending:T.AdditiveBlending,depthWrite:false
  }));
  bossShield.visible = false;
  boss.add(reactor,reactorWire,bossShield,glow(0xfa61f5,19,.85));
  const bossRing = mesh(new T.TorusGeometry(5.65,.18,8,32),cageMat);
  armor.add(bossRing);
  const plateGeo = new T.CylinderGeometry(1.48,1.78,2.3,3);
  for (let i = 0; i < 6; i++) {
    const angle = Math.PI * i / 3;
    const px = Math.cos(angle) * 5.7;
    const py = Math.sin(angle) * 5.7;
    const plate = mesh(plateGeo,armorMat,px,py,0);
    plate.rotation.z = angle - Math.PI / 2;
    plate.add(edge(plateGeo,0xb087c7));
    const ringLamp = mesh(octa,cageMat,px,py,1.01);
    ringLamp.scale.setScalar(.42);
    armor.add(plate,ringLamp);
  }
  boss.add(armor);
  scene.add(boss);
  boss.visible = false;

  const particleMax = 400;
  const particleData = new Float32Array(particleMax * 3);
  const particleColors = new Float32Array(particleMax * 3);
  const particleGeo = new T.BufferGeometry();
  particleGeo.setAttribute('position',new T.BufferAttribute(particleData,3).setUsage(T.DynamicDrawUsage));
  particleGeo.setAttribute('color',new T.BufferAttribute(particleColors,3).setUsage(T.DynamicDrawUsage));
  particleGeo.setDrawRange(0,0);
  const sparks = new T.Points(particleGeo,new T.PointsMaterial({
    map:texture,size:.64,transparent:true,depthWrite:false,blending:T.AdditiveBlending,vertexColors:true
  }));
  sparks.frustumCulled = false;
  scene.add(sparks);
  const particles = [];
  const coord = new T.Vector3();
  const viewPoint = new T.Vector3();
  const shade = new T.Color();

  function burst(x,y,z,color,count = 24, power = 1) {
    for (let i = 0; i < count && particles.length < particleMax; i++) {
      const life = random(.22,.78) * Math.sqrt(power);
      particles.push({x,y,z,vx:random(-8,8)*power,vy:random(-8,8)*power,vz:random(-6,12)*power,life,initial:life,color});
    }
  }

  function setSector(index,tint) {
    cockpitTint.setHex(tint ?? 0xa875ff);
    space.setSector(index,tint);
  }

  function resize() {
    const w = host.clientWidth || innerWidth;
    const h = host.clientHeight || innerHeight;
    camera.aspect = w / Math.max(1,h);
    camera.updateProjectionMatrix();
    renderer.setSize(w,h,false);
  }

  function draw(dt,state) {
    const {x,y,dx,dy,time,speed,boosting,invuln,shake,mobile} = state;
    ship.position.set(x,y,0);
    ship.rotation.set(-dy*.024,dx*.018,-dx*.065);
    ship.visible = !state.firstPerson && (invuln <= 0 || boosting || Math.floor(time*18)%2 === 0);
    shield.visible = boosting;
    shield.rotation.y = time*.85;
    for (const {sprite,trail} of exhausts) {
      const thrust = (boosting ? 1.8 : .85) + Math.sin(time*62)*.12;
      sprite.scale.setScalar(thrust*3);
      trail.scale.y = thrust;
    }
    const first = Boolean(state.firstPerson);
    const cabin = cockpit[selectedCabin];
    cabin.group.visible = first;
    const comfort = Boolean(state.reducedMotion);
    const response = eye.active ? 1-Math.exp(-dt*9) : 1;
    const fovBase = cabins[selectedCabin].fov;
    eye.fov += ((fovBase+(boosting&&!comfort?5:0))-eye.fov)*response;
    const base = first ? eye.fov : 59;
    const nextFov = T.MathUtils.clamp(2 * Math.atan(Math.tan(base * Math.PI / 360) /
      Math.min(1,camera.aspect / 1.22)) * 180 / Math.PI,base,113);
    if (camera.fov !== nextFov) {
      camera.fov = nextFov;
      camera.updateProjectionMatrix();
    }
    if (first) {
      const normalizedX = Math.max(-1,Math.min(1,dx/22));
      const normalizedY = Math.max(-1,Math.min(1,dy/19));
      eye.bank += ((comfort ? 0 : -.088*normalizedX)-eye.bank)*response;
      eye.yaw += ((comfort ? 0 : .077*normalizedX)-eye.yaw)*response;
      eye.pitch += ((comfort ? 0 : .061*normalizedY)-eye.pitch)*response;
      eye.active = true;
      const tremor = comfort ? 0 : shake*.18+(boosting?.012:0);
      camera.up.set(Math.sin(eye.bank),Math.cos(eye.bank),0);
      camera.position.set(x+Math.sin(time*69)*tremor,y+.46+Math.sin(time*91)*tremor*.63,.82);
      camera.lookAt(x+eye.yaw*22,y+.46+eye.pitch*22,-23);

      const aperture = Math.tan(camera.fov*Math.PI/360);
      cabin.group.scale.set(aperture*camera.aspect,aperture,1);
      cabinLight.copy(cockpitTint).multiplyScalar(.19).addScalar(.78);
      if (boosting) cabinLight.addScalar(.21);
      if (state.flash > 0) cabinLight.lerp(cabinGlow.setHex(0xff6a79).multiplyScalar(2),state.flash*.55);
      cabin.shell.color.copy(cabinLight);
    } else {
      eye.active = false;
      const kick = shake * (comfort ? .1 : 1);
      camera.up.set(0,1,0);
      camera.position.set(x*.78+random(-kick,kick),3.45+y*.47+random(-kick,kick),mobile ? 20.0 : 16.6);
      camera.lookAt(x*.60,y*.28,-24);
    }
    space.draw(dt,state,camera);
    armor.rotation.z = time*.56;
    armor.rotation.y = Math.sin(time)*.14;
    reactor.rotation.set(time*.78,time*1.23,0);
    reactorWire.rotation.copy(reactor.rotation);
    bossShield.rotation.set(time*.24,time*.39,time*.29);
    for (let i = particles.length-1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        particles.splice(i,1);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += (p.vz + speed * .23) * dt;
    }
    particles.forEach((p,i) => {
      particleData.set([p.x,p.y,p.z],i*3);
      shade.setHex(p.color).multiplyScalar(Math.min(1,p.life / p.initial * 1.7)).toArray(particleColors,i*3);
    });
    particleGeo.setDrawRange(0,particles.length);
    particleGeo.attributes.position.needsUpdate = true;
    particleGeo.attributes.color.needsUpdate = true;
    renderer.render(scene,camera);
  }

  function screenProjection(x,y,z) {
    viewPoint.set(x,y,z).applyMatrix4(camera.matrixWorldInverse);
    coord.set(x,y,z).project(camera);
    return {
      x:(coord.x*.5+.5)*host.clientWidth,
      y:(-.5*coord.y+.5)*host.clientHeight,
      depth:-viewPoint.z,
      visible:viewPoint.z < -camera.near && coord.z <= 1 && Math.abs(coord.x) <= 1 && Math.abs(coord.y) <= 1
    };
  }

  function screenPoint(x,y,z) {
    const projection = screenProjection(x,y,z);
    return [projection.x,projection.y];
  }

  return {draw,resize,object,boss,reactor,burst,setSector,setShip,capture,screenPoint,screenProjection,setBossShield:visible=>{bossShield.visible=visible;},clearParticles:()=>{particles.length=0;}};
}
