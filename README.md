# Laboratory Inventory & Borrowing Management System

Aplikasi web untuk mengelola inventaris dan transaksi peminjaman barang laboratorium komputer.

**Teknologi:** HTML, CSS, JavaScript + jQuery · Template **Titan** (Bootstrap 3, animate.css, WOW.js, Simple Text Rotator, Font Awesome, ET-Line icons) · Supabase (PostgreSQL + REST RPC) · Hosting Vercel/Netlify

## Akun Demo

| Role  | Username | Password   |
|-------|----------|------------|
| Admin | `admin`  | `admin123` |
| Staff | `staff`  | `staff123` |

## Data Awal Barang

| Kode  | Nama Barang         | Stok |
|-------|---------------------|------|
| BR001 | Laptop Lenovo       | 5    |
| BR002 | Mouse Logitech      | 10   |
| BR003 | Keyboard Mechanical | 8    |
| BR004 | Proyektor Epson     | 3    |
| BR005 | Monitor LG          | 6    |

Dokumen soal tidak mencantumkan kategori untuk data awal, jadi kolom kategori dibiarkan kosong dan bisa diisi Admin lewat **Edit Barang**.

## Struktur File

```
index.html               Halaman utama (login + aplikasi), markup template Titan
app.js                   Logika aplikasi (routing, halaman, animasi, pemanggilan API)
config.js                URL & anon key Supabase
assets/css/style.css     Stylesheet asli template Titan
assets/css/app.css       Penyesuaian tampilan untuk aplikasi
assets/js/plugins.js     Plugin Titan (jQuery appear & countTo)
assets/lib/              Library dari template Titan
assets/images/bg/        Gambar latar header (diambil dari template)
supabase/schema.sql      Tabel, fungsi RPC, keamanan, dan data awal (untuk project baru)
supabase/update_hapus_riwayat.sql  Update fitur hapus log & riwayat (untuk database yang sudah berjalan)
```

## Animasi dari Template Titan

- Preloader (spinner) saat halaman dibuka
- Hero login layar penuh dengan efek parallax + fade saat di-scroll
- Text rotator ("Inventaris Barang | Peminjaman Barang | Pengembalian Barang")
- Navbar transparan yang berubah gelap saat di-scroll
- Animasi WOW.js / animate.css (fadeInUp, fadeInDown) pada setiap konten halaman
- Counter angka naik pada statistik dashboard
- Progress bar ketersediaan stok per barang
- Baris tabel muncul bertahap, modal & notifikasi beranimasi, tombol scroll-to-top

Gambar latar bawaan template adalah placeholder yang sudah diblur; label ukurannya sudah disamarkan.
Ganti file di `assets/images/bg/` dengan foto sendiri bila ingin (nama file tetap sama).

## Cara Menjalankan

### 1. Siapkan database di Supabase
1. Daftar/login di https://supabase.com, klik **New project**, isi nama project & password database, pilih region **Southeast Asia (Singapore)**, tunggu sampai project siap.
2. Menu kiri **SQL Editor** → **New query** → tempel seluruh isi `supabase/schema.sql` → klik **Run**. Harus muncul "Success".
3. Cek di **Table Editor**: ada tabel `items` berisi 5 barang dan `users` berisi `admin` & `staff`.
4. Buka **Project Settings → API Keys**, salin:
   - **Publishable key** (`sb_publishable_...`). Kalau project kamu hanya punya kunci lama, pakai `anon` key dari tab **Legacy API Keys**.
   - **Project URL** (di **Project Settings → Data API**, bentuknya `https://xxxx.supabase.co`).
   Jangan pakai secret key / service_role.
5. Buka `config.js`, isi `SUPABASE_URL` dan `SUPABASE_ANON_KEY` dengan dua nilai tadi, simpan.

### 2. Jalankan di komputer (localhost)
Aplikasi harus dibuka lewat server lokal, **jangan** dobel-klik `index.html`. Pilih salah satu, dari dalam folder project:
- VS Code: pasang ekstensi **Live Server** → klik kanan `index.html` → **Open with Live Server**.
- Node.js: `npx serve .` lalu buka alamat yang muncul (biasanya http://localhost:3000).
- Python: `python -m http.server 8000` lalu buka http://localhost:8000.

Login dengan `admin` / `admin123` atau `staff` / `staff123`.

### 3. Online (URL publik untuk dosen)
1. Upload folder project ke repository GitHub baru (isi folder, termasuk `config.js`).
2. **Vercel:** vercel.com → login pakai GitHub → **Add New → Project** → pilih repo → Framework Preset **Other**, build command dikosongkan → **Deploy**.
   **Netlify (alternatif):** app.netlify.com → **Add new site → Import an existing project** → pilih repo → build command kosong, publish directory `.` → **Deploy**.
3. Buka URL yang diberikan (mis. `https://nama-project.vercel.app`), tes login Admin & Staff, lalu tes juga dari HP.

### Kalau ada masalah
- Muncul tulisan "Konfigurasi Supabase belum diisi" → `config.js` belum diisi/tersimpan.
- Login gagal "Invalid API key" / error 401 → kunci salah salin; ulangi langkah 1.4.
- "Could not find the function ..." → `schema.sql` belum dijalankan di project yang sama dengan URL di `config.js`.
- Project Supabase gratis akan di-pause bila tidak dipakai sekitar seminggu; buka dashboard Supabase dan klik **Restore** sebelum penilaian.

## Fitur & Hak Akses

| Fitur                                   | Admin | Staff |
|-----------------------------------------|:-----:|:-----:|
| Login / logout                          | ✓ | ✓ |
| Dashboard (total, tersedia, dipinjam, transaksi, aktivitas terbaru) | ✓ | ✓ |
| Lihat daftar & status ketersediaan barang, pencarian | ✓ | ✓ |
| Tambah / edit / hapus barang            | ✓ | ✗ |
| Catat peminjaman                        | ✓ | ✓ |
| Proses pengembalian (stok diperbarui, status → selesai) | ✓ | ✓ |
| Riwayat transaksi                       | Semua | Yang relevan* |
| Kelola pengguna (tambah Staff, edit, aktif/nonaktif) | ✓ | ✗ |
| Hapus semua log & riwayat (stok barang yang dipinjam dikembalikan otomatis) | ✓ | ✗ |

\* Staff melihat transaksi yang ia catat/proses, ditambah semua transaksi yang masih dipinjam (agar bisa memproses pengembalian).

## Keamanan

- Login memakai username + password; password disimpan sebagai hash bcrypt (`pgcrypto`).
- Semua tabel memakai Row Level Security tanpa policy, jadi anon key **tidak bisa** membaca atau menulis tabel secara langsung.
- Semua operasi berjalan lewat fungsi RPC `SECURITY DEFINER` yang memeriksa token sesi dan role di sisi server. Staff yang mencoba memanggil fungsi Admin akan ditolak oleh database, bukan hanya disembunyikan di tampilan.
- Barang yang masih dipinjam atau sudah punya riwayat transaksi tidak bisa dihapus.
- Akun Staff yang dinonaktifkan langsung ter-logout dan tidak bisa login.
