import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { buildArena, shatterTarget, SPAWN_PLAYER, TRIAL_RADIUS } from './arena.js';
import { Player, bindingCode, controlActions, defaultBindings, defaultCamera, isBindable, keyLabel, signaturePerks } from './player.js';
import { DuelBot, gauntletDifficulties } from './bot.js';
import { SynthAudio } from './audio.js';
import { noirFilmShader, visualModes, createProjectorOverlay, renderActionFx, drawRubberHoseCharacter, rubberHoseCast, rubberHoseArsenal, weaponFinishes, comicText } from './comicShader.js';

const $ = selector => document.querySelector(selector);
const letterStamps = [
  [-1.3,-2.8], [1.2,1.7], [-.7,-1.6], [1.8,3.3], [-2,-3.5],
  [.7,1], [-.8,-2.7], [2,3.5], [-1.6,.9], [.6,-1.4]
];

function applyRubberHoseText(element, label) {
  if (label !== undefined) {
    if (element.dataset.rubberLabel === label) return;
    element.dataset.rubberLabel = label;
    element.textContent = label;
  }
  let index = 0;
  for (const node of [...element.childNodes]) {
    if (node.nodeType !== Node.TEXT_NODE || !node.data.trim()) continue;
    const text = document.createElement('span');
    const readable = document.createElement('span');
    const artwork = document.createElement('span');
    readable.className = 'rubber-readable';
    readable.textContent = node.data;
    artwork.setAttribute('aria-hidden', 'true');
    for (const token of node.data.split(/(\s+)/)) {
      if (!token.trim()) {
        artwork.append(token);
        continue;
      }
      const word = document.createElement('span');
      word.className = 'rubber-word';
      for (const character of token) {
        const letter = document.createElement('span');
        const [offset, tilt] = letterStamps[index % letterStamps.length];
        letter.className = 'rubber-letter';
        letter.style.setProperty('--letter-offset', `${offset}px`);
        letter.style.setProperty('--letter-tilt', `${tilt}deg`);
        letter.style.setProperty('--letter-delay', `${index % 12 * 17}ms`);
        letter.textContent = character;
        word.append(letter);
        index++;
      }
      artwork.append(word);
    }
    text.append(readable, artwork);
    node.replaceWith(text);
  }
}

const storageKey = 'mouseberg.settings.v1';
const defaults = {...defaultCamera, foley: .82, visual: 0, grainEnabled: true, grain: .45, irisSpeed: .75};
const settings = {...defaults, bindings: {...defaultBindings}};

function loadSettings() {
  let saved;
  try { saved = JSON.parse(localStorage.getItem(storageKey)); } catch { return; }
  if (!saved || typeof saved !== 'object') return;
  for (const [name,min,max] of [['fov',65,105],['sensitivity',.0005,.006],['shakeIntensity',0,1.5],['foley',0,1],['grain',0,1],['irisSpeed',.25,1.5]]) {
    if (Number.isFinite(saved[name])) settings[name] = THREE.MathUtils.clamp(saved[name], min, max);
  }
  if (Number.isInteger(saved.visual) && visualModes[saved.visual]) settings.visual = saved.visual;
  if (typeof saved.grainEnabled === 'boolean') settings.grainEnabled = saved.grainEnabled;
  const bindings = {...defaultBindings};
  for (const [name] of controlActions) {
    const code = saved.bindings?.[name];
    if (typeof code === 'string' && isBindable(code)) bindings[name] = code;
  }
  // New actions take a free key when an older save already assigned their defaults.
  const newActions=['gadget','trial'].filter(name=>!isBindable(saved.bindings?.[name]));
  const occupied=new Set(Object.entries(bindings).filter(([name])=>!newActions.includes(name)).map(([,code])=>code));
  for(const name of newActions){
    if(occupied.has(bindings[name])){
      bindings[name]=Array.from('GTVBNMYUHOZJX',letter=>`Key${letter}`).find(code=>!occupied.has(code));
    }
    occupied.add(bindings[name]);
  }
  if (new Set(Object.values(bindings)).size === controlActions.length) settings.bindings = bindings;
}

function saveSettings() {
  try { localStorage.setItem(storageKey, JSON.stringify(settings)); } catch { /* Private browsing can disable storage. */ }
}
loadSettings();

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1b1d24);
scene.fog = new THREE.FogExp2(0x1b1d24, .0038);
const camera = new THREE.PerspectiveCamera(settings.fov, innerWidth / innerHeight, .08, 240);
camera.rotation.order = 'YXZ';
camera.position.set(0, 2.2, 8);
const playPixelRatio = Math.min(devicePixelRatio, 1.7);
const bookPixelRatio = Math.min(playPixelRatio, .65);
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.domElement.id = 'city-scene';
renderer.setDrawingBufferSize(innerWidth, innerHeight, bookPixelRatio);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.32;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);
scene.add(new THREE.AmbientLight(0xf6efe0, .42), new THREE.HemisphereLight(0xf2e8d5, 0x3e414a, 1.4));
const sun = new THREE.DirectionalLight(0xfff5e0, 2.9);
sun.position.set(65, 115, 45);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, {left:-95,right:95,top:95,bottom:-95});
sun.shadow.bias = -.0002;
scene.add(sun, new THREE.DirectionalLight(0x8f887a, .42).translateX(-25).translateY(16).translateZ(-28));

const composer = new EffectComposer(renderer);
composer.setPixelRatio(renderer.getPixelRatio());
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), .22, .28, .97));
composer.addPass(new OutputPass());
const filmPass = new ShaderPass(noirFilmShader);
composer.addPass(filmPass);

const arena = buildArena(scene);
const audio = new SynthAudio();
const fxCanvas = $('#action-fx-canvas'), fxContext = fxCanvas.getContext('2d');
const panels = {
  menu: $('#start'), motor_barn: $('#motor-barn'), settings: $('#settings-panel'), controls: $('#controls-card'),
  paused: $('#pause-panel'), results: $('#round-results'),
  'gauntlet-upgrades': $('#gauntlet-upgrades'), 'gauntlet-over': $('#gauntlet-over')
};
const bookScreen = $('#casebook-screen'), book = $('#casebook'), pauseBookmark = $('#casebook-pause-back');
const bookTabs = [...book.querySelectorAll('[data-book-tab]')];
const spreads = bookTabs.map(tab => tab.dataset.bookTab);
const pageFlip = $('#page-flip'), leaf = $('#turning-leaf'), iris = $('#iris-wipe-overlay');
const turnUnderlay = pageFlip.querySelector('.turn-underlay');
const frontFace = leaf.querySelector('.leaf-front'), backFace = leaf.querySelector('.leaf-back');
const projector = createProjectorOverlay($('#projector-overlay'));
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const countdownPanel = $('#countdown-overlay'), countdownLabel = $('#countdown-label'), countdownText = $('#countdown-text');
const scoreboard = $('#series-scoreboard'), roundBanner = $('#round-banner');
const winsNeeded = 3;
const seriesLength = winsNeeded*2-1;
const enemyIndicator=$('#enemy-indicator'), enemyIndicatorName=$('#enemy-name'), enemyIndicatorArrow=$('#enemy-arrow');
const enemyHealthFill=$('#enemy-health-fill'), enemyHealthValue=$('#enemy-health-value');
const titlePortrait = $('#title-portrait').getContext('2d'), skinPreview = $('#skin-preview').getContext('2d');

