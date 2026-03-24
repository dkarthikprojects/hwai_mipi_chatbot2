import { useState, useRef, useEffect, useCallback } from "react";

const SCROLL_CSS = [
  "*::-webkit-scrollbar{width:6px;height:6px}",
  "*::-webkit-scrollbar-track{background:transparent}",
  "*::-webkit-scrollbar-thumb{background:#334155;border-radius:6px}",
  "*::-webkit-scrollbar-thumb:hover{background:#475569}",
  "*{scrollbar-width:thin;scrollbar-color:#334155 transparent}",
].join(" ");

function GStyle() { return <style>{SCROLL_CSS}</style>; }


const C = {
  model:"claude-sonnet-4-20250514", tokens:2000,
  co:"HealthWorksAI", name:"MIPI POWER HOUSE", ver:"3.0.0",
};

const PAYORS = [
  {id:"humana",   label:"Humana",            logo:"H", color:"#006D3C"},
  {id:"united",   label:"UnitedHealthcare",   logo:"U", color:"#005EB8"},
  {id:"aetna",    label:"Aetna / CVS Health", logo:"A", color:"#7B2D8B"},
  {id:"elevance", label:"Elevance Health",     logo:"E", color:"#0078D4"},
  {id:"centene",  label:"Centene",             logo:"C", color:"#E31837"},
  {id:"kaiser",   label:"Kaiser Permanente",   logo:"K", color:"#003087"},
  {id:"devoted",  label:"Devoted Health",      logo:"D", color:"#1DA462"},
  {id:"other",    label:"Other Payor",         logo:"?", color:"#64748B"},
];

const BASE = "https://plancomparisonuat.analytics-hub.com/pc/user/?userID=/"
  + "?type=SIDEBAR_DASHBOARD&?userid=0a671ca0-a577-4803-a64f-9f4dad6f4c688";
const PC = "https://plancomparison-ui-aepmock.analytics-hub.com/pc/user/?userID=/"
  + "?type=SIDEBAR_DASHBOARD&?userid=0a671ca0-a577-4803-a64f-9f4dad6f4c6845";

const NAV = [
  {
    cat:"Market Intelligence", catIcon:"📈", color:"#4F46E5",
    items:[
      {
        id:"ca", label:"Competitor Analysis", icon:"🏆", url:BASE,
        desc:"Head-to-head plan comparison across payors and markets",
        ctx:"Viewing Competitor Analysis - plan counts, premiums, MOOP, SNP mix. PY2026.",
        qs:["How does our plan count compare to Humana in Florida?",
            "Which payor has the lowest average premium in Texas?",
            "Who dominates the D-SNP segment in California?"],
      },
      {
        id:"et", label:"Enrollment Trends", icon:"📊", url:BASE,
        desc:"MA enrollment trends, market share shifts, YoY growth",
        ctx:"Viewing Enrollment Trends - MA enrollment, YoY growth, market share by payor.",
        qs:["Which payor grew the most in MA enrollment last year?",
            "What is the national MA penetration rate trend?",
            "Which states have the fastest growing MA markets?"],
      },
      {
        id:"ms", label:"Market Snapshot", icon:"🗺️", url:BASE,
        desc:"County-level market landscape and competition density",
        ctx:"Viewing Market Snapshot - plan counts by county, payor presence, zero-prem share.",
        qs:["Which FL counties have the most plan options in 2026?",
            "Where are the biggest market white-space opportunities?",
            "Compare urban vs rural Texas county density"],
      },
    ],
  },
  {
    cat:"Product Intelligence", catIcon:"💡", color:"#059669",
    items:[
      {
        id:"pc", label:"Plan Comparison", icon:"⚖️", url:PC,
        desc:"Side-by-side plan benefit, cost-sharing, and premium comparison",
        ctx:"Viewing Plan Comparison - premiums, MOOP, deductibles, supplemental benefits.",
        qs:["What is the average OTC allowance for HMO plans in Florida?",
            "Compare dental benefits across the top 5 payors",
            "How does our MOOP compare to the market average?"],
      },
      {
        id:"sr", label:"Stars", icon:"⭐", url:BASE,
        desc:"CMS Star Ratings, QBP eligibility, measure-level trends",
        ctx:"Viewing Stars - overall stars, domain scores, QBP bonus eligibility.",
        qs:["How many contracts achieved 4+ stars nationally in 2026?",
            "What is the average star rating for FL plans?",
            "What is the QBP bonus impact for 4-star vs 3.5-star?"],
      },
      {
        id:"ty", label:"TPV YOY", icon:"📉", url:BASE,
        desc:"Third-Party Verification year-over-year trend analysis",
        ctx:"Viewing TPV YOY - year-over-year changes in plan verification metrics.",
        qs:["What are the main drivers of YOY TPV changes?",
            "Which markets show the most significant YOY shifts?",
            "What does a declining TPV trend indicate?"],
      },
    ],
  },
];

const TOOLS = [
  {id:"queries",   label:"Client Queries",    icon:"💬", color:"#4F46E5"},
  {id:"reporting", label:"Custom Reports",    icon:"📑", color:"#0891B2"},
  {id:"downloads", label:"Data Downloads",    icon:"⬇️", color:"#059669"},
  {id:"news",      label:"MA Industry News",  icon:"📰", color:"#D97706"},
  {id:"quiz",      label:"MA Knowledge Quiz", icon:"🧠", color:"#7C3AED"},
];

const LD = {
  nat:{tp:15955,zp:"72.5%",snp:"42.9%",ap:12.21,as_:3.81,fp:"44.6%"},
  FL: {tp:4243, zp:"75.8%",snp:"44.6%",ap:8.17, as_:3.78,fp:"43.5%"},
  TX: {tp:7947, zp:"70.6%",snp:"43.1%",ap:14.3, as_:3.79,fp:"43.1%"},
  CA: {tp:3765, zp:"72.8%",snp:"40.9%",ap:11.8, as_:3.85,fp:"49.3%"},
};
const TM = {
  query_landscape_data: {label:"Landscape DB",icon:"🗺️"},
  query_enrollment_data:{label:"Enrollment DB",icon:"👥"},
  query_stars_data:     {label:"Stars DB",    icon:"⭐"},
  query_benefit_data:   {label:"Benefits DB", icon:"💊"},
  query_formulary_data: {label:"Formulary DB",icon:"💉"},
};
const ATOOLS = [
  {name:"query_landscape_data",  description:"Query PY2026 MA Landscape.",
   input_schema:{type:"object",properties:{market:{type:"string"}}}},
  {name:"query_enrollment_data", description:"Query MA enrollment and market share.",
   input_schema:{type:"object",properties:{filters:{type:"object"},
   metrics:{type:"array",items:{type:"string"}}},required:["filters","metrics"]}},
  {name:"query_stars_data",  description:"Query CMS Star Ratings.",
   input_schema:{type:"object",properties:{payor:{type:"string"}}}},
  {name:"query_benefit_data",description:"Query PBP supplemental benefits.",
   input_schema:{type:"object",properties:{benefit_category:{type:"string"}},
   required:["benefit_category"]}},
  {name:"query_formulary_data",description:"Query formulary tier placement.",
   input_schema:{type:"object",properties:{drug_name:{type:"string"}}}},
];

function mock(name, inp) {
  if (name==="query_landscape_data") {
    const m=String(inp.market||"").toUpperCase().trim();
    const k=({FLORIDA:"FL",CALIFORNIA:"CA",TEXAS:"TX"})[m]
      ||(["FL","TX","CA"].includes(m)?m:"nat");
    const d=LD[k]||LD.nat;
    return {market:k==="nat"?"CA+FL+TX":k,year:2026,
      total_plans:d.tp,zero_prem:d.zp,snp_pct:d.snp,
      avg_prem:d.ap,avg_star:d.as_,four_plus:d.fp,source:"CMS MA Landscape PY2026"};
  }
  if (name==="query_enrollment_data")
    return {results:[{payor:"UnitedHealth",enrollment:"9.2M",share:"28.4%"},
      {payor:"Humana",enrollment:"6.1M",share:"18.8%"}],source:"CMS 2026"};
  if (name==="query_stars_data")
    return {avg:3.81,four_plus:"44.6%",source:"CMS 2026 Star Ratings"};
  if (name==="query_benefit_data")
    return {dental:{rate:"94%",avg:"$2,400/yr"},otc:{rate:"82%"},source:"PBP PY2026"};
  if (name==="query_formulary_data")
    return {drug:inp.drug_name||"Drug",tier:"Tier 3 - 71%",source:"CMS Formulary CY2026"};
  return {note:"Data available"};
}

async function callAPI(hist, sys, onTool) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({
      model:C.model, max_tokens:C.tokens,
      system:sys, tools:ATOOLS, messages:hist,
    }),
  });
  if (!res.ok) throw new Error("API " + res.status);
  const d = await res.json();
  if (d.stop_reason === "tool_use") {
    const results = d.content
      .filter(function(b){return b.type==="tool_use";})
      .map(function(b){
        const r=mock(b.name,b.input);
        if(onTool) onTool(b.name,r);
        return {type:"tool_result",tool_use_id:b.id,content:JSON.stringify(r)};
      });
    return callAPI(
      [...hist,{role:"assistant",content:d.content},{role:"user",content:results}],
      sys, onTool
    );
  }
  return d;
}

const uid  = function(){return Math.random().toString(36).slice(2,9);};
const tstr = function(d){return d.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});};

function mdHtml(md) {
  if (!md) return "";
  const esc = function(s){
    return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  };
  const inl = function(s){
    return esc(s)
      .replace(/\*\*(.*?)\*\*/g,"<strong>$1</strong>")
      .replace(/\*(.*?)\*/g,"<em>$1</em>");
  };
  const out=[]; let iL=false;
  const cL=function(){if(iL){out.push("</ul>");iL=false;}};
  md.split("\n").forEach(function(raw){
    const l=raw.trimEnd();
    if (l.startsWith("## ")) {
      cL();
      out.push("<h3 style='font-size:.9em;font-weight:700;margin:10px 0 3px'>"+inl(l.slice(3))+"</h3>");
    } else if (/^[-*] .+/.test(l)) {
      if (!iL){out.push("<ul style='padding-left:14px;margin:3px 0'>");iL=true;}
      out.push("<li style='margin:2px 0;font-size:.9em'>"+inl(l.replace(/^[-*] /,""))+"</li>");
    } else if (l.trim()==="") {
      cL(); out.push("<br/>");
    } else {
      cL();
      out.push("<p style='margin:3px 0;font-size:.9em'>"+inl(l)+"</p>");
    }
  });
  cL();
  return out.join("");
}

