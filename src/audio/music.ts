// Procedural ambient music for Ascend — zero assets, all synthesised live with the
// Web Audio API. Each area has a bespoke generative track (drone + swelling pad +
// sparse melodic motes, some with a low pulse); a danger-driven tension layer fades
// in on top when foes close, the Censor hunts, or a boss looms. Tracks crossfade as
// the player moves between areas. A master toggle + a picker (auto / shuffle / a
// specific track) live in the UI; preferences persist in localStorage.

type Wave = OscillatorType;

interface TrackDef {
  id: string;
  name: string;
  area: string;        // which dungeon area this track belongs to (auto-by-area pool)
  root: number;        // root frequency (Hz)
  scale: number[];     // semitone degrees for melodic motes
  chord: number[];     // semitone offsets (from root) for the sustained pad
  pad: Wave;
  drone: Wave;
  cutoff: number;      // lowpass brightness (Hz)
  reverb: number;      // 0..1 wet send
  motes: boolean;      // sprinkle melodic notes
  moteRate: number;    // avg seconds between motes
  pulseBpm: number;    // 0 = none; else a low heartbeat/pulse
  detune: number;      // cents (warmth / dissonance)
  level: number;       // track mix level
}

// ── the ten base area themes ─────────────────────────────────────────────────
const A = 55; // a low A reference
type Base = Omit<TrackDef, "area">;
const BASES: Base[] = [
  { id: "legacy",    name: "Legacy Stack",        root: A,        scale: [0, 3, 5, 7, 10],     chord: [0, 7, 15],        pad: "sine",     drone: "sine",     cutoff: 700,  reverb: 0.4, motes: true,  moteRate: 6.0, pulseBpm: 0,  detune: 5,  level: 0.5 },
  { id: "parachain", name: "Parachain Reaches",   root: A * 1.5,  scale: [0, 2, 3, 5, 7, 9],    chord: [0, 7, 14, 16],    pad: "triangle", drone: "sine",     cutoff: 1100, reverb: 0.45,motes: true,  moteRate: 4.0, pulseBpm: 0,  detune: 6,  level: 0.5 },
  { id: "kusama",    name: "Kusama Deeps",        root: A * 0.75, scale: [0, 1, 3, 6, 8],       chord: [0, 6, 13],        pad: "sawtooth", drone: "sine",     cutoff: 600,  reverb: 0.5, motes: true,  moteRate: 5.0, pulseBpm: 0,  detune: 14, level: 0.45 },
  { id: "mempool",   name: "The Mempool",         root: A,        scale: [0, 2, 5, 7, 10],      chord: [0, 5, 10],        pad: "sawtooth", drone: "triangle", cutoff: 800,  reverb: 0.35,motes: true,  moteRate: 2.4, pulseBpm: 96, detune: 9,  level: 0.45 },
  { id: "relay",     name: "Foot of the Relay",   root: A * 0.5,  scale: [0, 5, 7, 12],         chord: [0, 12],           pad: "sine",     drone: "sine",     cutoff: 400,  reverb: 0.6, motes: true,  moteRate: 8.0, pulseBpm: 0,  detune: 3,  level: 0.5 },
  { id: "gehennom",  name: "Gehennom",            root: A * 0.5,  scale: [0, 1, 4, 6, 8, 11],   chord: [0, 1, 6],         pad: "sawtooth", drone: "sawtooth", cutoff: 460,  reverb: 0.5, motes: true,  moteRate: 6.0, pulseBpm: 50, detune: 18, level: 0.5 },
  { id: "sanctum",   name: "Moloch's Sanctum",    root: A * 0.5,  scale: [0, 1, 3, 6, 7],       chord: [0, 6, 7],         pad: "sawtooth", drone: "sawtooth", cutoff: 620,  reverb: 0.4, motes: true,  moteRate: 3.0, pulseBpm: 84, detune: 16, level: 0.52 },
  { id: "planes",    name: "The Planes",          root: A * 2,    scale: [0, 2, 4, 7, 9, 11],   chord: [0, 7, 16, 23],    pad: "triangle", drone: "sine",     cutoff: 1600, reverb: 0.7, motes: true,  moteRate: 3.4, pulseBpm: 0,  detune: 7,  level: 0.42 },
  { id: "genesis",   name: "The Genesis Plane",   root: A * 2,    scale: [0, 4, 7, 11, 14],     chord: [0, 4, 7, 11, 14], pad: "triangle", drone: "sine",     cutoff: 2200, reverb: 0.75,motes: true,  moteRate: 4.5, pulseBpm: 0,  detune: 4,  level: 0.42 },
  { id: "elsewhere", name: "Elsewhere",           root: A * 1.25, scale: [0, 2, 4, 6, 8, 10],   chord: [0, 4, 8],         pad: "sine",     drone: "triangle", cutoff: 1000, reverb: 0.55,motes: true,  moteRate: 3.6, pulseBpm: 0,  detune: 10, level: 0.45 },
];

