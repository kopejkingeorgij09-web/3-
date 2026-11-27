import * as T from './three.module.min.js';

// Each airframe has its own canopy, fuselage proportions, and wing plan.
const frames = {
  dart:  [[.47,-1.24],[1.94,.62],[1.54,1.52],[.91,1.27],[.53,.83]],
  fork:  [[.47,-.75],[1.23,-1.32],[1.82,-.94],[1.98,1.47],[1.31,1.56],[.55,.98]],
  sting: [[.48,-.96],[2.57,.94],[2.21,1.65],[1.41,1.02],[.59,1.35]],
  needle:[[.39,-1.51],[.97,-1.11],[1.16,.41],[1.55,1.61],[.84,1.46],[.48,.98]],
  carrier:[[.55,-1.03],[1.59,-.95],[2.29,-.23],[2.29,1.30],[1.75,1.64],[.64,1.22]],
  delta: [[.41,-1.48],[2.60,.35],[2.64,1.28],[1.67,1.14],[.63,1.64]],
  swept: [[.42,-1.24],[1.56,-.82],[2.42,.85],[2.18,1.69],[1.57,.68],[.46,1.15]],
  ring:  [[.45,-.96],[1.46,-1.48],[2.32,-.99],[2.56,.32],[1.85,1.43],[1.14,1.47],[.48,1.04]],
  scythe:[[.44,-.78],[2.27,-1.50],[2.46,-.87],[1.61,.30],[1.90,1.47],[1.12,1.61],[.51,.96]]
};

// [wing plan, span, fuselage width, nose station, canopy station, wing cant, tail fins]
const profiles = [
  ['dart',1,.96,-2.30,-.49,.01,.21],
  ['fork',.96,.98,-2.19,-.45,-.07,.38],
  ['sting',1,1.06,-2.13,-.57,.01,.27],
  ['needle',1.17,.82,-2.72,-.07,.06,.48],
  ['carrier',.89,1.04,-2.09,-.51,-.04,.30],
  ['carrier',1.05,1.27,-2.08,-.83,.04,.49],
  ['delta',.83,1.08,-2.23,-.58,-.06,.38],
  ['needle',1.05,.83,-2.65,-.72,-.08,.62],
  ['fork',1.22,1.27,-2.05,-.28,.07,.56],
  ['ring',.93,.89,-2.39,-.18,.08,.31],
  ['carrier',1.05,1.55,-1.96,-.76,-.05,.54],
  ['swept',.74,.72,-2.79,-.30,.11,.65],
  ['fork',.88,.86,-2.66,-.46,.05,.45],
  ['carrier',.89,1.41,-2.25,-.66,.05,.69],
  ['delta',1.08,1.01,-2.22,-.37,.08,.51],
  ['scythe',.77,1.08,-2.62,.02,-.05,.76],
  ['ring',1.13,1.04,-2.14,-.48,-.04,.39],
  ['swept',1.11,.74,-2.58,-.91,.02,.33],
  ['ring',.92,1.15,-2.09,-.41,.04,.42],
  ['scythe',.96,.87,-2.51,-.61,.11,.65],
  ['carrier',1.17,1.30,-2.29,-.43,.06,.49],
  ['scythe',1.15,.91,-2.36,-.78,-.02,.48],
  ['fork',1.20,1.17,-2.71,-.26,.07,.61],
  ['delta',1.12,1.34,-2.32,-.50,.05,.70]
];

const block = new T.BoxGeometry();
const barrel = new T.CylinderGeometry(1,1,1,12);
const cone = new T.CylinderGeometry(.74,1,1,10);
const nozzle = new T.TorusGeometry(1,.11,5,16);
const disc = new T.CircleGeometry(1,16);
const dome = new T.OctahedronGeometry(1);

