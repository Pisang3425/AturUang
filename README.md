# AturUang

Aplikasi web keuangan pribadi berbahasa Indonesia. Dibuat dengan React, TypeScript, Vite, dan Supabase; tidak menghubungkan rekening bank.

## Jalankan lokal

```powershell
npm.cmd install
npm.cmd run dev
```

Tanpa konfigurasi Supabase, aplikasi berjalan dalam **mode lokal** dan menyimpan data di penyimpanan browser perangkat tersebut. Mode ini bukan sinkronisasi atau cadangan; gunakan ekspor JSON secara berkala. Jangan gunakan mode lokal untuk data bersama di komputer umum.

## Aktifkan Supabase

1. Buat proyek Supabase dan salin `.env.example` menjadi `.env.local`.
2. Isi `VITE_SUPABASE_URL` dan `VITE_SUPABASE_ANON_KEY` dengan URL proyek dan **publishable/anon key**. Jangan pernah memasukkan `service_role` atau secret key ke variabel `VITE_` atau browser.
3. Jalankan kedua file SQL secara berurutan lewat SQL Editor Supabase: `supabase/migrations/202610100001_initial_schema.sql`, lalu `supabase/migrations/202610100002_goals_recurring_preferences.sql`.
4. Di **Authentication → Providers → Email**, aktifkan pendaftaran email/kata sandi dan konfirmasi email. Aplikasi tidak menyediakan pendaftaran sosial.
5. Setelah URL hosting tersedia, atur **Authentication → URL Configuration → Site URL** ke alamat produksi dan tambahkan alamat tersebut ke **Redirect URLs**; untuk localhost tambahkan `http://localhost:5173/**` selama pengembangan.
6. Email bawaan Supabase dibatasi untuk pengujian (saat ini 2 email per jam). Untuk membagikan pendaftaran dengan teman, konfigurasikan SMTP email sendiri di Authentication → SMTP Settings agar konfirmasi dapat terkirim secara andal.
7. Jalankan ulang `npm.cmd run dev`, atau buat distribusi produksi dengan `npm.cmd run build`.

### Aktifkan AI (opsional)

AI nonaktif secara default dan aplikasi tetap berfungsi tanpa AI. Untuk mengaktifkannya:

