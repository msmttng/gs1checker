// Code.gs

function doGet(e) {
  const action = e.parameter.action;
  const gtin = e.parameter.gtin;
  const rawCode = e.parameter.raw;

  let result = {
    status: 'error',
    message: 'Unknown action or missing parameters'
  };

  try {
    if (action === 'search' && gtin) {
      result = searchDatabaseWithYJ(gtin, rawCode);
    }
  } catch (error) {
    result = {
      status: 'error',
      message: error.toString()
    };
  }

  // フロントエンドへ JSON形式で返却
  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  return doGet(e);
}

// 2段階検索（GTIN → YJコード → 在庫データ）を行うメイン関数
function searchDatabaseWithYJ(gtin, rawCode) {
  let ss;
  try {
    ss = SpreadsheetApp.getActiveSpreadsheet();
  } catch(e) {
    return getMockData(gtin);
  }
  
  const gtinString = String(gtin).trim();
  
  // =========================================
  // 【ステップ1】変換マスターでGTINからYJコードを探す
  // =========================================
  const masterSheetName = '変換マスター'; // ★マスターデータのシート名
  const masterSheet = ss.getSheetByName(masterSheetName);
  
  if (!masterSheet) {
    // マスターがなければ一旦エラー（またはテストデータ）を返す
    return { status: 'error', message: '「変換マスター」シートが見つかりません' };
  }

  const masterData = masterSheet.getDataRange().getDisplayValues();
  let targetYjCode = null;
  let targetProductName = "名称未登録";

  // 【仮定】マスターシートのA列が「GS1(GTIN)」、B列が「YJコード」、C列が「商品名」とする
  for (let i = 1; i < masterData.length; i++) { // 2行目から検索
    const row = masterData[i];
    const rowGtin = String(row[0]).trim(); // A列: GTIN
    
    if (rowGtin === gtinString || rowGtin.includes(gtinString)) {
      targetYjCode = String(row[1]).trim();     // B列: YJコード
      targetProductName = String(row[2]).trim(); // C列: 商品名
      break;
    }
  }

  if (!targetYjCode) {
    return {
      status: 'not_found',
      gtin: gtinString,
      message: 'マスターデータに該当のGS1コードが登録されていません'
    };
  }

  // =========================================
  // 【ステップ2】見つけたYJコードを使って在庫を探す
  // =========================================
  const inventorySheetName = '在庫データ'; // ★在庫データのシート名
  const inventorySheet = ss.getSheetByName(inventorySheetName);
  
  if (!inventorySheet) return { status: 'error', message: '「在庫データ」シートが見つかりません' };
  
  const invData = inventorySheet.getDataRange().getDisplayValues();
  
  // 【仮定】在庫シートのA列が「YJコード」、B列が「在庫数」、C列が「棚番」、D列が「最終納品日」とする
  for (let i = 1; i < invData.length; i++) {
    const row = invData[i];
    const rowYj = String(row[0]).trim(); // A列: YJコード
    
    if (rowYj === targetYjCode || rowYj.includes(targetYjCode)) {
      return {
        status: 'ok',
        gtin: gtinString,
        yjCode: targetYjCode,
        productName: targetProductName,       // マスターから取得した名前
        stock: row[1] || 0,                 // B列: 現在庫
        shelf: row[2] || "未設定",             // C列: 棚番
        lastDeliveryDate: row[3] || "",     // D列: 最終納品日
        rawCode: rawCode
      };
    }
  }

  // 在庫データには存在しなかった場合（＝在庫なし、未納品など）
  return {
    status: 'ok',
    gtin: gtinString,
    yjCode: targetYjCode,
    productName: targetProductName,
    stock: 0,
    shelf: "登録なし",
    lastDeliveryDate: "--",
    message: "在庫データには登録がありませんでした"
  };
}

// テスト用モックデータ
function getMockData(gtin) {
  return {}; // 簡略化
}
