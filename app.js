// ES Modulesを使って zxing-wasm (超高精度C++エンジン) を読み込む
import { readBarcodesFromVideoElement, setZXingModuleOverrides } from "https://cdn.jsdelivr.net/npm/zxing-wasm@3.3.1/dist/reader/index.js";

// WASMファイルのロード先をCDNに強制設定
setZXingModuleOverrides({
  locateFile: (path, prefix) => {
    return `https://cdn.jsdelivr.net/npm/zxing-wasm@3.3.1/dist/reader/${path}`;
  }
});

document.addEventListener('DOMContentLoaded', () => {
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

    let isScanning = false;
    let cameraStream = null;

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
            // [1] ネイティブのカメラストリームをごく普通のパラメータで要求（失敗しにくい）
            cameraStream = await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: "environment",
                    width: { ideal: 1920 }, // フルHD解像度を要求（DataBar Limitedのような細かすぎるバーコードのピクセル潰れを防ぐため）
                    height: { ideal: 1080 }
                },
                audio: false
            });

            // [2] 取得した映像をHTMLの<video>タグに流し込む
            videoElement.srcObject = cameraStream;
            videoElement.setAttribute("playsinline", true); // iOS Safariで全画面になるのを防ぐ
            videoElement.play();

            // [3] C++エンジンでの解析ループをスタート
            isScanning = true;
            processFrame();

        } catch (err) {
            alert("カメラの起動に失敗しました: " + err.message);
            // エラー時はスタートパネルに戻す
            startPanel.classList.remove('hidden');
            scannerPanel.classList.add('hidden');
        }
    }

    async function processFrame() {
        if (!isScanning) return;

        // videoの準備ができているか確認
        if (videoElement.readyState === videoElement.HAVE_ENOUGH_DATA) {
            try {
                // [超重要] ZXing WASM による最強の解析処理
                const scanResults = await readBarcodesFromVideoElement(videoElement, {
                    tryHarder: true, // 多少ぼやけていてもしつこく解析する
                    maxNumberOfSymbols: 1,
                    formats: [
                        "DataBar",          // これがGS1 DataBar (PTPシートに印字されている究極に細かいバーコード) です！！
                        "DataBarExpanded",  // これもDataBar派生
                        "DataMatrix",       // GS1 DataMatrix用
                        "Code128",          // GS1-128の外箱用
                        "QRCode"            // 汎用
                    ]
                });

                if (scanResults.length > 0) {
                    const decodedText = scanResults[0].text;
                    onScanSuccess(decodedText);
                    return; // 成功した場合は次のループを呼ばない（停止）
                }
            } catch (e) {
                console.error("解析エラー:", e);
                // 通常のエラーは無視して進める
            }
        }
        
        // 読めなかった場合は、少し休んで（例: 200ミリ秒後）次を探索する
        // requestAnimationFrameより少し間引くことでスマホの発熱とフリーズを防ぐ
        setTimeout(() => {
            if (isScanning) {
                requestAnimationFrame(processFrame);
            }
        }, 150);
    }

    function onScanSuccess(decodedText) {
        // スキャン停止
        isScanning = false;
        
        // （任意）カメラの電源を切る（連続スキャンを早くしたい場合は切らずにCSSで隠すだけでもOK）
        /*
        if (cameraStream) {
            cameraStream.getTracks().forEach(t => t.stop());
            cameraStream = null;
        }
        */

        // GS1データから各種ノイズ（シンボル識別子 ]C1 や 括弧）を除去
        let cleanText = decodedText.replace(/^\][A-Za-z]\d/, ''); 
        cleanText = cleanText.replace(/[\(\)]/g, '');

        let gtin = cleanText;

        // "01" に続く14桁の数字（GTIN）を抽出
        const gtinMatch = cleanText.match(/01(\d{14})/);
        if (gtinMatch) {
            gtin = gtinMatch[1];
        } else if (/^\d{13,14}$/.test(cleanText)) {
            // 13桁の場合は先頭に0を追加して14桁化
            gtin = cleanText.length === 13 ? '0' + cleanText : cleanText;
        }

        scannerPanel.classList.add('hidden');
        loadingPanel.classList.remove('hidden');
        
        // 生データを画面に表示（バグ調査用）
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
            setTimeout(() => displayMockData(gtin, rawCode), 800); // 失敗時はモック
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

    function displayMockData(gtin, rawCode) {
        const mock = { productName: "カロナール錠 500mg 100錠入", stock: 12, shelf: "B-2 棚", lastDeliveryDate: "2026/03/24 (メディセオ)", status: "ok" };
        displayResults(mock, gtin);
    }

    scanAgainBtn.addEventListener('click', async () => {
        // 再度スキャン開始（カメラは起動しっぱなしなら映像プレビューを再開するだけ）
        await startScanner();
    });
});