let state = 'menu', panelOrigin = 'menu', panelOpener = null, pausedView = null, playMode = 'free';
let player, bot = null, duelDifficulty = 'hard', gauntletDifficulty = 'medium', selectedSkin = 'bug', selectedWeapon = 'automatic';
const finishKey='mouseberg.weaponFinish.v1';
let selectedFinish=weaponFinishes[0].id;
try {
  const savedFinish=localStorage.getItem(finishKey);
  if(weaponFinishes.some(finish=>finish.id===savedFinish))selectedFinish=savedFinish;
} catch { /* Storage may be unavailable. */ }
let countdown = 0, clobberHideTimer = 0, finishAt = 0, elapsed = 0, titleFrame = -1, previewFxAt = -10;
let series = null;
let finishCam = null;
let gauntlet=null, trial=null, trialResultUntil=0;
const challengeKey='mouseberg.challenges.v1';
let storedChallenges;
try{storedChallenges=JSON.parse(localStorage.getItem(challengeKey));}catch{/* Storage may be unavailable. */}
const levelNames=Object.keys(gauntletDifficulties);
function validWave(value){return Number.isInteger(value)&&value>0?value:0;}
const challengeRecords={
  waves:Object.fromEntries(levelNames.map(level=>[level,validWave(storedChallenges?.waves?.[level]??
    (level==='medium'?storedChallenges?.wave:0))])),
  trial:Number.isFinite(storedChallenges?.trial)&&storedChallenges.trial>0?storedChallenges.trial:null
};
const upgradePool=[
  {title:'HOT LEAD',description:'+20% fire rate',stat:'fireRate',factor:1.2},
  {title:'IRON LUNGS',description:'+35 max HP and full heal',stat:'maxHealth'},
  {title:'HAIR TRIGGER',description:'+35% reload and move speed',stat:'move',factor:1.35},
  {title:'HEAVY SLUGS',description:'+25% bullet damage',stat:'damage',factor:1.25},
  {title:'QUICK FUSE',description:'−40% gadget cooldown',stat:'gadget',factor:.6}
];
const trialSweep=new THREE.Line3(), trialNearest=new THREE.Vector3();
let pendingBinding = null;
let isTransitioning = false, isFlipping = false, resizePending = false;
const isPlaying = mode => ['free','duel','gauntlet'].includes(mode);
const isBookPage = mode => spreads.includes(mode);

function replayEntrance(element) {
  if (!element) return;
  element.classList.remove('screen-enter');
  void element.offsetWidth;
  element.classList.add('screen-enter');
}

function setGameState(next, focusTarget) {
  const wasInBook = isBookPage(state);
  state = next;
  const inBook = isBookPage(next);
  document.body.dataset.mode = next;
  document.body.dataset.panelOrigin = panelOrigin;
  arena.setTargetsEnabled(inBook && panelOrigin !== 'paused');
  if (player) {
    player.mode = next;
    player.controlLocked = isTransitioning || !isPlaying(next);
    if (player.controlLocked) {
      player.keys.clear();
      player.isFiring = false;
      player.zooming = false;
    }
  }
  document.body.classList.toggle('zooming', Boolean(player?.zooming));
  for (const [mode,panel] of Object.entries(panels)) {
    const inactive = mode !== next;
    if (isBookPage(mode)) {
      panel.inert = inactive;
      panel.setAttribute('aria-hidden', String(inactive));
    } else panel.hidden = inactive;
  }
  bookScreen.hidden = !inBook;
  if (wasInBook !== inBook) syncSceneSize();
  pauseBookmark.hidden = panelOrigin !== 'paused';
  for (const tab of bookTabs) {
    if (tab.dataset.bookTab === next) tab.setAttribute('aria-current','page');
    else tab.removeAttribute('aria-current');
  }
  countdownPanel.hidden = isTransitioning || next !== 'countdown';
  scoreboard.hidden = !['countdown','duel','finishing'].includes(next);
  $('#wave-status').hidden = !['gauntlet','gauntlet-break'].includes(next);
  refreshTrialHud();
  roundBanner.hidden = next !== 'finishing' || seriesIsOver();
  if (next === 'countdown') {
    countdown = 3.25;
    clobberHideTimer = 0;
    applyRubberHoseText(countdownText, '3');
    countdownLabel.classList.remove('clobber');
  }
  if (!isPlaying(next)) audio.stopFall();
  else if (player.isSlamming) audio.startFall();
  if (next === 'paused' || (inBook && !wasInBook)) audio.screenOpen();

  if (inBook) {
    if (!wasInBook) replayEntrance(book);
    if (!isFlipping) replayEntrance(panels[next]);
  } else {
    book.classList.remove('screen-enter');
    replayEntrance(panels[next]?.firstElementChild);
  }
  if (focusTarget) focusTarget.focus({preventScroll:true});
}

function requestPlayFocus() {
  audio.unlock();
  renderer.domElement.requestPointerLock?.()?.catch(() => {});
}

function holdIris(radius) {
  iris.style.setProperty('--iris-radius', `${radius}px`);
  iris.toggleAttribute('data-closed', radius === 0);
}

async function animateIris(from, to, duration) {
  if (!duration) {
    holdIris(to);
    return;
  }
  const wipe = iris.animate([
    {'--iris-radius': `${from}px`},
    {'--iris-radius': `${to}px`}
  ], {duration, easing:'cubic-bezier(0.4, 0, 0.2, 1)', fill:'forwards'});
  iris.removeAttribute('data-closed');
  try {
    await wipe.finished;
    holdIris(to);
  } finally {
    wipe.cancel();
  }
}

async function irisWipe(swap, enterPlay = false) {
  if (isTransitioning || isFlipping) return;
  isTransitioning = true;
  player.controlLocked = true;
  player.keys.clear();
  if (enterPlay) requestPlayFocus();
  else audio.unlock();
  const radius = Math.max(innerWidth, innerHeight) * 1.5;
  const speed = settings.irisSpeed;
  const duration = reducedMotion.matches ? 0 : speed * 1000;
  holdIris(radius);
  iris.hidden = false;
  try {
    audio.irisClose(speed);
    await animateIris(radius, 0, duration);
    swap();
    audio.irisOpen(speed);
    await animateIris(0, radius, duration);
  } finally {
    iris.hidden = true;
    iris.removeAttribute('data-closed');
    isTransitioning = false;
    player.controlLocked = !isPlaying(state);
    countdownPanel.hidden = state !== 'countdown';
  }
}

function waitForLeafTurn() {
  const duration = parseFloat(getComputedStyle(leaf).transitionDuration) * 1000;
  return new Promise(resolve => {
    const finish = event => {
      if (event && (event.target !== leaf || event.propertyName !== 'transform')) return;
      clearTimeout(fallback);
      leaf.removeEventListener('transitionend', finish);
      leaf.removeEventListener('transitioncancel', finish);
      resolve();
    };
    const fallback = setTimeout(finish, duration + 120);
    leaf.addEventListener('transitionend', finish);
    leaf.addEventListener('transitioncancel', finish);
  });
}

