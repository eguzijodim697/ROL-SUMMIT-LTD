# ROL SUMMIT LTD — магазин на Netlify + Stripe

Статический сайт (HTML/CSS/vanilla JS) + 3 Netlify Functions. Товары берутся из Stripe в реальном времени, корзина хранится в браузере, оплата всей корзины одним платежом через Stripe Hosted Checkout.

## 1. Деплой

1. Залейте папку в GitHub/GitLab и импортируйте репозиторий в Netlify (**Add new site → Import an existing project**). Build command оставьте пустым, publish directory — `.` (уже задано в `netlify.toml`).
   Альтернатива: `npm install` → `npx netlify deploy --prod`. Обычный drag & drop **не** разворачивает функции.
2. **Site configuration → Environment variables** → добавьте:
   - `STRIPE_SECRET_KEY` = `sk_live_...` (или `sk_test_...` для теста). Scope должен включать **Functions**.
3. Сделайте **Redeploy** — переменные применяются только после нового деплоя.
4. **Forms → Enable form detection**, затем ещё раз Redeploy — чтобы заработала форма на странице Contact.

Рекомендация по безопасности: вместо полного секретного ключа можно создать **restricted key** со правами Products: Read, Prices: Read, Checkout Sessions: Write.

Publishable key для Hosted Checkout не нужен. Поле в `assets/js/config.js` можно оставить пустым.

### Необязательные переменные
| Переменная | Что делает |
|---|---|
| `STRIPE_SHIPPING_RATE_IDS` | ID тарифов доставки из Stripe (`shr_...`, через запятую, до 5) — показываются на checkout |
| `STRIPE_ALLOWED_COUNTRIES` | Страны доставки, по умолчанию `GB` |
| `STRIPE_AUTOMATIC_TAX` | `true` — включает Stripe Tax (если он настроен в Stripe) |

## 2. Как добавлять товары в Stripe

Stripe Dashboard → **Product catalogue → Add product**:
- **Name**, **Description** (пустая строка между абзацами = новый абзац на сайте), **Images** (до 8 фото — первое главное, второе показывается при наведении в каталоге).
- **Price**: One-off, GBP. Эта цена становится default price — сайт использует именно её.
- **Metadata** (необязательно):
  | Ключ | Значение | Эффект |
  |---|---|---|
  | `category` | например `Storage` | Фильтр в каталоге и хлебные крошки |
  | `featured` | `true` | Товар первым попадает в «Selected pieces» на главной и в hero |
  | `order` | `1`, `2`, … | Ручная сортировка (меньше = выше) |
  | `hidden` | `true` | Скрыть товар с сайта, не архивируя его |
  | любой другой ключ | например `material`, `dimensions`, `finish` | Показывается в блоке Specifications на странице товара |

Новые товары и изменения появляются на сайте примерно в течение 30 секунд (короткий CDN-кэш). Архивированный в Stripe товар исчезает с сайта, а если он лежал у кого-то в корзине — при оплате он автоматически удаляется с сообщением клиенту.

## 3. Настройки Stripe перед запуском
- **Settings → Business → Customer emails → Successful payments** — включите письма-чеки, на которые ссылается страница success.
- **Public details**: название, сайт, email и телефон поддержки — они видны клиенту на checkout.
- Statement descriptor — чтобы клиент узнавал платёж в выписке (например `ROL SUMMIT`).
- Если нужна платная доставка — создайте Shipping rates и добавьте `STRIPE_SHIPPING_RATE_IDS`.

## 4. Чек-лист контента
- [ ] Отзывы на главной — образцы для дизайна. Замените их реальными или удалите блок до запуска (в HTML есть комментарий): публикация выдуманных отзывов в UK запрещена DMCC Act 2024.
- [ ] Добавьте номер компании (Companies House) в футер и в `about.html` — для UK LTD он обязателен на сайте.
- [ ] Проверьте сроки доставки (3–5 рабочих дней на отправку) в FAQ, Terms и на странице товара — поправьте под реальные.
- [ ] Часы работы на странице Contact.

## 5. Настройки сайта
`assets/js/config.js`: количество товаров на главной, максимум одного товара в корзине, `productImageFit` (`cover` — лайфстайл-фото, `contain` — предметные фото на белом фоне).

## 6. Локальный запуск
```bash
npm install
npx netlify dev          # нужен файл .env со строкой STRIPE_SECRET_KEY=sk_test_...
```
