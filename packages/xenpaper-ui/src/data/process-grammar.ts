import type {
    XenpaperAST,
    SetScaleType,
    NoteType,
    ChordType,
    RatioChordType,
    TailType,
    PitchType,
    PitchRatioType,
    PitchCentsType,
    PitchHzType,
    PitchOctaveDivisionType,
    PitchDegreeType,
    PitchGroupScaleType,
    EdoScaleType,
    RatioChordScaleType,
    RatioChordPitchType,
    PercussionType,
    PercussionNoteType,
    HoldType,
    RestType,
    SetterGroupType,
    SetterType,
    SetSubdivisionType,
    SetBpmType,
    SetBmsType,
    SetRootType,
    SetOscType,
    SetEnvType,
    SetRulerRangeType,
    SetTrackType,
    SetVolumeType,
    SetPrimesType,
    SetInstType,
    CommentType,
    DelimiterType,
} from "./grammar";

import type {
    MoscScore,
    MoscItem,
    MoscNote,
    MoscNoteMs,
    MoscTempo,
    MoscParam,
    MoscEnd,
} from "@xenpaper/mosc";

import {
    centsToRatio,
    octaveDivisionToRatio,
    timeToMs,
    ratioToCents,
} from "@xenpaper/mosc";

//
// utils
//

const limit = (name: string, value: number, min: number, max: number): void => {
    if (value < min || value > max) {
        throw new Error(
            `${name} must be between ${min} and ${max}, got ${value}`
        );
    }
};

//
// pitch math
//

const LIST_OF_PRIMES: number[] = [
    2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71,
    73, 79, 83, 89, 97, 101, 103, 107, 109, 113, 127, 131, 137, 139, 149, 151,
    157, 163, 167, 173, 179, 181, 191, 193, 197, 199, 211, 223, 227, 229, 233,
    239, 241, 251, 257, 263, 269, 271, 277, 281, 283, 293, 307, 311, 313, 317,
    331, 337, 347, 349, 353, 359, 367, 373, 379, 383, 389, 397, 401, 409, 419,
    421, 431, 433, 439, 443, 449, 457, 461, 463, 467, 479, 487, 491, 499, 503,
    509, 521, 523, 541, 547, 557, 563, 569, 571, 577, 587, 593, 599, 601, 607,
    613, 617, 619, 631, 641, 643, 647, 653, 659, 661, 673, 677, 683, 691, 701,
    709, 719, 727, 733, 739, 743, 751, 757, 761, 769, 773, 787, 797, 809, 811,
    821, 823, 827, 829, 839, 853, 857, 859, 863, 877, 881, 883, 887, 907, 911,
    919, 929, 937, 941, 947, 953, 967, 971, 977, 983, 991, 997,
];

const primeFactorize = (n: number): number[] | null => {
    const factors: number[] = [];
    LIST_OF_PRIMES.every((p) => {
        let power = 0;
        while (n % p === 0) {
            power++;
            n /= p;
        }
        factors.push(power);
        return n > 1;
    });
    if (n > 1) {
        return null;
    }
    return factors;
};

const realizeRatio = (num: number, denom: number, context: Context): number => {
    if (num === 0 || denom === 0) {
        throw new Error(
            `Invalid ratio: ${num}/${denom}. Numerator/denominator cannot be 0.`
        );
    }
    if (!context.primesTuning || context.primesTuning.length === 0) {
        return num / denom;
    }
    const numFactors = primeFactorize(num);
    const denomFactors = primeFactorize(denom);
    if (numFactors === null || denomFactors === null) {
        return num / denom;
    }
    let ratio = 1.0;
    numFactors.forEach((power, i) => {
        const base =
            context.primesTuning.length > i
                ? context.primesTuning[i]
                : LIST_OF_PRIMES[i];
        ratio *= Math.pow(base, power);
    });
    denomFactors.forEach((power, i) => {
        const base =
            context.primesTuning.length > i
                ? context.primesTuning[i]
                : LIST_OF_PRIMES[i];
        ratio /= Math.pow(base, power);
    });
    return ratio;
};

