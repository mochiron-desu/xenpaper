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
        s.volume.value = muted ? -Infinity : (this._trackBaseDb.get(track) ?? 0);
        if(muted) {
            s.releaseAll();
        }
    }

    setMutedTracks(tracks: Set<string>): void {
        this._mutedTracks = new Set(tracks);
        this._syncTrackVolume('');
        this.trackSynths.forEach((_, t) => this._syncTrackVolume(t));
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
            }
        });
        this._syncTrackVolume('');
        this.trackSynths.forEach((_, t) => {
            this._syncTrackVolume(t);
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
                const targetSynth = this.getSynth(noteMs.track);
                const durationSec = (noteMs.msEnd - noteMs.ms) * 0.001;
                addEvent(noteMs.ms * 0.001 + 0.1, (time: number) => {
                    if(this._mutedTracks.has(noteMs.track ?? '')) return;
                    targetSynth.triggerAttackRelease(
                        noteMs.hz,
                        durationSec,
                        time
                    );
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
