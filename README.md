# 工地貓

室內設計公司的工地管理 Web App（PWA）。iPhone、iPad、Mac、Windows 用瀏覽器開啟即可，iPhone 可以「加入主畫面」當成 App 使用。

- 前端：單一 `index.html`（不需要編譯）
- 資料庫、登入、照片：Supabase
- 網址：GitHub Pages（免費、HTTPS）

## 第一次設定

### 1. Supabase
1. 建立專案，地區選 **Northeast Asia (Tokyo)**。
2. **SQL Editor → New query**，貼上 `supabase/schema.sql` 全部內容，按 **Run**。
3. **Authentication → Sign In / Providers**：關閉 **Allow new users to sign up**，只讓公司成員登入。
4. **Authentication → Users → Add user → Create new user**：替每位同事輸入 Email 和密碼，並勾選 **Auto Confirm User**。
5. **Project Settings → API**：複製 Project URL 和 anon public key，填進 `config.js`。

### 2. 第一次登入
每位同事第一次登入時，會被要求填寫名字和職位。

總監第一次登入後，到 SQL Editor 執行以下指令（把 Email 換成總監的），開啟總監的管理權限，例如刪除專案：

```sql
update public.profiles set is_admin = true
where id = (select id from auth.users where email = '總監的Email');
```

## 更新程式後重新部署
1. 修改檔案，把 `sw.js` 第一行的 `VERSION` 數字加 1，例如 `gdm-v1` 改成 `gdm-v2`。
2. 把變更推上 GitHub 的 `main` 分支。
3. 等待約 1 分鐘，GitHub Pages 會自動更新。
4. 手機上的 App 關掉再打開兩次，就會換成新版。

## 權限規則
- 沒登入的人看不到任何資料或照片。
- 登入的成員可以查看、新增、修改專案和紀錄。
- 只有總監（`is_admin`）可以刪除專案。
- 照片存在私人空間，只會產生有時效的連結給登入的成員。