function Dots() {
  return (
    <span style={{display:"inline-flex",gap:3,alignItems:"center"}}>
      {[0,1,2].map(function(i){
        return (
          <span key={i} style={{
            width:4,height:4,borderRadius:"50%",background:"#94A3B8",
            display:"inline-block",
            animation:"dt 1.2s ease-in-out "+(i*.2)+"s infinite",
          }}/>
        );
      })}
      <style>{"@keyframes dt{0%,60%,100%{opacity:.35;transform:translateY(0)}30%{opacity:1;transform:translateY(-4px)}}"}</style>
    </span>
  );
}

function Chip({name, result}) {
  const [open,setOpen]=useState(false);
  const m=TM[name]||{label:name,icon:"🔍"};
  return (
    <div
      onClick={function(){setOpen(function(o){return !o;});}}
      style={{background:"#F0FDF4",border:"1px solid #BBF7D0",
        borderRadius:6,padding:"4px 8px",fontSize:11,cursor:"pointer",marginBottom:3}}
    >
      <div style={{display:"flex",alignItems:"center",gap:5,color:"#166534"}}>
        <span>{m.icon}</span>
        <strong style={{fontSize:10.5}}>{m.label}</strong>
        <span style={{marginLeft:"auto",opacity:.5,fontSize:9}}>{open?"▲":"▼"}</span>
      </div>
      {open && (
        <pre style={{marginTop:4,background:"#DCFCE7",borderRadius:4,padding:5,
          fontSize:9.5,color:"#14532D",overflowX:"auto",whiteSpace:"pre-wrap",
          wordBreak:"break-word",maxHeight:120,overflowY:"auto"}}>
          {JSON.stringify(result,null,2)}
        </pre>
      )}
    </div>
  );
}

function Bubble({msg, accent}) {
  const isU=msg.role==="user";
  return (
    <div style={{display:"flex",flexDirection:isU?"row-reverse":"row",
      gap:8,alignItems:"flex-start",maxWidth:"91%",
      alignSelf:isU?"flex-end":"flex-start"}}>
      <div style={{width:26,height:26,borderRadius:"50%",flexShrink:0,
        background:isU?accent:"#0F172A",display:"flex",alignItems:"center",
        justifyContent:"center",fontSize:11,color:"#fff"}}>
        {isU?"👤":"🤖"}
      </div>
      <div style={{flex:1,minWidth:0}}>
        {!isU && msg.tools && msg.tools.map(function(t,i){
          return <Chip key={i} name={t.name} result={t.result}/>;
        })}
        <div style={{background:isU?accent:"#fff",color:isU?"#fff":"#1E293B",
          padding:"8px 12px",
          borderRadius:isU?"12px 3px 12px 12px":"3px 12px 12px 12px",
          boxShadow:"0 1px 3px rgba(0,0,0,.06)",
          border:isU?"none":"1px solid #E2E8F0",lineHeight:1.6,fontSize:13}}>
          {msg.loading
            ? <span style={{color:"#64748B",display:"flex",alignItems:"center",gap:7}}>
                <Dots/>Querying...
              </span>
            : <div dangerouslySetInnerHTML={{__html:mdHtml(msg.content)}}/>
          }
        </div>
        <div style={{color:"#CBD5E1",fontSize:9.5,marginTop:2,
          textAlign:isU?"right":"left"}}>{tstr(msg.ts)}</div>
      </div>
    </div>
  );
}

function useChat(sys, welcome) {
  const [msgs,setMsgs]   = useState([]);
  const [hist,setHist]   = useState([]);
  const [busy,setBusy]   = useState(false);
  const [err,setErr]     = useState(null);
  useEffect(function(){
    setMsgs(welcome
      ? [{id:uid(),role:"assistant",content:welcome,tools:[],ts:new Date()}]
      : []);
    setHist([]); setErr(null);
  },[welcome]);
  const send = useCallback(async function(text){
    if (!text.trim()||busy) return;
    setErr(null);
    const um={id:uid(),role:"user",content:text,tools:[],ts:new Date()};
    const lid=uid();
    const lm={id:lid,role:"assistant",content:"",tools:[],ts:new Date(),loading:true};
    setMsgs(function(p){return [...p,um,lm];});
    setBusy(true);
    const nh=[...hist,{role:"user",content:text}];
    const ac=[];
    try {
      const data = await callAPI(nh,sys,function(name,result){
        ac.push({name,result});
        setMsgs(function(p){
          return p.map(function(m){
            return m.id===lid?Object.assign({},m,{tools:[...ac]}):m;
          });
        });
      });
      const txt=data.content
        .filter(function(b){return b.type==="text";})
        .map(function(b){return b.text;}).join("\n\n").trim();
      setHist([...nh,{role:"assistant",content:txt}]);
      setMsgs(function(p){
        return p.map(function(m){
          return m.id===lid?Object.assign({},m,{content:txt,tools:ac,loading:false}):m;
        });
      });
    } catch(e) {
      setErr(e.message);
      setMsgs(function(p){return p.filter(function(m){return m.id!==lid;});});
    } finally { setBusy(false); }
  },[busy,hist,sys]);
  return {msgs,busy,err,setErr,send};
}

function CInput({onSend,busy,color,ph}) {
  const [v,setV]=useState("");
  function go(){if(v.trim()){onSend(v);setV("");}}
  return (
    <div style={{padding:"10px 16px",background:"#fff",
      borderTop:"1px solid #E2E8F0",flexShrink:0}}>
      <div style={{display:"flex",gap:8,alignItems:"flex-end",background:"#F8FAFC",
        borderRadius:10,border:"1.5px solid "+(busy?color+"88":"#E2E8F0"),
        padding:"7px 12px"}}>
        <textarea
          value={v}
          onChange={function(e){setV(e.target.value);}}
          onKeyDown={function(e){if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();go();}}}
          disabled={busy} rows={1}
          placeholder={ph||"Ask a question..."}
          style={{flex:1,background:"transparent",border:"none",outline:"none",
            resize:"none",fontSize:13.5,color:"#1E293B",fontFamily:"inherit",
            lineHeight:1.5,maxHeight:100,overflowY:"auto"}}
          onInput={function(e){
            e.target.style.height="auto";
            e.target.style.height=Math.min(e.target.scrollHeight,100)+"px";
          }}
        />
        <button
          onClick={go} disabled={busy||!v.trim()}
          style={{background:busy||!v.trim()?"#E2E8F0":color,
            color:busy||!v.trim()?"#94A3B8":"#fff",border:"none",borderRadius:7,
            padding:"6px 14px",cursor:busy||!v.trim()?"not-allowed":"pointer",
            fontWeight:600,fontSize:12.5,flexShrink:0,fontFamily:"inherit"}}
        >
          {busy?"...":"Send"}
        </button>
      </div>
    </div>
  );
}

const QPILLS=[
  "How many MA plans are in Florida for 2026?",
  "What % of 2026 plans offer $0 premium?",
  "Compare Humana vs UnitedHealth in Texas 2026",
  "Show star rating distribution for 2026",
];

function QueriesPanel({payor}) {
  const sys="You are MIPI POWER HOUSE - HealthWorksAI MA intelligence. User from "
    +payor.label+". Answer concisely using PY2026 data CA/FL/TX. Call tools. Cite sources.";
  const welcome="Welcome, **"+payor.label
    +"** team! Ask me anything about MA plans, premiums, benefits, or stars.";
  const {msgs,busy,err,setErr,send}=useChat(sys,welcome);
  const endRef=useRef(null);
  useEffect(function(){endRef.current&&endRef.current.scrollIntoView({behavior:"smooth"});},[msgs]);
  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <div style={{flex:1,overflowY:"auto",padding:"14px 18px",
        display:"flex",flexDirection:"column",gap:10}}>
        {msgs.map(function(m){return <Bubble key={m.id} msg={m} accent="#4F46E5"/>;}) }
        {err && (
          <div style={{background:"#FEF2F2",border:"1px solid #FECACA",
            borderRadius:8,padding:"8px 12px",color:"#B91C1C",fontSize:12,
            display:"flex",gap:8}}>
            Error: {err}
            <button onClick={function(){setErr(null);}}
              style={{marginLeft:"auto",background:"none",border:"none",
                cursor:"pointer",color:"#B91C1C"}}>X</button>
          </div>
        )}
        {msgs.length<=1 && (
          <div style={{display:"flex",flexWrap:"wrap",gap:6,marginTop:4}}>
            {QPILLS.map(function(q,i){
              return (
                <button key={i} onClick={function(){send(q);}}
                  style={{background:"#EEF2FF",color:"#4F46E5",
                    border:"1px solid #C7D2FE",borderRadius:20,
                    padding:"5px 12px",fontSize:11.5,cursor:"pointer",
                    fontFamily:"inherit"}}>{q}</button>
              );
            })}
          </div>
        )}
        <div ref={endRef}/>
      </div>
      <CInput onSend={send} busy={busy} color="#4F46E5" ph="Ask about MA plans..."/>
    </div>
  );
}