function shipMaterials(craft) {
  const accent = new T.Color(craft.color);
  const paint = new T.Color(craft.hull).multiplyScalar(craft.duelReward ? .43 : .74);
  const alloy = (color,roughness,metalness=.28) => new T.MeshStandardMaterial({
    color,roughness,metalness,side:T.DoubleSide
  });
  return {
    paint:alloy(paint,.38),
    panel:alloy(paint.clone().lerp(new T.Color(0xe4e9f4),craft.duelReward ? .17 : .33),.31),
    frame:alloy(paint.clone().multiplyScalar(.25),.46),
    metal:alloy(0x697f9c,.32,.54),
    dark:alloy(0x131b29,.69),
    glass: new T.MeshPhysicalMaterial({color:accent.clone().lerp(new T.Color(0x091724),.80),
      emissive:accent,emissiveIntensity:.08,metalness:.24,roughness:.19,clearcoat:1,side:T.DoubleSide}),
    tint:alloy(accent,.41,.10),
    lamp:new T.MeshBasicMaterial({color:accent.clone().lerp(new T.Color(0xffffff),.28),side:T.DoubleSide}),
    sheen:alloy(accent.clone().lerp(new T.Color(0x6887aa),.63),.18),
    marking:new T.MeshBasicMaterial({color:0xdce9f8,side:T.DoubleSide})
  };
}

