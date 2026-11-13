/**
 * 売上・入金・売掛繰越管理 ＆ 適格請求書（インボイス）発行シート
 * - 同月 × 同一顧客の複数売上・請求データの自動集計＆月次合算請求書（締め請求書）発行機能
 * - チェックした複数行を1枚の請求書データへ合算統合する機能
 * - 品目マスタ（10%標準・8%軽減税率・非課税の元情報管理）連動
 * - 顧客のインボイス番号が無くても完全動作（自社インボイス番号による適格請求書発行・印刷/PDF対応）
 * - 任意の決算月（期末単位）・月次・顧客別繰越集計＆スプレッドシート/CSV出力
 */

const STORAGE_KEY = "SALES_LEDGER_SHEET_V3";
const GITHUB_CONFIG_KEY = "SALES_LEDGER_GITHUB_CONFIG_V1";

// GitHub同期設定（トークン等はブラウザのlocalStorageにのみ保持し、data.jsonには含めない）
let ghConfig = {
  owner: "tadaaki-hub",
  repo: "sales-ledger-sheet",
  branch: "main",
  path: "data.json",
  token: "",
  autoPullOnLoad: true,
  lastSha: "",
  lastSyncAt: "",
  hasUnsavedChanges: false
};

// アプリケーションの状態
let state = {
  settings: {
    fiscalEndMonth: 3, // デフォルト3月決算（4月〜翌3月）
    selectedFiscalYear: 2026,
    selectedMonth: "ALL",
    customerFilter: "ALL",
    statusFilter: "ALL",
    searchQuery: "",
    inputModeGross: false,
    groupSameMonthCustomer: true, // 元帳シートで「同月×同一顧客」の小計・合算行を表示
    activeTab: "ledger",
    matrixMetric: "all_ledger",
    periodGroup: "monthly_customer", // デフォルトで「同月×同一顧客の月次締め集計」を表示
    showCarryOnInvoice: true
  },
  issuer: {
    name: "株式会社サンプルクリエイト",
    regNo: "T9010001099999",
    address: "〒100-0001 東京都千代田区千代田1-1-1 サンプルビル5F",
    contact: "TEL: 03-1234-5678 / Mail: billing@sample-create.co.jp",
    bank: "みずほ銀行 東京営業部 普通 1234567 カ）サンプルクリエイト",
    note: "恐れ入りますが、お振込手数料は貴社にてご負担くださいますようお願い申し上げます。"
  },
  products: [],
  customers: [],
  invoices: []
};

// 現在モーダルで編集またはプレビュー中のターゲット
let activeModalInvoiceId = null;
// 月次合算プレビュー時のターゲット { ym: "2026-04", customerId: "CUST-001" }
let activeCombinedTarget = null;

// サンプルデータ生成（同月・同一顧客の複数売上データを含む）
function getInitialSampleData() {
  const products = [
    {
      id: "PRD-01",
      code: "P-101",
      name: "クラウドシステム保守・ライセンス（標準10%）",
      taxRate: 10,
      unitPrice: 250000,
      unit: "式",
      note: "標準税率10%対象（毎月定期請求）"
    },
    {
      id: "PRD-02",
      code: "P-102",
      name: "業務システム開発・改修作業（標準10%）",
      taxRate: 10,
      unitPrice: 100000,
      unit: "人日",
      note: "標準税率10%対象（IT・制作役務）"
    },
    {
      id: "PRD-03",
      code: "P-103",
      name: "配送・梱包資材費（標準10%）",
      taxRate: 10,
      unitPrice: 10000,
      unit: "式",
      note: "標準税率10%対象（送料・資材）"
    },
    {
      id: "PRD-04",
      code: "P-801",
      name: "軽減対象 季節ギフト食品セット（軽減8%）",
      taxRate: 8,
      unitPrice: 3000,
      unit: "箱",
      note: "軽減税率8%対象（飲食料品の譲渡 ※印対象）"
    },
    {
      id: "PRD-05",
      code: "P-802",
      name: "軽減対象 業務用オーガニック食材卸（軽減8%）",
      taxRate: 8,
      unitPrice: 5000,
      unit: "kg",
      note: "軽減税率8%対象（飲食料品の譲渡 ※印対象）"
    },
    {
      id: "PRD-06",
      code: "P-001",
      name: "収入印紙・行政手数料立替（非課税/対象外）",
      taxRate: 0,
      unitPrice: 10000,
      unit: "件",
      note: "消費税非課税・不課税（立替金など）"
    }
  ];

  const customers = [
    {
      id: "CUST-001",
      code: "C001",
      name: "株式会社アルファ商事",
      address: "〒105-0001 東京都港区虎ノ門2-2-2 営業本部 御中",
      invoiceRegNo: "",
      openingBalance: 165000,
      paymentTerms: "月末締・翌月末払",
      note: "同月に複数案件・納品が発生する主力取引先"
    },
    {
      id: "CUST-002",
      code: "C002",
      name: "ベータフーズ株式会社",
      address: "〒530-0001 大阪府大阪市北区梅田3-3-3 仕入購買部 御中",
      invoiceRegNo: "",
      openingBalance: 0,
      paymentTerms: "月末締・翌月末払",
      note: "軽減税率（8%）対象品目と10%資材の混在取引先（月複数回納品）"
    },
    {
      id: "CUST-003",
      code: "C003",
      name: "ガンマシステムズ合同会社",
      address: "〒450-0002 愛知県名古屋市中村区名駅4-4-4",
      invoiceRegNo: "T3030003000003",
      openingBalance: 330000,
      paymentTerms: "20日締・翌月末払",
      note: "システム開発・分割検収あり"
    },
    {
      id: "CUST-004",
      code: "C004",
      name: "デルタデザイン事務所（個人事業・免税）",
      address: "〒810-0001 福岡県福岡市中央区天神1-1-1",
      invoiceRegNo: "",
      openingBalance: 0,
      paymentTerms: "月末締・翌々月10日払",
      note: "インボイス番号なし顧客でも請求書出力・集計完全対応"
    }
  ];

  const invoices = [
    // 前期末（繰越確認用）
    {
      id: "INV-1001",
      invoiceDate: "2026-02-28",
      invoiceNo: "INV-2602-01",
      customerId: "CUST-001",
      itemTitle: "2月度 クラウドシステム保守・ライセンス",
      net10: 200000,
      net8: 0,
      exempt0: 0,
      paidAmount: 220000,
      paidDate: "2026-03-31",
      note: "前期分・入金済",
      items: [
        { name: "2月度 クラウドシステム保守・ライセンス", taxRate: 10, qty: 1, unit: "式", unitPrice: 200000 }
      ]
    },
    {
      id: "INV-1002",
      invoiceDate: "2026-03-31",
      invoiceNo: "INV-2603-01",
      customerId: "CUST-001",
      itemTitle: "3月度 サーバー増設作業一式",
      net10: 300000,
      net8: 0,
      exempt0: 0,
      paidAmount: 165000,
      paidDate: "2026-03-31",
      note: "期末請求（翌期4月入金予定）",
      items: [
        { name: "業務システム開発・改修作業（サーバー増設）", taxRate: 10, qty: 3, unit: "人日", unitPrice: 100000 }
      ]
    },
    // 2026年4月：アルファ商事（同月・同一顧客で2件の売上がある例！）
    {
      id: "INV-2001A",
      invoiceDate: "2026-04-10",
      invoiceNo: "INV-2604-01",
      customerId: "CUST-001",
      itemTitle: "4月前半 追加端末セットアップ作業",
      net10: 120000,
      net8: 0,
      exempt0: 0,
      paidAmount: 330000, // 前月繰越分の入金
      paidDate: "2026-04-30",
      note: "同月1件目（3月繰越分入金消込）",
      items: [
        { name: "追加端末セットアップ作業（標準10%）", taxRate: 10, qty: 1, unit: "式", unitPrice: 120000 }
      ]
    },
    {
      id: "INV-2001B",
      invoiceDate: "2026-04-30",
      invoiceNo: "INV-2604-02",
      customerId: "CUST-001",
      itemTitle: "4月度 クラウドシステム保守・ライセンス",
      net10: 250000,
      net8: 0,
      exempt0: 0,
      paidAmount: 0,
      paidDate: "",
      note: "同月2件目（月末定期保守）",
      items: [
        { name: "クラウドシステム保守・ライセンス（標準10%）", taxRate: 10, qty: 1, unit: "式", unitPrice: 250000 }
      ]
    },
    // 2026年4月：ベータフーズ（同月・同一顧客で2件納品がある例！）
    {
      id: "INV-2002A",
      invoiceDate: "2026-04-15",
      invoiceNo: "INV-2604-03",
      customerId: "CUST-002",
      itemTitle: "軽減対象 季節ギフト食品セット（軽減8%） 第1回納品",
      net10: 20000,
      net8: 90000,
      exempt0: 0,
      paidAmount: 0,
      paidDate: "",
      note: "4月第1回納品（8%食品30箱＋10%送料）",
      items: [
        { name: "軽減対象 季節ギフト食品セット（軽減8%）", taxRate: 8, qty: 30, unit: "箱", unitPrice: 3000 },
        { name: "配送・梱包資材費（標準10%）", taxRate: 10, qty: 2, unit: "式", unitPrice: 10000 }
      ]
    },
    {
      id: "INV-2002B",
      invoiceDate: "2026-04-28",
      invoiceNo: "INV-2604-04",
      customerId: "CUST-002",
      itemTitle: "軽減対象 季節ギフト食品セット（軽減8%） 第2回納品",
      net10: 30000,
      net8: 90000,
      exempt0: 0,
      paidAmount: 249400, // 4月2件分の合計(119,200 + 130,200 = 249,400)を一括入金
      paidDate: "2026-05-29",
      note: "4月第2回納品（同月2件分を合算入金済）",
      items: [
        { name: "軽減対象 季節ギフト食品セット（軽減8%）", taxRate: 8, qty: 30, unit: "箱", unitPrice: 3000 },
        { name: "配送・梱包資材費（標準10%）", taxRate: 10, qty: 3, unit: "式", unitPrice: 10000 }
      ]
    },
    // 2026年5月以降
    {
      id: "INV-2003",
      invoiceDate: "2026-05-31",
      invoiceNo: "INV-2605-01",
      customerId: "CUST-001",
      itemTitle: "5月度 定期保守・追加ライセンス",
      net10: 250000,
      net8: 0,
      exempt0: 0,
      paidAmount: 407000, // 4月2件分の合算請求(132,000 + 275,000 = 407,000)が入金
      paidDate: "2026-05-31",
      note: "4月合算請求分(2件計)の入金",
      items: [
        { name: "クラウドシステム保守・ライセンス（標準10%）", taxRate: 10, qty: 1, unit: "式", unitPrice: 250000 }
      ]
    },
    {
      id: "INV-2004",
      invoiceDate: "2026-06-30",
      invoiceNo: "INV-2606-01",
      customerId: "CUST-003",
      itemTitle: "業務システム改修 フェーズ1検収",
      net10: 800000,
      net8: 0,
      exempt0: 0,
      paidAmount: 600000,
      paidDate: "2026-07-31",
      note: "一部入金・残額繰越中",
      items: [
        { name: "業務システム開発・改修作業（標準10%）", taxRate: 10, qty: 8, unit: "人日", unitPrice: 100000 }
      ]
    },
    {
      id: "INV-2005",
      invoiceDate: "2026-09-30",
      invoiceNo: "INV-2609-01",
      customerId: "CUST-002",
      itemTitle: "軽減対象 業務用オーガニック食材卸（軽減8%） ほか1件",
      net10: 40000,
      net8: 250000,
      exempt0: 0,
      paidAmount: 314000,
      paidDate: "2026-10-30",
      note: "10%配送費・8%飲食料品",
      items: [
        { name: "軽減対象 業務用オーガニック食材卸（軽減8%）", taxRate: 8, qty: 50, unit: "kg", unitPrice: 5000 },
        { name: "配送・梱包資材費（標準10%）", taxRate: 10, qty: 4, unit: "式", unitPrice: 10000 }
      ]
    },
    {
      id: "INV-2006",
      invoiceDate: "2026-10-31",
      invoiceNo: "INV-2610-01",
      customerId: "CUST-004",
      itemTitle: "Webサイトリニューアル制作 ほか1件",
      net10: 450000,
      net8: 0,
      exempt0: 10000,
      paidAmount: 0,
      paidDate: "",
      note: "11月末入金予定（売掛残）",
      items: [
        { name: "Webサイトリニューアル制作一式", taxRate: 10, qty: 1, unit: "式", unitPrice: 450000 },
        { name: "収入印紙・行政手数料立替（非課税/対象外）", taxRate: 0, qty: 1, unit: "件", unitPrice: 10000 }
      ]
    },
    // 2026年11月：アルファ商事（同月・同一顧客で2件の売上がある例！）
    {
      id: "INV-2007A",
      invoiceDate: "2026-11-05",
      invoiceNo: "INV-2611-01",
      customerId: "CUST-001",
      itemTitle: "11月スポット Webセキュリティ脆弱性診断",
      net10: 130000,
      net8: 0,
      exempt0: 0,
      paidAmount: 275000,
      paidDate: "2026-11-05",
      note: "前回繰越分入金・当月1件目",
      items: [
        { name: "Webセキュリティ脆弱性診断スポット作業", taxRate: 10, qty: 1, unit: "式", unitPrice: 130000 }
      ]
    },
    {
      id: "INV-2007B",
      invoiceDate: "2026-11-28",
      invoiceNo: "INV-2611-02",
      customerId: "CUST-001",
      itemTitle: "11月度 クラウドシステム保守・ライセンス",
      net10: 250000,
      net8: 0,
      exempt0: 0,
      paidAmount: 0,
      paidDate: "",
      note: "当月2件目（月末定期請求）",
      items: [
        { name: "クラウドシステム保守・ライセンス（標準10%）", taxRate: 10, qty: 1, unit: "式", unitPrice: 250000 }
      ]
    }
  ];

  return { products, customers, invoices };
}

// ローカルストレージ管理＆GitHub同期管理
function loadGithubConfig() {
  try {
    const raw = localStorage.getItem(GITHUB_CONFIG_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        ghConfig = { ...ghConfig, ...parsed };
      }
    }
    // URLハッシュ (#token=gho_...) で渡された場合は自動登録してURLから消去（ワンクリック初期設定用）
    if (location.hash && location.hash.includes("token=")) {
      const params = new URLSearchParams(location.hash.slice(1));
      const hashToken = params.get("token");
      if (hashToken) {
        ghConfig.token = hashToken.trim();
        localStorage.setItem(GITHUB_CONFIG_KEY, JSON.stringify(ghConfig));
        history.replaceState(null, "", location.pathname + location.search);
        setTimeout(() => {
          showToast("✅ GitHub自動接続が完了しました！「⬆ GitHubへ保存 (Push)」がそのまま使えます。");
        }, 400);
      }
    }
    // もしGitHub Pages (*.github.io) 上で開かれている場合、URLからownerとrepoを自動推定
    if (location.hostname.endsWith(".github.io")) {
      const autoOwner = location.hostname.replace(".github.io", "");
      const pathParts = location.pathname.split("/").filter(Boolean);
      const autoRepo = pathParts[0] || "";
      if (!ghConfig.owner && autoOwner) ghConfig.owner = autoOwner;
      if (!ghConfig.repo && autoRepo) ghConfig.repo = autoRepo;
    }
  } catch (e) {
    console.error("Failed to load GitHub config:", e);
  }
}

function saveGithubConfig() {
  try {
    localStorage.setItem(GITHUB_CONFIG_KEY, JSON.stringify(ghConfig));
    updateGithubStatusBadge();
  } catch (e) {
    console.error("Failed to save GitHub config:", e);
  }
}