export const pitchToRatio = (pitch: PitchType, context: Context): number => {
    const { scale, octaveSize } = context;
    limit("Equave size", octaveSize, -20, 20);

    const { type } = pitch.value;
    const octaveMulti = Math.pow(octaveSize, pitch?.octave?.octave || 0);

    if (type === "PitchRatio") {
        const { numerator, denominator } = pitch.value as PitchRatioType;
        const ratio = realizeRatio(numerator, denominator, context);
        limit("Pitch ratio", ratio, 0, 100);
        return ratio * octaveMulti;
    }

    if (type === "PitchCents") {
        const { cents } = pitch.value as PitchCentsType;
        limit("Cents", cents, -12000, 12000);
        return centsToRatio(cents) * octaveMulti;
    }

    if (type === "PitchOctaveDivision") {
        const { numerator, denominator, octaveSize } =
            pitch.value as PitchOctaveDivisionType;
        return (
            octaveDivisionToRatio(numerator, denominator, octaveSize) *
            octaveMulti
        );
    }

    if (type === "PitchDegree") {
        const { degree } = pitch.value as PitchDegreeType;
        return pitchDegreeToRatio(degree, scale, octaveSize) * octaveMulti;
    }

    if (type === "PitchHz") {
        const { hz } = pitch.value as PitchHzType;
        limit("Hz", hz, 0, 20000);
        return (hz / context.rootHz) * octaveMulti;
    }

    throw new Error(`Unknown pitch type "${type}"`);
};

const edoToRatios = (edoSize: number, octaveSize: number): number[] => {
    const ratios: number[] = [];
    for (let i = 0; i < edoSize; i++) {
        ratios.push(octaveDivisionToRatio(i, edoSize, octaveSize));
    }
    return ratios;
};

const pitchDegreeWrap = (degree: number, scale: number[]): [number, number] => {
    limit("Scale degree", degree, -1000, 1000);

    const steps = scale.length;
    if (steps === 0) {
        return [0, 0];
    }

    const octave = Math.floor(degree / steps);
    const wrappedDegree = degree - octave * steps;

    return [wrappedDegree, octave];
};

const pitchDegreeToRatio = (
    degree: number,
    scale: number[],
    octaveSize: number
): number => {
    limit("Equave size", octaveSize, -20, 20);

    if (scale.length === 0) {
        return 1;
    }

    const [wrappedDegree, octave] = pitchDegreeWrap(degree, scale);
    return scale[wrappedDegree] * Math.pow(octaveSize, octave);
};

const pitchToHz = (pitch: PitchType, context: Context): number => {
    if (pitch.value.type === "PitchHz") {
        const octaveMulti = Math.pow(
            context.octaveSize,
            pitch?.octave?.octave || 0
        );
        const hz = (pitch.value as PitchHzType).hz * octaveMulti;
        limit("Hz", hz, 0, 20000);
        return hz;
    }
    return pitchToRatio(pitch, context) * context.rootHz;
};

const tailToTime = (
    tail: TailType | undefined,
    context: Context
): { time: number; timeEnd: number } => {
    const time = context.time;

    const duration =
        tail && tail.type === "Hold" ? (tail as HoldType).length + 1 : 1;

    context.time += duration * context.subdivision;
    const timeEnd = context.time;

    return {
        time,
        timeEnd,
    };
};

//
// labels
//

const ratioWrap = (ratio: number, octaveSize: number): number => {
    if (
        octaveSize <= 0 ||
        octaveSize === 1 ||
        ratio <= 0 ||
        !Number.isFinite(ratio) ||
        !Number.isFinite(octaveSize)
    ) {
        return ratio;
    }
    const ratioInEquaves = Math.log2(ratio) / Math.log2(octaveSize);
    if (ratioInEquaves === 0 || ratioInEquaves === 1) {
        return ratio;
    }
    const k =
        ratioInEquaves > 1
            ? Math.ceil(ratioInEquaves) - 1
            : ratioInEquaves < 0
            ? Math.floor(ratioInEquaves)
            : 0;
    return ratio * Math.pow(octaveSize, -k);
};

const ratioToCentsLabel = (ratio: number, octaveSize: number): string => {
    return `${ratioToCents(ratioWrap(ratio, octaveSize)).toFixed(1)}c`;
};

