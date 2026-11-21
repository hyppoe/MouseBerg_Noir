import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { toonMaterial, createRubberHoseMesh, setInkCel, graffitiTexture, architectureTexture, cobblestoneTexture, brickworkTexture, skylineFacadeTexture, noirSkyTexture, goldRimTexture, comicText, burst, rubberHoseCast, rubberHoseTexture } from './comicShader.js';

export const SPAWN_PLAYER = Object.freeze({x: 0, z: 56, yaw: 0});
export const SPAWN_BOT = Object.freeze({x: 0, z: -56, yaw: Math.PI});
export const TRIAL_RADIUS=3.2;
const trialRoute = [
  [-14,3.5,49,'COUPE HOP'], [-17,2.6,34,'ALLEY ENTRY'],
  [-23,5,22,'RAMP CLIMB'], [-29,6.7,10,'WALL-RUN CATWALK'],
  [-44,3.1,5.2,'WATCHTOWER LADDER'], [-44,12.4,5.0,'CLIMB THE LADDER'],
  [-44,20,2.2,'WATCHTOWER DECK'], [-30,9.7,-24,'GRAPPLE ACROSS'],
  [-18,3.4,-22,'DIVE TO THE RAMP'], [0,13,-11,'SLAM-JUMP FINISH']
];
const spawnPads = [SPAWN_PLAYER, SPAWN_BOT];
const spawnClearance = 10;

const C={ink:0x141418,slate:0x8f887a,slate2:0x34353a,indigo:0x222328,charcoal:0x222328,plaster:0xe2d9c6,cyan:0xe2d9c6,amber:0xffbe3b,lantern:0xffd166,yellow:0xffd166,pink:0x8f887a};
const originalGeometry = new WeakMap();
const invisible = new THREE.MeshBasicMaterial({visible: false, side: THREE.DoubleSide});

function makeMesh(source, material, position, outlined = true, warp = {}) {
  const [x, y, z] = position;
  const mesh = createRubberHoseMesh(source, {material, outlined, seed: x * .27 + y * .11 + z * .18, ...warp});
  mesh.position.set(x, y, z);
  mesh.userData.inkedArt = true;
  originalGeometry.set(mesh, source);
  return mesh;
}

function solidProxy(source, position, rotation) {
  const proxy = new THREE.Mesh(source, invisible);
  proxy.position.set(...position);
  if (rotation) proxy.rotation.copy(rotation);
  return proxy;
}

function verifySpawnClearance(solids) {
  for (const {x,z} of spawnPads) {
    for (const {object,box} of solids) {
      const dx = Math.max(box.min.x - x, x - box.max.x, 0);
      const dz = Math.max(box.min.z - z, z - box.max.z, 0);
      if (Math.hypot(dx, dz) < spawnClearance) {
        throw new Error(`Spawn pad (${x}, ${z}) needs ${spawnClearance} units of clearance from the solid at (${object.position.toArray().join(', ')}).`);
      }
    }
  }
}

function addSpawnMarkings(scene) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.lineCap = 'round';
  for (const [radius, width, color] of [[103, 5, '#211c1a59'], [100, 3, '#f4e6c875'], [86, 2, '#e2d2b34d']]) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    for (let part = 0; part < 8; part++) {
      const start = part * Math.PI / 4 + .03;
      ctx.beginPath();
      for (let step = 0; step <= 14; step++) {
        const angle = start + step / 14 * (.60 + .05 * Math.sin(part * 2));
        const r = radius + 2 * Math.sin(angle * 7) + Math.sin(angle * 13);
        const x = 128 + r * Math.cos(angle), y = 128 + r * Math.sin(angle);
        if (step === 0) ctx.moveTo(x,y);
        else ctx.lineTo(x,y);
      }
      ctx.stroke();
    }
  }
  // A small chalk chevron points back into the courtyard from each pad.
  ctx.strokeStyle = '#f4e6c875';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(115,55);
  ctx.lineTo(128,43);
  ctx.lineTo(142,56);
  ctx.stroke();
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  const geometry = new THREE.PlaneGeometry(5.4,5.4);
  const material = new THREE.MeshBasicMaterial({map, transparent:true, depthWrite:false, opacity:.66});
  for (const {x,z,yaw} of spawnPads) {
    const decal = new THREE.Mesh(geometry,material);
    decal.name = 'Spawn pad chalk';
    decal.position.set(x,.02,z);
    decal.rotation.set(-Math.PI/2,0,yaw);
    scene.add(decal);
  }
}

function batchStaticArt(scene, staticRoots) {
  const batches = new Map();
  for (const root of staticRoots) {
    root.updateWorldMatrix(true, true);
    const tile = [Math.floor(root.position.x / 32), Math.floor(root.position.z / 32)].join('/');
    root.traverse(object => {
      if (!object.geometry?.attributes.position.count) return;
      const {geometry, material, castShadow, receiveShadow, isLineSegments} = object;
      const key = [tile, material.id, castShadow, receiveShadow, !!isLineSegments, !!geometry.index].join('/');
      if (!batches.has(key)) batches.set(key, {material, castShadow, receiveShadow, isLineSegments, parts: []});
      batches.get(key).parts.push(geometry.clone().applyMatrix4(object.matrixWorld));
    });
    root.removeFromParent();
    root.traverse(object => object.geometry?.dispose());
    originalGeometry.delete(root);
  }
  for (const {material, castShadow, receiveShadow, isLineSegments, parts} of batches.values()) {
    const geometry = parts.length === 1 ? parts[0] : mergeGeometries(parts);
    if (parts.length > 1) for (const part of parts) part.dispose();
    const batch = isLineSegments ? new THREE.LineSegments(geometry, material) : new THREE.Mesh(geometry, material);
    batch.castShadow = castShadow;
    batch.receiveShadow = receiveShadow;
    scene.add(batch);
  }
}

function inkStreetDetails(scene, staticRoots) {
  const primitiveTypes=new Set(['BoxGeometry','CylinderGeometry','SphereGeometry','TorusGeometry']);
  const details=[];
  scene.traverse(object=>{
    if(object.isMesh&&!object.userData.inkedArt&&!object.material.transparent&&object.material.visible&&
      primitiveTypes.has(object.geometry.type)) details.push(object);
  });
  for(const detail of details){
    const {geometry,material,parent}=detail;
    const flatMark=geometry.type==='BoxGeometry'&&geometry.parameters.height<=.08;
    const mesh=makeMesh(geometry,material,detail.position.toArray(),!flatMark,flatMark?{flare:0,bow:0}:undefined);
    mesh.quaternion.copy(detail.quaternion);
    mesh.scale.copy(detail.scale);
    mesh.castShadow=detail.castShadow;mesh.receiveShadow=detail.receiveShadow;
    parent.remove(detail);
    parent.add(mesh);
    geometry.dispose();
    if(parent===scene)staticRoots.add(mesh);
    else if(parent.parent===scene)staticRoots.add(parent);
  }
}
function buildBlobTexture(){
  const canvas=document.createElement('canvas');canvas.width=128;canvas.height=128;const ctx=canvas.getContext('2d');
  const g=ctx.createRadialGradient(64,64,7,64,64,62);g.addColorStop(0,'rgba(11,11,13,.48)');g.addColorStop(.52,'rgba(11,11,13,.27)');g.addColorStop(1,'rgba(11,11,13,0)');ctx.fillStyle=g;ctx.fillRect(0,0,128,128);
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;return texture;
}
function addShadow(scene,texture,x,z,w,d,y=.015){const p=new THREE.Mesh(new THREE.PlaneGeometry(w,d),new THREE.MeshBasicMaterial({map:texture,transparent:true,depthWrite:false,opacity:.85}));p.rotation.x=-Math.PI/2;p.position.set(x,y,z);p.renderOrder=1;scene.add(p);return p;}
function radialTexture(center='#ffe89e',edge='rgba(255,207,72,0)'){
  const canvas=document.createElement('canvas');canvas.width=canvas.height=256;const ctx=canvas.getContext('2d');const g=ctx.createRadialGradient(128,128,0,128,128,128);g.addColorStop(0,center);g.addColorStop(.2,'rgba(255,232,158,.72)');g.addColorStop(.56,'rgba(255,207,72,.2)');g.addColorStop(1,edge);ctx.fillStyle=g;ctx.fillRect(0,0,256,256);const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;return texture;
}
function coneGradientTexture(){
  const canvas=document.createElement('canvas');canvas.width=32;canvas.height=256;const ctx=canvas.getContext('2d'),g=ctx.createLinearGradient(0,0,0,256);g.addColorStop(0,'rgba(255,232,158,.015)');g.addColorStop(.2,'rgba(255,232,158,.07)');g.addColorStop(.72,'rgba(255,207,72,.15)');g.addColorStop(1,'rgba(255,207,72,.03)');ctx.fillStyle=g;ctx.fillRect(0,0,32,256);const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;return texture;
}
function enemyBadgeTexture(){const canvas=document.createElement('canvas');canvas.width=256;canvas.height=64;const ctx=canvas.getContext('2d');ctx.fillStyle='#0b0b0d';ctx.fillRect(0,0,256,64);ctx.fillStyle='#faf6eb';ctx.fillRect(5,5,246,54);ctx.fillStyle='#a61922';ctx.fillRect(10,10,236,44);ctx.fillStyle='#faf6eb';ctx.beginPath();ctx.moveTo(128,55);ctx.lineTo(112,40);ctx.lineTo(144,40);ctx.closePath();ctx.fill();ctx.strokeStyle='#0b0b0d';ctx.lineWidth=3;ctx.stroke();const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;return texture;}
function lanternMesh(){
  const group=new THREE.Group(), glass=toonMaterial(C.lantern,{emissive:C.amber,emissiveIntensity:1.25}), iron=toonMaterial(C.indigo);
  const profile=[[.18,-.44],[.32,-.38],[.4,-.18],[.42,.04],[.36,.31],[.19,.43]];
  group.add(makeMesh(new THREE.LatheGeometry(profile.map(p=>new THREE.Vector2(...p)),16),glass,[0,0,0]));
  for(const y of [-.42,.42]){
    const cap=makeMesh(new THREE.TorusGeometry(.215,.047,8,18),iron,[0,y,0]);
    cap.rotation.x=Math.PI/2;
    group.add(cap);
  }
  group.add(makeMesh(new THREE.CylinderGeometry(.022,.022,.58,8),iron,[0,.7,0]));
  return group;
}
function makeBird(scene){
  const group=new THREE.Group(),wingMat=new THREE.MeshBasicMaterial({color:C.ink,side:THREE.DoubleSide});
  const wingShape=new THREE.Shape();wingShape.moveTo(0,0);wingShape.quadraticCurveTo(-.24,.18,-.82,.52);wingShape.quadraticCurveTo(-.67,.12,-.38,-.05);wingShape.quadraticCurveTo(-.12,-.11,0,0);wingShape.closePath();const left=new THREE.Mesh(new THREE.ShapeGeometry(wingShape),wingMat),right=new THREE.Mesh(new THREE.ShapeGeometry(wingShape),wingMat);left.position.x=-.02;right.scale.x=-1;right.position.x=.02;group.add(left,right);
  const body=new THREE.Mesh(new THREE.SphereGeometry(.12,8,6),new THREE.MeshBasicMaterial({color:C.ink}));body.scale.set(1.8,.72,.7);group.add(body);const beak=new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(.15,-.01,.01),new THREE.Vector3(.34,-.02,.01)]),new THREE.LineBasicMaterial({color:C.ink}));group.add(beak);scene.add(group);return group;
}

