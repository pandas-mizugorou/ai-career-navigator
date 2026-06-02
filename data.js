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
    michaelpage:{ name:"Michael Page 求人実例（機械学習EM・LLM/生成AI領域 600–1500万・東京/フルリモート可）", url:"https://www.michaelpage.co.jp/job-detail/ref/jn-022026-6943594", date:"2026", tier:"posting" }
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

  // ▼▼ ここから下は「本ツール推定」= 上の実在値から本ツールが組んだ計算ロジック ▼▼
  // 実測値ではないため、画面では tier:"tool" として明示されます。
  model: {
    tier: "tool",
    // 経験年数→中央値（万円）。年代別レンジ(ageBands)に整合するよう設計
    expCurve: "0-2:380-430 / 3-5:510-570 / 6-9:622-688 / 10-14:722-810 / 15+:820-980",
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
      fit:["biz","consult","mgmt","comm"], ex:"電通総研(平均1133万)、NRI、アビーム、SIer系AI部門" },
    { name:"金融(銀行・証券・保険)データ部門", mul:1.15, range:"600–1200万", srcId:"sincereed",
      fit:["biz","research","mlops"], ex:"メガバンク、大手証券、保険会社のデータサイエンス組織" },
    { name:"国内メガベンチャー", mul:1.16, range:"700–1400万", srcId:"michaelpage",
      fit:["genai","mlops","agent","research"], ex:"LINEヤフー、メルカリ、サイバーエージェント、楽天" },
    { name:"AIスタートアップ", mul:1.06, range:"600–1200万 +SO", srcId:"relasic",
      fit:["genai","agent","research","comm"], ex:"Sakana AI、ELYZA、Preferred Networks 等" },
    { name:"事業会社のAI/DX内製組織", mul:1.02, range:"550–1000万", srcId:"sincereed",
      fit:["biz","mlops","comm","pm"], ex:"製造・小売・通信などの社内AI推進・内製チーム" }
  ],

  // 需要が高いスキルタグ（出典つき）
  hotSkills: { list:["LangChain","RAG","AIエージェント","Claude/OpenAI API","MLOps","クラウド(AWS/GCP/Azure)","論文読解・実装","英語"], srcId:"relacom" }
};
