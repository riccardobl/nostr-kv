import SQLite from 'better-sqlite3';
import Utils from './Utils.js';
import { Relay } from 'nostr-tools/relay'
import { generateSecretKey, getPublicKey, getEventHash } from 'nostr-tools/pure'
import { finalizeEvent, verifyEvent } from 'nostr-tools/pure'
import { useWebSocketImplementation } from 'nostr-tools/relay'
import ws from 'ws';
useWebSocketImplementation(ws);

export default class KVStore {
    activeRelays={};
    db=null;
    loopTimer =null;
    MAX_SUBMISSION_FAILURES=5;
    CONFIG=null;
    constructor(config,dbpath,dboptions){
        this.db = new SQLite(dbpath, dboptions);
        this.db.pragma('journal_mode = WAL');
        this.CONFIG=config;

    }


    async init() {
        if (this.initialized) return;
        this.closed=false;

        // cache kv pairs
        this._run(this._prepare('CREATE TABLE IF NOT EXISTS kvpairs \
        (\
            id TEXT PRIMARY KEY, \
            key TEXT, \
            value TEXT, \
            authorPubKey TEXT, \
            timestamp INTEGER, \
            localTimestamp INTEGER, \
            signedEvent TEXT, \
            expiration INTEGER\
        )'));

        this._run(this._prepare('CREATE INDEX IF NOT EXISTS keys_index1 ON kvpairs(key)'));
        this._run(this._prepare('CREATE INDEX IF NOT EXISTS keys_index2 ON kvpairs(authorPubKey)'));
        this._run(this._prepare('CREATE INDEX IF NOT EXISTS keys_index3 ON kvpairs(timestamp)'));
        this._run(this._prepare('CREATE INDEX IF NOT EXISTS keys_index4 ON kvpairs(localTimestamp)'));



        // track active relays
         this._run( this._prepare('CREATE TABLE IF NOT EXISTS relays \
        (\
            relayId TEXT PRIMARY KEY, \
            relayUrl TEXT, \
            lastAccess INTEGER\
        )'));
         this._run( this._prepare('CREATE INDEX IF NOT EXISTS relays_index1 ON relays(lastAccess)'));

    

        // track active subscriptions
         this._run( this._prepare('CREATE TABLE IF NOT EXISTS kvsub \
        (\
            subscriptionId TEXT PRIMARY KEY, \
            relayId TEXT, \
            authorPubKey TEXT, \
            lastAccess INTEGER, \
            FOREIGN KEY(relayId) REFERENCES relays(relayId) ON DELETE CASCADE\
        )'));
         this._run( this._prepare('CREATE INDEX IF NOT EXISTS kvsub_index1 ON kvsub(subscriptionId)'));
         this._run( this._prepare('CREATE INDEX IF NOT EXISTS kvsub_index2 ON kvsub(relayId)'));
         this._run( this._prepare('CREATE INDEX IF NOT EXISTS kvsub_index3 ON kvsub(authorPubKey)'));
         this._run( this._prepare('CREATE INDEX IF NOT EXISTS kvsub_index4 ON kvsub(lastAccess)'));
        

        // association kvpair -> subscription (many to many)
         this._run( this._prepare('CREATE TABLE IF NOT EXISTS kvpairsXsub \
        (\
            subPairId TEXT PRIMARY KEY, \
            pairId TEXT, \
            subscriptionId TEXT, \
            FOREIGN KEY(pairId) REFERENCES kvpairs(id) ON DELETE CASCADE, \
            FOREIGN KEY(subscriptionId) REFERENCES kvsub(subscriptionId) ON DELETE CASCADE \
        )'));
       

        // event submission queue
         this._run( this._prepare('CREATE TABLE IF NOT EXISTS eventSubmissionQueue \
        (\
            id TEXT PRIMARY KEY, \
            event TEXT, \
            relayUrl TEXT, \
            timestamp INTEGER, \
            failureCount INTEGER DEFAULT 0\
        )'));



        const _loop = async () => {
            if(this.closed)return;
            this.looping=true;
            try{
                await this.submitPendingEvents();
            }catch(e){
                console.error(e);
            }
            if (!this.lastMaintenance || Date.now() - this.lastMaintenance > 1000 * 60 * 5) {
                this.lastMaintenance = Date.now();
                try {
                    await this.cleanupLoop();
                } catch (e) {
                    console.error(e);
                }
            }
            this.looping=false;
            this.loopTimer = setTimeout(_loop, 100);
        }
        _loop();

        this.initialized = true;

    }

