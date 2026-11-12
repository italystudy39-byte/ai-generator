# CONTENT.LAB

Генератор постов для Telegram, Instagram и YouTube: три угла подачи (экспертный разбор, сторителлинг, прямой оффер), стриминг по словам, фоновая прегенерация для всех площадок, история в localStorage.

- Без ключа работает демо-генератор.
- С ключом Gemini API (кнопка `API KEY`, хранится только в браузере) — реальный SSE-стрим `gemini-3.5-flash-lite`.

## Структура

- `src/App.jsx`, `src/style.css` — исходники.

## Сборка

```bash
npm install
npm run build   # собирает dist/index.html из src/ (Vercel делает это сам при каждом пуше в main)
```
