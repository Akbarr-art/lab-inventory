-- =====================================================================
-- Laboratory Inventory & Borrowing Management System
-- Skema database Supabase (PostgreSQL)
--
-- Cara pakai: buka Supabase Dashboard > SQL Editor > New query,
-- tempel seluruh isi file ini, lalu klik "Run".
--
-- Desain keamanan:
--   * Login memakai username + password (bukan email), password di-hash
--     dengan bcrypt (pgcrypto).
--   * Semua tabel dikunci dengan Row Level Security TANPA policy, sehingga
--     kunci "anon" tidak bisa membaca/menulis tabel secara langsung.
--   * Semua akses data lewat fungsi RPC (SECURITY DEFINER) yang memeriksa
--     token sesi dan role (admin / staff) di sisi server.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- Bersihkan objek lama (agar file ini aman dijalankan ulang)
-- ---------------------------------------------------------------------
drop table if exists public.activity_logs cascade;
drop table if exists public.loans cascade;
drop table if exists public.items cascade;
drop table if exists public.sessions cascade;
drop table if exists public.users cascade;

-- ---------------------------------------------------------------------
-- Tabel
-- ---------------------------------------------------------------------
create table public.users (
  id            bigint generated always as identity primary key,
  username      text not null unique,
  password_hash text not null,
  full_name     text not null,
  role          text not null check (role in ('admin', 'staff')),
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);

create table public.sessions (
  token      uuid primary key default gen_random_uuid(),
  user_id    bigint not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days'
);

