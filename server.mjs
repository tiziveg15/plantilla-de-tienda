import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, extname, basename } from 'node:path';
import { randomUUID, createHmac, timingSafeEqual, scryptSync, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const DATA_DIR = resolve(ROOT, 'data');
const DB_FILE = resolve(DATA_DIR, 'store.json');
const PORT = Number(process.env.PORT || 4173);
const MIME = { '.html':'text/html; charset=utf-8', '.jsx':'text/javascript; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp' };
const seed = [
  {id:1,name:'Auriculares inalámbricos Studio Pro',category:'Tecnología',price:84999,stock:18,description:'Sonido envolvente y comodidad para acompañarte todo el día.',images:[]},
  {id:2,name:'Cafetera espresso Compacta',category:'Hogar',price:129990,stock:7,description:'Prepará café con sabor de cafetería desde tu casa.',images:[]},
  {id:3,name:'Zapatillas urbanas Everyday',category:'Moda',price:68900,stock:23,description:'Diseño versátil, materiales livianos y suela cómoda.',images:[]},
  {id:4,name:'Smartwatch Active 2',category:'Tecnología',price:109999,stock:11,description:'Conectividad y seguimiento de actividad desde tu muñeca.',images:[]},
  {id:5,name:'Mochila Explorer 28L',category:'Moda',price:45900,stock:4,description:'Espacio y comodidad para tus viajes y rutinas.',images:[]},
  {id:6,name:'Lámpara de escritorio Aura',category:'Hogar',price:37999,stock:15,description:'Iluminación práctica para tu espacio de trabajo o lectura.',images:[]},
  {id:7,name:'Set de cuidado facial esencial',category:'Belleza',price:29900,stock:32,description:'Una rutina esencial de cuidado diario en un set práctico.',images:[]},
  {id:8,name:'Parlante portátil Boom Mini',category:'Tecnología',price:55999,stock:0,description:'Sonido portátil para compartir tu música en cualquier lugar.',images:[]}
];
async function readDb(){try{return JSON.parse(await readFile(DB_FILE,'utf8'));}catch{return {products:seed,orders:[]};}}
let db = await readDb();
if(!Array.isArray(db.users))db.users=[];
async function persist(){await mkdir(DATA_DIR,{recursive:true}); await writeFile(DB_FILE,JSON.stringify(db,null,2),'utf8');}
const sessions = new Map();
function send(res,status,data,headers={}){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers});res.end(JSON.stringify(data));}
async function bodyJson(req){let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>10_000_000)throw new Error('Solicitud demasiado grande');}return raw?JSON.parse(raw):{};}
function sessionFor(req){let token=(req.headers.authorization||'').replace(/^Bearer\s+/i,'');if(!token){const cookie=req.headers.cookie||'';token=cookie.split(';').map(x=>x.trim()).find(x=>x.startsWith('nube_session='))?.slice('nube_session='.length)||'';}const session=sessions.get(token);if(!session||session.expires<Date.now()){sessions.delete(token);return null;}return session;}
function authorized(req){return sessionFor(req)?.role==='admin';}
function customerSession(req){const session=sessionFor(req);return session?.role==='customer'?session:null;}
function sessionCookie(token,maxAge=60*60*24*30){const secure=(process.env.SITE_URL||'').startsWith('https://')?'; Secure':'';return `nube_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure}`;}
function newSession(role,userId=null){const token=randomUUID()+randomUUID();sessions.set(token,{role,userId,expires:Date.now()+(role==='admin'?8:24*30)*60*60*1000});return token;}
function passwordHash(password,salt){return scryptSync(String(password??''),salt,64).toString('hex');}
function passwordMatches(input,user){const actual=Buffer.from(passwordHash(input,user.salt),'hex');const expected=Buffer.from(user.passwordHash,'hex');return actual.length===expected.length&&timingSafeEqual(actual,expected);}
function requireAdmin(req,res){if(!authorized(req)){send(res,401,{error:'Iniciá sesión como administrador.'});return false;}return true;}
async function createPreference(order){
  if(!process.env.MERCADOPAGO_ACCESS_TOKEN)throw new Error('Falta configurar MERCADOPAGO_ACCESS_TOKEN en el servidor.');
  const base=(process.env.SITE_URL||'').replace(/\/$/,'');
  if(!base.startsWith('https://'))throw new Error('SITE_URL debe ser la URL HTTPS pública de la tienda.');
  const response=await fetch('https://api.mercadopago.com/checkout/preferences',{method:'POST',headers:{Authorization:`Bearer ${process.env.MERCADOPAGO_ACCESS_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({items:order.items.map(i=>({id:String(i.id),title:i.name,quantity:i.quantity,currency_id:'ARS',unit_price:i.unitPrice})),external_reference:order.id,notification_url:`${base}/api/webhooks/mercadopago`,back_urls:{success:`${base}/?payment=success&order=${order.id}`,pending:`${base}/?payment=pending&order=${order.id}`,failure:`${base}/?payment=failure&order=${order.id}`},auto_return:'approved',binary_mode:true,expires:true,expiration_date_from:new Date().toISOString(),expiration_date_to:new Date(Date.now()+30*60*1000).toISOString(),payment_methods:{excluded_payment_types:[{id:'ticket'},{id:'bank_transfer'}]}})});
  const result=await response.json();if(!response.ok)throw new Error(result.message||'Mercado Pago no pudo crear la preferencia.');return result;
}
function validWebhook(req,url,dataId){
  const signature=req.headers['x-signature'];const requestId=req.headers['x-request-id'];const secret=process.env.MERCADOPAGO_WEBHOOK_SECRET;
  if(!signature||!requestId||!secret||!dataId)return false;
  const parts=Object.fromEntries(signature.split(',').map(x=>x.trim().split('=')));
  if(!parts.ts||!parts.v1)return false;
  const manifest=`id:${String(dataId).toLowerCase()};request-id:${requestId};ts:${parts.ts};`;
  const expected=createHmac('sha256',secret).update(manifest).digest('hex');
  const a=Buffer.from(expected);const b=Buffer.from(parts.v1);return a.length===b.length&&timingSafeEqual(a,b);
}
async function updateFromPayment(paymentId){
  const response=await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`,{headers:{Authorization:`Bearer ${process.env.MERCADOPAGO_ACCESS_TOKEN}`}});
  if(!response.ok)throw new Error('No se pudo consultar el pago en Mercado Pago.');
  const payment=await response.json();const order=db.orders.find(o=>o.id===payment.external_reference);if(!order)return;
  if(Number(payment.transaction_amount)!==order.total)return;
  if(payment.status==='approved'){if(order.stockReserved){order.stockReserved=false;order.stockDeducted=true;order.status='En preparación';}else if(!order.stockDeducted){const enough=order.items.every(line=>{const product=db.products.find(p=>p.id===line.id);return product&&product.stock>=line.quantity;});if(enough){for(const line of order.items){const product=db.products.find(p=>p.id===line.id);product.stock-=line.quantity;}order.stockDeducted=true;order.status='En preparación';}else order.status='Pago aprobado · revisar stock';}order.paymentStatus='approved';order.paymentMethod=payment.payment_method_id||'Tarjeta';}
  else if(payment.status==='rejected'){if(order.stockReserved){for(const line of order.items){const product=db.products.find(p=>p.id===line.id);if(product)product.stock+=line.quantity;}order.stockReserved=false;}order.paymentStatus='rejected';order.status='Pago rechazado';}
  else if(payment.status==='pending'||payment.status==='in_process'){order.paymentStatus=payment.status;order.status='Pago en revisión';}
  await persist();
}
async function api(req,res,url){
  if(req.method==='GET'&&url.pathname==='/api/products')return send(res,200,{products:db.products});
  if(req.method==='POST'&&url.pathname==='/api/admin/login'){
    const {email,password}=await bodyJson(req);if(!process.env.ADMIN_EMAIL||!process.env.ADMIN_PASSWORD)return send(res,503,{error:'Configurá ADMIN_EMAIL y ADMIN_PASSWORD en el servidor.'});
    if(email!==process.env.ADMIN_EMAIL||password!==process.env.ADMIN_PASSWORD)return send(res,401,{error:'Correo o contraseña incorrectos.'});
    const token=newSession('admin');return send(res,200,{ok:true,token});
  }
  if(url.pathname.startsWith('/api/admin/')){
    if(!requireAdmin(req,res))return;
    if(req.method==='POST'&&url.pathname==='/api/admin/products'){
      const p=await bodyJson(req);if(!p.name||!Number.isFinite(Number(p.price))||Number(p.price)<=0||!Number.isInteger(Number(p.stock))||Number(p.stock)<0||!p.description||!Array.isArray(p.images)||!p.images.length)return send(res,400,{error:'Revisá los datos obligatorios y agregá una foto.'});
      const product={...p,id:Date.now(),price:Number(p.price),stock:Number(p.stock)};db.products.unshift(product);await persist();return send(res,201,{product});
    }
    const editProductMatch=url.pathname.match(/^\/api\/admin\/products\/(\d+)$/);
    if(req.method==='PATCH'&&editProductMatch){const p=db.products.find(x=>x.id===Number(editProductMatch[1]));if(!p)return send(res,404,{error:'Producto no encontrado.'});const input=await bodyJson(req);if(!input.name||!Number.isFinite(Number(input.price))||Number(input.price)<=0||!Number.isInteger(Number(input.stock))||Number(input.stock)<0||!input.description||!Array.isArray(input.images)||!input.images.length)return send(res,400,{error:'Revisá todos los campos y agregá al menos una foto.'});Object.assign(p,input,{id:p.id,price:Number(input.price),stock:Number(input.stock)});await persist();return send(res,200,{product:p});}
    const stockMatch=url.pathname.match(/^\/api\/admin\/products\/(\d+)\/stock$/);
    if(req.method==='PATCH'&&stockMatch){const {stock}=await bodyJson(req);const p=db.products.find(x=>x.id===Number(stockMatch[1]));if(!p)return send(res,404,{error:'Producto no encontrado.'});if(!Number.isInteger(stock)||stock<0)return send(res,400,{error:'Stock inválido.'});p.stock=stock;await persist();return send(res,200,{product:p});}
    const deleteMatch=url.pathname.match(/^\/api\/admin\/products\/(\d+)$/);
    if(req.method==='DELETE'&&deleteMatch){db.products=db.products.filter(x=>x.id!==Number(deleteMatch[1]));await persist();return send(res,200,{ok:true});}
    const orderStatusMatch=url.pathname.match(/^\/api\/admin\/orders\/([a-f0-9-]+)\/status$/i);
    if(req.method==='PATCH'&&orderStatusMatch){const {status}=await bodyJson(req);const order=db.orders.find(o=>o.id===orderStatusMatch[1]);if(!order)return send(res,404,{error:'Pedido no encontrado.'});if(order.paymentStatus!=='approved'||!order.stockDeducted||!['En preparación','Enviado','Entregado'].includes(order.status))return send(res,409,{error:'Solo se puede despachar un pedido pagado y con stock reservado.'});if(!['En preparación','Enviado','Entregado'].includes(status))return send(res,400,{error:'Estado de envío inválido.'});order.status=status;await persist();return send(res,200,{order});}
    if(req.method==='GET'&&url.pathname==='/api/admin/orders')return send(res,200,{orders:db.orders});
    return send(res,404,{error:'Ruta administrativa inexistente.'});
  }
  if(req.method==='GET'&&url.pathname==='/api/auth/me'){const session=customerSession(req);const user=session&&db.users.find(x=>x.id===session.userId);return send(res,200,{user:user?{id:user.id,name:user.name,email:user.email}:null});}
  if(req.method==='POST'&&url.pathname==='/api/auth/register'){
    const {name,email,password}=await bodyJson(req);const normalized=String(email||'').trim().toLowerCase();
    if(!String(name||'').trim()||normalized.length>254||!/^\S+@\S+\.\S+$/.test(normalized)||String(password||'').length<10||String(password||'').length>128)return send(res,400,{error:'Ingresá tu nombre, un correo válido y una contraseña de al menos 10 caracteres.'});
    if(db.users.some(u=>u.email===normalized))return send(res,409,{error:'Ya existe una cuenta con ese correo.'});
    const salt=randomBytes(16).toString('hex');const user={id:randomUUID(),name:String(name).trim().slice(0,100),email:normalized,salt,passwordHash:passwordHash(password,salt),createdAt:new Date().toISOString()};db.users.push(user);await persist();const token=newSession('customer',user.id);return send(res,201,{user:{id:user.id,name:user.name,email:user.email}},{'Set-Cookie':sessionCookie(token)});
  }
  if(req.method==='POST'&&url.pathname==='/api/auth/login'){
    const {email,password}=await bodyJson(req);const user=db.users.find(x=>x.email===String(email||'').trim().toLowerCase());
    if(!user||!passwordMatches(password,user))return send(res,401,{error:'Correo o contraseña incorrectos.'});
    const token=newSession('customer',user.id);return send(res,200,{user:{id:user.id,name:user.name,email:user.email}},{'Set-Cookie':sessionCookie(token)});
  }
  if(req.method==='POST'&&url.pathname==='/api/auth/logout'){const session=customerSession(req);if(session)for(const [token,value] of sessions)if(value===session)sessions.delete(token);return send(res,200,{ok:true},{'Set-Cookie':sessionCookie('',0)});}
  if(req.method==='GET'&&url.pathname==='/api/my/orders'){const session=customerSession(req);if(!session)return send(res,401,{error:'Iniciá sesión para ver tus compras.'});return send(res,200,{orders:db.orders.filter(o=>o.userId===session.userId)});}  if(req.method==='POST'&&url.pathname==='/api/checkout'){
    const session=customerSession(req);if(!session)return send(res,401,{error:'Iniciá sesión o creá una cuenta para comprar.'});
    const {items}=await bodyJson(req);if(!Array.isArray(items)||!items.length)return send(res,400,{error:'El carrito está vacío.'});
    const requested=new Map();for(const item of items){const id=Number(item.id),quantity=Number(item.qty);if(!Number.isInteger(id)||!Number.isInteger(quantity)||quantity<1)return send(res,400,{error:'El carrito tiene cantidades inválidas.'});requested.set(id,(requested.get(id)||0)+quantity);}
    const lines=[];for(const [id,quantity] of requested){const p=db.products.find(x=>x.id===id);if(!p||quantity>p.stock)return send(res,409,{error:`No hay stock suficiente de ${p?.name||'uno de los productos'}.`});lines.push({id:p.id,name:p.name,emoji:p.emoji||'📦',quantity,qty:quantity,unitPrice:p.price});}
    const order={id:randomUUID(),userId:session.userId,createdAt:new Date().toISOString(),items:lines,total:lines.reduce((sum,x)=>sum+x.quantity*x.unitPrice,0),paymentStatus:'pending',status:'Esperando el pago',stockReserved:true,stockDeducted:false,reservationExpiresAt:Date.now()+30*60*1000};db.orders.unshift(order);for(const line of lines){const product=db.products.find(p=>p.id===line.id);product.stock-=line.quantity;}await persist();
    try{const preference=await createPreference(order);order.preferenceId=preference.id;await persist();return send(res,201,{orderId:order.id,checkoutUrl:preference.init_point});}catch(error){for(const line of lines){const product=db.products.find(p=>p.id===line.id);if(product)product.stock+=line.quantity;}db.orders=db.orders.filter(o=>o.id!==order.id);await persist();return send(res,502,{error:error.message});}
  }
  if(req.method==='GET'&&url.pathname.startsWith('/api/orders/')){const session=customerSession(req);if(!session)return send(res,401,{error:'Iniciá sesión para consultar tu pedido.'});const id=decodeURIComponent(url.pathname.split('/').pop());const order=db.orders.find(o=>o.id===id&&o.userId===session.userId);return order?send(res,200,{order}):send(res,404,{error:'Pedido no encontrado.'});}
  if(req.method==='POST'&&url.pathname==='/api/webhooks/mercadopago'){
    const data=await bodyJson(req);const paymentId=url.searchParams.get('data.id')||data.data?.id;const type=url.searchParams.get('type')||data.type;
    if(type!=='payment'||!validWebhook(req,url,paymentId))return send(res,401,{error:'Firma de notificación inválida.'});
    await updateFromPayment(paymentId);return send(res,200,{received:true});
  }
  return send(res,404,{error:'Ruta API inexistente.'});
}
async function loadEnv(){try{const text=await readFile(resolve(ROOT,'.env'),'utf8');for(const line of text.split(/\r?\n/)){const m=line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);if(m&&!process.env[m[1]])process.env[m[1]]=m[2].replace(/^(['"])(.*)\1$/,'$2');}}catch{}}
await loadEnv();
setInterval(async()=>{let changed=false;for(const order of db.orders){if(order.stockReserved&&order.reservationExpiresAt<Date.now()){for(const line of order.items){const product=db.products.find(p=>p.id===line.id);if(product)product.stock+=line.quantity;}order.stockReserved=false;order.paymentStatus='expired';order.status='Pago vencido';changed=true;}}if(changed)await persist();},60000).unref();
const server=createServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost');if(url.pathname.startsWith('/api/'))return await api(req,res,url);let file=url.pathname==='/'?'index.html':decodeURIComponent(url.pathname.slice(1));if(file.includes('..'))return send(res,400,{error:'Ruta inválida.'});const path=resolve(ROOT,file);if(!path.startsWith(ROOT))return send(res,400,{error:'Ruta inválida.'});const content=await readFile(path);res.writeHead(200,{'Content-Type':MIME[extname(path)]||'application/octet-stream','X-Content-Type-Options':'nosniff'});res.end(content);}catch(error){console.error(error);if(!res.headersSent)send(res,500,{error:error.message||'Error interno.'});}});
server.listen(PORT,()=>console.log(`Mercado Nube disponible en http://localhost:${PORT}`));

