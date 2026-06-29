// Procedural ambient music for Ascend — zero assets, all synthesised live with the
// Web Audio API. Each area has a bespoke generative track (drone + swelling pad +
// sparse melodic motes, some with a low pulse); a danger-driven tension layer fades
// in on top when foes close, the Censor hunts, or a boss looms. Tracks crossfade as
// the player moves between areas. A master toggle + a picker (auto / shuffle / a
// specific track) live in the UI; preferences persist in localStorage.

type Wave = OscillatorType;

// A leitmotif note: [scale-degree-in-semitones, duration-in-steps]. REST skips a beat.
const REST = 99;
type Note = [number, number];

interface TrackDef {
  id: string;
  name: string;
  area: string;        // which dungeon area this track belongs to (auto-by-area pool)
  root: number;        // root frequency (Hz)
  chord: number[];     // semitone offsets (from root) for the sustained pad
  melody: Note[];      // the area's leitmotif — a fixed rhythmic phrase shared by all its variants
  melStep: number;     // seconds per rhythmic step
  melOct: number;      // melody register (× the root octave)
  pad: Wave;
  drone: Wave;
  melWave: Wave;       // timbre of the melody voice
  cutoff: number;      // lowpass brightness (Hz)
  reverb: number;      // 0..1 wet send
  pulseBpm: number;    // 0 = none; else a low heartbeat/pulse
  detune: number;      // cents (warmth / dissonance)
  level: number;       // track mix level
}

