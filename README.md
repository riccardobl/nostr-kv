# NODE-KV

A key-value store that finalizes on nostr.



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