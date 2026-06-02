/* ============================================================
   AI/データサイエンス転職ナビ — データ層
   このファイルの数値が画面に表示される唯一のソースです。
   更新するには Claude Code に「AI転職ナビのデータ更新して」と依頼してください。
   更新手順は同フォルダの UPDATE.md を参照。
   ============================================================ */
window.SALARY_DATA = {
  meta: {
    last_updated: "2026-06-02",   // ← 更新時にこの日付を書き換える
    market: "日本国内",
    stale_after_days: 90,         // この日数を超えたら画面に「要更新」警告
    note: "数値は下記 sources に基づく目安。職種平均は時点・調査手法が異なるものを併記しています。"
  },

  // 信頼区分の定義（rank=信頼の高い順 1..5／glyph=色に頼らない形の符号）
  // tool は危険色(赤)ではなく無彩色。赤は freshness 警告・エラー専用に温存する。
  tiers: {
    official: { label:"公式統計",     desc:"政府・公的機関の調査",          color:"#36d399", glyph:"◎", rank:1 },
    survey:   { label:"専門サーベイ", desc:"人材会社の年収調査レポート",    color:"#5b8cff", glyph:"○", rank:2 },
    posting:  { label:"求人実数",     desc:"実際の募集要項の提示レンジ",    color:"#9b7cff", glyph:"□", rank:3 },
    agency:   { label:"エージェント推定", desc:"転職メディアの集計・解説記事（集客目的でやや高めに出る傾向）", color:"#f7b955", glyph:"△", rank:4 },
    tool:     { label:"本ツール推定", desc:"市場データから本ツールが設計した計算ロジック（実測値ではない）", color:"#9aa0bf", glyph:"⚙", rank:5 }
  },

  // 出典一覧（id で各数値から参照）
  sources: {
    jobtag:     { name:"厚労省 職業情報提供サイト job tag", url:"https://shigoto.mhlw.go.jp/", date:"2026", tier:"official" },
    kyujinbox:  { name:"求人ボックス 給料ナビ（miraie 記事経由）", url:"https://miraie-group.jp/sees/article/detail/AI_engineer_nenshu", date:"2026", tier:"agency" },
    morgan:     { name:"Morgan McKinley 年収ガイド 東京", url:"https://www.morganmckinley.com/jp-ja/salary-guide", date:"2026", tier:"survey" },
    mynavi_age: { name:"AIエンジニア年代別年収（miraie 集計）", url:"https://miraie-group.jp/sees/article/detail/AI_engineer_nenshu", date:"2025", tier:"agency" },
    relasic:    { name:"リラシク AIエンジニア求人の全貌 2026", url:"https://relasic.jp/contents/column/ai-engineer/", date:"2026", tier:"agency" },
    relacom:    { name:"リラコム 生成AI時代のキャリア戦略", url:"https://comm.relance.jp/blog/ai-engineer-career-strategy-20m-jpy/", date:"2025", tier:"agency" },
    geekly:     { name:"Geekly AI企業ランキング日本", url:"https://www.geekly.co.jp/column/cat-technology/ai_company_rankings_japan/", date:"2026", tier:"agency" },
    sincereed:  { name:"シンシアード DS年収解説", url:"https://sincereed-agent.com/column/datascientist_salary/", date:"2025", tier:"agency" },
    michaelpage:{ name:"Michael Page 求人実例（機械学習EM・LLM/生成AI領域 600–1500万・東京/フルリモート可）", url:"https://www.michaelpage.co.jp/job-detail/ref/jn-022026-6943594", date:"2026", tier:"posting" },
    mhlw_chingin:{ name:"厚労省 賃金構造基本統計調査 2024（ソフトウェア作成者・年齢階級別）", url:"https://www.mhlw.go.jp/toukei/itiran/roudou/chingin/kouzou/z2024/index.html", date:"2024", tier:"official" },
    nta_minkan: { name:"国税庁 民間給与実態統計調査 令和6年分（年齢階級別平均給与・男女計）", url:"https://www.nta.go.jp/publication/statistics/kokuzeicho/minkan2024/", date:"2024", tier:"official" },
    geekly_ai:  { name:"Geekly AIエンジニア年収（年代別・面談来訪データ）", url:"https://www.geekly.co.jp/column/cat-position/ai_engineer_annual_salary/", date:"2026", tier:"agency" },
    doda_change:{ name:"doda 転職前後の年収変動レポート 2025年11月版", url:"https://www.persol-career.co.jp/newsroom/news/research/2025/20251225_2032/", date:"2025", tier:"agency" }
  },

  // 職種別の参考平均（実在の公表値・出典つき）
  benchmarks: [
    { role:"データサイエンティスト",   avg:573,   srcId:"jobtag",    note:"全体平均。ボリュームゾーンは400–500万" },
    { role:"AIエンジニア",             avg:558,   srcId:"kyujinbox", note:"求人ボックス集計。job tag では628.9万" },
    { role:"機械学習エンジニア(東京)", avg:800,   srcId:"morgan",    note:"基本給ベース" }
  ],

  // 年代/経験の参考レンジ（出典つき・実在値）
  ageBands: [
    { band:"20代", lo:327, hi:525, srcId:"mynavi_age" },
    { band:"30代", lo:493, hi:650, srcId:"mynavi_age" },
    { band:"40代", lo:641, hi:695, srcId:"mynavi_age" },
    { band:"50代", lo:680, hi:760, srcId:"mynavi_age" }
  ],

  // ▼▼ 正確性改修(2026-06)：年齢別の実測アンカー（二層） ▼▼
  // 土台 = 厚労省 賃金構造基本統計(2024) ソフトウェア作成者の年齢別「年収換算」(=きまって支給×12＋年間賞与)。
  // AI/DSに最も近い公的職種実測を基準に採用（国税庁・全職種平均より過大評価/二重計上を避けるため）。
  // p50=平均(mean)。年齢別の分位(p25/75/90)は公的統計に無いため null（spread で推定補完・UIで明示）。
  ageAnchor: {
    basis: "ict_software", srcId: "mhlw_chingin", unit: "万円",
    note: "厚労省 賃金構造基本統計(2024) ソフトウェア作成者。AI/DSに最も近い公的職種実測を土台に採用。p50=平均。年齢別分位は非公表のため spread で推定補完。",
    points: [
      { age:22, p50:348, p25:null, p75:null, p90:null },
      { age:27, p50:470, p25:null, p75:null, p90:null },
      { age:32, p50:541, p25:null, p75:null, p90:null },
      { age:37, p50:631, p25:null, p75:null, p90:null },
      { age:42, p50:651, p25:null, p75:null, p90:null },
      { age:47, p50:738, p25:null, p75:null, p90:null },
      { age:52, p50:695, p25:null, p75:null, p90:null },
      { age:57, p50:731, p25:null, p75:null, p90:null },
      { age:62, p50:557, p25:null, p75:null, p90:null }
    ]
  },
  // 参考：国税庁 全職種・年齢別平均（背景比較用。AI/DS推定の主アンカーには使わない）
  ageAnchorNational: {
    basis: "national", srcId: "nta_minkan", unit: "万円",
    note: "国税庁 民間給与実態統計(令和6年) 年齢階級別平均給与(男女計・全職種)。全国母集団でAI/DSより低い。全体感の比較・背景表示用。",
    points: [
      { age:22, p50:277 }, { age:27, p50:407 }, { age:32, p50:449 }, { age:37, p50:482 },
      { age:42, p50:516 }, { age:47, p50:540 }, { age:52, p50:559 }, { age:57, p50:572 }, { age:62, p50:473 }
    ]
  },
  // 年齢別の分位(p25/75/90)が公的統計に無いため、p50から推定で補う（実測が得られ次第置換。UIで「推定」と明示）。
  spread: { tier: "tool", ratio: { p25:0.85, p75:1.20, p90:1.45 },
    note: "分位はソフトウェア作成者の年齢別分布が非公表のため、AIエンジニア年代別の平均/最高比(Geekly)から概算。" },
  // AI/生成AI職の「ソフトウェア作成者(土台)比」上乗せ。IT職内の差なので小さい。cap で頭打ち（過大評価回避）。
  aiPremium: { tier: "agency", srcId: "geekly_ai", cap: 1.20,
    byAgeBand: [ { band:"20代", mul:1.10 }, { band:"30代", mul:1.14 }, { band:"40代", mul:1.09 } ],
    note: "Geekly AIエンジニア年代別 ÷ 賃金構造 ソフトウェア作成者(同年代)。IT職内の上乗せのため小さい。生成AIスキル個別の加点は skillPrem 側で扱い二重計上を回避。50代は出典に無いため非適用。" },
  // 転職時の昇給実測（現年収比の見込みに使う）
  raiseOnChange: { tier: "agency", srcId: "doda_change",
    upRatio: 0.585, avgRaiseIfUp: 72.7, avgChangeAll: 7.1, medianRaise: null,
    note: "doda 2025/11。転職者の58.5%が昇給、昇給者の平均+72.7万、全体ならし+7.1万。中央値は非公表(不明)。doda利用者母集団に限る。" },

  // ▼▼ ここから下は「本ツール推定」= 上の実在値から本ツールが組んだ計算ロジック ▼▼
  // 実測値ではないため、画面では tier:"tool" として明示されます。
  model: {
    tier: "tool",
    // 経験年数→中央値（万円）の基準カーブ。連続な区分線形（端点で値が一致し階段にならない）。
    // [経験年数, 中央値] の点列。baseByExp() がこの間を線形補間する。年代別レンジ(ageBands)に整合するよう設計。
    expCurve: [[0,380],[2,430],[5,570],[9,688],[14,810],[20,950]],
    roleMul: { ds:0.98, mle:1.05, genai:1.08, consult:1.10, pm:1.06, adjacent:0.82 },
    // スキル加点(%)。生成AIの+15%は「月10–30万の単価差」(relacom/relasic)を年収比に換算した概算
    skillPrem: { genai:.15, agent:.10, mlops:.08, biz:.10, mgmt:.08, eng:.08, research:.07, comm:.05 },
    premCap: .55,
    groundingNote: "加点幅は生成AI/LLM・AIエージェント・MLOpsが高単価という公開求人の傾向(relasic/relacom 2025–26)に基づく概算。個別オファーの保証値ではありません。"
  },

  // 企業タイプ別の市場レンジ（出典つき）と相性判定用スキル
  companies: [
    { name:"外資系IT・戦略コンサル", mul:1.28, range:"900–1800万", srcId:"geekly",
      fit:["genai","eng","biz","mgmt"], ex:"外資クラウド系、アクセンチュア、戦略コンサルのAI部門" },
    { name:"AIコンサル / DX支援(日系大手)", mul:1.18, range:"800–1500万", srcId:"geekly",
      fit:["biz","genai","mgmt","comm"], ex:"電通総研(平均1133万)、NRI、アビーム、SIer系AI部門" },
    { name:"金融(銀行・証券・保険)データ部門", mul:1.15, range:"600–1200万", srcId:"sincereed",
      fit:["biz","research","mlops"], ex:"メガバンク、大手証券、保険会社のデータサイエンス組織" },
    { name:"国内メガベンチャー", mul:1.16, range:"700–1400万", srcId:"michaelpage",
      fit:["genai","mlops","agent","research"], ex:"LINEヤフー、メルカリ、サイバーエージェント、楽天" },
    { name:"AIスタートアップ", mul:1.06, range:"600–1200万 +SO", srcId:"relasic",
      fit:["genai","agent","research","comm"], ex:"Sakana AI、ELYZA、Preferred Networks 等" },
    { name:"事業会社のAI/DX内製組織", mul:1.02, range:"550–1000万", srcId:"sincereed",
      fit:["biz","mlops","comm","agent"], ex:"製造・小売・通信などの社内AI推進・内製チーム" }
  ],

  // 需要が高いスキルタグ（出典つき）
  hotSkills: { list:["LangChain","RAG","AIエージェント","Claude/OpenAI API","MLOps","クラウド(AWS/GCP/Azure)","論文読解・実装","英語"], srcId:"relacom" }
};
