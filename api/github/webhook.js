import { handleWebhook } from '../../src/github/routes.js';

// The signature covers the exact bytes GitHub sent, so the body must not be parsed first.
export const config = { api: { bodyParser: false } };
export default (req, res) => handleWebhook(req, res);