async function flipToSpread(next) {
  if (!isBookPage(state) || !isBookPage(next) || next === state || isFlipping || isTransitioning) return;
  setBindingCapture(null);
  const currentIndex = spreads.indexOf(state);
  const back = spreads.indexOf(next) < currentIndex;
  const focus = bookTabs[spreads.indexOf(next)];
  audio.pageFlip(back);
  if (reducedMotion.matches) {
    if(next==='menu')resetMainRightPage();
    setGameState(next, focus);
    return;
  }
  isFlipping = true;
  bookTabs[currentIndex].focus({preventScroll:true});
  const outgoing = panels[state], incoming = panels[next];
  const outgoingPages = [...outgoing.children], incomingPages = [...incoming.children];
  const [outgoingLeft, outgoingRight] = outgoingPages;
  const [incomingLeft, incomingRight] = incomingPages;
  const scrollPositions = [...outgoingPages, ...incomingPages].map(page => {
    const scroller = page.querySelector('.page-scroll');
    return [scroller, scroller.scrollTop];
  });

  book.classList.remove('screen-enter');
  outgoing.classList.remove('screen-enter');
  incoming.classList.remove('screen-enter');
  pageFlip.dataset.direction = back ? 'back' : 'forward';
  try {
    // Move the actual pages. Their canvases, form values, and event listeners stay with them.
    turnUnderlay.append(back ? incomingLeft : outgoingLeft, back ? outgoingRight : incomingRight);
    frontFace.append(back ? outgoingLeft : outgoingRight);
    backFace.append(back ? incomingRight : incomingLeft);
    pageFlip.hidden = false;
    for (const [scroller, top] of scrollPositions) scroller.scrollTop = top;
    void leaf.offsetWidth;
    const finished = waitForLeafTurn();
    pageFlip.classList.add('is-turning');
    await finished;
  } finally {
    outgoing.append(...outgoingPages);
    incoming.append(...incomingPages);
    pageFlip.hidden = true;
    pageFlip.classList.remove('is-turning');
    setGameState(next, focus);
    for (const [scroller, top] of scrollPositions) scroller.scrollTop = top;
    isFlipping = false;
    if (resizePending) syncSize();
  }
}

function clearBot() {
  bot?.dispose();
  bot = null;
  player.duelBot = null;
  player.opponents = [];
}

function resetSpawnPositions(mode) {
  arena.clearGadgets();
  player.resetAtSpawn(SPAWN_PLAYER);
  if (mode !== 'duel') clearBot();
  else if (bot) bot.reset();
  else bot = new DuelBot({scene,arena,player,audio,difficulty:duelDifficulty,skin:selectedSkin});
  player.duelBot = bot;
  player.opponents = bot?[bot]:[];
}

function startFree() {
  return irisWipe(()=>{
    panelOrigin = 'menu';
    panelOpener = null;
    pausedView = null;
    series = null;
    clearGauntlet();
    endTrial();
    resetSpawnPositions('free');
    setGameState('free');
  }, true);
}

function startSeries() {
  return irisWipe(()=>{
    panelOrigin = 'menu';
    panelOpener = null;
    pausedView = null;
    clearGauntlet();
    endTrial();
    clearBot();
    series = {round:1, playerWins:0, botWins:0, damage:0, hits:0, shots:0, time:0};
    startSeriesRound();
  }, true);
}

function startSeriesRound() {
  resetSpawnPositions('duel');
  updateSeriesScoreboard();
  setGameState('countdown');
}

function resume() {
  if (state !== 'paused') return;
  setGameState(playMode);
  requestPlayFocus();
}

function pauseGame() {
  if (!isPlaying(state) || isTransitioning) return;
  playMode = state;
  setGameState('paused', $('#resume-button'));
  if (document.pointerLockElement) document.exitPointerLock?.();
}

function backToTitle() {
  return irisWipe(()=>{
    resetMainRightPage();
    panelOrigin = 'menu';
    series = null;
    clearGauntlet();
    endTrial();
    arena.clearGadgets();
    clearBot();
    player.setBullet(false);
    setGameState('menu', $('#duel-menu-item'));
  });
}

function saveChallengeRecords(){
  try{localStorage.setItem(challengeKey,JSON.stringify(challengeRecords));}catch{/* Keep the in-session record. */}
  updateChallengeStamps();
}

function formatTrialTime(seconds){
  const centiseconds=Math.max(0,Math.floor(seconds*100));
  return `${String(Math.floor(centiseconds/6000)).padStart(2,'0')}:${String(Math.floor(centiseconds/100)%60).padStart(2,'0')}.${String(centiseconds%100).padStart(2,'0')}`;
}

function trialMedal(seconds){return seconds<32?'GOLD':seconds<45?'SILVER':'BRONZE';}

function updateChallengeStamps(){
  $('#gauntlet-record').textContent=levelNames.map(level=>
    `${gauntletDifficulties[level].label} ${challengeRecords.waves[level]||'—'}`).join(' · ');
  const time=challengeRecords.trial;
  $('#course-record').textContent=time===null?'—':`${formatTrialTime(time)} · ${trialMedal(time)}`;
}

function clearGauntlet(){
  if(gauntlet)for(const enemy of gauntlet.enemies)enemy.dispose();
  gauntlet=null;
  player.opponents=bot?[bot]:[];
  player.gauntletUpgrades=null;
  player.maxHealth=player.perk.maxHealth??100;
  player.health=Math.min(player.health,player.maxHealth);
}

function startGauntlet(){
  return irisWipe(()=>{
    clearGauntlet();
    endTrial();
    series=null;
    panelOrigin='menu';panelOpener=null;pausedView=null;
    resetSpawnPositions('gauntlet');
    gauntlet={difficulty:gauntletDifficulty,wave:0,enemies:[],queue:[],spawned:0,spawnTimer:0,breakUntil:0,upgrades:{maxHealth:0}};
    player.gauntletUpgrades=gauntlet.upgrades;
    startGauntletWave();
  },true);
}

function startGauntletWave(){
  gauntlet.wave++;
  gauntlet.spawned=0;
  gauntlet.queue=Array.from({length:gauntlet.wave+1},(_,index)=>{
    if(gauntlet.wave===1)return 'grunt';
    return index%4===2?'sniper':index%4===1?'rusher':'grunt';
  });
  const {difficulty}=gauntlet, tier=gauntletDifficulties[difficulty];
  if(gauntlet.wave>challengeRecords.waves[difficulty]){
    challengeRecords.waves[difficulty]=gauntlet.wave;
    saveChallengeRecords();
  }
  fillGauntletSlots(tier.opening);
  gauntlet.spawnTimer=tier.spacing;
  audio.waveStart(gauntlet.wave);
  setGameState('gauntlet');
}

function fillGauntletSlots(count){
  for(let i=0;i<count&&gauntlet.enemies.length<8&&gauntlet.queue.length;i++){
    let role=gauntlet.queue.shift();
    const towerSlots=gauntlet.enemies.filter(enemy=>enemy.role==='sniper').map(enemy=>enemy.towerSlot);
    const towerSlot=[0,1,2].find(slot=>!towerSlots.includes(slot));
    if(role==='sniper'&&towerSlot===undefined)role='grunt';
    const skin=role==='sniper'?'velvet':role==='rusher'?'kitty':'slinky';
    const spawnPoint=arena.gauntletSpawn(role,role==='sniper'?towerSlot:gauntlet.spawned,player.position);
    gauntlet.spawned++;
    const enemy=new DuelBot({scene,arena,player,audio,spawnPoint,role,skin,difficulty:gauntlet.difficulty});
    if(role==='sniper')enemy.towerSlot=towerSlot;
    gauntlet.enemies.push(enemy);
  }
  player.opponents=gauntlet.enemies;
  $('#wave-status').textContent=`WAVE ${gauntlet.wave} — ENEMIES LEFT: ${gauntlet.enemies.length+gauntlet.queue.length}`;
}

function checkGauntletWave(dt){
  if(state!=='gauntlet')return;
  const removed=gauntlet.enemies.some(enemy=>!enemy.alive);
  if(removed){
    gauntlet.enemies=gauntlet.enemies.filter(enemy=>{
      if(!enemy.alive)enemy.dispose();
      return enemy.alive;
    });
  }
  gauntlet.spawnTimer=Math.max(0,gauntlet.spawnTimer-dt);
  const deploy=gauntlet.queue.length&&gauntlet.enemies.length<8&&gauntlet.spawnTimer===0;
  if(removed||deploy)fillGauntletSlots(deploy?1:0);
  if(deploy)gauntlet.spawnTimer=gauntletDifficulties[gauntlet.difficulty].spacing;
  if(gauntlet.enemies.length||gauntlet.queue.length)return;
  arena.clearGadgets();
  player.setBullet(false);
  setGameState('gauntlet-break');
  if(document.pointerLockElement)document.exitPointerLock?.();
  audio.waveClear();
  gauntlet.breakUntil=performance.now()+680;
}

