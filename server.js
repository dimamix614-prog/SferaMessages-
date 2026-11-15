// SFERA server. Запуск: npm i ws && OWNER_KEY=твой_секрет node server.js
const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const {WebSocketServer}=require('ws');
const DB=path.join(__dirname,'data.json'),UP=path.join(__dirname,'uploads');
fs.mkdirSync(UP,{recursive:true});
let d={users:{},chats:{},msgs:[],reports:[],appeals:[],log:[],sess:{}};
try{d=JSON.parse(fs.readFileSync(DB))}catch{}
let tm;const save=()=>{clearTimeout(tm);tm=setTimeout(()=>fs.writeFileSync(DB,JSON.stringify(d)),300)};
const id=()=>crypto.randomBytes(8).toString('hex'),FOREVER=9e15,MIN=6e4;
// Правила: act = mute|ban, min = минуты
const RULES=[
['1.1','Оскорбление / Insult','mute',10],['1.2','Мошенничество / Fraud','ban',10080],
['1.3','Спам / Spam','mute',30],['1.4','Реклама / Ads','mute',60],
['1.5','Угрозы / Threats','mute',1440],['1.6','Дискриминация / Discrimination','mute',1440],
['1.7','18+ контент / Adult content','ban',4320],['1.8','Личные данные / Doxxing','mute',720],
['1.9','Выдача себя за другого / Impersonation','ban',4320],['1.10','Обход бана / Ban evasion','ban',FOREVER/MIN]];
const pub=u=>u&&({id:u.id,name:u.name,username:u.username,role:u.role,verified:!!u.verified,scam:u.scam||null,bio:u.bio||''});
const hash=(p,s)=>crypto.scryptSync(p,s,32).toString('hex');
const isStaff=u=>u.role==='owner'||u.role==='mod';
const rl={};const limited=(k,n)=>{const now=Date.now();rl[k]=(rl[k]||[]).filter(x=>now-x<MIN);if(rl[k].length>=n)return true;rl[k].push(now);return false};
const socks=new Map();
const push=(uids,o)=>uids.forEach(u=>(socks.get(u)||[]).forEach(w=>w.readyState===1&&w.send(JSON.stringify(o))));
const chatView=(c,me)=>{const v={id:c.id,type:c.type,title:c.title,slug:c.slug,verified:!!c.verified,scam:c.scam||null,admin:c.admin,joined:c.members.includes(me.id)};
 if(c.type==='dm')v.peer=pub(d.users[c.members.find(x=>x!==me.id)]||d.users[me.id]);
 const l=[...d.msgs].reverse().find(m=>m.cid===c.id);v.last=l||null;return v};
