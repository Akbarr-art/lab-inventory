// Isi dengan data dari Supabase Dashboard > Project Settings > API Keys.
// SUPABASE_ANON_KEY boleh diisi salah satu:
//   - Publishable key (diawali "sb_publishable_")  <- disarankan, format baru
//   - anon key lama (diawali "eyJ"), dari tab "Legacy API Keys"
// JANGAN pakai secret key / service_role key di sini.
// Kunci ini aman ditaruh di frontend karena seluruh tabel dikunci;
// aplikasi hanya bisa memanggil fungsi RPC yang memeriksa login & role.
window.APP_CONFIG = {
  SUPABASE_URL: "https://qfuebdkzxvnbstbbemrb.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_hQag_NbWhtoXtNTCtg-Y7A_nClcenF7",
};
