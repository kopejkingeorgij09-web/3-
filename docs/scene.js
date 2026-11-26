import * as T from './three.module.min.js';
import {captureRadius,captureHeightRatio,captureZ} from './campaign.js';
import {cabins} from './cockpit.js';

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

const skyVertex = `
varying vec3 ray;
void main(){
  ray = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
}`;
const skyFragment = `
varying vec3 ray;
uniform vec3 tint;
uniform float moment;
float hash(vec3 v){
  v = fract(v * .3183099 + vec3(.11,.37,.73));
  v *= 17.;
  return fract(v.x * v.y * v.z * (v.x+v.y+v.z));
}
float noise(vec3 v){
  vec3 i=floor(v), f=fract(v);
  f=f*f*(3.-2.*f);
  return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
    mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);
}
float clouds(vec3 p){
  return noise(p)*.53 + noise(p*2.13)*.27 + noise(p*4.44)*.13 + noise(p*9.12)*.07;
}
void main(){
  vec3 d=normalize(ray);
  vec3 q=d*vec3(4.,8.,5.)+vec3(1.8,.5,moment*.018);
  float a=clouds(q);
  float b=clouds(q+vec3(a*2.1, .7, a));
  float strand=pow(smoothstep(.28,.86,b+.18*(1.-abs(d.y))),2.);
  float center=pow(max(0.,dot(d,normalize(vec3(.06,-.065,-1.)))),22.);
  vec3 base=vec3(.009,.005,.023) + tint*(.07*center + .31*strand);
  base+=vec3(.11,.07,.19)*pow(center,4.)*(.14+strand);
  gl_FragColor=vec4(base,1.);
  #include <colorspace_fragment>
}`;

