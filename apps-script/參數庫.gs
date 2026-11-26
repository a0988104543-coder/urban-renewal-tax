/**
 * 都更稅費試算工具｜雲端參數庫（獨立 Apps Script，不綁試算表）
 *
 * 用途：把稅率、CPI（稅務專用）等各案共用的參數存成 Drive 上的 params.json，
 *       稅費試算工具打開時讀取；在工具裡更新參數後寫回這裡。
 *
 * 讀取（GET）：不需金鑰，回傳 { ok, params }。參數不含個人資料。
 * 寫入（POST）：body 為 { action:'save', key, params }，key 必須等於指令碼屬性 WRITE_KEY。
 *               每次寫入前，舊版會另存一份 params_v<版本>.json 備份在同一資料夾。
 *
 * 指令碼屬性（專案設定 → 指令碼屬性，皆由 setup() 自動建立）：
 *   WRITE_KEY        寫入金鑰（工具的「寫入金鑰」填同一串）；忘記時執行 showKey() 查看
 *   PARAMS_FILE_ID   params.json 的檔案 ID
 *
 * 第一次使用：
 *   1. 在編輯器上方選 setup，按「執行」，依畫面授權（需要 Drive 權限）。
 *      會在「我的雲端硬碟」建立資料夾「都更稅費參數庫」與空的 params.json，
 *      並在執行記錄印出寫入金鑰。
 *   2. 部署作業 → 新增部署作業 → 網頁應用程式
 *      執行身分：我　／　誰可以存取：所有人
 *   3. 把網頁應用程式網址貼到工具 ⑤ 參數頁的「參數庫網址」，金鑰貼到「寫入金鑰」。
 *   4. 在工具 ⑤ 參數頁按「把目前參數寫入雲端」完成第一次寫入，之後都由工具寫回。
 * 之後更新程式：管理部署作業 → 編輯 → 建立新版本（不要新增部署作業，否則網址會變）
 */

var FOLDER_NAME = '都更稅費參數庫';
var SCHEMA = 'tax-params-1';

function setup() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('PARAMS_FILE_ID');
  if (id) { try { DriveApp.getFileById(id); Logger.log('已存在 params.json：' + id); return; } catch (e) {} }
  var it = DriveApp.getFoldersByName(FOLDER_NAME);
  var folder = it.hasNext() ? it.next() : DriveApp.createFolder(FOLDER_NAME);
  var file = folder.createFile('params.json', JSON.stringify({ schema: SCHEMA, version: -1, params: {} }), 'application/json');
  props.setProperty('PARAMS_FILE_ID', file.getId());
  Logger.log('已建立 params.json：' + file.getId());
  showKey();
}

/** 沒有 WRITE_KEY 時自動產生一組；把金鑰印在執行記錄，複製到工具的「寫入金鑰」。 */
function showKey() {
  var props = PropertiesService.getScriptProperties();
  var key = props.getProperty('WRITE_KEY');
  if (!key) { key = Utilities.getUuid().replace(/-/g, ''); props.setProperty('WRITE_KEY', key); }
  Logger.log('寫入金鑰（貼到工具 ⑤ 參數頁）：' + key);
}

function doGet() {
  try {
    var p = readParams_();
    if (!p || p.version < 0) return json_({ ok: false, error: '參數庫還是空的，請先從工具寫入一次' });
    return json_({ ok: true, params: p });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    var body = JSON.parse(e.postData.contents || '{}');
    if (body.action !== 'save') return json_({ ok: false, error: '未知的 action：' + body.action });
    var key = PropertiesService.getScriptProperties().getProperty('WRITE_KEY');
    if (!key || body.key !== key) return json_({ ok: false, error: '寫入金鑰不正確' });
    var np = body.params;
    var err = check_(np);
    if (err) return json_({ ok: false, error: err });
    var file = paramsFile_();
    var cur = JSON.parse(file.getBlob().getDataAsString('UTF-8') || '{}');
    if (cur && cur.version >= 0) {
      if (np.version <= cur.version) return json_({ ok: false, error: '版本號必須大於目前的 v' + cur.version + '（可能有人先更新過，請重新整理工具）' });
      var folder = file.getParents().hasNext() ? file.getParents().next() : DriveApp.getRootFolder();
      folder.createFile('params_v' + cur.version + '.json', JSON.stringify(cur), 'application/json');
    }
    file.setContent(JSON.stringify(np));
    return json_({ ok: true, version: np.version });
  } catch (err2) {
    return json_({ ok: false, error: String(err2 && err2.message || err2) });
  } finally {
    try { lock.releaseLock(); } catch (e3) {}
  }
}

function check_(p) {
  if (!p || p.schema !== SCHEMA) return '格式不是 ' + SCHEMA;
  if (typeof p.version !== 'number') return '缺少版本號';
  if (!p.params || typeof p.params !== 'object') return '缺少 params';
  if (!p.cpi || !p.cpi.table || !p.cpi.base) return '缺少 CPI 表';
  var s = JSON.stringify(p);
  if (s.length > 200000) return '檔案過大';
  return '';
}

function paramsFile_() {
  var id = PropertiesService.getScriptProperties().getProperty('PARAMS_FILE_ID');
  if (!id) throw new Error('尚未執行 setup()');
  return DriveApp.getFileById(id);
}

function readParams_() {
  return JSON.parse(paramsFile_().getBlob().getDataAsString('UTF-8') || 'null');
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
