// The beds' mix (v2 step 3): one frame of sim state in, every voice's target and the one-shot events out.
// Pure and deterministic (no Web Audio, no Math.random(), no clock): node tests drive it, the offline render and the live
// page feed it the same way. v2/audio/beds.js turns its output into parameter targets on a graph built once.
//
// It reads what v1's sound reads, through v1's own mixers, so the levels and the triggers are v1's:
//   src/boatAudio.js BoatMix   the hull (chuckle, rush, the surf's roar, the rail's hiss, the bow slaps from the pitch at the
//                              bow), the load (the hum, the creaks, the sheet's groan, the sigh, the stall), the sails (the
//                              flutter, the flog, the snap on filling), the wind in the rig and its whistle, the distance
//   src/audio.js mixAt         the lake's ambience: the wind at the listener (v1's two wind beds), the lapping, the rain
//   src/sfx.js SfxMix          the controls: the winch's pawl clicks and the sheet's creak on the drum, the sheet running out
// and adds what the code voices need and v1's files carried in their recordings: the wind's cutoff, buffeting and stereo side
// (the apparent wind's angle at the listener), the flap rates of the luff and the flog, the heel on the rush, the still lap, the
// rain on the deck.
//
//   const mix = new BedsMix({ seed });
//   const out = mix.withBoat(mix.stepWind(input), boatMix)   // the hybrid (the page, the offline render): the code wind's targets
//   const all = mix.step(input)    // the all-code beds' full mix (before the owner's ear test, 2026-11-13: hull, sails and rain
//                                  // now play v1's recordings); kept for the record and the tests of v1's mixers through it
// The page runs stepWind only: v1's engines (v2/audio/recorded.js) run their own BoatMix and SfxMix.
import { knockdownWind } from './knockdownSound.js';
import { BoatMix, KN } from '../../src/boatAudio.js';
import { mixAt } from '../../src/audio.js';
import { SfxMix } from '../../src/sfx.js';

const DEG = Math.PI / 180;
import { clamp01 } from '../../src/sim/core/math.js';
import { smooth as smoothstep } from '../../src/sim/core/math.js';
import { lerp } from '../../src/sim/core/math.js';

// v2's own shapes (the rest are v1's LEVEL tables)
export const BEDS = {
  windRefMs: 12,            // the wind's u = earWind / windRefMs (Cold Smoke's cutoff 300 + 830·u^1.1 Hz; its u was skiing speed / 34 m/s)
  buffet: [0.22, 0.26],     // each ear's buffeting depth: a + b·min(u, 1) (Cold Smoke)
  buffetRate: [40, 9],      // the buffeting curve's playback in curve samples a second: a + b·earWind (Cold Smoke: 70 + 4.6·v for a skier)
  gustRate: 9,              // the slow swell on both ears together (curve samples a second)
  panMax: 0.65,             // the wind's stereo side at most (|pan|)
  lapStill: 0.35,           // the lap against the hull when nearly still (sog under ≈ 1 kn), before the boat bus
  deckRain: 0.4,            // the rain on the deck at full rain, before the boat bus
  heelRush: 0.35,           // the rush × (1 + heelRush · heel / 25°): the lee side's water nearer the ear
  flutterHz: [2.6, 0.95],   // the luff's flap: a + b·AWS (m/s) Hz, × (1 + 0.3 head): ≈ 6 Hz at 3.5 m/s, ≈ 10 Hz at 8 m/s
  flogHz: [1.4, 0.42],      // the whole sail flogging head to wind: slower, heavier
};

