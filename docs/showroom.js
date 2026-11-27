import * as T from './three.module.min.js';
import {buildShipModel} from './ship-models.js';

const views = {orbit:[-2.47,.52],nose:[Math.PI,.19],top:[Math.PI,Math.PI/2-.035],rear:[.52,.41]};

export function showroom(host) {
  const renderer = new T.WebGLRenderer({antialias:true,alpha:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.65));
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  host.replaceChildren(renderer.domElement);
  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(36,1,.1,80);
  const deck = new T.Mesh(new T.CylinderGeometry(3.85,4.10,.34,72),new T.MeshStandardMaterial({
    color:0x151626,roughness:.70,metalness:.29
  }));
  deck.position.y = -1.25;
  scene.add(deck,new T.HemisphereLight(0xe2edff,0x695991,1.38));

  const guide = new T.MeshBasicMaterial({color:0xaa83f4,toneMapped:false});
  for (const [radius,thickness] of [[3.76,.018],[3.58,.011],[2.89,.009]]) {
    const ring = new T.Mesh(new T.TorusGeometry(radius,thickness,4,80),guide);
    ring.rotation.x = -Math.PI/2;
    ring.position.y = -1.07;
    scene.add(ring);
  }
  const markers = new T.InstancedMesh(new T.BoxGeometry(.032,.014,.15),guide,24);
  const mark = new T.Object3D();
  for (let i=0; i<markers.count; i++) {
    const angle=i*Math.PI/12;
    mark.position.set(3.68*Math.sin(angle),-1.063,3.68*Math.cos(angle));
    mark.rotation.y=angle;
    mark.updateMatrix();
    markers.setMatrixAt(i,mark.matrix);
  }
  scene.add(markers);

  // A soft contact shadow remains legible at low viewing angles without a second render pass.
  const shadow = new T.Mesh(new T.PlaneGeometry(6.7,5.1),new T.ShaderMaterial({
    depthWrite:false,transparent:true,
    vertexShader:'varying vec2 uvPos; void main(){uvPos=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader:'varying vec2 uvPos; void main(){float r=length(uvPos-.5)*2.0; gl_FragColor=vec4(.012,.012,.026,.72*(1.0-smoothstep(.0,1.0,r)));}'
  }));
  shadow.rotation.x=-Math.PI/2;
  shadow.position.y=-1.074;
  scene.add(shadow);

  for (const [x,y,z,color,strength] of [[-4,6,-3,0xe5f4ff,2.64],[3,4,6,0xc5aeff,2.6],[5,2,-3,0xa7f3ff,1.15]]) {
    const light = new T.DirectionalLight(color,strength);
    light.position.set(x,y,z);
    scene.add(light);
  }

  const models = new Map();
  let model, pointer, radius, zoom = 1;
  let [yaw,elevation] = views.orbit;
  function draw() {
    const width=host.clientWidth, height=host.clientHeight;
    if (!width || !height || !model) return;
    camera.aspect=width/height;
    const distance = radius * zoom / (Math.sin(Math.PI/10)*Math.min(1,camera.aspect));
    const floor = Math.cos(elevation)*distance;
    camera.position.set(Math.sin(yaw)*floor,Math.sin(elevation)*distance,Math.cos(yaw)*floor);
    camera.lookAt(0,-.13,0);
    camera.updateProjectionMatrix();
    renderer.setSize(width,height,false);
    renderer.render(scene,camera);
  }

  function magnify(factor) {
    zoom=T.MathUtils.clamp(zoom*factor,.69,1.65);
    draw();
  }

  host.addEventListener('pointerdown',event=>{
    if (pointer || event.button!==0) return;
    pointer={id:event.pointerId,x:event.clientX,y:event.clientY};
    host.setPointerCapture(event.pointerId);
  });
  host.addEventListener('pointermove',event=>{
    if (pointer?.id!==event.pointerId) return;
    yaw-=(event.clientX-pointer.x)*.012;
    elevation=T.MathUtils.clamp(elevation+(event.clientY-pointer.y)*.009,-.05,Math.PI/2-.035);
    pointer.x=event.clientX;
    pointer.y=event.clientY;
    draw();
  });
  for (const type of ['pointerup','pointercancel','lostpointercapture']) {
    host.addEventListener(type,event=>{if (pointer?.id===event.pointerId) pointer=null;});
  }
  host.addEventListener('wheel',event=>{
    event.preventDefault();
    magnify(Math.exp(T.MathUtils.clamp(event.deltaY,-300,300)*.0015));
  },{passive:false});
  new ResizeObserver(draw).observe(host);

  return {
    magnify,
    view(name) {
      [yaw,elevation]=views[name];
      zoom=1;
      draw();
    },
    show(craft,index) {
      if (!models.has(index)) {
        const mesh=buildShipModel(craft,index);
        const size=new T.Box3().setFromObject(mesh).getSize(new T.Vector3());
        models.set(index,{mesh,radius:Math.max(size.x,size.z)*.565});
      }
      if (model) scene.remove(model);
      ({mesh:model,radius}=models.get(index));
      scene.add(model);
      guide.color.setHex(craft.color).multiplyScalar(.64);
      draw();
    }
  };
}
