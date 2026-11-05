import type {XenpaperAST} from './grammar';

export type HighlightColor = 'delimiter'
    |'pitch'
    |'chord'
    |'percussion'
    |'scaleGroup'
    |'scale'
    |'setterGroup'
    |'setter'
    |'comment'
    |'commentStart'
    |'unknown'
    |'error'
    |'errorMessage';

export type CharData = {
    color: HighlightColor;
    playTime?: [number, number];
    warning?: string;
};

const colorMap = new Map<string,HighlightColor>([
    ['Semicolon','delimiter'],
    ['Colon','delimiter'],
    // ['PitchCents','pitch'],
    // ['PitchOctaveDivision','pitch'],
    // ['PitchRatio','pitch'],
    // ['PitchDegree','pitch'],
    // ['PitchHz','pitch'],
    // ['OctaveModifier','pitch'],
    ['Pitch','pitch'],
    ['Percussion','percussion'],
    ['PercussionNote','percussion'],
    ['PercussionNote.Percussion','percussion'],
    ['PercussionNote.Hold','percussion'],
    ['RatioChordPitch','pitch'],
    ['Chord','chord'],
    ['Chord.Whitespace','pitch'],
    ['Chord.Percussion','percussion'],
    // ['RatioChord'],
    ['Hold','pitch'],
    ['Rest','delimiter'],
    ['BarLine','delimiter'],
    ['Whitespace','delimiter'],
    ['EdoScale','scale'],
    ['PitchGroupScale','scale'],
    ['PitchGroupScale.Pitch','scale'],
    ['PitchGroupScale.Whitespace','scale'],
    ['RatioChordScale','scale'],
    ['RatioChordScale.RatioChordPitch','scale'],
    ['RatioChordScale.Colon','scale'],
    ['ScaleOctaveMarker','scale'],
    ['SetScale','scaleGroup'],
    ['SetRoot','scaleGroup'],
    ['SetRoot.Pitch','scale'],
    ['SetBpm','setter'],
    ['SetBms','setter'],
    ['SetSubdivision','setter'],
    ['SetOsc','setter'],
    ['SetEnv','setter'],
    ['SetRulerPlot','setter'],
    ['SetRulerRange','setter'],
    ['SetRulerRange.Pitch','setter'],
    ['SetTrack','setter'],
    ['SetVolume','setter'],
    ['SetPrimes','setter'],
    ['SetPrimes.Pitch','setter'],
    ['SetInst','setter'],
    ['SetterGroup','setterGroup'],
    ['SetterGroup.Semicolon','setterGroup'],
    ['Comment','comment']
]);

// need to pass playhead time in
const extract = (chars: CharData[], data: any, parent: string, withinTime?: [number, number]): void => {
    if(Array.isArray(data)) {
        for(let i = 0; i < data.length; i++) {
            extract(chars, data[i], parent, withinTime);
        }
        return;
    }
    if(data instanceof Object) {
        const color = colorMap.get(`${parent}.${data.type}`) || colorMap.get(data.type);
        const time = withinTime ?? data.time;

        if(typeof data.pos === 'number' && typeof data.len === 'number' && color) {
            if(color === 'comment') {
                if(data.len > 0) {
                    chars[data.pos] = {
                        color: 'commentStart',
                        playTime: time
                    };
                }
                if(data.len > 1) {
                    const commentCharData: CharData = {
                        color: 'comment',
                        playTime: time
                    };
                    for(let i = 1; i < data.len; i++) {
                        chars[data.pos + i] = commentCharData;
                    }
                }
            } else {
                const charData: CharData = {
                    color,
                    playTime: time
                };
                for(let i = 0; i < data.len; i++) {
                    chars[data.pos + i] = charData;
                }
            }
        }
        for(const key in data) {
            if(key !== 'time') {
                const val = data[key];
                if(val instanceof Object) {
                    extract(chars, val, data.type, time);
                }
            }
        }
        return;
    }
};

export const grammarToChars = ({sequence}: XenpaperAST): CharData[] => {
    if(!sequence) return [];
    const {items} = sequence;
    const chars: CharData[] = [];
    extract(chars, items, '');
    return chars;
};
