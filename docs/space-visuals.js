import * as T from './three.module.min.js';

const TAU = Math.PI * 2;
const gateSpacing = 51;
const gateCount = 6;
const sectorTints = [0xa875ff, 0x60d3ff, 0xf08bfc];

// The index follows the campaign order. Each destination has its own orbital angle and colors.
const orbits = [
  [-.13,.05,.02,0xb79bff], [.31,-.01,.10,0xa5eaff], [-.26,-.03,.04,0xffbc8e],
  [.20,.07,.13,0xd2a6ff], [-.17,-.04,.02,0x9be9aa], [.05,.09,.17,0xd3c8ff],
  [.28,-.08,.07,0xffb37d], [-.22,.04,.28,0x86efec], [.02,-.08,.04,0xd693ad],
  [.19,.01,.19,0x8de9ff], [-.27,.12,.14,0xb8c5ff], [.09,-.02,.31,0xfcb0e3],
  [-.03,.15,.19,0xa0b9ee], [.13,-.07,.09,0xeab08a], [-.24,.07,.39,0x92fcff],
  [.12,.05,.33,0xe7c58f], [-.18,-.11,.16,0xb4eb89], [.08,.08,.29,0xa7a5fa],
  [-.01,.12,.26,0x95c5ff], [-.10,-.08,.22,0x8ff6cc], [.24,.01,.25,0xc0f8f0],
  [-.18,.02,.20,0xb6a4ea], [.18,-.01,.18,0xffbfac], [.03,.14,.36,0xbcffe1]
];
const starPalette = [0xbad8ff, 0xc3cdff, 0xffdfbd, 0xe0dfff];
const settings = [
  {world:[-.51,.27,-1], radius:.26, rings:.0, storm:.13, fog:.0059, drift:.22},
  {world:[.59,.28,-1], radius:.29, rings:1, storm:.39, fog:.0069, drift:.42},
  {world:[-.34,.31,-1], radius:.178, rings:.44, storm:.81, fog:.0049, drift:.70}
];

