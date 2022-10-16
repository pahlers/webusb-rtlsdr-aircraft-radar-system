import {manifest, version} from '@parcel/service-worker';

async function install() {
    const cache = await caches.open(version);
    await cache.addAll(manifest);
}

self.addEventListener('install', event => event.waitUntil(install()));

self.addEventListener('fetch', event => event.respondWith(
    caches.match(event.request).then(cachedResponse => {
            const networkFetch = fetch(event.request).then(response => {
                // update the cache with a clone of the network response
                caches.open(version).then(cache => {
                    cache.put(event.request, response.clone());
                });
            });
            // prioritize cached response over network
            return cachedResponse || networkFetch;
        }
    )
));

async function activate() {
    const keys = await caches.keys();
    await Promise.all(
        keys.map(key => key !== version && caches.delete(key))
    );
}

self.addEventListener('activate', event => event.waitUntil(activate()));
