/**
 * 纳指100 ETF 场内溢价监控 Worker v2
 *
 * 实时数据优先级：
 * 1. 东方财富 ETF 行情（最新价 f2 + IOPV f441，同一条 ETF 快照）
 * 2. naKanban / Tinyright（同源价格 + 实时估值）
 * 3. HaoETF（同源价格 + 实时估值，仅已确认覆盖产品）
 * 4. Cloudflare 最近有效缓存
 *
 * 关键原则：
 * - 绝不跨平台拼接“价格”和“估值”。
 * - 溢价率始终由本 Worker 自算：price / estimate - 1。
 * - 东方财富 f402 是“基金折价率”，所以平台溢价校验值 = -f402。
 * - 东方财富 ETF 列表按 100 条/页分页拉取，避免 pz 超大导致缺页/截断。
 *
 * API:
 * GET /health
 * GET /api/premiums
 * GET /api/eastmoney-test
 * GET /api/annual?code=513100
 * GET /api/otc-nav-summary
 * GET /api/fund-history?code=000834
 * GET /api/otc-tracking-summary?currency=CNY|USD
 * GET /api/otc-usd-funds
 * GET /api/qqq
 */

const ETF_META = [
  { code:"513100", company:"国泰基金",     size:194.68, sizeDate:"2026-06-30", inception:"2013-04-25", managementFee:0.60, custodyFee:0.20 },
  { code:"159941", company:"广发基金",     size:346.82, sizeDate:"2026-06-30", inception:"2015-06-10", managementFee:0.80, custodyFee:0.20 },
  { code:"513300", company:"华夏基金",     size:128.77, sizeDate:"2026-06-30", inception:"2020-10-22", managementFee:0.60, custodyFee:0.20 },
  { code:"159632", company:"华安基金",     size:113.00, sizeDate:"2026-06-30", inception:"2022-07-21", managementFee:0.60, custodyFee:0.20 },
  { code:"513110", company:"华泰柏瑞",     size:49.33,  sizeDate:"2026-06-30", inception:"2023-03-01", managementFee:0.80, custodyFee:0.20 },
  { code:"159660", company:"汇添富",       size:49.10,  sizeDate:"2026-06-30", inception:"2023-03-30", managementFee:0.50, custodyFee:0.15 },
  { code:"159659", company:"招商基金",     size:99.36,  sizeDate:"2026-06-30", inception:"2023-04-12", managementFee:0.50, custodyFee:0.15 },
  { code:"513390", company:"博时基金",     size:42.50,  sizeDate:"2026-06-30", inception:"2023-04-19", managementFee:0.50, custodyFee:0.15 },
  { code:"159501", company:"嘉实基金",     size:118.44, sizeDate:"2026-06-30", inception:"2023-05-31", managementFee:0.50, custodyFee:0.10 },
  { code:"159513", company:"大成基金",     size:73.84,  sizeDate:"2026-06-30", inception:"2023-07-12", managementFee:0.80, custodyFee:0.20 },
  { code:"159696", company:"易方达",       size:50.11,  sizeDate:"2026-06-30", inception:"2023-08-17", managementFee:0.50, custodyFee:0.10 },
  { code:"513870", company:"富国基金",     size:24.71,  sizeDate:"2026-06-30", inception:"2023-10-25", managementFee:0.50, custodyFee:0.10 },
];


const OTC_CNY_META = [
  {code:"000834", name:"大成纳斯达克100ETF联接(QDII)A", company:"大成基金", share:"A", managementFee:0.80, custodyFee:0.20, serviceFee:0.00},
  {code:"006479", name:"广发纳斯达克100ETF联接人民币(QDII)C", company:"广发基金", share:"C", managementFee:0.80, custodyFee:0.20, serviceFee:0.20},
  {code:"008971", name:"大成纳斯达克100ETF联接(QDII)C", company:"大成基金", share:"C", managementFee:0.80, custodyFee:0.20, serviceFee:0.30},
  {code:"012752", name:"建信纳斯达克100指数(QDII)C人民币", company:"建信基金", share:"C", managementFee:0.80, custodyFee:0.20, serviceFee:0.30},
  {code:"014978", name:"华安纳斯达克100ETF联接(QDII)C", company:"华安基金", share:"C", managementFee:0.60, custodyFee:0.20, serviceFee:0.20},
  {code:"016452", name:"南方纳斯达克100指数发起(QDII)A", company:"南方基金", share:"A", managementFee:0.50, custodyFee:0.15, serviceFee:0.00},
  {code:"016453", name:"南方纳斯达克100指数发起(QDII)C", company:"南方基金", share:"C", managementFee:0.50, custodyFee:0.15, serviceFee:0.10},
  {code:"018966", name:"汇添富纳斯达克100ETF发起式联接(QDII)人民币A", company:"汇添富基金", share:"A", managementFee:0.50, custodyFee:0.15, serviceFee:0.00},
  {code:"018967", name:"汇添富纳斯达克100ETF发起式联接(QDII)人民币C", company:"汇添富基金", share:"C", managementFee:0.50, custodyFee:0.15, serviceFee:0.40},
  {code:"019172", name:"摩根纳斯达克100指数(QDII)人民币A", company:"摩根基金", share:"A", managementFee:0.50, custodyFee:0.10, serviceFee:0.00},
  {code:"019173", name:"摩根纳斯达克100指数(QDII)人民币C", company:"摩根基金", share:"C", managementFee:0.50, custodyFee:0.10, serviceFee:0.30},
  {code:"019441", name:"万家纳斯达克100指数发起式(QDII)A", company:"万家基金", share:"A", managementFee:0.50, custodyFee:0.15, serviceFee:0.00},
  {code:"019442", name:"万家纳斯达克100指数发起式(QDII)C", company:"万家基金", share:"C", managementFee:0.50, custodyFee:0.15, serviceFee:0.20},
  {code:"019524", name:"华泰柏瑞纳斯达克100ETF发起式联接(QDII)A", company:"华泰柏瑞基金", share:"A", managementFee:0.50, custodyFee:0.15, serviceFee:0.00},
  {code:"019525", name:"华泰柏瑞纳斯达克100ETF发起式联接(QDII)C", company:"华泰柏瑞基金", share:"C", managementFee:0.50, custodyFee:0.15, serviceFee:0.25},
  {code:"019547", name:"招商纳斯达克100ETF发起式联接(QDII)A", company:"招商基金", share:"A", managementFee:0.50, custodyFee:0.15, serviceFee:0.00},
  {code:"019548", name:"招商纳斯达克100ETF发起式联接(QDII)C", company:"招商基金", share:"C", managementFee:0.50, custodyFee:0.15, serviceFee:0.40},
  {code:"019736", name:"宝盈纳斯达克100指数发起(QDII)A人民币", company:"宝盈基金", share:"A", managementFee:0.50, custodyFee:0.15, serviceFee:0.00},
  {code:"019737", name:"宝盈纳斯达克100指数发起(QDII)C人民币", company:"宝盈基金", share:"C", managementFee:0.50, custodyFee:0.15, serviceFee:0.25},
  {code:"021000", name:"南方纳斯达克100指数发起(QDII)I", company:"南方基金", share:"I", managementFee:0.50, custodyFee:0.15, serviceFee:0.01},
  {code:"021773", name:"汇添富纳斯达克100ETF发起式联接(QDII)人民币E", company:"汇添富基金", share:"E", managementFee:0.50, custodyFee:0.15, serviceFee:0.10},
  {code:"021778", name:"广发纳指100ETF联接(QDII)人民币F", company:"广发基金", share:"F", managementFee:0.80, custodyFee:0.20, serviceFee:0.18},
  {code:"022664", name:"华泰柏瑞纳斯达克100ETF发起式联接(QDII)I", company:"华泰柏瑞基金", share:"I", managementFee:0.50, custodyFee:0.15, serviceFee:0.10},
  {code:"023422", name:"建信纳斯达克100指数(QDII)D人民币", company:"建信基金", share:"D", managementFee:0.80, custodyFee:0.20, serviceFee:0.30},
  {code:"040046", name:"华安纳斯达克100ETF联接(QDII)A", company:"华安基金", share:"A", managementFee:0.60, custodyFee:0.20, serviceFee:0.00},
  {code:"160213", name:"国泰纳斯达克100指数", company:"国泰基金", share:"单一", managementFee:0.80, custodyFee:0.20, serviceFee:0.00},
  {code:"270042", name:"广发纳斯达克100ETF联接人民币(QDII)A", company:"广发基金", share:"A", managementFee:0.80, custodyFee:0.20, serviceFee:0.00},
  {code:"539001", name:"建信纳斯达克100指数(QDII)A人民币", company:"建信基金", share:"A", managementFee:0.80, custodyFee:0.20, serviceFee:0.00},
  {code:"012870", name:"易方达纳斯达克100ETF联接(QDII-LOF)C(人民币)", company:"易方达基金", share:"C", managementFee:0.50, custodyFee:0.10, serviceFee:0.30},
  {code:"015299", name:"华夏纳斯达克100ETF发起式联接(QDII)A", company:"华夏基金", share:"A", managementFee:0.60, custodyFee:0.20, serviceFee:0.00},
  {code:"015300", name:"华夏纳斯达克100ETF发起式联接(QDII)C", company:"华夏基金", share:"C", managementFee:0.60, custodyFee:0.20, serviceFee:0.30},
  {code:"016055", name:"博时纳斯达克100ETF发起式联接(QDII)A人民币", company:"博时基金", share:"A", managementFee:0.50, custodyFee:0.15, serviceFee:0.00},
  {code:"016057", name:"博时纳斯达克100ETF发起式联接(QDII)C人民币", company:"博时基金", share:"C", managementFee:0.50, custodyFee:0.15, serviceFee:0.30},
  {code:"016532", name:"嘉实纳斯达克100ETF发起联接(QDII)A人民币", company:"嘉实基金", share:"A", managementFee:0.50, custodyFee:0.10, serviceFee:0.00},
  {code:"016533", name:"嘉实纳斯达克100ETF发起联接(QDII)C人民币", company:"嘉实基金", share:"C", managementFee:0.50, custodyFee:0.10, serviceFee:0.25},
  {code:"018043", name:"天弘纳斯达克100指数发起(QDII)A", company:"天弘基金", share:"A", managementFee:0.50, custodyFee:0.10, serviceFee:0.00},
  {code:"018044", name:"天弘纳斯达克100指数发起(QDII)C", company:"天弘基金", share:"C", managementFee:0.50, custodyFee:0.10, serviceFee:0.20},
  {code:"021838", name:"嘉实纳斯达克100ETF发起联接(QDII)I人民币", company:"嘉实基金", share:"I", managementFee:0.50, custodyFee:0.10, serviceFee:0.10},
  {code:"022525", name:"天弘纳斯达克100指数发起(QDII)D", company:"天弘基金", share:"D", managementFee:0.50, custodyFee:0.10, serviceFee:0.20},
  {code:"024237", name:"博时纳斯达克100ETF发起式联接(QDII)I人民币", company:"博时基金", share:"I", managementFee:0.50, custodyFee:0.15, serviceFee:0.15},
  {code:"161130", name:"易方达纳斯达克100ETF联接(QDII-LOF)A(人民币)", company:"易方达基金", share:"A", managementFee:0.50, custodyFee:0.10, serviceFee:0.00},
].map(x => ({
  ...x,
  currency:"CNY",
  currencyLabel:"人民币",
  annualFee:+(x.managementFee+x.custodyFee+x.serviceFee).toFixed(2)
}));

// 当前仅保留广发纳指100美元 A/C 两个份额。
// 美元份额不直接套用人民币额度日报；额度/状态单独读取。
const OTC_USD_META = [
  {
    code:"000055",
    mainCode:"270042",
    name:"广发纳斯达克100ETF联接(QDII)美元A",
    company:"广发基金",
    share:"A·美元现汇",
    managementFee:0.80,
    custodyFee:0.20,
    serviceFee:0.00
  },
  {
    code:"006480",
    mainCode:"270042",
    name:"广发纳斯达克100ETF联接(QDII)美元C",
    company:"广发基金",
    share:"C·美元现汇",
    managementFee:0.80,
    custodyFee:0.20,
    serviceFee:0.20
  },
].map(x => ({
  ...x,
  currency:"USD",
  currencyLabel:"美元",
  annualFee:+(
    x.managementFee+
    x.custodyFee+
    x.serviceFee
  ).toFixed(2)
}));

const OTC_META = [
  ...OTC_CNY_META,
  ...OTC_USD_META
];

const OTC_CNY_CODES = new Set(OTC_CNY_META.map(x => x.code));
const OTC_USD_CODES = new Set(OTC_USD_META.map(x => x.code));
const OTC_CODES = new Set(OTC_META.map(x => x.code));

const OTC_CNY_META_MAP = new Map(OTC_CNY_META.map(x => [x.code,x]));
const OTC_META_MAP = new Map(OTC_META.map(x => [x.code,x]));

// 17 个“基金产品”，41 个人民币份额。
// 每日只按主代码读取产品公告，再把公告状态映射回各份额。
const OTC_PRODUCTS = [
  {mainCode:"539001", shares:["539001","012752","023422"]},
  {mainCode:"160213", shares:["160213"]},
  {mainCode:"270042", shares:["270042","006479","021778"]},
  {mainCode:"040046", shares:["040046","014978"]},
  {mainCode:"000834", shares:["000834","008971"]},
  {mainCode:"161130", shares:["161130","012870"]},
  {mainCode:"015299", shares:["015299","015300"]},
  {mainCode:"016055", shares:["016055","016057","024237"]},
  {mainCode:"016532", shares:["016532","016533","021838"]},
  {mainCode:"018043", shares:["018043","018044","022525"]},
  {mainCode:"016452", shares:["016452","016453","021000"]},
  {mainCode:"018966", shares:["018966","018967","021773"]},
  {mainCode:"019172", shares:["019172","019173"]},
  {mainCode:"019441", shares:["019441","019442"]},
  {mainCode:"019524", shares:["019524","019525","022664"]},
  {mainCode:"019547", shares:["019547","019548"]},
  {mainCode:"019736", shares:["019736","019737"]}
];

const OTC_PRODUCT_MAP = new Map();
for (const p of OTC_PRODUCTS) {
  for (const code of p.shares) OTC_PRODUCT_MAP.set(code,p);
}

const OTC_USD_PRODUCTS = [
  {
    mainCode:"270042",
    shares:[
      "000055",
      "006480"
    ]
  }
];

const OTC_RESULT_CACHE_URL =
  "https://nasdaq100-etf-monitor.internal/otc-hybrid-result-v4";
const OTC_LAST_GOOD_CACHE_URL =
  "https://nasdaq100-etf-monitor.internal/otc-hybrid-last-good-v4";
const OTC_ENGINE_VERSION = "v3.26";
const OTC_RESULT_FRESH_MS = 5*60*1000;
const OTC_PRODUCT_CACHE_PREFIX =
  "https://nasdaq100-etf-monitor.internal/otc-product-ann-state-v3/";
const OTC_FEE_CACHE_PREFIX =
  "https://nasdaq100-etf-monitor.internal/otc-fee-v1/";
const OTC_NAV_SUMMARY_CACHE_PREFIX =
  "https://nasdaq100-etf-monitor.internal/otc-nav-summary-v5/";
const OTC_TRACKING_CACHE_PREFIX =
  "https://nasdaq100-etf-monitor.internal/otc-tracking-summary-v3/";
const OTC_USD_RESULT_CACHE_URL =
  "https://nasdaq100-etf-monitor.internal/otc-usd-result-v4";
const OTC_USD_LAST_GOOD_CACHE_URL =
  "https://nasdaq100-etf-monitor.internal/otc-usd-last-good-v4";
const FUND_HISTORY_CACHE_PREFIX =
  "https://nasdaq100-etf-monitor.internal/fund-history-v3/";


const EASTMONEY_NOTICE_LIST =
  "https://api.fund.eastmoney.com/f10/JJGG";
const EASTMONEY_NOTICE_CONTENT =
  "https://np-cnotice-fund.eastmoney.com/api/content/ann";

const ANXINLE_OTC_SOURCE_URL =
  "https://anxinletech.com/instrument-qdii.html";
const OTC_ANN_VERIFY_CACHE_PREFIX =
  "https://nasdaq100-etf-monitor.internal/otc-ann-verify-v4/";

const OTC_ANN_BUNDLE_CACHE_URL =
  "https://nasdaq100-etf-monitor.internal/otc-ann-bundle-v7";
const OTC_ANN_BUNDLE_FALLBACK_CACHE_URL =
  "https://nasdaq100-etf-monitor.internal/otc-ann-bundle-v6";

// A/C 通常跟随主代码公告；D/E/F/I 新增份额更容易存在独立公告。
// 因此每日检查 17 个主代码 + 这些特殊份额代码。
const OTC_SPECIAL_ANN_CODES = OTC_CNY_META
  .filter(x => ["D","E","F","I"].includes(x.share))
  .map(x => x.code);

const OTC_ANN_WATCH_CODES = [
  ...new Set([
    ...OTC_PRODUCTS.map(x => x.mainCode),
    ...OTC_SPECIAL_ANN_CODES
  ])
];

const ETF_CODES = new Set(ETF_META.map(x => x.code));
const ALL_FUND_CODES = new Set([...ETF_CODES,...OTC_CODES]);
const HAOETF_KNOWN = new Set([
  "159941","513100","513300","159632",
  "513110","513390","159660","159659"
]);

const EASTMONEY_UT = "bd1d9ddb04089700cf9c27f6f7426281";
const EASTMONEY_FS = "b:MK0021,b:MK0022,b:MK0023,b:MK0024,b:MK0827";
const EASTMONEY_FIELDS = "f2,f3,f12,f13,f14,f124,f297,f402,f441";
const LAST_GOOD_CACHE_URL = "https://nasdaq100-etf-monitor.internal/last-good-v2";
const RESULT_CACHE_URL = "https://nasdaq100-etf-monitor.internal/premiums-v3";
const QQQ_CACHE_URL =
  "https://nasdaq100-etf-monitor.internal/qqq-v2";

const QQQ_STATIC_META = {
  symbol:"QQQ",
  issuer:"Invesco",
  trackingIndex:"NASDAQ-100 Index",
  inception:"1999-03-10",
  currency:"USD",
  expenseRatio:0.18
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

function send(data, status=200, cacheControl="no-store") {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...CORS,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": cacheControl,
    }
  });
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function stripHtml(v) {
  return String(v ?? "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,"")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,"")
    .replace(/<[^>]+>/g," ")
    .replace(/&nbsp;|&#160;/gi," ")
    .replace(/&amp;/gi,"&")
    .replace(/&lt;/gi,"<")
    .replace(/&gt;/gi,">")
    .replace(/&#37;/gi,"%")
    .replace(/\s+/g," ")
    .trim();
}

function cellsFromRow(rowHtml) {
  return [...String(rowHtml).matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)]
    .map(m => stripHtml(m[1]));
}

function numberOf(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const t = stripHtml(v).replace(/,/g,"").replace(/%/g,"").trim();
  if (!t || t==="-" || t==="—" || t==="--") return null;
  const x = Number(t);
  return Number.isFinite(x) ? x : null;
}

function validPrice(v) {
  const x = numberOf(v);
  return x !== null && x > 0 && x < 100 ? x : null;
}

function validPercent(v) {
  const x = numberOf(v);
  return x !== null && Math.abs(x) < 200 ? x : null;
}

function premiumOf(price, estimate) {
  if (!(price > 0) || !(estimate > 0)) return null;
  return (price / estimate - 1) * 100;
}

function snapshotValid(s) {
  if (!s) return false;
  if (!(s.price > 0) || !(s.estimate > 0)) return false;
  if (!Number.isFinite(s.premium) || Math.abs(s.premium) > 200) return false;

  // 平台值只做校验。显示字段有四舍五入，保留 0.40 个百分点容差。
  if (Number.isFinite(s.platformPremium)) {
    if (Math.abs(s.premium - s.platformPremium) > 0.40) return false;
  }
  return true;
}

function shanghaiDateTimeFromUnix(sec) {
  const n = numberOf(sec);
  if (!n || n < 1_000_000_000) return null;
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      timeZone:"Asia/Shanghai",
      year:"numeric",month:"2-digit",day:"2-digit",
      hour:"2-digit",minute:"2-digit",second:"2-digit",
      hour12:false
    }).format(new Date(n*1000)).replace(/\//g,"-");
  } catch (_) {
    return null;
  }
}

