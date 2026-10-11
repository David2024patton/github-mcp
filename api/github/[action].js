import { handleGithub } from '../../src/github/routes.js';
export default (req, res) => handleGithub(req.query?.action, req, res);