function updateGithubStatusBadge() {
  const dot = document.getElementById("ghStatusDot");
  if (!dot) return;
  if (!ghConfig.owner || !ghConfig.repo || !ghConfig.token) {
    dot.className = "gh-status-dot";
    dot.title = "GitHub未接続（⚙共有設定から設定してください）";
  } else if (ghConfig.hasUnsavedChanges) {
    dot.className = "gh-status-dot dirty";
    dot.title = `未Pushの変更があります（最終同期: ${ghConfig.lastSyncAt || "未同期"}）`;
  } else {
    dot.className = "gh-status-dot connected";
    dot.title = `GitHub同期済 (${ghConfig.owner}/${ghConfig.repo}) 最終同期: ${ghConfig.lastSyncAt || "完了"}`;
  }
}

function applyLoadedDataset(parsed) {
  if (!parsed || !Array.isArray(parsed.customers) || !Array.isArray(parsed.invoices)) return false;
  state.customers = parsed.customers;
  state.invoices = parsed.invoices;
  if (Array.isArray(parsed.products)) state.products = parsed.products;
  if (parsed.issuer) state.issuer = { ...state.issuer, ...parsed.issuer };
  if (parsed.settings) state.settings = { ...state.settings, ...parsed.settings };
  return true;
}

function loadState() {
  loadGithubConfig();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (applyLoadedDataset(parsed)) {
        updateGithubStatusBadge();
        return;
      }
    }
  } catch (e) {
    console.error("Failed to load state:", e);
  }
  const sample = getInitialSampleData();
  state.products = sample.products;
  state.customers = sample.customers;
  state.invoices = sample.invoices;
  saveState(false);
}

function saveState(markDirty = true) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        settings: state.settings,
        issuer: state.issuer,
        products: state.products,
        customers: state.customers,
        invoices: state.invoices
      })
    );
    if (markDirty) {
      ghConfig.hasUnsavedChanges = true;
      saveGithubConfig();
    }
  } catch (e) {
    console.error("Failed to save state:", e);
  }
}

/**
 * UTF-8 文字列 <-> Base64 変換（GitHub Contents API用）
 */
function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToUtf8(b64) {
  const cleaned = b64.replace(/\s/g, "");
  const binary = atob(cleaned);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder("utf-8").decode(bytes);
}

/**
 * GitHub APIから data.json を取得 (Pull)
 */