function normalizeEastmoneyDate(v) {
  if (v === null || v === undefined) return null;
  const s = String(v);
  if (/^\d{8}$/.test(s)) return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`;
  return s;
}

async function fetchJson(url, timeout=8000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(url, {
      method:"GET",
      signal:ctl.signal,
      headers:{
        "Accept":"application/json,text/plain,*/*",
        "Referer":"https://quote.eastmoney.com/center/gridlist.html#fund_etf",
        "User-Agent":"Mozilla/5.0 (compatible; Nasdaq100-ETF-Monitor/2.0)"
      },
      cf:{cacheTtl:0,cacheEverything:false}
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    if (!j) throw new Error("empty json");
    return j;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchText(url, timeout=8000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(url, {
      method:"GET",
      signal:ctl.signal,
      headers:{
        "Accept":"text/html,application/xhtml+xml,*/*",
        "User-Agent":"Mozilla/5.0 (compatible; Nasdaq100-ETF-Monitor/2.0)"
      },
      cf:{cacheTtl:0,cacheEverything:false}
    });
    if (!r.ok) throw new Error(`${url} HTTP ${r.status}`);
    return await r.text();
  } finally {
    clearTimeout(timer);
  }
}


function usTradingDateFromUnix(sec){
  const n=Number(sec);

  if(
    !Number.isFinite(n) ||
    n<=0
  ){
    return null;
  }

  try{
    const parts=
      new Intl.DateTimeFormat(
        "en-US",
        {
          timeZone:"America/New_York",
          year:"numeric",
          month:"2-digit",
          day:"2-digit"
        }
      ).formatToParts(
        new Date(n*1000)
      );

    const map=Object.fromEntries(
      parts.map(
        p=>[p.type,p.value]
      )
    );

    return (
      map.year &&
      map.month &&
      map.day
    )
      ?`${map.year}-${map.month}-${map.day}`
      :null;
  }catch(_){
    return new Date(
      n*1000
    ).toISOString().slice(0,10);
  }
}

function parseYahooChartRows(
  j
){
  const result=
    j?.chart?.result?.[0];

  if(!result){
    throw new Error(
      j?.chart?.error?.description ||
      "Yahoo chart result missing"
    );
  }

  const timestamps=
    Array.isArray(
      result.timestamp
    )
      ?result.timestamp
      :[];

  const quote=
    result.indicators?.quote?.[0]||
    {};

  const adj=
    result.indicators?.adjclose?.[0]
      ?.adjclose||
    [];

  const rows=[];

  for(
    let i=0;
    i<timestamps.length;
    i++
  ){
    const date=
      usTradingDateFromUnix(
        timestamps[i]
      );

    const close=
      Number(
        quote.close?.[i]
      );

    const open=
      Number(
        quote.open?.[i]
      );

    const high=
      Number(
        quote.high?.[i]
      );

    const low=
      Number(
        quote.low?.[i]
      );

    const adjClose=
      Number(
        adj?.[i]
      );

    const volume=
      Number(
        quote.volume?.[i]
      );

    if(
      !date ||
      !Number.isFinite(close) ||
      close<=0
    ){
      continue;
    }

    rows.push({
      date,
      open:
        Number.isFinite(open)
          ?open
          :null,
      high:
        Number.isFinite(high)
          ?high
          :null,
      low:
        Number.isFinite(low)
          ?low
          :null,
      close,
      adjClose:
        Number.isFinite(adjClose) &&
        adjClose>0
          ?adjClose
          :close,
      volume:
        Number.isFinite(volume)
          ?volume
          :null,
      dailyReturn:null
    });
  }

  return {
    meta:result.meta||{},
    rows
  };
}

async function fetchYahooChartUrl(
  url,
  timeoutMs=12000
){
  const ctl=
    new AbortController();

  const timer=
    setTimeout(
      ()=>ctl.abort(),
      timeoutMs
    );

  try{
    const r=
      await fetch(
        url,
        {
          method:"GET",
          signal:ctl.signal,
          headers:{
            "Accept":
              "application/json,text/plain,*/*",
            "User-Agent":
              "Mozilla/5.0 (compatible; Nasdaq100-Fund-Monitor/3.25)"
          },
          cf:{
            cacheTtl:0,
            cacheEverything:false
          }
        }
      );

    if(!r.ok){
      throw new Error(
        `Yahoo QQQ HTTP ${r.status}`
      );
    }

    return await r.json();
  }finally{
    clearTimeout(timer);
  }
}

async function fetchYahooQqqRecent(){
  const url=
    "https://query1.finance.yahoo.com/v8/finance/chart/QQQ"+
    "?range=2mo"+
    "&interval=1d"+
    "&includePrePost=false"+
    "&events=div%2Csplits"+
    "&includeAdjustedClose=true";

  const j=
    await fetchYahooChartUrl(
      url,
      12000
    );

  return parseYahooChartRows(
    j
  );
}

function unixSecondsUtc(
  isoDate
){
  return Math.floor(
    Date.parse(
      `${isoDate}T00:00:00Z`
    )/1000
  );
}

function addUtcYears(
  date,
  years
){
  const d=
    new Date(
      `${date}T00:00:00Z`
    );

  d.setUTCFullYear(
    d.getUTCFullYear()+
    years
  );

  return d
    .toISOString()
    .slice(0,10);
}

async function fetchYahooQqqDailyChunk(
  startDate,
  endDate
){
  const p1=
    unixSecondsUtc(
      startDate
    );

  // Yahoo period2 is exclusive; +1 day avoids dropping end-date bars.
  const p2=
    unixSecondsUtc(
      endDate
    )+
    86400;

  const url=
    "https://query1.finance.yahoo.com/v8/finance/chart/QQQ"+
    `?period1=${p1}`+
    `&period2=${p2}`+
    "&interval=1d"+
    "&includePrePost=false"+
    "&events=div%2Csplits"+
    "&includeAdjustedClose=true";

  const j=
    await fetchYahooChartUrl(
      url,
      15000
    );

  return parseYahooChartRows(
    j
  );
}

async function fetchYahooQqqFullDaily(){
  const today=
    new Date()
      .toISOString()
      .slice(0,10);

  const chunks=[];

  let start=
    QQQ_STATIC_META.inception;

  // 3年一段，避免 Yahoo 对超长 1d 请求自动降采样成月线。
  while(start<=today){
    let end=
      addUtcYears(
        start,
        3
      );

    if(end>today){
      end=today;
    }

    chunks.push({
      start,
      end
    });

    if(end===today){
      break;
    }

    const next=
      new Date(
        `${end}T00:00:00Z`
      );

    next.setUTCDate(
      next.getUTCDate()+1
    );

    start=
      next
        .toISOString()
        .slice(0,10);
  }

  const results=
    await mapLimit(
      chunks,
      3,
      async chunk=>{
        try{
          return await fetchYahooQqqDailyChunk(
            chunk.start,
            chunk.end
          );
        }catch(e){
          return {
            meta:{},
            rows:[],
            error:
              e?.message||
              String(e)
          };
        }
      }
    );

  const merged=
    new Map();

  for(const r of results){
    for(const row of r.rows||[]){
      merged.set(
        row.date,
        row
      );
    }
  }

  const history=[
    ...merged.values()
  ].sort(
    (a,b)=>
      a.date.localeCompare(
        b.date
      )
  );

  if(
    history.length<
    3000
  ){
    throw new Error(
      `QQQ daily history unexpectedly short: ${history.length}`
    );
  }

  return history;
}

function finalizeQqqHistory(
  history
){
  const rows=
    (history||[])
      .slice()
      .sort(
        (a,b)=>
          a.date.localeCompare(
            b.date
          )
      );

  for(
    let i=0;
    i<rows.length;
    i++
  ){
    if(i===0){
      rows[i].dailyReturn=null;
      continue;
    }

    const prev=
      Number(
        rows[i-1].adjClose
      );

    const curr=
      Number(
        rows[i].adjClose
      );

    rows[i].dailyReturn=
      prev>0 &&
      curr>0
        ?(curr/prev-1)*100
        :null;
  }

  return rows;
}

function buildQqqAnnualSeries(
  history
){
  if(!history.length){
    return [];
  }

  const yearLast=
    new Map();

  for(const row of history){
    const year=
      Number(
        row.date.slice(0,4)
      );

    if(
      Number.isFinite(year) &&
      Number(row.adjClose)>0
    ){
      yearLast.set(
        year,
        Number(
          row.adjClose
        )
      );
    }
  }

  const years=[
    ...yearLast.keys()
  ].sort(
    (a,b)=>a-b
  );

  const currentYear=
    Number(
      history[
        history.length-1
      ].date.slice(0,4)
    );

  const out=[];

  for(
    let i=0;
    i<years.length;
    i++
  ){
    const year=
      years[i];

    const last=
      yearLast.get(year);

    let base=null;

    if(i>0){
      base=
        yearLast.get(
          years[i-1]
        );
    }else{
      const first=
        history.find(
          r=>
            Number(
              r.date.slice(0,4)
            )===year
        );

      base=
        Number(
          first?.adjClose
        );
    }

    if(
      !(last>0) ||
      !(base>0)
    ){
      continue;
    }

    out.push({
      year,
      returnPct:
        (last/base-1)*100,
      label:
        year===currentYear
          ?"YTD"
          :String(year),
      method:
        i>0
          ?"adjusted_close_year_end"
          :"adjusted_close_since_inception"
    });
  }

  return out
    .sort(
      (a,b)=>b.year-a.year
    );
}

async function fetchYahooQqq(){
  const [
    recent,
    fullHistoryRaw
  ]=
    await Promise.all([
      fetchYahooQqqRecent(),
      fetchYahooQqqFullDaily()
    ]);

  const merged=
    new Map(
      fullHistoryRaw.map(
        r=>[r.date,r]
      )
    );

  // 用近期请求覆盖最后两个月，确保最新交易日/当前日线完整。
  for(const row of recent.rows||[]){
    merged.set(
      row.date,
      row
    );
  }

  const history=
    finalizeQqqHistory(
      [
        ...merged.values()
      ]
    );

  const latest=
    history[
      history.length-1
    ];

  const previous=
    history.length>=2
      ?history[
          history.length-2
        ]
      :null;

  const meta=
    recent.meta||{};

  const metaPrice=
    Number(
      meta.regularMarketPrice
    );

  const price=
    Number.isFinite(metaPrice) &&
    metaPrice>0
      ?metaPrice
      :Number(
          latest?.close
        );

  // previousClose 必须来自最近真实日线，不再使用 long-range meta.previousClose。
  const previousClose=
    Number(
      previous?.close
    );

  const change=
    Number.isFinite(price) &&
    previousClose>0
      ?price-
        previousClose
      :null;

  const changePct=
    change!==null
      ?change/
        previousClose*
        100
      :null;

  const dayHighMeta=
    Number(
      meta.regularMarketDayHigh
    );

  const dayLowMeta=
    Number(
      meta.regularMarketDayLow
    );

  const dayHigh=
    Number.isFinite(dayHighMeta)
      ?dayHighMeta
      :Number(
          latest?.high
        );

  const dayLow=
    Number.isFinite(dayLowMeta)
      ?dayLowMeta
      :Number(
          latest?.low
        );

  const week52High=
    Number(
      meta.fiftyTwoWeekHigh
    );

  const week52Low=
    Number(
      meta.fiftyTwoWeekLow
    );

  const volumeMeta=
    Number(
      meta.regularMarketVolume
    );

  const years=
    buildQqqAnnualSeries(
      history
    );

  return {
    fund:{
      ...QQQ_STATIC_META,
      name:
        meta.longName||
        meta.shortName||
        "Invesco QQQ",
      exchange:
        meta.fullExchangeName||
        meta.exchangeName||
        "NASDAQ"
    },
    quote:{
      price:
        Number.isFinite(price)
          ?price
          :null,
      previousClose:
        Number.isFinite(
          previousClose
        )
          ?previousClose
          :null,
      change,
      changePct,
      dayHigh:
        Number.isFinite(dayHigh)
          ?dayHigh
          :null,
      dayLow:
        Number.isFinite(dayLow)
          ?dayLow
          :null,
      week52High:
        Number.isFinite(
          week52High
        )
          ?week52High
          :null,
      week52Low:
        Number.isFinite(
          week52Low
        )
          ?week52Low
          :null,
      volume:
        Number.isFinite(
          volumeMeta
        )
          ?volumeMeta
          :latest?.volume??null,
      marketTime:
        Number.isFinite(
          Number(
            meta.regularMarketTime
          )
        )
          ?new Date(
              Number(
                meta.regularMarketTime
              )*1000
            ).toISOString()
          :null,
      latestTradingDate:
        latest?.date||null
    },
    history,
    years
  };
}


function nasdaqMetricValue(
  summary,
  keys
){
  if(
    !summary ||
    typeof summary!=="object"
  ){
    return null;
  }

  const normalizedKeys=
    keys.map(
      k=>
        String(k)
          .toLowerCase()
          .replace(
            /[^a-z0-9]/g,
            ""
          )
    );

  for(
    const [key,valueObj]
    of Object.entries(summary)
  ){
    const nk=
      String(key)
        .toLowerCase()
        .replace(
          /[^a-z0-9]/g,
          ""
        );

    if(
      !normalizedKeys.includes(
        nk
      )
    ){
      continue;
    }

    const raw=
      valueObj?.value ??
      valueObj?.label ??
      valueObj;

    if(
      raw!==null &&
      raw!==undefined &&
      String(raw).trim()!==""
    ){
      return String(raw).trim();
    }
  }

  return null;
}

function parsePercentString(v){
  if(v===null)return null;

  const m=
    String(v).match(
      /(-?[0-9]+(?:\.[0-9]+)?)\s*%/
    );

  if(!m)return null;

  const n=
    Number(m[1]);

  return Number.isFinite(n)
    ?n
    :null;
}

function parseCompactMoney(v){
  if(v===null)return null;

  const s=
    String(v)
      .replace(
        /[$,\s]/g,
        ""
      )
      .toUpperCase();

  const m=
    s.match(
      /([0-9]+(?:\.[0-9]+)?)([KMBT])?/
    );

  if(!m)return null;

  let n=
    Number(m[1]);

  if(!Number.isFinite(n)){
    return null;
  }

  const factor={
    K:1e3,
    M:1e6,
    B:1e9,
    T:1e12
  }[
    m[2]||""
  ]||1;

  return n*factor;
}

async function fetchNasdaqQqqFundMeta(){
  const url=
    "https://api.nasdaq.com/api/quote/QQQ/summary?assetclass=etf";

  const ctl=
    new AbortController();

  const timer=
    setTimeout(
      ()=>ctl.abort(),
      10000
    );

  try{
    const r=
      await fetch(
        url,
        {
          method:"GET",
          signal:ctl.signal,
          headers:{
            "Accept":
              "application/json,text/plain,*/*",
            "Accept-Language":
              "en-US,en;q=0.9",
            "Referer":
              "https://www.nasdaq.com/",
            "Origin":
              "https://www.nasdaq.com",
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151 Safari/537.36"
          },
          cf:{
            cacheTtl:0,
            cacheEverything:false
          }
        }
      );

    if(!r.ok){
      throw new Error(
        `QQQ Nasdaq HTTP ${r.status}`
      );
    }

    const j=
      await r.json();

    const summary=
      j?.data?.summaryData||
      j?.data?.summary||
      {};

    const expenseRaw=
      nasdaqMetricValue(
        summary,
        [
          "ExpenseRatio",
          "Expense Ratio",
          "TotalExpenseRatio"
        ]
      );

    const assetsRaw=
      nasdaqMetricValue(
        summary,
        [
          "NetAssets",
          "Net Assets",
          "TotalNetAssets",
          "AssetsUnderManagement",
          "AUM"
        ]
      );

    return {
      expenseRatio:
        parsePercentString(
          expenseRaw
        ),
      netAssets:
        parseCompactMoney(
          assetsRaw
        )
    };
  }finally{
    clearTimeout(timer);
  }
}

async function buildQqq({
  forceRefresh=false
}={}){
  if(!forceRefresh){
    const cached=
      await loadTimedJsonCache(
        QQQ_CACHE_URL,
        60*1000
      );

    if(cached){
      return {
        ...cached,
        servedFromCache:true
      };
    }
  }

  const primary=
    await fetchYahooQqq();

  let extra={
    expenseRatio:null,
    netAssets:null
  };

  try{
    extra=
      await fetchNasdaqQqqFundMeta();
  }catch(_){}

  const result={
    generatedAt:
      new Date().toISOString(),
    fund:{
      ...primary.fund,
      // QQQ 已完成结构调整，当前官方总费率为0.18%。
      expenseRatio:
        QQQ_STATIC_META.expenseRatio,
      // QQQ资产规模是数千亿美元量级。
      // Nasdaq字段若小于100亿美元，极可能是 shares outstanding 等误匹配，直接丢弃。
      netAssets:
        Number(extra.netAssets)>=1e10
          ?Number(extra.netAssets)
          :null
    },
    quote:
      primary.quote,
    history:
      primary.history,
    years:
      primary.years
  };

  await saveJsonCache(
    QQQ_CACHE_URL,
    {
      ...result,
      cachedAt:
        new Date().toISOString()
    },
    60
  );

  return result;
}

function eastmoneyPageUrl(page, pageSize=100) {
  const q = new URLSearchParams({
    pn:String(page),
    pz:String(pageSize),
    po:"1",
    np:"1",
    ut:EASTMONEY_UT,
    fltt:"2",
    invt:"2",
    wbp2u:"|0|0|0|web",
    fid:"f12",
    fs:EASTMONEY_FS,
    fields:EASTMONEY_FIELDS
  });
  return "https://push2delay.eastmoney.com/api/qt/clist/get?" + q.toString();
}

async function fetchEastmoneyPage(page, pageSize=100) {
  const j = await fetchJson(eastmoneyPageUrl(page,pageSize), 9000);
  const data = j?.data;
  if (!data) throw new Error(`Eastmoney page ${page} data missing`);
  return {
    total:Number(data.total)||0,
    diff:Array.isArray(data.diff) ? data.diff : [],
  };
}

function parseEastmoneyItem(item) {
  const code = String(item?.f12 ?? "");
  if (!ETF_CODES.has(code)) return null;

  const price = validPrice(item?.f2);
  const estimate = validPrice(item?.f441);
  const discountRate = validPercent(item?.f402);
  const platformPremium = Number.isFinite(discountRate) ? -discountRate : null;
  const premium = premiumOf(price, estimate);
  const snapshotTime = shanghaiDateTimeFromUnix(item?.f124);

  const s = {
    code,
    name:String(item?.f14 || code),
    price,
    estimate,
    premium,
    platformPremium,
    platformDiscountRate:discountRate,
    snapshotTime,
    dataDate:normalizeEastmoneyDate(item?.f297),
    source:"Eastmoney",
    sourceUrl:"https://quote.eastmoney.com/center/gridlist.html#fund_etf",
    dataStatus:"fresh",
  };
  s.checkDifference =
    Number.isFinite(premium) && Number.isFinite(platformPremium)
      ? premium - platformPremium : null;
  s.valid = snapshotValid(s);
  return s;
}

async function fetchEastmoneyETFMap() {
  const PAGE_SIZE = 100;
  const first = await fetchEastmoneyPage(1,PAGE_SIZE);
  const pages = Math.max(1, Math.min(20, Math.ceil(first.total / PAGE_SIZE)));

  const pageResults = [first];
  if (pages > 1) {
    const tasks = [];
    for (let p=2; p<=pages; p++) tasks.push(fetchEastmoneyPage(p,PAGE_SIZE));
    const rest = await Promise.all(tasks);
    pageResults.push(...rest);
  }

  const map = new Map();
  for (const pg of pageResults) {
    for (const item of pg.diff) {
      const s = parseEastmoneyItem(item);
      if (s) map.set(s.code, s);
    }
  }

  return {
    map,
    total:first.total,
    pages,
    matched:[...map.keys()],
  };
}

function parseTinyright(html) {
  const text = stripHtml(html);
  const marketOpen = !(text.includes("A 股休市") || text.includes("A股休市"));
  const rows = html.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) || [];
  const map = new Map();

  for (const row of rows) {
    const c = cellsFromRow(row);
    const code = c[1];
    if (!ETF_CODES.has(code)) continue;

    const price = validPrice(c[3]);
    const estimate = validPrice(c[12]);
    const platformPremium = validPercent(c[13]);
    const premium = premiumOf(price, estimate);
    const s = {
      code,
      name:c[2] || code,
      price,
      estimate,
      premium,
      platformPremium,
      snapshotTime:c[14] || null,
      source:"naKanban",
      sourceUrl:"https://n.tinyright.com/",
      dataStatus:"fallback",
    };
    s.checkDifference =
      Number.isFinite(premium) && Number.isFinite(platformPremium)
        ? premium - platformPremium : null;
    s.valid = snapshotValid(s);
    map.set(code,s);
  }
  return {map,marketOpen};
}

function parseHaoetf(html) {
  const fullText = stripHtml(html);
  const timeMatch = fullText.match(/数据更新时间[：:]\s*([0-9-]+\s+[0-9:]+)/);
  const pageTime = timeMatch ? timeMatch[1] : null;
  const rows = html.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) || [];
  const map = new Map();

  for (const row of rows) {
    const c = cellsFromRow(row);
    const code = c[0];
    if (!ETF_CODES.has(code)) continue;

    const estimate = validPrice(c[2]);
    const price = validPrice(c[7]);
    const platformPremium = validPercent(c[3]);
    const premium = premiumOf(price, estimate);
    const s = {
      code,
      name:c[1] || code,
      price,
      estimate,
      premium,
      platformPremium,
      snapshotTime:pageTime,
      source:"HaoETF",
      sourceUrl:"https://www.haoetf.com/",
      dataStatus:"fallback2",
    };
    s.checkDifference =
      Number.isFinite(premium) && Number.isFinite(platformPremium)
        ? premium - platformPremium : null;
    s.valid = snapshotValid(s);
    map.set(code,s);
  }
  return map;
}

function parseSnapshotDate(value) {
  if (!value) return null;
  const now = new Date();

  let m = String(value).match(/(\d{4})-(\d{1,2})-(\d{1,2}).*?(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) {
    return new Date(
      Number(m[1]),Number(m[2])-1,Number(m[3]),
      Number(m[4]),Number(m[5]),Number(m[6]||0)
    );
  }

  m = String(value).match(/(\d{1,2})月(\d{1,2})日\s+(\d{1,2}):(\d{2})/);
  if (m) {
    return new Date(now.getFullYear(),Number(m[1])-1,Number(m[2]),Number(m[3]),Number(m[4]),0);
  }
  return null;
}

function addFreshness(snapshot) {
  if (!snapshot) return snapshot;
  const d = parseSnapshotDate(snapshot.snapshotTime);
  let ageMinutes = null;
  if (d && !Number.isNaN(d.getTime())) {
    ageMinutes = Math.max(0,Math.round((Date.now()-d.getTime())/60000));
  }
  let freshness = "unknown";
  if (ageMinutes !== null) {
    if (ageMinutes <= 3) freshness = "live";
    else if (ageMinutes <= 30) freshness = "recent";
    else freshness = "stale";
  }
  return {...snapshot,ageMinutes,freshness};
}


function shanghaiNowParts() {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone:"Asia/Shanghai",
    year:"numeric",
    month:"2-digit",
    day:"2-digit",
    weekday:"short",
    hour:"2-digit",
    minute:"2-digit",
    second:"2-digit",
    hour12:false
  });
  const parts = fmt.formatToParts(new Date());
  const o = Object.fromEntries(parts.map(p => [p.type,p.value]));
  const hour = Number(o.hour);
  const minute = Number(o.minute);
  return {
    date:`${o.year}-${o.month}-${o.day}`,
    weekday:o.weekday,
    hour,
    minute,
    second:Number(o.second),
    hm:hour*60+minute,
  };
}

function newestEastmoneySnapshot(rows) {
  let newest = null;
  for (const r of rows) {
    if (r.source !== "Eastmoney" || !r.snapshotTime || !r.dataDate) continue;
    const d = parseSnapshotDate(r.snapshotTime);
    if (!d || Number.isNaN(d.getTime())) continue;
    if (!newest || d.getTime() > newest.time.getTime()) {
      newest = { time:d, dataDate:r.dataDate, snapshotTime:r.snapshotTime };
    }
  }
  return newest;
}

function determineMarketState(rows) {
  const now = shanghaiNowParts();
  const newest = newestEastmoneySnapshot(rows);
  const weekend = now.weekday === "Sat" || now.weekday === "Sun";
  const inMorning = now.hm >= 570 && now.hm <= 690;   // 09:30-11:30
  const inAfternoon = now.hm >= 780 && now.hm <= 900; // 13:00-15:00
  const inSession = inMorning || inAfternoon;
  const beforeOpen = now.hm < 570;
  const lunch = now.hm > 690 && now.hm < 780;
  const afterClose = now.hm > 900;

  let snapshotAgeMinutes = null;
  let dataDateIsToday = false;

  if (newest) {
    snapshotAgeMinutes = Math.max(0, Math.round((Date.now() - newest.time.getTime())/60000));
    dataDateIsToday = newest.dataDate === now.date;
  }

  // 只有交易时段 + 今天的数据 + 快照在 5 分钟内，才认定是真实时。
  if (!weekend && inSession && dataDateIsToday && snapshotAgeMinutes !== null && snapshotAgeMinutes <= 5) {
    return {
      code:"trading",
      label:"A股交易中 · 实时",
      isLive:true,
      isTradingDay:true,
      reason:"东方财富数据日期为今天，且最新快照足够新",
      shanghaiDate:now.date,
      newestDataDate:newest?.dataDate || null,
      newestSnapshotTime:newest?.snapshotTime || null,
      snapshotAgeMinutes,
    };
  }

  if (weekend) {
    return {
      code:"closed",
      label:"周末休市 · 最近交易数据",
      isLive:false,
      isTradingDay:false,
      reason:"当前为周末",
      shanghaiDate:now.date,
      newestDataDate:newest?.dataDate || null,
      newestSnapshotTime:newest?.snapshotTime || null,
      snapshotAgeMinutes,
    };
  }

  // 工作日但本应交易，东方财富 dataDate 不是今天：
  // 这基本就是法定节假日/临时休市，或上游没有今天行情。
  if (inSession && !dataDateIsToday) {
    return {
      code:"holiday_or_closed",
      label:"A股休市/无当日行情 · 最近交易数据",
      isLive:false,
      isTradingDay:false,
      reason:"当前处于通常交易时段，但东方财富数据日期不是今天",
      shanghaiDate:now.date,
      newestDataDate:newest?.dataDate || null,
      newestSnapshotTime:newest?.snapshotTime || null,
      snapshotAgeMinutes,
    };
  }

  // 数据日期是今天，但当前处在午休/盘前/盘后。
  if (dataDateIsToday) {
    let label = "非交易时段 · 最近交易数据";
    let code = "closed";
    if (beforeOpen) {
      label = "盘前 · 显示最近交易数据";
      code = "premarket";
    } else if (lunch) {
      label = "午间休市 · 显示上午收盘附近数据";
      code = "lunch";
    } else if (afterClose) {
      label = "已收盘 · 显示今日最后交易数据";
      code = "postmarket";
    }

    return {
      code,
      label,
      isLive:false,
      isTradingDay:true,
      reason:"东方财富数据日期为今天，但当前不处于连续交易时段",
      shanghaiDate:now.date,
      newestDataDate:newest?.dataDate || null,
      newestSnapshotTime:newest?.snapshotTime || null,
      snapshotAgeMinutes,
    };
  }

  return {
    code:"closed",
    label:"非交易时段 · 最近有效交易数据",
    isLive:false,
    isTradingDay:false,
    reason:"没有检测到今天的东方财富交易快照",
    shanghaiDate:now.date,
    newestDataDate:newest?.dataDate || null,
    newestSnapshotTime:newest?.snapshotTime || null,
    snapshotAgeMinutes,
  };
}

async function loadCachedSnapshots() {
  try {
    const hit = await caches.default.match(new Request(LAST_GOOD_CACHE_URL));
    if (!hit) return {};
    return await hit.json();
  } catch (_) {
    return {};
  }
}

async function saveCachedSnapshots(obj) {
  try {
    await caches.default.put(
      new Request(LAST_GOOD_CACHE_URL),
      new Response(JSON.stringify(obj), {
        headers:{"Content-Type":"application/json","Cache-Control":"public, max-age=2592000"}
      })
    );
  } catch (_) {}
}

async function loadShortResultCache() {
  try {
    const hit = await caches.default.match(new Request(RESULT_CACHE_URL));
    if (!hit) return null;
    const j = await hit.json();
    if (!j?.generatedAt) return null;
    const age = Date.now() - new Date(j.generatedAt).getTime();
    return age >= 0 && age <= 20_000 ? j : null;
  } catch (_) {
    return null;
  }
}

async function saveShortResultCache(obj) {
  try {
    await caches.default.put(
      new Request(RESULT_CACHE_URL),
      new Response(JSON.stringify(obj), {
        headers:{"Content-Type":"application/json","Cache-Control":"public, max-age=20"}
      })
    );
  } catch (_) {}
}


let historySchemaReady = false;

async function ensureHistorySchema(env) {
  if (!env?.DB) return false;
  if (historySchemaReady) return true;

  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS premium_history (
      code TEXT NOT NULL,
      trade_date TEXT NOT NULL,
      snapshot_time TEXT,
      premium REAL NOT NULL,
      price REAL NOT NULL,
      estimate REAL NOT NULL,
      source TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (code, trade_date)
    )
  `).run();

  await env.DB.prepare(`
    CREATE INDEX IF NOT EXISTS idx_premium_history_date
    ON premium_history(trade_date)
  `).run();

  historySchemaReady = true;
  return true;
}

function historyTradeDate(row) {
  if (row?.dataDate && /^\d{4}-\d{2}-\d{2}$/.test(String(row.dataDate))) {
    return String(row.dataDate);
  }
  const m = String(row?.snapshotTime || "").match(/(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

async function persistDailyHistory(env, rows, marketState, force=false) {
  if (!env?.DB) return {enabled:false,written:0,reason:"D1 binding DB not configured"};
  await ensureHistorySchema(env);

  const allowedState =
    force ||
    marketState?.isLive === true ||
    ["lunch","postmarket"].includes(marketState?.code);

  if (!allowedState) {
    return {enabled:true,written:0,reason:"not a recordable market state"};
  }

  const today = marketState?.shanghaiDate || shanghaiNowParts().date;
  const good = rows.filter(r => {
    const tradeDate = historyTradeDate(r);
    return (
      tradeDate === today &&
      Number.isFinite(Number(r.premium)) &&
      Number.isFinite(Number(r.price)) &&
      Number.isFinite(Number(r.estimate)) &&
      Number(r.price) > 0 &&
      Number(r.estimate) > 0
    );
  });

  if (!good.length) return {enabled:true,written:0,reason:"no valid same-day rows"};

  const updatedAt = new Date().toISOString();
  const statements = good.map(r =>
    env.DB.prepare(`
      INSERT INTO premium_history
        (code, trade_date, snapshot_time, premium, price, estimate, source, updated_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
      ON CONFLICT(code, trade_date) DO UPDATE SET
        snapshot_time=excluded.snapshot_time,
        premium=excluded.premium,
        price=excluded.price,
        estimate=excluded.estimate,
        source=excluded.source,
        updated_at=excluded.updated_at
    `).bind(
      r.code,
      historyTradeDate(r),
      r.snapshotTime || null,
      Number(r.premium),
      Number(r.price),
      Number(r.estimate),
      r.source || "unknown",
      updatedAt
    )
  );

  await env.DB.batch(statements);
  return {enabled:true,written:good.length,reason:"ok"};
}

async function getHistorySummaries(env) {
  const empty = new Map();
  if (!env?.DB) return {enabled:false,map:empty,recordStart:null};

  await ensureHistorySchema(env);

  const recentResult = await env.DB.prepare(`
    SELECT code, trade_date, premium
    FROM premium_history
    WHERE trade_date >= date('now','-70 day')
    ORDER BY code ASC, trade_date DESC
  `).run();

  const aggregateResult = await env.DB.prepare(`
    SELECT
      h.code,
      COUNT(*) AS history_days,
      MAX(h.premium) AS history_max,
      MIN(h.premium) AS history_min,
      (
        SELECT h2.trade_date
        FROM premium_history h2
        WHERE h2.code = h.code
        ORDER BY h2.premium DESC, h2.trade_date DESC
        LIMIT 1
      ) AS history_max_date,
      (
        SELECT h3.trade_date
        FROM premium_history h3
        WHERE h3.code = h.code
        ORDER BY h3.premium ASC, h3.trade_date DESC
        LIMIT 1
      ) AS history_min_date
    FROM premium_history h
    GROUP BY h.code
  `).run();

  const startResult = await env.DB.prepare(`
    SELECT MIN(trade_date) AS record_start
    FROM premium_history
  `).run();

  const recentByCode = new Map();
  for (const r of (recentResult.results || [])) {
    if (!recentByCode.has(r.code)) recentByCode.set(r.code, []);
    recentByCode.get(r.code).push({
      date:r.trade_date,
      premium:Number(r.premium)
    });
  }

  const aggByCode = new Map(
    (aggregateResult.results || []).map(r => [r.code, r])
  );

  const out = new Map();
  for (const meta of ETF_META) {
    const arr = recentByCode.get(meta.code) || [];
    const first5 = arr.slice(0,5).filter(x=>Number.isFinite(x.premium));
    const first20 = arr.slice(0,20).filter(x=>Number.isFinite(x.premium));
    const avg = a => a.length ? a.reduce((s,x)=>s+x.premium,0)/a.length : null;
    const a = aggByCode.get(meta.code);

    out.set(meta.code, {
      weekAvg:avg(first5),
      weekDays:first5.length,
      monthAvg:avg(first20),
      monthDays:first20.length,
      historyMax:a ? Number(a.history_max) : null,
      historyMaxDate:a?.history_max_date || null,
      historyMin:a ? Number(a.history_min) : null,
      historyMinDate:a?.history_min_date || null,
      historyDays:a ? Number(a.history_days) : 0,
    });
  }

  return {
    enabled:true,
    map:out,
    recordStart:startResult.results?.[0]?.record_start || null
  };
}


function parseHaoetfHistory(html, code) {
  const rows = html.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) || [];
  const out = [];

  for (const row of rows) {
    const c = cellsFromRow(row);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(c[0] || ""))) continue;

    const premium = validPercent(c[5]);
    if (!Number.isFinite(premium)) continue;

    out.push({
      date:String(c[0]),
      price:validPrice(c[1]),
      nav:validPrice(c[2]),
      estimate:validPrice(c[3]),
      estimateError:validPercent(c[4]),
      premium,
      source:"HaoETF",
      sourceUrl:`https://www.haoetf.com/qdii/${code}`,
      snapshotTime:null
    });
  }

  out.sort((a,b)=>a.date.localeCompare(b.date));
  return out;
}

