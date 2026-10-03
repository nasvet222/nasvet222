require("dotenv").config();
const express = require("express");
const cookieParser = require("cookie-parser");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const Database = require("better-sqlite3");
const crypto = require("crypto");
const path = require("path");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const JWT_SECRET = process.env.JWT_SECRET || "dev-only-change-me";
const db = new Database(path.join(__dirname, "data", "nasvay.db"));
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'customer',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  price INTEGER NOT NULL,
  image TEXT NOT NULL,
  stock INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  reference TEXT UNIQUE,
  customer_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT DEFAULT '',
  address TEXT NOT NULL,
  city TEXT DEFAULT '',
  state TEXT DEFAULT '',
  total INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  payment_status TEXT NOT NULL DEFAULT 'unpaid',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  product_id INTEGER,
  product_name TEXT NOT NULL,
  price INTEGER NOT NULL,
  quantity INTEGER NOT NULL,
  FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE,
  FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE SET NULL
);
`);

const productCount = db.prepare("SELECT COUNT(*) AS c FROM products").get().c;
if (!productCount) {
  const seed = db.prepare("INSERT INTO products (name,description,price,image,stock) VALUES (?,?,?,?,?)");
  const products = [
    ["Silk Evening Dress","Elegant flowing dress for evenings and special occasions.",8500000,"https://images.unsplash.com/photo-1496747611176-843222e1e57c?auto=format&fit=crop&w=900&q=80",10],
    ["Classic Blazer","Structured blazer for a polished everyday look.",7200000,"https://images.unsplash.com/photo-1485968579580-b6d095142e6e?auto=format&fit=crop&w=900&q=80",12],
    ["Signature Dress","A timeless silhouette with a modern finish.",9500000,"https://images.unsplash.com/photo-1539109136881-3be0616acf4b?auto=format&fit=crop&w=900&q=80",8],
    ["Minimal Set","Comfortable coordinated set for effortless style.",6800000,"https://images.unsplash.com/photo-1529139574466-a303027c1d8b?auto=format&fit=crop&w=900&q=80",15]
  ];
  const tx = db.transaction(() => products.forEach(p => seed.run(...p)));
  tx();
}
const adminEmail = process.env.ADMIN_EMAIL || "admin@nasvay.com";
const adminPassword = process.env.ADMIN_PASSWORD || "ChangeMe123!";
if (!db.prepare("SELECT id FROM users WHERE email=?").get(adminEmail)) {
  db.prepare("INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,?)")
    .run("NASVAY Admin", adminEmail, bcrypt.hashSync(adminPassword, 12), "admin");
}

app.use(express.json({verify:(req,res,buf)=>{req.rawBody=buf}}));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

function signUser(user) {
  return jwt.sign({id:user.id, role:user.role, email:user.email}, JWT_SECRET, {expiresIn:"7d"});
}
function auth(req,res,next) {
  try {
    const token = req.cookies.nasvay_token;
    if (!token) return res.status(401).json({error:"Please log in"});
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch { return res.status(401).json({error:"Session expired"}); }
}
function admin(req,res,next) {
  if (req.user?.role !== "admin") return res.status(403).json({error:"Admin access required"});
  next();
}
function naira(kobo) { return Math.round(kobo); }

app.get("/api/products", (req,res) => {
  const rows = db.prepare("SELECT * FROM products WHERE active=1 ORDER BY id DESC").all();
  res.json(rows);
});
app.get("/api/products/:id", (req,res) => {
  const p = db.prepare("SELECT * FROM products WHERE id=? AND active=1").get(req.params.id);
  if (!p) return res.status(404).json({error:"Product not found"});
  res.json(p);
});

app.post("/api/register", async (req,res) => {
  const {name,email,password} = req.body;
  if (!name || !email || !password || password.length < 8) return res.status(400).json({error:"Name, email and an 8+ character password are required"});
  try {
    const hash = await bcrypt.hash(password,12);
    const info = db.prepare("INSERT INTO users(name,email,password_hash) VALUES(?,?,?)").run(name,email.toLowerCase().trim(),hash);
    const user = db.prepare("SELECT id,name,email,role FROM users WHERE id=?").get(info.lastInsertRowid);
    res.cookie("nasvay_token", signUser(user), {httpOnly:true,sameSite:"lax",secure:process.env.NODE_ENV==="production",maxAge:7*24*3600*1000});
    res.json({user});
  } catch(e) {
    res.status(400).json({error:"Email is already registered"});
  }
});
app.post("/api/login", async (req,res) => {
  const {email,password} = req.body;
  const user = db.prepare("SELECT * FROM users WHERE email=?").get((email||"").toLowerCase().trim());
  if (!user || !(await bcrypt.compare(password||"",user.password_hash))) return res.status(401).json({error:"Invalid email or password"});
  const safe = {id:user.id,name:user.name,email:user.email,role:user.role};
  res.cookie("nasvay_token", signUser(safe), {httpOnly:true,sameSite:"lax",secure:process.env.NODE_ENV==="production",maxAge:7*24*3600*1000});
  res.json({user:safe});
});
app.post("/api/logout",(req,res)=>{res.clearCookie("nasvay_token");res.json({ok:true})});
app.get("/api/me",auth,(req,res)=>{
  const user = db.prepare("SELECT id,name,email,role,created_at FROM users WHERE id=?").get(req.user.id);
  res.json({user});
});

function validateCart(items) {
  if (!Array.isArray(items) || !items.length || items.length > 50) throw new Error("Invalid cart");
  const get = db.prepare("SELECT id,name,price,stock,active FROM products WHERE id=?");
  let total = 0; const normalized=[];
  for (const item of items) {
    const p = get.get(Number(item.product_id));
    const qty = Number(item.quantity);
    if (!p || !p.active || !Number.isInteger(qty) || qty < 1 || qty > p.stock) throw new Error(`Invalid quantity for product ${item.product_id}`);
    total += p.price * qty;
    normalized.push({product_id:p.id,name:p.name,price:p.price,quantity:qty});
  }
  return {total,items:normalized};
}

app.post("/api/orders/prepare",auth,(req,res)=>{
  try {
    const {customer,items}=req.body;
    if (!customer?.name || !customer?.email || !customer?.address) return res.status(400).json({error:"Name, email and address are required"});
    const cart=validateCart(items);
    res.json(cart);
  } catch(e){res.status(400).json({error:e.message});}
});

app.post("/api/paystack/initialize",auth,async(req,res)=>{
  try {
    if (!process.env.PAYSTACK_SECRET_KEY) return res.status(503).json({error:"Paystack is not configured. Add PAYSTACK_SECRET_KEY to .env"});
    const {customer,items}=req.body;
    if (!customer?.name || !customer?.email || !customer?.address) return res.status(400).json({error:"Complete your delivery details"});
    const cart=validateCart(items);
    const reference=`NASVAY-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
    const insertOrder=db.prepare(`INSERT INTO orders(user_id,reference,customer_name,email,phone,address,city,state,total)
      VALUES(?,?,?,?,?,?,?,?,?)`).run(req.user.id,reference,customer.name,customer.email,customer.phone||"",customer.address,customer.city||"",customer.state||"",cart.total);
    const orderId=insertOrder.lastInsertRowid;
    const itemStmt=db.prepare("INSERT INTO order_items(order_id,product_id,product_name,price,quantity) VALUES(?,?,?,?,?)");
    const tx=db.transaction(()=>cart.items.forEach(i=>itemStmt.run(orderId,i.product_id,i.name,i.price,i.quantity)));
    tx();

    const response=await fetch("https://api.paystack.co/transaction/initialize",{
      method:"POST",
      headers:{"Authorization":`Bearer ${process.env.PAYSTACK_SECRET_KEY}`,"Content-Type":"application/json"},
      body:JSON.stringify({
        email:customer.email,
        amount:naira(cart.total),
        currency:"NGN",
        reference,
        callback_url:`${BASE_URL}/payment-success.html`,
        metadata:{order_id:String(orderId)}
      })
    });
    const data=await response.json();
    if(!response.ok || !data.status) throw new Error(data.message || "Could not initialize payment");
    res.json({authorization_url:data.data.authorization_url,access_code:data.data.access_code,reference,order_id:orderId});
  } catch(e){res.status(400).json({error:e.message});}
});