// ── the ten base area themes — each carries a distinct, rhythmic, hook-led leitmotif ──
const A = 55; // a low A reference
type Base = Omit<TrackDef, "area">;
const BASES: Base[] = [
  // wistful minor hymn: a step up, a sigh down, then a bold leap to the 5th and a long resolve
  { id: "legacy",    name: "Legacy Stack",      root: A,        chord: [0, 7, 15],        melStep: 0.32, melOct: 4, pad: "sine",     drone: "sine",     melWave: "triangle", cutoff: 700,  reverb: 0.4,  pulseBpm: 0,  detune: 5,  level: 0.5,
    melody: [[0,3],[2,1],[3,2],[2,1],[0,3],[REST,1],[7,2],[5,2],[3,4]] },
  // playful lilting waltz: a bright leaping arpeggio that bounces up to a 6th and trips home
  { id: "parachain", name: "Parachain Reaches", root: A * 1.5,  chord: [0, 7, 14, 16],    melStep: 0.24, melOct: 2, pad: "triangle", drone: "sine",     melWave: "triangle", cutoff: 1100, reverb: 0.45, pulseBpm: 0,  detune: 6,  level: 0.5,
    melody: [[0,1],[4,1],[7,2],[4,1],[9,2],[7,1],[5,1],[2,1],[0,3]] },
  // uneasy: a tritone that keeps circling back — jagged and syncopated
  { id: "kusama",    name: "Kusama Deeps",      root: A * 0.75, chord: [0, 6, 13],        melStep: 0.3,  melOct: 4, pad: "sawtooth", drone: "sine",     melWave: "triangle", cutoff: 600,  reverb: 0.5,  pulseBpm: 0,  detune: 14, level: 0.45,
    melody: [[0,2],[6,1],[3,1],[6,2],[8,1],[6,1],[3,2],[REST,1],[0,3]] },
  // motoric anxiety: a stuttering repeated ping, then a quick scrambling run
  { id: "mempool",   name: "The Mempool",       root: A,        chord: [0, 5, 10],        melStep: 0.16, melOct: 4, pad: "sawtooth", drone: "triangle", melWave: "square",   cutoff: 800,  reverb: 0.35, pulseBpm: 96, detune: 9,  level: 0.45,
    melody: [[0,1],[0,1],[REST,1],[7,1],[5,1],[10,1],[7,1],[5,1],[3,1],[0,2],[REST,2]] },
  // solemn bell-tolls: wide open fifths and an octave with long silences between
  { id: "relay",     name: "Foot of the Relay", root: A * 0.5,  chord: [0, 12],           melStep: 0.46, melOct: 4, pad: "sine",     drone: "sine",     melWave: "sine",     cutoff: 400,  reverb: 0.6,  pulseBpm: 0,  detune: 3,  level: 0.5,
    melody: [[0,2],[REST,2],[7,2],[REST,1],[12,3],[REST,3],[7,2],[0,4],[REST,3]] },
  // sinister lurch: a minor-2nd grind into a tritone, collapsing back down low
  { id: "gehennom",  name: "Gehennom",          root: A * 0.5,  chord: [0, 1, 6],         melStep: 0.3,  melOct: 4, pad: "sawtooth", drone: "sawtooth", melWave: "sawtooth", cutoff: 460,  reverb: 0.5,  pulseBpm: 50, detune: 18, level: 0.5,
    melody: [[0,2],[1,1],[6,3],[REST,1],[8,1],[6,1],[1,2],[0,4]] },
  // boss march: a menacing 7–6–7 wobble at the top stabbing down to the root, over the pulse
  { id: "sanctum",   name: "Moloch's Sanctum",  root: A * 0.5,  chord: [0, 6, 7],         melStep: 0.22, melOct: 4, pad: "sawtooth", drone: "sawtooth", melWave: "square",   cutoff: 620,  reverb: 0.4,  pulseBpm: 84, detune: 16, level: 0.52,
    melody: [[7,1],[6,1],[7,2],[3,1],[0,2],[REST,1],[7,1],[6,1],[7,1],[0,3]] },
  // weightless ascent: a slow lydian climb to the #11, hanging in suspension
  { id: "planes",    name: "The Planes",        root: A * 2,    chord: [0, 7, 16, 23],    melStep: 0.42, melOct: 2, pad: "triangle", drone: "sine",     melWave: "sine",     cutoff: 1600, reverb: 0.7,  pulseBpm: 0,  detune: 7,  level: 0.42,
    melody: [[0,2],[4,2],[7,3],[11,4],[7,2],[9,2],[4,3],[REST,2]] },
  // sacred anthem: a clear major arch up to the octave and a hymnlike resolve home
  { id: "genesis",   name: "The Genesis Plane", root: A * 2,    chord: [0, 4, 7, 11, 14], melStep: 0.34, melOct: 2, pad: "triangle", drone: "sine",     melWave: "triangle", cutoff: 2200, reverb: 0.75, pulseBpm: 0,  detune: 4,  level: 0.42,
    melody: [[0,2],[4,1],[7,2],[12,4],[11,2],[7,2],[9,1],[7,1],[4,2],[0,4]] },
  // hypnotic, off-kilter: a symmetric whole-tone figure that circles and never quite lands
  { id: "elsewhere", name: "Elsewhere",         root: A * 1.25, chord: [0, 4, 8],         melStep: 0.28, melOct: 2, pad: "sine",     drone: "triangle", melWave: "triangle", cutoff: 1000, reverb: 0.55, pulseBpm: 0,  detune: 10, level: 0.45,
    melody: [[0,1],[2,1],[4,2],[6,1],[8,2],[6,1],[4,1],[2,2],[REST,2]] },
];

const ROMAN = ["", " II", " III", " IV", " V"];
const revoice = (c: number[]) => c.map((n, i) => (i === c.length - 1 ? n + 12 : n));
const clampRev = (r: number) => Math.min(0.85, r);
// Five textural variants per area — same root, chord, and (crucially) the same melody;
// only timbre, brightness, register, density, and reverb change, so the leitmotif stays.
const VARIANTS: ((b: Base) => Partial<Base>)[] = [
  () => ({}),                                                                                                              // I — the base texture
  (b) => ({ chord: revoice(b.chord), cutoff: Math.round(b.cutoff * 1.3), detune: b.detune + 4, melStep: +(b.melStep * 0.85).toFixed(3) }), // II — brighter, quicker
  (b) => ({ pad: b.drone, drone: b.pad, cutoff: Math.round(b.cutoff * 0.78), reverb: clampRev(b.reverb + 0.12), melOct: Math.max(1, b.melOct / 2), pulseBpm: b.pulseBpm ? Math.round(b.pulseBpm * 0.86) : 0 }), // III — darker, lower
  (b) => ({ cutoff: Math.round(b.cutoff * 1.6), reverb: clampRev(b.reverb + 0.18), melOct: b.melOct * 2, melWave: "sine", melStep: +(b.melStep * 1.15).toFixed(3) }), // IV — high shimmer
  (b) => ({ pad: b.drone, cutoff: Math.round(b.cutoff * 0.68), detune: b.detune + 7, melStep: +(b.melStep * 1.35).toFixed(3), pulseBpm: b.pulseBpm || 46 }), // V — heavy, slow, weighted
];
function variant(b: Base, n: number): TrackDef {
  return { ...b, ...VARIANTS[n](b), area: b.id, id: n === 0 ? b.id : `${b.id}-${n + 1}`, name: `${b.name}${ROMAN[n]}` };
}
// every area gets five textures sharing one leitmotif → "random by area" stays recognisable
const TRACKS: TrackDef[] = BASES.flatMap((b) => VARIANTS.map((_, n) => variant(b, n)));
const tracksForArea = (area: string) => TRACKS.filter((t) => t.area === area);

