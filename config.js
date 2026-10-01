// 工地貓 連線設定
// 填入 Supabase 後台 → Project Settings → API 的兩個值。
// anon / publishable key 本來就設計成放在網頁裡，可以公開；
// 千萬不要把 service_role 或 secret key 放在這裡。
window.GDM_CONFIG = {
  url: '',   // 例如 'https://abcdefghijk.supabase.co'
  key: ''    // anon public key（eyJ 開頭）或 publishable key（sb_publishable_ 開頭）
};
