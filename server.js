// Evilgang the Game — çevrimiçi sunucu (bağımlılıksız: Node.js >= 18, yerleşik http + elle RFC6455 WebSocket)
// Görevler: oyunu web sitesi olarak sunar, özel lobiler (oda kodu), lobi durumu, maç başlatma, kilitli adım (lockstep) girdi zaman çizelgesi,
// ping, kopma/yeniden bağlanma, hükmen galibiyet, ev sahibi devri, temel korumalar.
'use strict';
const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const PORT=+process.env.PORT||8080,LAG=+process.env.LAG_MS||0;// LAG_MS: test için yapay gecikme (her mesaj için)
const PUB=__dirname;// ---------------- statik site ----------------
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.png':'image/png','.ico':'image/x-icon','.json':'application/json'};
const server=http.createServer((req,res)=>{let u=decodeURIComponent((req.url||'/').split('?')[0]);if(u==='/health'){res.writeHead(200,{'content-type':'text/plain'});res.end('ok '+rooms.size);return}
  if(u==='/')u='/index.html';const fp=path.normalize(path.join(PUB,u));if(!fp.startsWith(PUB)){res.writeHead(403);res.end();return}
  fs.readFile(fp,(e,d)=>{if(e){res.writeHead(404);res.end('404');return}const h={'content-type':MIME[path.extname(fp)]||'application/octet-stream','cache-control':'no-cache'};
    if(/gzip/.test(req.headers['accept-encoding']||'')&&d.length>1024){h['content-encoding']='gzip';d=require('zlib').gzipSync(d)}res.writeHead(200,h);res.end(d)})});
// ---------------- minimal WebSocket (RFC 6455) ----------------
const GUID='258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
server.on('upgrade',(req,sock)=>{if((req.headers.upgrade||'').toLowerCase()!=='websocket'||!req.url.startsWith('/ws')){sock.destroy();return}
  const key=req.headers['sec-websocket-key'];if(!key){sock.destroy();return}
  const acc=crypto.createHash('sha1').update(key+GUID).digest('base64');
  sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+acc+'\r\n\r\n');sock.setNoDelay(true);
  const ip=(req.headers['x-forwarded-for']||sock.remoteAddress||'').split(',')[0].trim();const c=new Conn(sock,ip);c.start()});
class Conn{constructor(sock,ip){this.s=sock;this.ip=ip;this.buf=Buffer.alloc(0);this.alive=true;this.frag=null}
  start(){this.s.on('data',d=>this.onData(d));this.s.on('close',()=>this.onClose());this.s.on('error',()=>{try{this.s.destroy()}catch(e){}});onOpen(this)}
  onData(d){this.buf=Buffer.concat([this.buf,d]);if(this.buf.length>1<<20){this.close();return}
    for(;;){const b=this.buf;if(b.length<2)return;const fin=b[0]&128,op=b[0]&15,masked=b[1]&128;let len=b[1]&127,o=2;
      if(len===126){if(b.length<4)return;len=b.readUInt16BE(2);o=4}else if(len===127){if(b.length<10)return;len=Number(b.readBigUInt64BE(2));o=10}
      if(!masked){this.close();return}if(b.length<o+4+len)return;const mk=b.slice(o,o+4);o+=4;const pl=Buffer.alloc(len);for(let i=0;i<len;i++)pl[i]=b[o+i]^mk[i&3];this.buf=b.slice(o+len);
      if(op===8){this.close();return}if(op===9){this.sendRaw(pl,10);continue}if(op===10)continue;
      if(op===1||op===0){if(op===1&&!fin){this.frag=[pl];continue}if(op===0){(this.frag=this.frag||[]).push(pl);if(!fin)continue;const all=Buffer.concat(this.frag);this.frag=null;this.msg(all.toString('utf8'));continue}this.msg(pl.toString('utf8'))}}}
  msg(t){if(t.length>16000)return;let m;try{m=JSON.parse(t)}catch(e){return}if(LAG)setTimeout(()=>onMsg(this,m),LAG);else onMsg(this,m)}
  sendRaw(pl,op){if(this.s.destroyed)return;const n=pl.length;let h;if(n<126){h=Buffer.from([128|op,n])}else if(n<65536){h=Buffer.alloc(4);h[0]=128|op;h[1]=126;h.writeUInt16BE(n,2)}else{h=Buffer.alloc(10);h[0]=128|op;h[1]=127;h.writeBigUInt64BE(BigInt(n),2)}try{this.s.write(Buffer.concat([h,pl]))}catch(e){}}
  send(o){const s=JSON.stringify(o);const go=()=>this.sendRaw(Buffer.from(s,'utf8'),1);if(LAG)setTimeout(go,LAG);else go()}
  close(){if(this.closed)return;this.closed=1;try{this.sendRaw(Buffer.alloc(0),8);this.s.end()}catch(e){}setTimeout(()=>{try{this.s.destroy()}catch(e){}},500)}
  onClose(){if(this.gone)return;this.gone=1;onClose(this)}}