async function verifyPaystack(reference) {
  const response=await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,{
    headers:{Authorization:`Bearer ${process.env.PAYSTACK_SECRET_KEY}`}
  });
  return response.json();
}
function fulfillPaidOrder(reference, paystackData) {
  const order=db.prepare("SELECT * FROM orders WHERE reference=?").get(reference);
  if(!order) return false;
  if(order.payment_status==="paid") return true;
  if(paystackData.status!=="success" || Number(paystackData.amount)!==Number(order.total)) return false;
  const items=db.prepare("SELECT product_id,quantity FROM order_items WHERE order_id=?").all(order.id);
  const updateStock=db.prepare("UPDATE products SET stock=stock-? WHERE id=? AND stock>=?");
  const tx=db.transaction(()=>{
    for(const i of items){
      const result=updateStock.run(i.quantity,i.product_id,i.quantity);
      if(result.changes!==1) throw new Error("Insufficient stock");
    }
    db.prepare("UPDATE orders SET payment_status='paid',status='processing' WHERE id=?").run(order.id);
  });
  try { tx(); return true; } catch { return false; }
}
app.get("/api/paystack/verify/:reference",auth,async(req,res)=>{
  try {
    const order=db.prepare("SELECT * FROM orders WHERE reference=? AND user_id=?").get(req.params.reference,req.user.id);
    if(!order) return res.status(404).json({error:"Order not found"});
    if(!process.env.PAYSTACK_SECRET_KEY) return res.status(503).json({error:"Paystack is not configured"});
    const result=await verifyPaystack(req.params.reference);
    const paid=fulfillPaidOrder(req.params.reference,result.data||{});
    const updated=db.prepare("SELECT * FROM orders WHERE id=?").get(order.id);
    res.json({paid,order:updated});
  } catch(e){res.status(400).json({error:e.message});}
});