const ROMAN = ["", " II", " III"];
const revoice = (c: number[]) => c.map((n, i) => (i === c.length - 1 ? n + 12 : n));
/** Derive a same-area variant of a base theme — a different voicing/texture/density. */
function variant(b: Base, n: 1 | 2): TrackDef {
  const ov: Partial<Base> = n === 1
    ? { chord: revoice(b.chord), cutoff: Math.round(b.cutoff * 1.25), moteRate: +(b.moteRate * 0.78).toFixed(1), detune: b.detune + 4 }
    : { pad: b.drone, drone: b.pad, cutoff: Math.round(b.cutoff * 0.82), moteRate: +(b.moteRate * 1.35).toFixed(1), reverb: Math.min(0.8, b.reverb + 0.1), pulseBpm: b.pulseBpm ? Math.round(b.pulseBpm * 0.86) : 0 };
  return { ...b, ...ov, area: b.id, id: `${b.id}-${n + 1}`, name: `${b.name}${ROMAN[n]}` };
}
// every area gets three textures (base + two variants) for "random by area"
const TRACKS: TrackDef[] = BASES.flatMap((b) => [{ ...b, area: b.id }, variant(b, 1), variant(b, 2)]);
const tracksForArea = (area: string) => TRACKS.filter((t) => t.area === area);

const semi = (root: number, n: number) => root * Math.pow(2, n / 12);

interface Voice { osc: OscillatorNode; gain: GainNode; lfo?: OscillatorNode; }
interface ActiveTrack { def: TrackDef; bus: GainNode; voices: Voice[]; }