export const pitchToLabel = (pitch: PitchType, context: Context): string => {
    const { type } = pitch.value;

    if (type === "PitchHz") {
        const { hz } = pitch.value as PitchHzType;
        return `${hz}Hz`;
    }

    if (type === "PitchCents") {
        const { cents } = pitch.value as PitchCentsType;
        return `${cents}c`;
    }

    const centsLabel = ratioToCentsLabel(
        pitchToRatio(pitch, context),
        context.octaveSize
    );

    if (type === "PitchRatio") {
        const { numerator, denominator } = pitch.value as PitchRatioType;
        return `${numerator}/${denominator}  ${centsLabel}`;
    }

    if (type === "PitchOctaveDivision") {
        const { numerator, denominator } =
            pitch.value as PitchOctaveDivisionType;
        return `${numerator}\\${denominator}  ${centsLabel}`;
    }

    if (type === "PitchDegree") {
        const { degree } = pitch.value as PitchDegreeType;
        const [wrappedDegree] = pitchDegreeWrap(degree, context.scale);
        return context.scaleLabels[wrappedDegree];
    }

    throw new Error(`Unknown pitch type "${type}"`);
};

const edoToLabels = (
    edoSize: number,
    ratios: number[],
    octaveSize: number
): string[] => {
    const labels: string[] = [];
    for (let i = 0; i < edoSize; i++) {
        const centsLabel = ratioToCentsLabel(ratios[i], octaveSize);
        labels.push(`${i}\\${edoSize}  ${centsLabel}`);
    }
    return labels;
};

//
// converters
//

const ENV_VALUES = [0, 0.003, 0.006, 0.01, 0.033, 0.1, 0.33, 1, 3.3, 10];

export const PERCUSSION_SOUNDS: Record<string, { hz: number; label: string }> = {
    kick: { hz: 55, label: "kick" },
    snare: { hz: 200, label: "snare" },
    hihat: { hz: 8000, label: "hi-hat" },
    openhat: { hz: 8000, label: "open-hat" },
    clap: { hz: 1000, label: "clap" },
    lotom: { hz: 85, label: "low-tom" },
    midtom: { hz: 130, label: "mid-tom" },
    hitom: { hz: 196, label: "high-tom" },
    tom: { hz: 130, label: "tom" },
    crash: { hz: 5000, label: "crash" },
    ride: { hz: 3500, label: "ride" },
    rim: { hz: 450, label: "rim" },
    cowbell: { hz: 540, label: "cowbell" },
    shaker: { hz: 7000, label: "shaker" },
};

export const PERCUSSION_ALIAS_MAP: Record<string, string> = {
    bd: "kick",
    bassdrum: "kick",
    kick: "kick",
    sd: "snare",
    snaredrum: "snare",
    snare: "snare",
    hh: "hihat",
    hat: "hihat",
    closedhat: "hihat",
    ch: "hihat",
    hihat: "hihat",
    oh: "openhat",
    openhihat: "openhat",
    openhat: "openhat",
    cp: "clap",
    handclap: "clap",
    clap: "clap",
    lt: "lotom",
    lotom: "lotom",
    tom1: "lotom",
    mt: "midtom",
    midtom: "midtom",
    tom2: "midtom",
    ht: "hitom",
    hitom: "hitom",
    tom3: "hitom",
    tom: "tom",
    cr: "crash",
    cymbal: "crash",
    crash: "crash",
    rd: "ride",
    ridecymbal: "ride",
    ride: "ride",
    rim: "rim",
    rimshot: "rim",
    click: "rim",
    cb: "cowbell",
    cowbell: "cowbell",
    shaker: "shaker",
};

export const DRUM_DEGREE_MAP: string[] = [
    "kick",
    "snare",
    "hihat",
    "openhat",
    "clap",
    "lotom",
    "hitom",
    "crash",
    "ride",
    "cowbell",
];

type Context = {
    rootHz: number;
    time: number;
    subdivision: number;
    scale: number[];
    scaleLabels: string[];
    octaveSize: number;
    primesTuning: number[];
    instrument?: string;
    track?: string;
};

const times: [number, number][] = [];

