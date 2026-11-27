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
const shockGeo = new T.RingGeometry(.93,1,38);

// Wings, stabilizers and mission modules sit on the shared hull and its two engine mounts.
const loadouts = {
  5:{span:1.25,lead:1.05,height:.47,tail:2.08,rail:1.08},
  6:{span:1.52,lead:.42,height:.28,tail:2.08,rail:.66},
  7:{span:.68,lead:1.84,height:.68,tail:2.08,rail:1.41},
  8:{span:1.87,lead:1.17,height:.38,tail:2.08,rail:.52},
  9:{span:1.92,lead:-.20,height:.20,tail:2.08,rail:1.63},
  10:{span:2.12,lead:-.42,height:.59,tail:1.58,rail:1.42,assembly:'armor'},
  11:{span:.98,lead:-.51,height:.31,tail:2.25,rail:1.78,assembly:'fin'},
  12:{span:1.57,lead:-1.12,height:.40,tail:1.70,rail:.72,assembly:'pod'},
  13:{span:1.26,lead:-.94,height:.54,tail:1.75,rail:1.28,assembly:'armor'},
  14:{span:2.54,lead:.36,height:.25,tail:1.97,rail:1.14,assembly:'fin'},
  15:{span:1.13,lead:-1.75,height:.64,tail:2.08,rail:2.36,assembly:'fin'},
  16:{span:2.33,lead:-.04,height:.32,tail:1.62,rail:1.25,assembly:'pod'},
  17:{span:1.43,lead:-.88,height:.23,tail:2.54,rail:1.89,assembly:'fin'}
};

function fitLoadout(equipment,index,sign,hull,darkHull,accent) {
  const shape = loadouts[index] ?? loadouts[6];
  const {span,lead,height,tail,rail,assembly} = shape;
  equipment.add(facet([
    [sign*.40,.08,-1.45],[sign*span,height,lead],
    [sign*(span+(assembly==='armor' ? .22 : .48)),.02,tail],[sign*.62,-.20,1.08]
  ],[[0,1,2],[0,2,3],[0,3,1],[1,3,2]],hull));
  const strip = mesh(box,accent,sign*span,height+.02,lead+.08);
  strip.scale.set(assembly==='armor' ? .14 : .10,.07,rail);
  strip.rotation.y = sign*(index===14 ? -.49 : -.13);
  equipment.add(strip);
  if (assembly==='armor') {
    const slab = mesh(box,darkHull,sign*(span*.79),height*.49,lead+.47);
    slab.scale.set(index===10 ? .94 : .62,.36,index===10 ? 1.97 : 1.56);
    slab.rotation.y = sign*-.21;
    equipment.add(slab);
  } else if (assembly==='fin') {
    equipment.add(facet([
      [sign*span,height*.77,tail*.31],[sign*(span-.23),height+.54,tail*.77],
      [sign*(span-.08),height*.65,tail],[sign*(span+.13),height*.50,tail*.76]
    ],[[0,1,2],[0,2,3],[0,3,1],[1,3,2]],darkHull));
  } else if (assembly==='pod') {
    const pod = mesh(sphere,darkHull,sign*span,height*.25,lead+.80);
    pod.scale.set(.37,.28,index===12 ? .96 : .72);
    equipment.add(pod);
  }
}

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
  const glints = [];
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
    for (let vent=0;vent<5;vent++) {
      const x = deskX-.13+vent*.055;
      beam(inner(x,boxTop-.038,-1.045),inner(x-.014,boxTop-.076,-1.039),.008,0,graphite,trim);
    }
    const railTrace = inner(edge-.119,.772,-1.095);
    piece([railTrace,inner(edge-.28,1.05,-1.102),inner(edge-.47,.98,-1.105),
      inner(edge-.196,.734,-1.097)],frame,[],glints);
    if (beams>1) piece([
      inner(edge-.245,dash+.19,-1.108),inner(edge+.013,crown-.528,-1.103),
      inner(edge-.078,crown-.573,-1.110)
    ],frame,[],glints);
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
  const glass = new T.MeshBasicMaterial({
    color:0xc5e4ff,side:T.DoubleSide,fog:false,transparent:true,depthWrite:false,
    opacity:.09,blending:T.AdditiveBlending
  });
  batch(surfaces,shell,surfaceColors);
  batch(trim,seams);
  batch(lights,lit);
  batch(glints,glass);
  group.visible = false;
  return {group,shell,seams,lit,glass};
}