function buildCabin(profile) {
  const group = new T.Group();
  const plate = new T.MeshBasicMaterial({color:profile.frame,fog:false,side:T.DoubleSide});
  const deck = new T.MeshBasicMaterial({color:profile.deck,fog:false,side:T.DoubleSide});
  const seams = new T.MeshBasicMaterial({color:0xc09bff,fog:false});
  const lit = seams.clone();
  const railBox = new T.BoxGeometry(1,1,1);
  const axis = new T.Vector3(0,1,0);
  const addPiece = piece=>{
    piece.renderOrder = 18;
    group.add(piece);
    return piece;
  };
  const point = (x,y,z=-1.06)=>new T.Vector3(x,y,z);
  const rail = (a,b,width,material)=>{
    const part = addPiece(mesh(railBox,material));
    part.position.copy(a).lerp(b,.5);
    part.quaternion.setFromUnitVectors(axis,b.clone().sub(a).normalize());
    part.scale.set(width,a.distanceTo(b),width*.65);
    return part;
  };
  const panel = (outline,material)=>{
    const faces = [];
    for (let i=1;i<outline.length-1;i++) faces.push([0,i,i+1]);
    return addPiece(facet(outline,faces,material));
  };

  const {edge,crown,dash,cut,beams} = profile;
  panel([[-1.34,-1.25,-1.02],[1.34,-1.25,-1.02],[1.34,dash-.06,-1.10],
    [cut,dash-.01,-1.13],[-cut,dash-.01,-1.13],[-1.34,dash-.06,-1.10]],deck);
  panel([[-1.28,dash-.08,-1.15],[-cut,dash+.14,-1.18],[cut,dash+.14,-1.18],
    [1.28,dash-.08,-1.15],[1.28,dash-.16,-1.13],[-1.28,dash-.16,-1.13]],plate);
  for (const side of [-1,1]) {
    const lo = point(side*(edge-.10),dash+.07);
    const mid = point(side*(edge+.12),crown-.58,-1.12);
    const hi = point(side*(edge-.12),1.21,-1.15);
    panel([[side*1.28,-1.26,-1.04],lo.toArray(),mid.toArray(),hi.toArray(),[side*1.35,1.26,-1.06]],deck);
    rail(lo,mid,beams === 3 ? .093 : .061,plate);
    rail(mid,hi,beams === 3 ? .112 : .068,plate);
    rail(lo.clone().add(point(side*.026,.012,0)),mid.clone().add(point(side*.026,.012,0)),.009,lit);
    rail(point(side*cut,dash+.14,-1.17),point(side*.15,dash+.14,-1.17),.014,seams);
    if (beams >= 2) rail(point(side*(edge+.25),dash-.06),point(side*(edge-.04),crown-.42,-1.18),.031,plate);
    if (beams === 3) rail(point(side*(edge-.13),.68,-1.16),point(side*.26,1.19,-1.18),.024,plate);
  }
  rail(point(-edge+.10,1.10,-1.13),point(edge-.10,1.10,-1.13),.045,plate);
  if (profile.id === 'leviathan') {
    for (const side of [-1,1]) rail(point(side*.36,1.10,-1.10),point(side*.67,dash+.22,-1.19),.025,plate);
  }
  group.visible = false;
  return {group,seams,lit};
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
  const texture = glowTexture();
  const glow = (color, size, opacity = 1) => {
    const sprite = new T.Sprite(new T.SpriteMaterial({map:texture, color, transparent:true, opacity, depthWrite:false, blending:T.AdditiveBlending, fog:false}));
    sprite.scale.set(size, size, 1);
    return sprite;
  };
  const skyMat = new T.ShaderMaterial({
    side:T.BackSide, depthWrite:false, vertexShader:skyVertex, fragmentShader:skyFragment,
    uniforms:{moment:{value:0},tint:{value:new T.Color(0x8e46d9)}}
  });
  const sky = mesh(new T.SphereGeometry(310, 24, 14), skyMat);
  sky.renderOrder = -10;
  scene.add(sky);
  scene.add(new T.HemisphereLight(0xd1afff, 0x33225c, 2.05));
  const keyLight = new T.DirectionalLight(0xe6d8ff, 3.1);
  keyLight.position.set(-4, 7, 3);
  scene.add(keyLight);
  const rimLight = new T.DirectionalLight(0xa63bff, 3.2);
  rimLight.position.set(5, 1, -8);
  scene.add(rimLight);

  const gateColor = new T.MeshBasicMaterial({color:0xa673ff, transparent:true, opacity:.43});
  const gateFaint = new T.MeshBasicMaterial({color:0x8261e0, transparent:true, opacity:.2});
  const rings = [];
  const ringGeo = new T.TorusGeometry(27.5, .13, 6, 8);
  const rimGeo = new T.TorusGeometry(29, .065, 5, 8);
  const beaconGeo = new T.BoxGeometry(.25, .18, 3.1);
  const sectorTints = [0xa875ff, 0x60d3ff, 0xf08bfc];
  for (let i = 0; i < 7; i++) {
    const group = new T.Group();
    group.add(mesh(ringGeo, gateColor), mesh(rimGeo, gateFaint));
    for (let j = 0; j < 8; j++) {
      const a = j * Math.PI / 4;
      group.add(mesh(beaconGeo, gateColor, Math.cos(a) * 27.5, Math.sin(a) * 27.5));
    }
    group.scale.y = .60;
    group.position.z = 8 - i * 42;
    scene.add(group);
    rings.push(group);
  }

  const dummy = new T.Object3D();
  const rocks = new T.InstancedMesh(sphere, alloy(0xffffff), 64);
  rocks.instanceMatrix.setUsage(T.DynamicDrawUsage);
  rocks.frustumCulled = false;
  scene.add(rocks);
  const cliffstones = [];
  for (let i = 0; i < rocks.count; i++) {
    const side = i % 2 ? -1 : 1;
    const radius = random(1.4, 8.5);
    cliffstones.push({
      x:side*random(26,54), y:random(-22,22), z:random(-280,16), radius,
      rz:random(0,6), ry:random(0,6), spin:random(-.14,.14), depth:random(.7,1.6)
    });
    rocks.setColorAt(i, new T.Color().setHSL(random(.66,.79),random(.20,.45),random(.105,.24)));
  }

  const starCount = 420;
  const starPos = new Float32Array(starCount * 6);
  const starCol = new Float32Array(starPos.length);
  const starSpecs = [];
  const shades = [new T.Color(0xc7b4ff), new T.Color(0x8577f7), new T.Color(0xb7e9ff), new T.Color(0xf4bcff)];
  for (let i = 0; i < starCount; i++) {
    starSpecs.push({x:random(-115,115),y:random(-78,78),z:random(-290,25),s:random(.3,1.8)});
    const shade = shades[i % shades.length];
    shade.toArray(starCol, i * 6);
    shade.clone().multiplyScalar(.16).toArray(starCol, i * 6 + 3);
  }
  const starGeo = new T.BufferGeometry();
  starGeo.setAttribute('position', new T.BufferAttribute(starPos, 3).setUsage(T.DynamicDrawUsage));
  starGeo.setAttribute('color', new T.BufferAttribute(starCol, 3));
  const streaks = new T.LineSegments(starGeo,new T.LineBasicMaterial({vertexColors:true,transparent:true,opacity:.74,blending:T.AdditiveBlending,depthWrite:false}));
  streaks.frustumCulled = false;
  scene.add(streaks);

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
    raider:new T.IcosahedronGeometry(1.54,0), bolt:new T.CapsuleGeometry(.19,.72,2,6), shot:new T.BoxGeometry(.105,.105,2.05)
  };
  const colors = {raider:0xff924a,mine:0xff527a,crystal:0x61f9ff,heal:0xa1ff8b,bolt:0xff528b,shot:0xe1fcff};
  const crystalMat = new T.MeshStandardMaterial({color:0x85fff9,emissive:0x249b99,emissiveIntensity:1.6,roughness:.21,metalness:.15,flatShading:true});
  const healMat = new T.MeshStandardMaterial({color:0xa2ff8e,emissive:0x4dad4a,emissiveIntensity:1.55,flatShading:true});
  const rockMat = alloy(0x594975);
  const mineMat = alloy(0x723754);
  const outline = new Map();
  const objectMaterials = {raider:alloy(0x703b46),crystal:crystalMat,heal:healMat,rock:rockMat,mine:mineMat,bolt:bright(colors.bolt),shot:bright(colors.shot)};
  const boltGeo = new T.RingGeometry(.8,1,22);
  const dangerMat = new T.MeshBasicMaterial({color:colors.bolt,side:T.DoubleSide,transparent:true,opacity:.72,depthWrite:false});
  const instances = Object.fromEntries(Object.keys(objGeo).map(type => [type,[]]));

  function edge(geo,color) {
    const key = geo.uuid + '/' + color;
    if (!outline.has(key)) outline.set(key,[new T.EdgesGeometry(geo,17),new T.LineBasicMaterial({color,transparent:true,opacity:.79})]);
    return new T.LineSegments(...outline.get(key));
  }
  function object(type) {
    let group = instances[type].find(candidate => !candidate.visible);
    if (group) {
      group.visible = true;
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
    if (type === 'raider') {
      shape.scale.set(1.48,.56,1.06);
      const window = mesh(octa,bright(0xff9b43),0,.16,1.03);
      window.scale.set(.49,.28,.66);
      group.add(window);
      for (const sign of [-1,1]) {
        const wing = mesh(objGeo.raider,objectMaterials.raider,sign*1.58,.08,.17);
        wing.scale.set(.69,.36,1.04);
        wing.rotation.z = sign*.45;
        const edgeLight = mesh(box,bright(0xff7356),sign*2.00,.15,.75);
        edgeLight.scale.set(.77,.085,.11);
        group.add(wing,edgeLight);
      }
      const antenna = mesh(new T.TorusGeometry(1.11,.065,4,18),bright(0xffa358),0,.14,.83);
      group.add(antenna);
    }
    if (type === 'rock') group.add(edge(objGeo.rock,0x9c76be));
    group.add(shape);
    if (colors[type] && type !== 'shot') group.add(glow(colors[type],4.6,.56));
    scene.add(group);
    instances[type].push(group);
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
  const shade = new T.Color();

  function burst(x,y,z,color,count = 24, power = 1) {
    for (let i = 0; i < count && particles.length < particleMax; i++) {
      const life = random(.22,.78) * Math.sqrt(power);
      particles.push({x,y,z,vx:random(-8,8)*power,vy:random(-8,8)*power,vz:random(-6,12)*power,life,initial:life,color});
    }
  }

  function setSector(index,tint = sectorTints[index]) {
    gateColor.color.setHex(tint);
    gateFaint.color.copy(gateColor.color).multiplyScalar(.68);
    skyMat.uniforms.tint.value.copy(gateColor.color);
    scene.fog.color.copy(gateColor.color).multiplyScalar(.11);
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
    skyMat.uniforms.moment.value = time;
    for (const ring of rings) {
      ring.position.z += speed * dt;
      if (ring.position.z > 17) ring.position.z -= 294;
      ring.rotation.z = .13 * Math.sin(ring.position.z * .022 + time * .16);
    }
    cliffstones.forEach((a,i) => {
      a.z += speed * dt * .97;
      if (a.z > 20) a.z -= 302;
      dummy.position.set(a.x,a.y,a.z);
      dummy.rotation.set(.3,a.ry + time * a.spin,a.rz + time * a.spin*.6);
      dummy.scale.set(a.radius,a.radius * 1.25,a.radius * a.depth);
      dummy.updateMatrix();
      rocks.setMatrixAt(i,dummy.matrix);
    });
    rocks.instanceMatrix.needsUpdate = true;
    starSpecs.forEach((s,i) => {
      s.z += speed * dt * s.s;
      if(s.z > 23) s.z -= 313;
      starPos.set([s.x,s.y,s.z,s.x+.01,s.y,s.z-s.s*(boosting ? 15 : 3.7)],i*6);
    });
    starGeo.attributes.position.needsUpdate = true;
    streaks.material.opacity = boosting ? 1 : .67;
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
    const kick = shake * (state.reducedMotion ? .1 : 1);
    const first = state.firstPerson;
    const fovBase = first ? (boosting ? 76 : 68) : 59;
    const nextFov = T.MathUtils.clamp(2 * Math.atan(Math.tan(fovBase * Math.PI / 360) /
      Math.min(1,camera.aspect / 1.22)) * 180 / Math.PI,fovBase,113);
    if (camera.fov !== nextFov) {
      camera.fov = nextFov;
      camera.updateProjectionMatrix();
    }
    const cabin = cockpit[selectedCabin].group;
    cabin.visible = Boolean(first);
    const aperture = Math.tan(camera.fov*Math.PI/360);
    cabin.scale.set(aperture*camera.aspect,aperture,1);
    if (first) {
      const tilt = state.reducedMotion ? 0 : T.MathUtils.clamp(dx*-.0042,-.13,.13);
      camera.up.set(Math.sin(tilt),Math.cos(tilt),0);
      camera.position.set(x + random(-kick*.25,kick*.25),y+.42+random(-kick*.18,kick*.18),.77);
      camera.lookAt(x+dx*.035,y+dy*.041,-27);
    } else {
      camera.up.set(0,1,0);
      camera.position.set(x*.78+random(-kick,kick),3.45+y*.47+random(-kick,kick),mobile ? 20.0 : 16.6);
      camera.lookAt(x*.60,y*.28,-24);
    }
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

  function screenPoint(x,y,z) {
    coord.set(x,y,z).project(camera);
    return [(coord.x*.5+.5)*host.clientWidth,(-coord.y*.5+.5)*host.clientHeight];
  }

  return {draw,resize,object,boss,reactor,burst,setSector,setShip,capture,screenPoint,setBossShield:visible=>{bossShield.visible=visible;},clearParticles:()=>{particles.length=0;}};
}
