import {concatMap, exhaustMap, from, fromEvent, interval, map, mergeMap, scan, share, skipWhile, take, tap} from 'rxjs';
import {RtlSdr, webUsb} from 'rtlsdrjs';
import {distinctUntilChanged} from 'rxjs/src/internal/operators/distinctUntilChanged';
import {openDB} from 'idb/with-async-ittr.js';
import {cumulativeData, isPositionCorrect, toggle} from './lib/helpers';
import {decodeCPR} from './lib/decodeCPR';
import Demodulator from 'mode-s-demodulator';
import {AirplaneElement} from "./airplane.element";

console.log('[✈✈✈ tracker] start');

const connectButton = document.querySelector('.connect');
const notifyButton = document.querySelector('.notify');
const metaElement = document.querySelector('.meta');
const airplanesListElement = document.querySelector('.airplanes');
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
            .map(({
                      id,
                      callsign,
                      type,
                      signupTimestamp,
                      messages,
                      cumulativeData: {speed, altitude, heading, position, timestamp}
                  }) => new AirplaneElement({
                icao: id,
                callsign,
                type,
                signupTimestamp,
                messagesAmount: messages.length,
                messageTimestamp: timestamp,
                speed,
                altitude,
                heading,
                position
            }))
            .reverse();

        airplanesListElement.replaceChildren(...airplanesElements);
    });

const ping = interval(30)
    .pipe(
        toggle(toggle$),
        skipWhile(() => !sdr), // wait till sdr is ready
        exhaustMap(() => from(sdr.readSamples(16 * 16384)).pipe(map(samples => new Uint8Array(samples)))), // read samples
        mergeMap(samples => from(demodulatorProcess(samples))), // process sample
        distinctUntilChanged(({msg: previousMsg}, {msg: currentMsg}) => previousMsg.toString() === currentMsg.toString()), // filter doubles
        map(message => ({ // Remove raw message
            ...message,
            id: message.icao.toString(16).toUpperCase(),
            callsign: message.callsign.length > 0 ? message.callsign : null,
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
                latestAirplane: id,
                callsign
            };
        }, {
            airplanes: [],
            amountMessages: 0,
            latestAirplane: ''
        })
    )
    .subscribe(({airplanes, amountMessages, latestAirplane, callsign}) => {
        metaElement.querySelector('.airplanes-amount').innerText = airplanes.length;
        metaElement.querySelector('.messages-amount').innerText = amountMessages;

        const lastAirplaneElement = metaElement.querySelector('.latest-airplane');
        lastAirplaneElement.innerText = `${latestAirplane} ${callsign ?? ''}`;
        lastAirplaneElement.setAttribute('href', `#airplane-${latestAirplane}`);
    });

// Update airplane info
ping
    .pipe(
        concatMap(async message => { // combine information
            console.log('message', message.id, message.callsign, message.speed, message.altitude, message.heading, message.fflag ? 'odd' : 'even', message.rawLatitude, message.rawLongitude)

            const id = message.id;
            const airplane = await db.get(storeName, id) ?? {
                id,
                messages: [],
                signupTimestamp: (new Date()).toISOString(),
            };


            if (message.metype >= 9 && message.metype <= 18) {
                if (!airplane.position) {
                    airplane.position = {};
                }

                airplane.position[message.fflag ? 'odd' : 'even'] = {
                    lat: message.rawLatitude,
                    lng: message.rawLongitude,
                    time: Date.now()
                };

                // if the two messages are less than 10 seconds apart, compute the position
                if (Math.abs(airplane.position?.even?.time - airplane.position?.odd?.time) <= 60000) {
                    const position = decodeCPR(airplane.position.odd, airplane.position.even);
                    const correct = isPositionCorrect(position?.lat, position?.lng);

                    message.position = {
                        ...position,
                        correct,
                    };
                }
            }

            const updatedAirplane = {
                ...airplane,
                callsign: message.callsign ?? airplane.callsign,
                type: airplane.type ? 'update' : 'new',
                latestMessage: message,
                messages: [...airplane.messages, message],
                cumulativeData: cumulativeData(airplane?.cumulativeData, message)
            };

            await db.put(storeName, updatedAirplane);

            return updatedAirplane;
        }),
    )
    .subscribe((
        {
            id,
            callsign,
            type,
            signupTimestamp,
            messages,
            cumulativeData: {speed, altitude, heading, position, timestamp}
        }
    ) => {

        if (type === 'new' && Notification.permission === 'granted') {
            new Notification(`[✈✈✈ tracker] Tracking ${id}`);
        }

        const airplaneClone = new AirplaneElement({
            icao: id,
            callsign,
            type,
            signupTimestamp,
            messagesAmount: messages.length,
            messageTimestamp: timestamp,
            speed,
            altitude,
            heading,
            position
        });

        const airplaneElement = airplanesListElement.querySelector(`#airplane-${id}`);
        if (airplaneElement) {
            airplaneElement.replaceWith(airplaneClone);
        } else {
            airplanesListElement.prepend(airplaneClone);
        }
    });


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

navigator.serviceWorker.register(
    new URL('service-worker.js', import.meta.url),
    {type: 'module'}
).then(() => console.log('[✈✈✈ tracker] register serviceworker'));
