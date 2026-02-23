# TrailFrame 3D (MVP)

3D 地球旅行路线动画网站原型，技术栈：Vite + Cesium + GSAP。

## 开发

```bash
npm install
npm run dev
```

## 构建

```bash
npm run build
npm run preview
```

## 部署到 Vercel

已添加 `vercel.json` 和 `.vercelignore`，可直接部署。

```bash
# 首次登录（如果未登录）
vercel login

# 预览环境部署
vercel deploy

# 生产环境部署
vercel deploy --prod
```

Vercel 项目构建参数已固定为：
- Install Command: `npm ci`
- Build Command: `npm run build`
- Output Directory: `dist`

## 数据配置

编辑 `src/tripData.js`：
- `city` / `country` / `flag`
- `lon` / `lat`
- `metric`
- `photos`
- `vehicle` (`plane` / `car`)

## 说明

- 地球场景与路径动画：`src/globeScene.js`
- HUD 卡片与播放控制：`src/main.js`
- 样式：`src/styles.css`

后续可扩展：
1. 增加模板编辑器（多段行程、配色、字体、图标）
2. 引入后端存储（路线 JSON、图片素材）
3. 接 Remotion/FFmpeg 导出 MP4