function summarizeHaoHistory(allRows) {
  const desc = [...allRows].sort((a,b)=>b.date.localeCompare(a.date));
  const latest5 = desc.slice(0,5);
  const latest20 = desc.slice(0,20);
  const avg = arr => arr.length
    ? arr.reduce((sum,r)=>sum+Number(r.premium),0)/arr.length
    : null;

  let maxRow=null,minRow=null;
  for (const r of allRows) {
    if (!Number.isFinite(Number(r.premium))) continue;
    if (!maxRow || Number(r.premium)>Number(maxRow.premium)) maxRow=r;
    if (!minRow || Number(r.premium)<Number(minRow.premium)) minRow=r;
  }

  return {
    weekAvg:avg(latest5),
    weekDays:latest5.length,
    monthAvg:avg(latest20),
    monthDays:latest20.length,
    historyMax:maxRow ? Number(maxRow.premium) : null,
    historyMaxDate:maxRow?.date || null,
    historyMin:minRow ? Number(minRow.premium) : null,
    historyMinDate:minRow?.date || null,
    historyDays:allRows.length
  };
}

async function getHaoetfPremiumHistory(code, period="week", month=null) {
  if (!HAOETF_KNOWN.has(code)) {
    return {available:false,reason:"HaoETF history not confirmed for this ETF"};
  }

  const sourceUrl=`https://www.haoetf.com/qdii/${code}`;
  const html=await fetchText(sourceUrl,9000);
  const allRows=parseHaoetfHistory(html,code);

  if (!allRows.length) {
    return {available:false,reason:"HaoETF history table empty"};
  }

  const months=new Map();
  for (const r of allRows) {
    const m=r.date.slice(0,7);
    months.set(m,(months.get(m)||0)+1);
  }

  let rows;
  if (period==="all") {
    rows=[...allRows];
  } else if (month && /^\d{4}-\d{2}$/.test(month)) {
    rows=allRows.filter(r=>r.date.startsWith(month));
  } else {
    const limit=period==="month"?20:5;
    rows=[...allRows]
      .sort((a,b)=>b.date.localeCompare(a.date))
      .slice(0,limit)
      .reverse();
  }

  return {
    available:true,
    enabled:true,
    code,
    source:"HaoETF",
    sourceMode:"direct_source_history",
    sourceUrl,
    period:month?"calendar_month":period,
    month:month||null,
    summary:summarizeHaoHistory(allRows),
    historyRange:{
      start:allRows[0]?.date||null,
      end:allRows[allRows.length-1]?.date||null,
      days:allRows.length
    },
    availableMonths:[...months.entries()]
      .sort((a,b)=>b[0].localeCompare(a[0]))
      .map(([m,days])=>({month:m,days})),
    rows
  };
}

async function getPremiumHistoryUnified(env, code, period="week", month=null) {
  if (!ETF_CODES.has(code)) throw new Error("Unsupported ETF code");

  let haoetfError=null;

  if (HAOETF_KNOWN.has(code)) {
    try {
      const h=await getHaoetfPremiumHistory(code,period,month);
      if (h.available) return h;
    } catch (e) {
      haoetfError=e?.message||String(e);
    }
  }

  const d1=await getPremiumHistory(env,code,period,month);
  return {
    ...d1,
    source:"D1",
    sourceMode:"d1_fallback",
    haoetfError,
    historyRange:{
      start:null,
      end:null,
      days:d1?.summary?.historyDays||0
    }
  };
}

async function getPremiumHistory(env, code, period="week", month=null) {
  if (!ETF_CODES.has(code)) throw new Error("Unsupported ETF code");
  if (!env?.DB) {
    return {
      enabled:false,
      code,
      rows:[],
      availableMonths:[],
      error:"D1 binding DB not configured"
    };
  }

  await ensureHistorySchema(env);

  let sql = "";
  let params = [];

  if (period==="all") {
    sql = `
      SELECT code, trade_date, snapshot_time, premium, price, estimate, source
      FROM premium_history
      WHERE code=?1
      ORDER BY trade_date ASC
    `;
    params = [code];
  } else if (month && /^\d{4}-\d{2}$/.test(month)) {
    sql = `
      SELECT code, trade_date, snapshot_time, premium, price, estimate, source
      FROM premium_history
      WHERE code=?1 AND substr(trade_date,1,7)=?2
      ORDER BY trade_date ASC
    `;
    params = [code,month];
  } else {
    const limit = period === "month" ? 20 : 5;
    sql = `
      SELECT code, trade_date, snapshot_time, premium, price, estimate, source
      FROM premium_history
      WHERE code=?1
      ORDER BY trade_date DESC
      LIMIT ${limit}
    `;
    params = [code];
  }

  const stmt = env.DB.prepare(sql).bind(...params);
  const data = await stmt.run();

  let rows = (data.results || []).map(r => ({
    date:r.trade_date,
    snapshotTime:r.snapshot_time || null,
    premium:Number(r.premium),
    price:Number(r.price),
    estimate:Number(r.estimate),
    source:r.source
  }));

  if (!month && period!=="all") rows = rows.reverse();

  const monthsRes = await env.DB.prepare(`
    SELECT substr(trade_date,1,7) AS month, COUNT(*) AS days
    FROM premium_history
    WHERE code=?1
    GROUP BY substr(trade_date,1,7)
    ORDER BY month DESC
  `).bind(code).run();

  const summaryData = await getHistorySummaries(env);
  const summary = summaryData.map.get(code) || null;

  return {
    enabled:true,
    code,
    period:month ? "calendar_month" : period,
    month:month || null,
    summary,
    availableMonths:(monthsRes.results || []).map(x=>({
      month:x.month,
      days:Number(x.days)
    })),
    rows
  };
}

async function buildPremiums(env, options={}) {
  const shortHit = options.bypassShortCache ? null : await loadShortResultCache();
  if (shortHit) return {...shortHit,servedFromWorkerCache:true};

  const cached = await loadCachedSnapshots();

  let east = {map:new Map(),total:0,pages:0,matched:[]};
  let eastError = null;
  let eastRetried = false;

  try {
    east = await fetchEastmoneyETFMap();
  } catch (e) {
    eastError = e?.message || String(e);
    eastRetried = true;
    await sleep(900);
    try {
      east = await fetchEastmoneyETFMap();
      eastError = null;
    } catch (e2) {
      eastError = e2?.message || String(e2);
    }
  }

  let needTiny = ETF_META.map(x=>x.code).filter(code=>!snapshotValid(east.map.get(code)));

  let tiny = {map:new Map(),marketOpen:null};
  let tinyError = null;
  let tinyRetried = [];
  let tinyRetryError = null;

  if (needTiny.length) {
    try {
      tiny = parseTinyright(await fetchText("https://n.tinyright.com/"));
    } catch (e) {
      tinyError = e?.message || String(e);
    }

    tinyRetried = needTiny.filter(code=>!snapshotValid(tiny.map.get(code)));
    if (tinyRetried.length) {
      await sleep(900);
      try {
        const again = parseTinyright(await fetchText("https://n.tinyright.com/"));
        for (const code of tinyRetried) {
          const s = again.map.get(code);
          if (snapshotValid(s)) tiny.map.set(code,s);
        }
        if (again.marketOpen !== null) tiny.marketOpen = again.marketOpen;
      } catch (e) {
        tinyRetryError = e?.message || String(e);
      }
    }
  }

  const needHao = ETF_META.map(x=>x.code).filter(code=>{
    if (snapshotValid(east.map.get(code))) return false;
    if (snapshotValid(tiny.map.get(code))) return false;
    return HAOETF_KNOWN.has(code);
  });

  let hao = new Map();
  let haoError = null;
  if (needHao.length) {
    try {
      hao = parseHaoetf(await fetchText("https://www.haoetf.com/"));
    } catch (e) {
      haoError = e?.message || String(e);
    }
  }

  const nextCache = {...cached};
  const rows = ETF_META.map(meta=>{
    let chosen = east.map.get(meta.code);
    if (!snapshotValid(chosen)) chosen = tiny.map.get(meta.code);
    if (!snapshotValid(chosen)) chosen = hao.get(meta.code);

    if (snapshotValid(chosen)) {
      chosen = addFreshness(chosen);
      nextCache[meta.code] = {...chosen,cachedAt:new Date().toISOString()};
    } else if (snapshotValid(cached[meta.code])) {
      chosen = {...addFreshness(cached[meta.code]),dataStatus:"cached"};
      const d = cached[meta.code].cachedAt ? new Date(cached[meta.code].cachedAt) : null;
      chosen.cacheAgeMinutes = d && !Number.isNaN(d.getTime())
        ? Math.max(0,Math.round((Date.now()-d.getTime())/60000))
        : null;
    } else {
      chosen = {
        code:meta.code,
        name:meta.code,
        price:null,
        estimate:null,
        premium:null,
        platformPremium:null,
        snapshotTime:null,
        source:null,
        dataStatus:"unavailable",
        valid:false,
        ageMinutes:null,
        freshness:"unavailable"
      };
    }

    return {
      ...meta,
      totalFee:Number((meta.managementFee+meta.custodyFee).toFixed(4)),
      ...chosen
    };
  });

  await saveCachedSnapshots(nextCache);

  const sourceCounts = rows.reduce((acc,r)=>{
    const k = r.dataStatus==="cached" ? "cache" : (r.source || "unavailable");
    acc[k] = (acc[k]||0)+1;
    return acc;
  },{});

  const marketState = determineMarketState(rows);

  let historyWrite = {enabled:false,written:0,reason:"D1 unavailable"};
  let historySummary = {enabled:false,map:new Map(),recordStart:null};

  if (env?.DB) {
    try {
      historyWrite = await persistDailyHistory(
        env,
        rows,
        marketState,
        options.forceHistoryPersist === true
      );
      historySummary = await getHistorySummaries(env);
    } catch (e) {
      historyWrite = {
        enabled:true,
        written:0,
        reason:e?.message || String(e)
      };
    }
  }

  const rowsWithHistory = rows.map(r => ({
    ...r,
    history:historySummary.map?.get(r.code) || {
      weekAvg:null,
      weekDays:0,
      monthAvg:null,
      monthDays:0,
      historyMax:null,
      historyMaxDate:null,
      historyMin:null,
      historyMinDate:null,
      historyDays:0
    }
  }));

  const result = {
    generatedAt:new Date().toISOString(),
    marketOpen:marketState.isLive,
    marketState,
    rows:rowsWithHistory,
    sourceCounts,
    history:{
      enabled:historySummary.enabled,
      recordStart:historySummary.recordStart,
      write:historyWrite
    },
    upstream:{
      eastmoneyOk:!eastError,
      eastmoneyError:eastError,
      eastmoneyRetried:eastRetried,
      eastmoneyTotal:east.total,
      eastmoneyPages:east.pages,
      eastmoneyMatched:east.matched,
      tinyrightRequested:needTiny,
      tinyrightOk:!tinyError,
      tinyrightError:tinyError,
      tinyrightRetried:tinyRetried,
      tinyrightRetryError:tinyRetryError,
      haoetfRequested:needHao,
      haoetfOk:!haoError,
      haoetfError:haoError
    }
  };

  await saveShortResultCache(result);
  return result;
}




function hasFiniteValue(v) {
  if (v === null || v === undefined || v === "") return false;
  const n = Number(v);
  return Number.isFinite(n);
}

function parseYuanNumber(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/,/g,""));
  return Number.isFinite(n) ? n : null;
}

function amountText(v, state="unknown") {
  if (hasFiniteValue(v)) {
    const n = Number(v);
    if (n >= 10000 && Math.abs(n/10000-Math.round(n/10000)) < 1e-9) {
      return `${Math.round(n/10000)}万元/日`;
    }
    return `${n}元/日`;
  }
  if (state === "suspended") return "暂停申购";
  if (state === "open") return "正常申购";
  if (state === "unavailable") return "无此渠道";
  if (state === "limited") return "限额（金额未解析）";
  return "公告未单独披露";
}

function noticePdfUrl(id) {
  return id ? `https://pdf.dfcfw.com/pdf/H2_${id}_1.pdf` : null;
}

function noticeListPage(mainCode) {
  return `https://fundf10.eastmoney.com/jjgg_${mainCode}_0.html`;
}

function normalizeNoticeDate(v) {
  const s = String(v ?? "");
  const m = s.match(/(20\d{2})[-\/年](\d{1,2})[-\/月](\d{1,2})/);
  if (!m) return null;
  return `${m[1]}-${String(m[2]).padStart(2,"0")}-${String(m[3]).padStart(2,"0")}`;
}

