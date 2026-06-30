// Procedural ambient music for Ascend — zero assets, all synthesised live with the
// Web Audio API. Each area has a generative bed (drone + swelling pad), and a RHYTHM
// GROOVE — synthesised drums (kick → hats → snare) + a rhythmic bassline — rides on top
// as the main exploration layer, fading in and out with a hybrid intensity (per-zone
// baseline + live danger/crowd/JAM/boss). When you've been calm for a while it settles
// back to the bare ambient bed; the groove snaps back when a threat returns.
//
// When fully settled (a long calm), a relaxed CHILL IDLE GROOVE takes over — a half-time
// syncopated bass + light percussion with very sparse zone-keyed chimes — and the bed
// BREATHES: the drone AND the pad swells drop low and fully out for ~30s on a slow ~80s
// cycle, swelling back — opening space for just the groove + chimes + reverb tails. Distortion (murk + a soured, detuned bed) tracks the VISIBLE
// THREAT around you (count + proximity, peaking at bosses/swarms) — never depth. A
// danger-driven TENSION layer picks one of several DANGER THEMES on the rising edge of
// danger (a boss/swarm forces a heavy theme; the hells may too) — announced by a SWELL
// INTRO (a rising riser + tonal swell landing on a downbeat impact) — then escalates it by
// threat — trills tighten, bass enters, kicks fill. HEAVY themes play half-time with a
// deep kick + heavier sub-bass and spacious trills. Tracks crossfade between areas;
// stingers (death/ascension) duck everything.

type Wave = OscillatorType;

// A bassline note: [scale-degree-in-semitones, duration-in-steps]. REST skips a beat.
const REST = 99;
type Note = [number, number];

interface TrackDef {
  id: string;
  name: string;
  area: string;        // which dungeon area this track belongs to (auto-by-area pool)
  root: number;        // root frequency (Hz)
  chord: number[];     // semitone offsets (from root) for the sustained pad
  pad: Wave;
  drone: Wave;
  cutoff: number;      // lowpass brightness (Hz)
  reverb: number;      // 0..1 wet send
  pulseBpm: number;    // 0 = none; else a low heartbeat/pulse (only when the groove is resting)
  detune: number;      // cents (warmth) — soured further by nearby threat
  level: number;       // track mix level
  // ── the groove layer (every zone has one now — the rhythm IS the exploration texture) ──
  groove: number;      // 0..1 baseline grooviness — how readily drums + bass fade in
  bpm: number;         // tempo for the drum + bass grid (16th-note steps)
  bass: Note[];        // a rhythmic bassline over the bar (degree from root, low register)
}

// ── the ten base area themes — bed timbre + groove character, no melody ──
const A = 55; // a low A reference
type Base = Omit<TrackDef, "area">;
const BASES: Base[] = [
  { id: "legacy",    name: "Legacy Stack",      root: A,        chord: [0, 7, 15],        pad: "sine",     drone: "sine",     cutoff: 700,  reverb: 0.4,  pulseBpm: 0,  detune: 5,  level: 0.5,
    groove: 0.38, bpm: 80,  bass: [[0,4],[7,4],[3,4],[5,4]] },
  { id: "parachain", name: "Parachain Reaches", root: A * 1.5,  chord: [0, 7, 14, 16],    pad: "triangle", drone: "sine",     cutoff: 1100, reverb: 0.45, pulseBpm: 0,  detune: 6,  level: 0.5,
    groove: 0.5,  bpm: 116, bass: [[0,2],[7,2],[4,2],[7,2],[9,2],[7,2],[5,2],[0,2]] },
  { id: "kusama",    name: "Kusama Deeps",      root: A * 0.75, chord: [0, 6, 13],        pad: "sawtooth", drone: "sine",     cutoff: 600,  reverb: 0.5,  pulseBpm: 0,  detune: 14, level: 0.45,
    groove: 0.5,  bpm: 124, bass: [[0,2],[0,2],[6,2],[0,2],[3,2],[6,2],[0,4]] },
  { id: "mempool",   name: "The Mempool",       root: A,        chord: [0, 5, 10],        pad: "sawtooth", drone: "triangle", cutoff: 800,  reverb: 0.35, pulseBpm: 96, detune: 9,  level: 0.45,
    groove: 0.62, bpm: 132, bass: [[0,2],[0,2],[7,2],[0,2],[0,2],[10,2],[7,2],[5,2]] },
  { id: "relay",     name: "Foot of the Relay", root: A * 0.5,  chord: [0, 12],           pad: "sine",     drone: "sine",     cutoff: 400,  reverb: 0.6,  pulseBpm: 0,  detune: 3,  level: 0.5,
    groove: 0.28, bpm: 72,  bass: [[0,4],[7,4],[0,4],[12,4]] }, // slow, open fifths — gravely spacious
  { id: "gehennom",  name: "Gehennom",          root: A * 0.5,  chord: [0, 1, 6],         pad: "sawtooth", drone: "sawtooth", cutoff: 460,  reverb: 0.5,  pulseBpm: 50, detune: 18, level: 0.5,
    groove: 0.3,  bpm: 88,  bass: [[0,4],[1,2],[6,2],[0,4],[6,2],[1,2]] },
  { id: "sanctum",   name: "Moloch's Sanctum",  root: A * 0.5,  chord: [0, 6, 7],         pad: "sawtooth", drone: "sawtooth", cutoff: 620,  reverb: 0.4,  pulseBpm: 84, detune: 16, level: 0.52,
    groove: 0.32, bpm: 100, bass: [[0,2],[0,2],[7,2],[6,2],[0,2],[0,2],[7,2],[7,2]] },
  { id: "planes",    name: "The Planes",        root: A * 2,    chord: [0, 7, 16, 23],    pad: "triangle", drone: "sine",     cutoff: 1600, reverb: 0.7,  pulseBpm: 0,  detune: 7,  level: 0.42,
    groove: 0.3,  bpm: 92,  bass: [[0,4],[7,4],[16,4],[7,4]] }, // floating, weightless
  { id: "genesis",   name: "The Genesis Plane", root: A * 2,    chord: [0, 4, 7, 11, 14], pad: "triangle", drone: "sine",     cutoff: 2200, reverb: 0.75, pulseBpm: 0,  detune: 4,  level: 0.42,
    groove: 0.32, bpm: 96,  bass: [[0,2],[4,2],[7,2],[4,2],[0,2],[7,2],[4,2],[0,2]] },
  { id: "elsewhere", name: "Elsewhere",         root: A * 1.25, chord: [0, 4, 8],         pad: "sine",     drone: "triangle", cutoff: 1000, reverb: 0.55, pulseBpm: 0,  detune: 10, level: 0.45,
    groove: 0.42, bpm: 112, bass: [[0,2],[4,2],[8,2],[4,2],[0,2],[8,2],[4,2],[0,2]] },
];