export class BedsMix {
  constructor({ seed = 1 } = {}) {
    this.boat = new BoatMix({ seed });
    this.sfx = new SfxMix({ seed });
    this.rough = 0; this.lastWall = null;
  }
  // input: {
  //   t          the sim time (s): the boat's mixer runs on it (v1: simT)
  //   wallT      the real time (s): the controls' sounds follow the hand (v1: the frame clock); default t
  //   state      the physics' state (v1's phys.state: sog, heading, heel, apparentWind, mainFill, jibFill, drive, side, …)
  //   pitch      the drawn pitch (rad, + bow up): the float on the FFT surface; default state.pitch
  //   bowRelVel  the bow's speed against the water (m/s, the float): the sea the hull feels (v1's seaRough)
  //   earWind    the wind at the listener (m/s, WindField.sample at the eye: the gusts); default the apparent wind
  //   pan        the apparent wind's side at the listener (−1 left … +1 right)
  //   rain       0..1 (the storm's rain)
  //   camDist    the camera's distance to the boat (m)
  //   shoreDist  the listener's distance to the shore (m); default 400 (open water)
  //   hour       the scene's hour
  //   sheet, pull, rudder, steer   the hands (the winch's clicks, the sheet running out)
  // }
  step(inp) {
    const s = inp.state ?? {}, t = inp.t ?? 0, wallT = inp.wallT ?? t;
    const dtW = this.lastWall === null ? 0 : Math.min(0.1, Math.max(0, wallT - this.lastWall));
    this.lastWall = wallT;
    // the sea the hull feels (v1 src/controllers/sail.js: |bowRelVel| / 1.4, smoothed over 1.5 s)
    this.rough += (Math.min(1, Math.abs(inp.bowRelVel ?? 0) / 1.4) - this.rough) * (1 - Math.exp(-dtW / 1.5));
    const st = { ...s, pitch: inp.pitch ?? s.pitch ?? 0, seaRough: this.rough };
    const m = this.boat.step(t, st, { camDist: inp.camDist ?? 20 });
    const load = Math.hypot(s.drive ?? 0, s.side ?? 0) / 2000;
    const fx = this.sfx.step(wallT, { pull: inp.pull ?? 0, sheet: inp.sheet ?? null, rudder: inp.rudder ?? 0, steer: inp.steer ?? 0, sog: s.sog ?? 0, load });
    const aws = s.apparentWind?.speed ?? 0, awa = Math.abs(s.apparentWind?.angle ?? 0);
    const earWind = inp.earWind ?? aws, rain = clamp01(inp.rain ?? 0), sogKn = (s.sog ?? 0) / KN;
    const amb = mixAt({ hour: inp.hour ?? 12, windSpeed: earWind, shoreDist: -(inp.shoreDist ?? 400), rain });
    const u = earWind / BEDS.windRefMs, uk = Math.min(u, 1);
    const heelK = 1 + BEDS.heelRush * Math.min(1.4, Math.abs(s.heel ?? 0) / (25 * DEG));
    const pan = Math.max(-BEDS.panMax, Math.min(BEDS.panMax, (inp.pan ?? 0) * BEDS.panMax));
    const head = 0.4 * (0.55 * (1 - (s.mainTopFill ?? s.mainFill ?? 1)) + 0.45 * (1 - (s.jibTopFill ?? s.jibFill ?? 1)));
    const luff = 0.55 * (1 - (s.mainFill ?? 1)) + 0.45 * (1 - (s.jibFill ?? 1));
    const headK = luff > 1e-3 ? clamp01((head / luff - 0.4) / 0.6) : 0;
    const g = m.gains;
    const still = BEDS.lapStill * (1 - smoothstep(0.2, 1.5, sogKn)) * (0.6 + 0.4 * smoothstep(0, 6, earWind)) * (1 + 0.6 * this.rough);
    const events = [...m.events];
    for (const e of fx.events) if (e.kind === 'click' || e.kind === 'sheetCreak') events.push(e);
    return {
      t, rough: this.rough, load: m.load, phase: m.phase,
      gains: {
        // the ambience (v1: on the master, the "sound" switch): the wind at the listener as one voice (v1's two beds, equal power)
        wind: Math.hypot(amb.gains.wind_light, amb.gains.wind_strong), lap: amb.gains.lake_lap, rain: amb.gains.rain_water,
        birds: amb.gains.birds_dawn, loon: amb.gains.loon,   // S1a: v1's dawn chorus and loons (mixAt's windows and levels)
        // the boat (v1: × BUS_LEVEL × distance on the effects bus)
        bus: g.bus, chuckle: g.chuckle, rush: g.rush * heelK, roar: g.roar, hiss: g.hiss, still,
        hum: g.hum, note: g.note, flutter: g.flutter, flog: g.flog, rig: g.rig, whistle: g.whistle,
        deck: BEDS.deckRain * Math.sqrt(rain) * smoothstep(60, 15, inp.camDist ?? 20) ** 0.5,
        run: fx.gains.run,
      },
      hz: {
        wind: 300 + 830 * u ** 1.1, windShelfDb: lerp(-4, 0, smoothstep(4, 14, earWind)), lap: amb.lakeLowpassHz,
        hull: m.hz.hull, roar: 1300, dist: m.hz.dist, whistle: m.hz.whistle, whistleCs: 760 + 950 * uk, note: m.hz.note,
        flutter: lerp(900, 1900, headK), flog: lerp(520, 900, smoothstep(4, 12, aws)),
      },
      rate: {
        buffet: BEDS.buffetRate[0] + BEDS.buffetRate[1] * earWind, buffetDepth: BEDS.buffet[0] + BEDS.buffet[1] * uk,
        rush: m.rate.rush,
        flutter: (BEDS.flutterHz[0] + BEDS.flutterHz[1] * aws) * (1 + 0.3 * headK),
        flog: (BEDS.flogHz[0] + BEDS.flogHz[1] * aws) * (m.rate.flog ?? 1),
        run: fx.rate.run,
        // the near-still lap's rhythm (Hz): the short chop's period against a quiet hull
        lap: 0.8 + 0.12 * Math.min(8, earWind),
      },
      pan: { wind: pan, rig: 0.6 * pan, rain: 0 },
      awa, aws, earWind, events,
    };
  }
  // The hybrid's frame (the live page, the offline render): the code wind's share only, without this mixer's own BoatMix and
  // SfxMix (v1's engines in recorded.js run theirs: running both doubled the main thread's work). The sea the hull feels, the
  // lake's ambience gains (the lap and the rain loops), the wind's voice; then withBoat() takes the rig's gains, the whistle's
  // pitch, the bus and the distance from v1's own boat mix (createBoatAudio's update returns it).
  stepWind(inp) {
    const s = inp.state ?? {}, wallT = inp.wallT ?? inp.t ?? 0;
    const dtW = this.lastWall === null ? 0 : Math.min(0.1, Math.max(0, wallT - this.lastWall));
    this.lastWall = wallT;
    this.rough += (Math.min(1, Math.abs(inp.bowRelVel ?? 0) / 1.4) - this.rough) * (1 - Math.exp(-dtW / 1.5));
    const aws = s.apparentWind?.speed ?? 0, earWind = inp.earWind ?? aws, rain = clamp01(inp.rain ?? 0);
    const amb = mixAt({ hour: inp.hour ?? 12, windSpeed: earWind, shoreDist: -(inp.shoreDist ?? 400), rain });
    const u = earWind / BEDS.windRefMs, uk = Math.min(u, 1);
    const pan = Math.max(-BEDS.panMax, Math.min(BEDS.panMax, (inp.pan ?? 0) * BEDS.panMax));
    const o = this.windOut ??= { gains: {}, hz: {}, rate: {}, pan: {}, events: [] };
    o.t = inp.t ?? 0; o.rough = this.rough; o.earWind = earWind; o.aws = aws;
    o.gains.wind = Math.hypot(amb.gains.wind_light, amb.gains.wind_strong); o.gains.lap = amb.gains.lake_lap; o.gains.rain = amb.gains.rain_water; o.gains.birds = amb.gains.birds_dawn; o.gains.loon = amb.gains.loon;
    o.hz.wind = 300 + 830 * u ** 1.1; o.hz.windShelfDb = lerp(-4, 0, smoothstep(4, 14, earWind)); o.hz.lap = amb.lakeLowpassHz; o.hz.whistleCs = 760 + 950 * uk;
    o.rate.buffet = BEDS.buffetRate[0] + BEDS.buffetRate[1] * earWind; o.rate.buffetDepth = BEDS.buffet[0] + BEDS.buffet[1] * uk;
    o.pan.wind = pan; o.pan.rig = 0.6 * pan;
    if (inp.kdRoll > 0) knockdownWind(o, inp.kdRoll);   // K2: the gust's roar while she is knocked down (v2/audio/knockdownSound.js)
    return o;
  }
  withBoat(o, b) {
    o.gains.bus = b?.gains.bus ?? 0; o.gains.rig = b?.gains.rig ?? 0; o.gains.whistle = b?.gains.whistle ?? 0;
    o.hz.whistle = b?.hz.whistle ?? 1900; o.hz.dist = b?.hz.dist ?? 16000;
    o.events = b?.events ?? [];
    return o;
  }
}
