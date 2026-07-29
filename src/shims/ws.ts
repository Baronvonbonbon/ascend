// Browser stub for the Node `ws` package.
//
// pine-rpc's package root re-exports both the browser-side PineProvider and a Node-side
// JsonRpcServer daemon; the latter imports `ws`, which does not exist in a browser and breaks
// the bundle. We only ever construct PineProvider, so the server half is dead code — this stub
// satisfies the import so the bundler can tree-shake around it.
//
// If either of these is ever actually called, that is a real bug: it means browser code reached
// the daemon path, so they throw rather than failing silently.

const unavailable = (what: string) => {
  throw new Error(`${what} is a Node-only part of pine-rpc and is not available in the browser`);
};

export class WebSocketServer { constructor() { unavailable("WebSocketServer"); } }
export class WebSocket { constructor() { unavailable("WebSocket (ws)"); } }
export default { WebSocketServer, WebSocket };
