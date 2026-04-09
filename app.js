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
  var STORAGE_KEY = "spx-credit-spread-calculator-records-v1";
  var SUPABASE_URL = "https://frnrhycstwiezcifktnh.supabase.co";
  var SUPABASE_PUBLISHABLE_KEY = "sb_publishable_-xXAZ7HC7MSNZcYSRap5mw_hIR_N4fN";
  var PUBLIC_APP_URL = "https://1477009639zw-blip.github.io/spx-credit-spread-calculator/";
  var CLOUD_TABLE = "spx_credit_spread_records";
  var cloudClient = null;
  var cloudSession = null;
  var lastCalculatedResult = null;

  var fields = {
    tradeSideBadge: document.getElementById("trade-side-badge"),
    directionSourceBadge: document.getElementById("direction-source-badge"),
    exactTarget: document.getElementById("exact-target"),
    finalOtm: document.getElementById("final-otm"),
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
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
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

  function persistSavedRecords(records) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  }

  function hideSaveFeedback() {
    saveFeedback.textContent = "";
    saveFeedback.classList.add("hidden");
  }

  function showSaveFeedback(message) {
    saveFeedback.textContent = message;
    saveFeedback.classList.remove("hidden");
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

    var response = await cloudClient
      .from(CLOUD_TABLE)
      .upsert(rows, { onConflict: "user_id,record_date" });

    if (response.error) throw response.error;
    return true;
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
      persistSavedRecords(merged);
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

  function normalizeRecord(record) {
    var safeRecord = record || {};
    var note = typeof safeRecord.note === "string" ? safeRecord.note : "";
    var outerFivePointStrike = Number.isFinite(Number(safeRecord.outerFivePointStrike)) ? Number(safeRecord.outerFivePointStrike) : null;
    var innerFivePointStrike = Number.isFinite(Number(safeRecord.innerFivePointStrike)) ? Number(safeRecord.innerFivePointStrike) : null;
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
    deleteButton.addEventListener("click", function () {
      var records = loadSavedRecords().filter(function (item) {
        return item.recordDate !== record.recordDate;
      });
      persistSavedRecords(records);
      renderSavedRecords();
      showSaveFeedback("已删除 " + formatDateLabel(record.recordDate) + " 的记录。");
      deleteCloudRecord(record.recordDate);
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
          "Gap%": Number((calculated.gapPct * 100).toFixed(4)),
          "Gap分档": calculated.gapBucket,
          "方向": calculated.tradeSide,
          "方向来源": calculated.directionSource,
          "a值": calculated.aMultiplier,
          "RawOTM%": Number((calculated.rawOtmPct * 100).toFixed(4)),
          "FinalOTM%": Number((calculated.finalOtmPct * 100).toFixed(4)),
          "精确公式点位": Number(calculated.exactTargetPrice.toFixed(4)),
          "向外保守5点": calculated.outerFivePointStrike,
          "向内5点": calculated.innerFivePointStrike,
          "下跌1.5%": Number(calculated.referenceLevels[0].downLevel.toFixed(4)),
          "上涨1.5%": Number(calculated.referenceLevels[0].upLevel.toFixed(4)),
          "下跌2.0%": Number(calculated.referenceLevels[1].downLevel.toFixed(4)),
          "上涨2.0%": Number(calculated.referenceLevels[1].upLevel.toFixed(4)),
          "下跌2.5%": Number(calculated.referenceLevels[2].downLevel.toFixed(4)),
          "上涨2.5%": Number(calculated.referenceLevels[2].upLevel.toFixed(4)),
          "下跌3.0%": Number(calculated.referenceLevels[3].downLevel.toFixed(4)),
          "上涨3.0%": Number(calculated.referenceLevels[3].upLevel.toFixed(4)),
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

  function saveCurrentRecord() {
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
      note: recordNoteInput.value.trim(),
      savedAt: new Date().toISOString()
    };

    records.push(newRecord);

    records.sort(function (left, right) {
      return left.recordDate.localeCompare(right.recordDate);
    });

    persistSavedRecords(records);
    renderSavedRecords();
    showSaveFeedback("已保存 " + formatDateLabel(recordDateInput.value) + " 的记录。");

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
  initCloudClient();
  refreshCloudSession();
  renderSavedRecords();
  loadExample();
})();
