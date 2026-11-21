import * as THREE from 'three';
import { SPAWN_BOT } from './arena.js';
import { rubberHoseTexture, goldRimTexture, burst, inkDust, comicText } from './comicShader.js';

const UP = new THREE.Vector3(0, 1, 0);
const originHeight = 1.82;
const presets = {
  medium: {label:'MEDIUM',hp:130,speed:18,reaction:.35,lead:.10,spread:3.2,burst:5,pause:.45,dash:4.6,combo:9.5,damage:11,aimLerpSpeed:13,burstInterval:.095},
  hard: {label:'HARD',hp:155,speed:22,reaction:.18,lead:.115,spread:1.6,burst:8,pause:.28,dash:3,combo:5.2,damage:13,aimLerpSpeed:21,burstInterval:.078},
  extremelyHard: {label:'EXTREMELY HARD',hp:180,speed:25,reaction:.08,lead:.12,spread:.75,burst:12,pause:.18,dash:2.15,combo:3.7,damage:15,aimLerpSpeed:29,burstInterval:.066,headshotChance:.15}
};
const archetypes={
  grunt:{label:'TOMMY-GUN GRUNT',hp:90,speed:17,reaction:.42,lead:.10,spread:3.65,burst:5,pause:.76,dash:5,combo:10,damage:7,aimLerpSpeed:13,burstInterval:.1},
  sniper:{label:'WATCHTOWER SNIPER',hp:76,speed:13,reaction:.40,lead:.10,spread:1.15,burst:1,pause:2.05,dash:8,combo:20,damage:19,aimLerpSpeed:17,range:115},
  rusher:{label:'DASH-RUSHER',hp:68,speed:25,reaction:.28,lead:.11,spread:3.4,burst:7,pause:.61,dash:1.9,combo:8,damage:6,aimLerpSpeed:18,burstInterval:.06}
};
export const gauntletDifficulties={
  medium:{label:'MEDIUM',hp:1,spread:1,reaction:1,tracking:1,damage:1,opening:2,spacing:.86},
  hard:{label:'HARD',hp:1.24,spread:.72,reaction:.65,tracking:1.4,damage:1.2,opening:3,spacing:.46},
  extremelyHard:{label:'EXTREMELY HARD',hp:1.52,spread:.46,reaction:.36,tracking:1.8,damage:1.43,opening:4,spacing:.22}
};
const legacyDifficulty={gumshoe:'medium',bruiser:'hard',ace:'extremelyHard'};
const sniperChargeTime=.7;
function botSettings(difficulty,role){
  if(!role)return presets[difficulty]??presets.hard;
  const base=archetypes[role],tier=gauntletDifficulties[difficulty]??gauntletDifficulties.medium;
  return {...base,hp:Math.round(base.hp*tier.hp),spread:base.spread*tier.spread,
    reaction:base.reaction*tier.reaction,aimLerpSpeed:base.aimLerpSpeed*tier.tracking,
    damage:Math.round(base.damage*tier.damage)};
}
const laneGrids=new WeakMap();
function laneBlocked(boxes,from,dx,dz,distance,feet){
  const head=feet+3.2;
  const endX=from.x+dx*distance,endZ=from.z+dz*distance;
  const minX=Math.min(from.x,endX)-.91,maxX=Math.max(from.x,endX)+.91;
  const minZ=Math.min(from.z,endZ)-.91,maxZ=Math.max(from.z,endZ)+.91;
  for(const {box} of boxes){
    if(box.max.y<=feet+.63||box.min.y>=head-.03)continue;
    if(box.max.x<minX||box.min.x>maxX||box.max.z<minZ||box.min.z>maxZ)continue;
    const bounds=[
      [from.x,dx,box.min.x-.91,box.max.x+.91],
      [from.z,dz,box.min.z-.91,box.max.z+.91]
    ];
    let enter=0,exit=distance;
    for(const [origin,direction,min,max] of bounds){
      if(Math.abs(direction)<1e-6){
        if(origin<min||origin>max){exit=-1;break;}
        continue;
      }
      const a=(min-origin)/direction,b=(max-origin)/direction;
      enter=Math.max(enter,Math.min(a,b));
      exit=Math.min(exit,Math.max(a,b));
      if(enter>exit)break;
    }
    // Ignore a contact the bot is already moving away from.
    if(exit>.12&&enter<=exit)return true;
  }
  return false;
}
function groundLanes(arena){
  if(laneGrids.has(arena))return laneGrids.get(arena);
  const size=27, step=5, edge=65, nodes=[];
  for(let row=0;row<size;row++)for(let col=0;col<size;col++){
    const x=col*step-edge,z=row*step-edge;
    const blocked=(arena.collisionBoxes??[]).some(({box})=>
      box.max.y>.45&&box.min.y<3.1&&x>box.min.x-1&&x<box.max.x+1&&z>box.min.z-1&&z<box.max.z+1);
    nodes.push(blocked?null:new THREE.Vector3(x,0,z));
  }
  const adjacent=(a,b)=>{
    const centerX=(a.x+b.x)*.5,centerZ=(a.z+b.z)*.5;
    return !(arena.collisionBoxes??[]).some(({box})=>box.max.y>.45&&box.min.y<3.1&&
      centerX>box.min.x-1&&centerX<box.max.x+1&&centerZ>box.min.z-1&&centerZ<box.max.z+1);
  };
  const neighbors=nodes.map((point,index)=>{
    if(!point)return [];
    const row=Math.floor(index/size),col=index%size,links=[];
    for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]){
      if(col+dx<0||col+dx>=size||row+dz<0||row+dz>=size)continue;
      const other=index+dx+dz*size;
      if(nodes[other]&&nodes[index+dx]&&nodes[index+dz*size]&&adjacent(point,nodes[other]))links.push(other);
    }
    return links;
  });
  const grid={nodes,neighbors};
  laneGrids.set(arena,grid);
  return grid;
}
function lanePath(arena,from,to){
  const {nodes,neighbors}=groundLanes(arena);
  function nearest(position){
    let candidate=-1,best=Infinity;
    nodes.forEach((point,index)=>{
      if(!point)return;
      const distance=(point.x-position.x)**2+(point.z-position.z)**2;
      if(distance<best){candidate=index;best=distance;}
    });
    return candidate;
  }
  const start=nearest(from),goal=nearest(to);
  if(start<0||goal<0||start===goal)return [];
  const parents=new Int16Array(nodes.length).fill(-1),queue=[start];
  parents[start]=start;
  for(let read=0;read<queue.length&&parents[goal]<0;read++){
    const current=queue[read];
    for(const next of neighbors[current])if(parents[next]<0){
      parents[next]=current;
      queue.push(next);
    }
  }
  if(parents[goal]<0)return [];
  const path=[];
  for(let at=goal;at!==start;at=parents[at])path.push(nodes[at]);
  return path.reverse();
}
const sharedWaveFrames=new Map();
function waveFrame(skin,frame){
  const key=`${skin}:${frame}`;
  if(!sharedWaveFrames.has(key)){
    const art=rubberHoseTexture(skin,frame);
    sharedWaveFrames.set(key,[art,goldRimTexture(art)]);
  }
  return sharedWaveFrames.get(key);
}

