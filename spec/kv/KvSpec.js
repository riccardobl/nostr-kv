import KVStore from "../../src/KVStore.js";

describe("KV", () => {
     
    let relays;
    let keyPrefix;
    let registeredInstances=[];
    const kvOptions={};
    const _r=(i)=>{
        registeredInstances.push(i);
        return i;
    };
    const _waitConfirmation=async (d1, submissionIds, timeout)=>{
        const t=Date.now();
        let success=false;
        while (!timeout||Date.now() - t < timeout) {
            const status = await d1.checkStatus(submissionIds, relays);
            success = status.status.every((s) => s.startsWith("success "));
            if (!success) {
                await new Promise((resolve) => setTimeout(resolve, 1000));
            } else {
                break;
            }
        }
        return success;
    }
    afterEach(()=>{
        registeredInstances.forEach((i)=>i.close());
    });

    beforeEach(() => {    
        kvOptions.useStrictSubscriptions = true;

        jasmine.DEFAULT_TIMEOUT_INTERVAL = 60000;    
        relays = ["wss://nostr.rblb.it:7777"];
        keyPrefix="test"+Date.now()+"_"+Math.random()+"_";
        registeredInstances=[];
        return new Promise((resolve) => {
            setTimeout(resolve, 100);  
        });
    });

    it("should set a value and get it back immediately", async () => {
        const db = _r(new KVStore(kvOptions,":memory:"));

        const key = keyPrefix + "setAndGet";
        const value = Math.random() + "";
        const writeRes = await db.set(key, value, undefined, relays, 1000 * 60);
        // console.log("WriteRes: ", writeRes);
        expect(writeRes.status).toEqual(true);
        expect(writeRes.error).toBeUndefined();
        expect(writeRes.value).toEqual(value);
        const readRes = await db.get(key, undefined, relays);
        // console.log("ReadRes: ", readRes);
        expect(readRes.error).toBeUndefined();
        expect(readRes.value).toEqual(value);
        expect(readRes.author).toEqual(writeRes.author);
    });

    it("should set a value and wait for successful propagation in less than 5 seconds", async () => {
        const db = _r(new KVStore(kvOptions, ":memory:"));
        const key=keyPrefix+"propagate";
        const value=Math.random()+"";
        const writeRes = await db.set(key, value, undefined, relays, 1000 * 60);
        // console.log("WriteRes: ", writeRes);
        expect(writeRes.status).toEqual(true);
        expect(writeRes.error).toBeUndefined();
        expect(writeRes.value).toEqual(value);
        expect(writeRes.submissionIds).toBeDefined();
        expect(writeRes.submissionIds.length).toBeGreaterThan(0);
             
        const success=await _waitConfirmation(db, writeRes.submissionIds, 1000 * 5);
        expect(success).toEqual(true);

    });

    it("should set a value and get it back from another instance", async () => {

        const db = _r(new KVStore(kvOptions, ":memory:"));
        const db2 = _r(new KVStore(kvOptions, ":memory:"));
        const key = keyPrefix + "setAndGetElsewhere";
        const value = Math.random() + "";
        const writeRes = await db.set(key, value, undefined, relays, 1000 * 60);
        // console.log("WriteRes3: ", writeRes);
        expect(writeRes.status).toEqual(true);
        expect(writeRes.error).toBeUndefined();
        expect(writeRes.value).toEqual(value);
        
     
        await _waitConfirmation(db, writeRes.submissionIds);
        
        const readRes = await db2.get(key, undefined, relays);
        // console.log("ReadRes3: ", readRes);
        expect(readRes.error).toBeUndefined();
        expect(readRes.value).toEqual(value);
        expect(readRes.author).toEqual(writeRes.author);
    });

    it("should set a value that will expire after 4 s on all instances", async () => {


        const db = _r(new KVStore(kvOptions, ":memory:"));
        const db2 = _r(new KVStore(kvOptions, ":memory:"));
        const db3 = _r(new KVStore(kvOptions, ":memory:"));

        const key = keyPrefix + "setAndExpire";
        const value = Math.random() + "";
        const writeRes = await db.set(key, value, undefined, relays, 5000);
        // console.log("WriteRes: ", writeRes);
        expect(writeRes.status).toEqual(true);
        expect(writeRes.error).toBeUndefined();
        expect(writeRes.value).toEqual(value);

        let readRes = await db.get(key, undefined, relays);
        expect(readRes.error).toBeUndefined();
        expect(readRes.value).toEqual(value);

        readRes = await db2.get(key, undefined, relays);
        expect(readRes.error).toBeUndefined();
        expect(readRes.value).toEqual(value);

        // wait 2 second
        // console.log("Wait...");
        await new Promise((resolve) => setTimeout(resolve, 6000));

        let readRes2 = await db.get(key, undefined, relays);
        expect(readRes2.error).toBeUndefined();
        expect(readRes2.value).toBeUndefined();

        readRes2 = await db2.get(key, undefined, relays);
        expect(readRes2.error).toBeUndefined();
        expect(readRes2.value).toBeUndefined();

        readRes2 = await db3.get(key, undefined, relays);
        expect(readRes2.error).toBeUndefined();
        expect(readRes2.value).toBeUndefined();
    });

    it("should receive the updated value from another instance", async () => {


        const d1 = _r(new KVStore(kvOptions, ":memory:"));
        const d2 = _r(new KVStore(kvOptions, ":memory:"));
        const key=keyPrefix+"update";
        const value=Math.random()+"";
        const writeRes = await d1.set(key, value, undefined, relays, 1000 * 60);
        expect(writeRes.status).toEqual(true);
        expect(writeRes.error).toBeUndefined();
        expect(writeRes.value).toEqual(value);       
        await _waitConfirmation(d1, writeRes.submissionIds);

        const readRes = await d2.get(key, undefined, relays);
        expect(readRes.error).toBeUndefined();
        expect(readRes.value).toEqual(value);
        const newValue=Math.random()+""+"-2";

        const updateRes = await d1.set(key, newValue, undefined, relays, 1000 * 60);
        expect(updateRes.status).toEqual(true);
        expect(updateRes.error).toBeUndefined();
        expect(updateRes.value).toEqual(newValue);
        await _waitConfirmation(d1, updateRes.submissionIds);

        // wait some time
        await new Promise((resolve)=>setTimeout(resolve, 10000));
        const readRes2 = await d2.get(key, undefined, relays);
        expect(readRes2.error).toBeUndefined();
        expect(readRes2.value).toEqual(newValue);
        await new Promise((resolve) => setTimeout(resolve, 10000));

        const readRes3 = await d1.get(key, undefined, relays);
        expect(readRes3.error).toBeUndefined();
        expect(readRes3.value).toEqual(newValue);

        
    });

    it("should set the same key with different values from different instances and get the latest value", async () => {

        const instances=[];
        for(let i=0;i<10;i++){
            instances.push(_r(new KVStore(kvOptions, ":memory:")));
        }
        const instance0 = _r(new KVStore(kvOptions, ":memory:"));
        const key = keyPrefix + "multiSet";

        let lastValue;
        for(const instance of instances){
            const value = Math.random() +"_"+ Date.now();
            lastValue = value;

            const writeRes = await instance.set(key, value, undefined, relays, 1000 * 60);
            expect(writeRes.status).toEqual(true);
            expect(writeRes.error).toBeUndefined();
            expect(writeRes.value).toEqual(lastValue);
            // wait
            await _waitConfirmation(instance, writeRes.submissionIds);
            

        }
        let readRes = await instance0.get(key, undefined, relays);
        expect(readRes.error).toBeUndefined();
        expect(readRes.value).toEqual(lastValue);

        // wait some time
        await new Promise((resolve)=>setTimeout(resolve, 2000));

        for (let i = 0; i < instances.length;i++){
            readRes = await instances[i].get(key, undefined, relays);
            expect(readRes.error).toBeUndefined();
            expect(readRes.value).toEqual(lastValue);
        }



    });

    it("should isolate different authors", async () => {

        const d1 = _r(new KVStore(kvOptions, ":memory:"));
        const d2 = _r(new KVStore(kvOptions, ":memory:"));
        const d3 = _r(new KVStore(kvOptions, ":memory:"));

        const key=keyPrefix+"isolate";
        const valueA=Math.random()+"-1";
        const valueB=Math.random()+"-2";
        const valueC=Math.random()+"-3";

        const writeResA = await d1.set(key, valueA, undefined, relays, 1000 * 60);
        const author1=writeResA.author;
        const author1Priv = writeResA.authorPriv;

        await  _waitConfirmation(d1, writeResA.submissionIds);

        const writeResB = await d2.set(key, valueB, undefined, relays, 1000 * 60);
        const author2=writeResB.author;

        await  _waitConfirmation(d2, writeResB.submissionIds);

        const readByAuthor1OnInstance1 = await d1.get(key, [author1], relays);
        expect(readByAuthor1OnInstance1.error).toBeUndefined();
        expect(readByAuthor1OnInstance1.value).toEqual(valueA);

        const readByAuthor2OnInstance1 = await d1.get(key, [author2], relays);
        expect(readByAuthor2OnInstance1.error).toBeUndefined();
        expect(readByAuthor2OnInstance1.value).toEqual(valueB);
        
        const readByAnyAuthorOnInstance1 = await d1.get(key, "*", relays);
        expect(readByAnyAuthorOnInstance1.error).toBeUndefined();
        expect(readByAnyAuthorOnInstance1.value).toEqual(valueB);


        await new Promise((resolve)=>setTimeout(resolve, 2000));

        const readByAuthor1OnInstance2 = await d2.get(key, [author1], relays);
        expect(readByAuthor1OnInstance2.error).toBeUndefined();
        expect(readByAuthor1OnInstance2.value).toEqual(valueA);

        const readByAnyAuthorOnInstance2 = await d2.get(key, ["*"], relays);
        expect(readByAnyAuthorOnInstance2.error).toBeUndefined();
        expect(readByAnyAuthorOnInstance2.value).toEqual(valueB);

        const readByAuthor2OnInstance2 = await d2.get(key, [author2], relays);
        expect(readByAuthor2OnInstance2.error).toBeUndefined();
        expect(readByAuthor2OnInstance2.value).toEqual(valueB);

       

        const readByAnyAuthorOnInstance3 = await d3.get(key, ["*"], relays);
        expect(readByAnyAuthorOnInstance3.error).toBeUndefined();
        expect(readByAnyAuthorOnInstance3.value).toEqual(valueB);


        const readByAuthor2OnInstance3 = await d3.get(key, [author2], relays);
        expect(readByAuthor2OnInstance3.error).toBeUndefined();
        expect(readByAuthor2OnInstance3.value).toEqual(valueB);

        const readByAuthor1OnInstance3 = await d3.get(key, [author1], relays);
        expect(readByAuthor1OnInstance3.error).toBeUndefined();
        expect(readByAuthor1OnInstance3.value).toEqual(valueA);

        

        const writeResC = await d1.set(key, valueC, author1Priv, relays, 1000 * 60);
        expect(writeResC.status).toEqual(true);
        expect(writeResC.error).toBeUndefined();
        expect(writeResC.authorPriv).toEqual(author1Priv);
        expect(writeResC.author).toEqual(author1);

        const readByAuthor3OnInstance1 = await d1.get(key, [author1], relays);
        expect(readByAuthor3OnInstance1.error).toBeUndefined();
        expect(readByAuthor3OnInstance1.value).toEqual(valueC);
        await _waitConfirmation(d1, writeResB.submissionIds);

        await new Promise((resolve) => setTimeout(resolve, 2000));

        const readByAuthor3OnInstance2 = await d2.get(key, [author1], relays);
        expect(readByAuthor3OnInstance2.error).toBeUndefined();
        expect(readByAuthor3OnInstance2.value).toEqual(valueC);

        const readByAuthor3OnInstance3 = await d3.get(key, [author1], relays);
        expect(readByAuthor3OnInstance3.error).toBeUndefined();
        expect(readByAuthor3OnInstance3.value).toEqual(valueC);
        
    });
});