    activeRelays={};
    async getRelay(relay){
        const id = Utils.fastId(relay);
        const now=Date.now();
        this._run( this._prepare('INSERT OR IGNORE INTO relays (relayId, relayUrl, lastAccess) VALUES (:relayId, :relayUrl, :lastAccess)'), {
            relayId: id,
            relayUrl: relay,
            lastAccess: now
        });
        this._run( this._prepare('UPDATE relays SET lastAccess=:lastAccess WHERE relayId=:relayId'), {
            relayId: id,
            lastAccess: now
        });
        if(!this.activeRelays[id]){
            console.log("Relay not connected, connecting:",relay, id)
            this.activeRelays[id] = {
                relay:await Relay.connect(relay),
                lastAccess: now,
                id:id,
                url:relay
            }
        }
        return this.activeRelays[id];
    }

    async cleanExpiredRelays(relayTimeout = 1000 * 60 * 30) {
        const now = Date.now();       
        this._transaction(async () => {       
            const rows =  this._all( this._prepare('SELECT * FROM relays WHERE :now - lastAccess > :relayTimeout', true), {
                now,
                relayTimeout
            });
             this._run( this._prepare('DELETE FROM relays WHERE :now - lastAccess > :relayTimeout', true), {
                now,
                relayTimeout
            });
            for(const row of rows){
                console.log("Relay expired",row.relayId, row.relayUrl)
                delete this.activeRelays[row.relayId];
            }
        });   
    }

    activeSubscriptions={};