const noteToMosc = (note: NoteType, context: Context): MoscNote[] => {
    const timeProps = tailToTime(note.tail, context);

    // mutate ast node to add time
    const arr: [number, number] = [timeProps.time, timeProps.timeEnd];
    times.push(arr);
    note.time = arr;

    if (context.instrument === "drums" && note.pitch.value.type === "PitchDegree") {
        const degree = (note.pitch.value as PitchDegreeType).degree;
        const sound = DRUM_DEGREE_MAP[degree % DRUM_DEGREE_MAP.length] || "kick";
        const def = PERCUSSION_SOUNDS[sound] ?? { hz: 55, label: sound };
        return [
            {
                type: "NOTE_TIME",
                hz: def.hz,
                label: def.label,
                perc: sound,
                ...timeProps,
                ...(context.track !== undefined ? { track: context.track } : {}),
            },
        ];
    }

    const hz = pitchToHz(note.pitch, context);
    const label = pitchToLabel(note.pitch, context);

    return [
        {
            type: "NOTE_TIME",
            hz,
            label,
            ...timeProps,
            ...(context.track !== undefined ? { track: context.track } : {}),
        },
    ];
};

const percussionNoteToMosc = (
    note: PercussionNoteType,
    context: Context
): MoscNote[] => {
    const timeProps = tailToTime(note.tail, context);

    const arr: [number, number] = [timeProps.time, timeProps.timeEnd];
    times.push(arr);
    note.time = arr;

    const rawSound = note.percussion.sound.toLowerCase();
    const sound = PERCUSSION_ALIAS_MAP[rawSound] ?? rawSound;
    const def = PERCUSSION_SOUNDS[sound] ?? { hz: 100, label: sound };

    return [
        {
            type: "NOTE_TIME",
            hz: def.hz,
            label: def.label,
            perc: sound,
            ...timeProps,
            ...(context.track !== undefined ? { track: context.track } : {}),
        },
    ];
};

const chordToMosc = (
    chord: ChordType | RatioChordType,
    context: Context
): MoscNote[] => {
    const { tail, pitches } = chord;
    const timeProps = tailToTime(tail, context);

    // mutate ast node to add time
    const arr: [number, number] = [timeProps.time, timeProps.timeEnd];
    times.push(arr);
    chord.time = arr;

    const pitchTypes: MoscNote[] = pitches
        .filter((pitch): pitch is PitchType => pitch.type === "Pitch")
        .map((pitch: any) => {
            const hz = pitchToHz(pitch as PitchType, context);
            const label = pitchToLabel(pitch as PitchType, context);

            return {
                type: "NOTE_TIME",
                hz,
                label,
                ...timeProps,
                ...(context.track !== undefined ? { track: context.track } : {}),
            };
        });

    const percTypes: MoscNote[] = (pitches as any[])
        .filter((p: any) => p.type === "Percussion")
        .map((perc: any) => {
            const rawSound = perc.sound.toLowerCase();
            const sound = PERCUSSION_ALIAS_MAP[rawSound] ?? rawSound;
            const def = PERCUSSION_SOUNDS[sound] ?? { hz: 100, label: sound };

            return {
                type: "NOTE_TIME" as const,
                hz: def.hz,
                label: def.label,
                perc: sound,
                ...timeProps,
                ...(context.track !== undefined ? { track: context.track } : {}),
            };
        });

    const firstRatioPitch = pitches.find(
        (pitch: any) => pitch.type === "RatioChordPitch"
    ) as RatioChordPitchType | undefined;

    const firstDenominator = (firstRatioPitch as RatioChordPitchType)?.pitch;

    if (firstDenominator <= 0) {
        throw new Error(`Chords cannot contain a ratio of ${firstDenominator}`);
    }

    const ratioPitchTypes: MoscNote[] = [];
    const addRatioPitchType = (numerator: number): void => {
        const ratio = realizeRatio(numerator, firstDenominator, context);
        ratioPitchTypes.push({
            type: "NOTE_TIME",
            hz: ratio * context.rootHz,
            label: `${numerator}/${firstDenominator}  ${ratioToCentsLabel(
                ratio,
                context.octaveSize
            )}`,
            ...timeProps,
            ...(context.track !== undefined ? { track: context.track } : {}),
        });
    };

    let colons = 0;
    let lastNumerator = 1;
    pitches.forEach((pitch: any) => {
        if (pitch.type === "RatioChordPitch") {
            const numerator = (pitch as RatioChordPitchType).pitch;
            if (numerator <= 0) {
                throw new Error(
                    `Chords cannot contain a ratio of ${numerator}`
                );
            }

            if (colons == 2) {
                while (lastNumerator < numerator - 1) {
                    lastNumerator++;
                    addRatioPitchType(lastNumerator);
                }
            }

            addRatioPitchType(numerator);
            lastNumerator = numerator;
            colons = 0;
            return;
        }
        if (pitch.type === "Colon") {
            colons++;
        }
    });

    return pitchTypes.concat(ratioPitchTypes).concat(percTypes);
};

