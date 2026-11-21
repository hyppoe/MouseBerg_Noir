const hz = note => 440 * 2 ** ((note - 69) / 12);
const quiet = .0001;

export class SynthAudio {
  constructor() {
    this.ctx = null;
    this.foleyVolume = .82;
    this.fall = null;
  }

  unlock() {
    if (!this.ctx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      this.ctx = new AudioContext();
      const master = this.ctx.createGain();
      master.gain.value = .76;
      const limiter = this.ctx.createDynamicsCompressor();
      limiter.threshold.value = -15;
      limiter.ratio.value = 5;
      limiter.connect(master).connect(this.ctx.destination);

      this.foleyBus = this.ctx.createGain();
      this.foleyBus.gain.value = this.foleyVolume ** 1.35;
      this.foleyBus.connect(limiter);
      this.noiseBuffer = this.ctx.createBuffer(1, this.ctx.sampleRate * 2, this.ctx.sampleRate);
      const samples = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
  }

  setFoleyVolume(volume) {
    this.foleyVolume = volume;
    if (this.ctx) this.foleyBus.gain.setTargetAtTime(volume ** 1.35, this.ctx.currentTime, .03);
  }

  // Bullet-time previously filtered the score. The player still calls this hook.
  setHeartbeat() {}

  tone({freq, end = freq, duration, type = 'sine', gain, at = this.ctx?.currentTime,
    attack = .004, vibrato = 0, vibratoRate = 10, hold = false}) {
    if (!this.ctx) return;
    const oscillator = this.ctx.createOscillator();
    const envelope = this.ctx.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(freq, at);
    oscillator.frequency.exponentialRampToValueAtTime(end, at + duration * (hold ? .89 : .87));
    envelope.gain.setValueAtTime(quiet, at);
    envelope.gain.exponentialRampToValueAtTime(gain, at + Math.min(attack, duration / 3));
    envelope.gain.exponentialRampToValueAtTime(hold ? gain * .32 : quiet, at + duration);
    oscillator.connect(envelope).connect(this.foleyBus);
    oscillator.start(at);
    let lfo;
    if (vibrato) {
      lfo = this.ctx.createOscillator();
      const depth = this.ctx.createGain();
      lfo.frequency.value = vibratoRate;
      depth.gain.setValueAtTime(vibrato, at);
      depth.gain.exponentialRampToValueAtTime(Math.max(2, vibrato * .25), at + duration);
      lfo.connect(depth).connect(oscillator.detune);
      lfo.start(at);
    }
    if (!hold) {
      oscillator.stop(at + duration + .015);
      lfo?.stop(at + duration + .015);
    }
    return {oscillator, envelope, lfo};
  }

  noise({duration, center, q = 1.1, gain, attack = .002, at = this.ctx?.currentTime}) {
    if (!this.ctx) return;
    const source = this.ctx.createBufferSource();
    const filter = this.ctx.createBiquadFilter();
    const envelope = this.ctx.createGain();
    source.buffer = this.noiseBuffer;
    filter.type = 'bandpass';
    filter.frequency.value = center;
    filter.Q.value = q;
    envelope.gain.setValueAtTime(quiet, at);
    envelope.gain.exponentialRampToValueAtTime(gain, at + Math.min(attack, duration / 3));
    envelope.gain.exponentialRampToValueAtTime(quiet, at + duration);
    source.connect(filter).connect(envelope).connect(this.foleyBus);
    source.start(at, Math.random() * (2 - duration), duration);
  }

  pluck(note, at, duration, gain) {
    const freq = hz(note);
    this.tone({at, freq, end: freq * .994, duration, gain, type: 'triangle', attack: .009});
    this.tone({at, freq: freq * 2.02, duration: duration * .36, gain: gain * .49});
  }

  wood(freq, gain = .16, at = this.ctx?.currentTime) {
    this.tone({at, freq: freq * 1.08, end: freq, duration: .087, gain});
    this.tone({at, freq: freq * 3.89, end: freq * 3.73, duration: .034, gain: gain * .26});
    this.noise({at, center: freq * 2.9, duration: .026, gain: gain * .21});
  }

  metal(freq, gain, duration, at = this.ctx?.currentTime) {
    for (const [ratio, level, length] of [[1,1,1],[2.39,.47,.56],[3.81,.27,.33],[5.12,.16,.22]]) {
      this.tone({at, freq: freq * ratio, duration: duration * length, gain: gain * level});
    }
  }

  clack(at = this.ctx?.currentTime, gain = .2) {
    this.noise({at, center: 2900, q: .65, duration: .057, gain});
    this.wood(344, gain * .54, at);
  }

  uiHover(index = 0) { this.wood(hz([72,74,76,79,81,84,86][index % 7]), .074); }

  uiSelect() {
    if (!this.ctx) return;
    this.clack(this.ctx.currentTime, .14);
    this.metal(1162, .095, .22, this.ctx.currentTime + .027);
  }
  drawerToggle(open) {
    if(!this.ctx)return;
    const at=this.ctx.currentTime;
    this.wood(open?398:285,.095,at);
    this.noise({at:at+.022,center:open?1980:1440,q:.76,duration:open?.13:.085,gain:.068,attack:.012});
  }

  screenOpen() {
    this.noise({center: 1350, q: .65, duration: .19, gain: .12, attack: .029});
    this.tone({freq: 365, end: 1240, duration: .25, gain: .115, vibrato: 47, vibratoRate: 13, attack: .023});
  }

  pageFlip(back = false) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.noise({at:now,center:back?1670:2180,q:.72,duration:.19,gain:.22,attack:.034});
    this.noise({at:now+.105,center:3200,q:.89,duration:.16,gain:.15,attack:.028});
    this.noise({at:now+.246,center:960,q:.63,duration:.10,gain:.12,attack:.007});
    this.wood(back?297:364,.10,now+.286);
  }