const ROMAN = ["", " II", " III", " IV", " V"];
const revoice = (c: number[]) => c.map((n, i) => (i === c.length - 1 ? n + 12 : n));
const clampRev = (r: number) => Math.min(0.85, r);
// Five textural variants per area — same root, chord, groove; only timbre, brightness,
// register, reverb, and pulse change, so the area still reads as itself.
const VARIANTS: ((b: Base) => Partial<Base>)[] = [
  () => ({}),                                                                                                              // I — the base texture
  (b) => ({ chord: revoice(b.chord), cutoff: Math.round(b.cutoff * 1.3), detune: b.detune + 4 }),                          // II — brighter, revoiced
  (b) => ({ pad: b.drone, drone: b.pad, cutoff: Math.round(b.cutoff * 0.78), reverb: clampRev(b.reverb + 0.12), pulseBpm: b.pulseBpm ? Math.round(b.pulseBpm * 0.86) : 0 }), // III — darker, lower
  (b) => ({ cutoff: Math.round(b.cutoff * 1.6), reverb: clampRev(b.reverb + 0.18) }),                                      // IV — high shimmer
  (b) => ({ pad: b.drone, cutoff: Math.round(b.cutoff * 0.68), detune: b.detune + 7, pulseBpm: b.pulseBpm || 46 }),        // V — heavy, weighted
];
function variant(b: Base, n: number): TrackDef {
  return { ...b, ...VARIANTS[n](b), area: b.id, id: n === 0 ? b.id : `${b.id}-${n + 1}`, name: `${b.name}${ROMAN[n]}` };
}
const TRACKS: TrackDef[] = BASES.flatMap((b) => VARIANTS.map((_, n) => variant(b, n)));
const tracksForArea = (area: string) => TRACKS.filter((t) => t.area === area);

const semi = (root: number, n: number) => root * Math.pow(2, n / 12);

// ── danger themes ────────────────────────────────────────────────────────────
// On the rising edge of danger we pick ONE of these; visible threat then escalates
// its arrangement (trills tighten → bass enters → kick fills → sub-bass presence).
// "Light" themes sing in the zone's own chord (so combat grows out of the level's
// harmony); "heavy" themes are self-contained dark scales, reserved for bosses,
// swarms, and the hells — leaning into bass + low-end presence.
interface DangerTheme {
  id: string;
  zoned: boolean;                               // true → trill in the zone's tensionScale (reshaped by `contour`)
  scale?: number[];                             // self-contained scale (heavy themes)
  contour?: (zoneScale: number[]) => number[];  // reshape the zone scale for melodic variety
  lead: Wave; grace: Wave; cutoff: number;      // trill timbre + brightness
  bassFig: number[];                            // ostinato (scale degrees) once danger is real
  kickFill: number;                             // 0..1 — how aggressively kicks fill the bar
  heavy: boolean;                               // dark + sub-bass + presence-forward
}
const DANGER_THEMES: DangerTheme[] = [
  { id: "climb", zoned: true,  contour: (s) => s,                                                              lead: "triangle", grace: "square",   cutoff: 2600, bassFig: [0, 7, 0, 7, 0, 0, 7, 0], kickFill: 0.5,  heavy: false },
  { id: "surge", zoned: true,  contour: (s) => [...s].reverse(),                                               lead: "square",   grace: "triangle", cutoff: 2300, bassFig: [0, 0, 7, 0, 0, 7, 5, 7], kickFill: 0.75, heavy: false },
  { id: "weave", zoned: true,  contour: (s) => s.filter((_, i) => i % 2 === 0).concat(s.filter((_, i) => i % 2 === 1)), lead: "triangle", grace: "sine", cutoff: 2950, bassFig: [0, 5, 7, 5],          kickFill: 0.4,  heavy: false },
  { id: "dread", zoned: false, scale: [0, 1, 3, 6, 7, 6, 3, 1],                                                lead: "sawtooth", grace: "square",   cutoff: 1700, bassFig: [0, 0, 1, 0, 6, 0, 1, 0], kickFill: 0.9,  heavy: true },
  { id: "hunt",  zoned: false, scale: [0, 3, 6, 7, 10, 7, 6, 3],                                               lead: "square",   grace: "sawtooth", cutoff: 2050, bassFig: [0, 0, 0, 6, 0, 0, 7, 6], kickFill: 1.0,  heavy: true },
];