export function buildShipModel(craft,index) {
  const [plan,span,width,nose,canopy,cant,tail] = profiles[index] ?? profiles[0];
  const group = new T.Group();
  const materials = shipMaterials(craft);
  const batches = Object.fromEntries(Object.keys(materials).map(key=>[key,[]]));
  const matrix = new T.Matrix4();
  const orientation = new T.Quaternion();
  const rotation = new T.Euler();
  const vector = new T.Vector3();
  const position = new T.Vector3(), scale = new T.Vector3();

  function face(material,points) {
    const vertices = batches[material];
    for (let i=1; i<points.length-1; i++) vertices.push(...points[0],...points[i],...points[i+1]);
  }

  function piece(material,geometry,x,y,z,sx,sy,sz,rx=0,rz=0) {
    position.set(x,y,z);
    scale.set(sx,sy,sz);
    orientation.setFromEuler(rotation.set(rx,0,rz));
    matrix.compose(position,orientation,scale);
    const source = geometry.getAttribute('position');
    for (let i=0; i<(geometry.index?.count ?? source.count); i++) {
      vector.fromBufferAttribute(source,geometry.index ? geometry.index.getX(i) : i).applyMatrix4(matrix);
      batches[material].push(vector.x,vector.y,vector.z);
    }
  }

  // Octagonal cross-sections give the fuselage a continuous keel and bevelled shoulders.
  function section(z,w,height,base=0) {
    return [[-.62,1],[.62,1],[1,.36],[1,-.28],[.57,-.77],[-.57,-.77],[-1,-.28],[-1,.36]]
      .map(([x,y])=>[x*w,y*height+base,z]);
  }
  function connect(a,b,surfaces) {
    for (let i=0; i<a.length; i++) {
      const j=(i+1)%a.length;
      face(surfaces[i%surfaces.length],[a[i],a[j],b[j],b[i]]);
    }
  }
  function loft(sections,surfaces,end='frame') {
    sections.slice(1).forEach((current,i)=>connect(sections[i],current,surfaces));
    face(end,[...sections[0]].reverse());
    face(end,sections.at(-1));
  }
  loft([
    section(nose,.075,.065,-.025),
    section(nose*.67,width*.39,.23),
    section(-.68,width*.69,.33),
    section(.34,width*.77,.41),
    section(1.27,width*.67,.34),
    section(1.53,width*.47,.22)
  ],['panel','paint','frame','metal','dark','metal','frame','paint']);
  const glazing = [
    section(canopy-.65,.11*width,.105,.255),
    section(canopy-.18,.29*width,.24,.345),
    section(canopy+.30,.32*width,.31,.359),
    section(canopy+.66,.22*width,.155,.43)
  ];
  loft(glazing,['glass','glass','frame','dark','dark','dark','frame','glass'],'metal');
  for (const [i,fraction] of [[0,.15],[1,.29]]) {
    const streak=([x,y,z],scale)=>[x*scale,y+.005,z];
    face('sheen',[streak(glazing[i][0],.97),streak(glazing[i][0],.97-fraction),
      streak(glazing[i+1][0],.97-fraction),streak(glazing[i+1][0],.97)]);
  }
  const canopyBrace = section(canopy+.27,.324*width,.313,.361);
  connect(canopyBrace,section(canopy+.32,.322*width,.307,.363),['metal']);
  piece('frame',block,0,.422,1.00,.44,.09,.36);
  for (let vent=0; vent<4; vent++) {
    piece(vent===0 ? 'tint' : 'metal',block,0,.476,.872+vent*.089,.36,.017,.035);
  }

  for (const side of [-1,1]) {
    const mirrored = points=>side===1 ? points : [...points].reverse();
    const wing = frames[plan].map(([x,z],i)=>{
      const reach = i===0 || i===frames[plan].length-1 ? x*width : x*span;
      return [side*reach,.115+reach*cant,z];
    });
    // Triangulate the planar wing outline, including the concave swept tips.
    const outline = wing.map(([x,,z])=>new T.Vector2(x,z));
    const triangles = T.ShapeUtils.triangulateShape(outline,[]);
    const center = wing.reduce(([cx,cy,cz],[x,y,z])=>[cx+x/wing.length,cy+y/wing.length,cz+z/wing.length],[0,0,0]);
    const inset = wing.map(([x,y,z])=>[T.MathUtils.lerp(x,center[0],.083),y+.054,T.MathUtils.lerp(z,center[2],.083)]);
    const bottom = wing.map(([x,y,z])=>[x,y-.17,z]);
    connect(mirrored(wing),mirrored(inset),['metal','frame','metal']);
    connect(mirrored(bottom),mirrored(wing),['frame','frame','dark']);
    for (const [a,b,c] of triangles) {
      face('paint',mirrored([inset[a],inset[b],inset[c]]));
      face('frame',mirrored([bottom[c],bottom[b],bottom[a]]));
    }
    // Follow a structural triangle so the upper plating and vents never bridge a cutout.
    const outlineArea = ([a,b,c])=>Math.abs(
      (inset[b][0]-inset[a][0])*(inset[c][2]-inset[a][2]) -
      (inset[b][2]-inset[a][2])*(inset[c][0]-inset[a][0]));
    const [a,b,c] = triangles.reduce((best,triangle)=>outlineArea(triangle)>outlineArea(best) ? triangle : best);
    const armor = (u,v,lift) => inset[a].map((origin,i)=>
      origin*(1-u-v)+inset[b][i]*u+inset[c][i]*v+(i===1 ? lift : 0));
    const laminate = [[.13,.16],[.55,.16],[.64,.29],[.44,.47],[.13,.61]];
    const armorFeet = laminate.map(([u,v])=>armor(u,v,.001));
    const armorFace = laminate.map(([u,v])=>armor(u,v,.037));
    connect(mirrored(armorFeet),mirrored(armorFace),['frame','dark']);
    face('panel',mirrored(armorFace));
    const slot = (u,v,length,depth,lift)=>mirrored([
      armor(u,v,lift),armor(u+length,v,lift),armor(u+length,v+depth,lift),armor(u,v+depth,lift)
    ]);
    for (let rib=0; rib<4; rib++) {
      face(rib===0 ? 'tint' : 'frame',slot(.174+rib*.057,.235,.027,.16,.039));
    }
    face('marking',slot(.19,.43,.13,.018,.039));
    for (const edge of [1,wing.length-3]) {
      const a=inset[edge], b=inset[edge+1];
      const stripe = (along,inside,lift=0) => {
        const x=T.MathUtils.lerp(T.MathUtils.lerp(a[0],b[0],along),center[0],inside);
        return [x,.177+Math.abs(x)*cant+lift,T.MathUtils.lerp(T.MathUtils.lerp(a[2],b[2],along),center[2],inside)];
      };
      face('tint',mirrored([stripe(.10,.03),stripe(.90,.03),stripe(.90,.14),stripe(.10,.14)]));
      face('lamp',mirrored([stripe(.51,.045,.008),stripe(.80,.045,.008),stripe(.80,.075,.008),stripe(.51,.075,.008)]));
    }

    const engineX=side*.56;
    // Nozzle centres are also the flight exhaust attachment points.
    piece('frame',barrel,engineX,0,1.009,.31,.98,.31,Math.PI/2);
    piece('metal',cone,engineX,0,1.32,.322,.36,.322,Math.PI/2);
    piece('dark',disc,engineX,0,1.505,.261,.261,1);
    piece('lamp',disc,engineX,0,1.514,.150,.150,1);
    piece('tint',nozzle,engineX,0,1.528,.207,.207,.20);
    piece('metal',nozzle,engineX,0,1.513,.263,.263,.24);
    for (let slot=0; slot<6; slot++) {
      const phi=slot*Math.PI/3;
      piece('frame',block,engineX+Math.cos(phi)*.296,Math.sin(phi)*.296,1.24,.10,.045,.28,0,phi);
    }

    const finX = side*(.71*width+.16);
    const rakedFin = [
      [finX,.18,.30],[finX+side*.16,.24+tail,.80],
      [finX+side*.22,.29+tail,1.31],[finX,.13,1.49]
    ];
    const finFoot = rakedFin.map(([x,y,z])=>[x-side*.085,y-.045,z]);
    face('panel',mirrored(rakedFin));
    face('frame',mirrored([...finFoot].reverse()));
    connect(mirrored(rakedFin),mirrored(finFoot),['metal','tint','frame']);

    const mountX = side*(.93*width+.12);
    const mountY = .22+Math.abs(mountX)*cant;
    if (craft.rocket) {
      // A cassette with recessed launch cells and external retaining bands.
      piece('frame',block,mountX,mountY+.09,.05,.44,.31,1.31);
      piece('panel',block,mountX,mountY+.255,.07,.35,.062,1.13);
      piece('metal',block,mountX,mountY+.12,-.604,.425,.28,.08);
      for (const offset of [-.104,.104]) {
        piece('dark',disc,mountX+offset,mountY+.12,-.646,.085,.085,1);
        piece('tint',nozzle,mountX+offset,mountY+.12,-.653,.068,.068,.065);
      }
    } else if (craft.sniper || craft.pierce && !craft.prism) {
      const railX=craft.pattern.length>1 ? side*.83 : side*.31;
      piece('frame',block,railX,mountY+.08,-1.26,.25,.24,1.86);
      piece('metal',block,railX,mountY+.208,-1.35,.178,.049,1.74);
      piece('lamp',block,railX,mountY+.236,-1.43,.038,.015,1.44);
      piece('panel',block,railX,mountY+.104,-.48,.33,.27,.40);
    } else if (craft.prism) {
      piece('frame',block,mountX,mountY+.06,-.22,.46,.28,.98);
      piece('glass',dome,mountX,mountY+.22,-.31,.28,.25,.61);
      piece('lamp',block,mountX,mountY+.21,-.75,.22,.051,.26);
    } else {
      const count = craft.spread || craft.cryo ? 2 : 1;
      for (let i=0; i<count; i++) {
        const x=mountX+side*i*.23;
        const z=-.42+i*.23;
        piece('frame',barrel,x,mountY+.05,z,.119,1.12,.119,Math.PI/2);
        piece('metal',barrel,x,mountY+.05,z-.33,.131,.40,.131,Math.PI/2);
        piece('dark',disc,x,mountY+.05,z-.535,.096,.096,1);
        piece('lamp',disc,x,mountY+.05,z-.541,.042,.042,1);
        if (craft.ion || craft.cryo) {
          for (let ring=0; ring<3; ring++) piece('tint',nozzle,x,mountY+.05,z+ring*.14,.133,.133,.13);
        }
      }
    }

    const tip = inset[2];
    piece('frame',block,tip[0],tip[1]+.025,tip[2],.17,.073,.27);
    piece('lamp',block,tip[0],tip[1]+.064,tip[2],.09,.023,.17);
    for (let slash=0; slash<3; slash++) {
      piece('marking',block,side*.54*width,mountY+.19,.61+slash*.075,.092,.019,.029,0,side*.43);
    }
  }

  for (const [key,vertices] of Object.entries(batches)) {
    if (!vertices.length) {
      materials[key].dispose();
      continue;
    }
    const geometry=new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute(vertices,3));
    geometry.computeVertexNormals();
    group.add(new T.Mesh(geometry,materials[key]));
  }
  return group;
}
