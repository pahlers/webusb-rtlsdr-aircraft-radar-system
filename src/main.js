import {
    exhaustMap,
    from,
    fromEvent,
    interval,
    map,
    mergeMap,
    Observable,
    scan,
    skipWhile,
    startWith,
    take,
    tap
} from 'rxjs';
import {RtlSdr} from 'rtlsdrjs';
import {Demodulator} from "./lib/demodulator";
import {distinctUntilChanged} from "rxjs/src/internal/operators/distinctUntilChanged";

console.log('[✈✈✈ tracker] start');

const connectButton = document.querySelector('.connect')
const mainElement = document.querySelector('main');
const mainTemplate = document.querySelector('.mainTemplate');
const airplaneTemplate = document.querySelector('.airplaneTemplate');
const waitingElement = document.querySelector('.waiting');
const demodulator = new Demodulator();
let sdr;

fromEvent(connectButton, 'click')
    .pipe(
        tap(() => console.log('[✈✈✈ tracker] connecting')),
        take(1)
    )
    .subscribe(async () => {
        const rtlSdr = await RtlSdr.requestDevice();

        //
        // open the device
        //
        // supported options are:
        // - ppm: frequency correction factor, in parts per million (defaults to 0)
        // - gain: optional gain in dB, auto gain is used if not specified
        //
        await rtlSdr.open({
            ppm: 0.5
        });

        //
        // set sample rate and center frequency in Hz
        // - returns the actual values set
        //
        const actualSampleRate = await rtlSdr.setSampleRate(2000000);
        const actualCenterFrequency = await rtlSdr.setCenterFrequency(1090000000);

        console.log('[✈✈✈ tracker] actualSampleRate', actualSampleRate)
        console.log('[✈✈✈ tracker] actualCenterFrequency', actualCenterFrequency)

        //
        // reset the buffer
        //
        await rtlSdr.resetBuffer();

        sdr = rtlSdr;
        console.log('[✈✈✈ tracker] connected');

        waitingElement.classList.remove('hidden');
    });

const toggle$ = fromEvent(connectButton, 'click')
    .pipe(
        scan((t) => !t, false),
        tap((t) => console.log(`[✈✈✈ tracker] ${t ? '' : 'not '}listening`)),
    )

const demodulatorProcess = data => new Promise((resolve) => demodulator.process(data, 256000, resolve));

function cumulativeData(
    {speed: pSpeed, altitude: pAltitude, heading: pHeading} = {},
    {speed: cSpeed, altitude: cAltitude, heading: cHeading, timestamp} = {}
) {
    return {
        speed: cSpeed ?? pSpeed,
        altitude: cAltitude ?? pAltitude,
        heading: cHeading ?? pHeading,
        timestamp
    };
}

function sortBySignupTimestamp(a, b) {
    return new Date(a.signupTimestamp) - new Date(b.signupTimestamp);
}

interval(25)
    .pipe(
        skipWhile(() => !sdr), // wait till sdr is ready
        exhaustMap(() => from(sdr.readSamples(16 * 16384)).pipe(map(samples => new Uint8Array(samples)))), // read message
        mergeMap(samples => from(demodulatorProcess(samples))), // process message
        distinctUntilChanged(({msg: previousMsg}, {msg: currentMsg}) => previousMsg.toString() === currentMsg.toString()), // filter doubles
        map(message => ({ // add extra info
            ...message,
            icaoHex: message.icao.toString(16).toUpperCase(),
            timestamp: (new Date()).toISOString(),
            msg: undefined
        })),
        scan((acc, message) => { // combine information
            const id = message.icaoHex;
            const airplane = acc[id] ?? {id, signupTimestamp: (new Date()).toISOString()};
            const messages = [...(airplane?.messages ?? []), message];

            return {
                ...acc,
                [id]: {
                    ...airplane,
                    latestMessage: message,
                    messages,
                    cumulativeData: cumulativeData(airplane?.cumulativeData, message)
                },
                _meta: {
                    type: airplane ? 'update' : 'new',
                    current: id
                }
            };
        }, JSON.parse(localStorage.getItem('✈') ?? '{}')),
        tap(data => localStorage.setItem('✈', JSON.stringify(data))),
        toggle(toggle$), // on/off
        startWith(JSON.parse(localStorage.getItem('✈') ?? '{}'))
    )
    .subscribe(data => {
        const {type = '', current: currentId = ''} = data?._meta ?? {};
        const airplanes = Object.entries(data)
            .filter(([key]) => key !== '_meta')
            .map(([_, value]) => value);

        const mainClone = mainTemplate.content.cloneNode(true);

        mainClone.querySelector('.newMessage .type').innerText = type;
        mainClone.querySelector('.newMessage .id').innerText = currentId;

        const airplaneElements = airplanes
            .map(({id, signupTimestamp, messages, cumulativeData: {speed, altitude, heading, timestamp}}) => {
                const airplaneClone = airplaneTemplate.content.cloneNode(true);

                airplaneClone.querySelector('.icao').innerText = id;

                airplaneClone.querySelector('.signup-timestamp').innerText = `${signupTimestamp}`;
                airplaneClone.querySelector('.message-timestamp').innerText = `${timestamp}`;
                airplaneClone.querySelector('.messages-amount').innerText = messages.length;

                let speedElement = airplaneClone.querySelector('.speed-knot');
                speedElement.innerText = `${new Intl.NumberFormat('en', {
                    notation: 'standard'
                }).format(speed ?? 0)} kts`;
                speedElement.title = `${new Intl.NumberFormat('en', {
                    style: 'unit',
                    unit: 'kilometer-per-hour'
                }).format(((speed ?? 0) * 1.852))}`;

                let altitudeElement = airplaneClone.querySelector('.altitude-foot');
                altitudeElement.innerText = `${new Intl.NumberFormat('en', {
                    style: 'unit',
                    unit: 'foot'
                }).format(altitude ?? 0)}`;
                altitudeElement.title = `${new Intl.NumberFormat('en', {
                    style: 'unit',
                    unit: 'meter'
                }).format(((altitude ?? 0) * 0.3048))}`;

                airplaneClone.querySelector('.heading').innerText = `${new Intl.NumberFormat('en', {
                    style: 'unit',
                    unit: 'degree'
                }).format(heading ?? 0)}`;
                airplaneClone.querySelector('.heading-arrow').style = `transform: rotate(${heading}deg);`

                return airplaneClone;
            })
            .sort(sortBySignupTimestamp)
            .reverse();

        const amountMessages = airplanes.reduce((acc, {messages}) => acc + messages.length, 0);

        mainClone.querySelector('.newMessage .airplanes-amount').innerText = airplanes.length;
        mainClone.querySelector('.newMessage .messages-amount').innerText = amountMessages;
        mainClone.querySelector('.airplanes').replaceChildren(...airplaneElements);

        mainElement.replaceChildren(mainClone);
    });

function toggle(toggleObservable) {
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
