// In-process request/response doubles for the OAuth handlers (no network). Shapes match what Vercel hands a function.
export function request(method, data, headers = {}) {
  return {
    method, headers, body: method === 'GET' ? undefined : data, query: method === 'GET' ? data : undefined,
    socket: { remoteAddress: '198.51.100.1' }
  };
}

export function response() {
  return {
    statusCode: 200, headers: {}, body: null, ended: false,
    setHeader(k, v) { this.headers[k] = v; return this; },
    status(s) { this.statusCode = s; return this; },
    send(v) { this.body = v; return this; },
    json(v) { this.body = JSON.stringify(v); return this; },
    end() { this.ended = true; return this; }
  };
}

export async function call(handler, req) {
  const res = response();
  await handler(req, res);
  return res;
}

export const json = (res) => JSON.parse(res.body);
