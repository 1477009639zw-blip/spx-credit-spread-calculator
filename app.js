(function () {
  "use strict";

  var core = window.SPXStrategyCalculatorCore;
  if (!core) {
    throw new Error("SPXStrategyCalculatorCore 未加载。");
  }

  var form = document.getElementById("calculator-form");
  var errorBanner = document.getElementById("error-banner");
  var spxPrevCloseInput = document.getElementById("spx-prev-close");
  var vixPrevCloseInput = document.getElementById("vix-prev-close");
  var spxOpenInput = document.getElementById("spx-open");
  var recordDateInput = document.getElementById("record-date");
  var recordNoteInput = document.getElementById("record-note");
  var saveRecordButton = document.getElementById("save-record");
  var exportCsvButton = document.getElementById("export-csv");
  var exportExcelButton = document.getElementById("export-excel");
  var localChooseFolderButton = document.getElementById("local-choose-folder");
  var localLoadButton = document.getElementById("local-load");
  var localStatusBadge = document.getElementById("local-status-badge");
  var localFolderLabel = document.getElementById("local-folder-label");
  var cloudEmailInput = document.getElementById("cloud-email");
  var cloudLoginButton = document.getElementById("cloud-login");
  var cloudLoadButton = document.getElementById("cloud-load");
  var cloudUploadButton = document.getElementById("cloud-upload");
  var cloudLogoutButton = document.getElementById("cloud-logout");
  var cloudStatusBadge = document.getElementById("cloud-status-badge");
  var cloudUser = document.getElementById("cloud-user");
  var saveFeedback = document.getElementById("save-feedback");
  var savedRecordsList = document.getElementById("saved-records-list");
  var savedRecordsEmpty = document.getElementById("saved-records-empty");
  var LOCAL_RECORDS_FILENAME = "spx_credit_spread_records.json";
  var LEGACY_STORAGE_KEY = "spx-credit-spread-calculator-records-v1";
  var LOCAL_DB_NAME = "spx-credit-spread-calculator-local-store-v1";
  var LOCAL_DB_STORE = "metadata";
  var LOCAL_FOLDER_HANDLE_KEY = "records-folder-handle";
  var SUPABASE_URL = "https://frnrhycstwiezcifktnh.supabase.co";
  var SUPABASE_PUBLISHABLE_KEY = "sb_publishable_-xXAZ7HC7MSNZcYSRap5mw_hIR_N4fN";
  var PUBLIC_APP_URL = "https://1477009639zw-blip.github.io/spx-credit-spread-calculator/";
  var CLOUD_TABLE = "spx_credit_spread_records";
  var savedRecordsCache = [];
  var localFolderHandle = null;
  var cloudClient = null;
  var cloudSession = null;
  var lastCalculatedResult = null;

  var fields = {
    tradeSideBadge: document.getElementById("trade-side-badge"),
    directionSourceBadge: document.getElementById("direction-source-badge"),
    exactTarget: document.getElementById("exact-target"),
    finalOtm: document.getElementById("final-otm"),
    expectMoveLow: document.getElementById("expect-move-low"),
    expectMoveHigh: document.getElementById("expect-move-high"),
    overrideBanner: document.getElementById("override-banner"),
    exactPointCard: document.getElementById("exact-point-card"),
    outerStrikeCard: document.getElementById("outer-strike-card"),
    innerStrikeCard: document.getElementById("inner-strike-card"),
    narrativeCard: document.getElementById("narrative-card"),
    gapPct: document.getElementById("gap-pct"),
    gapBucket: document.getElementById("gap-bucket"),
    baseExpectedMove: document.getElementById("base-expected-move"),
    afterKMove: document.getElementById("after-k-move"),
    aMultiplier: document.getElementById("a-multiplier"),
    aDescription: document.getElementById("a-description"),
    rawOtm: document.getElementById("raw-otm"),
    otmFloor: document.getElementById("otm-floor"),
    floorReason: document.getElementById("floor-reason"),
    down1_5Level: document.getElementById("down-1_5-level"),
    up1_5Level: document.getElementById("up-1_5-level"),
    down2_0Level: document.getElementById("down-2_0-level"),
    up2_0Level: document.getElementById("up-2_0-level"),
    down2_5Level: document.getElementById("down-2_5-level"),
    up2_5Level: document.getElementById("up-2_5-level"),
    down3_0Level: document.getElementById("down-3_0-level"),
    up3_0Level: document.getElementById("up-3_0-level")
  };

  var referenceFieldMap = {
    0.015: ["down1_5Level", "up1_5Level"],
    0.02: ["down2_0Level", "up2_0Level"],
    0.025: ["down2_5Level", "up2_5Level"],
    0.03: ["down3_0Level", "up3_0Level"]
  };

  function todayString() {
    var now = new Date();
    var month = String(now.getMonth() + 1).padStart(2, "0");
    var day = String(now.getDate()).padStart(2, "0");
    return now.getFullYear() + "-" + month + "-" + day;
  }

  function loadSavedRecords() {
    return savedRecordsCache.map(function (record) {
      return normalizeRecord(record);
    });
  }

  function loadLegacyBrowserRecords() {
    try {
      var raw = window.localStorage.getItem(LEGACY_STORAGE_KEY);
      if (!raw) return [];
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed)
        ? parsed.map(function (record) {
            return normalizeRecord(record);
          })
        : [];
    } catch (error) {
      return [];
    }
  }

  function clearLegacyBrowserRecords() {
    try {
      window.localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch (error) {
      return false;
    }
    return true;
  }

  function persistSavedRecords(records) {
    var nextRecords = Array.isArray(records)
      ? records.map(function (record) {
          return normalizeRecord(record);
        })
      : [];

    if (!localFolderHandle) {
      savedRecordsCache = nextRecords;
      return Promise.resolve(false);
    }

    return writeLocalRecordsFile(nextRecords).then(function () {
      savedRecordsCache = nextRecords;
      return true;
    });
  }

  function openLocalMetaDb() {
    if (!window.indexedDB) {
      return Promise.resolve(null);
    }

    return new Promise(function (resolve, reject) {
      var request = window.indexedDB.open(LOCAL_DB_NAME, 1);

      request.onupgradeneeded = function (event) {
        event.target.result.createObjectStore(LOCAL_DB_STORE);
      };

      request.onsuccess = function () {
        resolve(request.result);
      };

      request.onerror = function () {
        reject(request.error || new Error("无法打开本地存储数据库。"));
      };
    });
  }

  async function readLocalMetaValue(key) {
    var db = await openLocalMetaDb();
    if (!db) return null;

    return new Promise(function (resolve, reject) {
      var tx = db.transaction(LOCAL_DB_STORE, "readonly");
      var store = tx.objectStore(LOCAL_DB_STORE);
      var request = store.get(key);

      request.onsuccess = function () {
        resolve(request.result || null);
      };

      request.onerror = function () {
        reject(request.error || new Error("读取本地文件夹记录失败。"));
      };
    }).finally(function () {
      db.close();
    });
  }

  async function writeLocalMetaValue(key, value) {
    var db = await openLocalMetaDb();
    if (!db) return false;

    return new Promise(function (resolve, reject) {
      var tx = db.transaction(LOCAL_DB_STORE, "readwrite");
      var store = tx.objectStore(LOCAL_DB_STORE);
      store.put(value, key);
      tx.oncomplete = function () {
        resolve(true);
      };
      tx.onerror = function () {
        reject(tx.error || new Error("保存本地文件夹记录失败。"));
      };
    }).finally(function () {
      db.close();
    });
  }

  async function removeLocalMetaValue(key) {
    var db = await openLocalMetaDb();
    if (!db) return false;

    return new Promise(function (resolve, reject) {
      var tx = db.transaction(LOCAL_DB_STORE, "readwrite");
      var store = tx.objectStore(LOCAL_DB_STORE);
      store.delete(key);
      tx.oncomplete = function () {
        resolve(true);
      };
      tx.onerror = function () {
        reject(tx.error || new Error("清除本地文件夹记录失败。"));
      };
    }).finally(function () {
      db.close();
    });
  }

  function hideSaveFeedback() {
    saveFeedback.textContent = "";
    saveFeedback.classList.add("hidden");
  }

  function showSaveFeedback(message) {
    saveFeedback.textContent = message;
    saveFeedback.classList.remove("hidden");
  }

  function setLocalUiBusy(isBusy) {
    [localChooseFolderButton, localLoadButton, saveRecordButton].forEach(function (button) {
      button.disabled = isBusy;
    });
  }

  function setLocalStatus(message, isConnected) {
    localStatusBadge.textContent = message;
    localStatusBadge.className = "local-status-badge" + (isConnected ? " connected" : "");
  }

  function updateLocalUi() {
    if (localFolderHandle) {
      setLocalStatus("已连接本地文件夹", true);
      localFolderLabel.textContent = "记录文件：" + LOCAL_RECORDS_FILENAME + (localFolderHandle.name ? " | 文件夹：" + localFolderHandle.name : "");
      localLoadButton.disabled = false;
      saveRecordButton.disabled = false;
      return;
    }

    setLocalStatus("未选择文件夹", false);
    localFolderLabel.textContent = "请选择一个电脑文件夹，记录会写入其中的 JSON 文件。";
    localLoadButton.disabled = true;
    saveRecordButton.disabled = true;
  }

  async function verifyLocalFolderPermission(handle) {
    if (!handle) return false;

    var options = { mode: "readwrite" };
    if (typeof handle.queryPermission === "function" && (await handle.queryPermission(options)) === "granted") {
      return true;
    }

    if (typeof handle.requestPermission === "function" && (await handle.requestPermission(options)) === "granted") {
      return true;
    }

    return false;
  }

  async function loadLocalRecordsFile() {
    if (!localFolderHandle) return [];

    var fileHandle = await localFolderHandle.getFileHandle(LOCAL_RECORDS_FILENAME, { create: true });
    var file = await fileHandle.getFile();
    var text = await file.text();
    if (!text.trim()) return [];

    var parsed = JSON.parse(text);
    return Array.isArray(parsed)
      ? parsed.map(function (record) {
          return normalizeRecord(record);
        })
      : [];
  }

  async function writeLocalRecordsFile(records) {
    if (!localFolderHandle) {
      return false;
    }

    var allowed = await verifyLocalFolderPermission(localFolderHandle);
    if (!allowed) {
      throw new Error("没有写入本地文件夹的权限，请重新选择文件夹。");
    }

    var fileHandle = await localFolderHandle.getFileHandle(LOCAL_RECORDS_FILENAME, { create: true });
    var writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(records, null, 2));
    await writable.close();
    return true;
  }

  async function restoreLocalFolderHandle() {
    try {
      var handle = await readLocalMetaValue(LOCAL_FOLDER_HANDLE_KEY);
      if (!handle) {
        updateLocalUi();
        return false;
      }

      if (!(await verifyLocalFolderPermission(handle))) {
        await removeLocalMetaValue(LOCAL_FOLDER_HANDLE_KEY);
        updateLocalUi();
        return false;
      }

      localFolderHandle = handle;
      savedRecordsCache = await loadLocalRecordsFile();
      await migrateLegacyRecordsToLocalFile();
      renderSavedRecords();
      updateLocalUi();
      return true;
    } catch (error) {
      localFolderHandle = null;
      updateLocalUi();
      showError("恢复本地文件夹失败：" + error.message);
      return false;
    }
  }

  async function chooseLocalFolder() {
    if (!window.showDirectoryPicker) {
      showError("当前浏览器不支持本地文件夹直写，请使用 Chrome 或 Edge。");
      return;
    }

    clearError();
    setLocalUiBusy(true);
    try {
      var handle = await window.showDirectoryPicker({ mode: "readwrite" });
      if (!(await verifyLocalFolderPermission(handle))) {
        throw new Error("文件夹权限未授予。");
      }

      localFolderHandle = handle;
      await writeLocalMetaValue(LOCAL_FOLDER_HANDLE_KEY, handle);
      savedRecordsCache = await loadLocalRecordsFile();
      await migrateLegacyRecordsToLocalFile();
      renderSavedRecords();
      updateLocalUi();
      showSaveFeedback("已连接到本地文件夹 " + (handle.name || "未命名文件夹") + "。");
    } catch (error) {
      if (error && error.name !== "AbortError") {
        showError("选择本地文件夹失败：" + error.message);
      }
    } finally {
      setLocalUiBusy(false);
      updateLocalUi();
    }
  }

  async function reloadLocalRecordsFromFolder() {
    if (!localFolderHandle) {
      showError("请先选择本地文件夹。");
      return;
    }

    clearError();
    setLocalUiBusy(true);
    try {
      savedRecordsCache = await loadLocalRecordsFile();
      renderSavedRecords();
      showSaveFeedback("已从本地文件夹载入 " + savedRecordsCache.length + " 条记录。");
    } catch (error) {
      showError("读取本地文件失败：" + error.message);
    } finally {
      setLocalUiBusy(false);
      updateLocalUi();
    }
  }

  async function migrateLegacyRecordsToLocalFile() {
    var legacyRecords = loadLegacyBrowserRecords();
    if (!legacyRecords.length || !localFolderHandle) {
      return false;
    }

    var currentFileRecords = await loadLocalRecordsFile();
    var merged = mergeRecords(currentFileRecords, legacyRecords);
    await writeLocalRecordsFile(merged);
    savedRecordsCache = merged;
    clearLegacyBrowserRecords();
    renderSavedRecords();
    showSaveFeedback("已将浏览器旧记录迁移到本地文件。");
    return true;
  }

  function setCloudBusy(isBusy) {
    [cloudLoginButton, cloudLoadButton, cloudUploadButton, cloudLogoutButton].forEach(function (button) {
      button.disabled = isBusy;
    });
  }

  function setCloudStatus(message, isConnected) {
    cloudStatusBadge.textContent = message;
    cloudStatusBadge.className = "cloud-status-badge" + (isConnected ? " connected" : "");
  }

  function updateCloudUi() {
    if (!cloudClient) {
      setCloudStatus("未连接", false);
      cloudUser.textContent = "Supabase SDK 未加载，云端同步暂不可用。";
      cloudLoadButton.disabled = true;
      cloudUploadButton.disabled = true;
      cloudLogoutButton.disabled = true;
      return;
    }

    if (cloudSession && cloudSession.user) {
      setCloudStatus("已登录", true);
      cloudUser.textContent = "当前云端账号：" + (cloudSession.user.email || cloudSession.user.id);
      cloudLoadButton.disabled = false;
      cloudUploadButton.disabled = false;
      cloudLogoutButton.disabled = false;
      return;
    }

    setCloudStatus("待登录", false);
    cloudUser.textContent = "Supabase 项目已配置，请输入邮箱并发送登录链接。";
    cloudLoadButton.disabled = true;
    cloudUploadButton.disabled = true;
    cloudLogoutButton.disabled = true;
  }

  function initCloudClient() {
    if (!window.supabase || !SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
      updateCloudUi();
      return;
    }

    cloudClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
    cloudClient.auth.onAuthStateChange(function (_event, session) {
      cloudSession = session;
      updateCloudUi();
    });
  }

  async function refreshCloudSession() {
    if (!cloudClient) return;
    var response = await cloudClient.auth.getSession();
    if (response.error) {
      showSaveFeedback("云端登录状态读取失败：" + response.error.message);
      return;
    }
    cloudSession = response.data.session;
    updateCloudUi();
  }

  async function sendCloudLoginLink() {
    if (!cloudClient) {
      showSaveFeedback("Supabase SDK 尚未加载，稍后刷新页面再试。");
      return;
    }

    var email = cloudEmailInput.value.trim();
    if (!email) {
      showError("请先输入用于云端同步的邮箱。");
      return;
    }

    clearError();
    setCloudBusy(true);
    try {
      var response = await cloudClient.auth.signInWithOtp({
        email: email,
        options: {
          emailRedirectTo: PUBLIC_APP_URL
        }
      });

      if (response.error) throw response.error;
      showSaveFeedback("登录链接已发送到 " + email + "。打开邮件链接后回到本页即可同步。");
    } catch (error) {
      showError("发送登录链接失败：" + error.message);
    } finally {
      setCloudBusy(false);
      updateCloudUi();
    }
  }

  async function signOutCloud() {
    if (!cloudClient) return;
    setCloudBusy(true);
    try {
      var response = await cloudClient.auth.signOut();
      if (response.error) throw response.error;
      cloudSession = null;
      showSaveFeedback("已退出云端账号，本地记录仍保留。");
    } catch (error) {
      showError("退出云端失败：" + error.message);
    } finally {
      setCloudBusy(false);
      updateCloudUi();
    }
  }

  function ensureCloudSignedIn() {
    if (!cloudClient || !cloudSession || !cloudSession.user) {
      showError("请先通过邮箱登录 Supabase 云端同步。");
      return false;
    }
    return true;
  }

  function isMissingCloudColumnError(error) {
    var code = error && error.code ? String(error.code) : "";
    var message = error && error.message ? String(error.message) : "";
    return (
      code === "42703" ||
      code === "PGRST204" ||
      /does not exist/i.test(message) ||
      /Could not find the '.*' column/i.test(message)
    );
  }

  async function upsertCloudRecords(records) {
    if (!ensureCloudSignedIn()) return false;

    var rows = records
      .filter(function (record) {
        return record.recordDate;
      })
      .map(recordToCloudRow);

    if (!rows.length) {
      showError("没有可上传的记录。");
      return false;
    }

    try {
      var response = await cloudClient
        .from(CLOUD_TABLE)
        .upsert(rows, { onConflict: "user_id,record_date" });

      if (response.error) throw response.error;
      return true;
    } catch (error) {
      if (!isMissingCloudColumnError(error)) {
        throw error;
      }

      var legacyRows = records
        .filter(function (record) {
          return record.recordDate;
        })
        .map(recordToLegacyCloudRow);

      var fallbackResponse = await cloudClient
        .from(CLOUD_TABLE)
        .upsert(legacyRows, { onConflict: "user_id,record_date" });

      if (fallbackResponse.error) {
        throw fallbackResponse.error;
      }

      showSaveFeedback("云端表结构还没升级，已先同步核心字段。请执行最新 supabase_schema.sql 以保存推荐策略和 OTM 参考位。");
      return true;
    }
  }

  async function uploadLocalRecordsToCloud() {
    clearError();
    var records = loadSavedRecords();
    if (!records.length) {
      showError("本地还没有记录，请先保存至少一条。");
      return;
    }

    setCloudBusy(true);
    try {
      await upsertCloudRecords(records);
      showSaveFeedback("已上传 " + records.length + " 条本地记录到 Supabase。");
    } catch (error) {
      showError("上传云端失败：" + error.message);
    } finally {
      setCloudBusy(false);
      updateCloudUi();
    }
  }

  async function loadCloudRecords() {
    if (!ensureCloudSignedIn()) return;

    clearError();
    setCloudBusy(true);
    try {
      var response = await cloudClient
        .from(CLOUD_TABLE)
        .select("*")
        .order("record_date", { ascending: false });

      if (response.error) throw response.error;

      var incoming = (response.data || []).map(cloudRowToRecord);
      var merged = mergeRecords(loadSavedRecords(), incoming);
      await persistSavedRecords(merged);
      renderSavedRecords();
      showSaveFeedback("已从 Supabase 载入 " + incoming.length + " 条记录，并与本地记录合并。");
    } catch (error) {
      showError("载入云端记录失败：" + error.message);
    } finally {
      setCloudBusy(false);
      updateCloudUi();
    }
  }

  async function deleteCloudRecord(recordDate) {
    if (!cloudClient || !cloudSession || !cloudSession.user || !recordDate) return;

    var response = await cloudClient
      .from(CLOUD_TABLE)
      .delete()
      .eq("record_date", recordDate);

    if (response.error) {
      showSaveFeedback("本地已删除，但云端删除失败：" + response.error.message);
    }
  }

  function formatDateLabel(dateText) {
    if (!dateText) return "未命名日期";
    return dateText;
  }

  function numericOrFallback(value, fallback) {
    var parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function buildRecommendation(result) {
    if (!result) return "";
    return result.tradeSide + " credit spread | 点位 " + formatNumber(result.exactTargetPrice, 2) + " | Final OTM " + formatPercent(result.finalOtmPct, 2);
  }

  function referenceValueByPct(result, pct, direction) {
    if (!result || !Array.isArray(result.referenceLevels)) return null;
    var found = result.referenceLevels.find(function (level) {
      return level.pct === pct;
    });
    if (!found) return null;
    return direction === "down" ? found.downLevel : found.upLevel;
  }

  function normalizeRecord(record) {
    var safeRecord = record || {};
    var note = typeof safeRecord.note === "string" ? safeRecord.note : "";
    var outerFivePointStrike = Number.isFinite(Number(safeRecord.outerFivePointStrike)) ? Number(safeRecord.outerFivePointStrike) : null;
    var innerFivePointStrike = Number.isFinite(Number(safeRecord.innerFivePointStrike)) ? Number(safeRecord.innerFivePointStrike) : null;
    var fallbackResult = null;

    if (Number(safeRecord.spxPrevClose) > 0 && Number(safeRecord.prevVixClose) > 0 && Number(safeRecord.spxOpen) > 0) {
      try {
        fallbackResult = core.calculateStrategy({
          spxPrevClose: Number(safeRecord.spxPrevClose),
          prevVixClose: Number(safeRecord.prevVixClose),
          spxOpen: Number(safeRecord.spxOpen)
        });
      } catch (_error) {
        fallbackResult = null;
      }
    }

    return {
      recordDate: safeRecord.recordDate || "",
      spxPrevClose: Number(safeRecord.spxPrevClose || 0),
      prevVixClose: Number(safeRecord.prevVixClose || 0),
      spxOpen: Number(safeRecord.spxOpen || 0),
      tradeSide: safeRecord.tradeSide || "",
      directionSource: safeRecord.directionSource || "",
      finalOtmPct: Number(safeRecord.finalOtmPct || 0),
      exactTargetPrice: Number(safeRecord.exactTargetPrice || 0),
      outerFivePointStrike: outerFivePointStrike,
      innerFivePointStrike: innerFivePointStrike,
      recommendation: typeof safeRecord.recommendation === "string" && safeRecord.recommendation
        ? safeRecord.recommendation
        : buildRecommendation(fallbackResult),
      down1_5Level: numericOrFallback(safeRecord.down1_5Level, referenceValueByPct(fallbackResult, 0.015, "down")),
      up1_5Level: numericOrFallback(safeRecord.up1_5Level, referenceValueByPct(fallbackResult, 0.015, "up")),
      down2_0Level: numericOrFallback(safeRecord.down2_0Level, referenceValueByPct(fallbackResult, 0.02, "down")),
      up2_0Level: numericOrFallback(safeRecord.up2_0Level, referenceValueByPct(fallbackResult, 0.02, "up")),
      down2_5Level: numericOrFallback(safeRecord.down2_5Level, referenceValueByPct(fallbackResult, 0.025, "down")),
      up2_5Level: numericOrFallback(safeRecord.up2_5Level, referenceValueByPct(fallbackResult, 0.025, "up")),
      down3_0Level: numericOrFallback(safeRecord.down3_0Level, referenceValueByPct(fallbackResult, 0.03, "down")),
      up3_0Level: numericOrFallback(safeRecord.up3_0Level, referenceValueByPct(fallbackResult, 0.03, "up")),
      note: note,
      savedAt: safeRecord.savedAt || ""
    };
  }

  function mergeRecords(localRecords, incomingRecords) {
    var byDate = {};
    localRecords.concat(incomingRecords).forEach(function (record) {
      var normalized = normalizeRecord(record);
      if (normalized.recordDate) {
        byDate[normalized.recordDate] = normalized;
      }
    });

    return Object.keys(byDate)
      .sort()
      .map(function (recordDate) {
        return byDate[recordDate];
      });
  }

  function cloudRowToRecord(row) {
    return normalizeRecord({
      recordDate: row.record_date,
      spxPrevClose: row.spx_prev_close,
      prevVixClose: row.prev_vix_close,
      spxOpen: row.spx_open,
      tradeSide: row.trade_side,
      directionSource: row.direction_source,
      finalOtmPct: row.final_otm_pct,
      exactTargetPrice: row.exact_target_price,
      outerFivePointStrike: row.outer_five_point_strike,
      innerFivePointStrike: row.inner_five_point_strike,
      recommendation: row.recommended_strategy,
      down1_5Level: row.reference_down_1_5,
      up1_5Level: row.reference_up_1_5,
      down2_0Level: row.reference_down_2_0,
      up2_0Level: row.reference_up_2_0,
      down2_5Level: row.reference_down_2_5,
      up2_5Level: row.reference_up_2_5,
      down3_0Level: row.reference_down_3_0,
      up3_0Level: row.reference_up_3_0,
      note: row.note,
      savedAt: row.saved_at
    });
  }

  function recordToCloudRow(record) {
    var normalized = normalizeRecord(record);
    var row = {
      record_date: normalized.recordDate,
      spx_prev_close: normalized.spxPrevClose,
      prev_vix_close: normalized.prevVixClose,
      spx_open: normalized.spxOpen,
      trade_side: normalized.tradeSide,
      direction_source: normalized.directionSource,
      final_otm_pct: normalized.finalOtmPct,
      exact_target_price: normalized.exactTargetPrice,
      outer_five_point_strike: normalized.outerFivePointStrike,
      inner_five_point_strike: normalized.innerFivePointStrike,
      recommended_strategy: normalized.recommendation,
      reference_down_1_5: normalized.down1_5Level,
      reference_up_1_5: normalized.up1_5Level,
      reference_down_2_0: normalized.down2_0Level,
      reference_up_2_0: normalized.up2_0Level,
      reference_down_2_5: normalized.down2_5Level,
      reference_up_2_5: normalized.up2_5Level,
      reference_down_3_0: normalized.down3_0Level,
      reference_up_3_0: normalized.up3_0Level,
      note: normalized.note,
      saved_at: normalized.savedAt || new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    if (cloudSession && cloudSession.user && cloudSession.user.id) {
      row.user_id = cloudSession.user.id;
    }

    return row;
  }

  function recordToLegacyCloudRow(record) {
    var normalized = normalizeRecord(record);
    var row = {
      record_date: normalized.recordDate,
      spx_prev_close: normalized.spxPrevClose,
      prev_vix_close: normalized.prevVixClose,
      spx_open: normalized.spxOpen,
      trade_side: normalized.tradeSide,
      direction_source: normalized.directionSource,
      final_otm_pct: normalized.finalOtmPct,
      exact_target_price: normalized.exactTargetPrice,
      outer_five_point_strike: normalized.outerFivePointStrike,
      inner_five_point_strike: normalized.innerFivePointStrike,
      note: normalized.note,
      saved_at: normalized.savedAt || new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    if (cloudSession && cloudSession.user && cloudSession.user.id) {
      row.user_id = cloudSession.user.id;
    }

    return row;
  }

  function formatNumber(value, digits) {
    return Number(value).toLocaleString("en-US", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    });
  }

  function formatPercent(value, digits) {
    return (value * 100).toFixed(digits) + "%";
  }

  function signedPercent(value, digits) {
    var sign = value > 0 ? "+" : "";
    return sign + formatPercent(value, digits);
  }

  function expectedMoveLowPrice(result) {
    if (Number.isFinite(result.expectedMoveLowPrice)) {
      return result.expectedMoveLowPrice;
    }

    return result.spxPrevClose * (1 - result.baseExpectedMovePct);
  }

  function expectedMoveHighPrice(result) {
    if (Number.isFinite(result.expectedMoveHighPrice)) {
      return result.expectedMoveHighPrice;
    }

    return result.spxPrevClose * (1 + result.baseExpectedMovePct);
  }

  function aDescription(result) {
    return "|gap| = " + formatPercent(result.absGapPct, 3) + "，落在 " + result.gapBucket + " 档";
  }

  function overrideMessage(result) {
    if (result.overrideApplied) {
      return "已触发低 VIX override：t-1 VIX1D < 15，且未出现超过 -0.5% 的 gap down，因此今日固定做 CALL credit spread。";
    }

    if (result.gapdownExemption) {
      return "低 VIX 豁免已触发：虽然 t-1 VIX1D < 15，但 gap down 已超过 -0.5%，因此回到正常规则，今日做 PUT credit spread。";
    }

    return "未触发低 VIX override，今日方向完全按 gap 决定：gap down 做 PUT，gap up 做 CALL。";
  }

  function narrative(result) {
    var floorText = result.floorApplied
      ? "由于公式算出的 OTM 更近，最终被 " + formatPercent(result.otmFloorPct, 2) + " 的底线抬高。"
      : "公式算出的 OTM 已高于底线，因此直接采用 raw OTM。";

    return (
      "今日开盘相对昨收为 " +
      signedPercent(result.gapPct, 3) +
      "，默认方向属于 " +
      (result.gapPct > 0 ? "高开 CALL" : "低开 PUT") +
      " 侧。最终实际方向为 " +
      result.tradeSide +
      "，来源是 “" +
      result.directionSource +
      "”。基础 expected move 为 " +
      formatPercent(result.baseExpectedMovePct, 3) +
      "，乘上 k 后为 " +
      formatPercent(result.moveAfterKPct, 3) +
      "，再乘 a = " +
      result.aMultiplier.toFixed(1) +
      " 后得到 raw OTM " +
      formatPercent(result.rawOtmPct, 3) +
      "。" +
      floorText +
      " 因此精确公式点位为 " +
      formatNumber(result.exactTargetPrice, 2) +
      "。"
    );
  }

  function paint(result) {
    lastCalculatedResult = result;
    fields.tradeSideBadge.textContent = result.tradeSide;
    fields.tradeSideBadge.className = "direction-badge " + (result.tradeSide === "CALL" ? "call" : "put");
    fields.directionSourceBadge.textContent = result.directionSource;

    fields.exactTarget.textContent = formatNumber(result.exactTargetPrice, 2);
    fields.finalOtm.textContent = formatPercent(result.finalOtmPct, 2);
    fields.expectMoveLow.textContent = formatNumber(expectedMoveLowPrice(result), 2);
    fields.expectMoveHigh.textContent = formatNumber(expectedMoveHighPrice(result), 2);

    fields.overrideBanner.textContent = overrideMessage(result);
    fields.exactPointCard.textContent = formatNumber(result.exactTargetPrice, 2);
    fields.outerStrikeCard.textContent = formatNumber(result.outerFivePointStrike, 0);
    fields.innerStrikeCard.textContent = formatNumber(result.innerFivePointStrike, 0);
    fields.narrativeCard.textContent = narrative(result);

    fields.gapPct.textContent = signedPercent(result.gapPct, 3);
    fields.gapBucket.textContent = result.gapBucket;
    fields.baseExpectedMove.textContent = formatPercent(result.baseExpectedMovePct, 3);
    fields.afterKMove.textContent = formatPercent(result.moveAfterKPct, 3);
    fields.aMultiplier.textContent = result.aMultiplier.toFixed(1);
    fields.aDescription.textContent = aDescription(result);
    fields.rawOtm.textContent = formatPercent(result.rawOtmPct, 3);
    fields.otmFloor.textContent = formatPercent(result.otmFloorPct, 2);
    fields.floorReason.textContent = result.floorApplied ? "底线已接管最终 OTM" : "公式 OTM 高于底线";

    result.referenceLevels.forEach(function (level) {
      var pair = referenceFieldMap[level.pct];
      fields[pair[0]].textContent = formatNumber(level.downLevel, 2);
      fields[pair[1]].textContent = formatNumber(level.upLevel, 2);
    });
  }

  function createRecordMarkup(record) {
    var card = document.createElement("article");
    card.className = "saved-record-card";

    var head = document.createElement("div");
    head.className = "saved-record-head";

    var titleWrap = document.createElement("div");

    var title = document.createElement("strong");
    title.textContent = formatDateLabel(record.recordDate);
    titleWrap.appendChild(title);

    var sub = document.createElement("span");
    sub.className = "saved-record-sub";
    sub.textContent = "SPX 昨收 " + formatNumber(record.spxPrevClose, 2) + " | 开盘 " + formatNumber(record.spxOpen, 2) + " | VIX1D " + formatNumber(record.prevVixClose, 2);
    titleWrap.appendChild(sub);

    head.appendChild(titleWrap);

    var stats = document.createElement("div");
    stats.className = "saved-record-stats";

    var side = document.createElement("span");
    side.className = "saved-record-chip " + (record.tradeSide === "CALL" ? "chip-call" : "chip-put");
    side.textContent = record.tradeSide;
    stats.appendChild(side);

    var target = document.createElement("span");
    target.className = "saved-record-chip";
    target.textContent = "点位 " + formatNumber(record.exactTargetPrice, 2);
    stats.appendChild(target);

    var otm = document.createElement("span");
    otm.className = "saved-record-chip";
    otm.textContent = "OTM " + formatPercent(record.finalOtmPct, 2);
    stats.appendChild(otm);

    if (record.recommendation) {
      var recommendation = document.createElement("p");
      recommendation.className = "saved-record-note";
      recommendation.textContent = "推荐策略：" + record.recommendation;
      card.appendChild(recommendation);
    }

    if (record.note) {
      var note = document.createElement("p");
      note.className = "saved-record-note";
      note.textContent = "备注：" + record.note;
      card.appendChild(note);
    }

    var actionRow = document.createElement("div");
    actionRow.className = "saved-record-actions";

    var loadButton = document.createElement("button");
    loadButton.type = "button";
    loadButton.className = "ghost-button small-button";
    loadButton.textContent = "载入";
    loadButton.addEventListener("click", function () {
      spxPrevCloseInput.value = record.spxPrevClose;
      vixPrevCloseInput.value = record.prevVixClose;
      spxOpenInput.value = record.spxOpen;
      recordDateInput.value = record.recordDate || todayString();
      recordNoteInput.value = record.note || "";
      calculateAndRender();
      showSaveFeedback("已载入 " + formatDateLabel(record.recordDate) + " 的记录。");
      window.scrollTo({ top: 0, behavior: "smooth" });
    });

    var deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "text-button";
    deleteButton.textContent = "删除";
    deleteButton.addEventListener("click", async function () {
      var records = loadSavedRecords().filter(function (item) {
        return item.recordDate !== record.recordDate;
      });
      try {
        await persistSavedRecords(records);
        renderSavedRecords();
        showSaveFeedback("已删除 " + formatDateLabel(record.recordDate) + " 的记录。");
        await deleteCloudRecord(record.recordDate);
      } catch (error) {
        showError("删除记录失败：" + error.message);
      }
    });

    actionRow.appendChild(loadButton);
    actionRow.appendChild(deleteButton);

    card.appendChild(head);
    card.appendChild(stats);
    card.appendChild(actionRow);
    return card;
  }

  function renderSavedRecords() {
    var records = loadSavedRecords().sort(function (left, right) {
      return right.recordDate.localeCompare(left.recordDate);
    });

    savedRecordsList.innerHTML = "";

    if (!records.length) {
      savedRecordsEmpty.classList.remove("hidden");
      return;
    }

    savedRecordsEmpty.classList.add("hidden");
    records.forEach(function (record) {
      savedRecordsList.appendChild(createRecordMarkup(record));
    });
  }

  function exportRows() {
    return loadSavedRecords()
      .sort(function (left, right) {
        return left.recordDate.localeCompare(right.recordDate);
      })
      .map(function (record) {
        var calculated = core.calculateStrategy({
          spxPrevClose: record.spxPrevClose,
          prevVixClose: record.prevVixClose,
          spxOpen: record.spxOpen
        });

        return {
          "记录日期": record.recordDate,
          "SPX昨收": record.spxPrevClose,
          "VIX1D昨收": record.prevVixClose,
          "SPX开盘": record.spxOpen,
          "Gap%": Number(((record.spxOpen / record.spxPrevClose - 1) * 100).toFixed(4)),
          "Gap分档": calculated.gapBucket,
          "方向": record.tradeSide,
          "方向来源": record.directionSource,
          "a值": calculated.aMultiplier,
          "RawOTM%": Number((calculated.rawOtmPct * 100).toFixed(4)),
          "推荐策略": record.recommendation || "",
          "FinalOTM%": Number((record.finalOtmPct * 100).toFixed(4)),
          "精确公式点位": Number(record.exactTargetPrice.toFixed(4)),
          "向外保守5点": record.outerFivePointStrike,
          "向内5点": record.innerFivePointStrike,
          "下跌1.5%": Number(numericOrFallback(record.down1_5Level, 0).toFixed(4)),
          "上涨1.5%": Number(numericOrFallback(record.up1_5Level, 0).toFixed(4)),
          "下跌2.0%": Number(numericOrFallback(record.down2_0Level, 0).toFixed(4)),
          "上涨2.0%": Number(numericOrFallback(record.up2_0Level, 0).toFixed(4)),
          "下跌2.5%": Number(numericOrFallback(record.down2_5Level, 0).toFixed(4)),
          "上涨2.5%": Number(numericOrFallback(record.up2_5Level, 0).toFixed(4)),
          "下跌3.0%": Number(numericOrFallback(record.down3_0Level, 0).toFixed(4)),
          "上涨3.0%": Number(numericOrFallback(record.up3_0Level, 0).toFixed(4)),
          "备注": record.note || "",
          "保存时间": record.savedAt || ""
        };
      });
  }

  function escapeCsvValue(value) {
    var text = value == null ? "" : String(value);
    if (text.indexOf('"') >= 0) {
      text = text.replace(/"/g, '""');
    }
    if (/[",\n]/.test(text)) {
      text = '"' + text + '"';
    }
    return text;
  }

  function downloadBlob(filename, content, mimeType) {
    var blob = new Blob([content], { type: mimeType });
    var url = window.URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  }

  function exportAsCsv() {
    var rows = exportRows();
    if (!rows.length) {
      showError("还没有可导出的记录，请先保存至少一条。");
      return;
    }

    clearError();
    var headers = Object.keys(rows[0]);
    var lines = [headers.join(",")];
    rows.forEach(function (row) {
      lines.push(
        headers
          .map(function (header) {
            return escapeCsvValue(row[header]);
          })
          .join(",")
      );
    });
    downloadBlob("spx_credit_spread_records.csv", "\ufeff" + lines.join("\n"), "text/csv;charset=utf-8;");
    showSaveFeedback("已导出 CSV。");
  }

  function escapeXml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function exportAsExcel() {
    var rows = exportRows();
    if (!rows.length) {
      showError("还没有可导出的记录，请先保存至少一条。");
      return;
    }

    clearError();
    var headers = Object.keys(rows[0]);
    var html = [
      "<html>",
      "<head>",
      '<meta charset="utf-8">',
      "</head>",
      "<body>",
      "<table border='1'>",
      "<thead><tr>" +
        headers
          .map(function (header) {
            return "<th>" + escapeXml(header) + "</th>";
          })
          .join("") +
        "</tr></thead>",
      "<tbody>"
    ];

    rows.forEach(function (row) {
      html.push(
        "<tr>" +
          headers
            .map(function (header) {
              return "<td>" + escapeXml(row[header]) + "</td>";
            })
            .join("") +
          "</tr>"
      );
    });

    html.push("</tbody></table></body></html>");
    downloadBlob("spx_credit_spread_records.xls", html.join(""), "application/vnd.ms-excel;charset=utf-8;");
    showSaveFeedback("已导出 Excel。");
  }

  function clearError() {
    errorBanner.textContent = "";
    errorBanner.classList.add("hidden");
  }

  function showError(message) {
    errorBanner.textContent = message;
    errorBanner.classList.remove("hidden");
  }

  function currentInputs() {
    return {
      spxPrevClose: spxPrevCloseInput.value,
      prevVixClose: vixPrevCloseInput.value,
      spxOpen: spxOpenInput.value
    };
  }

  function calculateAndRender() {
    clearError();

    try {
      var result = core.calculateStrategy(currentInputs());
      paint(result);
      hideSaveFeedback();
      return true;
    } catch (error) {
      lastCalculatedResult = null;
      showError(error.message);
      return false;
    }
  }

  async function saveCurrentRecord() {
    clearError();

    if (!recordDateInput.value) {
      showError("请先选择记录日期。");
      return;
    }

    if (!calculateAndRender() || !lastCalculatedResult) {
      return;
    }

    var records = loadSavedRecords().filter(function (record) {
      return record.recordDate !== recordDateInput.value;
    });

    var newRecord = {
      recordDate: recordDateInput.value,
      spxPrevClose: Number(spxPrevCloseInput.value),
      prevVixClose: Number(vixPrevCloseInput.value),
      spxOpen: Number(spxOpenInput.value),
      tradeSide: lastCalculatedResult.tradeSide,
      directionSource: lastCalculatedResult.directionSource,
      finalOtmPct: lastCalculatedResult.finalOtmPct,
      exactTargetPrice: lastCalculatedResult.exactTargetPrice,
      outerFivePointStrike: lastCalculatedResult.outerFivePointStrike,
      innerFivePointStrike: lastCalculatedResult.innerFivePointStrike,
      recommendation: buildRecommendation(lastCalculatedResult),
      down1_5Level: lastCalculatedResult.referenceLevels[0].downLevel,
      up1_5Level: lastCalculatedResult.referenceLevels[0].upLevel,
      down2_0Level: lastCalculatedResult.referenceLevels[1].downLevel,
      up2_0Level: lastCalculatedResult.referenceLevels[1].upLevel,
      down2_5Level: lastCalculatedResult.referenceLevels[2].downLevel,
      up2_5Level: lastCalculatedResult.referenceLevels[2].upLevel,
      down3_0Level: lastCalculatedResult.referenceLevels[3].downLevel,
      up3_0Level: lastCalculatedResult.referenceLevels[3].upLevel,
      note: recordNoteInput.value.trim(),
      savedAt: new Date().toISOString()
    };

    if (!localFolderHandle) {
      showError("请先选择本地文件夹，再保存到电脑文件。");
      return;
    }

    records.push(newRecord);

    records.sort(function (left, right) {
      return left.recordDate.localeCompare(right.recordDate);
    });

    try {
      await persistSavedRecords(records);
      renderSavedRecords();
      showSaveFeedback("已保存 " + formatDateLabel(recordDateInput.value) + " 到本地文件。");
    } catch (error) {
      showError("保存到本地文件失败：" + error.message);
      return;
    }

    if (cloudClient && cloudSession && cloudSession.user) {
      upsertCloudRecords([newRecord])
        .then(function () {
          showSaveFeedback("已保存 " + formatDateLabel(recordDateInput.value) + "，并同步到 Supabase。");
        })
        .catch(function (error) {
          showSaveFeedback("本地已保存，但云端同步失败：" + error.message);
        });
    }
  }

  function loadExample() {
    spxPrevCloseInput.value = "6000";
    vixPrevCloseInput.value = "25";
    spxOpenInput.value = "5991";
    calculateAndRender();
  }

  function loadLowVixExample() {
    spxPrevCloseInput.value = "6000";
    vixPrevCloseInput.value = "14.2";
    spxOpenInput.value = "5993";
    calculateAndRender();
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    calculateAndRender();
  });

  saveRecordButton.addEventListener("click", saveCurrentRecord);
  exportCsvButton.addEventListener("click", exportAsCsv);
  exportExcelButton.addEventListener("click", exportAsExcel);
  localChooseFolderButton.addEventListener("click", chooseLocalFolder);
  localLoadButton.addEventListener("click", reloadLocalRecordsFromFolder);
  cloudLoginButton.addEventListener("click", sendCloudLoginLink);
  cloudLoadButton.addEventListener("click", loadCloudRecords);
  cloudUploadButton.addEventListener("click", uploadLocalRecordsToCloud);
  cloudLogoutButton.addEventListener("click", signOutCloud);
  document.getElementById("load-example").addEventListener("click", loadExample);
  document.getElementById("load-low-vix-example").addEventListener("click", loadLowVixExample);

  [spxPrevCloseInput, vixPrevCloseInput, spxOpenInput].forEach(function (input) {
    input.addEventListener("input", function () {
      if (spxPrevCloseInput.value && vixPrevCloseInput.value && spxOpenInput.value) {
        calculateAndRender();
      }
    });
  });

  recordDateInput.value = todayString();
  updateLocalUi();
  initCloudClient();
  refreshCloudSession();
  restoreLocalFolderHandle();
  renderSavedRecords();
  loadExample();
})();