function showGauntletUpgrades(){
  const choices=[...upgradePool], list=$('#upgrade-list');
  list.replaceChildren();
  for(let i=0;i<3;i++){
    const [upgrade]=choices.splice(Math.floor(Math.random()*choices.length),1);
    const card=document.createElement('button'), caption=document.createElement('small');
    card.className='upgrade-card';
    card.type='button';
    card.textContent=upgrade.title;
    caption.textContent=upgrade.description;
    card.append(caption);
    applyRubberHoseText(card);
    card.addEventListener('click',()=>{
      if(state!=='gauntlet-upgrades')return;
      if(upgrade.stat==='maxHealth'){
        gauntlet.upgrades.maxHealth+=35;
        player.maxHealth+=35;
        player.health=player.maxHealth;
      }else{
        gauntlet.upgrades[upgrade.stat]=(gauntlet.upgrades[upgrade.stat]??1)*upgrade.factor;
        if(upgrade.stat==='move')gauntlet.upgrades.reload=gauntlet.upgrades.move;
        if(upgrade.stat==='gadget')player.gadgetCooldown*=upgrade.factor;
      }
      startGauntletWave();
      requestPlayFocus();
    });
    list.append(card);
  }
  setGameState('gauntlet-upgrades',list.firstElementChild);
}

function finishGauntlet(){
  if(state!=='gauntlet')return;
  const wave=gauntlet.wave;
  for(const enemy of gauntlet.enemies)enemy.dispose();
  gauntlet.enemies=[];
  gauntlet.queue=[];
  player.opponents=[];
  player.setBullet(false);
  arena.clearGadgets();
  const {difficulty}=gauntlet;
  $('#gauntlet-summary').textContent=`${gauntletDifficulties[difficulty].label} · Reached wave ${wave}. Best: wave ${challengeRecords.waves[difficulty]}.`;
  setGameState('gauntlet-over',$('#gauntlet-retry'));
  if(document.pointerLockElement)document.exitPointerLock?.();
  audio.knockout();
}

function refreshTrialHud(){
  const inFree=state==='free';
  const key=keyLabel(settings.bindings.trial);
  $('#trial-toggle').hidden=!inFree;
  $('#trial-toggle').textContent=`[${key}] ${trial?'CANCEL':'START'} TIME-TRIAL`;
  $('#trial-clock').hidden=!inFree||!trial;
  $('#trial-arrow').hidden=!inFree||!trial;
  $('#trial-record').hidden=!inFree||performance.now()>=trialResultUntil;
  arena.showTrialCheckpoint(inFree&&trial?trial.index:-1);
}

function endTrial(){
  trial=null;
  trialResultUntil=0;
  refreshTrialHud();
}

function toggleTrial(){
  if(state!=='free'||isTransitioning)return;
  if(trial){endTrial();return;}
  resetSpawnPositions('free');
  const firstGate=arena.trialCheckpoints[0].position;
  player.yaw=Math.atan2(player.position.x-firstGate.x,player.position.z-firstGate.z);
  camera.rotation.y=player.yaw;
  trial={index:0,time:0,before:player.position.clone()};
  trialResultUntil=0;
  refreshTrialHud();
  $('#trial-time').textContent='00:00.00';
  $('#trial-leg').textContent=`1 / ${arena.trialCheckpoints.length} · ${arena.trialCheckpoints[0].hint}`;
  audio.checkpoint(0);
  requestPlayFocus();
}

function updateTrial(dt){
  trial.time+=dt;
  $('#trial-time').textContent=formatTrialTime(trial.time);
  const {position,hint}=arena.trialCheckpoints[trial.index];
  const dx=position.x-player.position.x,dz=position.z-player.position.z;
  const relative=Math.atan2(dx,-dz)+player.yaw;
  $('#trial-arrow').style.setProperty('--heading',`${relative}rad`);
  $('#trial-leg').textContent=`${trial.index+1} / ${arena.trialCheckpoints.length} · ${hint}`;
  if(trial.before.equals(player.position))trialNearest.copy(player.position);
  else {
    trialSweep.set(trial.before,player.position);
    trialSweep.closestPointToPoint(position,true,trialNearest);
  }
  trial.before.copy(player.position);
  if(trialNearest.distanceToSquared(position)>TRIAL_RADIUS*TRIAL_RADIUS)return;
  audio.checkpoint(++trial.index);
  if(trial.index<arena.trialCheckpoints.length){
    arena.showTrialCheckpoint(trial.index);
    return;
  }
  const time=trial.time, record=challengeRecords.trial===null||time<challengeRecords.trial;
  resetMainRightPage();
  if(record){
    challengeRecords.trial=time;
    saveChallengeRecords();
  }
  $('#trial-result').textContent=`${trialMedal(time)} · ${formatTrialTime(time)}${record?' · PERSONAL BEST':''}`;
  trial=null;
  trialResultUntil=performance.now()+6000;
  refreshTrialHud();
  audio.waveClear();
}

function openPausedBook(page, trigger) {
  if (isPlaying(state)) pauseGame();
  if (state !== 'paused') return;
  panelOrigin = 'paused';
  panelOpener = panels.paused.contains(trigger) ? trigger : $('#resume-button');
  pausedView = {position:camera.position.clone(), rotation:camera.quaternion.clone()};
  setGameState(page, bookTabs[spreads.indexOf(page)]);
  audio.pageFlip();
}

function closePausedBook() {
  if (panelOrigin !== 'paused' || !isBookPage(state)) return;
  setBindingCapture(null);
  const target = panelOpener ?? $('#resume-button');
  camera.position.copy(pausedView.position);
  camera.quaternion.copy(pausedView.rotation);
  pausedView = null;
  panelOpener = null;
  panelOrigin = 'menu';
  resetMainRightPage();
  setGameState('paused', target);
}

function seriesIsOver() {
  return series !== null && Math.max(series.playerWins,series.botWins) >= winsNeeded;
}

function updateSeriesScoreboard() {
  $('#round-number').textContent = `ROUND ${series.round} OF ${seriesLength}`;
  $('#series-score-description').textContent = `You ${series.playerWins}, bot ${series.botWins}`;
  for (const [side,wins] of [['player',series.playerWins],['bot',series.botWins]]) {
    [...scoreboard.querySelector(`[data-round-pips="${side}"]`).children]
      .forEach((pip,index)=>pip.classList.toggle('won',index<wins));
  }
}

function finishRound(won,{kind,headshot,airborne}={}) {
  if (state !== 'duel') return;
  if (won) series.playerWins++;
  else series.botWins++;
  series.damage += bot.maxHealth - bot.health;
  series.hits += player.shotsHit;
  series.shots += player.shotsFired;
  updateSeriesScoreboard();
  roundBanner.dataset.outcome = won ? 'win' : 'loss';
  applyRubberHoseText($('#round-outcome'), won ? 'ROUND WON!' : 'ROUND LOST!');
  player.setBullet(false);
  arena.clearGadgets();
  if (headshot||airborne||kind==='gadget') startFinishCam(won,headshot);
  else {
    audio.knockout();
    beginRoundBanner();
  }
}

