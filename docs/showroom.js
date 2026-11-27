import * as T from './three.module.min.js';
import {buildShipModel} from './scene.js';

export function showroom(host) {
  const renderer = new T.WebGLRenderer({antialias:true,alpha:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.6));
  host.replaceChildren(renderer.domElement);
  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(38,1,.1,80);
  const deck = new T.Mesh(new T.CylinderGeometry(3.8,4.1,.38,64),new T.MeshStandardMaterial({color:0x293649,roughness:.64}));
  deck.position.y = -1.14;
  scene.add(deck, new T.HemisphereLight(0xe8f9ff,0x514069,2));
  const ring = new T.Mesh(new T.TorusGeometry(3.65,.035,7,70),new T.MeshBasicMaterial({color:0x63eafb}));
  ring.rotation.x = Math.PI/2;
  ring.position.y = -.93;
  scene.add(ring);
  for (const [x,y,z,color,strength] of [[-4,6,5,0xc8f7ff,3],[6,3,-5,0xb592ff,3.5]]) {
    const light = new T.DirectionalLight(color,strength);
    light.position.set(x,y,z);
    scene.add(light);
  }
  const models = new Map();
  let model, pointer, yaw = .65, pitch = .22, distance = 11.9;
  function draw() {
    if (!host.clientWidth || !model) return;
    const width = host.clientWidth, height = host.clientHeight;
    camera.aspect = width/height;
    camera.position.set(0,3.4,distance*Math.max(1,.92/camera.aspect));
    camera.lookAt(0,-.18,0);
    camera.updateProjectionMatrix();
    model.rotation.set(pitch,yaw,0);
    renderer.setSize(width,height,false);
    renderer.render(scene,camera);
  }
  host.addEventListener('pointerdown',event=>{
    pointer = {id:event.pointerId,x:event.clientX,y:event.clientY};
    host.setPointerCapture(event.pointerId);
  });
  host.addEventListener('pointermove',event=>{
    if (pointer?.id!==event.pointerId) return;
    yaw += (event.clientX-pointer.x)*.012;
    pitch = Math.max(-1.1,Math.min(1.1,pitch+(event.clientY-pointer.y)*.010));
    pointer.x=event.clientX;
    pointer.y=event.clientY;
    draw();
  });
  for (const type of ['pointerup','pointercancel','lostpointercapture']) host.addEventListener(type,()=>{pointer=null;});
  host.addEventListener('wheel',event=>{
    event.preventDefault();
    distance = Math.max(8.4,Math.min(17,distance+event.deltaY*.011));
    draw();
  },{passive:false});
  new ResizeObserver(draw).observe(host);
  return {show(craft,index) {
    if (model) scene.remove(model);
    if (!models.has(index)) models.set(index,buildShipModel(craft,index));
    model=models.get(index);
    scene.add(model);
    ring.material.color.setHex(craft.color);
    draw();
  }};
}