app.post("/api/paystack/webhook",(req,res)=>{
  const signature=req.headers["x-paystack-signature"];
  const expected=crypto.createHmac("sha512",process.env.PAYSTACK_SECRET_KEY||"").update(req.rawBody||"").digest("hex");
  if(!signature || signature!==expected) return res.sendStatus(401);
  res.sendStatus(200);
  const event=req.body;
  if(event.event==="charge.success" && event.data?.reference) {
    try { fulfillPaidOrder(event.data.reference,event.data); } catch(e) { console.error(e); }
  }
});

app.get("/api/orders",auth,(req,res)=>{
  const orders=db.prepare("SELECT * FROM orders WHERE user_id=? ORDER BY id DESC").all(req.user.id);
  const itemStmt=db.prepare("SELECT * FROM order_items WHERE order_id=?");
  res.json(orders.map(o=>({...o,items:itemStmt.all(o.id)})));
});

app.get("/api/admin/orders",auth,admin,(req,res)=>{
  const orders=db.prepare(`SELECT o.*,u.email AS account_email FROM orders o LEFT JOIN users u ON u.id=o.user_id ORDER BY o.id DESC`).all();
  const items=db.prepare("SELECT * FROM order_items WHERE order_id=?");
  res.json(orders.map(o=>({...o,items:items.all(o.id)})));
});
app.patch("/api/admin/orders/:id",auth,admin,(req,res)=>{
  const allowed=["pending","processing","shipped","delivered","cancelled"];
  if(!allowed.includes(req.body.status)) return res.status(400).json({error:"Invalid status"});
  db.prepare("UPDATE orders SET status=? WHERE id=?").run(req.body.status,req.params.id);
  res.json({ok:true});
});
app.post("/api/admin/products",auth,admin,(req,res)=>{
  const {name,description,price,image,stock}=req.body;
  if(!name || !Number.isInteger(Number(price)) || Number(price)<1 || !image) return res.status(400).json({error:"Name, price and image are required"});
  const info=db.prepare("INSERT INTO products(name,description,price,image,stock) VALUES(?,?,?,?,?)").run(name,description||"",Number(price),image,Number(stock||0));
  res.json(db.prepare("SELECT * FROM products WHERE id=?").get(info.lastInsertRowid));
});
app.patch("/api/admin/products/:id",auth,admin,(req,res)=>{
  const fields=["name","description","price","image","stock","active"];
  const current=db.prepare("SELECT * FROM products WHERE id=?").get(req.params.id);
  if(!current) return res.status(404).json({error:"Product not found"});
  const data={...current,...req.body};
  db.prepare("UPDATE products SET name=?,description=?,price=?,image=?,stock=?,active=? WHERE id=?")
    .run(data.name,data.description,Number(data.price),data.image,Number(data.stock),Number(data.active),req.params.id);
  res.json(db.prepare("SELECT * FROM products WHERE id=?").get(req.params.id));
});
app.delete("/api/admin/products/:id",auth,admin,(req,res)=>{
  db.prepare("UPDATE products SET active=0 WHERE id=?").run(req.params.id);
  res.json({ok:true});
});

app.get("/{*splat}",(req,res)=>{
  if(req.path.startsWith("/api/")) return res.status(404).json({error:"Not found"});
  res.sendFile(path.join(__dirname,"public","index.html"));
});
app.listen(PORT,()=>console.log(`NASVAY running at ${BASE_URL}`));
