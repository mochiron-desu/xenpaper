import {useState, useCallback, useEffect, useRef} from 'react';

export const hashify = (newHash: string): string => {
    return encodeURIComponent(newHash)
        .replace(/_/g, '%_')
        .replace(/%20/g, '_');
};

export const unhashify = (hash: string): string => {
    return decodeURIComponent(
        hash.replace(/%_|_/g, match => (match === '%_' ? '_' : '%20'))
    );
};

type UseHashResult = readonly [string, (newHash: string) => void];

export const useHash = (): UseHashResult => {
    const [hash, setHash] = useState(() => {
        let initialHash = unhashify(window.location.hash.substr(1));
        if(!initialHash && window.localStorage) {
            initialHash = window.localStorage.getItem('lasttune') ?? '';
        }
        return initialHash;
    });

    const lastEncodedRef = useRef<string>(window.location.hash.substr(1));
    const timerRef = useRef<number>(0);

    const onHashChange = useCallback(() => {
        setHash(window.location.hash);
    }, []);

    useEffect(() => {
        window.addEventListener('hashchange', onHashChange);
        return () => {
            window.removeEventListener('hashchange', onHashChange);
            if(timerRef.current) {
                window.clearTimeout(timerRef.current);
            }
        };
    }, [onHashChange]);

    const _setHash = useCallback((newHash: string) => {
        if(timerRef.current) {
            window.clearTimeout(timerRef.current);
        }
        timerRef.current = window.setTimeout(() => {
            const newHashEncoded = hashify(newHash);
            if (newHashEncoded !== lastEncodedRef.current) {
                lastEncodedRef.current = newHashEncoded;
                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-ignore
                window.history.replaceState(undefined, undefined, '#' + newHashEncoded);
                window.localStorage?.setItem('lasttune', newHash);
            }
        }, 300);
    }, []);

    return [hash, _setHash] as const;
};