const RTMPL=[
  {id:"cl",icon:"🏆",label:"Competitive Landscape",
   p:"Generate a competitive landscape report for {m} PY2026 with plan counts, premiums, SNP, stars, and 3 strategic insights."},
  {id:"pb",icon:"💰",label:"Premium Benchmarking",
   p:"Generate a premium benchmarking report for {m}: avg/median/zero-dollar rates by plan type, payor comparison, and recommendations."},
  {id:"sn",icon:"🏥",label:"SNP Analysis",
   p:"Generate a SNP market analysis for {m}: D-SNP/C-SNP/I-SNP plan counts, payor share, AIP integration status."},
  {id:"st",icon:"⭐",label:"Star Ratings",
   p:"Generate a star ratings summary for {m} PY2026: distribution, 4+ star share, QBP bonus impact, top HEDIS measures."},
  {id:"ex",icon:"👔",label:"Executive Summary",
   p:"Generate a 1-page executive summary for {m} PY2026: key findings, competitive threats, 3 strategic recommendations."},
];

function ReportingPanel({payor}) {
  const [mkt,setMkt]=useState("Florida");
  const [sel,setSel]=useState(null);
  const sys="You are MIPI POWER HOUSE - HealthWorksAI MA intelligence for "
    +payor.label+". Generate markdown reports with tables and strategic recommendations. PY2026 CA/FL/TX.";
  const welcome="Ready to build reports for **"+payor.label
    +"**. Select a template or describe your report below.";
  const {msgs,busy,err,setErr,send}=useChat(sys,welcome);
  const endRef=useRef(null);
  useEffect(function(){endRef.current&&endRef.current.scrollIntoView({behavior:"smooth"});},[msgs]);
  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <div style={{padding:"12px 18px",background:"#fff",
        borderBottom:"1px solid #E2E8F0",flexShrink:0}}>
        <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:8}}>
          <select value={mkt} onChange={function(e){setMkt(e.target.value);}}
            style={{background:"#F8FAFC",border:"1px solid #E2E8F0",borderRadius:8,
              padding:"6px 10px",fontSize:13,color:"#1E293B",fontFamily:"inherit"}}>
            <option>Florida</option><option>Texas</option>
            <option>California</option><option>National (CA+FL+TX)</option>
          </select>
        </div>
        <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
          {RTMPL.map(function(t){
            return (
              <button key={t.id} disabled={busy}
                onClick={function(){setSel(t.id);send(t.p.replace("{m}",mkt));}}
                style={{display:"flex",alignItems:"center",gap:5,
                  background:sel===t.id?"#0891B2":"#ECFEFF",
                  color:sel===t.id?"#fff":"#0E7490",
                  border:"1px solid "+(sel===t.id?"#0891B2":"#A5F3FC"),
                  borderRadius:20,padding:"5px 11px",fontSize:11.5,
                  cursor:busy?"not-allowed":"pointer",fontFamily:"inherit"}}>
                <span>{t.icon}</span>{t.label}
              </button>
            );
          })}
        </div>
      </div>
      <div style={{flex:1,overflowY:"auto",padding:"14px 18px",
        display:"flex",flexDirection:"column",gap:10}}>
        {msgs.map(function(m){return <Bubble key={m.id} msg={m} accent="#0891B2"/>;}) }
        {err && <div style={{background:"#FEF2F2",border:"1px solid #FECACA",
          borderRadius:8,padding:"8px",color:"#B91C1C",fontSize:12}}>Error: {err}</div>}
        <div ref={endRef}/>
      </div>
      <CInput onSend={send} busy={busy} color="#0891B2" ph="Describe a custom report..."/>
    </div>
  );
}

const RN=function(a,b){return Math.floor(Math.random()*(b-a+1))+a;};
const PK=function(a){return a[Math.floor(Math.random()*a.length)];};
const ORGS=["Humana Inc.","UnitedHealth Group","CVS/Aetna","Elevance Health",
  "Centene Corp","HCSC","Kaiser Permanente","Devoted Health"];
const CTYS={
  FL:["Miami-Dade","Broward","Palm Beach","Hillsborough","Orange",
      "Pinellas","Duval","Lee","Polk","Collier","Sarasota","Volusia"],
  TX:["Harris","Dallas","Tarrant","Bexar","Travis","Collin",
      "Denton","El Paso","Fort Bend","Williamson","Brazoria","Nueces"],
  CA:["Los Angeles","San Diego","Orange","Riverside","San Bernardino",
      "Santa Clara","Alameda","Sacramento","Contra Costa","Fresno"],
};