  irisClose(duration = .75) {
    if (!this.ctx) return;
    this.tone({freq:1180,end:245,duration:duration*.895,gain:.20,vibrato:66,vibratoRate:12,attack:.017});
    const at = this.ctx.currentTime + duration*.755;
    this.tone({at,freq:122,end:51,duration:.22,gain:.24,type:'triangle'});
    this.noise({at,center:380,q:.72,duration:.11,gain:.15});
  }

  irisOpen(duration = .75) {
    this.tone({freq:307,end:1130,duration:duration*.895,gain:.15,vibrato:52,vibratoRate:11,attack:.024});
    this.noise({center:1840,q:.68,duration:duration*.58,gain:.09,attack:.027});
  }

  weaponEquip() {
    if (!this.ctx) return;
    const at = this.ctx.currentTime;
    [0,.034,.077].forEach((offset,i) => this.clack(at + offset, .12 + .015 * i));
    this.spring(at + .065, .17, 195, 585, .28);
  }

  spring(at, gain, freq, end, duration) {
    this.tone({at, freq, end, duration, gain, vibrato: 245, vibratoRate: 17, type: 'triangle'});
    this.tone({at, freq: freq * 1.997, end: end * 1.95, duration: duration * .62, gain: gain * .27, vibrato: 135});
  }

  jump() { this.wood(585, .21); }
  doubleJump() {
    if (!this.ctx) return;
    const at = this.ctx.currentTime;
    this.spring(at, .22, 198, 790, .24);
    this.tone({at:at+.025, freq:230, end:82, duration:.09, gain:.24, type:'triangle'});
    this.noise({at:at+.025, center:1430, q:.85, duration:.086, gain:.18});
  }
  wallJump() { this.wood(424, .19); this.spring(this.ctx?.currentTime, .14, 225, 520, .22); }
  superJump() { this.spring(this.ctx?.currentTime, .28, 154, 693, .54); this.pluck(41, this.ctx?.currentTime, .22, .22); }
  ladderTick() { this.wood(308 + Math.random() * 66, .11); }

  dash() {
    this.tone({freq: 485, end: 1620, duration: .21, gain: .18, vibrato: 48, vibratoRate: 15});
    this.noise({center: 2650, q: .62, duration: .23, gain: .14, attack: .013});
  }

  thwip() {
    this.tone({freq: 1220, end: 460, duration: .23, gain: .17, vibrato: 67, attack: .012});
    this.pluck(58, this.ctx?.currentTime, .28, .24);
  }

  grappleRelease() {
    this.pluck(48, this.ctx?.currentTime, .16, .14);
    this.noise({center: 1820, duration: .11, gain: .11});
  }

  steamUpdraft() {
    if (!this.ctx) return;
    const at=this.ctx.currentTime;
    this.noise({at,center:1500,q:.55,duration:.66,attack:.045,gain:.24});
    this.tone({at:at+.035,freq:480,end:1460,duration:.42,attack:.035,gain:.16,vibrato:47,vibratoRate:12});
    for(const [offset,freq] of [[.012,215],[.078,276],[.16,348]]){
      this.tone({at:at+offset,freq,end:freq*1.7,duration:.11,type:'triangle',gain:.075});
    }
  }

  steamWarning() {
    if (!this.ctx) return;
    const at=this.ctx.currentTime;
    this.noise({at,center:1450,q:.8,duration:.72,attack:.12,gain:.12});
    this.tone({at:at+.12,freq:245,end:365,duration:.62,attack:.12,gain:.105,type:'triangle',vibrato:16,vibratoRate:8});
  }

  steamClink() {
    this.metal(520,.11,.19);
    this.clack(this.ctx?.currentTime,.075);
  }

  caseStamp() {
    if (!this.ctx) return;
    const at=this.ctx.currentTime;
    this.wood(238,.2,at);
    this.noise({at:at+.015,center:1850,q:.7,duration:.075,gain:.10});
    this.tone({at:at+.02,freq:610,end:420,duration:.12,gain:.075,type:'triangle'});
  }