function startFinishCam(won,headshot) {
  const target=won?bot.position.clone():player.position.clone();
  target.y+=won ? .65 : -.55;
  const from=camera.position.clone(), to=from.clone();
  if(!won){
    to.add(new THREE.Vector3(2.2,1.3,4.8).applyQuaternion(camera.quaternion));
    const toward=to.clone().sub(target);
    const ray=new THREE.Raycaster(target,toward.clone().normalize(),0,toward.length());
    const wall=ray.intersectObjects(arena.colliders,false)[0];
    if(wall)to.copy(wall.point).addScaledVector(ray.ray.direction,-.18);
  }
  const look=new THREE.Matrix4().lookAt(to,target,camera.up);
  finishCam={
    start:performance.now(), from, to,startRotation:camera.quaternion.clone(),
    rotation:new THREE.Quaternion().setFromRotationMatrix(look),fov:camera.fov
  };
  arena.spawnFinishStars(target);
  comicText(scene,headshot?'BULLSEYE!':'K.O.!',target.clone().add(new THREE.Vector3(0,1.5,0)),'#fcf8ee',1.6,1.8);
  setGameState('finish-cam');
  audio.finalBlow();
}

function updateFinishCam() {
  const t=THREE.MathUtils.clamp((performance.now()-finishCam.start)/1800,0,1);
  const eased=THREE.MathUtils.smoothstep(t,0,.76);
  camera.position.lerpVectors(finishCam.from,finishCam.to,eased);
  camera.quaternion.slerpQuaternions(finishCam.startRotation,finishCam.rotation,eased);
  camera.fov=finishCam.fov-12*eased;
  camera.updateProjectionMatrix();
  if(t>=1){
    finishCam=null;
    beginRoundBanner();
  }
}

function beginRoundBanner() {
  setGameState('finishing');
  const final = seriesIsOver();
  finishAt = performance.now() + (final ? 650 : 1600);
  if (final && document.pointerLockElement) document.exitPointerLock?.();
}

function resolveGadgetBlast(position,directHit) {
  audio.gadgetBlast();
  const strengthAt = target=>Math.max(0,1-position.distanceTo(target)/11);
  const viewDistance=position.distanceTo(player.position);
  if(viewDistance<26)player.addTrauma(.74*(1-viewDistance/26));
  let botDown=false;
  for(const enemy of player.opponents){
    if(!enemy.alive)continue;
    const strength=directHit?.userData.bot===enemy?1:strengthAt(enemy.position);
    if(strength<=0)continue;
    enemy.launchFromBlast(position,strength);
    if(enemy.takeDamage(55*strength)){
      botDown=botDown||enemy===bot;
      player.healOnElimination();
    }
  }
  const strength=strengthAt(player.position);
  let playerDown=false;
  if(strength>0){
    const away=player.position.clone().sub(position);
    away.y=0;
    player.velocity.addScaledVector(away.normalize(),strength*10);
    player.velocity.y=Math.max(player.velocity.y,5+20*strength);
    player.isGrounded=false;
    player.coyoteTimer=0;
    if(player.isSlamming){
      player.isSlamming=false;
      audio.stopFall();
    }
    playerDown=player.takeDamage(55*strength,position,{kind:'gadget',deferKnockout:true});
  }
  if(state==='gauntlet'&&playerDown)finishGauntlet();
  else if(playerDown||botDown)finishRound(!playerDown,{kind:'gadget'});
}

function showSeriesResults() {
  const won = series.playerWins === winsNeeded;
  const accuracy = series.shots ? Math.round(series.hits / series.shots * 100) : 0;
  applyRubberHoseText($('#ending-title'), won ? 'SERIES VICTORY!' : 'SERIES DEFEAT!');
  $('.newspaper').dataset.outcome = won ? 'win' : 'loss';
  $('#ending-copy').textContent = won ? 'You own this stretch of the docks.' : 'The rival took the last word.';
  $('#final-score').textContent = `YOU ${series.playerWins} – ${series.botWins} BOT`;
  $('#total-damage').textContent = Math.round(series.damage);
  $('#series-accuracy').textContent = `${accuracy}%`;
  $('#series-time').textContent = `${series.time.toFixed(1)} SEC`;
  setGameState('results', $('#retry-button'));
}

function updateEnemyIndicator(){
  let position=null,hp=100,maxHp=100,name='MOUSE';
  const enemy=player.opponents.filter(enemy=>enemy.alive).sort((a,b)=>a.position.distanceToSquared(player.position)-b.position.distanceToSquared(player.position))[0];
  if(['duel','gauntlet'].includes(state)&&enemy){position=enemy.group.position.clone().add(new THREE.Vector3(0,3.1,0));hp=enemy.health;maxHp=enemy.maxHealth;name=enemy.role?enemy.settings.label:'RIVAL';}
  if(!position){enemyIndicator.classList.remove('visible');return;}
  camera.updateWorldMatrix(true,false);const projected=position.project(camera),onScreen=projected.z>-1&&projected.z<1&&Math.abs(projected.x)<.94&&Math.abs(projected.y)<.9;let x=(projected.x*.5+.5)*innerWidth,y=(-projected.y*.5+.5)*innerHeight;
  if(projected.z>=1){x=innerWidth-x;y=innerHeight-y;}x=THREE.MathUtils.clamp(x,76,innerWidth-76);y=THREE.MathUtils.clamp(y,75,innerHeight-112);
  enemyIndicator.style.left=`${x}px`;enemyIndicator.style.top=`${y}px`;enemyIndicatorName.textContent=name;enemyHealthFill.style.width=`${THREE.MathUtils.clamp(hp/maxHp*100,0,100)}%`;if(enemyHealthValue)enemyHealthValue.textContent=`${Math.ceil(hp)} / ${maxHp}`;enemyIndicatorArrow.style.transform=onScreen?'':`rotate(${Math.atan2(x-innerWidth/2,y-innerHeight/2)*180/Math.PI}deg)`;enemyIndicator.classList.add('visible');
}

player = new Player({
  camera,renderer,scene,arena,audio,settings,onPause:pauseGame,
  onAction: event=>{
    if(event?.kind)for(const enemy of player.opponents)enemy.reactToPlayerAction(event);
    if(event?.trial)toggleTrial();
    if(event?.playerDown){
      if(state==='gauntlet')finishGauntlet();
      else finishRound(false,event);
    }
    if(event?.botDown)finishRound(true,event);
  },
  onTargetHit:target=>shatterTarget(arena,target,scene)
});
player.equipFinish(selectedFinish);

const formInputs = [...document.querySelectorAll('[data-setting]')];
const bindingButtons = new Map();
const filmButtons = visualModes.map((label,index)=>{
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'film-choice';
  button.setAttribute('role','radio');
  button.textContent = label;
  button.addEventListener('click',()=>selectFilm(index));
  button.addEventListener('keydown',event=>{
    const direction = ['ArrowLeft','ArrowUp'].includes(event.key) ? -1 : ['ArrowRight','ArrowDown'].includes(event.key) ? 1 : 0;
    if (!direction) return;
    event.preventDefault();
    const next = (index + direction + visualModes.length) % visualModes.length;
    selectFilm(next);
    filmButtons[next].focus();
  });
  $('#film-choices').append(button);
  return button;
});

function selectFilm(index) {
  settings.visual = index;
  applyFilm();
  saveSettings();
}

function applyFilm() {
  filmPass.uniforms.uMode.value = settings.visual;
  document.body.dataset.visual = settings.visual;
  projector.configure(settings);
  filmButtons.forEach((button,index)=>{
    button.setAttribute('aria-checked',String(index===settings.visual));
    button.tabIndex = index===settings.visual ? 0 : -1;
  });
}

for (const [action,label] of controlActions) {
  const row = document.createElement('div');
  row.className = 'binding-row';
  const dt = document.createElement('dt');
  dt.textContent = label;
  const dd = document.createElement('dd');
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'key-badge';
  button.addEventListener('click',()=>setBindingCapture(pendingBinding===action ? null : action));
  dd.append(button);
  row.append(dt,dd);
  $('#binding-list').append(row);
  bindingButtons.set(action,button);
}

