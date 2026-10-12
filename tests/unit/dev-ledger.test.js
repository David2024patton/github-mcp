import { runDevLedgerContract } from '../../test/contract/dev-ledger-contract.js';
import { createFakeDb } from '../../test/helpers/fake-db.js';
runDevLedgerContract('in-memory fake', async()=>{const db=createFakeDb();await db.initSchema();return db;});