const setScale = (setScale: SetScaleType, context: Context): void => {
    const { scale } = setScale;
    const { type } = scale;
    if (type === "PitchGroupScale") {
        const { pitches, scaleOctaveMarker, pitchGroupScalePrefix } =
            scale as PitchGroupScaleType;

        let filteredPitches: PitchType[] = pitches.filter(
            (pitch): pitch is PitchType => !pitch.delimiter
        ) as PitchType[];

        if (pitchGroupScalePrefix && pitchGroupScalePrefix.prefix === "m") {
            const degreePitches: PitchDegreeType[] = [
                {
                    type: "PitchDegree",
                    degree: 0,
                    delimiter: false,
                    pos: pitchGroupScalePrefix.pos,
                    len: 0,
                },
            ];

            let degree = 0;
            filteredPitches.forEach((pitch) => {
                if (pitch.value.type !== "PitchDegree") {
                    throw new Error(
                        "Mode scales {m} should only contain pitch degrees (0, 1, etc), not ratios, hz or any other kind of pitch"
                    );
                }
                degree += (pitch.value as PitchDegreeType).degree;

                degreePitches.push({
                    ...pitch.value,
                    degree,
                });
            });

            degreePitches.pop(); // ignore last degree which is assumed to complete the octave
            filteredPitches = degreePitches.map((value) => ({
                value,
            })) as PitchType[];
        }

        const newScale = filteredPitches.map((pitch) =>
            pitchToRatio(pitch, context)
        );
        const newScaleLabels = filteredPitches.map((pitch) =>
            pitchToLabel(pitch, context)
        );

        context.scale = newScale;
        context.scaleLabels = newScaleLabels;

        if (scaleOctaveMarker) {
            context.octaveSize = context.scale.pop() || 2;
            context.scaleLabels.pop();
        }

        return;
    }

    if (type === "EdoScale") {
        const { divisions, octaveSize } = scale as EdoScaleType;
        limit("EDO divisions", divisions, 1, 10000);
        limit("Equave size", octaveSize, 0.001, 20);
        context.scale = edoToRatios(divisions, octaveSize);
        context.scaleLabels = edoToLabels(divisions, context.scale, octaveSize);
        context.octaveSize = octaveSize;
        return;
    }

    if (type === "RatioChordScale") {
        const { pitches, scaleOctaveMarker } = scale as RatioChordScaleType;

        context.scale = [];
        context.scaleLabels = [];

        let firstDenominator = -1;
        let colons = 0;
        let lastNumerator = 0;

        const addRatio = (numerator: number): void => {
            const ratio = realizeRatio(numerator, firstDenominator, context);
            context.scale.push(ratio);
            const centsLabel = ratioToCentsLabel(ratio, 2);
            context.scaleLabels.push(
                `${numerator}/${firstDenominator}  ${centsLabel}`
            );
        };

        pitches.forEach((pitch) => {
            if (pitch.delimiter) {
                colons++;
                return;
            }

            const numerator = pitch.pitch;
            if (firstDenominator === -1) {
                firstDenominator = numerator;
            }

            if (colons === 2) {
                while (lastNumerator < numerator - 1) {
                    lastNumerator++;
                    addRatio(lastNumerator);
                }
            }

            addRatio(numerator);
            lastNumerator = numerator;
            colons = 0;
        });

        if (scaleOctaveMarker) {
            context.octaveSize = context.scale.pop() || 2;
            context.scaleLabels.pop();
        }

        return;
    }

    throw new Error(`Unknown scale type "${type}"`);
};

const setPrimes = (setPrimes: SetPrimesType, context: Context): void => {
    const { primesPitches } = setPrimes;
    const filteredPitches: PitchType[] = primesPitches.filter(
        (pitch): pitch is PitchType => !pitch.delimiter
    ) as PitchType[];
    context.primesTuning = filteredPitches.map((pitch) =>
        pitchToRatio(pitch, context)
    );
};