  startFall() {
    if (!this.ctx || this.fall) return;
    this.fall = this.tone({freq: 1040, end: 120, duration: .86, gain: .15,
      vibrato: 102, vibratoRate: 13, attack: .034, hold: true});
  }

  stopFall() {
    if (!this.fall) return;
    const {envelope, oscillator, lfo} = this.fall;
    const now = this.ctx.currentTime;
    if (envelope.gain.cancelAndHoldAtTime) envelope.gain.cancelAndHoldAtTime(now);
    else envelope.gain.cancelScheduledValues(now);
    envelope.gain.setTargetAtTime(quiet, now, .013);
    oscillator.stop(now + .072);
    lfo?.stop(now + .072);
    this.fall = null;
  }

  slam() {
    this.tone({freq: 126, end: 54, duration: .52, gain: .55});
    this.tone({freq: 209, end: 83, duration: .27, gain: .23, type: 'triangle'});
    this.noise({center: 410, q: .73, duration: .32, gain: .44});
    this.pluck(28, this.ctx?.currentTime, .62, .33);
  }

  capPop({gain, freq, duration}) {
    this.noise({center: 3700, q: .74, duration: duration * .66, gain});
    this.tone({freq, end: freq * .43, duration, gain: gain * .73, type: 'triangle'});
    this.wood(freq * 4.2, gain * .28);
  }

  fireWeapon(weapon = 'automatic') {
    if (weapon === 'sniper') {
      this.capPop({gain: .7, freq: 139, duration: .245});
      if (this.ctx) this.clack(this.ctx.currentTime + .115, .16);
    } else if (weapon === 'grease') {
      this.capPop({gain: .34, freq: 226, duration: .054});
    } else {
      this.capPop({gain: .45, freq: 168, duration: .079});
    }
  }

  ratTat() { this.capPop({gain: .18, freq: 199, duration: .061}); }
  botShot() { this.tone({freq: 122, end: 61, duration: .085, gain: .10}); }
  reloadStart() { this.reloadFoley('out'); }
  reloadFoley(stage) {
    if (!this.ctx) return;
    const at = this.ctx.currentTime;
    const offsets = stage === 'rack' ? [0,.045,.089] : stage === 'in' ? [0,.061] : [0,.026];
    offsets.forEach((offset,i) => this.clack(at + offset, i === offsets.length - 1 ? .23 : .11));
  }
  reloadDone() { this.wood(916, .12); }

  damage() { this.pluck(34, this.ctx?.currentTime, .22, .26); this.noise({center: 550, duration: .15, gain: .22}); }
  hit() { this.wood(514, .13); }
  headshot() { this.metal(847, .14, .21); }
  waveClear() {
    if(!this.ctx)return;
    const at=this.ctx.currentTime;
    [392,494,659].forEach((note,i)=>this.metal(note,.13,.23,at+i*.125));
    this.wood(258,.17,at+.35);
  }
  waveStart(wave) {
    if(!this.ctx)return;
    const at=this.ctx.currentTime;
    this.wood(210+Math.min(wave,7)*19,.18,at);
    this.metal(522,.13,.25,at+.09);
  }
  checkpoint(number) {
    if(!this.ctx)return;
    const at=this.ctx.currentTime, note=620+(number%5)*68;
    this.metal(note,.11,.24,at);
    this.metal(note*1.5,.087,.34,at+.086);
  }
  gadgetThrow() {
    if(!this.ctx)return;
    this.spring(this.ctx.currentTime,.115,460,236,.15);
    this.noise({center:2950,q:.62,duration:.12,gain:.09});
  }
  gadgetBlast() {
    if(!this.ctx)return;
    const at=this.ctx.currentTime;
    this.tone({at,freq:122,end:41,duration:.56,gain:.52,type:'triangle'});
    this.tone({at:at+.027,freq:186,end:49,duration:.31,gain:.26,type:'sine'});
    this.noise({at,center:540,q:.72,duration:.51,gain:.42});
  }
  finalBlow() {
    if(!this.ctx)return;
    const at=this.ctx.currentTime;
    for(const [offset,gain,notes] of [[0,.105,[174,261,349]],[.23,.095,[196,294,392]],[.56,.12,[155,233,311]]]){
      for(const freq of notes)this.tone({at:at+offset,freq,end:freq*.96,
        duration:offset>.5?.68:.23,gain,type:'triangle',vibrato:5,vibratoRate:6,attack:.016});
    }
    this.tone({at:at+.54,freq:113,end:41,duration:.7,gain:.37,type:'triangle'});
    this.noise({at:at+.54,center:385,q:.87,duration:.28,gain:.25});
  }
  clobber() { this.wood(262, .28); this.metal(660, .16, .34); }
  knockout() {
    if (!this.ctx) return;
    const at = this.ctx.currentTime;
    this.metal(845, .27, .72, at);
    this.metal(850, .25, .68, at + .238);
  }
}
