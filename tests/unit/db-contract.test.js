import { createFakeDb } from '../../test/helpers/fake-db.js';
import { runDbContract } from '../../test/contract/db-contract.js';

runDbContract('in-memory fake', async () => createFakeDb());