function triggerDL(fname, content) {
  const a=document.createElement("a");
  a.href="data:text/csv;charset=utf-8,"+encodeURIComponent(content);
  a.download=fname; a.style.display="none";
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
}
function buildCSV(rows) {
  if (!rows.length) return "";
  const hdr=Object.keys(rows[0]);
  const esc=function(v){
    const s=String(v==null?"":v);
    return (s.indexOf(",")>=0||s.indexOf('"')>=0)?'"'+s.replace(/"/g,'""')+'"':s;
  };
  return [hdr.join(","),
    ...rows.map(function(r){return hdr.map(function(h){return esc(r[h]);}).join(",");})
  ].join("\n");
}
function makeRows(type, states, counties, planTypes, snpTypes) {
  const sts=states.length?states:["FL","TX","CA"];
  const sn={FL:"Florida",TX:"Texas",CA:"California"};
  function cty(st){
    const pool=CTYS[st]||["County"];
    const filtered=counties.length?pool.filter(function(c){return counties.indexOf(c)>=0;}):pool;
    return PK(filtered.length?filtered:pool);
  }
  if (type==="eoc"||type==="dental") {
    const dt=type==="eoc"?"Evidence of Coverage":"Dental Summary";
    return sts.flatMap(function(st){
      return Array.from({length:10},function(){
        return {
          Contract_ID:"H"+RN(1000,9999),Organization:PK(ORGS),State:sn[st],
          County:cty(st),
          Plan_Type:planTypes.length?PK(planTypes):PK(["HMO","Local PPO"]),
          SNP_Type:snpTypes.length?PK(snpTypes):"Non-SNP",
          Document_Type:dt,
          CMS_URL:"https://www.cms.gov/Medicare/Prescription-Drug-coverage/PrescriptionDrugCovGenIn",
          Year:2026,
        };
      });
    });
  }
  if (type==="stars") {
    return sts.flatMap(function(st){
      return ORGS.slice(0,5).map(function(org){
        return {Organization:org,State:sn[st],
          Overall_Stars:PK([3,3.5,3.5,4,4,4.5,5]),
          QBP_Eligible:PK(["Yes","Yes","No"]),County:cty(st),Year:2026};
      });
    });
  }
  if (type==="premium") {
    const pts=planTypes.length?planTypes:["HMO","Local PPO","HMO-POS"];
    return sts.flatMap(function(st){
      return pts.flatMap(function(pt){
        return ORGS.slice(0,4).map(function(org){
          return {Organization:org,State:sn[st],Plan_Type:pt,
            Avg_Premium:parseFloat((Math.random()*60).toFixed(2)),
            Zero_Pct:parseFloat((50+Math.random()*45).toFixed(1))+"%",
            Plan_Count:RN(5,60),Year:2026};
        });
      });
    });
  }
  if (type==="snp") {
    const snps=snpTypes.filter(function(s){return s!=="Non-SNP";});
    const use=snps.length?snps:["Dual-Eligible","Chronic Condition","Institutional"];
    return sts.flatMap(function(st){
      return use.flatMap(function(snpt){
        return ORGS.slice(0,4).map(function(org){
          return {Organization:org,State:sn[st],SNP_Type:snpt,
            Plan_Count:RN(1,35),
            Avg_Stars:parseFloat((2.5+Math.random()*2.5).toFixed(1)),
            AIP_Integrated:snpt==="Dual-Eligible"?PK(["Yes","Yes","No"]):"N/A",
            Year:2026};
        });
      });
    });
  }
  return sts.flatMap(function(st){
    return Array.from({length:15},function(){
      const prem=Math.random()<0.73?0:RN(8,120);
      return {
        Contract_ID:"H"+RN(1000,9999),State:sn[st],
        County:cty(st),Organization:PK(ORGS),
        Plan_Type:planTypes.length?PK(planTypes):PK(["HMO","Local PPO","HMO-POS"]),
        SNP_Type:snpTypes.length?PK(snpTypes):PK(["Non-SNP","Non-SNP","Dual-Eligible"]),
        Monthly_Premium:prem,MOOP:PK([3400,4900,5900,6500,9250]),
        Star_Rating:PK([2.5,3,3.5,4,4,4.5,5]),Year:2026,
      };
    });
  });
}

const DCUTS=[
  {id:"landscape",label:"Plan Landscape",     icon:"🗺️",color:"#4F46E5",
   desc:"Plan counts, premium, MOOP, star ratings for selected filters"},
  {id:"stars",    label:"Star Ratings",        icon:"⭐",color:"#D97706",
   desc:"Star rating breakdown and QBP eligibility by org and state"},
  {id:"premium",  label:"Premium Benchmarking",icon:"💰",color:"#0891B2",
   desc:"Average premium, zero-premium share by plan type and payor"},
  {id:"snp",      label:"SNP Analysis",        icon:"🏥",color:"#E31837",
   desc:"D-SNP, C-SNP, I-SNP plan counts and AIP integration status"},
];

const DOC_CUTS=[
  {id:"eoc",    label:"Evidence of Coverage (EOC)",icon:"📋",color:"#059669",
   desc:"EOC manifest per plan — includes CMS Plan Finder links for bulk retrieval"},
  {id:"dental", label:"Dental Benefit Documents",  icon:"🦷",color:"#7C3AED",
   desc:"Dental summary manifest for plans offering dental coverage"},
];

function MSelect({label, opts, sel, onChange}) {
  const [open,setOpen]=useState(false);
  const all=sel.length===opts.length;
  function tog(v){
    onChange(sel.indexOf(v)>=0?sel.filter(function(x){return x!==v;}): [...sel,v]);
  }
  const txt=all?"All "+label:sel.length===0?"None":sel.length+" selected";
  return (
    <div style={{position:"relative",flex:1,minWidth:110}}>
      <button
        onClick={function(){setOpen(function(o){return !o;});}}
        style={{width:"100%",padding:"7px 10px",background:"#fff",
          border:"1px solid #E2E8F0",borderRadius:8,fontSize:12,color:"#1E293B",
          fontFamily:"inherit",cursor:"pointer",display:"flex",
          alignItems:"center",justifyContent:"space-between",gap:4}}
      >
        <span style={{fontSize:10.5,color:"#64748B"}}>{label}:</span>
        <span style={{flex:1,textAlign:"left",marginLeft:4,fontSize:11.5,color:"#1E293B"}}>
          {txt}
        </span>
        <span style={{color:"#94A3B8",fontSize:9}}>{open?"▲":"▼"}</span>
      </button>
      {open && (
        <div style={{position:"absolute",top:"calc(100% + 3px)",left:0,right:0,
          background:"#fff",border:"1px solid #E2E8F0",borderRadius:8,
          boxShadow:"0 4px 12px rgba(0,0,0,.1)",zIndex:20,padding:"4px 0",minWidth:150}}>
          <div
            onClick={function(){onChange(all?[]:opts.slice());}}
            style={{padding:"5px 10px",fontSize:11.5,cursor:"pointer",
              color:"#1E293B",fontWeight:all?600:400,
              display:"flex",alignItems:"center",gap:6,borderBottom:"1px solid #F1F5F9"}}
          >
            <span style={{width:13,height:13,borderRadius:3,
              border:"1.5px solid "+(all?"#475569":"#CBD5E1"),
              background:all?"#475569":"#fff",display:"inline-flex",
              alignItems:"center",justifyContent:"center",
              flexShrink:0,fontSize:8,color:"#fff",fontWeight:700}}>
              {all?"✓":""}
            </span>
            Select all
          </div>
          {opts.map(function(opt){
            const chk=sel.indexOf(opt)>=0;
            return (
              <div key={opt} onClick={function(){tog(opt);}}
                style={{padding:"5px 10px",fontSize:11.5,cursor:"pointer",
                  color:"#1E293B",fontWeight:chk?600:400,
                  display:"flex",alignItems:"center",gap:6}}>
                <span style={{width:13,height:13,borderRadius:3,
                  border:"1.5px solid "+(chk?"#475569":"#CBD5E1"),
                  background:chk?"#475569":"#fff",display:"inline-flex",
                  alignItems:"center",justifyContent:"center",
                  flexShrink:0,fontSize:8,color:"#fff",fontWeight:700}}>
                  {chk?"✓":""}
                </span>
                {opt}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function DownloadsPanel() {
  const [selSt,setSelSt]=useState(["FL","TX","CA"]);
  const [selCo,setSelCo]=useState([]);
  const [selPT,setSelPT]=useState(["HMO","Local PPO","HMO-POS","Regional PPO","PFFS"]);
  const [selSN,setSelSN]=useState(["Non-SNP","Dual-Eligible","Chronic Condition","Institutional"]);
  const [dlSt,setDlSt]=useState({});

  const availCo = selSt.flatMap(function(st){return CTYS[st]||[];})
    .filter(function(v,i,a){return a.indexOf(v)===i;}).sort();

  function download(cut){
    setDlSt(function(s){return Object.assign({},s,{[cut.id]:"busy"});});
    const rows=makeRows(cut.id,selSt,selCo,selPT,selSN);
    const csv=buildCSV(rows);
    const tag=selSt.length===3?"ALL":selSt.join("-");
    triggerDL("MIPI_"+cut.id.toUpperCase()+"_"+tag+"_2026.csv",csv);
    setDlSt(function(s){return Object.assign({},s,{[cut.id]:"done"});});
  }

  function DataCard({cut}){
    const iB=dlSt[cut.id]==="busy", iD=dlSt[cut.id]==="done";
    return (
      <div style={{background:"#fff",border:"1px solid #E2E8F0",
        borderRadius:10,padding:"13px"}}>
        <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:7}}>
          <span style={{fontSize:20}}>{cut.icon}</span>
          <div style={{fontWeight:700,fontSize:12.5,color:"#0F172A",lineHeight:1.2}}>
            {cut.label}
          </div>
        </div>
        <div style={{fontSize:11,color:"#64748B",lineHeight:1.5,
          marginBottom:10,minHeight:28}}>{cut.desc}</div>
        <div style={{display:"flex",gap:3,marginBottom:9,flexWrap:"wrap"}}>
          {selSt.slice(0,3).map(function(st){
            return (
              <span key={st} style={{fontSize:9.5,fontWeight:600,
                padding:"1px 6px",borderRadius:10,
                background:"#F1F5F9",color:"#475569"}}>{st}</span>
            );
          })}
        </div>
        <button
          onClick={function(){download(cut);}}
          disabled={iB||!selSt.length}
          style={{width:"100%",padding:"7px 0",
            background:iD?"#DCFCE7":iB?"#F8FAFC":"#F8FAFC",
            border:"1px solid "+(iD?"#6EE7B7":iB?"#E2E8F0":"#E2E8F0"),
            borderRadius:7,fontSize:12,fontWeight:600,
            color:iD?"#065F46":iB?"#94A3B8":"#374151",
            cursor:iB||!selSt.length?"not-allowed":"pointer",
            fontFamily:"inherit",display:"flex",
            alignItems:"center",justifyContent:"center",gap:5}}
        >
          {iB?"⏳":iD?"✅":"⬇️"} {iB?"Preparing...":iD?"Downloaded":"Download CSV"}
        </button>
      </div>
    );
  }

  function DocCard({cut}){
    const iB=dlSt[cut.id]==="busy", iD=dlSt[cut.id]==="done";
    const planCount=makeRows(cut.id,selSt,selCo,selPT,selSN).length;
    return (
      <div style={{background:"#FFFBEB",border:"1px solid #FDE68A",
        borderRadius:10,padding:"13px",position:"relative"}}>
        <div style={{position:"absolute",top:10,right:10,
          background:"#F59E0B",color:"#fff",fontSize:9,fontWeight:700,
          padding:"2px 7px",borderRadius:20,letterSpacing:".05em"}}>
          PREMIUM
        </div>
        <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:7}}>
          <span style={{fontSize:20}}>{cut.icon}</span>
          <div style={{fontWeight:700,fontSize:12.5,color:"#0F172A",lineHeight:1.2,
            paddingRight:52}}>{cut.label}</div>
        </div>
        <div style={{fontSize:11,color:"#78716C",lineHeight:1.5,
          marginBottom:10,minHeight:28}}>{cut.desc}</div>
        <div style={{display:"flex",gap:3,marginBottom:9,flexWrap:"wrap"}}>
          {selSt.slice(0,3).map(function(st){
            return (
              <span key={st} style={{fontSize:9.5,fontWeight:600,
                padding:"1px 6px",borderRadius:10,
                background:"#FEF3C7",color:"#92400E"}}>{st}</span>
            );
          })}
        </div>
        <button
          onClick={function(){download(cut);}}
          disabled={iB||!selSt.length}
          style={{width:"100%",padding:"7px 0",
            background:iD?"#DCFCE7":iB?"#FEF3C7":"#FEF3C7",
            border:"1px solid "+(iD?"#6EE7B7":iB?"#FDE68A":"#FDE68A"),
            borderRadius:7,fontSize:12,fontWeight:600,
            color:iD?"#065F46":iB?"#94A3B8":"#92400E",
            cursor:iB||!selSt.length?"not-allowed":"pointer",
            fontFamily:"inherit",display:"flex",
            alignItems:"center",justifyContent:"center",gap:5}}
        >
          {iB?"⏳":iD?"✅":"⬇️"}{" "}
          {iB?"Preparing...":iD?"Downloaded":"Download All ("+planCount+" plans)"}
        </button>
      </div>
    );
  }

  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <div style={{padding:"12px 18px",background:"#fff",
        borderBottom:"1px solid #E2E8F0",flexShrink:0}}>
        <div style={{fontSize:10.5,fontWeight:600,color:"#64748B",
          textTransform:"uppercase",letterSpacing:".07em",marginBottom:7}}>
          Filter your download
        </div>
        <div style={{display:"flex",gap:7,flexWrap:"wrap",marginBottom:7}}>
          <MSelect label="State" opts={["FL","TX","CA"]}
            sel={selSt} onChange={function(v){setSelSt(v);setSelCo([]);}}/>
          <MSelect label="County" opts={availCo}
            sel={selCo} onChange={setSelCo}/>
          <MSelect label="Plan Type"
            opts={["HMO","Local PPO","HMO-POS","Regional PPO","PFFS"]}
            sel={selPT} onChange={setSelPT}/>
          <MSelect label="SNP Type"
            opts={["Non-SNP","Dual-Eligible","Chronic Condition","Institutional"]}
            sel={selSN} onChange={setSelSN}/>
        </div>
        <div style={{fontSize:11,color:"#94A3B8"}}>
          Downloading for:{" "}
          <strong style={{color:"#374151"}}>
            {selSt.length===0?"No state selected":selSt.length===3?"CA, FL, TX":selSt.join(", ")}
          </strong>
          {selCo.length>0&&(
            <span style={{color:"#374151"}}>
              {" "}· {selCo.length} {selCo.length===1?"county":"counties"}
            </span>
          )}
        </div>
      </div>
      <div style={{flex:1,overflowY:"auto",padding:"14px 18px"}}>

        <div style={{fontSize:11,fontWeight:700,color:"#374151",
          textTransform:"uppercase",letterSpacing:".06em",marginBottom:9}}>
          Data Exports
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:20}}>
          {DCUTS.map(function(cut){return <DataCard key={cut.id} cut={cut}/>;}) }
        </div>

        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:9}}>
          <div style={{fontSize:11,fontWeight:700,color:"#374151",
            textTransform:"uppercase",letterSpacing:".06em"}}>
            Plan Documents
          </div>
          <div style={{height:1,flex:1,background:"#FDE68A"}}/>
          <span style={{fontSize:10,color:"#92400E",fontWeight:600,
            background:"#FEF3C7",padding:"2px 8px",borderRadius:20}}>
            Premium Feature
          </span>
        </div>
        <div style={{marginBottom:12,fontSize:11.5,color:"#78716C",lineHeight:1.6}}>
          EOC and Dental document manifests export plan-level CMS document links for bulk retrieval.
          Connect <code style={{fontSize:10.5,background:"rgba(0,0,0,.05)",
            padding:"1px 4px",borderRadius:3}}>POST /api/documents/:type</code> to retrieve actual PDFs.
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>
          {DOC_CUTS.map(function(cut){return <DocCard key={cut.id} cut={cut}/>;}) }
        </div>

      </div>
    </div>
  );
}

