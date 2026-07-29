import WebSocket from "ws";
import { writeFileSync } from "node:fs";
const r = await fetch("http://localhost:9224/json/new?https://ascendyendor00.dot.li", { method: "PUT" });
const { webSocketDebuggerUrl } = await r.json();
const ws = new WebSocket(webSocketDebuggerUrl);
let id=0; const p=new Map();
const send=(m,params={})=>new Promise(res=>{const i=++id;p.set(i,res);ws.send(JSON.stringify({id:i,method:m,params}));});
ws.on("message",d=>{const m=JSON.parse(d.toString()); if(m.id&&p.has(m.id)){p.get(m.id)(m.result);p.delete(m.id);}});
await new Promise(res=>ws.on("open",res));
await send("Runtime.enable"); await send("Page.enable");
const ev=async e=>(await send("Runtime.evaluate",{expression:e,returnByValue:true,awaitPromise:true})).result?.value;

await new Promise(res=>setTimeout(res,6000));
// take the trusted-provider fast path instead of waiting on a full relay-chain sync
const clicked = await ev(`(()=>{const b=[...document.querySelectorAll("button,div,a")].find(e=>/Use Trusted Provider/i.test(e.textContent||"")); if(b){b.click();return true} return false})()`);
console.log("clicked trusted provider:", clicked);

let found = false;
for (let i=0;i<24;i++){
  await new Promise(res=>setTimeout(res,5000));
  // the app renders inside an iframe on the gateway
  const info = await ev(`(()=>{
    const f=[...document.querySelectorAll("iframe")];
    for(const fr of f){ try{ const d=fr.contentDocument; if(d&&d.getElementById("splash-banner")) return "iframe"; }catch(e){ return "iframe-cross-origin"; } }
    if(document.getElementById("splash-banner")) return "top";
    return "";
  })()`);
  if (info) { console.log(`app shell found (${info}) after ~${(i+1)*5+6}s`); found = true; break; }
}
if (!found) console.log("app shell not detected within ~2min");
console.log("status text:", await ev(`(document.body.innerText||"").split("\\n").filter(Boolean).slice(0,6).join(" | ")`));
const shot = await send("Page.captureScreenshot",{format:"png"});
if (shot?.data) { writeFileSync("/tmp/claude-1000/-home-k-Documents-ascend/4356f691-a252-4358-b049-39a78ed968ce/scratchpad/live2.png", Buffer.from(shot.data,"base64")); console.log("screenshot saved"); }
process.exit(0);