    async get(key, authorsPubKeys, relayUrls,  maxHistoryEntries = 10, asEvent=false) {
        await this.init();
        if (authorsPubKeys){
            authorsPubKeys = [...authorsPubKeys].sort();        
        }
        if (!authorsPubKeys||!authorsPubKeys.length) {
            authorsPubKeys=["*"];
        }
        const isWildcard = authorsPubKeys.find(k=>k==="*");
        const relays=await Promise.all(relayUrls.map(async relay=>this.getRelay(relay)));
        const isStrictSub = !!this.CONFIG.useStrictSubscriptions;

        for(const relay of relays){
            let subs = [];

            for(const authorPubKey of authorsPubKeys){
                const subId = Utils.fastId(authorPubKey + "@" + relay.url + (isStrictSub?key:""));
                this._run( this._prepare('INSERT OR IGNORE INTO kvsub (subscriptionId, relayId, authorPubKey, lastAccess) VALUES (:subscriptionId, :relayId, :authorPubKey, :lastAccess)'), {
                    subscriptionId: subId,
                    relayId: relay.id,
                    authorPubKey,
                    lastAccess: Date.now()
                });
                this._run( this._prepare('UPDATE kvsub SET lastAccess=:lastAccess WHERE subscriptionId=:subscriptionId'), {
                    subscriptionId: subId,
                    lastAccess: Date.now()
                });

                subs.push(
                        {
                            relay,
                            authorPubKey,
                            lastAccess: Date.now(),
                            id: subId,
                            subEvent: {
                                kinds: [30078],
                                authors: isWildcard ?undefined:[authorPubKey],
                                "#d": isStrictSub ? [key] : undefined                               
                            }
                        }
                );
                if (isWildcard)break;                
            }
            subs = await Promise.all(subs);
            subs = subs.filter(s => !this.activeSubscriptions[s.id]);
            subs = subs.map(async s => {
                return new Promise((resolve, reject) => {
                    const timeoutTimer=setTimeout(() => {
                        reject("Timeout");
                    }, 1000 * 60 * 5);

                    console.log("Subscribing to", s,"@",relay.url)
                    const self=this;
                    relay.relay.subscribe([s.subEvent], {
                        onevent(event) {
                            try{
                                console.log("Got event",event)
                                if(!verifyEvent(event))throw "Invalid event";
                                if(event.kind!==30078)throw "Invalid event kind";
                                
                                            
                                let key=event.tags.find(t=>t[0]==="d");
                                if (!key )throw "Invalid event tag (d)";
                                key=key[1];
                                let expiration;
                                const expirationTag=event.tags.find(t=>t[0]==="expiration");
                                if (expirationTag)expiration=Number(expirationTag[1])*1000;
                                else expiration=0;
                                if(expiration && expiration < Date.now())throw "Expired event";
                                const timestamp=event.created_at*1000;
                                const value=event.content;
                                const pairId =event.id;
                                const authorPubKey = event.pubkey;
                                const localTimestamp = Date.now();
                                
                                const eventParams = {
                                    id: pairId,
                                    key,
                                    value,
                                    timestamp,
                                    authorPubKey,
                                    localTimestamp,
                                    expiration: expiration,
                                    signedEvent: JSON.stringify(event)
                                };
                                console.log("Received event",eventParams)
                                const subPairId = Utils.fastId(pairId + "@" + s.id);
                                self._transaction(() => {
                                    // check if subscription still exists
                                    const sub =  self._all( self._prepare('SELECT * FROM kvsub'));
                                    console.log(sub);
                                    if (!sub) throw "Subscription not found";

                                    self._run(self._prepare('INSERT OR REPLACE INTO kvpairs (id, key, value, timestamp, authorPubKey, localTimestamp, expiration,  signedEvent) VALUES (:id, :key, :value, :timestamp, :authorPubKey, :localTimestamp, :expiration, :signedEvent)'),eventParams);
                                    self._run(self._prepare('INSERT OR REPLACE INTO kvpairsXsub (subPairId, pairId, subscriptionId) VALUES (:subPairId, :pairId, :subscriptionId)'), {
                                        subPairId,
                                        pairId,
                                        subscriptionId: s.id
                                    });                                 
                                });
                                
                            }catch(e){
                                console.error("Can't process event",e);
                            }
                        },
                        oneose() {
                            clearTimeout(timeoutTimer);
                            resolve();
                        }
                    });
                })
                .then(() => s);
            });

            subs = await Promise.all(subs);
            for(const sub of subs){
                this.activeSubscriptions[sub.id] = sub;
            }
        }
      
        const params={
            key,
            maxHistoryEntries,
            now: Date.now()
        };
        
        let query = 'SELECT ' + (asEvent ? "signedEvent":"key,value,timestamp,authorPubKey,localTimestamp") +' FROM kvpairs WHERE key=:key';
        query += ' AND (expiration = 0 OR expiration > :now)';
        if (!isWildcard){
            query += ' AND (';
            for (let i=0;i<authorsPubKeys.length;i++){
                query += 'authorPubKey=:authorPubKey' + i;
                params['authorPubKey' + i] = authorsPubKeys[i];
                if (i < authorsPubKeys.length - 1)  query += ' OR ';                
            }
            query += ') ';
        }
        
        query += ' ORDER BY timestamp DESC LIMIT :maxHistoryEntries';
        query= this._prepare(query);
        
        const entries=  this._all(query, params);     
        console.log(entries);
        
        if (!asEvent){
            const out={
                key:key,
                value:entries.length>0?JSON.parse(entries[0].value):undefined,
                timestamp:entries.length>0?entries[0].timestamp:undefined,
                author:entries.length>0?entries[0].authorPubKey:undefined,
                localTimestamp:entries.length>0?entries[0].localTimestamp:undefined,
                history:[]
            };

            for(let i=1;i<entries.length;i++){
                out.history.push({
                    value:JSON.parse(entries[i].value),
                    timestamp:entries[i].timestamp,
                    author:entries[i].authorPubKey,
                    localTimestamp:entries[i].localTimestamp,
                });
            }

            return out;            
        }else{
            const out={
                signedEvent:entries.length>0?JSON.parse(entries[0].signedEvent):undefined,
                history:[]
            };
            for(let i=1;i<entries.length;i++){
                out.history.push({
                    signedEvent:JSON.parse(entries[i].signedEvent)
                });
            }
            return out;

            
        } 


    }

