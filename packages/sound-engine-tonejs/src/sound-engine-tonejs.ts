import type {MoscScoreMs, MoscNoteMs, MoscItemMs, MoscParamMs, MoscEndMs} from '@xenpaper/mosc';
import {SoundEngine, scoreToMs} from '@xenpaper/mosc';
import * as Tone from 'tone';

//
// utils
//

function flatMap<I,O>(arr: I[], mapper: (item: I) => O[]): O[] {
    const out: O[] = [];
    arr.forEach(item => out.push(...mapper(item)));
    return out;
}

//
// consts
//

const OSC_VOLUME = -18;

export const OSC_BASE_TYPES = [
    'sine',
    'sawtooth',
    'square',
    'triangle'
];

export let OSC_PARTIAL_SUFFIXES: string[] = [];
for(let i = 1; i < 33; i++) {
    OSC_PARTIAL_SUFFIXES.push(`${i}`);
}

export const OSC_TYPES_EXPANDED = flatMap(OSC_BASE_TYPES, base => [
    base,
    `fm${base}`,
    `am${base}`,
    `fat${base}`
]);

export const OSC_TYPES = flatMap(OSC_TYPES_EXPANDED, type => [
    type,
    ...OSC_PARTIAL_SUFFIXES.map(suffix => `${type}${suffix}`)
]);

const OSC_TYPES_SET = new Set(OSC_TYPES);

class VoicePool<T> {
    private voices: T[] = [];
    private lastStartTimes: number[] = [];
    private createVoice: () => T;

    constructor(createVoice: () => T) {
        this.createVoice = createVoice;
    }

    getVoice(time: number): T {
        for(let i = 0; i < this.voices.length; i++) {
            if(this.lastStartTimes[i] < time) {
                this.lastStartTimes[i] = time;
                return this.voices[i];
            }
        }
        const newVoice = this.createVoice();
        this.voices.push(newVoice);
        this.lastStartTimes.push(time);
        return newVoice;
    }

    releaseAll(): void {
        this.voices.forEach((v: any) => {
            if(!v) return;
            try {
                if(typeof v.releaseAll === 'function') v.releaseAll();
                if(typeof v.triggerRelease === 'function') v.triggerRelease();
                if(v.membrane && typeof v.membrane.triggerRelease === 'function') v.membrane.triggerRelease();
                if(v.noise && typeof v.noise.triggerRelease === 'function') v.noise.triggerRelease();
            } catch {
                // ignore
            }
        });
    }

    resetTimeTracking(): void {
        for(let i = 0; i < this.lastStartTimes.length; i++) {
            this.lastStartTimes[i] = -1;
        }
    }
}

export class TonejsPercussionKit {
    output: Tone.Volume;
    private pools = new Map<string, VoicePool<any>>();

    constructor() {
        this.output = new Tone.Volume(0).chain(Tone.Destination);
    }

    setVolume(db: number): void {
        this.output.volume.value = db;
    }

    private getPool<T>(name: string, createVoice: () => T): VoicePool<T> {
        let pool = this.pools.get(name);
        if(!pool) {
            pool = new VoicePool(createVoice);
            this.pools.set(name, pool);
        }
        return pool;
    }

    private getKickPool(): VoicePool<Tone.MembraneSynth> {
        return this.getPool('kick', () => {
            const synth = new Tone.MembraneSynth({
                pitchDecay: 0.05,
                octaves: 6,
                oscillator: { type: 'sine' },
                envelope: {
                    attack: 0.001,
                    decay: 0.38,
                    sustain: 0.01,
                    release: 0.38
                }
            }).chain(this.output);
            synth.volume.value = -3;
            return synth;
        });
    }

