-- =====================================================================
-- UPDATE: fitur "Hapus Semua Log & Riwayat"
-- Jalankan file INI SAJA di Supabase > SQL Editor (bukan schema.sql lagi,
-- karena schema.sql akan menghapus dan membuat ulang semua data).
-- Aman dijalankan lebih dari sekali; tidak mengubah data yang sudah ada.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Hapus semua log & riwayat (Admin)
-- Menghapus seluruh log aktivitas dan SEMUA transaksi (termasuk yang masih
-- "dipinjam"). Sebelum dihapus, stok barang yang sedang dipinjam
-- dikembalikan dulu, sehingga semua barang kembali tersedia.
-- ---------------------------------------------------------------------
create or replace function public.clear_history(p_token uuid)
returns json
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_user     public.users := public._auth(p_token, array['admin']);
  v_logs     integer;
  v_loans    integer;
  v_active   integer;
  v_restored integer;
begin
  -- Kunci tabel agar tidak ada peminjaman baru di tengah proses
  lock table public.loans in exclusive mode;

  select count(*), coalesce(sum(quantity), 0) into v_active, v_restored
  from public.loans where status = 'dipinjam';

  -- Kembalikan stok barang yang masih dipinjam
  update public.items i
     set stock = i.stock + a.qty, updated_at = now()
    from (select item_id, sum(quantity) as qty
            from public.loans where status = 'dipinjam'
           group by item_id) a
   where i.id = a.item_id;

  delete from public.loans where true;
  get diagnostics v_loans = row_count;

  delete from public.activity_logs where true;
  get diagnostics v_logs = row_count;

  perform public._log(v_user.id, 'hapus_riwayat',
    'Menghapus semua log & riwayat (' || v_loans || ' transaksi, ' || v_logs || ' log'
    || case when v_restored > 0 then ', ' || v_restored || ' unit dikembalikan ke stok' else '' end || ')');

  return json_build_object('deleted_logs', v_logs, 'deleted_loans', v_loans,
                           'active_loans', v_active, 'restored_units', v_restored);
end;
$$;

revoke execute on function public.clear_history(uuid) from public, anon, authenticated;
grant execute on function public.clear_history(uuid) to anon, authenticated;
