/* Laboratory Inventory & Borrowing Management System
 * Tampilan: template Titan (Bootstrap 3 + jQuery, animasi WOW/animate.css,
 * text rotator, counter, progress bar, parallax hero, preloader).
 * Data: fungsi RPC Supabase (lihat supabase/schema.sql). Role & hak akses
 * diperiksa di server. */
(function ($) {
  "use strict";

  var CFG = window.APP_CONFIG || {};
  var SUPABASE_URL = CFG.SUPABASE_URL;
  var SUPABASE_ANON_KEY = CFG.SUPABASE_ANON_KEY;
  var SESSION_KEY = "lab_inventory_session";

  // ==================================================================
  // API
  // ==================================================================
  // Publishable key baru (sb_publishable_...) cukup di header "apikey".
  // Anon key lama (JWT, diawali "eyJ") juga dikirim sebagai Bearer.
  function apiHeaders() {
    var h = { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY };
    if (/^eyJ/.test(SUPABASE_ANON_KEY || "")) h.Authorization = "Bearer " + SUPABASE_ANON_KEY;
    return h;
  }

  function rpc(fn, params) {
    return fetch(SUPABASE_URL + "/rest/v1/rpc/" + fn, {
      method: "POST",
      headers: apiHeaders(),
      body: JSON.stringify(params || {})
    }).then(function (res) {
      return res.text().then(function (text) {
        var data = text ? JSON.parse(text) : null;
        if (!res.ok) {
          var msg = (data && (data.message || data.hint)) || "Terjadi kesalahan (" + res.status + ")";
          var err = new Error(msg);
          if (/Sesi tidak valid|dinonaktifkan/.test(msg)) err.sessionExpired = true;
          throw err;
        }
        return data;
      });
    });
  }

  function api(fn, params) {
    return rpc(fn, $.extend({ p_token: state.token }, params || {})).catch(function (err) {
      if (err.sessionExpired) {
        clearSession();
        toast(err.message, true);
        render();
      }
      throw err;
    });
  }

  // ==================================================================
  // State & sesi
  // ==================================================================
  var state = { token: null, user: null };

  function loadSession() {
    try {
      var s = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
      if (s && s.token && s.user) { state.token = s.token; state.user = s.user; }
    } catch (e) { /* abaikan */ }
  }
  function saveSession() {
    try { localStorage.setItem(SESSION_KEY, JSON.stringify({ token: state.token, user: state.user })); } catch (e) {}
  }
  function clearSession() {
    state.token = null; state.user = null;
    try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
  }
  function isAdmin() { return state.user && state.user.role === "admin"; }

  // ==================================================================
  // Util
  // ==================================================================
  function esc(v) {
    return String(v === null || v === undefined ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function fmtNum(n) { return Number(n || 0).toLocaleString("id-ID"); }
  function fmtDate(d) {
    if (!d) return "-";
    return new Date(d.length === 10 ? d + "T00:00:00" : d)
      .toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
  }
  function fmtDateTime(d) {
    return d ? new Date(d).toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "-";
  }
  function today() {
    var d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
  }
  function debounce(fn, ms) {
    var t; return function () { var a = arguments; clearTimeout(t); t = setTimeout(function () { fn.apply(null, a); }, ms || 250); };
  }
  function formData(form) {
    var o = {}; $(form).serializeArray().forEach(function (f) { o[f.name] = f.value; }); return o;
  }

  var toastTimer;
  function toast(msg, isError) {
    var $t = $("#toast");
    $t.stop(true, true).text(msg)
      .attr("class", "app-toast animated fadeInUp" + (isError ? " error" : ""));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { $t.fadeOut(300, function () { $t.addClass("hidden").show(); }); }, 3500);
  }

  function statusLabel(status) {
    return status === "dipinjam"
      ? '<span class="label label-dipinjam">Dipinjam</span>'
      : '<span class="label label-selesai">Selesai</span>';
  }

  // Animasi baris tabel bertahap (animate.css)
  function rowAnim(i) {
    return 'class="row-anim animated fadeInUp" style="animation-delay:' + Math.min(i * 0.05, 0.6).toFixed(2) + 's"';
  }

  // Ulangi animasi animate.css pada elemen yang sudah ada di halaman
  function replayAnim($el, name, delay) {
    $el.removeClass("animated " + name).css("animation-delay", delay || "0s");
    void $el[0].offsetWidth;
    $el.addClass("animated " + name);
  }

  // Counter Titan (countTo)
  function runCounters($root) {
    $root.find(".count-to").each(function () {
      var $c = $(this);
      var to = Number($c.data("countto")) || 0;
      $c.countTo({ from: 0, to: to, speed: 1200, refreshInterval: 30,
        onUpdate: function (v) { $(this).text(fmtNum(Math.round(v))); },
        onComplete: function () { $(this).text(fmtNum(to)); } });
    });
  }

  // Progress bar Titan (lebar + angka naik saat terlihat)
  function runProgress($root) {
    $root.find(".progress-bar").each(function () {
      var $bar = $(this);
      $bar.appear(function () {
        var percent = $bar.attr("aria-valuenow");
        $bar.animate({ width: percent + "%" }, 900);
        $bar.find("span").animate({ opacity: 1 }, 900)
          .countTo({ from: 0, to: Number(percent), speed: 900, refreshInterval: 30 });
      });
    });
    $(window).trigger("scroll");
  }

  // ==================================================================
  // Modal (Bootstrap)
  // ==================================================================
  var modalCancel = null;

  function openModal(title, html, onSubmit, onCancel) {
    modalCancel = onCancel || null;
    $("#modal-title").text(title);
    $("#modal-body").html(html);
    var $form = $("#modal-body form");
    $form.on("submit", function (e) {
      e.preventDefault();
      var $btn = $form.find('[type="submit"]');
      var $err = $form.find(".form-error");
      $btn.prop("disabled", true); $err.text("");
      Promise.resolve(onSubmit(formData($form))).then(function () {
        modalCancel = null;
        $("#modal").modal("hide");
      }).catch(function (err) {
        $err.text(err.message);
        replayAnim($err, "shake");
      }).then(function () { $btn.prop("disabled", false); });
    });
    $("#modal").modal("show");
  }

  $("#modal")
    .on("shown.bs.modal", function () { $(this).find("input, select").first().trigger("focus"); })
    .on("hidden.bs.modal", function () {
      if (modalCancel) { var c = modalCancel; modalCancel = null; c(); }
      $("#modal-body").empty();
    });

  function confirmBox(title, message, okLabel) {
    return new Promise(function (resolve) {
      openModal(title,
        '<form><p>' + message + '</p><p class="form-error"></p>' +
        '<div class="form-actions">' +
        '<button type="button" class="btn btn-border-d btn-round btn-sm" data-dismiss="modal">Batal</button>' +
        '<button type="submit" class="btn btn-d btn-round btn-sm">' + esc(okLabel || "Ya, lanjutkan") + '</button>' +
        '</div></form>',
        function () { resolve(true); },
        function () { resolve(false); });
    });
  }

  // ==================================================================
  // Routing
  // ==================================================================
  var ROUTES = {
    dashboard:    { title: "Dashboard",    icon: "icon-speedometer", subtitle: "Ringkasan inventaris dan aktivitas laboratorium", bg: "dashboard", roles: ["admin", "staff"], render: renderDashboard },
    barang:       { title: "Data Barang",  icon: "icon-toolbox",     subtitle: "Daftar barang dan status ketersediaan",          bg: "barang",    roles: ["admin", "staff"], render: renderItems },
    peminjaman:   { title: "Peminjaman",   icon: "icon-upload",      subtitle: "Catat transaksi peminjaman barang",              bg: "peminjaman",roles: ["admin", "staff"], render: renderLoans },
    pengembalian: { title: "Pengembalian", icon: "icon-download",    subtitle: "Proses pengembalian barang yang dipinjam",       bg: "pengembalian", roles: ["admin", "staff"], render: renderReturns },
    riwayat:      { title: "Riwayat",      icon: "icon-clock",       subtitle: "Riwayat peminjaman dan pengembalian",            bg: "riwayat",   roles: ["admin", "staff"], render: renderHistory },
    pengguna:     { title: "Pengguna",     icon: "icon-profile-male",subtitle: "Kelola akun Admin dan Staff",                     bg: "pengguna",  roles: ["admin"],          render: renderUsers }
  };

  function currentRoute() {
    var key = location.hash.replace(/^#\/?/, "") || "dashboard";
    return ROUTES[key] ? key : "dashboard";
  }

  function renderNav(active) {
    var links = Object.keys(ROUTES).filter(function (k) { return ROUTES[k].roles.indexOf(state.user.role) >= 0; })
      .map(function (k) {
        return '<li><a href="#/' + k + '" class="' + (k === active ? "active" : "") + '">' + ROUTES[k].title + "</a></li>";
      }).join("");
    links +=
      '<li class="dropdown"><a class="dropdown-toggle" href="javascript:void(0)" data-toggle="dropdown">' +
      '<i class="fa fa-user-circle-o"></i> ' + esc(state.user.full_name.split(" ")[0]) + "</a>" +
      '<ul class="dropdown-menu">' +
      '<li class="user-meta">@' + esc(state.user.username) + " · " + (isAdmin() ? "Admin" : "Staff") + "</li>" +
      '<li><a href="javascript:void(0)" id="logout-btn"><i class="fa fa-sign-out"></i> Logout</a></li>' +
      "</ul></li>";
    $("#nav-menu").html(links);
  }

  var currentView = null; // "login" | "app"
  var renderSeq = 0;

  function showView(view) {
    if (currentView === view) return;
    currentView = view;
    if (view === "login") {
      $("#app-view").addClass("hidden");
      $("#login-view").removeClass("hidden").hide().fadeIn(500);
      $("#nav-menu").empty();
      $("#nav-toggle").addClass("hidden");
      $("#login-view .wow").each(function () { replayAnim($(this), this.className.match(/fade\w+/)[0], $(this).data("wow-delay")); });
      buildHomeSection();
    } else {
      $("#login-view").addClass("hidden");
      $("#app-view").removeClass("hidden").hide().fadeIn(500);
      $("#nav-toggle").removeClass("hidden");
    }
    $(window).scrollTop(0);
    navbarAnimation();
  }

  function render() {
    var seq = ++renderSeq;
    if (!state.token) { showView("login"); return Promise.resolve(); }

    var key = currentRoute();
    if (ROUTES[key].roles.indexOf(state.user.role) < 0) {
      toast("Anda tidak memiliki akses ke halaman tersebut.", true);
      location.hash = "#/dashboard";
      return Promise.resolve();
    }

    var first = currentView !== "app";
    showView("app");
    renderNav(key);
    $("#custom-collapse").collapse("hide");

    // Header halaman: ganti latar + animasi judul
    var r = ROUTES[key];
    $("#page-header").css("background-image", "url(assets/images/bg/" + r.bg + ".jpg)");
    $("#page-title").html('<span class="' + r.icon + '"></span>&nbsp; ' + esc(r.title));
    $("#page-subtitle").text(r.subtitle);
    replayAnim($("#page-title"), "fadeInDown");
    replayAnim($("#page-subtitle"), "fadeInUp", ".15s");
    if (!first) $("html, body").animate({ scrollTop: 0 }, 300);

    var $page = $("#page");
    $page.addClass("page-leave");
    return new Promise(function (res) { setTimeout(res, first ? 0 : 200); }).then(function () {
      if (seq !== renderSeq) return;
      $page.html('<p class="empty-state"><i class="fa fa-circle-o-notch fa-spin"></i></p>').removeClass("page-leave");
      return r.render($page).catch(function (err) {
        if (!err.sessionExpired && seq === renderSeq) $page.html('<p class="empty-state">' + esc(err.message) + "</p>");
      });
    });
  }

  // ==================================================================
  // Dashboard
  // ==================================================================
  function renderDashboard($page) {
    return Promise.all([api("get_dashboard"), api("list_items", { p_search: "" })]).then(function (res) {
      var d = res[0], items = res[1];
      var acts = d.recent_activities || [];
      var stats = [
        { icon: "icon-toolbox",  val: d.total_units,        title: "Total Barang",     sub: fmtNum(d.item_types) + " jenis barang" },
        { icon: "icon-laptop",   val: d.available_units,    title: "Barang Tersedia",  sub: "unit siap dipinjam" },
        { icon: "icon-upload",   val: d.borrowed_units,     title: "Barang Dipinjam",  sub: "unit sedang dipinjam" },
        { icon: "icon-clipboard",val: d.total_transactions, title: "Total Transaksi",  sub: fmtNum(d.active_transactions) + " masih aktif" }
      ];
      var actIcon = { peminjaman: "icon-upload", pengembalian: "icon-download", tambah_barang: "icon-toolbox",
        ubah_barang: "icon-edit", hapus_barang: "icon-scissors", tambah_pengguna: "icon-profile-male",
        ubah_pengguna: "icon-profile-male", status_pengguna: "icon-key", hapus_riwayat: "icon-recycle" };

      $page.html(
        '<div class="row multi-columns-row app-panel">' +
        stats.map(function (s, i) {
          return '<div class="col-xs-6 col-md-3"><div class="count-item wow fadeInUp" data-wow-delay="' + (i * 0.1) + 's">' +
            '<div class="count-icon"><span class="' + s.icon + '"></span></div>' +
            '<h3 class="count-to font-alt" data-countto="' + (s.val || 0) + '">0</h3>' +
            '<h5 class="count-title font-serif">' + s.title + "</h5>" +
            '<div class="count-sub">' + s.sub + "</div></div></div>";
        }).join("") +
        "</div>" +
        '<div class="row">' +
        '<div class="col-md-7 app-panel wow fadeInUp">' +
        '<h4 class="font-alt">Aktivitas Terbaru</h4><hr class="divider-w">' +
        (acts.length ? '<ul class="activity-list">' + acts.map(function (a, i) {
          return '<li class="wow fadeInUp" data-wow-delay="' + (i * 0.06).toFixed(2) + 's">' +
            '<span class="act-icon ' + (actIcon[a.action] || "icon-documents") + '"></span>' +
            '<div class="act-body">' + esc(a.description) + "<br><small>oleh " + esc(a.user_name || "-") + "</small></div>" +
            "<small>" + fmtDateTime(a.created_at) + "</small></li>";
        }).join("") + "</ul>" : '<p class="empty-state">Belum ada aktivitas.</p>') +
        "</div>" +
        '<div class="col-md-5 app-panel wow fadeInUp" data-wow-delay=".15s">' +
        '<h4 class="font-alt">Ketersediaan Barang</h4><hr class="divider-w">' +
        (items.length ? items.map(function (it) {
          var total = it.stock + it.borrowed;
          var pct = total > 0 ? Math.round((it.stock / total) * 100) : 0;
          return '<div class="stock-row"><h6 class="font-alt">' + esc(it.name) +
            ' <span class="hint">· ' + fmtNum(it.stock) + "/" + fmtNum(total) + " tersedia</span></h6>" +
            '<div class="progress"><div class="progress-bar pb-dark" aria-valuenow="' + pct +
            '" role="progressbar" aria-valuemin="0" aria-valuemax="100" style="width:0"><span class="font-alt"></span></div></div></div>';
        }).join("") : '<p class="empty-state">Belum ada barang.</p>') +
        "</div></div>"
      );
      runCounters($page);
      runProgress($page);
    });
  }

  // ==================================================================
  // Barang
  // ==================================================================
  function renderItems($page) {
    $page.html(
      '<div class="app-panel wow fadeInUp">' +
      '<div class="panel-tools"><div class="tools-left">' +
      '<input type="search" class="form-control" id="item-search" placeholder="Cari kode, nama, atau kategori…"></div>' +
      (isAdmin() ? '<button class="btn btn-d btn-round" id="add-item"><i class="fa fa-plus"></i> Tambah Barang</button>' : "") +
      '</div><div class="table-wrap" id="item-table"></div></div>');

    function load() {
      return api("list_items", { p_search: $("#item-search").val() }).then(function (items) {
        $("#item-table").html(items.length ?
          '<table class="table table-striped table-border checkout-table"><thead><tr>' +
          '<th>Kode</th><th>Nama Barang</th><th>Kategori</th><th class="num">Stok Tersedia</th><th class="num">Dipinjam</th><th>Status</th>' +
          (isAdmin() ? "<th></th>" : "") + "</tr></thead><tbody>" +
          items.map(function (i, idx) {
            return "<tr " + rowAnim(idx) + "><td><strong>" + esc(i.code) + "</strong></td><td>" + esc(i.name) + "</td>" +
              "<td>" + esc(i.category || "-") + '</td><td class="num">' + fmtNum(i.stock) + '</td><td class="num">' + fmtNum(i.borrowed) + "</td>" +
              "<td>" + (i.stock > 0 ? '<span class="label label-aktif">Tersedia</span>' : '<span class="label label-nonaktif">Habis</span>') + "</td>" +
              (isAdmin() ? '<td class="actions"><button class="btn btn-border-d btn-round btn-xs" data-edit="' + i.id + '"><i class="fa fa-pencil"></i> Edit</button>' +
                '<button class="btn btn-d btn-round btn-xs" data-del="' + i.id + '"><i class="fa fa-trash"></i> Hapus</button></td>' : "") +
              "</tr>";
          }).join("") + "</tbody></table>" : '<p class="empty-state">Barang tidak ditemukan.</p>');

        $("#item-table [data-edit]").on("click", function () {
          var id = $(this).data("edit");
          itemForm(items.filter(function (i) { return i.id == id; })[0], load);
        });
        $("#item-table [data-del]").on("click", function () {
          var id = $(this).data("del");
          var it = items.filter(function (i) { return i.id == id; })[0];
          confirmBox("Hapus Barang", "Hapus <strong>" + esc(it.code) + " - " + esc(it.name) + "</strong>?", "Hapus").then(function (ok) {
            if (!ok) return;
            api("delete_item", { p_id: it.id }).then(function () { toast("Barang dihapus."); load(); })
              .catch(function (err) { toast(err.message, true); });
          });
        });
      });
    }

    $("#item-search").on("input", debounce(load));
    if (isAdmin()) $("#add-item").on("click", function () { itemForm(null, load); });
    return load();
  }

  function itemForm(item, onDone) {
    var editing = !!item; item = item || {};
    openModal(editing ? "Edit Barang" : "Tambah Barang",
      '<form><div class="row">' +
      '<div class="col-sm-6 form-group"><label class="font-alt">Kode Barang</label><input class="form-control" name="code" required value="' + esc(item.code) + '" placeholder="BR006"></div>' +
      '<div class="col-sm-6 form-group"><label class="font-alt">Nama Barang</label><input class="form-control" name="name" required value="' + esc(item.name) + '"></div>' +
      '<div class="col-sm-6 form-group"><label class="font-alt">Kategori</label><input class="form-control" name="category" value="' + esc(item.category) + '"></div>' +
      '<div class="col-sm-6 form-group"><label class="font-alt">Stok Tersedia</label><input class="form-control" name="stock" type="number" min="0" required value="' + esc(item.stock === undefined ? 0 : item.stock) + '"></div>' +
      '</div><p class="form-error"></p><div class="form-actions">' +
      '<button type="button" class="btn btn-border-d btn-round btn-sm" data-dismiss="modal">Batal</button>' +
      '<button type="submit" class="btn btn-d btn-round btn-sm">Simpan</button></div></form>',
      function (f) {
        var p = { p_code: f.code, p_name: f.name, p_category: f.category, p_stock: parseInt(f.stock, 10) };
        return (editing ? api("update_item", $.extend({ p_id: item.id }, p)) : api("create_item", p)).then(function () {
          toast(editing ? "Barang diperbarui." : "Barang ditambahkan.");
          onDone();
        });
      });
  }

  // ==================================================================
  // Peminjaman
  // ==================================================================
  function loansTable(loans, withReturn) {
    if (!loans.length) return '<p class="empty-state">Belum ada transaksi.</p>';
    return '<table class="table table-striped table-border checkout-table"><thead><tr>' +
      '<th>#</th><th>Peminjam</th><th>Barang</th><th class="num">Jumlah</th><th>Tgl Pinjam</th><th>Tgl Kembali</th><th>Status</th><th>Dicatat oleh</th>' +
      (withReturn ? "<th></th>" : "") + "</tr></thead><tbody>" +
      loans.map(function (l, idx) {
        return "<tr " + rowAnim(idx) + "><td>" + l.id + "</td><td>" + esc(l.borrower_name) + "</td>" +
          "<td>" + esc(l.item_code) + " - " + esc(l.item_name) + '</td><td class="num">' + fmtNum(l.quantity) + "</td>" +
          "<td>" + fmtDate(l.loan_date) + "</td><td>" + fmtDate(l.return_date) + "</td><td>" + statusLabel(l.status) + "</td>" +
          "<td>" + esc(l.created_by_name || "-") +
          (l.returned_by_name ? '<br><span class="hint">Dikembalikan via ' + esc(l.returned_by_name) + "</span>" : "") + "</td>" +
          (withReturn ? '<td class="actions"><button class="btn btn-d btn-round btn-xs" data-return="' + l.id + '"><i class="fa fa-check"></i> Proses Pengembalian</button></td>' : "") +
          "</tr>";
      }).join("") + "</tbody></table>";
  }

  function renderLoans($page) {
    return api("list_items", { p_search: "" }).then(function (items) {
      $page.html(
        '<div class="app-panel wow fadeInUp">' +
        '<h4 class="font-alt">Catat Peminjaman Baru</h4><hr class="divider-w mb-20">' +
        '<form id="loan-form"><div class="row">' +
        '<div class="col-sm-6 col-md-3 form-group"><label class="font-alt">Nama Peminjam</label><input class="form-control" name="borrower" required></div>' +
        '<div class="col-sm-6 col-md-4 form-group"><label class="font-alt">Barang</label><select class="form-control" name="item_id" required>' +
        '<option value="">— Pilih barang —</option>' +
        items.map(function (i) {
          return '<option value="' + i.id + '"' + (i.stock <= 0 ? " disabled" : "") + ">" + esc(i.code) + " - " + esc(i.name) + " (tersedia " + i.stock + ")</option>";
        }).join("") + "</select></div>" +
        '<div class="col-sm-6 col-md-2 form-group"><label class="font-alt">Jumlah</label><input class="form-control" name="quantity" type="number" min="1" value="1" required></div>' +
        '<div class="col-sm-6 col-md-3 form-group"><label class="font-alt">Tanggal Peminjaman</label><input class="form-control" name="loan_date" type="date" value="' + today() + '" required></div>' +
        '</div><p class="form-error"></p><div class="form-actions"><button type="submit" class="btn btn-d btn-round"><i class="fa fa-save"></i> Simpan Transaksi</button></div></form>' +
        "</div>" +
        '<div class="app-panel wow fadeInUp" data-wow-delay=".15s">' +
        '<h4 class="font-alt">Transaksi Peminjaman Terbaru</h4><hr class="divider-w mb-20">' +
        '<div class="table-wrap" id="loan-table"></div></div>');

      var $form = $("#loan-form");
      $form.find("[name=item_id]").on("change", function () {
        var id = $(this).val();
        var it = items.filter(function (i) { return i.id == id; })[0];
        $form.find("[name=quantity]").attr("max", it ? it.stock : null);
      });
      $form.on("submit", function (e) {
        e.preventDefault();
        var f = formData(this);
        var $btn = $form.find('[type="submit"]'), $err = $form.find(".form-error");
        $btn.prop("disabled", true); $err.text("");
        api("create_loan", {
          p_borrower: f.borrower, p_item_id: parseInt(f.item_id, 10),
          p_quantity: parseInt(f.quantity, 10), p_loan_date: f.loan_date
        }).then(function () {
          toast("Transaksi peminjaman disimpan.");
          return renderLoans($page);
        }).catch(function (err) {
          $err.text(err.message); replayAnim($err, "shake");
          $btn.prop("disabled", false);
        });
      });

      return api("list_loans", { p_status: "semua", p_search: "" }).then(function (loans) {
        $("#loan-table").html(loansTable(loans.slice(0, 15), false));
      });
    });
  }

  // ==================================================================
  // Pengembalian
  // ==================================================================
  function renderReturns($page) {
    $page.html(
      '<div class="app-panel wow fadeInUp">' +
      '<div class="panel-tools"><h4 class="font-alt mb-0">Barang yang Sedang Dipinjam</h4>' +
      '<input type="search" class="form-control" id="ret-search" placeholder="Cari peminjam atau barang…"></div>' +
      '<div class="table-wrap" id="ret-table"></div></div>');

    function load() {
      return api("list_loans", { p_status: "dipinjam", p_search: $("#ret-search").val() }).then(function (loans) {
        $("#ret-table").html(loans.length ? loansTable(loans, true) : '<p class="empty-state">Tidak ada barang yang sedang dipinjam.</p>');
        $("#ret-table [data-return]").on("click", function () {
          var id = $(this).data("return");
          var l = loans.filter(function (x) { return x.id == id; })[0];
          confirmBox("Proses Pengembalian",
            "Konfirmasi pengembalian <strong>" + fmtNum(l.quantity) + " " + esc(l.item_name) + "</strong> oleh <strong>" + esc(l.borrower_name) +
            "</strong>? Stok akan diperbarui dan status transaksi menjadi selesai.", "Proses").then(function (ok) {
            if (!ok) return;
            api("return_loan", { p_loan_id: l.id }).then(function () { toast("Pengembalian diproses."); load(); })
              .catch(function (err) { toast(err.message, true); });
          });
        });
      });
    }
    $("#ret-search").on("input", debounce(load));
    return load();
  }

  // ==================================================================
  // Riwayat
  // ==================================================================
  function renderHistory($page) {
    $page.html(
      '<div class="app-panel wow fadeInUp">' +
      '<div class="panel-tools"><div class="tools-left">' +
      '<select class="form-control" id="hist-status" style="max-width:200px"><option value="semua">Semua status</option>' +
      '<option value="dipinjam">Dipinjam</option><option value="selesai">Selesai</option></select>' +
      '<input type="search" class="form-control" id="hist-search" placeholder="Cari peminjam atau barang…"></div>' +
      (isAdmin()
        ? '<button class="btn btn-border-d btn-round" id="clear-history"><i class="fa fa-trash"></i> Hapus Semua Log &amp; Riwayat</button>'
        : '<span class="hint">Menampilkan transaksi yang Anda tangani dan yang masih aktif.</span>') +
      '</div><div class="table-wrap" id="hist-table"></div></div>');

    function load() {
      return api("list_loans", { p_status: $("#hist-status").val(), p_search: $("#hist-search").val() }).then(function (loans) {
        $("#hist-table").html(loansTable(loans, false));
      });
    }
    $("#hist-status").on("change", load);
    $("#hist-search").on("input", debounce(load));
    if (isAdmin()) $("#clear-history").on("click", function () { clearHistoryForm(load); });
    return load();
  }

  function clearHistoryForm(onDone) {
    openModal("Hapus Semua Log & Riwayat",
      "<form>" +
      "<p>Tindakan ini akan menghapus <strong>permanen</strong>:</p>" +
      "<ul><li>semua log aktivitas di Dashboard</li><li>semua transaksi peminjaman, <strong>termasuk yang masih Dipinjam</strong></li></ul>" +
      '<p class="hint">Stok barang yang masih dipinjam akan dikembalikan otomatis, sehingga semua barang kembali tersedia.</p>' +
      '<div class="form-group"><label class="font-alt">Ketik HAPUS untuk konfirmasi</label>' +
      '<input class="form-control" name="confirm" autocomplete="off" required></div>' +
      '<p class="form-error"></p><div class="form-actions">' +
      '<button type="button" class="btn btn-border-d btn-round btn-sm" data-dismiss="modal">Batal</button>' +
      '<button type="submit" class="btn btn-d btn-round btn-sm"><i class="fa fa-trash"></i> Hapus</button></div></form>',
      function (f) {
        if ((f.confirm || "").trim().toUpperCase() !== "HAPUS") {
          return Promise.reject(new Error('Ketik "HAPUS" untuk melanjutkan.'));
        }
        return api("clear_history").then(function (r) {
          toast("Terhapus: " + fmtNum(r.deleted_loans) + " transaksi & " + fmtNum(r.deleted_logs) + " log." +
            (r.restored_units ? " " + fmtNum(r.restored_units) + " unit dikembalikan ke stok." : ""));
          onDone();
        });
      });
  }

  // ==================================================================
  // Pengguna (Admin)
  // ==================================================================
  function renderUsers($page) {
    $page.html(
      '<div class="app-panel wow fadeInUp">' +
      '<div class="panel-tools"><h4 class="font-alt mb-0">Daftar Pengguna</h4>' +
      '<button class="btn btn-d btn-round" id="add-user"><i class="fa fa-user-plus"></i> Tambah Staff</button></div>' +
      '<div class="table-wrap" id="user-table"></div></div>');

    function load() {
      return api("list_users").then(function (users) {
        $("#user-table").html(
          '<table class="table table-striped table-border checkout-table"><thead><tr>' +
          "<th>Username</th><th>Nama Lengkap</th><th>Role</th><th>Status</th><th>Dibuat</th><th></th></tr></thead><tbody>" +
          users.map(function (u, idx) {
            return "<tr " + rowAnim(idx) + "><td><strong>" + esc(u.username) + "</strong></td><td>" + esc(u.full_name) + "</td>" +
              '<td><span class="label label-muted">' + (u.role === "admin" ? "Admin" : "Staff") + "</span></td>" +
              "<td>" + (u.is_active ? '<span class="label label-aktif">Aktif</span>' : '<span class="label label-nonaktif">Nonaktif</span>') + "</td>" +
              "<td>" + fmtDate(u.created_at) + "</td>" +
              '<td class="actions"><button class="btn btn-border-d btn-round btn-xs" data-edit="' + u.id + '"><i class="fa fa-pencil"></i> Edit</button>' +
              (u.role === "staff" ? '<button class="btn ' + (u.is_active ? "btn-d" : "btn-border-d") + ' btn-round btn-xs" data-toggle-active="' + u.id + '">' +
                (u.is_active ? '<i class="fa fa-ban"></i> Nonaktifkan' : '<i class="fa fa-check"></i> Aktifkan') + "</button>" : "") +
              "</td></tr>";
          }).join("") + "</tbody></table>");

        $("#user-table [data-edit]").on("click", function () {
          var id = $(this).data("edit");
          userForm(users.filter(function (u) { return u.id == id; })[0], load);
        });
        $("#user-table [data-toggle-active]").on("click", function () {
          var id = $(this).data("toggle-active");
          var u = users.filter(function (x) { return x.id == id; })[0];
          api("set_user_active", { p_id: u.id, p_active: !u.is_active }).then(function () {
            toast("Akun " + u.username + " " + (u.is_active ? "dinonaktifkan" : "diaktifkan") + ".");
            load();
          }).catch(function (err) { toast(err.message, true); });
        });
      });
    }
    $("#add-user").on("click", function () { userForm(null, load); });
    return load();
  }

  function userForm(user, onDone) {
    var editing = !!user; user = user || {};
    openModal(editing ? "Edit Pengguna" : "Tambah Akun Staff",
      '<form><div class="row">' +
      '<div class="col-sm-6 form-group"><label class="font-alt">Username</label><input class="form-control" name="username" required autocomplete="off" value="' + esc(user.username) + '"></div>' +
      '<div class="col-sm-6 form-group"><label class="font-alt">Nama Lengkap</label><input class="form-control" name="full_name" required value="' + esc(user.full_name) + '"></div>' +
      '<div class="col-sm-12 form-group"><label class="font-alt">Password ' + (editing ? '<span class="hint">(kosongkan jika tidak diubah)</span>' : "") + "</label>" +
      '<input class="form-control" name="password" type="password" minlength="6" autocomplete="new-password"' + (editing ? "" : " required") + "></div>" +
      '</div><p class="form-error"></p><div class="form-actions">' +
      '<button type="button" class="btn btn-border-d btn-round btn-sm" data-dismiss="modal">Batal</button>' +
      '<button type="submit" class="btn btn-d btn-round btn-sm">Simpan</button></div></form>',
      function (f) {
        var p = editing
          ? api("update_user", { p_id: user.id, p_username: f.username, p_full_name: f.full_name, p_password: f.password || null })
          : api("create_staff", { p_username: f.username, p_full_name: f.full_name, p_password: f.password });
        return p.then(function () {
          if (editing && user.id === state.user.id) {
            state.user = $.extend({}, state.user, { username: f.username.trim().toLowerCase(), full_name: f.full_name.trim() });
            saveSession(); renderNav(currentRoute());
          }
          toast(editing ? "Data pengguna diperbarui." : "Akun Staff ditambahkan.");
          onDone();
        });
      });
  }

  // ==================================================================
  // Efek template Titan: background, hero, navbar, scroll-up
  // ==================================================================
  var $navbar = $("#navbar");
  var $hero = $("#login-view");

  $("[data-background]").each(function () {
    $(this).css("background-image", "url(" + $(this).attr("data-background") + ")");
  });

  function buildHomeSection() { $hero.height($(window).height()); }

  function navbarAnimation() {
    if ($navbar.hasClass("menu-open") || $(window).scrollTop() >= $navbar.height()) $navbar.removeClass("navbar-transparent");
    else $navbar.addClass("navbar-transparent");
  }

  function effectsHomeSection() {
    if (currentView !== "login") return;
    var top = $(window).scrollTop(), h = $hero.height();
    if (top <= h) {
      $hero.css("top", top * 0.55);                          // parallax
      $hero.find(".caption-content").css("opacity", 1 - top / h); // fade
    }
  }

  // Navbar tidak transparan selama menu lipat (mobile/tablet) terbuka
  $("#custom-collapse")
    .on("show.bs.collapse", function () { $navbar.addClass("menu-open").removeClass("navbar-transparent"); })
    .on("hidden.bs.collapse", function () { $navbar.removeClass("menu-open"); navbarAnimation(); });

  $(window).on("resize", buildHomeSection);
  $(window).on("scroll", function () {
    effectsHomeSection();
    navbarAnimation();
    if ($(this).scrollTop() > 100) $(".scroll-up").fadeIn(); else $(".scroll-up").fadeOut();
  });
  $('a[href="#totop"]').on("click", function () { $("html, body").animate({ scrollTop: 0 }, "slow"); return false; });

  // Text rotator Titan
  $(".rotate").textrotator({ animation: "dissolve", separator: "|", speed: 3000 });

  // Animasi WOW (live: elemen baru ikut teranimasi saat dirender)
  new WOW({ mobile: true, live: true }).init();

  $("#year").text(new Date().getFullYear());

  // Tabel jadi kartu bertumpuk di HP: setiap sel diberi label dari judul kolomnya
  function labelTables(root) {
    $(root).find("table.checkout-table").each(function () {
      var heads = $(this).find("thead th").map(function () { return $(this).text(); }).get();
      $(this).find("tbody tr").each(function () {
        $(this).children("td").each(function (i) { if (heads[i]) this.setAttribute("data-label", heads[i]); });
      });
    });
  }
  new MutationObserver(function () { labelTables(document.getElementById("page")); })
    .observe(document.getElementById("page"), { childList: true, subtree: true });

  // ==================================================================
  // Event global
  // ==================================================================
  $("#login-form").on("submit", function (e) {
    e.preventDefault();
    var f = formData(this), form = this;
    var $btn = $(form).find("button"), $err = $("#login-error");
    $btn.prop("disabled", true).html('<i class="fa fa-circle-o-notch fa-spin"></i>'); $err.text("");
    rpc("login", { p_username: f.username, p_password: f.password }).then(function (res) {
      state.token = res.token; state.user = res.user;
      saveSession(); form.reset();
      if (location.hash !== "#/dashboard") location.hash = "#/dashboard"; else render();
    }).catch(function (err) {
      $err.text(err.message);
      replayAnim($(form), "shake");
    }).then(function () { $btn.prop("disabled", false).text("Masuk"); });
  });

  $(document).on("click", "#logout-btn", function () {
    var token = state.token;
    rpc("logout", { p_token: token }).catch(function () {});
    clearSession();
    history.replaceState(null, "", location.pathname);
    render();
  });

  $(document).on("click", "#nav-menu a[href^='#/']", function () { $("#custom-collapse").collapse("hide"); });
  $(window).on("hashchange", render);

  // ==================================================================
  // Start: preloader Titan hilang setelah halaman & sesi siap
  // ==================================================================
  if (!SUPABASE_URL || SUPABASE_URL.indexOf("XXXXXXXX") >= 0) {
    $(".page-loader").hide();
    $("body").html('<p style="padding:24px">Konfigurasi Supabase belum diisi. Edit file <code>config.js</code>.</p>');
    return;
  }

  var pageLoaded = new Promise(function (res) {
    if (document.readyState === "complete") res(); else $(window).on("load", res);
  });

  loadSession();
  var ready = state.token
    ? rpc("me", { p_token: state.token }).then(function (u) { state.user = u; saveSession(); })
        .catch(function () { clearSession(); })
    : Promise.resolve();

  ready.then(render).then(function () { return pageLoaded; }).then(function () {
    $(".loader").fadeOut();
    $(".page-loader").delay(350).fadeOut("slow");
  });
})(jQuery);
