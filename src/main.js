import {concatMap, exhaustMap, from, fromEvent, interval, map, mergeMap, scan, share, skipWhile, take, tap} from 'rxjs';
import {RtlSdr, webUsb} from 'rtlsdrjs';
import {Demodulator} from './lib/demodulator';
import {distinctUntilChanged} from 'rxjs/src/internal/operators/distinctUntilChanged';
import {openDB} from 'idb/with-async-ittr.js';
import {cumulativeData, isPositionCorrect, toggle} from './helpers';
import {decodeCPR} from "./lib/decodeCPR";

console.log('[✈✈✈ tracker] start');

const connectButton = document.querySelector('.connect');
const notifyButton = document.querySelector('.notify');
const metaElement = document.querySelector('.meta');
const airplanesListElement = document.querySelector('.airplanes');
const airplaneTemplate = document.querySelector('.airplaneTemplate');
const demodulator = new Demodulator();
const demodulatorProcess = data => new Promise((resolve) => demodulator.process(data, 256000, resolve));

let sdr;
let db;
const storeName = 'airplanes';

const toggle$ = fromEvent(connectButton, 'click')
    .pipe(
        scan((t) => !t, false),
        tap((t) => console.log(`[✈✈✈ tracker] ${t ? '' : 'not '}listening`)),
    );

fromEvent(connectButton, 'click')
    .pipe(
        tap(() => console.log('[✈✈✈ tracker] connecting')),
        take(1)
    )
    .subscribe(async () => {
        const rtlSdr = await RtlSdr.requestDevice(webUsb);

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

        db = await openDB('✈', 1, {
            upgrade(db) {
                // Create a store of objects
                const store = db.createObjectStore(storeName, {
                    // The 'id' property of the object will be the key.
                    keyPath: 'id',
                    // If it isn't explicitly set, create a value by auto incrementing.
                    autoIncrement: false,
                });
                // Create an index on the 'date' property of the objects.
                store.createIndex('signupTimestamp', 'signupTimestamp');
            },
        });

        console.log('[✈✈✈ tracker] db ready');

        const airplanesElements = (await db.getAllFromIndex(storeName, 'signupTimestamp') ?? [])
            .map(createAirplaneElement)
            .reverse();

        airplanesListElement.replaceChildren(...airplanesElements);
    });

const ping = interval(30)
    .pipe(
        toggle(toggle$),
        skipWhile(() => !sdr), // wait till sdr is ready
        exhaustMap(() => from(sdr.readSamples(16 * 16384)).pipe(map(samples => new Uint8Array(samples)))), // read message
        mergeMap(samples => from(demodulatorProcess(samples))), // process message
        distinctUntilChanged(({msg: previousMsg}, {msg: currentMsg}) => previousMsg.toString() === currentMsg.toString()), // filter doubles
        map(message => ({ // Remove raw message
            ...message,
            id: message.icao.toString(16).toUpperCase(),
            timestamp: (new Date()).toISOString(),
            position: {},
            msg: undefined
        })),
        share()
    )

// Update general stats
ping
    .pipe(
        scan(({airplanes, amountMessages}, {id, callsign}) => {
            return {
                airplanes: [...airplanes, airplanes.includes(id) ? undefined : id].filter(n => !!n),
                amountMessages: amountMessages + 1,
                latestAirplane: `${id} ${callsign}`
            };
        }, {
            airplanes: [],
            amountMessages: 0,
            latestAirplane: ''
        })
    )
    .subscribe(({airplanes, amountMessages, latestAirplane}) => {
        metaElement.querySelector('.airplanes-amount').innerText = airplanes.length;
        metaElement.querySelector('.messages-amount').innerText = amountMessages;
        metaElement.querySelector('.latest-airplane').innerText = latestAirplane;
        metaElement.querySelector('.latest-airplane').setAttribute('href', `#airplane-${latestAirplane}`);
    });

// Update airplane info
ping
    .pipe(
        concatMap(async message => { // combine information
            console.log('message', message.id, message.callsign, message.speed, message.altitude, message.heading, message.rawLatitude, message.rawLongitude)

            const id = message.id;
            const airplane = await db.get(storeName, id) ?? {
                id,
                messages: [],
                signupTimestamp: (new Date()).toISOString(),
            };

            if (!airplane.position) {
                airplane.position = {};
            }

            airplane.type = airplane.type ? 'update' : 'new';

            if (message.metype >= 9 && message.metype <= 18) {
                airplane.position[message.fflag ? 'odd' : 'even'] = {
                    lat: message.rawLatitude,
                    lng: message.rawLongitude,
                    time: Date.now()
                };

                // if the two messages are less than 10 seconds apart, compute the position
                if (Math.abs(airplane.position?.even?.time - airplane.position?.odd?.time) <= 60000) {
                    const position = decodeCPR(airplane.position.odd, airplane.position.even);

                    message.position = {...position, correct: isPositionCorrect(position?.lat, position?.lng)};
                }
            }

            const updatedAirplane = {
                ...airplane,
                callsign: message.callsign && message.callsign.length > 0 ? message.callsign : undefined,
                latestMessage: message,
                messages: [...airplane.messages, message],
                cumulativeData: cumulativeData(airplane?.cumulativeData, message)
            };

            await db.put(storeName, updatedAirplane);

            return updatedAirplane;
        }),
    )
    .subscribe(renderAirplane);

function renderAirplane(data) {
    const {type, id} = data;

    if (type === 'new' && Notification.permission === 'granted') {
        new Notification(`[✈✈✈ tracker] Tracking ${id}`);
    }

    const airplaneClone = createAirplaneElement(data);

    const airplaneElement = airplanesListElement.querySelector(`#airplane-${id}`);
    if (airplaneElement) {
        airplaneElement.replaceWith(airplaneClone);
    } else {
        airplanesListElement.prepend(airplaneClone);
    }
}

function createAirplaneElement(
    {
        id,
        callsign,
        type,
        signupTimestamp,
        messages,
        cumulativeData: {callsign: cdCallsign, speed, altitude, heading, position, timestamp}
    }
) {
    const airplaneClone = airplaneTemplate.content.cloneNode(true);
    airplaneClone.querySelector('.airplane').id = `airplane-${id}`;
    airplaneClone.querySelector('.airplane').classList.add(`airplane-transition--${type}`);

    airplaneClone.querySelector('.icao').innerText = id;
    airplaneClone.querySelector('.callsign').innerText = callsign ?? cdCallsign ?? '';

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
    airplaneClone.querySelector('.heading-arrow').style = `transform: rotate(${heading}deg);`;

    if (position?.correct) {
        airplaneClone.querySelector('.lat').innerText = position.lat;
        airplaneClone.querySelector('.lng').innerText = position.lng;
    }

    fromEvent(airplaneClone.querySelector('.airplane'), 'animationend')
        .pipe(
            take(1)
        )
        .subscribe(({target}) => {
            target.classList.remove(`airplane-transition--${type}`);
        });

    return airplaneClone;
}

fromEvent(notifyButton, 'click')
    .subscribe(() => {
        if (Notification.permission === 'granted') {
            new Notification('[✈✈✈ tracker] notifications enabled');

        } else if (Notification.permission !== `denied`) {
            Notification.requestPermission()
                .then(function (permission) {
                    if (permission === 'granted') {
                        new Notification('[✈✈✈ tracker] notifications enabled');
                    }
                });
        }
    });
