import React, { useState, useRef, useEffect } from "react";
import {
  Mic, Upload, FileText, MessageSquare, BarChart3, Archive,
  Square, Download, Trash2, ChevronRight, CheckCircle2, Clock,
  Sparkles, FileDown, Settings, X, Eye, EyeOff,
  Loader2, AlertCircle, Key, Zap, ShieldCheck, RefreshCw
} from "lucide-react";
import { RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, ResponsiveContainer } from "recharts";

// ── Color tokens ─────────────────────────────────────────────────────────
const C = {
  cream:"#F5F1EA", paper:"#FAF7F0", tan:"#E8DFD0", tan2:"#D4C8B5",
  ink:"#1A1814", ink60:"#5C5750", ink40:"#9A938A",
  shu:"#B8412C", shu2:"#8A2E1C", shu10:"rgba(184,65,44,0.09)",
  koke:"#4A6B47", koke2:"#2F4730", koke10:"rgba(74,107,71,0.11)", koke30:"rgba(74,107,71,0.28)",
  amber10:"rgba(193,154,75,0.11)", amberT:"#8B6F2F", amber:"#C19A4B",
};
const F = { min:"'Shippori Mincho B1', serif", sans:"'Noto Sans JP', sans-serif" };
const MODELS = [
  { id:"gemini-2.0-flash", label:"Gemini 2.0 Flash", desc:"高速・無料枠あり" },
  { id:"gemini-2.5-flash", label:"Gemini 2.5 Flash", desc:"バランス型・推奨" },
  { id:"gemini-2.5-pro",   label:"Gemini 2.5 Pro",   desc:"高精度・複雑分析向け" },
];
const SEV = {
  high:  { dot:C.shu,    bg:C.shu10,  textColor:C.shu,    label:"重要" },
  medium:{ dot:C.amber,  bg:C.amber10,textColor:C.amberT, label:"注意" },
  low:   { dot:C.koke,   bg:C.koke10, textColor:C.koke2,  label:"良い点" },
};
const scoreColor = (s) => s>=80 ? C.koke : s>=70 ? C.amberT : C.shu;

// ── Gemini API ────────────────────────────────────────────────────────────
async function geminiText({ apiKey, model, prompt, json=false, maxTokens=4096 }) {
  const url=`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = {
    contents:[{ parts:[{ text:prompt }] }],
    generationConfig:{ maxOutputTokens:maxTokens, temperature:0.3, ...(json?{ responseMimeType:"application/json" }:{}) },
  };
  const res=await fetch(url,{ method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(body) });
  const data=await res.json();
  if(!res.ok) throw new Error(data?.error?.message||`HTTP ${res.status}`);
  const text=data?.candidates?.[0]?.content?.parts?.[0]?.text||"";
  if(json){
    let cleaned=text.trim().replace(/^```json\s*/i,"").replace(/^```\s*/,"").replace(/```\s*$/,"");
    return JSON.parse(cleaned);
  }
  return text;
}

async function geminiAudio({ apiKey, model, file, prompt, maxTokens=8192 }) {
  // Convert file to base64
  const b64 = await new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result.split(",")[1]);
    r.onerror = () => rej(new Error("ファイル読み込みに失敗しました"));
    r.readAsDataURL(file);
  });
  const url=`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = {
    contents:[{ parts:[
      { inline_data:{ mime_type:file.type||"audio/mpeg", data:b64 } },
      { text:prompt }
    ] }],
    generationConfig:{ maxOutputTokens:maxTokens, temperature:0.2 },
  };
  const res=await fetch(url,{ method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(body) });
  const data=await res.json();
  if(!res.ok) throw new Error(data?.error?.message||`HTTP ${res.status}`);
  return data?.candidates?.[0]?.content?.parts?.[0]?.text||"";
}

// ── Prompts ───────────────────────────────────────────────────────────────
const TRANSCRIBE_PROMPT = `この音声は日本語の面接です。発話を全て聞き取り、面接官と志望者を分けて文字起こししてください。

出力フォーマット（JSONのみ。前置き・コードブロック不要）:
{
  "transcript": [
    { "speaker": "interviewer" または "candidate", "text": "発話内容", "time": "MM:SS形式の開始時刻" }
  ]
}

- フィラー（「えーと」「あの」など）も省略せず書き起こす
- 沈黙は無視
- 質問・問いかけは interviewer、それに対する回答は candidate と判断`;

const QA_PROMPT = (transcript, company, type) => `以下は面接の文字起こしです。面接官の質問と志望者の回答のペアを抽出してください。

【面接情報】
- 会社名: ${company || "(未指定)"}
- 面接種別: ${type}

【文字起こし】
${transcript}

出力フォーマット（JSONのみ。コードブロック不要）:
{
  "qaList": [
    {
      "id": "q-001",
      "category": "自己紹介|志望動機|学生時代の経験|職務経験|スキル|キャリアビジョン|逆質問|その他 から1つ",
      "question": "面接官の質問(原文に近い形で)",
      "answer": "志望者の回答(原文に近い形で)",
      "answerSummary": "回答を2〜3文で要約",
      "keyPoints": ["要点1", "要点2", "要点3"],
      "delay": 応答遅延の推定秒数(数値,不明ならnull),
      "fillerCount": フィラー(えーと等)の概算回数(数値)
    }
  ]
}`;

const FEEDBACK_PROMPT = (qaList, company, type) => `あなたは10年以上の面接指導経験を持つ就職コーチです。以下の面接Q&Aを5軸で厳密かつ建設的に分析してください。

【面接情報】
- 会社名: ${company || "(未指定)"}
- 面接種別: ${type}

【Q&Aリスト(JSON)】
${JSON.stringify(qaList, null, 2)}

【分析軸】
1. 応答速度・流暢性(responseSpeed): 応答遅延、フィラー頻度、テンポ
2. 回答の適切性・網羅性(appropriateness): 質問への的確さ、具体性、長さ
3. 一貫性・矛盾検出(consistency): 回答間の論理的整合性、矛盾の有無
4. 論理的思考力(logicalThinking): PREP法・STAR法の構造、因果関係の明確さ
5. 総合印象(overall): 熱意・誠実さ、企業研究の深さ

【特に重視する点】
- 各回答間に矛盾や不整合がないか(横断比較)
- ロジックの飛躍・根拠不足
- 質問の意図と回答のズレ
- 抽象的すぎる回答