async function pullFromGithub(silent = false) {
  if (!ghConfig.owner || !ghConfig.repo) {
    if (!silent) {
      openGithubModal();
      showToast("⚙ 先にGitHubのオーナー名とリポジトリ名を設定してください。");
    }
    return false;
  }

  // トークン未設定でも同一オリジン上の ./data.json が読める場合はフォールバック読込を試行
  if (!ghConfig.token) {
    return await loadLocalRepoDataJson(silent);
  }

  const url = `https://api.github.com/repos/${encodeURIComponent(ghConfig.owner)}/${encodeURIComponent(ghConfig.repo)}/contents/${ghConfig.path}?ref=${encodeURIComponent(ghConfig.branch || "main")}`;
  try {
    if (!silent) showToast("☁ GitHubから最新データを取得中...");
    const res = await fetch(url, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${ghConfig.token}`,
        "X-GitHub-Api-Version": "2022-11-28"
      },
      cache: "no-store"
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }

    const meta = await res.json();
    ghConfig.lastSha = meta.sha || "";
    const jsonStr = base64ToUtf8(meta.content || "");
    const parsed = JSON.parse(jsonStr);

    if (applyLoadedDataset(parsed)) {
      ghConfig.hasUnsavedChanges = false;
      ghConfig.lastSyncAt = new Date().toLocaleString("ja-JP");
      saveState(false);
      saveGithubConfig();
      renderAll();
      if (!silent) {
        showToast(`✅ GitHub (${ghConfig.owner}/${ghConfig.repo}) から最新データを読み込みました！`);
      }
      return true;
    }
  } catch (err) {
    console.error("GitHub Pull Error:", err);
    if (!silent) {
      showToast(`❌ GitHubからの取得に失敗しました (${err.message})。共有設定をご確認ください。`);
    }
  }
  return false;
}

/**
 * 同一ディレクトリの ./data.json を直接fetchして読み込む（GitHubクローン環境・GitHub Pages用）
 */
async function loadLocalRepoDataJson(silent = false) {
  try {
    const res = await fetch("./data.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const parsed = await res.json();
    if (applyLoadedDataset(parsed)) {
      ghConfig.hasUnsavedChanges = false;
      ghConfig.lastSyncAt = new Date().toLocaleString("ja-JP");
      saveState(false);
      saveGithubConfig();
      renderAll();
      if (!silent) showToast("📂 リポジトリ内の data.json を読み込みました。");
      return true;
    }
  } catch (e) {
    if (!silent) {
      showToast("data.json の読み込みにはローカルサーバーまたはGitHubトークン設定が必要です。");
    }
  }
  return false;
}

/**
 * GitHub APIへ現在の売上データを保存 (Push)
 */
async function pushToGithub() {
  if (!ghConfig.owner || !ghConfig.repo || !ghConfig.token) {
    openGithubModal();
    showToast("⚙ GitHubへ保存(Push)するには、共有設定でアクセストークン(PAT)を設定してください。");
    return false;
  }

  const baseUrl = `https://api.github.com/repos/${encodeURIComponent(ghConfig.owner)}/${encodeURIComponent(ghConfig.repo)}/contents/${ghConfig.path}`;
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${ghConfig.token}`,
    "Content-Type": "application/json",
    "X-GitHub-Api-Version": "2022-11-28"
  };

  try {
    showToast("⬆ GitHubへデータを保存(Push)しています...");

    // 最新SHAを取得（競合防止）
    let currentSha = ghConfig.lastSha;
    const getRes = await fetch(`${baseUrl}?ref=${encodeURIComponent(ghConfig.branch || "main")}`, {
      headers,
      cache: "no-store"
    });
    if (getRes.ok) {
      const getMeta = await getRes.json();
      currentSha = getMeta.sha;
    }

    const payloadObj = {
      updatedAt: new Date().toISOString(),
      settings: state.settings,
      issuer: state.issuer,
      products: state.products,
      customers: state.customers,
      invoices: state.invoices
    };
    const jsonContent = JSON.stringify(payloadObj, null, 2);

    const body = {
      message: `売上・入金データ更新 (${new Date().toLocaleString("ja-JP")})`,
      content: utf8ToBase64(jsonContent),
      branch: ghConfig.branch || "main"
    };
    if (currentSha) {
      body.sha = currentSha;
    }

    const putRes = await fetch(baseUrl, {
      method: "PUT",
      headers,
      body: JSON.stringify(body)
    });

    if (!putRes.ok) {
      const errData = await putRes.json().catch(() => ({}));
      throw new Error(errData.message || `HTTP ${putRes.status}`);
    }

    const putResult = await putRes.json();
    ghConfig.lastSha = putResult.content?.sha || "";
    ghConfig.hasUnsavedChanges = false;
    ghConfig.lastSyncAt = new Date().toLocaleString("ja-JP");
    saveGithubConfig();
    showToast(`✅ GitHub (${ghConfig.owner}/${ghConfig.repo}) の ${ghConfig.path} に保存しました！社員・税理士へ共有されました。`);
    return true;
  } catch (err) {
    console.error("GitHub Push Error:", err);
    showToast(`❌ GitHubへの保存に失敗しました: ${err.message}`);
    return false;
  }
}

function openGithubModal() {
  document.getElementById("ghOwner").value = ghConfig.owner || "";
  document.getElementById("ghRepo").value = ghConfig.repo || "";
  document.getElementById("ghBranch").value = ghConfig.branch || "main";
  document.getElementById("ghPath").value = ghConfig.path || "data.json";
  document.getElementById("ghToken").value = ghConfig.token || "";
  document.getElementById("ghAutoPullOnLoad").checked = !!ghConfig.autoPullOnLoad;
  document.getElementById("githubModal").classList.remove("hidden");
}

// 数値フォーマット・税計算ユーティリティ
function toInt(val) {
  if (typeof val === "number") return Math.round(val);
  if (!val) return 0;
  const cleaned = String(val).replace(/[,¥￥\s]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function fmtYen(val) {
  const n = toInt(val);
  return "¥" + n.toLocaleString("ja-JP");
}

function fmtNum(val) {
  const n = toInt(val);
  return n.toLocaleString("ja-JP");
}

function calcInvoiceAmounts(inv) {
  const net10 = toInt(inv.net10);
  const tax10 = Math.floor(net10 * 0.1);
  const net8 = toInt(inv.net8);
  const tax8 = Math.floor(net8 * 0.08);
  const exempt0 = toInt(inv.exempt0);
  const totalNet = net10 + net8 + exempt0;
  const totalTax = tax10 + tax8;
  const totalGross = totalNet + totalTax;
  const paidAmount = toInt(inv.paidAmount);
  const singleBalance = totalGross - paidAmount;

  let status = "UNPAID";
  if (totalGross === 0 && paidAmount === 0) {
    status = "EMPTY";
  } else if (singleBalance === 0) {
    status = "PAID";
  } else if (singleBalance < 0) {
    status = "OVERPAID";
  } else if (paidAmount > 0 && singleBalance > 0) {
    status = "PARTIAL";
  } else {
    status = "UNPAID";
  }

  return {
    net10,
    tax10,
    net8,
    tax8,
    exempt0,
    totalNet,
    totalTax,
    totalGross,
    paidAmount,
    singleBalance,
    status
  };
}

function ensureInvoiceLineItems(inv) {
  if (!Array.isArray(inv.items) || inv.items.length === 0) {
    const items = [];
    if (toInt(inv.net10) !== 0) {
      items.push({
        name: inv.itemTitle || "お取引品目（標準税率10%対象）",
        taxRate: 10,
        qty: 1,
        unit: "式",
        unitPrice: toInt(inv.net10)
      });
    }
    if (toInt(inv.net8) !== 0) {
      items.push({
        name: inv.itemTitle ? `${inv.itemTitle}（軽減税率8%対象）` : "お取引品目（軽減税率8%対象）",
        taxRate: 8,
        qty: 1,
        unit: "式",
        unitPrice: toInt(inv.net8)
      });
    }
    if (toInt(inv.exempt0) !== 0) {
      items.push({
        name: "非課税・立替金項目",
        taxRate: 0,
        qty: 1,
        unit: "式",
        unitPrice: toInt(inv.exempt0)
      });
    }
    if (items.length === 0) {
      items.push({
        name: inv.itemTitle || "",
        taxRate: 10,
        qty: 1,
        unit: "式",
        unitPrice: 0
      });
    }
    inv.items = items;
  }
  return inv.items;
}

function syncInvoiceFromLineItems(inv) {
  if (!Array.isArray(inv.items) || inv.items.length === 0) return;
  let net10 = 0;
  let net8 = 0;
  let exempt0 = 0;
  const validNames = [];

  inv.items.forEach((it) => {
    const lineNet = toInt(Number(it.qty || 0) * Number(it.unitPrice || 0));
    const rate = Number(it.taxRate);
    if (rate === 8) net8 += lineNet;
    else if (rate === 0) exempt0 += lineNet;
    else net10 += lineNet;

    if (it.name && it.name.trim()) validNames.push(it.name.trim());
  });

  inv.net10 = net10;
  inv.net8 = net8;
  inv.exempt0 = exempt0;
  if (validNames.length === 1) {
    inv.itemTitle = validNames[0];
  } else if (validNames.length > 1) {
    inv.itemTitle = `${validNames[0]} ほか${validNames.length - 1}件`;
  }
}

// 会計年度ユーティリティ
function getFiscalYearFromDate(dateStr, fiscalEndMonth) {
  if (!dateStr || !/^\d{4}-\d{2}/.test(dateStr)) {
    return state.settings.selectedFiscalYear;
  }
  const [yStr, mStr] = dateStr.split("-");
  const year = parseInt(yStr, 10);
  const month = parseInt(mStr, 10);
  const endM = parseInt(fiscalEndMonth, 10);
  if (endM === 12) return year;
  return month > endM ? year : year - 1;
}

function getFiscalYearMonths(fy, fiscalEndMonth) {
  const year = parseInt(fy, 10);
  const endM = parseInt(fiscalEndMonth, 10);
  const startMonth = endM === 12 ? 1 : endM + 1;
  const months = [];
  let y = year;
  let m = startMonth;
  for (let i = 0; i < 12; i++) {
    months.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return months;
}

function getFiscalPeriodRangeLabel(fy, fiscalEndMonth) {
  const months = getFiscalYearMonths(fy, fiscalEndMonth);
  const first = months[0].replace("-", "年") + "月";
  const last = months[11].replace("-", "年") + "月";
  return `${fy}年度（${first}〜${last}）`;
}

/**
 * 累計繰越計算
 * 同月×同一顧客のグループ化時にも順序が揃うよう、「年月 -> 顧客コード順 -> 請求日順 -> ID順」でソートして計算
 */
function computeChronologicalRunningBalances() {
  const custMap = new Map();
  state.customers.forEach((c) => {
    custMap.set(c.id, {
      customer: c,
      runningBalance: toInt(c.openingBalance)
    });
  });

  const sortedInvoices = [...state.invoices].sort((a, b) => {
    const ymA = (a.invoiceDate || "9999-99").slice(0, 7);
    const ymB = (b.invoiceDate || "9999-99").slice(0, 7);
    if (ymA !== ymB) return ymA.localeCompare(ymB);
    if (a.customerId !== b.customerId) return (a.customerId || "").localeCompare(b.customerId || "");
    const da = a.invoiceDate || "9999-99-99";
    const db = b.invoiceDate || "9999-99-99";
    if (da !== db) return da.localeCompare(db);
    return (a.id || "").localeCompare(b.id || "");
  });

  const computedById = new Map();

  sortedInvoices.forEach((inv) => {
    const calc = calcInvoiceAmounts(inv);
    let tracker = custMap.get(inv.customerId);
    if (!tracker) {
      tracker = { customer: null, runningBalance: 0 };
      custMap.set(inv.customerId, tracker);
    }
    const prevCarry = tracker.runningBalance;
    const nextCarry = prevCarry + calc.totalGross - calc.paidAmount;
    tracker.runningBalance = nextCarry;

    computedById.set(inv.id, {
      ...calc,
      prevCarry,
      runningCarryBalance: nextCarry
    });
  });

  return { computedById, sortedInvoices, custMap };
}

function computeCarryInBeforeDate(cutoffDateStr, customerIdFilter = "ALL") {
  let carryIn = 0;
  state.customers.forEach((c) => {
    if (customerIdFilter === "ALL" || c.id === customerIdFilter) {
      carryIn += toInt(c.openingBalance);
    }
  });
  if (!cutoffDateStr) return carryIn;

  state.invoices.forEach((inv) => {
    if (customerIdFilter !== "ALL" && inv.customerId !== customerIdFilter) return;
    if (inv.invoiceDate && inv.invoiceDate < cutoffDateStr) {
      const calc = calcInvoiceAmounts(inv);
      carryIn += calc.totalGross - calc.paidAmount;
    }
  });
  return carryIn;
}

function getCustomerById(customerId) {
  return state.customers.find((c) => c.id === customerId) || null;
}

// 画面コントロール同期
function syncHeaderSelectors() {
  const endMonthEl = document.getElementById("fiscalEndMonth");
  const fySelectEl = document.getElementById("fiscalYearSelect");
  const monthSelectEl = document.getElementById("monthFilterSelect");
  const custFilterEl = document.getElementById("customerFilterSelect");
  const statusFilterEl = document.getElementById("statusFilterSelect");
  const chkGrossEl = document.getElementById("chkInputModeGross");
  const chkGroupEl = document.getElementById("chkGroupSameMonthCustomer");

  endMonthEl.value = String(state.settings.fiscalEndMonth);
  chkGrossEl.checked = !!state.settings.inputModeGross;
  if (chkGroupEl) chkGroupEl.checked = !!state.settings.groupSameMonthCustomer;

  const fySet = new Set([2024, 2025, 2026, 2027]);
  state.invoices.forEach((inv) => {
    if (inv.invoiceDate) {
      fySet.add(getFiscalYearFromDate(inv.invoiceDate, state.settings.fiscalEndMonth));
    }
  });
  fySet.add(Number(state.settings.selectedFiscalYear));

  const sortedFYs = Array.from(fySet).sort((a, b) => b - a);
  fySelectEl.innerHTML = "";
  sortedFYs.forEach((fy) => {
    const opt = document.createElement("option");
    opt.value = String(fy);
    opt.textContent = getFiscalPeriodRangeLabel(fy, state.settings.fiscalEndMonth);
    if (Number(fy) === Number(state.settings.selectedFiscalYear)) opt.selected = true;
    fySelectEl.appendChild(opt);
  });

  const months = getFiscalYearMonths(state.settings.selectedFiscalYear, state.settings.fiscalEndMonth);
  const currentMonthVal = state.settings.selectedMonth;
  monthSelectEl.innerHTML = `<option value="ALL">通期（全12ヶ月）</option>`;
  months.forEach((ym) => {
    const [y, m] = ym.split("-");
    const opt = document.createElement("option");
    opt.value = ym;
    opt.textContent = `${y}年${parseInt(m, 10)}月`;
    if (ym === currentMonthVal) opt.selected = true;
    monthSelectEl.appendChild(opt);
  });
  if (currentMonthVal !== "ALL" && !months.includes(currentMonthVal)) {
    state.settings.selectedMonth = "ALL";
    monthSelectEl.value = "ALL";
  }

  const currentCustVal = state.settings.customerFilter;
  custFilterEl.innerHTML = `<option value="ALL">すべての顧客を表示（全社集計）</option>`;
  state.customers.forEach((c) => {
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = `${c.code ? `[${c.code}] ` : ""}${c.name}`;
    if (c.id === currentCustVal) opt.selected = true;
    custFilterEl.appendChild(opt);
  });

  statusFilterEl.value = state.settings.statusFilter;

  const th10 = document.getElementById("thAmount10");
  const th8 = document.getElementById("thAmount8");
  if (state.settings.inputModeGross) {
    th10.textContent = "10%対象(税込入力)";
    th8.textContent = "8%軽減(税込入力)";
  } else {
    th10.textContent = "10%対象(税抜)";
    th8.textContent = "8%軽減(税抜)";
  }

  const datalist = document.getElementById("productSuggestions");
  if (datalist) {
    datalist.innerHTML = state.products
      .map((p) => {
        const rateLabel = p.taxRate === 8 ? "軽減8%※" : p.taxRate === 0 ? "非課税" : "標準10%";
        return `<option value="${escapeAttr(p.name)}">${rateLabel} / 標準単価: ¥${fmtNum(p.unitPrice)}</option>`;
      })
      .join("");
  }

  document.getElementById("issuerName").value = state.issuer.name || "";
  document.getElementById("issuerRegNo").value = state.issuer.regNo || "";
  document.getElementById("issuerAddress").value = state.issuer.address || "";
  document.getElementById("issuerContact").value = state.issuer.contact || "";
  document.getElementById("issuerBank").value = state.issuer.bank || "";
  document.getElementById("issuerNote").value = state.issuer.note || "";
}

function getSelectedPeriodBounds() {
  const months = getFiscalYearMonths(state.settings.selectedFiscalYear, state.settings.fiscalEndMonth);
  if (state.settings.selectedMonth !== "ALL" && months.includes(state.settings.selectedMonth)) {
    const ym = state.settings.selectedMonth;
    return {
      startYm: ym,
      endYm: ym,
      cutoffDate: `${ym}-01`,
      label: `${ym.replace("-", "年")}月`
    };
  }
  return {
    startYm: months[0],
    endYm: months[11],
    cutoffDate: `${months[0]}-01`,
    label: `${state.settings.selectedFiscalYear}年度 通期`
  };
}

// KPIサマリーバー更新
function renderSummaryBar() {
  const bounds = getSelectedPeriodBounds();
  const custFilter = state.settings.customerFilter;
  const carryIn = computeCarryInBeforeDate(bounds.cutoffDate, custFilter);

  let net10 = 0,
    tax10 = 0,
    net8 = 0,
    tax8 = 0,
    exempt0 = 0,
    totalGross = 0,
    totalPaid = 0;

  state.invoices.forEach((inv) => {
    if (custFilter !== "ALL" && inv.customerId !== custFilter) return;
    const ym = (inv.invoiceDate || "").slice(0, 7);
    if (ym >= bounds.startYm && ym <= bounds.endYm) {
      const c = calcInvoiceAmounts(inv);
      net10 += c.net10;
      tax10 += c.tax10;
      net8 += c.net8;
      tax8 += c.tax8;
      exempt0 += c.exempt0;
      totalGross += c.totalGross;
      totalPaid += c.paidAmount;
    }
  });

  const totalNet = net10 + net8 + exempt0;
  const totalTax = tax10 + tax8;
  const carryOut = carryIn + totalGross - totalPaid;
  const receivableTotal = carryIn + totalGross;
  const paidRate = receivableTotal > 0 ? ((totalPaid / receivableTotal) * 100).toFixed(1) : "0.0";

  document.getElementById("kpiCarryIn").textContent = fmtYen(carryIn);
  document.getElementById("kpiCarryInSub").textContent = `${bounds.cutoffDate} 時点の繰越残高`;
  document.getElementById("kpiTotalGross").textContent = fmtYen(totalGross);
  document.getElementById("kpiTotalTaxSub").textContent = `税抜: ${fmtYen(totalNet)} / 消費税計: ${fmtYen(totalTax)}`;
  document.getElementById("kpiTaxSplit").textContent = `10%税: ${fmtYen(tax10)} / 8%税: ${fmtYen(tax8)}`;
  document.getElementById("kpiTaxNetSplit").textContent = `10%税抜: ${fmtYen(net10)} / 8%税抜: ${fmtYen(net8)}`;
  document.getElementById("kpiTotalPaid").textContent = fmtYen(totalPaid);
  document.getElementById("kpiPaidRateSub").textContent = `要回収計(繰越+売上)に対する回収率: ${paidRate}%`;
  document.getElementById("kpiCarryOut").textContent = fmtYen(carryOut);
}

function getFilteredInvoices() {
  const bounds = getSelectedPeriodBounds();
  const custFilter = state.settings.customerFilter;
  const statusFilter = state.settings.statusFilter;
  const q = (state.settings.searchQuery || "").trim().toLowerCase();
  const { computedById, sortedInvoices } = computeChronologicalRunningBalances();

  const filtered = sortedInvoices.filter((inv) => {
    const ym = (inv.invoiceDate || "").slice(0, 7);
    if (ym && (ym < bounds.startYm || ym > bounds.endYm)) return false;
    if (custFilter !== "ALL" && inv.customerId !== custFilter) return false;

    const comp = computedById.get(inv.id);
    if (statusFilter === "UNPAID" && comp.singleBalance <= 0) return false;
    if (statusFilter === "PAID" && comp.singleBalance !== 0) return false;
    if (statusFilter === "OVERPAID" && comp.singleBalance >= 0) return false;

    if (q) {
      const cust = getCustomerById(inv.customerId);
      const hay = [inv.invoiceNo, inv.itemTitle, inv.note, cust ? cust.name : ""]
        .join(" ")
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  return { filtered, computedById, bounds };
}

/**
 * TAB 1: 元帳シート描画（同月×同一顧客の小計＆月まとめ合算請求書ボタン対応）
 */
function renderLedgerSheet() {
  const tbody = document.getElementById("ledgerTbody");
  const tfoot = document.getElementById("ledgerTfoot");
  const { filtered, computedById, bounds } = getFilteredInvoices();
  const custFilter = state.settings.customerFilter;
  const carryIn = computeCarryInBeforeDate(bounds.cutoffDate, custFilter);

  tbody.innerHTML = "";

  const carryRow = document.createElement("tr");
  carryRow.className = "carry-row";
  const custLabel =
    custFilter === "ALL" ? "全顧客 合計" : getCustomerById(custFilter)?.name || "選択顧客";
  carryRow.innerHTML = `
    <td class="col-check"></td>
    <td class="col-rownum">繰越</td>
    <td colspan="3" style="padding: 4px 8px;">📌 【${bounds.label}】 期首（前月）からの繰越売掛残高 （${custLabel}）</td>
    <td colspan="10" style="padding: 4px 8px; text-align: right; font-size: 11px;">※期間開始前の未回収累計（初期残高＋前期以前請求−前期以前入金）:</td>
    <td style="padding: 4px 6px; text-align: right; font-family: var(--font-mono);">${fmtYen(carryIn)}</td>
    <td style="padding: 4px 6px; text-align: right; font-family: var(--font-mono);">${fmtYen(carryIn)}</td>
    <td colspan="2" style="padding: 4px 6px; font-size: 11px;">← 期首繰越残高</td>
  `;
  tbody.appendChild(carryRow);

  let sumNet10 = 0,
    sumTax10 = 0,
    sumNet8 = 0,
    sumTax8 = 0,
    sumExempt0 = 0,
    sumGross = 0,
    sumPaid = 0,
    sumSingleBalance = 0;

  // 同月×同一顧客グループのトラッキング用
  let grpKey = null;
  let grpAcc = null;

  const flushGroupSubtotalRow = () => {
    if (!state.settings.groupSameMonthCustomer || !grpAcc) return;
    // 1件のみの場合でも月次締め合算確認ができるよう、複数件ある場合は強調表示、1件の場合は控えめに表示（または全グループに表示）
    const cust = getCustomerById(grpAcc.customerId);
    const [y, m] = grpAcc.ym.split("-");
    const ymLabel = y && m ? `${y}年${parseInt(m, 10)}月` : grpAcc.ym;
    const subTr = document.createElement("tr");
    subTr.className = "subtotal-group-row";
    subTr.innerHTML = `
      <td></td>
      <td style="text-align: center; font-size: 10px;">月計</td>
      <td colspan="4" style="padding: 2px 8px;">
        📑 【${ymLabel} × ${escapeHtml(cust?.name || "")}】 同月・同一顧客 合計（${grpAcc.count}件）
        <span style="font-weight:normal; font-size:11px; margin-left:6px; color:#0369a1;">
          (前月繰越: ${fmtYen(grpAcc.startCarry)} ＋ 当月売上: ${fmtYen(grpAcc.gross)} − 当月入金: ${fmtYen(grpAcc.paid)} ＝ 月末繰越: ${fmtYen(grpAcc.endCarry)})
        </span>
      </td>
      <td style="text-align: right; padding: 2px 6px; font-family: var(--font-mono);">${fmtNum(grpAcc.net10)}</td>
      <td style="text-align: right; padding: 2px 6px; font-family: var(--font-mono);">${fmtNum(grpAcc.tax10)}</td>
      <td style="text-align: right; padding: 2px 6px; font-family: var(--font-mono);">${fmtNum(grpAcc.net8)}</td>
      <td style="text-align: right; padding: 2px 6px; font-family: var(--font-mono);">${fmtNum(grpAcc.tax8)}</td>
      <td style="text-align: right; padding: 2px 6px; font-family: var(--font-mono);">${fmtNum(grpAcc.exempt0)}</td>
      <td style="text-align: right; padding: 2px 6px; font-family: var(--font-mono); color: #1e3a8a;">${fmtYen(grpAcc.gross)}</td>
      <td style="text-align: right; padding: 2px 6px; font-family: var(--font-mono); color: #15803d;">${fmtYen(grpAcc.paid)}</td>
      <td></td>
      <td style="text-align: center; font-size: 11px;">当月差引:</td>
      <td style="text-align: right; padding: 2px 6px; font-family: var(--font-mono);">${fmtYen(grpAcc.singleBal)}</td>
      <td style="text-align: right; padding: 2px 6px; font-family: var(--font-mono); color: #92400e;">${fmtYen(grpAcc.endCarry)}</td>
      <td colspan="2" style="text-align: center; padding: 2px 4px;">
        <button type="button" class="btn-mini combined-inv-btn" data-action="preview-combined-invoice" data-ym="${grpAcc.ym}" data-cust="${grpAcc.customerId}" title="この月のこの顧客の売上(${grpAcc.count}件)を1枚にまとめた月次合算請求書を発行します">
          🖨 月まとめ請求書 (${grpAcc.count}件合算)
        </button>
      </td>
    `;
    tbody.appendChild(subTr);
  };

  filtered.forEach((inv, idx) => {
    const comp = computedById.get(inv.id);
    const ym = (inv.invoiceDate || "").slice(0, 7);
    const currentKey = `${ym}__${inv.customerId}`;

    if (state.settings.groupSameMonthCustomer) {
      if (grpKey !== null && grpKey !== currentKey) {
        flushGroupSubtotalRow();
        grpAcc = null;
      }
      if (!grpAcc) {
        grpKey = currentKey;
        grpAcc = {
          ym,
          customerId: inv.customerId,
          count: 0,
          startCarry: comp.prevCarry,
          net10: 0,
          tax10: 0,
          net8: 0,
          tax8: 0,
          exempt0: 0,
          gross: 0,
          paid: 0,
          singleBal: 0,
          endCarry: comp.runningCarryBalance
        };
      }
      grpAcc.count += 1;
      grpAcc.net10 += comp.net10;
      grpAcc.tax10 += comp.tax10;
      grpAcc.net8 += comp.net8;
      grpAcc.tax8 += comp.tax8;
      grpAcc.exempt0 += comp.exempt0;
      grpAcc.gross += comp.totalGross;
      grpAcc.paid += comp.paidAmount;
      grpAcc.singleBal += comp.singleBalance;
      grpAcc.endCarry = comp.runningCarryBalance;
    }

    sumNet10 += comp.net10;
    sumTax10 += comp.tax10;
    sumNet8 += comp.net8;
    sumTax8 += comp.tax8;
    sumExempt0 += comp.exempt0;
    sumGross += comp.totalGross;
    sumPaid += comp.paidAmount;
    sumSingleBalance += comp.singleBalance;

    const tr = document.createElement("tr");
    tr.dataset.id = inv.id;

    const custOptions = state.customers
      .map(
        (c) =>
          `<option value="${c.id}" ${c.id === inv.customerId ? "selected" : ""}>${escapeHtml(c.name)}</option>`
      )
      .join("");

    const disp10 = state.settings.inputModeGross ? comp.net10 + comp.tax10 : comp.net10;
    const disp8 = state.settings.inputModeGross ? comp.net8 + comp.tax8 : comp.net8;

    const statusBadgeHtml = getStatusBadgeHtml(comp.status);
    const singleBalClass = comp.singleBalance > 0 ? "balance-unpaid" : "balance-zero";
    const itemCount = Array.isArray(inv.items) && inv.items.length > 0 ? inv.items.length : 1;

    tr.innerHTML = `
      <td class="col-check">
        <input type="checkbox" class="row-select-chk" data-id="${inv.id}" />
      </td>
      <td class="col-rownum">${idx + 1}</td>
      <td>
        <input type="date" class="cell-input" data-field="invoiceDate" value="${escapeAttr(inv.invoiceDate)}" />
      </td>
      <td>
        <input type="text" class="cell-input" data-field="invoiceNo" value="${escapeAttr(inv.invoiceNo)}" placeholder="INV-..." />
      </td>
      <td>
        <select class="cell-select" data-field="customerId">
          ${custOptions}
        </select>
      </td>
      <td>
        <input type="text" list="productSuggestions" class="cell-input" data-field="itemTitle" value="${escapeAttr(inv.itemTitle)}" placeholder="品目入力またはマスタから選択" />
      </td>
      <td>
        <input type="text" inputmode="numeric" class="cell-input num-input" data-field="net10" value="${disp10 ? fmtNum(disp10) : ""}" placeholder="0" />
      </td>
      <td>
        <div class="cell-readonly" data-role="tax10">${fmtNum(comp.tax10)}</div>
      </td>
      <td>
        <input type="text" inputmode="numeric" class="cell-input num-input" data-field="net8" value="${disp8 ? fmtNum(disp8) : ""}" placeholder="0" />
      </td>
      <td>
        <div class="cell-readonly" data-role="tax8">${fmtNum(comp.tax8)}</div>
      </td>
      <td>
        <input type="text" inputmode="numeric" class="cell-input num-input" data-field="exempt0" value="${comp.exempt0 ? fmtNum(comp.exempt0) : ""}" placeholder="0" />
      </td>
      <td>
        <div class="cell-readonly total-cell" data-role="totalGross">${fmtNum(comp.totalGross)}</div>
      </td>
      <td class="paid-cell-wrap">
        <input type="text" inputmode="numeric" class="cell-input num-input" data-field="paidAmount" value="${comp.paidAmount ? fmtNum(comp.paidAmount) : ""}" placeholder="0" />
      </td>
      <td class="paid-cell-wrap">
        <input type="date" class="cell-input" data-field="paidDate" value="${escapeAttr(inv.paidDate || "")}" />
      </td>
      <td style="text-align: center;" data-role="statusCell">
        ${statusBadgeHtml}
      </td>
      <td>
        <div class="cell-readonly ${singleBalClass}" data-role="singleBalance">${fmtNum(comp.singleBalance)}</div>
      </td>
      <td>
        <div class="cell-readonly carry-cell" data-role="runningCarry">${fmtNum(comp.runningCarryBalance)}</div>
      </td>
      <td>
        <input type="text" class="cell-input" data-field="note" value="${escapeAttr(inv.note || "")}" placeholder="備考..." />
      </td>
      <td>
        <div class="row-actions">
          <button type="button" class="btn-mini items-btn" data-action="edit-items" data-id="${inv.id}" title="10%・8%の品目明細（単価×数量）を編集">📋明細(${itemCount})</button>
          <button type="button" class="btn-mini pay-btn" data-action="fill-paid" data-id="${inv.id}" title="請求税込合計を入金セルに反映">入金</button>
          <button type="button" class="btn-mini inv-btn" data-action="preview-invoice" data-id="${inv.id}" title="この行単体の適格請求書を発行">🖨単票</button>
          <button type="button" class="btn-mini del-btn" data-action="delete-row" data-id="${inv.id}" title="行を削除">✕</button>
        </div>
      </td>
    `;

    tbody.appendChild(tr);
  });

  if (state.settings.groupSameMonthCustomer && grpAcc) {
    flushGroupSubtotalRow();
  }

  const endCarryOut = carryIn + sumGross - sumPaid;

  tfoot.innerHTML = `
    <tr>
      <td colspan="6" style="text-align: right; padding-right: 12px;">
        表示期間 合計（${filtered.length}件） / 期末(次月)繰越残高:
      </td>
      <td style="text-align: right;">${fmtYen(sumNet10)}</td>
      <td style="text-align: right;">${fmtYen(sumTax10)}</td>
      <td style="text-align: right;">${fmtYen(sumNet8)}</td>
      <td style="text-align: right;">${fmtYen(sumTax8)}</td>
      <td style="text-align: right;">${fmtYen(sumExempt0)}</td>
      <td style="text-align: right; color: #93c5fd;">${fmtYen(sumGross)}</td>
      <td style="text-align: right; color: #86efac;">${fmtYen(sumPaid)}</td>
      <td></td>
      <td style="text-align: center;">単票残計:</td>
      <td style="text-align: right; color: #fca5a5;">${fmtYen(sumSingleBalance)}</td>
      <td style="text-align: right; color: #fcd34d;">${fmtYen(endCarryOut)}</td>
      <td colspan="2"></td>
    </tr>
  `;
}

function getStatusBadgeHtml(status) {
  switch (status) {
    case "PAID":
      return `<span class="status-badge status-paid">入金済</span>`;
    case "PARTIAL":
      return `<span class="status-badge status-partial">一部入金</span>`;
    case "OVERPAID":
      return `<span class="status-badge status-over">繰越消込</span>`;
    default:
      return `<span class="status-badge status-unpaid">未入金</span>`;
  }
}

/**
 * TAB 2: 顧客別 × 月次・繰越マトリクス集計表の描画
 */
function renderMatrixSheet() {
  const thead = document.getElementById("matrixThead");
  const tbody = document.getElementById("matrixTbody");
  const tfoot = document.getElementById("matrixTfoot");
  const months = getFiscalYearMonths(state.settings.selectedFiscalYear, state.settings.fiscalEndMonth);
  const metric = state.settings.matrixMetric;
  const fiscalStartCutoff = `${months[0]}-01`;

  thead.innerHTML = `
    <tr>
      <th style="width: 185px;">顧客名（取引先）</th>
      <th style="width: 110px;" class="carry-col">期首繰越残高<br><span style="font-size:10px;font-weight:normal;">(${months[0]}月初)</span></th>
      ${months
        .map((ym) => {
          const [y, m] = ym.split("-");
          return `<th style="width: 96px;">${y.slice(2)}年${parseInt(m, 10)}月</th>`;
        })
        .join("")}
      <th style="width: 115px;" class="total-col">通期 売上税込計</th>
      <th style="width: 115px;" class="paid-col">通期 入金合計</th>
      <th style="width: 120px;" class="carry-col">期末繰越残高<br><span style="font-size:10px;font-weight:normal;">(次期へ繰越)</span></th>
    </tr>
  `;

  tbody.innerHTML = "";

  const colTotals = months.map(() => ({ gross: 0, net: 0, paid: 0, carry: 0 }));
  let grandOpening = 0,
    grandGross = 0,
    grandPaid = 0,
    grandClosing = 0;

  state.customers.forEach((cust) => {
    const openingCarry = computeCarryInBeforeDate(fiscalStartCutoff, cust.id);
    grandOpening += openingCarry;

    let runningCarry = openingCarry;
    let custAnnualGross = 0;
    let custAnnualPaid = 0;

    const monthCellsHtml = months
      .map((ym, mIdx) => {
        let mGross = 0,
          mNet = 0,
          mPaid = 0;

        state.invoices.forEach((inv) => {
          if (inv.customerId === cust.id && (inv.invoiceDate || "").slice(0, 7) === ym) {
            const c = calcInvoiceAmounts(inv);
            mGross += c.totalGross;
            mNet += c.totalNet;
            mPaid += c.paidAmount;
          }
        });

        runningCarry = runningCarry + mGross - mPaid;
        custAnnualGross += mGross;
        custAnnualPaid += mPaid;

        colTotals[mIdx].gross += mGross;
        colTotals[mIdx].net += mNet;
        colTotals[mIdx].paid += mPaid;
        colTotals[mIdx].carry += runningCarry;

        let innerHtml = "";
        if (metric === "all_ledger") {
          innerHtml = `
            <div class="matrix-3line">
              <span class="m-sales">売: ${fmtNum(mGross)}</span>
              <span class="m-paid">入: ${fmtNum(mPaid)}</span>
              <span class="m-carry">残: ${fmtNum(runningCarry)}</span>
            </div>
          `;
        } else if (metric === "carry_balance") {
          innerHtml = `<div style="text-align:right; font-family:var(--font-mono); font-weight:${runningCarry !== 0 ? "700" : "400"}; color:${runningCarry > 0 ? "#b45309" : "#64748b"};">${fmtNum(runningCarry)}</div>`;
        } else if (metric === "sales_gross") {
          innerHtml = `<div style="text-align:right; font-family:var(--font-mono); color:${mGross > 0 ? "#1d4ed8" : "#94a3b8"};">${fmtNum(mGross)}</div>`;
        } else if (metric === "sales_net") {
          innerHtml = `<div style="text-align:right; font-family:var(--font-mono); color:${mNet > 0 ? "#0f172a" : "#94a3b8"};">${fmtNum(mNet)}</div>`;
        } else if (metric === "paid") {
          innerHtml = `<div style="text-align:right; font-family:var(--font-mono); color:${mPaid > 0 ? "#15803d" : "#94a3b8"};">${fmtNum(mPaid)}</div>`;
        }

        return `<td class="matrix-cell-clickable" data-cust="${cust.id}" data-ym="${ym}" title="クリックして ${cust.name} の ${ym} の明細へ移動">${innerHtml}</td>`;
      })
      .join("");

    grandGross += custAnnualGross;
    grandPaid += custAnnualPaid;
    grandClosing += runningCarry;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td style="font-weight: 700; padding: 4px 8px;">${escapeHtml(cust.name)}</td>
      <td style="text-align: right; font-family: var(--font-mono); background: #fffbeb;">${fmtYen(openingCarry)}</td>
      ${monthCellsHtml}
      <td style="text-align: right; font-family: var(--font-mono); font-weight: 700; background: #eff6ff;">${fmtYen(custAnnualGross)}</td>
      <td style="text-align: right; font-family: var(--font-mono); font-weight: 700; background: #f0fdf4;">${fmtYen(custAnnualPaid)}</td>
      <td style="text-align: right; font-family: var(--font-mono); font-weight: 700; background: #fef3c7; color: #92400e;">${fmtYen(runningCarry)}</td>
    `;
    tbody.appendChild(tr);
  });

  const footMonthCells = colTotals
    .map((tot) => {
      if (metric === "all_ledger") {
        return `<td style="text-align: right; font-size: 11px;">
          <div>売:${fmtNum(tot.gross)}</div>
          <div style="color:#86efac;">入:${fmtNum(tot.paid)}</div>
          <div style="color:#fcd34d;">残:${fmtNum(tot.carry)}</div>
        </td>`;
      } else if (metric === "carry_balance") {
        return `<td style="text-align: right; color: #fcd34d;">${fmtYen(tot.carry)}</td>`;
      } else if (metric === "sales_gross") {
        return `<td style="text-align: right;">${fmtYen(tot.gross)}</td>`;
      } else if (metric === "sales_net") {
        return `<td style="text-align: right;">${fmtYen(tot.net)}</td>`;
      } else {
        return `<td style="text-align: right; color: #86efac;">${fmtYen(tot.paid)}</td>`;
      }
    })
    .join("");

  tfoot.innerHTML = `
    <tr>
      <td style="padding-left: 8px;">全顧客 合計</td>
      <td style="text-align: right; color: #fcd34d;">${fmtYen(grandOpening)}</td>
      ${footMonthCells}
      <td style="text-align: right; color: #93c5fd;">${fmtYen(grandGross)}</td>
      <td style="text-align: right; color: #86efac;">${fmtYen(grandPaid)}</td>
      <td style="text-align: right; color: #fcd34d;">${fmtYen(grandClosing)}</td>
    </tr>
  `;
}

/**
 * TAB 3: 同月×顧客の月次締め集計・月次推移・年度比較・顧客別集計
 */
function renderPeriodSummarySheet() {
  const thead = document.getElementById("periodThead");
  const tbody = document.getElementById("periodTbody");
  const tfoot = document.getElementById("periodTfoot");
  const mode = state.settings.periodGroup;

  const isMonthlyCustomerMode = mode === "monthly_customer";

  thead.innerHTML = `
    <tr>
      <th style="width: 210px;">${
        isMonthlyCustomerMode
          ? "対象年月 × 顧客名（同月合算）"
          : mode === "monthly"
          ? "対象年月"
          : mode === "yearly"
          ? "会計年度（期末単位）"
          : "顧客名（取引先）"
      }</th>
      <th style="width: 75px;">伝票件数</th>
      <th style="width: 115px;" class="carry-col">前月(期首)繰越残</th>
      <th style="width: 110px;">10%対象(税抜)</th>
      <th style="width: 95px;" class="calc-col">10%消費税</th>
      <th style="width: 110px;">8%軽減(税抜)</th>
      <th style="width: 95px;" class="calc-col">8%消費税</th>
      <th style="width: 95px;">非課税/対象外</th>
      <th style="width: 115px;" class="calc-col">税抜売上 合計</th>
      <th style="width: 100px;" class="calc-col">消費税 合計</th>
      <th style="width: 120px;" class="total-col">同月税込売上計</th>
      <th style="width: 115px;" class="paid-col">同月 入金合計</th>
      <th style="width: 120px;" class="carry-col">月末(期末)繰越残</th>
      ${isMonthlyCustomerMode ? `<th style="width: 145px;">月まとめ合算請求書</th>` : ""}
    </tr>
  `;

  tbody.innerHTML = "";
  const rows = [];

  if (isMonthlyCustomerMode) {
    // 選択期間内の「年月 × 顧客」ごとに自動集計
    const bounds = getSelectedPeriodBounds();
    const { computedById, sortedInvoices } = computeChronologicalRunningBalances();
    const groupMap = new Map();

    sortedInvoices.forEach((inv) => {
      if (state.settings.customerFilter !== "ALL" && inv.customerId !== state.settings.customerFilter) return;
      const ym = (inv.invoiceDate || "").slice(0, 7);
      if (!ym || ym < bounds.startYm || ym > bounds.endYm) return;

      const key = `${ym}__${inv.customerId}`;
      const comp = computedById.get(inv.id);
      const cust = getCustomerById(inv.customerId);
      const [y, m] = ym.split("-");
      const label = `${y}年${parseInt(m, 10)}月 — ${cust?.name || "不明顧客"}`;

      if (!groupMap.has(key)) {
        const b = createEmptyBucket(label, comp.prevCarry);
        b.ym = ym;
        b.customerId = inv.customerId;
        groupMap.set(key, b);
      }
      const bucket = groupMap.get(key);
      accumulateBucket(bucket, inv);
      bucket.carryOut = comp.runningCarryBalance;
    });

    groupMap.forEach((b) => rows.push(b));
  } else if (mode === "monthly") {
    const months = getFiscalYearMonths(state.settings.selectedFiscalYear, state.settings.fiscalEndMonth);
    let runningCarry = computeCarryInBeforeDate(`${months[0]}-01`, state.settings.customerFilter);

    months.forEach((ym) => {
      const bucket = createEmptyBucket(ym.replace("-", "年") + "月", runningCarry);
      state.invoices.forEach((inv) => {
        if (state.settings.customerFilter !== "ALL" && inv.customerId !== state.settings.customerFilter) return;
        if ((inv.invoiceDate || "").slice(0, 7) === ym) {
          accumulateBucket(bucket, inv);
        }
      });
      bucket.carryOut = bucket.carryIn + bucket.totalGross - bucket.paid;
      runningCarry = bucket.carryOut;
      rows.push(bucket);
    });
  } else if (mode === "yearly") {
    const fySet = new Set([state.settings.selectedFiscalYear - 1, state.settings.selectedFiscalYear, state.settings.selectedFiscalYear + 1]);
    state.invoices.forEach((inv) => {
      if (inv.invoiceDate) fySet.add(getFiscalYearFromDate(inv.invoiceDate, state.settings.fiscalEndMonth));
    });
    const sortedFYs = Array.from(fySet).sort((a, b) => a - b);

    sortedFYs.forEach((fy) => {
      const months = getFiscalYearMonths(fy, state.settings.fiscalEndMonth);
      const carryIn = computeCarryInBeforeDate(`${months[0]}-01`, state.settings.customerFilter);
      const bucket = createEmptyBucket(getFiscalPeriodRangeLabel(fy, state.settings.fiscalEndMonth), carryIn);

      state.invoices.forEach((inv) => {
        if (state.settings.customerFilter !== "ALL" && inv.customerId !== state.settings.customerFilter) return;
        const ym = (inv.invoiceDate || "").slice(0, 7);
        if (ym >= months[0] && ym <= months[11]) accumulateBucket(bucket, inv);
      });
      bucket.carryOut = bucket.carryIn + bucket.totalGross - bucket.paid;
      rows.push(bucket);
    });
  } else if (mode === "customer_annual") {
    const months = getFiscalYearMonths(state.settings.selectedFiscalYear, state.settings.fiscalEndMonth);
    state.customers.forEach((cust) => {
      const carryIn = computeCarryInBeforeDate(`${months[0]}-01`, cust.id);
      const bucket = createEmptyBucket(cust.name, carryIn);

      state.invoices.forEach((inv) => {
        if (inv.customerId !== cust.id) return;
        const ym = (inv.invoiceDate || "").slice(0, 7);
        if (ym >= months[0] && ym <= months[11]) accumulateBucket(bucket, inv);
      });
      bucket.carryOut = bucket.carryIn + bucket.totalGross - bucket.paid;
      rows.push(bucket);
    });
  }

  let totCount = 0,
    totNet10 = 0,
    totTax10 = 0,
    totNet8 = 0,
    totTax8 = 0,
    totExempt0 = 0,
    totNet = 0,
    totTax = 0,
    totGross = 0,
    totPaid = 0;

  rows.forEach((r) => {
    totCount += r.count;
    totNet10 += r.net10;
    totTax10 += r.tax10;
    totNet8 += r.net8;
    totTax8 += r.tax8;
    totExempt0 += r.exempt0;
    totNet += r.totalNet;
    totTax += r.totalTax;
    totGross += r.totalGross;
    totPaid += r.paid;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td style="padding: 6px 8px; font-weight: 700;">${escapeHtml(r.label)}</td>
      <td style="text-align: center; font-family: var(--font-mono); font-weight: ${r.count > 1 ? "700" : "400"}; color: ${r.count > 1 ? "#0284c7" : "inherit"};">${r.count}件</td>
      <td style="text-align: right; font-family: var(--font-mono); background: #fffbeb; padding: 4px 6px;">${fmtYen(r.carryIn)}</td>
      <td style="text-align: right; font-family: var(--font-mono); padding: 4px 6px;">${fmtYen(r.net10)}</td>
      <td style="text-align: right; font-family: var(--font-mono); background: #f8fafc; padding: 4px 6px;">${fmtYen(r.tax10)}</td>
      <td style="text-align: right; font-family: var(--font-mono); padding: 4px 6px;">${fmtYen(r.net8)}</td>
      <td style="text-align: right; font-family: var(--font-mono); background: #f8fafc; padding: 4px 6px;">${fmtYen(r.tax8)}</td>
      <td style="text-align: right; font-family: var(--font-mono); padding: 4px 6px;">${fmtYen(r.exempt0)}</td>
      <td style="text-align: right; font-family: var(--font-mono); font-weight: 600; background: #f1f5f9; padding: 4px 6px;">${fmtYen(r.totalNet)}</td>
      <td style="text-align: right; font-family: var(--font-mono); font-weight: 600; background: #f1f5f9; padding: 4px 6px;">${fmtYen(r.totalTax)}</td>
      <td style="text-align: right; font-family: var(--font-mono); font-weight: 700; background: #eff6ff; color: #1e3a8a; padding: 4px 6px;">${fmtYen(r.totalGross)}</td>
      <td style="text-align: right; font-family: var(--font-mono); font-weight: 700; background: #f0fdf4; color: #15803d; padding: 4px 6px;">${fmtYen(r.paid)}</td>
      <td style="text-align: right; font-family: var(--font-mono); font-weight: 700; background: #fef3c7; color: #92400e; padding: 4px 6px;">${fmtYen(r.carryOut)}</td>
      ${
        isMonthlyCustomerMode
          ? `<td style="text-align: center; padding: 4px;">
              <button type="button" class="btn-mini combined-inv-btn" data-action="preview-combined-invoice" data-ym="${r.ym}" data-cust="${r.customerId}">
                🖨 月まとめ請求書 (${r.count}件)
              </button>
            </td>`
          : ""
      }
    `;
    tbody.appendChild(tr);
  });

  const bounds = getSelectedPeriodBounds();
  const firstCarryIn = computeCarryInBeforeDate(bounds.cutoffDate, state.settings.customerFilter);
  const finalCarryOut = firstCarryIn + totGross - totPaid;

  tfoot.innerHTML = `
    <tr>
      <td style="padding-left: 8px;">集計合計</td>
      <td style="text-align: center;">${totCount}件</td>
      <td style="text-align: right; color: #fcd34d;">${fmtYen(firstCarryIn)}</td>
      <td style="text-align: right;">${fmtYen(totNet10)}</td>
      <td style="text-align: right;">${fmtYen(totTax10)}</td>
      <td style="text-align: right;">${fmtYen(totNet8)}</td>
      <td style="text-align: right;">${fmtYen(totTax8)}</td>
      <td style="text-align: right;">${fmtYen(totExempt0)}</td>
      <td style="text-align: right;">${fmtYen(totNet)}</td>
      <td style="text-align: right;">${fmtYen(totTax)}</td>
      <td style="text-align: right; color: #93c5fd;">${fmtYen(totGross)}</td>
      <td style="text-align: right; color: #86efac;">${fmtYen(totPaid)}</td>
      <td style="text-align: right; color: #fcd34d;">${fmtYen(finalCarryOut)}</td>
      ${isMonthlyCustomerMode ? `<td></td>` : ""}
    </tr>
  `;
}