function updateBindings() {
  const guide = $('#control-guide');
  guide.replaceChildren();
  for (const [action,label] of controlActions) {
    const button = bindingButtons.get(action);
    const key = keyLabel(settings.bindings[action]);
    const waiting = action === pendingBinding;
    button.classList.toggle('waiting', waiting);
    button.textContent = waiting ? 'PRESS KEY…' : key;
    button.setAttribute('aria-label', waiting ? `Press a key for ${label}` : `${label} (${key})`);
    button.setAttribute('aria-pressed', String(waiting));
  }
  const labels = Object.fromEntries(controlActions.map(([action,label])=>[label,keyLabel(settings.bindings[action])]));
  for (const [label,key] of Object.entries({...labels,'Fire':'LMB','Zoom':'RMB','Pause':'P / ESC'})) {
    const row = document.createElement('div');
    row.className = 'guide-row';
    const dt = document.createElement('dt'), dd = document.createElement('dd'), badge = document.createElement('kbd');
    dt.textContent = label;
    badge.textContent = key;
    dd.append(badge);
    row.append(dt,dd);
    guide.append(row);
  }
  const bound = action=>keyLabel(settings.bindings[action]);
  $('#gadget-key').textContent=`[${bound('gadget')}]`;
  refreshTrialHud();
  for (const badge of book.querySelectorAll('[data-key-sketch]')) badge.textContent=bound(badge.dataset.keySketch);
  $('#tips').textContent = [
    `${['forward','left','back','right'].map(bound).join(' ')} MOVE`, `${bound('jump')} JUMP / DOUBLE JUMP`,
    `${bound('slide')} SLIDE / SLAM`, `${bound('grapple')} GRAPPLE`, `${bound('gadget')} GADGET`, 'P / ESC PAUSE'
  ].join(' · ');
}

function setBindingCapture(action, message) {
  pendingBinding = action;
  $('#binding-status').textContent = message || (action ? 'Press a key, or Escape to cancel.' : 'Select a key to change it.');
  updateBindings();
}

function acceptBinding(code) {
  const previous = settings.bindings[pendingBinding];
  const other = controlActions.find(([name])=>name!==pendingBinding && settings.bindings[name]===code);
  if (other) settings.bindings[other[0]] = previous;
  settings.bindings[pendingBinding] = code;
  saveSettings();
  audio.uiSelect();
  setBindingCapture(null, other ? `Swapped with ${other[1]}.` : `Bound to ${keyLabel(code)}.`);
}

function updateReadout(name) {
  const output = document.querySelector(`[data-readout="${name}"]`);
  if (!output) return;
  const value = settings[name];
  if (name === 'irisSpeed') output.value = `${value.toFixed(2)} s`;
  else if (name === 'fov') output.value = `${value}°`;
  else if (name === 'sensitivity') output.value = value.toFixed(4);
  else output.value = `${Math.round(value*100)}%`;
}

function setBaseFov() {
  camera.fov = settings.fov;
  camera.updateProjectionMatrix();
}

function syncSettings() {
  for (const input of formInputs) {
    const name = input.dataset.setting;
    if (input.type === 'checkbox') input.checked = settings[name];
    else input.value = settings[name];
    updateReadout(name);
  }
  $('#setting-grain').disabled = !settings.grainEnabled;
  setBaseFov();
  audio.setFoleyVolume(settings.foley);
  applyFilm();
  updateBindings();
}

for (const input of formInputs) {
  input.addEventListener('input',()=>{
    const name = input.dataset.setting;
    settings[name] = input.type === 'checkbox' ? input.checked : input.valueAsNumber;
    if (name === 'fov') setBaseFov();
    if (name === 'foley') audio.setFoleyVolume(settings.foley);
    if (name === 'grainEnabled' || name === 'grain') {
      $('#setting-grain').disabled = !settings.grainEnabled;
      projector.configure(settings);
    }
    updateReadout(name);
    saveSettings();
  });
}
$('#settings-reset').addEventListener('click',()=>{
  Object.assign(settings, defaults, {bindings:{...defaultBindings}});
  setBindingCapture(null);
  syncSettings();
  saveSettings();
  $('#settings-status').textContent='Default settings restored.';
});

function refreshLoadout() {
  const skin = rubberHoseCast.find(item=>item.id===selectedSkin);
  const weapon = rubberHoseArsenal.find(item=>item.id===selectedWeapon);
  applyRubberHoseText($('#portrait-caption'), skin.name);
  $('#dossier-weapon').textContent = `${weapon.short} — ${weapon.name}`;
  applyRubberHoseText($('#preview-name'), skin.name);
  $('#preview-weapon').textContent = `HOLDING THE ${weapon.name}`;
  drawRubberHoseCharacter(titlePortrait,selectedSkin,elapsed,selectedWeapon,{finish:selectedFinish});
  drawRubberHoseCharacter(skinPreview,selectedSkin,elapsed,selectedWeapon,{finish:selectedFinish});
  titleFrame = -1;
}

function updateBookCharacterPreviews(time) {
  const visiblePage = '.case-spread[aria-hidden="false"],#page-flip';
  const cel = Math.floor(time*12);
  if (cel === titleFrame) return;
  titleFrame = cel;
  // The original canvases move into the leaf or underlay with their pages.
  if (titlePortrait.canvas.closest(visiblePage)) {
    drawRubberHoseCharacter(titlePortrait,selectedSkin,time,selectedWeapon,{finish:selectedFinish});
  }
  if (skinPreview.canvas.closest(visiblePage)) {
    const age=time-previewFxAt, pulse=age>=0&&age<.48?1-age/.48:0;
    drawRubberHoseCharacter(skinPreview,selectedSkin,time,selectedWeapon,{finish:selectedFinish,pulse,flash:age>=0&&age<.18,label:'CLICK!'});
  }
}

function playPreview() {
  previewFxAt = elapsed;
  audio.weaponEquip();
}

function populateBarn(list, root, detail, selected, choose) {
  for (const item of list) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'choice-card';
    button.textContent = item.short ? `${item.short} — ${item.name}` : item.name;
    if(item.metal)button.style.setProperty('--finish-color',item.metal);
    const copy = detail(item);
    if (copy) {
      const caption = document.createElement('small');
      caption.textContent = copy;
      button.append(caption);
    }
    if (signaturePerks[item.id]) {
      button.classList.add('skin-card');
      button.dataset.skin = item.id;
      const stamp = document.createElement('span');
      stamp.className = 'perk-stamp';
      stamp.textContent = 'SIGNATURE PERK';
      button.insertBefore(stamp,button.lastChild);
    }
    const toggle = on=>{
      button.classList.toggle('selected',on);
      button.setAttribute('aria-pressed',String(on));
    };
    toggle(item.id===selected);
    button.addEventListener('click',()=>{
      choose(item.id);
      for (const sibling of root.children) {
        sibling.classList.toggle('selected',sibling===button);
        sibling.setAttribute('aria-pressed',String(sibling===button));
      }
      refreshLoadout();
      previewFxAt = elapsed;
    });
    root.append(button);
  }
}

