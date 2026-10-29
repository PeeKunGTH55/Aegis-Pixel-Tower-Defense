# Pixel Art Web Game — Unified `pstack` Workflow (`D:\P\games`)

เอกสารนี้กำหนด Workflow กลาง, การผูก Skills, และบทบาทของ Subagents สำหรับพัฒนาเว็บเกม 2D Pixel Art ใน `D:\P\games` โดยใช้ **`pstack` (`$poteto-mode`)** เป็นแกนหลัก

---

## 1. Unified 5-Stage Game Development Workflow

ทุกงานพัฒนาฟีเจอร์ใหม่หรือแก้ไขระบบเกม ต้องเดินตาม 5 ขั้นตอนนี้โดยมี `$poteto-mode` เป็นตัวควบคุมหลัก:

1. **Stage 1: Scope, Domain Model & Architecture (`src/core/`)** — กำหนด Data Shape, Game State Machine, และ Scene Contracts เป็น Pure TypeScript แยกจาก Phaser
2. **Stage 2: Pixel Art Assets & Web Audio (`src/assets/`, `src/audio/`)** — กำหนด Base Grid `16x16` / `32x32`, ตั้งค่า `pixelArt: true`, `roundPixels: true` และ Web Audio SFX
3. **Stage 3: Engine & UI Implementation (`src/scenes/`, `src/main.ts`)** — พัฒนา Phaser Scene, 20x13 Free Grid & High Ground Terrain, และ Tactical HUD
4. **Stage 4: Dual Verification (`scripts/verify-formal-invariants.ts`, `scripts/verify-browser-gameplay.ts`)** — รัน `npm run verify:formal` และ `npm run verify:browser`
5. **Stage 5: Adversarial Review & Cleanup** — ตรวจสอบและล้างคอมเมนต์ขยะก่อนส่งมอบ
