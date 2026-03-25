document.addEventListener('DOMContentLoaded', () => {
    // -------------------------------------------------------------
    // UI 要素の取得
    // -------------------------------------------------------------
    const inputPanel = document.getElementById('input-panel');
    const loadingPanel = document.getElementById('loading-panel');
    const resultPanel = document.getElementById('result-panel');
    
    // AsReader用の入力フィールドとフォーム
    const barcodeInput = document.getElementById('barcode-input');
    const scannerForm = document.getElementById('scanner-form');
    const scanAgainBtn = document.getElementById('scan-again-btn');

    // 検索結果表示用
    const elName = document.getElementById('res-name');
    const elGtin = document.getElementById('res-gtin');
    const elStock = document.getElementById('res-stock');
    const elShelf = document.getElementById('res-shelf');
    const elDelivery = document.getElementById('res-delivery');
    const elStatus = document.getElementById('res-status');
    const loadingCode = document.getElementById('loading-code-display');

    // 【重要】ここに現在のGASのURL (AKfycb...) を入れます
    const GAS_URL = "https://script.google.com/macros/s/AKfycbwDhj91LpWaF6OWhTmr6hbYLgScu0tlBcs2Y4nyXvg2WAwybHYGd5-V579tf0I5_H2dCQ/exec";

    // -------------------------------------------------------------
    // AsReader 連携ロジック (HIDキーボードエミュレーション)
    // -------------------------------------------------------------
    let scanTimeout = null;

    // 常にインプットフィールドにフォーカスを当てておく（トリガーを押すだけで入力されるようにする）
    function refocus() {
        if (barcodeInput) {
            if (!barcodeInput.value) {
                barcodeInput.value = '';
            }
            // iOS Safariでソフトウェアキーボードが不要に上がらないようにするための制御
            // （ただしAsReader接続中は通常ソフトウェアキーボードは非表示になります）
            barcodeInput.focus();
        }
    }

    // 画面ロード時に自動フォーカス
    setTimeout(refocus, 300);

    // iOSブラウザ向けに、画面のどこを触っても確実に入力枠にフォーカスを戻す
    document.addEventListener('click', (e) => {
        // 現在入力パネルが表示されている場合のみ
        if (inputPanel && !inputPanel.classList.contains('hidden')) {
            if (e.target !== barcodeInput) {
                refocus();
            }
        }
    });

    // 1. スキャナの入力が高速で行われることを利用し、Enterがなくても一定時間（0.5秒）入力が止まれば「スキャン完了」とみなす
    barcodeInput.addEventListener('input', (e) => {
        const val = barcodeInput.value.trim();
        if (!val) return;
        
        clearTimeout(scanTimeout);
        scanTimeout = setTimeout(() => {
            // スキャナの入力が0.5秒間止まったら自動送信 (短すぎるバーコードは無視するかチェック)
            if (barcodeInput.value.trim().length >= 6) {
                const finalCode = barcodeInput.value.trim();
                barcodeInput.value = ''; // 送信前にクリア
                processScannedCode(finalCode);
            }
        }, 500);
    });

    // 2. もしAsReaderが正しく「Enter（改行）」を入力した場合は即座に発動
    scannerForm.addEventListener('submit', (e) => {
        e.preventDefault(); // 画面リロードを防ぐ
        clearTimeout(scanTimeout); // タイマー読み取りをキャンセル
        const rawCode = barcodeInput.value.trim();
        if (rawCode) {
            barcodeInput.value = '';
            processScannedCode(rawCode);
        }
    });

    // -------------------------------------------------------------
    // GTIN抽出とGASへのデータ送信
    // -------------------------------------------------------------
    function processScannedCode(decodedText) {
        // [超強力なフィルター] GS1データから各種ノイズ（ ]C1 や ]d2、括弧など）を除去
        // AsReaderは高精度なのでシンボル識別子を先頭に出力する設定になっている場合があります
        let cleanText = decodedText.replace(/^\][A-Za-z]\d/, ''); 
        cleanText = cleanText.replace(/[\(\)]/g, '');

        let gtin = cleanText;

        // "01" に続く14桁の数字（PTPシートなどのGTIN）を抽出
        const gtinMatch = cleanText.match(/01(\d{14})/);
        if (gtinMatch) {
            gtin = gtinMatch[1];
        } else if (/^\d{13,14}$/.test(cleanText)) {
            // JANコード等の場合は先頭に0を追加して14桁化
            gtin = cleanText.length === 13 ? '0' + cleanText : cleanText;
        }

        // 入力パネルを隠してローディング画面を出す
        inputPanel.classList.add('hidden');
        loadingPanel.classList.remove('hidden');
        
        // デバッグ用に抽出データを画面に表示
        loadingCode.innerHTML = `判定GTIN: <b style="color:#fff;">${gtin}</b><br><span style="font-size:0.7rem;color:#94a3b8;word-break:break-all;">(AsReader生データ: ${decodedText})</span>`;

        // GASへ問い合わせ
        fetchDataFromGAS(gtin, cleanText);
    }

    async function fetchDataFromGAS(gtin, rawCode) {
        try {
            const payload = { action: 'search_gs1', gtin: gtin, rawCode: rawCode };

            const response = await fetch(GAS_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) { throw new Error(`HTTP error! status: ${response.status}`); }

            const data = await response.json();
            displayResults(data, gtin);

        } catch (error) {
            console.error("API Fetch Error:", error);
            // 本番環境でFetchが一時失敗した際に見た目が崩れないようモック表示
            setTimeout(() => displayMockData(gtin, rawCode), 800);
        }
    }

    // -------------------------------------------------------------
    // 結果表示ロジック
    // -------------------------------------------------------------
    function displayResults(data, gtin) {
        loadingPanel.classList.add('hidden');
        resultPanel.classList.remove('hidden');

        if (data.status === 'error') {
            elName.textContent = "エラー"; elGtin.textContent = gtin; elStock.textContent = "--";
            elShelf.textContent = "--"; elDelivery.textContent = data.message || "エラーが発生しました";
            elStatus.className = "status-badge error"; elStatus.textContent = "取得失敗";
            return;
        }

        elName.textContent = data.productName || "不明な医薬品";
        elGtin.textContent = gtin || data.gtin || "--";
        elStock.textContent = data.stock != null ? `${data.stock} 個` : "--";
        elShelf.textContent = data.shelf || "未設定";
        elDelivery.textContent = data.lastDeliveryDate || "--";

        if (data.stock > 0) { elStatus.className = "status-badge success"; elStatus.textContent = "在庫あり"; } 
        else if (data.stock === 0) { elStatus.className = "status-badge warning"; elStatus.textContent = "品切れ"; } 
        else { elStatus.className = "status-badge error"; elStatus.textContent = "登録なし"; }
    }

    // デバッグ用モック
    function displayMockData(gtin, rawCode) {
        const mock = { productName: "（通信エラー）", stock: "--", shelf: "--", lastDeliveryDate: "--", status: "error", message: "GASと通信できませんでした" };
        displayResults(mock, gtin);
    }

    // -------------------------------------------------------------
    // 「続けてスキャン」ボタン
    // -------------------------------------------------------------
    if (scanAgainBtn) {
        scanAgainBtn.addEventListener('click', () => {
            // 結果画面を隠して、入力画面に戻す
            resultPanel.classList.add('hidden');
            inputPanel.classList.remove('hidden');
            // 即座に次のバーコードを待機
            refocus();
        });
    }
});