    async clearExpiredSubscriptions(subscriptionTimeout = 1000 * 60 * 5) {
        const now = Date.now();
        this._transaction(async () => {
            const rows =  this._all( this._prepare('SELECT * FROM kvsub WHERE :now - lastAccess > :subscriptionTimeout'), {
                now,
                subscriptionTimeout
            });
             this._run( this._prepare('DELETE FROM kvsub WHERE :now - lastAccess > :subscriptionTimeout'), {
                now,
                subscriptionTimeout
            });
            for(const row of rows){
                delete this.activeSubscriptions[row.subscriptionId];
            }
        });
    }


  



    async createEvent(key,value, expireAfter){
        await this.init();

        value=JSON.stringify(value);
        const now = Date.now();
        const expiration = expireAfter ? now+expireAfter : 0;

        const eventTags=[];
      
        eventTags.push(["d",key]);
        if(expiration){
            if (expiration < now) throw "Invalid expiration time";
            eventTags.push(["expiration", ""+Math.floor(expiration /1000.0)]);
        }
        const event = {
            kind: 30078,
            created_at: Math.floor(now / 1000),
            tags: eventTags,
            content: value,
        };
        return event;
    }


    async getAsEvent(key, authorsPubKeys, relayUrls,  maxHistoryEntries = 10) {
        return this.get(key, authorsPubKeys, relayUrls,  maxHistoryEntries, true);
    }

    async setFromEvent(signedEvent, relays){
        await this.init();
        if (signedEvent.kind !== 30078) throw "Invalid event kind";
        if (!signedEvent.tags.find(t => t[0] === "d")) throw "Invalid event tag (d)";
        const key=signedEvent.tags.find(t => t[0] === "d")[1];

      

        const expirationTag=signedEvent.tags.find(t => t[0] === "expiration");
        let expiration;
        if (expirationTag)expiration=Number(expirationTag[1])*1000;
        else expiration=0;
        const value=signedEvent.content;
        const pubKey=signedEvent.pubkey;
        const timestamp=Number(signedEvent.created_at)*1000;
        const now=Date.now();

        if (!verifyEvent(signedEvent)) throw "Invalid event";

        const stringifiedEvent = JSON.stringify(signedEvent);

        const submissionIds = [];
        // add to db
        this._transaction(async () => {
            this._run(this._prepare('INSERT OR REPLACE INTO kvpairs (id, key, value, timestamp, expiration, authorPubKey, localTimestamp,  signedEvent) VALUES (:id, :key, :value, :timestamp, :expiration, :authorPubKey, :localTimestamp,  :signedEvent)'), {
                id: signedEvent.id,
                key,
                value,
                timestamp: timestamp,
                expiration: expiration,
                authorPubKey: pubKey,
                localTimestamp: now,
                signedEvent: stringifiedEvent
            });
            for (const relay of relays) {
                const submissionId = Utils.fastId(signedEvent.id + "@" + relay);
                submissionIds.push(submissionId);
                this._run(this._prepare('INSERT OR REPLACE INTO eventSubmissionQueue (id, event, relayUrl) VALUES (:id, :event, :relayUrl)'), {
                    id: submissionId,
                    event: stringifiedEvent,
                    relayUrl: relay,
                    timestamp: Date.now()
                });
            }
        });


        return {
            status: true,
            submissionIds: submissionIds,
            authorPriv: "",
            author: pubKey,
            key: key,
            value: JSON.parse(value)
        };
    }

    async set(key, value, privKey, relays, expireAfter){
        await this.init();
      
        try{
            if(!privKey){
                privKey=generateSecretKey();
                privKey = Buffer.from(privKey).toString('hex');
                console.log("Generated new privKey",privKey)
            }
            const privKeyBuffer = Buffer.from(privKey,'hex');
   
            const signedEvent = finalizeEvent(await this.createEvent(key, value, expireAfter), privKeyBuffer);
            console.log("Created event",signedEvent);

            const out=await this.setFromEvent(signedEvent, relays);
            out.authorPriv=privKey;
            return out;

        }catch(e){
            console.error(e);
            return {
                status: false,
                error:e,
                submissionIds: []
            };
        }
    }