export class MusicEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private reverb!: ConvolverNode;
  private reverbReturn!: GainNode;
  private active: ActiveTrack | null = null;
  private tensionBus!: GainNode;
  private tensionWet!: GainNode;
  private timer: number | null = null;
  private nextMote = 0;
  private nextTensionMote = 0;
  private nextPulse = 0;
  private nextTensionPulse = 0;
  private danger = 0;          // 0..1, smoothed target for the tension layer
  private _enabled = false;
  private _mode: string;       // "auto" | "shuffle" | a track id
  private area = "legacy";
  private shuffleUntil = 0;

  constructor() {
    this._enabled = localStorage.getItem("ascend.audio") === "on";
    this._mode = localStorage.getItem("ascend.audio.mode") || "auto";
  }

  get enabled(): boolean { return this._enabled; }
  get mode(): string { return this._mode; }
  get trackList(): { id: string; name: string }[] { return BASES.map((t) => ({ id: t.id, name: t.name })); } // the picker lists themes; variants play under auto/shuffle

  /** Resume the context after a user gesture (autoplay policy). */
  resume(): void { if (this.ctx && this.ctx.state === "suspended") void this.ctx.resume(); }

  toggle(): boolean { this.setEnabled(!this._enabled); return this._enabled; }

  setEnabled(on: boolean): void {
    this._enabled = on;
    localStorage.setItem("ascend.audio", on ? "on" : "off");
    if (on) { this.ensureContext(); this.resume(); this.startScheduler(); this.applyMode(); }
    else { this.stopAll(); }
  }

  setMode(mode: string): void {
    this._mode = mode;
    localStorage.setItem("ascend.audio.mode", mode);
    this.shuffleUntil = 0;
    if (this._enabled) this.applyMode();
  }

  /** The game tells us which area the player is in; in auto mode we crossfade to a
   *  random variant of that area's theme — but only when the area actually changes. */
  setArea(areaId: string): void {
    const sameArea = this.active && this.active.def.area === areaId;
    this.area = areaId;
    if (this._enabled && this._mode === "auto" && !sameArea) this.crossfadeRandom(areaId);
  }

  private crossfadeRandom(areaId: string): void {
    const pool = tracksForArea(areaId);
    if (!pool.length) return;
    let pick = pool[Math.floor(Math.random() * pool.length)];
    if (pool.length > 1 && this.active && pick.id === this.active.def.id) pick = pool[(pool.indexOf(pick) + 1) % pool.length];
    this.crossfadeTo(pick.id);
  }

  /** The game sets a 0..1 danger level each turn; the tension layer follows it. */
  setDanger(level: number): void { this.danger = Math.max(0, Math.min(1, level)); }

  /** A one-shot musical cue on death (falling, gloomy) or ascension (rising, luminous). */
  playStinger(kind: "death" | "ascend"): void {
    if (!this._enabled) return;
    this.ensureContext();
    this.resume();
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    // duck the area bed + kill tension so the stinger reads clearly
    if (this.active) { this.active.bus.gain.cancelScheduledValues(now); this.active.bus.gain.setTargetAtTime(this.active.def.level * 0.2, now, 0.2); }
    this.tensionBus.gain.cancelScheduledValues(now); this.tensionBus.gain.setTargetAtTime(0, now, 0.15);
    const bus = this.makeBus(0.6);
    bus.gain.value = 0.9;
    if (kind === "ascend") {
      const seq = [0, 4, 7, 12, 16, 19, 24]; // a rising major arpeggio
      seq.forEach((s, i) => this.note(semi(220, s) * 2, now + i * 0.26, 1.6, bus, "triangle", 0.12, 3200));
      for (const c of [0, 7, 16, 23]) this.note(semi(220, c) * 2, now + seq.length * 0.26, 3.2, bus, "triangle", 0.07, 3000); // a luminous final chord
    } else {
      const seq = [0, -2, -3, -7, -10]; // a falling, sinking minor descent
      seq.forEach((s, i) => this.note(semi(110, s), now + i * 0.34, 1.5, bus, "sawtooth", 0.11, 900));
      for (const c of [0, 3, 6]) this.note(semi(55, c), now + seq.length * 0.34, 3.4, bus, "sine", 0.1, 500); // a low diminished knell
    }
    const end = now + (kind === "ascend" ? 7 : 6);
    if (this.active) this.active.bus.gain.setTargetAtTime(this.active.def.level, end - 1, 1.2); // let the bed swell back
    window.setTimeout(() => { try { bus.disconnect(); } catch { /* gone */ } }, (end - now + 1) * 1000);
  }

  // ── internals ──────────────────────────────────────────────────────────────
  private ensureContext(): void {
    if (this.ctx) return;
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.6;
    this.master.connect(this.ctx.destination);
    // a generated reverb impulse (exponentially-decaying noise)
    this.reverb = this.ctx.createConvolver();
    this.reverb.buffer = this.makeImpulse(3.2, 2.6);
    this.reverbReturn = this.ctx.createGain();
    this.reverbReturn.gain.value = 0.9;
    this.reverb.connect(this.reverbReturn).connect(this.master);
    // the tension layer's own bus (a dry + wet split), driven by danger
    this.tensionBus = this.ctx.createGain();
    this.tensionBus.gain.value = 0;
    const tDry = this.ctx.createGain(); tDry.gain.value = 0.6;
    this.tensionWet = this.ctx.createGain(); this.tensionWet.gain.value = 0.5;
    this.tensionBus.connect(tDry).connect(this.master);
    this.tensionBus.connect(this.tensionWet).connect(this.reverb);
  }

  private makeImpulse(seconds: number, decay: number): AudioBuffer {
    const rate = this.ctx!.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = this.ctx!.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  /** Build a per-track bus that routes to master (dry) + reverb (wet). Returns the input gain. */
  private makeBus(wet: number): GainNode {
    const bus = this.ctx!.createGain();
    const dry = this.ctx!.createGain(); dry.gain.value = 1 - wet * 0.5;
    const wetg = this.ctx!.createGain(); wetg.gain.value = wet;
    bus.connect(dry).connect(this.master);
    bus.connect(wetg).connect(this.reverb);
    return bus;
  }

  private applyMode(): void {
    if (this._mode === "auto") this.crossfadeRandom(this.area);
    else if (this._mode === "shuffle") { this.shuffleUntil = 0; this.pickShuffle(); }
    else this.crossfadeTo(this._mode);
  }

  private pickShuffle(): void {
    const t = TRACKS[Math.floor(Math.random() * TRACKS.length)];
    this.crossfadeTo(t.id);
    this.shuffleUntil = (this.ctx?.currentTime ?? 0) + 90 + Math.random() * 60; // ~1.5–2.5 min
  }

  private crossfadeTo(trackId: string): void {
    if (!this.ctx) return;
    if (this.active && this.active.def.id === trackId) return;
    const def = TRACKS.find((t) => t.id === trackId) ?? TRACKS[0];
    const now = this.ctx.currentTime;
    // fade out + tear down the old track
    if (this.active) {
      const old = this.active;
      old.bus.gain.cancelScheduledValues(now);
      old.bus.gain.setValueAtTime(old.bus.gain.value, now);
      old.bus.gain.linearRampToValueAtTime(0, now + 2.5);
      for (const v of old.voices) { try { v.osc.stop(now + 2.8); v.lfo?.stop(now + 2.8); } catch { /* already stopped */ } }
    }
    // build the new track's persistent voices
    const bus = this.makeBus(def.reverb);
    bus.gain.value = 0;
    bus.gain.linearRampToValueAtTime(def.level, now + 2.5);
    const voices: Voice[] = [];
    // drone (root + a quiet fifth)
    voices.push(this.makeDrone(def, def.root, 0.10, bus));
    voices.push(this.makeDrone(def, semi(def.root, 7), 0.05, bus));
    // pad chord with slow swells
    for (const c of def.chord) voices.push(this.makePad(def, semi(def.root, c) * 2, bus));
    this.active = { def, bus, voices };
    this.nextMote = now + 1;
    this.nextPulse = now + 0.5;
  }

  private makeDrone(def: TrackDef, freq: number, level: number, bus: GainNode): Voice {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator(); osc.type = def.drone; osc.frequency.value = freq; osc.detune.value = def.detune;
    const filt = ctx.createBiquadFilter(); filt.type = "lowpass"; filt.frequency.value = def.cutoff;
    const gain = ctx.createGain(); gain.gain.value = level;
    osc.connect(filt).connect(gain).connect(bus);
    osc.start();
    return { osc, gain };
  }

  private makePad(def: TrackDef, freq: number, bus: GainNode): Voice {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator(); osc.type = def.pad; osc.frequency.value = freq; osc.detune.value = (Math.random() - 0.5) * def.detune * 2;
    const filt = ctx.createBiquadFilter(); filt.type = "lowpass"; filt.frequency.value = def.cutoff * 1.3;
    const gain = ctx.createGain(); gain.gain.value = 0.0;
    // a slow LFO swells the pad in and out
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.03 + Math.random() * 0.05;
    const lfoGain = ctx.createGain(); lfoGain.gain.value = 0.035;
    const base = ctx.createConstantSource(); base.offset.value = 0.04;
    lfo.connect(lfoGain).connect(gain.gain);
    base.connect(gain.gain);
    osc.connect(filt).connect(gain).connect(bus);
    osc.start(); lfo.start(); base.start();
    return { osc, gain, lfo };
  }

  /** A short plucked/bowed note into a bus (motes + tension stabs). */
  private note(freq: number, when: number, dur: number, bus: GainNode, type: Wave, peak: number, cutoff: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator(); osc.type = type; osc.frequency.value = freq;
    const filt = ctx.createBiquadFilter(); filt.type = "lowpass"; filt.frequency.value = cutoff;
    const g = ctx.createGain(); g.gain.value = 0;
    osc.connect(filt).connect(g).connect(bus);
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(peak, when + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0008, when + dur);
    osc.start(when); osc.stop(when + dur + 0.05);
  }

  private startScheduler(): void {
    if (this.timer != null) return;
    this.timer = window.setInterval(() => this.tick(), 140);
  }

  private tick(): void {
    if (!this.ctx || !this._enabled) return;
    const now = this.ctx.currentTime;
    const horizon = now + 0.4;

    // shuffle mode rotates tracks over time
    if (this._mode === "shuffle" && now > this.shuffleUntil) this.pickShuffle();

    const t = this.active?.def;
    if (t && this.active) {
      // melodic motes
      if (t.motes) {
        while (this.nextMote < horizon) {
          const deg = t.scale[Math.floor(Math.random() * t.scale.length)] + (Math.random() < 0.4 ? 12 : 0);
          const freq = semi(t.root, deg) * 2;
          this.note(freq, this.nextMote, 1.2 + Math.random() * 1.6, this.active.bus, "triangle", 0.06, t.cutoff * 2);
          this.nextMote += t.moteRate * (0.6 + Math.random() * 0.8);
        }
      }
      // low pulse / heartbeat
      if (t.pulseBpm > 0) {
        const beat = 60 / t.pulseBpm;
        while (this.nextPulse < horizon) {
          this.pulse(t.root * 0.5, this.nextPulse, this.active.bus, 0.18);
          this.nextPulse += beat;
        }
      } else {
        this.nextPulse = now; // keep it current so re-enabling a pulsed track resyncs
      }
    }

    // ── the tension layer, scaled by danger ──
    const target = this.danger * 0.5;
    this.tensionBus.gain.setTargetAtTime(target, now, 0.6);
    if (this.danger > 0.05 && t) {
      // dissonant stabs (a tritone above the root) at a rate that rises with danger
      while (this.nextTensionMote < horizon) {
        const f = semi(t.root, 6 + (Math.random() < 0.5 ? 0 : 1)) * 3;
        this.note(f, this.nextTensionMote, 0.5 + Math.random(), this.tensionBus, "sawtooth", 0.05, 1400);
        this.nextTensionMote += (1.6 - this.danger) * (0.7 + Math.random() * 0.6);
      }
      // a quickening pulse when danger is high
      if (this.danger > 0.4) {
        const beat = 60 / (90 + this.danger * 60);
        while (this.nextTensionPulse < horizon) { this.pulse(t.root * 0.5, this.nextTensionPulse, this.tensionBus, 0.12); this.nextTensionPulse += beat; }
      } else this.nextTensionPulse = now;
    } else {
      this.nextTensionMote = now;
      this.nextTensionPulse = now;
    }
  }

  private pulse(freq: number, when: number, bus: GainNode, peak: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator(); osc.type = "sine"; osc.frequency.setValueAtTime(freq, when); osc.frequency.exponentialRampToValueAtTime(freq * 0.5, when + 0.25);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(peak, when + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0008, when + 0.3);
    osc.connect(g).connect(bus);
    osc.start(when); osc.stop(when + 0.35);
  }

  private stopAll(): void {
    if (this.timer != null) { clearInterval(this.timer); this.timer = null; }
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if (this.active) {
      this.active.bus.gain.linearRampToValueAtTime(0, now + 0.6);
      for (const v of this.active.voices) { try { v.osc.stop(now + 0.7); v.lfo?.stop(now + 0.7); } catch { /* */ } }
      this.active = null;
    }
    this.tensionBus.gain.setTargetAtTime(0, now, 0.2);
  }
}