function generator(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

const lerp = (a,b,t) => a + (b-a)*t;
const spline = t => t*t*(3-2*t);
const srgbHex = hex => new T.Color(hex);

function nebulaTexture() {
  const width = 720;
  const height = 364;
  const data = new Uint8Array(width * height * 4);
  const next = generator(2603177);
  const dimensions = [128,64];
  const values = Float32Array.from({length:dimensions[0]*dimensions[1]},next);
  function noise(x,y) {
    const ix = Math.floor(x), iy = Math.floor(y);
    const ax = ix & (dimensions[0]-1), bx = (ix+1) & (dimensions[0]-1);
    const ay = (iy & (dimensions[1]-1))*dimensions[0], by = ((iy+1) & (dimensions[1]-1))*dimensions[0];
    const dx = spline(x-ix), dy = spline(y-iy);
    return lerp(lerp(values[ay+ax],values[ay+bx],dx),lerp(values[by+ax],values[by+bx],dx),dy);
  }
  for (let y=0;y<height;y++) {
    const v = y/(height-1);
    for (let x=0;x<width;x++) {
      const u = x/(width-1);
      const warp = (noise(u*12+9,v*6+13)-.5)*.9;
      const a = u*17;
      const b = (v+.043*Math.sin(u*5.4*TAU))*9;
      const main = noise(a*1.23+warp*3,b*1.43+warp*2)*.55 +
        noise(a*3.12,b*3.2+warp)*.26 + noise(a*6.3+8,b*7.6+7)*.13 +
        noise(a*14.8+9,b*13.8+4)*.06;
      const filament = noise(a*1.7+main*.62,b*1.8+main*4.2);
      const dust = noise(a*8.1+main*4,b*10.1+warp)*.61 + noise(a*16.13,b*19.2)*.39;
      const i = (y*width+x)*4;
      data[i] = Math.round(main*255);
      data[i+1] = Math.round(filament*255);
      data[i+2] = Math.round(dust*255);
      data[i+3] = 255;
    }
  }
  const map = new T.DataTexture(data,width,height,T.RGBAFormat);
  map.wrapS = T.RepeatWrapping;
  map.minFilter = T.LinearFilter;
  map.magFilter = T.LinearFilter;
  map.needsUpdate = true;
  return map;
}

const skyVertex = `
varying vec3 ray;
void main(){
  ray = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
}`;

const skyFragment = `
uniform sampler2D cloudAtlas;
uniform vec3 tint;
uniform vec3 pale;
uniform vec3 world;
uniform float planetRadius;
uniform float rings;
uniform float storm;
uniform float time;
uniform vec3 sunlight;
uniform vec3 ringInclination;
uniform float curtain;
uniform float wind;
uniform float boost;
varying vec3 ray;
const float PI = 3.14159265;

void main() {
  vec3 direction = normalize(ray);
  vec2 uv = vec2(atan(direction.x,-direction.z)/(PI*2.0)+.5,asin(clamp(direction.y,-1.0,1.0))/PI+.5);
  vec3 textureMain = texture2D(cloudAtlas,uv+vec2(time*(.00052+wind*.00058),storm*.047)).rgb;
  vec2 vein = uv*vec2(2.24,1.48)+vec2(.27+textureMain.g*.083,-.09+textureMain.r*.07);
  vec3 textureDetail = texture2D(cloudAtlas,vein).rgb;
  float strand = textureMain.r*.72+textureDetail.g*.28;
  float band = 1.0-smoothstep(.03,.45,abs(direction.y+.13+.10*direction.x+.07*sin(direction.x*4.1)));
  float haze = smoothstep(.33,.64,strand)*(.23+.77*band);
  float dust = smoothstep(.40,.63,textureDetail.b)*smoothstep(.29,.62,textureMain.g);
  float edge = pow(max(0.0,dot(direction,normalize(vec3(.36,-.13,-1.0)))),10.0);
  float curl = sin(direction.x*3.7+textureMain.r*.83)*.115;
  float riftLine = abs(direction.y+.20-curl);
  float rift = exp(-riftLine*18.0)*edge;
  float grain = textureDetail.r*.61 + textureDetail.b*.39;
  float nearFilament = exp(-abs(direction.y+.01+curl*.83+textureMain.g*.098)*26.0);
  float farFilament = exp(-abs(direction.y+.36-curl*.57-textureMain.r*.11)*17.0);
  float translucentEdge = pow(max(0.0,dot(direction,normalize(vec3(-.69,-.21,-1.0)))),12.0);
  float ribbons = curtain*(nearFilament*translucentEdge+farFilament*edge*.73)*smoothstep(.33,.70,grain);
  vec3 base = vec3(.005,.008,.021) + vec3(.016,.028,.044)*(.26+.74*edge);
  base += tint*(haze*(.19+storm*.22)+rift*.11)*(1.0-dust*.72);
  base += pale*(.055*rift+.092*haze*haze+.27*ribbons);
  base += tint*ribbons*.46;
  base += sunlight*edge*band*smoothstep(.40,.70,textureMain.g)*.035;
  base += pale*boost*.032*edge*haze;
  float violetFactor = max(0.0,dot(direction,normalize(vec3(-.46,.12,-1.0))));
  base += tint*pow(violetFactor,38.0)*(.021+storm*.026);

  vec3 sun = normalize(vec3(-.47,.41,-1.0));
  float solarAngle = max(0.0,dot(direction,sun));
  float diffraction = exp(-abs(direction.y-sun.y)*94.0)*pow(solarAngle,35.0);
  base += sunlight*(pow(solarAngle,185.0)*.19+pow(solarAngle,7200.0)*.76+diffraction*.015);

  float closest = dot(direction,world);
  float offset = sqrt(max(0.0,dot(world,world)-closest*closest));
  float bodyZ = 100.0;
  float atmosphere = 1.0-smoothstep(0.0,.15,abs(offset/planetRadius-1.0));
  float horizonLit = clamp(.38 + direction.y*1.45 - direction.x*.92,0.18,1.0);
  if (closest>0.0 && offset<planetRadius*1.16) {
    base += pale*pow(atmosphere,2.15)*horizonLit*.41;
  }
  if (offset<planetRadius && closest>0.0) {
    bodyZ = closest-sqrt(max(0.0,planetRadius*planetRadius-offset*offset));
    vec3 normal = normalize(direction*bodyZ-world);
    vec3 light = normalize(vec3(-.42,.53,.66));
    float surface = max(0.0,dot(normal,light));
    float solarRim = pow(1.0-abs(dot(normal,-direction)),3.25);
    vec2 planetUv = vec2(atan(normal.x,normal.z)/(PI*2.0)+.5,asin(normal.y)/PI+.5);
    vec3 grain = texture2D(cloudAtlas,planetUv*vec2(1.9,1.15)+vec2(storm*.37,0.0)).rgb;
    float clouds = smoothstep(.15,.86,grain.r*.83+.17*sin((normal.y+grain.g*.17)*33.0));
    vec3 crust = mix(vec3(.008,.021,.045),pale*.24,clouds);
    vec3 surfaceColor = crust*(surface*.73+.058) + pale*solarRim*(.12+.62*surface);
    base = mix(base,surfaceColor,smoothstep(0.0,.016,planetRadius-offset));
  }
  vec3 ringNormal = normalize(ringInclination);
  float denom = dot(direction,ringNormal);
  if (rings>.0 && abs(denom)>.008) {
    float depth = dot(world,ringNormal)/denom;
    float radius = length(direction*depth-world)/planetRadius;
    if (depth>0.0 && depth<bodyZ && radius>1.24 && radius<2.19) {
      float bands = (.24+.25*sin(radius*93.0)+.15*sin(radius*230.0)+.12*sin(radius*176.0));
      float opacity = smoothstep(1.24,1.39,radius)*(1.0-smoothstep(2.02,2.19,radius))*rings*max(.1,bands);
      base = mix(base,pale*(.41+(2.19-radius)*.14)+sunlight*.094,opacity);
    }
  }
  gl_FragColor = vec4(base,1.0);
  #include <colorspace_fragment>
}`;

function makeStarDome(next) {
  const count = 820;
  const positions = new Float32Array(count*3);
  const colors = new Float32Array(count*3);
  const points = new Float32Array(count);
  const noise = new Float32Array(count);
  for (let i=0;i<count;i++) {
    const azimuth = next()*TAU;
    const y = next()*2-1;
    const ring = Math.sqrt(1-y*y);
    const radius = 296;
    positions.set([Math.sin(azimuth)*ring*radius,y*radius,Math.cos(azimuth)*ring*radius],i*3);
    srgbHex(starPalette[i%starPalette.length]).multiplyScalar(.33+next()*.55).toArray(colors,i*3);
    points[i] = .9+Math.pow(next(),5)*3;
    noise[i] = next()*TAU;
  }
  const geo = new T.BufferGeometry();
  geo.setAttribute('position',new T.BufferAttribute(positions,3));
  geo.setAttribute('color',new T.BufferAttribute(colors,3));
  geo.setAttribute('diameter',new T.BufferAttribute(points,1));
  geo.setAttribute('phase',new T.BufferAttribute(noise,1));
  const mat = new T.ShaderMaterial({
    uniforms:{time:{value:0}},
    transparent:true,
    depthWrite:false,
    blending:T.AdditiveBlending,
    vertexColors:true,
    vertexShader:`
      attribute float diameter;
      attribute float phase;
      uniform float time;
      varying vec3 shade;
      void main(){
        shade=color*(.78+.22*sin(phase+time*.72));
        gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);
        gl_PointSize=diameter;
      }
    `,
    fragmentShader:`
      varying vec3 shade;
      void main(){
        vec2 p=gl_PointCoord*2.0-1.0;
        float glow=exp(-dot(p,p)*3.5);
        gl_FragColor=vec4(shade,glow*.83);
        #include <colorspace_fragment>
      }
    `
  });
  const stars = new T.Points(geo,mat);
  stars.frustumCulled = false;
  return stars;
}

function roughStone(seed) {
  const next = generator(seed);
  const geo = new T.IcosahedronGeometry(1,1);
  const points = geo.getAttribute('position');
  const shade = new T.Color();
  const color = new Float32Array(points.count*3);
  for (let i=0;i<points.count;i++) {
    const x = points.getX(i), y = points.getY(i), z = points.getZ(i);
    const scale = .82 + .16*Math.sin(x*12.0+y*8.6-z*2.3+seed) + .14*Math.cos(z*6.2-y*8.4);
    points.setXYZ(i,x*scale+y*.15,y*scale,z*scale);
    if (i%3===0) shade.setRGB(.31,.39,.51).multiplyScalar(.64+next()*.61);
    shade.toArray(color,i*3);
  }
  geo.setAttribute('color',new T.BufferAttribute(color,3));
  geo.computeVertexNormals();
  return geo;
}

function makeCliffs(scene,next) {
  const count = 72;
  const stocks = [217,852,973].map(seed=>{
    const rock = new T.InstancedMesh(roughStone(seed),new T.MeshStandardMaterial({
      color:0x8c9bb0,vertexColors:true,flatShading:true,metalness:.12,roughness:.94
    }),count/3);
    rock.instanceMatrix.setUsage(T.DynamicDrawUsage);
    rock.frustumCulled = false;
    scene.add(rock);
    return rock;
  });
  const cliffs = Array.from({length:count},(_,i)=>{
    const side = i%2 ? 1 : -1;
    const target = stocks[i%stocks.length];
    const slot = Math.floor(i/stocks.length);
    const ridge = i%4===0;
    const size = ridge ? 8+next()*9 : 1.2+Math.pow(next(),1.44)*6.7;
    const a = {
      target,slot,size,side,x:side*((ridge ? 38 : 28)+next()*22),
      y:(next()-.56)*65,z:20-next()*314,
      spin:next()*.2-.1,tilt:next()*TAU,depth:.67+next()*1.1
    };
    target.setColorAt(slot,new T.Color().setHSL(.58+next()*.1,.19+next()*.25,.44+next()*.29));
    return a;
  });
  const proxy = new T.Object3D();
  function draw(dt,state) {
    for (const a of cliffs) {
      a.z += state.speed*dt*.92;
      if (a.z>30) a.z-=318;
      proxy.position.set(a.x,a.y+.64*Math.sin(state.time*.11+a.tilt),a.z);
      proxy.rotation.set(a.tilt*.57,a.tilt+state.time*a.spin,state.time*a.spin*.7);
      proxy.scale.set(a.size,a.size*a.depth,a.size*(.68+a.depth*.31));
      proxy.updateMatrix();
      a.target.setMatrixAt(a.slot,proxy.matrix);
    }
    for (const stock of stocks) stock.instanceMatrix.needsUpdate = true;
  }
  return {draw};
}

function planarFace(positions,indices,material) {
  const geo = new T.BufferGeometry();
  geo.setAttribute('position',new T.Float32BufferAttribute(positions.flat(),3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return new T.Mesh(geo,material);
}

function gateShell(gaps,inner,outer,depth) {
  const positions = [], indices = [];
  for (let panel=0;panel<gaps.length;panel++) {
    if (!gaps[panel]) continue;
    const start = (panel+.065)*TAU/gaps.length;
    const end = (panel+.935)*TAU/gaps.length;
    const stride = positions.length;
    for (const z of [-depth*.56,depth*.56]) {
      for (const angle of [start,end]) {
        positions.push([Math.cos(angle)*inner,Math.sin(angle)*inner,z]);
        positions.push([Math.cos(angle)*outer,Math.sin(angle)*outer,z*.8]);
      }
    }
    for (const index of [0,1,3,0,3,2,4,6,7,4,7,5,0,4,5,0,5,1,2,3,7,2,7,6,0,2,6,0,6,4,1,5,7,1,7,3]) indices.push(index+stride);
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position',new T.Float32BufferAttribute(positions.flat(),3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function createGates(scene,next) {
  const deckMaterial = new T.MeshStandardMaterial({
    color:0x304454,roughness:.72,metalness:.55,flatShading:true,side:T.DoubleSide
  });
  const glowMaterial = new T.LineBasicMaterial({
    color:0xc28dff,transparent:true,opacity:.64,blending:T.AdditiveBlending,depthWrite:false
  });
  const edgeMaterial = new T.LineBasicMaterial({color:0x7793ac,transparent:true,opacity:.32});
  const gates = [];
  for (let i=0;i<gateCount;i++) {
    const group = new T.Group();
    const slots = Array.from({length:16},(_,j)=>j%8<4 || next()>.37);
    const radius = lerp(26,29,next());
    const geometry = gateShell(slots,radius,radius+lerp(2.3,4.5,next()),lerp(1.8,4,next()));
    const trim = new T.LineSegments(new T.EdgesGeometry(geometry,23),edgeMaterial);
    const ribs = new T.Mesh(geometry,deckMaterial);
    const lit = [];
    slots.forEach((hasPanel,j)=>{
      if (!hasPanel || (i+j)%6===0) return;
      const from = (j+.11)*TAU/slots.length;
      const to = (j+.89)*TAU/slots.length;
      const point = (a,r,z)=>[Math.cos(a)*r,Math.sin(a)*r,z];
      lit.push(...point(from,radius-.06,.50),...point(to,radius-.06,.50));
      if ((i+j)%3===0) {
        const half = (from+to)/2;
        lit.push(...point(half-.006,radius+1.18,1.40),...point(half-.006,radius+2.10,1.49));
        lit.push(...point(half+.014,radius+1.18,1.40),...point(half+.014,radius+2.10,1.49));
      }
      if ((i+j)%3!==0) return;
      for (let segment=0;segment<3;segment++) {
        const angle = lerp(from,to,.23+segment*.092);
        lit.push(...point(angle,radius+.26,1.48),...point(angle+.012,radius+1.4,1.54));
      }
    });
    const beams = new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute(lit,3));
    group.add(ribs,trim,new T.LineSegments(beams,glowMaterial));
    group.scale.y=.62;
    group.position.z=14-i*gateSpacing;
    group.rotation.z=i*.27;
    scene.add(group);
    gates.push(group);
  }
  function draw(dt,state) {
    for (const [i,gate] of gates.entries()) {
      gate.position.z += state.speed*dt;
      if (gate.position.z>30) gate.position.z-=gateSpacing*gates.length;
      gate.rotation.z = i*.37+.10*Math.sin(gate.position.z*.018+state.time*.15);
    }
  }
  return {draw,deckMaterial,glowMaterial,edgeMaterial};
}

function createStreaks(scene,next) {
  const count = 270;
  const positions = new Float32Array(count*6);
  const colors = new Float32Array(count*6);
  const data = [];
  for (let i=0;i<count;i++) {
    const spread = i%5===0 ? .58 : 1;
    const shade = srgbHex(starPalette[i%starPalette.length]).multiplyScalar(.14+next()*.46);
    data.push({
      x:(next()-.5)*180*spread,y:(next()-.5)*100*spread,z:18-next()*300,
      ratio:.39+next()*1.42
    });
    shade.toArray(colors,i*6);
    shade.multiplyScalar(.13).toArray(colors,i*6+3);
  }
  const buffer = new T.BufferGeometry();
  const pointAttribute = new T.BufferAttribute(positions,3).setUsage(T.DynamicDrawUsage);
  buffer.setAttribute('position',pointAttribute);
  buffer.setAttribute('color',new T.BufferAttribute(colors,3));
  const material = new T.LineBasicMaterial({
    vertexColors:true,transparent:true,opacity:.68,blending:T.AdditiveBlending,depthWrite:false
  });
  const trails = new T.LineSegments(buffer,material);
  trails.frustumCulled = false;
  scene.add(trails);
  function draw(dt,state) {
    const {boosting,firstPerson,reducedMotion,speed} = state;
    const length = reducedMotion ? 1.6 : boosting ? (firstPerson ? 16 : 20) : (firstPerson ? 3.1 : 4.2);
    for (let i=0;i<count;i++) {
      const s = data[i];
      s.z += speed*s.ratio*dt;
      if (s.z>24) s.z-=303;
      const off = i*6;
      positions[off] = positions[off+3] = s.x;
      positions[off+1] = positions[off+4] = s.y;
      positions[off+2] = s.z;
      positions[off+5] = s.z-s.ratio*length;
    }
    pointAttribute.needsUpdate = true;
    material.opacity = boosting && !reducedMotion ? .92 : .53;
  }
  return {draw};
}

export function makeSpaceVisuals(scene) {
  const next = generator(150203);
  const nebula = nebulaTexture();
  const palette = new T.Color();
  const pale = new T.Color();
  const incident = new T.Color();
  const bluewhite = new T.Color(0xe0eeff);
  const shadow = new T.Color(0x102137);
  const gateMetal = new T.Color(0x394b60);
  const rimTone = new T.Color(0x637de8);
  let sector = 0;
  let destination = 0;
  let sectorTint = sectorTints[0];
  const sky = new T.Mesh(new T.SphereGeometry(310,24,16),new T.ShaderMaterial({
    side:T.BackSide,depthWrite:false,depthTest:false,
    vertexShader:skyVertex,fragmentShader:skyFragment,
    uniforms:{
      cloudAtlas:{value:nebula},tint:{value:palette},pale:{value:pale},
      world:{value:new T.Vector3()},planetRadius:{value:.26},rings:{value:0},
      storm:{value:.2},time:{value:0},
      sunlight:{value:incident},ringInclination:{value:new T.Vector3(.46,.67,.38)},
      curtain:{value:0},wind:{value:.3},boost:{value:0}
    }
  }));
  sky.renderOrder = -50;
  scene.add(sky);
  const stars = makeStarDome(next);
  scene.add(stars);
  const hemisphere = new T.HemisphereLight(0xdde7ff,0x4a4668,1.58);
  const key = new T.DirectionalLight(0xefe2cd,2.84);
  key.position.set(-7,10,4);
  const rim = new T.DirectionalLight(0x866bf4,2.91);
  rim.position.set(7,2,-11);
  scene.add(hemisphere,key,rim);

  const gates = createGates(scene,next);
  const cliffs = makeCliffs(scene,next);
  const trails = createStreaks(scene,next);

  function setSector(index,tint=sectorTints[index],level=destination) {
    sector = index;
    sectorTint = tint;
    destination = level;
    const profile = settings[index] ?? settings[0];
    const [yaw,lift,curtain,sunlight] = orbits[level] ?? orbits[0];
    palette.setHex(tint);
    incident.setHex(sunlight).lerp(bluewhite,.09);
    pale.copy(palette).lerp(incident,.36).lerp(bluewhite,.30);
    const params = sky.material.uniforms;
    const flip = (level+index)%4===2 ? -1 : 1;
    params.world.value.set((profile.world[0]+yaw*.51)*flip,profile.world[1]+lift,profile.world[2]);
    params.planetRadius.value = T.MathUtils.clamp(profile.radius+yaw*.18+lift*.26,.13,.37);
    params.rings.value = T.MathUtils.clamp(profile.rings+lift*1.8,0,1);
    params.ringInclination.value.set(.46+yaw*.7,.67+lift*.38,.38+lift*.52);
    params.storm.value = T.MathUtils.clamp(profile.storm+curtain*.48,0,1);
    params.curtain.value = curtain;
    params.wind.value = profile.drift;
    scene.fog.color.copy(palette).multiplyScalar(.11).lerp(shadow,.47);
    scene.fog.density = profile.fog*(1+curtain*.16);
    gates.glowMaterial.color.copy(pale).multiplyScalar(1.31);
    gates.edgeMaterial.color.copy(pale).multiplyScalar(.31);
    gates.deckMaterial.color.copy(palette).multiplyScalar(.19).lerp(gateMetal,.51);
    key.color.copy(incident);
    rim.color.copy(palette).lerp(rimTone,.23);
  }

  function draw(dt,state,camera) {
    if (Number.isInteger(state.level) && state.level !== destination) setSector(sector,sectorTint,state.level);
    sky.position.copy(camera.position);
    stars.position.copy(camera.position);
    sky.material.uniforms.time.value = state.reducedMotion ? 0 : state.time;
    const boost = sky.material.uniforms.boost;
    boost.value += ((state.boosting&&!state.reducedMotion ? 1 : 0)-boost.value)*(1-Math.exp(-dt*4.8));
    stars.material.uniforms.time.value = state.reducedMotion ? 0 : state.time;
    gates.draw(dt,state);
    cliffs.draw(dt,state);
    trails.draw(dt,state);
  }

  setSector(0);
  return {draw,setSector};
}

const enemyProfile = {
  scout:   {span:1.72, depth:1.36, hull:0x394d62, light:0x78e7ff, lightBody:0x55bad5},
  trapper: {span:2.28, depth:1.08, hull:0x593e3b, light:0xffae65, lightBody:0xce7147},
  gunner:  {span:1.84, depth:1.57, hull:0x592c4d, light:0xff759d, lightBody:0xd85372},
  bulwark: {span:2.23, depth:1.10, hull:0x4d4568, light:0xc5a4ff, lightBody:0x835fd4}
};

export const raiderVariants = Object.keys(enemyProfile);
const engineGeo = new T.CylinderGeometry(.24,.32,1.04,7);
const plate = new T.BoxGeometry(1,1,1);
const emitterGeo = new T.OctahedronGeometry(.42);
const podGeo = new T.DodecahedronGeometry(.54,0);
const brace = new T.TorusGeometry(.72,.079,6,18);
const lightLine = new T.BoxGeometry(.72,.059,.101);

export function makeRaider(variant,glow) {
  const profile = enemyProfile[variant] ?? enemyProfile.trapper;
  const {hull,light,span,depth,lightBody} = profile;
  const group = new T.Group();
  const body = new T.MeshStandardMaterial({color:hull,metalness:.52,roughness:.37,flatShading:true,side:T.DoubleSide});
  const armor = new T.MeshStandardMaterial({color:hull,metalness:.67,roughness:.58,flatShading:true,side:T.DoubleSide});
  armor.color.multiplyScalar(.56);
  const signaller = new T.MeshBasicMaterial({color:light});
  const chassis = planarFace(
    [[0,.13,depth*1.32],[-.72,-.05,.24],[-.47,-.27,-depth],[.47,-.27,-depth],
      [.72,-.05,.24],[0,.43,depth*.18],[0,-.49,-.06]],
    [0,1,5,0,5,4,1,2,5,2,3,5,3,4,5,0,6,1,0,4,6,1,6,2,2,6,3,3,6,4],
    body
  );
  group.add(chassis);
  const lens = new T.Mesh(emitterGeo,signaller);
  lens.scale.set(.66,.40,1.34);
  lens.position.set(0,.223,depth*.86);
  group.add(lens);
  for (const side of [-1,1]) {
    const wing = planarFace(
      [[side*.42,.13,depth*.72],[side*span,.09,variant==='scout' ? -.99 : .04],
        [side*(span-.46),-.20,-depth*.83],[side*.44,-.19,-.62],
        [side*(span*.72),.38,-depth*.32]],
      [0,1,4,1,2,4,2,3,4,3,0,4,0,3,2,0,2,1],armor
    );
    group.add(wing);
    const lamp = new T.Mesh(lightLine,signaller);
    lamp.position.set(side*(span*.73),.17,.34);
    lamp.rotation.y=side*(variant==='scout' ? -.56 : -.12);
    group.add(lamp);

    const drive = new T.Mesh(engineGeo,armor);
    drive.rotation.x=Math.PI/2;
    drive.position.set(side*.58,-.07,-depth*.52);
    group.add(drive);

    if (variant==='trapper' || variant==='bulwark') {
      const pod = new T.Mesh(podGeo,body);
      pod.scale.set(.86,variant==='bulwark' ? 1.21 : .73,1.61);
      pod.position.set(side*(span*.72),-.18,-.39);
      group.add(pod);
      const crystal = new T.Mesh(emitterGeo,signaller);
      crystal.position.set(side*(span*.71),-.13,.48);
      crystal.scale.set(.58,.36,.53);
      group.add(crystal);
    }
    if (variant==='gunner') {
      const cannon = new T.Mesh(engineGeo,body);
      cannon.scale.set(.67,1.66,.67);
      cannon.rotation.x=Math.PI/2;
      cannon.position.set(side*1.13,.21,.65);
      group.add(cannon);
      const muzzle = new T.Mesh(emitterGeo,signaller);
      muzzle.position.set(side*1.13,.21,1.53);
      muzzle.scale.setScalar(.34);
      group.add(muzzle);
    }
    if (variant==='bulwark') {
      const panel = new T.Mesh(plate,body);
      panel.scale.set(.64,.83,1.12);
      panel.rotation.z=side*-.23;
      panel.position.set(side*1.41,.10,.47);
      group.add(panel);
    }
  }
  if (variant==='bulwark') {
    const cage = new T.Mesh(brace,signaller);
    cage.position.z = .8;
    cage.scale.set(1.24,.83,1);
    group.add(cage);
  }
  const halo = glow(lightBody,variant==='bulwark' ? 6.2 : 4.8,.47);
  halo.position.z=.11;
  group.add(halo);
  return group;
}