const barnSkins = [...rubberHoseCast].sort((a,b)=>Number(b.id==='bug')-Number(a.id==='bug'));
populateBarn(barnSkins,$('#skin-options'),({id})=>`${signaturePerks[id].name} · ${signaturePerks[id].description}`,selectedSkin,id=>{
  selectedSkin=id;
  player.setSkin(id);
  audio.weaponEquip();
});
populateBarn(rubberHoseArsenal,$('#weapon-options'),weapon=>
  `${weapon.mag} ROUNDS · ${weapon.rate} RPS · ${weapon.damage}${weapon.headDamage?` / ${weapon.headDamage} HEAD`:''} DAMAGE${weapon.id==='grease'?' · +10% SPEED':''}${weapon.id==='sniper'?' · 2.8× ZOOM':''}`,
  selectedWeapon,id=>{
    if (id===selectedWeapon) audio.weaponEquip();
    else player.equipWeapon(id);
    selectedWeapon=id;
  });
populateBarn(weaponFinishes,$('#finish-options'),()=>'',selectedFinish,id=>{
  selectedFinish=id;
  player.equipFinish(id);
  audio.weaponEquip();
  try{localStorage.setItem(finishKey,id);}catch{/* Keep the in-session finish. */}
});

$('#character-preview-button').addEventListener('click',playPreview);
book.addEventListener('click',event=>{
  const tab = event.target.closest('[data-book-tab],[data-book-page]');
  if (tab) flipToSpread(tab.dataset.bookTab ?? tab.dataset.bookPage);
});
pauseBookmark.addEventListener('click',closePausedBook);
const drawers=[...book.querySelectorAll('[data-drawer]')];
function setDrawer(trigger,open){
  const panel=document.getElementById(trigger.getAttribute('aria-controls'));
  if(!open&&panel.contains(document.activeElement))trigger.focus({preventScroll:true});
  if(!open&&panel.id==='binding-options'&&pendingBinding)setBindingCapture(null);
  trigger.setAttribute('aria-expanded',String(open));
  panel.toggleAttribute('data-open',open);
  panel.inert=!open;
}
const drawerSizer=new ResizeObserver(entries=>{
  for(const {target} of entries){
    if(target.offsetHeight)target.parentElement.style.setProperty('--drawer-height',`${target.offsetHeight}px`);
  }
});
for(const trigger of drawers){
  const panel=document.getElementById(trigger.getAttribute('aria-controls'));
  drawerSizer.observe(panel.firstElementChild);
  trigger.addEventListener('click',()=>{
    const open=trigger.getAttribute('aria-expanded')!=='true';
    setDrawer(trigger,open);
    audio.drawerToggle(open);
  });
}
const modeStamp=$('#difficulty-stamp');
const menuPage=$('#start .case-page[data-side="left"]');
const dossierContent=$('#dossier-content');
const caseBriefingPage=modeStamp.closest('.case-page');
const modeStampButtons=[...book.querySelectorAll('[data-mode-stamp]')];
const difficultyBadges=[...modeStamp.querySelectorAll('[data-difficulty]')];
let stampedMode=null;
let stampSwap=null;
let cardAnimations=[];

function showModeStamp(mode) {
  const switching=mode!==stampedMode;
  if(switching){stampSwap?.cancel();for(const animation of cardAnimations)animation.cancel();cardAnimations=[];}
  if(!mode&&modeStamp.contains(document.activeElement)){
    modeStampButtons.find(button=>button.dataset.modeStamp===stampedMode)?.focus({preventScroll:true});
  }
  stampedMode=mode;
  const open=Boolean(mode);
  menuPage.toggleAttribute('data-briefing',open);
  dossierContent.inert=open;
  caseBriefingPage.setAttribute('aria-label',open?`${mode==='duel'?'1v1 Duel':'Noir Gauntlet'} difficulty briefing`:'Detective dossier');
  for(const button of modeStampButtons)button.setAttribute('aria-expanded',String(mode===button.dataset.modeStamp));
  if(open){
    $('#difficulty-title').textContent=mode==='duel'?'1v1 DUEL — SELECT DIFFICULTY':'NOIR GAUNTLET — SELECT DIFFICULTY';
    const difficulty=mode==='duel'?duelDifficulty:gauntletDifficulty;
    for(const badge of difficultyBadges){
      const selected=badge.dataset.difficulty===difficulty;
      badge.classList.toggle('selected',selected);
      badge.setAttribute('aria-pressed',String(selected));
    }
  }
  modeStamp.toggleAttribute('data-open',open);
  modeStamp.inert=!open;
  if(switching&&!reducedMotion.matches)animateRightPageSwap(open);
}
function resetMainRightPage(){
  if(stampedMode)showModeStamp(null);
  else{
    menuPage.removeAttribute('data-briefing');
    modeStamp.removeAttribute('data-open');
    modeStamp.inert=true;
    dossierContent.inert=false;
    caseBriefingPage.setAttribute('aria-label','Detective dossier');
    for(const button of modeStampButtons)button.setAttribute('aria-expanded','false');
  }
}
function animateRightPageSwap(open){
  const outgoing=open?dossierContent:modeStamp;
  const incoming=open?modeStamp:dossierContent;
  cardAnimations.push(outgoing.animate([
    {transform:'perspective(1400px) rotateY(0deg) scale(1)',opacity:1},
    {transform:'perspective(1400px) rotateY(-85deg) scale(.92)',opacity:0}
  ],{duration:220,easing:'cubic-bezier(.4,0,.2,1)',fill:'forwards'}));
  stampSwap=incoming.animate([
    {transform:`perspective(1400px) rotateY(${open?'85deg':'-85deg'}) scale(.92)`,opacity:0},
    {transform:'perspective(1400px) rotateY(0deg) scale(1.03,.97)',opacity:1,offset:.78},
    {transform:'perspective(1400px) rotateY(0deg) scale(1)',opacity:1}
  ],{duration:340,delay:110,easing:'cubic-bezier(.34,1.56,.64,1)',fill:'forwards'});
  cardAnimations.push(stampSwap);
  const items=open?[...difficultyBadges,$('#start-case-match')]:[];
  items.forEach((item,index)=>{
    item.classList.add('briefing-stagger');
    cardAnimations.push(item.animate([
      {opacity:0,transform:'translateY(9px) scale(.92)'},
      {opacity:1,transform:'translateY(0) scale(1)'}
    ],{duration:230,delay:450+index*45,easing:'cubic-bezier(.34,1.56,.64,1)',fill:'forwards'}));
    setTimeout(()=>item.classList.remove('briefing-stagger'),950+index*45);
  });
  audio.caseStamp();
}
for(const button of modeStampButtons){
  button.addEventListener('click',()=>{
    showModeStamp(stampedMode===button.dataset.modeStamp?null:button.dataset.modeStamp);
    audio.drawerToggle(Boolean(stampedMode));
  });
}
for(const badge of difficultyBadges){
  badge.addEventListener('click',()=>{
    if(!stampedMode)return;
    if(stampedMode==='duel')duelDifficulty=badge.dataset.difficulty;
    else gauntletDifficulty=badge.dataset.difficulty;
    showModeStamp(stampedMode);
  });
}
$('#start-case-match').addEventListener('click',()=>{
  if(!stampedMode)return;
  const launch=stampedMode==='duel'?startSeries:startGauntlet;
  showModeStamp(null);
  launch();
});
$('#cancel-case-match').addEventListener('click',()=>{
  showModeStamp(null);
  audio.drawerToggle(false);
});
$('[data-mode-choice="free"]').addEventListener('click',startFree);
$('#gauntlet-retry').addEventListener('click',startGauntlet);
$('#gauntlet-menu').addEventListener('click',backToTitle);
$('#gauntlet-leave').addEventListener('click',backToTitle);
$('#trial-toggle').addEventListener('click',toggleTrial);
$('#resume-button').addEventListener('click',resume);
$('#menu-button').addEventListener('click',backToTitle);
$('#retry-button').addEventListener('click',startSeries);
$('#results-menu-button').addEventListener('click',backToTitle);
$('[data-open-casebook="settings"]').addEventListener('click',event=>openPausedBook('settings',event.currentTarget));
$('#controls-toggle').addEventListener('click',event=>openPausedBook('controls',event.currentTarget));

