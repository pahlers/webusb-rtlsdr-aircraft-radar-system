import {concatMap, exhaustMap, from, fromEvent, interval, map, mergeMap, scan, share, skipWhile, take, tap} from 'rxjs';
import {RtlSdr, webUsb} from 'rtlsdrjs';
import {Demodulator} from './lib/demodulator';
import {distinctUntilChanged} from 'rxjs/src/internal/operators/distinctUntilChanged';
import {openDB} from 'idb/with-async-ittr.js';
import {cumulativeData, toggle} from './helpers';

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


const ping = interval(25)
    .pipe(
        toggle(toggle$),
        skipWhile(() => !sdr), // wait till sdr is ready
        exhaustMap(() => from(sdr.readSamples(16 * 16384)).pipe(map(samples => new Uint8Array(samples)))), // read message
        mergeMap(samples => from(demodulatorProcess(samples))), // process message
        distinctUntilChanged(({msg: previousMsg}, {msg: currentMsg}) => previousMsg.toString() === currentMsg.toString()), // filter doubles
        share()
    )

// Update general stats
ping
    .pipe(
        scan(({airplanes, amountMessages}, {icao}) => {
            return {
                airplanes: [...airplanes, airplanes.includes(icao) ? undefined : icao].filter(n => !!n),
                amountMessages: amountMessages + 1
            };
        }, {
            airplanes: [],
            amountMessages: 0
        })
    )
    .subscribe(({airplanes, amountMessages}) => {
        metaElement.querySelector('.airplanes-amount').innerText = airplanes.length;
        metaElement.querySelector('.messages-amount').innerText = amountMessages;
    });

// Update airplane info
ping
    .pipe(
        map(message => ({ // add extra info
            ...message,
            icaoHex: message.icao.toString(16).toUpperCase(),
            timestamp: (new Date()).toISOString(),
            msg: undefined
        })),
        concatMap(async message => { // combine information
            const id = message.icaoHex;

            const airplane = await db.get(storeName, id) ?? {
                id,
                signupTimestamp: (new Date()).toISOString()
            };

            airplane.type = airplane.type ? 'update' : 'new';

            const messages = [...(airplane?.messages ?? []), message];
            const updatedAirplane = {
                ...airplane,
                latestMessage: message,
                messages,
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
        new Notification(`[✈✈✈ tracker] Tracking ${id}`)
    }

    const airplaneClone = createAirplaneElement(data);

    const airplaneElement = airplanesListElement.querySelector(`.airplane--${id}`);
    if (airplaneElement) {
        airplaneElement.replaceWith(airplaneClone);
    } else {
        airplanesListElement.prepend(airplaneClone);
    }
}

function createAirplaneElement({
                                   id,
                                   type,
                                   signupTimestamp,
                                   messages,
                                   cumulativeData: {speed, altitude, heading, timestamp}
                               }) {
    const airplaneClone = airplaneTemplate.content.cloneNode(true);
    airplaneClone.querySelector('.airplane').classList.add(`airplane--${id}`, `airplane-transition--${type}`);

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
    airplaneClone.querySelector('.heading-arrow').style = `transform: rotate(${heading}deg);`;

    airplaneClone.ontransitionend = function () {
        airplaneClone.classList.remove(`airplane-transition--${type}`);
    }

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
