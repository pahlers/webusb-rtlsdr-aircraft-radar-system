import {Observable} from "rxjs";

export function toggle(toggleObservable) {
    return (observable) =>
        new Observable(subscriber => {
            let toggled = false;
            const toggleSubscription = toggleObservable.subscribe(t => toggled = t);

            const subscription = observable.subscribe({
                next(value) {
                    if (toggled) {
                        subscriber.next(value);
                    }
                },
                error(err) {
                    subscriber.error(err);
                },
                complete() {
                    subscriber.complete();
                },
            });

            subscription.add(toggleSubscription);

            return () => {
                subscription.unsubscribe();
            };
        });
}

export function cumulativeData(
    {speed: pSpeed, altitude: pAltitude, heading: pHeading, position: pPosition} = {},
    {speed: cSpeed, altitude: cAltitude, heading: cHeading, position: cPosition, timestamp} = {}
) {
    return {
        speed: cSpeed ?? pSpeed,
        altitude: cAltitude ?? pAltitude,
        heading: cHeading ?? pHeading,
        position: cPosition?.correct ? cPosition : pPosition,
        timestamp
    };
}

export function isPositionCorrect(lat, lng) {
    return Math.floor(lat) === 52 && Math.floor(lng) === 5;
}

function lng2tile(lon, zoom) {
    return (Math.floor((lon + 180) / 360 * Math.pow(2, zoom)));
}

function lat2tile(lat, zoom) {
    return (Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, zoom)));
}

export function generateMapUrl(lat, lng, zoom, url) {
    const x = lng2tile(lng, zoom);
    const y = lat2tile(lat, zoom);

    if (isNaN(x) || isNaN(y)) {
        return;
    }

    return {
        zoom,
        x,
        y,
        url: `${url}/${zoom}/${x}/${y}.png`
    };
}