    private getSnarePool(): VoicePool<{ membrane: Tone.MembraneSynth; noise: Tone.NoiseSynth }> {
        return this.getPool('snare', () => {
            const membrane = new Tone.MembraneSynth({
                pitchDecay: 0.01,
                octaves: 2,
                oscillator: { type: 'triangle' },
                envelope: { attack: 0.001, decay: 0.14, sustain: 0, release: 0.14 }
            }).chain(this.output);
            membrane.volume.value = -8;

            const noise = new Tone.NoiseSynth({
                noise: { type: 'pink' },
                envelope: { attack: 0.001, decay: 0.18, sustain: 0 }
            }).chain(this.output);
            noise.volume.value = -11;

            return { membrane, noise };
        });
    }

    private getHihatPool(): VoicePool<Tone.MetalSynth> {
        return this.getPool('hihat', () => {
            const synth = new Tone.MetalSynth({
                envelope: { attack: 0.001, decay: 0.06, release: 0.05 },
                harmonicity: 5.1,
                modulationIndex: 32,
                resonance: 4000,
                octaves: 1.5
            }).chain(this.output);
            synth.frequency.value = 200;
            synth.volume.value = -16;
            return synth;
        });
    }

    private getOpenhatPool(): VoicePool<Tone.MetalSynth> {
        return this.getPool('openhat', () => {
            const synth = new Tone.MetalSynth({
                envelope: { attack: 0.001, decay: 0.35, release: 0.35 },
                harmonicity: 5.1,
                modulationIndex: 32,
                resonance: 4000,
                octaves: 1.5
            }).chain(this.output);
            synth.frequency.value = 200;
            synth.volume.value = -16;
            return synth;
        });
    }

    private getClapPool(): VoicePool<Tone.NoiseSynth> {
        return this.getPool('clap', () => {
            const synth = new Tone.NoiseSynth({
                noise: { type: 'pink' },
                envelope: { attack: 0.005, decay: 0.22, sustain: 0 }
            }).chain(this.output);
            synth.volume.value = -10;
            return synth;
        });
    }

    private getLoTomPool(): VoicePool<Tone.MembraneSynth> {
        return this.getPool('lotom', () => {
            const synth = new Tone.MembraneSynth({
                pitchDecay: 0.05,
                octaves: 4,
                oscillator: { type: 'sine' },
                envelope: { attack: 0.001, decay: 0.35, sustain: 0.01, release: 0.35 }
            }).chain(this.output);
            synth.volume.value = -5;
            return synth;
        });
    }

    private getMidTomPool(): VoicePool<Tone.MembraneSynth> {
        return this.getPool('midtom', () => {
            const synth = new Tone.MembraneSynth({
                pitchDecay: 0.05,
                octaves: 4,
                oscillator: { type: 'sine' },
                envelope: { attack: 0.001, decay: 0.35, sustain: 0.01, release: 0.35 }
            }).chain(this.output);
            synth.volume.value = -5;
            return synth;
        });
    }

    private getHiTomPool(): VoicePool<Tone.MembraneSynth> {
        return this.getPool('hitom', () => {
            const synth = new Tone.MembraneSynth({
                pitchDecay: 0.05,
                octaves: 4,
                oscillator: { type: 'sine' },
                envelope: { attack: 0.001, decay: 0.35, sustain: 0.01, release: 0.35 }
            }).chain(this.output);
            synth.volume.value = -5;
            return synth;
        });
    }

    private getCrashPool(): VoicePool<Tone.MetalSynth> {
        return this.getPool('crash', () => {
            const synth = new Tone.MetalSynth({
                envelope: { attack: 0.002, decay: 1.2, release: 1.2 },
                harmonicity: 5.1,
                modulationIndex: 40,
                resonance: 5000,
                octaves: 2
            }).chain(this.output);
            synth.frequency.value = 260;
            synth.volume.value = -14;
            return synth;
        });
    }

