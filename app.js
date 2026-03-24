document.addEventListener('DOMContentLoaded', async () => {
    // -------------------------------------------------------------
    // UI 要素の取得
    // -------------------------------------------------------------
    const scannerPanel = document.getElementById('scanner-panel');
    const loadingPanel = document.getElementById('loading-panel');
    const resultPanel = document.getElementById('result-panel');
    const scanAgainBtn = document.getElementById('scan-again-btn');
    const startPanel = document.getElementById('start-panel');
    const startCameraBtn = document.getElementById('start-camera-btn');
    const videoElement = document.getElementById('video-stream');

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
    // 最新鋭システム「ZBar WASM (Polyfill)」の初期化
    // -------------------------------------------------------------
    let isScanning = false;
    let cameraStream = null;
    let barcodeDetector = null;

    try {
        // undecafの極秘ポリフィル機能を使って、iPhoneにバーコード探知APIをインストール
        window.BarcodeDetector = barcodeDetectorPolyfill.install();
        
        // DataBar（GS1 DataBar Limited等）および DataBarExpanded を最優先で読み取るように設定
        barcodeDetector = new window.BarcodeDetector({ 
            formats: ['databar', 'databar_exp', 'code_128', 'data_matrix', 'ean_13', 'qr_code'] 
        });
        console.log("ZBar DataBar Engine Initialized!");
    } catch (e) {
        alert("ZBarエンジン初期化エラー: 画面を再読み込みしてください。");
        console.error(e);
    }

    // -------------------------------------------------------------
    // カメラとスキャナーの起動
    // -------------------------------------------------------------
    if (startCameraBtn) {
        startCameraBtn.addEventListener('click', async () => {
            startPanel.classList.add('hidden');
            await startScanner();
        });
    }

    async function startScanner() {
        scannerPanel.classList.remove('hidden');
        resultPanel.classList.add('hidden');
        loadingPanel.classList.add('hidden');

        try {
            // [要警戒] 画質などを指定すると古いiOSですぐエラーになるため、
            // 完全に何も指定せず「裏のカメラ」という一番シンプルな要求だけを送る
            cameraStream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: "environment" },
                audio: false
            });

            videoElement.srcObject = cameraStream;
            videoElement.setAttribute("playsinline", true); // iOSで全画面化するのを防ぐ
            videoElement.play();

            isScanning = true;
            processFrame(); // バーコード探索ループ起動

        } catch (err) {
            alert("カメラの起動に失敗しました: " + err.message);
            // 失敗時はスタート画面に戻す
            startPanel.classList.remove('hidden');
            scannerPanel.classList.add('hidden');
        }
    }

    // -------------------------------------------------------------
    // ZBarによる映像解析ループ
    // -------------------------------------------------------------
    async function processFrame() {
        if (!isScanning) return;

        // 映像の準備ができているか確認
        if (videoElement.readyState === videoElement.HAVE_ENOUGH_DATA && barcodeDetector) {
            try {
                // ここが心臓部：最強のZBarエンジンで映像解析
                const barcodes = await barcodeDetector.detect(videoElement);

                if (barcodes.length > 0) {
                    const decodedText = barcodes[0].rawValue;
                    onScanSuccess(decodedText);
                    return; // 成功した場合は次のループを終了
                }
            } catch (e) {
                // 映像が瞬間的に乱れるなどした通常エラーは無視して進める
            }
        }
        
        // 読めなかった場合は少し休んでから次を探索 (スマホの熱暴走を防ぐため150ms待機)
        setTimeout(() => {
            if (isScanning) {
                requestAnimationFrame(processFrame);
            }
        }, 150);
    }

    // -------------------------------------------------------------
    // 読み取り成功時の処理とGAS通信
    // -------------------------------------------------------------
    function onScanSuccess(decodedText) {
        isScanning = false; // ループを止める

        // [非常に重要] GS1データから各種ノイズ（ ]C1 や 括弧など）を除去
        let cleanText = decodedText.replace(/^\][A-Za-z]\d/, ''); 
        cleanText = cleanText.replace(/[\(\)]/g, '');

        let gtin = cleanText;

        // "01" に続く14桁の数字（GTIN）を抽出
        const gtinMatch = cleanText.match(/01(\d{14})/);
        if (gtinMatch) {
            gtin = gtinMatch[1];
        } else if (/^\d{13,14}$/.test(cleanText)) {
            // 13桁のJAN等の場合は先頭に0を追加して14桁化
            gtin = cleanText.length === 13 ? '0' + cleanText : cleanText;
        }

        scannerPanel.classList.add('hidden');
        loadingPanel.classList.remove('hidden');
        
        // デバッグ用に生データを画面に表示
        loadingCode.innerHTML = `判定GTIN: <b style="color:#fff;">${gtin}</b><br><span style="font-size:0.7rem;color:#94a3b8;word-break:break-all;">(生データ: ${decodedText})</span>`;

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
        scanAgainBtn.addEventListener('click', async () => {
            await startScanner();
        });
    }
});