const semi = (root: number, n: number) => root * Math.pow(2, n / 12);

interface Voice { osc: OscillatorNode; gain: GainNode; lfo?: OscillatorNode; }
interface ActiveTrack { def: TrackDef; bus: GainNode; voices: Voice[]; }

/** The game's per-frame snapshot of what's around — drives distress, density, and reactions. */
export interface MusicContext {
  distress: number;   // 0..1 — deeper + more peril = sicker
  presence: number;   // 0..1 — structural melodic density (fuller shallow, sparser deep)
  danger: number;     // 0..1 — the tension layer
  bossNear: boolean;  // a boss / dragon / Censor in view → a menace rumble
  crowd: number;      // 0..1 — how thronged the area is
  jamNear: boolean;   // the JAM is on the level / held → a deep ominous pulse
  faucet: boolean;    // standing by a faucet → drips (foley)
  altar: boolean;     // standing by an altar → a soft chime (foley)
}

export class MusicEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private murk!: BiquadFilterNode;   // global lowpass the ambient bed runs through — closes with distress
  private reverb!: ConvolverNode;
  private reverbReturn!: GainNode;
  private active: ActiveTrack | null = null;
  private tensionBus!: GainNode;
  private tensionWet!: GainNode;
  private menaceGain!: GainNode;     // a low rumble that rises when a boss looms
  private noiseBuf: AudioBuffer | null = null;
  private timer: number | null = null;
  private nextMel = 0;       // next melody-note time
  private melIdx = 0;        // position within the leitmotif phrase
  private phraseFresh = true;        // a new phrase is about to be decided
  private phraseSkip = false;        // this cycle is an ambient drift (no melody)
  private phraseTranspose = 0;       // chord-tone shift for anti-loop variety
  private phraseOct = 1;             // octave for this restatement
  private nextTensionMote = 0;
  private nextPulse = 0;
  private nextTensionPulse = 0;
  private nextJam = 0;
  private nextChime = 0;
  private nextDrip = 0;
  private ebbPhase = Math.random() * Math.PI * 2;
  private danger = 0;          // 0..1, smoothed target for the tension layer
  private c: MusicContext = { distress: 0, presence: 1, danger: 0, bossNear: false, crowd: 0, jamNear: false, faucet: false, altar: false };
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

  /** The game's per-frame context — drives distress, density, and reactive layers. */
  setContext(c: MusicContext): void { this.c = c; this.danger = c.danger; }

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
    // a global lowpass the whole ambient bed passes through — it closes as distress rises (murk)
    this.murk = this.ctx.createBiquadFilter();
    this.murk.type = "lowpass";
    this.murk.frequency.value = 8500;
    this.murk.connect(this.master);
    // a generated reverb impulse (exponentially-decaying noise) — returns into the murk
    this.reverb = this.ctx.createConvolver();
    this.reverb.buffer = this.makeImpulse(3.2, 2.6);
    this.reverbReturn = this.ctx.createGain();
    this.reverbReturn.gain.value = 0.9;
    this.reverb.connect(this.reverbReturn).connect(this.murk);
    // the tension layer's own bus (a dry + wet split) — dry cuts through the murk straight to master
    this.tensionBus = this.ctx.createGain();
    this.tensionBus.gain.value = 0;
    const tDry = this.ctx.createGain(); tDry.gain.value = 0.6;
    this.tensionWet = this.ctx.createGain(); this.tensionWet.gain.value = 0.5;
    this.tensionBus.connect(tDry).connect(this.master);
    this.tensionBus.connect(this.tensionWet).connect(this.reverb);
    // a low rumble (filtered noise) that swells when a boss looms
    this.noiseBuf = this.makeNoise(2);
    const rumble = this.ctx.createBufferSource(); rumble.buffer = this.noiseBuf; rumble.loop = true;
    const rumbleLp = this.ctx.createBiquadFilter(); rumbleLp.type = "lowpass"; rumbleLp.frequency.value = 120;
    this.menaceGain = this.ctx.createGain(); this.menaceGain.gain.value = 0;
    rumble.connect(rumbleLp).connect(this.menaceGain).connect(this.murk);
    rumble.start();
  }

  private makeNoise(seconds: number): AudioBuffer {
    const rate = this.ctx!.sampleRate, len = Math.floor(rate * seconds);
    const buf = this.ctx!.createBuffer(1, len, rate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
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

  /** Build a per-track bus that routes through the murk (dry) + reverb (wet). Returns the input gain. */
  private makeBus(wet: number): GainNode {
    const bus = this.ctx!.createGain();
    const dry = this.ctx!.createGain(); dry.gain.value = 1 - wet * 0.5;
    const wetg = this.ctx!.createGain(); wetg.gain.value = wet;
    bus.connect(dry).connect(this.murk);
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
    this.nextMel = now + 1.2; // let the bed establish before the leitmotif enters
    this.melIdx = 0;
    this.phraseFresh = true; this.phraseOct = def.melOct; this.phraseTranspose = 0; this.phraseSkip = false;
    this.nextPulse = now + 0.5;
    this.nextJam = this.nextChime = this.nextDrip = now + 1;
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
  private note(freq: number, when: number, dur: number, bus: GainNode, type: Wave, peak: number, cutoff: number, detune = 0): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator(); osc.type = type; osc.frequency.value = freq; osc.detune.value = detune;
    const filt = ctx.createBiquadFilter(); filt.type = "lowpass"; filt.frequency.value = cutoff;
    const g = ctx.createGain(); g.gain.value = 0;
    osc.connect(filt).connect(g).connect(bus);
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(peak, when + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0008, when + dur);
    osc.start(when); osc.stop(when + dur + 0.05);
  }

  /** Slow swell-and-recede envelope (~70s) — the ebb and flow of the whole bed. */
  private ebb(now: number): number { return 0.5 + 0.5 * Math.sin((now / 70) * Math.PI * 2 + this.ebbPhase); }

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

    // ── distress → murk + detune the whole bed (deeper/perilous = sicker) ──
    const ds = this.c.distress;
    this.murk.frequency.setTargetAtTime(8500 - ds * 7600, now, 1.2);
    this.menaceGain.gain.setTargetAtTime((this.c.bossNear ? 0.13 : 0) + this.c.crowd * 0.05, now, 0.8);

    const t = this.active?.def;
    if (t && this.active) {
      for (const v of this.active.voices) v.osc.detune.setTargetAtTime(t.detune + ds * 34, now, 1.5); // beating sours the bed
      // structural density: fuller shallow, sparser deep — modulated by the slow ebb
      const presence = Math.max(0.08, Math.min(1, this.c.presence * (0.45 + 0.55 * this.ebb(now))));

      // the leitmotif — a continuously-mutating line: each restatement varies, with ambient drifts
      while (this.nextMel < horizon) {
        if (this.phraseFresh) {
          this.phraseFresh = false;
          if (Math.random() > presence * 0.85 + 0.12) {
            this.phraseSkip = true; // this cycle is an ambient drift — no motif
          } else {
            this.phraseSkip = false;
            this.phraseTranspose = Math.random() < 0.35 ? (t.chord[1 + Math.floor(Math.random() * (t.chord.length - 1))] ?? 0) : 0;
            const r = Math.random();
            this.phraseOct = r < 0.18 ? t.melOct * 2 : r < 0.34 ? Math.max(1, t.melOct / 2) : t.melOct;
          }
        }
        if (this.phraseSkip) {
          this.nextMel += t.melStep * (14 + Math.random() * 18 + (1 - presence) * 16); // a long, variable silence
          this.melIdx = 0; this.phraseFresh = true;
          continue;
        }
        if (this.melIdx < t.melody.length) {
          const [deg, steps] = t.melody[this.melIdx];
          const dropP = (1 - presence) * 0.4 + ds * 0.15;
          if (deg !== REST && Math.random() > dropP) {
            const freq = semi(t.root, deg + this.phraseTranspose) * this.phraseOct;
            const dur = Math.min(steps * t.melStep * 1.25, steps * t.melStep + 0.4);
            const bend = Math.random() < ds * 0.4 ? -ds * 45 * Math.random() : 0; // notes sag flat under distress
            this.note(freq, this.nextMel, dur, this.active.bus, t.melWave, 0.085 * (0.55 + 0.45 * presence), t.cutoff * 2.5, bend);
          }
          this.nextMel += steps * t.melStep * (1 + (Math.random() - 0.5) * ds * 0.5); // timing falters when sick
          this.melIdx++;
        } else {
          this.nextMel += t.melStep * (4 + (1 - presence) * 9); // a breath that lengthens when sparse
          this.melIdx = 0; this.phraseFresh = true;
        }
      }

      // low pulse / heartbeat
      if (t.pulseBpm > 0) {
        const beat = 60 / t.pulseBpm;
        while (this.nextPulse < horizon) { this.pulse(t.root * 0.5, this.nextPulse, this.active.bus, 0.18); this.nextPulse += beat; }
      } else this.nextPulse = now;

      // ── context reactions ──
      // the JAM on the level: a deep, slow, ominous pulse
      if (this.c.jamNear) { while (this.nextJam < horizon) { this.pulse(t.root * 0.5, this.nextJam, this.active.bus, 0.16); this.nextJam += 2.4; } } else this.nextJam = now;
      // altar: a soft high chime (musical reaction + signature foley)
      if (this.c.altar) { while (this.nextChime < horizon) { this.note(semi(t.root, 12) * 4, this.nextChime, 2.6, this.active.bus, "sine", 0.05, 4000); this.nextChime += 3.5 + Math.random() * 2.5; } } else this.nextChime = now;
      // faucet: occasional water drips (signature foley)
      if (this.c.faucet) { while (this.nextDrip < horizon) { this.drip(this.nextDrip); this.nextDrip += 0.7 + Math.random() * 1.8; } } else this.nextDrip = now;
    }

    // ── the tension layer, scaled by danger ──
    this.tensionBus.gain.setTargetAtTime(this.danger * 0.5, now, 0.6);
    if (this.danger > 0.05 && t) {
      while (this.nextTensionMote < horizon) {
        const f = semi(t.root, 6 + (Math.random() < 0.5 ? 0 : 1)) * 3;
        this.note(f, this.nextTensionMote, 0.5 + Math.random(), this.tensionBus, "sawtooth", 0.05, 1400);
        this.nextTensionMote += (1.6 - this.danger) * (0.7 + Math.random() * 0.6);
      }
      if (this.danger > 0.4) {
        const beat = 60 / (90 + this.danger * 60);
        while (this.nextTensionPulse < horizon) { this.pulse(t.root * 0.5, this.nextTensionPulse, this.tensionBus, 0.12); this.nextTensionPulse += beat; }
      } else this.nextTensionPulse = now;
    } else {
      this.nextTensionMote = now;
      this.nextTensionPulse = now;
    }
  }

  /** A water drip — a quick high blip that falls in pitch. */
  private drip(when: number): void {
    if (!this.active) return;
    const ctx = this.ctx!;
    const osc = ctx.createOscillator(); osc.type = "sine";
    const f = 900 + Math.random() * 700;
    osc.frequency.setValueAtTime(f, when); osc.frequency.exponentialRampToValueAtTime(f * 0.45, when + 0.12);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(0.05, when + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0006, when + 0.18);
    osc.connect(g).connect(this.active.bus);
    osc.start(when); osc.stop(when + 0.22);
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
