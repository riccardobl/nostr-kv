import Express from 'express';
import Cors from 'cors';
import Https from 'https';
import Yup from 'yup';

export default class RestServer {   
    kv = undefined;
    app = undefined;
    server = undefined;
    banner = {};
    index = "";
    defaultRelays = [];
    
    constructor(kv, banner, index, sslOptions, defaultRelays) {
        this.kv = kv;
        this.banner = banner;
        this.index = index;
        this.defaultRelays = defaultRelays;
        this.app = Express();
        this.app.use(Express.json({ type: '*/*' }));

        this.app.use(Cors());

        this.app.post('/api/kv/set', this.set.bind(this));
        this.app.post('/api/kv/get', this.get.bind(this));

        this.app.post('/api/propagation/check', this.check.bind(this));

        this.app.post('/api/event/create', this.eventCreate.bind(this));
        this.app.post('/api/event/set', this.eventSubmit.bind(this));
        this.app.post('/api/event/get', this.eventGet.bind(this));

        if (sslOptions) {
            this.server = Https.createServer(sslOptions, this.app);
        } else {
            this.server = this.app;
        }


        if (this.index) {
            this.app.get('/', async (req, res) => {
                res.send(await this._repl(req, res, this.index));
            });
        }
    }

    async _repl(req, res, v) {
        v = v.replace(/%IP%/g, req.ip);
        v = v.replace(/%METHOD%/g, req.method);
        
        const requiredStats = v.match(/%stats\.[a-zA-Z0-9_]+%/g);
        if (requiredStats) {
            const stats = await this.kv.getStats();
            for (const statKey in stats){
                v = v.replace(new RegExp(`%stats.${statKey}%`, 'g'), stats[statKey]);                
            }
        }
        return v;
    };

    async start(port) {
        const instance = this.server.listen(port, () => {
            const listeningOnPort = instance.address().port;
            console.info('Server running on port ' + listeningOnPort);
        });
    }

    async stop() {
        this.server.close();
    }

    async addBanner(req, res, result) {
        for (const key in this.banner) {
            const v = this.banner[key];
            result[key] = await this._repl(req, res, v);
        }
        return result;
    }

    

    async eventCreate(req, res) {
       
        try {
            const schema = Yup.object().shape({
                key: Yup.string().required(),
                value: Yup.string(),
                expireAfter: Yup.number().integer().positive().default(0)
            });
            const { key, value, expireAfter } = await schema.validate(req.body);
            const result = await this.kv.createEvent(key, value, expireAfter);
            res.json(result);
        } catch (e) {
            console.log("Request",req);
            console.error(e);
            res.status(500).json(await this.addBanner(req, res, { error: "" + e }));
        }
    }

    async eventGet(req, res) {
       
        try {
            const schema = Yup.object().shape({
                key: Yup.string().required(),
                authors: Yup.array().of(Yup.string()).min(1).default(["*"]),
                relays: Yup.array().of(Yup.string()).default(this.defaultRelays),
                maxHistory: Yup.number().integer().positive().default(10)
            });
            const { key, authors, relays, maxHistory } = await schema.validate(req.body);
            const result = await this.kv.getAsEvent(key, authors, relays,  maxHistory);
            res.json(await this.addBanner(req, res, result));
        } catch (e) {
            console.log("Request", req);
            console.error(e);
            res.status(500).json(await this.addBanner(req, res, { error: "" + e }));
        }
    }

    async eventSubmit(req, res) {
      
        try {
            const schema = Yup.object().shape({
                signedEvent: Yup.object().required(),
                relays: Yup.array().of(Yup.string()).default(this.defaultRelays),
            });
            const { signedEvent, relays } = await schema.validate(req.body);
            const result = await this.kv.setFromEvent(signedEvent, relays);
            res.json(await this.addBanner(req, res, result));
        } catch (e) {
            console.log("Request", req);
            console.error(e);
            res.status(500).json(await this.addBanner(req, res, { error: "" + e }));
        }
    }


    async set(req, res) {
      
        
        try {
            const schema = Yup.object().shape({
                key: Yup.string().required(),
                value: Yup.string(),
                authorPrivKey: Yup.string().required(),
                relays: Yup.array().of(Yup.string()).default(this.defaultRelays),
                expireAfter: Yup.number().integer().positive().default(0)
            });
            const { key, value, authorPrivKey, relays, expireAfter } = await schema.validate(req.body);
            const result = await this.kv.set(key, value, authorPrivKey, relays, expireAfter);
            res.json(await this.addBanner(req, res, result));
        } catch (e) {
            console.log("Request", req);
            console.error(e);
            res.status(500).json(await this.addBanner(req, res, { error: "" + e }));
        }
    }

    async get(req, res) {
      

        try {
            const schema = Yup.object().shape({
                key: Yup.string().required(),
                authors: Yup.array().of(Yup.string()).min(1).default(["*"]),
                relays: Yup.array().of(Yup.string()).default(this.defaultRelays),
                maxHistory: Yup.number().integer().positive().default(10)
            });
            const { key, authors, relays, maxHistory } = await schema.validate(req.body);
            const result = await this.kv.get(key, authors, relays,  maxHistory);
            res.json(await this.addBanner(req, res, result));
        } catch (e) {
            console.log("Request", req);
            console.error(e);
            res.status(500).json(await this.addBanner(req, res, { error: "" + e }));
        }
    }


    async check(req, res) {
      
        try {
            const schema = Yup.object().shape({
                submissionIds: Yup.array().of(Yup.string()).required()
            });
            const { submissionIds } = await schema.validate(req.body);
            const result = await this.kv.checkStatus(submissionIds);
            res.json(await this.addBanner(req, res, result));
        } catch (e) {
            console.log("Request", req);
            console.error(e);
            res.status(500).json(await this.addBanner(req, res, { error: "" + e }));
        }
    }
}