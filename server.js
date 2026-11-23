// SFERA server. Запуск: npm i ws && OWNER_KEY=твой_секрет node server.js
const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const {WebSocketServer}=require('ws');
const DB=path.join(__dirname,'data.json'),UP=path.join(__dirname,'uploads');
fs.mkdirSync(UP,{recursive:true});
let d={users:{},chats:{},msgs:[],reports:[],appeals:[],log:[],sess:{}};
try{d=JSON.parse(fs.readFileSync(DB))}catch{}
const SB=(process.env.SUPABASE_URL||'').replace(/\/$/,''),SK=process.env.SUPABASE_KEY||'',H={apikey:SK,Authorization:'Bearer '+SK,'Content-Type':'application/json'};
let tm;const persist=async()=>{if(SB){try{const r=await fetch(SB+'/rest/v1/kv',{method:'POST',headers:{...H,Prefer:'resolution=merge-duplicates'},body:JSON.stringify({id:1,v:d})});if(!r.ok)console.log('SAVE FAIL',r.status,await r.text())}catch(e){console.log('SAVE FAIL',e.message)}}else fs.writeFileSync(DB,JSON.stringify(d))};
const save=()=>{clearTimeout(tm);tm=setTimeout(persist,300)};
process.on('SIGTERM',async()=>{clearTimeout(tm);await persist();process.exit(0)});
const id=()=>crypto.randomBytes(8).toString('hex'),FOREVER=9e15,MIN=6e4;
// Правила: act = mute|ban, min = минуты
const RULES=[
['1.1','Оскорбление / Insult','mute',10],['1.2','Мошенничество / Fraud','ban',10080],
['1.3','Спам / Spam','mute',30],['1.4','Реклама / Ads','mute',60],
['1.5','Угрозы / Threats','mute',1440],['1.6','Дискриминация / Discrimination','mute',1440],
['1.7','18+ контент / Adult content','ban',4320],['1.8','Личные данные / Doxxing','mute',720],
['1.9','Выдача себя за другого / Impersonation','ban',4320],['1.10','Обход бана / Ban evasion','ban',FOREVER/MIN]];
const SYS={id:'sys',name:'SFERA',verified:true,role:'user'};
let CUR=null;
const pub=u=>u&&({id:u.id,name:u.name,username:u.username,role:u.role,verified:!!u.verified,scam:u.scam||null,bio:u.bio||'',av:(u.avPerm==='none'&&!(CUR&&CUR.id===u.id))?0:(u.av||0),seen:(u.seenPerm||'all')==='all'?u.seen||0:0,on:(u.seenPerm||'all')==='all'&&(socks.get(u.id)||[]).length>0,hide:u.seenPerm==='none',rc:u.seenPerm==='recent'?(Date.now()-(u.seen||0)<2592e5?'r':'l'):undefined,since:u.ts||0});
const fr=m=>m.uid==='sys'?SYS:pub(d.users[m.uid]);
const sp=u=>u.storyPerm||(u.role==='owner'?'all':'contacts');
const canSee=(v,o)=>v.id===o.id||sp(o)==='all'||(sp(o)==='contacts'&&Object.values(d.chats).some(c=>c.type==='dm'&&c.members.includes(v.id)&&c.members.includes(o.id)));
const ia=(c,u)=>c.admin===u.id||(c.admins||[]).includes(u.id);
const pubm=m=>m.once?{...m,file:null}:m;
const sendOk=(c,u)=>{if((u.muteUntil||0)>Date.now())throw'Вы в муте до / Muted until '+new Date(u.muteUntil).toLocaleString();if(!canPost(c,u))throw'Писать могут только админы / Admins only';
 if(c.type==='dm'&&!isStaff(u)){const o=d.users[c.members.find(x=>x!==u.id)];if(o&&o.id!==u.id){if((o.blocked||[]).includes(u.id))throw'Вы заблокированы этим пользователем / You are blocked by this user';if((u.blocked||[]).includes(o.id))throw'Вы заблокировали этого пользователя / You blocked this user';const p=o.msgPerm||'all';if(p==='none')throw'Пользователь не принимает сообщения / User does not accept messages';if(p==='contacts'&&!d.msgs.some(m=>m.cid===c.id&&m.uid===o.id))throw'Писать могут только контакты / Contacts only'}}};