1. Pastikan kedua migrasi database di atas sudah diterapkan.
2. Buat API key melalui [Google AI Studio](https://aistudio.google.com/app/apikey).
3. Pasang [Supabase CLI](https://supabase.com/docs/guides/cli), login, dan tautkan folder proyek ini ke proyek Supabase milikmu:

   ```powershell
   supabase login
   supabase link --project-ref PROJECT_REF_MILIKMU
   ```

4. Simpan API key Gemini sebagai secret server (ganti `API_KEY_GEMINI_MILIKMU` dengan key sendiri), lalu deploy Edge Function:

   ```powershell
   supabase secrets set GEMINI_API_KEY=API_KEY_GEMINI_MILIKMU
   supabase functions deploy financial-insight
   ```

   Model opsional dapat diatur dengan secret `GEMINI_MODEL`; default-nya `gemini-2.5-flash`. Jangan masukkan API key ke `.env`, variabel `VITE_`, atau kode browser.
5. Login ke aplikasi, buka Pengaturan, lalu aktifkan pemrosesan AI setelah membaca persetujuan. Pertanyaan dan agregat bulanan dikirim saat bertanya; deskripsi transaksi dan daftar kategori dikirim hanya ketika meminta saran kategori. Catatan pribadi dan nama akun tidak dikirim. Saran kategori tidak diterapkan sebelum diterima pengguna.

Edge Function memverifikasi sesi dan persetujuan profil, lalu mengirim permintaan ke Gemini dari server Supabase. AI opsional tetap bergantung pada ketersediaan, harga, kebijakan retensi, dan kuota Google AI yang berlaku untuk akunmu.

Pendaftaran publik berarti siapa pun dapat membuat akun, tetapi RLS membatasi akun agar hanya dapat membaca dan mengubah baris miliknya sendiri. Jangan menonaktifkan RLS. Lakukan pengujian isolasi akun menggunakan dua pengguna sebelum menyimpan data sungguhan.

## Hosting gratis

Untuk versi statis React ini, pilihan gratis paling sederhana adalah **Cloudflare Pages** untuk frontend dan **Supabase Free** untuk autentikasi/database:

1. Dorong proyek ini ke repository GitHub atau GitLab milikmu; jangan masukkan `.env.local` atau rahasia.
2. Di Cloudflare Dashboard → Workers & Pages → Create application → Pages → Connect to Git, pilih repository.
3. Atur build command `npm run build`, output directory `dist`, dan root directory ke folder proyek jika bukan root repo.
4. Tambahkan `VITE_SUPABASE_URL` serta `VITE_SUPABASE_ANON_KEY` di konfigurasi environment Pages untuk Production (dan Preview bila diperlukan), lalu deploy. Variabel tersebut adalah URL dan public/anon key; RLS tetap wajib. Jangan pernah masukkan service-role key.
5. Salin URL `*.pages.dev` hasil deploy ke Supabase **Site URL** dan **Redirect URLs**. Setelah itu bagikan URL tersebut kepada teman.

Cloudflare Pages Free menyajikan file statis lewat CDN dan kuotanya saat ini mencakup hingga 500 build/bulan; lihat [limits resmi Cloudflare Pages](https://developers.cloudflare.com/pages/platform/limits/). Frontend statis tidak perlu server pribadi tetap menyala. Namun **tidak ada jaminan SLA uptime pada kombinasi gratis ini**: menurut [harga resmi Supabase](https://supabase.com/pricing), project Free dapat dijeda setelah satu minggu tidak aktif. Jadi ini cocok untuk prototipe/pemakaian ringan, bukan layanan backend yang dijamin 24/7. Untuk backend selalu aktif, Supabase Pro mulai dari US$25/bulan. Email autentikasi untuk pendaftaran teman juga memerlukan SMTP yang layak; penyedia email bawaan memiliki batas kirim rendah.

Deploy belum dilakukan dari workspace ini: perlu akun Cloudflare, repository remote, dan project/kredensial Supabase milikmu. Instruksi ini menyiapkan konfigurasi agar setelah kredensial tersebut tersedia kamu dapat menerbitkannya tanpa menyimpan rahasia dalam kode.

Setiap tabel finansial memakai RLS berbasis `auth.uid()`, dan relasi transaksi memeriksa kepemilikan akun/kategori melalui foreign key gabungan. Supabase Auth menangani sesi login email/kata sandi.

## Yang tersedia

- Dashboard saldo dan arus kas, akun manual, pemasukan/pengeluaran/transfer, serta pengubahan saldo awal dengan riwayat audit.
- Target tabungan dengan kontribusi/penarikan dan pemeriksaan agar alokasi tidak negatif.
- Jadwal mingguan/bulanan/tahunan, pengingat dalam aplikasi, pencatatan setelah konfirmasi, serta auto-catat opsional saat aplikasi dibuka.
- Anggaran per kategori/bulan, salin anggaran ke bulan lain, laporan/perbandingan, ekspor CSV, dan cadangan JSON.
- Pencarian dan filter transaksi berdasarkan jenis, tanggal, kategori, serta akun; pengelolaan kategori dan akun.
- Insight berbasis perhitungan data aplikasi; AI server-side dan saran kategori opsional jika dikonfigurasi dan disetujui.
- Preferensi mata uang tampilan (tanpa konversi), zona waktu Indonesia, nama tampilan, onboarding, dan penghapusan data keuangan dengan konfirmasi berlapis.
- Layout responsif, navigasi ponsel, manifest dan service worker untuk cache shell aplikasi.

**Batasan penting:** Mode lokal menyimpan data hanya di browser/perangkat tersebut. PWA hanya menyimpan shell dan aset statis—tidak ada sinkronisasi atau penulisan data offline. Auto-catat rutin berjalan hanya ketika aplikasi dibuka; pengingat browser bukan layanan push terjadwal ketika aplikasi tertutup. Perubahan mata uang hanya mengubah tampilan, bukan mengonversi nominal; transaksi dicatat dalam bilangan bulat rupiah. Sinkronisasi Supabase mengirim perubahan beberapa tabel dalam beberapa permintaan sehingga bukan satu transaksi database atomik. Ekspor cadangan berkala dianjurkan.

Tidak ada data contoh sintetis yang dicampur dengan catatan pengguna. Fitur dasar berjalan tanpa AI dan tanpa koneksi rekening bank.