const NEWS=[
  {id:1,date:"Mar 20 2026",tag:"Policy",    tc:"#4F46E5",src:"CMS.gov",
   title:"CMS Finalizes 2027 MA Rate Notice: 5.06% Revenue Increase",
   body:"CMS released the Final 2027 Rate Announcement with a 5.06% effective growth rate, above the 2.23% proposed."},
  {id:2,date:"Mar 18 2026",tag:"Stars",     tc:"#D97706",src:"Health Affairs",
   title:"2026 Star Ratings: Average Drops to 3.81 as Cut Points Tighten",
   body:"National average star rating fell from 4.05 to 3.81. 44.6% of plans achieved 4+ stars."},
  {id:3,date:"Mar 15 2026",tag:"Enrollment",tc:"#059669",src:"KFF",
   title:"MA Enrollment Surpasses 33 Million - A New Record",
   body:"Medicare Advantage reached 33.2 million in early 2026 - 54% of all Medicare beneficiaries."},
  {id:4,date:"Mar 12 2026",tag:"Benefits",  tc:"#7C3AED",src:"Modern Healthcare",
   title:"OTC Benefit Pullback: Average Allowance Drops 18% for 2026",
   body:"Average OTC allowances fell from $1,460 to $1,200 amid CMS scrutiny and margin pressure."},
  {id:5,date:"Mar 10 2026",tag:"D-SNP",     tc:"#E31837",src:"AHIP",
   title:"D-SNP Integration: 68% of Plans Now Fully Integrated",
   body:"68% of D-SNP plans are now AIPs as of 2026, up from 51% in 2025."},
  {id:6,date:"Mar 8 2026", tag:"Formulary", tc:"#0891B2",src:"Fierce Healthcare",
   title:"GLP-1 Coverage Expands: 62% of MA-PD Plans Now Cover Ozempic",
   body:"62% of MA-PD plans now offer GLP-1 coverage including Ozempic and Wegovy."},
];
const NTAGS=["All",...new Set(NEWS.map(function(n){return n.tag;}))];

