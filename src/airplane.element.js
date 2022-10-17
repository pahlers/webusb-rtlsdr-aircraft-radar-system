import {fromEvent} from "rxjs";
import {generateMapUrl} from "./lib/helpers";

const css = `
:host {
    display: block;
    padding: 0.5rem;
}

.hidden {
    display: none;
}

.heading-arrow {
    font-size: 2rem;
    display: inline-block;
}
`;
const html = `        
        <h2><span class="icao"></span> <span class="callsign">--</span></h2>
        <p>
            Sign up <span class="signup-timestamp">--</span> Last update: <span class="message-timestamp">--</span> Amount
            messages: <span class="messages-amount">0</span>
        </p>
        <p>
            SPD: <span class="speed-knot">--</span><br>
            ALT: <span class="altitude-foot">--</span><br>
            HDG: <span class="heading">--</span> <span class="heading-arrow">⇮</span>
        </p>
        <p class="position">
            LAT: <span class="lat">--</span><br>
            LNG: <span class="lng">--</span><br>
        </p>
`;

export class AirplaneElement extends HTMLElement {
    #icao;
    #callsign;
    #type;
    #signupTimestamp;
    #messageTimestamp;
    #messagesAmount;
    #speed;
    #altitude;
    #heading;
    #positionCorrect;
    #positionLat;
    #positionLng;
    #timestamp;

    constructor(data) {
        super();

        if (data) {
            const {
                icao,
                callsign = '',
                type = 'new',
                signupTimestamp,
                messageTimestamp,
                messagesAmount,
                speed = 0,
                altitude = 0,
                heading = 0,
                position = {},
                timestamp
            } = data;

            this.#icao = icao;
            this.#callsign = callsign;
            this.#type = type;
            this.#signupTimestamp = signupTimestamp;
            this.#messageTimestamp = messageTimestamp;
            this.#messagesAmount = messagesAmount;
            this.#speed = speed;
            this.#altitude = altitude;
            this.#heading = heading;
            this.#positionCorrect = position?.correct ?? false;
            this.#positionLat = position?.lat;
            this.#positionLng = position?.lng;
            this.#timestamp = timestamp;
        }
    }

    connectedCallback() {
        // attributes
        this.#icao = this.#icao ?? this.getAttribute('icao');
        this.#type = this.#type ?? this.getAttribute('type') ?? 'new';
        this.#callsign = this.#callsign ?? this.getAttribute('callsign') ?? '';
        this.#signupTimestamp = this.#signupTimestamp ?? this.getAttribute('signup-timestamp');
        this.#messageTimestamp = this.#messageTimestamp ?? this.getAttribute('message-timestamp');
        this.#messagesAmount = this.#messagesAmount ?? this.getAttribute('messages-amount');
        this.#speed = this.#speed ?? +this.getAttribute('speed') ?? 0;
        this.#altitude = this.#altitude ?? +this.getAttribute('altitude') ?? 0;
        this.#heading = this.#heading ?? +this.getAttribute('heading') ?? 0;
        this.#positionCorrect = this.#positionCorrect ?? !!this.getAttribute('position-correct');
        this.#positionLat = this.#positionLat ?? parseFloat(this.getAttribute('position-latitude'));
        this.#positionLng = this.#positionLng ?? parseFloat(this.getAttribute('position-longitude'));

        const template = document.createElement('template');
        template.innerHTML = html;
        const templateContent = template.content;

        const style = document.createElement('style');
        style.innerText = css.replaceAll('\n', '');

        const node = templateContent.cloneNode(true)
        const airplaneElement = this;
        airplaneElement.id = `airplane-${this.#icao}`;
        airplaneElement.classList.add(`airplane-transition--${this.#type}`);

        node.querySelector('.icao').innerText = this.#icao;
        node.querySelector('.callsign').innerText = this.#callsign;

        node.querySelector('.signup-timestamp').innerText = `${this.#signupTimestamp}`;
        node.querySelector('.message-timestamp').innerText = `${this.#messageTimestamp}`;
        node.querySelector('.messages-amount').innerText = this.#messagesAmount;

        let speedElement = node.querySelector('.speed-knot');
        speedElement.innerText = `${new Intl.NumberFormat('en', {
            notation: 'standard'
        }).format(this.#speed)} kts`;
        speedElement.title = `${new Intl.NumberFormat('en', {
            style: 'unit',
            unit: 'kilometer-per-hour'
        }).format((this.#speed * 1.852))}`;

        let altitudeElement = node.querySelector('.altitude-foot');
        altitudeElement.innerText = `${new Intl.NumberFormat('en', {
            style: 'unit',
            unit: 'foot'
        }).format(this.#altitude)}`;
        altitudeElement.title = `${new Intl.NumberFormat('en', {
            style: 'unit',
            unit: 'meter'
        }).format((this.#altitude * 0.3048))}`;

        node.querySelector('.heading').innerText = `${new Intl.NumberFormat('en', {
            style: 'unit',
            unit: 'degree'
        }).format(this.#heading)}`;
        node.querySelector('.heading-arrow').style = `transform: rotate(${this.#heading}deg);`;

        if (this.#positionCorrect) {
            node.querySelector('.lat').innerText = this.#positionLat;
            node.querySelector('.lng').innerText = this.#positionLng;

            const {url} = generateMapUrl(this.#positionLat, this.#positionLng, 12, 'https://tile.openstreetmap.org');

            const mapElement = document.createElement('img');
            mapElement.alt = '';
            mapElement.src = url;
            mapElement.classList.add('map');
            mapElement.part.add('map');

            node.querySelector('.position').append(mapElement);
        }

        fromEvent(airplaneElement, 'animationend')
            .subscribe(({target, animationName}) => {
                if (animationName === 'blinking') {
                    target.classList.remove(`airplane-transition--${this.#type}`);
                }

                if (animationName === 'timer') {
                    target.classList.add('hidden');
                    target.remove();
                }
            });

        const shadowRoot = this.attachShadow({mode: 'open'});
        shadowRoot.appendChild(style);
        shadowRoot.appendChild(node);
    }
}

customElements.define('air-plane', AirplaneElement);
