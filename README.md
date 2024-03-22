# NOSTR-KV

Nostr-KV is an eventually-consistent key-value storage on top of nostr using [NIP-78](https://github.com/nostr-protocol/nips/blob/master/78.md).


# Overview
Applications connecting to a Nostr-KV instance, provide a list of relays to which they desire to publish data and a key-value pair.

The instance will store the data locally and make it available immediately to other application while propagating the data to the chosen relays.

When a key-value pair is requested, the instance will first see if a compatible event subscription is already opened and if the data is available locally, if not it will sync with the provided relay list and return the most recent value.

Event subscriptions stay open for a while and keep the data in sync with relays.
Pairs, relays and subscriptions that are not used for a while will be evicted from the cache.



# Key-Value API
TODO 

# Event Flow API
TODO


# Running an instance

```bash
docker run  \
-d \
--restart=always \
--name=nostr-kv \
-p 7778:8080 \
-v/srv/nostr-kv/data:/data \
-v/srv/certs:/certs \
ghcr.io/riccardobl/nostr-kv:master
```