function NewsPanel() {
  const [q,setQ]=useState("");
  const [tag,setTag]=useState("All");
  const f=NEWS.filter(function(n){
    return (tag==="All"||n.tag===tag)
      &&(!q.trim()||n.title.toLowerCase().indexOf(q.toLowerCase())>=0);
  });
  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <div style={{padding:"12px 18px",background:"#fff",
        borderBottom:"1px solid #E2E8F0",flexShrink:0}}>
        <div style={{display:"flex",gap:8,alignItems:"center",background:"#F8FAFC",
          borderRadius:10,border:"1.5px solid #E2E8F0",padding:"7px 12px",marginBottom:8}}>
          <span style={{fontSize:15}}>🔍</span>
          <input value={q} onChange={function(e){setQ(e.target.value);}}
            placeholder="Search MA news..."
            style={{flex:1,background:"transparent",border:"none",outline:"none",
              fontSize:13,color:"#1E293B",fontFamily:"inherit"}}/>
          {q&&<button onClick={function(){setQ("");}} style={{background:"none",
            border:"none",cursor:"pointer",color:"#94A3B8",fontSize:13,padding:0}}>X</button>}
        </div>
        <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
          {NTAGS.map(function(t){
            return (
              <button key={t} onClick={function(){setTag(t);}}
                style={{background:tag===t?"#0F172A":"#F1F5F9",
                  color:tag===t?"#F1F5F9":"#64748B",border:"none",borderRadius:20,
                  padding:"3px 10px",fontSize:11,fontWeight:tag===t?600:400,
                  cursor:"pointer",fontFamily:"inherit"}}>{t}</button>
            );
          })}
        </div>
      </div>
      <div style={{flex:1,overflowY:"auto",padding:"12px 18px"}}>
        <div style={{display:"flex",flexDirection:"column",gap:9}}>
          {f.map(function(n){
            return (
              <div key={n.id} style={{background:"#fff",border:"1px solid #E2E8F0",
                borderRadius:10,padding:"12px 14px"}}>
                <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:6}}>
                  <span style={{background:n.tc+"18",color:n.tc,fontSize:10,
                    fontWeight:700,padding:"2px 7px",borderRadius:20}}>{n.tag}</span>
                  <span style={{color:"#94A3B8",fontSize:11}}>{n.date}</span>
                  <span style={{marginLeft:"auto",color:"#CBD5E1",fontSize:11}}>{n.src}</span>
                </div>
                <h3 style={{margin:"0 0 4px",fontSize:13.5,fontWeight:700,lineHeight:1.3}}>
                  {n.title}
                </h3>
                <p style={{margin:0,fontSize:12.5,color:"#475569",lineHeight:1.6}}>{n.body}</p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const QZD=[
  {q:"Maximum in-network MOOP for a standard MA plan in 2026?",
   opts:["$7,550","$8,850","$9,250","$10,000"],ans:2,tag:"MOOP",
   exp:"CMS set the 2026 in-network MOOP cap at $9,250."},
  {q:"Which SNP type serves beneficiaries eligible for both Medicare and Medicaid?",
   opts:["C-SNP","I-SNP","D-SNP","MA-SNP"],ans:2,tag:"SNP",
   exp:"D-SNPs serve those eligible for both Medicare and Medicaid."},
  {q:"What does QBP stand for in CMS Star Ratings?",
   opts:["Quality Bonus Payment","Quarterly Benchmark Plan","Quality Benefit Program","Qualified Bonus Plan"],
   ans:0,tag:"Stars",exp:"QBP = Quality Bonus Payment. 4+ star plans get a 5% bonus."},
  {q:"In PY2026 (CA+FL+TX), what share of MA plans offer $0 premium?",
   opts:["~55%","~62%","~72%","~81%"],ans:2,tag:"Premium",
   exp:"72.5% of plans carry a $0 monthly premium."},
  {q:"Which payor had the most MA plans in CA+FL+TX for PY2026?",
   opts:["UnitedHealth","Humana Inc.","CVS/Aetna","Centene"],ans:1,tag:"Landscape",
   exp:"Humana had 4,231 plans - most of any parent org."},
  {q:"What % of D-SNP plans were fully integrated (AIP) as of 2026?",
   opts:["42%","51%","68%","79%"],ans:2,tag:"D-SNP",
   exp:"68% of D-SNP plans are now AIPs, up from 51% in 2025."},
];
const QTAGS=["All",...new Set(QZD.map(function(q){return q.tag;}))];

function QuizPanel() {
  const [q,setQ]=useState("");
  const [tag,setTag]=useState("All");
  const [started,setStarted]=useState(false);
  const [pool,setPool]=useState([]);
  const [qi,setQi]=useState(0);
  const [sel,setSel]=useState(null);
  const [score,setScore]=useState(0);
  const [done,setDone]=useState(false);
  const fq=QZD.filter(function(x){
    return (tag==="All"||x.tag===tag)
      &&(!q.trim()||x.q.toLowerCase().indexOf(q.toLowerCase())>=0);
  });
  function start(){setPool(fq);setQi(0);setSel(null);setScore(0);setDone(false);setStarted(true);}
  function pick(i){
    if(sel!==null) return;
    setSel(i);
    if(i===pool[qi].ans) setScore(function(s){return s+1;});
  }
  function next(){if(qi<pool.length-1){setQi(qi+1);setSel(null);}else setDone(true);}
  function reset(){setStarted(false);setSel(null);setDone(false);}

  if (started&&done) {
    const pct=score/pool.length;
    return (
      <div style={{flex:1,display:"flex",flexDirection:"column",
        alignItems:"center",justifyContent:"center",padding:24}}>
        <div style={{fontSize:48,marginBottom:10}}>🎉</div>
        <h2 style={{margin:"0 0 6px",fontSize:20,fontWeight:700}}>Quiz Complete!</h2>
        <p style={{color:"#64748B",marginBottom:16}}>Score: <strong>{score} / {pool.length}</strong></p>
        <div style={{background:pct>=.8?"#ECFDF5":pct>=.5?"#FFFBEB":"#FEF2F2",
          border:"1px solid "+(pct>=.8?"#6EE7B7":pct>=.5?"#FCD34D":"#FCA5A5"),
          borderRadius:10,padding:"9px 22px",marginBottom:18,fontSize:13,fontWeight:600,
          color:pct>=.8?"#065F46":pct>=.5?"#92400E":"#B91C1C"}}>
          {pct>=.8?"Excellent!":pct>=.5?"Good effort!":"Keep studying!"}
        </div>
        <button onClick={reset} style={{background:"#7C3AED",color:"#fff",border:"none",
          borderRadius:8,padding:"9px 22px",fontSize:13,fontWeight:600,
          cursor:"pointer",fontFamily:"inherit"}}>Back to Topics</button>
      </div>
    );
  }

  if (started) {
    const qx=pool[qi];
    return (
      <div style={{flex:1,overflowY:"auto",padding:"16px 20px"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
          <button onClick={reset} style={{background:"none",border:"1px solid #E2E8F0",
            borderRadius:7,padding:"4px 10px",fontSize:12,cursor:"pointer",
            color:"#64748B",fontFamily:"inherit"}}>Topics</button>
          <div style={{display:"flex",gap:6}}>
            <span style={{background:"#F5F3FF",color:"#7C3AED",fontSize:11,
              padding:"3px 9px",borderRadius:20,fontWeight:600}}>Q {qi+1}/{pool.length}</span>
            <span style={{background:"#EEF2FF",color:"#4F46E5",fontSize:11,
              padding:"3px 9px",borderRadius:20,fontWeight:600}}>Score: {score}</span>
          </div>
        </div>
        <div style={{background:"#F1F5F9",borderRadius:99,height:5,marginBottom:16}}>
          <div style={{background:"#7C3AED",borderRadius:99,height:"100%",
            width:((qi+(sel!==null?1:0))/pool.length*100)+"%",transition:"width .3s"}}/>
        </div>
        <div style={{background:"#fff",border:"1px solid #E2E8F0",borderRadius:12,
          padding:"14px 16px",marginBottom:12}}>
          <p style={{margin:0,fontSize:14,fontWeight:600,lineHeight:1.5}}>{qx.q}</p>
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:7,marginBottom:12}}>
          {qx.opts.map(function(opt,i){
            let bg="#fff",bdr="1px solid #E2E8F0",col="#1E293B";
            if (sel!==null) {
              if(i===qx.ans){bg="#ECFDF5";bdr="1px solid #6EE7B7";col="#065F46";}
              else if(i===sel){bg="#FEF2F2";bdr="1px solid #FCA5A5";col="#B91C1C";}
            }
            const lt=String.fromCharCode(65+i);
            return (
              <button key={i} onClick={function(){pick(i);}} disabled={sel!==null}
                style={{background:bg,border:bdr,color:col,borderRadius:9,
                  padding:"9px 13px",fontSize:13,textAlign:"left",
                  cursor:sel!==null?"default":"pointer",fontFamily:"inherit",
                  display:"flex",alignItems:"center",gap:9}}>
                <span style={{width:21,height:21,borderRadius:"50%",
                  background:sel===null?"#F1F5F9":i===qx.ans?"#DCFCE7":i===sel?"#FEE2E2":"#F1F5F9",
                  display:"flex",alignItems:"center",justifyContent:"center",
                  flexShrink:0,fontSize:10,fontWeight:700,
                  color:sel===null?"#64748B":i===qx.ans?"#16A34A":i===sel?"#DC2626":"#64748B"}}>
                  {sel!==null?(i===qx.ans?"✓":i===sel?"✗":lt):lt}
                </span>
                {opt}
              </button>
            );
          })}
        </div>
        {sel!==null && (
          <div style={{background:"#F8FAFC",border:"1px solid #E2E8F0",borderRadius:9,
            padding:"10px 13px",marginBottom:12,fontSize:12.5,color:"#475569",lineHeight:1.6}}>
            <strong style={{color:"#0F172A"}}>Explanation: </strong>{qx.exp}
          </div>
        )}
        {sel!==null && (
          <button onClick={next} style={{background:"#7C3AED",color:"#fff",border:"none",
            borderRadius:8,padding:"8px 18px",fontSize:13,fontWeight:600,
            cursor:"pointer",fontFamily:"inherit"}}>
            {qi<pool.length-1?"Next":"Results 🎉"}
          </button>
        )}
      </div>
    );
  }

  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <div style={{padding:"12px 18px",background:"#fff",
        borderBottom:"1px solid #E2E8F0",flexShrink:0}}>
        <div style={{display:"flex",gap:8,alignItems:"center",background:"#F8FAFC",
          borderRadius:10,border:"1.5px solid #E2E8F0",padding:"7px 12px",marginBottom:8}}>
          <span style={{fontSize:15}}>🔍</span>
          <input value={q} onChange={function(e){setQ(e.target.value);}}
            placeholder="Search quiz topics..."
            style={{flex:1,background:"transparent",border:"none",outline:"none",
              fontSize:13,color:"#1E293B",fontFamily:"inherit"}}/>
          {q&&<button onClick={function(){setQ("");}} style={{background:"none",
            border:"none",cursor:"pointer",color:"#94A3B8",fontSize:13,padding:0}}>X</button>}
        </div>
        <div style={{display:"flex",gap:5,flexWrap:"wrap",alignItems:"center"}}>
          {QTAGS.map(function(t){
            return (
              <button key={t} onClick={function(){setTag(t);}}
                style={{background:tag===t?"#7C3AED":"#F1F5F9",
                  color:tag===t?"#fff":"#64748B",border:"none",borderRadius:20,
                  padding:"3px 10px",fontSize:11,fontWeight:tag===t?600:400,
                  cursor:"pointer",fontFamily:"inherit"}}>{t}</button>
            );
          })}
          <span style={{marginLeft:"auto",color:"#94A3B8",fontSize:11}}>
            {fq.length} questions
          </span>
        </div>
      </div>
      <div style={{flex:1,overflowY:"auto",padding:"14px 18px"}}>
        <div style={{display:"flex",alignItems:"center",
          justifyContent:"space-between",marginBottom:12}}>
          <div>
            <h2 style={{margin:"0 0 3px",fontSize:15,fontWeight:700}}>MA Knowledge Quiz</h2>
            <p style={{margin:0,fontSize:12,color:"#64748B"}}>
              {fq.length} question{fq.length!==1?"s":""} available
            </p>
          </div>
          <button onClick={start} disabled={fq.length===0}
            style={{background:fq.length===0?"#E2E8F0":"#7C3AED",
              color:fq.length===0?"#94A3B8":"#fff",border:"none",borderRadius:8,
              padding:"8px 18px",fontSize:13,fontWeight:600,
              cursor:fq.length===0?"not-allowed":"pointer",fontFamily:"inherit"}}>
            Start Quiz
          </button>
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:7}}>
          {fq.map(function(qx,i){
            return (
              <div key={i} style={{background:"#fff",border:"1px solid #E2E8F0",
                borderRadius:10,padding:"10px 13px",display:"flex",
                alignItems:"center",gap:9}}>
                <span style={{width:22,height:22,borderRadius:"50%",background:"#F5F3FF",
                  display:"flex",alignItems:"center",justifyContent:"center",
                  fontSize:11,fontWeight:700,color:"#7C3AED",flexShrink:0}}>{i+1}</span>
                <p style={{margin:0,fontSize:13,color:"#1E293B",lineHeight:1.4,flex:1}}>
                  {qx.q}
                </p>
                <span style={{background:"#F5F3FF",color:"#7C3AED",fontSize:9.5,
                  padding:"2px 6px",borderRadius:10,fontWeight:600,flexShrink:0}}>
                  {qx.tag}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Copilot({payor, db}) {
  const [coll,setColl]=useState(false);
  const [inp,setInp]=useState("");
  const endRef=useRef(null);
  const sys="You are the HWAI Copilot - HealthWorksAI embedded MA intelligence. User from "
    +payor.label+". "+db.ctx+" PY2026: 15,955 plans, 72.5% zero-premium, avg star 3.81.";
  const welcome="I am your **HWAI Copilot** for **"+db.label
    +"**.\n\n"+db.desc+"\n\nPick a question below or ask your own.";
  const {msgs,busy,err,setErr,send}=useChat(sys,welcome);
  useEffect(function(){endRef.current&&endRef.current.scrollIntoView({behavior:"smooth"});},[msgs]);
  if (coll) return (
    <div onClick={function(){setColl(false);}}
      style={{width:32,background:"#0F172A",borderLeft:"1px solid #1E293B",
        display:"flex",flexDirection:"column",alignItems:"center",
        paddingTop:10,flexShrink:0,cursor:"pointer"}}>
      <span style={{fontSize:14,marginBottom:5}}>🤖</span>
      <div style={{color:"#334155",fontSize:8,letterSpacing:".08em",
        textTransform:"uppercase",transform:"rotate(180deg)",
        fontFamily:"inherit",writingMode:"vertical-rl",userSelect:"none"}}>
        HWAI Copilot
      </div>
    </div>
  );
  return (
    <div style={{width:280,minWidth:240,background:"#fff",
      borderLeft:"1px solid #E2E8F0",display:"flex",flexDirection:"column",flexShrink:0}}>
      <div style={{padding:"9px 11px",background:"#0F172A",
        borderBottom:"2px solid "+db.catColor,flexShrink:0,
        display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div style={{display:"flex",alignItems:"center",gap:6}}>
          <span style={{fontSize:14}}>🤖</span>
          <div>
            <div style={{color:"#F1F5F9",fontWeight:700,fontSize:12,lineHeight:1.2}}>
              HWAI Copilot
            </div>
            <div style={{color:"#475569",fontSize:9,marginTop:1}}>{C.co}</div>
          </div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:4}}>
          <span style={{background:db.catColor+"22",color:db.catColor,fontSize:9,
            padding:"2px 6px",borderRadius:20,fontWeight:600}}>{db.label}</span>
          <button onClick={function(){setColl(true);}} style={{background:"none",border:"none",
            cursor:"pointer",color:"#475569",fontSize:14,padding:"1px 3px",lineHeight:1}}>
            &#8249;
          </button>
        </div>
      </div>
      <div style={{flex:1,overflowY:"auto",padding:"9px 9px 5px",
        display:"flex",flexDirection:"column",gap:6}}>
        {msgs.map(function(msg){
          const isU=msg.role==="user";
          return (
            <div key={msg.id} style={{display:"flex",
              flexDirection:isU?"row-reverse":"row",gap:5,
              alignItems:"flex-start",maxWidth:"96%",
              alignSelf:isU?"flex-end":"flex-start"}}>
              <div style={{width:20,height:20,borderRadius:"50%",flexShrink:0,
                background:isU?db.catColor:"#1E293B",display:"flex",
                alignItems:"center",justifyContent:"center",fontSize:9,color:"#fff"}}>
                {isU?"👤":"🤖"}
              </div>
              <div style={{flex:1,minWidth:0}}>
                {!isU&&msg.tools&&msg.tools.map(function(t,i){
                  return <Chip key={i} name={t.name} result={t.result}/>;
                })}
                <div style={{background:isU?db.catColor:"#F8FAFC",
                  color:isU?"#fff":"#1E293B",padding:"6px 8px",
                  borderRadius:isU?"9px 2px 9px 9px":"2px 9px 9px 9px",
                  border:isU?"none":"1px solid #E2E8F0",lineHeight:1.55,fontSize:12}}>
                  {msg.loading
                    ? <span style={{color:"#94A3B8",display:"flex",
                        alignItems:"center",gap:5,fontSize:11}}><Dots/>Thinking...</span>
                    : <div dangerouslySetInnerHTML={{__html:mdHtml(msg.content)}}/>
                  }
                </div>
              </div>
            </div>
          );
        })}
        {err&&<div style={{background:"#FEF2F2",border:"1px solid #FECACA",
          borderRadius:6,padding:"5px 8px",color:"#B91C1C",fontSize:11}}>
          Error: {err}
          <button onClick={function(){setErr(null);}} style={{marginLeft:6,background:"none",
            border:"none",cursor:"pointer",color:"#B91C1C"}}>X</button>
        </div>}
        {msgs.length<=2&&db.qs&&db.qs.length>0&&(
          <div style={{padding:"3px 0"}}>
            <div style={{color:"#94A3B8",fontSize:9,fontWeight:600,
              textTransform:"uppercase",letterSpacing:".08em",marginBottom:4}}>
              Quick Questions
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:3}}>
              {db.qs.map(function(qs,i){
                return (
                  <button key={i} onClick={function(){send(qs);}}
                    style={{background:"#F8FAFC",
                      border:"1px solid "+db.catColor+"22",borderRadius:6,
                      padding:"4px 7px",fontSize:10.5,color:"#374151",cursor:"pointer",
                      textAlign:"left",fontFamily:"inherit",lineHeight:1.35}}>
                    {qs}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <div ref={endRef}/>
      </div>
      <div style={{padding:"6px 9px",borderTop:"1px solid #E2E8F0",
        background:"#FAFAFA",flexShrink:0}}>
        <div style={{display:"flex",gap:4,alignItems:"flex-end",background:"#fff",
          borderRadius:8,border:"1.5px solid "+(busy?db.catColor+"88":"#E2E8F0"),
          padding:"4px 7px"}}>
          <textarea value={inp} onChange={function(e){setInp(e.target.value);}}
            disabled={busy} rows={1} placeholder="Ask about this dashboard..."
            onKeyDown={function(e){
              if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send(inp);setInp("");}
            }}
            style={{flex:1,background:"transparent",border:"none",outline:"none",
              resize:"none",fontSize:12,color:"#1E293B",fontFamily:"inherit",
              lineHeight:1.4,maxHeight:60,overflowY:"auto"}}
            onInput={function(e){
              e.target.style.height="auto";
              e.target.style.height=Math.min(e.target.scrollHeight,60)+"px";
            }}
          />
          <button onClick={function(){send(inp);setInp("");}}
            disabled={busy||!inp.trim()}
            style={{background:busy||!inp.trim()?"#E2E8F0":db.catColor,
              color:busy||!inp.trim()?"#94A3B8":"#fff",border:"none",borderRadius:6,
              padding:"4px 8px",cursor:busy||!inp.trim()?"not-allowed":"pointer",
              fontWeight:700,fontSize:12,flexShrink:0,fontFamily:"inherit"}}>
            {busy?"...":"Go"}
          </button>
        </div>
      </div>
    </div>
  );
}

function DBView({db, payor}) {
  const [ifrErr,setIfrErr]=useState(false);
  const [loading,setLoading]=useState(true);
  return (
    <div style={{flex:1,display:"flex",overflow:"hidden"}}>
      <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
        <div style={{padding:"8px 14px",background:"#fff",
          borderBottom:"1px solid #E2E8F0",display:"flex",
          alignItems:"center",gap:8,flexShrink:0}}>
          <span style={{fontSize:17}}>{db.icon}</span>
          <div>
            <div style={{fontWeight:700,fontSize:13,lineHeight:1.2}}>{db.label}</div>
            <div style={{fontSize:11,color:"#94A3B8",marginTop:1}}>
              {db.cat} - {db.desc}
            </div>
          </div>
          <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:6}}>
            <span style={{background:db.catColor+"15",color:db.catColor,fontSize:11,
              padding:"2px 8px",borderRadius:20,fontWeight:600,
              border:"1px solid "+db.catColor+"33"}}>{db.cat}</span>
            <div style={{display:"flex",alignItems:"center",gap:3}}>
              <div style={{width:6,height:6,borderRadius:"50%",
                background:loading?"#F59E0B":"#10B981"}}/>
              <span style={{color:"#94A3B8",fontSize:11}}>{loading?"Loading...":"Live"}</span>
            </div>
          </div>
        </div>
        <div style={{flex:1,position:"relative",overflow:"hidden"}}>
          {loading&&!ifrErr&&(
            <div style={{position:"absolute",inset:0,display:"flex",
              flexDirection:"column",alignItems:"center",justifyContent:"center",
              background:"#F8FAFC",zIndex:2}}>
              <div style={{fontSize:34,marginBottom:10}}>{db.icon}</div>
              <div style={{fontWeight:600,fontSize:14,marginBottom:5}}>
                Loading {db.label}
              </div>
              <div style={{color:"#94A3B8",fontSize:11,marginBottom:18,
                maxWidth:300,textAlign:"center",wordBreak:"break-all"}}>{db.url}</div>
              <div style={{display:"flex",gap:5}}>
                {[0,1,2,3].map(function(i){
                  return (
                    <div key={i} style={{width:7,height:7,borderRadius:"50%",
                      background:"#4F46E5",opacity:.3,
                      animation:"pp 1.2s ease-in-out "+(i*.15)+"s infinite"}}/>
                  );
                })}
              </div>
              <style>{"@keyframes pp{0%,60%,100%{opacity:.3;transform:scale(1)}30%{opacity:1;transform:scale(1.2)}}"}</style>
            </div>
          )}
          {ifrErr?(
            <div style={{position:"absolute",inset:0,display:"flex",
              flexDirection:"column",alignItems:"center",justifyContent:"center",
              background:"#F8FAFC",padding:30}}>
              <div style={{fontSize:36,marginBottom:10}}>🔒</div>
              <div style={{fontWeight:700,fontSize:14,marginBottom:7}}>
                Dashboard Blocked by Browser
              </div>
              <div style={{color:"#64748B",fontSize:12,textAlign:"center",
                maxWidth:360,lineHeight:1.7,marginBottom:16}}>
                Cannot embed due to X-Frame-Options / CORS policy.
                Add Content-Security-Policy headers to fix.
              </div>
              <a href={db.url} target="_blank" rel="noreferrer"
                style={{background:"#4F46E5",color:"#fff",padding:"7px 16px",
                  borderRadius:8,fontSize:12.5,fontWeight:600,textDecoration:"none"}}>
                Open in New Tab
              </a>
            </div>
          ):(
            <iframe key={db.id} src={db.url} title={db.label}
              onLoad={function(){setLoading(false);}}
              onError={function(){setLoading(false);setIfrErr(true);}}
              style={{width:"100%",height:"100%",border:"none",display:"block"}}
              allow="fullscreen"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
            />
          )}
        </div>
      </div>
      <Copilot key={db.id} payor={payor} db={db}/>
    </div>
  );
}

function PayorLogin({onSelect}) {
  const [hov,setHov]=useState(null);
  return (
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",
      justifyContent:"center",height:"100vh",background:"#0F172A",padding:32}}>
      <div style={{color:"#38BDF8",fontWeight:700,fontSize:11,
        letterSpacing:".14em",textTransform:"uppercase",marginBottom:8}}>
        {C.co}
      </div>
      <h1 style={{color:"#F1F5F9",fontSize:26,fontWeight:800,
        margin:"0 0 6px",letterSpacing:"-.02em"}}>{C.name}</h1>
      <p style={{color:"#475569",fontSize:13,marginBottom:32,textAlign:"center"}}>
        Medicare Advantage Market and Product Intelligence - PY2026
      </p>
      <div style={{background:"#1E293B",borderRadius:16,padding:24,
        maxWidth:480,width:"100%"}}>
        <p style={{color:"#94A3B8",fontSize:12,textAlign:"center",
          margin:"0 0 16px",fontWeight:500}}>
          Select your organization to continue
        </p>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
          {PAYORS.map(function(p){
            return (
              <button key={p.id} onClick={function(){onSelect(p);}}
                onMouseEnter={function(){setHov(p.id);}}
                onMouseLeave={function(){setHov(null);}}
                style={{display:"flex",alignItems:"center",gap:10,padding:"10px 13px",
                  background:hov===p.id?"#334155":"#0F172A",
                  border:"1px solid "+(hov===p.id?"#475569":"#1E293B"),
                  borderRadius:9,cursor:"pointer",fontFamily:"inherit",
                  transition:"all .15s",textAlign:"left"}}>
                <span style={{width:30,height:30,borderRadius:"50%",background:p.color,
                  display:"flex",alignItems:"center",justifyContent:"center",
                  fontSize:13,fontWeight:800,color:"#fff",flexShrink:0}}>{p.logo}</span>
                <span style={{color:"#E2E8F0",fontSize:12.5,fontWeight:500}}>
                  {p.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Sidebar({payor, aDB, aTool, onDB, onTool, onSwitch, coll, onToggle}) {
  const [exp,setExp]=useState({"Market Intelligence":true,"Product Intelligence":true});
  function togCat(c){setExp(function(e){return Object.assign({},e,{[c]:!e[c]});});}

  if (coll) return (
    <aside style={{width:38,background:"#0F172A",display:"flex",flexDirection:"column",
      alignItems:"center",flexShrink:0,borderRight:"1px solid #1E293B"}}>
      <button onClick={onToggle} title="Expand"
        style={{width:"100%",padding:"11px 0",background:"transparent",border:"none",
          borderBottom:"1px solid #1E293B",cursor:"pointer",color:"#94A3B8",
          fontSize:15,display:"flex",alignItems:"center",justifyContent:"center"}}>
        &#9776;
      </button>
      <div style={{flex:1,display:"flex",flexDirection:"column",
        alignItems:"center",gap:3,paddingTop:8}}>
        {NAV.flatMap(function(g){return g.items;}).map(function(db){
          const isA=aDB&&aDB.id===db.id;
          const grp=NAV.find(function(g){return g.items.some(function(i){return i.id===db.id;});});
          return (
            <button key={db.id} title={db.label}
              onClick={function(){onDB(Object.assign({},db,{cat:grp.cat,catColor:grp.color}));}}
              style={{width:28,height:28,borderRadius:6,
                background:isA?(grp?grp.color:"#4F46E5"):"transparent",
                border:"none",cursor:"pointer",display:"flex",
                alignItems:"center",justifyContent:"center",fontSize:13}}>
              {db.icon}
            </button>
          );
        })}
        <div style={{borderTop:"1px solid #1E293B",width:"100%",margin:"2px 0"}}/>
        {TOOLS.map(function(t){
          const isA=aTool&&aTool.id===t.id&&!aDB;
          return (
            <button key={t.id} title={t.label} onClick={function(){onTool(t);}}
              style={{width:28,height:28,borderRadius:6,
                background:isA?t.color:"transparent",border:"none",cursor:"pointer",
                display:"flex",alignItems:"center",justifyContent:"center",fontSize:13}}>
              {t.icon}
            </button>
          );
        })}
      </div>
    </aside>
  );

  return (
    <aside style={{width:210,background:"#0F172A",display:"flex",flexDirection:"column",
      flexShrink:0,overflowY:"auto"}}>
      <div style={{padding:"13px 12px 9px",borderBottom:"1px solid #1E293B",
        flexShrink:0,display:"flex",alignItems:"flex-start",justifyContent:"space-between"}}>
        <div>
          <div style={{color:"#38BDF8",fontWeight:700,fontSize:8.5,
            letterSpacing:".14em",textTransform:"uppercase"}}>{C.co}</div>
          <div style={{color:"#F1F5F9",fontWeight:800,fontSize:13,
            marginTop:2,lineHeight:1.2}}>{C.name}</div>
          <div style={{color:"#475569",fontSize:9,marginTop:2}}>PY2026 - CA - FL - TX</div>
        </div>
        <button onClick={onToggle} title="Collapse"
          style={{background:"transparent",border:"none",cursor:"pointer",
            color:"#475569",fontSize:13,padding:2,marginTop:1,lineHeight:1}}>
          &#8249;&#8249;
        </button>
      </div>
      <div style={{padding:"9px 12px",borderBottom:"1px solid #1E293B",flexShrink:0}}>
        <div style={{color:"#475569",fontSize:8.5,fontWeight:600,
          textTransform:"uppercase",letterSpacing:".1em",marginBottom:5}}>
          Logged In As
        </div>
        <div style={{display:"flex",alignItems:"center",gap:6,background:"#1E293B",
          borderRadius:7,padding:"6px 8px"}}>
          <span style={{width:24,height:24,borderRadius:"50%",background:payor.color,
            display:"flex",alignItems:"center",justifyContent:"center",
            fontSize:10,fontWeight:800,color:"#fff",flexShrink:0}}>{payor.logo}</span>
          <div style={{flex:1,minWidth:0}}>
            <div style={{color:"#F1F5F9",fontSize:11,fontWeight:600,lineHeight:1.2,
              whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{payor.label}</div>
            <div style={{color:"#475569",fontSize:9,marginTop:1}}>Payor User</div>
          </div>
          <button onClick={onSwitch} title="Switch"
            style={{background:"transparent",border:"none",color:"#475569",
              cursor:"pointer",fontSize:10,padding:1,flexShrink:0}}>
            &#x21A9;
          </button>
        </div>
      </div>
      <div style={{flex:1,overflowY:"auto",padding:"9px 12px"}}>
        {NAV.map(function(group){
          return (
            <div key={group.cat} style={{marginBottom:3}}>
              <button onClick={function(){togCat(group.cat);}}
                style={{display:"flex",alignItems:"center",justifyContent:"space-between",
                  width:"100%",padding:"4px 5px",background:"transparent",border:"none",
                  cursor:"pointer",fontFamily:"inherit",marginBottom:2}}>
                <div style={{display:"flex",alignItems:"center",gap:4}}>
                  <span style={{fontSize:11}}>{group.catIcon}</span>
                  <span style={{color:exp[group.cat]?group.color:"#475569",fontSize:9,
                    fontWeight:700,textTransform:"uppercase",letterSpacing:".07em"}}>
                    {group.cat}
                  </span>
                </div>
                <span style={{color:"#334155",fontSize:7,opacity:.5}}>
                  {exp[group.cat]?"▲":"▼"}
                </span>
              </button>
              {exp[group.cat]&&group.items.map(function(db){
                const isA=aDB&&aDB.id===db.id;
                return (
                  <button key={db.id}
                    onClick={function(){onDB(Object.assign({},db,{cat:group.cat,catColor:group.color}));}}
                    style={{display:"flex",alignItems:"center",gap:6,width:"100%",
                      padding:"6px 7px",marginBottom:1,borderRadius:7,border:"none",
                      cursor:"pointer",fontFamily:"inherit",
                      background:isA?group.color+"20":"transparent",
                      borderLeft:isA?"2px solid "+group.color:"2px solid transparent",
                      textAlign:"left",transition:"all .15s"}}>
                    <span style={{fontSize:12}}>{db.icon}</span>
                    <span style={{fontSize:11,fontWeight:isA?700:400,
                      color:isA?group.color:"#94A3B8",whiteSpace:"nowrap",
                      overflow:"hidden",textOverflow:"ellipsis"}}>{db.label}</span>
                    {isA&&<div style={{marginLeft:"auto",width:4,height:4,
                      borderRadius:"50%",background:group.color,flexShrink:0}}/>}
                  </button>
                );
              })}
            </div>
          );
        })}
        <div style={{borderTop:"1px solid #1E293B",margin:"6px 0",opacity:.4}}/>
        <div style={{color:"#475569",fontSize:8.5,fontWeight:600,
          textTransform:"uppercase",letterSpacing:".1em",marginBottom:5,padding:"0 5px"}}>
          Tools
        </div>
        {TOOLS.map(function(t){
          const isA=aTool&&aTool.id===t.id&&!aDB;
          return (
            <button key={t.id} onClick={function(){onTool(t);}}
              style={{display:"flex",alignItems:"center",gap:6,width:"100%",
                padding:"6px 7px",marginBottom:1,borderRadius:7,border:"none",
                cursor:"pointer",fontFamily:"inherit",
                background:isA?t.color+"20":"transparent",
                borderLeft:isA?"2px solid "+t.color:"2px solid transparent",
                textAlign:"left",transition:"all .15s"}}>
              <span style={{fontSize:12}}>{t.icon}</span>
              <span style={{fontSize:11,fontWeight:isA?700:400,
                color:isA?t.color:"#94A3B8"}}>{t.label}</span>
              {isA&&<div style={{marginLeft:"auto",width:4,height:4,
                borderRadius:"50%",background:t.color,flexShrink:0}}/>}
            </button>
          );
        })}
      </div>
      <div style={{padding:"7px 12px",borderTop:"1px solid #1E293B",
        color:"#334155",fontSize:9,flexShrink:0}}>
        <div>Real CMS data - CA - FL - TX</div>
        <div style={{marginTop:1}}>v{C.ver} - {C.co}</div>
      </div>
    </aside>
  );
}

export default function App() {
  const [payor,setPayor]=useState(null);
  const [aDB,setADB]=useState(null);
  const [aTool,setATool]=useState(TOOLS[0]);
  const [sbColl,setSbColl]=useState(false);
  function selDB(db){setADB(db);setATool(null);}
  function selTool(t){setATool(t);setADB(null);}
  function doSwitch(){setPayor(null);setADB(null);setATool(TOOLS[0]);}

  if (!payor) return <PayorLogin onSelect={function(p){setPayor(p);}} />;

  return (
    <div style={{display:"flex",height:"100vh",
      fontFamily:"'Inter',system-ui,sans-serif",
      fontSize:14,overflow:"hidden",background:"#F8FAFC"}}>
      <GStyle/>
      <Sidebar payor={payor} aDB={aDB} aTool={aTool}
        onDB={selDB} onTool={selTool} onSwitch={doSwitch}
        coll={sbColl} onToggle={function(){setSbColl(function(c){return !c;});}}
      />
      <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
        <div style={{padding:"8px 14px",background:"#fff",
          borderBottom:"1px solid #E2E8F0",display:"flex",
          alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
          <div style={{display:"flex",alignItems:"center",gap:7}}>
            {aDB&&(
              <>
                <span style={{fontSize:14}}>{aDB.icon}</span>
                <span style={{fontWeight:700,fontSize:13}}>{aDB.label}</span>
                <span style={{color:"#CBD5E1",fontSize:12}}>-</span>
                <span style={{color:"#94A3B8",fontSize:12}}>{aDB.cat}</span>
                <span style={{background:"#F5F3FF",color:"#7C3AED",fontSize:10,
                  padding:"2px 7px",borderRadius:20,fontWeight:600,marginLeft:3}}>
                  🤖 HWAI Copilot active
                </span>
              </>
            )}
            {aTool&&!aDB&&(
              <>
                <span style={{fontSize:14}}>{aTool.icon}</span>
                <span style={{fontWeight:700,fontSize:13}}>{aTool.label}</span>
              </>
            )}
          </div>
          <div style={{display:"flex",alignItems:"center",gap:3}}>
            <div style={{width:6,height:6,borderRadius:"50%",background:"#10B981"}}/>
            <span style={{color:"#64748B",fontSize:11}}>15,955 plans - CA FL TX - PY2026</span>
          </div>
        </div>
        <div style={{flex:1,overflow:"hidden",display:"flex",flexDirection:"column"}}>
          {aDB
            ? <DBView key={aDB.id} db={aDB} payor={payor}/>
            : aTool&&aTool.id==="queries"   ? <QueriesPanel   payor={payor}/>
            : aTool&&aTool.id==="reporting" ? <ReportingPanel payor={payor}/>
            : aTool&&aTool.id==="downloads" ? <DownloadsPanel/>
            : aTool&&aTool.id==="news"      ? <NewsPanel/>
            : aTool&&aTool.id==="quiz"      ? <QuizPanel/>
            : null
          }
        </div>
      </div>
    </div>
  );
}