const hash=(p,s)=>crypto.scryptSync(p,s,32).toString('hex');
const isStaff=u=>u.role==='owner'||u.role==='mod';
const rl={};const limited=(k,n)=>{const now=Date.now();rl[k]=(rl[k]||[]).filter(x=>now-x<MIN);if(rl[k].length>=n)return true;rl[k].push(now);return false};
const socks=new Map();
const push=(uids,o)=>uids.forEach(u=>(socks.get(u)||[]).forEach(w=>w.readyState===1&&w.send(JSON.stringify(o))));
let WP=null,VP=process.env.VAPID_PUBLIC||'',VS=process.env.VAPID_PRIVATE||'';
try{WP=require('web-push')}catch(e){console.log('web-push unavailable:',e.message);WP=null}
function initPush(){if(!WP)return;try{if(!(VP&&VS)){d.vapid=d.vapid||WP.generateVAPIDKeys();VP=d.vapid.publicKey;VS=d.vapid.privateKey;save()}WP.setVapidDetails('mailto:support@sfera.app',VP,VS)}catch(e){console.log('push init failed:',e.message);WP=null}}
const pushTo=(uids,pl,cid)=>{if(!WP)return;uids.forEach(uid=>{const u=d.users[uid];if(!u||(socks.get(uid)||[]).some(w=>w.vis!==false)||(cid&&d.chats[cid]&&(d.chats[cid].mute||{})[uid]))return;
 const p=u.nprev===false&&!pl.call?{...pl,body:'Новое сообщение / New message'}:pl;
 (u.push||[]).forEach(sub=>WP.sendNotification(sub,JSON.stringify(p)).catch(e=>{if(e.statusCode===404||e.statusCode===410){u.push=(u.push||[]).filter(x=>x.endpoint!==sub.endpoint);save()}}))})};
const kindLabel=m=>m.kind==='text'?String(m.text||'').slice(0,100):m.kind==='sticker'?'Стикер / Sticker':m.kind==='photo'?'Фото / Photo':m.kind==='file'?(m.fname||'Файл / File'):m.kind==='voice'?'Голосовое / Voice':m.kind==='circle'?'Видеосообщение / Video':'Сообщение / Message';
const chatView=(c,me)=>{const v={id:c.id,type:c.type,title:c.title,slug:c.slug,verified:!!c.verified,scam:c.scam||null,admin:c.admin,admins:c.admins||[],arch:!!(c.arch&&c.arch[me.id]),pin:c.pin||null,joined:c.members.includes(me.id),desc:c.desc||'',av:c.av||0,priv:!!c.priv,subs:c.members.length,isadm:ia(c,me),req:ia(c,me)?(c.req||[]).length:0,pending:(c.req||[]).includes(me.id),muted:!!(c.mute&&c.mute[me.id]),unread:c.members.includes(me.id)?d.msgs.filter(m=>m.cid===c.id&&m.uid!==me.id&&!m.deleted&&m.ts>((c.read||{})[me.id]||0)&&!(m.hide||[]).includes(me.id)).length:0};
 if(c.type==='dm')v.peer=pub(d.users[c.members.find(x=>x!==me.id)]||d.users[me.id]);
 const l=[...d.msgs].reverse().find(m=>m.cid===c.id&&!m.deleted&&!(m.hide||[]).includes(me.id));v.last=l||null;return v};
const canPost=(c,u)=>c.type==='system'?false:c.type!=='channel'||c.admin===u.id||(c.admins||[]).includes(u.id);
const dev=ua=>{ua=ua||'';const os=/Android/.test(ua)?'Android':/iPhone|iPad/.test(ua)?'iOS':/Windows/.test(ua)?'Windows':/Mac/.test(ua)?'macOS':/Linux/.test(ua)?'Linux':'?';const br=/Edg/.test(ua)?'Edge':/Firefox/.test(ua)?'Firefox':/Chrome/.test(ua)?'Chrome':/Safari/.test(ua)?'Safari':'';return os+' '+br};
const own1=(uid,type)=>{let c=Object.values(d.chats).find(c=>c.type===type&&c.members.length===1&&c.members[0]===uid);if(!c){const i=id();c=d.chats[i]={id:i,type,members:[uid]}}return c};
const sysMsg=(uid,text,act,sid)=>{const c=own1(uid,'system'),m={id:id(),cid:c.id,uid:'sys',ts:Date.now(),kind:'text',text,act:!!act,sid};d.msgs.push(m);save();push([uid],{t:'msg',msg:{...m,from:SYS}})};
const pend={};
function geo(ip,t){if(!ip||/^(::1|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip)||typeof fetch!=='function')return;const ac=new AbortController();setTimeout(()=>ac.abort(),4000);
 fetch('https://ipapi.co/'+encodeURIComponent(ip.replace('::ffff:',''))+'/json/',{signal:ac.signal}).then(r=>r.json()).then(j=>{const s=d.sdev&&d.sdev[t];if(s&&j&&j.city){s.city=j.city;s.country=j.country_name||j.country;save()}}).catch(()=>{})}