    private getRidePool(): VoicePool<Tone.MetalSynth> {
        return this.getPool('ride', () => {
            const synth = new Tone.MetalSynth({
                envelope: { attack: 0.001, decay: 0.7, release: 0.7 },
                harmonicity: 4.2,
                modulationIndex: 20,
                resonance: 3000,
                octaves: 1.2
            }).chain(this.output);
            synth.frequency.value = 450;
            synth.volume.value = -16;
            return synth;
        });
    }

    private getRimPool(): VoicePool<Tone.MembraneSynth> {
        return this.getPool('rim', () => {
            const synth = new Tone.MembraneSynth({
                pitchDecay: 0.01,
                octaves: 1,
                oscillator: { type: 'triangle' },
                envelope: { attack: 0.001, decay: 0.04, sustain: 0, release: 0.04 }
            }).chain(this.output);
            synth.volume.value = -6;
            return synth;
        });
    }

    private getCowbellPool(): VoicePool<Tone.MetalSynth> {
        return this.getPool('cowbell', () => {
            const synth = new Tone.MetalSynth({
                envelope: { attack: 0.001, decay: 0.22, release: 0.22 },
                harmonicity: 1.48,
                modulationIndex: 8,
                resonance: 2000,
                octaves: 0.5
            }).chain(this.output);
            synth.frequency.value = 540;
            synth.volume.value = -13;
            return synth;
        });
    }

    private getShakerPool(): VoicePool<Tone.NoiseSynth> {
        return this.getPool('shaker', () => {
            const synth = new Tone.NoiseSynth({
                noise: { type: 'white' },
                envelope: { attack: 0.012, decay: 0.07, sustain: 0 }
            }).chain(this.output);
            synth.volume.value = -17;
            return synth;
        });
    }

    trigger(sound: string, durationSec: number, time: number, hz?: number): void {
        switch(sound) {
            case 'kick': {
                const synth = this.getKickPool().getVoice(time);
                synth.triggerAttackRelease(hz || 55, Math.min(durationSec, 0.4), time);
                break;
            }
            case 'snare': {
                const snare = this.getSnarePool().getVoice(time);
                snare.membrane.triggerAttackRelease(hz || 185, 0.12, time);
                snare.noise.triggerAttackRelease(0.16, time);
                break;
            }
            case 'hihat': {
                const synth = this.getHihatPool().getVoice(time);
                synth.triggerAttackRelease(hz || 200, 0.05, time);
                break;
            }
            case 'openhat': {
                const synth = this.getOpenhatPool().getVoice(time);
                synth.triggerAttackRelease(hz || 200, Math.min(Math.max(durationSec, 0.25), 0.5), time);
                break;
            }
            case 'clap': {
                const synth = this.getClapPool().getVoice(time);
                synth.triggerAttackRelease(0.18, time);
                break;
            }
            case 'lotom': {
                const synth = this.getLoTomPool().getVoice(time);
                synth.triggerAttackRelease(hz || 85, Math.min(durationSec, 0.35), time);
                break;
            }
            case 'midtom':
            case 'tom': {
                const synth = this.getMidTomPool().getVoice(time);
                synth.triggerAttackRelease(hz || 130, Math.min(durationSec, 0.35), time);
                break;
            }
            case 'hitom': {
                const synth = this.getHiTomPool().getVoice(time);
                synth.triggerAttackRelease(hz || 196, Math.min(durationSec, 0.35), time);
                break;
            }
            case 'crash': {
                const synth = this.getCrashPool().getVoice(time);
                synth.triggerAttackRelease(hz || 260, Math.min(Math.max(durationSec, 0.8), 1.5), time);
                break;
            }
            case 'ride': {
                const synth = this.getRidePool().getVoice(time);
                synth.triggerAttackRelease(hz || 450, Math.min(Math.max(durationSec, 0.5), 0.9), time);
                break;
            }
            case 'rim': {
                const synth = this.getRimPool().getVoice(time);
                synth.triggerAttackRelease(hz || 450, 0.04, time);
                break;
            }
            case 'cowbell': {
                const synth = this.getCowbellPool().getVoice(time);
                synth.triggerAttackRelease(hz || 540, 0.22, time);
                break;
            }
            case 'shaker': {
                const synth = this.getShakerPool().getVoice(time);
                synth.triggerAttackRelease(0.07, time);
                break;
            }
            default: {
                const synth = this.getKickPool().getVoice(time);
                synth.triggerAttackRelease(hz || 55, Math.min(durationSec, 0.4), time);
                break;
            }
        }
    }