function createEmptyBucket(label, carryIn) {
  return {
    label,
    count: 0,
    carryIn,
    net10: 0,
    tax10: 0,
    net8: 0,
    tax8: 0,
    exempt0: 0,
    totalNet: 0,
    totalTax: 0,
    totalGross: 0,
    paid: 0,
    carryOut: carryIn
  };
}

function accumulateBucket(bucket, inv) {
  const c = calcInvoiceAmounts(inv);
  bucket.count += 1;
  bucket.net10 += c.net10;
  bucket.tax10 += c.tax10;
  bucket.net8 += c.net8;
  bucket.tax8 += c.tax8;
  bucket.exempt0 += c.exempt0;
  bucket.totalNet += c.totalNet;
  bucket.totalTax += c.totalTax;
  bucket.totalGross += c.totalGross;
  bucket.paid += c.paidAmount;
}

/**
 * TAB 4: 品目マスタ描画
 */
function renderProductsSheet() {
  const tbody = document.getElementById("productTbody");
  if (!tbody) return;
  tbody.innerHTML = "";

  state.products.forEach((prd, idx) => {
    const tr = document.createElement("tr");
    tr.dataset.prdId = prd.id;
    tr.innerHTML = `
      <td class="col-rownum">${idx + 1}</td>
      <td>
        <input type="text" class="cell-input" data-prd-field="code" value="${escapeAttr(prd.code || "")}" placeholder="P-101" />
      </td>
      <td>
        <input type="text" class="cell-input" data-prd-field="name" value="${escapeAttr(prd.name || "")}" placeholder="品目・サービス名を入力" />
      </td>
      <td>
        <select class="cell-select" data-prd-field="taxRate" style="font-weight:700; color:${prd.taxRate === 8 ? "#b45309" : prd.taxRate === 0 ? "#475569" : "#1d4ed8"};">
          <option value="10" ${Number(prd.taxRate) === 10 ? "selected" : ""}>標準税率 10%</option>
          <option value="8" ${Number(prd.taxRate) === 8 ? "selected" : ""}>軽減税率 8%（※飲食料品等）</option>
          <option value="0" ${Number(prd.taxRate) === 0 ? "selected" : ""}>非課税 / 不課税 (0%)</option>
        </select>
      </td>
      <td>
        <input type="text" inputmode="numeric" class="cell-input num-input" data-prd-field="unitPrice" value="${prd.unitPrice ? fmtNum(prd.unitPrice) : "0"}" />
      </td>
      <td>
        <input type="text" class="cell-input" data-prd-field="unit" value="${escapeAttr(prd.unit || "式")}" placeholder="式 / 個 / 箱" />
      </td>
      <td>
        <input type="text" class="cell-input" data-prd-field="note" value="${escapeAttr(prd.note || "")}" placeholder="備考..." />
      </td>
      <td style="text-align: center;">
        <button type="button" class="btn-mini del-btn" data-action="delete-product" data-id="${prd.id}">削除</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

/**
 * TAB 5: 顧客マスタ＆自社設定描画
 */
function renderCustomersSheet() {
  const tbody = document.getElementById("customerTbody");
  const tfoot = document.getElementById("customerTfoot");
  tbody.innerHTML = "";

  let sumOpening = 0,
    sumGross = 0,
    sumPaid = 0,
    sumCurrentCarry = 0;

  state.customers.forEach((cust, idx) => {
    let cGross = 0,
      cPaid = 0;
    state.invoices.forEach((inv) => {
      if (inv.customerId === cust.id) {
        const calc = calcInvoiceAmounts(inv);
        cGross += calc.totalGross;
        cPaid += calc.paidAmount;
      }
    });
    const opening = toInt(cust.openingBalance);
    const currentCarry = opening + cGross - cPaid;

    sumOpening += opening;
    sumGross += cGross;
    sumPaid += cPaid;
    sumCurrentCarry += currentCarry;

    const tr = document.createElement("tr");
    tr.dataset.custId = cust.id;
    tr.innerHTML = `
      <td class="col-rownum">${idx + 1}</td>
      <td>
        <input type="text" class="cell-input" data-cust-field="code" value="${escapeAttr(cust.code || "")}" placeholder="C001" />
      </td>
      <td>
        <input type="text" class="cell-input" data-cust-field="name" value="${escapeAttr(cust.name || "")}" placeholder="株式会社..." />
      </td>
      <td>
        <input type="text" class="cell-input" data-cust-field="address" value="${escapeAttr(cust.address || "")}" placeholder="〒... 住所・部署名（任意）" />
      </td>
      <td>
        <input type="text" inputmode="numeric" class="cell-input num-input" data-cust-field="openingBalance" value="${opening ? fmtNum(opening) : "0"}" />
      </td>
      <td>
        <input type="text" class="cell-input" data-cust-field="paymentTerms" value="${escapeAttr(cust.paymentTerms || "")}" placeholder="月末締・翌月末払" />
      </td>
      <td>
        <input type="text" class="cell-input" data-cust-field="invoiceRegNo" value="${escapeAttr(cust.invoiceRegNo || "")}" placeholder="空欄でOK（任意メモ）" />
      </td>
      <td>
        <div class="cell-readonly total-cell">${fmtYen(cGross)}</div>
      </td>
      <td>
        <div class="cell-readonly">${fmtYen(cPaid)}</div>
      </td>
      <td>
        <div class="cell-readonly carry-cell">${fmtYen(currentCarry)}</div>
      </td>
      <td style="text-align: center;">
        <button type="button" class="btn-mini del-btn" data-action="delete-customer" data-id="${cust.id}">削除</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  tfoot.innerHTML = `
    <tr>
      <td colspan="4" style="text-align: right; padding-right: 12px;">全顧客 合計（${state.customers.length}社）:</td>
      <td style="text-align: right; color: #fcd34d;">${fmtYen(sumOpening)}</td>
      <td colspan="2"></td>
      <td style="text-align: right; color: #93c5fd;">${fmtYen(sumGross)}</td>
      <td style="text-align: right; color: #86efac;">${fmtYen(sumPaid)}</td>
      <td style="text-align: right; color: #fcd34d;">${fmtYen(sumCurrentCarry)}</td>
      <td></td>
    </tr>
  `;
}

function renderAll() {
  syncHeaderSelectors();
  renderSummaryBar();
  renderLedgerSheet();
  renderMatrixSheet();
  renderPeriodSummarySheet();
  renderProductsSheet();
  renderCustomersSheet();
}

/**
 * モーダル1: 請求明細（品目・10%/8%内訳）エディタ
 */
function openItemsModal(invoiceId) {
  const inv = state.invoices.find((i) => i.id === invoiceId);
  if (!inv) return;
  activeModalInvoiceId = invoiceId;
  activeCombinedTarget = null;
  ensureInvoiceLineItems(inv);

  const cust = getCustomerById(inv.customerId);
  document.getElementById("itemsModalTitle").textContent = `📋 請求明細（10% / 8%軽減 品目内訳） — ${cust?.name || ""} [${inv.invoiceNo}]`;
  renderLineItemsModalTable(inv);
  document.getElementById("itemsModal").classList.remove("hidden");
}

function renderLineItemsModalTable(inv) {
  const tbody = document.getElementById("lineItemsTbody");
  tbody.innerHTML = "";

  const prdOptions =
    `<option value="">-- 品目マスタから引用 --</option>` +
    state.products
      .map((p) => {
        const rateText = p.taxRate === 8 ? "8%軽減" : p.taxRate === 0 ? "非課税" : "10%";
        return `<option value="${p.id}">[${rateText}] ${escapeHtml(p.name)} (¥${fmtNum(p.unitPrice)})</option>`;
      })
      .join("");

  inv.items.forEach((item, idx) => {
    const lineNet = toInt(Number(item.qty || 0) * Number(item.unitPrice || 0));
    const tr = document.createElement("tr");
    tr.dataset.idx = String(idx);
    tr.innerHTML = `
      <td class="col-rownum">${idx + 1}</td>
      <td>
        <select class="cell-select" data-line-action="pick-product" data-idx="${idx}">
          ${prdOptions}
        </select>
      </td>
      <td>
        <input type="text" class="cell-input" data-line-field="name" data-idx="${idx}" value="${escapeAttr(item.name || "")}" placeholder="品目・作業名" />
      </td>
      <td>
        <select class="cell-select" data-line-field="taxRate" data-idx="${idx}">
          <option value="10" ${Number(item.taxRate) === 10 ? "selected" : ""}>標準 10%</option>
          <option value="8" ${Number(item.taxRate) === 8 ? "selected" : ""}>軽減 8% (※)</option>
          <option value="0" ${Number(item.taxRate) === 0 ? "selected" : ""}>非課税 0%</option>
        </select>
      </td>
      <td>
        <input type="number" step="any" class="cell-input num-input" data-line-field="qty" data-idx="${idx}" value="${item.qty ?? 1}" />
      </td>
      <td>
        <input type="text" class="cell-input" data-line-field="unit" data-idx="${idx}" value="${escapeAttr(item.unit || "式")}" />
      </td>
      <td>
        <input type="text" inputmode="numeric" class="cell-input num-input" data-line-field="unitPrice" data-idx="${idx}" value="${fmtNum(item.unitPrice || 0)}" />
      </td>
      <td>
        <div class="cell-readonly" data-line-role="lineNet">${fmtYen(lineNet)}</div>
      </td>
      <td style="text-align: center;">
        <button type="button" class="btn-mini del-btn" data-line-action="del-line" data-idx="${idx}">✕</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  updateLineItemsModalSummary(inv);
}

function updateLineItemsModalSummary(inv) {
  syncInvoiceFromLineItems(inv);
  const c = calcInvoiceAmounts(inv);
  const sumEl = document.getElementById("lineItemsSummaryText");
  sumEl.textContent = `10%対象税抜: ${fmtYen(c.net10)} (税:${fmtYen(c.tax10)}) ／ 8%軽減税抜: ${fmtYen(c.net8)} (税:${fmtYen(c.tax8)}) ／ 非課税: ${fmtYen(c.exempt0)} ➔ 請求税込合計: ${fmtYen(c.totalGross)}`;
}

/**
 * モーダル2A: 単票の適格請求書プレビュー
 */
function openInvoicePreviewModal(invoiceId) {
  const inv = state.invoices.find((i) => i.id === invoiceId);
  if (!inv) return;
  activeModalInvoiceId = invoiceId;
  activeCombinedTarget = null;
  ensureInvoiceLineItems(inv);

  document.getElementById("invoicePreviewModalTitle").textContent = `🖨 適格請求書（単票）プレビュー・印刷・PDF出力`;
  document.getElementById("btnEditItemsFromPreview").classList.remove("hidden");
  renderInvoicePrintPaper(inv);
  document.getElementById("invoicePreviewModal").classList.remove("hidden");
}

/**
 * モーダル2B: 同月 × 同一顧客の複数売上を1枚にまとめた「月次合算請求書（締め請求書）」プレビュー
 */
function openCombinedMonthlyInvoiceModal(ym, customerId) {
  const { computedById, sortedInvoices } = computeChronologicalRunningBalances();
  const targetInvoices = sortedInvoices.filter(
    (inv) => inv.customerId === customerId && (inv.invoiceDate || "").slice(0, 7) === ym
  );
  if (targetInvoices.length === 0) {
    showToast("対象月の請求データがありません。");
    return;
  }

  activeModalInvoiceId = null;
  activeCombinedTarget = { ym, customerId };

  const cust = getCustomerById(customerId);
  const [y, m] = ym.split("-");
  document.getElementById("invoicePreviewModalTitle").textContent = `🖨 【月まとめ合算請求書】 ${y}年${parseInt(m, 10)}月度 — ${cust?.name || ""}（全${targetInvoices.length}件合算）`;
  document.getElementById("btnEditItemsFromPreview").classList.add("hidden");

  renderCombinedInvoicePrintPaper(ym, customerId, targetInvoices, computedById);
  document.getElementById("invoicePreviewModal").classList.remove("hidden");
}

function renderCombinedInvoicePrintPaper(ym, customerId, targetInvoices, computedById) {
  const cust = getCustomerById(customerId);
  const showCarry = document.getElementById("chkShowCarryOnInvoice").checked;
  const [y, m] = ym.split("-");
  const ymLabel = `${y}年${parseInt(m, 10)}月度`;

  const firstComp = computedById.get(targetInvoices[0].id);
  const lastComp = computedById.get(targetInvoices[targetInvoices.length - 1].id);
  const prevCarry = firstComp ? firstComp.prevCarry : computeCarryInBeforeDate(`${ym}-01`, customerId);

  let net10 = 0,
    net8 = 0,
    exempt0 = 0,
    paidAmount = 0;
  const combinedLines = [];
  const notes = [];

  targetInvoices.forEach((inv) => {
    ensureInvoiceLineItems(inv);
    const c = calcInvoiceAmounts(inv);
    net10 += c.net10;
    net8 += c.net8;
    exempt0 += c.exempt0;
    paidAmount += c.paidAmount;
    if (inv.note) notes.push(`${inv.invoiceDate}: ${inv.note}`);

    inv.items.forEach((it) => {
      combinedLines.push({
        date: inv.invoiceDate,
        invoiceNo: inv.invoiceNo,
        name: it.name,
        taxRate: it.taxRate,
        qty: it.qty,
        unit: it.unit,
        unitPrice: it.unitPrice
      });
    });
  });

  // インボイス制度に準拠し、税率区分ごとの税抜合計に対して端数処理1回で消費税を算出
  const tax10 = Math.floor(net10 * 0.1);
  const tax8 = Math.floor(net8 * 0.08);
  const totalGross = net10 + tax10 + net8 + tax8 + exempt0;
  const closingCarry = lastComp ? lastComp.runningCarryBalance : prevCarry + totalGross - paidAmount;
  const currentBillAmount = showCarry ? closingCarry : totalGross;

  const itemsHtml = combinedLines
    .map((it, idx) => {
      const lineNet = toInt(Number(it.qty || 0) * Number(it.unitPrice || 0));
      const rateMark = Number(it.taxRate) === 8 ? "8% ※" : Number(it.taxRate) === 0 ? "非課税" : "10%";
      const itemNameWithMark =
        Number(it.taxRate) === 8 && !String(it.name).includes("※")
          ? `${escapeHtml(it.name)} ※`
          : escapeHtml(it.name);
      return `
        <tr>
          <td style="text-align: center; width: 32px;">${idx + 1}</td>
          <td style="text-align: center; width: 85px; font-family: var(--font-mono); font-size: 11px;">${escapeHtml(it.date || "")}</td>
          <td style="text-align: center; width: 90px; font-family: var(--font-mono); font-size: 11px;">${escapeHtml(it.invoiceNo || "")}</td>
          <td>${itemNameWithMark}</td>
          <td style="text-align: right; width: 55px; font-family: var(--font-mono);">${escapeHtml(it.qty)}</td>
          <td style="text-align: center; width: 48px;">${escapeHtml(it.unit || "式")}</td>
          <td style="text-align: right; width: 95px; font-family: var(--font-mono);">${fmtYen(it.unitPrice)}</td>
          <td style="text-align: center; width: 62px;">${rateMark}</td>
          <td style="text-align: right; width: 105px; font-family: var(--font-mono); font-weight: 700;">${fmtYen(lineNet)}</td>
        </tr>
      `;
    })
    .join("");

  const carryBoxHtml = showCarry
    ? `
      <table class="inv-carry-table">
        <thead>
          <tr>
            <th>前月繰越残高 ①</th>
            <th>当月ご入金額 ②</th>
            <th>差引繰越残高 (①−②)</th>
            <th>当月お買上計 (${targetInvoices.length}件税込) ③</th>
            <th style="background:#dbeafe; color:#1e3a8a;">今回ご請求合計 (①−②＋③)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>${fmtYen(prevCarry)}</td>
            <td>${fmtYen(paidAmount)}</td>
            <td>${fmtYen(prevCarry - paidAmount)}</td>
            <td>${fmtYen(totalGross)}</td>
            <td style="background:#eff6ff; color:#1e3a8a; font-size:15px;">${fmtYen(closingCarry)}</td>
          </tr>
        </tbody>
      </table>
    `
    : "";

  const lastDate = targetInvoices[targetInvoices.length - 1].invoiceDate || `${ym}-30`;
  const combinedInvNo = `SUM-${ym.replace("-", "")}-${cust?.code || "CUST"}`;

  const paper = document.getElementById("invoicePrintSheet");
  paper.innerHTML = `
    <div>
      <div class="inv-title-bar">
        <h1>御 請 求 書（${ymLabel} 合算）</h1>
      </div>

      <div class="inv-top-grid">
        <div class="inv-recipient">
          <div class="inv-recipient-name">${escapeHtml(cust?.name || "お取引先")} 御中</div>
          ${cust?.address ? `<div style="font-size:11.5px; color:#334155; margin-bottom:4px;">${escapeHtml(cust.address)}</div>` : ""}
          ${cust?.paymentTerms ? `<div style="font-size:11px; color:#475569;">お支払条件: ${escapeHtml(cust.paymentTerms)}</div>` : ""}
          <div style="margin-top: 10px; font-size: 11.5px;">下記の通り、${ymLabel}（全${targetInvoices.length}件）のご請求を申し上げます。</div>
        </div>

        <div class="inv-issuer">
          <div><strong>請求締日:</strong> ${escapeHtml(lastDate)}</div>
          <div><strong>合算請求番号:</strong> ${escapeHtml(combinedInvNo)}</div>
          <div class="inv-issuer-name">${escapeHtml(state.issuer.name)}</div>
          <div class="inv-reg-badge">登録番号: ${escapeHtml(state.issuer.regNo || "未設定")}</div>
          <div>${escapeHtml(state.issuer.address)}</div>
          <div>${escapeHtml(state.issuer.contact)}</div>
        </div>
      </div>

      <div class="inv-grand-box">
        <div class="inv-grand-label">
          ${showCarry ? `${ymLabel} ご請求金額（繰越反映後・税込）` : `${ymLabel} お買上合計金額（税込）`}
        </div>
        <div class="inv-grand-amount">${fmtYen(currentBillAmount)} -</div>
      </div>

      ${carryBoxHtml}

      <table class="inv-items-table">
        <thead>
          <tr>
            <th>No.</th>
            <th>取引日</th>
            <th>伝票番号</th>
            <th>品目・摘要</th>
            <th>数量</th>
            <th>単位</th>
            <th>単価(税抜)</th>
            <th>税率</th>
            <th>金額(税抜)</th>
          </tr>
        </thead>
        <tbody>
          ${itemsHtml}
        </tbody>
      </table>

      <div class="inv-tax-summary-wrap">
        <div style="font-size: 11px; color: #334155;">
          <div>※ 印は軽減税率（8%）対象品目を示します。</div>
          <div>※ 当月伝票 ${targetInvoices.length} 件分を合算集計しております。</div>
          ${notes.length > 0 ? `<div style="margin-top:6px;"><strong>【備考】</strong> ${escapeHtml(notes.join(" / "))}</div>` : ""}
        </div>

        <table class="inv-tax-table">
          <tbody>
            <tr>
              <th>10%標準対象 税抜合計</th>
              <td>${fmtYen(net10)}</td>
              <th>10%消費税</th>
              <td>${fmtYen(tax10)}</td>
            </tr>
            <tr>
              <th>8%軽減対象(※) 税抜合計</th>
              <td>${fmtYen(net8)}</td>
              <th>8%消費税</th>
              <td>${fmtYen(tax8)}</td>
            </tr>
            ${
              exempt0 !== 0
                ? `<tr>
                    <th>非課税・対象外合計</th>
                    <td>${fmtYen(exempt0)}</td>
                    <th>-</th>
                    <td>¥0</td>
                  </tr>`
                : ""
            }
            <tr style="background:#eff6ff; font-weight:700;">
              <th style="background:#dbeafe;">当月お買上 税込合計</th>
              <td colspan="3" style="font-size:14px; color:#1e3a8a;">${fmtYen(totalGross)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="inv-footer-box">
      <div><strong>【お振込先口座】</strong> ${escapeHtml(state.issuer.bank)}</div>
      <div style="margin-top: 4px; color: #475569;">${escapeHtml(state.issuer.note)}</div>
    </div>
  `;
}

function renderInvoicePrintPaper(inv) {
  const { computedById } = computeChronologicalRunningBalances();
  const comp = computedById.get(inv.id) || calcInvoiceAmounts(inv);
  const cust = getCustomerById(inv.customerId);
  const showCarry = document.getElementById("chkShowCarryOnInvoice").checked;

  const prevCarry = comp.prevCarry ?? 0;
  const currentBillAmount = showCarry ? comp.runningCarryBalance : comp.totalGross;

  const itemsHtml = inv.items
    .map((it, idx) => {
      const lineNet = toInt(Number(it.qty || 0) * Number(it.unitPrice || 0));
      const rateMark = Number(it.taxRate) === 8 ? "8% ※" : Number(it.taxRate) === 0 ? "非課税" : "10%";
      const itemNameWithMark =
        Number(it.taxRate) === 8 && !String(it.name).includes("※")
          ? `${escapeHtml(it.name)} ※`
          : escapeHtml(it.name);
      return `
        <tr>
          <td style="text-align: center; width: 36px;">${idx + 1}</td>
          <td>${itemNameWithMark}</td>
          <td style="text-align: right; width: 65px; font-family: var(--font-mono);">${escapeHtml(it.qty)}</td>
          <td style="text-align: center; width: 55px;">${escapeHtml(it.unit || "式")}</td>
          <td style="text-align: right; width: 105px; font-family: var(--font-mono);">${fmtYen(it.unitPrice)}</td>
          <td style="text-align: center; width: 70px;">${rateMark}</td>
          <td style="text-align: right; width: 115px; font-family: var(--font-mono); font-weight: 700;">${fmtYen(lineNet)}</td>
        </tr>
      `;
    })
    .join("");

  const carryBoxHtml = showCarry
    ? `
      <table class="inv-carry-table">
        <thead>
          <tr>
            <th>前回繰越残高 ①</th>
            <th>今回ご入金額 ②</th>
            <th>差引繰越残高 (①−②)</th>
            <th>今回お買上額 (税込) ③</th>
            <th style="background:#dbeafe; color:#1e3a8a;">今回ご請求合計 (①−②＋③)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>${fmtYen(prevCarry)}</td>
            <td>${fmtYen(comp.paidAmount)}</td>
            <td>${fmtYen(prevCarry - comp.paidAmount)}</td>
            <td>${fmtYen(comp.totalGross)}</td>
            <td style="background:#eff6ff; color:#1e3a8a; font-size:15px;">${fmtYen(comp.runningCarryBalance)}</td>
          </tr>
        </tbody>
      </table>
    `
    : "";

  const paper = document.getElementById("invoicePrintSheet");
  paper.innerHTML = `
    <div>
      <div class="inv-title-bar">
        <h1>御 請 求 書</h1>
      </div>

      <div class="inv-top-grid">
        <div class="inv-recipient">
          <div class="inv-recipient-name">${escapeHtml(cust?.name || "お取引先")} 御中</div>
          ${cust?.address ? `<div style="font-size:11.5px; color:#334155; margin-bottom:4px;">${escapeHtml(cust.address)}</div>` : ""}
          ${cust?.paymentTerms ? `<div style="font-size:11px; color:#475569;">お支払条件: ${escapeHtml(cust.paymentTerms)}</div>` : ""}
          <div style="margin-top: 10px; font-size: 11.5px;">下記の通りご請求申し上げます。</div>
        </div>

        <div class="inv-issuer">
          <div><strong>請求日:</strong> ${escapeHtml(inv.invoiceDate || "-")}</div>
          <div><strong>請求書番号:</strong> ${escapeHtml(inv.invoiceNo || "-")}</div>
          <div class="inv-issuer-name">${escapeHtml(state.issuer.name)}</div>
          <div class="inv-reg-badge">登録番号: ${escapeHtml(state.issuer.regNo || "未設定")}</div>
          <div>${escapeHtml(state.issuer.address)}</div>
          <div>${escapeHtml(state.issuer.contact)}</div>
        </div>
      </div>

      <div class="inv-grand-box">
        <div class="inv-grand-label">
          ${showCarry ? "今回ご請求金額（繰越反映後・税込）" : "今回ご請求金額（税込）"}
        </div>
        <div class="inv-grand-amount">${fmtYen(currentBillAmount)} -</div>
      </div>

      ${carryBoxHtml}

      <table class="inv-items-table">
        <thead>
          <tr>
            <th>No.</th>
            <th>品目・摘要</th>
            <th>数量</th>
            <th>単位</th>
            <th>単価(税抜)</th>
            <th>税率</th>
            <th>金額(税抜)</th>
          </tr>
        </thead>
        <tbody>
          ${itemsHtml}
        </tbody>
      </table>

      <div class="inv-tax-summary-wrap">
        <div style="font-size: 11px; color: #334155;">
          <div>※ 印は軽減税率（8%）対象品目を示します。</div>
          ${inv.note ? `<div style="margin-top:6px;"><strong>【備考】</strong> ${escapeHtml(inv.note)}</div>` : ""}
        </div>

        <table class="inv-tax-table">
          <tbody>
            <tr>
              <th>10%標準対象 税抜合計</th>
              <td>${fmtYen(comp.net10)}</td>
              <th>10%消費税</th>
              <td>${fmtYen(comp.tax10)}</td>
            </tr>
            <tr>
              <th>8%軽減対象(※) 税抜合計</th>
              <td>${fmtYen(comp.net8)}</td>
              <th>8%消費税</th>
              <td>${fmtYen(comp.tax8)}</td>
            </tr>
            ${
              comp.exempt0 !== 0
                ? `<tr>
                    <th>非課税・対象外合計</th>
                    <td>${fmtYen(comp.exempt0)}</td>
                    <th>-</th>
                    <td>¥0</td>
                  </tr>`
                : ""
            }
            <tr style="background:#eff6ff; font-weight:700;">
              <th style="background:#dbeafe;">今回お買上 税込合計</th>
              <td colspan="3" style="font-size:14px; color:#1e3a8a;">${fmtYen(comp.totalGross)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="inv-footer-box">
      <div><strong>【お振込先口座】</strong> ${escapeHtml(state.issuer.bank)}</div>
      <div style="margin-top: 4px; color: #475569;">${escapeHtml(state.issuer.note)}</div>
    </div>
  `;
}

// セル入力中のインプレース更新
function updateLedgerRowAndTotalsInPlace(editedRowTr, inv) {
  const { computedById } = computeChronologicalRunningBalances();
  const allRows = document.querySelectorAll("#ledgerTbody tr[data-id]");
  allRows.forEach((tr) => {
    const rowId = tr.dataset.id;
    const comp = computedById.get(rowId);
    if (!comp) return;
    if (tr === editedRowTr) {
      tr.querySelector('[data-role="tax10"]').textContent = fmtNum(comp.tax10);
      tr.querySelector('[data-role="tax8"]').textContent = fmtNum(comp.tax8);
      tr.querySelector('[data-role="totalGross"]').textContent = fmtNum(comp.totalGross);
      tr.querySelector('[data-role="statusCell"]').innerHTML = getStatusBadgeHtml(comp.status);

      const balEl = tr.querySelector('[data-role="singleBalance"]');
      balEl.textContent = fmtNum(comp.singleBalance);
      balEl.className = `cell-readonly ${comp.singleBalance > 0 ? "balance-unpaid" : "balance-zero"}`;
    }
    const carryEl = tr.querySelector('[data-role="runningCarry"]');
    if (carryEl) carryEl.textContent = fmtNum(comp.runningCarryBalance);
  });

  renderSummaryBar();
  renderMatrixSheet();
  renderPeriodSummarySheet();
  renderCustomersSheet();
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(str) {
  return escapeHtml(str);
}

let toastTimer = null;
function showToast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("hidden"), 3500);
}

function addNewInvoiceRow() {
  const defaultCust =
    state.settings.customerFilter !== "ALL"
      ? state.settings.customerFilter
      : state.customers[0]?.id || "";

  let defaultDate = new Date().toISOString().slice(0, 10);
  if (state.settings.selectedMonth !== "ALL") {
    defaultDate = `${state.settings.selectedMonth}-28`;
  } else {
    const months = getFiscalYearMonths(state.settings.selectedFiscalYear, state.settings.fiscalEndMonth);
    const todayYm = defaultDate.slice(0, 7);
    if (!months.includes(todayYm)) defaultDate = `${months[0]}-28`;
  }

  const nextSeq = state.invoices.length + 1;
  const ymCompact = defaultDate.slice(2, 7).replace("-", "");
  const newInv = {
    id: `INV-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    invoiceDate: defaultDate,
    invoiceNo: `INV-${ymCompact}-${String(nextSeq).padStart(2, "0")}`,
    customerId: defaultCust,
    itemTitle: "",
    net10: 0,
    net8: 0,
    exempt0: 0,
    paidAmount: 0,
    paidDate: "",
    note: "",
    items: []
  };

  state.invoices.push(newInv);
  saveState();
  renderAll();

  setTimeout(() => {
    const row = document.querySelector(`#ledgerTbody tr[data-id="${newInv.id}"]`);
    if (row) {
      row.scrollIntoView({ behavior: "smooth", block: "nearest" });
      const itemInput = row.querySelector('[data-field="itemTitle"]');
      if (itemInput) itemInput.focus();
    }
  }, 50);
}

/**
 * チェックした同一顧客の複数行を1枚の請求書データに統合（マージ）する
 */
function mergeSelectedInvoiceRows() {
  const checkedIds = Array.from(document.querySelectorAll(".row-select-chk:checked")).map(
    (c) => c.dataset.id
  );
  if (checkedIds.length < 2) {
    showToast("合算統合したい複数の行（2行以上）にチェックを入れてください。");
    return;
  }

  const selectedInvs = state.invoices.filter((i) => checkedIds.includes(i.id));
  const custSet = new Set(selectedInvs.map((i) => i.customerId));
  if (custSet.size > 1) {
    showToast("異なる顧客の行が混ざっています。同じ顧客の行を選択してください。");
    return;
  }

  // 日付昇順に並べて最後の行の日付をベースにする
  selectedInvs.sort((a, b) => (a.invoiceDate || "").localeCompare(b.invoiceDate || ""));
  const baseInv = selectedInvs[selectedInvs.length - 1];
  const mergedItems = [];
  let totalPaid = 0;
  let latestPaidDate = "";
  const notes = [];

  selectedInvs.forEach((inv) => {
    ensureInvoiceLineItems(inv);
    inv.items.forEach((it) => {
      mergedItems.push({
        name: `${it.name} (${inv.invoiceDate.slice(5)})`,
        taxRate: it.taxRate,
        qty: it.qty,
        unit: it.unit,
        unitPrice: it.unitPrice
      });
    });
    totalPaid += toInt(inv.paidAmount);
    if (inv.paidDate && inv.paidDate > latestPaidDate) latestPaidDate = inv.paidDate;
    if (inv.note) notes.push(inv.note);
  });

  baseInv.items = mergedItems;
  syncInvoiceFromLineItems(baseInv);
  baseInv.paidAmount = totalPaid;
  baseInv.paidDate = latestPaidDate;
  baseInv.note = notes.join(" / ");

  // 統合元となった他の行を削除
  const removeIds = new Set(checkedIds.filter((id) => id !== baseInv.id));
  state.invoices = state.invoices.filter((i) => !removeIds.has(i.id));

  saveState();
  renderAll();
  showToast(`🔗 選択された ${checkedIds.length} 件の売上を 1枚の請求書（${baseInv.invoiceNo}）に合算統合しました！`);
}

// スプレッドシートコピー＆CSV出力
function buildExportRowsForCurrentView() {
  const tab = state.settings.activeTab;

  if (tab === "ledger") {
    const { filtered, computedById, bounds } = getFilteredInvoices();
    const carryIn = computeCarryInBeforeDate(bounds.cutoffDate, state.settings.customerFilter);

    const headers = [
      "請求日",
      "請求書番号",
      "顧客コード",
      "顧客名（取引先）",
      "品目・案件摘要",
      "10%対象(税抜)",
      "10%消費税",
      "8%軽減対象(税抜)",
      "8%消費税",
      "非課税/対象外",
      "税抜売上合計",
      "消費税合計",
      "請求税込合計",
      "入金金額",
      "入金日",
      "ステータス",
      "単票未収残高",
      "顧客別累計繰越残高",
      "備考"
    ];

    const rows = [
      headers,
      [
        bounds.cutoffDate,
        "繰越",
        "",
        "【期首（前月）繰越残高】",
        "期間開始前の未回収売掛残高",
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        "",
        "繰越",
        carryIn,
        carryIn,
        ""
      ]
    ];

    filtered.forEach((inv) => {
      const c = computedById.get(inv.id);
      const cust = getCustomerById(inv.customerId);
      const statusText =
        c.status === "PAID"
          ? "入金済"
          : c.status === "PARTIAL"
          ? "一部入金"
          : c.status === "OVERPAID"
          ? "繰越消込"
          : "未入金";

      rows.push([
        inv.invoiceDate,
        inv.invoiceNo,
        cust?.code || "",
        cust?.name || "",
        inv.itemTitle,
        c.net10,
        c.tax10,
        c.net8,
        c.tax8,
        c.exempt0,
        c.totalNet,
        c.totalTax,
        c.totalGross,
        c.paidAmount,
        inv.paidDate || "",
        statusText,
        c.singleBalance,
        c.runningCarryBalance,
        inv.note || ""
      ]);
    });

    return rows;
  }

  const tableId =
    tab === "matrix"
      ? "matrixTable"
      : tab === "period"
      ? "periodTable"
      : tab === "products"
      ? "productTable"
      : "customerTable";
  const tableEl = document.getElementById(tableId);
  const rows = [];
  tableEl.querySelectorAll("tr").forEach((tr) => {
    const rowData = [];
    tr.querySelectorAll("th, td").forEach((cell) => {
      const input = cell.querySelector("input, select");
      if (input) {
        rowData.push(input.value);
      } else {
        rowData.push(cell.innerText.replace(/\s+/g, " ").trim());
      }
    });
    rows.push(rowData);
  });
  return rows;
}

function copyForSpreadsheet() {
  const rows = buildExportRowsForCurrentView();
  const tsv = rows
    .map((r) => r.map((cell) => String(cell ?? "").replace(/[\t\r\n]/g, " ")).join("\t"))
    .join("\n");

  navigator.clipboard
    .writeText(tsv)
    .then(() => {
      showToast("📋 クリップボードにコピーしました！GoogleスプレッドシートやExcelのセルにそのまま貼り付け(Ctrl+V)できます。");
    })
    .catch(() => {
      showToast("コピーに失敗しました。");
    });
}

function exportCsvForAccountant() {
  const rows = buildExportRowsForCurrentView();
  const csvContent = rows
    .map((r) =>
      r
        .map((cell) => {
          const s = String(cell ?? "");
          return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(",")
    )
    .join("\r\n");

  const bom = new Uint8Array([0xef, 0xbb, 0xbf]);
  const blob = new Blob([bom, csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `売上入金繰越集計_${state.settings.selectedFiscalYear}年度_${state.settings.activeTab}_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast("⬇ 税理士共有用CSVをダウンロードしました。");
}

function setupEventListeners() {
  document.getElementById("fiscalEndMonth").addEventListener("change", (e) => {
    state.settings.fiscalEndMonth = parseInt(e.target.value, 10);
    state.settings.selectedMonth = "ALL";
    saveState();
    renderAll();
    showToast(`決算月を「${state.settings.fiscalEndMonth}月期末」に変更し、年度集計を再計算しました。`);
  });

  document.getElementById("fiscalYearSelect").addEventListener("change", (e) => {
    state.settings.selectedFiscalYear = parseInt(e.target.value, 10);
    state.settings.selectedMonth = "ALL";
    saveState();
    renderAll();
  });

  document.getElementById("monthFilterSelect").addEventListener("change", (e) => {
    state.settings.selectedMonth = e.target.value;
    saveState();
    renderAll();
  });

  document.getElementById("customerFilterSelect").addEventListener("change", (e) => {
    state.settings.customerFilter = e.target.value;
    saveState();
    renderAll();
  });

  document.getElementById("statusFilterSelect").addEventListener("change", (e) => {
    state.settings.statusFilter = e.target.value;
    saveState();
    renderAll();
  });

  document.getElementById("searchInput").addEventListener("input", (e) => {
    state.settings.searchQuery = e.target.value;
    renderLedgerSheet();
  });

  document.getElementById("chkGroupSameMonthCustomer").addEventListener("change", (e) => {
    state.settings.groupSameMonthCustomer = e.target.checked;
    saveState();
    renderLedgerSheet();
  });

  document.getElementById("chkInputModeGross").addEventListener("change", (e) => {
    state.settings.inputModeGross = e.target.checked;
    saveState();
    renderAll();
  });

  // タブ切り替え
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tab;
      state.settings.activeTab = tab;
      document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b === btn));
      document.querySelectorAll(".tab-panel").forEach((p) =>
        p.classList.toggle("active", p.id === `tab-${tab}`)
      );
      saveState();
    });
  });

  // マトリクス表示切替・ジャンプ
  document.querySelectorAll("#matrixMetricSelect .seg-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.settings.matrixMetric = btn.dataset.metric;
      document.querySelectorAll("#matrixMetricSelect .seg-btn").forEach((b) =>
        b.classList.toggle("active", b === btn)
      );
      saveState();
      renderMatrixSheet();
    });
  });

  document.getElementById("matrixTbody").addEventListener("click", (e) => {
    const cell = e.target.closest(".matrix-cell-clickable");
    if (!cell) return;
    state.settings.customerFilter = cell.dataset.cust;
    state.settings.selectedMonth = cell.dataset.ym;
    state.settings.activeTab = "ledger";
    saveState();
    document.querySelectorAll(".tab-btn").forEach((b) =>
      b.classList.toggle("active", b.dataset.tab === "ledger")
    );
    document.querySelectorAll(".tab-panel").forEach((p) =>
      p.classList.toggle("active", p.id === "tab-ledger")
    );
    renderAll();
  });

  document.querySelectorAll("#periodGroupSelect .seg-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.settings.periodGroup = btn.dataset.group;
      document.querySelectorAll("#periodGroupSelect .seg-btn").forEach((b) =>
        b.classList.toggle("active", b === btn)
      );
      saveState();
      renderPeriodSummarySheet();
    });
  });

  // TAB 3 内の「月まとめ請求書」ボタンイベント
  document.getElementById("periodTbody").addEventListener("click", (e) => {
    const btn = e.target.closest('button[data-action="preview-combined-invoice"]');
    if (!btn) return;
    openCombinedMonthlyInvoiceModal(btn.dataset.ym, btn.dataset.cust);
  });

  // 元帳テーブルのセル編集
  const ledgerTbody = document.getElementById("ledgerTbody");

  ledgerTbody.addEventListener("input", (e) => {
    const target = e.target;
    const tr = target.closest("tr[data-id]");
    if (!tr) return;
    const inv = state.invoices.find((i) => i.id === tr.dataset.id);
    if (!inv) return;

    const field = target.dataset.field;
    if (!field) return;

    if (field === "itemTitle") {
      inv.itemTitle = target.value;
      const matchedPrd = state.products.find((p) => p.name === target.value.trim());
      if (matchedPrd && inv.net10 === 0 && inv.net8 === 0 && inv.exempt0 === 0) {
        const rate = Number(matchedPrd.taxRate);
        if (rate === 8) inv.net8 = toInt(matchedPrd.unitPrice);
        else if (rate === 0) inv.exempt0 = toInt(matchedPrd.unitPrice);
        else inv.net10 = toInt(matchedPrd.unitPrice);

        inv.items = [
          {
            name: matchedPrd.name,
            taxRate: rate,
            qty: 1,
            unit: matchedPrd.unit || "式",
            unitPrice: toInt(matchedPrd.unitPrice)
          }
        ];
        saveState();
        renderAll();
        showToast(`📦 品目マスタ「${matchedPrd.name}」から税区分(${rate}%)と単価(${fmtYen(matchedPrd.unitPrice)})を自動入力しました！`);
        return;
      }
    } else if (field === "net10" || field === "net8" || field === "exempt0" || field === "paidAmount") {
      const rawVal = toInt(target.value);
      if (state.settings.inputModeGross && field === "net10") {
        inv.net10 = Math.ceil(rawVal / 1.1);
      } else if (state.settings.inputModeGross && field === "net8") {
        inv.net8 = Math.ceil(rawVal / 1.08);
      } else {
        inv[field] = rawVal;
      }
      inv.items = [];
      ensureInvoiceLineItems(inv);
    } else {
      inv[field] = target.value;
    }

    saveState();
    updateLedgerRowAndTotalsInPlace(tr, inv);
  });

  ledgerTbody.addEventListener(
    "blur",
    (e) => {
      const target = e.target;
      if (!target.classList || !target.classList.contains("num-input")) return;
      renderLedgerSheet();
    },
    true
  );

  // 元帳テーブルのアクションボタン（明細編集 / 全額入金 / 単票請求書 / 月まとめ合算請求書 / 削除）
  ledgerTbody.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const action = btn.dataset.action;

    if (action === "preview-combined-invoice") {
      openCombinedMonthlyInvoiceModal(btn.dataset.ym, btn.dataset.cust);
      return;
    }

    const id = btn.dataset.id;
    const inv = state.invoices.find((i) => i.id === id);
    if (!inv) return;

    if (action === "edit-items") {
      openItemsModal(id);
    } else if (action === "preview-invoice") {
      openInvoicePreviewModal(id);
    } else if (action === "fill-paid") {
      const comp = calcInvoiceAmounts(inv);
      inv.paidAmount = comp.totalGross;
      if (!inv.paidDate) inv.paidDate = new Date().toISOString().slice(0, 10);
      saveState();
      renderAll();
      showToast(`請求番号 ${inv.invoiceNo} に全額入金（${fmtYen(comp.totalGross)}）を反映しました。`);
    } else if (action === "delete-row") {
      state.invoices = state.invoices.filter((i) => i.id !== id);
      saveState();
      renderAll();
      showToast("請求行を削除しました。");
    }
  });

  ledgerTbody.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.isComposing) {
      e.preventDefault();
      const target = e.target;
      const field = target.dataset.field;
      const tr = target.closest("tr[data-id]");
      if (!tr || !field) return;

      // 次のデータ行を探す（小計行をスキップ）
      let nextTr = tr.nextElementSibling;
      while (nextTr && !nextTr.dataset.id) {
        nextTr = nextTr.nextElementSibling;
      }
      if (nextTr && nextTr.dataset.id) {
        const nextInput = nextTr.querySelector(`[data-field="${field}"]`);
        if (nextInput) {
          nextInput.focus();
          if (nextInput.select) nextInput.select();
        }
      } else {
        addNewInvoiceRow();
      }
    }
  });

  document.getElementById("btnAddRow").addEventListener("click", () => addNewInvoiceRow());
  document.getElementById("btnMergeSelected").addEventListener("click", () => mergeSelectedInvoiceRows());

  document.getElementById("btnDuplicateRow").addEventListener("click", () => {
    const checked = Array.from(document.querySelectorAll(".row-select-chk:checked")).map((c) => c.dataset.id);
    if (checked.length === 0) {
      showToast("複製する行にチェックを入れてください。");
      return;
    }
    checked.forEach((id) => {
      const orig = state.invoices.find((i) => i.id === id);
      if (orig) {
        state.invoices.push({
          ...JSON.parse(JSON.stringify(orig)),
          id: `INV-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          invoiceNo: `${orig.invoiceNo}-COPY`,
          paidAmount: 0,
          paidDate: ""
        });
      }
    });
    saveState();
    renderAll();
    showToast(`${checked.length}件の行を複製しました。`);
  });

  document.getElementById("btnDeleteSelected").addEventListener("click", () => {
    const checked = Array.from(document.querySelectorAll(".row-select-chk:checked")).map((c) => c.dataset.id);
    if (checked.length === 0) {
      showToast("削除する行にチェックを入れてください。");
      return;
    }
    state.invoices = state.invoices.filter((i) => !checked.includes(i.id));
    saveState();
    renderAll();
    showToast(`${checked.length}件の行を削除しました。`);
  });

  document.getElementById("chkSelectAll").addEventListener("change", (e) => {
    document.querySelectorAll(".row-select-chk").forEach((chk) => {
      chk.checked = e.target.checked;
    });
  });

  // TAB 4: 品目マスタ
  const prdTbody = document.getElementById("productTbody");
  prdTbody.addEventListener("input", (e) => {
    const target = e.target;
    const tr = target.closest("tr[data-prd-id]");
    if (!tr) return;
    const prd = state.products.find((p) => p.id === tr.dataset.prdId);
    if (!prd) return;
    const field = target.dataset.prdField;
    if (!field) return;

    if (field === "unitPrice" || field === "taxRate") {
      prd[field] = toInt(target.value);
    } else {
      prd[field] = target.value;
    }
    saveState();
    syncHeaderSelectors();
  });

  prdTbody.addEventListener(
    "blur",
    (e) => {
      if (e.target.dataset && e.target.dataset.prdField) renderProductsSheet();
    },
    true
  );

  prdTbody.addEventListener("click", (e) => {
    const btn = e.target.closest('button[data-action="delete-product"]');
    if (!btn) return;
    state.products = state.products.filter((p) => p.id !== btn.dataset.id);
    saveState();
    renderAll();
    showToast("品目を削除しました。");
  });

  document.getElementById("btnAddProduct").addEventListener("click", () => {
    const seq = state.products.length + 1;
    state.products.push({
      id: `PRD-${Date.now()}`,
      code: `P-${String(seq).padStart(3, "0")}`,
      name: `新規品目・商品 ${seq}`,
      taxRate: 10,
      unitPrice: 10000,
      unit: "式",
      note: ""
    });
    saveState();
    renderAll();
    showToast("新規品目を追加しました。");
  });

  // TAB 5: 自社インボイス設定＆顧客マスタ
  ["issuerName", "issuerRegNo", "issuerAddress", "issuerContact", "issuerBank", "issuerNote"].forEach(
    (id) => {
      document.getElementById(id).addEventListener("input", () => {
        state.issuer.name = document.getElementById("issuerName").value;
        state.issuer.regNo = document.getElementById("issuerRegNo").value;
        state.issuer.address = document.getElementById("issuerAddress").value;
        state.issuer.contact = document.getElementById("issuerContact").value;
        state.issuer.bank = document.getElementById("issuerBank").value;
        state.issuer.note = document.getElementById("issuerNote").value;
        saveState();
      });
    }
  );

  const custTbody = document.getElementById("customerTbody");
  custTbody.addEventListener("input", (e) => {
    const target = e.target;
    const tr = target.closest("tr[data-cust-id]");
    if (!tr) return;
    const cust = getCustomerById(tr.dataset.custId);
    if (!cust) return;
    const field = target.dataset.custField;
    if (!field) return;

    if (field === "openingBalance") {
      cust.openingBalance = toInt(target.value);
    } else {
      cust[field] = target.value;
    }
    saveState();
    renderSummaryBar();
  });

  custTbody.addEventListener(
    "blur",
    (e) => {
      if (e.target.dataset && e.target.dataset.custField) renderAll();
    },
    true
  );

  custTbody.addEventListener("click", (e) => {
    const btn = e.target.closest('button[data-action="delete-customer"]');
    if (!btn) return;
    const id = btn.dataset.id;
    if (state.invoices.some((inv) => inv.customerId === id)) {
      showToast("この顧客には請求データが紐付いているため削除できません。");
      return;
    }
    state.customers = state.customers.filter((c) => c.id !== id);
    saveState();
    renderAll();
    showToast("顧客を削除しました。");
  });

  document.getElementById("btnAddCustomer").addEventListener("click", () => {
    const seq = state.customers.length + 1;
    state.customers.push({
      id: `CUST-${Date.now()}`,
      code: `C${String(seq).padStart(3, "0")}`,
      name: `新規取引先 ${seq}`,
      address: "",
      invoiceRegNo: "",
      openingBalance: 0,
      paymentTerms: "月末締・翌月末払",
      note: ""
    });
    saveState();
    renderAll();
    showToast("新規顧客を追加しました。");
  });

  // モーダル1（品目明細エディタ）
  const lineItemsTbody = document.getElementById("lineItemsTbody");
  lineItemsTbody.addEventListener("change", (e) => {
    const target = e.target;
    if (target.dataset.lineAction === "pick-product") {
      const idx = parseInt(target.dataset.idx, 10);
      const prd = state.products.find((p) => p.id === target.value);
      const inv = state.invoices.find((i) => i.id === activeModalInvoiceId);
      if (prd && inv && inv.items[idx]) {
        inv.items[idx].name = prd.name;
        inv.items[idx].taxRate = Number(prd.taxRate);
        inv.items[idx].unitPrice = toInt(prd.unitPrice);
        inv.items[idx].unit = prd.unit || "式";
        saveState();
        renderLineItemsModalTable(inv);
      }
    }
  });

  lineItemsTbody.addEventListener("input", (e) => {
    const target = e.target;
    const field = target.dataset.lineField;
    if (!field) return;
    const idx = parseInt(target.dataset.idx, 10);
    const inv = state.invoices.find((i) => i.id === activeModalInvoiceId);
    if (!inv || !inv.items[idx]) return;

    if (field === "unitPrice" || field === "taxRate") {
      inv.items[idx][field] = toInt(target.value);
    } else if (field === "qty") {
      inv.items[idx].qty = Number(target.value) || 0;
    } else {
      inv.items[idx][field] = target.value;
    }

    const tr = target.closest("tr");
    if (tr) {
      const lineNet = toInt(Number(inv.items[idx].qty || 0) * Number(inv.items[idx].unitPrice || 0));
      tr.querySelector('[data-line-role="lineNet"]').textContent = fmtYen(lineNet);
    }
    updateLineItemsModalSummary(inv);
    saveState();
  });

  lineItemsTbody.addEventListener("click", (e) => {
    const btn = e.target.closest('button[data-line-action="del-line"]');
    if (!btn) return;
    const idx = parseInt(btn.dataset.idx, 10);
    const inv = state.invoices.find((i) => i.id === activeModalInvoiceId);
    if (!inv) return;
    inv.items.splice(idx, 1);
    if (inv.items.length === 0) {
      inv.items.push({ name: "", taxRate: 10, qty: 1, unit: "式", unitPrice: 0 });
    }
    updateLineItemsModalSummary(inv);
    saveState();
    renderLineItemsModalTable(inv);
  });

  document.getElementById("btnAddLineItem").addEventListener("click", () => {
    const inv = state.invoices.find((i) => i.id === activeModalInvoiceId);
    if (!inv) return;
    inv.items.push({ name: "", taxRate: 10, qty: 1, unit: "式", unitPrice: 0 });
    saveState();
    renderLineItemsModalTable(inv);
  });

  document.getElementById("btnCloseItemsModal").addEventListener("click", () => {
    document.getElementById("itemsModal").classList.add("hidden");
    renderAll();
  });

  document.getElementById("btnSaveItemsModal").addEventListener("click", () => {
    document.getElementById("itemsModal").classList.add("hidden");
    renderAll();
    showToast("品目明細（10%・8%内訳）を元帳シートに反映しました。");
  });

  document.getElementById("btnOpenInvoiceFromItems").addEventListener("click", () => {
    document.getElementById("itemsModal").classList.add("hidden");
    renderAll();
    if (activeModalInvoiceId) openInvoicePreviewModal(activeModalInvoiceId);
  });

  // モーダル2（請求書プレビュー＆印刷）
  document.getElementById("chkShowCarryOnInvoice").addEventListener("change", () => {
    if (activeCombinedTarget) {
      openCombinedMonthlyInvoiceModal(activeCombinedTarget.ym, activeCombinedTarget.customerId);
    } else if (activeModalInvoiceId) {
      const inv = state.invoices.find((i) => i.id === activeModalInvoiceId);
      if (inv) renderInvoicePrintPaper(inv);
    }
  });

  document.getElementById("btnEditItemsFromPreview").addEventListener("click", () => {
    document.getElementById("invoicePreviewModal").classList.add("hidden");
    if (activeModalInvoiceId) openItemsModal(activeModalInvoiceId);
  });

  document.getElementById("btnPrintInvoice").addEventListener("click", () => {
    window.print();
  });

  document.getElementById("btnClosePreviewModal").addEventListener("click", () => {
    document.getElementById("invoicePreviewModal").classList.add("hidden");
  });

  // コピー・CSV出力・データメニュー
  document.getElementById("btnCopyTsv").addEventListener("click", copyForSpreadsheet);
  document.getElementById("btnExportCsv").addEventListener("click", exportCsvForAccountant);

  const menuBtn = document.getElementById("btnDataMenu");
  const menuDropdown = document.getElementById("dataMenuDropdown");
  menuBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    menuDropdown.classList.toggle("hidden");
  });
  document.addEventListener("click", () => menuDropdown.classList.add("hidden"));

  document.getElementById("btnExportJson").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sales_ledger_backup_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("バックアップファイル(JSON)を保存しました。");
  });

  document.getElementById("fileImportJson").addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        if (parsed.customers && parsed.invoices) {
          state.customers = parsed.customers;
          state.invoices = parsed.invoices;
          if (parsed.products) state.products = parsed.products;
          if (parsed.issuer) state.issuer = { ...state.issuer, ...parsed.issuer };
          if (parsed.settings) state.settings = { ...state.settings, ...parsed.settings };
          saveState();
          renderAll();
          showToast("バックアップデータを復元しました。");
        }
      } catch (err) {
        showToast("ファイルの読み込みに失敗しました。");
      }
    };
    reader.readAsText(file);
  });

  document.getElementById("btnLoadSample").addEventListener("click", () => {
    const sample = getInitialSampleData();
    state.products = sample.products;
    state.customers = sample.customers;
    state.invoices = sample.invoices;
    saveState();
    renderAll();
    showToast("サンプルデータを再読み込みしました。");
  });

  document.getElementById("btnClearAll").addEventListener("click", () => {
    state.invoices = [];
    saveState();
    renderAll();
    showToast("請求データをすべてクリアしました。");
  });

  // 同フォルダの data.json を読込ボタン
  const btnLoadRepo = document.getElementById("btnLoadRepoDataJson");
  if (btnLoadRepo) {
    btnLoadRepo.addEventListener("click", () => loadLocalRepoDataJson(false));
  }

  // GitHub 同期ボタン・設定モーダルイベント
  document.getElementById("btnGithubPull").addEventListener("click", () => pullFromGithub(false));
  document.getElementById("btnGithubPush").addEventListener("click", () => pushToGithub());
  document.getElementById("btnGithubSettings").addEventListener("click", () => openGithubModal());
  document.getElementById("btnCloseGithubModal").addEventListener("click", () => {
    document.getElementById("githubModal").classList.add("hidden");
  });

  const readGithubModalInputs = () => {
    ghConfig.owner = document.getElementById("ghOwner").value.trim();
    ghConfig.repo = document.getElementById("ghRepo").value.trim();
    ghConfig.branch = document.getElementById("ghBranch").value.trim() || "main";
    ghConfig.path = document.getElementById("ghPath").value.trim() || "data.json";
    ghConfig.token = document.getElementById("ghToken").value.trim();
    ghConfig.autoPullOnLoad = document.getElementById("ghAutoPullOnLoad").checked;
    saveGithubConfig();
  };

  document.getElementById("btnTestGithubConn").addEventListener("click", async () => {
    readGithubModalInputs();
    const statusBox = document.getElementById("ghSyncStatusBox");
    if (!ghConfig.owner || !ghConfig.repo || !ghConfig.token) {
      statusBox.className = "gh-status-box err";
      statusBox.textContent = "エラー: オーナー名、リポジトリ名、Personal Access Token をすべて入力してください。";
      return;
    }
    statusBox.className = "gh-status-box";
    statusBox.textContent = "GitHub APIへ接続テスト中...";
    try {
      const repoUrl = `https://api.github.com/repos/${encodeURIComponent(ghConfig.owner)}/${encodeURIComponent(ghConfig.repo)}`;
      const res = await fetch(repoUrl, {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${ghConfig.token}`,
          "X-GitHub-Api-Version": "2022-11-28"
        }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const repoInfo = await res.json();
      statusBox.className = "gh-status-box ok";
      statusBox.textContent = `✅ 接続成功！ リポジトリ「${repoInfo.full_name}」(${repoInfo.private ? "Private/非公開" : "Public/公開"}) へのアクセスを確認しました。`;
    } catch (err) {
      statusBox.className = "gh-status-box err";
      statusBox.textContent = `❌ 接続失敗 (${err.message})。リポジトリが存在するか、トークンに Contents 権限があるかご確認ください。`;
    }
  });

  document.getElementById("btnSaveGithubConfig").addEventListener("click", () => {
    readGithubModalInputs();
    document.getElementById("githubModal").classList.add("hidden");
    showToast("☁ GitHub共有設定をブラウザに保存しました。");
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  loadState();
  setupEventListeners();
  renderAll();
  // 自動Pull設定がONでトークンが設定されていれば、起動時にGitHubから最新データを取得
  if (ghConfig.autoPullOnLoad && ghConfig.owner && ghConfig.repo && ghConfig.token) {
    await pullFromGithub(true);
  }
});
