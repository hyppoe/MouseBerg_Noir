import * as THREE from 'three';
import { comicText, burst, inkDust, tuning, setComicFx, triggerComicFx, rubberHoseCast, rubberHoseArsenal, weaponFinishes } from './comicShader.js';

const UP=new THREE.Vector3(0,1,0);
const rankNames=['D','C','B','A','S','SS','SSS'];
const slideSpeedCap=48;
const slideHopRetention=.95;
const slideHopBonus=4.5;
const slideLandingWindow=.24;
const coyoteDuration=.15;
export const signaturePerks = {
  bug: {name:'Wing Flutter', description:'Two air jumps with ink puffs', airJumps:2},
  slinky: {name:'Elastic Reach', description:'98-unit hook · +15% pull', grappleRange:98, grapplePull:1.15},
  velvet: {name:'Catwalk Stride', description:'+25% aimed speed · 20% less bloom', aimSpeed:1.25, bloom:.8},
  parsnip: {name:'Thick Skin', description:'120 HP · half gadget damage', maxHealth:120, gadgetDamage:.5},
  kitty: {name:'Alley Cat', description:'+20% wall speed and kick · +25% stamina recovery', wallSpeed:1.2, staminaRegen:1.25},
  hattie: {name:'Second Wind', description:'Airborne stamina recovery · +15 HP per elimination', airStamina:true, eliminationHeal:15}
};

export const controlActions = [
  ['forward','Move forward','KeyW'], ['left','Move left','KeyA'],
  ['back','Move back','KeyS'], ['right','Move right','KeyD'],
  ['jump','Jump / double jump / wall-jump','Space'], ['sprint','Sprint','ShiftLeft'],
  ['slide','Slide / slam','KeyC'], ['dash','Dash','KeyE'], ['grapple','Grapple','KeyF'],
  ['bulletTime','Bullet-time','KeyQ'], ['reload','Reload','KeyR'], ['gadget','Throw gadget','KeyG'],
  ['trial','Start / cancel rooftop trial','KeyT']
];
export const defaultBindings = Object.fromEntries(controlActions.map(([action,,code])=>[action,code]));
export const defaultCamera = {fov:80,sensitivity:.002,shakeIntensity:1};
export function bindingCode(event){return event.code==='ShiftRight'?'ShiftLeft':event.code;}

export function isBindable(code){
  return code!=='KeyP'&&/^(?:Key[A-Z]|Digit\d|Arrow(?:Up|Down|Left|Right)|Numpad[0-9]|ShiftLeft|Space|Enter|Backspace|Comma|Period|Slash|Semicolon|Quote|Backquote|Minus|Equal|BracketLeft|BracketRight|Backslash)$/.test(code);
}

const keyNames = {ShiftLeft:'SHIFT',Space:'SPACE',Enter:'ENTER',Backspace:'⌫',ArrowUp:'↑',ArrowDown:'↓',ArrowLeft:'←',ArrowRight:'→',
  Comma:',',Period:'.',Slash:'/',Semicolon:';',Quote:"'",Backquote:'`',Minus:'−',Equal:'=',BracketLeft:'[',BracketRight:']',Backslash:'\\'};
export function keyLabel(code){return keyNames[code]??code.replace(/^(Key|Digit)/,'').replace('Numpad','NUM ');}