    releaseAll(): void {
        this.pools.forEach(pool => pool.releaseAll());
    }

    resetTimeTracking(): void {
        this.pools.forEach(pool => pool.resetTimeTracking());
    }
}

export class SoundEngineTonejs extends SoundEngine {

    _started = false;
    _endMs = 0;
    _loopEndMs = 0;
    _scoreDirty = false;
    _activeNoteEvents = new Set<MoscItemMs>();
    _mutedTracks = new Set<string>();
    _trackBaseDb = new Map<string, number>();

    synth = new Tone.PolySynth(Tone.Synth, {
        oscillator: {
            type: 'sine',
            volume: OSC_VOLUME
        },
        envelope: {
            attack: 0.01,
            sustain: 0.5,
            decay: 0.25,
            release: 0.5
        }
    }).chain(Tone.Destination);

    trackSynths = new Map<string, Tone.PolySynth>();
    percussionKits = new Map<string, TonejsPercussionKit>();

    getSynth(track?: string): Tone.PolySynth {
        if(!track) {
            return this.synth;
        }
        let synth = this.trackSynths.get(track);
        if(!synth) {
            synth = new Tone.PolySynth(Tone.Synth, {
                oscillator: {
                    type: 'sine',
                    volume: OSC_VOLUME
                },
                envelope: {
                    attack: 0.01,
                    sustain: 0.5,
                    decay: 0.25,
                    release: 0.5
                }
            }).chain(Tone.Destination);
            this.trackSynths.set(track, synth);
        }
        return synth;
    }

    getPercussionKit(track?: string): TonejsPercussionKit {
        const key = track ?? '';
        let kit = this.percussionKits.get(key);
        if(!kit) {
            kit = new TonejsPercussionKit();
            this.percussionKits.set(key, kit);
            const db = this._mutedTracks.has(key) ? -Infinity : (this._trackBaseDb.get(key) ?? 0);
            kit.setVolume(db);
        }
        return kit;
    }

    playing(): boolean {
        return Tone.Transport.state === 'started';
    }

    looping(): boolean {
        return Tone.Transport.loop;
    }

    position(): number {
        return Tone.Transport.seconds * 1000;
    }

    endPosition(): number {
        return this._endMs;
    }

    async start(): Promise<void> {
        if(!this._started) {
            await Tone.start();
            this._started = true;

            const onEnd = () => this._releaseAll();

            Tone.Transport.on('stop', onEnd);
            Tone.Transport.on('loop', onEnd);
        }
    }

    async play(): Promise<void> {
        await this.start();
        if(this._scoreDirty) {
            this._scheduleScore();
            // scheduling resets synth volumes, so restore params for the current position
            this._applyParamsUpTo(this.position());
        }
        Tone.Transport.start();
    }

    async pause(): Promise<void> {
        await this.start();
        Tone.Transport.stop();
    }

    async gotoMs(ms: number): Promise<void> {
        // silence anything currently sounding so seeking mid-playback doesn't leave hanging notes
        this._releaseAll();
        this._applyParamsUpTo(ms);
        Tone.Transport.seconds = ms * 0.001;
    }

    // params (osc/env/vol) scheduled before a seek point would otherwise be skipped
    _applyParamsUpTo(ms: number): void {
        this.scoreMs?.sequence.forEach((item: MoscItemMs): void => {
            if(item.type === 'PARAM_MS' && item.ms <= ms) {
                this._applyParam(item as MoscParamMs);
            }
        });
    }