const setterToMosc = (setter: SetterType, context: Context): MoscItem[] => {
    const { type, delimiter } = setter;

    if (delimiter) return [];

    if (type === "SetBpm") {
        const { bpm } = setter as SetBpmType;
        return [
            {
                type: "TEMPO",
                time: context.time,
                bpm,
                lerp: false,
            },
        ];
    }

    if (type === "SetBms") {
        const { bms } = setter as SetBmsType;
        return [
            {
                type: "TEMPO",
                time: context.time,
                bpm: 60000 / bms,
                lerp: false,
            },
        ];
    }

    if (type === "SetSubdivision") {
        const { subdivision, denominator } = setter as SetSubdivisionType;
        context.subdivision = (denominator ?? 1) / subdivision;
        return [];
    }

    if (type === "SetOsc") {
        const { osc } = setter as SetOscType;
        if (osc === "drums" || osc === "percussion") {
            context.instrument = "drums";
        }
        return [
            {
                type: "PARAM_TIME",
                time: context.time,
                value: {
                    type: "osc",
                    osc,
                },
                ...(context.track !== undefined ? { track: context.track } : {}),
            },
        ];
    }

    if (type === "SetInst") {
        const { inst } = setter as SetInstType;
        context.instrument = inst.toLowerCase();
        return [
            {
                type: "PARAM_TIME",
                time: context.time,
                value: {
                    type: "inst",
                    inst: inst.toLowerCase(),
                },
                ...(context.track !== undefined ? { track: context.track } : {}),
            },
        ];
    }

    if (type === "SetEnv") {
        const { a, d, s, r } = setter as SetEnvType;
        return [
            {
                type: "PARAM_TIME",
                time: context.time,
                value: {
                    type: "env",
                    a: ENV_VALUES[a] || 0,
                    d: ENV_VALUES[d] || 0,
                    s: s / 9,
                    r: ENV_VALUES[r] || 0,
                },
                ...(context.track !== undefined ? { track: context.track } : {}),
            },
        ];
    }

    if (type === "SetVolume") {
        const { volume } = setter as SetVolumeType;
        limit("Volume", volume, 0, 10);
        return [
            {
                type: "PARAM_TIME",
                time: context.time,
                value: {
                    type: "vol",
                    vol: volume,
                },
                ...(context.track !== undefined ? { track: context.track } : {}),
            },
        ];
    }

    return [];
};

const rulerStateCaptureRootHz = (
    initial: InitialRulerState,
    context: Context
): InitialRulerState => {
    if (initial.rootHz) {
        return initial;
    }
    return {
        ...initial,
        rootHz: context.rootHz,
        octaveSize: context.octaveSize,
    };
};

export type InitialRulerState = {
    lowHz?: number;
    highHz?: number;
    rootHz?: number;
    octaveSize?: number;
    plots: MoscNoteMs[][];
};

const setterToRulerState = (
    initial: InitialRulerState,
    setter: SetterType,
    context: Context
): InitialRulerState => {
    const { type, delimiter } = setter;

    if (delimiter) return initial;

    if (type === "SetRulerPlot") {
        const newPlot = context.scale.map(
            (ratio, i): MoscNoteMs => ({
                type: "NOTE_MS",
                ms: context.time,
                msEnd: context.time,
                hz: ratio * context.rootHz,
                label: context.scaleLabels[i],
            })
        );

        return {
            ...initial,
            plots: [...initial.plots, newPlot],
        };
    }

    if (type === "SetRulerRange") {
        if (initial.lowHz) {
            return initial;
        }

        const { low, high } = setter as SetRulerRangeType;
        return {
            ...initial,
            lowHz: pitchToHz(low, context),
            highHz: pitchToHz(high, context),
        };
    }

    return initial;
};

export type Chapter = {
    label: string;
    // [startMs, startMs], mutated from step time to ms along with other times
    time: [number, number];
};

export type BarWarning = {
    pos: number;
    message: string;
};

export type Processed = {
    score?: MoscScore;
    initialRulerState?: InitialRulerState;
    chapters?: Chapter[];
    barWarnings?: BarWarning[];
};