export function buildArena(scene){
  const colliders = [], grappleTargets = [], ramps = [], ladders = [], birds = [], streetLights = [];
  const animatedProps = [], staticRoots = new Set(), solidSources = [];
  const jumpPuffs = [];
  const puffGeometry = new THREE.SphereGeometry(1,16,10);
  const gadgets = [];
  const gadgetRay = new THREE.Raycaster();
  const smokeRay = new THREE.Line3();
  const nearestSmoke = new THREE.Vector3();
  const finishStars = [];
  const trialCheckpoints=trialRoute.map(([x,y,z,hint])=>({position:new THREE.Vector3(x,y,z),hint}));
  const course=new THREE.Group();
  course.name='Rooftop Time-Trials pocket watches';
  course.visible=false;
  scene.add(course);
  const watchGold = toonMaterial(0xefaa2f,{emissive:0xf2a324,emissiveIntensity:.48});
  const watchInk = new THREE.MeshBasicMaterial({color:0x131219});
  const rimGeometry=new THREE.TorusGeometry(TRIAL_RADIUS,.15,10,48);
  const borderGeometry=new THREE.TorusGeometry(TRIAL_RADIUS,.235,10,48);
  const knobGeometry=new THREE.BoxGeometry(.57,.42,.52);
  const watchTickGeometry=new THREE.BoxGeometry(.072,.31,.09);
  const watches=trialCheckpoints.map(({position})=>{
    const watch=new THREE.Group();
    watch.position.copy(position);
    watch.add(new THREE.Mesh(borderGeometry,watchInk));
    for(const side of [-1,1]){
      const rim=new THREE.Mesh(rimGeometry,watchGold);
      rim.position.z=.17*side;
      watch.add(rim);
    }
    const knob=new THREE.Mesh(knobGeometry,watchGold);
    knob.position.set(0,TRIAL_RADIUS+.27,0);
    watch.add(knob);
    for(let i=0;i<12;i++){
      const angle=i*Math.PI/6, tick=new THREE.Mesh(watchTickGeometry,watchGold);
      tick.position.set(Math.sin(angle)*2.89,Math.cos(angle)*2.89,.16);
      tick.rotation.z=-angle;
      watch.add(tick);
    }
    course.add(watch);
    return watch;
  });
  const beacon=new THREE.Mesh(new THREE.CylinderGeometry(.34,.09,27,12),
    new THREE.MeshBasicMaterial({color:0xffc451,transparent:true,opacity:.45,depthWrite:false,blending:THREE.AdditiveBlending}));
  course.add(beacon);
  let activeTrial=-1;
  function showTrialCheckpoint(index=-1){
    activeTrial=index;
    course.visible=index>=0;
    watches.forEach((watch,number)=>watch.visible=number===index);
    if(index>=0){
      beacon.position.copy(trialCheckpoints[index].position);
      beacon.position.y+=16.5;
    }
  }
  const starShape = new THREE.Shape();
  for(let i=0;i<10;i++){
    const angle=i*Math.PI/5, radius=i%2?.19:.43;
    const x=Math.sin(angle)*radius,y=Math.cos(angle)*radius;
    if(i===0)starShape.moveTo(x,y);else starShape.lineTo(x,y);
  }
  starShape.closePath();
  const starGeometry=new THREE.ShapeGeometry(starShape);

  function spawnJumpPuffs(feet) { spawnInkPuffs(feet,false); }

  function spawnInkPuffs(position,blast) {
    const group = new THREE.Group();
    group.name = blast?'Gadget ink-smoke cloud':'Double jump ink-puff ring';
    group.position.copy(position);
    const white = toonMaterial(0xfffcf2,{transparent:true,depthWrite:false});
    const ink = new THREE.MeshBasicMaterial({color:0x0c0c10,side:THREE.BackSide,transparent:true,depthWrite:false});
    const count=blast?24:12;
    const soot=blast?new THREE.MeshBasicMaterial({color:0x222129,transparent:true,depthWrite:false}):null;
    const puffs = Array.from({length:count},(_,i) => {
      const mesh = new THREE.Mesh(puffGeometry,blast&&i%3===0?soot:white);
      mesh.renderOrder = 1;
      const outline = new THREE.Mesh(puffGeometry,ink);
      outline.scale.setScalar(1.12);
      mesh.add(outline);
      group.add(mesh);
      const angle = i * Math.PI * 2 / count;
      return {mesh,x:Math.cos(angle),z:Math.sin(angle),size:.32+.09*Math.sin(i*3.7),lift:.4+(i%6)*.39};
    });
    const ring = {group,puffs,white,ink,soot,blast,age:0,life:blast?1.7:.45};
    updateJumpPuffs(ring);
    scene.add(group);
    jumpPuffs.push(ring);
  }

  function updateJumpPuffs({puffs,white,ink,soot,age,life,blast}) {
    const t = age / life;
    const spread = 1 - (1-t)**2;
    const radius = .64 + 2.1*spread;
    white.opacity = ink.opacity = 1 - THREE.MathUtils.smoothstep(t,.25,1);
    if(soot)soot.opacity=white.opacity*.86;
    for (const {mesh,x,z,size,lift} of puffs) {
      const scale = size * (1 + .5*Math.sin(Math.PI*t)) * (1 - .92*t) * (blast?4:1);
      const swirl=blast?t*1.8*lift:0, reach=radius*(blast?1.5:1);
      mesh.position.set(
        (x*Math.cos(swirl)-z*Math.sin(swirl))*reach,
        blast?lift*(.32+spread):-.06-.37*t,
        (z*Math.cos(swirl)+x*Math.sin(swirl))*reach
      );
      mesh.scale.set(scale*1.12,scale*.76,scale);
    }
  }
  function throwGadget(origin,velocity){
    const mesh=new THREE.Group();
    mesh.name='Cartoon ink bomb';
    mesh.position.copy(origin);
    const shell=toonMaterial(0x9f292c);
    const ink=new THREE.MeshBasicMaterial({color:0x0c0c10,side:THREE.BackSide});
    const tape=new THREE.MeshBasicMaterial({color:0x16161b});
    const sparkMaterial=new THREE.MeshBasicMaterial({color:0xffce5e});
    const geometry=new THREE.CapsuleGeometry(.15,.5,4,10);
    for(let i=0;i<3;i++){
      const angle=i*Math.PI*2/3;
      const stick=new THREE.Mesh(geometry,shell);
      stick.position.set(Math.cos(angle)*.16,0,Math.sin(angle)*.16);
      const outline=new THREE.Mesh(geometry,ink);
      outline.scale.set(1.11,1.05,1.11);
      stick.add(outline);
      mesh.add(stick);
    }
    const band=new THREE.Mesh(new THREE.CylinderGeometry(.295,.295,.16,12),tape);
    const fuse=new THREE.Mesh(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(0,.32,0),new THREE.Vector3(.13,.64,0),new THREE.Vector3(.32,.62,0)
    ),9,.035,5,false),tape);
    const spark=new THREE.Mesh(starGeometry,sparkMaterial);
    spark.position.set(.33,.62,0);
    mesh.add(band,fuse,spark);
    scene.add(mesh);
    gadgets.push({mesh,velocity:velocity.clone(),spark,age:0,
      geometries:[geometry,band.geometry,fuse.geometry],materials:[shell,ink,tape,sparkMaterial]});
  }
  function removeGadget(gadget){
    scene.remove(gadget.mesh);
    gadget.geometries.forEach(geometry=>geometry.dispose());
    gadget.materials.forEach(material=>material.dispose());
  }
  function clearGadgets(){
    gadgets.forEach(removeGadget);
    gadgets.length=0;
  }
  function updateGadgets(dt,enemies,onExplode){
    for(let i=gadgets.length-1;i>=0;i--){
      const gadget=gadgets[i];
      if(!gadget)continue;
      const {mesh,velocity,spark}=gadget;
      gadget.age+=dt;
      mesh.rotation.x+=dt*6;mesh.rotation.z+=dt*4;
      spark.rotation.y+=dt*26;
      spark.scale.setScalar(.22+.16*Math.abs(Math.sin(gadget.age*61)));
      const steps=Math.max(1,Math.ceil(dt/.008)), step=dt/steps;
      let directHit=null;
      for(let tick=0;tick<steps&&!directHit;tick++){
        velocity.y-=38*step;
        const distance=velocity.length()*step;
        if(distance<1e-6)continue;
        gadgetRay.set(mesh.position,velocity.clone().normalize());
        gadgetRay.far=distance+.055;
        const surface=gadgetRay.intersectObjects(colliders,false)[0];
        const enemy=gadgetRay.intersectObjects(enemies,false)[0];
        if(enemy&&(!surface||enemy.distance<surface.distance)){
          mesh.position.copy(enemy.point);
          directHit=enemy.object;
        }else if(surface){
          const normal=surface.face.normal.clone().transformDirection(surface.object.matrixWorld);
          if(normal.dot(velocity)>0)normal.negate();
          mesh.position.copy(surface.point).addScaledVector(normal,.065);
          // Keep tangent speed and apply restitution only perpendicular to the surface.
          velocity.addScaledVector(normal,-1.55*velocity.dot(normal));
          if(normal.y>.7){velocity.x*=.9;velocity.z*=.9;}
        }else mesh.position.addScaledVector(velocity,step);
      }
      if(directHit||gadget.age>=1.6){
        const position=mesh.position.clone();
        removeGadget(gadget);
        gadgets.splice(i,1);
        spawnInkPuffs(position,true);
        comicText(scene,'KA-BOOM!',position.clone().add(new THREE.Vector3(0,3,0)),'#fcf8ee',2.1,1.15);
        onExplode(position,directHit);
      }
    }
  }
  function smokeBlocksSight(from,to){
    smokeRay.set(from,to);
    return jumpPuffs.some(({blast,age,group})=>{
      if(!blast||age>=1.35)return false;
      smokeRay.closestPointToPoint(group.position,true,nearestSmoke);
      return nearestSmoke.distanceToSquared(group.position)<(2.6+age*1.6)**2;
    });
  }
  function spawnFinishStars(position){
    const group=new THREE.Group(), material=new THREE.MeshBasicMaterial({color:0xffefd2,side:THREE.DoubleSide});
    group.position.copy(position);
    group.name='Finish cam ink stars';
    for(let i=0;i<15;i++){
      const star=new THREE.Mesh(starGeometry,material);
      const angle=i*Math.PI*2/15;
      star.userData.velocity=new THREE.Vector3(Math.cos(angle)*9,3+Math.sin(i*2.4)*4,Math.sin(angle)*9);
      star.scale.setScalar(.6+(i%4)*.15);
      star.rotation.set(i*.63,i*.9,i*.78);
      group.add(star);
    }
    finishStars.push({group,material,age:0});
    scene.add(group);
  }
  const lampGlowTexture = radialTexture();
  const lampPoolTexture = radialTexture('rgba(255,195,75,.24)','rgba(255,190,59,0)');
  const coneTexture = coneGradientTexture();
  const dust = new THREE.Points(new THREE.BufferGeometry(),new THREE.PointsMaterial({color:C.amber,size:.12,transparent:true,opacity:.78,blending:THREE.AdditiveBlending,depthWrite:false}));
  let stepTimer = 0, cel = 0;
  const addArt = object => {
    scene.add(object);
    staticRoots.add(object);
    return object;
  };
  const addProxy = (source, position, rotation) => {
    const proxy = solidProxy(source, position, rotation);
    colliders.push(proxy);
    return proxy;
  };
  const addSolid = object => {
    addArt(object);
    solidSources.push(object);
    return object;
  };
  const addPlatform=object=>{object.userData.isPlatform=true;return addSolid(object);};
  // Invisible ramp proxies extend half a unit past each end so their raycast
  // surfaces overlap adjoining decks without changing the visible ramp mesh.
  const addRamp=(ramp,axis='x')=>{
    addArt(ramp);
    const {width, height, depth} = originalGeometry.get(ramp).parameters;
    const proxy = addProxy(new THREE.BoxGeometry(width + (axis === 'x' ? 1 : 0), height, depth + (axis === 'z' ? 1 : 0)),
      ramp.position.toArray(), ramp.rotation);
    proxy.userData.isRamp = true;
    ramps.push(proxy);
    return ramp;
  };
  const shadowTexture=buildBlobTexture();
  const iron = toonMaterial(0x37343a);
  const nickel = toonMaterial(0xb8ae97);
  const paper = toonMaterial(0xebe2cf);
  const lampGlass = toonMaterial(C.lantern, {emissive: 0xffbd4f, emissiveIntensity: 1.8});
  const lathe = (profile, segments = 20) => new THREE.LatheGeometry(profile.map(([r,y]) => new THREE.Vector2(r,y)), segments);
  const oval = (x,y,z) => new THREE.SphereGeometry(1,24,14).scale(x,y,z);
  const pipe = (points, radius, segments = 24) => new THREE.TubeGeometry(
    new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p))), segments, radius, 9, false);

  // Each emitter shares its pre-inked puff meshes and advances in held cels.
  const lobes = Array.from({length: 6}, (_, i) => {
    const angle = i * Math.PI / 3, radius = .25 + .035 * (i % 3);
    return oval(radius, radius * .74, radius).translate(Math.cos(angle)*.37, Math.sin(i*1.9)*.07, Math.sin(angle)*.37);
  });
  const cloudGeometry = mergeGeometries(lobes);
  const cloud = makeMesh(cloudGeometry, paper, [0,0,0], true, {bow:0,flare:0,jitter:.027});
  cloud.castShadow = false;
  for (const lobe of lobes) lobe.dispose();
  const addSmoke = (x,y,z,{period=3, rise=4, count=3, gap=.13, scale=1, phase=0, visibleFraction=.71}={}) => {
    const puffs = Array.from({length: count}, () => {
      const puff = cloud.clone();
      puff.visible = false;
      scene.add(puff);
      return puff;
    });
    animatedProps.push(time => {
      for (let i = 0; i < puffs.length; i++) {
        const puff = puffs[i], age = ((time / period + phase - i * gap) % 1 + 1) % 1;
        puff.visible = age < visibleFraction;
        if (!puff.visible) continue;
        const progress = age / visibleFraction, pop = 1 - THREE.MathUtils.smoothstep(progress,.77,1);
        puff.position.set(x + .95 * progress + Math.sin(progress*9+i)*progress*.28,
          y + progress*rise, z + Math.cos(progress*8+i)*progress*.35);
        puff.scale.setScalar((.35 + progress*1.28) * scale * (.55 + .45*pop));
        puff.rotation.set(progress*.55, i + progress*2.4, Math.sin(progress*7+i)*.34);
      }
    });
  };
  const pavingTexture=cobblestoneTexture();pavingTexture.wrapS=THREE.RepeatWrapping;pavingTexture.wrapT=THREE.RepeatWrapping;pavingTexture.repeat.set(27,27);pavingTexture.anisotropy=8;
  const floorMaterial=toonMaterial(0xfaf6eb,{map:pavingTexture});
  const floorVisual=makeMesh(new THREE.PlaneGeometry(180,180),floorMaterial,[0,.005,0],false,{flare:0,bow:0});
  floorVisual.rotation.x=-Math.PI/2;
  floorVisual.castShadow=false;
  scene.add(floorVisual);
  const groundCollider = addProxy(new THREE.PlaneGeometry(180,180), [0,0,0], new THREE.Euler(-Math.PI/2,0,0));
  groundCollider.userData.isContinuousFloor = true;
  addSpawnMarkings(scene);
  // Raised pale-stone sidewalks define the block edge, with a low curb lip that remains an easy step.
  const sidewalkTexture=architectureTexture('#b8b1a2','#848078');sidewalkTexture.repeat.set(3,1);
  const sidewalkMat=new THREE.MeshBasicMaterial({color:0xfaf6eb,map:sidewalkTexture});
  for(const z of [-72,72])addPlatform(makeMesh(new THREE.BoxGeometry(160,.12,8),sidewalkMat,[0,.06,z],false));
  for(const x of [-72,72])addPlatform(makeMesh(new THREE.BoxGeometry(8,.12,136),sidewalkMat,[x,.06,0],false));
  const curbMat=new THREE.MeshBasicMaterial({color:0x1c1c20}),curbHighlight=new THREE.MeshBasicMaterial({color:0xb8b1a2});
  for(const z of [-67.85,67.85]){const curb=new THREE.Mesh(new THREE.BoxGeometry(160,.075,.14),curbMat);curb.position.set(0,.08,z);scene.add(curb);const edge=new THREE.Mesh(new THREE.BoxGeometry(160,.025,.045),curbHighlight);edge.position.set(0,.125,z-.035*Math.sign(z));scene.add(edge);}
  const addStreetlamp = (x,z,baseY=0,illuminate=false) => {
    const pivot = new THREE.Group();
    const face = x > 0 ? -1 : 1;
    pivot.position.set(x,baseY,z);
    const crook = pipe([[0,.52,0],[-face*.17,2.15,0],[0,4.7,0],[face*.29,5.77,0],
      [face*1.04,6.03,0],[face*1.61,5.45,0]], .13, 28);
    pivot.add(makeMesh(crook, iron, [0,0,0], true, {flare:0,bow:0}));
    pivot.add(makeMesh(lathe([[.62,0],[.65,.13],[.48,.25],[.29,.32],[.26,.86],[.19,1.03]]), iron, [0,0,0]));
    const headX = face*1.61, headY = 5.21;
    pivot.add(makeMesh(oval(.35,.39,.35), lampGlass, [headX,headY-.15,0]));
    pivot.add(makeMesh(lathe([[.48,0],[.46,.12],[.30,.21],[.18,.34],[0,.41]]), iron, [headX,headY,0]));
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({map:lampGlowTexture,opacity:.55,blending:THREE.AdditiveBlending,depthWrite:false}));
    glow.position.set(headX,headY-.2,0);
    glow.scale.set(3.3,3.3,1);
    pivot.add(glow);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(3.15,headY,24,1,true),
      new THREE.MeshBasicMaterial({color:0xffd782,map:coneTexture,transparent:true,opacity:.2,depthWrite:false,side:THREE.DoubleSide,forceSinglePass:true}));
    cone.position.set(headX,headY/2+.04,0);
    pivot.add(cone);
    scene.add(pivot);
    addProxy(new THREE.BoxGeometry(.72,5.1,.72), [x,baseY+2.55,z]);
    const pool = new THREE.Mesh(new THREE.CircleGeometry(5.2,40),
      new THREE.MeshBasicMaterial({color:0xffe89e,map:lampPoolTexture,transparent:true,opacity:.64,depthWrite:false,blending:THREE.AdditiveBlending}));
    pool.rotation.x=-Math.PI/2;
    pool.position.set(x+headX,baseY+.024,z);
    scene.add(pool);
    if (illuminate) {
      const light = new THREE.PointLight(C.lantern,19,24,1.6);
      light.position.set(headX,headY-.34,0);
      pivot.add(light);
      streetLights.push({light, phase:x*.17+z*.11, base:19});
    }
    animatedProps.push(time => {
      pivot.rotation.z = Math.sin(time*1.07+x*.17+z*.11)*.035;
      pool.position.x = x + headX - Math.sin(pivot.rotation.z)*headY;
    });
  };
  for(const [i,[x,z]] of [[-34,-34],[-34,34],[34,-34],[34,34],[-8,-35],[8,35],[-35,8],[35,-8],[-17,-20],[17,-20],[-61,0],[61,0],[-13,-61],[13,61]].entries()) addStreetlamp(x,z,0,i%2===0);
  for(const sx of [-1,1])for(const sz of [-1,1])addStreetlamp(sx*57,sz*29,8.75);
  // A fine, restrained floor grid and lane trim keep routes legible without checkerboard noise.
  const trimMat=new THREE.MeshBasicMaterial({color:0xe8e1cf,transparent:true,opacity:.34});
  for(const x of [-29,-25,25,29]){const line=new THREE.Mesh(new THREE.BoxGeometry(.11,.025,67),trimMat);line.position.set(x,.018,0);scene.add(line);}
  for(const z of [-30,-25,25,30]){const line=new THREE.Mesh(new THREE.BoxGeometry(69,.028,.1),trimMat);line.position.set(0,.02,z);scene.add(line);}
  for(const [x,z,rot] of [[-24,-15,.15],[24,-15,-.15],[-24,15,-.15],[24,15,.15]]){const line=new THREE.Mesh(new THREE.BoxGeometry(.16,.035,18),trimMat);line.position.set(x,.035,z);line.rotation.y=rot;scene.add(line);}
  // Ivory zebra crossings give players a strong parallax ruler through the plaza.
  const crosswalkMat=new THREE.MeshBasicMaterial({color:0xe8e1cf}),crosswalkInk=new THREE.MeshBasicMaterial({color:0x1c1c20});
  for(const z of [-31,31])for(let i=0;i<8;i++){const x=-15.5+i*4.4,outline=new THREE.Mesh(new THREE.BoxGeometry(2.25,.028,.74),crosswalkInk);outline.position.set(x,.016,z);scene.add(outline);const stripe=new THREE.Mesh(new THREE.BoxGeometry(2.04,.03,.5),crosswalkMat);stripe.position.set(x,.032,z);scene.add(stripe);}
  for(const x of [-31,31])for(let i=0;i<8;i++){const z=-15.5+i*4.4,outline=new THREE.Mesh(new THREE.BoxGeometry(.74,.028,2.25),crosswalkInk);outline.position.set(x,.016,z);scene.add(outline);const stripe=new THREE.Mesh(new THREE.BoxGeometry(.5,.03,2.04),crosswalkMat);stripe.position.set(x,.032,z);scene.add(stripe);}
  // Flush cast-iron covers and drainage grates add readable scale without changing walkable height.
  for(const [x,z] of [[-22,-22],[22,22],[-22,22],[22,-22]]){const disk=new THREE.Mesh(new THREE.CircleGeometry(1.05,40),new THREE.MeshBasicMaterial({color:0x686a70,side:THREE.DoubleSide}));disk.rotation.x=-Math.PI/2;disk.position.set(x,.014,z);scene.add(disk);const rim=new THREE.Mesh(new THREE.TorusGeometry(1.08,.075,6,40),new THREE.MeshBasicMaterial({color:0x1c1c20}));rim.rotation.x=-Math.PI/2;rim.position.set(x,.028,z);scene.add(rim);const inner=new THREE.Mesh(new THREE.TorusGeometry(.7,.025,5,32),new THREE.MeshBasicMaterial({color:0xb8b1a2}));inner.rotation.x=-Math.PI/2;inner.position.set(x,.03,z);scene.add(inner);for(let i=0;i<8;i++){const a=i*Math.PI/4,line=new THREE.Mesh(new THREE.BoxGeometry(.06,.018,.45),new THREE.MeshBasicMaterial({color:0x1c1c20}));line.position.set(x+Math.cos(a)*.43,.034,z+Math.sin(a)*.43);line.rotation.y=-a;scene.add(line);}}
  for(const [x,z,rot] of [[-63,-18,0],[63,18,0],[-18,63,Math.PI/2],[18,-63,Math.PI/2]]){const grate=new THREE.Mesh(new THREE.BoxGeometry(2.8,.025,1.05),crosswalkInk);grate.position.set(x,.018,z);grate.rotation.y=rot;scene.add(grate);for(let i=-5;i<=5;i++){const bar=new THREE.Mesh(new THREE.BoxGeometry(.075,.035,.88),curbHighlight);bar.position.set(x+i*.22,.04,z);bar.rotation.y=rot;scene.add(bar);}}
  // Soft silver puddle glints complement the amber lamp pools without hiding paving detail.
  const puddleCanvas=document.createElement('canvas');puddleCanvas.width=puddleCanvas.height=256;const puddleCtx=puddleCanvas.getContext('2d'),puddleGrad=puddleCtx.createRadialGradient(128,128,5,128,128,126);puddleGrad.addColorStop(0,'rgba(250,246,235,.38)');puddleGrad.addColorStop(.43,'rgba(184,177,162,.22)');puddleGrad.addColorStop(1,'rgba(132,128,120,0)');puddleCtx.fillStyle=puddleGrad;puddleCtx.fillRect(0,0,256,256);puddleCtx.strokeStyle='rgba(250,246,235,.42)';puddleCtx.lineWidth=3;for(let i=0;i<7;i++){puddleCtx.beginPath();puddleCtx.ellipse(128,128,30+i*13,8+i*4,-.15,0,Math.PI);puddleCtx.stroke();}const puddleTexture=new THREE.CanvasTexture(puddleCanvas);puddleTexture.colorSpace=THREE.SRGBColorSpace;
  for(const [x,z,rx,rz,rot] of [[-34,-34,4,1.8,.2],[34,34,3.7,1.7,-.35],[-8,-35,3.4,1.5,.6],[8,35,3.5,1.6,-.5],[-35,8,3.7,1.8,.1],[35,-8,3.4,1.5,.45],[-61,0,3,1.4,-.3],[61,0,3.1,1.5,.25]]){const puddle=new THREE.Mesh(new THREE.CircleGeometry(1,48),new THREE.MeshBasicMaterial({map:puddleTexture,color:0xfaf6eb,transparent:true,opacity:.62,depthWrite:false,side:THREE.DoubleSide}));puddle.rotation.x=-Math.PI/2;puddle.rotation.z=rot;puddle.position.set(x,.024,z);puddle.scale.set(rx,rz,1);puddle.renderOrder=1;scene.add(puddle);}
  const enamel = toonMaterial(0x534f55);
  const rubber = toonMaterial(0x202025);
  const upholstery = toonMaterial(0x3b434b);
  const addCoupe = (x,z,heading) => {
    const car = new THREE.Group();
    car.position.set(x,0,z);
    car.rotation.y = heading;
    const part = (shape,material,p,warp) => {
      const mesh = makeMesh(shape,material,p,true,warp);
      car.add(mesh);
      return mesh;
    };
    part(oval(1.45,.66,3.2),enamel,[0,1.03,0]);
    part(oval(1.16,1.07,1.81),enamel,[0,1.68,-.69]);
    part(oval(.89,.59,1.95),enamel,[0,1.28,1.38]);
    const windshield = part(oval(.86,.53,.14),upholstery,[0,1.99,.83],{flare:0});
    windshield.rotation.x=-.21;
    part(oval(.13,.69,.31),nickel,[0,1.17,3.14]).scale.x=3.7;
    for(const side of [-1,1]){
      const window=part(oval(.21,.46,.99),upholstery,[side*1.03,2.06,-.67]);
      window.rotation.x=.10;
      part(oval(.045,.045,.27),nickel,[side*1.37,1.49,-.78]);
      part(oval(.24,.13,2.21),rubber,[side*1.31,.48,0]);
      part(oval(.34,.30,.33),lampGlass,[side*.9,1.29,2.72]);
      part(oval(.72,.12,.18),nickel,[side*.65,.68,2.97]);
      for(const axle of [-1,1]){
        const wheelZ=axle*1.93;
        part(oval(.58,.48,1.03),enamel,[side*1.18,1.03,wheelZ]);
        for(const [radius,width,offset,material] of [[.64,.36,1.36,rubber],[.49,.07,1.55,paper],[.28,.08,1.60,nickel]]){
          const wheel=part(new THREE.CylinderGeometry(radius,radius,width,24),material,[side*offset,.61,wheelZ],{flare:0,bow:0,jitter:.016});
          wheel.rotation.z=Math.PI/2;
        }
        const pie=part(new THREE.CircleGeometry(.22,12,.6,1.3),rubber,[side*1.647,.61,wheelZ]);
        pie.rotation.y=side*Math.PI/2;
      }
    }
    addArt(car);
    // Two boxes approximate the running boards and cab, leaving the hood climbable.
    for (const [w,h,d,y,offset] of [[3.23,1.44,6.04,.72,0],[2.13,1.19,2.79,2,-.67]]) {
      const sideways=Math.abs(Math.sin(heading))>.5;
      addProxy(new THREE.BoxGeometry(sideways?d:w,h,sideways?w:d),
        [x+Math.sin(heading)*offset,y,z+Math.cos(heading)*offset]);
    }
    addShadow(scene,shadowTexture,x,z,Math.abs(Math.sin(heading))>.5?8:5,Math.abs(Math.sin(heading))>.5?5:8);
  };
  for(const [x,z,heading] of [[-37,1,0],[37,-1,Math.PI],[-14,49,Math.PI/2],[14,-49,-Math.PI/2]])addCoupe(x,z,heading);

  const hydrantPaint=toonMaterial(0x8c5144);
  for(const [i,[x,z]] of [[-34,-25],[34,25],[-27,34],[27,-34],[-65,21],[65,-21],[-21,-65],[21,65]].entries()){
    const hydrant=new THREE.Group();
    hydrant.position.set(x,0,z);
    hydrant.add(makeMesh(lathe([[.65,0],[.63,.14],[.40,.25],[.43,.48],[.46,1.02],[.39,1.22],[.52,1.31],
      [.52,1.45],[.38,1.58],[.17,1.69],[0,1.71]]),hydrantPaint,[0,0,0]));
    for(const side of [-1,1]){
      const cap=makeMesh(lathe([[.24,0],[.32,.11],[.34,.25],[.29,.38],[.16,.45],[0,.45]]),hydrantPaint,[side*.29,.84,0]);
      cap.rotation.z=-side*Math.PI/2;
      hydrant.add(cap);
    }
    hydrant.add(makeMesh(new THREE.DodecahedronGeometry(.17),nickel,[0,1.68,0]));
    scene.add(hydrant);
    addProxy(new THREE.BoxGeometry(1.05,1.53,1.05),[x,.765,z]);
    addSmoke(x,1.64,z,{period:6.6,count:1,rise:1.65,scale:.60,phase:i*.123,visibleFraction:.23});
    animatedProps.push(time=>{
      const bounce=Math.sin(time*5.3+i*.93);
      hydrant.scale.set(1-.12*bounce,1+bounce*(bounce>0?.10:.12),1-.12*bounce);
      hydrant.rotation.z=bounce*.048;
    });
  }
  for(const [i,[x,z]] of [[-22,-22],[22,22],[-22,22],[22,-22]].entries())
    addSmoke(x,.11,z,{period:3.7,rise:2.8,scale:.83,phase:i*.29});

  const barrelWood=toonMaterial(0x685548);
  const addBarrel=(x,z)=>{
    const h=1.75;
    addArt(makeMesh(lathe([[0,0],[.58,0],[.67,.12],[.77,.55],[.81,.91],[.75,1.33],[.63,1.64],[.59,h],[0,h]]),barrelWood,[x,0,z]));
    for(const [y,r] of [[.21,.71],[.58,.79],[1.25,.77],[1.55,.69]]){
      const hoop=makeMesh(new THREE.TorusGeometry(r,.055,8,22),iron,[x,y,z]);
      hoop.rotation.x=Math.PI/2;
      addArt(hoop);
    }
    addProxy(new THREE.BoxGeometry(1.45,h,1.45),[x,h*.5,z]);
    addShadow(scene,shadowTexture,x,z,2.4,2.4);
  };
  for(const [x,z] of [[-39,12],[-40,14],[39,-10],[41,-11],[-19,-36],[20,37],[-55,36],[55,-36]])addBarrel(x,z);
  // Period street furniture and planters dress the plaza edges while keeping
  // the central movement lanes open.
  const ironMat=toonMaterial(C.charcoal),stoneMat=toonMaterial(C.plaster,{map:architectureTexture('#b8b1a2','#848078')}),woodMat=toonMaterial(C.slate,{map:architectureTexture('#686a70','#3a3c42')});
  for(const [x,z] of [[-51,-24],[51,24],[-24,51],[24,-51]]){
    addSolid(makeMesh(new THREE.CylinderGeometry(.18,.24,4.6,8),ironMat,[x,2.3,z],false));
    const face=new THREE.Mesh(new THREE.CircleGeometry(.68,32),new THREE.MeshBasicMaterial({color:0xe8e1cf,side:THREE.DoubleSide}));face.position.set(x,4.65,z+.03);scene.add(face);
    const rim=new THREE.Mesh(new THREE.TorusGeometry(.69,.085,6,32),new THREE.MeshBasicMaterial({color:C.ink}));rim.position.copy(face.position);scene.add(rim);
    for(let mark=0;mark<12;mark++){const a=mark*Math.PI/6,hand=new THREE.Mesh(new THREE.BoxGeometry(.045,.42,.05),new THREE.MeshBasicMaterial({color:C.ink}));hand.position.set(x+Math.sin(a)*.25,4.65+Math.cos(a)*.25,z+.07);hand.rotation.z=-a;scene.add(hand);}
    addSolid(makeMesh(new THREE.CylinderGeometry(.42,.48,.25,8),ironMat,[x,.125,z],false));
  }
  for(const [x,z] of [[-62,-28],[62,28],[-28,62],[28,-62]]){
    const bin=addSolid(makeMesh(new THREE.CylinderGeometry(.55,.66,1.25,10),ironMat,[x,.64,z]));
    const lid=new THREE.Mesh(new THREE.CylinderGeometry(.62,.58,.12,10),stoneMat);lid.position.set(x,1.31,z);scene.add(lid);
    const planter=addSolid(makeMesh(new THREE.BoxGeometry(3.6,.8,2.2),stoneMat,[x*.76,.4,z*.76]));
    const soil=new THREE.Mesh(new THREE.BoxGeometry(3.25,.12,1.85),woodMat);soil.position.set(x*.76,.84,z*.76);scene.add(soil);
    for(let i=0;i<5;i++){const shrub=new THREE.Mesh(new THREE.SphereGeometry(.33+(i%2)*.08,7,5),new THREE.MeshBasicMaterial({color:i%2?0x686a70:0x848078}));shrub.position.set(x*.76-1.25+i*.62,1.15+(i%2)*.1,z*.76);scene.add(shrub);}
  }
  // Individual canvas strips share a drooping side profile and scalloped valance.
  const canvasDark=toonMaterial(0x765051),canvasLight=toonMaterial(0xd4c4a1);
  const awningProfile=new THREE.Shape();
  awningProfile.moveTo(0,.43);
  awningProfile.bezierCurveTo(.79,.33,1.62,.04,2.25,-.45);
  awningProfile.quadraticCurveTo(2.34,-.66,2.29,-.88);
  awningProfile.quadraticCurveTo(2.16,-.96,2.13,-.79);
  awningProfile.lineTo(2.11,-.51);
  awningProfile.bezierCurveTo(1.38,-.04,.60,.22,0,.33);
  awningProfile.closePath();
  const awningStrip=new THREE.ExtrudeGeometry(awningProfile,{depth:.72,bevelEnabled:false,curveSegments:12});
  const theaterSign=(label)=>{
    const canvas=document.createElement('canvas');
    canvas.width=768;canvas.height=128;
    const ctx=canvas.getContext('2d');
    ctx.fillStyle='#29242a';ctx.fillRect(0,0,768,128);
    ctx.strokeStyle='#c3985c';ctx.lineWidth=8;ctx.strokeRect(10,12,748,104);
    ctx.fillStyle='#f5e0b2';ctx.font='bold 58px Georgia';ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillText(label,384,66);
    for(const edge of [29,739])for(const y of [34,64,94]){
      ctx.beginPath();ctx.arc(edge,y,4,0,Math.PI*2);ctx.fill();
    }
    const map=new THREE.CanvasTexture(canvas);
    map.colorSpace=THREE.SRGBColorSpace;
    return new THREE.MeshBasicMaterial({map});
  };
  const venueSigns=['BLUE NOTE JAZZ','BELLWETHER CLUB','FINCH & SONS','THE COPPER ROOM'].map(theaterSign);
  let venue=0;
  for(const sx of [-1,1])for(const sz of [-1,1]){
    const x=sx*57,z=sz*57;
    const side=-sz, awningZ=z+side*8.95;
    for(let stripe=-5;stripe<=5;stripe++){
      const cloth=makeMesh(awningStrip,stripe%2?canvasDark:canvasLight,
        [x+side*(stripe*.71+.36),2.68,awningZ],true,{bow:0,flare:0,jitter:.018,thickness:.55});
      cloth.rotation.y=-side*Math.PI/2;
      addArt(cloth);
    }
    const marquee=new THREE.Mesh(new THREE.PlaneGeometry(8.7,1.16),venueSigns[venue++]);
    marquee.position.set(x,3.69,z+side*9.1);
    marquee.rotation.y=side>0?0:Math.PI;
    scene.add(marquee);
    addArt(makeMesh(new THREE.BoxGeometry(9.02,1.36,.27),nickel,[x,3.69,z+side*8.92]));
  }
  const newsMat=new THREE.MeshBasicMaterial({map:graffitiTexture('MOUSEBERG DAILY'),side:THREE.DoubleSide});
  for(const [x,z] of [[-24,-30],[24,-30],[-24,30],[24,30]]){const stand=addSolid(makeMesh(new THREE.BoxGeometry(1.3,1.7,.75),toonMaterial(C.charcoal),[x,.85,z]));const paper=new THREE.Mesh(new THREE.PlaneGeometry(1.15,1.45),newsMat);paper.position.set(x,.95,z+.39);scene.add(paper);}
  const newsCanvas=document.createElement('canvas');
  newsCanvas.width=384;newsCanvas.height=512;
  const news=newsCanvas.getContext('2d');
  news.fillStyle='#e9dec4';news.fillRect(0,0,384,512);
  news.strokeStyle='#272326';news.lineWidth=7;news.strokeRect(10,10,364,492);
  news.fillStyle='#211e20';news.textAlign='center';news.font='bold 36px Georgia';news.fillText('MOUSEBERG DAILY',192,69,342);
  news.font='bold 30px Georgia';news.fillText('DOCKS AFTER DARK',192,132,335);
  news.fillRect(17,86,350,5);news.fillRect(24,159,151,132);
  news.strokeStyle='#e9dec4';news.lineWidth=2;
  for(let i=-10;i<135;i+=10){news.beginPath();news.moveTo(27,177+i*.82);news.lineTo(172,190+i*.82);news.stroke();}
  news.fillStyle='#5e544b';
  for(let col=0;col<3;col++)for(let row=0;row<18;row++){
    if (row<9&&col<1) continue;
    news.fillRect(24+col*117,171+row*17,91-(row*13+col*7)%24,3);
  }
  const newsMap=new THREE.CanvasTexture(newsCanvas);
  newsMap.colorSpace=THREE.SRGBColorSpace;
  const loosePaper=toonMaterial(0xfff4da,{map:newsMap,side:THREE.DoubleSide});
  const pageGeometry=new THREE.BoxGeometry(.91,1.24,.027);
  for(const [i,[x,z]] of [[-30,13],[30,-13],[-15,-35],[16,30],[-52,45],[53,-44],[12,54],[-12,-57]].entries()){
    const sheet=makeMesh(pageGeometry,loosePaper,[x,.08,z],true,{bow:0,flare:0,thickness:.52});
    scene.add(sheet);
    animatedProps.push(time=>{
      const drift=time*.65+i*1.7,billow=Math.pow(Math.max(0,Math.sin(drift)),3);
      sheet.position.set(x+7*Math.sin(drift),.13+billow*.94,z+3*Math.sin(drift*1.36));
      sheet.rotation.set(-Math.PI/2+billow*(1.4+Math.sin(drift*9)),drift*1.4,Math.sin(drift*3)+billow*1.6);
    });
  }
  // The raised perimeter gives the main courtyard a clear sunken read and playable wall-run lanes.
  const wallMaterial=toonMaterial(C.slate,{map:brickworkTexture()}),trimMaterial=toonMaterial(C.ink);
  const roofline=toonMaterial(0x827865);
  const perimeter=[
    {dims:[160,26,1.4],pos:[0,13,-80]},
    {dims:[160,26,1.4],pos:[0,13,80]},
    {dims:[1.4,26,160],pos:[-80,13,0]},
    {dims:[1.4,26,160],pos:[80,13,0]}
  ];
  for(const {dims,pos} of perimeter){
    const alongX=dims[0]>dims[2], axis=alongX?0:2;
    addProxy(new THREE.BoxGeometry(...dims),pos);
    for(let i=0;i<10;i++){
      const location=[...pos], panel=[...dims];
      panel[axis]=16.24;
      location[axis]=-72+i*16;
      addArt(makeMesh(new THREE.BoxGeometry(...panel),wallMaterial,location,true,{bow:.36,flare:.04,ridge:.10}));
      for (const [height,length,depth,mat] of [[9.0,.32,1.96,roofline],[17.25,.38,2.04,roofline],[25.75,.54,2.30,trimMaterial]]) {
        const course=[...location];course[1]=height;
        addArt(makeMesh(new THREE.BoxGeometry(...(alongX?[16.2,length,depth]:[depth,length,16.2])),mat,course));
      }
      if(i<9){
        const pier=[...location];pier[axis]+=8;
        addArt(makeMesh(new THREE.BoxGeometry(...(alongX?[.82,26,2.04]:[2.04,26,.82])),wallMaterial,pier,true,{bow:.24}));
      }
    }
  }
  const corniceMat=new THREE.MeshBasicMaterial({color:C.plaster}),windowInk=new THREE.MeshBasicMaterial({color:C.ink}),windowGlass=new THREE.MeshBasicMaterial({color:0xe6b76a}),barMat=new THREE.MeshBasicMaterial({color:C.indigo}),wantedPoster=new THREE.MeshBasicMaterial({map:graffitiTexture('WANTED'),side:THREE.DoubleSide}),dailyPoster=new THREE.MeshBasicMaterial({map:graffitiTexture('MOUSEBERG DAILY'),side:THREE.DoubleSide});
  const wallFaces=[{angle:0,base:[0,0,-79.03]},{angle:Math.PI,base:[0,0,79.03]},{angle:-Math.PI/2,base:[79.03,0,0]},{angle:Math.PI/2,base:[-79.03,0,0]}];
  for(let faceIndex=0;faceIndex<wallFaces.length;faceIndex++){
    const face=wallFaces[faceIndex];
    for(const x of [-57,0,57]){
      const wx=face.base[0]+Math.cos(face.angle)*x,wz=face.base[2]+Math.sin(face.angle)*x,windowGroup=new THREE.Group();windowGroup.position.set(wx,5.1,wz);windowGroup.rotation.y=face.angle;
      const frame=new THREE.Mesh(new THREE.BoxGeometry(4.1,3.1,.12),windowInk);windowGroup.add(frame);const pane=new THREE.Mesh(new THREE.PlaneGeometry(3.65,2.65),windowGlass);pane.position.z=.075;windowGroup.add(pane);
      for(const barX of [-.65,0,.65]){const bar=new THREE.Mesh(new THREE.BoxGeometry(.065,2.7,.08),barMat);bar.position.set(barX,0,.12);windowGroup.add(bar);}const cross=new THREE.Mesh(new THREE.BoxGeometry(3.7,.075,.08),barMat);cross.position.set(0,0,.12);windowGroup.add(cross);scene.add(windowGroup);
      const poster=new THREE.Mesh(new THREE.PlaneGeometry(2.7,3.5),faceIndex%2?wantedPoster:dailyPoster);poster.position.set(wx,3.1,wz);poster.rotation.y=face.angle;scene.add(poster);
    }
    for(const x of [-42,42]){const ladder=new THREE.Group();ladder.position.set(face.base[0]+Math.cos(face.angle)*x,1.4,face.base[2]+Math.sin(face.angle)*x);ladder.rotation.y=face.angle;for(const railX of [-.9,.9]){const rail=new THREE.Mesh(new THREE.BoxGeometry(.13,8.8,.13),windowInk);rail.position.set(railX,4.35,-.18);ladder.add(rail);}for(let rung=0;rung<15;rung++){const bar=new THREE.Mesh(new THREE.BoxGeometry(1.8,.1,.18),corniceMat);bar.position.set(0,.35+rung*.57,-.18);ladder.add(bar);}scene.add(ladder);}
  }
  const boards=document.createElement('canvas');
  boards.width=boards.height=256;
  const grain=boards.getContext('2d');
  for(let i=0;i<6;i++){
    grain.fillStyle=['#896d54','#a08768','#78634d'][i%3];
    grain.fillRect(i*43,0,43,256);
    grain.strokeStyle='#3e332c';grain.lineWidth=3;
    grain.beginPath();grain.moveTo(i*43,0);grain.bezierCurveTo(i*43-4,80,i*43+6,157,i*43,256);grain.stroke();
  }
  grain.strokeStyle='rgba(48,38,34,.43)';grain.lineWidth=1.2;
  for(let i=0;i<110;i++){
    const x=i*73%255,y=i*139%255;
    grain.beginPath();grain.moveTo(x,y);grain.quadraticCurveTo(x+5,y+14,x+1,y+27+i%24);grain.stroke();
  }
  const boardMap=new THREE.CanvasTexture(boards);
  boardMap.colorSpace=THREE.SRGBColorSpace;
  const crateMat=toonMaterial(0xc4ab8e,{map:boardMap}),batten=toonMaterial(0x665249);
  const addCrate=(x,y,z,w,h,d)=>{
    addSolid(makeMesh(new THREE.BoxGeometry(w,h,d),crateMat,[x,y+h/2,z],true,{ridge:.06}));
    for(const face of [-1,1]){
      for(const side of [-1,1]){
        addArt(makeMesh(new THREE.BoxGeometry(w+.055,.18,.093),batten,[x,y+h/2+side*(h/2-.13),z+face*(d/2+.047)]));
        addArt(makeMesh(new THREE.BoxGeometry(.19,h+.03,.09),batten,[x+side*(w/2-.13),y+h/2,z+face*(d/2+.05)]));
      }
      const brace=makeMesh(new THREE.BoxGeometry(.20,Math.hypot(w,h)-.47,.135),batten,[x,y+h/2,z+face*(d/2+.098)]);
      brace.rotation.z=face*Math.atan2(w,h);
      addArt(brace);
    }
    if(y===0)addShadow(scene,shadowTexture,x,z,w*1.52,d*1.55);
  };
  for(const [i,[x,z]] of [[-34,-13],[-34,14],[34,-14],[34,13],[-12,32],[12,-32],[-48,27],[47,-27],[45,46],[45,68]].entries()){
    addCrate(x,0,z,2.8,2.25,2.6);
    if(i%3!==1)addCrate(x+.29,2.25,z-.13,1.95,1.71,1.94);
  }
  const portalProfile=new THREE.Shape();
  portalProfile.moveTo(-3.9,0);
  portalProfile.absarc(0,0,3.9,Math.PI,0,true);
  portalProfile.lineTo(2.79,0);
  portalProfile.absarc(0,0,2.79,0,Math.PI,false);
  portalProfile.closePath();
  const arch=new THREE.ExtrudeGeometry(portalProfile,{curveSegments:22,depth:1.18,bevelEnabled:true,bevelSize:.09,bevelThickness:.06,bevelSegments:2});
  const archUV=arch.attributes.uv;
  for(let i=0;i<archUV.count;i++)archUV.setXY(i,archUV.getX(i)/8,archUV.getY(i)/14);
  for(const [x,z] of [[-48,-40],[48,40],[-60,17],[60,-17]]){
    addArt(makeMesh(arch,wallMaterial,[x,3.5,z-.59],true,{ridge:.14,bow:0,flare:.04}));
    for(const side of [-1,1]){
      addSolid(makeMesh(new THREE.BoxGeometry(1.25,3.55,1.42),wallMaterial,[x+side*3.34,1.775,z]));
      addArt(makeMesh(new THREE.BoxGeometry(1.53,.27,1.62),roofline,[x+side*3.34,3.5,z]));
    }
    addProxy(new THREE.BoxGeometry(5.58,1.28,1.24),[x,6.84,z]);
    for(const side of [-1,1])addProxy(new THREE.BoxGeometry(1.25,2.1,1.24),[x+side*2.76,5.53,z]);
    addArt(makeMesh(new THREE.BoxGeometry(.75,1.02,1.43),nickel,[x,6.92,z]));
  }
  // Split-level central ink divider: two offset cover wings leave generous flank routes.
  const coverMat=toonMaterial(C.slate,{map:brickworkTexture()});
  const covers=[{dims:[13,2.6,1.1],pos:[-9,1.3,-1.6]},{dims:[13,2.6,1.1],pos:[9,1.3,-1.6]},{dims:[1.1,2.5,9],pos:[0,1.25,-8.1]},{dims:[1.1,2.5,9],pos:[0,1.25,5.1]}];
  for(const c of covers){addSolid(makeMesh(new THREE.BoxGeometry(...c.dims),coverMat,c.pos));addShadow(scene,shadowTexture,c.pos[0],c.pos[2],c.dims[0]*1.45,c.dims[2]*1.8,.025);}
  // Clean comic-white elevated center platform with bold dark support trim.
  addSolid(makeMesh(new THREE.BoxGeometry(15,1.2,11),toonMaterial(0x535051),[0,.25,-1.4]));
  const centerDeck=addPlatform(makeMesh(new THREE.BoxGeometry(14.7,.28,10.7),toonMaterial(C.plaster,{map:architectureTexture('#faf6eb','#e8e1cf')}),[0,.99,-1.4]));
  addShadow(scene,shadowTexture,0,-1.4,19,15,.03);
  for(const x of [-7.3,7.3]){const beam=addSolid(makeMesh(new THREE.BoxGeometry(.16,.18,11),trimMaterial,[x,1.18,-1.4]));}
  // Elevated side catwalks and continuous wall-run alleys.
  for(const side of [-1,1]){
    const deck=addPlatform(makeMesh(new THREE.BoxGeometry(6,1,56),toonMaterial(C.slate,{map:brickworkTexture()}),[side*29,4.45,0]));addShadow(scene,shadowTexture,side*29,0,10,61,.03);
      const innerEdge=makeMesh(new THREE.BoxGeometry(.16,.16,56),toonMaterial(C.plaster),[side*26,5.03,0]);scene.add(innerEdge);
    for(const z of [-22,22]){
      const ramp=makeMesh(new THREE.BoxGeometry(18,.7,10),toonMaterial(C.slate2,{map:graffitiTexture('MOUSEBERG DAILY','#222328','#e8e1cf')}),[side*21,2.5,z]);ramp.rotation.z=side*.22;addRamp(ramp,'x');
      for(const edgeSide of [-1,1]){const rampEdge=makeMesh(new THREE.BoxGeometry(17.8,.1,.14),toonMaterial(C.amber,{emissive:C.amber,emissiveIntensity:.45}),[side*21,2.9,z+edgeSide*4.86],false);rampEdge.rotation.copy(ramp.rotation);scene.add(rampEdge);}
      addShadow(scene,shadowTexture,side*20,z,14,24,.025);
    }
  }
  // Outer brownstone blocks create a second traversable tier beyond the original plaza.
  const roofMat=toonMaterial(C.slate,{map:brickworkTexture()}),roofEdgeMat=toonMaterial(C.plaster),rampMat=toonMaterial(C.slate2,{map:graffitiTexture('MOUSEBERG DAILY','#222328','#e8e1cf')});
  const glowWindow=toonMaterial(0xdca55b,{emissive:0xffb94d,emissiveIntensity:.65});
  const darkWindow=toonMaterial(0x383039,{emissive:0x261c20,emissiveIntensity:.1});
  const windowFrame=toonMaterial(0x51463f);
  const ringMat=toonMaterial(0xd9a054,{emissive:0xffa52a,emissiveIntensity:.8});
  const addGrappleRing=(x,y,z)=>{
    const ring=makeMesh(new THREE.TorusGeometry(.78,.128,10,30),ringMat,[x,y,z],true,{bow:0,flare:0});
    addArt(ring);
    grappleTargets.push(solidProxy(new THREE.SphereGeometry(.84,12,8),[x,y,z]));
  };
  const ventBase=lathe([[.66,0],[.65,.12],[.37,.2],[.35,.56]],16);
  const ventCap=oval(.63,.41,.63);
  const ventFin=pipe([[0,-.29,.47],[.22,-.14,.54],[.26,.10,.56],[.14,.31,.4],[.02,.37,.17]],.042,10);
  for(const sx of [-1,1])for(const sz of [-1,1]){
    const x=sx*57,z=sz*57;
    // Open upper-floor sniper windows sit above sturdy lower brownstone courses.
    for(const wallSide of [-1,1]){
      const wz=z+wallSide*8.45;
      for(const [dims,pos] of [
        [[18,3,1.1],[x,1.5,wz]],[[18,.36,1.1],[x,3.18,wz]],[[18,.42,1.1],[x,6.48,wz]],[[18,1.1,1.1],[x,7.45,wz]],
        [[.9,3,1.1],[x-4.45,4.85,wz]],[[.9,3,1.1],[x+.0,4.85,wz]],[[.9,3,1.1],[x+4.45,4.85,wz]]
      ])addSolid(makeMesh(new THREE.BoxGeometry(...dims),roofMat,pos));
      // Iron window bars frame two clear firing ports without filling their openings.
      for(const offset of [-6.6,-2.3,2.3,6.6]){const bar=new THREE.Mesh(new THREE.BoxGeometry(.09,3.15,.13),new THREE.MeshBasicMaterial({color:C.ink}));bar.position.set(x+offset,4.9,wz-wallSide*.58);scene.add(bar);}
      const crossbar=new THREE.Mesh(new THREE.BoxGeometry(18,.11,.14),new THREE.MeshBasicMaterial({color:C.ink}));crossbar.position.set(x,4.5,wz-wallSide*.6);scene.add(crossbar);
      const balcony=addPlatform(makeMesh(new THREE.BoxGeometry(12,.35,2.3),roofEdgeMat,[x,3.1,z+wallSide*9.5]));
      for(const railX of [-5.7,0,5.7])addSolid(makeMesh(new THREE.BoxGeometry(.12,.85,.12),toonMaterial(C.charcoal),[x+railX,3.7,z+wallSide*10.4],false));
      addSolid(makeMesh(new THREE.BoxGeometry(12,.12,.12),toonMaterial(C.charcoal),[x,4.1,z+wallSide*10.4],false));
    }
    // The plaza-facing doorway opens beneath the roof ramp; the upper level remains balcony-like.
    addSolid(makeMesh(new THREE.BoxGeometry(1.1,8,18),roofMat,[x+sx*8.45,4,z]));
    for(const side of [-1,1])addSolid(makeMesh(new THREE.BoxGeometry(1.1,8,4.6),roofMat,[x-sx*8.45,4,z+side*6.7]));
    const roof=addPlatform(makeMesh(new THREE.BoxGeometry(18,.8,18),roofMat,[x,7.6,z]));
    // Interior gallery ledges overlook the ground floor and connect to a broad climbable stair ramp.
    for(const side of [-1,1]){
      addPlatform(makeMesh(new THREE.BoxGeometry(14,.45,2.4),roofMat,[x,3.05,z+side*6.5]));
      addPlatform(makeMesh(new THREE.BoxGeometry(2.4,.45,9),roofMat,[x+side*6.5,3.05,z]));
    }
    const insideStair=makeMesh(new THREE.BoxGeometry(8,.6,3.3),rampMat,[x+sx*2.5,1.7,z]);insideStair.rotation.z=sx*.36;addRamp(insideStair,'x');
    const insideLamp=new THREE.PointLight(C.lantern,8,12,1.7);insideLamp.position.set(x,5,z);scene.add(insideLamp);
    // Solid rooftop parapets preserve a ramp-width doorway on the plaza-facing edge.
    for(const side of [-1,1])addSolid(makeMesh(new THREE.BoxGeometry(18,.45,.55),roofEdgeMat,[x,8.2,z+side*8.7]));
    addSolid(makeMesh(new THREE.BoxGeometry(.55,.45,17),roofEdgeMat,[x+sx*8.7,8.2,z]));
    for(const side of [-1,1])addSolid(makeMesh(new THREE.BoxGeometry(.55,.45,4.2),roofEdgeMat,[x-sx*8.7,8.2,z+side*6.4]));
    const ramp=makeMesh(new THREE.BoxGeometry(20,.8,8.5),rampMat,[sx*38,4,z]);ramp.rotation.z=sx*.38;addRamp(ramp,'x');
    addShadow(scene,shadowTexture,x,z,23,23,.035);

    // Build back from the playable roof edge so the ramps and north/south bridges still connect.
    const upperX=x+sx*4.35, capY=sz>0?20.35:17.35;
    addSolid(makeMesh(new THREE.BoxGeometry(8.15,capY-8,14),roofMat,[upperX,(capY+8)/2,z],true,{flare:.06,bow:.34}));
    for(const y of [11.9,15.75,...(sz>0?[19.6]:[])]){
      addPlatform(makeMesh(new THREE.BoxGeometry(9.62,.43,14.65),roofline,[upperX-sx*.4,y,z],true,{ridge:.08}));
    }
    addPlatform(makeMesh(new THREE.BoxGeometry(9.18,.52,14.88),roofline,[upperX,capY-.1,z],true,{ridge:.19}));
    addArt(makeMesh(new THREE.BoxGeometry(8.46,.79,13.62),roofMat,[upperX,capY+.51,z],true,{ridge:.23}));
    addArt(makeMesh(new THREE.BoxGeometry(4.9,.33,8.4),roofline,[upperX,capY+1.02,z],true,{ridge:.2}));
    for(const y of [10.05,13.77,...(sz>0?[17.63]:[])]){
      for(const [faceAngle,wallX,wallZ,offsets] of [[-sx*Math.PI/2,upperX-sx*4.28,z,[-5,-1.7,1.7,5]],
        [sz>0?Math.PI:0,upperX,z-sz*7.37,[-2.2,0,2.2]]]){
        for(const [i,offset] of offsets.entries()){
          const window=new THREE.Group();
          window.position.set(wallX+Math.cos(faceAngle)*offset,y,wallZ-Math.sin(faceAngle)*offset);
          window.rotation.y=faceAngle;
          window.add(makeMesh(new THREE.BoxGeometry(1.54,2.65,.34),roofline,[0,0,0]));
          window.add(makeMesh(new THREE.BoxGeometry(1.13,2.17,.12),(i+sx+Math.round(y))%4===0?darkWindow:glowWindow,[0,0,.214],true,{flare:.035}));
          window.add(makeMesh(new THREE.BoxGeometry(.067,2.18,.07),windowFrame,[0,0,.305]));
          window.add(makeMesh(new THREE.BoxGeometry(1.14,.071,.07),windowFrame,[0,.34,.3]));
          window.add(makeMesh(new THREE.BoxGeometry(1.68,.18,.42),roofEdgeMat,[0,-1.29,.1]));
          addArt(window);
        }
      }
    }
    const chimneyX=upperX+sx*1.2, chimneyZ=z+sz*3.9;
    addSolid(makeMesh(new THREE.BoxGeometry(1.38,3.24,1.32),roofMat,[chimneyX,capY+1.52,chimneyZ],true,{bow:.87,ridge:.13}));
    addArt(makeMesh(new THREE.BoxGeometry(1.74,.34,1.62),roofline,[chimneyX,capY+3.13,chimneyZ]));
    addSmoke(chimneyX,capY+3.34,chimneyZ,{period:4.4,rise:4.6,scale:1.16,phase:(sx+sz)*.13});
    addGrappleRing(upperX-sx*4.91,capY+1.48,z-sz*2.9);
    const ventX=x-sx*4.8, ventZ=z+sz*5.9;
    addArt(makeMesh(ventBase,iron,[ventX,8,ventZ]));
    const rotor=new THREE.Group();
    rotor.position.set(ventX,8.88,ventZ);
    rotor.add(makeMesh(ventCap,iron,[0,0,0]));
    for(let i=0;i<7;i++){
      const fin=makeMesh(ventFin,nickel,[0,0,0],true,{bow:0,flare:0,jitter:.005,thickness:.6});
      fin.rotation.y=i*Math.PI*2/7;
      rotor.add(fin);
    }
    scene.add(rotor);
    animatedProps.push(time=>{rotor.rotation.y=time*2.3+sx+sz;});
  }
  // Paired elevated scaffold bridges leave deliberate jump gaps between the roof blocks.
  for(const sx of [-1,1])for(const sz of [-1,1]){
    const bridge=addPlatform(makeMesh(new THREE.BoxGeometry(6,.65,47),toonMaterial(C.slate2,{map:architectureTexture('#686a70','#222328')}),[sx*57,8.35,sz*29]));
    for(const edge of [-1,1])addSolid(makeMesh(new THREE.BoxGeometry(.18,.35,47),roofEdgeMat,[sx*57+edge*2.85,8.82,sz*29]));
  }
  // Twin construction cranes provide high grapple surfaces above the roof routes.
  const craneMat=toonMaterial(C.charcoal),craneTrim=toonMaterial(C.plaster);
  for(const sx of [-1,1]){
    const mast=addSolid(makeMesh(new THREE.BoxGeometry(1.35,24,1.35),craneMat,[sx*70,12,-12]));
    const beam=addSolid(makeMesh(new THREE.BoxGeometry(22,.9,1.5),craneMat,[sx*70,24.3,-12]));
    for(const dx of [-8,8])addSolid(makeMesh(new THREE.BoxGeometry(.28,5,.28),craneTrim,[sx*70+dx,21.5,-12]));
    const trolley=addSolid(makeMesh(new THREE.BoxGeometry(1.2,1.1,1.8),roofEdgeMat,[sx*70,23.3,-12]));
    const cable=addSolid(makeMesh(new THREE.BoxGeometry(.16,5,.16),craneMat,[sx*70,20.2,-12]));
    const hook=makeMesh(new THREE.TorusGeometry(.55,.11,6,14),roofEdgeMat,[sx*70,17.4,-12],false);scene.add(hook);
    for(const dx of [-10,10])addSolid(makeMesh(new THREE.BoxGeometry(.45,1,.45),craneTrim,[sx*70+dx,24.3,-12]));
  }
  // Timber-and-steel sniper towers make the plaza's vertical routes readable.
  const ladderMaterial=toonMaterial(C.charcoal),towerWood=toonMaterial(0x686a70,{map:architectureTexture('#686a70','#222328')}),towerDeckMat=toonMaterial(C.slate,{map:brickworkTexture()}),towerRoofMat=toonMaterial(C.charcoal);
  const addLadder=(x,z,topY,direction=1)=>{
    const centerZ=z+direction*.68;
    for(const s of [-1,1])addArt(makeMesh(new THREE.BoxGeometry(.12,topY+.6,.16),ladderMaterial,[x+s*.63,topY/2,centerZ],true,{bow:.20,flare:0}));
    for(let y=.45;y<topY;y+=.72)addArt(makeMesh(new THREE.BoxGeometry(1.34,.12,.16),towerWood,[x,y,centerZ]));
    const center=new THREE.Vector3(x,topY/2,centerZ);
    ladders.push({center,x,z:centerZ,topY,width:1.8,depth:1.8,approach:new THREE.Vector3(0,0,-direction)});
  };
  const peakedRoof=new THREE.Shape();
  peakedRoof.moveTo(-4.65,0);
  peakedRoof.bezierCurveTo(-2.7,.17,-1.39,2.55,0,2.65);
  peakedRoof.bezierCurveTo(1.39,2.55,2.7,.17,4.65,0);
  peakedRoof.quadraticCurveTo(4.1,-.51,0,-.31);
  peakedRoof.quadraticCurveTo(-4.1,-.50,-4.65,0);
  peakedRoof.closePath();
  const towerCanopy=new THREE.ExtrudeGeometry(peakedRoof,{depth:8.9,curveSegments:16,bevelEnabled:true,bevelSegments:2,bevelSize:.14,bevelThickness:.14});
  const addWatchtower=(x,z)=>{
    const half=3.7,postMat=towerWood, deck=18;
    for(const sx of [-1,1])for(const sz of [-1,1])
      addSolid(makeMesh(new THREE.BoxGeometry(.54,deck,.54),postMat,[x+sx*half,deck/2,z+sz*half],true,{bow:1}));
    addSolid(makeMesh(new THREE.BoxGeometry(8,.5,8),towerDeckMat,[x,deck-.25,z],true,{ridge:.09}));
    // Three-sided waist rails leave a broad, deliberate shooting aperture.
    for(const side of [-1,1])addSolid(makeMesh(new THREE.BoxGeometry(.18,1.15,7.5),towerWood,[x+side*3.82,deck+.56,z]));
    for(const side of [-1,1]){for(const s of [-1,1])addSolid(makeMesh(new THREE.BoxGeometry(3.0,1.15,.18),towerWood,[x+s*2.22,deck+.56,z+side*3.82]));}
    for(const sx of [-1,1])for(const sz of [-1,1])addSolid(makeMesh(new THREE.BoxGeometry(.29,5.5,.29),postMat,[x+sx*half,deck+2.72,z+sz*half]));
    const roof=makeMesh(towerCanopy,towerRoofMat,[x,deck+5.39,z-4.45],true,{ridge:.20,bow:0,flare:0});
    addArt(roof);
    addProxy(new THREE.BoxGeometry(8.98,.55,8.86),[x,deck+5.24,z]);
    addArt(makeMesh(oval(.34,.48,.34),lampGlass,[x,deck+4.25,z]));
    addGrappleRing(x,deck+3.54,z+4.24);
    addLadder(x,z+4.30,deck+.04);
  };
  for(const [x,z] of [[-44,0],[44,0],[36,-42]])addWatchtower(x,z);
  const steamEvents=[];
  const steamVents=[[44,9],[-44,-8],[36,-49],[25,42],[19,-41]].map(([x,z],index)=>({
    x,z,state:'DORMANT',timer:Math.random()*6.5+index*1.75,eruptedFor:0,windDown:0,
    dormantDuration:7+Math.random()*8,eruption:()=>2+Math.random()*3
  }));
  const ventIron=toonMaterial(0x141418), ventHighlight=toonMaterial(0xc3b397);
  const ventBlack=new THREE.MeshBasicMaterial({color:0x0b0b0e});
  const gratingGeometry=new THREE.BoxGeometry(.1,.035,1.54);
  const lidGeometry=new THREE.CylinderGeometry(1.06,1.11,.15,24);
  const rimGeometrySteam=new THREE.TorusGeometry(1.21,.14,8,28).rotateX(Math.PI/2);
  const lipGeometrySteam=new THREE.TorusGeometry(1.22,.036,6,28).rotateX(Math.PI/2);
  const ventMouthGeometry=new THREE.CircleGeometry(1.15,24).rotateX(-Math.PI/2);
  const curlGeometry=pipe(Array.from({length:18},(_,i)=>{
    const f=i/17, a=f*Math.PI*1.8, r=1.56+.54*f;
    return [Math.cos(a)*r,f*1.25,Math.sin(a)*r];
  }),.035,22);
  const curlInk=new THREE.MeshBasicMaterial({color:0x202028,transparent:true,opacity:.75,depthWrite:false});
  const steamLobes=3, steamStack=7;
  const steamGeometry=new THREE.IcosahedronGeometry(1,1);
  const steamWhite=new THREE.InstancedMesh(steamGeometry,toonMaterial(0xfcf8ee),steamVents.length*steamStack*steamLobes);
  const steamOutline=new THREE.InstancedMesh(steamGeometry,
    new THREE.MeshBasicMaterial({color:0x141418,side:THREE.BackSide}),steamWhite.count);
  for(const batch of [steamWhite,steamOutline]){
    batch.name='Manhole steam · '+(batch===steamWhite?'puffs':'ink');
    batch.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    batch.frustumCulled=false;
    scene.add(batch);
  }
  const lobe=new THREE.Object3D();
  const steamFixtures=steamVents.map(({x,z})=>{
    const fixture=new THREE.Group();
    fixture.name='Steam manhole';
    fixture.position.set(x,0,z);
    const hotMaterial=toonMaterial(0x242124,{emissive:0x9e2a2a,emissiveIntensity:0});
    const rim=new THREE.Mesh(rimGeometrySteam,hotMaterial);
    rim.position.y=.094;
    const lip=new THREE.Mesh(lipGeometrySteam,ventHighlight);
    lip.position.y=.203;
    const mouth=new THREE.Mesh(ventMouthGeometry,ventBlack);
    mouth.position.y=.023;
    const lid=new THREE.Group();
    lid.name='Steam manhole lid';
    lid.add(new THREE.Mesh(lidGeometry,ventIron));
    for(let i=-2;i<=2;i++){
      const grate=new THREE.Mesh(gratingGeometry,hotMaterial);
      grate.position.set(i*.29,.085,0);
      lid.add(grate);
    }
    const curls=Array.from({length:2},()=>new THREE.Mesh(curlGeometry,curlInk));
    fixture.add(rim,lip,mouth,lid,...curls);
    // These parts already have their ink treatment and must stay out of the static batches.
    fixture.traverse(part=>{if(part.isMesh)part.userData.inkedArt=true;});
    scene.add(fixture);
    return {lid,curls,hotMaterial};
  });
  animatedProps.push(time=>{
    steamFixtures.forEach(({lid,curls,hotMaterial},ventIndex)=>{
      const vent=steamVents[ventIndex];
      const phase=time*.51+ventIndex*.173;
      const warning=vent.state==='WARNING',erupting=vent.state==='ERUPTING',winding=vent.state==='WINDING_DOWN';
      const warningProgress=warning?THREE.MathUtils.clamp(vent.timer/1.5,0,1):0;
      const pulse=Math.abs(Math.sin(warningProgress*Math.PI*3));
      hotMaterial.emissiveIntensity=warning?pulse*.75:0;
      const pressure=warning?Math.pow((1+Math.sin(Math.floor(time*12+ventIndex)*Math.PI))*.5,2):0;
      const windFactor=winding?Math.pow(THREE.MathUtils.clamp(1-vent.timer/.85,0,1),2):1;
      lid.position.y=erupting||winding?.3+.37*Math.abs(Math.sin(Math.floor(time*12+ventIndex)*.8))*windFactor:
        warning?.04+.20*pressure:.04;
      lid.rotation.set(erupting?.58:winding?.58*windFactor:.07*pressure,0,erupting?.24*Math.sin(time*7):winding?.24*windFactor:.08*Math.cos(Math.floor(time*12+ventIndex)));
      for(let i=0;i<curls.length;i++){
        const rise=(phase+i*.5)%1;
        curls[i].position.y=erupting?.45+rise*11.8:winding?.45+rise*11.8*windFactor:.36+rise*.85;
        curls[i].rotation.y=time*1.7+i*Math.PI;
        curls[i].scale.setScalar((erupting?.45+.57*Math.sin(Math.PI*rise):winding?(.45+.57*Math.sin(Math.PI*rise))*windFactor:warning?.15:.055)*(i===0?1:.72));
        curls[i].visible=true;
      }
      const {x,z}=steamVents[ventIndex];
      for(let layer=0;layer<steamStack;layer++){
          const rise=(phase+layer/steamStack)%1;
          const puffing=erupting||winding||warning&&layer<2;
        const spread=.12+.63*rise;
        for(let i=0;i<steamLobes;i++){
          const angle=i*Math.PI*2/steamLobes+layer*2.4+time*1.9;
          const size=puffing?(.45+rise*1.06)*(1-.42*THREE.MathUtils.smoothstep(rise,.87,1))*(winding?windFactor:1):0;
          lobe.position.set(x+Math.cos(angle)*spread,.49+rise*12.5*(winding?windFactor:1)+.28*Math.sin(angle*2),z+Math.sin(angle)*spread);
          lobe.scale.set(size,size*(.75+.14*Math.sin(angle)),size*.91);
          lobe.updateMatrix();
          const index=(ventIndex*steamStack+layer)*steamLobes+i;
          steamWhite.setMatrixAt(index,lobe.matrix);
          lobe.scale.multiplyScalar(1.11);
          lobe.updateMatrix();
          steamOutline.setMatrixAt(index,lobe.matrix);
        }
      }
    });
    steamWhite.instanceMatrix.needsUpdate=true;
    steamOutline.instanceMatrix.needsUpdate=true;
  });
  // Two building ladders reach the already-solid mid-level roof decks.
  addLadder(-50.2,47.72,8.06,-1);addLadder(50.2,-47.72,8.06);
  // The plaza remains unbroken at street level; the former underground cutouts are removed.
  // False-wall crate stacks mask a narrow back-alley cut-through behind the eastern blocks.
  for(const [x,z] of [[45,52],[45,62]])addSolid(makeMesh(new THREE.BoxGeometry(.3,6,7),roofMat,[x,3,z]));
  // Four corner grapple decks with cyan anchor rings and substantial support pillars.
  const anchors=[],anchorGlow=new THREE.MeshBasicMaterial({color:C.lantern,blending:THREE.AdditiveBlending});const anchorCore=new THREE.MeshBasicMaterial({color:C.plaster});
  for(const sx of [-1,1])for(const sz of [-1,1]){
    const x=sx*30,z=sz*29,y=7.1;
    const pillar=addSolid(makeMesh(new THREE.BoxGeometry(2,7.1,2),toonMaterial(C.indigo),[x,3.55,z]));addShadow(scene,shadowTexture,x,z,7,7,.03);
    const deck=addPlatform(makeMesh(new THREE.BoxGeometry(9,.9,9),toonMaterial(C.slate2),[x,y,z]));addShadow(scene,shadowTexture,x,z,13,13,.04);
    const ring=makeMesh(new THREE.TorusGeometry(1.35,.11,8,28),anchorGlow,[x,y+1.2,z]);ring.rotation.x=Math.PI/2;scene.add(ring);
    const core=makeMesh(new THREE.SphereGeometry(.18,12,8),anchorCore,[x,y+1.2,z]);scene.add(core);anchors.push({ring,core,phase:Math.random()*6});
    grappleTargets.push(solidProxy(new THREE.SphereGeometry(1.36,12,8),[x,y+1.3,z]));
  }
  // Short pillars and low cover support route choices without blocking the center sightline.
  for(const [x,z] of [[-18,-2],[18,-2],[-18,2],[18,2]]){const p=addSolid(makeMesh(new THREE.CylinderGeometry(1.15,1.35,5.4,8),toonMaterial(C.slate),[x,2.7,z]));addShadow(scene,shadowTexture,x,z,5,5,.03);}
  for(const [x,z] of [[-25,0],[25,0],[0,-30],[0,30]]){const bollard=addSolid(makeMesh(new THREE.BoxGeometry(.55,1.2,.55),toonMaterial(C.plaster),[x,.6,z]));}
  // Warm paper lanterns hang from sagging catenary cables across the courtyard.
  const cableMaterial=toonMaterial(C.charcoal), lanternTemplate=lanternMesh();
  for(const z of [-20,0,20]){
    const cable=new THREE.Group(), points=[];
    cable.position.set(0,13.1,z);
    for(let i=0;i<=16;i++){const t=i/16;points.push([-36+t*72,-1.15*Math.sin(Math.PI*t),0]);}
    cable.add(makeMesh(pipe(points,.052,54),cableMaterial,[0,0,0],true,{flare:0,bow:0,jitter:.018}));
    const lanterns=[];
    for(let i=0;i<7;i++){
      const t=(i+.5)/7, group=lanternTemplate.clone();
      group.position.set(-36+t*72,-1.15*Math.sin(Math.PI*t)-.85,0);
      cable.add(group);
      lanterns.push(group);
    }
    scene.add(cable);
    animatedProps.push(time=>{
      cable.rotation.x=Math.sin(time*.94+z*.13)*.096;
      for(const [i,lantern] of lanterns.entries())lantern.rotation.z=Math.sin(time*1.4+i*.79)*.096;
    });
  }
  for(const x of [-19,19]){
    const points=[];
    for(let i=0;i<=16;i++){const t=i/16;points.push([0,-.95*Math.sin(Math.PI*t),-35+t*70]);}
    const cable=makeMesh(pipe(points,.044,52),cableMaterial,[x,13.4,0],true,{flare:0,bow:0,jitter:.015});
    scene.add(cable);
    animatedProps.push(time=>{cable.rotation.z=Math.sin(time*1.18+x*.14)*.06;});
  }
  // Three concentric bands of illustrated city blocks create depth above and beyond the arena rim.
  const skylineRings=[{radius:110,count:30,height:38,width:11,depth:7,seed:13,tint:0xa69d8f},{radius:137,count:31,height:53,width:14,depth:9,seed:29,tint:0x817b76},{radius:168,count:32,height:65,width:17,depth:11,seed:47,tint:0x5e6068}];
  for(let ringIndex=0;ringIndex<skylineRings.length;ringIndex++){
    const ring=skylineRings[ringIndex],facade=new THREE.MeshBasicMaterial({map:skylineFacadeTexture(ring.seed),color:ring.tint,fog:true});
    for(let i=0;i<ring.count;i++){
      const angle=i/ring.count*Math.PI*2+(ringIndex%2)*.075,variation=.76+((i*37+ring.seed)%47)/100,h=ring.height*variation,w=ring.width*(.72+((i*17)%29)/60),d=ring.depth*(.82+((i*13)%23)/70),r=ring.radius+((i*11+ring.seed)%9)-4;
      const x=Math.sin(angle)*r,z=-Math.cos(angle)*r;
      const building=makeMesh(new THREE.BoxGeometry(w,h,d),facade,[x,h*.5-1.2,z],true,{flare:.067,bow:.68,ridge:.18});
      building.rotation.y=angle;building.receiveShadow=false;building.castShadow=false;addArt(building);
      if(i%4<2){
        for(const [factor,crownHeight,offset] of [[.78,h*.095,-.16],[.52,h*.08,h*.08]]){
          const crown=makeMesh(new THREE.BoxGeometry(w*factor,crownHeight,d*factor),facade,[x,h-1.2+offset+crownHeight/2,z],true,{ridge:.18});
          crown.rotation.y=angle;crown.castShadow=crown.receiveShadow=false;addArt(crown);
        }
      }
      // Water tanks, aerials and radio needles break up the rectangular roofline.
      if(i%6===1){const roof=new THREE.Group();roof.position.set(x,h-1.1,z);roof.rotation.y=angle;const tank=new THREE.Mesh(new THREE.CylinderGeometry(w*.18,w*.2,Math.max(1.7,h*.075),10),new THREE.MeshBasicMaterial({color:C.ink,fog:true}));tank.position.y=h*.045;tank.castShadow=false;roof.add(tank);const tankRim=new THREE.Mesh(new THREE.TorusGeometry(w*.19,.12,5,14),new THREE.MeshBasicMaterial({color:C.plaster,fog:true}));tankRim.position.y=h*.085;roof.add(tankRim);for(const legX of [-1,1])for(const legZ of [-1,1]){const leg=new THREE.Mesh(new THREE.BoxGeometry(.12,Math.max(1.5,h*.08),.12),new THREE.MeshBasicMaterial({color:C.ink,fog:true}));leg.position.set(legX*w*.13,-h*.015,legZ*w*.13);roof.add(leg);}scene.add(roof);}
      else if(i%5===0){const mast=new THREE.Mesh(new THREE.CylinderGeometry(.04,.1,4+ringIndex*1.8,5),new THREE.MeshBasicMaterial({color:C.indigo,fog:true}));mast.position.set(x,h+1.9+ringIndex*.8,z);scene.add(mast);const beacon=new THREE.Mesh(new THREE.SphereGeometry(.13,6,5),new THREE.MeshBasicMaterial({color:i%2?C.cyan:C.lantern}));beacon.position.set(x,h+3.95+ringIndex*.8,z);scene.add(beacon);}
    }
  }
  const sky=noirSkyTexture();
  sky.mapping=THREE.EquirectangularReflectionMapping;
  scene.background=sky;
  inkStreetDetails(scene,staticRoots);
  // Distant silhouettes include a few skeletal cranes and glide paths for inked birds.
  const craneMaterial=new THREE.LineBasicMaterial({color:C.ink,transparent:true,opacity:.9});
  for(const [x,z,s] of [[-62,-74,1],[64,-90,.82]]){const crane=new THREE.Group();for(const [a,b] of [[[-8,0,0],[8,0,0]],[[-5,0,0],[-5,16,0]],[[-5,16,0],[14,16,0]],[[10,16,0],[10,4,0]],[[-5,16,0],[12,2,0]]])crane.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...a),new THREE.Vector3(...b)]),craneMaterial));crane.position.set(x,4,z);crane.scale.setScalar(s);scene.add(crane);}
  for(let i=0;i<5;i++){const bird=makeBird(scene),phase=i*Math.PI*2/5,radius=27+(i%3)*6,baseY=17+Math.random()*8;bird.position.set(Math.cos(phase)*radius,baseY,Math.sin(phase)*radius);bird.userData={phase,baseY,speed:.12+Math.random()*.07,radius,wings:bird.children.slice(0,2)};birds.push(bird);}
  // Drifting golden dust/embers with a compact single draw call.
  const dustCount=115,positions=new Float32Array(dustCount*3),phases=new Float32Array(dustCount);for(let i=0;i<dustCount;i++){positions[i*3]=(Math.random()-.5)*58;positions[i*3+1]=Math.random()*12;positions[i*3+2]=(Math.random()-.5)*58;phases[i]=Math.random()*Math.PI*2;}
  dust.geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));dust.userData.phases=phases;scene.add(dust);
  // Gangster mice patrol central lanes, rooftop edges, alley mouths, and crane-height ledges.
  const targets=[],enemyHitboxes=[],enemyBadge=enemyBadgeTexture(),characterFrames=rubberHoseCast.map(({id})=>Array.from({length:4},(_,frame)=>rubberHoseTexture(id,frame))),rimFrames=characterFrames.map(frames=>frames.map(texture=>goldRimTexture(texture)));let targetsEnabled=true;
  const targetSpots=[[-16,5,-28],[16,5,-28],[-21,4,22],[21,4,22],[0,7,-18],[-50,10,-56],[50,10,-56],[-50,10,56],[50,10,56],[-42,15,0],[42,15,0],[-58,14,-12],[58,14,-12],[-70,19,-12],[70,19,-12],[0,12,-56],[0,12,56],[0,18,0],[-57,4.8,-57],[57,4.8,-57],[-57,4.8,57],[57,4.8,57],[36,15,-42],[-44,15,0],[44,15,0],[-26,4,40],[26,4,-40]];
  for(let targetIndex=0;targetIndex<targetSpots.length;targetIndex++){
    const [x,y,z]=targetSpots[targetIndex],skinIndex=targetIndex%rubberHoseCast.length,skin=rubberHoseCast[skinIndex].id,characterTexture=characterFrames[skinIndex][0];
    const drone=new THREE.Group();drone.position.set(x,y,z);drone.userData={target:true,alive:true,hp:100,maxHp:100,respawn:0,baseY:y,phase:Math.random()*6,home:new THREE.Vector3(x,y,z),fireTimer:1+Math.random()*2};
    drone.userData.skin=skin;drone.userData.skinIndex=skinIndex;drone.userData.spriteFrame=0;drone.outline=new THREE.Sprite(new THREE.SpriteMaterial({map:rimFrames[skinIndex][0],color:0xffe89e,transparent:true,opacity:.98,blending:THREE.AdditiveBlending,depthWrite:false,alphaTest:.02}));drone.outline.scale.set(2.82,4.02,1);drone.outline.renderOrder=3;drone.add(drone.outline);
    drone.sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:characterTexture,color:C.plaster,transparent:true,depthWrite:false,alphaTest:.08}));drone.sprite.scale.set(2.4,3.6,1);drone.sprite.renderOrder=4;drone.spriteFrameTime=0;drone.add(drone.sprite);
    const gun=new THREE.Group(),gunInk=new THREE.MeshBasicMaterial({color:C.ink}),gunSteel=toonMaterial(C.slate);gun.position.set(.48,.08,.22);const receiver=new THREE.Mesh(new THREE.BoxGeometry(.72,.22,.24),gunInk);gun.add(receiver);const barrel=new THREE.Mesh(new THREE.CylinderGeometry(.045,.045,.63,8),gunInk);barrel.rotation.z=Math.PI/2;barrel.position.x=.62;gun.add(barrel);const drum=new THREE.Mesh(new THREE.CylinderGeometry(.13,.13,.2,10),gunSteel);drum.rotation.x=Math.PI/2;drum.position.set(.05,-.18,0);gun.add(drum);const muzzle=new THREE.Object3D();muzzle.position.set(.96,.02,0);gun.add(muzzle);const flash=new THREE.Mesh(new THREE.OctahedronGeometry(.32),new THREE.MeshBasicMaterial({color:0xfaf6eb,transparent:true,opacity:0}));flash.position.copy(muzzle.position);gun.add(flash);drone.gun=gun;drone.muzzleAnchor=muzzle;drone.muzzleFlash=flash;drone.add(gun);
    drone.badge=new THREE.Sprite(new THREE.SpriteMaterial({map:enemyBadge,transparent:true,depthWrite:false}));drone.badge.scale.set(2.1,.52,1);drone.badge.position.y=2.25;drone.badge.renderOrder=5;drone.add(drone.badge);
    const hidden=new THREE.MeshBasicMaterial({transparent:true,opacity:0,colorWrite:false,depthWrite:false,side:THREE.DoubleSide});
    const bodyHitbox=new THREE.Mesh(new THREE.CylinderGeometry(1.35,1.35,2.6,16,1,false),hidden);bodyHitbox.position.y=-.5;bodyHitbox.userData={isEnemyHitbox:true,isHead:false,targetRoot:drone};drone.bodyHitbox=bodyHitbox;drone.add(bodyHitbox);enemyHitboxes.push(bodyHitbox);
    const headHitbox=new THREE.Mesh(new THREE.CylinderGeometry(1.35,1.35,1,16,1,false),hidden);headHitbox.position.y=1.3;headHitbox.userData={isEnemyHitbox:true,isHead:true,targetRoot:drone};drone.headHitbox=headHitbox;drone.add(headHitbox);enemyHitboxes.push(headHitbox);
    const pool=new THREE.Mesh(new THREE.CircleGeometry(2.8,32),new THREE.MeshBasicMaterial({map:lampPoolTexture,color:0xffe89e,transparent:true,opacity:.75,depthWrite:false,blending:THREE.AdditiveBlending,side:THREE.DoubleSide}));pool.rotation.x=-Math.PI/2;pool.position.y=-1.78;pool.renderOrder=1;drone.pool=pool;drone.add(pool);
    scene.add(drone);targets.push(drone);
  }
  for(const source of solidSources){
    const geometry=originalGeometry.get(source);
    const proxy=addProxy(geometry,source.position.toArray(),source.rotation);
    proxy.userData.isPlatform=source.userData.isPlatform;
  }
  for(const proxy of [...colliders,...grappleTargets]) proxy.updateMatrixWorld();
  const solidBoxes=colliders.filter(o=>!o.userData.isContinuousFloor).map(object=>{
    object.geometry.computeBoundingBox();
    const box=object.geometry.boundingBox.clone().applyMatrix4(object.matrixWorld);
    if(object.userData.isPlatform)box.expandByVector(new THREE.Vector3(.5,0,.5));
    return {object,box};
  });
  verifySpawnClearance(solidBoxes);
  const collisionBoxes=solidBoxes.filter(({object})=>!object.userData.isRamp);
  const waveGround=[[-7,-45],[7,-45],[-16,-34],[16,-35],[-15,-9],[15,-9],[-7,13],[7,13],[-15,36],[16,37],[-7,47],[7,47],[-7,-23],[7,24]]
    .filter(([x,z])=>collisionBoxes.every(({box})=>box.max.y<.2||box.min.y>3.6||
      x+1.4<box.min.x||x-1.4>box.max.x||z+1.4<box.min.z||z-1.4>box.max.z));
  const waveTowers=[[-44,0],[44,0],[36,-42]].map(([x,z])=>({x,z,y:18,yaw:Math.PI}));
  function gauntletSpawn(role,slot,avoid){
    if(role==='sniper')return waveTowers[slot%waveTowers.length];
    const open=waveGround.filter(([x,z])=>Math.hypot(x-avoid.x,z-avoid.z)>12);
    const sites=open.length?open:waveGround;
    const [x,z]=sites[slot%sites.length]??[SPAWN_BOT.x,SPAWN_BOT.z];
    return {x,z,y:0,yaw:Math.atan2(x-avoid.x,z-avoid.z)};
  }
  batchStaticArt(scene,staticRoots);
  for(const animate of animatedProps) animate(0);
  return {
    colliders, arenaColliders:colliders, grappleColliders:[...colliders,...grappleTargets], collisionBoxes,
    ramps, ladders, targets, enemyHitboxes, spawnJumpPuffs, throwGadget, clearGadgets,
    trialCheckpoints, showTrialCheckpoint, gauntletSpawn,
    steamVentAt({x,y,z}){
      if(y<0||y>=16)return null;
      const vent=steamVents.find(item=>(item.state==='ERUPTING'||item.state==='WINDING_DOWN')&&(x-item.x)**2+(z-item.z)**2<2.6**2);
      if(!vent)return null;
      return {vent,launchForce:vent.state==='WINDING_DOWN'?29*Math.pow(THREE.MathUtils.clamp(1-vent.timer/.85,0,1),2):29};
    },
    takeSteamEvents(){return steamEvents.splice(0);},
    updateGadgets, smokeBlocksSight, spawnFinishStars, bounds:78.9,
    get hasActiveGadgets(){return gadgets.length>0;},
    get targetsEnabled(){return targetsEnabled;},
    setTargetsEnabled(enabled){
      targetsEnabled=!!enabled;
      enemyHitboxes.length=0;
      for(const target of targets){
        target.visible=targetsEnabled&&target.userData.alive;
        target.bodyHitbox.visible=target.headHitbox.visible=target.visible;
        if(target.visible)enemyHitboxes.push(target.bodyHitbox,target.headHitbox);
      }
    },
    groundHeightAt(x,z){
      const ray=new THREE.Raycaster(new THREE.Vector3(x,25,z),new THREE.Vector3(0,-1,0),0,50);
      const y=ray.intersectObject(groundCollider,false)[0]?.point.y??0;
      return Math.abs(y)<1e-8 ? 0 : y;
    },
    update(dt,time,frameDt=dt){
    for(const vent of steamVents){
      vent.timer+=dt;
      if(vent.state==='DORMANT'&&vent.timer>=vent.dormantDuration-1.5){
        vent.state='WARNING';vent.timer=0;steamEvents.push('warning');
      }else if(vent.state==='WARNING'&&vent.timer>=1.5){
        vent.state='ERUPTING';vent.timer=0;vent.eruptedFor=vent.eruption();steamEvents.push('eruption');
      }else if(vent.state==='ERUPTING'&&vent.timer>=vent.eruptedFor-.85){
        vent.state='WINDING_DOWN';vent.timer=0;
      }else if(vent.state==='WINDING_DOWN'&&vent.timer>=.85){
        vent.state='DORMANT';vent.timer=0;vent.dormantDuration=7+Math.random()*8;
        steamEvents.push('clink');
      }
    }
    if(activeTrial>=0){
      const watch=watches[activeTrial];
      watch.rotation.y=time*.91;
      watch.rotation.z=Math.sin(time*1.8)*.11;
      beacon.material.opacity=.32+Math.sin(time*3.7)*.1;
    }
    for (let i = jumpPuffs.length-1; i >= 0; i--) {
      const ring = jumpPuffs[i];
      ring.age += frameDt;
      if (ring.age < ring.life) updateJumpPuffs(ring);
      else {
        scene.remove(ring.group);
        ring.white.dispose();
        ring.ink.dispose();
        ring.soot?.dispose();
        jumpPuffs.splice(i,1);
      }
    }
    for(let i=finishStars.length-1;i>=0;i--){
      const effect=finishStars[i];
      effect.age+=dt;
      for(const star of effect.group.children){
        star.position.addScaledVector(star.userData.velocity,dt);
        star.rotation.z+=dt*8;
        star.userData.velocity.y-=dt*8;
      }
      if(effect.age>.51){
        scene.remove(effect.group);
        effect.material.dispose();
        finishStars.splice(i,1);
      }
    }
    const interval=1/12;
    stepTimer+=frameDt;
    if(stepTimer>=interval){
      const frames=Math.floor(stepTimer/interval);
      cel+=frames;
      stepTimer-=frames*interval;
      for(const animate of animatedProps) animate(cel*interval);
      setInkCel(cel);
    }
    for(const {light,phase,base} of streetLights){light.intensity=base*(.96+.04*Math.sin(time*7.5+phase));}
    for(const bird of birds){const orbit=bird.userData.phase+time*bird.userData.speed;bird.position.x=Math.cos(orbit)*bird.userData.radius;bird.position.z=Math.sin(orbit)*bird.userData.radius;bird.position.y=bird.userData.baseY+Math.sin(time*1.2+bird.userData.phase)*.5;bird.rotation.y=-orbit;const flap=Math.sin(Math.floor(time*12)*.55+bird.userData.phase)*.42;bird.userData.wings[0].rotation.z=flap;bird.userData.wings[1].rotation.z=-flap;}
    const pa=dust.geometry.attributes.position,ph=dust.userData.phases;for(let i=0;i<dustCount;i++){pa.array[i*3+1]+=(.16+Math.sin(time+ph[i])*.08)*dt;pa.array[i*3]+=Math.sin(time*.45+ph[i])*.05*dt;if(pa.array[i*3+1]>13)pa.array[i*3+1]=.4;}pa.needsUpdate=true;
    for(const anchor of anchors){anchor.ring.rotation.z+=dt*.35;anchor.core.scale.setScalar(1+Math.sin(time*2+anchor.phase)*.12);}
    for(const d of targets){if(d.userData.alive){if(!targetsEnabled)continue;const phase=time*3.6+d.userData.phase,bob=Math.sin(phase);d.position.y=d.userData.baseY+bob*.42;d.sprite.scale.set(2.4*(1+.09*Math.sin(phase+Math.PI/2)),3.6*(1-.07*Math.sin(phase+Math.PI/2)),1);d.outline.scale.set(d.sprite.scale.x*1.17,d.sprite.scale.y*1.12,1);d.sprite.material.rotation=Math.sin(phase*.5)*.045;d.outline.material.rotation=d.sprite.material.rotation;const frame=Math.floor(time*12)%4;if(frame!==d.userData.spriteFrame){d.userData.spriteFrame=frame;d.sprite.material.map=characterFrames[d.userData.skinIndex][frame];d.outline.material.map=rimFrames[d.userData.skinIndex][frame];}}else{d.userData.respawn-=dt;if(d.userData.respawn<=0){d.userData.alive=true;d.userData.hp=d.userData.maxHp;d.visible=targetsEnabled;d.position.copy(d.userData.home);d.userData.baseY=d.position.y;d.bodyHitbox.visible=d.headHitbox.visible=d.visible;if(targetsEnabled)enemyHitboxes.push(d.bodyHitbox,d.headHitbox);}}
  }}};
}

export function shatterTarget(arena,target,scene){const drone=target?.userData?.targetRoot||target;if(!drone?.userData.alive)return false;drone.userData.alive=false;drone.userData.respawn=4.2;drone.visible=false;const index=arena.enemyHitboxes.indexOf(drone.bodyHitbox);if(index>=0)arena.enemyHitboxes.splice(index,1);const headIndex=arena.enemyHitboxes.indexOf(drone.headHitbox);if(headIndex>=0)arena.enemyHitboxes.splice(headIndex,1);burst(scene,drone.position.clone(),0xe8e1cf,22,10);comicText(scene,Math.random()>.5?'POW!':'KRAK!',drone.position.clone().add(new THREE.Vector3(0,1,0)),'#faf6eb',.9,.7);return true;}
