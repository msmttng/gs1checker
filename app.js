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

    let html5QrcodeScanner;
    
    // 【重要】ここに現在のGASのURL (AKfycb...) を入れます
    const GAS_URL = "https://script.google.com/macros/s/AKfycbwDhj91LpWaF6OWhTmr6hbYLgScu0tlBcs2Y4nyXvg2WAwybHYGd5-V579tf0I5_H2dCQ/exec";

    // Initialize scanner
    function startScanner() {
        scannerPanel.classList.remove('hidden');
        resultPanel.classList.add('hidden');
        loadingPanel.classList.add('hidden');

        html5QrcodeScanner = new Html5QrcodeScanner(
            "reader", 
            { 
                fps: 10, 
                qrbox: { width: 280, height: 100 },
                aspectRatio: 1.0,
                formatsToSupport: [
                    Html5QrcodeSupportedFormats.DATA_MATRIX,
                    Html5QrcodeSupportedFormats.GS1_128,
                    Html5QrcodeSupportedFormats.CODE_128,
                    Html5QrcodeSupportedFormats.QR_CODE,
                    Html5QrcodeSupportedFormats.EAN_13
                ]
            }, 
            false
        );
        html5QrcodeScanner.render(onScanSuccess, onScanFailure);
    }

    function onScanSuccess(decodedText, decodedResult) {
        if (html5QrcodeScanner) {
            html5QrcodeScanner.clear();
        }

        let gtin = decodedText;
        const gtinMatch = decodedText.replace(/[\(\)]/g, '').match(/^01(\d{14})/);
        if (gtinMatch) {
            gtin = gtinMatch[1];
        }

        scannerPanel.classList.add('hidden');
        loadingPanel.classList.remove('hidden');
        loadingCode.textContent = `GS1: ${gtin}`;

        fetchDataFromGAS(gtin, decodedText);
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

    startScanner();
});
