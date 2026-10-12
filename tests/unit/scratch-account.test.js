import {createFakeDb} from '../../test/helpers/fake-db.js';
import {runScratchAccountContract} from '../../test/contract/scratch-account-contract.js';
runScratchAccountContract('fake database',async()=>{const db=createFakeDb();await db.initSchema();return db;});