    _releaseAll(): void {
        this.synth.releaseAll();
        this.trackSynths.forEach(s => s.releaseAll());
        this.percussionKits.forEach(kit => kit.releaseAll());
        this._activeNoteEvents.forEach(noteMs => {
            this._triggerEvent('note', noteMs, false);
        });
        this._activeNoteEvents.clear();
    }

    _applyParam(paramMs: MoscParamMs): void {
        const targetSynths = paramMs.track
            ? [this.getSynth(paramMs.track)]
            : [this.synth, ...Array.from(this.trackSynths.values())];
        if(paramMs.value.type === 'osc' && OSC_TYPES_SET.has(paramMs.value.osc)) {
            targetSynths.forEach(s => s.set({
                oscillator: {
                    type: paramMs.value.osc,
                    volume: OSC_VOLUME
                }
            }));
        }
        if(paramMs.value.type === 'env') {
            targetSynths.forEach(s => s.set({
                envelope: {
                    attack: paramMs.value.a,
                    decay: paramMs.value.d,
                    sustain: paramMs.value.s,
                    release: paramMs.value.r
                }
            }));
        }
        if(paramMs.value.type === 'vol') {
            const db = paramMs.value.vol <= 0
                ? -Infinity
                : 20 * Math.log10(paramMs.value.vol);
            if(paramMs.track) {
                this._trackBaseDb.set(paramMs.track, db);
                this._syncTrackVolume(paramMs.track);
            } else {
                this._trackBaseDb.set('', db);
                this._syncTrackVolume('');
                this.trackSynths.forEach((_, t) => {
                    this._trackBaseDb.set(t, db);
                    this._syncTrackVolume(t);
                });
            }
        }
    }

    _syncTrackVolume(track: string): void {
        const s = this.getSynth(track || undefined);
        const muted = this._mutedTracks.has(track);
        const db = muted ? -Infinity : (this._trackBaseDb.get(track) ?? 0);
        s.volume.value = db;
        if(muted) {
            s.releaseAll();
        }
        const kit = this.percussionKits.get(track);
        if(kit) {
            kit.setVolume(db);
            if(muted) {
                kit.releaseAll();
            }
        }
    }

    setMutedTracks(tracks: Set<string>): void {
        this._mutedTracks = new Set(tracks);
        this._syncTrackVolume('');
        this.trackSynths.forEach((_, t) => this._syncTrackVolume(t));
        this.percussionKits.forEach((_, t) => this._syncTrackVolume(t));
        this._activeNoteEvents.forEach(item => {
            const noteMs = item as MoscNoteMs;
            if(this._mutedTracks.has(noteMs.track ?? '')) {
                this._activeNoteEvents.delete(noteMs);
                this._triggerEvent('note', noteMs, false);
            }
        });
    }

    setLoop(loop: boolean, startMs: number = 0, endMs: number = 0): void {
        this.setLoopActive(loop);
        this.setLoopStart(startMs);
        this.setLoopEnd(endMs);
    }

    setLoopActive(loop: boolean = true): void {
        Tone.Transport.loop = loop;
    }

    setLoopStart(ms: number = 0): void {
        Tone.Transport.loopStart = ms * 0.001;
    }

    setLoopEnd(ms: number = 0): void {
        this._loopEndMs = ms;
        Tone.Transport.loopEnd = (ms === 0 ? this._endMs : ms) * 0.001;
    }

    async setScore(scoreMs: MoscScoreMs): Promise<void> {
        this.scoreMs = scoreMs;
        this._endMs = scoreMs.lengthMs;
        if(this._loopEndMs === 0) {
            this.setLoopEnd(0);
        }

        if(this.playing()) {
            this._scheduleScore();
            this._applyParamsUpTo(this.position());
        } else {
            this._scoreDirty = true;
        }
    }

