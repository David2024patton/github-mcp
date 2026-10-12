import {serveRtc} from '../../src/rtc/entry.js';
export default (req,res)=>serveRtc(req,res,req.query?.name==='_batch'?'batch':'tool');