interface Voice { osc: OscillatorNode; gain: GainNode; lfo?: OscillatorNode; }
interface ActiveTrack { def: TrackDef; bus: GainNode; voices: Voice[]; }

/** The game's per-frame snapshot of what's around — drives distortion, groove, and tension. */
export interface MusicContext {
  threat: number;     // 0..1 — visible foes (count + proximity) → warps the bed (murk + detune)
  danger: number;     // 0..1 — drives the tension layer (trills / fast beats / bass)
  bossNear: boolean;  // a boss / dragon / Censor in view → a menace rumble
  crowd: number;      // 0..1 — how thronged the area is
  jamNear: boolean;   // the JAM is on the level / held → a deep ominous pulse
  faucet: boolean;    // standing by a faucet → drips (foley)
  altar: boolean;     // standing by an altar → a soft chime (foley)
}

export class MusicEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private murk!: BiquadFilterNode;   // global lowpass the ambient bed runs through — closes near threats
  private reverb!: ConvolverNode;
  private reverbReturn!: GainNode;
  private active: ActiveTrack | null = null;
  private tensionBus!: GainNode;
  private tensionWet!: GainNode;
  private menaceGain!: GainNode;     // a low rumble that rises when a boss looms
  private noiseBuf: AudioBuffer | null = null;
  private timer: number | null = null;
  private nextPulse = 0;
  // ── groove layer (drums + bass) ──
  private grooveBus!: GainNode;      // drums + bass — dry, punchy, bypasses the threat murk
  private nextStep = 0;              // next 16th-note drum step time
  private stepIdx = 0;               // 0..15 position in the bar
  private nextBass = 0;              // next bass onset time
  private bassIdx = 0;               // position in the bassline phrase
  private calmSince = 0;             // ctx time since things last went calm (drives settle-to-ambience)
  private stingerUntil = 0;          // a death/ascend stinger owns the mix until this time
  // ── tension layer (melodic trills + combat drums + bass, locked to the area bpm) ──
  private nextTrill = 0;
  private trillIdx = 0;
  private nextTensionStep = 0;
  private tensionStepIdx = 0;
  private nextTensionBass = 0;
  private tensionBassIdx = 0;
  private nextJam = 0;
  private nextChime = 0;
  private nextDrip = 0;
  private ebbPhase = Math.random() * Math.PI * 2;
  // ── idle chill groove (settled state): relaxed syncopated bass + light perc + sparse chimes ──
  private nextChillStep = 0;
  private chillStepIdx = 0;
  private nextChillBass = 0;
  private chillBassIdx = 0;
  private nextChillChime = 0;
  private droneVoices: { gain: GainNode; base: number }[] = []; // the bed's drones — ducked/breathed during calm
  private padVoices: GainNode[] = [];                            // the bed's pad output gains — breathed alongside the drone
  // ── danger theme (picked on the rising edge of danger, escalated by threat) ──
  private dangerActive = false;
  private dangerTheme: DangerTheme | null = null;
  private lastIntro = 0; // ctx time of the last danger swell-intro (debounces flicker near the threshold)
  private danger = 0;          // 0..1, the tension layer's target
  private c: MusicContext = { threat: 0, danger: 0, bossNear: false, crowd: 0, jamNear: false, faucet: false, altar: false };
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
  get trackList(): { id: string; name: string }[] { return BASES.map((t) => ({ id: t.id, name: t.name })); }

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

  /** The game's per-frame context — drives distortion, groove, and the tension layer. */
  setContext(c: MusicContext): void { this.c = c; this.danger = c.danger; }

  /** A one-shot musical cue on death (falling, gloomy) or ascension (rising, luminous). */
  playStinger(kind: "death" | "ascend"): void {
    if (!this._enabled) return;
    this.ensureContext();
    this.resume();
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    // duck the area bed + kill tension/groove so the stinger reads clearly
    if (this.active) { this.active.bus.gain.cancelScheduledValues(now); this.active.bus.gain.setTargetAtTime(this.active.def.level * 0.2, now, 0.2); }
    this.tensionBus.gain.cancelScheduledValues(now); this.tensionBus.gain.setTargetAtTime(0, now, 0.15);
    this.grooveBus.gain.cancelScheduledValues(now); this.grooveBus.gain.setTargetAtTime(0, now, 0.15);
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
    this.stingerUntil = end; // hold the duck — tick won't restore tension/groove until the stinger clears
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
    // a global lowpass the whole ambient bed passes through — it closes as nearby threat rises (murk)
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
    // the groove bus — drums + bass. Dry straight to master (stays punchy, not muffled by the
    // threat murk), with a small reverb send for glue.
    this.grooveBus = this.ctx.createGain();
    this.grooveBus.gain.value = 0;
    const gDry = this.ctx.createGain(); gDry.gain.value = 0.92;
    const gWet = this.ctx.createGain(); gWet.gain.value = 0.1;
    this.grooveBus.connect(gDry).connect(this.master);
    this.grooveBus.connect(gWet).connect(this.reverb);
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
    // drone (root + a quiet fifth) — tracked so the bed can be ducked + "breathed" during calm
    this.droneVoices = [];
    const d1 = this.makeDrone(def, def.root, 0.10, bus); voices.push(d1); this.droneVoices.push({ gain: d1.gain, base: 0.10 });
    const d2 = this.makeDrone(def, semi(def.root, 7), 0.05, bus); voices.push(d2); this.droneVoices.push({ gain: d2.gain, base: 0.05 });
    // pad chord with slow swells — each routed through an output gain so the pad can breathe too
    this.padVoices = [];
    for (const c of def.chord) voices.push(this.makePad(def, semi(def.root, c) * 2, bus));
    this.active = { def, bus, voices };
    this.nextPulse = now + 0.5;
    this.calmSince = now;
    // the groove enters a bar or two after the bed (so a zone fades up ambient first, then finds its beat)
    this.nextStep = this.nextBass = now + 2.4;
    this.stepIdx = this.bassIdx = 0;
    this.nextTrill = this.nextTensionStep = this.nextTensionBass = now;
    this.trillIdx = 0; this.tensionStepIdx = this.tensionBassIdx = 0;
    this.nextJam = this.nextChime = this.nextDrip = now + 1;
    this.nextChillStep = this.nextChillBass = this.nextChillChime = now + 2; this.chillStepIdx = this.chillBassIdx = 0;
    this.dangerActive = false; this.dangerTheme = null;
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
    const out = ctx.createGain(); out.gain.value = 1; // a breath gain, ducked during calm (the swell stays on `gain`)
    osc.connect(filt).connect(gain).connect(out).connect(bus);
    this.padVoices.push(out);
    osc.start(); lfo.start(); base.start();
    return { osc, gain, lfo };
  }

  /** A short plucked/bowed note into a bus (tension trills + foley). */
  private note(freq: number, when: number, dur: number, bus: GainNode, type: Wave, peak: number, cutoff: number, detune = 0): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator(); osc.type = type; osc.frequency.value = freq; osc.detune.value = detune;
    const filt = ctx.createBiquadFilter(); filt.type = "lowpass"; filt.frequency.value = cutoff;
    const g = ctx.createGain(); g.gain.value = 0;
    osc.connect(filt).connect(g).connect(bus);
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(peak, when + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0008, when + dur);
    g.gain.linearRampToValueAtTime(0, when + dur + 0.04); // settle to true silence before stop — no click
    osc.start(when); osc.stop(when + dur + 0.05);
  }

  /** A soft bell/pad tone for the calm ambient melody — slow swell-in, long ring, rounded + with a
   *  quiet octave shimmer. Routed into the area bus so it picks up the zone's reverb. */
  private bellNote(freq: number, when: number, dur: number, bus: GainNode, peak: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator(); osc.type = "triangle"; osc.frequency.value = freq;
    const shimmer = ctx.createOscillator(); shimmer.type = "sine"; shimmer.frequency.value = freq * 2.005; // a touch of glassy octave
    const sg = ctx.createGain(); sg.gain.value = 0.28;
    const filt = ctx.createBiquadFilter(); filt.type = "lowpass"; filt.frequency.value = 2400;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(peak, when + 0.45);            // soft swell-in (no pluck)
    g.gain.exponentialRampToValueAtTime(0.0006, when + dur);
    g.gain.linearRampToValueAtTime(0, when + dur + 0.1);
    osc.connect(filt); shimmer.connect(sg).connect(filt); filt.connect(g).connect(bus);
    osc.start(when); shimmer.start(when); osc.stop(when + dur + 0.12); shimmer.stop(when + dur + 0.12);
  }

  /** Slow swell-and-recede envelope (~70s) — the ebb and flow of the groove intensity. */
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

    const c = this.c;
    // ── distortion tracks the VISIBLE THREAT around you (not depth): the murk closes + the bed sours ──
    const warp = c.threat;
    this.murk.frequency.setTargetAtTime(8500 - warp * 7000, now, 1.0);
    this.menaceGain.gain.setTargetAtTime((c.bossNear ? 0.13 : 0) + c.crowd * 0.05, now, 0.8);

    const t = this.active?.def;
    if (t && this.active) {
      for (const v of this.active.voices) v.osc.detune.setTargetAtTime(t.detune + warp * 30, now, 1.2); // beating sours the bed near foes

      // ── the bed breathes: in calm the whole bed (drone + pad swells) drops to a low level, then fully
      //    out for ~30s on a slow ~80s cycle, swelling back — opening space for the chill groove + chimes. ──
      const calmish = this.danger < 0.2 && !c.bossNear && !c.jamNear;
      const bedMul = calmish ? ((now / 80) % 1 > 0.62 ? 0 : 0.5) : 1; // ~30s "breath" (bed out) per cycle
      for (const d of this.droneVoices) d.gain.gain.setTargetAtTime(d.base * bedMul, now, 6);
      for (const pg of this.padVoices) pg.gain.setTargetAtTime(bedMul, now, 6);

      // ── calm → ambience: after ~25s with nothing threatening, the groove ebbs out to the chill idle groove ──
      const calm = this.danger < 0.06 && c.crowd < 0.05 && !c.bossNear && !c.jamNear && warp < 0.06;
      if (!calm) this.calmSince = now;
      const settled = now - this.calmSince > 25; // long calm → settle into the idle groove

      // ── groove intensity (per-zone baseline + situation), handed to the chill groove once settled ──
      const baseG = t.groove ?? 0;
      let intensity = 0;
      if (baseG > 0 && !settled) {
        const situ = Math.max(this.danger, c.crowd * 0.7) + (c.jamNear ? 0.15 : 0) + (c.bossNear ? 0.2 : 0);
        intensity = Math.min(1, baseG * (0.55 + 0.45 * this.ebb(now)) + 0.45 * situ);
      }
      const grooveOn = intensity > 0.12;
      const stinging = now < this.stingerUntil;

      if (settled && !stinging) {
        // ── idle: a relaxed, syncopated chill groove (bass + light perc + sparse chimes) over the breathing bed ──
        this.grooveBus.gain.setTargetAtTime(0.34, now, 2.6);
        this.scheduleChillGroove(t, now, horizon);
        this.nextStep = this.nextBass = now; this.stepIdx = this.bassIdx = 0; // keep the combat groove re-synced for when threat returns
      } else {
        this.grooveBus.gain.setTargetAtTime(grooveOn && !stinging ? intensity * 0.5 : 0, now, 1.0);
        if (grooveOn && !stinging) this.scheduleGroove(t, now, horizon, intensity);
        else { this.nextStep = this.nextBass = now; this.stepIdx = this.bassIdx = 0; }
        this.nextChillStep = this.nextChillBass = this.nextChillChime = now; this.chillStepIdx = this.chillBassIdx = 0;
      }

      // low pulse / heartbeat — only when neither groove is playing (not during the chill idle groove)
      if (t.pulseBpm > 0 && !grooveOn && !(settled && !stinging)) {
        const beat = 60 / t.pulseBpm;
        while (this.nextPulse < horizon) { this.pulse(t.root * 0.5, this.nextPulse, this.active.bus, 0.18); this.nextPulse += beat; }
      } else this.nextPulse = now;

      // ── context reactions ──
      if (c.jamNear) { while (this.nextJam < horizon) { this.pulse(t.root * 0.5, this.nextJam, this.active.bus, 0.16); this.nextJam += 2.4; } } else this.nextJam = now;
      if (c.altar) { while (this.nextChime < horizon) { this.note(semi(t.root, 12) * 4, this.nextChime, 2.6, this.active.bus, "sine", 0.05, 4000); this.nextChime += 3.5 + Math.random() * 2.5; } } else this.nextChime = now;
      if (c.faucet) { while (this.nextDrip < horizon) { this.drip(this.nextDrip); this.nextDrip += 0.7 + Math.random() * 1.8; } } else this.nextDrip = now;
    }

    // ── the tension layer: trills + fast beats + a driving bass, scaled by danger ──
    this.scheduleTension(now, horizon);
  }

  /** Tension: a flowing melodic trill + combat drums + bass, all locked to the area's bpm/scale and
   *  scaled by danger — so combat music grows out of the level's own groove rather than a generic alarm. */
  private scheduleTension(now: number, horizon: number): void {
    const t = this.active?.def;
    const d = this.danger;
    const stinging = now < this.stingerUntil;
    // Danger triggers the layer; visible threat (count + proximity), bosses, and crowds ESCALATE it.
    const sev = Math.min(1, Math.max(d, this.c.threat) + (this.c.bossNear ? 0.15 : 0) + this.c.crowd * 0.2);
    this.tensionBus.gain.setTargetAtTime(stinging ? 0 : Math.min(0.6, sev * 0.5), now, 0.6);
    if (stinging || !t || d <= 0.05) {
      this.nextTrill = this.nextTensionStep = this.nextTensionBass = now;
      this.dangerActive = false; this.dangerTheme = null; // reset so the next fight re-rolls a theme
      return;
    }
    // Rising edge → pick a theme. A boss/swarm arriving mid-fight upgrades a light theme to a heavy one.
    if (!this.dangerActive || !this.dangerTheme) { this.dangerActive = true; this.pickDangerTheme(); }
    else if (!this.dangerTheme.heavy && (this.c.bossNear || this.c.crowd > 0.55)) this.pickDangerTheme();
    const th = this.dangerTheme!;

    const root = t.root;
    const sixteenth = 60 / (t.bpm ?? 110) / 4; // everything rides the zone's tempo grid
    const scale = th.zoned ? (th.contour ? th.contour(this.tensionScale(t)) : this.tensionScale(t)) : th.scale!;

    // ── melodic trills: the theme's line; subdivision tightens with severity, grace shimmer enters mid ──
    // Heavy themes trill more spaciously (half as often) so the bass + deep drums carry the weight.
    const gap = sixteenth * (sev > 0.66 ? 1 : sev > 0.33 ? 2 : 4) * (th.heavy ? 2 : 1);
    const peak = 0.03 + sev * 0.04;
    while (this.nextTrill < horizon) {
      const deg = scale[this.trillIdx % scale.length];
      this.note(semi(root, deg) * 2, this.nextTrill, gap * 0.85, this.tensionBus, th.lead, peak, th.cutoff);
      if (sev > 0.4) this.note(semi(root, deg + 2) * 2, this.nextTrill + sixteenth * 0.5, sixteenth * 0.5, this.tensionBus, th.grace, peak * 0.7, th.cutoff - 200); // grace shimmer
      this.trillIdx++;
      this.nextTrill += gap;
    }

    // ── combat drums: kick density scales with severity × the theme's fill ──
    while (this.nextTensionStep < horizon) {
      const s = this.tensionStepIdx, when = this.nextTensionStep;
      const kp = (0.16 + sev * 0.22) * (0.75 + th.kickFill * 0.4); // heavier themes hit harder
      if (th.heavy) {
        // half-time + deep: big spaced kicks on 1 and the &-of-3, a deep tom/snare on 3, sparse hats
        if (s === 0 || s === 11) this.kick(when, this.tensionBus, kp * 1.25, true);
        if (s === 8 && sev > 0.4) this.noiseHit(when, 0.18, this.tensionBus, 0.22, "bandpass", 1250, 0.8);
        if ((s === 4 || s === 12) && sev > 0.66) this.noiseHit(when, 0.03, this.tensionBus, 0.04, "highpass", 6800, 0.7);
      } else {
        const fill = sev * (0.6 + th.kickFill * 0.6);
        if (s === 0 || s === 8 || (fill > 0.5 && (s === 4 || s === 12)) || (fill > 0.75 && (s === 6 || s === 14))) this.kick(when, this.tensionBus, kp);
        if ((s === 4 || s === 12) && sev > 0.4) this.noiseHit(when, 0.12, this.tensionBus, 0.16, "bandpass", 1900, 0.8); // snare backbeat
        if (s % 2 === 0 || sev > 0.6) this.noiseHit(when, 0.03, this.tensionBus, 0.05 + sev * 0.04, "highpass", 7600, 0.7); // hats
      }
      this.tensionStepIdx = (s + 1) % 16;
      this.nextTensionStep += sixteenth;
    }

    // ── driving bass (the theme's figure) once danger is real; heavy themes play half-time + add sub-bass presence ──
    if (sev > 0.3) {
      const fig = th.bassFig;
      const bassEvery = th.heavy ? 4 : 2;                      // half-time bass for heavy themes
      const bassLen = sixteenth * (th.heavy ? 3.6 : 1.8);      // longer, weightier notes when heavy
      while (this.nextTensionBass < horizon) {
        let bf = semi(root, fig[this.tensionBassIdx % fig.length]);
        while (bf < 41) bf *= 2; // lift very-low roots into audible bass range
        this.bassNote(bf, this.nextTensionBass, bassLen, this.tensionBus, (th.heavy ? 0.2 : 0.16) + sev * 0.12);
        if ((th.heavy || sev > 0.66) && bf / 2 >= 26) this.bassNote(bf / 2, this.nextTensionBass, bassLen, this.tensionBus, (th.heavy ? 0.14 : 0.09) + sev * 0.07); // sub-octave presence
        this.tensionBassIdx++;
        this.nextTensionBass += sixteenth * bassEvery;
      }
    } else { this.nextTensionBass = now; this.tensionBassIdx = 0; }
  }

  /** On the rising edge of danger, choose a danger theme: a boss or swarm forces a heavy one; the
   *  hells may draw a heavy one too; otherwise a light, zone-keyed theme. Avoids repeating the last. */
  private pickDangerTheme(): void {
    const heavies = DANGER_THEMES.filter((x) => x.heavy);
    const lights = DANGER_THEMES.filter((x) => !x.heavy);
    let pool: DangerTheme[];
    if (this.c.bossNear || this.c.crowd > 0.55) pool = heavies;
    else if (this.area === "gehennom" || this.area === "sanctum") pool = DANGER_THEMES;
    else pool = lights;
    let pick = pool[Math.floor(Math.random() * pool.length)];
    if (pool.length > 1 && this.dangerTheme && pick.id === this.dangerTheme.id) pick = pool[(pool.indexOf(pick) + 1) % pool.length];
    this.dangerTheme = pick;
    this.playDangerIntro(pick);
  }

  /** A swell intro when danger appears: a rising riser + tonal swell that crescendos and lands on a
   *  downbeat impact, handing off to the theme. Heavy themes get a darker, deeper riser + a boom;
   *  light themes a brighter upward sweep + crash. Routed dry (bypasses the threat murk) so it cuts. */
  private playDangerIntro(th: DangerTheme): void {
    if (!this.ctx) return;
    const ctx = this.ctx, now = ctx.currentTime;
    if (now - this.lastIntro < 4) return; // don't re-fire on danger flicker
    this.lastIntro = now;
    const dur = th.heavy ? 1.5 : 1.05;
    // a small dry bus (straight to master) + a reverb send, so the swell stays bright under threat
    const bus = ctx.createGain(); bus.gain.value = 1; bus.connect(this.master);
    const wet = ctx.createGain(); wet.gain.value = 0.35; bus.connect(wet).connect(this.reverb);
    // a noise riser sweeping upward (darker/lower for heavy)
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf!; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = "bandpass"; f.Q.value = 0.8;
    const lo = th.heavy ? 200 : 500, hi = th.heavy ? 2600 : 6000;
    f.frequency.setValueAtTime(lo, now); f.frequency.exponentialRampToValueAtTime(hi, now + dur);
    const ng = ctx.createGain(); ng.gain.setValueAtTime(0, now);
    ng.gain.linearRampToValueAtTime(th.heavy ? 0.16 : 0.12, now + dur * 0.92); // swell up
    ng.gain.linearRampToValueAtTime(0, now + dur + 0.15);                       // release as the beat lands
    src.connect(f).connect(ng).connect(bus);
    src.start(now); src.stop(now + dur + 0.2);
    // a tonal swell on the root — rising, tense
    const root = this.active?.def.root ?? 110;
    const base = th.heavy ? root : root * 2;
    const osc = ctx.createOscillator(); osc.type = th.heavy ? "sawtooth" : "triangle";
    osc.frequency.setValueAtTime(base * 0.94, now); osc.frequency.linearRampToValueAtTime(base, now + dur);
    const og = ctx.createGain(); og.gain.setValueAtTime(0, now);
    og.gain.linearRampToValueAtTime(th.heavy ? 0.10 : 0.07, now + dur * 0.9);
    og.gain.exponentialRampToValueAtTime(0.0006, now + dur + 0.3);
    og.gain.linearRampToValueAtTime(0, now + dur + 0.34);
    osc.connect(og).connect(bus);
    osc.start(now); osc.stop(now + dur + 0.35);
    // the downbeat impact when it lands — a deep boom (heavy) or a bright crash (light)
    if (th.heavy) this.kick(now + dur, bus, 0.5, true);
    else this.noiseHit(now + dur, 0.18, bus, 0.2, "bandpass", 2400, 0.6);
    window.setTimeout(() => { try { bus.disconnect(); } catch { /* gone */ } }, (dur + 0.6) * 1000);
  }

  /** A flowing up-and-back melodic contour drawn from the area's chord tones — the trills sing in
   *  the level's own harmony (climb to the octave, step back down). */
  private tensionScale(t: TrackDef): number[] {
    const ch = t.chord.length ? t.chord : [0, 7];
    const down = ch.slice(1, -1).reverse(); // avoid repeating the top/bottom on the way back
    return [...ch, ch[ch.length - 1] + 12, ...down];
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
    g.gain.linearRampToValueAtTime(0, when + 0.21);
    osc.connect(g).connect(this.active.bus);
    osc.start(when); osc.stop(when + 0.22);
  }

  private pulse(freq: number, when: number, bus: GainNode, peak: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator(); osc.type = "sine"; osc.frequency.setValueAtTime(freq, when); osc.frequency.exponentialRampToValueAtTime(freq * 0.5, when + 0.25);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(peak, when + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0008, when + 0.3);
    g.gain.linearRampToValueAtTime(0, when + 0.34);
    osc.connect(g).connect(bus);
    osc.start(when); osc.stop(when + 0.35);
  }

  /** Schedule one batch of drum steps + bass onsets, locked to the zone's BPM, fading with intensity. */
  private scheduleGroove(t: TrackDef, now: number, horizon: number, intensity: number): void {
    const bpm = t.bpm ?? 110;
    const step = 60 / bpm / 4; // a 16th note
    if (this.nextStep < now - 1) { this.nextStep = now; this.stepIdx = 0; } // re-sync after a stall (backgrounded tab)
    while (this.nextStep < horizon) {
      const s = this.stepIdx, bus = this.grooveBus, when = this.nextStep;
      // kick: 0 & 8 always; 4 & 12 once driving; syncopated 6 & 14 when intense
      if (s === 0 || s === 8 || (intensity > 0.5 && (s === 4 || s === 12)) || (intensity > 0.72 && (s === 6 || s === 14))) this.kick(when, bus, 0.5);
      // snare backbeat
      if ((s === 4 || s === 12) && intensity > 0.32) this.noiseHit(when, 0.14, bus, 0.2, "bandpass", 1850, 0.8);
      // hats: offbeats first, then every step when intense; a touch louder on the & of the beat
      if (intensity > 0.2 && (s % 2 === 0 || intensity > 0.6)) this.noiseHit(when, 0.035, bus, s % 4 === 2 ? 0.1 : 0.06, "highpass", 8200, 0.7);
      this.nextStep += step;
      this.stepIdx = (this.stepIdx + 1) % 16;
    }
    // the bassline fades in a notch above the drums; loops its own phrase locked to the same grid
    if (intensity > 0.38 && t.bass && t.bass.length) {
      if (this.nextBass < now - 1) { this.nextBass = now; this.bassIdx = 0; }
      while (this.nextBass < horizon) {
        const [deg, steps] = t.bass[this.bassIdx % t.bass.length];
        const dur = steps * step;
        let bf = semi(t.root, deg);
        while (bf < 41) bf *= 2; // lift very-low roots (Gehennom/Sanctum at 27.5Hz) into audible bass range
        if (deg !== REST) this.bassNote(bf, this.nextBass, Math.min(dur * 0.92, dur), this.grooveBus, 0.26 * Math.min(1, intensity * 1.2));
        this.nextBass += dur;
        this.bassIdx = (this.bassIdx + 1) % t.bass.length;
      }
    } else { this.nextBass = now; this.bassIdx = 0; }
  }

  /** The idle/exploration texture: a relaxed half-time syncopated bass + light percussion with very
   *  sparse zone-keyed chimes — replaces the old idle bell melody. Drums/bass run through the punchy
   *  groove bus; chimes ring through the area's reverb. */
  private scheduleChillGroove(t: TrackDef, now: number, horizon: number): void {
    const step = 60 / (t.bpm ?? 110) / 4; // the zone's 16th grid
    const bus = this.grooveBus;
    if (this.nextChillStep < now - 1) { this.nextChillStep = now; this.chillStepIdx = 0; }
    while (this.nextChillStep < horizon) {
      const s = this.chillStepIdx, when = this.nextChillStep;
      // half-time, laid-back kit: kick on beat 1 + the syncopated "&-of-3"; soft rim on 3; swung shaker
      if (s === 0 || s === 11) this.kick(when, bus, 0.3);
      if (s === 8) this.noiseHit(when, 0.11, bus, 0.11, "bandpass", 1700, 0.7);
      if (s === 6 || s === 14) this.noiseHit(when, 0.04, bus, 0.05, "highpass", 7000, 0.7);
      this.chillStepIdx = (s + 1) % 16;
      this.nextChillStep += step;
    }
    // a sparse, syncopated bassline (degree + step-duration, with rests) in the zone's key — sums to one bar
    const fig: Note[] = [[0, 3], [REST, 1], [7, 2], [REST, 2], [5, 2], [REST, 1], [0, 3], [REST, 2]];
    if (this.nextChillBass < now - 1) { this.nextChillBass = now; this.chillBassIdx = 0; }
    while (this.nextChillBass < horizon) {
      const [deg, steps] = fig[this.chillBassIdx % fig.length];
      const dur = steps * step;
      if (deg !== REST) { let bf = semi(t.root, deg); while (bf < 41) bf *= 2; this.bassNote(bf, this.nextChillBass, dur * 0.85, bus, 0.18); }
      this.nextChillBass += dur;
      this.chillBassIdx = (this.chillBassIdx + 1) % fig.length;
    }
    // very sparse chimes — zone-keyed bells, occasional, through the area reverb
    const sc = this.tensionScale(t);
    while (this.nextChillChime < horizon) {
      if (Math.random() < 0.4 && this.active) this.bellNote(semi(t.root, sc[Math.floor(Math.random() * sc.length)]) * 2, this.nextChillChime, 3.2, this.active.bus, 0.045);
      this.nextChillChime += 4 + Math.random() * 5; // every 4–9s, 40% → very sparse
    }
  }

  /** Kick drum — a sine with a fast pitch drop and a punchy decay. `deep` = a lower, longer, heavier
   *  thud for the half-time heavy enemy themes. */
  private kick(when: number, bus: GainNode, peak: number, deep = false): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator(); osc.type = "sine";
    const f0 = deep ? 100 : 135, f1 = deep ? 30 : 46, drop = deep ? 0.13 : 0.09, dec = deep ? 0.34 : 0.22;
    osc.frequency.setValueAtTime(f0, when); osc.frequency.exponentialRampToValueAtTime(f1, when + drop);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(peak, when + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0008, when + dec);
    g.gain.linearRampToValueAtTime(0, when + dec + 0.03);
    osc.connect(g).connect(bus);
    osc.start(when); osc.stop(when + dec + 0.04);
  }

  /** A filtered-noise percussion hit — bandpass = snare/clap, highpass = hi-hat. */
  private noiseHit(when: number, dur: number, bus: GainNode, peak: number, type: BiquadFilterType, freq: number, q: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf!;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(peak, when + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0005, when + dur);
    g.gain.linearRampToValueAtTime(0, when + dur + 0.02);
    src.connect(f).connect(g).connect(bus);
    src.start(when); src.stop(when + dur + 0.03);
  }

  /** A plucked bass note — a sawtooth through a low lowpass. */
  private bassNote(freq: number, when: number, dur: number, bus: GainNode, peak: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator(); osc.type = "sawtooth"; osc.frequency.value = freq;
    const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 300; f.Q.value = 3;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(peak, when + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0008, when + dur);
    g.gain.linearRampToValueAtTime(0, when + dur + 0.02);
    osc.connect(f).connect(g).connect(bus);
    osc.start(when); osc.stop(when + dur + 0.03);
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
    this.grooveBus.gain.setTargetAtTime(0, now, 0.2);
  }
}