    async submitPendingEvents(){
        try{
            let submissions =  this._all( this._prepare('SELECT * FROM eventSubmissionQueue WHERE failureCount <= :maxSubmissionFailures ORDER BY timestamp ASC', true), {
                maxSubmissionFailures: this.MAX_SUBMISSION_FAILURES
            });

            if(submissions.length===0){
                // console.log("Nothing to submit. Skip");
                return;
            }

            const res=await Promise.allSettled(submissions.map(async submission => {
                const event = JSON.parse(submission.event);
                try{
                    const relay = await this.getRelay(submission.relayUrl);
                    if (!relay) throw "Invalid relay";
                    await relay.relay.publish(event);
                    this._run( this._prepare('DELETE FROM eventSubmissionQueue WHERE id=:id'), {
                        id: submission.id
                    });
                }catch(e){
                    this._run( this._prepare('UPDATE eventSubmissionQueue SET failureCount=failureCount+1 WHERE id=:id'), {
                        id: submission.id
                    });
                    console.error("Failed to submit event",e);
                    throw e;
                }
                return submission;
            }));
            console.log(res);  
        }catch(e){
            console.error(e);
        }     
    }

    async checkStatus(submissionIds){
        const out=[];
        for(const submissionId of submissionIds){
            const submission= this._get( this._prepare('SELECT * FROM eventSubmissionQueue WHERE id=:id'), {
                id: submissionId
            });
            if(submission){
                if (submission.failureCount > this.MAX_SUBMISSION_FAILURES){
                    out.push("failed");
                }else{
                    out.push("pending");
                }
            }else{
                out.push("success or expired");
            }
        }
        return {
            status: out
        };
    }

    

    async close() {
        this.closed=true;
        while(this.looping){
            await new Promise(resolve=>setTimeout(resolve,1000));
        }
        clearTimeout(this.loopTimer);
        await this.cleanupLoop(0, 0);
    }

    async cleanExpiredSubmissions(submissionTimeout = 1000 * 60 * 60) {
        const now = Date.now();   
         this._run( this._prepare('DELETE FROM eventSubmissionQueue WHERE :now - timestamp > :submissionTimeout OR failureCount > :maxSubmissionFailures'), {
            now,
            submissionTimeout,
            maxSubmissionFailures: this.MAX_SUBMISSION_FAILURES
        });
    }

    async deleteOrphanPairs(orphanPairTimeout= 1000 * 60 * 5 ) {
        const now = Date.now();
        this._run( this._prepare(
            `DELETE FROM kvpairs WHERE id NOT IN (SELECT pairId FROM kvpairsXsub) AND :now - localTimestamp > :orphanPairTimeout`
            ), {
            now,
            orphanPairTimeout
        });       
    }

    async deleteExpiredPairs() {
        const now = Date.now();
        this._run( this._prepare(
            `DELETE FROM kvpairs WHERE expiration > 0 AND expiration < :now`
            ), {
            now
        });

    }

    async cleanupLoop(relayTimeout = 1000 * 60 * 30,
         subscriptionTimeout = 1000 * 60 * 5, submissionTimeout = 1000 * 60 * 5,
         orphanPairTimeout= 1000 * 60 * 5 ) {
        await Promise.all([
            this.cleanExpiredRelays(relayTimeout),
            this.clearExpiredSubscriptions(subscriptionTimeout),
            this.cleanExpiredSubmissions(submissionTimeout),
            this.deleteOrphanPairs(orphanPairTimeout),
            this.deleteExpiredPairs()
        ]);
    }




    // slite wrapper stuff
     _prepare(sql, silent = false) {
        if (!silent) console.log(sql);
        const q = this.db.prepare(sql);
        q.debug = sql;
        q.silent = silent;
        return q;
    }

     _all(query, params = {}) {
        if (!query.silent) console.log("All query", query.debug, params);
        return ( query.all(params));
    }

     _get(query, params = {}) {
        if (!query.silent) console.log("Get query", query.debug, params);
        return ( query.get(params));
    }

     _run(query, params = {}) {
        if (!query.silent) console.log("Run query", query.debug, params);
        return ( query.run(params));
    }


     _transaction(transaction) {
        const _tx=this.db.transaction(()=>{
            transaction();        
        });
        _tx();
        
    }
} 