export function makeScene(host) {
  const renderer = new T.WebGLRenderer({antialias:true, powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.6));
  renderer.outputColorSpace = T.SRGBColorSpace;
  host.replaceChildren(renderer.domElement);
  const scene = new T.Scene();
  scene.fog = new T.FogExp2(0x231346, .0044);
  const camera = new T.PerspectiveCamera(57, 1, .12, 620);
  scene.add(camera);
  const cockpit = new Map();
  const cabinFor = index=>{
    if (!cockpit.has(index)) {
      const cabin = buildCabin(cabins[index]);
      cockpit.set(index,cabin);
      camera.add(cabin.group);
    }
    return cockpit.get(index);
  };
  let selectedCabin = 0;
  let cockpitTint = new T.Color(0xa875ff);
  const cabinGlow = new T.Color();
  const cabinLight = new T.Color();
  const eye = {active:false,fov:68,bank:0,yaw:0,pitch:0};
  const texture = glowTexture();
  const traceGeometry = new T.CylinderGeometry(1,1,1,6);
  const traceStyles = {scatter:[.065,.14],sniper:[.10,.29],laser:[.23,.16],cannon:[.31,.26]};
  const traces = [];
  const traceStart = new T.Vector3(), traceEnd = new T.Vector3(), traceDelta = new T.Vector3();
  const traceAxis = new T.Vector3(0,1,0);

  function ultimateTrace(start,end,color,kind) {
    const [width,duration] = traceStyles[kind];
    let trace = traces.find(candidate=>!candidate.mesh.visible);
    if (!trace) {
      const material = new T.MeshBasicMaterial({transparent:true,depthWrite:false,blending:T.AdditiveBlending});
      trace = {mesh:new T.Mesh(traceGeometry,material)};
      traces.push(trace);
      scene.add(trace.mesh);
    }
    traceStart.set(start.x,start.y,start.z);
    traceEnd.set(end.x,end.y,end.z);
    traceDelta.subVectors(traceEnd,traceStart);
    const length = traceDelta.length();
    if (length < .001) return;
    const {mesh} = trace;
    mesh.position.lerpVectors(traceStart,traceEnd,.5);
    mesh.quaternion.setFromUnitVectors(traceAxis,traceDelta.multiplyScalar(1/length));
    mesh.scale.set(width,length,width);
    mesh.material.color.setHex(color).multiplyScalar(1.45);
    mesh.material.opacity = .94;
    mesh.visible = true;
    trace.life = trace.duration = duration;
  }
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
      } else fitLoadout(equipment,index,sign,hull,darkHull,accent);
    }
    equipment.visible = false;
    ship.add(equipment);
    variants.push(equipment);
  }
  const plasmaGeo = new T.ConeGeometry(.083,1.36,8);
  const plasmaMaterial = new T.MeshBasicMaterial({
    color:0xe0f7ff,transparent:true,opacity:.79,depthWrite:false,blending:T.AdditiveBlending
  });
  const exhausts = [-.56,.56].map(x => {
    const sprite = glow(0x964bff,3.1,.83);
    sprite.position.set(x,0,1.6);
    ship.add(sprite);
    const trailMaterial = new T.MeshBasicMaterial({color:0xbb8aff,transparent:true,opacity:.7,blending:T.AdditiveBlending,depthWrite:false});
    const trail = mesh(new T.ConeGeometry(.16,3.0,8),trailMaterial,x,0,2.96);
    trail.rotation.x = Math.PI / 2;
    const plasma = mesh(plasmaGeo,plasmaMaterial,x,0,2.17);
    plasma.rotation.x = Math.PI/2;
    ship.add(trail,plasma);
    return {sprite,trail,plasma};
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
    cache:new T.CylinderGeometry(.65,.65,1.6,6),pulse:new T.RingGeometry(1.88,2.07,42),
    relay:new T.TorusGeometry(2.10,.105,8,48), bolt:new T.CapsuleGeometry(.19,.72,2,6), shot:new T.BoxGeometry(.105,.105,2.05)
  };
  const colors = {cache:0xffb959,relay:0x6ee1ff,mine:0xff527a,crystal:0x61f9ff,heal:0xa1ff8b,bolt:0xff528b,shot:0xe1fcff};
  const crystalMat = new T.MeshStandardMaterial({color:0x85fff9,emissive:0x249b99,emissiveIntensity:1.6,roughness:.21,metalness:.15,flatShading:true});
  const healMat = new T.MeshStandardMaterial({color:0xa2ff8e,emissive:0x4dad4a,emissiveIntensity:1.55,flatShading:true});
  const rockMat = alloy(0x594975);
  const mineMat = alloy(0x723754);
  const outline = new Map();
  const cacheMetal = new T.MeshStandardMaterial({
    color:0x9c6833,emissive:0x784021,emissiveIntensity:.68,metalness:.64,roughness:.38,flatShading:true
  });
  const pulseMaterial = new T.MeshBasicMaterial({
    color:0xff567d,side:T.DoubleSide,transparent:true,opacity:.4,depthWrite:false,blending:T.AdditiveBlending
  });
  const objectMaterials = {cache:cacheMetal,pulse:pulseMaterial,relay:bright(0x8cefff),crystal:crystalMat,heal:healMat,rock:rockMat,mine:mineMat,bolt:bright(colors.bolt),shot:bright(colors.shot)};
  const boltGeo = new T.RingGeometry(.8,1,22);
  const dangerMat = new T.MeshBasicMaterial({color:colors.bolt,side:T.DoubleSide,transparent:true,opacity:.72,depthWrite:false});
  const aceBoltColors = {needle:0xffe67e,fan:0xff5085,plasma:0xff8a42,ion:0x75deff};
  const instances = Object.fromEntries([...Object.keys(objGeo),...raiderVariants,...Object.keys(aceBoltColors)].map(type => [type,[]]));

  function edge(geo,color) {
    const key = geo.uuid + '/' + color;
    if (!outline.has(key)) outline.set(key,[new T.EdgesGeometry(geo,17),new T.LineBasicMaterial({color,transparent:true,opacity:.79})]);
    return new T.LineSegments(...outline.get(key));
  }
  function object(type,variant = 'trapper') {
    const key = type === 'raider' ? (raiderVariants.includes(variant) ? variant : 'trapper') :
      type === 'bolt' && Object.hasOwn(aceBoltColors,variant) ? variant : type;
    const pool = instances[key];
    let group = pool.find(candidate => !candidate.visible);
    if (group) {
      group.visible = true;
      if (type === 'pulse') group.userData.setCharged(false);
      return group;
    }
    if (type === 'raider') {
      group = makeRaider(key,glow);
      scene.add(group);
      pool.push(group);
      return group;
    }
    group = new T.Group();
    const projectileTint = aceBoltColors[key];
    const shape = mesh(objGeo[type],projectileTint ? bright(projectileTint) : objectMaterials[type]);
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
      const material = projectileTint ? dangerMat.clone() : dangerMat;
      if (projectileTint) material.color.setHex(projectileTint);
      const alarm = mesh(boltGeo,material);
      alarm.scale.setScalar(1.35);
      if (key === 'needle') shape.scale.set(.62,.62,2.15);
      if (key === 'plasma') shape.scale.set(1.36,1.36,1.02);
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
    if (type === 'cache') {
      shape.rotation.z = Math.PI*.24;
      const strap = mesh(box,bright(0xffdf87),0,.03,.59);
      strap.scale.set(1.03,.12,.10);
      strap.rotation.z = -.67;
      const diamond = mesh(octa,bright(0xffeeb8),0,0,.70);
      diamond.scale.set(.21,.27,.13);
      const rim = edge(objGeo.cache,0xffc575);
      rim.rotation.z = shape.rotation.z;
      group.add(strap,diamond,rim);
    }
    if (type === 'pulse') {
      shape.material = pulseMaterial.clone();
      const diameter = mesh(new T.RingGeometry(1.34,1.37,30),pulseMaterial.clone(),0,0,.07);
      const haze = glow(0xff4c73,5,.20);
      group.add(diameter,haze);
      group.userData.setCharged = active=>{
        shape.material.opacity = active ? .96 : .41;
        diameter.material.opacity = active ? .70 : .33;
        haze.material.opacity = active ? .60 : .16;
      };
      group.userData.setCharged(false);
    }
    if (type === 'rock') group.add(edge(objGeo.rock,0x9c76be));
    group.add(shape);
    if (colors[type] && type !== 'shot') group.add(glow(projectileTint ?? colors[type],4.6,.56));
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
    selectedCabin = cabins[index] ? index : 0;
    eye.active = false;
    cockpit.forEach(({group})=>{group.visible = false;});
    const cabin = cabinFor(selectedCabin);
    cabin.seams.color.setHex(craft.color).multiplyScalar(.49);
    cabin.lit.color.setHex(craft.color);
    cabin.glass.color.setHex(craft.color).lerp(cabinGlow.setHex(0xcfeaff),.68);
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
  const shocks = Array.from({length:5},()=>{
    const material = new T.MeshBasicMaterial({
      color:0xffbcd4,fog:false,side:T.DoubleSide,transparent:true,opacity:0,
      blending:T.AdditiveBlending,depthWrite:false
    });
    const ring = mesh(shockGeo,material);
    ring.visible = false;
    scene.add(ring);
    return {ring,life:0,duration:0,radius:0};
  });
  const warningMaterial = new T.MeshBasicMaterial({
    color:0xffab80,transparent:true,depthWrite:false,side:T.DoubleSide,blending:T.AdditiveBlending,fog:false
  });
  const warningRing = mesh(new T.RingGeometry(.94,1,56),warningMaterial);
  warningRing.visible = false;
  scene.add(warningRing);
  function aceWarning(lock,special,time,comfort) {
    warningRing.visible = Boolean(lock);
    if (!lock) return;
    warningRing.position.set(lock.x,lock.y,-3.2);
    warningRing.scale.set(special.radius[0],special.radius[1],1);
    warningMaterial.color.setHex(special.color);
    warningMaterial.opacity = comfort ? .65 : .64+Math.sin(time*13)*.21;
  }

  const blastShellGeometry = new T.SphereGeometry(1,16,12);
  const blastEffects = Array.from({length:6},()=>{
    const group = new T.Group();
    const outer = mesh(shockGeo,warningMaterial.clone());
    const inner = mesh(shockGeo,warningMaterial.clone());
    inner.rotation.set(.43,-.58,0);
    const shell = mesh(blastShellGeometry,new T.MeshBasicMaterial({
      transparent:true,opacity:0,side:T.FrontSide,depthWrite:false,blending:T.AdditiveBlending
    }));
    const embers = glow(0xff823b,4);
    const core = glow(0xfff2ca,3);
    group.add(outer,inner,shell,embers,core);
    group.visible = false;
    scene.add(group);
    return {group,outer,inner,shell,embers,core,age:0,source:null};
  });
  const coord = new T.Vector3();
  const viewPoint = new T.Vector3();
  const shade = new T.Color();

  function burst(x,y,z,color,count = 24, power = 1) {
    if (count >= 28 || power >= 1.6) {
      const wave = shocks.find(({life})=>life<=0) ?? shocks.reduce((a,b)=>a.life<b.life?a:b);
      wave.life = wave.duration = .29+.14*Math.sqrt(power);
      wave.radius = 2.4*power;
      wave.ring.position.set(x,y,z);
      wave.ring.scale.setScalar(.32);
      wave.ring.material.color.set(color);
      wave.ring.material.opacity = .59;
      wave.ring.visible = true;
    }
    for (let i = 0; i < count && particles.length < particleMax; i++) {
      const life = random(.22,.78) * Math.sqrt(power);
      particles.push({x,y,z,vx:random(-8,8)*power,vy:random(-8,8)*power,vz:random(-6,12)*power,life,initial:life,color});
    }
  }

  function raiderBlast(source,tint) {
    const effect = blastEffects.find(item=>!item.group.visible) ?? blastEffects.reduce((a,b)=>a.age>b.age?a:b);
    const {x,y,z,radius} = source;
    const {group,outer,inner,shell,embers,core} = effect;
    effect.source = source;
    effect.age = 0;
    group.position.set(x,y,z);
    group.visible = true;
    outer.material.color.set(tint).lerp(shade.setHex(0xfff1de),.35);
    inner.material.color.set(tint);
    shell.material.color.set(tint);
    embers.material.color.set(tint).lerp(shade.setHex(0xff7739),.36);
    core.material.color.setHex(0xffeac1);
    burst(x,y,z,0xffd489,Math.round(radius*7),.72+radius*.12);
    burst(x,y,z,tint,Math.round(radius*4),.78+radius*.14);
  }

  function drawBlasts(dt,comfort) {
    for (const effect of blastEffects) {
      if (!effect.group.visible) continue;
      effect.age += dt;
      const {source,age,outer,inner,shell,embers,core} = effect;
      if (age >= source.duration+.57) {
        effect.group.visible = false;
        continue;
      }
      const phase = Math.min(1,source.elapsed/source.duration);
      const radius = Math.max(.28,source.radius*(1-(1-phase)**2));
      const fade = Math.pow(1-phase,1.15);
      const hot = Math.max(0,1-age/.37);
      outer.scale.setScalar(radius);
      outer.material.opacity = (comfort ? .50 : .88)*fade;
      inner.scale.setScalar(Math.max(.20,radius*.82));
      inner.material.opacity = .55*fade;
      shell.scale.setScalar(radius*.71);
      shell.material.opacity = (comfort ? .060 : .14)*fade;
      embers.scale.setScalar(2.3+radius*.96);
      embers.material.opacity = Math.max(0,1-age/(source.duration+.57))*.60;
      core.scale.setScalar(source.radius*(.26+Math.min(age,.22)*2.4));
      core.material.opacity = hot * (comfort ? .34 : .86);
    }
  }

  function setSector(index,tint,orbit) {
    cockpitTint.setHex(tint ?? 0xa875ff);
    space.setSector(index,tint,orbit);
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
    ship.rotation.set(-Math.atan(dy/24)*.73,Math.atan(dx/32)*.52,-Math.atan(dx/18)*.98);
    ship.visible = !state.firstPerson && !state.scoped && (invuln <= 0 || boosting || Math.floor(time*18)%2 === 0);
    shield.visible = boosting;
    shield.rotation.y = time*.85;
    const comfort = Boolean(state.reducedMotion);
    for (const {sprite,trail,plasma} of exhausts) {
      const thrust = (boosting ? 1.8 : .85) + (comfort ? 0 : Math.sin(time*62)*.064);
      sprite.scale.setScalar(thrust*3);
      trail.scale.y = thrust;
      plasma.scale.set(.94,thrust*1.12,.94);
      plasma.position.z = 1.49+.68*thrust;
    }
    const first = Boolean(state.firstPerson);
    const cabin = cabinFor(selectedCabin);
    cabin.group.visible = first;
    const response = eye.active ? 1-Math.exp(-dt*9) : 1;
    const fovBase = cabins[selectedCabin].fov;
    eye.fov += ((fovBase+(boosting&&!comfort?5:0))-eye.fov)*response;
    const base = state.scoped ? 43 : first ? eye.fov : 61;
    const nextFov = T.MathUtils.clamp(2 * Math.atan(Math.tan(base * Math.PI / 360) /
      Math.min(1,camera.aspect / 1.22)) * 180 / Math.PI,base,113);
    if (camera.fov !== nextFov) {
      camera.fov = nextFov;
      camera.updateProjectionMatrix();
    }
    if (state.scoped) {
      camera.up.set(0,1,0);
      camera.position.set(x,y+.1,.82);
      camera.lookAt(x,y+.1,-23);
      const aperture = Math.tan(camera.fov*Math.PI/360);
      cabin.group.scale.set(aperture*camera.aspect,aperture,1);
    } else if (first) {
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
      cabin.glass.opacity = .082+(comfort ? 0 : .036*Math.abs(eye.bank)*9)+
        (boosting ? .065 : 0);
      cabin.glass.color.copy(cabinLight).lerp(cabinGlow.setHex(0xb4e8ff),.56);
    } else {
      eye.active = false;
      const kick = shake * (comfort ? .1 : 1);
      camera.up.set(0,1,0);
      camera.position.set(x*.62+random(-kick,kick),3.72+y*.39+random(-kick,kick),mobile ? 21.0 : 18.3);
      camera.lookAt(x*.43,y*.24,-28);
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
      shade.set(p.color).multiplyScalar(Math.min(1,p.life / p.initial * 1.7)).toArray(particleColors,i*3);
    });
    particleGeo.setDrawRange(0,particles.length);
    particleGeo.attributes.position.needsUpdate = true;
    particleGeo.attributes.color.needsUpdate = true;
    for (const wave of shocks) {
      if (wave.life <= 0) continue;
      wave.life = Math.max(0,wave.life-dt);
      wave.ring.visible = wave.life > 0 && !comfort;
      if (!wave.ring.visible) continue;
      const phase = 1-wave.life/wave.duration;
      wave.ring.position.z += speed*dt*.15;
      wave.ring.scale.setScalar(.32+wave.radius*(1-Math.pow(1-phase,2)));
      wave.ring.material.opacity = .66*Math.pow(1-phase,1.7);
    }
    for (const trace of traces) {
      if (!trace.mesh.visible) continue;
      trace.life -= dt;
      trace.mesh.visible = trace.life > 0;
      trace.mesh.material.opacity = Math.max(0,trace.life/trace.duration);
    }
    drawBlasts(dt,comfort);
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

  function clearParticles() {
    particles.length = 0;
    for (const wave of shocks) {
      wave.life = 0;
      wave.ring.visible = false;
    }
    for (const trace of traces) trace.mesh.visible = false;
    for (const effect of blastEffects) effect.group.visible = false;
  }

  return {draw,resize,object,boss,reactor,burst,raiderBlast,aceWarning,ultimateTrace,setSector,setShip,capture,
    screenPoint,screenProjection,setBossShield:visible=>{bossShield.visible=visible;},clearParticles};
}