export class DuelBot {
  constructor({scene,arena,player,audio,difficulty='hard',skin='bug',role=null,spawnPoint=SPAWN_BOT}) {
    this.role=role;
    this.spawnPoint=spawnPoint;
    this.scene=scene;this.arena=arena;this.player=player;this.audio=audio;
    this.difficulty=legacyDifficulty[difficulty]??difficulty;
    this.settings=botSettings(this.difficulty,role);
    this.position=new THREE.Vector3();this.velocity=new THREE.Vector3();this.ray=new THREE.Raycaster();this.floorRay=new THREE.Raycaster();this.movePhase=0;this.state='SEEK_PLAYER';this.fireTimer=.5;this.reactionTimer=this.settings.reaction;this.reloadTimer=0;this.burstLeft=0;this.comboTimer=2.8;this.dashTimer=0;this.dashCharges=2;this.bunnyHopTimer=0;this.isGrounded=false;this.isSlamming=false;this.slamWindowTimer=0;this.damageBurst=0;this.flashTimer=0;this.flashing=false;this.dustTimer=0;this.ladder=null;this.ladderTimer=0;this.spriteFrame=-1;
    this.botAimPos=new THREE.Vector3();this.aimLagTimer=this.settings.reaction;this.ammo=24;this.maxAmmo=24;this.strafeSign=Math.random()<.5?-1:1;this.strafeTimer=.45+Math.random()*.6;this.jumpPeekTimer=2.5+Math.random()*2.5;this.coverPoint=null;this.coverRepathTimer=0;this.burstCount=0;this.dashBurstRemaining=0;this.jumpCooldown=0;this.slamSequenceArmed=false;this.stuckElapsed=0;this.lastCheckPos=new THREE.Vector3();
    this.group=new THREE.Group();scene.add(this.group);
    const [art,rim]=role?waveFrame(skin,0):[rubberHoseTexture(skin,0)];
    this.skin=skin;this.sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:art,transparent:true,depthWrite:false,alphaTest:.05}));this.sprite.scale.set(2.55,3.75,1);this.sprite.position.y=.1;this.group.add(this.sprite);
    this.outline=new THREE.Sprite(new THREE.SpriteMaterial({map:rim??goldRimTexture(art),color:0xffe89e,transparent:true,opacity:1,blending:THREE.AdditiveBlending,depthWrite:false,alphaTest:.01}));this.outline.scale.set(2.9,4.15,1);this.outline.renderOrder=3;this.group.add(this.outline);
    const invisible=new THREE.MeshBasicMaterial({transparent:true,opacity:0,colorWrite:false,depthWrite:false,side:THREE.DoubleSide});
    this.bodyHit=new THREE.Mesh(new THREE.CylinderGeometry(1.35,1.35,2.6,16),invisible);this.bodyHit.position.y=-.5;this.bodyHit.userData={bot:this,botPart:'body',isEnemyHitbox:true,isHead:false};this.group.add(this.bodyHit);
    this.headHit=new THREE.Mesh(new THREE.CylinderGeometry(1.35,1.35,1,16),invisible);this.headHit.position.y=1.3;this.headHit.userData={bot:this,botPart:'head',isEnemyHitbox:true,isHead:true};this.group.add(this.headHit);this.hitboxes=[this.headHit,this.bodyHit];
    this.makeGun();this.makeHealthDisplay(skin);this.makeGroundPool();this.floorRay.far=8;this.spawn();
    if(role==='sniper'){
      const geometry=new THREE.BufferGeometry();
      geometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(6),3));
      this.sightline=new THREE.Line(geometry,new THREE.LineBasicMaterial({color:0xffca55,transparent:true,opacity:.72,depthWrite:false}));
      this.sightline.frustumCulled=false;
      this.sightline.visible=false;
      scene.add(this.sightline);
    }
  }
  makeGun(){
    const ink=new THREE.MeshBasicMaterial({color:0x0b0b0d}),metal=new THREE.MeshToonMaterial({color:0x686a70}),ivory=new THREE.MeshBasicMaterial({color:0xe8e1cf});this.gun=new THREE.Group();this.gun.position.set(.63,.72,.2);this.group.add(this.gun);
    const receiver=new THREE.Mesh(new THREE.BoxGeometry(.88,.29,.32),ink);this.gun.add(receiver);
    const top=new THREE.Mesh(new THREE.BoxGeometry(.76,.12,.28),metal);top.position.set(-.04,.18,0);this.gun.add(top);
    const barrel=new THREE.Mesh(new THREE.CylinderGeometry(.075,.075,.8,8),ink);barrel.rotation.z=Math.PI/2;barrel.position.set(.69,.06,0);this.gun.add(barrel);
    const muzzle=new THREE.Mesh(new THREE.TorusGeometry(.105,.035,6,12),ivory);muzzle.position.set(1.1,.06,0);muzzle.rotation.y=Math.PI/2;this.gun.add(muzzle);
    const grip=new THREE.Mesh(new THREE.BoxGeometry(.24,.42,.24),ink);grip.position.set(-.06,-.31,0);grip.rotation.z=-.24;this.gun.add(grip);
    const drum=new THREE.Mesh(new THREE.CylinderGeometry(.2,.2,.24,12),metal);drum.rotation.x=Math.PI/2;drum.position.set(.12,-.25,0);this.gun.add(drum);
    this.muzzleAnchor=new THREE.Object3D();this.muzzleAnchor.position.set(1.12,.06,0);this.gun.add(this.muzzleAnchor);
    const burstShape=new THREE.Shape();for(let i=0;i<16;i++){const a=i/16*Math.PI*2,r=i%2?.22:.58,px=Math.cos(a)*r,py=Math.sin(a)*r;i?burstShape.lineTo(px,py):burstShape.moveTo(px,py);}burstShape.closePath();this.muzzleFlash=new THREE.Mesh(new THREE.ShapeGeometry(burstShape),new THREE.MeshBasicMaterial({color:0xfaf6eb,transparent:true,opacity:0,side:THREE.DoubleSide}));this.muzzleFlash.position.set(1.22,.06,0);this.muzzleFlash.scale.setScalar(.7);this.gun.add(this.muzzleFlash);
  }
  makeHealthDisplay(skin){
    const canvas=document.createElement('canvas');canvas.width=512;canvas.height=128;this.healthCanvas=canvas;this.healthCtx=canvas.getContext('2d');this.healthTexture=new THREE.CanvasTexture(canvas);this.healthTexture.colorSpace=THREE.SRGBColorSpace;
    this.healthSprite=new THREE.Sprite(new THREE.SpriteMaterial({map:this.healthTexture,transparent:true,depthWrite:false}));this.healthSprite.scale.set(3.8,.95,1);this.healthSprite.position.set(0,2.75,0);this.healthSprite.renderOrder=7;this.group.add(this.healthSprite);this.drawHealth();
  }
  makeGroundPool(){const c=document.createElement('canvas');c.width=c.height=128;const x=c.getContext('2d'),g=x.createRadialGradient(64,64,0,64,64,64);g.addColorStop(0,'rgba(255,232,158,.42)');g.addColorStop(.55,'rgba(255,207,72,.16)');g.addColorStop(1,'rgba(255,207,72,0)');x.fillStyle=g;x.fillRect(0,0,128,128);const map=new THREE.CanvasTexture(c);map.colorSpace=THREE.SRGBColorSpace;this.pool=new THREE.Mesh(new THREE.CircleGeometry(3.6,32),new THREE.MeshBasicMaterial({map,color:0xffe89e,transparent:true,opacity:.72,depthWrite:false,blending:THREE.AdditiveBlending,side:THREE.DoubleSide}));this.pool.rotation.x=-Math.PI/2;this.pool.position.y=-1.78;this.group.add(this.pool);}
  drawHealth(){if(!this.healthCtx)return;const c=this.healthCanvas,x=this.healthCtx;x.clearRect(0,0,c.width,c.height);x.fillStyle='#0b0b0d';x.fillRect(7,14,498,99);x.fillStyle='#faf6eb';x.fillRect(16,22,480,83);x.fillStyle='#222328';x.fillRect(22,28,468,71);x.fillStyle='#a61922';x.fillRect(27,33,458*Math.max(0,this.health/this.maxHealth),61);x.fillStyle='#faf6eb';x.font='bold 29px Georgia';x.textAlign='center';x.textBaseline='middle';x.strokeStyle='#0b0b0d';x.lineWidth=6;x.strokeText(`${Math.ceil(this.health)} / ${this.maxHealth}`,256,64);x.fillText(`${Math.ceil(this.health)} / ${this.maxHealth}`,256,64);this.healthTexture.needsUpdate=true;}
  spawn(){
    const {x,z,yaw,y}=this.spawnPoint;
    const floorY=y??this.arena.groundHeightAt(x,z);
    this.group.position.set(x,floorY+originHeight,z);
    this.group.rotation.set(0,yaw,0);
    this.position.copy(this.group.position);
    this.velocity.set(0,0,0);
    this.isGrounded=true;
    this.isSlamming=false;
    this.slamSequenceArmed=false;
    this.slamWindowTimer=0;
    this.dashCharges=2;
    this.dashTimer=0;
    this.dashBurstRemaining=0;
    this.jumpCooldown=0;
    this.bunnyHopTimer=0;
    this.ladder=null;
    this.ladderTimer=0;
    this.movePhase=0;
    this.dustTimer=0;

    this.maxHealth=this.settings.hp;
    this.health=this.maxHealth;
    this.hp=this.health;
    this.isDead=false;
    this.alive=true;
    this.ammo=this.maxAmmo;
    this.reloadTimer=0;
    this.burstLeft=0;
    this.burstCount=0;
    this.damageBurst=0;
    this.flashTimer=0;
    this.flashing=false;

    this.fireTimer=this.settings.reaction;
    this.reactionTimer=this.settings.reaction;
    this.aimLagTimer=this.settings.reaction;
    this.comboTimer=this.settings.combo;
    this.botAimPos.copy(this.player.camera.position).y-=.35;
    this.hadSight=false;
    this.sniperCharge=0;
    this.aimAtHead=false;
    this.pursuitPath=[];
    this.pursuitRepath=0;
    this.strafeSign=Math.random()<.5?-1:1;
    this.strafeTimer=.55+Math.random()*.6;
    this.jumpPeekTimer=2.5+Math.random()*3;
    this.coverPoint=null;
    this.coverRepathTimer=0;
    this.stuckElapsed=0;
    this.lastCheckPos.copy(this.position);
    this.state='SEEK_PLAYER';

    this.gun.rotation.set(0,0,0);
    this.muzzleFlash.material.opacity=0;
    this.sprite.position.y=.1;
    this.outline.position.y=0;
    this.spriteFrame=-1;
    this.group.visible=true;
    this.group.updateMatrixWorld(true);
    this.drawHealth();
    return this;
  }
  reset(){return this.spawn();}
  hasLineOfSight(point){const origin=this.group.position.clone().add(new THREE.Vector3(0,.76,0)),target=point.clone();target.y-=.35;if(this.arena.smokeBlocksSight(origin,target))return false;const delta=target.sub(origin),distance=delta.length();if(distance<.01)return true;this.ray.set(origin,delta.normalize());this.ray.far=Math.max(0,distance-.2);const hit=this.ray.intersectObjects(this.arena.arenaColliders||this.arena.colliders,false)[0];return !hit;}
  playerAimNear(){const direction=this.player.direction?.()||new THREE.Vector3(0,0,-1),origin=this.player.camera.position,offset=this.group.position.clone().add(new THREE.Vector3(0,.4,0)).sub(origin),along=Math.max(0,offset.dot(direction));return along<75&&offset.addScaledVector(direction,-along).length()<2.5;}
  chooseState(distance,los){
    if(!los)return 'SEEK_PLAYER';
    if(this.role==='rusher'&&distance>12)return 'RUSH_PLAYER';
    if(this.reloadTimer>0&&distance<36)return 'TAKE_COVER';
    if(this.comboTimer<1&&this.group.position.y<12&&this.difficulty!=='medium')return 'HIGH_GROUND_PUSH';
    if(this.playerAimNear()||this.damageBurst>=28||distance<10)return 'EVADE_TECH';
    return distance<=62?'ENGAGE_STRAFE':'SEEK_PLAYER';
  }
  reactToPlayerAction(event){
    const kind=typeof event==='string'?event:event?.kind;
    if(!['dash','slam','grapple','wall'].includes(kind))return;
    const lag=(kind==='dash'||kind==='grapple') ? .23 : .13;
    this.aimLagTimer=Math.max(this.aimLagTimer,lag);
    this.reactionTimer=Math.max(this.reactionTimer,lag);
  }
  chooseCoverPoint(){
    const towardPlayer=this.player.position.clone().sub(this.group.position);towardPlayer.y=0;if(towardPlayer.lengthSq()<.01)towardPlayer.set(0,0,1);towardPlayer.normalize();let best=null,bestDistance=Infinity;
    for(const {box,object} of this.arena.collisionBoxes||[]){const sx=box.max.x-box.min.x,sy=box.max.y-box.min.y,sz=box.max.z-box.min.z;if(sx>14||sz>14||sy>13||sy<1||object?.userData?.isRamp)continue;const center=new THREE.Vector3((box.min.x+box.max.x)/2,0,(box.min.z+box.max.z)/2),away=center.clone().sub(this.player.position);away.y=0;if(away.lengthSq()<.01)away.copy(towardPlayer).negate();away.normalize();const point=center.clone().addScaledVector(away,Math.max(sx,sz)*.5+1.8);point.y=this.group.position.y;const distance=point.distanceTo(this.group.position);if(distance<bestDistance&&distance<38){best=point;bestDistance=distance;}}
    return best||this.group.position.clone().addScaledVector(towardPlayer,-7);
  }
  updateHumanAim(dt,distance){
    if(this.aimLagTimer>0)return;
    const target=this.player.camera.position.clone().addScaledVector(this.player.velocity,this.settings.lead*distance/95);
    target.y-=this.aimAtHead ? .015 : .35;
    this.botAimPos.lerp(target,-Math.expm1(-this.settings.aimLerpSpeed*dt));
  }
  pursuitHeading(dt){
    const from=this.group.position,target=this.player.position;
    let destination=target;
    if(target.y-from.y>4){
      const heights=(this.arena.ramps??[]).flatMap(ramp=>{
        const {width}=ramp.geometry.parameters;
        const a=new THREE.Vector3(-width*.50,0,0).applyMatrix4(ramp.matrixWorld);
        const b=new THREE.Vector3(width*.50,0,0).applyMatrix4(ramp.matrixWorld);
        const [low,high]=a.y<b.y?[a,b]:[b,a];
        if(Math.abs(high.y-(target.y-originHeight))>3.6)return [];
        const approach=from.y-originHeight>low.y+.55||Math.hypot(from.x-low.x,from.z-low.z)<3.1;
        return [{entry:approach?high:low,exit:high}];
      });
      for(const ladder of this.arena.ladders??[]){
        if(Math.abs(ladder.topY-(target.y-originHeight))>5)continue;
        heights.push({entry:new THREE.Vector3(ladder.x,0,ladder.z),exit:new THREE.Vector3(ladder.x,ladder.topY,ladder.z),ladder});
      }
      let best=Infinity, chosenLadder=null;
      for(const route of heights){
        const score=Math.hypot(route.entry.x-from.x,route.entry.z-from.z)+
          1.4*Math.hypot(route.exit.x-target.x,route.exit.z-target.z);
        if(score>=best)continue;
        best=score;
        destination=route.entry;
        chosenLadder=route.ladder;
      }
      if(chosenLadder&&Math.hypot(destination.x-from.x,destination.z-from.z)<1)this.ladder=chosenLadder;
    }
    const direct=destination.clone().sub(from).setY(0);
    if(direct.lengthSq()<.1)return direct;
    const distance=direct.length(), heading=direct.clone().divideScalar(distance);
    const blocked=laneBlocked(this.arena.collisionBoxes,from,heading.x,heading.z,Math.min(13,distance),from.y-originHeight);
    if(!blocked&&!this.pursuitPath.length){
      this.pursuitPath=[];
      this.pursuitRepath=0;
      return direct;
    }
    if(from.y>4.2)return direct;
    this.pursuitRepath-=dt;
    if(this.pursuitRepath<=0&&(!this.pursuitPath.length||blocked)){
      this.pursuitPath=lanePath(this.arena,from,destination);
      this.pursuitRepath=.65;
    }
    while(this.pursuitPath.length&&Math.hypot(this.pursuitPath[0].x-from.x,this.pursuitPath[0].z-from.z)<1.65)this.pursuitPath.shift();
    return this.pursuitPath.length?this.pursuitPath[0].clone().sub(from).setY(0):direct;
  }
  nearestLadder(){return (this.arena.ladders||[]).slice().sort((a,b)=>this.group.position.distanceToSquared(a.center)-this.group.position.distanceToSquared(b.center))[0];}
  dash(){if(this.dashCharges<=0||this.dashTimer>0)return;const away=this.group.position.clone().sub(this.player.position);away.y=0;if(away.lengthSq()<.01)away.set(0,0,1);away.normalize();const side=new THREE.Vector3(-away.z,0,away.x).multiplyScalar(Math.random()<.5?-1:1);this.velocity.addScaledVector(side,22);const flat=new THREE.Vector3(this.velocity.x,0,this.velocity.z).clampLength(0,44);this.velocity.x=flat.x;this.velocity.z=flat.z;this.dashCharges--;this.dashTimer=this.settings.dash;this.dashBurstRemaining=.22;this.audio?.dash?.();burst(this.scene,this.group.position.clone().add(new THREE.Vector3(0,.4,0)),0xe8e1cf,13,8);}
  floorBelow(feet){
    this.floorRay.set(new THREE.Vector3(this.group.position.x,feet+.68,this.group.position.z),new THREE.Vector3(0,-1,0));
    this.floorRay.near=0;this.floorRay.far=48;
    return this.floorRay.intersectObjects(this.arena.colliders,false).find(hit=>!hit.object.userData.isEnemyHitbox)??null;
  }
  resolveHorizontalAxis(axis,amount){
    const p=this.group.position;if(!amount)return;
    const feet=p.y-originHeight,head=feet+3.2,half=.85;
    if(axis==='x')p.x+=amount;else p.z+=amount;
    for(const {box} of this.arena.collisionBoxes||[]){
      if(head<=box.min.y+.02||feet>=box.max.y-.08)continue;
      if(p.x+half<=box.min.x||p.x-half>=box.max.x||p.z+half<=box.min.z||p.z-half>=box.max.z)continue;
      if(axis==='x'){p.x=amount>0?box.min.x-half:box.max.x+half;this.velocity.x=0;}
      else{p.z=amount>0?box.min.z-half:box.max.z+half;this.velocity.z=0;}
    }
    const limit=66;if(axis==='x'&&(p.x>limit||p.x< -limit)){p.x=THREE.MathUtils.clamp(p.x,-limit,limit);this.velocity.x=0;}if(axis==='z'&&(p.z>limit||p.z< -limit)){p.z=THREE.MathUtils.clamp(p.z,-limit,limit);this.velocity.z=0;}
  }
  steerAroundObstacles(heading){
    if(heading.lengthSq()<.01)return heading;
    const base=heading.clone().normalize(),from=this.group.position,feet=from.y-originHeight;
    const clear=(dir,length)=>!laneBlocked(this.arena.collisionBoxes,from,dir.x,dir.z,length,feet);
    if(clear(base,3))return heading;
    for(const angle of [35,65,95,135,170]){
      for(const side of [this.strafeSign,-this.strafeSign]){
        const steer=base.clone().applyAxisAngle(UP,THREE.MathUtils.degToRad(side*angle));
        if(clear(steer,3))return steer;
      }
    }
    return heading;
  }
  update(rawDt,time){
    if(!this.alive)return;
    const dt=Math.min(Math.max(rawDt,.001),.05);this.movePhase+=dt;this.fireTimer-=dt;this.reactionTimer=Math.max(0,this.reactionTimer-dt);const wasReloading=this.reloadTimer>0;this.reloadTimer=Math.max(0,this.reloadTimer-dt);if(wasReloading&&this.reloadTimer===0)this.ammo=this.maxAmmo;this.aimLagTimer=Math.max(0,this.aimLagTimer-dt);this.dashTimer=Math.max(0,this.dashTimer-dt);this.dashBurstRemaining=Math.max(0,(this.dashBurstRemaining||0)-dt);this.jumpCooldown=Math.max(0,(this.jumpCooldown||0)-dt);this.comboTimer-=dt;this.slamWindowTimer=Math.max(0,this.slamWindowTimer-dt);this.flashTimer=Math.max(0,this.flashTimer-dt);this.damageBurst=Math.max(0,this.damageBurst-dt*24);this.bunnyHopTimer=Math.max(0,this.bunnyHopTimer-dt);this.strafeTimer-=dt;this.jumpPeekTimer-=dt;this.coverRepathTimer-=dt;
    if(this.strafeTimer<=0){this.strafeSign=-this.strafeSign;this.strafeTimer=.29+Math.random()*.28;}
    if(this.ammo<=0&&this.reloadTimer<=0){this.reloadTimer=1.4;this.fireTimer=1.4;this.burstLeft=0;this.coverPoint=this.chooseCoverPoint();this.coverRepathTimer=.8;}
    const p=this.group.position,playerPos=this.player.position,delta=playerPos.clone().sub(p),flat=new THREE.Vector3(delta.x,0,delta.z),distance=flat.length(),toPlayer=flat.lengthSq()?flat.normalize():new THREE.Vector3(0,0,1),perp=new THREE.Vector3(-toPlayer.z,0,toPlayer.x);
    const los=this.hasLineOfSight(this.player.camera.position);
    if(los&&!this.hadSight){
      this.reactionTimer=Math.max(this.reactionTimer,this.settings.reaction);
      this.aimAtHead=Math.random()<(this.settings.headshotChance??0);
    }
    this.hadSight=los;
    const onPerch=this.role==='sniper'&&p.y>this.spawnPoint.y+.9;
    this.state=onPerch?'HOLD_PERCH':this.chooseState(distance,los);
    let desired=new THREE.Vector3(),orbit=this.strafeSign;
    if(this.state==='SEEK_PLAYER')desired.copy(this.pursuitHeading(dt));
    else if(this.state==='RUSH_PLAYER')desired.copy(toPlayer).addScaledVector(perp,orbit*.32);
    else if(this.state==='ENGAGE_STRAFE'){desired.addScaledVector(toPlayer,distance>28?.76:distance<13?-.38:.19);desired.addScaledVector(perp,orbit);}
    else if(this.state==='EVADE_TECH'){desired.addScaledVector(perp,orbit);desired.addScaledVector(toPlayer,-.34);if((this.playerAimNear()||this.damageBurst>20)&&this.dashTimer<=0)this.dash();}
    else if(this.state==='TAKE_COVER'){if(!this.coverPoint||this.coverRepathTimer<=0){this.coverPoint=this.chooseCoverPoint();this.coverRepathTimer=.8;}desired.copy(this.coverPoint).sub(p);desired.y=0;if(desired.lengthSq()<4)desired.addScaledVector(perp,orbit*.18);}
    else if(this.state==='HIGH_GROUND_PUSH'){const ladder=this.nearestLadder();if(ladder){const toward=ladder.center.clone().sub(p);toward.y=0;if(toward.length()<2.2){this.ladder=ladder;this.ladderTimer=0;}else desired.copy(toward.normalize());}else desired.copy(toPlayer);}
    if(this.role==='rusher'&&distance<47&&this.dashTimer<=0)this.dash();
    if(this.ladder){const ladderDir=new THREE.Vector3(this.ladder.x-p.x,0,this.ladder.z-p.z);desired.copy(ladderDir);if(p.y-originHeight>=this.ladder.topY-.12){this.ladder=null;this.velocity.y=Math.max(this.velocity.y,4);this.comboTimer=0;}else this.velocity.y=13;}
    const sprinting=this.state==='SEEK_PLAYER'||this.state==='RUSH_PLAYER';
    const desiredSpeed=desired.lengthSq()?this.settings.speed*(sprinting?1.19:1):0;
    const dashActive=this.dashBurstRemaining>0;
    if(desired.lengthSq())desired.normalize();
    if(!this.ladder)desired=this.steerAroundObstacles(desired);
    const horizontal=new THREE.Vector3(this.velocity.x,0,this.velocity.z),target=desired.multiplyScalar(desiredSpeed);
    if(!dashActive){
      if(desiredSpeed>0)horizontal.addScaledVector(target.clone().sub(horizontal).normalize(),Math.min(150*dt,target.distanceTo(horizontal)));
      else horizontal.multiplyScalar(Math.exp(-8*dt));
    }
    horizontal.clampLength(0,dashActive?44:32);this.velocity.x=horizontal.x;this.velocity.z=horizontal.z;
    if(this.stuckElapsed===undefined){this.stuckElapsed=0;this.lastCheckPos=p.clone();}
    this.stuckElapsed+=dt;
    if(this.stuckElapsed>=.48){
      if(!this.ladder&&desiredSpeed>2&&p.distanceTo(this.lastCheckPos)<1.1){
        this.pursuitPath=[];
        this.pursuitRepath=0;
        this.strafeSign=-this.strafeSign;
      }
      this.lastCheckPos.copy(p);
      this.stuckElapsed=0;
    }
    if(this.ladder){const ladder=this.ladder;this.velocity.x=THREE.MathUtils.damp(this.velocity.x,THREE.MathUtils.clamp((ladder.x-p.x)*5,-8,8),8,dt);this.velocity.z=THREE.MathUtils.damp(this.velocity.z,THREE.MathUtils.clamp((ladder.z-p.z)*5,-8,8),8,dt);}
    const jumpAllowed=this.role!=='sniper'&&this.isGrounded&&this.jumpCooldown<=0&&!this.ladder;
    if(jumpAllowed&&this.jumpPeekTimer<=0&&distance>9&&distance<48&&this.state!=='RUSH_PLAYER'){
      this.velocity.y=16.5;this.isGrounded=false;this.jumpCooldown=1.8;this.jumpPeekTimer=(this.difficulty==='medium'?4.8:3.2)+Math.random()*2.3;this.slamSequenceArmed=this.difficulty!=='medium'&&Math.random()<.32;
    }else if(jumpAllowed&&this.difficulty!=='medium'&&this.comboTimer<=0&&this.state==='HIGH_GROUND_PUSH'){
      this.velocity.y=16.5;this.isGrounded=false;this.jumpCooldown=1.8;this.slamSequenceArmed=true;this.comboTimer=this.settings.combo;
    }
    if(this.slamSequenceArmed&&!this.isGrounded&&!this.isSlamming&&this.velocity.y<=0){this.isSlamming=true;this.velocity.y=-48;this.slamSequenceArmed=false;}
    if(!this.isGrounded&&!this.ladder)this.velocity.y-=42*dt;
    const previousFeet=p.y-originHeight,previousHead=previousFeet+3.2;
    // X and Z are resolved independently with short swept steps to avoid tunnelling.
    const travel=Math.max(Math.abs(this.velocity.x),Math.abs(this.velocity.z))*dt,steps=Math.max(1,Math.ceil(travel/.45));
    for(let i=0;i<steps;i++){this.resolveHorizontalAxis('x',this.velocity.x*dt/steps);this.resolveHorizontalAxis('z',this.velocity.z*dt/steps);}
    p.y+=this.velocity.y*dt;
    const feet=p.y-originHeight,head=feet+3.2;
    if(this.velocity.y>0){for(const {box} of this.arena.collisionBoxes||[]){if(p.x+.85<=box.min.x||p.x-.85>=box.max.x||p.z+.85<=box.min.z||p.z-.85>=box.max.z)continue;if(previousHead<=box.min.y&&head>box.min.y){p.y=box.min.y-3.2+originHeight;this.velocity.y=0;break;}}}
    const floor=this.floorBelow(Math.max(previousFeet,feet));
    const floorY=floor?.point.y??-Infinity,nowFeet=p.y-originHeight;
    if(this.isGrounded&&Math.abs(nowFeet-floorY)<=.68)p.y=floorY+originHeight;
    else if(this.isGrounded)this.isGrounded=false;
    const landed=!this.isGrounded&&this.velocity.y<=.5&&nowFeet<=floorY+.12;
    if(landed){p.y=floorY+originHeight;this.velocity.y=0;this.isGrounded=true;this.ladder=null;this.jumpCooldown=Math.max(this.jumpCooldown,1.8);if(this.isSlamming){this.isSlamming=false;this.slamWindowTimer=.18;burst(this.scene,new THREE.Vector3(p.x,floorY+.1,p.z),0xe8e1cf,24,14);comicText(this.scene,'SLAM!',new THREE.Vector3(p.x,floorY+1,p.z),'#faf6eb',1,.6);this.audio?.slam?.();}if(this.slamWindowTimer>0){this.slamWindowTimer=0;this.slamSequenceArmed=false;this.velocity.y=28;this.isGrounded=false;this.jumpCooldown=3.5;this.comboTimer=this.settings.combo;comicText(this.scene,'BOING!',p.clone().add(new THREE.Vector3(0,2,0)),'#ffe89e',1,.55);this.audio?.superJump?.();}}
    else if(!this.isGrounded||this.velocity.y>0){this.isGrounded=false;}
    if(this.isGrounded){this.velocity.y=0;if(this.dashCharges<2)this.dashCharges=2;}
    this.group.position.x=THREE.MathUtils.clamp(p.x,-66,66);this.group.position.z=THREE.MathUtils.clamp(p.z,-66,66);this.position.copy(p);
    this.updateHumanAim(dt,p.distanceTo(this.player.camera.position));
    this.group.rotation.y=Math.atan2(this.botAimPos.x-p.x,this.botAimPos.z-p.z);
    const gunPivot=this.group.localToWorld(this.gun.position.clone());
    const aim=this.botAimPos.clone().sub(gunPivot);
    this.gun.rotation.set(0,-Math.PI/2,Math.atan2(aim.y,Math.hypot(aim.x,aim.z)),'YXZ');
    const frame=Math.floor(time*12);
    if(frame!==this.spriteFrame){
      this.spriteFrame=frame;
      const old=this.sprite.material.map, oldRim=this.outline.material.map;
      const [art,rim]=this.role?waveFrame(this.skin,frame%4):[rubberHoseTexture(this.skin,frame%4)];
      this.sprite.material.map=art;
      this.outline.material.map=rim??goldRimTexture(art);
      if(!this.role){old?.dispose();oldRim?.dispose();}
    }
    const ducking=this.reloadTimer>0&&this.coverPoint&&p.distanceTo(this.coverPoint)<2.8;this.sprite.position.y=.1+Math.sin(time*8)*.09-(ducking ? .38 : 0);this.outline.position.y=this.sprite.position.y;this.muzzleFlash.material.opacity=Math.max(0,this.muzzleFlash.material.opacity-dt*8);if(this.flashTimer>0&&!this.flashing){this.healthCtx.fillStyle='rgba(250,246,235,.8)';this.healthCtx.fillRect(0,0,512,128);this.healthTexture.needsUpdate=true;this.flashing=true;}else if(this.flashTimer===0&&this.flashing){this.drawHealth();this.flashing=false;}
    if(this.dustTimer>0)this.dustTimer-=dt;else if(this.isGrounded&&horizontal.length()>8){inkDust(this.scene,p.clone().add(new THREE.Vector3(0,-1.7,0)),.65);this.dustTimer=.25;}
    const inRange=los&&distance>=8&&distance<=(this.settings.range??75);
    const ready=inRange&&this.reactionTimer<=0&&this.aimLagTimer<=0&&this.reloadTimer<=0&&this.fireTimer<=0&&this.ammo>0;
    if(this.sightline)this.updateSniperCharge(dt,ready);
    else if(ready)this.fireAtPlayer();
  }
  updateSniperCharge(dt,ready){
    this.sightline.visible=ready;
    if(!ready){this.sniperCharge=0;return;}
    this.sniperCharge=Math.min(sniperChargeTime,this.sniperCharge+dt);
    const tip=this.gun.localToWorld(new THREE.Vector3(1.12,.06,0));
    const position=this.sightline.geometry.attributes.position;
    position.setXYZ(0,tip.x,tip.y,tip.z);
    position.setXYZ(1,this.botAimPos.x,this.botAimPos.y,this.botAimPos.z);
    position.needsUpdate=true;
    this.sightline.material.opacity=.42+.53*this.sniperCharge/sniperChargeTime;
    if(this.sniperCharge>=sniperChargeTime){
      this.fireAtPlayer();
      this.sniperCharge=0;
      this.sightline.visible=false;
    }
  }
  fireAtPlayer(){
    if(this.burstLeft<=0)this.burstLeft=this.settings.burst;
    this.burstLeft--;this.ammo--;
    const origin=this.gun.localToWorld(new THREE.Vector3(1.12,.06,0)),aim=this.botAimPos.clone().sub(origin).normalize();
    const right=new THREE.Vector3().crossVectors(aim,Math.abs(aim.y)<.98?UP:new THREE.Vector3(0,0,1)).normalize();
    const up=new THREE.Vector3().crossVectors(right,aim).normalize();
    const spread=Math.tan(THREE.MathUtils.degToRad(this.settings.spread))*Math.sqrt(Math.random());
    const angle=Math.random()*Math.PI*2;
    aim.addScaledVector(right,Math.cos(angle)*spread).addScaledVector(up,Math.sin(angle)*spread).normalize();
    this.ray.set(origin,aim);this.ray.far=(this.settings.range??75)+10;
    const hit=this.ray.intersectObjects(this.arena.arenaColliders||this.arena.colliders,false)[0],end=hit?.point||origin.clone().addScaledVector(aim,70);
    const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints([origin,end]),new THREE.LineBasicMaterial({color:0xfaf6eb,transparent:true,opacity:.9}));this.scene.add(line);setTimeout(()=>{this.scene.remove(line);line.geometry.dispose();line.material.dispose();},100);
    if(hit)burst(this.scene,hit.point,0xe8e1cf,7,4);
    const head=this.player.camera.position.clone().add(new THREE.Vector3(0,.025,0));
    const headHit=this.ray.ray.intersectSphere(new THREE.Sphere(head,.21),new THREE.Vector3());
    const chest=head.clone().add(new THREE.Vector3(0,-.375,0));
    const hitPlayer=headHit??this.ray.ray.intersectSphere(new THREE.Sphere(chest,.62),new THREE.Vector3());
    if(hitPlayer&&(!hit||origin.distanceTo(hitPlayer)<hit.distance)&&!this.arena.smokeBlocksSight(origin,hitPlayer)){
      this.player.takeDamage(this.settings.damage,this.position,{headshot:Boolean(headHit),airborne:!this.isGrounded});
    }
    this.muzzleFlash.material.opacity=1;this.muzzleFlash.scale.setScalar(.8+Math.random()*.6);this.audio?.ratTat?.();this.audio?.botShot?.();
    if(this.burstLeft>0)this.fireTimer=(this.settings.burstInterval??.105)+Math.random()*.012;
    else{this.fireTimer=this.settings.pause;this.aimAtHead=Math.random()<(this.settings.headshotChance??0);}
    if(this.ammo<=0){this.reloadTimer=1.4;this.fireTimer=1.4;this.coverPoint=this.chooseCoverPoint();this.coverRepathTimer=.8;}
  }  takeDamage(amount,part='body'){if(!this.alive)return false;this.health=Math.max(0,this.health-amount);this.hp=this.health;this.damageBurst+=amount;this.flashTimer=.08;this.flashing=false;this.drawHealth();this.audio?.hit?.();if(this.health<=0){this.alive=false;this.isDead=true;this.group.visible=false;burst(this.scene,this.group.position.clone().add(new THREE.Vector3(0,1,0)),0xe8e1cf,28,12);return true;}return false;}
  setSkin(skin){if(this.skin===skin)return;const old=this.sprite.material.map,oldRim=this.outline.material.map;this.skin=skin;this.sprite.material.map=rubberHoseTexture(skin,this.spriteFrame);this.outline.material.map=goldRimTexture(this.sprite.material.map);this.sprite.material.needsUpdate=true;this.outline.material.needsUpdate=true;old?.dispose();oldRim?.dispose();}
  launchFromBlast(origin,strength){
    const direction=this.position.clone().sub(origin);
    direction.y=0;
    this.velocity.addScaledVector(direction.normalize(),strength*9);
    this.velocity.y=Math.max(this.velocity.y,4+strength*17);
    this.ladder=null;
    this.isSlamming=false;
    this.slamSequenceArmed=false;
    this.isGrounded=false;
  }
  dispose(){
    this.scene.remove(this.group);
    this.group.traverse(object=>{
      object.geometry?.dispose();
      for(const material of [object.material].flat().filter(Boolean)){
        const waveArt=this.role&&(object===this.sprite||object===this.outline);
        if(!waveArt)material.map?.dispose();
        material.dispose();
      }
    });
    if(this.sightline){
      this.scene.remove(this.sightline);
      this.sightline.geometry.dispose();
      this.sightline.material.dispose();
    }
  }
}