// ---------------- odalar ----------------
const rooms=new Map(),players=new Map();// token -> player
const ALPHA='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';function code(){let s;do{s='';for(let i=0;i<6;i++)s+=ALPHA[crypto.randomInt(ALPHA.length)]}while(rooms.has(s));return s}
const JOINRATE=new Map();function rateOk(ip){const n=Date.now(),a=(JOINRATE.get(ip)||[]).filter(t=>n-t<60000);if(a.length>=12){JOINRATE.set(ip,a);return false}a.push(n);JOINRATE.set(ip,a);return true}
const clean=s=>String(s||'').replace(/[<>&"'`\u0000-\u001f]/g,'').trim().slice(0,14)||'Oyuncu';
function onOpen(c){c.send({t:'hello',v:1})}
function pub(r){return{t:'lobby',code:r.code,host:r.host,mode:r.mode,rlen:r.rlen,map:r.map,locked:r.locked,inMatch:!!r.match,players:r.order.map(tk=>{const p=players.get(tk);return{id:p.id,nick:p.nick,ready:p.ready,ch:p.ch,sk:p.sk,ping:p.ping,on:!!p.c,host:p.token===r.host}})}}
function bcast(r,o,except){r.order.forEach(tk=>{const p=players.get(tk);if(p&&p.c&&p!==except)p.c.send(o)})}
function lobbyUpd(r){bcast(r,pub(r))}
function leaveRoom(p,why){const r=rooms.get(p.room);if(!r)return;r.order=r.order.filter(t=>t!==p.token);p.room=null;
  if(r.match&&r.match.fighters.includes(p.token)){const M=r.match,sl=M.fighters.indexOf(p.token);
    if(M.cfg.mode==='race'&&M.fighters.length>2){M.dead.add(sl);bcast(r,{t:'info',k:'gone',nick:p.nick});if(M.dead.size>=M.fighters.length)endMatch(r,'done');else{const mx=Math.max(...M.log.map(l=>l.length));fillDead(r,M,mx-1)}}
    else endMatch(r,'forfeit',p.token,why||'left')}
  if(!r.order.length){rooms.delete(r.code);return}if(r.host===p.token){r.host=r.order[0];bcast(r,{t:'info',k:'hostMoved',nick:players.get(r.host).nick})}lobbyUpd(r)}
function fillDead(r,M,f){M.dead.forEach(s=>{const L=M.log[s];while(L.length<=f){L.push([0,[]]);bcast(r,{t:'in',s,f:L.length-1,d:[0,[]]},null)}})}
function liveSlots(M){return M.fighters.map((t,i)=>i).filter(i=>!M.dead.has(i))}
function endMatch(r,reason,loserTok,why){const M=r.match;if(!M)return;r.match=null;clearInterval(M.tick);
  const res={t:'end',reason,why:why||'',loser:loserTok?players.get(loserTok)&&players.get(loserTok).id:null};bcast(r,res);r.order.forEach(t=>{const p=players.get(t);if(p)p.ready=false});lobbyUpd(r)}
function onMsg(c,m){const p=c.p;
  if(m.t==='ping'){c.send({t:'pong',c:m.c});if(p&&typeof m.rtt==='number')p.ping=Math.max(0,Math.min(9999,m.rtt|0));return}
  if(m.t==='hi'){// yeni ya da yeniden bağlanan oyuncu
    let q=m.token&&players.get(m.token);if(q&&q.c&&q.c!==c){try{q.c.close()}catch(e){}}
    if(!q){q={token:crypto.randomBytes(16).toString('hex'),id:crypto.randomBytes(4).toString('hex'),nick:clean(m.nick),room:null,ready:false,ch:0,sk:0,st:null,ping:0,c:null};players.set(q.token,q)}
    q.nick=clean(m.nick||q.nick);q.c=c;c.p=q;clearTimeout(q.dropT);c.send({t:'me',token:q.token,id:q.id,nick:q.nick});
    const r=q.room&&rooms.get(q.room);if(r){c.send(pub(r));if(r.match){const M=r.match;c.send({t:'start',cfg:M.cfg,resume:1,have:M.log.map(l=>l.length)});bcast(r,{t:'info',k:'back',nick:q.nick},q);M.paused=0}}return}
  if(!p)return;
  if(m.t==='create'){if(p.room)leaveRoom(p);const r={code:code(),host:p.token,order:[p.token],mode:'fight',rlen:0,map:0,locked:false,match:null,made:Date.now(),kicked:new Set()};rooms.set(r.code,r);p.room=r.code;p.ready=false;lobbyUpd(r);return}
  if(m.t==='join'){if(!rateOk(c.ip)){c.send({t:'err',k:'rate'});return}const r=rooms.get(String(m.code||'').toUpperCase().trim());
    if(!r){c.send({t:'err',k:'noroom'});return}if(r.kicked.has(p.token)){c.send({t:'err',k:'kicked'});return}if(r.locked){c.send({t:'err',k:'locked'});return}if(r.order.length>=8){c.send({t:'err',k:'full'});return}
    if(p.room&&p.room!==r.code)leaveRoom(p);if(!r.order.includes(p.token))r.order.push(p.token);p.room=r.code;p.ready=false;lobbyUpd(r);bcast(r,{t:'info',k:'joined',nick:p.nick},p);return}
  const r=p.room&&rooms.get(p.room);if(!r)return;const isHost=r.host===p.token;
  if(m.t==='leave'){leaveRoom(p,'left');c.send({t:'left'});return}
  if(m.t==='set'&&!r.match){if(Number.isInteger(m.ch)&&m.ch>=0&&m.ch<64)p.ch=m.ch;if(Number.isInteger(m.sk)&&m.sk>=0&&m.sk<16)p.sk=m.sk;if(Array.isArray(m.st)&&m.st.length===5&&m.st.every(v=>Number.isInteger(v)&&v>=4&&v<=18)&&m.st.reduce((a,b)=>a+b,0)<=50)p.st=m.st;if(typeof m.ready==='boolean')p.ready=m.ready;lobbyUpd(r);return}
  if(m.t==='host'&&isHost&&!r.match){if(m.mode==='fight'||m.mode==='race')r.mode=m.mode;if(typeof m.rlen==='number')r.rlen=m.rlen?1:0;if(Number.isInteger(m.map)&&m.map>=0&&m.map<64)r.map=m.map;if(typeof m.locked==='boolean')r.locked=m.locked;
    if(m.kick){const k=r.order.find(t=>players.get(t).id===m.kick);if(k&&k!==r.host){const kp=players.get(k);r.kicked.add(k);leaveRoom(kp,'kicked');if(kp.c)kp.c.send({t:'err',k:'kicked'})}}lobbyUpd(r);return}
  if(m.t==='start'&&isHost&&!r.match){const others=r.order.filter(t=>t!==r.host&&players.get(t).ready&&players.get(t).c);if(!others.length){c.send({t:'err',k:'notready'});return}
    p.ready=true;const F=r.mode==='race'?[r.host,...others.slice(0,5)]:[r.host,others[0]];
    const pings=F.map(t=>players.get(t).ping||80),D=Math.max(3,Math.min(12,Math.ceil(Math.max(...pings)/2/16.7)+2));
    const cfg={seed:crypto.randomInt(1,2**31-1),D,map:r.map,mode:r.mode,rlen:r.rlen,f:F.map(t=>{const q=players.get(t);return{id:q.id,nick:q.nick,ch:q.ch,sk:q.sk,st:q.st}})};
    const M={cfg,fighters:F,log:F.map(()=>[]),dead:new Set(),loaded:new Set(),go:false,hash:{},tick:null};r.match=M;bcast(r,{t:'start',cfg});lobbyUpd(r);return}
  const M=r.match;if(!M)return;const slot=M.fighters.indexOf(p.token);
  if(m.t==='loaded'){M.loaded.add(p.token);if(!M.go&&M.fighters.every((t,i)=>M.dead.has(i)||M.loaded.has(t))){M.go=true;bcast(r,{t:'go'})}else if(M.go)c.send({t:'go'});return}
  if(m.t==='in'&&slot>=0){// girdi zaman çizelgesi: sunucu sıra ve süreklilikten sorumlu
    const L=M.log[slot];const f=m.f|0;if(f!==L.length)return;// boşluk/çift kayıt reddedilir
    L.push([m.h|0,Array.isArray(m.e)?m.e.slice(0,8).map(String).filter(k=>k.length<=6):[]]);bcast(r,{t:'in',s:slot,f,d:L[f]},null);if(M.dead.size)fillDead(r,M,f);return}
  if(m.t==='need'){// yeniden bağlanan/geride kalan istemci: eksik girdileri iste
    const from=m.from|0;for(let s=0;s<M.log.length;s++){const L=M.log[s];for(let f=Math.max(0,m.f0?.[s]??from);f<L.length;f+=200)c.send({t:'inb',s,f,d:L.slice(f,f+200)})}return}
  if(m.t==='hash'&&slot>=0){const k=m.f|0;(M.hash[k]=M.hash[k]||{})[slot]=m.h;const H=M.hash[k],lv=liveSlots(M);if(lv.every(i=>H[i]!=null)){if(lv.some(i=>H[i]!==H[lv[0]])){bcast(r,{t:'desync',f:k});}delete M.hash[k]}return}
  if(m.t==='snap'&&slot===0){bcast(r,{t:'snap',f:m.f,d:m.d},p);return}
  if(m.t==='result'&&slot>=0){M.res=M.res||{};M.res[slot]=m.w|0;const lv=liveSlots(M);if(lv.every(i=>M.res[i]!=null)){const ok=lv.every(i=>M.res[i]===M.res[lv[0]]);endMatch(r,ok?'done':'disputed')}return}
  if(m.t==='quit'&&slot>=0){if(M.cfg.mode==='race'&&M.fighters.length>2){leaveRoom(p,'quit');r.order.includes(p.token)||(r.order.push(p.token),p.room=r.code);lobbyUpd(r);c.send({t:'end',reason:'quit',why:'',loser:p.id})}else endMatch(r,'forfeit',p.token,'quit');return}}
function onClose(c){const p=c.p;if(!p||p.c!==c)return;p.c=null;const r=p.room&&rooms.get(p.room);if(r){bcast(r,{t:'info',k:'drop',nick:p.nick});lobbyUpd(r)}
  // 30 sn yeniden bağlanma süresi
  p.dropT=setTimeout(()=>{if(p.c)return;if(p.room)leaveRoom(p,'timeout');players.delete(p.token)},30000)}
// boş/eski odaları temizle
setInterval(()=>{const n=Date.now();for(const [k,r] of rooms){if(!r.order.some(t=>players.get(t)&&players.get(t).c)&&n-r.made>120000)rooms.delete(k)}},30000);
server.listen(PORT,()=>console.log('Evilgang sunucusu dinliyor: http://localhost:'+PORT+(LAG?'  (yapay gecikme '+LAG+' ms)':'')));
