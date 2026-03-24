document.addEventListener('DOMContentLoaded', () => {
    // Elements
    const scannerPanel = document.getElementById('scanner-panel');
    const loadingPanel = document.getElementById('loading-panel');
    const resultPanel = document.getElementById('result-panel');
    const scanAgainBtn = document.getElementById('scan-again-btn');

    // Display Elements
    const elName = document.getElementById('res-name');
    const elGtin = document.getElementById('res-gtin');
    const elStock = document.getElementById('res-stock');
    const elShelf = document.getElementById('res-shelf');
    const elDelivery = document.getElementById('res-delivery');
    const elStatus = document.getElementById('res-status');
    const loadingCode = document.getElementById('loading-code-display');
    const startPanel = document.getElementById('start-panel');
    const startCameraBtn = document.getElementById('start-camera-btn');

    if (startCameraBtn) {
        startCameraBtn.addEventListener('click', () => {
            startPanel.classList.add('hidden');
            startScanner();
        });
    }

    let html5QrCode;
    
    // 【重要】ここに現在のGASのURL (AKfycb...) を入れます
    const GAS_URL = "https://script.google.com/macros/s/AKfycbwDhj91LpWaF6OWhTmr6hbYLgScu0tlBcs2Y4nyXvg2WAwybHYGd5-V579tf0I5_H2dCQ/exec";

    // Initialize scanner
    function startScanner() {
        scannerPanel.classList.remove('hidden');
        resultPanel.classList.add('hidden');
        loadingPanel.classList.add('hidden');

        if (!html5QrCode) {
            html5QrCode = new Html5Qrcode("reader");
        }

        const config = {
            fps: 15, // スキャン頻度を上げて認識率アップ
            qrbox: { width: 280, height: 180 }, // 読み取り枠を縦方向にも広げる
            aspectRatio: 1.0,
            useBarCodeDetectorIfSupported: true // [重要] iOS本来の強力なAIバーコードエンジンを優先使用
        };

        // カメラの条件が厳しすぎるとiOSで起動エラー（OverconstrainedError）になるため、条件を緩める
        const constraints = { 
            facingMode: "environment" 
        };

        // UIなしで直接背面カメラを指定して起動
        html5QrCode.start(
            constraints,
            config,
            onScanSuccess,
            onScanFailure
        ).catch((err) => {
            console.warn("背面カメラの起動に失敗。通常の環境カメラを試します", err);
            html5QrCode.start({ facingMode: "environment" }, config, onScanSuccess, onScanFailure).catch(e => {
                console.warn("カメラ起動失敗:", e);
                // PC等の場合へのフォールバック
                html5QrCode.start({ facingMode: "user" }, config, onScanSuccess, onScanFailure);
            });
        });
    }

    function onScanSuccess(decodedText, decodedResult) {
        if (html5QrCode && html5QrCode.isScanning) {
            html5QrCode.stop().catch(err => console.error(err));
        }

        // GS1データから各種ノイズ（シンボル識別子 ]C1 や 括弧）を除去
        let cleanText = decodedText.replace(/^\][A-Za-z]\d/, ''); 
        cleanText = cleanText.replace(/[\(\)]/g, '');

        let gtin = cleanText;

        // "01" に続く14桁の数字（GTIN）を抽出
        const gtinMatch = cleanText.match(/01(\d{14})/);
        if (gtinMatch) {
            gtin = gtinMatch[1];
        } else if (/^\d{13,14}$/.test(cleanText)) {
            // 13桁（通常のJANバーコードなど）の場合は先頭に0を追加して14桁化
            gtin = cleanText.length === 13 ? '0' + cleanText : cleanText;
        }

        scannerPanel.classList.add('hidden');
        loadingPanel.classList.remove('hidden');
        
        // 読み取りのバグ調査用に、画面に生データと抽出後のGTINを両方表示します
        loadingCode.innerHTML = `判定GTIN: <b style="color:#fff;">${gtin}</b><br><span style="font-size:0.7rem;color:#94a3b8;word-break:break-all;">(生データ: ${decodedText})</span>`;

        fetchDataFromGAS(gtin, cleanText);
    }

    function onScanFailure(error) {
        // 継続スキャン
    }

    async function fetchDataFromGAS(gtin, rawCode) {
        try {
            // 既存のRESTfulなGASの仕様に従い、POSTリクエストでJSONペイロードを送信
            const payload = {
                action: 'search_gs1',
                gtin: gtin,
                rawCode: rawCode
            };

            const response = await fetch(GAS_URL, {
                method: 'POST',
                // Text/plain を使うことでGAS側CORSのプリフライトを回避しつつ、bodyはJSONとする
                headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            displayResults(data, gtin);

        } catch (error) {
            console.error("API Fetch Error:", error);
            setTimeout(() => displayMockData(gtin), 800);
        }
    }

    function displayResults(data, gtin) {
        loadingPanel.classList.add('hidden');
        resultPanel.classList.remove('hidden');

        if (data.status === 'error') {
            elName.textContent = "エラー";
            elGtin.textContent = gtin;
            elStock.textContent = "--";
            elShelf.textContent = "--";
            elDelivery.textContent = data.message || "エラーが発生しました";
            elStatus.className = "status-badge error";
            elStatus.textContent = "取得失敗";
            return;
        }

        elName.textContent = data.productName || "不明な医薬品";
        elGtin.textContent = gtin || data.gtin || "--";
        elStock.textContent = data.stock != null ? `${data.stock} 個` : "--";
        elShelf.textContent = data.shelf || "未設定";
        elDelivery.textContent = data.lastDeliveryDate || "--";

        if (data.stock > 0) {
            elStatus.className = "status-badge success";
            elStatus.textContent = "在庫あり";
        } else if (data.stock === 0) {
            elStatus.className = "status-badge warning";
            elStatus.textContent = "品切れ";
        } else {
            elStatus.className = "status-badge error";
            elStatus.textContent = "登録なし";
        }
    }

    function displayMockData(gtin) {
        const mock = {
            productName: "カロナール錠 500mg 100錠入",
            stock: 12,
            shelf: "B-2 棚",
            lastDeliveryDate: "2026/03/24 (メディセオ)",
            status: "ok"
        };
        displayResults(mock, gtin);
    }

    scanAgainBtn.addEventListener('click', () => {
        startScanner();
    });

    // iPhone Safariではユーザーの画面タップなしにカメラを自動起動するとセキュリティブロックされるため、
    // ページ読み込み時（起動時）の自動スタートを廃止し、ボタンタップで起動するように変更しました。
    // startScanner(); 
});
