# Pul Nazorati — Telegram Web App

Shaxsiy daromad/xarajatlarni kuzatish va pul yig'ish maqsadlarini boshqarish uchun Telegram Mini App.

## Tarkibi

```
pul-nazorati/
├── server.js          # Express server + barcha API'lar
├── bot.js              # Telegram bot (/start buyrug'i, Web App tugmasi)
├── db.js                # SQLite ma'lumotlar bazasi
├── telegramAuth.js      # Telegram foydalanuvchisini xavfsiz tekshirish
├── public/index.html    # Frontend (bosh sahifa, statistika, maqsadlar, tahlil)
├── package.json
└── .env.example
```

---

## 1-QADAM: Telegram bot yaratish (BotFather)

1. Telegram'da **@BotFather** ni oching.
2. `/newbot` buyrug'ini yuboring.
3. Botga nom bering (masalan: `Pul Nazorati`), keyin username so'raladi — u albatta `bot` bilan tugashi kerak (masalan: `pul_nazorati_bot`).
4. BotFather sizga bir qator raqam va harflardan iborat **token** beradi — masalan:
   `123456789:AAExampleTokenFromBotFather`
   Bu tokenni saqlab qo'ying, hech kimga bermang.

---

## 2-QADAM: Kodni GitHub'ga yuklash

Railway/Render odatda GitHub repo orqali ishlaydi:

```bash
cd pul-nazorati
git init
git add .
git commit -m "Pul Nazorati - birinchi versiya"
```

Keyin GitHub'da yangi (bo'sh) repository yarating va:

```bash
git remote add origin https://github.com/FOYDALANUVCHI_NOMI/pul-nazorati.git
git branch -M main
git push -u origin main
```

---

## 3-QADAM: Railway'da joylashtirish (deploy)

1. https://railway.app ga kiring, GitHub hisobingiz bilan ro'yxatdan o'ting.
2. **New Project → Deploy from GitHub repo** ni tanlang, `pul-nazorati` repositoriyangizni tanlang.
3. Railway avtomatik `package.json`ni topib, `npm install` va `npm start`ni ishga tushiradi.
4. **Variables** (Environment Variables) bo'limiga o'ting va quyidagilarni qo'shing:
   - `BOT_TOKEN` — BotFather'dan olgan tokeningiz
   - `WEBAPP_URL` — hozircha bo'sh qoldiring, keyingi qadamda to'ldiramiz
5. **Settings → Networking → Generate Domain** tugmasini bosing — Railway sizga shunday domen beradi:
   `https://pul-nazorati-production.up.railway.app`
6. Shu domenni nusxalab, **Variables** bo'limidagi `WEBAPP_URL`ga qo'ying (masalan: `https://pul-nazorati-production.up.railway.app`) va saqlang — Railway avtomatik qayta ishga tushadi (redeploy).

> Render.com'da ham deyarli bir xil: **New → Web Service → GitHub repo tanlash → Environment Variables qo'shish → Deploy**.

---

## 4-QADAM: Bot tugmasini sozlash (Menu Button)

Ilova bot orqali ham (`/start` bosilganda), ham pastdagi ko'k tugma orqali ochilishi uchun:

1. @BotFather'ga qayting → `/mybots` → botingizni tanlang.
2. **Bot Settings → Menu Button → Configure Menu Button**.
3. So'ralganda, Railway domeningizni kiriting: `https://pul-nazorati-production.up.railway.app`

Endi botingizga `/start` yuborsangiz — tugma orqali ilova ochiladi.

---

## 5-QADAM: Sinab ko'rish

1. Telegram'da botingizni toping, `/start` bosing.
2. **"💰 Ilovani ochish"** tugmasini bosing.
3. Ilova ochiladi — pul kiritib, statistikani ko'rib, maqsad yaratib sinab ko'ring.

---

## Lokal kompyuterda sinash (Railway'siz)

```bash
npm install
cp .env.example .env
# .env faylini oching, BOT_TOKEN'ni kiriting, ALLOW_DEV_NO_AUTH=true qiling
npm start
```

Brauzerda `http://localhost:3000` manzilini oching — `ALLOW_DEV_NO_AUTH=true` bo'lgani uchun Telegram'siz ham ishlaydi (test uchun). **Production'da bu sozlamani albatta `false` qiling yoki umuman o'chiring**, aks holda har kim autentifikatsiyasiz ma'lumot yubora oladi.

---

## Muhim eslatmalar

- Ma'lumotlar bazasi (`data.db`) — SQLite fayl, server ishga tushgan joyda avtomatik yaratiladi. Railway'da bepul reja restart bo'lganda faylni yo'qotishi mumkin — agar ma'lumotlar doimiy saqlanishi kerak bo'lsa, Railway'ning **Volume** (doimiy disk) xizmatidan foydalaning yoki PostgreSQL'ga o'tish tavsiya etiladi.
- Bot **polling** rejimida ishlaydi (oddiy, kod yozish oson). Foydalanuvchilar ko'payib, tezlik muhim bo'lsa, keyinchalik **webhook** rejimiga o'tkazish mumkin.
- Har bir foydalanuvchining ma'lumotlari uning Telegram ID'si bo'yicha alohida saqlanadi — boshqa birov sizning ma'lumotlaringizni ko'ra olmaydi.

---

## Keyingi qadamlar (ixtiyoriy yaxshilashlar)

- Maqsadga muddat (sana) qo'shish
- Xarajat limiti va eslatma xabarlari
- Excel/PDF hisobot eksporti
- Bir necha valyuta qo'llab-quvvatlash