    _scheduleScore(): void {
        this._scoreDirty = false;
        if(!this.scoreMs) return;

        // clear all previous notes from tone transport
        const transportAny = Tone.Transport as any;
        if(transportAny._timeline && Array.isArray(transportAny._timeline._timeline)) {
            transportAny._timeline._timeline.forEach((ev: any) => ev.dispose && ev.dispose());
            transportAny._timeline._timeline = [];
            transportAny._scheduledEvents = {};
        }
        Tone.Transport.cancel();

        // ensure track synths exist for all tracks in score and reset volumes
        this._trackBaseDb.clear();
        this.scoreMs.sequence.forEach((item: MoscItemMs): void => {
            if((item.type === 'NOTE_MS' || item.type === 'PARAM_MS') && item.track) {
                this.getSynth(item.track);
                if(item.type === 'NOTE_MS' && (item as MoscNoteMs).perc) {
                    this.getPercussionKit(item.track);
                }
            }
        });
        this._syncTrackVolume('');
        this.trackSynths.forEach((_, t) => {
            this._syncTrackVolume(t);
        });
        this.percussionKits.forEach((kit, t) => {
            this._syncTrackVolume(t);
            kit.resetTimeTracking();
        });

        const eventsBySec = new Map<number, Array<(time: number) => void>>();
        const addEvent = (sec: number, fn: (time: number) => void): void => {
            let list = eventsBySec.get(sec);
            if(!list) {
                list = [];
                eventsBySec.set(sec, list);
            }
            list.push(fn);
        };

        // group all new notes and events by timestamp so Tone.Transport schedules in O(1) sorted order
        this.scoreMs.sequence.forEach((item: MoscItemMs): void => {
            if(item.type === 'NOTE_MS') {
                const noteMs = item as MoscNoteMs;
                const durationSec = (noteMs.msEnd - noteMs.ms) * 0.001;
                addEvent(noteMs.ms * 0.001 + 0.1, (time: number) => {
                    if(this._mutedTracks.has(noteMs.track ?? '')) return;
                    if(noteMs.perc) {
                        const kit = this.getPercussionKit(noteMs.track);
                        kit.trigger(noteMs.perc, durationSec, time, noteMs.hz);
                    } else {
                        const targetSynth = this.getSynth(noteMs.track);
                        targetSynth.triggerAttackRelease(
                            noteMs.hz,
                            durationSec,
                            time
                        );
                    }
                    this._activeNoteEvents.add(noteMs);
                    this._triggerEvent('note', noteMs, true);
                });

                addEvent(noteMs.msEnd * 0.001 + 0.1, () => {
                    if(this._activeNoteEvents.delete(noteMs)) {
                        this._triggerEvent('note', noteMs, false);
                    }
                });

                return;
            }

            if(item.type === 'PARAM_MS') {
                const paramMs = item as MoscParamMs;
                addEvent(paramMs.ms * 0.001, () => this._applyParam(paramMs));

                return;
            }

            if(item.type === 'END_MS') {
                this._endMs = (item as MoscEndMs).ms;
                if(this._loopEndMs === 0) {
                    this.setLoopEnd(0);
                }

                addEvent(this._endMs * 0.001, () => {
                    if(Tone.Transport.loop) return;

                    Tone.Transport.stop();
                    this._triggerEvent('end', undefined);
                });

                return;
            }

            // @ts-ignore
            throw new Error(`Unexpected item type ${item.type} encountered`);
        });

        const sortedTimes = Array.from(eventsBySec.keys()).sort((a, b) => a - b);
        sortedTimes.forEach((sec) => {
            const callbacks = eventsBySec.get(sec)!;
            if(callbacks.length === 1) {
                Tone.Transport.schedule(callbacks[0], sec);
            } else {
                Tone.Transport.schedule((time: number) => {
                    for(let i = 0; i < callbacks.length; i++) {
                        callbacks[i](time);
                    }
                }, sec);
            }
        });
    }
}