出力フォーマット(JSONのみ。コードブロック不要):
{
  "scores": {
    "responseSpeed": 0〜100の整数,
    "appropriateness": 0〜100の整数,
    "consistency": 0〜100の整数,
    "logicalThinking": 0〜100の整数,
    "overall": 0〜100の整数
  },
  "items": [
    {
      "id": "fb-001",
      "sev": "high|medium|low",
      "qid": "対象質問ID(例:q-001)またはnull",
      "title": "指摘タイトル(15字以内)",
      "issue": "問題点の具体説明(100〜200字)",
      "advice": "改善アドバイス(100〜200字)",
      "eg": "模範回答例(任意。200〜400字または null)"
    }
  ],
  "strengths": ["評価できる点1", "評価できる点2", "評価できる点3"],
  "topPriority": "最優先で改善すべき点(150字以内)"
}`;

// ── Helpers ───────────────────────────────────────────────────────────────
const KamonStripe = () => (
  <div style={{ display:"flex", height:"3px", width:"100%" }}>
    <div style={{ flex:1, background:C.shu }}/>
    <div style={{ width:"40px", background:C.koke }}/>
    <div style={{ width:"14px", background:C.shu2 }}/>
    <div style={{ width:"6px", background:C.koke2 }}/>
  </div>
);
const DiamondBullet = ({ color }) => <span style={{ display:"inline-block", width:"10px", height:"10px", background:color, transform:"rotate(45deg)", flexShrink:0, marginTop:"3px" }}/>;
const SectionTitle = ({ color, label }) => (
  <div style={{ display:"flex", alignItems:"center", gap:"10px", marginBottom:"20px" }}>
    <DiamondBullet color={color}/>
    <span style={{ fontFamily:F.sans, fontSize:"11px", letterSpacing:"0.28em", color }}>{label}</span>
  </div>
);
const StepLabel = ({ num, title }) => (
  <div style={{ marginBottom:"32px" }}>
    <div style={{ display:"flex", alignItems:"center", gap:"12px", marginBottom:"10px" }}>
      <span style={{ fontFamily:F.sans, fontSize:"11px", letterSpacing:"0.12em", background:C.shu, color:C.cream, padding:"3px 10px" }}>{num}</span>
      <span style={{ color:C.koke, fontSize:"11px" }}>── ── ──</span>
    </div>
    <h2 style={{ fontFamily:F.min, fontSize:"1.875rem", color:C.ink, margin:0 }}>{title}</h2>
  </div>
);
const ScoreBar = ({ label, value, color }) => (
  <div style={{ display:"flex", alignItems:"center", gap:"14px" }}>
    <span style={{ fontFamily:F.sans, fontSize:"12px", color:C.ink60, width:"112px" }}>{label}</span>
    <div style={{ flex:1, height:"6px", borderRadius:"3px", background:C.tan, overflow:"hidden" }}>
      <div style={{ width:`${value}%`, height:"100%", background:color, borderRadius:"3px" }}/>
    </div>
    <span style={{ fontFamily:F.min, fontSize:"14px", color:C.ink, width:"36px", textAlign:"right" }}>{value}</span>
  </div>
);
const TabBtn = ({ active, onClick, Icon, label, num, disabled }) => (
  <button onClick={onClick} disabled={disabled} style={{
    position:"relative", display:"flex", alignItems:"center", gap:"8px", padding:"14px 20px",
    fontSize:"14px", fontFamily:F.sans, color:active?C.ink:disabled?C.ink40:C.ink60,
    background:"transparent", border:"none", cursor:disabled?"not-allowed":"pointer",
    transition:"color 0.2s", opacity:disabled?0.5:1,
  }}>
    <span style={{ fontSize:"11px", color:active?C.shu:C.ink40 }}>{num}</span>
    <Icon size={15} strokeWidth={1.5} style={{ color:active?C.shu:"inherit" }}/>
    <span style={{ fontWeight:500 }}>{label}</span>
    {active && <span style={{ position:"absolute", bottom:0, left:0, right:0, height:"2px", background:C.shu }}/>}
  </button>
);

// ── Settings Modal ────────────────────────────────────────────────────────
const SettingsModal = ({ open, onClose, apiKey, setApiKey, model, setModel }) => {
  const [tmp, setTmp]=useState(apiKey);
  const [tmpM, setTmpM]=useState(model);
  const [show, setShow]=useState(false);
  const [st, setSt]=useState("idle");
  const [msg, setMsg]=useState(""); const [resT, setResT]=useState("");

  useEffect(()=>{ if(open){setTmp(apiKey);setTmpM(model);setSt("idle");setMsg("");setResT("");} },[open]);

  const test=async()=>{
    if(!tmp.trim()){setSt("error");setMsg("APIキーを入力してください");return;}
    setSt("testing"); setMsg(""); setResT("");
    try { const r=await geminiText({apiKey:tmp.trim(),model:tmpM,prompt:"「接続テスト成功」と一言だけ返してください。",maxTokens:50});
      setSt("success"); setResT(r.trim()); setMsg("接続に成功しました");
    } catch(e){ setSt("error"); setMsg(e.message||"接続に失敗しました"); }
  };
  const save=async()=>{
    setApiKey(tmp.trim()); setModel(tmpM);
    try{await window.storage.set("gemini_api_key",tmp.trim());await window.storage.set("gemini_model",tmpM);}catch{}
    onClose();
  };
  if(!open) return null;

  return (
    <div style={{ position:"fixed",inset:0,zIndex:50,display:"flex",alignItems:"center",justifyContent:"center",padding:"16px",fontFamily:F.sans }}>
      <div style={{ position:"absolute",inset:0,background:"rgba(26,24,20,0.5)",backdropFilter:"blur(4px)" }} onClick={onClose}/>
      <div style={{ position:"relative",width:"100%",maxWidth:"520px",maxHeight:"90vh",overflowY:"auto",background:C.cream,border:`1px solid ${C.tan2}`,boxShadow:"0 24px 48px rgba(26,24,20,0.25)" }}>
        <KamonStripe/>
        <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",padding:"20px 28px",borderBottom:`1px solid ${C.tan2}` }}>
          <div>
            <p style={{ fontSize:"11px",letterSpacing:"0.3em",color:C.shu,marginBottom:"4px" }}>SETTINGS</p>
            <h3 style={{ fontFamily:F.min,fontSize:"1.25rem",color:C.ink,margin:0 }}>API設定</h3>
          </div>
          <button onClick={onClose} style={{ padding:"8px",color:C.ink60,background:"none",border:"none",cursor:"pointer" }}><X size={18} strokeWidth={1.5}/></button>
        </div>
        <div style={{ padding:"24px 28px",display:"flex",flexDirection:"column",gap:"24px" }}>
          <div style={{ padding:"14px 16px",display:"flex",gap:"12px",background:C.koke10,borderLeft:`3px solid ${C.koke}` }}>
            <ShieldCheck size={18} strokeWidth={1.5} style={{ color:C.koke,flexShrink:0,marginTop:"2px" }}/>
            <p style={{ fontSize:"12px",color:C.ink,lineHeight:1.7,margin:0 }}>
              APIキーはブラウザにのみ保存されます。<span style={{ color:C.shu }}>Google AI Studio</span> から取得できます。
            </p>
          </div>
          <div>
            <label style={{ display:"flex",alignItems:"center",gap:"6px",fontSize:"11px",letterSpacing:"0.25em",color:C.ink60,marginBottom:"8px" }}>
              <Key size={12} strokeWidth={1.5}/> GEMINI API KEY
            </label>
            <div style={{ position:"relative" }}>
              <input type={show?"text":"password"} value={tmp} onChange={e=>setTmp(e.target.value)} placeholder="AIza..."
                style={{ width:"100%",boxSizing:"border-box",padding:"12px 48px 12px 16px",fontSize:"13px",letterSpacing:"0.05em",
                  background:"transparent",border:`1px solid ${C.tan2}`,color:C.ink,outline:"none",fontFamily:F.sans }}
                onFocus={e=>e.target.style.borderColor=C.shu} onBlur={e=>e.target.style.borderColor=C.tan2}/>
              <button onClick={()=>setShow(!show)} style={{ position:"absolute",right:"12px",top:"50%",transform:"translateY(-50%)",background:"none",border:"none",color:C.ink60,cursor:"pointer" }}>
                {show?<EyeOff size={14}/>:<Eye size={14}/>}
              </button>
            </div>
          </div>
          <div>
            <label style={{ display:"flex",alignItems:"center",gap:"6px",fontSize:"11px",letterSpacing:"0.25em",color:C.ink60,marginBottom:"12px" }}>
              <Zap size={12} strokeWidth={1.5}/> MODEL
            </label>
            <div style={{ display:"flex",flexDirection:"column",gap:"8px" }}>
              {MODELS.map(m=>(
                <label key={m.id} style={{ display:"flex",alignItems:"flex-start",gap:"12px",padding:"12px 14px",cursor:"pointer",
                  border:`1px solid ${tmpM===m.id?C.shu:C.tan2}`,background:tmpM===m.id?C.ink:"transparent" }}>
                  <input type="radio" name="model" checked={tmpM===m.id} onChange={()=>setTmpM(m.id)} style={{ marginTop:"3px" }}/>
                  <div>
                    <div style={{ fontFamily:F.min,fontSize:"14px",color:tmpM===m.id?C.cream:C.ink }}>{m.label}</div>
                    <div style={{ fontSize:"12px",color:tmpM===m.id?"rgba(245,241,234,0.6)":C.ink60,marginTop:"2px" }}>{m.desc}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>
          <div>
            <button onClick={test} disabled={st==="testing"}
              style={{ width:"100%",display:"flex",alignItems:"center",justifyContent:"center",gap:"8px",padding:"12px",fontSize:"13px",letterSpacing:"0.1em",
                border:`1px solid ${C.ink}`,background:"transparent",color:C.ink,cursor:"pointer",transition:"all 0.2s",fontFamily:F.sans }}
              onMouseEnter={e=>{e.currentTarget.style.background=C.ink;e.currentTarget.style.color=C.cream;}}
              onMouseLeave={e=>{e.currentTarget.style.background="transparent";e.currentTarget.style.color=C.ink;}}>
              {st==="testing"?<><Loader2 size={14} className="animate-spin"/>テスト中...</>:<><Sparkles size={14} strokeWidth={1.5}/>接続テスト</>}
            </button>
            {st==="success"&&(
              <div style={{ marginTop:"12px",padding:"14px 16px",background:C.koke10,borderLeft:`3px solid ${C.koke}` }}>
                <div style={{ display:"flex",alignItems:"center",gap:"6px",fontSize:"11px",color:C.koke2,letterSpacing:"0.2em",marginBottom:"6px" }}>
                  <CheckCircle2 size={13} strokeWidth={1.5}/> CONNECTION SUCCESSFUL
                </div>
                <p style={{ fontSize:"13px",color:C.ink,margin:0 }}>{msg}</p>
                {resT&&<p style={{ fontSize:"12px",color:C.ink60,marginTop:"8px",paddingTop:"8px",borderTop:`1px solid ${C.koke30}`,margin:"8px 0 0" }}>Geminiの応答: 「{resT}」</p>}
              </div>
            )}
            {st==="error"&&(
              <div style={{ marginTop:"12px",padding:"14px 16px",background:C.shu10,borderLeft:`3px solid ${C.shu}` }}>
                <div style={{ display:"flex",alignItems:"center",gap:"6px",fontSize:"11px",color:C.shu,letterSpacing:"0.2em",marginBottom:"6px" }}>
                  <AlertCircle size={13} strokeWidth={1.5}/> CONNECTION FAILED
                </div>
                <p style={{ fontSize:"13px",color:C.ink,wordBreak:"break-all",margin:0 }}>{msg}</p>
              </div>
            )}
          </div>
        </div>
        <div style={{ display:"flex",justifyContent:"flex-end",gap:"8px",padding:"16px 28px",borderTop:`1px solid ${C.tan2}`,background:C.paper }}>
          <button onClick={onClose} style={{ padding:"10px 20px",fontSize:"13px",color:C.ink60,background:"none",border:"none",cursor:"pointer" }}>キャンセル</button>
          <button onClick={save} disabled={!tmp.trim()}
            style={{ padding:"10px 24px",fontSize:"13px",background:C.shu,color:C.cream,border:"none",cursor:"pointer",transition:"background 0.2s",opacity:tmp.trim()?1:0.3,fontFamily:F.sans }}
            onMouseEnter={e=>e.currentTarget.style.background=C.shu2} onMouseLeave={e=>e.currentTarget.style.background=C.shu}
          >保存</button>
        </div>
      </div>
    </div>
  );
};

// ── Loading Overlay ───────────────────────────────────────────────────────
const LoadingOverlay = ({ stage }) => {
  const stages = {
    transcribe: "音声を文字起こし中...",
    qa: "質問と回答を抽出中...",
    feedback: "AIが面接を分析中...",
  };
  return (
    <div style={{ position:"fixed",inset:0,zIndex:40,background:"rgba(245,241,234,0.92)",backdropFilter:"blur(4px)",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:F.sans }}>
      <div style={{ textAlign:"center" }}>
        <div style={{ position:"relative",width:80,height:80,margin:"0 auto 24px" }}>
          <svg width="80" height="80" viewBox="0 0 80 80" style={{ animation:"spin 2s linear infinite" }}>
            <circle cx="40" cy="40" r="34" fill="none" stroke={C.tan} strokeWidth="3"/>
            <circle cx="40" cy="40" r="34" fill="none" stroke={C.shu} strokeWidth="3" strokeDasharray="40 200" strokeLinecap="round"/>
            <circle cx="40" cy="40" r="24" fill="none" stroke={C.koke} strokeWidth="2" strokeDasharray="20 100" strokeLinecap="round" transform="rotate(180 40 40)"/>
          </svg>
        </div>
        <p style={{ fontFamily:F.min,fontSize:"1.1rem",color:C.ink,marginBottom:6 }}>{stages[stage]||"処理中..."}</p>
        <p style={{ fontSize:"12px",color:C.ink60 }}>少々お待ちください</p>
        <style>{`@keyframes spin { from{transform:rotate(0deg);} to{transform:rotate(360deg);} }`}</style>
      </div>
    </div>
  );
};

// ── Input Tab ─────────────────────────────────────────────────────────────
const InputTab = ({ onAnalyze, hasKey, onOpenSettings, busy }) => {
  const [mode, setMode]=useState("upload");
  const [text, setText]=useState("");
  const [company, setCompany]=useState("");
  const [iType, setIType]=useState("1次面接");
  const [file, setFile]=useState(null);
  const [error, setError]=useState("");
  const fileRef=useRef(null);

  const handleFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 20*1024*1024) {
      setError("ファイルサイズが大きすぎます。20MB以下のファイルをお使いください。");
      return;
    }
    setError("");
    setFile(f);
  };

  const submit = () => {
    if (mode === "upload") {
      if (!file) { setError("音声ファイルを選択してください"); return; }
      onAnalyze({ mode:"audio", file, company, iType });
    } else if (mode === "text") {
      if (text.trim().length < 30) { setError("テキストが短すぎます。30文字以上入力してください"); return; }
      onAnalyze({ mode:"text", text:text.trim(), company, iType });
    }
  };

  return (
    <div style={{ display:"flex",flexDirection:"column",gap:"40px" }}>
      <StepLabel num="01" title="面接の記録を読み込む"/>

      {!hasKey&&(
        <div style={{ padding:"20px",display:"flex",alignItems:"flex-start",gap:"16px",background:C.amber10,borderLeft:`3px solid ${C.amber}` }}>
          <AlertCircle size={20} strokeWidth={1.5} style={{ color:C.amberT,flexShrink:0,marginTop:"2px" }}/>
          <div>
            <p style={{ fontFamily:F.min,fontSize:"1rem",color:C.ink,marginBottom:"6px",marginTop:0 }}>Gemini APIキーが未設定です</p>
            <p style={{ fontSize:"12px",color:C.ink60,marginBottom:"12px",marginTop:0 }}>分析を実行するには設定からAPIキーを登録してください。</p>
            <button onClick={onOpenSettings} style={{ fontSize:"12px",background:C.ink,color:C.cream,border:"none",padding:"8px 16px",cursor:"pointer",fontFamily:F.sans }}
              onMouseEnter={e=>e.currentTarget.style.background=C.shu} onMouseLeave={e=>e.currentTarget.style.background=C.ink}>設定を開く →</button>
          </div>
        </div>
      )}

      <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:"24px",paddingBottom:"32px",borderBottom:`1px solid ${C.tan2}` }}>
        <div>
          <label style={{ display:"block",fontSize:"11px",letterSpacing:"0.25em",color:C.ink60,marginBottom:"8px" }}>会社名 / COMPANY</label>
          <input value={company} onChange={e=>setCompany(e.target.value)} placeholder="株式会社〇〇"
            style={{ width:"100%",boxSizing:"border-box",background:"transparent",borderTop:"none",borderLeft:"none",borderRight:"none",borderBottom:`1px solid rgba(26,24,20,0.25)`,
              padding:"8px 0",fontFamily:F.min,fontSize:"1.1rem",color:C.ink,outline:"none" }}
            onFocus={e=>e.target.style.borderBottomColor=C.shu} onBlur={e=>e.target.style.borderBottomColor="rgba(26,24,20,0.25)"}/>
        </div>
        <div>
          <label style={{ display:"block",fontSize:"11px",letterSpacing:"0.25em",color:C.ink60,marginBottom:"8px" }}>面接種別 / TYPE</label>
          <select value={iType} onChange={e=>setIType(e.target.value)}
            style={{ width:"100%",background:"transparent",borderTop:"none",borderLeft:"none",borderRight:"none",borderBottom:`1px solid rgba(26,24,20,0.25)`,
              padding:"8px 0",fontFamily:F.min,fontSize:"1.1rem",color:C.ink,outline:"none",cursor:"pointer" }}>
            {["1次面接","2次面接","最終面接","OB/OG訪問","模擬面接"].map(v=><option key={v}>{v}</option>)}
          </select>
        </div>
      </div>

      <div style={{ display:"flex",gap:"4px" }}>
        {[{id:"upload",label:"音声ファイル",Icon:Upload},{id:"text",label:"テキスト",Icon:FileText}].map(({id,label,Icon})=>(
          <button key={id} onClick={()=>{setMode(id);setError("");}} style={{
            display:"flex",alignItems:"center",gap:"8px",padding:"10px 20px",fontSize:"13px",
            fontFamily:F.sans,cursor:"pointer",transition:"all 0.2s",
            border:`1px solid ${mode===id?C.shu:C.tan2}`,
            background:mode===id?C.shu:"transparent",
            color:mode===id?C.cream:C.ink
          }}>
            <Icon size={14} strokeWidth={1.5}/>{label}
          </button>
        ))}
      </div>

      {error && (
        <div style={{ padding:"12px 16px",background:C.shu10,borderLeft:`3px solid ${C.shu}`,display:"flex",alignItems:"center",gap:"10px" }}>
          <AlertCircle size={16} strokeWidth={1.5} style={{ color:C.shu }}/>
          <span style={{ fontSize:"13px",color:C.ink }}>{error}</span>
        </div>
      )}

      <div style={{ minHeight:"280px" }}>
        {mode==="upload"&&(
          <div onClick={()=>fileRef.current?.click()} style={{
            display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
            padding:"64px",textAlign:"center",cursor:"pointer",transition:"all 0.3s",
            border:`2px dashed ${file?C.koke:C.tan2}`, background: file?C.koke10:"transparent"
          }}
            onMouseEnter={e=>{if(!file){e.currentTarget.style.borderColor=C.shu;e.currentTarget.style.background=C.shu10;}}}
            onMouseLeave={e=>{if(!file){e.currentTarget.style.borderColor=C.tan2;e.currentTarget.style.background="transparent";}}}>
            <input ref={fileRef} type="file" accept="audio/*,video/*" onChange={handleFile} style={{ display:"none" }}/>
            <div style={{ width:"64px",height:"64px",display:"flex",alignItems:"center",justifyContent:"center",background:file?C.koke:C.tan,borderRadius:"50%",marginBottom:"20px" }}>
              {file ? <CheckCircle2 size={28} strokeWidth={1.5} style={{ color:C.cream }}/> : <Upload size={28} strokeWidth={1.2} style={{ color:C.ink60 }}/>}
            </div>
            {file
              ? <>
                  <p style={{ fontFamily:F.min,fontSize:"1.05rem",color:C.ink,margin:"0 0 4px" }}>{file.name}</p>
                  <p style={{ fontSize:"11px",color:C.ink60,margin:0 }}>{(file.size/1024/1024).toFixed(1)} MB · クリックで変更</p>
                </>
              : <>
                  <p style={{ fontFamily:F.min,fontSize:"1.1rem",color:C.ink,marginBottom:"6px",marginTop:0 }}>音声ファイルをドロップ</p>
                  <p style={{ fontSize:"12px",color:C.ink40,margin:0 }}>MP3 / WAV / M4A / MP4 — 20MB以下</p>
                </>
            }
          </div>
        )}
        {mode==="text"&&(
          <div>
            <textarea value={text} onChange={e=>setText(e.target.value)} placeholder="面接の文字起こしテキストを直接貼り付けてください..."
              style={{ width:"100%",boxSizing:"border-box",height:"256px",padding:"20px",fontSize:"15px",fontFamily:F.sans,
                color:C.ink,background:C.paper,border:`1px solid ${C.tan2}`,outline:"none",resize:"none",lineHeight:1.8 }}
              onFocus={e=>e.target.style.borderColor=C.shu} onBlur={e=>e.target.style.borderColor=C.tan2}/>
            <p style={{ fontSize:"12px",color:C.ink40,textAlign:"right",marginTop:"8px" }}>{text.length} 文字</p>
          </div>
        )}
      </div>

      <div style={{ display:"flex",justifyContent:"flex-end",paddingTop:"16px" }}>
        <button onClick={submit} disabled={!hasKey||busy} style={{
          display:"flex",alignItems:"center",gap:"12px",padding:"16px 32px",fontSize:"13px",
          letterSpacing:"0.2em",fontFamily:F.sans,background:C.ink,color:C.cream,
          border:"none",cursor:(hasKey&&!busy)?"pointer":"not-allowed",opacity:(hasKey&&!busy)?1:0.3,transition:"background 0.2s"
        }}
          onMouseEnter={e=>{if(hasKey&&!busy)e.currentTarget.style.background=C.shu;}}
          onMouseLeave={e=>e.currentTarget.style.background=C.ink}>
          <Sparkles size={16} strokeWidth={1.5}/>分析を開始する<ChevronRight size={16} strokeWidth={1.5}/>
        </button>
      </div>
    </div>
  );
};

// ── Transcript Tab ────────────────────────────────────────────────────────
const TranscriptTab = ({ transcript }) => {
  if (!transcript || transcript.length === 0) {
    return (
      <div>
        <StepLabel num="02" title="文字起こし"/>
        <div style={{ padding:"48px",textAlign:"center",background:C.paper,border:`1px solid ${C.tan2}` }}>
          <p style={{ fontFamily:F.min,color:C.ink60 }}>まだ文字起こしがありません。「入力」タブから分析を開始してください。</p>
        </div>
      </div>
    );
  }
  return (
    <div>
      <StepLabel num="02" title="文字起こし"/>
      <div style={{ display:"flex",flexDirection:"column",gap:"2px" }}>
        {transcript.map((e,i)=>(
          <div key={i} style={{
            display:"flex",gap:"24px",padding:"20px",cursor:"pointer",transition:"background 0.2s",
            borderLeft:`3px solid ${e.speaker==="interviewer"?C.ink:C.shu}`,
            marginLeft:e.speaker==="candidate"?"48px":"0"
          }}
            onMouseEnter={ev=>ev.currentTarget.style.background=C.tan+"55"}
            onMouseLeave={ev=>ev.currentTarget.style.background="transparent"}>
            <div style={{ minWidth:"90px" }}>
              <span style={{ display:"block",fontSize:"11px",letterSpacing:"0.2em",color:e.speaker==="interviewer"?C.ink:C.shu,marginBottom:"4px" }}>
                {e.speaker==="interviewer"?"面接官":"志望者"}
              </span>
              <span style={{ fontSize:"11px",color:C.ink40 }}>{e.time||""}</span>
            </div>
            <p style={{ fontFamily:F.min,fontSize:"1.05rem",color:C.ink,lineHeight:1.9,margin:0,flex:1 }}>{e.text}</p>
          </div>
        ))}
      </div>
    </div>
  );
};

// ── Q&A Tab ───────────────────────────────────────────────────────────────
const topColors=[C.shu, C.koke, C.shu, C.koke, C.shu];
const QATab = ({ qaList }) => {
  if (!qaList || qaList.length === 0) {
    return (
      <div>
        <StepLabel num="03" title="質問と回答のサマリー"/>
        <div style={{ padding:"48px",textAlign:"center",background:C.paper,border:`1px solid ${C.tan2}` }}>
          <p style={{ fontFamily:F.min,color:C.ink60 }}>まだQ&Aがありません。</p>
        </div>
      </div>
    );
  }
  return (
    <div>
      <StepLabel num="03" title="質問と回答のサマリー"/>
      <div style={{ display:"flex",flexDirection:"column",gap:"24px" }}>
        {qaList.map((qa,i)=>(
          <article key={qa.id||i} style={{ border:`1px solid ${C.tan2}`,background:C.paper,overflow:"hidden" }}>
            <div style={{ height:"4px",background:topColors[i%5] }}/>
            <div style={{ padding:"28px" }}>
              <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"20px",paddingBottom:"16px",borderBottom:`1px solid ${C.tan}` }}>
                <div style={{ display:"flex",alignItems:"center",gap:"16px" }}>
                  <span style={{ fontSize:"12px",color:C.ink40 }}>Q.{String(i+1).padStart(2,"0")}</span>
                  <span style={{ fontSize:"11px",padding:"4px 10px",background:C.ink,color:C.cream,letterSpacing:"0.1em" }}>{qa.category||"その他"}</span>
                </div>
                {qa.delay != null && (
                  <div style={{ display:"flex",alignItems:"center",gap:"8px",padding:"6px 12px",background:qa.delay>3?C.shu10:C.koke10 }}>
                    <Clock size={12} strokeWidth={1.5} style={{ color:qa.delay>3?C.shu:C.koke }}/>
                    <span style={{ fontSize:"12px",color:qa.delay>3?C.shu:C.koke }}>応答 {qa.delay}s</span>
                  </div>
                )}
              </div>
              <p style={{ fontFamily:F.min,fontSize:"1.15rem",color:C.ink,lineHeight:1.8,marginBottom:"16px",marginTop:0 }}>「{qa.question}」</p>
              {qa.answer && (
                <div style={{ marginBottom:"16px",padding:"12px 16px",background:C.cream,borderLeft:`2px solid ${C.tan2}` }}>
                  <p style={{ fontSize:"13px",color:C.ink60,lineHeight:1.8,margin:0,fontFamily:F.sans }}>{qa.answer}</p>
                </div>
              )}
              <div>
                <span style={{ fontSize:"11px",letterSpacing:"0.25em",color:C.shu }}>ANSWER SUMMARY</span>
                <p style={{ fontSize:"14px",color:C.ink,lineHeight:1.8,marginTop:"8px",marginBottom:"12px",fontFamily:F.sans }}>{qa.answerSummary}</p>
                {qa.keyPoints && (
                  <div style={{ display:"flex",flexWrap:"wrap",gap:"6px" }}>
                    {qa.keyPoints.map((kp,j)=>(
                      <span key={j} style={{ fontSize:"12px",padding:"4px 10px",background:j%2===0?C.koke10:C.shu10,color:j%2===0?C.koke2:C.shu2 }}>{kp}</span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
};

// ── Feedback Tab ──────────────────────────────────────────────────────────
const FeedbackTab = ({ session, feedback, onSave, onExport, saved }) => {
  if (!feedback) {
    return (
      <div>
        <StepLabel num="04" title="AI分析・フィードバック"/>
        <div style={{ padding:"48px",textAlign:"center",background:C.paper,border:`1px solid ${C.tan2}` }}>
          <p style={{ fontFamily:F.min,color:C.ink60 }}>まだ分析結果がありません。</p>
        </div>
      </div>
    );
  }

  const radarData = [
    {axis:"応答速度",value:feedback.scores.responseSpeed},
    {axis:"適切性",value:feedback.scores.appropriateness},
    {axis:"一貫性",value:feedback.scores.consistency},
    {axis:"論理性",value:feedback.scores.logicalThinking},
    {axis:"総合",value:feedback.scores.overall},
  ];
  const bars=[
    {key:"responseSpeed",label:"応答速度",color:C.shu},
    {key:"appropriateness",label:"回答の適切性",color:C.koke},
    {key:"consistency",label:"一貫性",color:C.shu},
    {key:"logicalThinking",label:"論理的思考",color:C.koke},
  ];

  return (
    <div style={{ display:"flex",flexDirection:"column",gap:"40px" }}>
      <StepLabel num="04" title="AI分析・フィードバック"/>

      <div style={{ display:"grid",gridTemplateColumns:"2fr 3fr",gap:"32px",paddingBottom:"40px",borderBottom:`1px solid ${C.tan2}` }}>
        <div>
          <p style={{ fontSize:"11px",letterSpacing:"0.25em",color:C.ink60,marginBottom:"16px" }}>OVERALL SCORE</p>
          <div style={{ display:"flex",alignItems:"center",gap:"20px",marginBottom:"32px" }}>
            <div style={{ position:"relative",display:"flex",alignItems:"center",justifyContent:"center" }}>
              <svg width="100" height="100" viewBox="0 0 100 100">
                <circle cx="50" cy="50" r="44" fill="none" stroke={C.tan} strokeWidth="8"/>
                <circle cx="50" cy="50" r="44" fill="none" stroke={C.shu} strokeWidth="8"
                  strokeDasharray={`${2*Math.PI*44*feedback.scores.overall/100} ${2*Math.PI*44}`}
                  strokeLinecap="round" transform="rotate(-90 50 50)"/>
                <circle cx="50" cy="50" r="34" fill="none" stroke={C.koke} strokeWidth="3"
                  strokeDasharray={`${2*Math.PI*34*feedback.scores.logicalThinking/100} ${2*Math.PI*34}`}
                  transform="rotate(-90 50 50)" strokeOpacity="0.55"/>
              </svg>
              <div style={{ position:"absolute",textAlign:"center" }}>
                <div style={{ fontFamily:F.min,fontSize:"22px",color:C.shu,fontWeight:500 }}>{feedback.scores.overall}</div>
              </div>
            </div>
            <div>
              <p style={{ fontSize:"11px",letterSpacing:"0.2em",color:C.ink40,margin:"0 0 4px" }}>/100点</p>
              <p style={{ fontFamily:F.min,fontSize:"1rem",color:C.ink,margin:0 }}>総合評価</p>
            </div>
          </div>
          <div style={{ display:"flex",flexDirection:"column",gap:"14px" }}>
            {bars.map(b=><ScoreBar key={b.key} label={b.label} value={feedback.scores[b.key]||0} color={b.color}/>)}
          </div>
        </div>
        <div style={{ height:"288px" }}>
          <ResponsiveContainer width="100%" height="100%">
            <RadarChart data={radarData}>
              <PolarGrid stroke={C.ink} strokeOpacity={0.12}/>
              <PolarAngleAxis dataKey="axis" tick={{ fontSize:11, fill:C.ink60, fontFamily:F.sans }}/>
              <PolarRadiusAxis angle={90} domain={[0,100]} tick={false} axisLine={false}/>
              <Radar dataKey="value" stroke={C.shu} fill={C.shu} fillOpacity={0.13} strokeWidth={2}/>
            </RadarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {feedback.topPriority && (
        <div style={{ position:"relative",overflow:"hidden",padding:"28px",background:C.ink }}>
          <div style={{ position:"absolute",top:0,right:0,width:"160px",height:"160px",borderRadius:"50%",background:C.shu,opacity:0.22,transform:"translate(40%,-40%)" }}/>
          <div style={{ position:"absolute",bottom:0,left:0,width:"80px",height:"80px",borderRadius:"50%",background:C.koke,opacity:0.3,transform:"translate(-30%,40%)" }}/>
          <div style={{ position:"relative" }}>
            <p style={{ fontSize:"11px",letterSpacing:"0.3em",color:C.shu,margin:"0 0 12px" }}>★ TOP PRIORITY</p>
            <p style={{ fontFamily:F.min,fontSize:"1.1rem",color:C.cream,lineHeight:1.8,margin:0 }}>{feedback.topPriority}</p>
          </div>
        </div>
      )}

      {feedback.strengths && feedback.strengths.length > 0 && (
        <div>
          <SectionTitle color={C.koke2} label="STRENGTHS / 評価できる点"/>
          <div style={{ display:"flex",flexDirection:"column",gap:"10px" }}>
            {feedback.strengths.map((s,i)=>(
              <div key={i} style={{ display:"flex",alignItems:"flex-start",gap:"12px",padding:"14px 16px",background:C.koke10,borderLeft:`3px solid ${C.koke}` }}>
                <CheckCircle2 size={16} strokeWidth={1.5} style={{ color:C.koke,flexShrink:0,marginTop:"2px" }}/>
                <span style={{ fontSize:"14px",color:C.ink,lineHeight:1.7 }}>{s}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {feedback.items && feedback.items.length > 0 && (
        <div>
          <SectionTitle color={C.shu2} label="DETAILED FEEDBACK / 詳細な指摘"/>
          <div style={{ display:"flex",flexDirection:"column",gap:"16px" }}>
            {feedback.items.map(item=>{
              const cfg=SEV[item.sev]||SEV.medium;
              return (
                <div key={item.id} style={{ border:`1px solid ${C.tan2}`,overflow:"hidden" }}>
                  <div style={{ height:"4px",background:cfg.dot }}/>
                  <div style={{ padding:"24px" }}>
                    <div style={{ display:"flex",alignItems:"center",gap:"12px",marginBottom:"16px",flexWrap:"wrap" }}>
                      <span style={{ fontSize:"11px",padding:"3px 10px",background:cfg.dot,color:C.cream }}>{cfg.label}</span>
                      {item.qid && <span style={{ fontSize:"11px",color:C.ink40 }}>{item.qid}</span>}
                      <h4 style={{ fontFamily:F.min,fontSize:"1rem",color:C.ink,margin:0 }}>{item.title}</h4>
                    </div>
                    <div style={{ display:"grid",gap:"10px" }}>
                      <div style={{ padding:"14px 16px",background:C.paper,borderLeft:`2px solid ${C.ink}` }}>
                        <span style={{ fontSize:"11px",letterSpacing:"0.25em",color:C.ink40,display:"block",marginBottom:"6px" }}>問題点</span>
                        <p style={{ fontSize:"13px",color:C.ink,lineHeight:1.8,margin:0 }}>{item.issue}</p>
                      </div>
                      <div style={{ padding:"14px 16px",background:C.koke10,borderLeft:`2px solid ${C.koke}` }}>
                        <span style={{ fontSize:"11px",letterSpacing:"0.25em",color:C.koke2,display:"block",marginBottom:"6px" }}>アドバイス</span>
                        <p style={{ fontSize:"13px",color:C.ink,lineHeight:1.8,margin:0 }}>{item.advice}</p>
                      </div>
                      {item.eg&&(
                        <div style={{ padding:"14px 16px",background:C.shu10,borderLeft:`2px solid ${C.shu}` }}>
                          <span style={{ fontSize:"11px",letterSpacing:"0.25em",color:C.shu,display:"block",marginBottom:"6px" }}>模範回答例</span>
                          <p style={{ fontFamily:F.min,fontSize:"1rem",color:C.ink,lineHeight:1.9,margin:0 }}>{item.eg}</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div style={{ display:"flex",flexWrap:"wrap",gap:"10px",paddingTop:"24px",borderTop:`1px solid ${C.tan2}` }}>
        <button onClick={onSave} disabled={saved} style={{ display:"flex",alignItems:"center",gap:"8px",padding:"12px 24px",fontSize:"13px",
          background:saved?C.koke:C.shu,color:C.cream,border:"none",cursor:saved?"default":"pointer",letterSpacing:"0.05em",transition:"background 0.2s",opacity:saved?0.7:1 }}
          onMouseEnter={e=>{if(!saved)e.currentTarget.style.background=C.shu2;}} onMouseLeave={e=>{if(!saved)e.currentTarget.style.background=C.shu;}}>
          {saved?<><CheckCircle2 size={14} strokeWidth={1.5}/>保存済み</>:<><Archive size={14} strokeWidth={1.5}/>アプリ内に保存</>}
        </button>
        <button onClick={()=>onExport("pdf")} style={{ display:"flex",alignItems:"center",gap:"8px",padding:"12px 24px",fontSize:"13px",
          background:C.koke,color:C.cream,border:"none",cursor:"pointer",letterSpacing:"0.05em",transition:"background 0.2s" }}
          onMouseEnter={e=>e.currentTarget.style.background=C.koke2} onMouseLeave={e=>e.currentTarget.style.background=C.koke}>
          <FileDown size={14} strokeWidth={1.5}/>PDFエクスポート
        </button>
        {[["text","テキスト出力"],["json","JSON出力"]].map(([k,l])=>(
          <button key={k} onClick={()=>onExport(k)} style={{ display:"flex",alignItems:"center",gap:"8px",padding:"12px 24px",fontSize:"13px",
            border:`1px solid ${C.tan2}`,color:C.ink60,background:"transparent",cursor:"pointer",transition:"all 0.2s" }}
            onMouseEnter={e=>{e.currentTarget.style.borderColor=C.koke;e.currentTarget.style.color=C.koke2;e.currentTarget.style.background=C.koke10;}}
            onMouseLeave={e=>{e.currentTarget.style.borderColor=C.tan2;e.currentTarget.style.color=C.ink60;e.currentTarget.style.background="transparent";}}>
            <Download size={14} strokeWidth={1.5}/>{l}
          </button>
        ))}
      </div>
    </div>
  );
};

// ── History Tab ───────────────────────────────────────────────────────────
const HistoryTab = ({ history, onLoad, onDelete, onExportSession }) => {
  if (!history || history.length === 0) {
    return (
      <div>
        <StepLabel num="05" title="過去の面接履歴"/>
        <div style={{ padding:"48px",textAlign:"center",background:C.paper,border:`1px solid ${C.tan2}` }}>
          <p style={{ fontFamily:F.min,color:C.ink60,marginBottom:8 }}>まだ保存されたセッションがありません。</p>
          <p style={{ fontSize:12,color:C.ink40 }}>分析タブから「アプリ内に保存」してください。</p>
        </div>
      </div>
    );
  }
  return (
    <div>
      <StepLabel num="05" title="過去の面接履歴"/>
      <div style={{ borderTop:`1px solid ${C.tan2}` }}>
        {history.map((s,i)=>(
          <div key={s.sessionId} style={{ display:"flex",alignItems:"center",justifyContent:"space-between",padding:"20px 16px",
            borderBottom:`1px solid ${C.tan2}`,cursor:"pointer",transition:"background 0.2s" }}
            onClick={()=>onLoad(s.sessionId)}
            onMouseEnter={e=>{
              e.currentTarget.style.background=C.tan+"55";
              e.currentTarget.querySelector(".hist-actions").style.opacity="1";
            }}
            onMouseLeave={e=>{
              e.currentTarget.style.background="transparent";
              e.currentTarget.querySelector(".hist-actions").style.opacity="0";
            }}>
            <div style={{ display:"flex",alignItems:"center",gap:"20px" }}>
              <div style={{ position:"relative",width:"52px",height:"52px",flexShrink:0 }}>
                <svg width="52" height="52" viewBox="0 0 52 52">
                  <circle cx="26" cy="26" r="22" fill="none" stroke={C.tan} strokeWidth="4"/>
                  <circle cx="26" cy="26" r="22" fill="none" stroke={scoreColor(s.score)} strokeWidth="4"
                    strokeDasharray={`${2*Math.PI*22*s.score/100} ${2*Math.PI*22}`}
                    strokeLinecap="round" transform="rotate(-90 26 26)"/>
                </svg>
                <span style={{ position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",
                  fontFamily:F.min,fontSize:"13px",fontWeight:500,color:scoreColor(s.score) }}>{s.score}</span>
              </div>
              <div>
                <h4 style={{ fontFamily:F.min,fontSize:"1.1rem",color:C.ink,margin:"0 0 6px" }}>{s.company||"(会社名なし)"}</h4>
                <div style={{ display:"flex",alignItems:"center",gap:"10px",fontSize:"12px",color:C.ink60 }}>
                  <span style={{ padding:"2px 8px",background:[C.shu10,C.koke10,C.tan][i%3],color:[C.shu2,C.koke2,C.ink60][i%3] }}>{s.iType}</span>
                  <span>{s.date}</span>
                </div>
              </div>
            </div>
            <div className="hist-actions" style={{ display:"flex",alignItems:"center",gap:"6px",opacity:0,transition:"opacity 0.2s" }}>
              <button onClick={(e)=>{e.stopPropagation();onExportSession(s.sessionId,"json");}} style={{ padding:"8px",color:C.ink60,background:"none",border:"none",cursor:"pointer",transition:"all 0.2s" }}
                onMouseEnter={e=>{e.currentTarget.style.background=C.koke;e.currentTarget.style.color=C.cream;}}
                onMouseLeave={e=>{e.currentTarget.style.background="none";e.currentTarget.style.color=C.ink60;}}>
                <Download size={14} strokeWidth={1.5}/>
              </button>
              <button onClick={(e)=>{e.stopPropagation();if(window.confirm("削除しますか?"))onDelete(s.sessionId);}} style={{ padding:"8px",color:C.ink60,background:"none",border:"none",cursor:"pointer",transition:"all 0.2s" }}
                onMouseEnter={e=>{e.currentTarget.style.background=C.shu;e.currentTarget.style.color=C.cream;}}
                onMouseLeave={e=>{e.currentTarget.style.background="none";e.currentTarget.style.color=C.ink60;}}>
                <Trash2 size={14} strokeWidth={1.5}/>
              </button>
              <ChevronRight size={16} strokeWidth={1.5} style={{ color:C.ink40 }}/>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// ── Export utilities ──────────────────────────────────────────────────────
function downloadBlob(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(()=>{ document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
}

function sessionToText(session) {
  const fb = session.feedback || {};
  const lines = [];
  lines.push("============================================");
  lines.push(`面接分析レポート`);
  lines.push("============================================");
  lines.push(`会社: ${session.company||"(未指定)"}`);
  lines.push(`種別: ${session.iType}`);
  lines.push(`日付: ${session.date}`);
  lines.push(`総合スコア: ${fb.scores?.overall||"-"}/100`);
  lines.push("");
  lines.push("── スコア内訳 ──");
  if (fb.scores) {
    lines.push(`応答速度: ${fb.scores.responseSpeed}`);
    lines.push(`回答の適切性: ${fb.scores.appropriateness}`);
    lines.push(`一貫性: ${fb.scores.consistency}`);
    lines.push(`論理的思考: ${fb.scores.logicalThinking}`);
  }
  lines.push("");
  if (fb.topPriority) {
    lines.push("── 最優先で改善すべき点 ──");
    lines.push(fb.topPriority);
    lines.push("");
  }
  if (fb.strengths?.length) {
    lines.push("── 評価できる点 ──");
    fb.strengths.forEach(s=>lines.push(`・${s}`));
    lines.push("");
  }
  if (fb.items?.length) {
    lines.push("── 詳細フィードバック ──");
    fb.items.forEach((it,i)=>{
      lines.push(`\n[${i+1}] ${SEV[it.sev]?.label||""} : ${it.title}`);
      if(it.qid) lines.push(`対象: ${it.qid}`);
      lines.push(`問題点: ${it.issue}`);
      lines.push(`アドバイス: ${it.advice}`);
      if(it.eg) lines.push(`模範回答例: ${it.eg}`);
    });
    lines.push("");
  }
  if (session.qaList?.length) {
    lines.push("── Q&A一覧 ──");
    session.qaList.forEach((qa,i)=>{
      lines.push(`\nQ.${String(i+1).padStart(2,"0")} [${qa.category}]`);
      lines.push(`質問: ${qa.question}`);
      lines.push(`回答要約: ${qa.answerSummary}`);
    });
    lines.push("");
  }
  if (session.transcript?.length) {
    lines.push("── 文字起こし ──");
    session.transcript.forEach(e=>{
      lines.push(`[${e.speaker==="interviewer"?"面接官":"志望者"}] ${e.time||""} ${e.text}`);
    });
  }
  return lines.join("\n");
}

function sessionToPdfHtml(session) {
  const fb = session.feedback || {};
  const safe = (s) => String(s||"").replace(/[&<>]/g, c=>({ "&":"&amp;","<":"&lt;",">":"&gt;" }[c]));
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>面接分析レポート - ${safe(session.company)}</title>
<style>
  @page { size: A4; margin: 18mm; }
  body { font-family: "Hiragino Mincho ProN","Yu Mincho",serif; color:#1A1814; line-height:1.7; }
  h1 { font-size: 22px; border-bottom: 3px solid #B8412C; padding-bottom: 8px; }
  h2 { font-size: 15px; color:#B8412C; letterspacing: 0.1em; margin-top: 24px; border-left: 4px solid #B8412C; padding-left: 10px; }
  .meta { display:flex; gap:24px; font-size:12px; color:#5C5750; margin: 12px 0 24px; }
  .score-card { background:#1A1814; color:#F5F1EA; padding: 20px; margin: 16px 0; }
  .score-big { font-size: 48px; }
  .scores { display:grid; grid-template-columns: 1fr 1fr; gap:8px; font-size:13px; margin:12px 0; }
  .top-priority { background:#FAF7F0; border-left: 4px solid #B8412C; padding: 16px; margin: 16px 0; }
  .item { border:1px solid #D4C8B5; padding:14px; margin: 10px 0; page-break-inside: avoid; }
  .item-header { display:flex; gap:10px; align-items:center; margin-bottom:10px; }
  .badge { font-size:11px; padding:2px 8px; color:#fff; }
  .b-high { background:#B8412C; } .b-medium { background:#C19A4B; } .b-low { background:#4A6B47; }
  .sub { font-size:12px; color:#5C5750; margin: 8px 0 4px; }
  .qa { padding:10px 14px; border-left: 3px solid #B8412C; margin: 8px 0; background:#FAF7F0; page-break-inside: avoid; }
  .qa.koke { border-left-color: #4A6B47; }
  ul { padding-left: 18px; }
  li { margin: 4px 0; }
  .footer { margin-top: 24px; padding-top: 12px; border-top: 1px solid #D4C8B5; font-size:10px; color:#9A938A; }
</style></head><body>
<h1>面接分析レポート</h1>
<div class="meta">
  <div><strong>会社</strong>: ${safe(session.company)||"(未指定)"}</div>
  <div><strong>種別</strong>: ${safe(session.iType)}</div>
  <div><strong>日付</strong>: ${safe(session.date)}</div>
</div>
<div class="score-card">
  <div style="font-size:11px;letter-spacing:0.2em;">OVERALL SCORE</div>
  <div class="score-big">${fb.scores?.overall||"-"}<span style="font-size:18px;color:#B8412C;">/100</span></div>
  <div class="scores">
    <div>応答速度: ${fb.scores?.responseSpeed||"-"}</div>
    <div>回答の適切性: ${fb.scores?.appropriateness||"-"}</div>
    <div>一貫性: ${fb.scores?.consistency||"-"}</div>
    <div>論理的思考: ${fb.scores?.logicalThinking||"-"}</div>
  </div>
</div>
${fb.topPriority?`<div class="top-priority"><strong style="color:#B8412C;">★ 最優先で改善</strong><p>${safe(fb.topPriority)}</p></div>`:""}
${fb.strengths?.length?`<h2>STRENGTHS / 評価できる点</h2><ul>${fb.strengths.map(s=>`<li>${safe(s)}</li>`).join("")}</ul>`:""}
${fb.items?.length?`<h2>DETAILED FEEDBACK / 詳細な指摘</h2>${fb.items.map((it,i)=>`
<div class="item">
  <div class="item-header">
    <span class="badge b-${it.sev||"medium"}">${SEV[it.sev]?.label||"指摘"}</span>
    ${it.qid?`<span style="font-size:11px;color:#9A938A;">${safe(it.qid)}</span>`:""}
    <strong>${safe(it.title)}</strong>
  </div>
  <div class="sub">問題点</div><div>${safe(it.issue)}</div>
  <div class="sub">アドバイス</div><div>${safe(it.advice)}</div>
  ${it.eg?`<div class="sub">模範回答例</div><div style="background:#FAF7F0;padding:10px;border-left:2px solid #B8412C;">${safe(it.eg)}</div>`:""}
</div>`).join("")}`:""}
${session.qaList?.length?`<h2>Q&A 一覧</h2>${session.qaList.map((qa,i)=>`
<div class="qa ${i%2?"koke":""}">
  <div style="font-size:11px;color:#9A938A;">Q.${String(i+1).padStart(2,"0")} · ${safe(qa.category)}</div>
  <div style="font-weight:bold;margin:6px 0;">${safe(qa.question)}</div>
  <div style="font-size:13px;">${safe(qa.answerSummary)}</div>
</div>`).join("")}`:""}
<div class="footer">Interview Analyzer · Powered by Gemini · Generated ${new Date().toLocaleString("ja-JP")}</div>
<script>setTimeout(()=>window.print(), 500);</script>
</body></html>`;
}