const newSess=(u,ip,ua)=>{const t=id()+id();d.sess[t]=u.id;(d.sdev=d.sdev||{})[t]={dev:dev(ua),ip,ts:Date.now(),last:Date.now()};geo(ip,t);sysMsg(u.id,'Новый вход / New login\nУстройство / Device: '+dev(ua)+'\nIP: '+ip+'\n'+new Date().toLocaleString('ru-RU')+'\nЭто вы? / Was it you?',true,t.slice(0,12));return{token:t}};
const A={
reg(b,_,ip,ua){if(limited('r'+ip,5))throw'Слишком часто / Too many';
 const un=String(b.username||'').toLowerCase();if(!/^[a-z0-9_]{3,20}$/.test(un))throw'Bad username';
 if(Object.values(d.users).some(u=>u.username===un))throw'Username занят / taken';
 if(String(b.password||'').length<6)throw'Пароль ≥6 / Password ≥6';
 let role='user';
 if(un==='sfera'){if(!process.env.OWNER_KEY||b.ownerKey!==process.env.OWNER_KEY)throw'Username зарезервирован / reserved';role='owner'}
 const s=id(),u={ts:Date.now(),id:id(),name:String(b.name||un).slice(0,40),username:un,salt:s,pass:hash(b.password,s),role,verified:role==='owner'};
 d.users[u.id]=u;return A.login({username:un,password:b.password},null,ip,ua)},
login(b,_,ip,ua){if(limited('l'+ip,10))throw'Слишком часто / Too many';
 const u=Object.values(d.users).find(x=>x.username===String(b.username).toLowerCase());
 if(!u||hash(String(b.password),u.salt)!==u.pass)throw'Неверный логин или пароль / Wrong login';
 if((socks.get(u.id)||[]).length>0){const pid=id(),code=String(crypto.randomInt(1e5,1e6));pend[pid]={uid:u.id,code,exp:Date.now()+5*MIN};
  sysMsg(u.id,'Код входа / Login code: '+code+'\nУстройство / Device: '+dev(ua)+'\nIP: '+ip+'\nНикому не сообщайте / Do not share');return{need:pid}}
 return newSess(u,ip,ua)},
login2(b,_,ip,ua){const p=pend[b.pid];if(!p||p.exp<Date.now()||limited('c'+b.pid,5))throw'Код недействителен / Invalid code';
 if(String(b.code).trim()!==p.code)throw'Неверный код / Wrong code';delete pend[b.pid];return newSess(d.users[p.uid],ip,ua)},
logout(b,u,ip,ua,tk){delete d.sess[tk];return{}},
sysact(b,u){const m=d.msgs.find(x=>x.id===b.mid),c=m&&d.chats[m.cid];if(!c||!c.members.includes(u.id)||!m.act||m.done)throw'403';
 m.done=b.ok?'yes':'no';if(!b.ok){const k=Object.keys(d.sess).find(k=>k.startsWith(m.sid));k&&delete d.sess[k]}upd(m);save();return{}},
user(b,u){const o=d.users[b.uid];if(!o)throw'No user';return{user:pub(o)}},
me(b,u){return{me:{...pub(u),banUntil:u.banUntil||0,muteUntil:u.muteUntil||0,callPerm:u.callPerm||'all',msgPerm:u.msgPerm||'all',seenPerm:u.seenPerm||'all',avPerm:u.avPerm||'all',storyPerm:sp(u),nprev:u.nprev!==false},rules:RULES}},
chats(b,u){own1(u.id,'system');own1(u.id,'saved');return{chats:Object.values(d.chats).filter(c=>c.members.includes(u.id)).map(c=>chatView(c,u)).filter(v=>{const g=(d.chats[v.id].gone||{})[u.id];return !g||(v.last&&v.last.ts>g)})}},
search(b,u){const q=String(b.q||'').toLowerCase().replace('@','');if(!q)return{users:[],chats:[]};
 return{users:Object.values(d.users).filter(x=>x.id!==u.id&&(x.username.includes(q)||x.name.toLowerCase().includes(q))).slice(0,20).map(pub),
 chats:Object.values(d.chats).filter(c=>c.type!=='dm'&&c.slug&&(c.priv?c.slug===q:(c.slug.includes(q)||c.title.toLowerCase().includes(q)))).slice(0,20).map(c=>chatView(c,u))}},
dm(b,u){const o=d.users[b.uid];if(!o)throw'No user';if(o.id===u.id)return{chat:chatView(own1(u.id,'saved'),u)};
 let c=Object.values(d.chats).find(c=>c.type==='dm'&&c.members.includes(u.id)&&c.members.includes(o.id));
 if(!c){c=d.chats[id()]={id:'',type:'dm',members:[u.id,o.id]};c.id=Object.keys(d.chats).pop()}
 return{chat:chatView(c,u)}},
mk(b,u){let slug=String(b.slug||'').toLowerCase();if(b.priv&&!slug)slug='p'+id().slice(0,9);
 if(slug&&!/^[a-z0-9_]{3,30}$/.test(slug))throw'Bad link';
 if(slug&&Object.values(d.chats).some(c=>c.slug===slug))throw'Ссылка занята / Link taken';
 if(slug==='sfera'&&u.role!=='owner')throw'Ссылка sfera только владельцу / sfera is owner-only';
 const i=id();const c=d.chats[i]={id:i,type:b.type==='channel'?'channel':'group',title:String(b.title||'').slice(0,50)||'Chat',slug,members:[u.id],admin:u.id};
 c.desc=String(b.desc||'').slice(0,300);c.priv=!!b.priv;if(slug==='sfera'&&u.role==='owner')c.verified=true;save();return{chat:chatView(c,u)}},
join(b,u){const c=b.slug?Object.values(d.chats).find(x=>x.slug===String(b.slug).toLowerCase().replace(/^@/,'')):d.chats[b.cid];if(!c||c.type==='dm'||!c.slug)throw'Не найдено / Not found';
 if((c.ban||[]).includes(u.id))throw'Вы заблокированы в этом чате / You are blocked here';
 if(c.members.includes(u.id))return{chat:chatView(c,u)};
 if(c.priv){c.req=c.req||[];if(!c.req.includes(u.id))c.req.push(u.id);push([c.admin,...(c.admins||[])],{t:'req',cid:c.id});save();return{chat:chatView(c,u),pending:true}}
 c.members.push(u.id);save();return{chat:chatView(c,u)}},
msgs(b,u){const c=d.chats[b.cid];if(!c||(!c.members.includes(u.id)&&(!c.slug||c.priv||(c.ban||[]).includes(u.id))))throw'No access';
 const m=d.msgs.filter(m=>m.cid===c.id&&(!m.deleted||m.stub)&&!(m.hide||[]).includes(u.id)&&m.ts>((c.gone||{})[u.id]||0)).slice(-100).map(m=>({...pubm(m),from:fr(m)}));if(c.members.includes(u.id)){(c.read=c.read||{})[u.id]=Date.now()}const pm=d.msgs.find(x=>x.id===c.pin);return{pin:pm?{...pm,from:fr(pm)}:null,msgs:m,canPost:canPost(c,u)&&c.members.includes(u.id)}},
send(b,u){const c=d.chats[b.cid];if(!c||!c.members.includes(u.id))throw'No access';sendOk(c,u);
 const K=['circle','voice','sticker','file','photo'],m={id:id(),cid:c.id,uid:u.id,ts:Date.now(),kind:K.includes(b.kind)?b.kind:'text',reply:b.reply||null};
 if(b.once&&['circle','voice','photo'].includes(m.kind))m.once=true;
 if(m.kind==='sticker'){if(!/^[scd]:\d{1,2}$/.test(String(b.text)))throw'Bad';m.text=b.text}
 else if(m.kind!=='text'){const buf=Buffer.from(String(b.data||'').split(',')[1]||'','base64');if(!buf.length||buf.length>8.5e6)throw'Слишком большой файл, до 8 МБ / Too big, 8 MB max';
  if(m.kind==='file'){m.fname=String(b.name||'file').replace(/[\\\/\0]/g,'_').slice(-80)||'file';m.size=buf.length;m.file=m.id+'_'+m.fname.replace(/[^\w.\-]+/g,'_').slice(-50)}
  else m.file=m.id+(m.kind==='voice'?'.a.webm':m.kind==='photo'?'.p.jpg':'.webm');
  fs.writeFileSync(path.join(UP,m.file),buf)}
 else{m.text=String(b.text||'').slice(0,4000);if(!m.text.trim())throw'Empty'}
 d.msgs.push(m);save();push(c.members,{t:'msg',msg:{...pubm(m),from:pub(u)}});pushTo(c.members.filter(x=>x!==u.id),{title:c.type==='dm'?u.name:(c.title||'SFERA'),body:(c.type==='dm'?'':u.name+': ')+kindLabel(m),cid:c.id},c.id);return{}},
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
const upd=m=>push(d.chats[m.cid].members,{t:'upd',msg:{...pubm(m),from:fr(m)}});
const staff=u=>{if(!isStaff(u))throw'403'};
const own=u=>{if(u.role!=='owner')throw'Только владелец / Owner only'};
Object.assign(A,{
del(b,u){const m=d.msgs.find(x=>x.id===b.mid);if(!m)throw'No msg';
 if(b.all){if(m.uid!==u.id&&!isStaff(u))throw'403';m.deleted=true;m.stub=!!b.stub;m.text='';m.file=null;if(m.stub)upd(m);else push(d.chats[m.cid].members,{t:'del',cid:m.cid,mid:m.id})}else(m.hide=m.hide||[]).push(u.id);save();return{}},
edit(b,u){const m=d.msgs.find(x=>x.id===b.mid);if(!m||m.uid!==u.id||m.kind!=='text'||m.deleted)throw'403';m.text=String(b.text||'').slice(0,4000);m.edited=true;upd(m);save();return{}},
pin(b,u){const m=d.msgs.find(x=>x.id===b.mid),c=m&&d.chats[m.cid];if(!c||!c.members.includes(u.id)||(!['dm','saved'].includes(c.type)&&c.admin!==u.id&&!(c.admins||[]).includes(u.id)&&!isStaff(u)))throw'403';
 c.pin=b.on?m.id:null;push(c.members,{t:'pin',cid:c.id,msg:b.on?{...m,from:fr(m)}:null});save();return{}},
react(b,u){const m=d.msgs.find(x=>x.id===b.mid),c=m&&d.chats[m.cid];if(!c||!c.members.includes(u.id)||!/^\p{Extended_Pictographic}/u.test(String(b.e))||String(b.e).length>12)throw'Bad';
 const r=m.re=m.re||{},had=(r[b.e]||[]).includes(u.id);for(const e in r){r[e]=r[e].filter(x=>x!==u.id);if(!r[e].length)delete r[e]}
 if(!had)(r[b.e]=r[b.e]||[]).push(u.id);upd(m);save();return{}},
profile(b,u){if(b.name)u.name=String(b.name).slice(0,40);if(b.nprev!=null)u.nprev=!!b.nprev;if(['all','recent','none'].includes(b.seenPerm))u.seenPerm=b.seenPerm;if(['all','none'].includes(b.avPerm))u.avPerm=b.avPerm;if(['contacts','all','none'].includes(b.storyPerm))u.storyPerm=b.storyPerm;if(['all','ask','none'].includes(b.callPerm))u.callPerm=b.callPerm;if(['all','contacts','none'].includes(b.msgPerm))u.msgPerm=b.msgPerm;if(b.bio!=null)u.bio=String(b.bio).slice(0,200);
 if(b.avatar){const bf=Buffer.from(String(b.avatar).split(',')[1]||'','base64');if(bf.length&&bf.length<2e5){fs.writeFileSync(path.join(UP,'a_'+u.id+'.jpg'),bf);u.av=Date.now()}}save();return{}},
feedback(b,u){(d.fb=d.fb||[]).push({uid:u.id,text:String(b.text||'').slice(0,2000),ts:Date.now()});save();return{}},
feedbacks(b,u){staff(u);return{list:(d.fb||[]).slice(-50).reverse().map(f=>({...f,user:pub(d.users[f.uid])}))}},
users(b,u){staff(u);return{users:Object.values(d.users).map(x=>({...pub(x),ban:x.banUntil>Date.now(),mute:x.muteUntil>Date.now()}))}},
reload(b,u){own(u);const t=d.users[b.uid];if(!t)throw'No user';for(const k in d.sess)if(d.sess[k]===t.id)delete d.sess[k];t.banUntil=0;t.muteUntil=0;save();return{}},
wipe(b,u){staff(u);const t=d.users[b.uid];if(!t||t.role==='owner'||(t.role==='mod'&&u.role!=='owner'))throw'Нельзя / Forbidden';
 for(const k in d.sess)if(d.sess[k]===t.id)delete d.sess[k];
 Object.values(d.chats).forEach(c=>{if(c.type==='dm'&&c.members.includes(t.id)){delete d.chats[c.id];d.msgs=d.msgs.filter(m=>m.cid!==c.id)}else c.members=c.members.filter(x=>x!==t.id)});
 d.msgs=d.msgs.filter(m=>m.uid!==t.id);d.reports=d.reports.filter(r=>r.to!==t.id&&r.by!==t.id);d.appeals=d.appeals.filter(a=>a.uid!==t.id);delete d.users[t.id];save();return{}}});
Object.assign(A,{
sadd(b,u){const h=Math.max(12,Math.min(48,+b.hours||24)),s={id:id(),uid:u.id,ts:Date.now(),exp:Date.now()+h*36e5,kind:b.kind==='text'?'text':'img'};
 if(s.kind==='text'){s.text=String(b.text||'').slice(0,300);s.bg=+b.bg||0;if(!s.text.trim())throw'Empty'}
 else{const bf=Buffer.from(String(b.data||'').split(',')[1]||'','base64');if(!bf.length||bf.length>1.5e6)throw'Too big';s.file='s_'+s.id+'.jpg';fs.writeFileSync(path.join(UP,s.file),bf)}
 (d.stories=d.stories||[]).push(s);save();return{}},
stories(b,u){const now=Date.now(),g={};(d.stories||[]).filter(s=>s.exp>now&&d.users[s.uid]&&canSee(u,d.users[s.uid])).forEach(s=>(g[s.uid]=g[s.uid]||[]).push(s));
 return{list:Object.entries(g).map(([k,v])=>({user:pub(d.users[k]),items:v}))}},
ustories(b,u){const o=d.users[b.uid];if(!o||!canSee(u,o))return{list:[],hidden:true};return{list:(d.stories||[]).filter(s=>s.uid===b.uid).slice(-60)}},
sdel(b,u){const s=(d.stories||[]).find(x=>x.id===b.id);if(!s||(s.uid!==u.id&&!isStaff(u)))throw'403';d.stories=d.stories.filter(x=>x!==s);save();return{}},
chatdel(b,u){const c=d.chats[b.cid];if(!c||!c.members.includes(u.id)||c.type==='system')throw'403';
 if(c.type==='group'||(c.type==='channel'&&c.admin!==u.id))c.members=c.members.filter(x=>x!==u.id);(c.gone=c.gone||{})[u.id]=Date.now();save();return{}},
chatarch(b,u){const c=d.chats[b.cid];if(!c||!c.members.includes(u.id))throw'403';(c.arch=c.arch||{})[u.id]=!!b.on;save();return{}},
chadm(b,u){const c=d.chats[b.cid],t=Object.values(d.users).find(x=>x.username===String(b.username).toLowerCase().replace('@',''));
 if(!c||c.type!=='channel'||(c.admin!==u.id&&u.role!=='owner')||!t)throw'403';c.admins=(c.admins||[]).filter(x=>x!==t.id);if(b.on){c.admins.push(t.id);if(!c.members.includes(t.id))c.members.push(t.id)}save();return{}}});
Object.assign(A,{
chedit(b,u){const c=d.chats[b.cid];if(!c||!['channel','group'].includes(c.type)||!ia(c,u))throw'403';
 if(b.title!=null)c.title=String(b.title).slice(0,50)||c.title;if(b.desc!=null)c.desc=String(b.desc).slice(0,300);if(b.priv!=null)c.priv=!!b.priv;
 if(b.slug!=null){const sl=String(b.slug).toLowerCase().replace(/^@/,'');if(sl&&!/^[a-z0-9_]{3,30}$/.test(sl))throw'Bad link';if(sl&&sl!==c.slug&&Object.values(d.chats).some(x=>x.slug===sl))throw'Ссылка занята / Link taken';if(sl==='sfera'&&u.role!=='owner')throw'Ссылка sfera только владельцу / sfera is owner-only';c.slug=sl}
 if(b.avatar){const bf=Buffer.from(String(b.avatar).split(',')[1]||'','base64');if(bf.length&&bf.length<2e5){fs.writeFileSync(path.join(UP,'a_'+c.id+'.jpg'),bf);c.av=Date.now()}}
 save();return{chat:chatView(c,u)}},
members(b,u){const c=d.chats[b.cid];if(!c||!ia(c,u))throw'403';
 return{members:c.members.filter(x=>d.users[x]).map(x=>({...pub(d.users[x]),adm:ia(c,{id:x}),owner:c.admin===x})),bans:(c.ban||[]).filter(x=>d.users[x]).map(x=>pub(d.users[x])),reqs:(c.req||[]).filter(x=>d.users[x]).map(x=>pub(d.users[x]))}},
chkick(b,u){const c=d.chats[b.cid],t=b.uid;if(!c||!ia(c,u)||t===c.admin||t===u.id)throw'403';if((c.admins||[]).includes(t)&&c.admin!==u.id)throw'403';
 if(b.unban)c.ban=(c.ban||[]).filter(x=>x!==t);else{c.members=c.members.filter(x=>x!==t);c.admins=(c.admins||[]).filter(x=>x!==t);if(b.ban){c.ban=c.ban||[];if(!c.ban.includes(t))c.ban.push(t)}}save();return{}},
rans(b,u){const c=d.chats[b.cid];if(!c||!ia(c,u))throw'403';c.req=(c.req||[]).filter(x=>x!==b.uid);
 if(b.ok&&d.users[b.uid]&&!c.members.includes(b.uid)&&!(c.ban||[]).includes(b.uid)){c.members.push(b.uid);push([b.uid],{t:'ok',cid:c.id})}save();return{}},
viewed(b,u){const m=d.msgs.find(x=>x.id===b.mid),c=m&&d.chats[m.cid];if(!c||!c.members.includes(u.id)||!m.once||m.uid===u.id)throw'403';if(m.gone)throw'Уже просмотрено / Already viewed';
 const f=path.join(UP,m.file||'-'),mime=m.kind==='voice'?'audio/webm':m.kind==='photo'?'image/jpeg':'video/webm';let buf;
 try{buf=fs.readFileSync(f);fs.unlinkSync(f)}catch{m.gone=true;m.file=null;upd(m);save();throw'Файл недоступен / File unavailable'}
 m.gone=true;m.file=null;upd(m);save();return{data:'data:'+mime+';base64,'+buf.toString('base64')}},
fwd(b,u){const m=d.msgs.find(x=>x.id===b.mid),sc=m&&d.chats[m.cid],c=d.chats[b.cid];
 if(!sc||!c||!(sc.members.includes(u.id)||(sc.slug&&!sc.priv))||!c.members.includes(u.id)||m.deleted||m.once||m.act)throw'403';sendOk(c,u);
 const n={id:id(),cid:c.id,uid:u.id,ts:Date.now(),kind:m.kind,text:m.text,file:m.file,fname:m.fname,size:m.size,fwd:fr(m).name};d.msgs.push(n);save();push(c.members,{t:'msg',msg:{...n,from:pub(u)}});return{}}});
Object.assign(A,{
readchat(b,u){const c=d.chats[b.cid];if(!c||!c.members.includes(u.id))throw'403';(c.read=c.read||{})[u.id]=Date.now();return{}},
stats(b,u){staff(u);return{users:Object.keys(d.users).length,chats:Object.values(d.chats).filter(c=>c.type!=='dm'&&c.type!=='system'&&c.type!=='saved').length,msgs:d.msgs.length,online:[...socks.entries()].filter(([k,v])=>v.length).length,stories:(d.stories||[]).filter(s=>s.exp>Date.now()).length}},
calllist(b,u){const ids=new Set(Object.values(d.chats).filter(c=>c.type==='dm'&&c.members.includes(u.id)).map(c=>c.id));
 return{list:d.msgs.filter(m=>m.kind==='call'&&ids.has(m.cid)).slice(-60).reverse().map(m=>{const c=d.chats[m.cid],o=d.users[c.members.find(x=>x!==u.id)||u.id];return{id:m.id,cid:m.cid,ts:m.ts,uid:m.uid,call:m.call,peer:pub(o)}})}}});
Object.assign(A,{
sessions(b,u,ip,ua,tk){return{list:Object.keys(d.sess).filter(k=>d.sess[k]===u.id).map(k=>({id:k.slice(0,12),cur:k===tk,...((d.sdev||{})[k]||{dev:'?',ip:'',ts:0,last:0})}))}},
endsess(b,u){const k=Object.keys(d.sess).find(x=>d.sess[x]===u.id&&x.startsWith(String(b.sid)));if(!k)throw'No session';delete d.sess[k];save();return{}},
endothers(b,u,ip,ua,tk){for(const k of Object.keys(d.sess))if(d.sess[k]===u.id&&k!==tk)delete d.sess[k];save();return{}},
chpass(b,u,ip,ua,tk){if(hash(String(b.old||''),u.salt)!==u.pass)throw'Неверный пароль / Wrong password';if(String(b.pass||'').length<6)throw'Пароль ≥6 / Password ≥6';
 u.salt=id();u.pass=hash(String(b.pass),u.salt);for(const k of Object.keys(d.sess))if(d.sess[k]===u.id&&k!==tk)delete d.sess[k];sysMsg(u.id,'Пароль изменён / Password changed\nУстройство / Device: '+dev(ua)+'\nIP: '+ip);save();return{}},
delacc(b,u){if(hash(String(b.pass||''),u.salt)!==u.pass)throw'Неверный пароль / Wrong password';if(u.role==='owner')throw'Владелец не может удалить аккаунт / Owner cannot delete the account';return A.wipe({uid:u.id},{role:'owner',id:'x'})},
block(b,u){const t=d.users[b.uid];if(!t||t.id===u.id)throw'Bad';u.blocked=(u.blocked||[]).filter(x=>x!==t.id);if(b.on)u.blocked.push(t.id);save();return{}},
blocklist(b,u){return{list:(u.blocked||[]).filter(x=>d.users[x]).map(x=>pub(d.users[x]))}},
cmute(b,u){const c=d.chats[b.cid];if(!c||!c.members.includes(u.id))throw'403';(c.mute=c.mute||{})[u.id]=!!b.on;save();return{}},
pushkey(){return{key:WP&&VP?VP:null}},
pushsub(b,u){const s=b.sub;if(!s||!s.endpoint)throw'Bad';u.push=(u.push||[]).filter(x=>x.endpoint!==s.endpoint);u.push.push(s);u.push=u.push.slice(-5);save();return{}},
pushoff(b,u){u.push=(u.push||[]).filter(x=>x.endpoint!==String(b.endpoint||''));save();return{}}});
const SW=`self.addEventListener('push',e=>{let d={};try{d=e.data.json()}catch(x){}e.waitUntil(self.registration.showNotification(d.title||'SFERA',{body:d.body||'',icon:'/icon.png',badge:'/icon.png',tag:d.cid||'sfera',renotify:true,vibrate:d.call?[400,200,400,200,400]:[150,80,150],data:{cid:d.cid}}))});
self.addEventListener('notificationclick',e=>{e.notification.close();e.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(l=>{for(const c of l){if('focus' in c)return c.focus()}return clients.openWindow('/')}))});`;
const OPEN=['reg','login','login2'],BANOK=['me','appeal'];
const srv=http.createServer((q,r)=>{
 const ip=(q.headers['x-forwarded-for']||q.socket.remoteAddress||'').split(',')[0].trim(),j=(c,o)=>{r.writeHead(c,{'Content-Type':'application/json'});r.end(JSON.stringify(o))};
 if(q.method==='POST'&&q.url==='/api'){let s='',n=0,big=false;q.on('data',x=>{n+=x.length;if(n>13e6)big=true;else s+=x});
  q.on('end',()=>{if(big)return j(413,{error:'Слишком большой файл, до 8 МБ / Too big, 8 MB max'});try{const b=JSON.parse(s),u=d.users[d.sess[q.headers['x-token']]];CUR=u||null;if(u){u.seen=Date.now();const sd=d.sdev&&d.sdev[q.headers['x-token']];if(sd)sd.last=Date.now()}
   if(!OPEN.includes(b.a)&&!u)return j(401,{error:'auth'});
   if(u&&u.banUntil>Date.now()&&!BANOK.includes(b.a))return j(403,{error:'banned',until:u.banUntil});
   if(!A[b.a])return j(404,{error:'?'});j(200,A[b.a](b,u,ip,q.headers['user-agent'],q.headers['x-token']))}catch(e){j(400,{error:String(e&&e.message||e)})}});return}
 if(q.url.startsWith('/uploads/')){const n=path.basename(q.url.split('?')[0]),f=path.join(UP,n);if(!fs.existsSync(f)){r.writeHead(404);return r.end()}
  const ava=/^[as]_/.test(n),mm=ava?null:d.msgs.find(m=>m.file===n);if(mm&&mm.once){r.writeHead(403);return r.end()}
  const h={'Content-Type':n.endsWith('.a.webm')?'audio/webm':ava||n.endsWith('.p.jpg')?'image/jpeg':mm&&mm.kind==='file'?'application/octet-stream':'video/webm','Cache-Control':'private, max-age=3600','X-Content-Type-Options':'nosniff'};
  if(mm&&mm.kind==='file')h['Content-Disposition']="attachment; filename*=UTF-8''"+encodeURIComponent(mm.fname||n);
  r.writeHead(200,h);return fs.createReadStream(f).pipe(r)}
 if(q.url==='/sw.js'){r.writeHead(200,{'Content-Type':'application/javascript','Service-Worker-Allowed':'/','Cache-Control':'no-cache'});return r.end(SW)}
 if(q.url==='/manifest.json'){r.writeHead(200,{'Content-Type':'application/manifest+json'});return r.end(JSON.stringify({name:'SFERA',short_name:'SFERA',start_url:'/',display:'standalone',background_color:'#191920',theme_color:'#191920',icons:[{src:'/icon.png',sizes:'96x96',type:'image/png',purpose:'any'}]}))}
 if(q.url==='/icon.png'){try{const h=fs.readFileSync(path.join(__dirname,'index.html'),'utf8'),m=/LOGO='data:image\/png;base64,([^']+)'/.exec(h);if(m){r.writeHead(200,{'Content-Type':'image/png','Cache-Control':'public, max-age=86400'});return r.end(Buffer.from(m[1],'base64'))}}catch{}r.writeHead(404);return r.end()}
 r.writeHead(200,{'Content-Type':'text/html;charset=utf-8'});r.end(fs.readFileSync(path.join(__dirname,'index.html')))});
const permit={},calls={},held={};
function callMsg(c,caller,video,st,dur){const m={id:id(),cid:c.id,uid:caller,ts:Date.now(),kind:'call',call:{v:!!video,st,dur}};d.msgs.push(m);save();push(c.members,{t:'msg',msg:{...m,from:pub(d.users[caller])}})}
function callSig(o,c,uid){const to=c.members.find(x=>x!==uid),T=d.users[to],me=d.users[uid];if(!T)return;
 const out=x=>{const z={...x,cid:c.id,from:uid,fromName:me.name};if(!(socks.get(to)||[]).length&&['creq','co','ci'].includes(x.t))(held[to]=held[to]||[]).push({...z,t0:Date.now()});push([to],z)},back=x=>push([uid],{...x,cid:c.id});
 if((T.blocked||[]).includes(uid)||(me.blocked||[]).includes(to)){if(o.t==='creq'||o.t==='co')back({t:'cno',why:'off'});return}
 if(o.t==='creq'){const p=T.callPerm||'all';if(p==='none')return back({t:'cno',why:'off'});pushTo([to],{title:me.name,body:'Звонок / Call',cid:c.id,call:1},c.id);if(p==='all'){permit[to+':'+uid]=Date.now()+9e4;return back({t:'cok'})}return out({t:'creq'})}
 if(o.t==='cok'){permit[uid+':'+to]=Date.now()+9e4;return out({t:'cok'})}
 if(o.t==='cno')return out({t:'cno',why:'deny'});
 if(o.t==='co'){if(!((permit[to+':'+uid]||0)>Date.now()))return back({t:'cno',why:'perm'});calls[c.id]={caller:uid,video:!!o.video,ans:0};pushTo([to],{title:me.name,body:o.video?'Видеозвонок / Video call':'Звонок / Call',cid:c.id,call:1},c.id)}
 if(o.t==='ca'&&calls[c.id])calls[c.id].ans=Date.now();
 if(o.t==='ce'){delete held[to];const k=calls[c.id];if(k){delete calls[c.id];callMsg(c,k.caller,k.video,k.ans?'done':uid===k.caller?'cancel':'declined',k.ans?Math.round((Date.now()-k.ans)/1000):0)}}
 out(o)}
new WebSocketServer({server:srv}).on('connection',(w,q)=>{const uid=d.sess[new URL(q.url,'http://x').searchParams.get('t')];if(!uid)return w.close();
 socks.set(uid,[...(socks.get(uid)||[]),w]);{const h=(held[uid]||[]).filter(x=>Date.now()-x.t0<45e3);delete held[uid];h.forEach(x=>w.send(JSON.stringify(x)))}
  w.on('message',raw=>{try{const o=JSON.parse(raw),c=d.chats[o.cid];if(o.t==='vis')w.vis=!!o.v;else if(o.t==='typing'&&c&&c.members.includes(uid))push(c.members.filter(x=>x!==uid),{t:'typing',cid:c.id,uid});
  else if(['creq','cok','cno','co','ca','ci','ce'].includes(o.t)&&c&&c.type==='dm'&&c.members.includes(uid))callSig(o,c,uid)}catch{}});
 w.on('close',()=>{socks.set(uid,(socks.get(uid)||[]).filter(x=>x!==w));if(d.users[uid])d.users[uid].seen=Date.now()})});
(async()=>{if(SB){try{const r=await fetch(SB+'/rest/v1/kv?id=eq.1&select=v',{headers:H});if(!r.ok)throw Error('HTTP '+r.status+' '+await r.text());const j=await r.json();if(j[0])d=j[0].v;console.log('DB loaded from Supabase')}catch(e){console.log('CANNOT LOAD DB, refusing to start:',e.message);process.exit(1)}}
 initPush();
 srv.listen(process.env.PORT||3000,()=>console.log('SFERA on :'+(process.env.PORT||3000)))})();