const canPost=(c,u)=>c.type!=='channel'||c.admin===u.id||u.role==='owner';
const A={
reg(b,_,ip){if(limited('r'+ip,5))throw'Слишком часто / Too many';
 const un=String(b.username||'').toLowerCase();if(!/^[a-z0-9_]{3,20}$/.test(un))throw'Bad username';
 if(Object.values(d.users).some(u=>u.username===un))throw'Username занят / taken';
 if(String(b.password||'').length<6)throw'Пароль ≥6 / Password ≥6';
 let role='user';
 if(un==='sfera'){if(!process.env.OWNER_KEY||b.ownerKey!==process.env.OWNER_KEY)throw'Username зарезервирован / reserved';role='owner'}
 const s=id(),u={id:id(),name:String(b.name||un).slice(0,40),username:un,salt:s,pass:hash(b.password,s),role,verified:role==='owner'};
 d.users[u.id]=u;return A.login({username:un,password:b.password},null,ip)},
login(b,_,ip){if(limited('l'+ip,10))throw'Слишком часто / Too many';
 const u=Object.values(d.users).find(x=>x.username===String(b.username).toLowerCase());
 if(!u||hash(String(b.password),u.salt)!==u.pass)throw'Неверный логин или пароль / Wrong login';
 const t=id()+id();d.sess[t]=u.id;return{token:t}},
me(b,u){return{me:{...pub(u),banUntil:u.banUntil||0,muteUntil:u.muteUntil||0},rules:RULES}},
chats(b,u){return{chats:Object.values(d.chats).filter(c=>c.members.includes(u.id)).map(c=>chatView(c,u))}},
search(b,u){const q=String(b.q||'').toLowerCase().replace('@','');if(!q)return{users:[],chats:[]};
 return{users:Object.values(d.users).filter(x=>x.id!==u.id&&(x.username.includes(q)||x.name.toLowerCase().includes(q))).slice(0,20).map(pub),
 chats:Object.values(d.chats).filter(c=>c.type!=='dm'&&c.slug&&(c.slug.includes(q)||c.title.toLowerCase().includes(q))).slice(0,20).map(c=>chatView(c,u))}},
dm(b,u){const o=d.users[b.uid];if(!o)throw'No user';
 let c=Object.values(d.chats).find(c=>c.type==='dm'&&c.members.includes(u.id)&&c.members.includes(o.id));
 if(!c){c=d.chats[id()]={id:'',type:'dm',members:[u.id,o.id]};c.id=Object.keys(d.chats).pop()}
 return{chat:chatView(c,u)}},
mk(b,u){const slug=String(b.slug||'').toLowerCase();
 if(slug&&!/^[a-z0-9_]{3,30}$/.test(slug))throw'Bad link';
 if(slug&&Object.values(d.chats).some(c=>c.slug===slug))throw'Ссылка занята / Link taken';
 if(slug==='sfera'&&u.role!=='owner')throw'Ссылка sfera только владельцу / sfera is owner-only';
 const i=id();const c=d.chats[i]={id:i,type:b.type==='channel'?'channel':'group',title:String(b.title||'').slice(0,50)||'Chat',slug,members:[u.id],admin:u.id};
 if(slug==='sfera'&&u.role==='owner')c.verified=true;return{chat:chatView(c,u)}},
join(b,u){const c=d.chats[b.cid];if(!c||c.type==='dm'||!c.slug)throw'No chat';if(!c.members.includes(u.id))c.members.push(u.id);save();return{chat:chatView(c,u)}},
msgs(b,u){const c=d.chats[b.cid];if(!c||(!c.members.includes(u.id)&&!c.slug))throw'No access';
 const m=d.msgs.filter(m=>m.cid===c.id).slice(-100).map(m=>({...m,from:pub(d.users[m.uid])}));return{msgs:m,canPost:canPost(c,u)&&c.members.includes(u.id)}},
send(b,u){const c=d.chats[b.cid];if(!c||!c.members.includes(u.id))throw'No access';
 if((u.muteUntil||0)>Date.now())throw'Вы в муте до / Muted until '+new Date(u.muteUntil).toLocaleString();
 if(!canPost(c,u))throw'Только админ канала / Admins only';
 const m={id:id(),cid:c.id,uid:u.id,ts:Date.now(),kind:b.kind==='circle'?'circle':'text'};
 if(m.kind==='circle'){const buf=Buffer.from(String(b.data||'').split(',')[1]||'','base64');if(!buf.length||buf.length>8e6)throw'Видео слишком большое / Too big';
  m.file=m.id+'.webm';fs.writeFileSync(path.join(UP,m.file),buf)}
 else{m.text=String(b.text||'').slice(0,4000);if(!m.text.trim())throw'Empty'}
 d.msgs.push(m);save();push(c.members,{t:'msg',msg:{...m,from:pub(u)}});return{}},
report(b,u){const t=d.users[b.uid];if(!t||t.id===u.id)throw'Bad target';
 if(d.reports.some(r=>r.by===u.id&&r.to===t.id))throw'Вы уже жаловались / Already reported';
 d.reports.push({id:id(),by:u.id,to:t.id,reason:String(b.reason||'').slice(0,300),ts:Date.now()});
 const n=new Set(d.reports.filter(r=>r.to===t.id).map(r=>r.by)).size;
 if(n>=25&&!isStaff(t)&&!(t.banUntil>Date.now())){t.banUntil=FOREVER;t.banReason='auto: 25 reports';d.log.push({ts:Date.now(),by:'system',to:t.id,act:'autoban'})}
 save();return{count:n}},
mod(b,u){if(!isStaff(u))throw'403';const t=d.users[b.uid];if(!t||t.role==='owner'||(t.role==='mod'&&u.role!=='owner'))throw'Нельзя / Forbidden';
 if(b.rule==='unban'){t.banUntil=0;t.muteUntil=0;d.appeals=d.appeals.filter(a=>a.uid!==t.id)}
 else{const r=RULES.find(x=>x[0]===b.rule);if(!r)throw'Bad rule';const until=Math.min(FOREVER,Date.now()+r[3]*MIN);
  if(r[2]==='ban'){t.banUntil=until;t.banReason=r[0]}else t.muteUntil=until}
 d.log.push({ts:Date.now(),by:u.id,to:t.id,act:b.rule});save();return{}},
scam(b,u){if(!isStaff(u))throw'403';const o=b.kind==='chat'?d.chats[b.id]:d.users[b.id];if(!o||o.role==='owner')throw'Bad';
 o.scam=b.on?{reason:String(b.reason||'—').slice(0,200),by:u.id,ts:Date.now()}:null;d.log.push({ts:Date.now(),by:u.id,to:b.id,act:'scam:'+!!b.on});save();return{}},
verify(b,u){if(u.role!=='owner')throw'Только владелец / Owner only';const o=b.kind==='chat'?d.chats[b.id]:d.users[b.id];if(!o)throw'Bad';o.verified=!!b.on;save();return{}},
setmod(b,u){if(u.role!=='owner')throw'Только владелец / Owner only';const t=Object.values(d.users).find(x=>x.username===String(b.username).toLowerCase().replace('@',''));
 if(!t||t.role==='owner')throw'Bad user';t.role=b.on?'mod':'user';save();return{}},
appeal(b,u){d.appeals=d.appeals.filter(a=>a.uid!==u.id);d.appeals.push({uid:u.id,text:String(b.text||'').slice(0,1000),ts:Date.now()});save();return{}},
appeals(b,u){if(!isStaff(u))throw'403';return{appeals:d.appeals.map(a=>({...a,user:pub(d.users[a.uid]),reason:d.users[a.uid]?.banReason}))}}};
const OPEN=['reg','login'],BANOK=['me','appeal'];
const srv=http.createServer((q,r)=>{
 const ip=q.socket.remoteAddress,j=(c,o)=>{r.writeHead(c,{'Content-Type':'application/json'});r.end(JSON.stringify(o))};
 if(q.method==='POST'&&q.url==='/api'){let s='',n=0;q.on('data',x=>{n+=x.length;if(n>12e6)q.destroy();s+=x});
  q.on('end',()=>{try{const b=JSON.parse(s),u=d.users[d.sess[q.headers['x-token']]];
   if(!OPEN.includes(b.a)&&!u)return j(401,{error:'auth'});
   if(u&&u.banUntil>Date.now()&&!BANOK.includes(b.a))return j(403,{error:'banned',until:u.banUntil});
   if(!A[b.a])return j(404,{error:'?'});j(200,A[b.a](b,u,ip))}catch(e){j(400,{error:String(e&&e.message||e)})}});return}
 if(q.url.startsWith('/uploads/')){const f=path.join(UP,path.basename(q.url));return fs.existsSync(f)?(r.writeHead(200,{'Content-Type':'video/webm'}),fs.createReadStream(f).pipe(r)):(r.writeHead(404),r.end())}
 r.writeHead(200,{'Content-Type':'text/html;charset=utf-8'});r.end(fs.readFileSync(path.join(__dirname,'index.html')))});
new WebSocketServer({server:srv}).on('connection',(w,q)=>{const uid=d.sess[new URL(q.url,'http://x').searchParams.get('t')];if(!uid)return w.close();
 socks.set(uid,[...(socks.get(uid)||[]),w]);w.on('close',()=>socks.set(uid,(socks.get(uid)||[]).filter(x=>x!==w)))});
srv.listen(process.env.PORT||3000,()=>console.log('SFERA on :'+(process.env.PORT||3000)));