create table public.items (
  id         bigint generated always as identity primary key,
  code       text not null unique,
  name       text not null,
  category   text,
  stock      integer not null default 0 check (stock >= 0), -- stok tersedia
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.loans (
  id            bigint generated always as identity primary key,
  borrower_name text not null,
  item_id       bigint not null references public.items(id) on delete restrict,
  quantity      integer not null check (quantity > 0),
  loan_date     date not null,
  return_date   date,
  status        text not null default 'dipinjam' check (status in ('dipinjam', 'selesai')),
  created_by    bigint references public.users(id) on delete set null,
  returned_by   bigint references public.users(id) on delete set null,
  created_at    timestamptz not null default now()
);

create table public.activity_logs (
  id          bigint generated always as identity primary key,
  user_id     bigint references public.users(id) on delete set null,
  action      text not null,
  description text not null,
  created_at  timestamptz not null default now()
);

create index on public.loans (status);
create index on public.loans (item_id);
create index on public.activity_logs (created_at desc);

-- Kunci semua tabel: RLS aktif tanpa policy = tidak bisa diakses langsung
alter table public.users         enable row level security;
alter table public.sessions      enable row level security;
alter table public.items         enable row level security;
alter table public.loans         enable row level security;
alter table public.activity_logs enable row level security;

revoke all on public.users, public.sessions, public.items, public.loans, public.activity_logs
  from anon, authenticated;

-- ---------------------------------------------------------------------
-- Helper internal
-- ---------------------------------------------------------------------

-- Validasi token sesi + role. Mengembalikan baris user atau error.
create or replace function public._auth(p_token uuid, p_roles text[] default array['admin','staff'])
returns public.users
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_user public.users;
begin
  select u.* into v_user
  from public.sessions s
  join public.users u on u.id = s.user_id
  where s.token = p_token and s.expires_at > now();

  if v_user.id is null then
    raise exception 'Sesi tidak valid atau sudah berakhir. Silakan login ulang.' using errcode = 'P0001';
  end if;
  if not v_user.is_active then
    raise exception 'Akun Anda dinonaktifkan.' using errcode = 'P0001';
  end if;
  if not (v_user.role = any(p_roles)) then
    raise exception 'Akses ditolak: fitur ini hanya untuk %.', array_to_string(p_roles, '/') using errcode = 'P0001';
  end if;
  return v_user;
end;
$$;

create or replace function public._log(p_user_id bigint, p_action text, p_desc text)
returns void
language sql security definer
set search_path = public
as $$
  insert into public.activity_logs (user_id, action, description) values (p_user_id, p_action, p_desc);
$$;

-- ---------------------------------------------------------------------
-- Autentikasi
-- ---------------------------------------------------------------------
create or replace function public.login(p_username text, p_password text)
returns json
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_user  public.users;
  v_token uuid;
begin
  select * into v_user from public.users where lower(username) = lower(trim(p_username));

  if v_user.id is null or v_user.password_hash <> crypt(p_password, v_user.password_hash) then
    raise exception 'Username atau password salah.' using errcode = 'P0001';
  end if;
  if not v_user.is_active then
    raise exception 'Akun Anda dinonaktifkan. Hubungi Admin.' using errcode = 'P0001';
  end if;

  delete from public.sessions where expires_at < now();
  insert into public.sessions (user_id) values (v_user.id) returning token into v_token;
  perform public._log(v_user.id, 'login', v_user.full_name || ' login');

  return json_build_object(
    'token', v_token,
    'user', json_build_object('id', v_user.id, 'username', v_user.username,
                              'full_name', v_user.full_name, 'role', v_user.role)
  );
end;
$$;

create or replace function public.logout(p_token uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_uid bigint;
begin
  delete from public.sessions where token = p_token returning user_id into v_uid;
  if v_uid is not null then
    perform public._log(v_uid, 'logout', (select full_name from public.users where id = v_uid) || ' logout');
  end if;
end;
$$;

create or replace function public.me(p_token uuid)
returns json
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_user public.users := public._auth(p_token);
begin
  return json_build_object('id', v_user.id, 'username', v_user.username,
                           'full_name', v_user.full_name, 'role', v_user.role);
end;
$$;

-- ---------------------------------------------------------------------
-- Dashboard
-- ---------------------------------------------------------------------
create or replace function public.get_dashboard(p_token uuid)
returns json
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_user      public.users := public._auth(p_token);
  v_available integer;
  v_borrowed  integer;
begin
  select coalesce(sum(stock), 0) into v_available from public.items;
  select coalesce(sum(quantity), 0) into v_borrowed from public.loans where status = 'dipinjam';

  return json_build_object(
    'item_types',         (select count(*) from public.items),
    'total_units',        v_available + v_borrowed,
    'available_units',    v_available,
    'borrowed_units',     v_borrowed,
    'total_transactions', (select count(*) from public.loans),
    'active_transactions',(select count(*) from public.loans where status = 'dipinjam'),
    'recent_activities',  coalesce((
      select json_agg(r) from (
        select a.action, a.description, a.created_at, u.full_name as user_name
        from public.activity_logs a
        left join public.users u on u.id = a.user_id
        where a.action not in ('login', 'logout')
        order by a.created_at desc
        limit 8
      ) r), '[]'::json)
  );
end;
$$;

-- ---------------------------------------------------------------------
-- Barang
-- ---------------------------------------------------------------------
create or replace function public.list_items(p_token uuid, p_search text default '')
returns json
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_user public.users := public._auth(p_token);
  v_q    text := '%' || coalesce(trim(p_search), '') || '%';
begin
  return coalesce((
    select json_agg(r order by r.code) from (
      select i.id, i.code, i.name, i.category, i.stock,
             coalesce((select sum(l.quantity) from public.loans l
                       where l.item_id = i.id and l.status = 'dipinjam'), 0) as borrowed
      from public.items i
      where i.code ilike v_q or i.name ilike v_q or coalesce(i.category, '') ilike v_q
    ) r), '[]'::json);
end;
$$;

create or replace function public.create_item(p_token uuid, p_code text, p_name text, p_category text, p_stock integer)
returns void
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_user public.users := public._auth(p_token, array['admin']);
begin
  if coalesce(trim(p_code), '') = '' or coalesce(trim(p_name), '') = '' then
    raise exception 'Kode dan nama barang wajib diisi.' using errcode = 'P0001';
  end if;
  if p_stock is null or p_stock < 0 then
    raise exception 'Stok tidak boleh negatif.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.items where lower(code) = lower(trim(p_code))) then
    raise exception 'Kode barang % sudah digunakan.', trim(p_code) using errcode = 'P0001';
  end if;

  insert into public.items (code, name, category, stock)
  values (upper(trim(p_code)), trim(p_name), nullif(trim(p_category), ''), p_stock);

  perform public._log(v_user.id, 'tambah_barang',
    'Menambah barang ' || upper(trim(p_code)) || ' - ' || trim(p_name) || ' (stok ' || p_stock || ')');
end;
$$;

create or replace function public.update_item(p_token uuid, p_id bigint, p_code text, p_name text, p_category text, p_stock integer)
returns void
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_user public.users := public._auth(p_token, array['admin']);
begin
  if coalesce(trim(p_code), '') = '' or coalesce(trim(p_name), '') = '' then
    raise exception 'Kode dan nama barang wajib diisi.' using errcode = 'P0001';
  end if;
  if p_stock is null or p_stock < 0 then
    raise exception 'Stok tidak boleh negatif.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.items where lower(code) = lower(trim(p_code)) and id <> p_id) then
    raise exception 'Kode barang % sudah digunakan.', trim(p_code) using errcode = 'P0001';
  end if;

  update public.items
     set code = upper(trim(p_code)), name = trim(p_name),
         category = nullif(trim(p_category), ''), stock = p_stock, updated_at = now()
   where id = p_id;
  if not found then
    raise exception 'Barang tidak ditemukan.' using errcode = 'P0001';
  end if;

  perform public._log(v_user.id, 'ubah_barang', 'Mengubah barang ' || upper(trim(p_code)) || ' - ' || trim(p_name));
end;
$$;

create or replace function public.delete_item(p_token uuid, p_id bigint)
returns void
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_user public.users := public._auth(p_token, array['admin']);
  v_item public.items;
begin
  select * into v_item from public.items where id = p_id;
  if v_item.id is null then
    raise exception 'Barang tidak ditemukan.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.loans where item_id = p_id and status = 'dipinjam') then
    raise exception 'Barang masih dipinjam, tidak bisa dihapus.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.loans where item_id = p_id) then
    raise exception 'Barang sudah memiliki riwayat transaksi, tidak bisa dihapus.' using errcode = 'P0001';
  end if;

  delete from public.items where id = p_id;
  perform public._log(v_user.id, 'hapus_barang', 'Menghapus barang ' || v_item.code || ' - ' || v_item.name);
end;
$$;

-- ---------------------------------------------------------------------
-- Peminjaman & Pengembalian
-- ---------------------------------------------------------------------
-- p_status: 'semua' | 'dipinjam' | 'selesai'
-- Admin melihat seluruh transaksi. Staff melihat transaksi yang relevan:
-- yang dicatat/diproses olehnya, ditambah semua yang masih "dipinjam"
-- (agar Staff tetap bisa memproses pengembalian).
create or replace function public.list_loans(p_token uuid, p_status text default 'semua', p_search text default '')
returns json
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_user public.users := public._auth(p_token);
  v_q    text := '%' || coalesce(trim(p_search), '') || '%';
begin
  return coalesce((
    select json_agg(r order by r.created_at desc) from (
      select l.id, l.borrower_name, l.quantity, l.loan_date, l.return_date, l.status, l.created_at,
             i.code as item_code, i.name as item_name,
             cu.full_name as created_by_name, ru.full_name as returned_by_name
      from public.loans l
      join public.items i on i.id = l.item_id
      left join public.users cu on cu.id = l.created_by
      left join public.users ru on ru.id = l.returned_by
      where (p_status = 'semua' or l.status = p_status)
        and (l.borrower_name ilike v_q or i.name ilike v_q or i.code ilike v_q)
        and (v_user.role = 'admin'
             or l.status = 'dipinjam'
             or l.created_by = v_user.id
             or l.returned_by = v_user.id)
    ) r), '[]'::json);
end;
$$;

create or replace function public.create_loan(p_token uuid, p_borrower text, p_item_id bigint, p_quantity integer, p_loan_date date)
returns void
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_user public.users := public._auth(p_token);
  v_item public.items;
begin
  if coalesce(trim(p_borrower), '') = '' then
    raise exception 'Nama peminjam wajib diisi.' using errcode = 'P0001';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Jumlah barang harus lebih dari 0.' using errcode = 'P0001';
  end if;
  if p_loan_date is null then
    raise exception 'Tanggal peminjaman wajib diisi.' using errcode = 'P0001';
  end if;

  select * into v_item from public.items where id = p_item_id for update;
  if v_item.id is null then
    raise exception 'Barang tidak ditemukan.' using errcode = 'P0001';
  end if;
  if v_item.stock < p_quantity then
    raise exception 'Stok % tidak cukup (tersedia %).', v_item.name, v_item.stock using errcode = 'P0001';
  end if;

  update public.items set stock = stock - p_quantity, updated_at = now() where id = p_item_id;
  insert into public.loans (borrower_name, item_id, quantity, loan_date, created_by)
  values (trim(p_borrower), p_item_id, p_quantity, p_loan_date, v_user.id);

  perform public._log(v_user.id, 'peminjaman',
    trim(p_borrower) || ' meminjam ' || p_quantity || ' ' || v_item.name);
end;
$$;

create or replace function public.return_loan(p_token uuid, p_loan_id bigint)
returns void
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_user public.users := public._auth(p_token);
  v_loan public.loans;
  v_name text;
begin
  select * into v_loan from public.loans where id = p_loan_id for update;
  if v_loan.id is null then
    raise exception 'Transaksi tidak ditemukan.' using errcode = 'P0001';
  end if;
  if v_loan.status = 'selesai' then
    raise exception 'Transaksi ini sudah selesai.' using errcode = 'P0001';
  end if;

  update public.items set stock = stock + v_loan.quantity, updated_at = now()
   where id = v_loan.item_id returning name into v_name;
  update public.loans
     set status = 'selesai', return_date = current_date, returned_by = v_user.id
   where id = p_loan_id;

  perform public._log(v_user.id, 'pengembalian',
    v_loan.borrower_name || ' mengembalikan ' || v_loan.quantity || ' ' || v_name);
end;
$$;

-- ---------------------------------------------------------------------
-- Manajemen Pengguna (Admin)
-- ---------------------------------------------------------------------
create or replace function public.list_users(p_token uuid)
returns json
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_user public.users := public._auth(p_token, array['admin']);
begin
  return coalesce((
    select json_agg(r order by r.role, r.username) from (
      select id, username, full_name, role, is_active, created_at from public.users
    ) r), '[]'::json);
end;
$$;

create or replace function public.create_staff(p_token uuid, p_username text, p_full_name text, p_password text)
returns void
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_user public.users := public._auth(p_token, array['admin']);
begin
  if coalesce(trim(p_username), '') = '' or coalesce(trim(p_full_name), '') = '' then
    raise exception 'Username dan nama lengkap wajib diisi.' using errcode = 'P0001';
  end if;
  if length(coalesce(p_password, '')) < 6 then
    raise exception 'Password minimal 6 karakter.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.users where lower(username) = lower(trim(p_username))) then
    raise exception 'Username % sudah digunakan.', trim(p_username) using errcode = 'P0001';
  end if;

  insert into public.users (username, password_hash, full_name, role)
  values (lower(trim(p_username)), crypt(p_password, gen_salt('bf')), trim(p_full_name), 'staff');

  perform public._log(v_user.id, 'tambah_pengguna', 'Menambah akun Staff ' || lower(trim(p_username)));
end;
$$;

-- p_password kosong = password tidak diubah
create or replace function public.update_user(p_token uuid, p_id bigint, p_username text, p_full_name text, p_password text default null)
returns void
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_user public.users := public._auth(p_token, array['admin']);
begin
  if coalesce(trim(p_username), '') = '' or coalesce(trim(p_full_name), '') = '' then
    raise exception 'Username dan nama lengkap wajib diisi.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.users where lower(username) = lower(trim(p_username)) and id <> p_id) then
    raise exception 'Username % sudah digunakan.', trim(p_username) using errcode = 'P0001';
  end if;
  if coalesce(p_password, '') <> '' and length(p_password) < 6 then
    raise exception 'Password minimal 6 karakter.' using errcode = 'P0001';
  end if;

  update public.users
     set username = lower(trim(p_username)),
         full_name = trim(p_full_name),
         password_hash = case when coalesce(p_password, '') = '' then password_hash
                              else crypt(p_password, gen_salt('bf')) end
   where id = p_id;
  if not found then
    raise exception 'Pengguna tidak ditemukan.' using errcode = 'P0001';
  end if;

  perform public._log(v_user.id, 'ubah_pengguna', 'Mengubah data pengguna ' || lower(trim(p_username)));
end;
$$;

create or replace function public.set_user_active(p_token uuid, p_id bigint, p_active boolean)
returns void
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_user   public.users := public._auth(p_token, array['admin']);
  v_target public.users;
begin
  select * into v_target from public.users where id = p_id;
  if v_target.id is null then
    raise exception 'Pengguna tidak ditemukan.' using errcode = 'P0001';
  end if;
  if v_target.role <> 'staff' then
    raise exception 'Hanya akun Staff yang bisa diaktifkan/dinonaktifkan.' using errcode = 'P0001';
  end if;

  update public.users set is_active = p_active where id = p_id;
  if not p_active then
    delete from public.sessions where user_id = p_id; -- paksa logout
  end if;

  perform public._log(v_user.id, 'status_pengguna',
    (case when p_active then 'Mengaktifkan' else 'Menonaktifkan' end) || ' akun Staff ' || v_target.username);
end;
$$;

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

-- ---------------------------------------------------------------------
-- Hak eksekusi: hanya fungsi publik yang boleh dipanggil dari aplikasi
-- ---------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function
  public.login(text, text),
  public.logout(uuid),
  public.me(uuid),
  public.get_dashboard(uuid),
  public.list_items(uuid, text),
  public.create_item(uuid, text, text, text, integer),
  public.update_item(uuid, bigint, text, text, text, integer),
  public.delete_item(uuid, bigint),
  public.list_loans(uuid, text, text),
  public.create_loan(uuid, text, bigint, integer, date),
  public.return_loan(uuid, bigint),
  public.list_users(uuid),
  public.create_staff(uuid, text, text, text),
  public.update_user(uuid, bigint, text, text, text),
  public.set_user_active(uuid, bigint, boolean),
  public.clear_history(uuid)
to anon, authenticated;

-- ---------------------------------------------------------------------
-- Data awal
-- ---------------------------------------------------------------------
-- Akun demo: 1 Admin + 1 Staff
insert into public.users (username, password_hash, full_name, role) values
  ('admin', extensions.crypt('admin123', extensions.gen_salt('bf')), 'Administrator', 'admin'),
  ('staff', extensions.crypt('staff123', extensions.gen_salt('bf')), 'Staff Laboratorium', 'staff');

-- Data awal barang sesuai dokumen (kategori tidak tercantum di dokumen,
-- jadi dibiarkan kosong; bisa diisi Admin lewat menu Edit Barang)
insert into public.items (code, name, stock) values
  ('BR001', 'Laptop Lenovo', 5),
  ('BR002', 'Mouse Logitech', 10),
  ('BR003', 'Keyboard Mechanical', 8),
  ('BR004', 'Proyektor Epson', 3),
  ('BR005', 'Monitor LG', 6);