// ── Main App ──────────────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab]=useState("input");
  const [settingsOpen, setSettingsOpen]=useState(false);
  const [apiKey, setApiKey]=useState("");
  const [model, setModel]=useState("gemini-2.5-flash");
  const [ready, setReady]=useState(false);

  // session state
  const [session, setSession] = useState(null);
  const [busy, setBusy] = useState(null); // null | "transcribe" | "qa" | "feedback"
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [history, setHistory] = useState([]);

  useEffect(()=>{
    (async()=>{
      try{ const r=await window.storage.get("gemini_api_key"); if(r?.value) setApiKey(r.value); }catch{}
      try{ const r=await window.storage.get("gemini_model"); if(r?.value) setModel(r.value); }catch{}
      await loadHistory();
      setReady(true);
    })();
  },[]);

  const loadHistory = async () => {
    try {
      const list = await window.storage.list("session:");
      const sessions = [];
      for (const key of (list?.keys || [])) {
        try {
          const r = await window.storage.get(key);
          if (r?.value) {
            const s = JSON.parse(r.value);
            sessions.push({
              sessionId: s.sessionId,
              company: s.company,
              iType: s.iType,
              date: s.date,
              score: s.feedback?.scores?.overall || 0,
            });
          }
        } catch {}
      }
      sessions.sort((a,b) => (b.date||"").localeCompare(a.date||""));
      setHistory(sessions);
    } catch (e) { console.warn("History load failed:", e); }
  };

  const hasKey = apiKey.trim().length>0;

  const runAnalysis = async ({ mode, file, text, company, iType }) => {
    setError(""); setSaved(false);
    const sessionId = `s-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
    const date = new Date().toISOString().slice(0,10).replace(/-/g,"/");
    let transcript = [];
    let plainText = "";

    try {
      // STEP 1: get transcript
      if (mode === "audio") {
        setBusy("transcribe");
        try {
          const result = await geminiAudio({
            apiKey, model, file, prompt: TRANSCRIBE_PROMPT, maxTokens: 8192,
          });
          // Try to parse as JSON; if fails, treat as plain text
          let cleaned = result.trim().replace(/^```json\s*/i,"").replace(/^```\s*/,"").replace(/```\s*$/,"");
          try {
            const parsed = JSON.parse(cleaned);
            transcript = parsed.transcript || [];
          } catch {
            transcript = [{ speaker:"unknown", text: result, time:"00:00" }];
          }
          plainText = transcript.map(e => `[${e.speaker==="interviewer"?"面接官":e.speaker==="candidate"?"志望者":"話者"}] ${e.text}`).join("\n");
        } catch (e) {
          throw new Error(`音声処理に失敗: ${e.message}`);
        }
      } else {
        plainText = text;
        // Quick split as fallback transcript view
        transcript = text.split(/\n+/).filter(Boolean).map((line, i) => {
          const isInt = /^(面接官|Q[\.:：]|質問[:：])/.test(line) || /[?？]\s*$/.test(line);
          return { speaker: isInt ? "interviewer" : "candidate", text: line.replace(/^(面接官|志望者|Q|A)[:：\.]?\s*/, ""), time: "" };
        });
      }

      // Save partial session
      setSession({ sessionId, company, iType, date, transcript, qaList: null, feedback: null });
      setTab("transcript");

      // STEP 2: Q&A extraction
      setBusy("qa");
      const qaResult = await geminiText({
        apiKey, model, prompt: QA_PROMPT(plainText, company, iType), json: true, maxTokens: 4096,
      });
      const qaList = qaResult.qaList || [];
      setSession(prev => ({ ...prev, qaList }));
      setTab("qa");

      // STEP 3: feedback
      setBusy("feedback");
      const fbResult = await geminiText({
        apiKey, model, prompt: FEEDBACK_PROMPT(qaList, company, iType), json: true, maxTokens: 4096,
      });
      setSession(prev => ({ ...prev, feedback: fbResult }));
      setTab("feedback");
      setBusy(null);
    } catch (e) {
      console.error(e);
      setError(e.message || "分析に失敗しました");
      setBusy(null);
    }
  };

  const saveSession = async () => {
    if (!session?.feedback) return;
    try {
      await window.storage.set(`session:${session.sessionId}`, JSON.stringify(session));
      setSaved(true);
      await loadHistory();
    } catch (e) {
      setError("保存に失敗しました: " + e.message);
    }
  };

  const exportCurrent = (format) => {
    if (!session) return;
    exportSession(session, format);
  };

  const exportSession = (s, format) => {
    const base = `interview_${s.company||"session"}_${s.date.replace(/\//g,"-")}`;
    if (format === "json") {
      downloadBlob(JSON.stringify(s, null, 2), `${base}.json`, "application/json");
    } else if (format === "text") {
      downloadBlob(sessionToText(s), `${base}.txt`, "text/plain;charset=utf-8");
    } else if (format === "pdf") {
      const html = sessionToPdfHtml(s);
      const w = window.open("", "_blank");
      if (w) { w.document.write(html); w.document.close(); }
      else { downloadBlob(html, `${base}.html`, "text/html"); }
    }
  };

  const exportSessionById = async (sessionId, format) => {
    try {
      const r = await window.storage.get(`session:${sessionId}`);
      if (r?.value) exportSession(JSON.parse(r.value), format);
    } catch (e) { setError("エクスポートに失敗: " + e.message); }
  };

  const loadSession = async (sessionId) => {
    try {
      const r = await window.storage.get(`session:${sessionId}`);
      if (r?.value) {
        setSession(JSON.parse(r.value));
        setSaved(true);
        setTab("feedback");
      }
    } catch (e) { setError("読み込みに失敗: " + e.message); }
  };

  const deleteSession = async (sessionId) => {
    try {
      await window.storage.delete(`session:${sessionId}`);
      await loadHistory();
    } catch (e) { setError("削除に失敗: " + e.message); }
  };

  const tabs=[
    {id:"input",num:"01",label:"入力",Icon:Mic, disabled:false},
    {id:"transcript",num:"02",label:"文字起こし",Icon:FileText, disabled:!session?.transcript?.length},
    {id:"qa",num:"03",label:"Q&A",Icon:MessageSquare, disabled:!session?.qaList?.length},
    {id:"feedback",num:"04",label:"分析",Icon:BarChart3, disabled:!session?.feedback},
    {id:"history",num:"05",label:"履歴",Icon:Archive, disabled:false},
  ];

  return (
    <div style={{ minHeight:"100vh",background:C.cream,fontFamily:F.sans,
      backgroundImage:`radial-gradient(circle at 8% 12%, rgba(184,65,44,0.06) 0%, transparent 42%), radial-gradient(circle at 92% 82%, rgba(74,107,71,0.07) 0%, transparent 42%)` }}>
      <link href="https://fonts.googleapis.com/css2?family=Shippori+Mincho+B1:wght@400;500;700&family=Noto+Sans+JP:wght@300;400;500;600&display=swap" rel="stylesheet"/>

      <KamonStripe/>

      <header style={{ position:"sticky",top:0,zIndex:10,background:"rgba(245,241,234,0.92)",backdropFilter:"blur(6px)",borderBottom:`1px solid ${C.tan2}` }}>
        <div style={{ maxWidth:"1152px",margin:"0 auto",padding:"16px 32px",display:"flex",alignItems:"center",justifyContent:"space-between" }}>
          <div style={{ display:"flex",alignItems:"center",gap:"16px" }}>
            <div style={{ position:"relative",width:"40px",height:"40px",background:C.ink,display:"flex",alignItems:"center",justifyContent:"center" }}>
              <span style={{ fontFamily:F.min,color:C.cream,fontSize:"1.1rem" }}>面</span>
              <span style={{ position:"absolute",top:"-2px",right:"-2px",width:"10px",height:"10px",background:C.shu }}/>
              <span style={{ position:"absolute",bottom:"-2px",left:"-2px",width:"6px",height:"6px",background:C.koke }}/>
            </div>
            <div>
              <h1 style={{ fontFamily:F.min,color:C.ink,fontSize:"1rem",lineHeight:1.2,margin:0 }}>
                面接分析<span style={{ color:C.shu }}>.</span>
              </h1>
              <p style={{ fontSize:"10px",letterSpacing:"0.3em",color:C.ink40,margin:0 }}>INTERVIEW ANALYZER</p>
            </div>
          </div>
          <div style={{ display:"flex",alignItems:"center",gap:"12px" }}>
            <button onClick={()=>setSettingsOpen(true)} style={{
              display:"flex",alignItems:"center",gap:"8px",padding:"6px 14px",fontSize:"12px",letterSpacing:"0.08em",
              border:`1px solid ${hasKey?C.koke30:"rgba(193,154,75,0.38)"}`,
              color:hasKey?C.koke2:C.amberT,background:hasKey?C.koke10:C.amber10,cursor:"pointer",fontFamily:F.sans,
              transition:"all 0.2s"
            }}>
              <span style={{ width:"6px",height:"6px",borderRadius:"50%",background:hasKey?C.koke:C.amber }}/>
              {ready?(hasKey?"API接続済み":"API未設定"):"..."}
            </button>
            <button onClick={()=>setSettingsOpen(true)} style={{ padding:"10px",color:C.ink60,background:"none",border:"none",cursor:"pointer" }}>
              <Settings size={16} strokeWidth={1.5}/>
            </button>
          </div>
        </div>
        <nav style={{ maxWidth:"1152px",margin:"0 auto",padding:"0 16px",display:"flex",overflowX:"auto" }}>
          {tabs.map(t=><TabBtn key={t.id} active={tab===t.id} onClick={()=>!t.disabled&&setTab(t.id)} Icon={t.Icon} label={t.label} num={t.num} disabled={t.disabled}/>)}
        </nav>
      </header>

      {error && (
        <div style={{ maxWidth:"1152px",margin:"16px auto 0",padding:"0 32px" }}>
          <div style={{ display:"flex",alignItems:"flex-start",gap:"12px",padding:"14px 18px",background:C.shu10,borderLeft:`3px solid ${C.shu}` }}>
            <AlertCircle size={18} strokeWidth={1.5} style={{ color:C.shu,flexShrink:0,marginTop:2 }}/>
            <p style={{ fontSize:13,color:C.ink,margin:0,flex:1 }}>{error}</p>
            <button onClick={()=>setError("")} style={{ background:"none",border:"none",color:C.shu,cursor:"pointer" }}><X size={14}/></button>
          </div>
        </div>
      )}

      <main style={{ maxWidth:"1152px",margin:"0 auto",padding:"48px 32px" }}>
        {tab==="input"&&<InputTab onAnalyze={runAnalysis} hasKey={hasKey} onOpenSettings={()=>setSettingsOpen(true)} busy={!!busy}/>}
        {tab==="transcript"&&<TranscriptTab transcript={session?.transcript}/>}
        {tab==="qa"&&<QATab qaList={session?.qaList}/>}
        {tab==="feedback"&&<FeedbackTab session={session} feedback={session?.feedback} onSave={saveSession} onExport={exportCurrent} saved={saved}/>}
        {tab==="history"&&<HistoryTab history={history} onLoad={loadSession} onDelete={deleteSession} onExportSession={exportSessionById}/>}
      </main>

      <footer style={{ maxWidth:"1152px",margin:"64px auto 0",padding:"24px 32px",borderTop:`1px solid ${C.tan2}` }}>
        <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",fontSize:"11px",color:C.ink40 }}>
          <div style={{ display:"flex",alignItems:"center",gap:"12px" }}>
            <span style={{ width:"8px",height:"8px",background:C.shu,transform:"rotate(45deg)",display:"inline-block" }}/>
            <span style={{ letterSpacing:"0.25em" }}>INTERVIEW ANALYZER</span>
            <span style={{ width:"6px",height:"6px",background:C.koke,transform:"rotate(45deg)",display:"inline-block" }}/>
            <span style={{ letterSpacing:"0.25em" }}>POWERED BY GEMINI</span>
          </div>
          <span style={{ letterSpacing:"0.2em" }}>v1.0</span>
        </div>
      </footer>

      {busy && <LoadingOverlay stage={busy}/>}

      <SettingsModal open={settingsOpen} onClose={()=>setSettingsOpen(false)}
        apiKey={apiKey} setApiKey={setApiKey} model={model} setModel={setModel}/>
    </div>
  );
}
