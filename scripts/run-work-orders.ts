const base = (process.env.WORK_ORDERS_BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const secret = process.env.WORK_ORDERS_RUN_SECRET;

if (!secret) {
  console.error("Set WORK_ORDERS_RUN_SECRET (the API's run secret) to run the work-order job.");
  process.exit(1);
}

const res = await fetch(`${base}/api/work-orders/run`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${secret}`, origin: base },
  body: "{}",
});
const text = await res.text();
if (!res.ok) {
  console.error(`POST /api/work-orders/run → ${res.status}: ${text.slice(0, 400)}`);
  process.exit(1);
}
console.log(text);