function chineseDateToIso(y,m,d) {
  return `${y}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
}

function extractDateByRegex(text, regex) {
  const m = String(text ?? "").match(regex);
  return m ? chineseDateToIso(m[1],m[2],m[3]) : null;
}

function normalizeNoticeText(v) {
  return stripHtml(String(v ?? ""))
    .replace(/\u00a0/g," ")
    .replace(/[：﹕]/g,":")
    .replace(/[（]/g,"(")
    .replace(/[）]/g,")")
    .replace(/\s+/g," ")
    .trim();
}

function titleTemporaryDate(title) {
  const t = normalizeNoticeText(title);
  return (
    extractDateByRegex(
      t,
      /(?:关于旗下部分基金)?\s*(20\d{2})年(\d{1,2})月(\d{1,2})日暂停(?:申购|赎回|转换|定期定额)/
    ) ||
    extractDateByRegex(
      t,
      /(20\d{2})年(\d{1,2})月(\d{1,2})日(?:暂停|休市)/
    )
  );
}

function isAnnualHolidaySchedule(title) {
  const t = normalizeNoticeText(title);
  return (
    /20\d{2}年.*(?:境外主要市场|主要境外市场).*节假日.*暂停/.test(t) ||
    /20\d{2}年度.*节假日.*暂停/.test(t) ||
    /全年.*节假日.*暂停/.test(t)
  );
}

function isQuotaNoticeTitle(title) {
  const t = normalizeNoticeText(title);

  if (!/(申购|定期定额|定投)/.test(t)) return false;
  if (!/(大额|限制|暂停|恢复|调整)/.test(t)) return false;

  // 与每日额度无关。
  if (
    /终止.*销售|销售业务.*终止|费率优惠|增加.*销售机构/.test(t)
  ) {
    return false;
  }

  // “申购/定投起点调整”只是最低申购金额，不是每日申购额度，
  // 不能拿来验证“限额/暂停申购”状态。
  if (
    /(?:申购|定投|定期定额).{0,16}(?:起点|最低金额|最低申购)/.test(t) ||
    /(?:起点|最低金额|最低申购).{0,16}(?:申购|定投|定期定额)/.test(t)
  ) {
    return false;
  }

  // 年度节假日计划表不是持续性的额度状态，不能拿来覆盖全年。
  if (isAnnualHolidaySchedule(t)) return false;

  return true;
}

function noticeScope(title) {
  const t = normalizeNoticeText(title);

  const direct =
    /直销|基金管理人直销|直销电子交易平台|网上直销|直销柜台/.test(t);
  const agency =
    /代销|非直销|其他销售机构|各销售机构/.test(t);

  if (direct && !agency) return "direct";
  if (agency && !direct) return "agency";
  return "general";
}

async function fetchJsonWithHeaders(url, headers={}, timeout=9000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(url,{
      method:"GET",
      signal:ctl.signal,
      headers:{
        "Accept":"application/json,text/plain,*/*",
        "User-Agent":"Mozilla/5.0 (compatible; Nasdaq100-Fund-Monitor/3.5)",
        ...headers
      },
      cf:{cacheTtl:0,cacheEverything:false}
    });
    if (!r.ok) throw new Error(`${url} HTTP ${r.status}`);
    const j = await r.json();
    if (!j) throw new Error("empty json");
    return j;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchAnnouncementList(
  mainCode,
  pageIndex=1,
  pageSize=100
) {
  const q = new URLSearchParams({
    callback:"",
    fundcode:mainCode,
    pageIndex:String(pageIndex),
    pageSize:String(pageSize),
    type:"0"
  });

  const url = `${EASTMONEY_NOTICE_LIST}?${q.toString()}`;
  const j = await fetchJsonWithHeaders(
    url,
    {"Referer":noticeListPage(mainCode)},
    10000
  );

  const arr = Array.isArray(j?.Data) ? j.Data : [];
  return arr.map(x => ({
    id:String(x.ID || ""),
    title:String(x.TITLE || ""),
    publishDate:
      normalizeNoticeDate(x.PUBLISHDATEDesc) ||
      normalizeNoticeDate(x.PUBLISHDATE) ||
      normalizeNoticeDate(x.PUBLISHTIME),
    scope:noticeScope(x.TITLE || ""),
    temporaryDate:titleTemporaryDate(x.TITLE || "")
  }))
  .filter(x => x.id && isQuotaNoticeTitle(x.title))
  .sort((a,b) =>
    String(b.publishDate||"").localeCompare(String(a.publishDate||""))
  );
}

async function fetchAnnouncementContent(id) {
  const q = new URLSearchParams({
    client_source:"web_fund",
    show_all:"1",
    art_code:id
  });

  const url = `${EASTMONEY_NOTICE_CONTENT}?${q.toString()}`;
  const j = await fetchJsonWithHeaders(url,{},10000);

  const content =
    j?.data?.notice_content ??
    j?.Data?.notice_content ??
    "";

  if (!content) throw new Error(`公告正文为空: ${id}`);
  return normalizeNoticeText(content);
}

function extractGeneralLimit(text) {
  const patterns = [
    /限制申购金额[^0-9]{0,80}([0-9][0-9,.]*)/,
    /大额申购[^。；]{0,120}?限额[^0-9]{0,40}([0-9][0-9,.]*)\s*元/,
    /限额(?:调整)?(?:为|至)\s*([0-9][0-9,.]*)\s*元/,
    /申购及定期定额投资[^。；]{0,120}?(?:不超过|不得超过|上限为)\s*([0-9][0-9,.]*)\s*元/,
    /单日单个基金账户[^。；]{0,140}?(?:不超过|不得超过|上限为)\s*([0-9][0-9,.]*)\s*元/,
    /单日[^。；]{0,100}?(?:累计)?(?:申购|定期定额)[^。；]{0,100}?(?:不超过|不得超过|上限(?:为)?|限额为)\s*([0-9][0-9,.]*)\s*元/
  ];

  for (const p of patterns) {
    const m = text.match(p);
    if (m) {
      const n = parseYuanNumber(m[1]);
      if (n !== null) return n;
    }
  }
  return null;
}

function extractChannelLimit(text, channel) {
  const directPatterns = [
    /(?:直销电子交易平台|直销渠道|直销机构|直销柜台|直销平台|直销中心|网上直销|本公司直销|基金管理人直销)[^。；]{0,220}?(?:不超过|不得超过|上限(?:为|调整为)?|累计金额(?:应)?不超过|限额(?:为|调整为)?)\s*([0-9][0-9,.]*)\s*元/,
    /通过本公司(?:网上)?直销[^。；]{0,220}?(?:不超过|不得超过)\s*([0-9][0-9,.]*)\s*元/
  ];

  const agencyPatterns = [
    /(?:代销机构|代销渠道|代销|各代销机构|非直销(?:销售)?机构|其他销售机构|除直销[^。；]{0,50}销售机构)[^。；]{0,220}?(?:不超过|不得超过|上限(?:为|调整为)?|累计金额(?:应)?不超过|限额(?:为|调整为)?)\s*([0-9][0-9,.]*)\s*元/,
    /通过(?:各)?(?:代销|其他销售)机构[^。；]{0,220}?(?:不超过|不得超过)\s*([0-9][0-9,.]*)\s*元/
  ];

  const patterns = channel === "direct" ? directPatterns : agencyPatterns;
  for (const p of patterns) {
    const m = text.match(p);
    if (m) {
      const n = parseYuanNumber(m[1]);
      if (n !== null) return n;
    }
  }
  return null;
}

function parseNoticeDates(title, text, publishDate) {
  const source = `${title} ${text}`;

  const effective =
    extractDateByRegex(source,/调整大额申购起始日[^0-9]{0,30}(20\d{2})年(\d{1,2})月(\d{1,2})日/) ||
    extractDateByRegex(source,/暂停大额申购起始日[^0-9]{0,30}(20\d{2})年(\d{1,2})月(\d{1,2})日/) ||
    extractDateByRegex(source,/暂停申购起始日[^0-9]{0,30}(20\d{2})年(\d{1,2})月(\d{1,2})日/) ||
    extractDateByRegex(source,/恢复申购起始日[^0-9]{0,30}(20\d{2})年(\d{1,2})月(\d{1,2})日/) ||
    extractDateByRegex(source,/恢复大额申购起始日[^0-9]{0,30}(20\d{2})年(\d{1,2})月(\d{1,2})日/) ||

    // 常见公告写法：
    // “2025年9月29日起暂停申购”
    // “2026年8月5日起调整大额申购限额”
    // 这一规则必须放在 publishDate 回退之前，否则会把公告发布日期误当生效日。
    extractDateByRegex(
      source,
      /(?:自|从)?\s*(20\d{2})年(\d{1,2})月(\d{1,2})日\s*(?:起|开始)(?=[，,。；;\s]|执行|实施|生效|调整|暂停|恢复|办理|限制)/
    ) ||

    extractDateByRegex(source,/自\s*(20\d{2})年(\d{1,2})月(\d{1,2})日(?:起|开始)/) ||
    publishDate;

  const resume =
    extractDateByRegex(source,/恢复(?:申购|相关业务|办理申购)[^0-9]{0,80}(20\d{2})年(\d{1,2})月(\d{1,2})日/) ||
    extractDateByRegex(source,/于\s*(20\d{2})年(\d{1,2})月(\d{1,2})日恢复(?:申购|相关业务)/) ||
    extractDateByRegex(source,/(20\d{2})年(\d{1,2})月(\d{1,2})日(?:起)?恢复(?:申购|赎回|转换|定期定额)/);

  const temporary =
    titleTemporaryDate(title) ||
    extractDateByRegex(
      source,
      /(?:仅于|于)\s*(20\d{2})年(\d{1,2})月(\d{1,2})日暂停(?:申购|赎回|转换|定期定额)/
    );

  return {
    effectiveDate:effective,
    resumeDate:resume,
    temporaryDate:temporary
  };
}

function extractAffectedShareClasses(title, text) {
  const titleNorm = normalizeNoticeText(title);
  const head = normalizeNoticeText(text).slice(0,1600);
  const classes = new Set();

  for (const source of [titleNorm,head]) {
    for (const m of source.matchAll(/([ACDEFI])\s*类/g)) {
      classes.add(m[1]);
    }
  }

  return [...classes];
}

function extractAffectedCodes(text, product) {
  const found = new Set(
    [...String(text).matchAll(/\b(\d{6})\b/g)].map(m=>m[1])
  );
  return product.shares.filter(code=>found.has(code));
}

function parseNoticeState(notice, text, product) {
  const title = normalizeNoticeText(notice.title);
  const full = `${title} ${text}`;

  const generalLimit = extractGeneralLimit(text);
  const directLimit = extractChannelLimit(text,"direct");
  const agencyLimit = extractChannelLimit(text,"agency");
  const dates = parseNoticeDates(title,text,notice.publishDate);

  const fullSuspend =
    (/暂停申购/.test(title) && !/暂停大额申购/.test(title)) ||
    (
      /暂停(?:办理)?申购/.test(full) &&
      !/暂停大额申购/.test(title) &&
      /暂停申购及|暂停申购、|暂停申购业务/.test(title)
    );

  let state = "unknown";

  if (fullSuspend) {
    state = "suspended";
  } else if (
    hasFiniteValue(generalLimit) ||
    hasFiniteValue(directLimit) ||
    hasFiniteValue(agencyLimit) ||
    /(?:限制|暂停|调整).*大额申购/.test(title) ||
    /大额申购.*(?:限制|暂停|调整)/.test(title)
  ) {
    state = "limited";
  } else if (
    /恢复(?:正常)?申购/.test(title) ||
    /恢复大额申购/.test(title)
  ) {
    state = "open";
  }

  const affectedCodes = extractAffectedCodes(`${title} ${text.slice(0,2000)}`,product);
  const affectedClasses = extractAffectedShareClasses(title,text);

  return {
    id:notice.id,
    title:notice.title,
    publishDate:notice.publishDate,
    scope:notice.scope,
    announcementUrl:noticePdfUrl(notice.id),
    effectiveDate:dates.effectiveDate,
    resumeDate:dates.resumeDate,
    temporaryDate:dates.temporaryDate,
    isHoliday:/节假日|境外主要投资场所/.test(title),
    state,
    generalLimit,
    agencyLimit,
    directLimit,
    hasAgencyInfo:hasFiniteValue(agencyLimit),
    hasDirectInfo:hasFiniteValue(directLimit),
    affectedCodes,
    affectedClasses
  };
}

function isoDaysAgo(dateStr, days) {
  if (!dateStr) return null;
  const d = new Date(`${dateStr}T00:00:00+08:00`);
  if (!Number.isFinite(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate()+days);
  return d.toISOString().slice(0,10);
}

function noticeApplicable(parsed, today) {
  if (parsed.effectiveDate && today < parsed.effectiveDate) return false;

  // “某年某月某日暂停”的单日公告只在该天有效。
  if (parsed.temporaryDate) return today === parsed.temporaryDate;

  if (parsed.resumeDate && today >= parsed.resumeDate) return false;

  // 无法解析恢复日期的旧节假日暂停，禁止长期覆盖当前额度。
  if (parsed.isHoliday && parsed.publishDate) {
    const expiry = isoDaysAgo(parsed.publishDate,14);
    if (expiry && today > expiry) return false;
  }

  return true;
}

function shareIsAffected(parsed, meta, product) {
  if (parsed.affectedCodes?.length) {
    return parsed.affectedCodes.includes(meta.code);
  }

  if (parsed.affectedClasses?.length && meta.share !== "单一") {
    return parsed.affectedClasses.includes(meta.share);
  }

  // 公告未显式限定份额 -> 视为整个基金产品。
  return true;
}

function emptyChannelState() {
  return {state:"unknown",limit:null,notice:null};
}

function makeShareState(meta) {
  return {
    code:meta.code,
    agency:emptyChannelState(),
    direct:emptyChannelState(),
    applied:[]
  };
}

function stateForParsedLimit(parsed, limit) {
  if (parsed.state === "suspended") return "suspended";
  if (parsed.state === "open") return "open";
  if (parsed.state === "limited") return "limited";
  return hasFiniteValue(limit) ? "limited" : "unknown";
}

// newest -> oldest. 已经由较新公告确定的渠道不允许被旧公告覆盖。
function applyParsedNoticeToShare(target, parsed) {
  const scope = parsed.scope || "general";

  function applyChannel(name, limit) {
    if (target[name].state !== "unknown") return;
    target[name] = {
      state:stateForParsedLimit(parsed,limit),
      limit:hasFiniteValue(limit) ? Number(limit) : null,
      notice:parsed
    };
  }

  if (scope === "general") {
    if (parsed.state === "suspended") {
      applyChannel("agency",null);
      applyChannel("direct",null);
    } else if (
      parsed.state === "open" &&
      !hasFiniteValue(parsed.generalLimit) &&
      !hasFiniteValue(parsed.agencyLimit) &&
      !hasFiniteValue(parsed.directLimit)
    ) {
      applyChannel("agency",null);
      applyChannel("direct",null);
    } else {
      applyChannel(
        "agency",
        hasFiniteValue(parsed.agencyLimit)
          ? parsed.agencyLimit
          : parsed.generalLimit
      );
      applyChannel(
        "direct",
        hasFiniteValue(parsed.directLimit)
          ? parsed.directLimit
          : parsed.generalLimit
      );
    }
  } else if (scope === "direct") {
    applyChannel(
      "direct",
      hasFiniteValue(parsed.directLimit)
        ? parsed.directLimit
        : parsed.generalLimit
    );
  } else if (scope === "agency") {
    applyChannel(
      "agency",
      hasFiniteValue(parsed.agencyLimit)
        ? parsed.agencyLimit
        : parsed.generalLimit
    );
  }

  target.applied.push(parsed);
}

function combinedShareStatus(s) {
  const a=s.agency.state,d=s.direct.state;

  if (a==="suspended" && d==="suspended") {
    return {status:"suspended",label:"暂停申购"};
  }
  if (a==="limited" || d==="limited") {
    return {status:"limited",label:"限额申购"};
  }
  if (
    (a==="suspended" && (d==="open"||d==="limited")) ||
    (d==="suspended" && (a==="open"||a==="limited"))
  ) {
    return {status:"mixed",label:"渠道状态不同"};
  }
  if (a==="open" && d==="open") {
    return {status:"open",label:"开放申购"};
  }
  if (a==="open" || d==="open") {
    return {status:"open",label:"部分渠道开放"};
  }
  if (a==="suspended" || d==="suspended") {
    return {status:"mixed",label:"部分渠道暂停"};
  }
  return {status:"missing",label:"公告未完整解析"};
}

async function loadTimedJsonCache(key, maxAgeMs) {
  try {
    const hit = await caches.default.match(new Request(key));
    if (!hit) return null;
    const j = await hit.json();
    const ts = new Date(j?.cachedAt || j?.generatedAt || 0).getTime();
    const age = Date.now() - ts;
    if (!(age >= 0 && age <= maxAgeMs)) return null;
    return j;
  } catch (_) {
    return null;
  }
}

async function saveJsonCache(key, obj, maxAgeSeconds) {
  try {
    await caches.default.put(
      new Request(key),
      new Response(JSON.stringify(obj),{
        headers:{
          "Content-Type":"application/json; charset=utf-8",
          "Cache-Control":`public, max-age=${maxAgeSeconds}`
        }
      })
    );
  } catch (_) {}
}

async function loadOtcLastGood() {
  try {
    const hit = await caches.default.match(new Request(OTC_LAST_GOOD_CACHE_URL));
    return hit ? await hit.json() : null;
  } catch (_) {
    return null;
  }
}

async function mapLimit(items, limit, fn) {
  const result = new Array(items.length);
  let next = 0;

  async function workerLoop() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      result[i] = await fn(items[i],i);
    }
  }

  const workers = Array.from(
    {length:Math.min(limit,items.length)},
    () => workerLoop()
  );
  await Promise.all(workers);
  return result;
}

function candidateTitleApplicable(notice,today) {
  if (!notice) return false;
  if (notice.temporaryDate && notice.temporaryDate !== today) return false;
  return true;
}

function resolutionComplete(resolution) {
  return resolution.shareStates.every(s =>
    s.agency.state !== "unknown" &&
    s.direct.state !== "unknown"
  );
}

function resolutionHasAnyData(resolution) {
  return resolution.shareStates.some(s =>
    s.agency.state !== "unknown" ||
    s.direct.state !== "unknown"
  );
}

function makeResolution(product,notices,fingerprint) {
  return {
    product,
    notices,
    fingerprint,
    nextIndex:0,
    shareStates:product.shares.map(code=>
      makeShareState(OTC_META_MAP.get(code))
    ),
    parsedNotices:[],
    errors:[]
  };
}

async function parseNextUsefulNotice(resolution,today,budget) {
  while (
    resolution.nextIndex < resolution.notices.length &&
    budget.remaining > 0
  ) {
    const notice = resolution.notices[resolution.nextIndex++];
    if (!candidateTitleApplicable(notice,today)) continue;

    budget.remaining -= 1;
    try {
      const text = await fetchAnnouncementContent(notice.id);
      const parsed = parseNoticeState(
        notice,
        text,
        resolution.product
      );

      if (!noticeApplicable(parsed,today)) continue;
      if (parsed.state === "unknown") continue;

      resolution.parsedNotices.push(parsed);

      for (const shareState of resolution.shareStates) {
        const meta=OTC_META_MAP.get(shareState.code);
        if (!shareIsAffected(parsed,meta,resolution.product)) continue;
        applyParsedNoticeToShare(shareState,parsed);
      }
      return true;
    } catch(e) {
      resolution.errors.push(e?.message||String(e));
    }
  }
  return false;
}

function serializeResolution(resolution) {
  return {
    mainCode:resolution.product.mainCode,
    fingerprint:resolution.fingerprint,
    shareStates:resolution.shareStates,
    parsedNotices:resolution.parsedNotices
  };
}

function restoreResolution(product,notices,fingerprint,cached) {
  const r=makeResolution(product,notices,fingerprint);
  if (!cached?.state?.shareStates) return r;

  r.shareStates=cached.state.shareStates.map(s=>({
    ...s,
    applied:Array.isArray(s.applied)?s.applied:[]
  }));
  r.parsedNotices=Array.isArray(cached.state.parsedNotices)
    ?cached.state.parsedNotices
    :[];
  return r;
}

async function prepareProductResolution(product,notices) {
  const relevant=notices.map(n=>({...n,mainCode:product.mainCode}));
  const fingerprint=relevant
    .slice(0,10)
    .map(x=>`${x.id}:${x.scope}`)
    .join("|");

  const cacheKey=OTC_PRODUCT_CACHE_PREFIX+product.mainCode;
  const cached=await loadTimedJsonCache(
    cacheKey,
    60*24*3600*1000
  );

  if (
    cached?.fingerprint===fingerprint &&
    cached?.state?.shareStates
  ) {
    return {
      resolution:restoreResolution(
        product,
        relevant,
        fingerprint,
        cached
      ),
      cached:true,
      cacheKey
    };
  }

  return {
    resolution:makeResolution(
      product,
      relevant,
      fingerprint
    ),
    cached:false,
    cacheKey,
    oldCached:cached
  };
}

function resultRowsFromResolutions(items,checkDate) {
  const byCode=new Map();

  for (const item of items) {
    const r=item.resolution;

    for (const shareState of r.shareStates) {
      const meta=OTC_META_MAP.get(shareState.code);
      const combined=combinedShareStatus(shareState);

      const notices=[
        shareState.agency.notice,
        shareState.direct.notice,
        ...(shareState.applied||[])
      ].filter(Boolean);

      const latest=[...notices].sort(
        (a,b)=>String(b.publishDate||"")
          .localeCompare(String(a.publishDate||""))
      )[0]||null;

      byCode.set(meta.code,{
        ...meta,
        status:combined.status,
        statusLabel:combined.label,
        agencyLimit:hasFiniteValue(shareState.agency.limit)
          ?Number(shareState.agency.limit)
          :null,
        directLimit:hasFiniteValue(shareState.direct.limit)
          ?Number(shareState.direct.limit)
          :null,
        agencyState:shareState.agency.state,
        directState:shareState.direct.state,
        announcementDate:latest?.publishDate||null,
        quotaDate:latest?.publishDate||null,
        effectiveDate:latest?.effectiveDate||null,
        announcementTitle:latest?.title||null,
        announcementUrl:latest?.announcementUrl||null,
        announcementId:latest?.id||null,
        verification:"基金管理人公告原文",
        limitText:
          `代销 ${amountText(shareState.agency.limit,shareState.agency.state)}；`+
          `直销 ${amountText(shareState.direct.limit,shareState.direct.state)}`,
        channelText:
          `代销：${amountText(shareState.agency.limit,shareState.agency.state)}；`+
          `直销：${amountText(shareState.direct.limit,shareState.direct.state)}`,
        source:"基金管理人公告（东方财富公告接口）",
        sourceUrl:noticeListPage(r.product.mainCode),
        checkDate,
        dataStatus:item.cached?"cached":"fresh"
      });
    }
  }

  return OTC_CNY_META.map(meta=>byCode.get(meta.code)||({
    ...meta,
    status:"missing",
    statusLabel:"公告读取失败",
    agencyLimit:null,
    directLimit:null,
    agencyState:"unknown",
    directState:"unknown",
    announcementDate:null,
    quotaDate:null,
    effectiveDate:null,
    announcementTitle:null,
    announcementUrl:null,
    announcementId:null,
    verification:"基金管理人公告原文",
    limitText:"代销 公告未单独披露；直销 公告未单独披露",
    channelText:"代销：公告未单独披露；直销：公告未单独披露",
    source:"基金管理人公告（东方财富公告接口）",
    sourceUrl:noticeListPage(
      OTC_PRODUCT_MAP.get(meta.code)?.mainCode||meta.code
    ),
    checkDate,
    dataStatus:"missing"
  }));
}


function absoluteUrlHybrid(url,base="https://anxinletech.com") {
  if (!url) return null;
  const s=String(url).trim();
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith("//")) return "https:"+s;
  if (s.startsWith("/")) return base+s;
  return base+"/"+s.replace(/^\.?\//,"");
}

function parseYuanAmountHybrid(text) {
  const s=stripHtml(text);
  const m=s.match(/([0-9]+(?:\.[0-9]+)?)\s*(万)?元/);
  if (!m) return null;
  const v=Number(m[1])*(m[2]?10000:1);
  return Number.isFinite(v)?v:null;
}

function parseAmountAfterLabelHybrid(text,label) {
  const s=stripHtml(text);
  const re=new RegExp(
    label+"[^0-9]{0,60}([0-9]+(?:\\.[0-9]+)?)\\s*(万)?元"
  );
  const m=s.match(re);
  if (!m) return null;
  const v=Number(m[1])*(m[2]?10000:1);
  return Number.isFinite(v)?v:null;
}

function normalizeAnxinStatus(statusText) {
  const s=stripHtml(statusText);
  if (/暂停申购/.test(s)) return {code:"suspended",label:"暂停申购"};
  if (/限大额|限购/.test(s)) return {code:"limited",label:"限额申购"};
  if (/开放申购|正常申购/.test(s)) return {code:"open",label:"开放申购"};
  if (/场内交易/.test(s)) return {code:"exchange",label:"场内交易"};
  return {code:"unknown",label:s.replace(/\?.*$/,"").trim()||"未知"};
}

function anxinVerificationLabel(statusText) {
  const s=stripHtml(statusText);
  if (/公告直核/.test(s)) return "公告直核";
  if (/人工核实/.test(s)) return "人工核实";
  if (/双源一致/.test(s)) return "双源一致";
  return "汇总口径";
}

function extractAnxinAnnouncementUrl(rowHtml) {
  const hrefs=[...String(rowHtml).matchAll(/href=["']([^"']+)["']/gi)]
    .map(m=>absoluteUrlHybrid(m[1]));
  return hrefs.reverse().find(u=>
    /fund(?:f10)?\.eastmoney\.com|fund\.eastmoney\.com|pdf\.dfcfw\.com/i.test(u)
  )||null;
}

function parseAnxinQuota(limitText,channelText,statusCode) {
  const limit=stripHtml(limitText);
  const channel=stripHtml(channelText);
  const joined=`${limit} ${channel}`;

  if (
    statusCode==="suspended" ||
    /代销与直销均暂停|均暂停申购/.test(joined)
  ) {
    return {
      agencyLimit:null,
      directLimit:null,
      agencyState:"suspended",
      directState:"suspended",
      directInferredFromAgency:false
    };
  }

  let agencyLimit=parseAmountAfterLabelHybrid(joined,"代销");
  let directLimit=parseAmountAfterLabelHybrid(joined,"直销");

  const singleLimit=parseYuanAmountHybrid(limit);
  const directOnly=
    /仅[^；。]*直销|APP直销|官网[^；。]*直销|直销[^；。]*代销无|代销无[^；。]*直销/.test(channel);
  const agencyPaused=/代销[^；。]*暂停/.test(joined);
  const directPaused=/直销[^；。]*暂停/.test(joined);

  if (
    agencyLimit===null &&
    directLimit===null &&
    singleLimit!==null
  ) {
    if (directOnly) directLimit=singleLimit;
    else agencyLimit=singleLimit;
  }

  if (statusCode==="open" || /正常申购/.test(limit)) {
    return {
      agencyLimit:null,
      directLimit:null,
      agencyState:"open",
      directState:"open",
      directInferredFromAgency:true
    };
  }

  let agencyState=agencyPaused
    ?"suspended"
    :(agencyLimit!==null
      ?"limited"
      :(directOnly?"unavailable":"unknown"));

  let directState=directPaused
    ?"suspended"
    :(directLimit!==null?"limited":"unknown");

  let directInferredFromAgency=false;

  // 用户口径：
  // 如果只披露一个普通申购额度，且没有单独披露直销额度，
  // 默认认为直销额度与代销额度一致。
  // “仅直销”“代销无此额度”等明确渠道例外不适用此规则。
  if (
    directLimit===null &&
    agencyLimit!==null &&
    !directOnly &&
    !directPaused
  ) {
    directLimit=agencyLimit;
    directState=agencyState==="limited"
      ?"limited"
      :agencyState;
    directInferredFromAgency=true;
  }

  return {
    agencyLimit,
    directLimit,
    agencyState,
    directState,
    directInferredFromAgency
  };
}

function parseAnxinLatestDate(html) {
  const flat=stripHtml(html);
  const m=flat.match(/当日速览\s*[·?]?\s*(\d{4}-\d{2}-\d{2})/);
  return m?m[1]:null;
}

function parseAnxinRows(html) {
  const quotaDate=parseAnxinLatestDate(html);
  const tableRows=String(html).match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)||[];
  const found=new Map();

  for (const rowHtml of tableRows) {
    const rowText=stripHtml(rowHtml);
    const codeMatch=rowText.match(/[（(](\d{6})[）)]/);
    if (!codeMatch) continue;

    const code=codeMatch[1];
    if (!OTC_CNY_CODES.has(code)) continue;

    const cells=cellsFromRow(rowHtml);
    if (cells.length<3) continue;

    const meta=OTC_CNY_META_MAP.get(code);
    const firstCell=cells[0]||"";
    const dynamicName=
      firstCell.replace(/[（(]\d{6}[）)]/,"").trim()||meta.name;
    const status=normalizeAnxinStatus(cells[1]||"");
    const limitText=cells[2]||"";
    const channelText=cells[3]||"";
    const announcementText=cells[4]||"";
    const quota=parseAnxinQuota(
      limitText,
      channelText,
      status.code
    );

    found.set(code,{
      ...meta,
      name:dynamicName,
      status:status.code,
      statusLabel:status.label,
      anxinVerification:anxinVerificationLabel(cells[1]||""),
      limitText,
      channelText,
      announcementText,
      sourceAnnouncementUrl:extractAnxinAnnouncementUrl(rowHtml),
      quotaDate,
      ...quota,
      source:"安鑫乐QDII额度日报",
      sourceUrl:ANXINLE_OTC_SOURCE_URL,
      dataStatus:"fresh"
    });
  }

  const rows=OTC_CNY_META.map(meta=>found.get(meta.code)||({
    ...meta,
    status:"missing",
    statusLabel:"安鑫乐未匹配",
    anxinVerification:"未匹配",
    limitText:"—",
    channelText:"—",
    announcementText:"—",
    sourceAnnouncementUrl:null,
    quotaDate,
    agencyLimit:null,
    directLimit:null,
    agencyState:"unknown",
    directState:"unknown",
    source:"安鑫乐QDII额度日报",
    sourceUrl:ANXINLE_OTC_SOURCE_URL,
    dataStatus:"missing"
  }));

  return {
    rows,
    quotaDate,
    matched:found.size
  };
}

function announcementTiming(parsed,today) {
  if (!parsed) return "none";

  if (
    parsed.effectiveDate &&
    parsed.effectiveDate>today
  ) return "upcoming";

  if (!noticeApplicable(parsed,today)) {
    return "expired";
  }

  return "active";
}

async function getLatestQuotaAnnouncement(product,today) {
  const notices=await fetchAnnouncementList(product.mainCode);
  const latest=notices[0]||null;

  if (!latest) {
    return {
      mainCode:product.mainCode,
      found:false,
      timing:"none"
    };
  }

  const cacheKey=
    OTC_ANN_VERIFY_CACHE_PREFIX+product.mainCode;
  const cached=await loadTimedJsonCache(
    cacheKey,
    90*24*3600*1000
  );

  if (
    cached?.announcement?.id===latest.id &&
    cached?.announcement?.parsed
  ) {
    const parsed=cached.announcement.parsed;
    return {
      mainCode:product.mainCode,
      found:true,
      id:latest.id,
      title:latest.title,
      publishDate:latest.publishDate,
      parsed,
      timing:announcementTiming(parsed,today),
      contentFetched:false,
      changedFromCache:false
    };
  }

  let parsed=null;
  let error=null;
  try {
    const text=await fetchAnnouncementContent(latest.id);
    parsed=parseNoticeState(latest,text,product);
  } catch(e) {
    error=e?.message||String(e);
  }

  const result={
    cachedAt:new Date().toISOString(),
    announcement:{
      id:latest.id,
      title:latest.title,
      publishDate:latest.publishDate,
      parsed
    }
  };
  await saveJsonCache(
    cacheKey,
    result,
    90*24*3600
  );

  return {
    mainCode:product.mainCode,
    found:true,
    id:latest.id,
    title:latest.title,
    publishDate:latest.publishDate,
    parsed,
    timing:parsed
      ?announcementTiming(parsed,today)
      :"unparsed",
    contentFetched:true,
    changedFromCache:!!cached?.announcement?.id &&
      cached.announcement.id!==latest.id,
    error
  };
}

function comparableChannel(
  row,
  parsed,
  channel
) {
  const scope=parsed.scope||"general";
  if (
    scope!=="general" &&
    scope!==channel
  ) return null;

  let expectedState=parsed.state;
  let expectedLimit=null;

  if (parsed.state==="limited") {
    if (channel==="agency") {
      expectedLimit=hasFiniteValue(parsed.agencyLimit)
        ?Number(parsed.agencyLimit)
        :(hasFiniteValue(parsed.generalLimit)
          ?Number(parsed.generalLimit)
          :null);
    } else {
      expectedLimit=hasFiniteValue(parsed.directLimit)
        ?Number(parsed.directLimit)
        :(hasFiniteValue(parsed.generalLimit)
          ?Number(parsed.generalLimit)
          :null);
    }
  }

  const actualState=
    channel==="agency"
      ?row.agencyState
      :row.directState;
  const actualLimit=
    channel==="agency"
      ?row.agencyLimit
      :row.directLimit;

  const checks=[];

  // 公告明确暂停/开放时，可以比较渠道状态。
  if (
    expectedState==="suspended" ||
    expectedState==="open"
  ) {
    if (
      actualState!=="unknown" &&
      actualState!=="unavailable"
    ) {
      checks.push({
        field:channel+"State",
        expected:expectedState,
        actual:actualState,
        match:actualState===expectedState
      });
    }
  }

  // 限额公告：只在公告解析到了金额时做金额硬比较。
  if (
    expectedState==="limited" &&
    hasFiniteValue(expectedLimit)
  ) {
    if (hasFiniteValue(actualLimit)) {
      checks.push({
        field:channel+"Limit",
        expected:Number(expectedLimit),
        actual:Number(actualLimit),
        match:Number(expectedLimit)===Number(actualLimit)
      });
    }
  }

  return {
    channel,
    expectedState,
    expectedLimit,
    actualState,
    actualLimit,
    checks
  };
}

function compareAnnouncementToAnxin(
  row,
  announcement,
  product,
  today
) {
  if (
    !announcement?.found ||
    !announcement.parsed
  ) {
    return {
      status:"unverified",
      label:"公告未解析",
      checks:[]
    };
  }

  const parsed=announcement.parsed;

  if (!shareIsAffected(parsed,row,product)) {
    return {
      status:"not_affected",
      label:"最新公告未涉及该份额",
      checks:[]
    };
  }

  if (announcement.timing==="upcoming") {
    return {
      status:"upcoming",
      label:`${parsed.effectiveDate||"未来日期"}起生效`,
      checks:[]
    };
  }

  if (announcement.timing!=="active") {
    return {
      status:"unverified",
      label:"最新公告当前未生效",
      checks:[]
    };
  }

  const parts=[
    comparableChannel(row,parsed,"agency"),
    comparableChannel(row,parsed,"direct")
  ].filter(Boolean);

  const checks=parts.flatMap(x=>x.checks||[]);

  // 若公告只解析到了“限额/暂停”等状态，但没解析到可比较金额，
  // 使用产品总体状态做软校验。
  if (!checks.length) {
    if (
      parsed.state==="limited" &&
      row.status==="limited"
    ) {
      return {
        status:"partial",
        label:"状态一致·金额未独立解析",
        checks:[]
      };
    }
    if (
      parsed.state==="suspended" &&
      row.status==="suspended" &&
      parsed.scope==="general"
    ) {
      return {
        status:"match",
        label:"公告一致",
        checks:[]
      };
    }
    return {
      status:"partial",
      label:"公告已读取·可比字段不足",
      checks:[]
    };
  }

  const mismatches=checks.filter(x=>!x.match);

  return mismatches.length
    ?{
      status:"mismatch",
      label:"与公告不一致",
      checks,
      mismatches
    }
    :{
      status:"match",
      label:"公告一致",
      checks
    };
}

function announcementForRow(row,annMap,today) {
  const product=OTC_PRODUCT_MAP.get(row.code);
  if (!product) return row;

  const ann=annMap.get(product.mainCode)||null;
  const verification=compareAnnouncementToAnxin(
    row,
    ann,
    product,
    today
  );

  const parsed=ann?.parsed||null;

  return {
    ...row,
    mainCode:product.mainCode,
    verificationStatus:verification.status,
    verificationLabel:verification.label,
    verificationChecks:verification.checks||[],
    verificationMismatches:verification.mismatches||[],
    verificationAnnouncementId:ann?.id||null,
    verificationAnnouncementTitle:ann?.title||null,
    verificationAnnouncementDate:ann?.publishDate||null,
    verificationAnnouncementUrl:ann?.id
      ?noticePdfUrl(ann.id)
      :null,
    verificationEffectiveDate:parsed?.effectiveDate||null,
    verificationTiming:ann?.timing||"none",
    verificationAnnouncementChanged:
      ann?.changedFromCache===true,
    announcementAffectedClasses:
      parsed?.affectedClasses||[],
    announcementAffectedCodes:
      parsed?.affectedCodes||[],
    officialExpectedState:
      parsed?.state||null,
    officialAgencyLimit:
      hasFiniteValue(parsed?.agencyLimit)
        ?Number(parsed.agencyLimit)
        :(hasFiniteValue(parsed?.generalLimit)
          ?Number(parsed.generalLimit)
          :null),
    officialDirectLimit:
      hasFiniteValue(parsed?.directLimit)
        ?Number(parsed.directLimit)
        :(hasFiniteValue(parsed?.generalLimit)
          ?Number(parsed.generalLimit)
          :null)
  };
}


function extractAnnouncementId(url) {
  if (!url) return null;
  const m=String(url).match(/(AN\d{12,})/);
  return m?m[1]:null;
}

function extractTitleAffectedClassesV37(title) {
  const t=normalizeNoticeText(title);
  const out=new Set();
  for (const m of t.matchAll(/([ACDEFI])\s*类/g)) {
    out.add(m[1]);
  }
  return [...out];
}


function parseLimitNumberV38(raw) {
  if (raw===null||raw===undefined) return null;
  const n=Number(
    String(raw)
      .replace(/,/g,"")
      .trim()
  );
  return Number.isFinite(n)?n:null;
}

function extractGeneralLimitV38(text) {
  const s=normalizeNoticeText(text);

  const patterns=[
    // 公告表格常见：“限制申购金额（单位：人民币元）10”
    /限制申购金额[^0-9]{0,160}([0-9][0-9,.]*)\s*(?:人民币)?元?/,

    // “累计金额限制调整为10元”
    /(?:申购|定期定额投资)[^。；]{0,180}?累计金额限制调整为\s*([0-9][0-9,.]*)\s*(?:人民币)?元/,

    // “金额不应超过10人民币元”
    /(?:累计申购|累计金额|申购、定期定额投资的金额)[^。；]{0,160}?(?:不应超过|不超过|不得超过|上限为|限制为)\s*([0-9][0-9,.]*)\s*(?:人民币)?元/,

    // “累计高于10元的申购业务进行限制”
    /(?:单笔或多笔累计|累计)[^。；]{0,120}?高于\s*([0-9][0-9,.]*)\s*(?:人民币)?元[^。；]{0,100}?(?:申购|定投|定期定额)/,

    // “单日...申购累计金额限制调整为10元”
    /单日[^。；]{0,180}?(?:申购|定期定额)[^。；]{0,160}?(?:限制调整为|调整为|不超过|不得超过)\s*([0-9][0-9,.]*)\s*(?:人民币)?元/
  ];

  for(const p of patterns){
    const m=s.match(p);
    if(m){
      const n=parseLimitNumberV38(m[1]);
      if(n!==null)return n;
    }
  }
  return null;
}

function extractChannelLimitV38(text,channel) {
  const s=normalizeNoticeText(text);

  const directPatterns=[
    /(?:直销渠道|直销机构|直销电子交易平台|网上直销|基金管理人直销|本公司直销)[^。；]{0,260}?(?:高于|超过|不应超过|不超过|不得超过|上限(?:为|调整为)?|限制(?:为|调整为)?)\s*([0-9][0-9,.]*)\s*(?:人民币)?元/,
    /针对在[^。；]{0,80}?直销渠道[^。；]{0,260}?(?:高于|超过)\s*([0-9][0-9,.]*)\s*(?:人民币)?元/
  ];

  const agencyPatterns=[
    /(?:代销机构|代销渠道|各代销机构|非直销销售机构|其他销售机构)[^。；]{0,260}?(?:高于|超过|不应超过|不超过|不得超过|上限(?:为|调整为)?|限制(?:为|调整为)?)\s*([0-9][0-9,.]*)\s*(?:人民币)?元/,
    /(?:除直销[^。；]{0,60}?外的销售机构)[^。；]{0,260}?(?:高于|超过|不超过|不得超过)\s*([0-9][0-9,.]*)\s*(?:人民币)?元/
  ];

  const patterns=channel==="direct"
    ?directPatterns
    :agencyPatterns;

  for(const p of patterns){
    const m=s.match(p);
    if(m){
      const n=parseLimitNumberV38(m[1]);
      if(n!==null)return n;
    }
  }
  return null;
}

function explicitChannelStateV38(text,channel) {
  const s=normalizeNoticeText(text);

  if(channel==="direct"){
    if(
      /(?:直销电子交易平台|直销渠道|直销机构|网上直销)[^。；]{0,180}?暂停[^。；]{0,120}?申购/.test(s) ||
      /在基金管理人直销电子交易平台暂停[^。；]{0,180}?申购业务/.test(s)
    ) return "suspended";

    if(
      /(?:直销电子交易平台|直销渠道|直销机构|网上直销)[^。；]{0,180}?恢复[^。；]{0,120}?申购/.test(s)
    ) return "open";
  }else{
    if(
      /(?:代销机构|代销渠道|各销售机构|本公司直销柜台及代销机构)[^。；]{0,220}?(?:仍)?暂停[^。；]{0,120}?申购/.test(s) ||
      /代销机构仍暂停办理申购/.test(s)
    ) return "suspended";

    if(
      /(?:代销机构|代销渠道|各销售机构)[^。；]{0,180}?恢复[^。；]{0,120}?申购/.test(s)
    ) return "open";
  }
  return null;
}

function extractDirectAffectedCodesV38(text,product){
  const s=normalizeNoticeText(text);
  const segs=[];

  for(const m of s.matchAll(/[^。；]{0,80}直销渠道[^。；]{0,320}/g)){
    segs.push(m[0]);
  }
  for(const m of s.matchAll(/[^。；]{0,80}直销电子交易平台[^。；]{0,320}/g)){
    segs.push(m[0]);
  }

  const found=new Set();
  for(const seg of segs){
    for(const m of seg.matchAll(/\b(\d{6})\b/g)){
      if(product.shares.includes(m[1])){
        found.add(m[1]);
      }
    }
  }
  return [...found];
}

function parseNoticeStateV38(notice,text,product) {
  const parsed=parseNoticeStateV37(
    notice,
    text,
    product
  );

  const general=extractGeneralLimitV38(text);
  const direct=extractChannelLimitV38(
    text,
    "direct"
  );
  const agency=extractChannelLimitV38(
    text,
    "agency"
  );

  if(hasFiniteValue(general)){
    parsed.generalLimit=Number(general);
    if(parsed.state==="unknown"){
      parsed.state="limited";
    }
  }

  if(hasFiniteValue(direct)){
    parsed.directLimit=Number(direct);
    if(parsed.state==="unknown"){
      parsed.state="limited";
    }
  }

  if(hasFiniteValue(agency)){
    parsed.agencyLimit=Number(agency);
    if(parsed.state==="unknown"){
      parsed.state="limited";
    }
  }

  parsed.directStateExplicit=
    explicitChannelStateV38(
      `${notice.title} ${text}`,
      "direct"
    );

  parsed.agencyStateExplicit=
    explicitChannelStateV38(
      `${notice.title} ${text}`,
      "agency"
    );

  parsed.directAffectedCodesV38=
    extractDirectAffectedCodesV38(
      text,
      product
    );

  // “在直销平台暂停...申购业务”这种标题，原 parser 可能只识别 scope，
  // 这里明确补成 direct suspended。
  if(
    parsed.scope==="direct" &&
    parsed.directStateExplicit==="suspended" &&
    parsed.state==="unknown"
  ){
    parsed.state="suspended";
  }

  return parsed;
}

function expectedChannelV38(
  row,
  parsed,
  channel
){
  let expectedState=parsed.state;
  let expectedLimit=null;

  const explicitState=
    channel==="direct"
      ?parsed.directStateExplicit
      :parsed.agencyStateExplicit;

  if(explicitState){
    expectedState=explicitState;
  }

  if(expectedState==="limited"){
    if(channel==="agency"){
      expectedLimit=
        hasFiniteValue(parsed.agencyLimit)
          ?Number(parsed.agencyLimit)
          :(hasFiniteValue(parsed.generalLimit)
            ?Number(parsed.generalLimit)
            :null);
    }else{
      const directCodes=
        parsed.directAffectedCodesV38||[];

      const directApplies=
        !directCodes.length ||
        directCodes.includes(row.code);

      expectedLimit=
        directApplies &&
        hasFiniteValue(parsed.directLimit)
          ?Number(parsed.directLimit)
          :(hasFiniteValue(parsed.generalLimit)
            ?Number(parsed.generalLimit)
            :null);
    }
  }

  return {
    expectedState,
    expectedLimit
  };
}

function comparableChannelV38(
  row,
  parsed,
  channel
){
  const scope=parsed.scope||"general";
  const explicitState=
    channel==="direct"
      ?parsed.directStateExplicit
      :parsed.agencyStateExplicit;

  // 即使标题是 direct-only，如果正文明确写了代销“仍暂停”，
  // 也允许把 agency 状态作为独立证据。
  if(
    scope!=="general" &&
    scope!==channel &&
    !explicitState
  ){
    return null;
  }

  const expected=
    expectedChannelV38(
      row,
      parsed,
      channel
    );

  const actualState=
    channel==="agency"
      ?row.agencyState
      :row.directState;

  const actualLimit=
    channel==="agency"
      ?row.agencyLimit
      :row.directLimit;

  const checks=[];

  if(
    expected.expectedState==="suspended" ||
    expected.expectedState==="open"
  ){
    if(
      actualState!=="unknown" &&
      actualState!=="unavailable"
    ){
      checks.push({
        field:channel+"State",
        expected:expected.expectedState,
        actual:actualState,
        match:
          actualState===
          expected.expectedState
      });
    }
  }

  if(
    expected.expectedState==="limited" &&
    hasFiniteValue(
      expected.expectedLimit
    ) &&
    hasFiniteValue(actualLimit)
  ){
    checks.push({
      field:channel+"Limit",
      expected:
        Number(expected.expectedLimit),
      actual:Number(actualLimit),
      match:
        Number(expected.expectedLimit)===
        Number(actualLimit)
    });
  }

  return {
    channel,
    expectedState:
      expected.expectedState,
    expectedLimit:
      expected.expectedLimit,
    actualState,
    actualLimit,
    checks
  };
}

function parseNoticeStateV37(notice,text,product) {
  const parsed=parseNoticeState(notice,text,product);
  parsed.titleAffectedClasses=
    extractTitleAffectedClassesV37(notice.title);
  return parsed;
}

function shareIsAffectedV37(parsed,meta,product) {
  // 标题里明确写 “A类及C类” 时，这是最强作用范围，
  // 不能因为正文基础信息里顺带出现 F/I 代码就把 F/I 也算进去。
  if (parsed?.titleAffectedClasses?.length) {
    if (meta.share==="单一") return true;
    return parsed.titleAffectedClasses.includes(meta.share);
  }

  if (parsed?.affectedClasses?.length) {
    if (meta.share==="单一") return true;
    return parsed.affectedClasses.includes(meta.share);
  }

  if (parsed?.affectedCodes?.length) {
    return parsed.affectedCodes.includes(meta.code);
  }

  return true;
}

async function loadAnnouncementBundle() {
  async function readOne(url) {
    try {
      const hit=await caches.default.match(
        new Request(url)
      );
      if (!hit) return null;
      const j=await hit.json();
      return {
        byId:j?.byId||{},
        latestByWatch:j?.latestByWatch||{}
      };
    } catch(_) {
      return null;
    }
  }

  // 先读新版缓存。
  const primary=await readOne(
    OTC_ANN_BUNDLE_CACHE_URL
  );
  if (
    primary &&
    Object.keys(primary.byId||{}).length
  ) {
    return {
      ...primary,
      cacheSource:"v7"
    };
  }

  // v3.12 的问题就是强制换缓存导致冷启动要重抓大量正文。
  // 如果新版缓存还没建立，直接继承 v3.10/v3.11 已经稳定的 v6 数据。
  const fallback=await readOne(
    OTC_ANN_BUNDLE_FALLBACK_CACHE_URL
  );
  if (
    fallback &&
    Object.keys(fallback.byId||{}).length
  ) {
    return {
      ...fallback,
      cacheSource:"v6-fallback"
    };
  }

  return {
    byId:{},
    latestByWatch:{},
    cacheSource:"empty"
  };
}

async function saveAnnouncementBundle(bundle) {
  try {
    await caches.default.put(
      new Request(OTC_ANN_BUNDLE_CACHE_URL),
      new Response(
        JSON.stringify({
          cachedAt:new Date().toISOString(),
          byId:bundle.byId||{},
          latestByWatch:bundle.latestByWatch||{}
        }),
        {
          headers:{
            "Content-Type":"application/json; charset=utf-8",
            "Cache-Control":"public, max-age=7776000"
          }
        }
      )
    );
  } catch(_) {}
}

function watchProduct(code) {
  return OTC_PRODUCT_MAP.get(code) ||
    OTC_PRODUCTS.find(p=>p.mainCode===code) ||
    null;
}

async function fetchAnnouncementWatchLists() {
  return await mapLimit(
    OTC_ANN_WATCH_CODES,
    6,
    async code=>{
      try {
        const notices=await fetchAnnouncementList(code);
        return {
          code,
          product:watchProduct(code),
          notices,
          error:null
        };
      } catch(e) {
        return {
          code,
          product:watchProduct(code),
          notices:[],
          error:e?.message||String(e)
        };
      }
    }
  );
}

function buildNoticeMeta(watchResults) {
  const byId=new Map();

  for (const item of watchResults) {
    for (const n of item.notices) {
      if (!byId.has(n.id)) {
        byId.set(n.id,{
          ...n,
          sourceCodes:[],
          mainCodes:[]
        });
      }
      const x=byId.get(n.id);
      if (!x.sourceCodes.includes(item.code)) {
        x.sourceCodes.push(item.code);
      }
      const main=item.product?.mainCode;
      if (main && !x.mainCodes.includes(main)) {
        x.mainCodes.push(main);
      }
    }
  }
  return byId;
}

function latestWatchMap(watchResults) {
  const out={};
  for (const item of watchResults) {
    const n=item.notices?.[0];
    if (!n) continue;
    out[item.code]={
      id:n.id,
      title:n.title,
      publishDate:n.publishDate,
      mainCode:item.product?.mainCode||null
    };
  }
  return out;
}

function sourceAnnouncementIdsFromRows(rows) {
  const ids=new Set();
  for (const r of rows) {
    const id=extractAnnouncementId(
      r.sourceAnnouncementUrl
    );
    if (id) ids.add(id);
  }
  return [...ids];
}

function changedLatestIds(previous,current) {
  const ids=[];
  for (const [code,x] of Object.entries(current)) {
    const old=previous?.[code];
    if (
      old?.id &&
      x?.id &&
      old.id!==x.id
    ) {
      ids.push(x.id);
    }
  }
  return [...new Set(ids)];
}

function baselineLatestIds(current) {
  return [...new Set(
    Object.values(current)
      .map(x=>x?.id)
      .filter(Boolean)
  )];
}

async function fillAnnouncementBundle({
  bundle,
  watchResults,
  anxinRows,
  today
}) {
  const noticeMeta=buildNoticeMeta(watchResults);
  const currentLatest=latestWatchMap(watchResults);
  const previousLatest=bundle.latestByWatch||{};

  const changedIds=changedLatestIds(
    previousLatest,
    currentLatest
  );
  const currentSourceIds=
    sourceAnnouncementIdsFromRows(anxinRows);
  const latestIds=baselineLatestIds(
    currentLatest
  );

  // 冷启动不再串行抓 21 篇正文。
  // 最多16篇、并发5路：
  // 1安鑫乐 + 25列表 + 16正文 = 42，
  // 仍给历史回溯预留约6次外部请求。
  const MAX_BODY_FETCH=16;

  const priority=[
    ...changedIds,
    ...currentSourceIds,
    ...latestIds
  ];

  const queue=[
    ...new Set(priority)
  ].filter(id=>!bundle.byId?.[id]);

  const tasks=queue.slice(
    0,
    MAX_BODY_FETCH
  );

  const errors=[];
  let fetched=0;

  const results=await mapLimit(
    tasks,
    5,
    async id=>{
      const meta=noticeMeta.get(id);
      if (!meta) {
        return {id,skipped:true};
      }

      const product=
        meta.mainCodes?.length
          ?OTC_PRODUCTS.find(
            p=>p.mainCode===meta.mainCodes[0]
          )
          :null;

      if (!product) {
        return {id,skipped:true};
      }

      try {
        const text=
          await fetchAnnouncementContent(id);

        const parsed=parseNoticeStateV38(
          meta,
          text,
          product
        );

        return {
          id,
          item:{
            id,
            title:meta.title,
            publishDate:meta.publishDate,
            sourceCodes:meta.sourceCodes||[],
            mainCodes:meta.mainCodes||[],
            parsed,
            fetchedAt:
              new Date().toISOString()
          }
        };
      } catch(e) {
        return {
          id,
          error:e?.message||String(e)
        };
      }
    }
  );

  for (const r of results) {
    if (r?.item) {
      bundle.byId[r.id]=r.item;
      fetched+=1;
    } else if (r?.error) {
      errors.push({
        id:r.id,
        error:r.error
      });
    }
  }

  bundle.latestByWatch=currentLatest;
  await saveAnnouncementBundle(bundle);

  return {
    bundle,
    noticeMeta,
    currentLatest,
    changedIds,
    contentFetched:fetched,
    errors
  };
}


async function refreshLegacyEffectiveDates({
  bundle,
  today,
  maxFetch=2
}) {
  const candidates=Object.values(
    bundle.byId||{}
  ).filter(item=>
    item?.historyBackfill===true &&
    item?.parsed &&
    item.publishDate &&
    item.parsed.effectiveDate===
      item.publishDate
  ).slice(0,maxFetch);

  if (!candidates.length) {
    return {
      fetched:0,
      errors:[]
    };
  }

  const errors=[];
  let fetched=0;

  const results=await mapLimit(
    candidates,
    2,
    async item=>{
      const mainCode=
        item.mainCodes?.[0]||
        item.sourceCodes?.[0]||
        null;

      const product=mainCode
        ?OTC_PRODUCTS.find(
          p=>p.mainCode===mainCode
        )
        :null;

      if (!product) {
        return {
          id:item.id,
          skipped:true
        };
      }

      try {
        const text=
          await fetchAnnouncementContent(
            item.id
          );

        const meta={
          id:item.id,
          title:item.title,
          publishDate:item.publishDate,
          scope:noticeScope(
            item.title||""
          ),
          sourceCodes:
            item.sourceCodes||[mainCode],
          mainCodes:
            item.mainCodes||[mainCode]
        };

        const parsed=
          parseNoticeStateV38(
            meta,
            text,
            product
          );

        return {
          id:item.id,
          parsed
        };
      } catch(e) {
        return {
          id:item.id,
          error:e?.message||String(e)
        };
      }
    }
  );

  for (const r of results) {
    if (r?.parsed && bundle.byId?.[r.id]) {
      bundle.byId[r.id]={
        ...bundle.byId[r.id],
        parsed:r.parsed,
        reparsedAt:
          new Date().toISOString(),
        parserVersion:"v3.13"
      };
      fetched+=1;
    } else if (r?.error) {
      errors.push({
        id:r.id,
        error:r.error
      });
    }
  }

  if (fetched>0) {
    await saveAnnouncementBundle(bundle);
  }

  return {
    fetched,
    errors
  };
}

function candidateIdsForRow(
  row,
  bundle,
  currentLatest
) {
  const product=OTC_PRODUCT_MAP.get(row.code);
  if (!product) return [];

  const ids=[];
  const sourceId=extractAnnouncementId(
    row.sourceAnnouncementUrl
  );
  if (sourceId) ids.push(sourceId);

  // 主代码最新公告
  const mainLatest=currentLatest?.[
    product.mainCode
  ]?.id;
  if (mainLatest) ids.push(mainLatest);

  // 特殊 D/E/F/I 份额自己的最新公告
  const ownLatest=currentLatest?.[
    row.code
  ]?.id;
  if (ownLatest) ids.push(ownLatest);

  // 缓存中同一产品、同一特殊代码历史上已解析的公告也作为候选。
  for (const [id,item] of Object.entries(bundle.byId||{})) {
    const sourceCodes=item?.sourceCodes||[];
    const mainCodes=item?.mainCodes||[];
    if (
      sourceCodes.includes(row.code) ||
      mainCodes.includes(product.mainCode)
    ) {
      ids.push(id);
    }
  }

  return [...new Set(ids)];
}

function parsedCandidatesForRow(
  row,
  bundle,
  currentLatest,
  today
) {
  const product=OTC_PRODUCT_MAP.get(row.code);
  const ids=candidateIdsForRow(
    row,
    bundle,
    currentLatest
  );

  return ids
    .map(id=>bundle.byId?.[id])
    .filter(Boolean)
    .map(item=>({
      ...item,
      timing:announcementTiming(
        item.parsed,
        today
      )
    }))
    .filter(item=>
      shareIsAffectedV37(
        item.parsed,
        row,
        product
      )
    )
    .sort((a,b)=>
      String(b.publishDate||"")
        .localeCompare(
          String(a.publishDate||"")
        )
    );
}

function compareAnnouncementToAnxinV37(
  row,
  official,
  product,
  today
) {
  if (!official?.parsed) {
    return {
      status:"unverified",
      label:"官方公告待解析",
      checks:[]
    };
  }

  const parsed=official.parsed;

  if (!shareIsAffectedV37(
    parsed,
    row,
    product
  )) {
    return {
      status:"not_affected",
      label:"公告未涉及该份额",
      checks:[]
    };
  }

  const timing=announcementTiming(
    parsed,
    today
  );

  if (timing==="upcoming") {
    return {
      status:"upcoming",
      label:`${parsed.effectiveDate||"未来日期"}起生效`,
      checks:[]
    };
  }

  if (timing!=="active") {
    return {
      status:"unverified",
      label:"公告当前未生效",
      checks:[]
    };
  }

  const parts=[
    comparableChannelV38(
      row,
      parsed,
      "agency"
    ),
    comparableChannelV38(
      row,
      parsed,
      "direct"
    )
  ].filter(Boolean);

  const checks=parts.flatMap(
    x=>x.checks||[]
  );

  if (!checks.length) {
    if (
      parsed.state==="limited" &&
      row.status==="limited"
    ) {
      return {
        status:"partial",
        label:"状态一致·金额未独立解析",
        checks:[]
      };
    }

    if (
      parsed.state==="suspended" &&
      row.status==="suspended"
    ) {
      return {
        status:"match",
        label:"公告一致",
        checks:[]
      };
    }

    return {
      status:"partial",
      label:"公告已读取·可比字段不足",
      checks:[]
    };
  }

  const mismatches=checks.filter(
    x=>!x.match
  );

  return mismatches.length
    ?{
      status:"mismatch",
      label:"与公告不一致",
      checks,
      mismatches
    }
    :{
      status:"match",
      label:"公告一致",
      checks
    };
}

function verifyAnxinRowsV37({
  rows,
  bundle,
  currentLatest,
  changedIds,
  today
}) {
  return rows.map(row=>{
    const product=OTC_PRODUCT_MAP.get(row.code);
    const candidates=parsedCandidatesForRow(
      row,
      bundle,
      currentLatest,
      today
    );

    const upcoming=candidates.find(
      x=>x.timing==="upcoming"
    )||null;

    // 当前生效公告取“最新且适用于该份额”的 active 公告。
    // 这能覆盖 I/F 独立份额公告，不再强行使用主代码旧公告。
    const active=candidates.find(
      x=>x.timing==="active"
    )||null;

    const sourceId=extractAnnouncementId(
      row.sourceAnnouncementUrl
    );
    const sourceOfficial=sourceId
      ?bundle.byId?.[sourceId]
      :null;

    const verificationOfficial=
      active ||
      sourceOfficial ||
      null;

    const verification=
      compareAnnouncementToAnxinV37(
        row,
        verificationOfficial,
        product,
        today
      );

    const latestCandidate=
      upcoming ||
      candidates[0] ||
      null;

    const isChanged=
      latestCandidate?.id &&
      changedIds.includes(
        latestCandidate.id
      );

    // 若有未来公告，验证状态显示提前预警，但保留 currentVerificationStatus。
    const displayStatus=upcoming
      ?"upcoming"
      :verification.status;
    const displayLabel=upcoming
      ?`${upcoming.parsed.effectiveDate||"未来日期"}起生效`
      :verification.label;

    return {
      ...row,

      verificationStatus:displayStatus,
      verificationLabel:displayLabel,
      currentVerificationStatus:
        verification.status,
      currentVerificationLabel:
        verification.label,
      verificationChecks:
        verification.checks||[],
      verificationMismatches:
        verification.mismatches||[],

      verificationAnnouncementId:
        verificationOfficial?.id||null,
      verificationAnnouncementTitle:
        verificationOfficial?.title||null,
      verificationAnnouncementDate:
        verificationOfficial?.publishDate||null,
      verificationAnnouncementUrl:
        verificationOfficial?.id
          ?noticePdfUrl(
            verificationOfficial.id
          )
          :null,
      verificationEffectiveDate:
        verificationOfficial?.parsed?.effectiveDate||null,

      latestOfficialAnnouncementId:
        latestCandidate?.id||null,
      latestOfficialAnnouncementTitle:
        latestCandidate?.title||null,
      latestOfficialAnnouncementDate:
        latestCandidate?.publishDate||null,
      latestOfficialAnnouncementUrl:
        latestCandidate?.id
          ?noticePdfUrl(
            latestCandidate.id
          )
          :null,
      latestOfficialEffectiveDate:
        latestCandidate?.parsed?.effectiveDate||null,
      latestOfficialTiming:
        latestCandidate?.timing||"none",
      verificationAnnouncementChanged:
        isChanged===true,

      announcementAffectedClasses:
        verificationOfficial?.parsed?.titleAffectedClasses?.length
          ?verificationOfficial.parsed.titleAffectedClasses
          :(verificationOfficial?.parsed?.affectedClasses||[]),
      announcementAffectedCodes:
        verificationOfficial?.parsed?.affectedCodes||[],

      officialExpectedState:
        verificationOfficial?.parsed?.state||null,
      officialAgencyLimit:
        verificationOfficial?.parsed
          ?expectedChannelV38(
            row,
            verificationOfficial.parsed,
            "agency"
          ).expectedLimit
          :null,
      officialDirectLimit:
        verificationOfficial?.parsed
          ?expectedChannelV38(
            row,
            verificationOfficial.parsed,
            "direct"
          ).expectedLimit
          :null
    };
  });
}

function buildAnnouncementUpdatesV37({
  watchResults,
  bundle,
  currentLatest,
  changedIds,
  today
}) {
  const updates=[];

  for (const item of watchResults) {
    const latest=currentLatest?.[item.code];
    if (!latest?.id) continue;

    const cached=bundle.byId?.[
      latest.id
    ];
    const timing=cached?.parsed
      ?announcementTiming(
        cached.parsed,
        today
      )
      :"unparsed";

    if (
      changedIds.includes(latest.id) ||
      timing==="upcoming"
    ) {
      updates.push({
        watchCode:item.code,
        mainCode:item.product?.mainCode||null,
        id:latest.id,
        title:latest.title,
        publishDate:latest.publishDate,
        effectiveDate:
          cached?.parsed?.effectiveDate||null,
        timing,
        changed:
          changedIds.includes(latest.id),
        url:noticePdfUrl(latest.id)
      });
    }
  }

  const seen=new Set();
  return updates.filter(x=>{
    const key=`${x.watchCode}:${x.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}


function needsHistoryBackfill(status) {
  return (
    status==="unverified" ||
    status==="partial"
  );
}

function unresolvedProductMainCodes(rows) {
  return [...new Set(
    (rows||[])
      .filter(r=>
        needsHistoryBackfill(
          r.currentVerificationStatus
        )
      )
      .map(r=>
        OTC_PRODUCT_MAP.get(r.code)?.mainCode
      )
      .filter(Boolean)
  )];
}

function productResolvedAfterVerify(
  baseRows,
  product,
  bundle,
  currentLatest,
  changedIds,
  today
) {
  const checked=verifyAnxinRowsV37({
    rows:baseRows,
    bundle,
    currentLatest,
    changedIds,
    today
  });

  return checked
    .filter(r=>
      OTC_PRODUCT_MAP.get(r.code)?.mainCode===
      product.mainCode
    )
    .every(r=>
      !needsHistoryBackfill(
        r.currentVerificationStatus
      )
    );
}

async function backfillUnverifiedAnnouncements({
  baseRows,
  verifiedRows,
  bundle,
  currentLatest,
  changedIds,
  today,
  initialContentFetches
}) {
  const unresolved=unresolvedProductMainCodes(
    verifiedRows
  );

  // 这里只处理正常25代码检查后仍为 unverified / partial 的产品。
  // 外部 fetch 预算按 48 次控制：
  // 1 安鑫乐 + 25 首屏公告列表 + 首轮正文 + 历史回溯 <= 48。
  // Cache API 不计入这个动态 fetch 预算。
  const baseFetches=
    1 +
    OTC_ANN_WATCH_CODES.length +
    Number(initialContentFetches||0);

  const budget={
    remaining:Math.max(
      0,
      Math.min(6,48-baseFetches)
    )
  };

  const errors=[];
  let pagesChecked=0;
  let bodiesFetched=0;
  const productsChecked=[];

  for(const mainCode of unresolved){
    if(budget.remaining<2)break;

    const product=OTC_PRODUCTS.find(
      p=>p.mainCode===mainCode
    );
    if(!product)continue;

    productsChecked.push(mainCode);

    // 先重新读取第1页。原因：
    // 新版可能刚刚排除了“申购/定投起点”等伪额度公告，
    // 真正有效的暂停/限额公告可能本来就在第1页较后位置。
    if(budget.remaining>=1){
      budget.remaining-=1;
      pagesChecked+=1;

      try{
        const firstPage=
          await fetchAnnouncementList(
            mainCode,
            1,
            100
          );

        for(const notice of firstPage){
          if(
            productResolvedAfterVerify(
              baseRows,
              product,
              bundle,
              currentLatest,
              changedIds,
              today
            )
          ){
            break;
          }

          if(bundle.byId?.[notice.id]){
            continue;
          }

          if(budget.remaining<1)break;
          budget.remaining-=1;
          bodiesFetched+=1;

          try{
            const text=
              await fetchAnnouncementContent(
                notice.id
              );

            const meta={
              ...notice,
              sourceCodes:[mainCode],
              mainCodes:[mainCode]
            };

            const parsed=
              parseNoticeStateV38(
                meta,
                text,
                product
              );

            bundle.byId[notice.id]={
              id:notice.id,
              title:notice.title,
              publishDate:
                notice.publishDate,
              sourceCodes:[mainCode],
              mainCodes:[mainCode],
              parsed,
              fetchedAt:
                new Date().toISOString(),
              historyBackfill:true,
              historyPage:1
            };
          }catch(e){
            errors.push({
              mainCode,
              page:1,
              id:notice.id,
              stage:"history_body",
              error:e?.message||String(e)
            });
          }
        }
      }catch(e){
        errors.push({
          mainCode,
          page:1,
          stage:"history_list",
          error:e?.message||String(e)
        });
      }
    }

    // 第1页仍未解决时，最多继续看第2~4页。
    for(let page=2;page<=4;page++){
      if(budget.remaining<1)break;

      budget.remaining-=1;
      pagesChecked+=1;

      let notices=[];
      try{
        notices=await fetchAnnouncementList(
          mainCode,
          page,
          100
        );
      }catch(e){
        errors.push({
          mainCode,
          page,
          stage:"history_list",
          error:e?.message||String(e)
        });
        continue;
      }

      if(!notices.length)continue;

      for(const notice of notices){
        if(
          productResolvedAfterVerify(
            baseRows,
            product,
            bundle,
            currentLatest,
            changedIds,
            today
          )
        ){
          break;
        }

        if(bundle.byId?.[notice.id]){
          continue;
        }

        if(budget.remaining<1)break;
        budget.remaining-=1;
        bodiesFetched+=1;

        try{
          const text=
            await fetchAnnouncementContent(
              notice.id
            );

          const meta={
            ...notice,
            sourceCodes:[mainCode],
            mainCodes:[mainCode]
          };

          const parsed=
            parseNoticeStateV38(
              meta,
              text,
              product
            );

          bundle.byId[notice.id]={
            id:notice.id,
            title:notice.title,
            publishDate:
              notice.publishDate,
            sourceCodes:[mainCode],
            mainCodes:[mainCode],
            parsed,
            fetchedAt:
              new Date().toISOString(),
            historyBackfill:true,
            historyPage:page
          };
        }catch(e){
          errors.push({
            mainCode,
            page,
            id:notice.id,
            stage:"history_body",
            error:e?.message||String(e)
          });
        }
      }

      if(
        productResolvedAfterVerify(
          baseRows,
          product,
          bundle,
          currentLatest,
          changedIds,
          today
        )
      ){
        break;
      }
    }
  }

  if(bodiesFetched>0){
    await saveAnnouncementBundle(bundle);
  }

  const rows=verifyAnxinRowsV37({
    rows:baseRows,
    bundle,
    currentLatest,
    changedIds,
    today
  });

  return {
    rows,
    pagesChecked,
    bodiesFetched,
    productsChecked,
    errors,
    budgetRemaining:budget.remaining
  };
}

async function buildOtcFundsHybridV37({
  forceRefresh=false,
  ctx=null
}={}) {
  const today=shanghaiNowParts().date;

  if (!forceRefresh) {
    const short=await loadTimedJsonCache(
      OTC_RESULT_CACHE_URL,
      OTC_RESULT_FRESH_MS
    );
    if (
      short &&
      short.engineVersion===
        OTC_ENGINE_VERSION
    ) {
      return {
        ...short,
        servedFromWorkerCache:true
      };
    }

    // 普通打开网页时，过期缓存也先快速返回，避免等待25个公告列表
    // 以及公告正文全部读取完成。最新数据由 waitUntil 在后台更新。
    const lastGood=
      await loadOtcLastGood();

    if(
      lastGood &&
      Array.isArray(lastGood.rows) &&
      lastGood.rows.length
    ){
      const canRefreshInBackground=
        !!ctx &&
        typeof ctx.waitUntil===
          "function";

      if(canRefreshInBackground){
        ctx.waitUntil(
          buildOtcFundsHybridV37({
            forceRefresh:true,
            ctx:null
          }).catch(e=>{
            console.error(
              "background OTC refresh failed",
              e
            );
          })
        );
      }

      return {
        ...lastGood,
        servedAt:
          new Date().toISOString(),
        servedFromLastGood:true,
        refreshingInBackground:
          canRefreshInBackground,
        rows:(lastGood.rows||[]).map(
          r=>({
            ...r,
            dataStatus:"cached"
          })
        )
      };
    }
  }

  try {
    // 1) 当前额度主源
    const anxinHtml=await fetchText(
      ANXINLE_OTC_SOURCE_URL,
      10000
    );
    const anxin=parseAnxinRows(
      anxinHtml
    );

    // 2) 一次 consolidated cache read
    const bundle=await loadAnnouncementBundle();

    // 3) 17主代码 + 8特殊份额 = 25 个公告列表
    const watchResults=
      await fetchAnnouncementWatchLists();

    // 4) 最多读取21篇“新增/当前验证”正文
    const filled=await fillAnnouncementBundle({
      bundle,
      watchResults,
      anxinRows:anxin.rows,
      today
    });

    // 只重解析极少量旧“历史回溯公告”，用于修正类似
    // “2025年9月29日起”被旧缓存记成公告发布日期的问题。
    const legacyRefresh=
      await refreshLegacyEffectiveDates({
        bundle:filled.bundle,
        today,
        maxFetch:2
      });

    // 5) 官方公告校验；当前额度绝不被公告覆盖
    let rows=verifyAnxinRowsV37({
      rows:anxin.rows,
      bundle:filled.bundle,
      currentLatest:filled.currentLatest,
      changedIds:filled.changedIds,
      today
    });

    // 6) 仅对仍未验证的产品向后翻历史公告。
    // 例如较早发布且“恢复时间另行公告”的持续暂停公告。
    const historyBackfill=
      await backfillUnverifiedAnnouncements({
        baseRows:anxin.rows,
        verifiedRows:rows,
        bundle:filled.bundle,
        currentLatest:filled.currentLatest,
        changedIds:filled.changedIds,
        today,
        initialContentFetches:
          filled.contentFetched+
          legacyRefresh.fetched
      });

    rows=historyBackfill.rows;

    const announcementUpdates=
      buildAnnouncementUpdatesV37({
        watchResults,
        bundle:filled.bundle,
        currentLatest:filled.currentLatest,
        changedIds:filled.changedIds,
        today
      });

    const summary={
      limited:rows.filter(
        r=>r.status==="limited"
      ).length,
      suspended:rows.filter(
        r=>r.status==="suspended"
      ).length,
      open:rows.filter(
        r=>r.status==="open"
      ).length,
      directExplicit:rows.filter(
        r=>hasFiniteValue(
          r.directLimit
        )
      ).length,
      directHigher:rows.filter(
        r=>hasFiniteValue(
          r.directLimit
        ) &&
        hasFiniteValue(
          r.agencyLimit
        ) &&
        Number(r.directLimit)>
        Number(r.agencyLimit)
      ).length,
      verifiedMatch:rows.filter(
        r=>r.currentVerificationStatus==="match"
      ).length,
      verifiedMismatch:rows.filter(
        r=>r.currentVerificationStatus==="mismatch"
      ).length,
      upcoming:rows.filter(
        r=>r.verificationStatus==="upcoming"
      ).length,
      partial:rows.filter(
        r=>r.currentVerificationStatus==="partial"
      ).length,
      unverified:rows.filter(
        r=>r.currentVerificationStatus==="unverified"
      ).length
    };

    const result={
      engineVersion:
        OTC_ENGINE_VERSION,
      generatedAt:new Date().toISOString(),
      checkDate:today,
      quotaDate:anxin.quotaDate,
      matched:anxin.matched,
      total:OTC_CNY_META.length,

      source:"安鑫乐QDII额度日报",
      sourceUrl:ANXINLE_OTC_SOURCE_URL,
      verificationSource:
        "基金管理人公告原文",
      verificationTransport:
        "东方财富/天天基金公告接口",

      announcementListChecks:
        OTC_ANN_WATCH_CODES.length,
      announcementMainProductChecks:
        OTC_PRODUCTS.length,
      announcementSpecialShareChecks:
        OTC_SPECIAL_ANN_CODES.length,
      announcementContentFetches:
        filled.contentFetched+
        legacyRefresh.fetched+
        historyBackfill.bodiesFetched,
      announcementLegacyReparseFetches:
        legacyRefresh.fetched,
      announcementBundleCacheSource:
        bundle.cacheSource||"unknown",
      announcementHistoryBackfillPages:
        historyBackfill.pagesChecked,
      announcementHistoryBackfillBodies:
        historyBackfill.bodiesFetched,
      announcementHistoryBackfillProducts:
        historyBackfill.productsChecked,
      announcementFetchErrors:[
        ...filled.errors,
        ...legacyRefresh.errors,
        ...historyBackfill.errors
      ],

      rows,
      announcementUpdates,
      summary
    };

    if (anxin.matched>=30) {
      await saveJsonCache(
        OTC_LAST_GOOD_CACHE_URL,
        {
          ...result,
          cachedAt:new Date().toISOString()
        },
        7*24*3600
      );
    }

    await saveJsonCache(
      OTC_RESULT_CACHE_URL,
      {
        ...result,
        cachedAt:new Date().toISOString()
      },
      300
    );

    return result;
  } catch(e) {
    const cached=await loadOtcLastGood();
    if (cached) {
      return {
        ...cached,
        servedAt:new Date().toISOString(),
        servedFromLastGood:true,
        refreshingInBackground:false,
        upstreamError:
          e?.message||String(e),
        rows:(cached.rows||[]).map(
          r=>({
            ...r,
            dataStatus:"cached"
          })
        )
      };
    }
    throw e;
  }
}

async function buildOtcFundsHybrid({
  forceRefresh=false
}={}) {
  const today=shanghaiNowParts().date;

  if (!forceRefresh) {
    const short=await loadTimedJsonCache(
      OTC_RESULT_CACHE_URL,
      5*60*1000
    );
    if (short) {
      return {
        ...short,
        servedFromWorkerCache:true
      };
    }
  }

  try {
    // 主数据源：每次强制刷新都会重新读取安鑫乐最新日报。
    const anxinHtml=await fetchText(
      ANXINLE_OTC_SOURCE_URL,
      10000
    );
    const anxin=parseAnxinRows(anxinHtml);

    // 校验源：每个基金产品每次打开页面都检查一次公告列表。
    // 公告 ID 未变化时复用正文解析缓存；有新公告才重新读正文。
    const announcements=await mapLimit(
      OTC_PRODUCTS,
      5,
      async product=>{
        try {
          return await getLatestQuotaAnnouncement(
            product,
            today
          );
        } catch(e) {
          return {
            mainCode:product.mainCode,
            found:false,
            timing:"error",
            error:e?.message||String(e)
          };
        }
      }
    );

    const annMap=new Map(
      announcements.map(x=>[x.mainCode,x])
    );

    const rows=anxin.rows.map(
      row=>announcementForRow(
        row,
        annMap,
        today
      )
    );

    const productAnnouncements=announcements.map(a=>({
      mainCode:a.mainCode,
      found:a.found===true,
      id:a.id||null,
      title:a.title||null,
      publishDate:a.publishDate||null,
      effectiveDate:a.parsed?.effectiveDate||null,
      timing:a.timing||"none",
      url:a.id?noticePdfUrl(a.id):null,
      affectedClasses:a.parsed?.affectedClasses||[],
      affectedCodes:a.parsed?.affectedCodes||[],
      state:a.parsed?.state||null,
      agencyLimit:hasFiniteValue(a.parsed?.agencyLimit)
        ?Number(a.parsed.agencyLimit)
        :null,
      directLimit:hasFiniteValue(a.parsed?.directLimit)
        ?Number(a.parsed.directLimit)
        :null,
      generalLimit:hasFiniteValue(a.parsed?.generalLimit)
        ?Number(a.parsed.generalLimit)
        :null,
      contentFetched:a.contentFetched===true,
      changedFromCache:a.changedFromCache===true,
      error:a.error||null
    }));

    const result={
      generatedAt:new Date().toISOString(),
      checkDate:today,
      quotaDate:anxin.quotaDate,
      matched:anxin.matched,
      total:OTC_CNY_META.length,
      source:"安鑫乐QDII额度日报",
      sourceUrl:ANXINLE_OTC_SOURCE_URL,
      verificationSource:"基金管理人公告原文",
      verificationTransport:
        "东方财富/天天基金公告接口",
      rows,
      productAnnouncements,
      announcementListChecks:OTC_PRODUCTS.length,
      announcementContentFetches:
        announcements.filter(
          x=>x.contentFetched
        ).length,
      summary:{
        limited:rows.filter(
          r=>r.status==="limited"
        ).length,
        suspended:rows.filter(
          r=>r.status==="suspended"
        ).length,
        open:rows.filter(
          r=>r.status==="open"
        ).length,
        directExplicit:rows.filter(
          r=>hasFiniteValue(r.directLimit)
        ).length,
        directHigher:rows.filter(
          r=>hasFiniteValue(r.directLimit) &&
             hasFiniteValue(r.agencyLimit) &&
             Number(r.directLimit)>
             Number(r.agencyLimit)
        ).length,
        verifiedMatch:rows.filter(
          r=>r.verificationStatus==="match"
        ).length,
        verifiedMismatch:rows.filter(
          r=>r.verificationStatus==="mismatch"
        ).length,
        upcoming:rows.filter(
          r=>r.verificationStatus==="upcoming"
        ).length,
        partial:rows.filter(
          r=>r.verificationStatus==="partial"
        ).length
      }
    };

    if (anxin.matched>=30) {
      await saveJsonCache(
        OTC_LAST_GOOD_CACHE_URL,
        {
          ...result,
          cachedAt:new Date().toISOString()
        },
        7*24*3600
      );
    }

    await saveJsonCache(
      OTC_RESULT_CACHE_URL,
      {
        ...result,
        cachedAt:new Date().toISOString()
      },
      300
    );

    return result;
  } catch(e) {
    const cached=await loadOtcLastGood();
    if (cached) {
      return {
        ...cached,
        generatedAt:new Date().toISOString(),
        checkDate:today,
        servedFromLastGood:true,
        upstreamError:e?.message||String(e),
        rows:(cached.rows||[]).map(r=>({
          ...r,
          dataStatus:"cached"
        }))
      };
    }
    throw e;
  }
}

async function buildOtcFunds() {
  const today=shanghaiNowParts().date;

  const daily=await loadTimedJsonCache(
    OTC_RESULT_CACHE_URL,
    36*3600*1000
  );
  if (daily?.checkDate===today) {
    return {...daily,servedFromDailyCache:true};
  }

  try {
    // 17 个产品先公平地各取一次公告列表。
    const listItems=await mapLimit(
      OTC_PRODUCTS,
      5,
      async product=>{
        try {
          return {
            product,
            notices:await fetchAnnouncementList(product.mainCode),
            error:null
          };
        } catch(e) {
          return {
            product,
            notices:[],
            error:e?.message||String(e)
          };
        }
      }
    );

    const prepared=[];
    for (const item of listItems) {
      const p=await prepareProductResolution(
        item.product,
        item.notices
      );
      prepared.push({
        ...p,
        listError:item.error
      });
    }

    // Cloudflare Free: 50 subrequests/request.
    // 17次公告列表 + 最多31次公告正文 = 48，留2次余量。
    const budget={remaining:31};

    // 第一轮：所有没有命中产品缓存的基金，至少各读一篇正文。
    for (const item of prepared) {
      if (item.cached || !item.resolution.notices.length) continue;
      await parseNextUsefulNotice(
        item.resolution,
        today,
        budget
      );
    }

    // 第二轮：再公平地给“尚未完整确定渠道状态”的产品各补一篇。
    for (const item of prepared) {
      if (budget.remaining<=0) break;
      if (item.cached) continue;
      if (resolutionComplete(item.resolution)) continue;

      await parseNextUsefulNotice(
        item.resolution,
        today,
        budget
      );
    }

    // 第三轮：仍有余量时，优先给完全没有解析出任何状态的产品继续补。
    for (const item of prepared) {
      if (budget.remaining<=0) break;
      if (item.cached) continue;
      if (resolutionHasAnyData(item.resolution)) continue;

      await parseNextUsefulNotice(
        item.resolution,
        today,
        budget
      );
    }

    // 如果新解析只解决了一部分渠道，可从该产品旧版“官方公告缓存”
    // 补未知渠道；绝不从第三方额度源补。
    for (const item of prepared) {
      if (item.cached) continue;

      const old=item.oldCached?.state?.shareStates;
      if (Array.isArray(old)) {
        const oldMap=new Map(old.map(s=>[s.code,s]));
        for (const s of item.resolution.shareStates) {
          const prev=oldMap.get(s.code);
          if (!prev) continue;

          if (
            s.agency.state==="unknown" &&
            prev.agency?.state &&
            prev.agency.state!=="unknown"
          ) {
            s.agency=prev.agency;
          }
          if (
            s.direct.state==="unknown" &&
            prev.direct?.state &&
            prev.direct.state!=="unknown"
          ) {
            s.direct=prev.direct;
          }
        }
      }

      await saveJsonCache(
        item.cacheKey,
        {
          cachedAt:new Date().toISOString(),
          fingerprint:item.resolution.fingerprint,
          state:serializeResolution(item.resolution)
        },
        60*24*3600
      );
    }

    const rows=resultRowsFromResolutions(
      prepared,
      today
    );

    const resolvedProductSet=new Set(
      rows
        .filter(r=>r.status!=="missing")
        .map(r=>OTC_PRODUCT_MAP.get(r.code)?.mainCode)
        .filter(Boolean)
    );

    const announcementDates=rows
      .map(r=>r.announcementDate)
      .filter(Boolean)
      .sort();

    const result={
      generatedAt:new Date().toISOString(),
      checkDate:today,
      quotaDate:announcementDates.length
        ?announcementDates[announcementDates.length-1]
        :null,
      latestAnnouncementDate:announcementDates.length
        ?announcementDates[announcementDates.length-1]
        :null,
      resolvedProducts:resolvedProductSet.size,
      productTotal:OTC_PRODUCTS.length,
      matched:rows.filter(r=>r.status!=="missing").length,
      total:OTC_CNY_META.length,
      announcementContentFetches:31-budget.remaining,
      source:"基金管理人公告",
      transport:"东方财富/天天基金公告接口",
      sourceUrl:"https://fund.eastmoney.com/gonggao/",
      rows,
      summary:{
        limited:rows.filter(r=>r.status==="limited").length,
        suspended:rows.filter(r=>r.status==="suspended").length,
        open:rows.filter(r=>r.status==="open").length,
        mixed:rows.filter(r=>r.status==="mixed").length,
        directExplicit:rows.filter(
          r=>hasFiniteValue(r.directLimit)
        ).length,
        directHigher:rows.filter(
          r=>hasFiniteValue(r.directLimit) &&
             hasFiniteValue(r.agencyLimit) &&
             Number(r.directLimit)>Number(r.agencyLimit)
        ).length
      }
    };

    if (resolvedProductSet.size>=12) {
      await saveJsonCache(
        OTC_LAST_GOOD_CACHE_URL,
        {...result,cachedAt:new Date().toISOString()},
        30*24*3600
      );
    }

    await saveJsonCache(
      OTC_RESULT_CACHE_URL,
      {...result,cachedAt:new Date().toISOString()},
      36*3600
    );

    return result;
  } catch(e) {
    const cached=await loadOtcLastGood();
    if (cached) {
      return {
        ...cached,
        generatedAt:new Date().toISOString(),
        checkDate:today,
        servedFromLastGood:true,
        upstreamError:e?.message||String(e),
        rows:(cached.rows||[]).map(r=>({
          ...r,
          dataStatus:"cached"
        }))
      };
    }
    throw e;
  }
}

function flatSection(flat, startLabel, endLabels) {
  const start = flat.indexOf(startLabel);
  if (start < 0) return "";
  let end = flat.length;
  for (const label of endLabels) {
    const p = flat.indexOf(label,start+startLabel.length);
    if (p >= 0 && p < end) end = p;
  }
  return flat.slice(start,end).trim();
}

async function getOtcFeeDetails(code) {
  if (!OTC_CODES.has(code)) throw new Error("Unsupported OTC fund code");

  const cacheKey = OTC_FEE_CACHE_PREFIX+code;
  const cached = await loadTimedJsonCache(cacheKey,12*3600*1000);
  if (cached) return {...cached,servedFromWorkerCache:true};

  const meta = OTC_META_MAP.get(code);
  const sourceUrl = `https://fundf10.eastmoney.com/jjfl_${code}.html`;
  const html = await fetchText(sourceUrl,10000);
  const flat = stripHtml(html);

  const management = numberOf((flat.match(/管理费率\s*([0-9.]+)%/)||[])[1]);
  const custody = numberOf((flat.match(/托管费率\s*([0-9.]+)%/)||[])[1]);
  const service = numberOf((flat.match(/销售服务费率\s*([0-9.]+)%/)||[])[1]);
  const currentPurchase = numberOf((flat.match(/购买手续费[:：]?\s*([0-9.]+)%/)||[])[1]);
  const dailyLimitMatch =
    flat.match(/日累计申购限额\s*([0-9,.]+)\s*(美元|人民币元|元)/);
  const dailyLimit =
    numberOf((dailyLimitMatch||[])[1]);
  const dailyLimitUnit =
    (dailyLimitMatch||[])[2]||null;

  let purchaseSection = flatSection(flat,"申购费率",["友情提示","赎回费率"]);
  purchaseSection = purchaseSection
    .replace(/^申购费率\s*/,"")
    .replace(/\s+/g," ")
    .trim();
  if (purchaseSection.length > 520) purchaseSection = purchaseSection.slice(0,520)+"…";

  const result = {
    cachedAt:new Date().toISOString(),
    code,
    name:meta.name,
    company:meta.company,
    share:meta.share,
    source:"天天基金/东方财富Choice",
    sourceUrl,
    managementFee:management ?? meta.managementFee,
    custodyFee:custody ?? meta.custodyFee,
    serviceFee:service ?? meta.serviceFee,
    annualFee:+((management ?? meta.managementFee)+(custody ?? meta.custodyFee)+(service ?? meta.serviceFee)).toFixed(2),
    currentPurchaseFee:currentPurchase,
    eastmoneyDailyLimit:dailyLimit,
    eastmoneyDailyLimitUnit:dailyLimitUnit,
    purchaseFeeText:purchaseSection || "页面未解析到申购费率表，请以基金公司/销售渠道最终页面为准。"
  };

  await saveJsonCache(cacheKey,result,12*3600);
  return result;
}



function parseUsdFundPageStatus(
  html
) {
  const flat=stripHtml(html);

  const statusMatch=flat.match(
    /交易状态[:：]?\s*(暂停申购|开放申购|限大额|封闭期|封闭)/
  );

  const rawStatus=
    statusMatch?.[1]||null;

  if(
    rawStatus==="暂停申购" ||
    rawStatus==="封闭期" ||
    rawStatus==="封闭" ||
    /该基金暂不开放购买/.test(flat)
  ){
    return {
      status:"suspended",
      statusLabel:
        rawStatus==="封闭期" ||
        rawStatus==="封闭"
          ?"封闭期"
          :"暂停申购"
    };
  }

  if(rawStatus==="限大额"){
    return {
      status:"limited",
      statusLabel:"限大额"
    };
  }

  if(rawStatus==="开放申购"){
    return {
      status:"open",
      statusLabel:"开放申购"
    };
  }

  return {
    status:"missing",
    statusLabel:"状态未解析"
  };
}


function allProductCodesForUsd(
  mainCode
){
  const cny=
    OTC_PRODUCTS.find(
      p=>p.mainCode===mainCode
    );

  const usd=
    OTC_USD_PRODUCTS.find(
      p=>p.mainCode===mainCode
    );

  return [
    ...(usd?.shares||[]),
    ...(cny?.shares||[])
  ];
}

function orderedCodesInNotice(
  text,
  mainCode
){
  const known=
    new Set(
      allProductCodesForUsd(
        mainCode
      )
    );

  const source=
    normalizeNoticeText(text);

  const heading=
    source.match(
      /交\s*易\s*代\s*码/
    );

  const pos=
    heading?.index??-1;

  const scope=
    pos>=0
      ?source.slice(
          pos,
          pos+1800
        )
      :source.slice(0,2200);

  const out=[];

  for(
    const m of scope.matchAll(
      /\b(\d{6})\b/g
    )
  ){
    const code=m[1];

    if(
      known.has(code) &&
      !out.includes(code)
    ){
      out.push(code);
    }
  }

  return out;
}


function tokensAfterHeading(
  text,
  headingRegex,
  stopRegex,
  tokenRegex,
  maxChars=1000
){
  const source=
    normalizeNoticeText(text);

  const m=
    source.match(headingRegex);

  if(!m || m.index===undefined){
    return [];
  }

  let tail=
    source.slice(
      m.index+m[0].length,
      m.index+m[0].length+
        maxChars
    );

  if(stopRegex){
    const stop=tail.search(
      stopRegex
    );

    if(stop>=0){
      tail=tail.slice(0,stop);
    }
  }

  const out=[];

  for(
    const tm of tail.matchAll(
      tokenRegex
    )
  ){
    out.push(
      String(
        tm[1]??tm[0]
      ).trim()
    );
  }

  return out;
}

function shareFlagMapFromNotice(
  text,
  codeOrder
){
  const flags=
    tokensAfterHeading(
      text,
      /(?:该\s*)?(?:分\s*级\s*基金|基金份额)?\s*是\s*否\s*暂\s*停(?:\s*大\s*额)?\s*申\s*购[^是|否|-]{0,180}/,
      /限\s*制\s*申\s*购\s*金\s*额|限制申购金额|2\./,
      /(?:^|\s)(是|否|-)(?=\s|$)/g,
      1000
    );

  const map=new Map();

  codeOrder.forEach(
    (code,i)=>{
      if(flags[i]!==undefined){
        map.set(
          code,
          flags[i]
        );
      }
    }
  );

  return map;
}


function shareLimitMapFromNotice(
  text,
  codeOrder
){
  const source=
    normalizeNoticeText(text);

  const map=new Map();

  const heading=
    source.match(
      /(?:下\s*属\s*分\s*级\s*基\s*金\s*的|下\s*属\s*基\s*金\s*份\s*额\s*的)?\s*限\s*制\s*申\s*购\s*金\s*额/
    );

  // Layout A:
  // 限制申购金额 1美元 10元 1美元 ...
  if(
    heading &&
    heading.index!==undefined
  ){
    let tail=
      source.slice(
        heading.index+
        heading[0].length,
        heading.index+
        heading[0].length+
        1400
      );

    const stop=
      tail.search(
        /(?:下\s*属\s*分\s*级\s*基\s*金\s*的|下\s*属\s*基\s*金\s*份\s*额\s*的)?\s*限\s*制\s*(?:定\s*期\s*定\s*额|转\s*换\s*转\s*入)|2\.\s*其他/
      );

    if(stop>=0){
      tail=tail.slice(0,stop);
    }

    const combined=[];

    for(
      const tm of tail.matchAll(
        /([0-9][0-9,.]*)\s*(美元|人民币元|元)/g
      )
    ){
      combined.push({
        value:
          parseYuanNumber(
            tm[1]
          ),
        unit:tm[2],
        raw:tm[0]
      });
    }

    if(
      combined.length>=
      codeOrder.length
    ){
      codeOrder.forEach(
        (code,i)=>{
          map.set(
            code,
            combined[i]
          );
        }
      );

      return map;
    }
  }

  // Layout B:
  // 金额单位 人民币元 人民币元 美元 美元
  // 限制申购金额 10.00 10.00 2.00 2.00
  const unitHeading=
    source.match(
      /金额单位/
    );

  if(
    unitHeading &&
    unitHeading.index!==undefined &&
    heading &&
    heading.index!==undefined &&
    unitHeading.index<
      heading.index
  ){
    const unitText=
      source.slice(
        unitHeading.index+
        unitHeading[0].length,
        heading.index
      );

    const units=[
      ...unitText.matchAll(
        /人民币元|美元|(?<!人民币)元/g
      )
    ].map(
      m=>m[0]
    );

    let amountText=
      source.slice(
        heading.index+
        heading[0].length,
        heading.index+
        heading[0].length+
        1000
      );

    const stop=
      amountText.search(
        /(?:下属分级基金的|下属基金份额的)?限制(?:定期定额|转换转入)|2\.\s*其他/
      );

    if(stop>=0){
      amountText=
        amountText.slice(
          0,
          stop
        );
    }

    const values=[
      ...amountText.matchAll(
        /(?:^|\s)([0-9][0-9,.]*)(?=\s|$)/g
      )
    ].map(
      m=>parseYuanNumber(
        m[1]
      )
    ).filter(
      hasFiniteValue
    );

    if(
      units.length>=
        codeOrder.length &&
      values.length>=
        codeOrder.length
    ){
      codeOrder.forEach(
        (code,i)=>{
          map.set(
            code,
            {
              value:values[i],
              unit:units[i],
              raw:
                `${values[i]}${units[i]}`
            }
          );
        }
      );

      return map;
    }
  }

  // Layout C:
  // 限制...金额（单位：美元）
  // 016056 15 / 016058 15
  const usdRowMatch=
    source.match(
      /限制[^。；]{0,120}?金额\s*[（(]单位[:：]?\s*美元[）)]/
    );

  if(
    usdRowMatch &&
    usdRowMatch.index!==undefined
  ){
    const usdTail=
      source.slice(
        usdRowMatch.index+
        usdRowMatch[0].length,
        usdRowMatch.index+
        usdRowMatch[0].length+
        900
      );

    for(const code of codeOrder){
      const meta=
        OTC_META_MAP.get(code);

      if(
        !meta ||
        meta.currency!=="USD"
      ){
        continue;
      }

      const escaped=
        code.replace(
          /[.*+?^${}()|[\]\\]/g,
          "\\$&"
        );

      const m=
        usdTail.match(
          new RegExp(
            `${escaped}[^0-9]{0,50}([0-9][0-9,.]*)`
          )
        );

      if(m){
        const value=
          parseYuanNumber(
            m[1]
          );

        if(
          hasFiniteValue(value)
        ){
          map.set(
            code,
            {
              value,
              unit:"美元",
              raw:
                `${value}美元`
            }
          );
        }
      }
    }

    if(map.size){
      return map;
    }
  }

  return map;
}

function genericUsdLimitFromNotice(
  text
){
  const source=
    normalizeNoticeText(text);

  const patterns=[
    /美元(?:现汇|现钞)?(?:基金)?份额[^。；]{0,260}?(?:不应超过|应不超过|不得超过|限制金额为|业务限额为|限额为)\s*([0-9][0-9,.]*)\s*美元/i,
    /美元[^。；]{0,160}?份额[^。；]{0,260}?(?:限额|限制金额)[^0-9]{0,40}([0-9][0-9,.]*)\s*美元/i,
    /限制金额为\s*([0-9][0-9,.]*)\s*美元[^。；]{0,260}?美元(?:现汇|现钞|份额)/i,
    /本基金美元(?:现汇|现钞)?基金份额[^。；]{0,300}?累计金额(?:应)?不超过\s*([0-9][0-9,.]*)\s*美元/i,
    /美元(?:现汇|现钞)[^。；]{0,260}?(?:不应超过|应不超过|不得超过)\s*([0-9][0-9,.]*)\s*美元/i
  ];

  for(const p of patterns){
    const m=
      source.match(p);

    if(!m)continue;

    const value=
      parseYuanNumber(
        m[1]
      );

    if(
      hasFiniteValue(value)
    ){
      return value;
    }
  }

  return null;
}



function usdAmountNumber(
  raw,
  wanFlag
){
  const n=
    parseYuanNumber(raw);

  if(!hasFiniteValue(n)){
    return null;
  }

  return Number(n)*
    (wanFlag?10000:1);
}

function extractUsdChannelLimit(
  text,
  channel
){
  const source=
    normalizeNoticeText(text);

  const channelPatterns=
    channel==="direct"
      ?[
          /(?:本公司\s*)?(?:直\s*销\s*渠\s*道|直\s*销\s*机\s*构|直\s*销\s*柜\s*台|网上直销)[^。；]{0,900}?美元(?:现汇|现钞)?(?:基金)?份额[^。；]{0,320}?(?:累计金额)?(?:应)?不超过\s*([0-9][0-9,.]*)\s*(万)?\s*美元/i,
          /(?:本公司\s*)?(?:直\s*销\s*渠\s*道|直\s*销\s*机\s*构|直\s*销\s*柜\s*台)[^。；]{0,900}?美元[^。；]{0,320}?(?:限额|限制金额|上限)(?:为|调整为)?\s*([0-9][0-9,.]*)\s*(万)?\s*美元/i
        ]
      :[
          /(?:各\s*代\s*销\s*机\s*构|代\s*销\s*机\s*构|代\s*销\s*渠\s*道)[^。；]{0,900}?美元(?:现汇|现钞)?(?:基金)?份额[^。；]{0,320}?(?:累计金额)?(?:应)?不超过\s*([0-9][0-9,.]*)\s*(万)?\s*美元/i,
          /(?:各\s*代\s*销\s*机\s*构|代\s*销\s*机\s*构|代\s*销\s*渠\s*道)[^。；]{0,900}?美元[^。；]{0,320}?(?:限额|限制金额|上限)(?:为|调整为)?\s*([0-9][0-9,.]*)\s*(万)?\s*美元/i
        ];

  for(const p of channelPatterns){
    const m=source.match(p);
    if(!m)continue;

    const n=
      usdAmountNumber(
        m[1],
        Boolean(m[2])
      );

    if(hasFiniteValue(n)){
      return n;
    }
  }

  return null;
}

function explicitUsdSuspendFromNotice(
  text
){
  const source=
    normalizeNoticeText(text);

  return (
    /美元(?:现钞|现汇)[^。；]{0,260}?(?:仍)?暂停申购/.test(
      source
    ) ||
    /美元(?:现钞|现汇)[^。；]{0,220}?份额[^。；]{0,220}?暂停申购/.test(
      source
    ) ||
    /美元份额[^。；]{0,260}?(?:仍)?暂停申购/.test(
      source
    )
  );
}

function broadFullSuspendFromNotice(
  title,
  text
){
  const t=
    normalizeNoticeText(title);

  const source=
    normalizeNoticeText(text);

  if(
    !(
      /暂停申购/.test(t) &&
      !/暂停大额申购/.test(t)
    )
  ){
    return false;
  }

  // 明确只针对人民币的公告不能扩散到美元份额。
  if(
    /仅[^。；]{0,80}人民币/.test(source) ||
    /本次[^。；]{0,120}仅针对[^。；]{0,80}人民币/.test(source)
  ){
    return false;
  }

  return (
    /本基金[^。；]{0,100}?暂停申购/.test(source) ||
    /暂停申购(?:及|、|\(|（|业务)/.test(t)
  );
}

function parseUsdOfficialNotice(
  notice,
  text,
  mainCode,
  today
){
  const title=
    normalizeNoticeText(
      notice.title
    );

  const full=
    `${title} ${normalizeNoticeText(text)}`;

  const dates=
    parseNoticeDates(
      title,
      full,
      notice.publishDate
    );

  const parsedForTime={
    effectiveDate:
      dates.effectiveDate,
    resumeDate:
      dates.resumeDate,
    temporaryDate:
      dates.temporaryDate,
    isHoliday:
      /节假日|境外主要投资场所/.test(
        title
      ),
    publishDate:
      notice.publishDate
  };

  if(
    !noticeApplicable(
      parsedForTime,
      today
    )
  ){
    return null;
  }

  const codeOrder=
    orderedCodesInNotice(
      full,
      mainCode
    );

  const flags=
    shareFlagMapFromNotice(
      full,
      codeOrder
    );

  const limits=
    shareLimitMapFromNotice(
      full,
      codeOrder
    );

  const usdAgencyLimit=
    extractUsdChannelLimit(
      full,
      "agency"
    );

  const usdDirectLimit=
    extractUsdChannelLimit(
      full,
      "direct"
    );

  const explicitUsdSuspend=
    explicitUsdSuspendFromNotice(
      full
    );

  const broadFullSuspend=
    broadFullSuspendFromNotice(
      title,
      full
    );

  const isRecovery=
    /恢复(?:正常)?(?:大额)?申购/.test(
      title
    );

  const isFullSuspend=
    (
      /暂停申购/.test(title) &&
      !/暂停大额申购/.test(title)
    ) ||
    (
      /暂停(?:办理)?申购/.test(full) &&
      !/大额申购/.test(title) &&
      /暂停申购(?:及|、|业务)/.test(
        title
      )
    );

  const isLimited=
    /(?:暂停|限制|调整).*大额申购/.test(
      title
    ) ||
    /大额申购.*(?:暂停|限制|调整)/.test(
      title
    );

  return {
    id:notice.id,
    title:notice.title,
    publishDate:
      notice.publishDate,
    effectiveDate:
      dates.effectiveDate,
    scope:
      notice.scope||
      noticeScope(title),
    announcementUrl:
      noticePdfUrl(
        notice.id
      ),
    codeOrder,
    flags,
    limits,
    usdAgencyLimit,
    usdDirectLimit,
    explicitUsdSuspend,
    broadFullSuspend,
    genericUsdLimit:
      genericUsdLimitFromNotice(
        full
      ),
    isRecovery,
    isFullSuspend,
    isLimited
  };
}

function usdNoticeAffectsCode(
  parsed,
  code
){
  if(!parsed)return false;

  const meta=
    OTC_META_MAP.get(code);

  if(
    meta?.currency==="USD" &&
    (
      parsed.explicitUsdSuspend ||
      parsed.broadFullSuspend
    )
  ){
    return true;
  }

  if(
    parsed.codeOrder?.length &&
    !parsed.codeOrder.includes(code)
  ){
    return false;
  }

  const flag=
    parsed.flags?.get(code);

  if(
    flag==="-" ||
    flag==="否"
  ){
    return false;
  }

  return true;
}


function applyUsdNoticeToRow(
  state,
  parsed,
  code
){
  if(
    !usdNoticeAffectsCode(
      parsed,
      code
    )
  ){
    return;
  }

  const meta=
    OTC_META_MAP.get(code);

  if(
    !meta ||
    meta.currency!=="USD"
  ){
    return;
  }

  const limit=
    parsed.limits?.get(code);

  const tableUsdLimit=
    limit &&
    limit.unit==="美元" &&
    hasFiniteValue(
      limit.value
    )
      ?Number(limit.value)
      :null;

  const genericUsdLimit=
    hasFiniteValue(
      parsed.genericUsdLimit
    )
      ?Number(
          parsed.genericUsdLimit
        )
      :null;

  const explicitAgencyLimit=
    hasFiniteValue(
      parsed.usdAgencyLimit
    )
      ?Number(
          parsed.usdAgencyLimit
        )
      :null;

  const explicitDirectLimit=
    hasFiniteValue(
      parsed.usdDirectLimit
    )
      ?Number(
          parsed.usdDirectLimit
        )
      :null;

  const applyChannel=(
    channel,
    nextState,
    nextLimit=null
  )=>{
    state[
      channel+"State"
    ]=nextState;

    state[
      channel+"Limit"
    ]=
      nextState==="limited" &&
      hasFiniteValue(nextLimit)
        ?Number(nextLimit)
        :null;
  };

  // 华安等公告可能正文明确说明美元份额继续暂停，
  // 即使本次公告表格只列人民币份额，也应覆盖美元状态。
  if(
    parsed.explicitUsdSuspend ||
    parsed.broadFullSuspend
  ){
    const scope=
      parsed.scope||"general";

    if(scope==="direct"){
      applyChannel(
        "direct",
        "suspended"
      );
    }else if(scope==="agency"){
      applyChannel(
        "agency",
        "suspended"
      );
    }else{
      applyChannel(
        "agency",
        "suspended"
      );
      applyChannel(
        "direct",
        "suspended"
      );
    }

    state.latestOfficial=parsed;
    return;
  }

  // 公告正文分别披露代销 / 直销美元限额时，
  // 必须保留两个渠道各自金额，例如博时：15美元 / 15万美元。
  let appliedExplicitChannel=false;

  if(
    hasFiniteValue(
      explicitAgencyLimit
    )
  ){
    applyChannel(
      "agency",
      "limited",
      explicitAgencyLimit
    );
    appliedExplicitChannel=true;
  }

  if(
    hasFiniteValue(
      explicitDirectLimit
    )
  ){
    applyChannel(
      "direct",
      "limited",
      explicitDirectLimit
    );
    appliedExplicitChannel=true;
  }

  if(appliedExplicitChannel){
    // 如果只披露一个渠道，另一个渠道仍允许后续 table/general 逻辑补齐。
    const fallback=
      hasFiniteValue(
        tableUsdLimit
      )
        ?tableUsdLimit
        :hasFiniteValue(
            genericUsdLimit
          )
          ?genericUsdLimit
          :null;

    if(
      !hasFiniteValue(
        explicitAgencyLimit
      ) &&
      hasFiniteValue(fallback)
    ){
      applyChannel(
        "agency",
        "limited",
        fallback
      );
    }

    if(
      !hasFiniteValue(
        explicitDirectLimit
      ) &&
      hasFiniteValue(fallback)
    ){
      applyChannel(
        "direct",
        "limited",
        fallback
      );
    }

    state.latestOfficial=parsed;
    return;
  }

  let nextState=null;
  let nextLimit=null;

  if(
    hasFiniteValue(
      tableUsdLimit
    )
  ){
    nextState="limited";
    nextLimit=
      tableUsdLimit;
  }else if(
    hasFiniteValue(
      genericUsdLimit
    ) &&
    parsed.isLimited
  ){
    nextState="limited";
    nextLimit=
      genericUsdLimit;
  }else if(parsed.isRecovery){
    nextState="open";
  }else if(parsed.isFullSuspend){
    nextState="suspended";
  }else if(parsed.isLimited){
    nextState="limited";
  }else{
    return;
  }

  const scope=
    parsed.scope||"general";

  if(scope==="direct"){
    applyChannel(
      "direct",
      nextState,
      nextLimit
    );
  }else if(scope==="agency"){
    applyChannel(
      "agency",
      nextState,
      nextLimit
    );
  }else{
    applyChannel(
      "agency",
      nextState,
      nextLimit
    );
    applyChannel(
      "direct",
      nextState,
      nextLimit
    );
  }

  state.latestOfficial=parsed;
}


function finalizeUsdOfficialState(
  meta,
  state,
  today
){
  const agencyState=
    state.agencyState;
  const directState=
    state.directState;

  const agencyLimit=
    state.agencyLimit;
  const directLimit=
    state.directLimit;

  let status="missing";
  let statusLabel=
    "公告状态未解析";

  if(
    agencyState==="suspended" &&
    directState==="suspended"
  ){
    status="suspended";
    statusLabel="暂停申购";
  }else if(
    agencyState==="limited" ||
    directState==="limited"
  ){
    status="limited";
    statusLabel="限大额";
  }else if(
    agencyState==="open" &&
    directState==="open"
  ){
    status="open";
    statusLabel="开放申购";
  }

  const bestLimit=
    hasFiniteValue(
      agencyLimit
    )
      ?agencyLimit
      :hasFiniteValue(
          directLimit
        )
        ?directLimit
        :null;

  const latest=
    state.latestOfficial;

  return {
    ...meta,
    status,
    statusLabel,
    agencyLimit:
      hasFiniteValue(
        agencyLimit
      )
        ?agencyLimit
        :null,
    directLimit:
      hasFiniteValue(
        directLimit
      )
        ?directLimit
        :null,
    agencyState,
    directState,
    directInferredFromAgency:false,
    limitText:
      hasFiniteValue(bestLimit)
        ?`${bestLimit}美元/日`
        :statusLabel,
    channelText:
      "美元份额按基金管理人公告解析；人民币与美元额度独立处理",
    announcementText:
      latest?.title||"—",
    sourceAnnouncementUrl:
      latest?.announcementUrl||null,
    latestOfficialAnnouncementUrl:
      latest?.announcementUrl||null,
    verificationAnnouncementUrl:
      latest?.announcementUrl||null,
    verificationAnnouncementId:
      latest?.id||null,
    verificationAnnouncementTitle:
      latest?.title||null,
    verificationAnnouncementDate:
      latest?.publishDate||null,
    verificationEffectiveDate:
      latest?.effectiveDate||null,
    latestOfficialAnnouncementId:
      latest?.id||null,
    latestOfficialAnnouncementTitle:
      latest?.title||null,
    latestOfficialAnnouncementDate:
      latest?.publishDate||null,
    latestOfficialEffectiveDate:
      latest?.effectiveDate||null,
    latestOfficialTiming:
      latest
        ?"effective"
        :"none",
    currentVerificationStatus:
      latest
        ?"match"
        :"unverified",
    currentVerificationLabel:
      latest
        ?"官方公告"
        :"未验证",
    verificationStatus:
      latest
        ?"match"
        :"unverified",
    verificationLabel:
      latest
        ?"官方公告"
        :"未验证",
    anxinVerification:
      "美元份额",
    quotaDate:today,
    checkDate:today,
    source:
      "基金管理人公告",
    sourceUrl:
      latest?.announcementUrl||
      `https://fund.eastmoney.com/${meta.code}.html`,
    dataStatus:
      latest
        ?"fresh"
        :"missing"
  };
}

async function fetchUsdOfficialProduct(
  product,
  today
){
  const notices=
    await fetchAnnouncementList(
      product.mainCode,
      1,
      100
    );

  // 年度节假日已在列表过滤器中排除。
  // 每个产品最多读取4篇：
  // 2篇最近公告 + 1篇较早一般公告 + 1篇最近完整暂停公告。
  // 1次列表 + 最多4篇正文，美元侧最多约5个上游请求。
  const chosen=
    notices.slice(0,2);

  const addUnique=
    notice=>{
      if(
        notice &&
        !chosen.some(
          x=>x.id===notice.id
        ) &&
        chosen.length<4
      ){
        chosen.push(notice);
      }
    };

  const olderGeneral=
    notices.find(
      n=>
        !chosen.some(
          x=>x.id===n.id
        ) &&
        !/人民币/.test(
          n.title||""
        ) &&
        !/直销电子交易平台|直销机构|代销机构/.test(
          n.title||""
        ) &&
        /暂停申购|恢复申购|大额申购|限制申购|调整.*申购/.test(
          n.title||""
        )
    );

  addUnique(
    olderGeneral
  );

  const latestFullSuspend=
    notices.find(
      n=>
        !chosen.some(
          x=>x.id===n.id
        ) &&
        /暂停申购/.test(
          n.title||""
        ) &&
        !/暂停大额申购/.test(
          n.title||""
        ) &&
        !isAnnualHolidaySchedule(
          n.title||""
        )
    );

  addUnique(
    latestFullSuspend
  );

  const parsed=[];

  for(const notice of chosen){
    try{
      const text=
        await fetchAnnouncementContent(
          notice.id
        );

      const p=
        parseUsdOfficialNotice(
          notice,
          text,
          product.mainCode,
          today
        );

      if(p){
        parsed.push(p);
      }
    }catch(_){}
  }

  // 旧 -> 新顺序应用，使最新公告覆盖旧状态。
  parsed.sort(
    (a,b)=>
      String(
        a.effectiveDate||
        a.publishDate||
        ""
      ).localeCompare(
        String(
          b.effectiveDate||
          b.publishDate||
          ""
        )
      )
  );

  const out=[];

  for(
    const code of product.shares
  ){
    const meta=
      OTC_META_MAP.get(code);

    if(!meta)continue;

    const state={
      agencyState:"unknown",
      directState:"unknown",
      agencyLimit:null,
      directLimit:null,
      latestOfficial:null
    };

    for(const p of parsed){
      applyUsdNoticeToRow(
        state,
        p,
        code
      );
    }

    out.push(
      finalizeUsdOfficialState(
        meta,
        state,
        today
      )
    );
  }

  return out;
}

async function fetchUsdFundSnapshot(
  meta
) {
  const today=
    shanghaiNowParts().date;

  const sourceUrl=
    `https://fund.eastmoney.com/${meta.code}.html`;

  const html=
    await fetchText(
      sourceUrl,
      10000
    );

  const parsed=
    parseUsdFundPageStatus(
      html
    );

  let dailyLimit=null;
  let dailyLimitUnit=null;

  // 已暂停/封闭时无需再额外请求费率页来找额度。
  if(
    parsed.status!=="suspended"
  ){
    try{
      const fee=
        await getOtcFeeDetails(
          meta.code
        );

      dailyLimitUnit=
        fee.eastmoneyDailyLimitUnit;

      // 美元份额只接受明确标注“美元”的限额，
      // 绝不把“元”数字直接当作美元额度。
      if(
        dailyLimitUnit==="美元" &&
        hasFiniteValue(
          fee.eastmoneyDailyLimit
        )
      ){
        dailyLimit=
          Number(
            fee.eastmoneyDailyLimit
          );
      }
    }catch(_){}
  }

  let status=parsed.status;
  let statusLabel=parsed.statusLabel;
  let agencyState="unknown";
  let directState="unknown";

  if(status==="suspended"){
    agencyState="suspended";
    directState="suspended";
  }else if(hasFiniteValue(dailyLimit)){
    status="limited";
    statusLabel="限大额";
    agencyState="limited";
    directState="limited";
  }else if(status==="open"){
    agencyState="open";
    directState="open";
  }else if(status==="limited"){
    agencyState="limited";
    directState="limited";
  }

  const limitText=
    hasFiniteValue(dailyLimit)
      ?`${dailyLimit}美元/日`
      :status==="suspended"
        ?statusLabel
        :"美元限额未明确披露";

  const channelText=
    hasFiniteValue(dailyLimit)
      ?"已明确识别美元申购限额；直销未单独披露时按相同额度展示"
      :"当前仅核验美元份额申购状态；未识别到明确美元限额时不推算";

  return {
    ...meta,
    mainCode:
      meta.mainCode||null,
    status,
    statusLabel,
    agencyLimit:
      hasFiniteValue(dailyLimit)
        ?dailyLimit
        :null,
    directLimit:
      hasFiniteValue(dailyLimit)
        ?dailyLimit
        :null,
    agencyState,
    directState,
    directInferredFromAgency:
      hasFiniteValue(dailyLimit),
    limitText,
    channelText,
    announcementText:"—",
    sourceAnnouncementUrl:null,
    latestOfficialAnnouncementUrl:null,
    verificationAnnouncementUrl:null,
    verificationAnnouncementId:null,
    verificationAnnouncementTitle:null,
    verificationAnnouncementDate:null,
    verificationEffectiveDate:null,
    latestOfficialAnnouncementId:null,
    latestOfficialAnnouncementTitle:null,
    latestOfficialAnnouncementDate:null,
    latestOfficialEffectiveDate:null,
    latestOfficialTiming:"none",
    currentVerificationStatus:
      "unverified",
    currentVerificationLabel:
      "状态核验",
    verificationStatus:
      "unverified",
    verificationLabel:
      "状态核验",
    anxinVerification:
      "美元份额",
    quotaDate:today,
    checkDate:today,
    source:
      "天天基金/东方财富基金当前状态页",
    sourceUrl,
    dataStatus:"fresh"
  };
}

async function loadUsdLastGood(){
  return await loadTimedJsonCache(
    OTC_USD_LAST_GOOD_CACHE_URL,
    7*24*3600*1000
  );
}

async function buildOtcUsdFunds({
  forceRefresh=false
}={}) {
  if(!forceRefresh){
    const cached=
      await loadTimedJsonCache(
        OTC_USD_RESULT_CACHE_URL,
        15*60*1000
      );

    if(cached){
      return {
        ...cached,
        servedFromWorkerCache:true
      };
    }
  }

  const today=
    shanghaiNowParts().date;

  try{
    const groups=
      await mapLimit(
        OTC_USD_PRODUCTS,
        3,
        async product=>{
          try{
            return await fetchUsdOfficialProduct(
              product,
              today
            );
          }catch(e){
            return product.shares.map(
              code=>{
                const meta=
                  OTC_META_MAP.get(code);

                return {
                  ...meta,
                  status:"missing",
                  statusLabel:
                    "公告读取失败",
                  agencyLimit:null,
                  directLimit:null,
                  agencyState:"unknown",
                  directState:"unknown",
                  directInferredFromAgency:false,
                  limitText:
                    "公告读取失败",
                  channelText:"—",
                  announcementText:"—",
                  sourceAnnouncementUrl:null,
                  latestOfficialAnnouncementUrl:null,
                  verificationAnnouncementUrl:null,
                  currentVerificationStatus:
                    "unverified",
                  currentVerificationLabel:
                    "未验证",
                  verificationStatus:
                    "unverified",
                  verificationLabel:
                    "未验证",
                  anxinVerification:
                    "美元份额",
                  quotaDate:today,
                  checkDate:today,
                  source:
                    "基金管理人公告",
                  sourceUrl:
                    `https://fund.eastmoney.com/${code}.html`,
                  dataStatus:"missing",
                  error:
                    e?.message||String(e)
                };
              }
            );
          }
        }
      );

    const rows=
      groups.flat();

    const result={
      generatedAt:
        new Date().toISOString(),
      checkDate:today,
      quotaDate:today,
      matched:rows.filter(
        r=>r.status!=="missing"
      ).length,
      total:OTC_USD_META.length,
      source:
        "基金管理人公告",
      rows,
      summary:{
        limited:rows.filter(
          r=>r.status==="limited"
        ).length,
        suspended:rows.filter(
          r=>r.status==="suspended"
        ).length,
        open:rows.filter(
          r=>r.status==="open"
        ).length,
        unverified:rows.filter(
          r=>r.status==="missing"
        ).length
      }
    };

    if(result.matched>=1){
      await saveJsonCache(
        OTC_USD_LAST_GOOD_CACHE_URL,
        {
          ...result,
          cachedAt:
            new Date().toISOString()
        },
        7*24*3600
      );
    }

    await saveJsonCache(
      OTC_USD_RESULT_CACHE_URL,
      {
        ...result,
        cachedAt:
          new Date().toISOString()
      },
      15*60
    );

    return result;
  }catch(e){
    const old=
      await loadUsdLastGood();

    if(old){
      return {
        ...old,
        generatedAt:
          new Date().toISOString(),
        servedFromLastGood:true,
        upstreamError:
          e?.message||String(e),
        rows:(old.rows||[]).map(
          r=>({
            ...r,
            dataStatus:"cached"
          })
        )
      };
    }

    throw e;
  }
}


function parseFundNetWorthScript(code,js,includeHistory=false) {
  const m = js.match(
    /var\s+Data_netWorthTrend\s*=\s*(\[[\s\S]*?\]);/
  );
  if (!m) throw new Error("Net-worth trend not found");

  let arr;
  try {
    arr = JSON.parse(m[1]);
  } catch (_) {
    throw new Error("Net-worth trend parse failed");
  }

  if (!Array.isArray(arr) || !arr.length) {
    throw new Error("Net-worth trend empty");
  }

  const byYear = new Map();
  const history = [];
  let latestNav = null;
  let latestNavDate = null;
  let latestDailyReturn = null;

  for (const item of arr) {
    const ts = Number(item?.x);
    if (!Number.isFinite(ts)) continue;

    // Eastmoney 的净值时间戳表示北京时间日期。
    // Worker 运行在 UTC，如果直接 toISOString().slice(0,10)，
    // 会把北京时间 00:00 映射到前一天 UTC，导致净值日期整体早一天。
    // 加 8 小时后再按 UTC 取 YYYY-MM-DD，等价于按 Asia/Shanghai 日期解释。
    const shanghaiDt =
      new Date(ts + 8*60*60*1000);
    const year =
      shanghaiDt.getUTCFullYear();
    const date =
      shanghaiDt.toISOString().slice(0,10);
    const y = Number(item?.y);
    const daily = Number(item?.equityReturn);

    if (!byYear.has(year)) {
      byYear.set(year,{
        year,
        firstNav:null,
        lastNav:null,
        product:1,
        dailyCount:0
      });
    }

    const r = byYear.get(year);

    if (Number.isFinite(y) && y > 0) {
      if (r.firstNav === null) r.firstNav = y;
      r.lastNav = y;
      latestNav = y;
      latestNavDate = date;

      if (
        Number.isFinite(daily) &&
        Math.abs(daily) < 100
      ) {
        latestDailyReturn = daily;
      } else {
        latestDailyReturn = null;
      }

      if (includeHistory) {
        history.push({
          date,
          nav:y,
          dailyReturn:
            Number.isFinite(daily) &&
            Math.abs(daily) < 100
              ?daily
              :null
        });
      }
    }

    if (
      Number.isFinite(daily) &&
      Math.abs(daily) < 100
    ) {
      r.product *= (1 + daily / 100);
      r.dailyCount++;
    }
  }

  const currentYear =
    new Date().getUTCFullYear();

  const years = [...byYear.values()]
    .sort((a,b)=>b.year-a.year)
    .map(r=>{
      let ret = null;
      let method = null;

      if (r.dailyCount > 0) {
        ret = (r.product - 1) * 100;
        method =
          "daily_nav_return_compounded";
      } else if (
        r.firstNav > 0 &&
        r.lastNav > 0
      ) {
        ret =
          (r.lastNav / r.firstNav - 1) *
          100;
        method = "nav_first_last";
      }

      return {
        year:r.year,
        returnPct:ret,
        label:
          r.year===currentYear
            ?"YTD"
            :String(r.year),
        method
      };
    })
    .filter(x=>
      Number.isFinite(x.returnPct)
    );

  return {
    code,
    latestNav,
    latestNavDate,
    latestDailyReturn,
    years,
    history
  };
}


function parseLsjzNavRows(
  code,
  rows,
  includeHistory=false
){
  if(
    !Array.isArray(rows) ||
    !rows.length
  ){
    throw new Error(
      "Historical NAV API empty"
    );
  }

  const sorted=
    rows
      .map(r=>({
        date:
          String(
            r?.FSRQ||""
          ).slice(0,10),
        nav:
          Number(
            String(
              r?.DWJZ??""
            ).replace(/,/g,"")
          ),
        dailyReturn:
          Number(
            String(
              r?.JZZZL??""
            )
              .replace("%","")
              .replace(/,/g,"")
          )
      }))
      .filter(
        r=>
          /^\d{4}-\d{2}-\d{2}$/.test(
            r.date
          ) &&
          Number.isFinite(r.nav) &&
          r.nav>0
      )
      .sort(
        (a,b)=>
          a.date.localeCompare(
            b.date
          )
      );

  if(!sorted.length){
    throw new Error(
      "Historical NAV API no valid rows"
    );
  }

  const byYear=new Map();
  const history=[];

  for(const item of sorted){
    const year=
      Number(
        item.date.slice(0,4)
      );

    if(!byYear.has(year)){
      byYear.set(
        year,
        {
          year,
          firstNav:null,
          lastNav:null,
          product:1,
          dailyCount:0
        }
      );
    }

    const y=
      byYear.get(year);

    if(y.firstNav===null){
      y.firstNav=item.nav;
    }

    y.lastNav=item.nav;

    if(
      Number.isFinite(
        item.dailyReturn
      ) &&
      Math.abs(
        item.dailyReturn
      )<100
    ){
      y.product*=
        1+
        item.dailyReturn/100;

      y.dailyCount++;
    }

    if(includeHistory){
      history.push({
        date:item.date,
        nav:item.nav,
        dailyReturn:
          Number.isFinite(
            item.dailyReturn
          ) &&
          Math.abs(
            item.dailyReturn
          )<100
            ?item.dailyReturn
            :null
      });
    }
  }

  const currentYear=
    new Date(
      Date.now()+
      8*60*60*1000
    ).getUTCFullYear();

  const years=[
    ...byYear.values()
  ]
    .sort(
      (a,b)=>b.year-a.year
    )
    .map(r=>{
      let ret=null;
      let method=null;

      if(r.dailyCount>0){
        ret=
          (r.product-1)*100;
        method=
          "daily_nav_return_compounded";
      }else if(
        r.firstNav>0 &&
        r.lastNav>0
      ){
        ret=
          (
            r.lastNav/
            r.firstNav-
            1
          )*100;
        method=
          "nav_first_last";
      }

      return {
        year:r.year,
        returnPct:ret,
        label:
          r.year===currentYear
            ?"YTD"
            :String(r.year),
        method
      };
    })
    .filter(
      x=>Number.isFinite(
        x.returnPct
      )
    );

  const latest=
    sorted[
      sorted.length-1
    ];

  return {
    code,
    latestNav:
      latest.nav,
    latestNavDate:
      latest.date,
    latestDailyReturn:
      Number.isFinite(
        latest.dailyReturn
      ) &&
      Math.abs(
        latest.dailyReturn
      )<100
        ?latest.dailyReturn
        :null,
    years,
    history
  };
}

async function fetchFundNetWorthFallback(
  code,
  includeHistory=false
){
  const pageSize=
    includeHistory
      ?10000
      :1200;

  const q=
    new URLSearchParams({
      fundCode:code,
      pageIndex:"1",
      pageSize:String(pageSize),
      startDate:"",
      endDate:"",
      _:String(Date.now())
    });

  const url=
    `https://api.fund.eastmoney.com/f10/lsjz?${q.toString()}`;

  const j=
    await fetchJsonWithHeaders(
      url,
      {
        "Referer":
          `https://fundf10.eastmoney.com/jjjz_${code}.html`
      },
      12000
    );

  const rows=
    j?.Data?.LSJZList;

  return parseLsjzNavRows(
    code,
    rows,
    includeHistory
  );
}

async function fetchFundNetWorthData(
  code,
  includeHistory=false
) {
  if (!ALL_FUND_CODES.has(code)) {
    throw new Error(
      "Unsupported fund code"
    );
  }

  const url =
    `https://fund.eastmoney.com/pingzhongdata/${code}.js?v=${Date.now()}`;

  try{
    const js =
      await fetchText(
        url,
        9000
      );

    return parseFundNetWorthScript(
      code,
      js,
      includeHistory
    );
  }catch(primaryError){
    // 某些美元份额（目前主要是 宝盈 019738/019739）
    // pingzhongdata 的 Data_netWorthTrend 为空，但历史净值 API 正常。
    try{
      return await fetchFundNetWorthFallback(
        code,
        includeHistory
      );
    }catch(fallbackError){
      throw new Error(
        `${primaryError?.message||primaryError}; fallback: ${fallbackError?.message||fallbackError}`
      );
    }
  }
}


async function annualPerformance(code) {
  const x = await fetchFundNetWorthData(
    code,
    false
  );

  return {
    code,
    source:"基金净值走势",
    sourceUrl:
      `https://fund.eastmoney.com/${code}.html`,
    latestNav:x.latestNav,
    latestNavDate:x.latestNavDate,
    latestDailyReturn:x.latestDailyReturn,
    years:x.years
  };
}

function otcMetaByCurrency(
  currency
) {
  return currency==="USD"
    ?OTC_USD_META
    :OTC_CNY_META;
}

async function otcNavSummary({
  forceRefresh=false,
  currency="CNY"
}={}) {
  const normalized=
    currency==="USD"
      ?"USD"
      :"CNY";

  const metaList=
    otcMetaByCurrency(
      normalized
    );

  const cacheKey=
    OTC_NAV_SUMMARY_CACHE_PREFIX+
    normalized;

  if (!forceRefresh) {
    const cached =
      await loadTimedJsonCache(
        cacheKey,
        2*3600*1000
      );
    if (cached) {
      return {
        ...cached,
        servedFromCache:true
      };
    }
  }

  // CNY 41个、USD 2个分开请求，避免超过单次上游子请求预算。
  const results = await mapLimit(
    metaList,
    6,
    async meta=>{
      try {
        const x =
          await fetchFundNetWorthData(
            meta.code,
            false
          );

        return {
          code:meta.code,
          latestNav:x.latestNav,
          latestNavDate:
            x.latestNavDate,
          latestDailyReturn:
            x.latestDailyReturn,
          years:(x.years||[])
            .slice(0,3),
          error:null
        };
      } catch(e) {
        return {
          code:meta.code,
          latestNav:null,
          latestNavDate:null,
          latestDailyReturn:null,
          years:[],
          error:
            e?.message||String(e)
        };
      }
    }
  );

  const result = {
    generatedAt:
      new Date().toISOString(),
    currency:normalized,
    total:metaList.length,
    matched:results.filter(
      r=>
        r.latestNav!==null &&
        r.latestNav!==undefined &&
        Number.isFinite(
          Number(r.latestNav)
        )
    ).length,
    rows:results
  };

  await saveJsonCache(
    cacheKey,
    {
      ...result,
      cachedAt:
        new Date().toISOString()
    },
    2*3600
  );

  return result;
}


function parseTrackingErrorHtml(
  code,
  html
) {
  const text=stripHtml(html);

  const sectionPos=
    text.indexOf("指数基金指标");

  const scope=
    sectionPos>=0
      ?text.slice(
          sectionPos,
          sectionPos+1600
        )
      :text;

  // 必须从“跟踪指数”的数据行读取第一个指标。
  //
  // 典型扁平文本：
  // 跟踪指数 年化跟踪误差 同类平均跟踪误差
  // 纳斯达克100指数 1.66% 2.27%
  //
  // 旧版从“年化跟踪误差”标题向后找百分比，
  // 当基金自身值为 -- / 页面结构特殊时，可能误抓第二列
  // “同类平均跟踪误差”。
  const rowMatch=scope.match(
    /(?:纳斯达克\s*100\s*指数|NASDAQ\s*100(?:\s*INDEX)?)[^0-9%-]{0,80}(--|[0-9]+(?:\.[0-9]+)?\s*%)/i
  );

  if(!rowMatch){
    throw new Error(
      "Tracking error row not found"
    );
  }

  const raw=String(
    rowMatch[1]||""
  ).trim();

  if(raw==="--"){
    throw new Error(
      "Tracking error unavailable"
    );
  }

  const trackingError=
    Number(
      raw.replace("%","").trim()
    );

  if(
    !Number.isFinite(trackingError) ||
    trackingError<0 ||
    trackingError>100
  ){
    throw new Error(
      "Invalid tracking error"
    );
  }

  const dateMatch=scope.match(
    /截止至[:：]?\s*(20\d{2}-\d{2}-\d{2})/
  );

  return {
    code,
    trackingError,
    trackingErrorDate:
      dateMatch?.[1]||null,
    trackingIndex:
      "纳斯达克100指数"
  };
}


async function fetchTrackingError(
  code
) {
  if(!OTC_CODES.has(code)){
    throw new Error(
      "Unsupported OTC fund code"
    );
  }

  const url=
    `https://fundf10.eastmoney.com/tsdata_${code}.html`;

  const html=
    await fetchText(
      url,
      9000
    );

  return parseTrackingErrorHtml(
    code,
    html
  );
}

async function otcTrackingSummary({
  forceRefresh=false,
  currency="CNY"
}={}) {
  const normalized=
    currency==="USD"
      ?"USD"
      :"CNY";

  const metaList=
    otcMetaByCurrency(
      normalized
    );

  const cacheKey=
    OTC_TRACKING_CACHE_PREFIX+
    normalized;

  if(!forceRefresh){
    const cached=
      await loadTimedJsonCache(
        cacheKey,
        24*3600*1000
      );

    if(cached){
      return {
        ...cached,
        servedFromCache:true
      };
    }
  }

  // 仍使用 v3.17 的“当前年化跟踪误差”特色数据口径。
  // CNY / USD 分拆，避免一次性读取60个页面。
  const rows=await mapLimit(
    metaList,
    6,
    async meta=>{
      try{
        const x=
          await fetchTrackingError(
            meta.code
          );

        return {
          code:meta.code,
          trackingError:
            x.trackingError,
          trackingErrorDate:
            x.trackingErrorDate,
          trackingIndex:
            x.trackingIndex,
          error:null
        };
      }catch(e){
        return {
          code:meta.code,
          trackingError:null,
          trackingErrorDate:null,
          trackingIndex:null,
          error:
            e?.message||String(e)
        };
      }
    }
  );

  const result={
    generatedAt:
      new Date().toISOString(),
    currency:normalized,
    total:metaList.length,
    matched:rows.filter(
      r=>
        r.trackingError!==null &&
        r.trackingError!==undefined &&
        Number.isFinite(
          Number(r.trackingError)
        )
    ).length,
    rows
  };

  await saveJsonCache(
    cacheKey,
    {
      ...result,
      cachedAt:
        new Date().toISOString()
    },
    24*3600
  );

  return result;
}


async function fundHistory(code) {
  if (!ALL_FUND_CODES.has(code)) {
    throw new Error("Unsupported fund code");
  }

  const cacheKey =
    FUND_HISTORY_CACHE_PREFIX+code;

  const cached =
    await loadTimedJsonCache(
      cacheKey,
      6*3600*1000
    );

  if (cached) {
    return {
      ...cached,
      servedFromCache:true
    };
  }

  const x =
    await fetchFundNetWorthData(
      code,
      true
    );

  const result = {
    generatedAt:
      new Date().toISOString(),
    code,
    latestNav:x.latestNav,
    latestNavDate:
      x.latestNavDate,
    latestDailyReturn:
      x.latestDailyReturn,
    history:x.history||[],
    years:x.years||[]
  };

  await saveJsonCache(
    cacheKey,
    {
      ...result,
      cachedAt:
        new Date().toISOString()
    },
    6*3600
  );

  return result;
}


export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null,{status:204,headers:CORS});
    }
    if (request.method !== "GET") {
      return send({ok:false,error:"Method Not Allowed"},405);
    }

    const url = new URL(request.url);

    if (url.pathname === "/" || url.pathname === "/health") {
      return send({
        ok:true,
        service:"Nasdaq-100 cross-border fund monitor v3.26 - OTC fast load",
        etfCount:ETF_META.length,
        otcFundCount:OTC_META.length,
        otcCnyFundCount:OTC_CNY_META.length,
        otcUsdFundCount:OTC_USD_META.length,
        qqqEnabled:true,
        sourcePriority:["Eastmoney","naKanban","HaoETF","cache"],
        otcQuotaSource:"安鑫乐QDII额度日报（主）",
        otcQuotaVerification:"基金管理人公告原文（25代码检查 + partial/unverified历史回溯）",
        otcEngineVersion:OTC_ENGINE_VERSION,
        otcFastLoad:true,
        otcFeeSource:"天天基金/东方财富Choice",
        sharedCacheSeconds:20,
        historySourcePriority:["HaoETF direct history","Cloudflare D1 fallback"],
        historyStorage:"HaoETF direct + Cloudflare D1 fallback",
        historyEnabled:true,
        d1Enabled:!!env?.DB,
        time:new Date().toISOString()
      });
    }

    if (url.pathname === "/api/eastmoney-test") {
      try {
        const east = await fetchEastmoneyETFMap();
        const rows = ETF_META.map(meta=>{
          const s = east.map.get(meta.code);
          return {
            code:meta.code,
            company:meta.company,
            found:!!s,
            valid:!!s?.valid,
            price:s?.price ?? null,
            iopv:s?.estimate ?? null,
            premium:s?.premium ?? null,
            eastmoneyDiscountRate:s?.platformDiscountRate ?? null,
            eastmoneyPremiumForCheck:s?.platformPremium ?? null,
            difference:s?.checkDifference ?? null,
            dataDate:s?.dataDate ?? null,
            snapshotTime:s?.snapshotTime ?? null
          };
        });
        return send({
          ok:true,
          source:"Eastmoney ETF clist",
          totalETF:east.total,
          pages:east.pages,
          matched:east.matched,
          rows
        });
      } catch (e) {
        return send({ok:false,error:e?.message||String(e)},502);
      }
    }

    if (url.pathname === "/api/premiums") {
      try {
        return send({ok:true,...await buildPremiums(env)});
      } catch (e) {
        return send({ok:false,error:e?.message||String(e)},502);
      }
    }

    if (url.pathname === "/api/premium-history") {
      const code = url.searchParams.get("code") || "";
      const period = url.searchParams.get("period") || "week";
      const month = url.searchParams.get("month");
      try {
        const result = await getPremiumHistoryUnified(env, code, period, month);
        return send({ok:true,...result},200,"no-store");
      } catch (e) {
        return send({ok:false,error:e?.message||String(e)},502);
      }
    }

    if (url.pathname === "/api/history-status") {
      try {
        if (!env?.DB) {
          return send({
            ok:true,
            enabled:false,
            binding:"DB",
            message:"D1 binding DB not configured"
          });
        }
        await ensureHistorySchema(env);
        const s = await getHistorySummaries(env);
        return send({
          ok:true,
          enabled:true,
          binding:"DB",
          recordStart:s.recordStart
        });
      } catch (e) {
        return send({ok:false,error:e?.message||String(e)},502);
      }
    }

    if (url.pathname === "/api/otc-funds") {
      const forceRefresh=url.searchParams.get("refresh")==="1";
      try {
        return send(
          {
            ok:true,
            ...await buildOtcFundsHybridV37({
              forceRefresh,
              ctx
            })
          },
          200,
          forceRefresh
            ?"no-store"
            :"public, max-age=60"
        );
      } catch (e) {
        return send(
          {ok:false,error:e?.message||String(e)},
          502
        );
      }
    }


    if (url.pathname === "/api/otc-usd-funds") {
      const forceRefresh=
        url.searchParams.get("refresh")==="1";

      try {
        return send(
          {
            ok:true,
            ...await buildOtcUsdFunds({
              forceRefresh
            })
          },
          200,
          forceRefresh
            ?"no-store"
            :"public, max-age=60"
        );
      } catch (e) {
        return send(
          {
            ok:false,
            error:e?.message||String(e)
          },
          502
        );
      }
    }

    if (url.pathname === "/api/otc-fee") {
      const code = url.searchParams.get("code") || "";
      try {
        return send({ok:true,...await getOtcFeeDetails(code)},200,"public, max-age=3600");
      } catch (e) {
        return send({ok:false,error:e?.message||String(e)},502);
      }
    }


    if (url.pathname === "/api/otc-nav-summary") {
      const forceRefresh =
        url.searchParams.get("refresh")==="1";
      try {
        const currency=
          String(
            url.searchParams.get("currency")||
            "CNY"
          ).toUpperCase()==="USD"
            ?"USD"
            :"CNY";

        const result =
          await otcNavSummary({
            forceRefresh,
            currency
          });
        return send(
          {ok:true,...result},
          200,
          forceRefresh
            ?"no-store"
            :"public, max-age=600"
        );
      } catch (e) {
        return send(
          {
            ok:false,
            error:e?.message||String(e)
          },
          502
        );
      }
    }


    if (url.pathname === "/api/otc-tracking-summary") {
      const forceRefresh =
        url.searchParams.get("refresh")==="1";

      try {
        const currency=
          String(
            url.searchParams.get("currency")||
            "CNY"
          ).toUpperCase()==="USD"
            ?"USD"
            :"CNY";

        const result =
          await otcTrackingSummary({
            forceRefresh,
            currency
          });

        return send(
          {ok:true,...result},
          200,
          forceRefresh
            ?"no-store"
            :"public, max-age=3600"
        );
      } catch (e) {
        return send(
          {
            ok:false,
            error:e?.message||String(e)
          },
          502
        );
      }
    }

    if (url.pathname === "/api/fund-history") {
      const code =
        url.searchParams.get("code")||"";
      try {
        const result =
          await fundHistory(code);
        return send(
          {ok:true,...result},
          200,
          "public, max-age=1800"
        );
      } catch (e) {
        return send(
          {
            ok:false,
            error:e?.message||String(e)
          },
          502
        );
      }
    }


    if (url.pathname === "/api/qqq") {
      const forceRefresh=
        url.searchParams.get("refresh")==="1";

      try{
        return send(
          {
            ok:true,
            ...await buildQqq({
              forceRefresh
            })
          },
          200,
          forceRefresh
            ?"no-store"
            :"public, max-age=30"
        );
      }catch(e){
        return send(
          {
            ok:false,
            error:e?.message||String(e)
          },
          502
        );
      }
    }

    if (url.pathname === "/api/annual") {
      const code = url.searchParams.get("code") || "";
      try {
        const result = await annualPerformance(code);
        return send({ok:true,...result},200,"public, max-age=1800");
      } catch (e) {
        return send({ok:false,error:e?.message||String(e)},502);
      }
    }

    return send({ok:false,error:"Not Found"},404);
  },

  async scheduled(controller, env, ctx) {
    // 建议 Cron: 5 7 * * 1-5
    // Cloudflare Cron 使用 UTC，即北京时间工作日 15:05。
    ctx.waitUntil((async () => {
      try {
        await buildPremiums(env, {
          bypassShortCache:true,
          forceHistoryPersist:true
        });
      } catch (e) {
        console.error("scheduled premium history capture failed", e);
      }
    })());
  }
};