document.addEventListener('pointerdown',()=>audio.unlock(),true);
document.addEventListener('keydown',event=>{
  if (isTransitioning || isFlipping) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  audio.unlock();
  if (pendingBinding && state === 'controls') {
    if (event.code==='Tab') {
      setBindingCapture(null,'Key change cancelled.');
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (event.repeat) return;
    if (event.code==='Escape') setBindingCapture(null,'Key change cancelled.');
    else if (isBindable(bindingCode(event)) && !event.ctrlKey && !event.metaKey && !event.altKey) acceptBinding(bindingCode(event));
    else setBindingCapture(pendingBinding,'Choose a game key. Tab, P and Escape are reserved.');
    return;
  }
  if (event.code==='Escape' && (state==='paused' || (isBookPage(state) && (state!=='menu' || panelOrigin==='paused')))) {
    event.preventDefault();
    if (state==='paused') resume();
    else if (panelOrigin==='paused') closePausedBook();
    else flipToSpread('menu');
    return;
  }
  const panel = isBookPage(state) ? bookScreen : panels[state];
  if (event.code==='Tab' && panel) {
    const items=[...panel.querySelectorAll('button,input')].filter(item=>item.tabIndex>=0&&!item.disabled&&!item.closest('[hidden],[inert]'));
    const end=event.shiftKey?items[0]:items.at(-1);
    if (document.activeElement===end || !panel.contains(document.activeElement)) {
      event.preventDefault();
      (event.shiftKey?items.at(-1):items[0])?.focus();
    }
  }
},true);

document.addEventListener('pointerover',event=>{
  if (isTransitioning || isFlipping) return;
  const button=event.target.closest('button');
  if (!button || (event.relatedTarget instanceof Node && button.contains(event.relatedTarget))) return;
  const group=button.closest('nav,.modal-actions,.choice-list,.film-choices,.difficulty-row');
  const index=group ? [...group.querySelectorAll('button')].filter(item=>!item.closest('[hidden]')).indexOf(button) : 0;
  audio.uiHover(Math.max(0,index));
});
document.addEventListener('click',event=>{
  if (isTransitioning || isFlipping) {
    event.preventDefault();
    event.stopImmediatePropagation();
    return;
  }
  if (event.target.closest('button:not([data-drawer],[data-mode-stamp])')) audio.uiSelect();
},true);

function syncSceneSize() {
  // The city is blurred behind the book. Keep its smaller buffers between flips.
  const ratio = isBookPage(state) ? bookPixelRatio : playPixelRatio;
  const ratioChanged = renderer.getPixelRatio() !== ratio;
  renderer.setDrawingBufferSize(innerWidth, innerHeight, ratio);
  if (ratioChanged) composer.setPixelRatio(ratio);
  composer.setSize(innerWidth, innerHeight);
  filmPass.uniforms.uResolution.value.set(innerWidth * ratio, innerHeight * ratio);
}

function syncSize() {
  if (isFlipping) {
    resizePending = true;
    return;
  }
  resizePending = false;
  camera.aspect=innerWidth/innerHeight;
  camera.updateProjectionMatrix();
  syncSceneSize();
  projector.resize(innerWidth,innerHeight);
  const dpr=Math.min(devicePixelRatio||1,2);
  fxCanvas.width=Math.floor(innerWidth*dpr);
  fxCanvas.height=Math.floor(innerHeight*dpr);
  fxCanvas.style.width=`${innerWidth}px`;
  fxCanvas.style.height=`${innerHeight}px`;
  player.resizeWeaponCanvas?.();
}

function frame() {
  requestAnimationFrame(frame);
  const frameDt=clock.getDelta(), dt=Math.min(frameDt,.04);
  const sceneScale=finishCam ? .25 : 1;
  const gameDt=dt*sceneScale*(player.bulletTime ? .35 : 1);
  elapsed+=dt*sceneScale;
  arena.update(gameDt,elapsed,frameDt*sceneScale);
  for(const event of arena.takeSteamEvents()){
    if(event==='warning')audio.steamWarning();
    else if(event==='clink')audio.steamClink();
  }
  if(finishCam)updateFinishCam();
  const titleBackdrop=isBookPage(state);
  if (titleBackdrop) {
    const t=elapsed*.075;
    camera.position.set(Math.sin(t)*74,20+Math.sin(t*.7)*3,Math.cos(t)*74);
    camera.lookAt(0,5,0);
    updateBookCharacterPreviews(elapsed);
  }
  if (state==='countdown' && !isTransitioning) {
    countdown-=dt;
    const label=countdown>2.5?'3':countdown>1.75?'2':countdown>1?'1':'CLOBBER!';
    if (countdownText.dataset.rubberLabel!==label) {
      applyRubberHoseText(countdownText, label);
      countdownLabel.classList.toggle('clobber',label==='CLOBBER!');
      if (label==='CLOBBER!') clobberHideTimer=.65;
    }
    if (label==='CLOBBER!' && (clobberHideTimer-=dt)<=0) {
      audio.clobber();
      setGameState('duel');
    }
  }
  if (isPlaying(state) && !isTransitioning) {
    if (state==='duel') series.time += frameDt;
    player.update(dt);
    if (state==='duel'||state==='gauntlet') {
      for(const enemy of player.opponents){
        if(!isPlaying(state))break;
        if(enemy.alive)enemy.update(gameDt,elapsed);
      }
    }
    if (state==='duel'&&bot&&!bot.alive) finishRound(true);
    if (isPlaying(state)&&arena.hasActiveGadgets) {
      const live=player.opponents.filter(enemy=>enemy.alive);
      for(const enemy of live)enemy.group.updateMatrixWorld(true);
      arena.updateGadgets(dt,live.length?live.flatMap(enemy=>enemy.hitboxes):arena.enemyHitboxes,resolveGadgetBlast);
    }
    if(state==='gauntlet')checkGauntletWave(frameDt);
    if(state==='free'&&trial)updateTrial(frameDt);
  } else if (!titleBackdrop) player.updateHud();
  if(state==='gauntlet-break'&&performance.now()>=gauntlet.breakUntil)showGauntletUpgrades();
  if(trialResultUntil&&performance.now()>=trialResultUntil){
    trialResultUntil=0;
    $('#trial-record').hidden=true;
  }
  if (state==='finishing' && !isTransitioning && performance.now()>=finishAt) {
    if (seriesIsOver()) showSeriesResults();
    else {
      roundBanner.hidden = true;
      irisWipe(()=>{
        series.round++;
        startSeriesRound();
      });
    }
  }
  if (!titleBackdrop) {
    updateEnemyIndicator();
    renderActionFx(fxContext,fxCanvas.width,fxCanvas.height,elapsed,player);
  }
  composer.render();
  projector.draw(performance.now()/1000,reducedMotion.matches);
}

for (const element of document.querySelectorAll(
  '.title-balloons,.title-noir,.page-heading,.headline,.menu-label,.case-tabs button,.casebook-pause,' +
  '.page-back,.placard,.difficulty,.choice-card,.film-choice'
)) applyRubberHoseText(element);
syncSettings();
syncSize();
refreshLoadout();
updateChallengeStamps();
setGameState('menu');
const clock = new THREE.Clock();
frame();
window.addEventListener('resize',syncSize);
document.addEventListener('pointerlockchange',()=>{
  if (!document.pointerLockElement && isPlaying(state)) pauseGame();
});
renderer.domElement.addEventListener('click',()=>{
  if ((isPlaying(state)||state==='countdown') && !document.pointerLockElement) requestPlayFocus();
});
