import KVStore from './KVStore.js';
import RESTServer from './RESTServer.js';
import goodbye from 'graceful-goodbye';
import Fs from 'fs';
const _DEFAULT_BANNER = JSON.stringify({
    _banner: "Self hosted nostr-kv instance",
    _ip: "%IP%",
});
const _DEFAULT_INDEX=`
<!DOCTYPE html>
<html>
    <head>
        <title>Nostr-KV</title>
    </head>
    <body>
        <h1>Nostr-KV</h1>
        <p>Self hosted Nostr-KV instance</p>
    </body>
</html>
`;
async function main(){
   
    const PORT = process.env.PORT || 3000;
    const DB_PATH = process.env.DB_PATH || ':memory:';
    const BANNER = JSON.parse(process.env.BANNER || _DEFAULT_BANNER);
    const INDEX = process.env.INDEX || _DEFAULT_INDEX;
    const SSL_CERT = process.env.SSL_CERT || null;
    const SSL_KEY = process.env.SSL_KEY || null;
    const USE_STRICT_SUBSCRIPTIONS = ["true","1"].includes((process.env.USE_STRICT_SUBSCRIPTIONS || "1").toLowerCase());
    
    const kvOptions={
        useStrictSubscriptions:USE_STRICT_SUBSCRIPTIONS
    };

    const sslOptions = SSL_CERT&&SSL_KEY?{
        key: Fs.readFileSync(SSL_KEY),
        cert: Fs.readFileSync(SSL_CERT)
    }:undefined;

    const kv = new KVStore(kvOptions, DB_PATH);
    const server = new RESTServer(kv, BANNER, INDEX, sslOptions);
    await server.start(PORT);

    goodbye(()=>{
        server.stop();
        kv.close();
    });
}

main();