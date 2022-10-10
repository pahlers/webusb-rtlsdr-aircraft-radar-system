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