export class Player {
  constructor({camera,renderer,scene,arena,audio,onAction,onTargetHit,onPause,settings={...defaultCamera,bindings:{...defaultBindings}}}){
    this.settings=settings;
    this.camera=camera;this.renderer=renderer;this.scene=scene;this.arena=arena;this.audio=audio;this.onAction=onAction;this.onTargetHit=onTargetHit;this.onPause=onPause;
    camera.rotation.order='YXZ';this.yaw=camera.rotation.y;this.pitch=camera.rotation.x;this.isLocked=false;this.position=camera.position.clone();this.velocity=new THREE.Vector3();this.keys=new Set();this.ray=new THREE.Raycaster();this.clock=0;
    this.isGrounded=false;this.wasGrounded=false;this.wallSide=0;this.wallRun=0;this.slide=0;this.isSlamming=false;this.slamWindowTimer=0;this.jumpBufferTimer=0;this.spaceJustPressed=false;this.spaceReleasedGrapple=false;this.coyoteTimer=0;this.ladderClimbing=null;this.ladderTickTimer=0;
    this.dashCharges=2;this.dashCooldown=0;this.grappleCooldown=0;this.anchor=null;this.anchorNormal=new THREE.Vector3(0,1,0);this.grappleLine=null;this.grappleHook=null;this.grappleSwing=0;this.grappleTarget=null;this.wallInfo=null;this.wallKickTilt=0;
    this.focus=1;this.bulletTime=false;this.zooming=false;this.style=0;this.styleDecay=0;this.seenMoves=new Map();this.actionPulse=0;this.shotCooldown=0;
    this.ammo=40;this.magazine=40;this.isFiring=false;this.isReloading=false;this.reloadTimer=0;this.reloadDuration=1.45;this.reloadFoleyStage=-1;this.dustTimer=0;this.shotBloom=0;this.pitchRecoil=0;this.shotsFired=0;this.shotsHit=0;this.headshots=0;this.smokePuffs=[];
    this.selectedSkin='bug';this.selectedWeapon='automatic';this.weaponStats=rubberHoseArsenal[0];
    this.weaponFinish=weaponFinishes[0];
    this.activeSteamVent=null;
    this.airJumpsRemaining=this.perk.airJumps??1;
    this.adsProgress=0;this.firePoseTimer=0;this.gadgetCooldown=0;
    this.opponents=[];
    this.gauntletUpgrades=null;
    this.health=100;this.maxHealth=100;this.healthRegenDelay=0;this.stamina=100;this.maxStamina=100;this.sprintRegenDelay=0;this.isSprinting=false;this.controlLocked=false;this.mode='menu';
    this.baseRunSpeed=tuning.baseSpeed;this.playerRadius=.36;this.bodyTop=.18;this.maxStep=.6;this.worldBounds=arena.bounds||79.4;this.slideCooldown=0;this.trauma=0;
    this.slideHop=false;this.slideChain=0;this.slideLandingTimer=0;this.slideInputBuffer=0;this.superJumpRising=false;
    this.baseEye=1.72;this.eye=this.baseEye;this.recoil=0;this.zoomRoll=0;this.tetherFrame=-1;this.makeWeapon();
    this.bindInput();
  }
  bindInput(){
    document.addEventListener('pointerlockchange',()=>{
      this.isLocked=document.pointerLockElement===this.renderer.domElement;
      if(this.isLocked)document.querySelector('#prompt').textContent='';
      else { this.zooming=false;this.isFiring=false; }
    });
    document.addEventListener('mousemove',e=>{
      if(this.controlLocked||document.pointerLockElement!==this.renderer.domElement)return;
      const dx=e.movementX||0,dy=e.movementY||0;
      if(Math.abs(dx)>150||Math.abs(dy)>150)return;
      const sensitivity=this.settings.sensitivity*(this.zooming ? .55 : 1);
      this.yaw-=dx*sensitivity;
      this.pitch=THREE.MathUtils.clamp(this.pitch-dy*sensitivity,-Math.PI*.49,Math.PI*.49);
      this.camera.rotation.set(this.pitch,this.yaw,0,'YXZ');
    });
    window.addEventListener('keydown',e=>{
      if(e.defaultPrevented||this.controlLocked||e.metaKey||e.ctrlKey||e.altKey)return;
      if((e.code==='Escape'&&this.isLocked)||e.code==='KeyP'){
        if(!e.repeat)this.onPause?.();
        return;
      }
      const code=bindingCode(e);
      const action=Object.keys(this.settings.bindings).find(name=>this.settings.bindings[name]===code);
      if(!action)return;
      e.preventDefault();
      this.keys.add(code);
      if(action==='bulletTime')this.setBullet(true);
      if(e.repeat)return;
      switch(action){
        case 'grapple': this.fireGrapple(); break;
        case 'dash': this.dash(); break;
        case 'slide': this.slideOrSlam(); break;
        case 'reload': this.reload(); break;
        case 'gadget': this.throwGadget(); break;
        case 'trial': this.onAction?.({trial:true}); break;
        case 'jump':
          this.jumpBufferTimer=.2;this.spaceJustPressed=true;
          if(this.anchor){this.spaceReleasedGrapple=true;this.releaseGrapple();}
          break;
      }
    });
    window.addEventListener('keyup',e=>{
      const code=bindingCode(e);
      this.keys.delete(code);
      if(code===this.settings.bindings.bulletTime&&this.bulletTime)this.setBullet(false);
      if(code===this.settings.bindings.grapple&&this.anchor)this.releaseGrapple();
    });
    window.addEventListener('mousedown',e=>{if(e.button===0){if(this.isLocked&&!this.controlLocked){this.isFiring=true;this.shoot();}}if(e.button===2&&this.isLocked&&!this.controlLocked){e.preventDefault();this.zooming=true;}});
    window.addEventListener('mouseup',e=>{if(e.button===0)this.isFiring=false;if(e.button===2)this.zooming=false;});
    window.addEventListener('contextmenu',e=>{if(this.isLocked)e.preventDefault();});
    window.addEventListener('blur',()=>{
      this.keys.clear();this.zooming=false;this.isFiring=false;
      if(this.anchor)this.releaseGrapple();
      if(this.bulletTime)this.setBullet(false);
    });
  }
  makeWeapon(){
    this.weaponCanvas=document.querySelector('#ink-viewmodel');this.weaponCtx=this.weaponCanvas?.getContext('2d');this.resizeWeaponCanvas(false);this.renderInkWeapon(0);
  }
  resizeWeaponCanvas(render=true){if(!this.weaponCanvas)return;const width=Math.max(1,Math.floor(window.innerWidth)),height=Math.max(1,Math.floor(window.innerHeight));if(this.weaponCanvas.width!==width||this.weaponCanvas.height!==height){this.weaponCanvas.width=width;this.weaponCanvas.height=height;this.weaponCtx=this.weaponCanvas.getContext('2d');if(render)this.renderInkWeapon(this.clock||0);}}
  get perk(){return signaturePerks[this.selectedSkin];}
  get reloadTime(){return this.reloadDuration/(this.gauntletUpgrades?.reload??1);}
  get grappleRange(){return this.perk.grappleRange??75;}
  resetAirJumps(){this.airJumpsRemaining=this.perk.airJumps??1;}
  get doubleJumpAvailable(){return this.airJumpsRemaining>0;}
  setSkin(skin){
    if(!Object.hasOwn(signaturePerks,skin)||skin===this.selectedSkin)return;
    const healthFraction=this.health/this.maxHealth;
    this.selectedSkin=skin;
    this.maxHealth=(this.perk.maxHealth??100)+(this.gauntletUpgrades?.maxHealth??0);
    this.health=healthFraction*this.maxHealth;
    this.resetAirJumps();
    this.renderInkWeapon(this.clock);
    this.duelBot?.setSkin(skin);
  }
  equipWeapon(id){const stats=rubberHoseArsenal.find(w=>w.id===id);if(!stats)return;const changed=this.selectedWeapon!==id;this.selectedWeapon=id;this.weaponStats=stats;this.magazine=stats.mag;this.ammo=stats.mag;this.reloadDuration=stats.reload;this.reloadFoleyStage=-1;this.isReloading=false;this.shotCooldown=0;this.shotBloom=0;if(changed)this.audio.weaponEquip?.(id);this.renderInkWeapon(this.clock);this.updateHud();}
  equipFinish(id){
    const finish=weaponFinishes.find(item=>item.id===id);
    if(!finish)return;
    this.weaponFinish=finish;
    this.renderInkWeapon(this.clock);
  }
  renderInkWeapon(time){
    const ctx=this.weaponCtx;
    if(!ctx)return;
    this.resizeWeaponCanvas(false);
    const {width,height}=this.weaponCanvas, unit=Math.min(height,width*.94);
    ctx.clearRect(0,0,width,height);
    const blend=THREE.MathUtils.smoothstep(this.adsProgress,0,1);
    const cel=Math.floor(time*12);
    const bob=Math.sin(cel*Math.PI*.5);
    const moving=THREE.MathUtils.clamp(Math.hypot(this.velocity.x,this.velocity.z)/22,0,1);
    const settle=Math.sin(Math.PI*THREE.MathUtils.smoothstep(blend,.72,1))*(.074+.014*bob);
    const recoil=this.recoil;
    const reload=this.isReloading ? Math.sin(Math.PI*THREE.MathUtils.clamp(1-this.reloadTimer/this.reloadTime,0,1)) : 0;
    const sniper=this.selectedWeapon==='sniper', drum=this.selectedWeapon==='automatic';
    const barrel=sniper?.97:drum?.76:.66;
    const yaw=-1.02*(1-blend), roll=(-Math.PI*22/180+(this.slide>0?-.1:0))*(1-blend)+reload*.2;
    const muzzleY=height*.548, depthScale=.43+.38*blend;
    const fore=.54-.20*blend;
    const centerX=THREE.MathUtils.lerp(width*.805,width*.5,blend)+bob*(2+moving*8)*(1-blend);
    const centerY=THREE.MathUtils.lerp(height*.815,muzzleY+unit*barrel*fore/(1+barrel*depthScale),blend)
      -Math.sin(blend*Math.PI)*18+bob*(3+moving*12)*(1-blend)+unit*(reload*.16+recoil*.039);
    const finish=this.weaponFinish;
    const {metal,shade:shadow,barrel:barrelColor,highlight,wood,grain,trim,drum:drumColor}=finish;
    const ink='#0c0c10', cream='#f4ebd9';
    const skin=rubberHoseCast.find(item=>item.id===this.selectedSkin);
    const cos=Math.cos(yaw), sin=Math.sin(yaw);
    const rcos=Math.cos(roll), rsin=Math.sin(roll);
    const project=([x,y,z])=>{
      const scale=1/(1+Math.max(-.38,z)*depthScale);
      const across=(x*cos+z*sin)*scale*(1+settle);
      const up=(y-z*fore)*scale*(1-settle*1.55);
      return [centerX+unit*(across*rcos-up*rsin),centerY+unit*(across*rsin+up*rcos),scale];
    };
    ctx.lineJoin='round';
    ctx.lineCap='round';
    function path(points,color,line=5,stroke=ink){
      ctx.beginPath();
      points.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));
      if(color){ctx.closePath();ctx.fillStyle=color;ctx.fill();}
      ctx.strokeStyle=stroke;ctx.lineWidth=line*unit/640;ctx.stroke();
    }
    const surface=(points,color,line,stroke)=>path(points.map(project),color,line,stroke);
    const section=(z,w,top,bottom)=>[[-w,top,z],[w,top,z],[w,bottom,z],[-w,bottom,z]];
    function solid(near,far,top,side){
      surface([near[0],near[1],far[1],far[0]],top);
      surface([near[0],far[0],far[3],near[3]],side);
      surface([near[1],near[2],far[2],far[1]],side);
      surface(near,shadow);
    }
    function ellipse(point,rx,ry,color,angle=roll){
      const [x,y,k]=project(point);
      ctx.beginPath();ctx.ellipse(x,y,rx*k*unit,ry*k*unit,angle,0,Math.PI*2);
      ctx.fillStyle=color;ctx.fill();ctx.lineWidth=5*unit/640;ctx.strokeStyle=ink;ctx.stroke();
    }
    const front=.22, tip=barrel-recoil*.038;
    solid(section(-.29,.088,.012,.104),section(front,.055,-.015,.055),wood,grain);
    solid(section(-.073,.085,-.026,.09),section(front,.056,-.031,.047),metal,shadow);
    solid(section(front,.055,-.023,.038),section(tip,.023,-.016,.021),barrelColor,shadow);
    if(sniper){
      solid(section(.02,.040,-.086,-.04),section(.43,.024,-.084,-.054),highlight,shadow);
      ellipse([0,-.069,.02],.033,.026,'#859294');
    }else if(drum){
      ellipse([.035,.087,.075],.085,.061,shadow);
      ellipse([.035,.087,.075],.056,.039,drumColor);
      ellipse([.035,.087,.075],.016,.019,trim);
    }else{
      solid(section(-.01,.042,.039,.16),section(.065,.043,.035,.13),metal,shadow);
    }
    for(let i=0;i<6;i++){
      const z=front+(tip-front)*(.13+i*.102);
      surface([[-.031,-.016,z],[.031,-.016,z]],null,2.7);
    }
    if(finish.id==='gold'){
      for(let i=0;i<3;i++){
        const z=-.01+i*.045, y=-.027-(z+.073)*.017;
        surface([[-.053,y,z],[0,y,z+.026],[.053,y,z]],null,2,trim);
        surface([[-.053,y,z],[0,y,z-.016],[.053,y,z]],null,1.5,shadow);
      }
    }else if(finish.id==='crimson'){
      for(const x of [-.021,.021])surface([[x,-.0235,front],[x,-.018,tip-.025]],null,2.2,ink);
    }else{
      surface([[-.036,-.027,-.045],[-.026,-.031,.196]],null,2.5,finish.id==='ivory'?trim:highlight);
    }
    ellipse([0,0,tip],.012+.022*blend,.023,trim);
    ellipse([0,0,tip+.001],.006+.014*blend,.011,ink);
    surface([[0,-.035,tip-.055],[0,-.016,tip-.055]],null,3.3);
    const hand=(side,depth,vertical,reach)=>{
      const [x,y,k]=project([side*.078,vertical,depth]);
      const scale=unit*k;
      const palmX=x+side*.032*scale;
      const cuffX=x+side*(.085+reach)*scale;
      path([[palmX-.055*scale,y+.036*scale],[palmX+.049*scale,y+.041*scale],
        [cuffX+.085*scale,height+unit*.10],[cuffX-.082*scale,height+unit*.10]],skin.accent,9);
      ctx.save();ctx.translate(palmX,y);ctx.rotate(roll+side*.16*(1-blend));ctx.scale(scale,scale);
      ctx.beginPath();ctx.moveTo(-.041,.052);ctx.bezierCurveTo(-.082,.024,-.074,-.029,-.034,-.035);
      ctx.bezierCurveTo(-.027,-.068,.002,-.075,.014,-.045);
      ctx.bezierCurveTo(.066,-.070,.096,-.017,.072,.024);
      ctx.quadraticCurveTo(.051,.077,-.041,.052);ctx.closePath();
      ctx.fillStyle=skin.glove;ctx.fill();ctx.strokeStyle=ink;ctx.lineWidth=.009;ctx.stroke();
      ctx.lineWidth=.004;
      for(let i=0;i<3;i++){
        ctx.beginPath();ctx.moveTo(.017+i*.015,-.018);ctx.quadraticCurveTo(.027+i*.014,0,.02+i*.014,.019);ctx.stroke();
      }
      ctx.restore();
    };
    hand(-1,.32-.18*blend+(this.anchor ? .12 : 0),.027+reload*.07,.023);
    hand(1,-.099,.073+reload*.047,0);

    if(recoil>.69){
      const [mx,my]=project([0,-.015,tip]);
      const flash=Array.from({length:16},(_,i)=>{
        const a=i*Math.PI/8,r=unit*(i%2?.023:.071)*recoil;
        return [mx+Math.cos(a)*r,my+Math.sin(a)*r];
      });
      path(flash,finish.flash,5);
      if(finish.id==='gold'){
        for(let i=0;i<5;i++){
          const angle=i*Math.PI*2/5+cel*.27;
          const radius=unit*.11*recoil;
          const x=mx+Math.cos(angle)*radius, y=my+Math.sin(angle)*radius;
          const spark=unit*.0065;
          path([[x-spark,y],[x,y-spark*1.6],[x+spark,y],[x,y+spark*1.6]],trim,2.3);
        }
      }
    }
    for(const puff of this.smokePuffs){
      const alpha=1-puff.age/puff.maxAge;
      if(alpha<=0)continue;
      const [x,y]=project([0,-.03-puff.age*.31,tip+puff.age*.15]);
      ctx.save();ctx.globalAlpha=alpha*.55;
      ctx.beginPath();ctx.arc(x+puff.age*18,y,(puff.radius+puff.age*20)*unit/850,0,Math.PI*2);
      ctx.fillStyle=puff.cream?cream:'#9b9792';ctx.fill();ctx.restore();
    }
    if(this.isReloading&&reload>.48){
      const [x,y]=project([0,-.16,.13]);
      ctx.font=`900 ${Math.round(unit*.033)}px Georgia`;
      ctx.textAlign='center';ctx.fillStyle=cream;ctx.lineWidth=4;ctx.strokeStyle=ink;
      ctx.strokeText('CLICK!',x,y);ctx.fillText('CLICK!',x,y);
    }
  }
  direction(){const cp=Math.cos(this.pitch);return new THREE.Vector3(-Math.sin(this.yaw)*cp,Math.sin(this.pitch),-Math.cos(this.yaw)*cp).normalize();}
  held(action){return this.keys.has(this.settings.bindings[action]);}
  moveAxes(){const f=this.direction();f.y=0;f.normalize();const r=new THREE.Vector3().crossVectors(f,UP).normalize();const d=new THREE.Vector3();if(this.held('forward'))d.add(f);if(this.held('back'))d.sub(f);if(this.held('right'))d.add(r);if(this.held('left'))d.sub(r);if(d.lengthSq())d.normalize();return {f,r,d};}
  groundCheck(){const feet=this.position.y-this.eye;this.ray.set(new THREE.Vector3(this.position.x,feet+.36,this.position.z),new THREE.Vector3(0,-1,0));this.ray.far=.55;const hit=this.ray.intersectObjects(this.arena.colliders,false)[0];return hit?{hit,feet}:null;}
  updateLadder(dt){
    const held=this.held('forward')||this.held('jump');
    if(this.ladderClimbing){
      const ladder=this.ladderClimbing;
      if(!held&&!this.held('back')){this.ladderClimbing=null;return false;}
      this.position.x=THREE.MathUtils.damp(this.position.x,ladder.x,14,dt);
      this.position.z=THREE.MathUtils.damp(this.position.z,ladder.z,14,dt);
      this.velocity.set(0,15,0);
      this.isGrounded=false;
      this.ladderTickTimer-=dt;
      if(this.ladderTickTimer<=0){this.audio.ladderTick?.();this.ladderTickTimer=.22;}
      if(this.position.y-this.eye<ladder.topY-.06)return true;
      this.position.y=ladder.topY+this.eye;
      this.velocity.set(ladder.approach.x*9,8.5,ladder.approach.z*9);
      this.ladderClimbing=null;
      this.ladderTickTimer=0;
      return false;
    }
    if(!held||this.anchor)return false;
    const feet=this.position.y-this.eye;
    const ladder=this.arena.ladders.find(item=>Math.abs(this.position.x-item.x)<item.width*.52&&Math.abs(this.position.z-item.z)<item.depth*.52&&feet>=-.5&&feet<item.topY-.08);
    if(!ladder)return false;
    this.clearSlideMomentum();
    this.ladderClimbing=ladder;this.position.x=ladder.x;this.position.z=ladder.z;
    this.velocity.set(0,15,0);this.isGrounded=false;
    this.audio.ladderTick?.();this.ladderTickTimer=.22;
    return true;
  }
  wallCheck(){
    const f=this.direction();f.y=0;if(f.lengthSq()<1e-6)f.set(0,0,-1);f.normalize();const right=new THREE.Vector3().crossVectors(f,UP).negate();
    const dirs=[right.clone(),right.clone().negate(),f,f.clone().add(right).normalize(),f.clone().sub(right).normalize(),f.clone().negate().add(right).normalize(),f.clone().negate().sub(right).normalize()];
    const origin=this.position.clone().add(new THREE.Vector3(0,-.4,0));let nearest=null;
    for(const dir of dirs){this.ray.set(origin,dir);this.ray.near=0;this.ray.far=1.6;const hit=this.ray.intersectObjects(this.arena.colliders,false)[0];if(!hit||nearest&&hit.distance>=nearest.distance)continue;let normal=hit.face.normal.clone().applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld)).normalize();if(normal.dot(dir)>0)normal.negate();const toPlayer=origin.clone().sub(hit.point).normalize();if(normal.dot(toPlayer)<0)normal.copy(toPlayer);nearest={point:hit.point.clone(),normal,distance:hit.distance,side:Math.sign(normal.dot(right))||1};}
    return nearest;
  }
  wallJump(contact){
    const normal=contact.normal.clone();normal.y=0;if(normal.lengthSq()<1e-5)normal.copy(this.moveAxes().r).multiplyScalar(contact.side);normal.normalize();this.velocity.y=14;this.velocity.addScaledVector(normal,15*(this.perk.wallSpeed??1));this.jumpBufferTimer=0;this.coyoteTimer=0;this.resetAirJumps();this.wallKickTilt=-contact.side*.22;this.wallRun=0;this.wallSide=0;this.wallInfo=null;this.isGrounded=false;this.audio.wallJump();this.addTrauma(.22);this.pulse('wall');comicText(this.scene,'KICK!',this.position.clone().add(new THREE.Vector3(0,.2,0)),'#faf6eb',.85,.5);burst(this.scene,this.position.clone().addScaledVector(normal,.35),0xe8e1cf,14,8);
  }
  update(dt){
    const realDt=Math.min(dt,.04), gameDt=realDt*(this.bulletTime ? .35 : 1),spacePressed=this.spaceJustPressed,releasedGrapple=this.spaceReleasedGrapple;this.spaceJustPressed=false;this.spaceReleasedGrapple=false;this.baseRunSpeed=tuning.baseSpeed;this.clock+=gameDt;this.dustTimer=Math.max(0,this.dustTimer-realDt);this.slamWindowTimer=Math.max(0,this.slamWindowTimer-realDt);this.jumpBufferTimer=Math.max(0,this.jumpBufferTimer-realDt);this.dashCooldown=Math.max(0,this.dashCooldown-gameDt);this.grappleCooldown=Math.max(0,this.grappleCooldown-gameDt);this.shotCooldown=Math.max(0,this.shotCooldown-gameDt);this.slideCooldown=Math.max(0,this.slideCooldown-gameDt);this.actionPulse=Math.max(0,this.actionPulse-gameDt*2.3);this.styleDecay+=gameDt;this.trauma=Math.max(0,this.trauma-realDt*1.65);this.recoil=Math.max(0,this.recoil-realDt*5.5);this.shotBloom=Math.max(0,this.shotBloom-realDt*.75);this.pitchRecoil=THREE.MathUtils.damp(this.pitchRecoil,0,7,realDt);this.healthRegenDelay=Math.max(0,this.healthRegenDelay-realDt);this.sprintRegenDelay=Math.max(0,this.sprintRegenDelay-realDt);this.wallKickTilt=THREE.MathUtils.damp(this.wallKickTilt,0,8,realDt);if(this.isReloading){this.reloadTimer-=realDt;const reloadProgress=1-this.reloadTimer/this.reloadTime,nextStage=reloadProgress>=.76?2:reloadProgress>=.34?1:0;if(nextStage>this.reloadFoleyStage){this.reloadFoleyStage=nextStage;this.audio.reloadFoley?.(nextStage===1?'in':nextStage===2?'rack':'out');}if(this.reloadTimer<=0){this.isReloading=false;this.reloadFoleyStage=-1;this.ammo=this.magazine;this.audio.reloadDone?.();}}
    const showingSlide=this.slide>0||this.slideHop||this.slideLandingTimer>0;
    this.slide=Math.max(0,this.slide-gameDt);
    this.slideInputBuffer=Math.max(0,this.slideInputBuffer-realDt);
    this.slideLandingTimer=Math.max(0,this.slideLandingTimer-realDt);
    if(showingSlide&&this.slide===0&&!this.slideHop&&this.slideLandingTimer===0)this.clearSlideMomentum();
    if(this.isFiring&&this.isLocked&&!this.isReloading&&this.shotCooldown<=0)this.shoot();if(this.ammo<=0&&!this.isReloading)this.reload();
    this.isSprinting=this.held('sprint')&&this.moveAxes().d.lengthSq()>0&&this.isGrounded&&this.stamina>0&&this.slide<=0&&!this.isReloading&&this.mode!=='menu'&&this.mode!=='paused';if(this.isSprinting){this.stamina=Math.max(0,this.stamina-realDt*23);this.sprintRegenDelay=.85;}else if(this.sprintRegenDelay<=0&&(this.isGrounded||this.perk.airStamina))this.stamina=Math.min(this.maxStamina,this.stamina+realDt*29*(this.perk.staminaRegen??1));setComicFx('sprint',this.isSprinting);
    this.gadgetCooldown=Math.max(0,this.gadgetCooldown-realDt);
    for(let i=this.smokePuffs.length-1;i>=0;i--){this.smokePuffs[i].age+=realDt;if(this.smokePuffs[i].age>=this.smokePuffs[i].maxAge)this.smokePuffs.splice(i,1);}
    this.wasGrounded=this.isGrounded;
    const ground=this.groundCheck();
    this.isGrounded=!!ground&&this.velocity.y<=0;
    if(this.isGrounded&&!this.wasGrounded)this.onLanding();
    const climbing=this.updateLadder(realDt);
    if(climbing)this.isGrounded=false;
    if(climbing){this.velocity.y=15;this.coyoteTimer=0;}
    else if(this.isGrounded){this.position.y=ground.hit.point.y+this.eye;
      this.coyoteTimer=0;this.dashCharges=2;
      this.velocity.y=0;
      if(this.slide<=0&&this.styleDecay>1.25){this.style=Math.max(0,this.style-realDt*1.7);}
    }else{
      this.coyoteTimer=this.wasGrounded&&this.velocity.y<=0
        ? coyoteDuration : Math.max(0,this.coyoteTimer-realDt);
      const gravityScale=this.velocity.y<0 ? 1.35 : this.superJumpRising ? .88 : 1;
      this.velocity.y-=tuning.gravity*gravityScale*gameDt;
      if(this.velocity.y<=0)this.superJumpRising=false;
    }
    const {d}=this.moveAxes();const horizontal=new THREE.Vector3(this.velocity.x,0,this.velocity.z);
    const aimSpeed=(this.zooming ? this.perk.aimSpeed??1 : 1)*(this.gauntletUpgrades?.move??1);
    this.wallInfo=!this.isGrounded&&!this.anchor?this.wallCheck():null;this.wallSide=this.wallInfo?this.wallInfo.side:0;
    if(this.wallSide&&this.velocity.y<2){this.velocity.y=Math.max(this.velocity.y,-2);this.wallRun+=realDt;if(this.wallRun>0.22)this.reward('wall');}else this.wallRun=0;
    if(climbing){horizontal.set(0,0,0);this.wallInfo=null;this.wallSide=0;}
    else if(this.isGrounded){
      const sliding=this.slide>0, chaining=this.slideLandingTimer>0;
      const friction=sliding ? .7 : chaining ? .65 : 7.5;
      const runSpeed=this.baseRunSpeed*this.weaponStats.speed*aimSpeed;
      const jumpingFromSlide=sliding&&(spacePressed||this.jumpBufferTimer>0);
      if(!jumpingFromSlide){
        horizontal.multiplyScalar(Math.exp(-friction*realDt));
        this.accelerate(horizontal,d,(sliding?22:120)*aimSpeed,runSpeed*(sliding?1.55:this.isSprinting?1.42:1),realDt);
      }
      if(sliding&&ground?.hit.object.userData.isRamp){
        const normal=ground.hit.face.normal.clone().applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(ground.hit.object.matrixWorld)).normalize();
        horizontal.addScaledVector(new THREE.Vector3(normal.x,0,normal.z),tuning.gravity*normal.y*realDt);
      }
      if(sliding)horizontal.clampLength(0,slideSpeedCap);
    }else{
      const movementScale=aimSpeed*(this.wallSide ? this.perk.wallSpeed??1 : 1);
      this.accelerate(horizontal,d,(this.slideHop?13:28)*movementScale,14*movementScale,realDt);
      if(this.slideHop)horizontal.clampLength(0,slideSpeedCap);
      else horizontal.multiplyScalar(1-.04*realDt);
    }
    if(this.anchor){const delta=this.anchor.clone().sub(this.position),dist=delta.length();if(dist>this.grappleRange){this.releaseGrapple();}else{const dir=delta.normalize(),pull=Math.min(tuning.grapple*(this.perk.grapplePull??1)*realDt,Math.max(0,(dist-1)*6*realDt));horizontal.x+=dir.x*pull;horizontal.z+=dir.z*pull;this.velocity.y+=dir.y*pull;this.grappleSwing+=realDt;if(this.grappleSwing>.35)this.reward('grapple');this.updateGrappleTether();}}
    this.velocity.x=horizontal.x;this.velocity.z=horizontal.z;
    if(!climbing&&(spacePressed||this.jumpBufferTimer>0)){if(this.isGrounded||this.coyoteTimer>0){
        this.jumpBufferTimer=0;this.isGrounded=false;this.coyoteTimer=0;
        if(this.slamWindowTimer>0){
          this.clearSlideMomentum();
          this.velocity.y=tuning.jump*tuning.superJump;
          this.superJumpRising=true;
          this.slamWindowTimer=0;
          this.audio.superJump();this.addTrauma(.48);this.pulse('slam');
          comicText(this.scene,'SLAM JUMP!',this.position.clone().add(new THREE.Vector3(0,1,0)),'#faf6eb',1.4,.85);
          burst(this.scene,this.position,0xe8e1cf,26,12);
        }else{
          this.velocity.y=tuning.jump;
          this.audio.jump();
          if(this.slide>0){
            this.slide=0;
            this.slideHop=true;
            this.velocity.x*=slideHopRetention;
            this.velocity.z*=slideHopRetention;
          }
          this.slideLandingTimer=0;
        }
      }
      else if(spacePressed&&!releasedGrapple){
        if(this.wallInfo)this.wallJump(this.wallInfo);
        else if(this.doubleJumpAvailable&&!this.isSlamming)this.doubleJump();
      }}
    if(this.isSlamming)this.velocity.y=Math.max(this.velocity.y,-tuning.slam);
    if(this.bulletTime&&this.focus>0){this.focus=Math.max(0,this.focus-realDt*.22);this.onAction?.({focus:this.focus,bulletTime:true});if(this.focus===0)this.setBullet(false);}else this.focus=Math.min(1,this.focus+realDt*.11);
    if(this.mode==='free'&&this.healthRegenDelay<=0&&this.health<this.maxHealth)this.health=Math.min(this.maxHealth,this.health+realDt*9);
    if(this.bulletTime&&this.isGrounded)this.setBullet(false);
    this.applySteamUpdraft();
    this.moveWithCollisions(realDt);
    if(this.position.y-this.eye < -15){if(this.anchor)this.releaseGrapple();this.position.set(0,this.baseEye,12);this.velocity.set(0,0,0);this.eye=this.baseEye;this.isGrounded=false;this.resetMovement();}
    const flatSpeed=Math.hypot(this.velocity.x,this.velocity.z);if(this.isGrounded&&flatSpeed>8&&this.dustTimer<=0){inkDust(this.scene,this.position.clone().add(new THREE.Vector3(0,-this.eye+.04,0)),this.slide>0?1.5:1);this.dustTimer=this.slide>0 ? .09 : this.isSprinting ? .11 : .2;}
    const nextEye=THREE.MathUtils.damp(this.eye,this.slide>0?this.baseEye*.56:this.baseEye,12,realDt);
    this.position.y+=nextEye-this.eye;
    this.eye=nextEye;
    this.camera.position.copy(this.position);
    const shake=Math.pow(this.trauma,2)*this.settings.shakeIntensity,shakeTime=performance.now()*.001;
    this.camera.position.x+=Math.sin(shakeTime*73+1.1)*shake*.075;this.camera.position.y+=Math.sin(shakeTime*91+2.4)*shake*.06;this.camera.position.z+=Math.cos(shakeTime*67+.3)*shake*.04;
    this.zoomRoll=THREE.MathUtils.damp(this.zoomRoll,this.zooming?THREE.MathUtils.degToRad(4.5):0,8,realDt);this.camera.rotation.set(THREE.MathUtils.clamp(this.pitch+this.pitchRecoil+Math.sin(shakeTime*81)*shake*.008,-Math.PI*.49,Math.PI*.49),this.yaw+Math.cos(shakeTime*69)*shake*.009,this.zoomRoll+this.wallKickTilt+Math.sin(shakeTime*57+1)*shake*.018,'YXZ');
    const fast=THREE.MathUtils.smoothstep(flatSpeed,this.baseRunSpeed*.55,slideSpeedCap);
    const rush=(this.slide>0||this.slideHop||this.slideLandingTimer>0)?fast*5+Math.min(5,this.slideChain*1.2):0;
    const baseFov=this.settings.fov;
    this.camera.fov=THREE.MathUtils.damp(this.camera.fov,this.zooming?baseFov/(this.selectedWeapon==='sniper'?2.8:1.45):baseFov+fast*27+rush+(this.isSprinting?5:0),9,realDt);
    this.camera.updateProjectionMatrix();document.body.classList.toggle('zooming',this.zooming);this.updateGrappleLock();
    this.updateWeapon(realDt,fast);this.updateHud();
    if(this.anchor){this.onAction?.({grapple:true,action:this.actionPulse});}else this.onAction?.({grapple:false,action:this.actionPulse});
  }
  doubleJump(){
    this.velocity.y=Math.max(this.velocity.y*.35,0)+tuning.jump*.92;
    this.airJumpsRemaining--;
    this.jumpBufferTimer=0;
    const feet=this.position.clone();
    feet.y-=this.eye;
    this.arena.spawnJumpPuffs(feet);
    const popup=feet.clone().addScaledVector(this.moveAxes().f,3.2);
    popup.y+=this.eye+.3;
    comicText(this.scene,'POOF!',popup,'#faf6eb',.9,.45);
    this.audio.doubleJump();
  }
  grappleHandOrigin(){this.camera.updateWorldMatrix(true,false);return new THREE.Vector3(-.42,-.34,-.78).applyMatrix4(this.camera.matrixWorld);}
  makeTetherCurve(start,end,phase,amplitude=.11){const axis=end.clone().sub(start);axis.normalize();const u=new THREE.Vector3().crossVectors(axis,UP);if(u.lengthSq()<.01)u.set(1,0,0);u.normalize();const v=new THREE.Vector3().crossVectors(axis,u).normalize();const points=[];for(let i=0;i<=24;i++){const t=i/24,angle=t*Math.PI*18+phase,offset=amplitude*Math.sin(Math.PI*t);points.push(start.clone().lerp(end,t).addScaledVector(u,Math.cos(angle)*offset).addScaledVector(v,Math.sin(angle)*offset));}return new THREE.CatmullRomCurve3(points);}
  createGrappleTether(){
    const specs=[['ink',.085,0,0x0b0b0d,.98],['ivory',.036,0,0xfaf6eb,.95],['paper',.027,Math.PI,0xe8e1cf,.96]];this.grappleLine={};
    for(const [key,radius,phase,color,opacity] of specs){const curve=this.makeTetherCurve(this.grappleHandOrigin(),this.anchor,phase,.045);const material=new THREE.MeshBasicMaterial({color,transparent:true,opacity,depthWrite:false});const mesh=new THREE.Mesh(new THREE.TubeGeometry(curve,32,radius,7,false),material);mesh.renderOrder=key==='ink'?7:8;this.scene.add(mesh);this.grappleLine[key]=mesh;}
    const hook=new THREE.Group();hook.position.copy(this.anchor);hook.quaternion.setFromUnitVectors(UP,this.anchorNormal);
    const curve=new THREE.CatmullRomCurve3([new THREE.Vector3(0,-.28,0),new THREE.Vector3(0,-.05,0),new THREE.Vector3(.2,.08,0),new THREE.Vector3(.24,.28,0),new THREE.Vector3(.08,.36,0),new THREE.Vector3(-.04,.29,0)]);
    hook.add(new THREE.Mesh(new THREE.TubeGeometry(curve,20,.075,8,false),new THREE.MeshBasicMaterial({color:0x0b0b0d})));
    hook.add(new THREE.Mesh(new THREE.TubeGeometry(curve,20,.032,8,false),new THREE.MeshBasicMaterial({color:0xfaf6eb})));
    const barb=new THREE.Mesh(new THREE.ConeGeometry(.105,.28,6),new THREE.MeshBasicMaterial({color:0xe8e1cf}));barb.position.y=-.25;barb.rotation.x=Math.PI;hook.add(barb);this.scene.add(hook);this.grappleHook=hook;
  }
  updateGrappleTether(){if(!this.grappleLine||!this.anchor)return;const frame=Math.floor(performance.now()/33.333);if(frame===this.tetherFrame)return;this.tetherFrame=frame;const start=this.grappleHandOrigin(),specs={ink:[.085,0],ivory:[.036,0],paper:[.027,Math.PI]};for(const [key,[radius,phase]] of Object.entries(specs)){const mesh=this.grappleLine[key],curve=this.makeTetherCurve(start,this.anchor,phase,.045);const next=new THREE.TubeGeometry(curve,32,radius,7,false);mesh.geometry.dispose();mesh.geometry=next;}}
  applySteamUpdraft(){
    const vent=this.arena.steamVentAt(this.position);
    if(!vent){
      this.activeSteamVent=null;
      return;
    }
    this.velocity.y=Math.max(this.velocity.y,vent.launchForce);
    this.isGrounded=false;
    this.coyoteTimer=0;
    if(this.isSlamming){
      this.isSlamming=false;
      this.audio.stopFall();
      setComicFx('slam',false);
    }
    if(this.activeSteamVent===vent.vent)return;
    this.activeSteamVent=vent.vent;
    this.resetAirJumps();
    this.dashCharges=2;
    this.audio.steamUpdraft();
    const popup=this.position.clone().addScaledVector(this.moveAxes().f,3);
    popup.y+=.6;
    comicText(this.scene,'WHOOSH!',popup,'#faf6eb',1.15,.7);
  }

  moveWithCollisions(dt){
    const wasGrounded=this.isGrounded,feetBefore=this.position.y-this.eye;
    const oldX=this.position.x;this.position.x+=this.velocity.x*dt;this.resolveHorizontal('x',this.velocity.x,oldX);
    const oldZ=this.position.z;this.position.z+=this.velocity.z*dt;this.resolveHorizontal('z',this.velocity.z,oldZ);
    this.position.y+=this.velocity.y*dt;let landed=this.resolveVertical(feetBefore);
    const feet=this.position.y-this.eye;this.ray.set(new THREE.Vector3(this.position.x,Math.max(feetBefore,feet)+.35,this.position.z),new THREE.Vector3(0,-1,0));this.ray.far=Math.max(1.05,feetBefore-feet+.9);
    const surface=this.ray.intersectObjects(this.arena.colliders,false)[0];
    if(surface&&this.velocity.y<=0){const y=surface.point.y,crossed=feetBefore>=y-.04&&feet<=y+.05,followSlope=wasGrounded&&Math.abs(y-feetBefore)<=this.maxStep;if(crossed||followSlope){this.position.y=y+this.eye;this.velocity.y=0;this.isGrounded=true;landed=true;if(surface.object.userData.isRamp&&this.slide>0){this.lastSlopeNormal=surface.face.normal.clone().applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(surface.object.matrixWorld)).normalize();}}}
    if(landed)this.dashCharges=2;
    if(landed&&!wasGrounded)this.onLanding();
    if(!landed){
      this.isGrounded=false;
      if(wasGrounded)this.coyoteTimer=coyoteDuration;
    }
    this.position.x=THREE.MathUtils.clamp(this.position.x,-this.worldBounds,this.worldBounds);this.position.z=THREE.MathUtils.clamp(this.position.z,-this.worldBounds,this.worldBounds);
  }
  resolveHorizontal(axis,delta,previousValue){
    if(Math.abs(delta)<1e-8)return;const radius=this.playerRadius,bottom=this.position.y-this.eye+.035,top=this.position.y+this.bodyTop;
    for(let pass=0;pass<2;pass++)for(const {box} of this.arena.collisionBoxes){
      if(top<=box.min.y||bottom>=box.max.y)continue;
      const other=axis==='x'?this.position.z:this.position.x,otherRadius=radius,lo=axis==='x'?box.min.z:box.min.x,hi=axis==='x'?box.max.z:box.max.x;
      if(other+otherRadius<=lo||other-otherRadius>=hi)continue;
      const value=this.position[axis],min=axis==='x'?box.min.x:box.min.z,max=axis==='x'?box.max.x:box.max.z;
      const overlaps=value+radius>min&&value-radius<max;
      const crossed=delta>0
        ? previousValue+radius<=min&&value+radius>=min
        : previousValue-radius>=max&&value-radius<=max;
      if(overlaps||crossed){this.position[axis]=delta>0?min-radius:max+radius;this.velocity[axis]=0;}
    }
    for(const ramp of this.arena.ramps){ramp.updateWorldMatrix(true,false);if(!ramp.geometry.boundingBox)ramp.geometry.computeBoundingBox();const bb=ramp.geometry.boundingBox,localFeet=ramp.worldToLocal(new THREE.Vector3(this.position.x,this.position.y-this.eye,this.position.z)),localEye=ramp.worldToLocal(this.position.clone());
      const inside=localFeet.x>=bb.min.x-radius&&localFeet.x<=bb.max.x+radius&&localFeet.z>=bb.min.z-radius&&localFeet.z<=bb.max.z+radius;
      const intersectsSlab=localEye.y>bb.min.y-this.eye&&localEye.y<bb.max.y+this.bodyTop;
      if(inside&&intersectsSlab&&localFeet.y<bb.max.y-this.maxStep){this.position[axis]=previousValue;this.velocity[axis]=0;}
    }
  }
  resolveVertical(feetBefore){
    const currentFeet=this.position.y-this.eye,headBefore=feetBefore+this.eye+this.bodyTop,headAfter=this.position.y+this.bodyTop;
    let landed=false;
    for(const {box} of this.arena.collisionBoxes){
      if(this.position.x+this.playerRadius<=box.min.x||this.position.x-this.playerRadius>=box.max.x||this.position.z+this.playerRadius<=box.min.z||this.position.z-this.playerRadius>=box.max.z)continue;
      if(this.velocity.y<=0&&feetBefore>=box.max.y-.04&&currentFeet<=box.max.y){this.position.y=box.max.y+this.eye;this.velocity.y=0;this.isGrounded=true;landed=true;}
      else if(this.velocity.y>0&&headBefore<=box.min.y&&headAfter>=box.min.y){this.position.y=box.min.y-this.bodyTop;this.velocity.y=0;}
    }
    return landed;
  }
  landSlam(){if(!this.isSlamming)return;this.isSlamming=false;setComicFx('slam',false);this.slamWindowTimer=1.0;this.dashCharges=2;this.audio.stopFall();this.audio.slam();this.addTrauma(.9);triggerComicFx('impact',420);burst(this.scene,this.position.clone().add(new THREE.Vector3(0,-this.eye+.15,0)),0xe8e1cf,28,13);comicText(this.scene,'SLAM!',this.position.clone().add(new THREE.Vector3(0,.5,0)),'#faf6eb',1.25,.8);this.actionPulse=1;}
  addTrauma(amount){this.trauma=Math.min(1,this.trauma+amount);}
  accelerate(vel,dir,accel,cap,dt){if(!dir.lengthSq())return;const current=vel.dot(dir),add=cap-current;if(add<=0)return;vel.addScaledVector(dir,Math.min(add,accel*dt));}
  clearSlideMomentum(){
    this.slide=0;this.slideHop=false;this.slideChain=0;
    this.slideLandingTimer=0;this.slideInputBuffer=0;
    setComicFx('slide',false);
  }
  resetMovement(){
    this.clearSlideMomentum();
    this.audio.stopFall();
    this.slideCooldown=0;this.isSlamming=false;this.superJumpRising=false;
    this.slamWindowTimer=0;this.jumpBufferTimer=0;this.spaceJustPressed=false;this.spaceReleasedGrapple=false;
    this.coyoteTimer=0;this.resetAirJumps();
    this.ladderClimbing=null;
    this.activeSteamVent=null;
    setComicFx('slam',false);
  }
  resetAtSpawn({x,z,yaw}){
    const floorY=this.arena.groundHeightAt(x,z);
    this.releaseGrapple();
    this.resetMovement();
    this.adsProgress=0;this.firePoseTimer=0;this.gadgetCooldown=0;
    this.keys.clear();
    this.velocity.set(0,0,0);
    this.eye=this.baseEye;
    this.position.set(x,floorY+this.eye,z);
    this.isGrounded=true;
    this.wasGrounded=true;
    this.yaw=yaw;
    this.pitch=0;
    this.camera.position.copy(this.position);
    this.camera.rotation.set(this.pitch,this.yaw,0,'YXZ');
    this.camera.fov=this.settings.fov;
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();

    this.dashCharges=2;
    this.dashCooldown=0;
    this.grappleCooldown=0;
    this.grappleSwing=0;
    this.grappleTarget=null;
    this.wallSide=0;
    this.wallRun=0;
    this.wallInfo=null;
    this.wallKickTilt=0;
    this.ladderTickTimer=0;
    this.isSprinting=false;
    this.health=this.maxHealth;
    this.healthRegenDelay=0;
    this.stamina=this.maxStamina;
    this.sprintRegenDelay=0;
    this.focus=1;
    this.setBullet(false);
    this.zooming=false;
    this.zoomRoll=0;

    this.magazine=this.weaponStats.mag;
    this.ammo=this.magazine;
    this.isFiring=false;
    this.isReloading=false;
    this.reloadTimer=0;
    this.reloadFoleyStage=-1;
    this.shotCooldown=0;
    this.shotsFired=0;
    this.shotsHit=0;
    this.headshots=0;
    this.smokePuffs.length=0;
    this.recoil=0;
    this.pitchRecoil=0;
    this.shotBloom=0;
    this.trauma=0;
    this.actionPulse=0;
    this.lastDamageDirection=null;
    this.dustTimer=0;
    this.clock=0;
    this.style=0;
    this.styleDecay=0;
    this.seenMoves.clear();
    this.updateWeapon();
    this.updateHud();
  }
  onLanding(){
    this.resetAirJumps();
    this.coyoteTimer=0;
    this.superJumpRising=false;
    if(this.isSlamming)this.landSlam();
    if(!this.slideHop)return;
    this.slideHop=false;
    this.slideLandingTimer=slideLandingWindow;
    if(this.slideInputBuffer>0)this.startSlide();
  }
  startSlide(){
    if(this.slideCooldown>0)return;
    const {f}=this.moveAxes();
    const horizontal=new THREE.Vector3(this.velocity.x,0,this.velocity.z);
    const base=this.baseRunSpeed*this.weaponStats.speed*1.55;
    const chained=this.slideLandingTimer>0&&horizontal.length()>=this.baseRunSpeed*.7;
    if(chained){
      this.slideChain++;
      horizontal.setLength(Math.min(slideSpeedCap,Math.max(base,horizontal.length()+slideHopBonus)));
    }else{
      this.slideChain=0;
      horizontal.addScaledVector(f,11);
      if(horizontal.lengthSq()<.0001)horizontal.copy(f);
      horizontal.setLength(Math.min(slideSpeedCap,Math.max(base,horizontal.length())));
    }
    this.velocity.x=horizontal.x;this.velocity.z=horizontal.z;
    this.slide=.9;this.slideCooldown=.15;this.slideLandingTimer=0;this.slideInputBuffer=0;
    setComicFx('slide',true);
    this.pulse('slide');
  }
  slideOrSlam(){
    if(this.isGrounded){this.startSlide();return;}
    if(this.isSlamming||this.ladderClimbing)return;
    if(this.slideHop&&this.velocity.y<0){
      const feet=this.position.clone().addScaledVector(UP,-this.eye);
      this.ray.set(feet,new THREE.Vector3(0,-1,0));
      this.ray.near=0;this.ray.far=-this.velocity.y*.12+.42;
      if(this.ray.intersectObjects(this.arena.colliders,false).length){
        this.slideInputBuffer=.15;
        return;
      }
    }
    this.clearSlideMomentum();
    this.superJumpRising=false;
    this.isSlamming=true;
    setComicFx('slam',true);
    this.velocity.y=-tuning.slam;
    this.audio.startFall();
    this.addTrauma(.18);this.pulse('slam');
  }
  dash(){if(this.dashCharges<1||this.dashCooldown>0)return;const {d}=this.moveAxes();const aim=this.direction();const dir=d.lengthSq()?d:aim;this.velocity.addScaledVector(dir,tuning.dash);this.dashCharges--;this.dashCooldown=.18;this.addTrauma(.3);this.pulse('dash');this.audio.dash();triggerComicFx('dash',420);comicText(this.scene,'ZAP!',this.position.clone().add(new THREE.Vector3(0,.2,0)),'#e8e1cf',.75,.4);burst(this.scene,this.position,0xe8e1cf,10,7);}
  getGrappleTarget(assist=true){
    const solids=this.arena.grappleColliders||this.arena.colliders,origin=this.position.clone(),forward=this.direction();
    this.ray.set(origin,forward);this.ray.near=0;this.ray.far=this.grappleRange;
    const direct=this.ray.intersectObjects(solids,false)[0];if(direct||!assist)return direct||null;
    // Sample a small angular fan and keep only surfaces within 1.5 world units of the crosshair ray.
    const right=new THREE.Vector3(1,0,0).applyQuaternion(this.camera.quaternion).normalize(),up=new THREE.Vector3(0,1,0).applyQuaternion(this.camera.quaternion).normalize();
    let best=null,bestScore=Infinity;
    for(const angle of [.02,.06,.13,.28])for(let i=0;i<8;i++){
      const a=i*Math.PI/4,dir=forward.clone().addScaledVector(right,Math.cos(a)*angle).addScaledVector(up,Math.sin(a)*angle).normalize();
      this.ray.set(origin,dir);this.ray.near=0;this.ray.far=this.grappleRange;
      const hit=this.ray.intersectObjects(solids,false)[0];if(!hit)continue;
      const relative=hit.point.clone().sub(origin),distance=relative.dot(forward);if(distance<0||distance>this.grappleRange)continue;
      const lateralSq=Math.max(0,relative.lengthSq()-distance*distance);if(lateralSq>2.25)continue;
      const score=distance+Math.sqrt(lateralSq)*.8;if(score<bestScore){best=hit;bestScore=score;}
    }
    return best;
  }
  updateGrappleLock(){const el=document.querySelector('#grapple-lock');if(!el)return;const hit=!this.anchor&&this.grappleCooldown<=0?this.getGrappleTarget(false):null;if(!hit){el.style.display='none';this.grappleTarget=null;return;}this.grappleTarget=hit.point.clone();this.camera.updateWorldMatrix(true,false);const projected=hit.point.clone().project(this.camera),visible=projected.z>-1&&projected.z<1&&Math.abs(projected.x)<1.05&&Math.abs(projected.y)<1.05;if(!visible){el.style.display='none';return;}el.style.display='block';el.style.left=`${(projected.x*.5+.5)*innerWidth}px`;el.style.top=`${(-projected.y*.5+.5)*innerHeight}px`;}
  fireGrapple(){if(this.anchor||this.grappleCooldown>0)return;const hit=this.getGrappleTarget();if(!hit)return;this.anchor=hit.point.clone();this.anchorNormal=hit.face.normal.clone().applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld)).normalize();this.grappleSwing=0;this.resetAirJumps();this.createGrappleTether();setComicFx('grapple',true);this.velocity.addScaledVector(this.direction(),3);this.addTrauma(.22);this.audio.thwip();this.pulse('grapple');burst(this.scene,this.anchor,0xe8e1cf,20,9);comicText(this.scene,'THWIP!',this.anchor.clone(),'#e8e1cf',.8,.5);}
  releaseGrapple(){if(!this.anchor)return;this.anchor=null;this.grappleCooldown=1.5;this.grappleSwing=0;setComicFx('grapple',false);document.querySelector('#grapple-lock')?.style.setProperty('display','none');if(this.grappleLine){for(const line of Object.values(this.grappleLine)){this.scene.remove(line);line.geometry.dispose();line.material.dispose();}this.grappleLine=null;}if(this.grappleHook){this.scene.remove(this.grappleHook);this.grappleHook.traverse(object=>{object.geometry?.dispose();if(Array.isArray(object.material))object.material.forEach(m=>m.dispose());else object.material?.dispose();});this.grappleHook=null;}this.velocity.y+=7;this.audio.grappleRelease?.();}
  setBullet(on){if(on&&!this.isGrounded&&this.focus>0){this.bulletTime=true;setComicFx('bullet',true);this.audio.setHeartbeat(true);this.onAction?.({bulletTime:true,focus:this.focus});}else{this.bulletTime=false;setComicFx('bullet',false);this.audio.setHeartbeat(false);this.onAction?.({bulletTime:false,focus:this.focus});}}
  reload(){if(this.isReloading||this.ammo===this.magazine)return;this.isFiring=false;this.isReloading=true;this.reloadTimer=this.reloadTime;this.reloadFoleyStage=0;this.audio.reloadStart?.();}
  healOnElimination(){
    this.health=Math.min(this.maxHealth,this.health+(this.perk.eliminationHeal??0));
  }
  throwGadget(){
    if(this.gadgetCooldown>0||this.controlLocked)return;
    const forward=this.direction();
    const origin=this.position.clone().addScaledVector(forward,.38);
    const velocity=forward.clone().multiplyScalar(34).addScaledVector(UP,10);
    this.arena.throwGadget(origin,velocity);
    this.gadgetCooldown=10*(this.gauntletUpgrades?.gadget??1);
    this.audio.gadgetThrow();
    this.updateHud();
  }
  takeDamage(amount,source,{kind='shot',headshot=false,airborne=false,deferKnockout=false}={}){
    if(!['free','duel','gauntlet'].includes(this.mode)||this.health<=0)return false;
    if(kind==='gadget')amount*=this.perk.gadgetDamage??1;
    this.health=Math.max(0,this.health-amount);
    this.healthRegenDelay=5;this.audio.damage?.();this.addTrauma(.24);triggerComicFx('hurt',260);
    if(source){
      const from=source.clone().sub(this.position);from.y=0;
      this.lastDamageDirection=from.lengthSq()?from.normalize():null;
    }
    if(this.health===0&&!deferKnockout)this.onAction?.({playerDown:true,kind,headshot,airborne});
    return this.health===0;
  }
  shoot(){if(this.shotCooldown>0||this.isReloading||this.ammo<=0)return;const stats=this.weaponStats;this.shotCooldown=1/(stats.rate*(this.gauntletUpgrades?.fireRate??1));this.ammo--;this.shotsFired++;this.recoil=1;this.firePoseTimer=.35;this.smokePuffs.push(...Array.from({length:4},(_,i)=>({x:475-i*39,y:310-i*37,radius:13+i*5,age:i*.035,maxAge:.52,cream:i%2===0})));if(this.smokePuffs.length>24)this.smokePuffs.splice(0,this.smokePuffs.length-24);this.shotBloom=Math.min(1,this.shotBloom+ (this.selectedWeapon==='sniper' ? .55 : .22)*(this.perk.bloom??1));this.pitchRecoil-=THREE.MathUtils.degToRad(this.selectedWeapon==='sniper'?1.1:.35);this.audio.fireWeapon?.(this.selectedWeapon);this.addTrauma(this.selectedWeapon==='sniper' ? .18 : .09);this.pulse('shot');const dir=this.direction(),origin=this.position.clone();
    const spread=stats.spread+this.shotBloom*(this.selectedWeapon==='sniper' ? .1 : this.selectedWeapon==='grease' ? .75 : 1.8),noiseX=(Math.random()-.5)*THREE.MathUtils.degToRad(spread),noiseY=(Math.random()-.5)*THREE.MathUtils.degToRad(spread);const rayDir=dir.clone().add(new THREE.Vector3(noiseX,noiseY,0).applyQuaternion(this.camera.quaternion)).normalize();this.ray.set(origin,rayDir);this.ray.far=120;
    const botHitboxes=this.opponents.filter(enemy=>enemy.alive).flatMap(enemy=>enemy.hitboxes),enemyHit=this.ray.intersectObjects([...(this.arena.enemyHitboxes||[]),...botHitboxes],true)[0],wallHit=this.ray.intersectObjects(this.arena.colliders,false)[0],hit=enemyHit&&(!wallHit||enemyHit.distance<wallHit.distance)?enemyHit:null;const end=hit?.point||wallHit?.point||origin.clone().addScaledVector(rayDir,48);this.tracer(origin,end,0xe8e1cf);
    if(hit){
      this.shotsHit++;
      const popup=['WHACK!','BOP!','ZOWIE!'][Math.floor(Math.random()*3)];
      const headshot=!!hit.object.userData.isHead, airborne=!this.isGrounded;
      const damage=(headshot&&stats.headDamage ? stats.headDamage : stats.damage)*(this.gauntletUpgrades?.damage??1);
      this.showHitmarker(popup);
      const enemy=hit.object.userData.bot;
      if(enemy){
        const killed=enemy.takeDamage(damage,headshot?'head':'body');
        if(headshot){this.headshots++;this.audio.headshot?.();}
        comicText(this.scene,headshot?'KRAK!':popup,hit.point.clone().addScaledVector(UP,.7),'#faf6eb',.85,.6);
        if(killed){
          this.healOnElimination();
          this.onAction?.({botDown:true,enemy,kind:'shot',headshot,airborne});
        }
        this.reward('shot');
      }else{
        const target=hit.object.userData.targetRoot;
        if(target&&this.onTargetHit?.(target)){
          this.healOnElimination();
          if(headshot)this.audio.headshot?.();else this.audio.hit?.();
          comicText(this.scene,headshot?'KRAK!':popup,hit.point.clone().addScaledVector(UP,.7),'#faf6eb',.85,.6);
          if(airborne)this.dashCharges=Math.min(2,this.dashCharges+1);
          this.reward('shot');
        }
      }
    }
    if(!this.isGrounded){this.velocity.addScaledVector(dir,-2.2);this.reward('impulse');}
    if(this.ammo===0)this.reload();
  }
  tracer(start,end,color){const geo=new THREE.BufferGeometry().setFromPoints([start.clone(),end.clone()]);const line=new THREE.Line(geo,new THREE.LineBasicMaterial({color,transparent:true,opacity:.78}));this.scene.add(line);const born=performance.now(),fade=()=>{const t=(performance.now()-born)/90;if(t>=1){this.scene.remove(line);geo.dispose();line.material.dispose();return;}line.material.opacity=.78*(1-t);requestAnimationFrame(fade);};requestAnimationFrame(fade);}
  showHitmarker(text){const el=document.querySelector('#hitmarker');if(!el)return;el.textContent=text;el.classList.remove('show');void el.offsetWidth;el.classList.add('show');}
  reward(move){const now=this.clock,last=this.seenMoves.get(move)??-99;if(now-last<1.4)return;this.seenMoves.set(move,now);this.style=Math.min(100,this.style+({wall:9,grapple:14,slam:20,shot:12,impulse:10}[move]||5));this.styleDecay=0;this.updateHud();}
  pulse(kind){this.actionPulse=1;this.onAction?.({kind,action:1});this.reward(kind==='dash'?'impulse':kind==='grapple'?'grapple':kind==='wall'?'wall':kind==='shot'?'shot':kind==='slam'?'slam':'impulse');}
  updateWeapon(dt=0){
    const target=this.zooming||this.firePoseTimer>0?1:0;
    this.adsProgress=THREE.MathUtils.lerp(this.adsProgress,target,Math.min(1,12*dt));
    if(Math.abs(this.adsProgress-target)<.001)this.adsProgress=target;
    this.firePoseTimer=Math.max(0,this.firePoseTimer-dt);
    this.renderInkWeapon(this.clock);
  }
  updateHud(){
    const byId=id=>document.getElementById(id);
    byId('speed').textContent=Math.round(Math.hypot(this.velocity.x,this.velocity.z));
    const dash=byId('dash');
    dash.dataset.ready=this.dashCharges;
    dash.setAttribute('aria-label',`${this.dashCharges} of 2 dash charges`);
    const grapple=byId('grapple');
    const hookReady=!this.anchor&&this.grappleCooldown<=0;
    grapple.toggleAttribute('data-ready',hookReady);
    grapple.textContent=this.anchor?'REELING':hookReady?'READY':`${this.grappleCooldown.toFixed(1)}s`;

    const ammoPanel=byId('ammo-panel');
    ammoPanel.toggleAttribute('data-reloading',this.isReloading);
    ammoPanel.toggleAttribute('data-warning',this.isReloading||this.ammo<=Math.ceil(this.magazine*.2));
    byId('ammo').textContent=this.isReloading?'RELOADING!':`${this.ammo} / ${this.magazine}`;
    const gadget=byId('gadget-status');
    gadget.textContent=this.gadgetCooldown>0?`${this.gadgetCooldown.toFixed(1)}s`:'READY';
    gadget.toggleAttribute('data-ready',this.gadgetCooldown<=0);
    const focus=Math.round(this.focus*100);
    byId('focus').style.width=`${focus}%`;
    byId('focus-wrap').setAttribute('aria-valuenow',focus);
    byId('health-fill').style.width=`${this.health/this.maxHealth*100}%`;
    byId('health-value').textContent=Math.ceil(this.health);
    byId('stamina-fill').style.width=`${this.stamina/this.maxStamina*100}%`;
    byId('stamina-value').textContent=Math.ceil(this.stamina);
    byId('rank').textContent=rankNames[Math.min(rankNames.length-1,Math.floor(this.style/15))];
  }
}