// a comment made only of decoration e.g. "# ======" or "# ------"
const RULE_COMMENT = /^\s*[-=#*~_]{3,}\s*$/;
// a comment decorated inline e.g. "# --- Section A ---" or "## Section A"
const DECORATED_COMMENT = /^(\s*[-=]{2,}|#)\s*(.*?)[\s\-=#]*$/;

const formatBeats = (n: number): string => {
    const rounded = Math.round(n * 1000) / 1000;
    return `${rounded} beat${rounded === 1 ? "" : "s"}`;
};

export const processGrammar = (grammar: XenpaperAST): Processed => {
    // console.log('grammar', JSON.stringify(grammar));

    const grammarSequence = grammar.sequence;
    if (!grammarSequence) {
        return {};
    }

    times.length = 0;

    const INITIAL_TEMPO: MoscTempo = {
        type: "TEMPO",
        time: 0,
        bpm: 120,
        lerp: false,
    };

    const INITIAL_OSC: MoscParam = {
        type: "PARAM_TIME",
        time: 0,
        value: {
            type: "osc",
            osc: "triangle",
        },
    };

    const INITIAL_ENV: MoscParam = {
        type: "PARAM_TIME",
        time: 0,
        value: {
            type: "env",
            a: ENV_VALUES[2],
            d: ENV_VALUES[8],
            s: 0.5,
            r: ENV_VALUES[6],
        },
    };

    const scale = edoToRatios(12, 2);

    const preambleContext: Context = {
        rootHz: 220,
        time: 0,
        subdivision: 0.5,
        scale,
        scaleLabels: edoToLabels(12, scale, 2),
        octaveSize: 2,
        primesTuning: [],
    };

    let context: Context = preambleContext;
    const tracks = new Map<string, Context>();

    const getOrCreateTrackContext = (trackId: string): Context => {
        const existing = tracks.get(trackId);
        if (existing) {
            return existing;
        }
        const created: Context = {
            rootHz: preambleContext.rootHz,
            time: preambleContext.time,
            subdivision: preambleContext.subdivision,
            scale: [...preambleContext.scale],
            scaleLabels: [...preambleContext.scaleLabels],
            octaveSize: preambleContext.octaveSize,
            primesTuning: [...preambleContext.primesTuning],
            instrument: preambleContext.instrument,
            track: trackId,
        };
        tracks.set(trackId, created);
        return created;
    };

    const moscItems: MoscItem[] = [];
    let initialRulerState: InitialRulerState = {
        plots: [],
    };

    // chapters: heading comments, positioned at the next sounding item
    const chapters: Chapter[] = [];
    let pendingChapter: string | undefined;
    let prevWasRuleComment = false;

    // bars per track: list of [barline pos, bar length in steps]
    const barsByTrack = new Map<string, { pos: number; length: number }[]>();
    const barStartByTrack = new Map<string, number>();

    const flushChapter = () => {
        if (pendingChapter === undefined) return;
        const last = chapters[chapters.length - 1];
        if (!last || last.time[0] !== context.time) {
            const arr: [number, number] = [context.time, context.time];
            times.push(arr);
            chapters.push({ label: pendingChapter, time: arr });
        }
        pendingChapter = undefined;
    };

    grammarSequence.items.forEach((item): void => {
        const { type } = item;
        if (type === "Whitespace") {
            return;
        }

        if (type === "Comment") {
            const text = (item as CommentType).comment;
            if (RULE_COMMENT.test(text)) {
                prevWasRuleComment = true;
                return;
            }
            const decorated = text.match(DECORATED_COMMENT);
            if (decorated && decorated[2]) {
                pendingChapter = decorated[2];
            } else if (prevWasRuleComment && text.trim()) {
                pendingChapter = text.trim();
            }
            prevWasRuleComment = false;
            return;
        }
        prevWasRuleComment = false;

        if (type === "BarLine") {
            const track = context.track;
            if (track !== undefined) {
                const start = barStartByTrack.get(track) ?? 0;
                const bars = barsByTrack.get(track) ?? [];
                // rounded so float drift from e.g. div:3 doesn't cause false mismatches
                const length = Math.round((context.time - start) * 1e6) / 1e6;
                bars.push({ pos: item.pos, length });
                barsByTrack.set(track, bars);
                barStartByTrack.set(track, context.time);
            }
            return;
        }

        if (
            type === "Note" ||
            type === "Rest" ||
            type === "Chord" ||
            type === "RatioChord" ||
            type === "PercussionNote"
        ) {
            flushChapter();
        }

        if (type === "SetScale") {
            setScale(item as SetScaleType, context);
            return;
        }

        if (type === "SetRoot") {
            const { pitch } = item as SetRootType;
            context.rootHz = pitchToHz(pitch, context);
            return;
        }

        if (type === "PercussionNote") {
            moscItems.push(...percussionNoteToMosc(item as PercussionNoteType, context));
            return;
        }

        if (type === "Note") {
            moscItems.push(...noteToMosc(item as NoteType, context));
            initialRulerState = rulerStateCaptureRootHz(
                initialRulerState,
                context
            );
            return;
        }

        if (type === "Rest") {
            const { time } = context;
            const rest = item as RestType;
            context.time += rest.length * context.subdivision;
            // mutate ast node to add time
            const arr: [number, number] = [time, context.time];
            times.push(arr);
            rest.time = arr;
            return;
        }

        if (type === "Chord") {
            moscItems.push(...chordToMosc(item as ChordType, context));
            return;
        }

        if (type === "RatioChord") {
            moscItems.push(...chordToMosc(item as RatioChordType, context));
            initialRulerState = rulerStateCaptureRootHz(
                initialRulerState,
                context
            );
            return;
        }

        if (type === "SetterGroup") {
            const setters = (item as SetterGroupType).setters;
            const firstTrackSetter = setters.find(
                (s): s is SetTrackType => s.type === "SetTrack"
            );
            if (firstTrackSetter) {
                context = getOrCreateTrackContext(firstTrackSetter.track);
            }
            setters.forEach((setter) => {
                if (setter.type === "SetTrack") {
                    context = getOrCreateTrackContext(
                        (setter as SetTrackType).track
                    );
                    return;
                }
                if (setter.type === "SetPrimes") {
                    setPrimes(setter as SetPrimesType, context);
                    return;
                }
                moscItems.push(...setterToMosc(setter, context));
                initialRulerState = setterToRulerState(
                    initialRulerState,
                    setter,
                    context
                );
            });
            return;
        }

        throw new Error(`Unknown sequence item "${type}"`);
    });

    initialRulerState = rulerStateCaptureRootHz(initialRulerState, context);

    // compare the length of each numbered bar across tracks
    const barWarnings: BarWarning[] = [];
    if (barsByTrack.size > 1) {
        const maxBars = Math.max(
            ...Array.from(barsByTrack.values()).map((b) => b.length)
        );
        for (let i = 0; i < maxBars; i++) {
            const counts = new Map<number, number>();
            barsByTrack.forEach((bars) => {
                const bar = bars[i];
                if (bar) counts.set(bar.length, (counts.get(bar.length) ?? 0) + 1);
            });
            if (counts.size < 2) continue;
            // the most common length is assumed to be correct
            const expected = Array.from(counts.entries()).sort(
                (a, b) => b[1] - a[1]
            )[0][0];
            barsByTrack.forEach((bars, track) => {
                const bar = bars[i];
                if (bar && bar.length !== expected) {
                    barWarnings.push({
                        pos: bar.pos,
                        message: `Bar ${i + 1} of track "${track}" is ${formatBeats(
                            bar.length
                        )} long, other tracks are ${formatBeats(expected)}`,
                    });
                }
            });
        }
        barWarnings.sort((a, b) => a.pos - b.pos);
    }

    const maxTime = Math.max(
        preambleContext.time,
        ...Array.from(tracks.values()).map((t) => t.time)
    );

    const sequence = [
        INITIAL_TEMPO,
        INITIAL_OSC,
        INITIAL_ENV,
        ...moscItems,
        {
            type: "END_TIME",
            time: maxTime,
        } as MoscEnd,
    ];

    // translate times from steps to ms
    const thisTimeToMs = timeToMs(sequence);

    // omg are we really mutating many time items throughout the AST tree via mutations? golly!
    times.forEach((time) => {
        time[0] = thisTimeToMs(time[0]);
        time[1] = thisTimeToMs(time[1]);
    });

    const score = {
        sequence,
        lengthTime: maxTime,
    };

    return {
        score,
        initialRulerState,
        chapters,
        barWarnings,
    };
};
