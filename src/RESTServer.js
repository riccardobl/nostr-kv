import Express from 'express';
import KVStore from './KVStore.js';
import Cors from 'cors';
import Https from 'https';
export default class RestServer {

    KV = undefined;
    APP = undefined;
    SERVER = undefined;
    BANNER = {};
    INDEX = "";
    DEFAULT_RELAYS = [];

    constructor(kv, banner, index, sslOptions) {
        this.KV = kv;
        this.BANNER = banner;
        this.INDEX = index;
        this.DEFAULT_RELAYS = ["wss://nostr.rblb.it:7777"];
        this.APP = Express();
        this.APP.use(Express.json());
        this.APP.use(Cors());

        this.APP.post('/api/kv/set', this.set.bind(this));
        this.APP.post('/api/kv/get', this.get.bind(this));

        this.APP.post('/api/propagation/check', this.check.bind(this));

        this.APP.post('/api/event/create', this.eventCreate.bind(this));
        this.APP.post('/api/event/set', this.eventSubmit.bind(this));
        this.APP.post('/api/event/get', this.eventGet.bind(this));

        if (sslOptions) {
            this.SERVER = Https.createServer(sslOptions, this.APP);
        } else {
            this.SERVER = this.APP;
        }


        if (this.INDEX) {
            this.APP.get('/', (req, res) => {
                res.send(this._repl(req, res, this.INDEX));
            });
        }
    }

    _repl(req, res, v) {
        v = v.replace(/%IP%/g, req.ip);
        v = v.replace(/%METHOD%/g, req.method);
        return v;
    };

    async start(port) {
        const instance = this.SERVER.listen(port, () => {
            const listeningOnPort = instance.address().port;
            console.log('Server running on port ' + listeningOnPort);
        });
    }

    async stop() {
        this.SERVER.close();
    }

    async addBanner(req, res, result) {

        for (const key in this.BANNER) {
            const v = this.BANNER[key];
            result[key] = this._repl(req, res, v);
        }
        return result;
    }

    async catchall(req, res) {
        const action = req.body.action;
        if (action === "set") {
            return this.set(req, res);
        } else if (action === "get") {
            return this.get(req, res);
        } else if (action == "eventCreate") {
            return this.eventCreate(req, res);
        } else if (action == "eventSet") {
            return this.eventSubmit(req, res);
        } else {
            res.status(400).json(await this.addBanner({ error: "Invalid action" }));
        }
    }

    async eventCreate(req, res) {
        const key = req.body.key;
        const value = req.body.value;
        const expireAfter = req.body.expireAfter;
        try {
            const result = await this.KV.createEvent(key, value, expireAfter);
            res.json(result);
        } catch (e) {
            console.error(e);
            res.status(500).json(await this.addBanner(req, res, { error: "" + e }));
        }
    }

    async eventGet(req, res) {
        const key = req.body.key;
        const authors = req.body.authors || ["*"];
        const relays = req.body.relays || this.DEFAULT_RELAYS;
        const maxHistory = req.body.maxHistory;
        try {
            const result = await this.KV.getAsEvent(key, authors, relays,  maxHistory);
            res.json(await this.addBanner(req, res, result));
        } catch (e) {
            console.error(e);
            res.status(500).json(await this.addBanner(req, res, { error: "" + e }));
        }
    }

    async eventSubmit(req, res) {
        const signedEvent = req.body.signedEvent;
        const relays = req.body.relays || this.DEFAULT_RELAYS;
        try {
            const result = await this.KV.setFromEvent(signedEvent, relays);
            res.json(await this.addBanner(req, res, result));
        } catch (e) {
            console.error(e);
            res.status(500).json(await this.addBanner(req, res, { error: "" + e }));
        }
    }


    async set(req, res) {
        const key = req.body.key;
        const value = req.body.value;
        const authorPrivKey = req.body.authorPrivKey;
        const relays = req.body.relays || this.DEFAULT_RELAYS;
        const expireAfter = req.body.expireAfter;
        try {
            const result = await this.KV.set(key, value, authorPrivKey, relays, expireAfter);
            res.json(await this.addBanner(req, res, result));
        } catch (e) {
            console.error(e);
            res.status(500).json(await this.addBanner(req, res, { error: "" + e }));
        }
    }

    async get(req, res) {
        const key = req.body.key;
        const authors = req.body.authors || ["*"];
        const relays = req.body.relays || this.DEFAULT_RELAYS;
        const maxHistory = req.body.maxHistory;

        try {
            const result = await this.KV.get(key, authors, relays,  maxHistory);
            res.json(await this.addBanner(req, res, result));
        } catch (e) {
            console.error(e);
            res.status(500).json(await this.addBanner(req, res, { error: "" + e }));
        }
    }


    async check(req, res) {
        const submissionIds = req.body.submissionIds;
        try {
            const result = await this.KV.checkStatus(submissionIds);
            res.json(await this.addBanner(req, res, result));
        } catch (e) {
            console.error(e);
            res.status(500).json(await this.addBanner(req, res, { error: "" + e }));
        }
    }
}